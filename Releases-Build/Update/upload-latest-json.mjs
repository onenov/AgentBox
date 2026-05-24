#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(scriptDir, '../..')
const envPath = path.join(scriptDir, '.env')
const manifestPath = path.join(rootDir, 'Data/latest.json')
const outputRoot = process.env.OUTPUT_ROOT || path.join(rootDir, 'Build/output')

loadEnv(envPath)

const bucket = requireEnv('TENCENT_COS_BUCKET')
const region = requireEnv('TENCENT_COS_REGION')
const secretId = requireEnv('TENCENT_COS_SECRET_ID')
const secretKey = requireEnv('TENCENT_COS_SECRET_KEY')
const baseUrl = stripTrailingSlash(requireEnv('TENCENT_COS_BASE_URL'))
const latestJsonKey = normalizeObjectKey(process.env.TENCENT_COS_LATEST_JSON_KEY || 'releases/latest.json')
const baseOrigin = new URL(baseUrl).origin
const uploadSignatures = process.env.UPLOAD_SIGNATURES !== '0'
const uploadDmg = process.env.UPLOAD_DMG !== '0'
const uploadLatestJson = process.env.UPLOAD_LATEST_JSON !== '0'
const dryRun = process.argv.includes('--dry-run')

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const uploadItems = collectUploadItems(manifest)

if (dryRun) {
  console.log('Dry run. Files that would be uploaded:')
  for (const item of uploadItems) {
    console.log(`- ${item.filePath} -> ${item.key}`)
  }
  process.exit(0)
}

for (const item of uploadItems) {
  await uploadObject(item)
  console.log(`Uploaded ${path.relative(rootDir, item.filePath)} -> ${item.key}`)
}

function collectUploadItems(latestManifest) {
  const items = []
  const seenKeys = new Set()

  if (uploadLatestJson) {
    addItem(items, seenKeys, {
      filePath: manifestPath,
      key: latestJsonKey,
      contentType: 'application/json; charset=utf-8',
    })
  }

  for (const [platformKey, platform] of Object.entries(latestManifest.platforms || {})) {
    if (!platform?.url) {
      throw new Error(`Missing url for platform: ${platformKey}`)
    }

    const url = new URL(platform.url)
    if (url.origin !== baseOrigin) {
      throw new Error(`Artifact URL origin does not match TENCENT_COS_BASE_URL: ${platform.url}`)
    }

    const packageKey = normalizeObjectKey(decodeURIComponent(url.pathname))
    const packagePath = resolveLocalArtifactPath(packageKey, latestManifest.version)
    addItem(items, seenKeys, {
      filePath: packagePath,
      key: packageKey,
      contentType: contentTypeFor(packagePath),
    })

    const signaturePath = `${packagePath}.sig`
    if (uploadSignatures && fs.existsSync(signaturePath)) {
      addItem(items, seenKeys, {
        filePath: signaturePath,
        key: `${packageKey}.sig`,
        contentType: 'text/plain; charset=utf-8',
      })
    }

  }

  for (const downloadItem of collectDownloadItems(latestManifest.downloads, latestManifest.version)) {
    addItem(items, seenKeys, downloadItem)
  }

  if (uploadDmg) {
    for (const dmgItem of collectDmgItems(latestManifest.version)) {
      addItem(items, seenKeys, dmgItem)
    }
  }

  for (const item of items) {
    if (!fs.existsSync(item.filePath)) {
      throw new Error(`File not found: ${item.filePath}`)
    }
  }

  return items
}

function collectDownloadItems(downloads, version) {
  if (!downloads || typeof downloads !== 'object') return []

  const items = []
  visitDownloadNode(downloads, version, items)
  return items
}

function visitDownloadNode(node, version, items) {
  if (!node || typeof node !== 'object') return

  if (typeof node.url === 'string') {
    const url = new URL(node.url)
    if (url.origin !== baseOrigin) {
      throw new Error(`Download URL origin does not match TENCENT_COS_BASE_URL: ${node.url}`)
    }

    const packageKey = normalizeObjectKey(decodeURIComponent(url.pathname))
    const packagePath = resolveLocalArtifactPath(packageKey, version)
    items.push({
      filePath: packagePath,
      key: packageKey,
      contentType: contentTypeFor(packagePath),
    })
  }

  for (const value of Object.values(node)) {
    visitDownloadNode(value, version, items)
  }
}

