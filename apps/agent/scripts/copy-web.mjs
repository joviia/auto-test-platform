import { cpSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const source = join(import.meta.dirname, '..', '..', 'web', 'dist')
const target = join(import.meta.dirname, '..', 'dist', 'web')

if (!existsSync(join(source, 'index.html'))) {
  throw new Error(`Web UI 尚未构建：${source}。请先执行 pnpm --filter @atp/web build`)
}
rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })
console.log(`[atp] web -> ${target}`)
