# AgentBox 非 Docker 安装

这个目录提供 AgentBox 的非 Docker 安装脚本。Linux 会安装为 systemd 服务，并配置定时自更新；macOS 和 Windows 会从发布清单下载对应的桌面安装包。

## 一键安装

Linux 服务器推荐直接执行：

```sh
curl -fsSL https://agent.orence.net/install.sh | sh
```

如果当前用户不是 root，可以使用：

```sh
curl -fsSL https://agent.orence.net/install.sh | sudo sh
```

脚本默认会：

- 从 `https://agent.orence.net/releases/latest.json` 获取最新版本。
- 下载 `downloads.linux.x64` 或 `downloads.linux.arm64` 对应的后端二进制。
- 校验 `sha256`。
- 安装到 `/opt/agentbox/bin/agentbox`。
- 创建 systemd 服务 `agentbox.service`，默认以 root 用户运行。
- 创建自更新定时器 `agentbox-updater.timer`。
- 自动生成访问 token。
- 输出本机、内网、公网访问链接。

## 访问地址

安装完成后，脚本会输出类似：

```text
AgentBox 访问地址
------------------------------------------------------------
  本机：http://127.0.0.1:8787/login?token=...&persistence=persistent
  内网：http://10.0.0.1:8787/login?token=...&persistence=persistent
  公网：http://1.2.3.4:8787/login?token=...&persistence=persistent
```

其中：

- `本机` 适合在服务器本机访问。
- `内网` 是服务器局域网地址。
- `公网` 会尝试自动检测公网 IP。

如果服务器有域名或反代地址，建议安装时传入：

```sh
curl -fsSL https://agent.orence.net/install.sh | sh -s -- --public-url https://agentbox.example.com
```

这样输出的公网登录地址会使用你的域名。

## Token

如果没有传入 token，脚本会自动生成一个随机 token，并写入：

```text
/opt/agentbox/data/agentbox/auth.json
```

也会写入 systemd 环境文件：

```text
/etc/agentbox/agentbox.env
```

如果要固定 token：

```sh
curl -fsSL https://agent.orence.net/install.sh | sh -s -- --token "your-secret-token"
```

也可以用环境变量：

```sh
curl -fsSL https://agent.orence.net/install.sh | AGENTBOX_AUTH_TOKEN="your-secret-token" sh
```

重复执行安装脚本时，如果已有 token，默认会复用旧 token，不会每次重置。

## 服务管理

查看脚本帮助：

```sh
curl -fsSL https://agent.orence.net/install.sh | sh -s -- --help
```

查看 AgentBox 安装状态、服务状态、自动更新、访问地址和 Node 环境：

```sh
curl -fsSL https://agent.orence.net/install.sh | sh -s -- --cat
```

查看服务状态：

```sh
systemctl status agentbox
```

查看日志：

```sh
journalctl -u agentbox -f
```

重启服务：

```sh
systemctl restart agentbox
```

默认监听：

```text
0.0.0.0:8787
```

可以安装时指定端口：

```sh
curl -fsSL https://agent.orence.net/install.sh | sh -s -- --port 8788
```

## 覆盖安装和重启

如果需要同版本也重新下载安装，可以使用 `--force`：

```sh
curl -fsSL https://agent.orence.net/install.sh | sh -s -- --force
```

默认安装、更新或覆盖安装完成后会自动重启 `agentbox.service`。

如果想显式指定自动重启：

```sh
curl -fsSL https://agent.orence.net/install.sh | sh -s -- --force --restart
```

如果只想覆盖文件和服务配置，但不重启服务：

```sh
curl -fsSL https://agent.orence.net/install.sh | sh -s -- --force --no-restart
```

## 自动更新

Linux 非 Docker 安装会创建：

```text
agentbox-updater.service
agentbox-updater.timer
```

默认每小时检查一次远程发布清单：

```text
https://agent.orence.net/releases/latest.json
```

有新版本时会：

1. 下载新的 Linux 二进制到临时文件。
2. 校验 `sha256`。
3. 原子替换 `/opt/agentbox/bin/agentbox`。
4. 执行 `systemctl restart agentbox`。

查看 timer：

```sh
systemctl list-timers agentbox-updater.timer
```

手动触发更新：

```sh
systemctl start agentbox-updater.service
```

修改检查间隔：

```sh
curl -fsSL https://agent.orence.net/install.sh | sh -s -- --update-interval 2h
```

关闭自动更新：

```sh
curl -fsSL https://agent.orence.net/install.sh | sh -s -- --no-auto-update
```

## 自定义安装路径

默认路径：

```text
程序目录：/opt/agentbox
配置目录：/etc/agentbox
数据目录：/opt/agentbox/data
```

