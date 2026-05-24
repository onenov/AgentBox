import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appConfigPath = resolve(rootDir, 'public/config.js')
const cargoTomlPath = resolve(rootDir, 'src-tauri/Cargo.toml')
const tauriConfigPath = resolve(rootDir, 'src-tauri/tauri.conf.json')

const appConfigText = readFileSync(appConfigPath, 'utf8')
const versionMatch = appConfigText.match(/\bAPP_VERSION\s*:\s*(['"])([^'"]+)\1/)
const appVersion = versionMatch?.[2]?.trim()

if (!appVersion) {
  throw new Error(`APP_VERSION not found in ${appConfigPath}`)
}

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(appVersion)) {
  throw new Error(`APP_VERSION must be a valid semver version, got: ${appVersion}`)
}

const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8'))

if (tauriConfig.version !== appVersion) {
  tauriConfig.version = appVersion
  writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`)
  console.log(`Synced Tauri version to ${appVersion}`)
}

const cargoTomlText = readFileSync(cargoTomlPath, 'utf8')
const nextCargoTomlText = cargoTomlText.replace(
  /(^\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m,
  `$1"${appVersion}"`,
)

if (nextCargoTomlText === cargoTomlText && !new RegExp(`^version\\s*=\\s*"${escapeRegExp(appVersion)}"`, 'm').test(cargoTomlText)) {
  throw new Error(`Cargo package version not found in ${cargoTomlPath}`)
}

if (nextCargoTomlText !== cargoTomlText) {
  writeFileSync(cargoTomlPath, nextCargoTomlText)
  console.log(`Synced Cargo package version to ${appVersion}`)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
