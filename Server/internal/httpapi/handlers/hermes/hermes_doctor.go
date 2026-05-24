package hermes

import (
	"context"
	"fmt"
	"strings"
	"time"

	"agent-box-server/internal/httpapi/toolenv"

	"github.com/danielgtaylor/huma/v2/sse"
)

type HermesDoctorStreamInput struct {
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile from ~/.hermes/active_profile." example:"default"`
}

func DoctorHermesStream(ctx context.Context, input *HermesDoctorStreamInput, send sse.Sender) {
	profileName := ""
	if input != nil {
		profileName = input.Profile
	}
	profile, err := resolveHermesProfileSelection(profileName)
	if err != nil {
		streamHermesTaskError(send, "hermes-doctor", "doctor", err)
		return
	}

	streamHermesTaskSteps(ctx, send, "hermes-doctor", "doctor", []hermesTaskStep{
		{
			label:    "执行 Hermes Doctor",
			progress: 10,
			timeout:  3 * time.Minute,
			run: func(ctx context.Context, task hermesTaskLogger) error {
				return runHermesDoctorCommand(ctx, profile, task)
			},
		},
	})
}

func runHermesDoctorCommand(ctx context.Context, profile HermesProfileSelection, task hermesTaskLogger) error {
	path := toolenv.ResolveToolPath("hermes")
	if path == "" {
		return fmt.Errorf("hermes CLI not found")
	}

	args := []string{"doctor"}
	if profile.Name != "default" {
		args = append([]string{"-p", profile.Name}, args...)
	}
	task.addLog("执行 " + strings.Join(append([]string{path}, args...), " "))
	return runHermesStreamingCommand(ctx, 3*time.Minute, "", hermesCommandEnvForProfile(profile), task.addLog, path, args...)
}
