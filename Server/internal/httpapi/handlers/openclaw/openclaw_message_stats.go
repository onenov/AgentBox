package openclaw

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	defaultOpenClawMessageStatsHours = 6
	maxOpenClawMessageStatsHours     = 168
)

type OpenClawMessageStatsInput struct {
	AgentID string `query:"agentId" doc:"Agent id to filter by. Use all or leave empty for every agent." example:"main"`
	Hours   int    `query:"hours" doc:"Lookback window in hours." example:"6"`
	Range   string `query:"range" doc:"Range preset: hour, week, month, or all. Week and month are calendar periods in local time." example:"week"`
}

type OpenClawMessageStatsOutput struct {
	Body OpenClawMessageStatsResponse
}

type OpenClawRecentMessagesInput struct {
	AgentID string `query:"agentId" doc:"Agent id to filter by. Use all or leave empty for every agent." example:"main"`
	Limit   int    `query:"limit" doc:"Maximum number of recent messages to return. Maximum is 200." example:"30"`
}

type OpenClawRecentMessagesOutput struct {
	Body OpenClawRecentMessagesResponse
}

type OpenClawMessageStatsResponse struct {
	Status    string                          `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                          `json:"timestamp" example:"2026-05-15T06:00:00Z" doc:"UTC response timestamp."`
	Home      string                          `json:"home" example:"/Users/one/.openclaw" doc:"OpenClaw home directory scanned."`
	AgentID   string                          `json:"agentId" example:"all" doc:"Selected agent id or all."`
	Range     OpenClawMessageStatsRange       `json:"range" doc:"Time range used for aggregation."`
	Total     int                             `json:"total" example:"42" doc:"Total message records in range."`
	Roles     OpenClawMessageRoleCounts       `json:"roles" doc:"Message counts by role."`
	Agents    []OpenClawMessageStatsAgent     `json:"agents" doc:"Per-agent message counts."`
	Buckets   []OpenClawMessageStatsBucket    `json:"buckets" doc:"Hourly message buckets."`
	Scanned   OpenClawMessageStatsScanSummary `json:"scanned" doc:"Best-effort scan summary."`
}

type OpenClawRecentMessagesResponse struct {
	Status    string                     `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                     `json:"timestamp" example:"2026-05-15T06:00:00Z" doc:"UTC response timestamp."`
	Home      string                     `json:"home" example:"/Users/one/.openclaw" doc:"OpenClaw home directory scanned."`
	AgentID   string                     `json:"agentId" example:"all" doc:"Selected agent id or all."`
	Limit     int                        `json:"limit" example:"30" doc:"Requested row limit."`
	Messages  []OpenClawRecentMessage    `json:"messages" doc:"Recent channel user and assistant messages."`
	Scanned   OpenClawMessageScanSummary `json:"scanned" doc:"Best-effort scan summary."`
}

type OpenClawRecentMessage struct {
	ID          string            `json:"id" example:"main:session-id:message-id" doc:"Stable row id."`
	MessageID   string            `json:"messageId,omitempty" doc:"Channel message id when present."`
	SessionID   string            `json:"sessionId" example:"382acb05-7fff-4f57-948e-4411b5002193" doc:"OpenClaw session id."`
	AgentID     string            `json:"agentId" example:"main" doc:"Agent id."`
	Channel     string            `json:"channel,omitempty" example:"openclaw-weixin" doc:"Resolved channel id when available."`
	ChatID      string            `json:"chatId,omitempty" doc:"Channel chat/conversation id when present."`
	Sender      string            `json:"sender,omitempty" doc:"Sender display value when present."`
	SenderID    string            `json:"senderId,omitempty" doc:"Sender id when present."`
	Role        string            `json:"role" example:"user" doc:"Message role."`
	Content     string            `json:"content" doc:"Message body with OpenClaw metadata stripped."`
	Timestamp   string            `json:"timestamp" example:"2026-05-15T06:00:00Z" doc:"Message timestamp in UTC."`
	DisplayTime string            `json:"displayTime,omitempty" doc:"Original channel timestamp from metadata when present."`
	Metadata    map[string]string `json:"metadata,omitempty" doc:"Sanitized string metadata parsed from Conversation info."`
}

