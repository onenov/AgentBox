//go:build windows

package hermes

import (
	"os/exec"
	"syscall"
)

const createNewProcessGroup = 0x00000200

func setHermesGatewayCommandAttrs(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNewProcessGroup}
}
