package hermes

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	defaultHermesMessageStatsHours = 6
	maxHermesMessageStatsHours     = 168
)

type HermesMessageStatsInput struct {
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	Hours   int    `query:"hours" doc:"Lookback window in hours." example:"6"`
	Range   string `query:"range" doc:"Range preset: hour, week, month, or all. Week and month are calendar periods in local time." example:"week"`
}

type HermesRecentMessagesInput struct {
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	Limit   int    `query:"limit" doc:"Maximum number of recent messages to return. Maximum is 200." example:"30"`
}

type HermesMessageStatsOutput struct {
	Body HermesMessageStatsResponse
}

type HermesRecentMessagesOutput struct {
	Body HermesRecentMessagesResponse
}

type HermesMessageStatsResponse struct {
	Status    string                        `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                        `json:"timestamp" example:"2026-05-18T06:00:00Z" doc:"UTC response timestamp."`
	Profile   HermesProfileSelection        `json:"profile" doc:"Resolved Hermes profile used for this response."`
	Home      string                        `json:"home" doc:"Hermes home directory scanned."`
	Range     HermesMessageStatsRange       `json:"range" doc:"Time range used for aggregation."`
	Total     int                           `json:"total" example:"42" doc:"Total message records in range."`
	Roles     HermesMessageRoleCounts       `json:"roles" doc:"Message counts by role."`
	Platforms []HermesMessageStatsPlatform  `json:"platforms" doc:"Per-platform message counts."`
	Buckets   []HermesMessageStatsBucket    `json:"buckets" doc:"Hourly message buckets."`
	Scanned   HermesMessageStatsScanSummary `json:"scanned" doc:"Best-effort scan summary."`
}

type HermesRecentMessagesResponse struct {
	Status    string                   `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                   `json:"timestamp" example:"2026-05-18T06:00:00Z" doc:"UTC response timestamp."`
	Profile   HermesProfileSelection   `json:"profile" doc:"Resolved Hermes profile used for this response."`
	Home      string                   `json:"home" doc:"Hermes home directory scanned."`
	Limit     int                      `json:"limit" example:"30" doc:"Requested row limit."`
	Messages  []HermesRecentMessage    `json:"messages" doc:"Recent Hermes channel user and assistant messages."`
	Scanned   HermesMessageScanSummary `json:"scanned" doc:"Best-effort scan summary."`
}

type HermesRecentMessage struct {
	ID          string `json:"id" doc:"Stable row id."`
	SessionID   string `json:"sessionId" doc:"Hermes session id."`
	SessionKey  string `json:"sessionKey,omitempty" doc:"Gateway session key from sessions.json."`
	Platform    string `json:"platform,omitempty" example:"weixin" doc:"Messaging platform."`
	ChatID      string `json:"chatId,omitempty" doc:"Platform chat id."`
	ChatName    string `json:"chatName,omitempty" doc:"Platform chat display name when available."`
	ChatType    string `json:"chatType,omitempty" example:"dm" doc:"Platform chat type."`
	Sender      string `json:"sender,omitempty" doc:"Sender display value when present."`
	SenderID    string `json:"senderId,omitempty" doc:"Sender id when present."`
	Role        string `json:"role" example:"user" doc:"Message role."`
	Content     string `json:"content" doc:"Message body."`
	Timestamp   string `json:"timestamp" example:"2026-05-18T06:00:00Z" doc:"Message timestamp in UTC."`
	DisplayTime string `json:"displayTime,omitempty" doc:"Original timestamp when present."`
}

type HermesMessageRoleCounts struct {
	User      int `json:"user" example:"12" doc:"User message count."`
	Assistant int `json:"assistant" example:"18" doc:"Assistant message count."`
	Tool      int `json:"tool" example:"7" doc:"Tool message count."`
	Other     int `json:"other" example:"5" doc:"Other message count."`
}

type HermesMessageStatsRange struct {
	Hours    int    `json:"hours" example:"6" doc:"Lookback window in hours."`
	Bucket   string `json:"bucket" example:"hour" doc:"Bucket granularity."`
	Preset   string `json:"preset" example:"week" doc:"Selected range preset."`
	Start    string `json:"start" example:"2026-05-18T00:00:00+08:00" doc:"Range start in local timezone."`
	End      string `json:"end" example:"2026-05-18T06:00:00+08:00" doc:"Range end in local timezone."`
	Timezone string `json:"timezone" example:"Asia/Shanghai" doc:"Timezone used for labels and bucket timestamps."`
}

