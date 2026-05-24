# AgentBox Build

## macOS App

构建并签名、公证 universal、x64、arm64 三份 macOS 包：

```bash
./AgentBox-Apple/build-macos-all.sh
```

单独构建某个 macOS 目标：

```bash
./AgentBox-Apple/build-macos-all.sh arm64
./AgentBox-Apple/build-macos-all.sh x64
./AgentBox-Apple/build-macos-all.sh universal
```

产物目录：

```text
Build/output/1.0.0/macos/universal/app/AgentBox.app
Build/output/1.0.0/macos/universal/dmg/AgentBox_1.0.0_universal.dmg
Build/output/1.0.0/macos/universal/updater/AgentBox_1.0.0_universal.app.tar.gz
Build/output/1.0.0/macos/universal/updater/AgentBox_1.0.0_universal.app.tar.gz.sig
Build/output/1.0.0/macos/x64/app/AgentBox.app
Build/output/1.0.0/macos/x64/dmg/AgentBox_1.0.0_x64.dmg
Build/output/1.0.0/macos/x64/updater/AgentBox_1.0.0_x64.app.tar.gz
Build/output/1.0.0/macos/x64/updater/AgentBox_1.0.0_x64.app.tar.gz.sig
Build/output/1.0.0/macos/arm64/app/AgentBox.app
Build/output/1.0.0/macos/arm64/dmg/AgentBox_1.0.0_aarch64.dmg
Build/output/1.0.0/macos/arm64/updater/AgentBox_1.0.0_aarch64.app.tar.gz
Build/output/1.0.0/macos/arm64/updater/AgentBox_1.0.0_aarch64.app.tar.gz.sig
```

脚本会自动把 `Client/public/config.js` 里的 `APP_VERSION` 同步到 Tauri 配置，并使用 `AgentBox-Apple/tauri-updater.key` 为 Tauri updater 产物生成签名。

## Windows x64 Installer

```bash
./Build/scripts/build-windows-docker.sh
```

跳过 Docker 镜像重建：

```bash
SKIP_IMAGE_BUILD=1 ./Build/scripts/build-windows-docker.sh
```

产物：

```text
Build/output/1.0.0/windows/x64/nsis/AgentBox_1.0.0_x64-setup.exe
Build/output/1.0.0/windows/x64/nsis/AgentBox_1.0.0_x64-setup.exe.sig
```

## Windows ARM64 Installer

```bash
./Build/scripts/build-windows-arm64-docker.sh
```

跳过 Docker 镜像重建：

```bash
SKIP_IMAGE_BUILD=1 ./Build/scripts/build-windows-arm64-docker.sh
```

产物：

```text
Build/output/1.0.0/windows/arm64/nsis/AgentBox_1.0.0_arm64-setup.exe
Build/output/1.0.0/windows/arm64/nsis/AgentBox_1.0.0_arm64-setup.exe.sig
```

## Linux Backend Binaries

构建前端并嵌入到 Go 后端，然后输出一体化后端二进制；不构建 Tauri 桌面壳：

```bash
./Build/scripts/build-linux-backend.sh
```

默认产物：

```text
Build/output/1.0.0/linux/x64/backend/agentbox
Build/output/1.0.0/linux/arm64/backend/agentbox
```

脚本会先执行 `pnpm build`，将 `Client/dist` 复制到 `Server/internal/web/dist`，并把内嵌前端的 `API_URL` 改为同源入口。

指定输出更多平台：

```bash
TARGETS="linux/amd64 linux/arm64 windows/amd64 windows/arm64 darwin/amd64 darwin/arm64" ./Build/scripts/build-linux-backend.sh
```

指定输出目录：

```bash
OUTPUT_ROOT=Build/release-output ./Build/scripts/build-linux-backend.sh
```

所有构建脚本都会把最终产物整理到：

```text
Build/output/<版本>/<平台>/<架构>/<包类型>/
```

## Tauri Updater Manifest

生成 macOS/Windows 安装包后，用脚本读取 `.sig` 文件并更新 `Data/latest.json`：

```bash
./Build/scripts/generate-latest-json.mjs
```

默认下载地址前缀为：

```text
https://annex.orence.net/agentbox
```

生成的文件 URL 格式为：

```text
https://annex.orence.net/agentbox/<版本>/<平台>/<架构>/<包类型>/文件名
```

如果 `Build/output/<版本>/linux/x64/backend/agentbox` 或 `Build/output/<版本>/linux/arm64/backend/agentbox` 存在，脚本会额外写入 `downloads.linux`，用于发布 Linux 后端一体化二进制：

```json
{
  "downloads": {
    "linux": {
      "x64": {
        "url": "https://annex.orence.net/agentbox/<版本>/linux/x64/backend/agentbox",
        "sha256": "...",
        "size": 123
      }
    }
  }
}
```

如需临时指定 CDN 前缀：

```bash
UPDATE_ARTIFACT_BASE_URL=https://annex.orence.net/agentbox ./Build/scripts/generate-latest-json.mjs
```

发布时上传 `.app.tar.gz`、`.exe` 和对应 `.sig` 同名签名文件；`latest.json` 里必须写入 `.sig` 文件内容，而不是 `.sig` 文件 URL。

macOS 平台项会额外写入 `dmgurl`，指向同架构 `.dmg` 安装包地址。

上传 `latest.json` 对应的更新文件到 COS：

```bash
./Build/Update/upload-latest-json.mjs
```

脚本会读取 `Build/Update/.env`，默认上传：

- `Data/latest.json` -> `releases/latest.json`
- `latest.json` 里各平台 `url` 对应的安装包
- `latest.json` 里 `downloads` 对应的下载文件（包含 Linux 后端二进制）
- 安装包旁边同名 `.sig` 文件
- macOS 各架构对应的 `.dmg` 安装包

可选参数和环境变量：

```bash
./Build/Update/upload-latest-json.mjs --dry-run
UPLOAD_LATEST_JSON=0 ./Build/Update/upload-latest-json.mjs
UPLOAD_SIGNATURES=0 ./Build/Update/upload-latest-json.mjs
UPLOAD_DMG=0 ./Build/Update/upload-latest-json.mjs
TENCENT_COS_LATEST_JSON_KEY=agentbox/latest.json ./Build/Update/upload-latest-json.mjs
```

## Notes

Windows Docker 构建会读取 `AgentBox-Apple/heroui.env` 里的 HeroUI token，如果本机没有该文件，也可以临时传入：

```bash
HEROUI_AUTH_TOKEN=... ./Build/scripts/build-windows-docker.sh
```

在 macOS/Linux Docker 里构建 Windows 安装包时，Tauri 会跳过 Windows 安装包签名。
