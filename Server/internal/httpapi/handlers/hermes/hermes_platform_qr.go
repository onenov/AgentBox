package hermes

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"agent-box-server/internal/httpapi/toolenv"

	"github.com/danielgtaylor/huma/v2/sse"
)

type HermesPlatformQRSetupStreamInput struct {
	Name    string `path:"name" doc:"Hermes platform name." example:"feishu"`
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
}

type hermesPlatformQRDefinition struct {
	name        string
	label       string
	timeout     time.Duration
	pythonSetup string
}

var hermesPlatformQRDefinitions = map[string]hermesPlatformQRDefinition{
	"weixin": {
		name:    "weixin",
		label:   "Weixin",
		timeout: 10 * time.Minute,
		pythonSetup: `
import asyncio
from hermes_cli.config import get_env_value, save_env_value
from gateway.platforms.weixin import check_weixin_requirements, qr_login

if not check_weixin_requirements():
    raise SystemExit("Weixin needs aiohttp and cryptography. Install hermes-agent[messaging] first.")

credentials = asyncio.run(qr_login(__import__("os").environ["HERMES_HOME"]))
if not credentials:
    raise SystemExit("Weixin QR login did not complete.")

save_env_value("WEIXIN_ACCOUNT_ID", credentials.get("account_id", ""))
save_env_value("WEIXIN_TOKEN", credentials.get("token", ""))
if credentials.get("base_url"):
    save_env_value("WEIXIN_BASE_URL", credentials.get("base_url", ""))
save_env_value("WEIXIN_CDN_BASE_URL", get_env_value("WEIXIN_CDN_BASE_URL") or "https://novac2c.cdn.weixin.qq.com/c2c")
save_env_value("WEIXIN_DM_POLICY", get_env_value("WEIXIN_DM_POLICY") or "pairing")
save_env_value("WEIXIN_ALLOW_ALL_USERS", get_env_value("WEIXIN_ALLOW_ALL_USERS") or "false")
save_env_value("WEIXIN_GROUP_POLICY", get_env_value("WEIXIN_GROUP_POLICY") or "disabled")
if credentials.get("user_id") and not get_env_value("WEIXIN_HOME_CHANNEL"):
    save_env_value("WEIXIN_HOME_CHANNEL", credentials.get("user_id", ""))
print("Weixin QR login saved.")
`,
	},
	"feishu": {
		name:    "feishu",
		label:   "Feishu",
		timeout: 10 * time.Minute,
		pythonSetup: `
from hermes_cli.config import save_env_value
from gateway.platforms import feishu as feishu_onboard

domain = "feishu"
print("  Connecting to Feishu / Lark...", end="", flush=True)
feishu_onboard._init_registration(domain)
begin = feishu_onboard._begin_registration(domain)
print(" done.")
qr_url = begin["qr_url"]
print("  Open this URL in Feishu / Lark on your phone:")
print("  " + qr_url)
credentials = feishu_onboard._poll_registration(
    device_code=begin["device_code"],
    interval=begin["interval"],
    expire_in=min(begin["expire_in"], 600),
    domain=domain,
)
if not credentials:
    raise SystemExit("Feishu / Lark QR setup did not complete.")
bot_info = feishu_onboard.probe_bot(credentials["app_id"], credentials["app_secret"], credentials["domain"])
if bot_info:
    credentials["bot_name"] = bot_info.get("bot_name")
    credentials["bot_open_id"] = bot_info.get("bot_open_id")

save_env_value("FEISHU_APP_ID", credentials.get("app_id", ""))
save_env_value("FEISHU_APP_SECRET", credentials.get("app_secret", ""))
save_env_value("FEISHU_DOMAIN", credentials.get("domain", "feishu"))
save_env_value("FEISHU_CONNECTION_MODE", "websocket")
save_env_value("FEISHU_ALLOW_ALL_USERS", "false")
save_env_value("FEISHU_ALLOWED_USERS", "")
save_env_value("FEISHU_GROUP_POLICY", "open")
if credentials.get("bot_name"):
    print("Bot created: " + str(credentials.get("bot_name")))
print("Feishu / Lark QR setup saved.")
`,
	},
	"dingtalk": {
		name:    "dingtalk",
		label:   "DingTalk",
		timeout: 2 * time.Hour,
		pythonSetup: `
from hermes_cli.config import save_env_value
from hermes_cli.dingtalk_auth import dingtalk_qr_auth

result = dingtalk_qr_auth()
if not result:
    raise SystemExit("DingTalk QR authorization did not complete.")

client_id, client_secret = result
save_env_value("DINGTALK_CLIENT_ID", client_id)
save_env_value("DINGTALK_CLIENT_SECRET", client_secret)
save_env_value("DINGTALK_ALLOW_ALL_USERS", "true")
print("DingTalk QR authorization saved.")
`,
	},
	"wecom": {
		name:    "wecom",
		label:   "WeCom",
		timeout: 6 * time.Minute,
		pythonSetup: `
from hermes_cli.config import get_env_value, save_env_value
from gateway.platforms.wecom import qr_scan_for_bot_info

credentials = qr_scan_for_bot_info()
if not credentials:
    raise SystemExit("WeCom QR setup did not complete.")

save_env_value("WECOM_BOT_ID", credentials.get("bot_id", ""))
save_env_value("WECOM_SECRET", credentials.get("secret", ""))
save_env_value("WECOM_DM_POLICY", get_env_value("WECOM_DM_POLICY") or "pairing")
print("WeCom QR setup saved.")
`,
	},
	"qqbot": {
		name:    "qqbot",
		label:   "QQBot",
		timeout: 10 * time.Minute,
		pythonSetup: `
from hermes_cli.config import save_env_value
from gateway.platforms.qqbot import qr_register

credentials = qr_register()
if not credentials:
    raise SystemExit("QQBot QR setup did not complete.")

save_env_value("QQ_APP_ID", credentials.get("app_id", ""))
save_env_value("QQ_CLIENT_SECRET", credentials.get("client_secret", ""))
save_env_value("QQ_ALLOW_ALL_USERS", "false")
if credentials.get("user_openid"):
    save_env_value("QQ_ALLOWED_USERS", credentials.get("user_openid", ""))
else:
    save_env_value("QQ_ALLOWED_USERS", "")
print("QQBot QR setup saved.")
`,
	},
	"whatsapp": {
		name:    "whatsapp",
		label:   "WhatsApp",
		timeout: 10 * time.Minute,
	},
}

