package hermes

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

	"github.com/danielgtaylor/huma/v2/sse"
)

const (
	defaultHermesLogKind = "gateway"
	defaultHermesLogTail = 200
	maxHermesLogTail     = 2000
	maxHermesTailBytes   = 512 * 1024
)

var hermesLogFiles = map[string]string{
	"gateway":      "logs/gateway.log",
	"gateway-run":  "gateway-run.log",
	"gateway-exit": "logs/gateway-exit-diag.log",
	"errors":       "logs/errors.log",
	"agent":        "logs/agent.log",
}

var hermesPythonLogPattern = regexp.MustCompile(`^(?P<time>\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},\d{3})\s+(?P<level>[A-Z]+)\s+(?P<subsystem>[^:]+):\s*(?P<message>.*)$`)

type HermesLogInput struct {
	Kind    string `query:"kind" enum:"gateway,gateway-run,gateway-exit,errors,agent" example:"gateway" doc:"Hermes log type."`
	File    string `query:"file" example:"agent.log" doc:"Optional Hermes logs directory file name. Only files directly under ~/.hermes/logs are allowed. Prefer kind for known Hermes logs."`
	Tail    int    `query:"tail" example:"200" doc:"Number of recent lines to scan and send first. Maximum is 2000."`
	Follow  string `query:"follow" example:"true" doc:"Whether to keep following new log lines. Defaults to true. Set to false to stop after the initial tail."`
	Filter  string `query:"filter" example:"gateway" doc:"Case-insensitive text filter matched against raw log line, message, subsystem and level."`
	Levels  string `query:"levels" example:"info,warn,error,fatal" doc:"Comma-separated log levels to include: trace, debug, info, warn, error, fatal."`
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
}