type OpenClawMessageScanSummary struct {
	AgentDirs int      `json:"agentDirs" example:"1" doc:"Number of agent directories scanned."`
	Files     int      `json:"files" example:"2" doc:"Number of session JSONL files scanned."`
	Errors    []string `json:"errors,omitempty" doc:"Non-fatal scan errors."`
}

type OpenClawMessageStatsRange struct {
	Hours    int    `json:"hours" example:"6" doc:"Lookback window in hours."`
	Bucket   string `json:"bucket" example:"hour" doc:"Bucket granularity."`
	Preset   string `json:"preset" example:"week" doc:"Selected range preset."`
	Start    string `json:"start" example:"2026-05-15T00:00:00+08:00" doc:"Range start in local timezone."`
	End      string `json:"end" example:"2026-05-15T06:00:00+08:00" doc:"Range end in local timezone."`
	Timezone string `json:"timezone" example:"Asia/Shanghai" doc:"Timezone used for labels and bucket timestamps."`
}

type OpenClawMessageRoleCounts struct {
	User       int `json:"user" example:"12" doc:"User message count."`
	Assistant  int `json:"assistant" example:"18" doc:"Assistant message count."`
	ToolResult int `json:"toolResult" example:"7" doc:"Tool result message count."`
	Other      int `json:"other" example:"5" doc:"Other message count."`
}

type OpenClawMessageStatsAgent struct {
	AgentID string                    `json:"agentId" example:"main" doc:"Agent id."`
	Total   int                       `json:"total" example:"42" doc:"Total messages for this agent."`
	Roles   OpenClawMessageRoleCounts `json:"roles" doc:"Message counts by role for this agent."`
}

type OpenClawMessageStatsBucket struct {
	Time  string                    `json:"time" example:"2026-05-15T06:00:00+08:00" doc:"Bucket start timestamp in local timezone."`
	Label string                    `json:"label" example:"14:00" doc:"Short local label for chart display."`
	Total int                       `json:"total" example:"10" doc:"Total message count in bucket."`
	Roles OpenClawMessageRoleCounts `json:"roles" doc:"Message counts by role in this bucket."`
}

type OpenClawMessageStatsScanSummary struct {
	AgentDirs int      `json:"agentDirs" example:"1" doc:"Number of agent directories scanned."`
	Files     int      `json:"files" example:"2" doc:"Number of session JSONL files scanned."`
	Errors    []string `json:"errors,omitempty" doc:"Non-fatal scan errors."`
}

var (
	openClawConversationInfoPattern      = regexp.MustCompile(`(?s)^Conversation info \(untrusted metadata\):\s*` + "```json\\s*(.*?)\\s*```\\s*(.*)$")
	openClawLeadingMetadataBlockPattern  = regexp.MustCompile(`(?s)^[A-Za-z][A-Za-z0-9 _-]* \(untrusted metadata\):\s*` + "```json\\s*.*?\\s*```\\s*")
	openClawConsecutiveWhitespacePattern = regexp.MustCompile(`\n{3,}`)
	openClawHiddenSystemMessagePattern   = regexp.MustCompile(`(?i)^(?:NO_REPLY|HEARTBEAT_OK|Model\s+(?:set to|reset to default)\b.*)$`)
)

type openClawSessionMessageLine struct {
	Content    string `json:"content"`
	CustomType string `json:"customType"`
	Details    struct {
		Source string `json:"source"`
	} `json:"details"`
	ID        string `json:"id"`
	ParentID  string `json:"parentId"`
	Type      string `json:"type"`
	Timestamp string `json:"timestamp"`
	Message   struct {
		Content json.RawMessage `json:"content"`
		Role    string          `json:"role"`
	} `json:"message"`
}

func OpenClawMessageStats(ctx context.Context, input *OpenClawMessageStatsInput) (*OpenClawMessageStatsOutput, error) {
	if input == nil {
		input = &OpenClawMessageStatsInput{}
	}
	_ = ctx

	ranges := resolveOpenClawMessageStatsRange(input.Range, input.Hours)

	agentID := strings.TrimSpace(input.AgentID)
	if agentID == "" {
		agentID = "all"
	}

	body := collectOpenClawMessageStats(defaultOpenClawHomeDir(), agentID, ranges)
	return &OpenClawMessageStatsOutput{Body: body}, nil
}

