import type { AccessCredential, AccessCredentialTarget } from '@/api/auth'
import { parseAccessCredential } from '@/api/auth'
import { getDesktopStorageValue, setDesktopStorageValueAsync } from '@/utils/desktopStorage'
import { isTauriRuntime } from './tauri'

const DB_NAME = 'agent-box-access-credentials'
const DB_VERSION = 1
const CREDENTIAL_STORE = 'credentials'
const META_STORE = 'metadata'
const ACTIVE_CREDENTIAL_KEY = 'activeCredentialId'
const DESKTOP_ACCESS_CREDENTIALS_KEY = 'agent-box-access-credentials-v1'

export const ACCESS_CREDENTIALS_CHANGED_EVENT = 'agent-box:access-credentials-changed'

export type StoredAccessCredential = {
  backendAddress: string
  color?: string
  credential: string
  createdAt: string
  id: string
  label: string
  lastUsedAt?: string
  suffix: string
  target: AccessCredentialTarget
  tokenPreview: string
  updatedAt: string
}

type DesktopAccessCredentialStore = {
  activeCredentialId?: string
  credentials: StoredAccessCredential[]
  version: 1
}

export async function listStoredAccessCredentials() {
  if (isTauriRuntime()) {
    const store = await readDesktopAccessCredentialStore()
    return store.credentials
  }

  const db = await openAccessCredentialDB()
  return await withStore<StoredAccessCredential[]>(db, CREDENTIAL_STORE, 'readonly', (store) => requestToPromise(store.getAll()))
}

export async function getActiveAccessCredential() {
  if (isTauriRuntime()) {
    const store = await readDesktopAccessCredentialStore()
    return store.credentials.find((credential) => credential.id === store.activeCredentialId) ?? null
  }

  const db = await openAccessCredentialDB()
  const activeId = await getMetaValue<string>(db, ACTIVE_CREDENTIAL_KEY)
  if (!activeId) return null
  return await withStore<StoredAccessCredential | null>(db, CREDENTIAL_STORE, 'readonly', async (store) => {
    return (await requestToPromise<StoredAccessCredential | undefined>(store.get(activeId))) ?? null
  })
}

export async function saveStoredAccessCredential(rawCredential: string, label?: string, color?: string) {
  const parsed = parseAccessCredential(rawCredential)
  if (!parsed.backendAddress || !parsed.target || !parsed.suffix) {
    throw new Error('请填写完整的 anex 访问凭据')
  }
  return await saveParsedAccessCredential(rawCredential, parsed, label, color)
}