type HermesMessageStatsPlatform struct {
	Platform string                  `json:"platform" example:"weixin" doc:"Messaging platform."`
	Total    int                     `json:"total" example:"42" doc:"Total messages for this platform."`
	Roles    HermesMessageRoleCounts `json:"roles" doc:"Message counts by role for this platform."`
}

type HermesMessageStatsBucket struct {
	Time  string                  `json:"time" example:"2026-05-18T06:00:00+08:00" doc:"Bucket start timestamp in local timezone."`
	Label string                  `json:"label" example:"14:00" doc:"Short local label for chart display."`
	Total int                     `json:"total" example:"10" doc:"Total message count in bucket."`
	Roles HermesMessageRoleCounts `json:"roles" doc:"Message counts by role in this bucket."`
}

type HermesMessageStatsScanSummary struct {
	Files  int      `json:"files" example:"2" doc:"Number of session JSONL files scanned."`
	Errors []string `json:"errors,omitempty" doc:"Non-fatal scan errors."`
}

type HermesMessageScanSummary struct {
	Files  int      `json:"files" example:"2" doc:"Number of session JSONL files scanned."`
	Errors []string `json:"errors,omitempty" doc:"Non-fatal scan errors."`
}

type hermesSessionMessageLine struct {
	Role         string          `json:"role"`
	Content      json.RawMessage `json:"content"`
	Platform     string          `json:"platform"`
	Model        string          `json:"model"`
	Timestamp    string          `json:"timestamp"`
	FinishReason string          `json:"finish_reason"`
}

type hermesSessionRegistryEntry struct {
	SessionKey string `json:"session_key"`
	SessionID  string `json:"session_id"`
	Platform   string `json:"platform"`
	ChatType   string `json:"chat_type"`
	Origin     struct {
		Platform  string `json:"platform"`
		ChatID    string `json:"chat_id"`
		ChatName  string `json:"chat_name"`
		ChatType  string `json:"chat_type"`
		UserID    string `json:"user_id"`
		UserName  string `json:"user_name"`
		ChatTopic string `json:"chat_topic"`
	} `json:"origin"`
}

type hermesMessageStatsRange struct {
	hours  int
	preset string
	start  time.Time
	end    time.Time
}

func HermesMessageStats(ctx context.Context, input *HermesMessageStatsInput) (*HermesMessageStatsOutput, error) {
	if input == nil {
		input = &HermesMessageStatsInput{}
	}
	_ = ctx
	profile, err := resolveHermesProfileSelection(input.Profile)
	if err != nil {
		return nil, err
	}
	ranges := resolveHermesMessageStatsRange(input.Range, input.Hours)
	body := collectHermesMessageStats(profile, ranges)
	return &HermesMessageStatsOutput{Body: body}, nil
}

func HermesRecentMessages(ctx context.Context, input *HermesRecentMessagesInput) (*HermesRecentMessagesOutput, error) {
	if input == nil {
		input = &HermesRecentMessagesInput{}
	}
	_ = ctx
	profile, err := resolveHermesProfileSelection(input.Profile)
	if err != nil {
		return nil, err
	}
	limit := input.Limit
	if limit <= 0 {
		limit = 30
	}
	if limit > 200 {
		limit = 200
	}
	body := collectHermesRecentMessages(profile, limit)
	return &HermesRecentMessagesOutput{Body: body}, nil
}

func resolveHermesMessageStatsRange(preset string, hours int) hermesMessageStatsRange {
	now := time.Now().Local()
	normalized := strings.ToLower(strings.TrimSpace(preset))
	switch normalized {
	case "week", "this-week", "this_week":
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7
		}
		start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, -(weekday - 1))
		return hermesMessageStatsRange{preset: "week", start: start, end: now}
	case "month", "this-month", "this_month":
		start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
		return hermesMessageStatsRange{preset: "month", start: start, end: now}
	case "all":
		return hermesMessageStatsRange{preset: "all", end: now}
	default:
		if hours <= 0 {
			hours = defaultHermesMessageStatsHours
		}
		if hours > maxHermesMessageStatsHours {
			hours = maxHermesMessageStatsHours
		}
		return hermesMessageStatsRange{hours: hours, preset: "hour", start: now.Add(-time.Duration(hours) * time.Hour), end: now}
	}
}

