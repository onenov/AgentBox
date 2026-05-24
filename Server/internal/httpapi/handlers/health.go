package handlers

// Health handler 用于提供轻量级健康检查，方便前端、部署平台或监控系统确认后端进程是否可访问。
//
// 该接口只返回服务状态、服务名和当前 UTC 时间，不执行数据库、外部命令或运行环境检测，
// 因此适合作为高频探活接口使用。

import (
	"context"
	"time"

	"agent-box-server/internal/version"
)

type HealthOutput struct {
	Body HealthResponse
}

type HealthResponse struct {
	Status    string `json:"status" example:"ok" doc:"Service health status."`
	Service   string `json:"service" example:"agent-box-server" doc:"Service name."`
	Version   string `json:"version" example:"1.0.1" doc:"AgentBox backend version."`
	Timestamp string `json:"timestamp" example:"2026-05-11T15:59:00Z" doc:"UTC response timestamp."`
}

func Health(ctx context.Context, input *struct{}) (*HealthOutput, error) {
	return &HealthOutput{
		Body: HealthResponse{
			Status:    "ok",
			Service:   "agent-box-server",
			Version:   version.Current(),
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		},
	}, nil
}
