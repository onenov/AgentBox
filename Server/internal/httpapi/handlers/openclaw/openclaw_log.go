package openclaw

// OpenClawLog handler 用于从当前主机的 OpenClaw 日志目录读取并流式推送日志。
//
// 该接口固定使用 /openclaw/log 路径，默认读取 OpenClaw 的 Gateway 日志文件，
// 支持通过 file 指定同类日志文件，通过 tail 控制首次返回的尾部行数。
//
// 接口使用 Server-Sent Events 持续输出，不读取或暴露 OpenClaw 配置中的敏感字段。

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2/sse"
)

const (
	defaultOpenClawLogKind = "gateway-err"
	defaultOpenClawLogTail = 200
	maxOpenClawLogTail     = 2000
	maxOpenClawTailBytes   = 512 * 1024
)

var openClawLogFiles = map[string]string{
	"gateway":      "gateway.log",
	"gateway-err":  "gateway.err.log",
	"guardian":     "guardian.log",
	"config-audit": "config-audit.log",
}

type OpenClawLogInput struct {
	Kind   string `query:"kind" enum:"gateway,gateway-err,guardian,config-audit" example:"gateway-err" doc:"OpenClaw log type. Backup logs are intentionally not exposed here."`
	File   string `query:"file" example:"gateway.err.log" doc:"Optional OpenClaw log file name. Prefer kind for known OpenClaw logs."`
	Tail   int    `query:"tail" example:"200" doc:"Number of recent lines to scan and send first. Maximum is 2000."`
	Follow string `query:"follow" example:"true" doc:"Whether to keep following new log lines. Defaults to true. Set to false to stop after the initial tail."`
	Filter string `query:"filter" example:"gateway" doc:"Case-insensitive text filter matched against raw log line, message, subsystem and level."`
	Levels string `query:"levels" example:"info,warn,error,fatal" doc:"Comma-separated log levels to include: trace, debug, info, warn, error, fatal."`
}