func SetupHermesPlatformQRStream(ctx context.Context, input *HermesPlatformQRSetupStreamInput, send sse.Sender) {
	if input == nil {
		streamHermesTaskError(send, "hermes-platform-qr", "qr-setup", fmt.Errorf("Hermes platform QR setup input is required"))
		return
	}
	name := strings.ToLower(strings.TrimSpace(input.Name))
	def, ok := hermesPlatformQRDefinitions[name]
	if !ok {
		streamHermesTaskError(send, "hermes-platform-qr", "qr-setup", fmt.Errorf("Hermes platform %q does not support QR setup", input.Name))
		return
	}
	profile, err := resolveHermesProfileSelection(input.Profile)
	if err != nil {
		streamHermesTaskError(send, "hermes-"+name+"-qr", "qr-setup", err)
		return
	}

	streamHermesTaskSteps(ctx, send, "hermes-"+name+"-qr", "qr-setup", []hermesTaskStep{
		{label: "检查 Hermes Profile", progress: 5, run: func(context.Context, hermesTaskLogger) error {
			return ensureHermesProfileDir(profile.Path)
		}},
		{label: "执行 " + def.label + " 扫码配置", progress: 25, timeout: def.timeout, run: func(ctx context.Context, task hermesTaskLogger) error {
			if name == "whatsapp" {
				return runHermesWhatsAppQRSetup(ctx, profile, task)
			}
			return runHermesPlatformPythonQRSetup(ctx, profile, def, task)
		}},
		{label: "重启 Hermes Gateway 应用配置", progress: 92, timeout: 60 * time.Second, run: func(ctx context.Context, task hermesTaskLogger) error {
			path := toolenv.ResolveToolPath("hermes")
			if path == "" {
				if resolved, lookupErr := exec.LookPath("hermes"); lookupErr == nil {
					path = resolved
				}
			}
			if path == "" {
				task.addLog("hermes CLI 不可用，请稍后手动重启 Gateway。")
				return nil
			}
			_, err := runHermesGatewayRestartAndWait(ctx, path, profile, 60*time.Second, task.addLog)
			if err != nil {
				task.addLog("Gateway 重启未完成，请稍后手动重启：" + err.Error())
				return nil
			}
			return nil
		}},
	})
}

func runHermesPlatformPythonQRSetup(ctx context.Context, profile HermesProfileSelection, def hermesPlatformQRDefinition, task hermesTaskLogger) error {
	task.addLog("使用 Hermes 内置 " + def.label + " QR setup flow。")
	return runHermesPythonStreamingCommandForProfile(ctx, def.timeout, profile, task.addLog, def.pythonSetup)
}

