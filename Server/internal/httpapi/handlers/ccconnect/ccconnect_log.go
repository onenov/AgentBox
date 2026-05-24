package ccconnect

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/danielgtaylor/huma/v2/sse"
)

const (
	defaultCCConnectLogKind = "runtime"
	defaultCCConnectLogTail = 200
	maxCCConnectLogTail     = 2000
	maxCCConnectTailBytes   = 512 * 1024
	ccConnectRuntimeLogFile = "agent-box-cc-connect.log"
	ccConnectMainLogFile    = "cc-connect.log"
)

var ccConnectLogFiles = map[string]string{
	"runtime": ccConnectRuntimeLogFile,
	"main":    ccConnectMainLogFile,
}

var ccConnectGoLogPattern = regexp.MustCompile(`^(?P<time>\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2})\s+(?P<level>[A-Z]+|\[[^\]]+])\s+(?P<message>.*)$`)

type CCConnectLogInput struct {
	Kind   string `query:"kind" enum:"runtime,main" example:"runtime" doc:"CC-Connect log type."`
	File   string `query:"file" example:"agent-box-cc-connect.log" doc:"Optional CC-Connect logs directory file name. Only files directly under the effective data_dir/logs directory are allowed. Prefer kind for known CC-Connect logs."`
	Tail   int    `query:"tail" example:"200" doc:"Number of recent lines to scan and send first. Maximum is 2000."`
	Follow string `query:"follow" example:"true" doc:"Whether to keep following new log lines. Defaults to true. Set to false to stop after the initial tail."`
	Filter string `query:"filter" example:"bridge" doc:"Case-insensitive text filter matched against raw log line, message, subsystem and level."`
	Levels string `query:"levels" example:"info,warn,error,fatal" doc:"Comma-separated log levels to include: trace, debug, info, warn, error, fatal."`
}