type OpenClawLogMetaEvent struct {
	Kind      string `json:"kind" doc:"Resolved OpenClaw log type."`
	Path      string `json:"path" doc:"Resolved log file path."`
	File      string `json:"file" doc:"Log file name."`
	Tail      int    `json:"tail" doc:"Requested tail line count."`
	Follow    bool   `json:"follow" doc:"Whether the stream keeps following new lines."`
	Filter    string `json:"filter,omitempty" doc:"Applied text filter."`
	Levels    string `json:"levels,omitempty" doc:"Applied comma-separated level filter."`
	Size      int64  `json:"size" doc:"Log file size in bytes when stream starts."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type OpenClawLogLineEvent struct {
	Line      string `json:"line" doc:"One raw log line."`
	Level     string `json:"level,omitempty" doc:"Parsed log level when available."`
	Message   string `json:"message,omitempty" doc:"Parsed log message when available."`
	Subsystem string `json:"subsystem,omitempty" doc:"Parsed log subsystem when available."`
	Time      string `json:"time,omitempty" doc:"Parsed log timestamp when available."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type OpenClawLogErrorEvent struct {
	Message   string `json:"message" doc:"Error message."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type OpenClawLogDoneEvent struct {
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

func OpenClawLogStream(ctx context.Context, input *OpenClawLogInput, send sse.Sender) {
	if input == nil {
		input = &OpenClawLogInput{}
	}

	logKind, logFile := resolveOpenClawLogSelection(input.Kind, input.File)
	logPath, err := resolveOpenClawLogPath(logFile)
	if err != nil {
		_ = send.Data(OpenClawLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
		return
	}

	tail := input.Tail
	if tail == 0 {
		tail = defaultOpenClawLogTail
	}
	tail = boundInt(tail, 0, maxOpenClawLogTail)
	follow := parseFollowQuery(input.Follow)

	file, stat, err := openLogFile(logPath)
	if err != nil {
		_ = send.Data(OpenClawLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
		return
	}
	defer file.Close()

	if err := send.Data(OpenClawLogMetaEvent{
		Kind:      logKind,
		Path:      logPath,
		File:      logFile,
		Tail:      tail,
		Follow:    follow,
		Filter:    strings.TrimSpace(input.Filter),
		Levels:    normalizeLogLevels(input.Levels),
		Size:      stat.Size(),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		return
	}

	filter := newOpenClawLogFilter(input.Filter, input.Levels)

	if tail > 0 {
		lines, err := readTailLines(file, stat.Size(), tail)
		if err != nil {
			_ = send.Data(OpenClawLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
		} else {
			for _, line := range lines {
				if !sendLogLine(ctx, send, line, filter) {
					return
				}
			}
		}
	}

	offset, err := file.Seek(0, io.SeekEnd)
	if err != nil {
		_ = send.Data(OpenClawLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
		return
	}
	if !follow {
		_ = send.Data(OpenClawLogDoneEvent{Timestamp: time.Now().UTC().Format(time.RFC3339)})
		return
	}

	followLogFile(ctx, send, logPath, file, offset, filter)
}

func followLogFile(ctx context.Context, send sse.Sender, logPath string, file *os.File, offset int64, filter logFilter) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			stat, err := os.Stat(logPath)
			if err != nil {
				_ = send.Data(OpenClawLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
				continue
			}

			if stat.Size() < offset {
				if reopened, err := os.Open(logPath); err == nil {
					_ = file.Close()
					file = reopened
					offset = 0
				}
			}
			if stat.Size() == offset {
				continue
			}

			if _, err := file.Seek(offset, io.SeekStart); err != nil {
				_ = send.Data(OpenClawLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
				continue
			}

			reader := bufio.NewReader(file)
			for {
				line, err := reader.ReadString('\n')
				if len(line) > 0 {
					offset += int64(len(line))
					if !sendLogLine(ctx, send, strings.TrimRight(line, "\r\n"), filter) {
						return
					}
				}
				if err != nil {
					if !errors.Is(err, io.EOF) {
						_ = send.Data(OpenClawLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
					}
					break
				}
			}
		}
	}
}

func sendLogLine(ctx context.Context, send sse.Sender, line string, filter logFilter) bool {
	if !filter.match(line) {
		return true
	}
	parsed := parseOpenClawLogLine(line)
	select {
	case <-ctx.Done():
		return false
	default:
		return send.Data(OpenClawLogLineEvent{
			Line:      line,
			Level:     parsed.Level,
			Message:   parsed.Message,
			Subsystem: parsed.Subsystem,
			Time:      parsed.Time,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}) == nil
	}
}

func readTailLines(file *os.File, size int64, tail int) ([]string, error) {
	if size < 0 {
		size = 0
	}
	start := int64(0)
	if size > maxOpenClawTailBytes {
		start = size - maxOpenClawTailBytes
	}
	if _, err := file.Seek(start, io.SeekStart); err != nil {
		return nil, err
	}

	content, err := io.ReadAll(file)
	if err != nil {
		return nil, err
	}
	text := strings.TrimRight(string(content), "\r\n")
	if text == "" {
		return nil, nil
	}
	lines := strings.Split(text, "\n")
	if len(lines) <= tail {
		return lines, nil
	}
	return lines[len(lines)-tail:], nil
}

func openLogFile(path string) (*os.File, os.FileInfo, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	stat, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, nil, err
	}
	if stat.IsDir() {
		_ = file.Close()
		return nil, nil, fmt.Errorf("%s is a directory", path)
	}
	return file, stat, nil
}

func resolveOpenClawLogPath(file string) (string, error) {
	candidates := openClawLogPathCandidates(file)
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if fileInfo, err := os.Stat(candidate); err == nil && !fileInfo.IsDir() {
			return candidate, nil
		}
	}
	if len(candidates) == 0 {
		return "", fmt.Errorf("invalid log file")
	}
	return "", fmt.Errorf("openclaw log file not found: %s", candidates[0])
}

func resolveOpenClawLogSelection(kind string, file string) (string, string) {
	kind = strings.TrimSpace(strings.ToLower(kind))
	file = strings.TrimSpace(file)
	if file != "" {
		return "custom", normalizeOpenClawLogFile(file)
	}
	if kind == "" {
		kind = defaultOpenClawLogKind
	}
	if logFile, ok := openClawLogFiles[kind]; ok {
		return kind, logFile
	}
	return kind, normalizeOpenClawLogFile(kind)
}

func normalizeOpenClawLogFile(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return openClawLogFiles[defaultOpenClawLogKind]
	}
	return filepath.Base(value)
}

func openClawLogPathCandidates(file string) []string {
	cleanFile := filepath.Base(strings.TrimSpace(file))
	if cleanFile == "." || cleanFile == string(filepath.Separator) || cleanFile == "" {
		return nil
	}
	paths := make([]string, 0, 4)
	if logsDir := openClawConfiguredLogsDir(); strings.TrimSpace(logsDir) != "" {
		paths = append(paths, filepath.Join(logsDir, cleanFile))
	}
	paths = append(paths,
		filepath.Join(defaultOpenClawHomeDir(), "logs", cleanFile),
		filepath.Join(os.TempDir(), "openclaw", cleanFile),
	)
	if homeDir, err := os.UserHomeDir(); err == nil && homeDir != "" {
		paths = append(paths, filepath.Join(homeDir, "Library", "Logs", "openclaw", cleanFile))
	}
	return uniqueStrings(paths)
}

func openClawConfiguredLogsDir() string {
	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		return ""
	}
	gateway := objectMap(content["gateway"])
	logsDir := stringFromMap(gateway, "logsDir")
	return strings.TrimSpace(logsDir)
}

type parsedOpenClawLogLine struct {
	Level     string
	Message   string
	Subsystem string
	Time      string
}

type logFilter struct {
	needle string
	levels map[string]bool
}

func newOpenClawLogFilter(filter string, levels string) logFilter {
	return logFilter{
		needle: strings.ToLower(strings.TrimSpace(filter)),
		levels: parseLogLevelSet(levels),
	}
}

func (filter logFilter) match(line string) bool {
	parsed := parseOpenClawLogLine(line)
	if len(filter.levels) > 0 && parsed.Level != "" && !filter.levels[parsed.Level] {
		return false
	}
	if filter.needle == "" {
		return true
	}
	haystack := strings.ToLower(strings.Join([]string{line, parsed.Level, parsed.Message, parsed.Subsystem}, " "))
	return strings.Contains(haystack, filter.needle)
}

func parseOpenClawLogLine(line string) parsedOpenClawLogLine {
	var raw map[string]any
	if err := json.Unmarshal([]byte(line), &raw); err != nil {
		return parsedOpenClawLogLine{Message: line}
	}
	return parsedOpenClawLogLine{
		Level:     firstStringField(raw, "level", "severity"),
		Message:   firstStringField(raw, "message", "msg", "event"),
		Subsystem: firstStringField(raw, "subsystem", "module", "component", "scope", "name"),
		Time:      firstStringField(raw, "time", "timestamp", "ts"),
	}
}

func firstStringField(raw map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := raw[key]; ok {
			switch typed := value.(type) {
			case string:
				return strings.TrimSpace(typed)
			case float64:
				return fmt.Sprintf("%.0f", typed)
			}
		}
	}
	return ""
}

func parseLogLevelSet(value string) map[string]bool {
	value = normalizeLogLevels(value)
	if value == "" {
		return nil
	}
	levels := make(map[string]bool)
	for _, item := range strings.Split(value, ",") {
		level := strings.TrimSpace(strings.ToLower(item))
		if level != "" {
			levels[level] = true
		}
	}
	return levels
}

func normalizeLogLevels(value string) string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, item := range parts {
		level := strings.TrimSpace(strings.ToLower(item))
		if level != "" {
			out = append(out, level)
		}
	}
	return strings.Join(out, ",")
}

func parseFollowQuery(value string) bool {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return true
	}
	return value != "false" && value != "0" && value != "off"
}

func parseBoundedInt(value string, fallback int, minValue int, maxValue int) int {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return boundInt(parsed, minValue, maxValue)
}

func boundInt(value int, minValue int, maxValue int) int {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}