func OpenClawRecentMessages(ctx context.Context, input *OpenClawRecentMessagesInput) (*OpenClawRecentMessagesOutput, error) {
	if input == nil {
		input = &OpenClawRecentMessagesInput{}
	}
	_ = ctx

	limit := input.Limit
	if limit <= 0 {
		limit = 30
	}
	if limit > 200 {
		limit = 200
	}

	agentID := strings.TrimSpace(input.AgentID)
	if agentID == "" {
		agentID = "all"
	}

	body := collectOpenClawRecentMessages(defaultOpenClawHomeDir(), agentID, limit)
	return &OpenClawRecentMessagesOutput{Body: body}, nil
}

func collectOpenClawRecentMessages(home string, agentID string, limit int) OpenClawRecentMessagesResponse {
	scanned := OpenClawMessageScanSummary{}
	agentDirs := openClawMessageStatsAgentDirs(filepath.Join(home, "agents"), agentID)
	scanned.AgentDirs = len(agentDirs)
	messages := []OpenClawRecentMessage{}

	for _, agentDir := range agentDirs {
		scanOpenClawRecentAgentMessages(agentDir.id, agentDir.sessionsDir, &messages, &scanned)
	}

	sort.Slice(messages, func(i, j int) bool {
		return messages[i].Timestamp > messages[j].Timestamp
	})
	if len(messages) > limit {
		messages = messages[:limit]
	}

	return OpenClawRecentMessagesResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Home:      home,
		AgentID:   agentID,
		Limit:     limit,
		Messages:  messages,
		Scanned:   scanned,
	}
}

type openClawMessageStatsRange struct {
	hours  int
	preset string
	start  time.Time
	end    time.Time
}

func resolveOpenClawMessageStatsRange(preset string, hours int) openClawMessageStatsRange {
	now := time.Now().Local()
	normalized := strings.ToLower(strings.TrimSpace(preset))

	switch normalized {
	case "week", "this-week", "this_week":
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7
		}
		start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, -(weekday - 1))
		return openClawMessageStatsRange{preset: "week", start: start, end: now}
	case "month", "this-month", "this_month":
		start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
		return openClawMessageStatsRange{preset: "month", start: start, end: now}
	case "all":
		return openClawMessageStatsRange{preset: "all", end: now}
	default:
		if hours <= 0 {
			hours = defaultOpenClawMessageStatsHours
		}
		if hours > maxOpenClawMessageStatsHours {
			hours = maxOpenClawMessageStatsHours
		}
		return openClawMessageStatsRange{
			hours:  hours,
			preset: "hour",
			start:  now.Add(-time.Duration(hours) * time.Hour),
			end:    now,
		}
	}
}

