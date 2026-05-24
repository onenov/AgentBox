#!/usr/bin/env node
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(scriptDir, '../..')
const tauriConfigPath = path.join(rootDir, 'Client/src-tauri/tauri.conf.json')
const outputJsonPath = path.join(rootDir, 'Data/latest.json')
const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'))
const productName = tauriConfig.productName || 'AgentBox'
const version = process.env.RELEASE_VERSION || tauriConfig.version
const outputRoot = process.env.OUTPUT_ROOT || path.join(rootDir, 'Build/output')
const artifactBaseUrl = normalizeArtifactBaseUrl(process.env.UPDATE_ARTIFACT_BASE_URL || 'https://annex.orence.net/agentbox')
const existingManifest = readExistingManifest(outputJsonPath)
const notes = process.env.RELEASE_NOTES || existingManifest.notes || ''
const pubDate = process.env.RELEASE_PUB_DATE || new Date().toISOString()

const candidates = [
  {
    key: 'darwin-aarch64',
    path: path.join(outputRoot, version, 'macos/arm64/updater', `${productName}_${version}_aarch64.app.tar.gz`),
    url: artifactUrl('macos', 'arm64', 'updater', `${productName}_${version}_aarch64.app.tar.gz`),
    dmgPath: path.join(outputRoot, version, 'macos/arm64/dmg', `${productName}_${version}_aarch64.dmg`),
    dmgurl: artifactUrl('macos', 'arm64', 'dmg', `${productName}_${version}_aarch64.dmg`),
  },
  {
    key: 'darwin-x86_64',
    path: path.join(outputRoot, version, 'macos/x64/updater', `${productName}_${version}_x64.app.tar.gz`),
    url: artifactUrl('macos', 'x64', 'updater', `${productName}_${version}_x64.app.tar.gz`),
    dmgPath: path.join(outputRoot, version, 'macos/x64/dmg', `${productName}_${version}_x64.dmg`),
    dmgurl: artifactUrl('macos', 'x64', 'dmg', `${productName}_${version}_x64.dmg`),
  },
  {
    key: 'windows-x86_64',
    path: path.join(outputRoot, version, 'windows/x64/nsis', `${productName}_${version}_x64-setup.exe`),
    url: artifactUrl('windows', 'x64', 'nsis', `${productName}_${version}_x64-setup.exe`),
  },
  {
    key: 'windows-aarch64',
    path: path.join(outputRoot, version, 'windows/arm64/nsis', `${productName}_${version}_arm64-setup.exe`),
    url: artifactUrl('windows', 'arm64', 'nsis', `${productName}_${version}_arm64-setup.exe`),
    optional: true,
  },
]

const platforms = {}
const missing = []

for (const candidate of candidates) {
  const signaturePath = `${candidate.path}.sig`
  const missingPaths = [candidate.path, signaturePath, candidate.dmgPath].filter((filePath) => filePath && !fs.existsSync(filePath))
  if (missingPaths.length > 0) {
    if (!candidate.optional) missing.push(missingPaths.join(' + '))
    continue
  }

  platforms[candidate.key] = {
    signature: fs.readFileSync(signaturePath, 'utf8').trim(),
    url: candidate.url,
  }

  if (candidate.dmgurl) {
    platforms[candidate.key].dmgurl = candidate.dmgurl
  }
}

if (missing.length > 0) {
  console.error('Missing updater artifacts:')
  for (const item of missing) console.error(`- ${item}`)
  process.exit(1)
}

const manifest = {
  version,
  notes,
  pub_date: pubDate,
  platforms,
}

const downloads = collectDownloads()
if (Object.keys(downloads).length > 0) {
  manifest.downloads = downloads
}

fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true })
fs.writeFileSync(outputJsonPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Wrote ${path.relative(rootDir, outputJsonPath)}`)

function readExistingManifest(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return {}
  }
}

function artifactUrl(platform, arch, packageType, fileName) {
  return `${artifactBaseUrl}/${version}/${platform}/${arch}/${packageType}/${fileName}`
}

function collectDownloads() {
  const linux = {}
  const linuxCandidates = [
    {
      arch: 'x64',
      path: path.join(outputRoot, version, 'linux/x64/backend', 'agentbox'),
      url: artifactUrl('linux', 'x64', 'backend', 'agentbox'),
    },
    {
      arch: 'arm64',
      path: path.join(outputRoot, version, 'linux/arm64/backend', 'agentbox'),
      url: artifactUrl('linux', 'arm64', 'backend', 'agentbox'),
    },
  ]

  for (const candidate of linuxCandidates) {
    if (!fs.existsSync(candidate.path)) continue
    const stat = fs.statSync(candidate.path)
    linux[candidate.arch] = {
      url: candidate.url,
      sha256: sha256File(candidate.path),
      size: stat.size,
    }
  }

  return Object.keys(linux).length > 0 ? { linux } : {}
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function normalizeArtifactBaseUrl(baseUrl) {
  return baseUrl.replace(/\/$/, '').replace(new RegExp(`/${escapeRegExp(version)}$`), '')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