type HermesLogMetaEvent struct {
	Kind      string `json:"kind" doc:"Resolved Hermes log type."`
	Path      string `json:"path" doc:"Resolved log file path."`
	File      string `json:"file" doc:"Log file name."`
	Tail      int    `json:"tail" doc:"Requested tail line count."`
	Follow    bool   `json:"follow" doc:"Whether the stream keeps following new lines."`
	Filter    string `json:"filter,omitempty" doc:"Applied text filter."`
	Levels    string `json:"levels,omitempty" doc:"Applied comma-separated level filter."`
	Size      int64  `json:"size" doc:"Log file size in bytes when stream starts."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type HermesLogLineEvent struct {
	Line      string `json:"line" doc:"One raw log line."`
	Level     string `json:"level,omitempty" doc:"Parsed log level when available."`
	Message   string `json:"message,omitempty" doc:"Parsed log message when available."`
	Subsystem string `json:"subsystem,omitempty" doc:"Parsed log subsystem when available."`
	Time      string `json:"time,omitempty" doc:"Parsed log timestamp when available."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type HermesLogErrorEvent struct {
	Message   string `json:"message" doc:"Error message."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type HermesLogDoneEvent struct {
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type parsedHermesLogLine struct {
	Level     string
	Message   string
	Subsystem string
	Time      string
}

type hermesLogFilter struct {
	needle string
	levels map[string]bool
}

func HermesLogStream(ctx context.Context, input *HermesLogInput, send sse.Sender) {
	if input == nil {
		input = &HermesLogInput{}
	}

	profile, err := resolveHermesProfileSelection(input.Profile)
	if err != nil {
		_ = send.Data(HermesLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
		return
	}
	logKind, logFile := resolveHermesLogSelection(input.Kind, input.File)
	logPath, err := resolveHermesLogPath(profile, logFile)
	if err != nil {
		_ = send.Data(HermesLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
		return
	}

	tail := input.Tail
	if tail == 0 {
		tail = defaultHermesLogTail
	}
	tail = boundHermesInt(tail, 0, maxHermesLogTail)
	follow := parseHermesFollowQuery(input.Follow)

	file, stat, err := openHermesLogFile(logPath)
	if err != nil {
		_ = send.Data(HermesLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
		return
	}
	defer file.Close()

	if err := send.Data(HermesLogMetaEvent{
		Kind:      logKind,
		Path:      logPath,
		File:      filepath.Base(logPath),
		Tail:      tail,
		Follow:    follow,
		Filter:    strings.TrimSpace(input.Filter),
		Levels:    normalizeHermesLogLevels(input.Levels),
		Size:      stat.Size(),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		return
	}

	filter := newHermesLogFilter(input.Filter, input.Levels)

	if tail > 0 {
		lines, err := readHermesTailLines(file, stat.Size(), tail)
		if err != nil {
			_ = send.Data(HermesLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
		} else {
			for _, line := range lines {
				if !sendHermesLogLine(ctx, send, line, filter) {
					return
				}
			}
		}
	}

	offset, err := file.Seek(0, io.SeekEnd)
	if err != nil {
		_ = send.Data(HermesLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
		return
	}
	if !follow {
		_ = send.Data(HermesLogDoneEvent{Timestamp: time.Now().UTC().Format(time.RFC3339)})
		return
	}

	followHermesLogFile(ctx, send, logPath, file, offset, filter)
}

func followHermesLogFile(ctx context.Context, send sse.Sender, logPath string, file *os.File, offset int64, filter hermesLogFilter) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			stat, err := os.Stat(logPath)
			if err != nil {
				_ = send.Data(HermesLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
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
				_ = send.Data(HermesLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
				continue
			}

			reader := bufio.NewReader(file)
			for {
				line, err := reader.ReadString('\n')
				if len(line) > 0 {
					offset += int64(len(line))
					if !sendHermesLogLine(ctx, send, strings.TrimRight(line, "\r\n"), filter) {
						return
					}
				}
				if err != nil {
					if !errors.Is(err, io.EOF) {
						_ = send.Data(HermesLogErrorEvent{Message: err.Error(), Timestamp: time.Now().UTC().Format(time.RFC3339)})
					}
					break
				}
			}
		}
	}
}

func sendHermesLogLine(ctx context.Context, send sse.Sender, line string, filter hermesLogFilter) bool {
	if !filter.match(line) {
		return true
	}
	parsed := parseHermesLogLine(line)
	select {
	case <-ctx.Done():
		return false
	default:
		return send.Data(HermesLogLineEvent{
			Line:      line,
			Level:     parsed.Level,
			Message:   parsed.Message,
			Subsystem: parsed.Subsystem,
			Time:      parsed.Time,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}) == nil
	}
}

func readHermesTailLines(file *os.File, size int64, tail int) ([]string, error) {
	if size < 0 {
		size = 0
	}
	start := int64(0)
	if size > maxHermesTailBytes {
		start = size - maxHermesTailBytes
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

func openHermesLogFile(path string) (*os.File, os.FileInfo, error) {
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

func resolveHermesLogPath(profile HermesProfileSelection, file string) (string, error) {
	home := profile.Path
	logPath := filepath.Join(home, file)
	cleanHome := filepath.Clean(home)
	cleanLogPath := filepath.Clean(logPath)
	if cleanLogPath == filepath.Join(cleanHome, "gateway-run.log") {
		return cleanLogPath, nil
	}
	logsDir := filepath.Join(cleanHome, "logs")
	if cleanLogPath != filepath.Join(logsDir, filepath.Base(cleanLogPath)) {
		return "", fmt.Errorf("invalid log file")
	}
	return cleanLogPath, nil
}

func resolveHermesLogSelection(kind string, file string) (string, string) {
	kind = strings.TrimSpace(strings.ToLower(kind))
	file = strings.TrimSpace(file)
	if file != "" {
		return "custom", filepath.Join("logs", normalizeHermesLogFile(file))
	}
	if kind == "" {
		kind = defaultHermesLogKind
	}
	if logFile, ok := hermesLogFiles[kind]; ok {
		return kind, logFile
	}
	return kind, filepath.Join("logs", normalizeHermesLogFile(kind))
}

func normalizeHermesLogFile(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return filepath.Base(hermesLogFiles[defaultHermesLogKind])
	}
	return filepath.Base(value)
}

func newHermesLogFilter(filter string, levels string) hermesLogFilter {
	return hermesLogFilter{
		needle: strings.ToLower(strings.TrimSpace(filter)),
		levels: parseHermesLogLevelSet(levels),
	}
}

func (filter hermesLogFilter) match(line string) bool {
	parsed := parseHermesLogLine(line)
	if len(filter.levels) > 0 && parsed.Level != "" && !filter.levels[parsed.Level] {
		return false
	}
	if filter.needle == "" {
		return true
	}
	haystack := strings.ToLower(strings.Join([]string{line, parsed.Level, parsed.Message, parsed.Subsystem}, " "))
	return strings.Contains(haystack, filter.needle)
}

func parseHermesLogLine(line string) parsedHermesLogLine {
	var raw map[string]any
	if err := json.Unmarshal([]byte(line), &raw); err == nil {
		level := firstHermesStringField(raw, "level", "severity")
		message := firstHermesStringField(raw, "message", "msg", "event")
		subsystem := firstHermesStringField(raw, "subsystem", "module", "component", "scope", "name", "tag")
		if message == "" {
			message = subsystem
		}
		if level == "" && message != "" {
			level = "info"
		}
		return parsedHermesLogLine{
			Level:     normalizeParsedHermesLogLevel(level),
			Message:   message,
			Subsystem: subsystem,
			Time:      firstHermesStringField(raw, "time", "timestamp", "ts"),
		}
	}

	if matches := hermesPythonLogPattern.FindStringSubmatch(line); len(matches) > 0 {
		values := regexpMatchMap(hermesPythonLogPattern, matches)
		return parsedHermesLogLine{
			Level:     normalizeParsedHermesLogLevel(values["level"]),
			Message:   values["message"],
			Subsystem: strings.TrimSpace(values["subsystem"]),
			Time:      normalizeHermesPythonLogTime(values["time"]),
		}
	}

	return parsedHermesLogLine{Message: line}
}

func normalizeParsedHermesLogLevel(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "warning" {
		return "warn"
	}
	return value
}

func firstHermesStringField(raw map[string]any, keys ...string) string {
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

func regexpMatchMap(pattern *regexp.Regexp, matches []string) map[string]string {
	values := make(map[string]string)
	names := pattern.SubexpNames()
	for index, name := range names {
		if index > 0 && name != "" && index < len(matches) {
			values[name] = matches[index]
		}
	}
	return values
}

func normalizeHermesPythonLogTime(value string) string {
	parsed, err := time.ParseInLocation("2006-01-02 15:04:05,000", value, time.Local)
	if err != nil {
		return value
	}
	return parsed.Format(time.RFC3339)
}

func parseHermesLogLevelSet(value string) map[string]bool {
	value = normalizeHermesLogLevels(value)
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

func normalizeHermesLogLevels(value string) string {
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

func parseHermesFollowQuery(value string) bool {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return true
	}
	return value != "false" && value != "0" && value != "off"
}

func parseHermesBoundedInt(value string, fallback int, minValue int, maxValue int) int {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return boundHermesInt(parsed, minValue, maxValue)
}

func boundHermesInt(value int, minValue int, maxValue int) int {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}