func collectOpenClawMessageStats(home string, agentID string, ranges openClawMessageStatsRange) OpenClawMessageStatsResponse {
	now := ranges.end
	endBucket := truncateToHour(now)
	start := ranges.start
	buckets := []OpenClawMessageStatsBucket{}
	bucketIndex := map[string]int{}

	if !start.IsZero() {
		startBucket := truncateToHour(start)
		bucketCapacity := int(endBucket.Sub(startBucket)/time.Hour) + 1
		if bucketCapacity < 1 {
			bucketCapacity = 1
		}
		buckets = make([]OpenClawMessageStatsBucket, 0, bucketCapacity)
		bucketIndex = make(map[string]int, bucketCapacity)

		for bucketTime := startBucket; !bucketTime.After(endBucket); bucketTime = bucketTime.Add(time.Hour) {
			addOpenClawMessageBucket(bucketTime, &buckets, bucketIndex)
		}
	}

	agents := map[string]*OpenClawMessageStatsAgent{}
	totalRoles := OpenClawMessageRoleCounts{}
	scanned := OpenClawMessageStatsScanSummary{}
	agentDirs := openClawMessageStatsAgentDirs(filepath.Join(home, "agents"), agentID)
	scanned.AgentDirs = len(agentDirs)

	for _, agentDir := range agentDirs {
		scanOpenClawAgentMessages(agentDir.id, agentDir.sessionsDir, ranges.start, &totalRoles, agents, &buckets, bucketIndex, &scanned)
	}

	agentRows := make([]OpenClawMessageStatsAgent, 0, len(agents))
	for _, agent := range agents {
		agentRows = append(agentRows, *agent)
	}
	sort.Slice(agentRows, func(i, j int) bool {
		if agentRows[i].Total == agentRows[j].Total {
			return agentRows[i].AgentID < agentRows[j].AgentID
		}
		return agentRows[i].Total > agentRows[j].Total
	})
	buckets = fillOpenClawMessageBucketGaps(buckets, endBucket)
	if start.IsZero() && len(buckets) > 0 {
		if parsed, err := time.Parse(time.RFC3339, buckets[0].Time); err == nil {
			start = parsed
		}
	}
	if start.IsZero() {
		start = endBucket
	}

	return OpenClawMessageStatsResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Home:      home,
		AgentID:   agentID,
		Range: OpenClawMessageStatsRange{
			Hours:    ranges.hours,
			Bucket:   "hour",
			Preset:   ranges.preset,
			Start:    start.Format(time.RFC3339),
			End:      now.Format(time.RFC3339),
			Timezone: localTimezoneName(now),
		},
		Total:   totalRoles.total(),
		Roles:   totalRoles,
		Agents:  agentRows,
		Buckets: buckets,
		Scanned: scanned,
	}
}

type openClawMessageStatsAgentDir struct {
	id          string
	sessionsDir string
}

func openClawMessageStatsAgentDirs(agentsRoot string, agentID string) []openClawMessageStatsAgentDir {
	if agentID != "" && agentID != "all" {
		return []openClawMessageStatsAgentDir{{
			id:          filepath.Base(agentID),
			sessionsDir: filepath.Join(agentsRoot, filepath.Base(agentID), "sessions"),
		}}
	}

	entries, err := os.ReadDir(agentsRoot)
	if err != nil {
		return nil
	}

	dirs := make([]openClawMessageStatsAgentDir, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		dirs = append(dirs, openClawMessageStatsAgentDir{
			id:          entry.Name(),
			sessionsDir: filepath.Join(agentsRoot, entry.Name(), "sessions"),
		})
	}
	sort.Slice(dirs, func(i, j int) bool {
		return dirs[i].id < dirs[j].id
	})
	return dirs
}

func scanOpenClawAgentMessages(
	agentID string,
	sessionsDir string,
	start time.Time,
	totalRoles *OpenClawMessageRoleCounts,
	agents map[string]*OpenClawMessageStatsAgent,
	buckets *[]OpenClawMessageStatsBucket,
	bucketIndex map[string]int,
	scanned *OpenClawMessageStatsScanSummary,
) {
	entries, err := os.ReadDir(sessionsDir)
	if err != nil {
		scanned.Errors = append(scanned.Errors, agentID+": "+err.Error())
		return
	}

	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || strings.HasPrefix(name, ".") || !strings.HasSuffix(name, ".jsonl") || strings.Contains(name, ".trajectory") {
			continue
		}
		scanned.Files++
		scanOpenClawMessageFile(filepath.Join(sessionsDir, name), agentID, start, totalRoles, agents, buckets, bucketIndex, scanned)
	}
}

func scanOpenClawRecentAgentMessages(agentID string, sessionsDir string, messages *[]OpenClawRecentMessage, scanned *OpenClawMessageScanSummary) {
	entries, err := os.ReadDir(sessionsDir)
	if err != nil {
		scanned.Errors = append(scanned.Errors, agentID+": "+err.Error())
		return
	}

	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || strings.HasPrefix(name, ".") || !strings.HasSuffix(name, ".jsonl") || strings.Contains(name, ".trajectory") {
			continue
		}
		scanned.Files++
		scanOpenClawRecentMessageFile(filepath.Join(sessionsDir, name), agentID, messages, scanned)
	}
}

