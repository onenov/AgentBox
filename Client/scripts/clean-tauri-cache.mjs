import { rmSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const rootDir = resolve(new URL('.', import.meta.url).pathname, '..')
const paths = [
  resolve(rootDir, 'src-tauri/target'),
  resolve(rootDir, 'src-tauri/gen'),
  resolve(rootDir, '.tauri'),
]

for (const path of paths) {
  if (!existsSync(path)) continue
  rmSync(path, { recursive: true, force: true })
  console.log(`Removed ${path}`)
}
