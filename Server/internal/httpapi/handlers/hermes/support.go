package hermes

import (
	"sync"
	"time"
)

type HermesCacheInfo struct {
	Refresh bool `json:"refresh" example:"false" doc:"Whether refresh=true was requested."`
}

type cacheEntry[T any] struct {
	mu        sync.Mutex
	loaded    bool
	value     T
	expiresAt time.Time
}

type cacheMap[T any] struct {
	mu      sync.Mutex
	entries map[string]*cacheEntry[T]
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

func cachedByKey[T any](cache *cacheMap[T], key string, ttl time.Duration, refresh bool, load func() T) T {
	cache.mu.Lock()
	if cache.entries == nil {
		cache.entries = map[string]*cacheEntry[T]{}
	}
	entry := cache.entries[key]
	if entry == nil {
		entry = &cacheEntry[T]{}
		cache.entries[key] = entry
	}
	cache.mu.Unlock()

	return cached(entry, ttl, refresh, load)
}

func invalidateCache[T any](entry *cacheEntry[T]) {
	entry.mu.Lock()
	defer entry.mu.Unlock()

	entry.loaded = false
	var zero T
	entry.value = zero
	entry.expiresAt = time.Time{}
}

func invalidateCacheMap[T any](cache *cacheMap[T]) {
	cache.mu.Lock()
	defer cache.mu.Unlock()

	cache.entries = map[string]*cacheEntry[T]{}
}