func scanOpenClawMessageFile(
	path string,
	agentID string,
	start time.Time,
	totalRoles *OpenClawMessageRoleCounts,
	agents map[string]*OpenClawMessageStatsAgent,
	buckets *[]OpenClawMessageStatsBucket,
	bucketIndex map[string]int,
	scanned *OpenClawMessageStatsScanSummary,
) {
	file, err := os.Open(path)
	if err != nil {
		scanned.Errors = append(scanned.Errors, filepath.Base(path)+": "+err.Error())
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	heartbeatRuntimeContextIDs := map[string]bool{}
	heartbeatToolCallIDs := map[string]bool{}
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var record openClawSessionMessageLine
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			continue
		}
		if record.Type == "custom_message" {
			if isOpenClawHeartbeatRuntimeContext(record) {
				heartbeatRuntimeContextIDs[record.ID] = true
			}
			continue
		}
		if record.Type != "message" {
			continue
		}
		if isOpenClawHeartbeatMessage(record, heartbeatRuntimeContextIDs, heartbeatToolCallIDs) {
			continue
		}
		content, _ := parseOpenClawConversationInfo(openClawMessageText(record.Message.Content))
		if isOpenClawHiddenMessageContent(content) {
			continue
		}
		timestamp, err := time.Parse(time.RFC3339Nano, record.Timestamp)
		if err != nil || (!start.IsZero() && timestamp.Before(start)) || timestamp.After(time.Now().Add(time.Minute)) {
			continue
		}

		role := normalizeOpenClawMessageRole(record.Message.Role)
		incrementOpenClawMessageCounts(totalRoles, role)

		agent := agents[agentID]
		if agent == nil {
			agent = &OpenClawMessageStatsAgent{AgentID: agentID}
			agents[agentID] = agent
		}
		agent.Total++
		incrementOpenClawMessageCounts(&agent.Roles, role)

		bucketTime := truncateToHour(timestamp.Local())
		index := addOpenClawMessageBucket(bucketTime, buckets, bucketIndex)
		(*buckets)[index].Total++
		incrementOpenClawMessageCounts(&(*buckets)[index].Roles, role)
	}

	if err := scanner.Err(); err != nil {
		scanned.Errors = append(scanned.Errors, filepath.Base(path)+": "+err.Error())
	}
}

func scanOpenClawRecentMessageFile(path string, agentID string, messages *[]OpenClawRecentMessage, scanned *OpenClawMessageScanSummary) {
	file, err := os.Open(path)
	if err != nil {
		scanned.Errors = append(scanned.Errors, filepath.Base(path)+": "+err.Error())
		return
	}
	defer file.Close()

	sessionID := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	heartbeatRuntimeContextIDs := map[string]bool{}
	heartbeatToolCallIDs := map[string]bool{}
	lastConversationMetadata := map[string]string{}
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var record openClawSessionMessageLine
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			continue
		}
		if record.Type == "custom_message" {
			if isOpenClawHeartbeatRuntimeContext(record) {
				heartbeatRuntimeContextIDs[record.ID] = true
			}
			continue
		}
		if record.Type != "message" {
			continue
		}
		if isOpenClawHeartbeatMessage(record, heartbeatRuntimeContextIDs, heartbeatToolCallIDs) {
			continue
		}
		role := normalizeOpenClawMessageRole(record.Message.Role)
		if role != "user" && role != "assistant" {
			continue
		}

		timestamp, err := time.Parse(time.RFC3339Nano, record.Timestamp)
		if err != nil {
			continue
		}
		content, metadata := parseOpenClawConversationInfo(openClawMessageText(record.Message.Content))
		if isOpenClawHiddenMessageContent(content) {
			continue
		}
		if role == "user" && len(metadata) == 0 {
			continue
		}
		if role == "user" {
			lastConversationMetadata = cloneOpenClawStringMap(metadata)
		}
		if role == "assistant" && len(metadata) == 0 {
			if len(lastConversationMetadata) == 0 {
				continue
			}
			metadata = cloneOpenClawStringMap(lastConversationMetadata)
		}

		messageID := metadata["message_id"]
		chatID := metadata["chat_id"]
		*messages = append(*messages, OpenClawRecentMessage{
			ID:          agentID + ":" + sessionID + ":" + record.ID,
			MessageID:   messageID,
			SessionID:   sessionID,
			AgentID:     agentID,
			Channel:     resolveOpenClawMessageChannel(metadata),
			ChatID:      chatID,
			Sender:      recentOpenClawMessageSender(role, metadata),
			SenderID:    firstNonEmpty(metadata["sender_id"], metadata["user_id"]),
			Role:        role,
			Content:     strings.TrimSpace(content),
			Timestamp:   timestamp.UTC().Format(time.RFC3339),
			DisplayTime: metadata["timestamp"],
			Metadata:    metadata,
		})
	}

	if err := scanner.Err(); err != nil {
		scanned.Errors = append(scanned.Errors, filepath.Base(path)+": "+err.Error())
	}
}