func collectHermesMessageStats(profile HermesProfileSelection, ranges hermesMessageStatsRange) HermesMessageStatsResponse {
	now := ranges.end
	endBucket := truncateHermesMessageHour(now)
	start := ranges.start
	buckets := []HermesMessageStatsBucket{}
	bucketIndex := map[string]int{}
	if !start.IsZero() {
		startBucket := truncateHermesMessageHour(start)
		for bucketTime := startBucket; !bucketTime.After(endBucket); bucketTime = bucketTime.Add(time.Hour) {
			addHermesMessageBucket(bucketTime, &buckets, bucketIndex)
		}
	}

	totalRoles := HermesMessageRoleCounts{}
	platforms := map[string]*HermesMessageStatsPlatform{}
	scanned := HermesMessageStatsScanSummary{}
	registry := readHermesSessionRegistry(filepath.Join(profile.Path, "sessions", "sessions.json"))
	scanHermesMessageStatsDir(profile, registry, ranges.start, &totalRoles, platforms, &buckets, bucketIndex, &scanned)

	platformRows := make([]HermesMessageStatsPlatform, 0, len(platforms))
	for _, platform := range platforms {
		platformRows = append(platformRows, *platform)
	}
	sort.Slice(platformRows, func(i, j int) bool {
		if platformRows[i].Total == platformRows[j].Total {
			return platformRows[i].Platform < platformRows[j].Platform
		}
		return platformRows[i].Total > platformRows[j].Total
	})
	buckets = fillHermesMessageBucketGaps(buckets, endBucket)
	if start.IsZero() && len(buckets) > 0 {
		if parsed, err := time.Parse(time.RFC3339, buckets[0].Time); err == nil {
			start = parsed
		}
	}
	if start.IsZero() {
		start = endBucket
	}

	return HermesMessageStatsResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Profile:   profile,
		Home:      profile.Path,
		Range: HermesMessageStatsRange{
			Hours:    ranges.hours,
			Bucket:   "hour",
			Preset:   ranges.preset,
			Start:    start.Format(time.RFC3339),
			End:      now.Format(time.RFC3339),
			Timezone: hermesLocalTimezoneName(now),
		},
		Total:     totalRoles.total(),
		Roles:     totalRoles,
		Platforms: platformRows,
		Buckets:   buckets,
		Scanned:   scanned,
	}
}

func collectHermesRecentMessages(profile HermesProfileSelection, limit int) HermesRecentMessagesResponse {
	scanned := HermesMessageScanSummary{}
	registry := readHermesSessionRegistry(filepath.Join(profile.Path, "sessions", "sessions.json"))
	messages := []HermesRecentMessage{}
	scanHermesRecentMessagesDir(profile, registry, &messages, &scanned)
	sort.Slice(messages, func(i, j int) bool {
		return messages[i].Timestamp > messages[j].Timestamp
	})
	if len(messages) > limit {
		messages = messages[:limit]
	}
	return HermesRecentMessagesResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Profile:   profile,
		Home:      profile.Path,
		Limit:     limit,
		Messages:  messages,
		Scanned:   scanned,
	}
}

func scanHermesMessageStatsDir(profile HermesProfileSelection, registry map[string]hermesSessionRegistryEntry, start time.Time, totalRoles *HermesMessageRoleCounts, platforms map[string]*HermesMessageStatsPlatform, buckets *[]HermesMessageStatsBucket, bucketIndex map[string]int, scanned *HermesMessageStatsScanSummary) {
	entries, err := os.ReadDir(filepath.Join(profile.Path, "sessions"))
	if err != nil {
		scanned.Errors = append(scanned.Errors, err.Error())
		return
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || strings.HasPrefix(name, ".") || !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		scanned.Files++
		scanHermesMessageStatsFile(filepath.Join(profile.Path, "sessions", name), registry, start, totalRoles, platforms, buckets, bucketIndex, scanned)
	}
}

