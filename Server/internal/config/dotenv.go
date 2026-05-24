package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func loadExecutableDirDotEnv() error {
	path, err := ExecutableDirDotEnvPath()
	if err != nil {
		return nil
	}
	err = loadDotEnvFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func ExecutableDirDotEnvPath() (string, error) {
	executablePath, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(executablePath), ".env"), nil
}

func UpdateExecutableDirDotEnvValue(key string, value string) (string, error) {
	if !validDotEnvKey(key) {
		return "", fmt.Errorf("invalid .env key %q", key)
	}
	path, err := ExecutableDirDotEnvPath()
	if err != nil {
		return "", err
	}
	if err := updateDotEnvValue(path, key, value); err != nil {
		return path, err
	}
	if strings.TrimSpace(value) == "" {
		_ = os.Unsetenv(key)
	} else if err := os.Setenv(key, value); err != nil {
		return path, err
	}
	if _, err := Load(); err != nil {
		return path, err
	}
	return path, nil
}

func loadDotEnvFile(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for lineNumber := 1; scanner.Scan(); lineNumber++ {
		key, value, ok, err := parseDotEnvLine(scanner.Text())
		if err != nil {
			return fmt.Errorf("%s:%d: %w", path, lineNumber, err)
		}
		if !ok {
			continue
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		if err := os.Setenv(key, value); err != nil {
			return fmt.Errorf("%s:%d: set %s: %w", path, lineNumber, key, err)
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	return nil
}

func parseDotEnvLine(line string) (string, string, bool, error) {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "#") {
		return "", "", false, nil
	}
	line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
	key, value, ok := strings.Cut(line, "=")
	if !ok {
		return "", "", false, fmt.Errorf("invalid .env line")
	}
	key = strings.TrimSpace(key)
	if !validDotEnvKey(key) {
		return "", "", false, fmt.Errorf("invalid .env key %q", key)
	}
	value, err := parseDotEnvValue(strings.TrimSpace(value))
	if err != nil {
		return "", "", false, err
	}
	return key, value, true, nil
}

func parseDotEnvValue(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	if strings.HasPrefix(value, `"`) {
		end := quotedDotEnvValueEnd(value, '"')
		if end < 0 {
			return "", fmt.Errorf("unterminated quoted value")
		}
		parsed, err := strconv.Unquote(value[:end+1])
		if err != nil {
			return "", err
		}
		if rest := strings.TrimSpace(value[end+1:]); rest != "" && !strings.HasPrefix(rest, "#") {
			return "", fmt.Errorf("unexpected content after quoted value")
		}
		return parsed, nil
	}
	if strings.HasPrefix(value, "'") {
		end := quotedDotEnvValueEnd(value, '\'')
		if end < 0 {
			return "", fmt.Errorf("unterminated quoted value")
		}
		if rest := strings.TrimSpace(value[end+1:]); rest != "" && !strings.HasPrefix(rest, "#") {
			return "", fmt.Errorf("unexpected content after quoted value")
		}
		return value[1:end], nil
	}
	return strings.TrimSpace(stripDotEnvInlineComment(value)), nil
}

func quotedDotEnvValueEnd(value string, quote byte) int {
	escaped := false
	for index := 1; index < len(value); index++ {
		char := value[index]
		if quote == '"' && char == '\\' && !escaped {
			escaped = true
			continue
		}
		if char == quote && !escaped {
			return index
		}
		escaped = false
	}
	return -1
}

func stripDotEnvInlineComment(value string) string {
	for index, char := range value {
		if char == '#' && (index == 0 || value[index-1] == ' ' || value[index-1] == '\t') {
			return value[:index]
		}
	}
	return value
}

func validDotEnvKey(key string) bool {
	if key == "" {
		return false
	}
	for index, char := range key {
		if char == '_' || char >= 'A' && char <= 'Z' || char >= 'a' && char <= 'z' || index > 0 && char >= '0' && char <= '9' {
			continue
		}
		return false
	}
	return true
}

func updateDotEnvValue(path string, key string, value string) error {
	data, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}

	lines := []string{}
	if len(data) > 0 {
		lines = strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
		if len(lines) > 0 && lines[len(lines)-1] == "" {
			lines = lines[:len(lines)-1]
		}
	}

	nextLines := make([]string, 0, len(lines)+1)
	replaced := false
	for _, line := range lines {
		if dotEnvLineKey(line) == key {
			if strings.TrimSpace(value) != "" {
				nextLines = append(nextLines, key+"="+quoteDotEnvValue(value))
			}
			replaced = true
			continue
		}
		nextLines = append(nextLines, line)
	}

	if !replaced && strings.TrimSpace(value) != "" {
		nextLines = append(nextLines, key+"="+quoteDotEnvValue(value))
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	content := strings.Join(nextLines, "\n")
	if content != "" {
		content += "\n"
	}
	return os.WriteFile(path, []byte(content), 0o600)
}

func dotEnvLineKey(line string) string {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" || strings.HasPrefix(trimmed, "#") {
		return ""
	}
	trimmed = strings.TrimSpace(strings.TrimPrefix(trimmed, "export "))
	key, _, ok := strings.Cut(trimmed, "=")
	if !ok {
		return ""
	}
	key = strings.TrimSpace(key)
	if !validDotEnvKey(key) {
		return ""
	}
	return key
}

func quoteDotEnvValue(value string) string {
	return strconv.Quote(value)
}
