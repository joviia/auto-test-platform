#!/usr/bin/env node
/**
 * 三幕剧被测页 break/restore 脚本（幂等：均为整文件重写）。
 *
 * break 的三处变异与候选链一一对应（打掉登录按钮的全部四层候选）：
 *   1. 按钮文案 登录 → 立即提交   —— 打掉 role+名称 与 text 两层候选
 *   2. 按钮外包一层 <div>          —— 打掉 css「#login-form > button」直接子级链
 *   3. 删除按钮的 data-testid      —— 打掉第一优先候选
 * 输入框的候选不动，保证幕 3 中 fill 步骤仍可通过、失败聚焦在 click 步骤。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/runner/fixtures/login-form/index.html')

function replaceOrFail(source, from, to) {
  if (!source.includes(from)) {
    throw new Error(`break 失败：源码中未找到目标片段「${from}」（可能已被 break 过）`)
  }
  return source.replace(from, to)
}

function broken(source) {
  let s = source
  s = replaceOrFail(s, ' data-testid="login-submit"', '')
  s = replaceOrFail(s, '>登录</button>', '>立即提交</button>')
  s = replaceOrFail(s, '<button type="submit"', '<div><button type="submit"')
  s = replaceOrFail(s, '</button>', '</button></div>')
  return s
}

const action = process.argv[2]
if (action === 'restore') {
  // restore 以本脚本顶部注释下的原始副本为准：从 git 恢复最可靠
  console.log('restore：从 git HEAD 恢复 fixture 原始内容')
  const { execFileSync } = await import('node:child_process')
  execFileSync('git', ['checkout', 'HEAD', '--', fixturePath], { stdio: 'inherit' })
  console.log(`已恢复 ${fixturePath}`)
} else if (action === 'break') {
  const source = readFileSync(fixturePath, 'utf8')
  writeFileSync(fixturePath, broken(source))
  console.log(`break 完成（按钮：删 testId + 改文案 + 外包 div）：${fixturePath}`)
} else {
  console.error('用法：node scripts/fixture.mjs <break|restore>')
  process.exit(2)
}
