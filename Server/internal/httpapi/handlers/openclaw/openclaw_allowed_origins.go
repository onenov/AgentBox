package openclaw

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"

	"agent-box-server/internal/config"
)

const defaultOpenClawGatewayPort = "18789"

var tauriControlUIAllowedOrigins = []string{
	"tauri://localhost",
}

func EnsureOpenClawControlUIAllowedOrigins(ctx context.Context, serverHost string, serverPort string, logger *slog.Logger) {
	changed, origins, err := ensureOpenClawControlUIAllowedOrigins(serverHost, serverPort)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) && logger != nil {
			logger.WarnContext(ctx, "update OpenClaw Control UI allowed origins", slog.String("error", err.Error()))
		}
		return
	}
	if changed && logger != nil {
		logger.InfoContext(ctx, "updated OpenClaw Control UI allowed origins", slog.Int("origins", len(origins)))
	}
}

func EnsureOpenClawControlUIAllowedOrigin(ctx context.Context, origin string, logger *slog.Logger) {
	normalized := normalizeControlUIOrigin(origin)
	if normalized == "" {
		return
	}
	changed, origins, err := ensureOpenClawControlUIAllowedOrigins("", "", normalized)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) && logger != nil {
			logger.WarnContext(ctx, "update OpenClaw Control UI request origin", slog.String("origin", normalized), slog.String("error", err.Error()))
		}
		return
	}
	if !changed {
		return
	}
	if logger != nil {
		logger.InfoContext(ctx, "added OpenClaw Control UI request origin", slog.String("origin", normalized), slog.Int("origins", len(origins)))
	}
	output, err := RestartOpenClawGateway(ctx, nil)
	if err != nil {
		if logger != nil {
			logger.WarnContext(ctx, "restart OpenClaw Gateway after adding request origin", slog.String("origin", normalized), slog.String("error", err.Error()))
		}
		return
	}
	if logger != nil {
		logger.InfoContext(ctx, "restarted OpenClaw Gateway after adding request origin", slog.String("origin", normalized), slog.String("message", output.Body.Message))
	}
}

func ensureOpenClawControlUIAllowedOrigins(serverHost string, serverPort string, extraOrigins ...string) (bool, []string, error) {
	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		return false, nil, err
	}

	gateway := ensureMapValue(content, "gateway")
	controlUI := ensureMapValue(gateway, "controlUi")
	ports := []string{"*"}
	hosts := localControlUIAllowedHosts(serverHost)
	wantedOrigins := mergeUniqueStrings(
		buildControlUIAllowedOrigins(hosts, ports),
		buildConfiguredAgentBoxControlUIOrigins(serverHost, serverPort),
		tauriControlUIAllowedOrigins,
		normalizeControlUIOrigins(extraOrigins),
	)

	currentOrigins := stringSliceFromConfig(controlUI["allowedOrigins"])
	mergedOrigins := mergeUniqueStrings(currentOrigins, wantedOrigins)
	if stringSlicesEqual(currentOrigins, mergedOrigins) {
		return false, mergedOrigins, nil
	}

	controlUI["allowedOrigins"] = mergedOrigins
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return false, mergedOrigins, err
	}
	invalidateOpenClawEnvironmentCache()
	return true, mergedOrigins, nil
}

func normalizeControlUIOrigins(values []string) []string {
	origins := make([]string, 0, len(values))
	for _, value := range values {
		if origin := normalizeControlUIOrigin(value); origin != "" {
			origins = append(origins, origin)
		}
	}
	return uniqueStrings(origins)
}

func buildConfiguredAgentBoxControlUIOrigins(serverHost string, serverPort string) []string {
	cfg := config.Current()
	values := []string{
		cfg.AgentBoxPublicURL,
		os.Getenv("AGENTBOX_PUBLIC_ORIGIN"),
		os.Getenv("AGENTBOX_CONTROL_UI_ORIGINS"),
	}
	if host := normalizeHost(serverHost); host != "" {
		if port := normalizePort(serverPort, cfg.Port); port != "" {
			values = append(values, "http://"+net.JoinHostPort(host, port))
		}
	}
	if cfg.Port != "" {
		values = append(values, config.BackendAddress(cfg))
	}

	origins := make([]string, 0, len(values))
	for _, value := range values {
		for _, item := range strings.Split(value, ",") {
			if origin := normalizeControlUIOrigin(item); origin != "" {
				origins = append(origins, origin)
			}
		}
	}
	return uniqueStrings(origins)
}

func normalizeControlUIOrigin(value string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(value), "/")
	if trimmed == "" {
		return ""
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" && parsed.Scheme != "tauri" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}

func ensureMapValue(parent map[string]any, key string) map[string]any {
	if value, ok := parent[key].(map[string]any); ok && value != nil {
		return value
	}
	next := map[string]any{}
	parent[key] = next
	return next
}

func localControlUIAllowedHosts(serverHost string) []string {
	hosts := []string{"127.0.0.1", "localhost"}
	if host := normalizeHost(serverHost); host != "" && !strings.Contains(host, ":") {
		hosts = append(hosts, host)
	}
	if hostname, err := os.Hostname(); err == nil && strings.TrimSpace(hostname) != "" {
		hosts = append(hosts, strings.TrimSpace(hostname))
	}
	if addrs, err := net.InterfaceAddrs(); err == nil {
		for _, addr := range addrs {
			ip := ipFromInterfaceAddr(addr)
			if ip == nil || ip.IsLoopback() || ip.IsUnspecified() {
				continue
			}
			if ipv4 := ip.To4(); ipv4 != nil {
				hosts = append(hosts, ipv4.String())
			}
		}
	}
	return uniqueStrings(hosts)
}

func buildControlUIAllowedOrigins(hosts []string, ports []string) []string {
	origins := make([]string, 0, len(hosts)*len(ports))
	for _, host := range hosts {
		for _, port := range ports {
			if host == "" || port == "" {
				continue
			}
			origins = append(origins, "http://"+net.JoinHostPort(host, port))
		}
	}
	return uniqueStrings(origins)
}

func ipFromInterfaceAddr(addr net.Addr) net.IP {
	switch typed := addr.(type) {
	case *net.IPNet:
		return typed.IP
	case *net.IPAddr:
		return typed.IP
	default:
		return nil
	}
}

func normalizeHost(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || trimmed == "0.0.0.0" || trimmed == "::" || trimmed == "[::]" {
		return ""
	}
	if host, _, err := net.SplitHostPort(trimmed); err == nil {
		trimmed = host
	}
	return strings.Trim(trimmed, "[]")
}

func normalizePort(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		trimmed = fallback
	}
	port, err := strconv.Atoi(trimmed)
	if err != nil || port <= 0 || port > 65535 {
		return ""
	}
	return strconv.Itoa(port)
}

func stringSliceFromConfig(value any) []string {
	switch typed := value.(type) {
	case []string:
		return uniqueStrings(typed)
	case []any:
		items := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := strings.TrimSpace(fmt.Sprint(item)); text != "" && text != "<nil>" {
				items = append(items, text)
			}
		}
		return uniqueStrings(items)
	case string:
		if strings.TrimSpace(typed) == "" {
			return nil
		}
		return []string{strings.TrimSpace(typed)}
	default:
		return nil
	}
}

func mergeUniqueStrings(groups ...[]string) []string {
	items := []string{}
	for _, group := range groups {
		items = append(items, group...)
	}
	return uniqueStrings(items)
}

func uniqueStrings(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func stringSlicesEqual(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