func isOpenClawHiddenMessageContent(content string) bool {
	trimmed := strings.TrimSpace(content)
	return trimmed == "" || openClawHiddenSystemMessagePattern.MatchString(trimmed)
}

func recentOpenClawMessageSender(role string, metadata map[string]string) string {
	if role == "assistant" {
		return "OpenClaw"
	}
	return firstNonEmpty(metadata["sender"], metadata["sender_name"], metadata["from"])
}

func cloneOpenClawStringMap(source map[string]string) map[string]string {
	if len(source) == 0 {
		return nil
	}
	cloned := make(map[string]string, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}

func isOpenClawHeartbeatRuntimeContext(record openClawSessionMessageLine) bool {
	if record.CustomType != "openclaw.runtime-context" && record.Details.Source != "openclaw-runtime-context" {
		return false
	}
	content := strings.TrimSpace(record.Content)
	return strings.Contains(content, "HEARTBEAT_OK") && strings.Contains(content, "HEARTBEAT.md")
}

func isOpenClawHeartbeatMessage(record openClawSessionMessageLine, runtimeContextIDs map[string]bool, toolCallIDs map[string]bool) bool {
	role := normalizeOpenClawMessageRole(record.Message.Role)
	text := strings.TrimSpace(openClawMessageText(record.Message.Content))

	if role == "user" && text == "[OpenClaw heartbeat poll]" {
		return true
	}
	if role == "assistant" && text == "HEARTBEAT_OK" {
		return true
	}
	if role == "assistant" && runtimeContextIDs[record.ParentID] && openClawMessageHasOnlyToolCalls(record.Message.Content) {
		toolCallIDs[record.ID] = true
		return true
	}
	if role == "toolResult" && toolCallIDs[record.ParentID] {
		return true
	}
	return false
}

func openClawMessageText(content json.RawMessage) string {
	if len(content) == 0 {
		return ""
	}

	var plain string
	if err := json.Unmarshal(content, &plain); err == nil {
		return plain
	}

	var parts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(content, &parts); err != nil {
		return ""
	}

	texts := make([]string, 0, len(parts))
	for _, part := range parts {
		if part.Type != "" && part.Type != "text" {
			continue
		}
		if strings.TrimSpace(part.Text) == "" {
			continue
		}
		texts = append(texts, part.Text)
	}
	return strings.Join(texts, "\n")
}

func openClawMessageHasOnlyToolCalls(content json.RawMessage) bool {
	if len(content) == 0 {
		return false
	}

	var parts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(content, &parts); err != nil || len(parts) == 0 {
		return false
	}

	hasToolCall := false
	for _, part := range parts {
		switch part.Type {
		case "toolCall":
			hasToolCall = true
		case "thinking":
			continue
		case "text", "":
			if strings.TrimSpace(part.Text) != "" {
				return false
			}
		default:
			return false
		}
	}
	return hasToolCall
}

func parseOpenClawConversationInfo(text string) (string, map[string]string) {
	trimmed := strings.TrimSpace(text)
	matches := openClawConversationInfoPattern.FindStringSubmatch(trimmed)
	if len(matches) != 3 {
		return cleanOpenClawMessageContent(trimmed), nil
	}

	metadata := map[string]string{}
	var raw map[string]any
	if err := json.Unmarshal([]byte(matches[1]), &raw); err == nil {
		for key, value := range raw {
			switch typed := value.(type) {
			case string:
				if strings.TrimSpace(typed) != "" {
					metadata[key] = strings.TrimSpace(typed)
				}
			case float64, bool:
				metadata[key] = strings.TrimSpace(strings.Trim(strings.ReplaceAll(strings.TrimSpace(toJSONScalar(typed)), "\"", ""), "\n"))
			}
		}
	}
	return cleanOpenClawMessageContent(matches[2]), metadata
}

func cleanOpenClawMessageContent(text string) string {
	cleaned := strings.TrimSpace(text)
	for {
		next := strings.TrimSpace(openClawLeadingMetadataBlockPattern.ReplaceAllString(cleaned, ""))
		if next == cleaned {
			break
		}
		cleaned = next
	}
	return strings.TrimSpace(openClawConsecutiveWhitespacePattern.ReplaceAllString(cleaned, "\n\n"))
}

func toJSONScalar(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(data)
}

func resolveOpenClawMessageChannel(metadata map[string]string) string {
	if len(metadata) == 0 {
		return ""
	}
	if channel := strings.TrimSpace(metadata["channel"]); channel != "" {
		return channel
	}
	if messageID := strings.TrimSpace(metadata["message_id"]); strings.Contains(messageID, ":") {
		prefix := strings.TrimSpace(strings.SplitN(messageID, ":", 2)[0])
		if strings.HasPrefix(prefix, "openclaw-") {
			return prefix
		}
	}
	if chatID := strings.TrimSpace(metadata["chat_id"]); strings.Contains(chatID, ":") {
		return strings.TrimSpace(strings.SplitN(chatID, ":", 2)[0])
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func addOpenClawMessageBucket(bucketTime time.Time, buckets *[]OpenClawMessageStatsBucket, bucketIndex map[string]int) int {
	key := bucketTime.Format(time.RFC3339)
	if index, ok := bucketIndex[key]; ok {
		return index
	}
	index := len(*buckets)
	bucketIndex[key] = index
	*buckets = append(*buckets, OpenClawMessageStatsBucket{
		Time:  key,
		Label: bucketTime.Format("15:04"),
	})
	return index
}

func fillOpenClawMessageBucketGaps(buckets []OpenClawMessageStatsBucket, endBucket time.Time) []OpenClawMessageStatsBucket {
	if len(buckets) == 0 {
		return buckets
	}

	sort.Slice(buckets, func(i, j int) bool {
		return buckets[i].Time < buckets[j].Time
	})
	first, err := time.Parse(time.RFC3339, buckets[0].Time)
	if err != nil {
		return buckets
	}

	byTime := make(map[string]OpenClawMessageStatsBucket, len(buckets))
	for _, bucket := range buckets {
		byTime[bucket.Time] = bucket
	}

	filled := make([]OpenClawMessageStatsBucket, 0, int(endBucket.Sub(first)/time.Hour)+1)
	for bucketTime := first; !bucketTime.After(endBucket); bucketTime = bucketTime.Add(time.Hour) {
		key := bucketTime.Format(time.RFC3339)
		if bucket, ok := byTime[key]; ok {
			filled = append(filled, bucket)
			continue
		}
		filled = append(filled, OpenClawMessageStatsBucket{
			Time:  key,
			Label: bucketTime.Format("15:04"),
		})
	}
	return filled
}

func normalizeOpenClawMessageRole(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "user":
		return "user"
	case "assistant":
		return "assistant"
	case "toolresult", "tool_result", "tool-result":
		return "toolResult"
	default:
		return "other"
	}
}

func incrementOpenClawMessageCounts(counts *OpenClawMessageRoleCounts, role string) {
	switch role {
	case "user":
		counts.User++
	case "assistant":
		counts.Assistant++
	case "toolResult":
		counts.ToolResult++
	default:
		counts.Other++
	}
}

func (counts OpenClawMessageRoleCounts) total() int {
	return counts.User + counts.Assistant + counts.ToolResult + counts.Other
}

func truncateToHour(value time.Time) time.Time {
	local := value.Local()
	return time.Date(local.Year(), local.Month(), local.Day(), local.Hour(), 0, 0, 0, local.Location())
}

func localTimezoneName(value time.Time) string {
	name, offset := value.Local().Zone()
	if name != "" {
		return name
	}
	return time.FixedZone("", offset).String()
}
