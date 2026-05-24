package logfilter

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

var (
	ansiCSIPattern = regexp.MustCompile(`\x1b\[[0-?]*[ -/]*[@-~]`)
	ansiOSCPattern = regexp.MustCompile(`\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)`)
)

// TerminalQRFilter removes terminal-rendered QR code blocks from streamed logs
// while preserving ordinary instructions and web authorization URLs.
type TerminalQRFilter struct {
	suppressing bool
}

func (filter *TerminalQRFilter) AllowLine(line string) bool {
	line = strings.TrimRight(line, "\r\n")
	visible := stripANSI(line)
	trimmed := strings.TrimSpace(visible)
	lower := strings.ToLower(trimmed)

	if strings.Contains(lower, "http://") || strings.Contains(lower, "https://") {
		filter.suppressing = false
		return true
	}
	if isTerminalQRLine(line, visible) {
		filter.suppressing = true
		return false
	}
	if trimmed == "" {
		return !filter.suppressing
	}
	if isQRCueLine(lower) {
		filter.suppressing = true
		return true
	}
	if filter.suppressing {
		filter.suppressing = false
	}
	return true
}

func stripANSI(value string) string {
	value = ansiOSCPattern.ReplaceAllString(value, "")
	return ansiCSIPattern.ReplaceAllString(value, "")
}

func isTerminalQRLine(original string, visible string) bool {
	trimmed := strings.TrimSpace(visible)
	if trimmed == "" {
		return hasANSIGraphics(original)
	}

	nonSpace := 0
	qrChars := 0
	otherChars := 0
	for _, char := range trimmed {
		if char == ' ' || char == '\t' {
			continue
		}
		nonSpace++
		if isQRBlockRune(char) {
			qrChars++
			continue
		}
		otherChars++
	}
	if nonSpace == 0 || qrChars == 0 {
		return false
	}
	if otherChars == 0 {
		return qrChars >= 3 || utf8.RuneCountInString(trimmed) <= 4
	}
	return qrChars >= 8 && float64(qrChars)/float64(nonSpace) >= 0.75
}

func hasANSIGraphics(value string) bool {
	return strings.Contains(value, "\x1b[7m") ||
		strings.Contains(value, "\x1b[40m") ||
		strings.Contains(value, "\x1b[47m") ||
		strings.Contains(value, "\x1b[30m") ||
		strings.Contains(value, "\x1b[37m")
}

func isQRBlockRune(char rune) bool {
	switch char {
	case '█', '▀', '▄', '▌', '▐', '▖', '▗', '▘', '▙', '▚', '▛', '▜', '▝', '▞', '▟', '■', '□', '▪', '▫':
		return true
	default:
		return false
	}
}

func isQRCueLine(lower string) bool {
	return strings.Contains(lower, "qr code") ||
		strings.Contains(lower, "二维码") ||
		strings.Contains(lower, "扫码")
}
