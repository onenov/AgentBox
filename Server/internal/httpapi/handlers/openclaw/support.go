package openclaw

import (
	"context"
	"os/exec"
	"strings"
	"sync"
	"time"

	"agent-box-server/internal/httpapi/toolenv"
)

type OpenClawCacheInfo struct {
	Refresh bool `json:"refresh" example:"false" doc:"Whether refresh=true was requested."`
}

type cacheEntry[T any] struct {
	mu        sync.Mutex
	loaded    bool
	value     T
	expiresAt time.Time
}

type persistentCache[T any] struct {
	mu      sync.Mutex
	entries map[string]*persistentCacheEntry[T]
}

type persistentCacheEntry[T any] struct {
	mu     sync.Mutex
	loaded bool
	value  T
}

func cached[T any](entry *cacheEntry[T], ttl time.Duration, refresh bool, load func() T) T {
	now := time.Now()

	entry.mu.Lock()
	defer entry.mu.Unlock()

	if entry.loaded && !refresh && now.Before(entry.expiresAt) {
		return entry.value
	}

	entry.value = load()
	entry.loaded = true
	entry.expiresAt = now.Add(ttl)
	return entry.value
}

func cachedPersistent[T any](cache *persistentCache[T], key string, refresh bool, load func() (T, error)) (T, error) {
	entry := persistentCacheKey(cache, key)

	entry.mu.Lock()
	defer entry.mu.Unlock()

	if entry.loaded && !refresh {
		return entry.value, nil
	}

	value, err := load()
	if err != nil {
		var zero T
		return zero, err
	}

	entry.value = value
	entry.loaded = true
	return entry.value, nil
}

func persistentCacheKey[T any](cache *persistentCache[T], key string) *persistentCacheEntry[T] {
	cache.mu.Lock()
	defer cache.mu.Unlock()

	if cache.entries == nil {
		cache.entries = map[string]*persistentCacheEntry[T]{}
	}
	if cache.entries[key] == nil {
		cache.entries[key] = &persistentCacheEntry[T]{}
	}
	return cache.entries[key]
}

func invalidatePersistentCache[T any](cache *persistentCache[T], keys ...string) {
	cache.mu.Lock()
	defer cache.mu.Unlock()

	if len(keys) == 0 {
		cache.entries = map[string]*persistentCacheEntry[T]{}
		return
	}
	for _, key := range keys {
		delete(cache.entries, key)
	}
}

func commandOutput(ctx context.Context, name string, args ...string) string {
	cmdCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, name, args...)
	cmd.Env = toolenv.CommandEnv()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func firstLine(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	lines := strings.Split(value, "\n")
	return strings.TrimSpace(lines[0])
}
