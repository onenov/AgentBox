package realtime

import (
	"context"
	"log/slog"
	"net/http"
	"sync"

	"nhooyr.io/websocket"
)

type Hub struct {
	logger  *slog.Logger
	clients map[*websocket.Conn]struct{}
	mu      sync.RWMutex
}

func NewHub(logger *slog.Logger) *Hub {
	return &Hub{
		logger:  logger,
		clients: make(map[*websocket.Conn]struct{}),
	}
}

func (h *Hub) Handle(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		h.logger.Error("accept websocket", slog.String("error", err.Error()))
		return
	}

	h.mu.Lock()
	h.clients[conn] = struct{}{}
	h.mu.Unlock()

	defer func() {
		h.mu.Lock()
		delete(h.clients, conn)
		h.mu.Unlock()
		_ = conn.Close(websocket.StatusNormalClosure, "closed")
	}()

	for {
		_, _, err := conn.Read(r.Context())
		if err != nil {
			return
		}
	}
}

func (h *Hub) Broadcast(ctx context.Context, payload []byte) {
	h.mu.RLock()
	clients := make([]*websocket.Conn, 0, len(h.clients))
	for client := range h.clients {
		clients = append(clients, client)
	}
	h.mu.RUnlock()

	for _, client := range clients {
		if err := client.Write(ctx, websocket.MessageText, payload); err != nil {
			h.logger.Debug("broadcast websocket", slog.String("error", err.Error()))
		}
	}
}
