package handlers

// Environment handler 用于向 AgentBox UI 暴露当前后端所在主机的运行环境快照。
//
// 接口支持两个查询参数：
//   - section：只返回某一组信息，例如 os、user、cpu、memory、load、uptime、disks、network、process、runtime、tools。
//   - refresh：绕过内存缓存，重新采集本次请求涉及的信息分组。
//
// 环境检测按信息分组做了缓存。OS、用户、CPU、Go Runtime、工具版本等静态信息会长期缓存；
// 内存、负载、进程、磁盘、网络等变化较快的信息使用短 TTL 缓存，避免每次请求都重复执行较慢的系统命令，
// 同时保证前端 Dashboard 看到的数据仍然足够新。

import (
	"context"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"agent-box-server/internal/httpapi/toolenv"

	"github.com/danielgtaylor/huma/v2"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	gopsnet "github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"
)

const (
	sectionAll     = ""
	sectionOS      = "os"
	sectionUser    = "user"
	sectionCPU     = "cpu"
	sectionMemory  = "memory"
	sectionLoad    = "load"
	sectionUptime  = "uptime"
	sectionDisks   = "disks"
	sectionNetwork = "network"
	sectionProcess = "process"
	sectionRuntime = "runtime"
	sectionTools   = "tools"
)

var (
	serverStartedAt      = time.Now()
	environmentCache     = environmentCacheStore{}
	networkIOSampleCache = networkIOSampleStore{samples: make(map[string]networkIOSample)}
)

type EnvironmentInput struct {
	Refresh bool   `query:"refresh" doc:"Force refresh cached environment data." example:"false"`
	Section string `query:"section" enum:"os,user,cpu,memory,load,uptime,disks,network,process,runtime,tools" doc:"Return only one environment section. Omit for the full snapshot." example:"tools"`
}

type EnvironmentOutput struct {
	Body EnvironmentResponse
}

type EnvironmentResponse struct {
	Status    string            `json:"status" example:"ok" doc:"Environment detection status."`
	Timestamp string            `json:"timestamp" example:"2026-05-11T15:59:00Z" doc:"UTC response timestamp."`
	Section   string            `json:"section,omitempty" example:"tools" doc:"Requested section when the response is scoped."`
	Cache     CacheInfo         `json:"cache" doc:"Cache behavior used for this response."`
	OS        *OSInfo           `json:"os,omitempty" doc:"Operating system information."`
	User      *UserInfo         `json:"user,omitempty" doc:"Current operating system user information."`
	CPU       *CPUInfo          `json:"cpu,omitempty" doc:"CPU information."`
	Memory    *MemoryInfo       `json:"memory,omitempty" doc:"Memory usage information."`
	Load      *LoadInfo         `json:"load,omitempty" doc:"System load average information."`
	Uptime    *UptimeInfo       `json:"uptime,omitempty" doc:"System and backend process uptime information."`
	Disks     []DiskInfo        `json:"disks,omitempty" doc:"Mounted disk usage information."`
	Network   *NetworkInfo      `json:"network,omitempty" doc:"Network addresses, DNS, and I/O counters."`
	Process   *ProcessInfo      `json:"process,omitempty" doc:"AgentBox backend process metrics."`
	Runtime   *RuntimeInfo      `json:"runtime,omitempty" doc:"AgentBox server runtime information."`
	Tools     *DevelopmentTools `json:"tools,omitempty" doc:"Development toolchain availability."`
}

type CacheInfo struct {
	Refresh bool `json:"refresh" example:"false" doc:"Whether refresh=true was requested."`
}

type OSInfo struct {
	Name       string `json:"name" example:"darwin" doc:"Go operating system name."`
	Arch       string `json:"arch" example:"arm64" doc:"Go target architecture."`
	Platform   string `json:"platform,omitempty" example:"darwin" doc:"Host platform name when detectable."`
	Family     string `json:"family,omitempty" example:"darwin" doc:"Host platform family when detectable."`
	Version    string `json:"version,omitempty" example:"macOS 15.5" doc:"Operating system version when detectable."`
	Kernel     string `json:"kernel,omitempty" example:"Darwin 24.5.0" doc:"Kernel information when detectable."`
	Hostname   string `json:"hostname,omitempty" example:"workstation.local" doc:"Host name when detectable."`
	Executable string `json:"executable,omitempty" example:"/usr/local/bin/agent-box" doc:"Current server executable path."`
	WorkingDir string `json:"workingDir,omitempty" example:"/opt/agent-box" doc:"Current server working directory."`
}

