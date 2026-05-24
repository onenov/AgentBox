//go:build !windows

package hermes

import (
	"os/exec"
	"syscall"
)

func setHermesGatewayCommandAttrs(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}