func scanHermesMessageStatsFile(path string, registry map[string]hermesSessionRegistryEntry, start time.Time, totalRoles *HermesMessageRoleCounts, platforms map[string]*HermesMessageStatsPlatform, buckets *[]HermesMessageStatsBucket, bucketIndex map[string]int, scanned *HermesMessageStatsScanSummary) {
	file, err := os.Open(path)
	if err != nil {
		scanned.Errors = append(scanned.Errors, filepath.Base(path)+": "+err.Error())
		return
	}
	defer file.Close()
	sessionID := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	sessionInfo := registry[sessionID]
	sessionPlatform := firstNonEmpty(sessionInfo.Platform, sessionInfo.Origin.Platform)
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		record, ok := parseHermesSessionLine(scanner.Text())
		if !ok {
			continue
		}
		role := normalizeHermesMessageRole(record.Role)
		if role == "other" {
			continue
		}
		content := hermesMessageText(record.Content)
		if isHermesHiddenMessageContent(content) {
			continue
		}
		timestamp, err := parseHermesMessageTimestamp(record.Timestamp)
		if err != nil || (!start.IsZero() && timestamp.Before(start)) || timestamp.After(time.Now().Add(time.Minute)) {
			continue
		}
		platform := firstNonEmpty(record.Platform, sessionPlatform, "local")
		incrementHermesMessageCounts(totalRoles, role)
		platformRow := platforms[platform]
		if platformRow == nil {
			platformRow = &HermesMessageStatsPlatform{Platform: platform}
			platforms[platform] = platformRow
		}
		platformRow.Total++
		incrementHermesMessageCounts(&platformRow.Roles, role)
		bucketTime := truncateHermesMessageHour(timestamp.Local())
		index := addHermesMessageBucket(bucketTime, buckets, bucketIndex)
		(*buckets)[index].Total++
		incrementHermesMessageCounts(&(*buckets)[index].Roles, role)
	}
	if err := scanner.Err(); err != nil {
		scanned.Errors = append(scanned.Errors, filepath.Base(path)+": "+err.Error())
	}
}

func scanHermesRecentMessagesDir(profile HermesProfileSelection, registry map[string]hermesSessionRegistryEntry, messages *[]HermesRecentMessage, scanned *HermesMessageScanSummary) {
	entries, err := os.ReadDir(filepath.Join(profile.Path, "sessions"))
	if err != nil {
		scanned.Errors = append(scanned.Errors, err.Error())
		return
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || strings.HasPrefix(name, ".") || !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		scanned.Files++
		scanHermesRecentMessagesFile(filepath.Join(profile.Path, "sessions", name), registry, messages, scanned)
	}
}

func scanHermesRecentMessagesFile(path string, registry map[string]hermesSessionRegistryEntry, messages *[]HermesRecentMessage, scanned *HermesMessageScanSummary) {
	file, err := os.Open(path)
	if err != nil {
		scanned.Errors = append(scanned.Errors, filepath.Base(path)+": "+err.Error())
		return
	}
	defer file.Close()
	sessionID := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	sessionInfo := registry[sessionID]
	sessionPlatform := firstNonEmpty(sessionInfo.Platform, sessionInfo.Origin.Platform)
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		record, ok := parseHermesSessionLine(scanner.Text())
		if !ok {
			continue
		}
		role := normalizeHermesMessageRole(record.Role)
		if role != "user" && role != "assistant" {
			continue
		}
		content := hermesMessageText(record.Content)
		if isHermesHiddenMessageContent(content) {
			continue
		}
		timestamp, err := parseHermesMessageTimestamp(record.Timestamp)
		if err != nil {
			continue
		}
		platform := firstNonEmpty(record.Platform, sessionPlatform)
		*messages = append(*messages, HermesRecentMessage{
			ID:          sessionID + ":" + strconv.Itoa(lineNumber),
			SessionID:   sessionID,
			SessionKey:  firstNonEmpty(sessionInfo.SessionKey),
			Platform:    platform,
			ChatID:      sessionInfo.Origin.ChatID,
			ChatName:    sessionInfo.Origin.ChatName,
			ChatType:    firstNonEmpty(sessionInfo.ChatType, sessionInfo.Origin.ChatType),
			Sender:      hermesRecentMessageSender(role, sessionInfo),
			SenderID:    firstNonEmpty(sessionInfo.Origin.UserID),
			Role:        role,
			Content:     strings.TrimSpace(content),
			Timestamp:   timestamp.UTC().Format(time.RFC3339),
			DisplayTime: record.Timestamp,
		})
	}
	if err := scanner.Err(); err != nil {
		scanned.Errors = append(scanned.Errors, filepath.Base(path)+": "+err.Error())
	}
}

func parseHermesSessionLine(line string) (hermesSessionMessageLine, bool) {
	var record hermesSessionMessageLine
	if strings.TrimSpace(line) == "" {
		return record, false
	}
	if err := json.Unmarshal([]byte(line), &record); err != nil {
		return record, false
	}
	return record, true
}

