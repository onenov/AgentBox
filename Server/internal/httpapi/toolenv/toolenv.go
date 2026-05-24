package toolenv

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"agent-box-server/internal/config"
)

const fallbackProxyHTTP = "http://orence:CF3UZ2OFQLSEIK3G@proxy.orence.io:21331"
const fallbackProxyNoProxy = "127.0.0.1,localhost,::1"

type ProxyMode string

const (
	ProxyModeOff     ProxyMode = "off"
	ProxyModeBuiltin ProxyMode = "builtin"
	ProxyModeCustom  ProxyMode = "custom"
)

type ProxySettings struct {
	Mode       ProxyMode `json:"mode" example:"builtin" doc:"Proxy mode: off, builtin, or custom."`
	HTTPProxy  string    `json:"httpProxy,omitempty" example:"http://user:pass@proxy.example.com:7890" doc:"HTTP proxy URL."`
	HTTPSProxy string    `json:"httpsProxy,omitempty" example:"http://user:pass@proxy.example.com:7890" doc:"HTTPS proxy URL."`
	AllProxy   string    `json:"allProxy,omitempty" example:"socks5://127.0.0.1:7890" doc:"Fallback proxy URL used when HTTP/HTTPS proxy is empty."`
	NoProxy    string    `json:"noProxy,omitempty" example:"127.0.0.1,localhost,::1" doc:"Hosts that should bypass proxy."`
	UpdatedAt  string    `json:"updatedAt,omitempty" example:"2026-05-21T10:30:00Z" doc:"UTC update timestamp."`
}

type ProxyEffectiveSettings struct {
	Mode       ProxyMode `json:"mode" example:"builtin" doc:"Proxy mode used by the backend."`
	HTTPProxy  string    `json:"httpProxy,omitempty" example:"http://proxy.example.com:7890" doc:"Effective HTTP proxy URL."`
	HTTPSProxy string    `json:"httpsProxy,omitempty" example:"http://proxy.example.com:7890" doc:"Effective HTTPS proxy URL."`
	AllProxy   string    `json:"allProxy,omitempty" example:"http://proxy.example.com:7890" doc:"Effective all-proxy URL."`
	NoProxy    string    `json:"noProxy,omitempty" example:"127.0.0.1,localhost,::1" doc:"Effective no-proxy hosts."`
	Enabled    bool      `json:"enabled" example:"true" doc:"Whether proxy fallback is enabled."`
}

type ProxyCheckResult struct {
	Status    string             `json:"status" example:"ok" doc:"Proxy check status."`
	Timestamp string             `json:"timestamp" example:"2026-05-21T10:30:00Z" doc:"UTC response timestamp."`
	Mode      ProxyMode          `json:"mode" example:"builtin" doc:"Checked proxy mode."`
	OK        bool               `json:"ok" example:"true" doc:"Whether every probe succeeded."`
	ExitIP    string             `json:"exitIP,omitempty" example:"94.74.85.179" doc:"Public exit IP observed through the proxy."`
	Targets   []ProxyCheckTarget `json:"targets" doc:"Proxy connectivity probes."`
	Error     string             `json:"error,omitempty" doc:"Summary error when the proxy cannot be checked."`
}

type ProxyCheckTarget struct {
	Name       string `json:"name" example:"npm" doc:"Display name of the checked target."`
	URL        string `json:"url" example:"https://registry.npmjs.org/-/ping" doc:"Checked URL."`
	Status     string `json:"status" example:"ok" doc:"Check status: ok or error."`
	StatusCode int    `json:"statusCode,omitempty" example:"200" doc:"HTTP status code when available."`
	LatencyMs  int64  `json:"latencyMs" example:"120" doc:"Request latency in milliseconds."`
	Error      string `json:"error,omitempty" doc:"Error summary when the check failed."`
}

var (
	directNetworkProbeMu     sync.Mutex
	directNetworkProbeLoaded bool
	directNetworkProbeOK     bool
	directNetworkProbeExpiry time.Time
	proxySettingsStore       = struct {
		sync.RWMutex
		loaded   bool
		settings ProxySettings
	}{}
)

func init() {
	InstallHTTPProxyFallback()
}