func runHermesWhatsAppQRSetup(ctx context.Context, profile HermesProfileSelection, task hermesTaskLogger) error {
	if err := updateHermesProfileEnvValues(profile, map[string]string{
		"WHATSAPP_ENABLED": "true",
		"WHATSAPP_MODE":    "self-chat",
	}); err != nil {
		return err
	}

	project := hermesProjectPath(ctx)
	bridgeDir := filepath.Join(project, "scripts", "whatsapp-bridge")
	bridgeScript := filepath.Join(bridgeDir, "bridge.js")
	if !pathExists(bridgeScript) {
		return fmt.Errorf("WhatsApp bridge script not found: %s", bridgeScript)
	}
	if !pathExists(filepath.Join(bridgeDir, "node_modules")) {
		task.addLog("安装 WhatsApp bridge 依赖。")
		if err := runHermesStreamingCommand(ctx, 5*time.Minute, bridgeDir, hermesCommandEnvForProfile(profile), task.addLog, "npm", "install", "--no-fund", "--no-audit", "--progress=false"); err != nil {
			return err
		}
	}

	sessionDir := filepath.Join(profile.Path, "whatsapp", "session")
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		return err
	}
	task.addLog("等待 WhatsApp 配对授权完成。")
	return runHermesStreamingCommand(ctx, 10*time.Minute, bridgeDir, hermesCommandEnvForProfile(profile), task.addLog, "node", bridgeScript, "--pair-only", "--session", sessionDir)
}

func runHermesPythonStreamingCommandForProfile(ctx context.Context, timeout time.Duration, profile HermesProfileSelection, writeOutput func(string), script string, args ...string) error {
	project := hermesProjectPath(ctx)
	python := filepath.Join(project, "venv", "bin", "python")
	if !pathExists(python) {
		python = filepath.Join(project, "venv", "bin", "python3")
	}
	if !pathExists(python) {
		python = toolenv.ResolveToolPath("python3")
	}
	if python == "" {
		python = "python3"
	}
	commandArgs := append([]string{"-u", "-c", "import sys; sys.path.insert(0, " + pythonStringLiteral(project) + ");\n" + script}, args...)
	return runHermesStreamingCommand(ctx, timeout, project, hermesCommandEnvForProfile(profile), writeOutput, python, commandArgs...)
}

func runHermesStreamingCommand(ctx context.Context, timeout time.Duration, cwd string, env []string, writeOutput func(string), name string, args ...string) error {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	path := toolenv.ResolveToolPath(name)
	if path == "" {
		if resolved, err := exec.LookPath(name); err == nil {
			path = resolved
		}
	}
	if path == "" {
		path = name
	}
	cmd := exec.CommandContext(cmdCtx, path, args...)
	if strings.TrimSpace(cwd) != "" {
		cmd.Dir = cwd
	}
	cmd.Env = append(env, "CI=1", "NO_COLOR=1", "PYTHONUNBUFFERED=1", "TERM=dumb")
	cmd.Stdout = hermesTaskWriter{write: writeOutput}
	cmd.Stderr = hermesTaskWriter{write: writeOutput}
	err := cmd.Run()
	if cmdCtx.Err() != nil {
		return cmdCtx.Err()
	}
	return err
}

func updateHermesProfileEnvValues(profile HermesProfileSelection, updates map[string]string) error {
	envPath := filepath.Join(profile.Path, ".env")
	content, err := os.ReadFile(envPath)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	current := parseHermesEnvKeyValues(string(content))
	clean := map[string]string{}
	for key, value := range updates {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key == "" || value == "" {
			continue
		}
		if strings.TrimSpace(current[key]) != "" {
			continue
		}
		clean[key] = value
	}
	if len(clean) == 0 {
		return nil
	}
	next := upsertHermesEnvContent(string(content), clean)
	if err := os.MkdirAll(filepath.Dir(envPath), 0o755); err != nil {
		return err
	}
	return os.WriteFile(envPath, []byte(next), 0o600)
}

func streamHermesTaskError(send sse.Sender, prefix string, kind string, err error) {
	id := prefix + "-" + time.Now().UTC().Format("20060102-150405")
	run := hermesTaskStreamRun{id: id, kind: kind, send: send}
	if !run.emitMeta() {
		return
	}
	run.fail(err)
}