type UserInfo struct {
	Username string `json:"username,omitempty" example:"one" doc:"Current username."`
	Name     string `json:"name,omitempty" example:"One" doc:"Display name when detectable."`
	UID      string `json:"uid,omitempty" example:"501" doc:"Current user id."`
	GID      string `json:"gid,omitempty" example:"20" doc:"Current primary group id."`
	HomeDir  string `json:"homeDir,omitempty" example:"/Users/one" doc:"Current user's home directory."`
}

type CPUInfo struct {
	Architecture string `json:"architecture" example:"arm64" doc:"CPU architecture."`
	LogicalCores int    `json:"logicalCores" example:"10" doc:"Logical CPU core count available to the process."`
	Model        string `json:"model,omitempty" example:"Apple M4 Pro" doc:"CPU model when detectable."`
}

type MemoryInfo struct {
	Total       uint64  `json:"total" example:"34359738368" doc:"Total physical memory in bytes."`
	Available   uint64  `json:"available" example:"17179869184" doc:"Available physical memory in bytes."`
	Used        uint64  `json:"used" example:"17179869184" doc:"Used physical memory in bytes."`
	UsedPercent float64 `json:"usedPercent" example:"50.25" doc:"Used memory percentage."`
	SwapTotal   uint64  `json:"swapTotal,omitempty" example:"2147483648" doc:"Total swap memory in bytes."`
	SwapUsed    uint64  `json:"swapUsed,omitempty" example:"1073741824" doc:"Used swap memory in bytes."`
}

type LoadInfo struct {
	Load1  float64 `json:"load1" example:"1.23" doc:"1-minute load average."`
	Load5  float64 `json:"load5" example:"1.45" doc:"5-minute load average."`
	Load15 float64 `json:"load15" example:"1.67" doc:"15-minute load average."`
}

type UptimeInfo struct {
	SystemSeconds  uint64 `json:"systemSeconds" example:"86400" doc:"System uptime in seconds."`
	BackendSeconds uint64 `json:"backendSeconds" example:"3600" doc:"AgentBox backend uptime in seconds."`
	BackendStarted string `json:"backendStarted" example:"2026-05-11T15:59:00Z" doc:"Backend process start time in UTC."`
}

type DiskInfo struct {
	Device      string  `json:"device" example:"/dev/disk3s1" doc:"Disk device name."`
	Mountpoint  string  `json:"mountpoint" example:"/" doc:"Disk mount point."`
	Filesystem  string  `json:"filesystem" example:"apfs" doc:"Filesystem type."`
	Total       uint64  `json:"total" example:"1000000000000" doc:"Total disk size in bytes."`
	Free        uint64  `json:"free" example:"500000000000" doc:"Free disk space in bytes."`
	Used        uint64  `json:"used" example:"500000000000" doc:"Used disk space in bytes."`
	UsedPercent float64 `json:"usedPercent" example:"50.25" doc:"Used disk percentage."`
}

type NetworkInfo struct {
	IPs []IPInfo        `json:"ips" doc:"Non-loopback host IP addresses."`
	DNS DNSInfo         `json:"dns" doc:"DNS resolver configuration."`
	IO  []NetworkIOInfo `json:"io" doc:"Network I/O counters for active primary interfaces."`
}

type IPInfo struct {
	Interface string `json:"interface" example:"en0" doc:"Network interface name."`
	Address   string `json:"address" example:"192.168.1.10" doc:"IP address."`
	Family    string `json:"family" example:"ipv4" doc:"IP address family."`
}

type DNSInfo struct {
	Servers []string `json:"servers,omitempty" example:"[\"8.8.8.8\"]" doc:"Configured DNS servers."`
	Search  []string `json:"search,omitempty" example:"[\"local\"]" doc:"Configured DNS search domains."`
}

type NetworkIOInfo struct {
	Name               string  `json:"name" example:"en0" doc:"Network interface name."`
	BytesSent          uint64  `json:"bytesSent" example:"1048576" doc:"Cumulative bytes sent since interface counters started."`
	BytesRecv          uint64  `json:"bytesRecv" example:"1048576" doc:"Cumulative bytes received since interface counters started."`
	BytesSentPerSecond float64 `json:"bytesSentPerSecond" example:"1024.5" doc:"Estimated bytes sent per second based on the previous sample."`
	BytesRecvPerSecond float64 `json:"bytesRecvPerSecond" example:"2048.5" doc:"Estimated bytes received per second based on the previous sample."`
	PacketsSent        uint64  `json:"packetsSent" example:"1000" doc:"Packets sent."`
	PacketsRecv        uint64  `json:"packetsRecv" example:"1000" doc:"Packets received."`
	Errin              uint64  `json:"errIn" example:"0" doc:"Inbound error count."`
	Errout             uint64  `json:"errOut" example:"0" doc:"Outbound error count."`
	Dropin             uint64  `json:"dropIn" example:"0" doc:"Inbound drop count."`
	Dropout            uint64  `json:"dropOut" example:"0" doc:"Outbound drop count."`
}

