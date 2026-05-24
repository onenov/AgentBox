package gateway

import "time"

type FrameType string

const (
	FrameTypeRequest  FrameType = "req"
	FrameTypeResponse FrameType = "res"
	FrameTypeEvent    FrameType = "event"
)

type Frame struct {
	Type         FrameType `json:"type"`
	ID           string    `json:"id,omitempty"`
	Method       string    `json:"method,omitempty"`
	Params       any       `json:"params,omitempty"`
	OK           bool      `json:"ok,omitempty"`
	Payload      any       `json:"payload,omitempty"`
	Error        *Error    `json:"error,omitempty"`
	Event        string    `json:"event,omitempty"`
	Seq          *int64    `json:"seq,omitempty"`
	StateVersion *int64    `json:"stateVersion,omitempty"`
}

type Error struct {
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
	Details any    `json:"details,omitempty"`
}

type ClientConfig struct {
	URL      string
	Token    string
	Password string
	Timeout  time.Duration
	ClientID string
	Role     string
	Scopes   []string
}

type Client struct {
	config ClientConfig
}

func NewClient(config ClientConfig) *Client {
	if config.Timeout == 0 {
		config.Timeout = 30 * time.Second
	}
	if config.ClientID == "" {
		config.ClientID = "agent-box-server"
	}
	if config.Role == "" {
		config.Role = "operator"
	}
	if len(config.Scopes) == 0 {
		config.Scopes = []string{"operator.read", "operator.write"}
	}
	return &Client{config: config}
}