func readHermesSessionRegistry(path string) map[string]hermesSessionRegistryEntry {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var byKey map[string]hermesSessionRegistryEntry
	if err := json.Unmarshal(content, &byKey); err != nil {
		return nil
	}
	bySession := map[string]hermesSessionRegistryEntry{}
	for key, item := range byKey {
		if item.SessionKey == "" {
			item.SessionKey = key
		}
		if item.SessionID != "" {
			bySession[item.SessionID] = item
		}
	}
	return bySession
}

func hermesMessageText(content json.RawMessage) string {
	if len(content) == 0 {
		return ""
	}
	var plain string
	if err := json.Unmarshal(content, &plain); err == nil {
		return plain
	}
	var value any
	if err := json.Unmarshal(content, &value); err == nil {
		return contentToText(value)
	}
	return string(content)
}

func parseHermesMessageTimestamp(value string) (time.Time, error) {
	trimmed := strings.TrimSpace(value)
	if parsed, err := time.Parse(time.RFC3339Nano, trimmed); err == nil {
		return parsed, nil
	}
	for _, layout := range []string{
		"2006-01-02T15:04:05.999999999",
		"2006-01-02T15:04:05.999999",
		"2006-01-02T15:04:05",
	} {
		if parsed, err := time.ParseInLocation(layout, trimmed, time.Local); err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, &time.ParseError{Layout: time.RFC3339Nano, Value: trimmed}
}

func isHermesHiddenMessageContent(content string) bool {
	trimmed := strings.TrimSpace(content)
	return trimmed == "" || strings.EqualFold(trimmed, "HEARTBEAT_OK")
}

func hermesRecentMessageSender(role string, session hermesSessionRegistryEntry) string {
	if role == "assistant" {
		return "Hermes"
	}
	return firstNonEmpty(session.Origin.UserName, session.Origin.UserID)
}

func normalizeHermesMessageRole(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "user":
		return "user"
	case "assistant":
		return "assistant"
	case "tool", "toolresult", "tool_result", "tool-result":
		return "tool"
	default:
		return "other"
	}
}

func incrementHermesMessageCounts(counts *HermesMessageRoleCounts, role string) {
	switch role {
	case "user":
		counts.User++
	case "assistant":
		counts.Assistant++
	case "tool":
		counts.Tool++
	default:
		counts.Other++
	}
}

func (counts HermesMessageRoleCounts) total() int {
	return counts.User + counts.Assistant + counts.Tool + counts.Other
}

func addHermesMessageBucket(bucketTime time.Time, buckets *[]HermesMessageStatsBucket, bucketIndex map[string]int) int {
	key := bucketTime.Format(time.RFC3339)
	if index, ok := bucketIndex[key]; ok {
		return index
	}
	index := len(*buckets)
	bucketIndex[key] = index
	*buckets = append(*buckets, HermesMessageStatsBucket{Time: key, Label: bucketTime.Format("15:04")})
	return index
}

func fillHermesMessageBucketGaps(buckets []HermesMessageStatsBucket, endBucket time.Time) []HermesMessageStatsBucket {
	if len(buckets) == 0 {
		return buckets
	}
	sort.Slice(buckets, func(i, j int) bool { return buckets[i].Time < buckets[j].Time })
	first, err := time.Parse(time.RFC3339, buckets[0].Time)
	if err != nil {
		return buckets
	}
	byTime := make(map[string]HermesMessageStatsBucket, len(buckets))
	for _, bucket := range buckets {
		byTime[bucket.Time] = bucket
	}
	filled := make([]HermesMessageStatsBucket, 0, int(endBucket.Sub(first)/time.Hour)+1)
	for bucketTime := first; !bucketTime.After(endBucket); bucketTime = bucketTime.Add(time.Hour) {
		key := bucketTime.Format(time.RFC3339)
		if bucket, ok := byTime[key]; ok {
			filled = append(filled, bucket)
			continue
		}
		filled = append(filled, HermesMessageStatsBucket{Time: key, Label: bucketTime.Format("15:04")})
	}
	return filled
}

func truncateHermesMessageHour(value time.Time) time.Time {
	local := value.Local()
	return time.Date(local.Year(), local.Month(), local.Day(), local.Hour(), 0, 0, 0, local.Location())
}

func hermesLocalTimezoneName(value time.Time) string {
	name, offset := value.Local().Zone()
	if name != "" {
		return name
	}
	return time.FixedZone("", offset).String()
}