type ProcessInfo struct {
	PID           int32   `json:"pid" example:"12345" doc:"Backend process id."`
	PPID          int32   `json:"ppid,omitempty" example:"1234" doc:"Parent process id."`
	Name          string  `json:"name,omitempty" example:"agent-box" doc:"Backend process name."`
	Status        string  `json:"status,omitempty" example:"running" doc:"Backend process status."`
	CreateTime    int64   `json:"createTime,omitempty" example:"1770000000000" doc:"Process create time as Unix milliseconds."`
	RSS           uint64  `json:"rss" example:"33554432" doc:"Resident set size in bytes."`
	CPUPercent    float64 `json:"cpuPercent" example:"1.25" doc:"Backend process CPU usage percentage."`
	Goroutines    int     `json:"goroutines" example:"12" doc:"Current goroutine count."`
	OpenFiles     int     `json:"openFiles,omitempty" example:"8" doc:"Open file count when detectable."`
	Threads       int32   `json:"threads,omitempty" example:"12" doc:"Process thread count when detectable."`
	UptimeSeconds uint64  `json:"uptimeSeconds" example:"3600" doc:"Backend process uptime in seconds."`
}

type RuntimeInfo struct {
	GoVersion  string `json:"goVersion" example:"go1.26.3" doc:"Go runtime version."`
	Compiler   string `json:"compiler" example:"gc" doc:"Go compiler."`
	NumCPU     int    `json:"numCpu" example:"10" doc:"CPU count reported by the Go runtime."`
	GOMAXPROCS int    `json:"gomaxprocs" example:"10" doc:"Current Go scheduler parallelism."`
}

type DevelopmentTools struct {
	NodeJS   ToolInfo `json:"nodejs" doc:"Node.js availability and installation information."`
	NPM      ToolInfo `json:"npm" doc:"npm availability and installation information."`
	NPX      ToolInfo `json:"npx" doc:"npx availability and installation information."`
	Python   ToolInfo `json:"python" doc:"Python availability and installation information."`
	UV       ToolInfo `json:"uv" doc:"uv package manager availability and installation information."`
	Git      ToolInfo `json:"git" doc:"Git availability and installation information."`
	Homebrew ToolInfo `json:"homebrew,omitempty" doc:"Homebrew availability and installation information on macOS."`
	Xcode    ToolInfo `json:"xcode,omitempty" doc:"Apple Xcode Command Line Tools availability on macOS."`
	Docker   ToolInfo `json:"docker" doc:"Docker CLI availability and daemon information."`
}

type ToolInfo struct {
	Available    bool              `json:"available" example:"true" doc:"Whether the command is available in PATH."`
	Running      *bool             `json:"running,omitempty" example:"true" doc:"Whether the backing service or daemon is running when applicable."`
	Path         string            `json:"path,omitempty" example:"/opt/homebrew/bin/node" doc:"Resolved executable path."`
	Version      string            `json:"version,omitempty" example:"v24.0.0" doc:"Tool version."`
	GlobalPrefix string            `json:"globalPrefix,omitempty" example:"/opt/homebrew" doc:"Global installation prefix when detectable."`
	Metadata     map[string]string `json:"metadata,omitempty" doc:"Additional detected tool metadata."`
	Error        string            `json:"error,omitempty" example:"executable file not found in PATH" doc:"Detection error when unavailable or failed."`
}

type networkIOSampleStore struct {
	mu      sync.Mutex
	samples map[string]networkIOSample
}

type networkIOSample struct {
	bytesSent uint64
	bytesRecv uint64
	takenAt   time.Time
}

type cacheEntry[T any] struct {
	mu        sync.Mutex
	loaded    bool
	expiresAt time.Time
	value     T
}

type environmentCacheStore struct {
	os      cacheEntry[OSInfo]
	user    cacheEntry[UserInfo]
	cpu     cacheEntry[CPUInfo]
	memory  cacheEntry[MemoryInfo]
	load    cacheEntry[LoadInfo]
	disks   cacheEntry[[]DiskInfo]
	network cacheEntry[NetworkInfo]
	process cacheEntry[ProcessInfo]
	runtime cacheEntry[RuntimeInfo]
	tools   cacheEntry[DevelopmentTools]
}

