package handlers

// NetworkCheck handler 用于从后端主机主动探测常用外部站点的访问延迟。
//
// 该接口面向 AgentBox UI 的网络诊断卡片，检测百度、Google 和 GitHub 的 HTTP 可达性、
// 状态码和请求耗时，帮助区分“浏览器到后端 API 延迟”和“后端主机访问公网服务延迟”。
//
// 接口只返回延迟、状态码和错误摘要，不返回响应正文或任何敏感网络配置。

import (
	"context"
	"net/http"
	"time"
)

type NetworkCheckInput struct {
	Refresh bool `query:"refresh" doc:"Force refresh cached network check data." example:"false"`
}

type NetworkCheckOutput struct {
	Body NetworkCheckResponse
}

type NetworkCheckResponse struct {
	Status    string             `json:"status" example:"ok" doc:"Overall network check status."`
	Timestamp string             `json:"timestamp" example:"2026-05-11T15:59:00Z" doc:"UTC response timestamp."`
	Cache     CacheInfo          `json:"cache" doc:"Cache behavior used for this response."`
	Targets   []NetworkCheckItem `json:"targets" doc:"External target latency checks."`
}

type NetworkCheckItem struct {
	Name       string `json:"name" example:"GitHub" doc:"Display name of the checked target."`
	URL        string `json:"url" example:"https://github.com" doc:"Checked URL."`
	Status     string `json:"status" example:"ok" doc:"Check status: ok or error."`
	StatusCode int    `json:"statusCode,omitempty" example:"200" doc:"HTTP status code when available."`
	LatencyMs  int64  `json:"latencyMs" example:"42" doc:"Request latency in milliseconds."`
	Error      string `json:"error,omitempty" doc:"Error summary when the check failed."`
}

var networkCheckCache cacheEntry[NetworkCheckResponse]

func NetworkCheck(ctx context.Context, input *NetworkCheckInput) (*NetworkCheckOutput, error) {
	if input == nil {
		input = &NetworkCheckInput{}
	}

	body := cached(&networkCheckCache, 5*time.Second, input.Refresh, func() NetworkCheckResponse {
		return detectNetworkChecks(ctx)
	})
	body.Timestamp = time.Now().UTC().Format(time.RFC3339)
	body.Cache = CacheInfo{Refresh: input.Refresh}

	return &NetworkCheckOutput{Body: body}, nil
}

func detectNetworkChecks(ctx context.Context) NetworkCheckResponse {
	targets := []struct {
		name string
		url  string
	}{
		{name: "百度", url: "https://www.baidu.com"},
		{name: "Google", url: "https://www.google.com/generate_204"},
		{name: "GitHub", url: "https://github.com"},
	}

	items := make([]NetworkCheckItem, 0, len(targets))
	status := "ok"
	for _, target := range targets {
		item := probeNetworkTarget(ctx, target.name, target.url)
		if item.Status != "ok" {
			status = "warning"
		}
		items = append(items, item)
	}

	return NetworkCheckResponse{
		Status:  status,
		Targets: items,
	}
}

func probeNetworkTarget(ctx context.Context, name string, targetURL string) NetworkCheckItem {
	requestCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, targetURL, nil)
	if err != nil {
		return NetworkCheckItem{Name: name, URL: targetURL, Status: "error", Error: err.Error()}
	}
	request.Header.Set("User-Agent", "AgentBox-NetworkCheck/0.1")

	client := &http.Client{Timeout: 5 * time.Second}
	startedAt := time.Now()
	response, err := client.Do(request)
	latencyMs := time.Since(startedAt).Milliseconds()
	if err != nil {
		return NetworkCheckItem{Name: name, URL: targetURL, Status: "error", LatencyMs: latencyMs, Error: err.Error()}
	}
	defer response.Body.Close()

	status := "ok"
	if response.StatusCode >= http.StatusBadRequest {
		status = "error"
	}

	return NetworkCheckItem{
		Name:       name,
		URL:        targetURL,
		Status:     status,
		StatusCode: response.StatusCode,
		LatencyMs:  latencyMs,
	}
}
