import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(rootDir, '.env')
const tauriConfigPath = resolve(rootDir, 'src-tauri/tauri.conf.json')

const envText = readFileSync(envPath, 'utf8')
const match = envText.match(/^\s*FRONTEND_DEV_PORT\s*=\s*(\d+)\s*$/m)
const port = match?.[1] ?? '5173'
const devUrl = `http://localhost:${port}`

const configText = readFileSync(tauriConfigPath, 'utf8')
const nextConfigText = configText.replace(
  /("devUrl"\s*:\s*")[^"]+(")/,
  `$1${devUrl}$2`,
)

if (nextConfigText !== configText) {
  writeFileSync(tauriConfigPath, nextConfigText)
}