func Environment(ctx context.Context, input *EnvironmentInput) (*EnvironmentOutput, error) {
	if input == nil {
		input = &EnvironmentInput{}
	}

	section := normalizeEnvironmentSection(input.Section)
	if !isValidEnvironmentSection(section) {
		return nil, huma.Error400BadRequest("unsupported environment section", nil)
	}

	response := EnvironmentResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Section:   section,
		Cache:     CacheInfo{Refresh: input.Refresh},
	}

	include := func(target string) bool {
		return section == sectionAll || section == target
	}

	if include(sectionOS) {
		value := cached(&environmentCache.os, 0, input.Refresh, func() OSInfo { return detectOS(ctx) })
		response.OS = &value
	}
	if include(sectionUser) {
		value := cached(&environmentCache.user, 0, input.Refresh, detectUser)
		response.User = &value
	}
	if include(sectionCPU) {
		value := cached(&environmentCache.cpu, 0, input.Refresh, func() CPUInfo { return detectCPU(ctx) })
		response.CPU = &value
	}
	if include(sectionMemory) {
		value := cached(&environmentCache.memory, time.Second, input.Refresh, detectMemory)
		response.Memory = &value
	}
	if include(sectionLoad) {
		value := cached(&environmentCache.load, 2*time.Second, input.Refresh, detectLoad)
		response.Load = &value
	}
	if include(sectionUptime) {
		value := detectUptime()
		response.Uptime = &value
	}
	if include(sectionDisks) {
		response.Disks = cached(&environmentCache.disks, 10*time.Second, input.Refresh, detectDisks)
	}
	if include(sectionNetwork) {
		value := cached(&environmentCache.network, time.Second, input.Refresh, detectNetwork)
		response.Network = &value
	}
	if include(sectionProcess) {
		value := cached(&environmentCache.process, time.Second, input.Refresh, detectProcess)
		response.Process = &value
	}
	if include(sectionRuntime) {
		value := cached(&environmentCache.runtime, 0, input.Refresh, detectRuntime)
		response.Runtime = &value
	}
	if include(sectionTools) {
		value := cached(&environmentCache.tools, 15*time.Second, input.Refresh, func() DevelopmentTools { return detectTools(ctx) })
		response.Tools = &value
	}

	return &EnvironmentOutput{Body: response}, nil
}

func cached[T any](entry *cacheEntry[T], ttl time.Duration, refresh bool, load func() T) T {
	now := time.Now()

	entry.mu.Lock()
	defer entry.mu.Unlock()

	if !refresh && entry.loaded && (ttl == 0 || now.Before(entry.expiresAt)) {
		return entry.value
	}

	entry.value = load()
	entry.loaded = true
	if ttl > 0 {
		entry.expiresAt = now.Add(ttl)
	} else {
		entry.expiresAt = time.Time{}
	}
	return entry.value
}

func normalizeEnvironmentSection(section string) string {
	section = strings.TrimSpace(strings.ToLower(section))
	section = strings.TrimPrefix(section, "/")
	return section
}

func isValidEnvironmentSection(section string) bool {
	switch section {
	case sectionAll, sectionOS, sectionUser, sectionCPU, sectionMemory, sectionLoad, sectionUptime, sectionDisks, sectionNetwork, sectionProcess, sectionRuntime, sectionTools:
		return true
	default:
		return false
	}
}

func detectOS(ctx context.Context) OSInfo {
	info := OSInfo{
		Name: runtime.GOOS,
		Arch: runtime.GOARCH,
	}

	if hostname, err := os.Hostname(); err == nil {
		info.Hostname = hostname
	}
	if executable, err := os.Executable(); err == nil {
		info.Executable = executable
	}
	if workingDir, err := os.Getwd(); err == nil {
		info.WorkingDir = workingDir
	}
	if hostInfo, err := host.Info(); err == nil {
		info.Platform = hostInfo.Platform
		info.Family = hostInfo.PlatformFamily
		if hostInfo.PlatformVersion != "" {
			info.Version = hostInfo.PlatformVersion
		}
		if hostInfo.KernelVersion != "" {
			info.Kernel = strings.TrimSpace(strings.Join([]string{hostInfo.KernelArch, hostInfo.KernelVersion}, " "))
		}
	}

	switch runtime.GOOS {
	case "darwin":
		productName := commandOutput(ctx, "sw_vers", "-productName")
		productVersion := commandOutput(ctx, "sw_vers", "-productVersion")
		buildVersion := commandOutput(ctx, "sw_vers", "-buildVersion")
		info.Version = strings.TrimSpace(strings.Join([]string{productName, productVersion, buildVersion}, " "))
		info.Kernel = commandOutput(ctx, "uname", "-srv")
	case "linux":
		info.Version = firstNonEmpty(info.Version, commandOutput(ctx, "lsb_release", "-ds"), commandOutput(ctx, "uname", "-o"))
		info.Kernel = firstNonEmpty(info.Kernel, commandOutput(ctx, "uname", "-srv"))
	case "windows":
		info.Version = firstNonEmpty(info.Version, commandOutput(ctx, "cmd", "/c", "ver"))
	}

	return info
}

