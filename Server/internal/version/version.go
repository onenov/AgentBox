package version

import (
	"os"
	"strings"
)

// Version is injected by release build scripts. Development runs keep the safe fallback.
var Version = "dev"

func Current() string {
	if value := strings.TrimSpace(os.Getenv("AGENTBOX_VERSION")); value != "" {
		return value
	}
	if value := strings.TrimSpace(Version); value != "" {
		return value
	}
	return "dev"
}
