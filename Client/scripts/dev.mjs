import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(rootDir, '.env')
const envText = readFileSync(envPath, 'utf8')
const match = envText.match(/^\s*FRONTEND_DEV_PORT\s*=\s*(\d+)\s*$/m)
const port = match?.[1] ?? '5173'

const child = spawn('vite', ['--port', port, '--strictPort'], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    FRONTEND_DEV_PORT: port,
  },
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