func detectUser() UserInfo {
	info := UserInfo{}
	current, err := user.Current()
	if err != nil {
		return info
	}

	info.Username = current.Username
	info.Name = current.Name
	info.UID = current.Uid
	info.GID = current.Gid
	info.HomeDir = current.HomeDir
	return info
}

func detectCPU(ctx context.Context) CPUInfo {
	info := CPUInfo{
		Architecture: runtime.GOARCH,
		LogicalCores: runtime.NumCPU(),
	}

	switch runtime.GOOS {
	case "darwin":
		info.Model = commandOutput(ctx, "sysctl", "-n", "machdep.cpu.brand_string")
	case "linux":
		info.Model = commandOutput(ctx, "sh", "-c", "awk -F': ' '/model name/ {print $2; exit}' /proc/cpuinfo")
	case "windows":
		info.Model = commandOutput(ctx, "wmic", "cpu", "get", "name", "/value")
		info.Model = strings.TrimPrefix(info.Model, "Name=")
	}

	return info
}

func detectMemory() MemoryInfo {
	info := MemoryInfo{}
	if virtualMemory, err := mem.VirtualMemory(); err == nil {
		info.Total = virtualMemory.Total
		info.Available = virtualMemory.Available
		info.Used = virtualMemory.Used
		info.UsedPercent = virtualMemory.UsedPercent
	}
	if swapMemory, err := mem.SwapMemory(); err == nil {
		info.SwapTotal = swapMemory.Total
		info.SwapUsed = swapMemory.Used
	}
	return info
}

func detectLoad() LoadInfo {
	info := LoadInfo{}
	if avg, err := load.Avg(); err == nil {
		info.Load1 = avg.Load1
		info.Load5 = avg.Load5
		info.Load15 = avg.Load15
	}
	return info
}

func detectUptime() UptimeInfo {
	info := UptimeInfo{
		BackendSeconds: uint64(time.Since(serverStartedAt).Seconds()),
		BackendStarted: serverStartedAt.UTC().Format(time.RFC3339),
	}
	if seconds, err := host.Uptime(); err == nil {
		info.SystemSeconds = seconds
	}
	return info
}

func detectDisks() []DiskInfo {
	root := rootMountpoint()
	partitions, _ := disk.Partitions(false)

	var best *disk.PartitionStat
	for _, partition := range partitions {
		if !diskMountContainsRoot(partition.Mountpoint, root) {
			continue
		}
		if best != nil && len(cleanDiskMountpoint(partition.Mountpoint)) <= len(cleanDiskMountpoint(best.Mountpoint)) {
			continue
		}
		next := partition
		best = &next
	}

	if best != nil {
		if info, ok := diskInfoForPartition(*best); ok {
			return []DiskInfo{info}
		}
	}

	if usage, err := disk.Usage(root); err == nil && usage.Total > 0 {
		return []DiskInfo{{
			Device:      root,
			Mountpoint:  root,
			Filesystem:  usage.Fstype,
			Total:       usage.Total,
			Free:        usage.Free,
			Used:        usage.Used,
			UsedPercent: usage.UsedPercent,
		}}
	}

	return nil
}

func diskInfoForPartition(partition disk.PartitionStat) (DiskInfo, bool) {
	usage, err := disk.Usage(partition.Mountpoint)
	if err != nil || usage.Total == 0 {
		return DiskInfo{}, false
	}
	filesystem := partition.Fstype
	if filesystem == "" {
		filesystem = usage.Fstype
	}
	return DiskInfo{
		Device:      partition.Device,
		Mountpoint:  partition.Mountpoint,
		Filesystem:  filesystem,
		Total:       usage.Total,
		Free:        usage.Free,
		Used:        usage.Used,
		UsedPercent: usage.UsedPercent,
	}, true
}