function collectDmgItems(version) {
  const macosDir = path.join(outputRoot, version, 'macos')
  if (!fs.existsSync(macosDir)) return []

  return fs
    .readdirSync(macosDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const arch = entry.name
      const dmgDir = path.join(macosDir, arch, 'dmg')
      if (!fs.existsSync(dmgDir)) return []

      return fs
        .readdirSync(dmgDir)
        .filter((fileName) => fileName.endsWith('.dmg'))
        .map((fileName) => ({
          filePath: path.join(dmgDir, fileName),
          key: normalizeObjectKey(path.posix.join('agentbox', version, 'macos', arch, 'dmg', fileName)),
          contentType: 'application/x-apple-diskimage',
        }))
    })
}

function addItem(items, seenKeys, item) {
  if (seenKeys.has(item.key)) return
  seenKeys.add(item.key)
  items.push(item)
}

function resolveLocalArtifactPath(objectKey, version) {
  const segments = objectKey.split('/').filter(Boolean)
  const versionIndex = segments.indexOf(version)
  if (versionIndex < 0) {
    throw new Error(`Artifact URL path does not contain version "${version}": ${objectKey}`)
  }

  return path.join(outputRoot, ...segments.slice(versionIndex))
}

function uploadObject({ filePath, key, contentType }) {
  const body = fs.readFileSync(filePath)
  const host = `${bucket}.cos.${region}.myqcloud.com`
  const pathname = `/${key.split('/').map(encodeURIComponent).join('/')}`
  const headers = {
    'content-length': String(body.length),
    'content-type': contentType,
    host,
  }

  const authorization = createAuthorization({
    method: 'put',
    pathname,
    headers,
  })

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'PUT',
        host,
        path: pathname,
        headers: {
          Authorization: authorization,
          'Content-Length': headers['content-length'],
          'Content-Type': headers['content-type'],
          Host: host,
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const responseText = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve()
            return
          }
          reject(new Error(`COS upload failed (${res.statusCode}) for ${key}: ${responseText}`))
        })
      },
    )

    req.on('error', reject)
    req.end(body)
  })
}

function createAuthorization({ method, pathname, headers }) {
  const now = Math.floor(Date.now() / 1000)
  const keyTime = `${now};${now + 600}`
  const signedHeaderNames = ['host']
  const httpHeaders = signedHeaderNames.map((name) => `${name}=${encodeURIComponent(headers[name])}`).join('&')
  const httpString = [method, pathname, '', httpHeaders, ''].join('\n')
  const stringToSign = ['sha1', keyTime, sha1Hex(httpString), ''].join('\n')
  const signKey = hmacSha1Hex(secretKey, keyTime)
  const signature = hmacSha1Hex(signKey, stringToSign)

  return [
    'q-sign-algorithm=sha1',
    `q-ak=${secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${signedHeaderNames.join(';')}`,
    'q-url-param-list=',
    `q-signature=${signature}`,
  ].join('&')
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return

  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key] !== undefined) continue
    process.env[key] = unquoteEnvValue(rawValue)
  }
}

function unquoteEnvValue(value) {
  const trimmed = value.trim()
  const quote = trimmed[0]
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function requireEnv(key) {
  const value = process.env[key]
  if (!value) throw new Error(`Missing environment variable: ${key}`)
  return value
}

function normalizeObjectKey(value) {
  return value.replace(/^\/+/, '').replace(/\/+/g, '/')
}

function stripTrailingSlash(value) {
  return value.replace(/\/$/, '')
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8'
  if (filePath.endsWith('.gz')) return 'application/gzip'
  if (filePath.endsWith('.dmg')) return 'application/x-apple-diskimage'
  if (filePath.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable'
  return 'application/octet-stream'
}

function sha1Hex(value) {
  return crypto.createHash('sha1').update(value).digest('hex')
}

function hmacSha1Hex(key, value) {
  return crypto.createHmac('sha1', key).update(value).digest('hex')
}