可通过参数修改：

```sh
curl -fsSL https://agent.orence.net/install.sh | sh -s -- \
  --install-dir /opt/agentbox \
  --data-root /opt/agentbox/data \
  --service-name agentbox
```

## 卸载

卸载服务和程序文件，默认保留配置与数据：

```sh
curl -fsSL https://agent.orence.net/install.sh | sh -s -- --uninstall
```

会移除：

```text
/opt/agentbox/bin
/etc/systemd/system/agentbox.service
/etc/systemd/system/agentbox-updater.service
/etc/systemd/system/agentbox-updater.timer
```

会保留：

```text
/etc/agentbox
/opt/agentbox/data
```

彻底清理配置和数据：

```sh
curl -fsSL https://agent.orence.net/install.sh | sh -s -- --uninstall --purge
```

## macOS 和 Windows

`install.sh` 也支持 macOS 和 Windows 的 `sh` 环境，例如 Git Bash、MSYS2 或 WSL。

macOS 会从 `latest.json` 读取 `platforms.darwin-*`，下载 `.app.tar.gz`，解压后覆盖 `/Applications/AgentBox.app` 并打开应用。可用 `--macos-app-dir` 或 `AGENTBOX_MACOS_APP_DIR` 指定应用目录，用 `--macos-app-name` 或 `AGENTBOX_MACOS_APP_NAME` 指定应用名称。

Windows 的 `sh` 环境会从 `latest.json` 读取 `platforms.windows-*`，下载并启动安装器。

Windows PowerShell 不要使用 `curl -fsSL`，因为 PowerShell 里的 `curl` 默认是 `Invoke-WebRequest` 的别名，不支持 `-fsSL`。

Windows PowerShell 5.1 对 `irm ... | iex` 的响应编码判断不稳定，如果脚本源码直接包含中文，可能在执行前就被解码成乱码。为了让一键命令稳定，`install.ps1` 的源码和输出文案保持纯 ASCII。

推荐使用 Windows 专用脚本：

```powershell
irm https://agent.orence.net/install.ps1 | iex
```

如果当前机器限制脚本执行策略，可以用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://agent.orence.net/install.ps1 | iex"
```

带参数时使用：

```powershell
& ([scriptblock]::Create((irm https://agent.orence.net/install.ps1))) -Help
& ([scriptblock]::Create((irm https://agent.orence.net/install.ps1))) -Cat
& ([scriptblock]::Create((irm https://agent.orence.net/install.ps1))) -Silent -Wait
& ([scriptblock]::Create((irm https://agent.orence.net/install.ps1))) -NoRun -DownloadDir "$env:USERPROFILE\Downloads"
```

Windows 脚本支持自动识别 x64/arm64，也可以手动指定：

```powershell
& ([scriptblock]::Create((irm https://agent.orence.net/install.ps1))) -Arch arm64
```

## 常用参数

```text
--manifest-url URL   使用自定义发布清单
--install-dir DIR    Linux 安装目录，默认 /opt/agentbox
--data-root DIR      Linux 数据目录，默认 /opt/agentbox/data
--service-name NAME  Linux systemd 服务名，默认 agentbox
--user USER          Linux 服务用户，默认 root
--group GROUP        Linux 服务用户组，默认 root
--port PORT          Linux 监听端口，默认 8787
--public-url URL     输出登录链接时使用的公网地址
--token TOKEN        指定后端访问 token
--force              即使版本一致也重新下载并覆盖安装
--restart            安装或覆盖后自动重启服务，默认启用
--no-restart         安装或覆盖后不自动重启服务
--cat                查看当前 Linux 安装、服务、更新器和访问状态
--no-start           安装后不启动服务
--no-auto-update     不启用自动更新 timer
--update-interval X  自动更新间隔，默认 1h
--uninstall          卸载服务和程序文件
--purge              卸载时同时删除配置和数据
--dry-run            只展示计划执行的操作
```

## Windows PowerShell 参数

```text
-ManifestUrl URL     使用自定义发布清单
-Arch auto|x64|arm64 指定 Windows 安装包架构，默认 auto
-DownloadDir DIR     安装包下载目录，默认 %TEMP%\AgentBoxInstall
-InstallerPath FILE  使用本地安装包，不下载
-Silent              静默安装，传递 NSIS /S
-Wait                等待安装器退出
-NoRun               只下载安装包，不启动安装器
-Force               安装包已存在时也重新下载
-DryRun              只展示计划执行的操作
-Cat                 查看当前 Windows 安装状态
-Uninstall           调用已安装 AgentBox 的卸载程序
-CurrentUser         安装给当前用户，传递 /currentuser
-AllUsers            安装给所有用户，传递 /allusers
-Help                显示帮助
```