export async function checkAccessCredentialHealth(credential: AccessCredential) {
  if (!credential.backendAddress) {
    throw new Error('凭据缺少后端地址')
  }

  const healthURL = new URL('/api/health', credential.backendAddress).toString()
  let response: Response
  try {
    response = await fetch(healthURL, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${credential.token}`,
      },
    })
  } catch (err) {
    throw new Error(healthFetchErrorMessage(err, credential.backendAddress), { cause: err })
  }
  if (!response.ok) {
    throw new Error(`健康检查失败：${response.status}`)
  }

  return await response.json().catch(() => null) as { status?: unknown } | null
}

export async function checkStoredAccessCredentialHealth(credential: StoredAccessCredential) {
  return await checkAccessCredentialHealth(parseAccessCredential(credential.credential))
}

export async function saveAndActivateAccessCredential(rawCredential: string, parsed: AccessCredential) {
  const stored = await saveParsedAccessCredential(rawCredential, parsed)
  await activateStoredAccessCredential(stored.id)
  return stored
}

export async function activateStoredAccessCredential(id: string) {
  if (isTauriRuntime()) {
    const store = await readDesktopAccessCredentialStore()
    const current = store.credentials.find((credential) => credential.id === id)
    if (!current) {
      throw new Error('凭据不存在')
    }

    const next = { ...current, lastUsedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    await writeDesktopAccessCredentialStore({
      ...store,
      activeCredentialId: next.id,
      credentials: store.credentials.map((credential) => credential.id === next.id ? next : credential),
    })
    notifyAccessCredentialChange()
    return next
  }

  const db = await openAccessCredentialDB()
  const current = await withStore<StoredAccessCredential | null>(db, CREDENTIAL_STORE, 'readonly', async (store) => {
    return (await requestToPromise<StoredAccessCredential | undefined>(store.get(id))) ?? null
  })
  if (!current) {
    throw new Error('凭据不存在')
  }

  const next = { ...current, lastUsedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  await withStore<void>(db, CREDENTIAL_STORE, 'readwrite', async (store) => {
    await requestToPromise(store.put(next))
  })
  await setMetaValue(db, ACTIVE_CREDENTIAL_KEY, next.id)
  notifyAccessCredentialChange()
  return next
}

export async function clearActiveAccessCredential() {
  if (isTauriRuntime()) {
    const store = await readDesktopAccessCredentialStore()
    await writeDesktopAccessCredentialStore({ ...store, activeCredentialId: undefined })
    notifyAccessCredentialChange()
    return
  }

  const db = await openAccessCredentialDB()
  await deleteMetaValue(db, ACTIVE_CREDENTIAL_KEY)
  notifyAccessCredentialChange()
}

export async function deleteStoredAccessCredential(id: string) {
  if (isTauriRuntime()) {
    const store = await readDesktopAccessCredentialStore()
    await writeDesktopAccessCredentialStore({
      ...store,
      activeCredentialId: store.activeCredentialId === id ? undefined : store.activeCredentialId,
      credentials: store.credentials.filter((credential) => credential.id !== id),
    })
    notifyAccessCredentialChange()
    return
  }

  const db = await openAccessCredentialDB()
  await withStore<void>(db, CREDENTIAL_STORE, 'readwrite', async (store) => {
    await requestToPromise(store.delete(id))
  })
  const activeId = await getMetaValue<string>(db, ACTIVE_CREDENTIAL_KEY)
  if (activeId === id) {
    await deleteMetaValue(db, ACTIVE_CREDENTIAL_KEY)
  }
  notifyAccessCredentialChange()
}

async function saveParsedAccessCredential(rawCredential: string, parsed: AccessCredential, label?: string, color?: string) {
  if (!parsed.backendAddress || !parsed.target || !parsed.suffix) {
    throw new Error('请填写完整的 anex 访问凭据')
  }

  const normalizedCredential = rawCredential.trim()
  const now = new Date().toISOString()
  const desktopStore = isTauriRuntime() ? await readDesktopAccessCredentialStore() : null
  const db = desktopStore ? null : await openAccessCredentialDB()
  const existing = desktopStore
    ? desktopStore.credentials.find((credential) => credential.credential === normalizedCredential) ?? null
    : await findCredentialByValue(db!, normalizedCredential)
  const stored: StoredAccessCredential = {
    backendAddress: parsed.backendAddress,
    color: normalizeCredentialColor(color || existing?.color || defaultCredentialColor(parsed.target)),
    credential: normalizedCredential,
    createdAt: existing?.createdAt ?? now,
    id: existing?.id ?? createID(),
    label: label?.trim() || existing?.label || defaultCredentialLabel(parsed.target, parsed.backendAddress),
    lastUsedAt: existing?.lastUsedAt,
    suffix: parsed.suffix,
    target: parsed.target,
    tokenPreview: maskToken(parsed.token),
    updatedAt: now,
  }

  if (desktopStore) {
    await writeDesktopAccessCredentialStore({
      ...desktopStore,
      credentials: upsertStoredAccessCredential(desktopStore.credentials, stored),
    })
    notifyAccessCredentialChange()
    return stored
  }

  await withStore<void>(db!, CREDENTIAL_STORE, 'readwrite', async (store) => {
    await requestToPromise(store.put(stored))
  })
  notifyAccessCredentialChange()
  return stored
}

function upsertStoredAccessCredential(credentials: StoredAccessCredential[], stored: StoredAccessCredential) {
  const index = credentials.findIndex((credential) => credential.id === stored.id)
  if (index === -1) return [...credentials, stored]
  const next = [...credentials]
  next[index] = stored
  return next
}

async function readDesktopAccessCredentialStore(): Promise<DesktopAccessCredentialStore> {
  const stored = await getDesktopStorageValue<DesktopAccessCredentialStore>(DESKTOP_ACCESS_CREDENTIALS_KEY)
  if (isDesktopAccessCredentialStore(stored)) {
    return stored
  }

  const migrated = await readIndexedDBAccessCredentialStoreForMigration()
  await writeDesktopAccessCredentialStore(migrated)
  return migrated
}

async function writeDesktopAccessCredentialStore(store: DesktopAccessCredentialStore) {
  await setDesktopStorageValueAsync(DESKTOP_ACCESS_CREDENTIALS_KEY, {
    activeCredentialId: store.activeCredentialId,
    credentials: store.credentials,
    version: 1,
  })
}

async function readIndexedDBAccessCredentialStoreForMigration(): Promise<DesktopAccessCredentialStore> {
  try {
    const db = await openAccessCredentialDB()
    const credentials = await withStore<StoredAccessCredential[]>(db, CREDENTIAL_STORE, 'readonly', (store) => requestToPromise(store.getAll()))
    const activeCredentialId = await getMetaValue<string>(db, ACTIVE_CREDENTIAL_KEY)
    return { activeCredentialId, credentials, version: 1 }
  } catch {
    return { credentials: [], version: 1 }
  }
}

function isDesktopAccessCredentialStore(value: DesktopAccessCredentialStore | null): value is DesktopAccessCredentialStore {
  return Boolean(
    value &&
    value.version === 1 &&
    Array.isArray(value.credentials),
  )
}

function normalizeCredentialColor(color: string) {
  const normalized = color.trim().toLowerCase()
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : '#3b82f6'
}

function healthFetchErrorMessage(err: unknown, backendAddress: string) {
  const message = err instanceof Error ? err.message : String(err || '')
  if (/failed to fetch|load failed|networkerror|connection refused|err_connection_refused/i.test(message)) {
    return `后端不可达：无法连接 ${backendAddress}`
  }
  return `健康检查请求失败：${message || backendAddress}`
}

async function findCredentialByValue(db: IDBDatabase, credential: string) {
  return await withStore<StoredAccessCredential | null>(db, CREDENTIAL_STORE, 'readonly', async (store) => {
    const index = store.index('credential')
    return (await requestToPromise<StoredAccessCredential | undefined>(index.get(credential))) ?? null
  })
}

function defaultCredentialLabel(target: AccessCredentialTarget, backendAddress: string) {
  const targetLabel = targetLabelMap[target]
  try {
    return `${targetLabel} · ${new URL(backendAddress).host}`
  } catch {
    return targetLabel
  }
}

function maskToken(token: string) {
  const normalized = token.trim()
  if (normalized.length <= 8) return '*'.repeat(Math.max(normalized.length, 4))
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`
}

const targetLabelMap: Record<AccessCredentialTarget, string> = {
  all: '全部',
  cc: 'CC-Connect',
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
}

const targetColorMap: Record<AccessCredentialTarget, string> = {
  all: '#3b82f6',
  cc: '#0891b2',
  hermes: '#7c3aed',
  openclaw: '#059669',
}

function defaultCredentialColor(target: AccessCredentialTarget) {
  return targetColorMap[target]
}

function openAccessCredentialDB() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(CREDENTIAL_STORE)) {
        const store = db.createObjectStore(CREDENTIAL_STORE, { keyPath: 'id' })
        store.createIndex('credential', 'credential', { unique: true })
        store.createIndex('target', 'target', { unique: false })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('打开 IndexedDB 失败'))
  })
}

function withStore<T>(db: IDBDatabase, storeName: string, mode: IDBTransactionMode, callback: (store: IDBObjectStore) => Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    let result: T

    callback(store)
      .then((value) => {
        result = value
      })
      .catch((error) => {
        transaction.abort()
        reject(error)
      })

    transaction.oncomplete = () => resolve(result)
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 操作失败'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 操作已取消'))
  })
}

function requestToPromise<T = unknown>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'))
  })
}

async function getMetaValue<T>(db: IDBDatabase, key: string) {
  return await withStore<T | undefined>(db, META_STORE, 'readonly', async (store) => await requestToPromise<T | undefined>(store.get(key)))
}

async function setMetaValue(db: IDBDatabase, key: string, value: string) {
  await withStore<void>(db, META_STORE, 'readwrite', async (store) => {
    await requestToPromise(store.put(value, key))
  })
}

async function deleteMetaValue(db: IDBDatabase, key: string) {
  await withStore<void>(db, META_STORE, 'readwrite', async (store) => {
    await requestToPromise(store.delete(key))
  })
}

function createID() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `cred-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function notifyAccessCredentialChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ACCESS_CREDENTIALS_CHANGED_EVENT))
  }
}