type CCConnectLogMetaEvent struct {
	Kind      string `json:"kind" doc:"Resolved CC-Connect log type."`
	Path      string `json:"path" doc:"Resolved log file path."`
	File      string `json:"file" doc:"Log file name."`
	Tail      int    `json:"tail" doc:"Requested tail line count."`
	Follow    bool   `json:"follow" doc:"Whether the stream keeps following new lines."`
	Filter    string `json:"filter,omitempty" doc:"Applied text filter."`
	Levels    string `json:"levels,omitempty" doc:"Applied comma-separated level filter."`
	Size      int64  `json:"size" doc:"Log file size in bytes when stream starts."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type CCConnectLogLineEvent struct {
	Line      string `json:"line" doc:"One raw log line."`
	Level     string `json:"level,omitempty" doc:"Parsed log level when available."`
	Message   string `json:"message,omitempty" doc:"Parsed log message when available."`
	Subsystem string `json:"subsystem,omitempty" doc:"Parsed log subsystem when available."`
	Time      string `json:"time,omitempty" doc:"Parsed log timestamp when available."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type CCConnectLogErrorEvent struct {
	Message   string `json:"message" doc:"Error message."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type CCConnectLogDoneEvent struct {
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type parsedCCConnectLogLine struct {
	Level     string
	Message   string
	Subsystem string
	Time      string
}

type ccConnectLogFilter struct {
	needle string
	levels map[string]bool
}

func CCConnectLogStream(ctx context.Context, input *CCConnectLogInput, send sse.Sender) {
	if input == nil {
		input = &CCConnectLogInput{}
	}

	logKind, logFile := resolveCCConnectLogSelection(input.Kind, input.File)
	logPath, err := resolveCCConnectLogPath(logKind, logFile)
	if err != nil {
		_ = send.Data(CCConnectLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
		return
	}

	tail := input.Tail
	if tail == 0 {
		tail = defaultCCConnectLogTail
	}
	tail = boundCCConnectInt(tail, 0, maxCCConnectLogTail)
	follow := parseCCConnectFollowQuery(input.Follow)

	file, stat, err := openCCConnectLogFile(logPath)
	if err != nil {
		_ = send.Data(CCConnectLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
		return
	}
	defer file.Close()

	if err := send.Data(CCConnectLogMetaEvent{
		Kind:      logKind,
		Path:      logPath,
		File:      filepath.Base(logPath),
		Tail:      tail,
		Follow:    follow,
		Filter:    strings.TrimSpace(input.Filter),
		Levels:    normalizeCCConnectLogLevels(input.Levels),
		Size:      stat.Size(),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		return
	}

	filter := newCCConnectLogFilter(input.Filter, input.Levels)

	if tail > 0 {
		lines, err := readCCConnectTailLines(file, stat.Size(), tail)
		if err != nil {
			_ = send.Data(CCConnectLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
		} else {
			for _, line := range lines {
				if !sendCCConnectLogLine(ctx, send, line, filter) {
					return
				}
			}
		}
	}

	offset, err := file.Seek(0, io.SeekEnd)
	if err != nil {
		_ = send.Data(CCConnectLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
		return
	}
	if !follow {
		_ = send.Data(CCConnectLogDoneEvent{Timestamp: time.Now().UTC().Format(time.RFC3339)})
		return
	}

	followCCConnectLogFile(ctx, send, logPath, file, offset, filter)
}

func followCCConnectLogFile(ctx context.Context, send sse.Sender, logPath string, file *os.File, offset int64, filter ccConnectLogFilter) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			stat, err := os.Stat(logPath)
			if err != nil {
				_ = send.Data(CCConnectLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
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
				_ = send.Data(CCConnectLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
				continue
			}

			reader := bufio.NewReader(file)
			for {
				line, err := reader.ReadString('\n')
				if len(line) > 0 {
					offset += int64(len(line))
					if !sendCCConnectLogLine(ctx, send, strings.TrimRight(line, "\r\n"), filter) {
						return
					}
				}
				if err != nil {
					if !errors.Is(err, io.EOF) {
						_ = send.Data(CCConnectLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
					}
					break
				}
			}
		}
	}
}

func sendCCConnectLogLine(ctx context.Context, send sse.Sender, line string, filter ccConnectLogFilter) bool {
	if !filter.match(line) {
		return true
	}
	parsed := parseCCConnectLogLine(line)
	select {
	case <-ctx.Done():
		return false
	default:
		return send.Data(CCConnectLogLineEvent{
			Line:      line,
			Level:     parsed.Level,
			Message:   parsed.Message,
			Subsystem: parsed.Subsystem,
			Time:      parsed.Time,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}) == nil
	}
}

func readCCConnectTailLines(file *os.File, size int64, tail int) ([]string, error) {
	if size < 0 {
		size = 0
	}
	start := int64(0)
	if size > maxCCConnectTailBytes {
		start = size - maxCCConnectTailBytes
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

func openCCConnectLogFile(path string) (*os.File, os.FileInfo, error) {
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

func resolveCCConnectLogPath(kind string, file string) (string, error) {
	logsDir := filepath.Join(resolveCCConnectLogDataDir(), "logs")
	logPath := filepath.Join(logsDir, file)
	cleanLogsDir := filepath.Clean(logsDir)
	cleanLogPath := filepath.Clean(logPath)
	if cleanLogPath != filepath.Join(cleanLogsDir, filepath.Base(cleanLogPath)) {
		return "", fmt.Errorf("invalid log file")
	}
	if kind == "main" && filepath.Base(cleanLogPath) == ccConnectMainLogFile && !pathIsFile(cleanLogPath) {
		fallbackPath := filepath.Join(cleanLogsDir, ccConnectRuntimeLogFile)
		if pathIsFile(fallbackPath) {
			return fallbackPath, nil
		}
	}
	return cleanLogPath, nil
}

func resolveCCConnectLogSelection(kind string, file string) (string, string) {
	kind = strings.TrimSpace(strings.ToLower(kind))
	file = strings.TrimSpace(file)
	if file != "" {
		return "custom", normalizeCCConnectLogFile(file)
	}
	if kind == "" {
		kind = defaultCCConnectLogKind
	}
	if logFile, ok := ccConnectLogFiles[kind]; ok {
		return kind, logFile
	}
	return kind, normalizeCCConnectLogFile(kind)
}

func normalizeCCConnectLogFile(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ccConnectLogFiles[defaultCCConnectLogKind]
	}
	return filepath.Base(value)
}

func resolveCCConnectLogDataDir() string {
	configPath, _ := resolveCCConnectConfigPath()
	data, err := os.ReadFile(configPath)
	if err != nil {
		return defaultCCConnectDataDir()
	}
	var cfg ccConnectConfigFile
	if _, err := toml.Decode(string(data), &cfg); err != nil {
		return defaultCCConnectDataDir()
	}
	return effectiveCCConnectDataDir(cfg.DataDir)
}

func newCCConnectLogFilter(filter string, levels string) ccConnectLogFilter {
	return ccConnectLogFilter{
		needle: strings.ToLower(strings.TrimSpace(filter)),
		levels: parseCCConnectLogLevelSet(levels),
	}
}

func (filter ccConnectLogFilter) match(line string) bool {
	parsed := parseCCConnectLogLine(line)
	if len(filter.levels) > 0 && parsed.Level != "" && !filter.levels[parsed.Level] {
		return false
	}
	if filter.needle == "" {
		return true
	}
	haystack := strings.ToLower(strings.Join([]string{line, parsed.Level, parsed.Message, parsed.Subsystem}, " "))
	return strings.Contains(haystack, filter.needle)
}

func parseCCConnectLogLine(line string) parsedCCConnectLogLine {
	var raw map[string]any
	if err := json.Unmarshal([]byte(line), &raw); err == nil {
		level := firstCCConnectStringField(raw, "level", "severity")
		message := firstCCConnectStringField(raw, "message", "msg", "event")
		subsystem := firstCCConnectStringField(raw, "subsystem", "module", "component", "scope", "name", "platform", "project")
		if message == "" {
			message = subsystem
		}
		if level == "" && message != "" {
			level = "info"
		}
		return parsedCCConnectLogLine{
			Level:     normalizeParsedCCConnectLogLevel(level),
			Message:   message,
			Subsystem: subsystem,
			Time:      firstCCConnectStringField(raw, "time", "timestamp", "ts"),
		}
	}

	if fields := parseCCConnectKeyValueLogLine(line); len(fields) > 0 {
		level := normalizeParsedCCConnectLogLevel(fields["level"])
		message := fields["msg"]
		if message == "" {
			message = fields["message"]
		}
		return parsedCCConnectLogLine{
			Level:     level,
			Message:   firstNonEmptyLine(message, line),
			Subsystem: firstNonEmptyLine(fields["platform"], fields["project"], fields["addr"], fields["socket"]),
			Time:      fields["time"],
		}
	}

	if matches := ccConnectGoLogPattern.FindStringSubmatch(line); len(matches) > 0 {
		values := ccConnectRegexpMatchMap(ccConnectGoLogPattern, matches)
		return parsedCCConnectLogLine{
			Level:   normalizeParsedCCConnectLogLevel(strings.Trim(values["level"], "[]")),
			Message: values["message"],
			Time:    normalizeCCConnectGoLogTime(values["time"]),
		}
	}

	return parsedCCConnectLogLine{Message: line}
}

func parseCCConnectKeyValueLogLine(line string) map[string]string {
	fields := make(map[string]string)
	index := 0
	for index < len(line) {
		for index < len(line) && line[index] == ' ' {
			index += 1
		}
		keyStart := index
		for index < len(line) && line[index] != '=' && line[index] != ' ' {
			index += 1
		}
		if index >= len(line) || line[index] != '=' {
			for index < len(line) && line[index] != ' ' {
				index += 1
			}
			continue
		}
		key := strings.TrimSpace(line[keyStart:index])
		index += 1

		var value string
		if index < len(line) && line[index] == '"' {
			index += 1
			var builder strings.Builder
			for index < len(line) {
				if line[index] == '\\' && index+1 < len(line) {
					builder.WriteByte(line[index+1])
					index += 2
					continue
				}
				if line[index] == '"' {
					index += 1
					break
				}
				builder.WriteByte(line[index])
				index += 1
			}
			value = builder.String()
		} else {
			valueStart := index
			for index < len(line) && line[index] != ' ' {
				index += 1
			}
			value = line[valueStart:index]
		}

		if key != "" {
			fields[key] = value
		}
	}
	return fields
}

func firstCCConnectStringField(raw map[string]any, keys ...string) string {
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

func ccConnectRegexpMatchMap(pattern *regexp.Regexp, matches []string) map[string]string {
	values := make(map[string]string)
	names := pattern.SubexpNames()
	for index, name := range names {
		if index > 0 && name != "" && index < len(matches) {
			values[name] = matches[index]
		}
	}
	return values
}

func normalizeCCConnectGoLogTime(value string) string {
	parsed, err := time.ParseInLocation("2006/01/02 15:04:05", value, time.Local)
	if err != nil {
		return value
	}
	return parsed.Format(time.RFC3339)
}

func normalizeParsedCCConnectLogLevel(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "warning" {
		return "warn"
	}
	return value
}

func parseCCConnectLogLevelSet(value string) map[string]bool {
	value = normalizeCCConnectLogLevels(value)
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

func normalizeCCConnectLogLevels(value string) string {
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

func parseCCConnectFollowQuery(value string) bool {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return true
	}
	return value != "false" && value != "0" && value != "off"
}

func parseCCConnectBoundedInt(value string, fallback int, minValue int, maxValue int) int {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return boundCCConnectInt(parsed, minValue, maxValue)
}

func boundCCConnectInt(value int, minValue int, maxValue int) int {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}