func ResolveToolPath(name string, candidates ...string) string {
	if path, err := exec.LookPath(name); err == nil && IsExecutablePath(path) {
		return path
	}
	if path := shellCommandPath(name); path != "" {
		return path
	}
	candidates = append(ToolExecutableCandidates(name), candidates...)
	for _, path := range CompactStrings(candidates) {
		if IsExecutablePath(path) {
			return path
		}
	}
	return ""
}

func shellCommandPath(name string) string {
	if runtime.GOOS == "windows" || strings.ContainsAny(name, `/\`) {
		return ""
	}
	for _, shell := range []string{"bash", "sh"} {
		shellPath, err := exec.LookPath(shell)
		if err != nil || shellPath == "" {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
		cmd := exec.CommandContext(ctx, shellPath, "-lc", "command -v -- "+shellQuote(name))
		cmd.Env = CommandEnv()
		output, err := cmd.Output()
		cancel()
		if err != nil {
			continue
		}
		path := strings.TrimSpace(strings.SplitN(string(output), "\n", 2)[0])
		if path != "" && IsExecutablePath(path) {
			return path
		}
	}
	return ""
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func CommandEnv() []string {
	env := PrependPathEntries(os.Environ(), ToolPathEntries()...)
	if effective, ok := EffectiveProxySettings(); ok {
		env = WithProxyEnv(env, effective)
	}
	return env
}

func ToolPathEntries() []string {
	var entries []string
	home, err := os.UserHomeDir()
	if err == nil && home != "" {
		entries = append(entries, filepath.Join(home, ".local", "bin"))
	}
	if runtime.GOOS != "windows" {
		entries = append(entries, "/opt/homebrew/bin", "/usr/local/bin", "/home/linuxbrew/.linuxbrew/bin", "/opt/local/bin")
	} else {
		entries = append(entries, WindowsToolPathEntries()...)
	}
	entries = append(entries, NodeBinPathCandidates()...)
	return CompactStrings(entries)
}

func ToolExecutableCandidates(name string) []string {
	executables := WindowsExecutableNames(name)
	candidates := []string{
		UserLocalExecutablePath(name),
		"/opt/homebrew/bin/" + name,
		"/usr/local/bin/" + name,
		"/home/linuxbrew/.linuxbrew/bin/" + name,
		"/opt/local/bin/" + name,
	}
	if runtime.GOOS == "windows" {
		if appData := os.Getenv("APPDATA"); appData != "" {
			for _, executable := range executables {
				candidates = append(candidates, filepath.Join(appData, "npm", executable))
			}
		}
	}
	for _, path := range ToolPathEntries() {
		for _, executable := range executables {
			candidates = append(candidates, filepath.Join(path, executable))
		}
	}
	for _, path := range NodeBinPathCandidates() {
		for _, executable := range executables {
			candidates = append(candidates, filepath.Join(path, executable))
		}
	}
	return CompactStrings(candidates)
}

func ResolveHomebrewPath() string {
	return ResolveToolPath("brew", "/opt/homebrew/bin/brew", "/usr/local/bin/brew", "/home/linuxbrew/.linuxbrew/bin/brew")
}

func UserLocalExecutablePath(name string) string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	if runtime.GOOS == "windows" && filepath.Ext(name) == "" {
		name += ".exe"
	}
	return filepath.Join(home, ".local", "bin", name)
}

func WindowsExecutableName(name string) string {
	return WindowsExecutableNames(name)[0]
}

func WindowsExecutableNames(name string) []string {
	if runtime.GOOS == "windows" && filepath.Ext(name) == "" {
		return []string{name + ".exe", name + ".cmd", name + ".bat", name + ".ps1", name}
	}
	return []string{name}
}

func NodeBinPathCandidates() []string {
	var candidates []string
	home, err := os.UserHomeDir()
	if err == nil && home != "" {
		candidates = append(candidates,
			filepath.Join(home, ".npm-global", "bin"),
			filepath.Join(home, ".volta", "bin"),
			filepath.Join(home, "n", "bin"),
			filepath.Join(home, ".n", "bin"),
		)
	}
	if nPrefix := strings.TrimSpace(os.Getenv("N_PREFIX")); nPrefix != "" {
		candidates = append(candidates, filepath.Join(nPrefix, "bin"))
	}
	if runtime.GOOS == "windows" {
		if appData := os.Getenv("APPDATA"); appData != "" {
			candidates = append(candidates, filepath.Join(appData, "npm"))
		}
		candidates = append(candidates, WindowsNodePathEntries()...)
	} else {
		candidates = append(candidates,
			"/root/n/bin",
			"/root/.n/bin",
			"/usr/local/n/bin",
			"/opt/n/bin",
		)
	}
	if home != "" {
		if matches, err := filepath.Glob(filepath.Join(home, ".nvm", "versions", "node", "*", "bin")); err == nil {
			sort.Sort(sort.Reverse(sort.StringSlice(matches)))
			candidates = append(candidates, matches...)
		}
		if matches, err := filepath.Glob(filepath.Join(home, ".fnm", "node-versions", "*", "installation", "bin")); err == nil {
			sort.Sort(sort.Reverse(sort.StringSlice(matches)))
			candidates = append(candidates, matches...)
		}
	}
	return CompactStrings(candidates)
}

func WindowsToolPathEntries() []string {
	if runtime.GOOS != "windows" {
		return nil
	}
	var candidates []string
	if systemRoot := os.Getenv("SystemRoot"); systemRoot != "" {
		candidates = append(candidates,
			filepath.Join(systemRoot, "System32"),
			filepath.Join(systemRoot, "System32", "WindowsPowerShell", "v1.0"),
		)
	}
	candidates = append(candidates, WindowsGitPathEntries()...)
	candidates = append(candidates, WindowsNodePathEntries()...)
	return CompactStrings(candidates)
}

func WindowsGitPathEntries() []string {
	if runtime.GOOS != "windows" {
		return nil
	}
	var candidates []string
	for _, root := range WindowsProgramRoots() {
		candidates = append(candidates,
			filepath.Join(root, "Git", "cmd"),
			filepath.Join(root, "Git", "bin"),
		)
	}
	if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
		candidates = append(candidates,
			filepath.Join(localAppData, "Programs", "Git", "cmd"),
			filepath.Join(localAppData, "Programs", "Git", "bin"),
		)
	}
	return CompactStrings(candidates)
}

func WindowsNodePathEntries() []string {
	if runtime.GOOS != "windows" {
		return nil
	}
	var candidates []string
	for _, root := range WindowsProgramRoots() {
		candidates = append(candidates, filepath.Join(root, "nodejs"))
	}
	if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
		candidates = append(candidates, filepath.Join(localAppData, "Programs", "nodejs"))
	}
	return CompactStrings(candidates)
}

func WindowsProgramRoots() []string {
	if runtime.GOOS != "windows" {
		return nil
	}
	return CompactStrings([]string{
		os.Getenv("ProgramFiles"),
		os.Getenv("ProgramW6432"),
		os.Getenv("ProgramFiles(x86)"),
	})
}

func IsExecutablePath(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return runtime.GOOS == "windows" || info.Mode()&0o111 != 0
}

func PrependPathEntries(env []string, entries ...string) []string {
	entries = CompactStrings(entries)
	if len(entries) == 0 {
		return env
	}
	for index, item := range env {
		if strings.HasPrefix(item, "PATH=") {
			env[index] = "PATH=" + strings.Join(entries, string(os.PathListSeparator)) + string(os.PathListSeparator) + strings.TrimPrefix(item, "PATH=")
			return env
		}
	}
	return append(env, "PATH="+strings.Join(entries, string(os.PathListSeparator)))
}

func WithFallbackProxyEnv(env []string) []string {
	return WithProxyEnv(env, ProxyEffectiveSettings{
		Mode:       ProxyModeBuiltin,
		HTTPProxy:  fallbackProxyHTTP,
		HTTPSProxy: fallbackProxyHTTP,
		AllProxy:   fallbackProxyHTTP,
		NoProxy:    fallbackProxyNoProxy,
		Enabled:    true,
	})
}

func WithProxyEnv(env []string, proxy ProxyEffectiveSettings) []string {
	values := map[string]string{}
	if proxy.HTTPProxy != "" {
		values["HTTP_PROXY"] = proxy.HTTPProxy
		values["http_proxy"] = proxy.HTTPProxy
	}
	if proxy.HTTPSProxy != "" {
		values["HTTPS_PROXY"] = proxy.HTTPSProxy
		values["https_proxy"] = proxy.HTTPSProxy
	}
	if proxy.AllProxy != "" {
		values["ALL_PROXY"] = proxy.AllProxy
		values["all_proxy"] = proxy.AllProxy
	}
	if proxy.NoProxy != "" {
		values["NO_PROXY"] = proxy.NoProxy
		values["no_proxy"] = proxy.NoProxy
	}
	if len(values) == 0 {
		return env
	}
	return SetEnvValues(env, values)
}

func SetEnvValues(env []string, values map[string]string) []string {
	result := append([]string(nil), env...)
	seen := map[string]struct{}{}
	for index, item := range result {
		key, _, ok := strings.Cut(item, "=")
		if !ok {
			continue
		}
		if value, exists := values[key]; exists {
			result[index] = key + "=" + value
			seen[key] = struct{}{}
		}
	}
	for key, value := range values {
		if _, ok := seen[key]; ok {
			continue
		}
		result = append(result, key+"="+value)
	}
	return result
}

func DirectNetworkAvailable() bool {
	now := time.Now()
	directNetworkProbeMu.Lock()
	if directNetworkProbeLoaded && now.Before(directNetworkProbeExpiry) {
		ok := directNetworkProbeOK
		directNetworkProbeMu.Unlock()
		return ok
	}
	directNetworkProbeMu.Unlock()

	ok := probeDirectNetwork()

	directNetworkProbeMu.Lock()
	directNetworkProbeLoaded = true
	directNetworkProbeOK = ok
	directNetworkProbeExpiry = now.Add(2 * time.Minute)
	directNetworkProbeMu.Unlock()
	return ok
}

func probeDirectNetwork() bool {
	client := &http.Client{
		Timeout: 4 * time.Second,
		Transport: &http.Transport{
			Proxy: nil,
			DialContext: (&net.Dialer{
				Timeout:   3 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			TLSHandshakeTimeout:   3 * time.Second,
			ResponseHeaderTimeout: 3 * time.Second,
		},
	}
	for _, endpoint := range []string{
		"https://registry.npmjs.org/-/ping",
		"https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh",
	} {
		if !probeDirectEndpoint(client, endpoint) {
			return false
		}
	}
	return true
}

func probeDirectEndpoint(client *http.Client, endpoint string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodHead, endpoint, nil)
	if err != nil {
		return false
	}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 500
}

func InstallHTTPProxyFallback() {
	directTransport := http.DefaultTransport.(*http.Transport).Clone()
	directTransport.Proxy = func(req *http.Request) (*url.URL, error) {
		if _, ok := EffectiveProxySettings(); ok {
			return nil, nil
		}
		return http.ProxyFromEnvironment(req)
	}
	proxyTransport := http.DefaultTransport.(*http.Transport).Clone()
	proxyTransport.Proxy = func(req *http.Request) (*url.URL, error) {
		if shouldBypassFallbackProxy(req.URL.Hostname()) {
			return nil, nil
		}
		proxyURL, _ := proxyURLForScheme(req.URL.Scheme)
		return proxyURL, nil
	}
	http.DefaultTransport = fallbackHTTPTransport{
		direct: directTransport,
		proxy:  proxyTransport,
	}
}

type fallbackHTTPTransport struct {
	direct http.RoundTripper
	proxy  http.RoundTripper
}

func (transport fallbackHTTPTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if shouldBypassFallbackProxy(req.URL.Hostname()) {
		return transport.direct.RoundTrip(req)
	}
	resp, err := transport.direct.RoundTrip(req)
	if err == nil {
		return resp, nil
	}
	if _, ok := proxyURLForScheme(req.URL.Scheme); !ok {
		return nil, err
	}
	if req.Body != nil && req.GetBody == nil {
		return nil, err
	}
	retry := req.Clone(req.Context())
	if req.GetBody != nil {
		body, bodyErr := req.GetBody()
		if bodyErr != nil {
			return nil, err
		}
		retry.Body = body
	}
	return transport.proxy.RoundTrip(retry)
}

func ProxySettingsSnapshot() ProxySettings {
	return loadProxySettings()
}

func BuiltinProxySettings() ProxyEffectiveSettings {
	return ProxyEffectiveSettings{
		Mode:       ProxyModeBuiltin,
		HTTPProxy:  fallbackProxyHTTP,
		HTTPSProxy: fallbackProxyHTTP,
		AllProxy:   fallbackProxyHTTP,
		NoProxy:    fallbackProxyNoProxy,
		Enabled:    true,
	}
}

func EffectiveProxySettings() (ProxyEffectiveSettings, bool) {
	settings := loadProxySettings()
	switch settings.Mode {
	case ProxyModeOff:
		return ProxyEffectiveSettings{Mode: ProxyModeOff, NoProxy: normalizedNoProxy(settings.NoProxy), Enabled: false}, false
	case ProxyModeCustom:
		effective := ProxyEffectiveSettings{
			Mode:       ProxyModeCustom,
			HTTPProxy:  strings.TrimSpace(settings.HTTPProxy),
			HTTPSProxy: strings.TrimSpace(settings.HTTPSProxy),
			AllProxy:   strings.TrimSpace(settings.AllProxy),
			NoProxy:    normalizedNoProxy(settings.NoProxy),
			Enabled:    true,
		}
		if effective.HTTPProxy == "" && effective.HTTPSProxy == "" && effective.AllProxy == "" {
			return effective, false
		}
		return effective, true
	default:
		effective := BuiltinProxySettings()
		effective.NoProxy = normalizedNoProxy(settings.NoProxy)
		return effective, true
	}
}

func SaveProxySettings(settings ProxySettings) (ProxySettings, error) {
	normalized, err := NormalizeProxySettings(settings)
	if err != nil {
		return ProxySettings{}, err
	}
	normalized.UpdatedAt = time.Now().UTC().Format(time.RFC3339)

	path := proxySettingsPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return ProxySettings{}, fmt.Errorf("create proxy settings dir: %w", err)
	}
	payload, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return ProxySettings{}, fmt.Errorf("encode proxy settings: %w", err)
	}
	if err := os.WriteFile(path, append(payload, '\n'), 0o600); err != nil {
		return ProxySettings{}, fmt.Errorf("write proxy settings: %w", err)
	}

	proxySettingsStore.Lock()
	proxySettingsStore.loaded = true
	proxySettingsStore.settings = normalized
	proxySettingsStore.Unlock()

	resetDirectNetworkProbeCache()
	return normalized, nil
}

func NormalizeProxySettings(settings ProxySettings) (ProxySettings, error) {
	normalized := ProxySettings{
		Mode:       settings.Mode,
		HTTPProxy:  strings.TrimSpace(settings.HTTPProxy),
		HTTPSProxy: strings.TrimSpace(settings.HTTPSProxy),
		AllProxy:   strings.TrimSpace(settings.AllProxy),
		NoProxy:    normalizedNoProxy(settings.NoProxy),
		UpdatedAt:  strings.TrimSpace(settings.UpdatedAt),
	}
	if normalized.Mode == "" {
		normalized.Mode = ProxyModeBuiltin
	}
	switch normalized.Mode {
	case ProxyModeOff:
		normalized.HTTPProxy = ""
		normalized.HTTPSProxy = ""
		normalized.AllProxy = ""
	case ProxyModeBuiltin:
		normalized.HTTPProxy = ""
		normalized.HTTPSProxy = ""
		normalized.AllProxy = ""
	case ProxyModeCustom:
		if normalized.HTTPProxy == "" && normalized.HTTPSProxy == "" && normalized.AllProxy == "" {
			return ProxySettings{}, errors.New("custom proxy requires at least one proxy URL")
		}
		for _, value := range []string{normalized.HTTPProxy, normalized.HTTPSProxy, normalized.AllProxy} {
			if value == "" {
				continue
			}
			if err := validateProxyURL(value); err != nil {
				return ProxySettings{}, err
			}
		}
	default:
		return ProxySettings{}, fmt.Errorf("unsupported proxy mode %q", normalized.Mode)
	}
	return normalized, nil
}

func CheckProxy(ctx context.Context, settings *ProxySettings) ProxyCheckResult {
	var effective ProxyEffectiveSettings
	var ok bool
	mode := ProxyModeBuiltin
	if settings != nil {
		normalized, err := NormalizeProxySettings(*settings)
		if err != nil {
			return ProxyCheckResult{
				Status:    "error",
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Mode:      settings.Mode,
				OK:        false,
				Error:     err.Error(),
			}
		}
		mode = normalized.Mode
		effective, ok = effectiveProxySettingsFrom(normalized)
	} else {
		snapshot := loadProxySettings()
		mode = snapshot.Mode
		effective, ok = EffectiveProxySettings()
	}
	if !ok {
		return ProxyCheckResult{
			Status:    "error",
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Mode:      mode,
			OK:        false,
			Error:     "proxy is disabled or incomplete",
		}
	}

	proxyURL, ok := firstProxyURL(effective)
	if !ok {
		return ProxyCheckResult{
			Status:    "error",
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Mode:      mode,
			OK:        false,
			Error:     "proxy URL is empty",
		}
	}

	client := &http.Client{
		Timeout: 12 * time.Second,
		Transport: &http.Transport{
			Proxy: http.ProxyURL(proxyURL),
			DialContext: (&net.Dialer{
				Timeout:   6 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			TLSHandshakeTimeout:   10 * time.Second,
			ResponseHeaderTimeout: 10 * time.Second,
		},
	}

	targets := []struct {
		name string
		url  string
		body bool
	}{
		{name: "Google", url: "https://www.gstatic.com/generate_204"},
		{name: "GitHub", url: "https://api.github.com/rate_limit"},
		{name: "npm Registry", url: "https://registry.npmjs.org/-/ping"},
	}
	result := ProxyCheckResult{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Mode:      mode,
		OK:        true,
		Targets:   make([]ProxyCheckTarget, 0, len(targets)),
	}
	for _, target := range targets {
		item, body := probeProxyTarget(ctx, client, target.name, target.url, target.body)
		if item.Status != "ok" {
			result.Status = "error"
			result.OK = false
		}
		if target.body && body != "" {
			result.ExitIP = strings.TrimSpace(body)
		}
		result.Targets = append(result.Targets, item)
	}
	if exitIP := probeProxyExitIP(ctx, client); exitIP != "" {
		result.ExitIP = exitIP
	}
	return result
}

func loadProxySettings() ProxySettings {
	proxySettingsStore.RLock()
	if proxySettingsStore.loaded {
		settings := proxySettingsStore.settings
		proxySettingsStore.RUnlock()
		return settings
	}
	proxySettingsStore.RUnlock()

	settings := defaultProxySettings()
	path := proxySettingsPath()
	if payload, err := os.ReadFile(path); err == nil {
		var stored ProxySettings
		if err := json.Unmarshal(payload, &stored); err == nil {
			if normalized, err := NormalizeProxySettings(stored); err == nil {
				settings = normalized
			}
		}
	}

	proxySettingsStore.Lock()
	if !proxySettingsStore.loaded {
		proxySettingsStore.loaded = true
		proxySettingsStore.settings = settings
	}
	settings = proxySettingsStore.settings
	proxySettingsStore.Unlock()
	return settings
}

func defaultProxySettings() ProxySettings {
	mode := ProxyModeBuiltin
	if runningInContainer() && environmentProxyConfigured() {
		mode = ProxyModeOff
	}
	return ProxySettings{
		Mode:    mode,
		NoProxy: normalizedNoProxy(firstNonEmpty(os.Getenv("NO_PROXY"), os.Getenv("no_proxy"))),
	}
}

func proxySettingsPath() string {
	return filepath.Join(config.DefaultDataDir(), "proxy.json")
}

func normalizedNoProxy(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallbackProxyNoProxy
	}
	return value
}

func effectiveProxySettingsFrom(settings ProxySettings) (ProxyEffectiveSettings, bool) {
	switch settings.Mode {
	case ProxyModeOff:
		return ProxyEffectiveSettings{Mode: ProxyModeOff, NoProxy: normalizedNoProxy(settings.NoProxy), Enabled: false}, false
	case ProxyModeCustom:
		effective := ProxyEffectiveSettings{
			Mode:       ProxyModeCustom,
			HTTPProxy:  strings.TrimSpace(settings.HTTPProxy),
			HTTPSProxy: strings.TrimSpace(settings.HTTPSProxy),
			AllProxy:   strings.TrimSpace(settings.AllProxy),
			NoProxy:    normalizedNoProxy(settings.NoProxy),
			Enabled:    true,
		}
		if effective.HTTPProxy == "" && effective.HTTPSProxy == "" && effective.AllProxy == "" {
			return effective, false
		}
		return effective, true
	default:
		effective := BuiltinProxySettings()
		effective.NoProxy = normalizedNoProxy(settings.NoProxy)
		return effective, true
	}
}

func proxyURLForScheme(scheme string) (*url.URL, bool) {
	effective, ok := EffectiveProxySettings()
	if !ok {
		return nil, false
	}
	value := ""
	if strings.EqualFold(scheme, "https") {
		value = firstNonEmpty(effective.HTTPSProxy, effective.HTTPProxy, effective.AllProxy)
	} else {
		value = firstNonEmpty(effective.HTTPProxy, effective.AllProxy, effective.HTTPSProxy)
	}
	if value == "" {
		return nil, false
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return nil, false
	}
	return parsed, true
}

func firstProxyURL(effective ProxyEffectiveSettings) (*url.URL, bool) {
	value := firstNonEmpty(effective.HTTPSProxy, effective.HTTPProxy, effective.AllProxy)
	if value == "" {
		return nil, false
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return nil, false
	}
	return parsed, true
}

func validateProxyURL(value string) error {
	parsed, err := url.Parse(value)
	if err != nil {
		return fmt.Errorf("invalid proxy URL %q: %w", value, err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("invalid proxy URL %q: scheme and host are required", value)
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func environmentProxyConfigured() bool {
	for _, key := range []string{"HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"} {
		if strings.TrimSpace(os.Getenv(key)) != "" {
			return true
		}
	}
	return false
}

func runningInContainer() bool {
	for _, key := range []string{"AGENTBOX_CONTAINER", "container", "CONTAINER", "DOTNET_RUNNING_IN_CONTAINER"} {
		value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
		if value == "1" || value == "true" || value == "yes" || value == "docker" || value == "podman" || value == "container" {
			return true
		}
	}
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}
	if _, err := os.Stat("/run/.containerenv"); err == nil {
		return true
	}
	if data, err := os.ReadFile("/proc/1/cgroup"); err == nil {
		lower := strings.ToLower(string(data))
		return strings.Contains(lower, "docker") ||
			strings.Contains(lower, "kubepods") ||
			strings.Contains(lower, "containerd") ||
			strings.Contains(lower, "podman")
	}
	return false
}

func probeProxyTarget(ctx context.Context, client *http.Client, name string, targetURL string, readBody bool) (ProxyCheckTarget, string) {
	requestCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()

	method := http.MethodHead
	if readBody {
		method = http.MethodGet
	}
	request, err := http.NewRequestWithContext(requestCtx, method, targetURL, nil)
	if err != nil {
		return ProxyCheckTarget{Name: name, URL: targetURL, Status: "error", Error: err.Error()}, ""
	}
	request.Header.Set("User-Agent", "AgentBox-ProxyCheck/0.1")

	startedAt := time.Now()
	response, err := client.Do(request)
	latencyMs := time.Since(startedAt).Milliseconds()
	if err != nil {
		return ProxyCheckTarget{Name: name, URL: targetURL, Status: "error", LatencyMs: latencyMs, Error: err.Error()}, ""
	}
	defer response.Body.Close()

	body := ""
	if readBody {
		if payload, err := io.ReadAll(io.LimitReader(response.Body, 128)); err == nil {
			body = strings.TrimSpace(string(payload))
		}
	}

	status := "ok"
	if response.StatusCode >= http.StatusBadRequest {
		status = "error"
	}

	return ProxyCheckTarget{
		Name:       name,
		URL:        targetURL,
		Status:     status,
		StatusCode: response.StatusCode,
		LatencyMs:  latencyMs,
	}, body
}

func probeProxyExitIP(ctx context.Context, client *http.Client) string {
	_, body := probeProxyTarget(ctx, client, "Exit IP", "https://api.ipify.org", true)
	return normalizeProxyExitIP(body)
}

func normalizeProxyExitIP(value string) string {
	value = strings.TrimSpace(value)
	if net.ParseIP(value) == nil {
		return ""
	}
	return value
}

func resetDirectNetworkProbeCache() {
	directNetworkProbeMu.Lock()
	directNetworkProbeLoaded = false
	directNetworkProbeOK = false
	directNetworkProbeExpiry = time.Time{}
	directNetworkProbeMu.Unlock()
}

func shouldBypassFallbackProxy(host string) bool {
	host = strings.Trim(strings.ToLower(host), "[]")
	return host == "" ||
		host == "localhost" ||
		host == "127.0.0.1" ||
		host == "::1" ||
		strings.HasPrefix(host, "127.") ||
		strings.HasSuffix(host, ".local")
}

func CompactStrings(values []string) []string {
	compact := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		compact = append(compact, value)
	}
	return compact
}