func diskMountContainsRoot(mountpoint string, root string) bool {
	mount := cleanDiskMountpoint(mountpoint)
	target := cleanDiskMountpoint(root)
	if mount == "" || target == "" {
		return false
	}
	if runtime.GOOS == "windows" {
		return strings.EqualFold(mount, target) || strings.HasPrefix(strings.ToLower(target), strings.ToLower(mount)+`\`)
	}
	return target == mount || strings.HasPrefix(target, strings.TrimRight(mount, "/")+"/")
}

func cleanDiskMountpoint(value string) string {
	if runtime.GOOS == "windows" {
		volume := filepath.VolumeName(value)
		if volume == "" {
			return ""
		}
		return strings.TrimRight(volume, `\`) + `\`
	}
	cleaned := filepath.Clean(value)
	if cleaned == "." {
		return ""
	}
	return cleaned
}

func detectNetwork() NetworkInfo {
	ips := detectIPs()
	return NetworkInfo{
		IPs: ips,
		DNS: detectDNS(),
		IO:  detectNetworkIO(primaryInterfaceNames(ips)),
	}
}

func detectIPs() []IPInfo {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil
	}

	ips := make([]IPInfo, 0)
	for _, networkInterface := range interfaces {
		if networkInterface.Flags&net.FlagUp == 0 || networkInterface.Flags&net.FlagLoopback != 0 || isIgnoredNetworkInterface(networkInterface.Name) {
			continue
		}

		addresses, err := networkInterface.Addrs()
		if err != nil {
			continue
		}

		for _, address := range addresses {
			hostValue, _, err := net.ParseCIDR(address.String())
			if err != nil || hostValue == nil || hostValue.IsLoopback() || hostValue.IsLinkLocalUnicast() {
				continue
			}

			family := "ipv6"
			if hostValue.To4() != nil {
				family = "ipv4"
			}

			ips = append(ips, IPInfo{
				Interface: networkInterface.Name,
				Address:   hostValue.String(),
				Family:    family,
			})
		}
	}
	return ips
}

func isIgnoredNetworkInterface(name string) bool {
	ignoredPrefixes := []string{"awdl", "bridge", "gif", "llw", "lo", "p2p", "stf", "utun"}
	for _, prefix := range ignoredPrefixes {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}

func primaryInterfaceNames(ips []IPInfo) map[string]struct{} {
	names := make(map[string]struct{})
	for _, ip := range ips {
		if ip.Interface != "" {
			names[ip.Interface] = struct{}{}
		}
	}
	return names
}

func detectDNS() DNSInfo {
	servers := parseResolverValues("nameserver")
	search := parseResolverValues("search")
	if len(search) == 0 {
		search = parseResolverValues("domain")
	}
	return DNSInfo{Servers: servers, Search: search}
}

func parseResolverValues(key string) []string {
	content, err := os.ReadFile("/etc/resolv.conf")
	if err != nil {
		return nil
	}

	values := make([]string, 0)
	for _, line := range strings.Split(string(content), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 || fields[0] != key {
			continue
		}
		values = append(values, fields[1:]...)
	}
	return values
}

func detectNetworkIO(interfaceNames map[string]struct{}) []NetworkIOInfo {
	if len(interfaceNames) == 0 {
		return nil
	}

	counters, err := gopsnet.IOCounters(true)
	if err != nil {
		return nil
	}

	items := make([]NetworkIOInfo, 0, len(interfaceNames))
	now := time.Now()
	networkIOSampleCache.mu.Lock()
	defer networkIOSampleCache.mu.Unlock()

	for _, counter := range counters {
		if _, ok := interfaceNames[counter.Name]; !ok {
			continue
		}

		var bytesSentPerSecond float64
		var bytesRecvPerSecond float64
		if previous, ok := networkIOSampleCache.samples[counter.Name]; ok {
			elapsed := now.Sub(previous.takenAt).Seconds()
			if elapsed > 0 {
				if counter.BytesSent >= previous.bytesSent {
					bytesSentPerSecond = float64(counter.BytesSent-previous.bytesSent) / elapsed
				}
				if counter.BytesRecv >= previous.bytesRecv {
					bytesRecvPerSecond = float64(counter.BytesRecv-previous.bytesRecv) / elapsed
				}
			}
		}

		networkIOSampleCache.samples[counter.Name] = networkIOSample{
			bytesSent: counter.BytesSent,
			bytesRecv: counter.BytesRecv,
			takenAt:   now,
		}

		items = append(items, NetworkIOInfo{
			Name:               counter.Name,
			BytesSent:          counter.BytesSent,
			BytesRecv:          counter.BytesRecv,
			BytesSentPerSecond: bytesSentPerSecond,
			BytesRecvPerSecond: bytesRecvPerSecond,
			PacketsSent:        counter.PacketsSent,
			PacketsRecv:        counter.PacketsRecv,
			Errin:              counter.Errin,
			Errout:             counter.Errout,
			Dropin:             counter.Dropin,
			Dropout:            counter.Dropout,
		})
	}
	return items
}

func detectProcess() ProcessInfo {
	info := ProcessInfo{
		PID:           int32(os.Getpid()),
		Goroutines:    runtime.NumGoroutine(),
		UptimeSeconds: uint64(time.Since(serverStartedAt).Seconds()),
	}

	proc, err := process.NewProcess(info.PID)
	if err != nil {
		return info
	}
	if ppid, err := proc.Ppid(); err == nil {
		info.PPID = ppid
	}
	if name, err := proc.Name(); err == nil {
		info.Name = name
	}
	if statuses, err := proc.Status(); err == nil && len(statuses) > 0 {
		info.Status = statuses[0]
	}
	if createTime, err := proc.CreateTime(); err == nil {
		info.CreateTime = createTime
	}
	if memoryInfo, err := proc.MemoryInfo(); err == nil {
		info.RSS = memoryInfo.RSS
	}
	if cpuPercent, err := proc.CPUPercent(); err == nil {
		info.CPUPercent = cpuPercent
	}
	if openFiles, err := proc.OpenFiles(); err == nil {
		info.OpenFiles = len(openFiles)
	}
	if threads, err := proc.NumThreads(); err == nil {
		info.Threads = threads
	}
	return info
}

func detectRuntime() RuntimeInfo {
	return RuntimeInfo{
		GoVersion:  runtime.Version(),
		Compiler:   runtime.Compiler,
		NumCPU:     runtime.NumCPU(),
		GOMAXPROCS: runtime.GOMAXPROCS(0),
	}
}

func detectTools(ctx context.Context) DevelopmentTools {
	return DevelopmentTools{
		NodeJS:   detectTool(ctx, "node", "--version"),
		NPM:      detectTool(ctx, "npm", "--version", "prefix", "-g"),
		NPX:      detectTool(ctx, "npx", "--version"),
		Python:   detectPython(ctx),
		UV:       detectTool(ctx, "uv", "--version"),
		Git:      detectGitTool(ctx),
		Homebrew: detectHomebrew(ctx),
		Xcode:    detectXcodeCommandLineTools(ctx),
		Docker:   detectDocker(ctx),
	}
}

func isVirtualFilesystem(filesystem string) bool {
	switch strings.ToLower(filesystem) {
	case "autofs", "binfmt_misc", "cgroup", "cgroup2", "debugfs", "devfs", "devpts", "devtmpfs", "fusectl", "hugetlbfs", "mqueue", "overlay", "proc", "pstore", "rpc_pipefs", "securityfs", "sysfs", "tmpfs", "tracefs":
		return true
	default:
		return false
	}
}

func rootMountpoint() string {
	if runtime.GOOS == "windows" {
		if drive := strings.TrimSpace(os.Getenv("SystemDrive")); drive != "" {
			return strings.TrimRight(drive, `\/`) + `\`
		}
		if cwd, err := os.Getwd(); err == nil {
			if volume := filepath.VolumeName(cwd); volume != "" {
				return strings.TrimRight(volume, `\`) + `\`
			}
		}
		return `C:\`
	}
	return "/"
}

func detectPython(ctx context.Context) ToolInfo {
	info := detectTool(ctx, "python3", "--version")
	if info.Available {
		return info
	}

	fallback := detectTool(ctx, "python", "--version")
	if fallback.Available {
		return fallback
	}
	return info
}

func detectDocker(ctx context.Context) ToolInfo {
	info := detectTool(ctx, "docker", "--version")
	if !info.Available {
		return info
	}

	running := false
	if output := commandOutput(ctx, "docker", "info", "--format", "{{.ServerVersion}}"); output != "" {
		running = true
		info.Metadata = map[string]string{"serverVersion": output}
	} else {
		info.Error = "Docker CLI is available, but Docker daemon did not respond"
	}
	info.Running = &running
	return info
}

func detectGitTool(ctx context.Context) ToolInfo {
	path := resolveToolPath("git")
	if path == "" {
		_, err := exec.LookPath("git")
		errorText := "executable file not found"
		if err != nil {
			errorText = err.Error()
		}
		return ToolInfo{Available: false, Error: errorText}
	}

	info := ToolInfo{Available: true, Path: path}
	if runtime.GOOS == "darwin" && isMacOSDeveloperToolStub(path) && !xcodeCommandLineToolsInstalled(ctx) {
		info.Available = false
		info.Error = "Xcode Command Line Tools are not installed"
		return info
	}

	info.Version = firstLine(commandOutput(ctx, path, "--version"))
	return info
}

func detectHomebrew(ctx context.Context) ToolInfo {
	if runtime.GOOS == "windows" {
		return ToolInfo{Available: false, Error: "Homebrew detection is not enabled on Windows"}
	}

	info := detectTool(ctx, "brew", "--version", "--prefix")
	if !info.Available {
		return info
	}

	info.Metadata = map[string]string{}
	if repository := commandOutput(ctx, "brew", "--repository"); repository != "" {
		info.Metadata["repository"] = repository
	}
	if cellar := commandOutput(ctx, "brew", "--cellar"); cellar != "" {
		info.Metadata["cellar"] = cellar
	}
	return info
}

func detectXcodeCommandLineTools(ctx context.Context) ToolInfo {
	if runtime.GOOS != "darwin" {
		return ToolInfo{Available: false, Error: "Xcode Command Line Tools detection is only available on macOS"}
	}

	path := resolveToolPath("xcode-select")
	if path == "" {
		return ToolInfo{Available: false, Error: "xcode-select executable file not found"}
	}

	prefix := commandOutput(ctx, path, "-p")
	if prefix == "" {
		return ToolInfo{Available: false, Path: path, Error: "Xcode Command Line Tools are not installed"}
	}

	return ToolInfo{
		Available:    true,
		Path:         path,
		Version:      firstLine(commandOutput(ctx, path, "--version")),
		GlobalPrefix: prefix,
	}
}

func xcodeCommandLineToolsInstalled(ctx context.Context) bool {
	if runtime.GOOS != "darwin" {
		return false
	}
	return commandOutput(ctx, "xcode-select", "-p") != ""
}

func isMacOSDeveloperToolStub(path string) bool {
	return runtime.GOOS == "darwin" && filepath.Clean(path) == "/usr/bin/git"
}

func detectTool(ctx context.Context, name string, versionArg string, prefixArgs ...string) ToolInfo {
	path := resolveToolPath(name)
	if path == "" {
		_, err := exec.LookPath(name)
		errorText := "executable file not found"
		if err != nil {
			errorText = err.Error()
		}
		return ToolInfo{Available: false, Error: errorText}
	}

	info := ToolInfo{
		Available: true,
		Path:      path,
	}

	if versionArg != "" {
		info.Version = firstLine(commandOutput(ctx, path, versionArg))
	}
	if len(prefixArgs) > 0 {
		info.GlobalPrefix = commandOutput(ctx, path, prefixArgs...)
	}

	return info
}

func resolveToolPath(name string, candidates ...string) string {
	return toolenv.ResolveToolPath(name, candidates...)
}

func resolveCommandExecutable(name string) string {
	if name == "" || filepath.IsAbs(name) || strings.ContainsAny(name, `/\`) {
		return name
	}
	if path := resolveToolPath(name); path != "" {
		return path
	}
	return name
}

func toolCommandEnv() []string {
	return toolenv.CommandEnv()
}

func toolPathEntries() []string {
	return toolenv.ToolPathEntries()
}

func toolExecutableCandidates(name string) []string {
	return toolenv.ToolExecutableCandidates(name)
}

func resolveHomebrewPath() string {
	return toolenv.ResolveHomebrewPath()
}

func userLocalExecutablePath(name string) string {
	return toolenv.UserLocalExecutablePath(name)
}

func windowsExecutableName(name string) string {
	return toolenv.WindowsExecutableName(name)
}

func nodeBinPathCandidates() []string {
	return toolenv.NodeBinPathCandidates()
}

func isExecutablePath(path string) bool {
	return toolenv.IsExecutablePath(path)
}

func prependPathEntries(env []string, entries ...string) []string {
	return toolenv.PrependPathEntries(env, entries...)
}

func compactStrings(values []string) []string {
	return toolenv.CompactStrings(values)
}

func commandOutput(ctx context.Context, name string, args ...string) string {
	cmdCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, resolveCommandExecutable(name), args...)
	cmd.Env = toolCommandEnv()
	output, err := cmd.CombinedOutput()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

func firstLine(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	return strings.Split(value, "\n")[0]
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
