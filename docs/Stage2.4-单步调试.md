# Stage 2.4：单步调试

日期：2026-10-19
状态：已交付（2026-10-19）

## 1. 问题

回放失败时，现在的信息只有「第几步失败 + 错误 + 截图」。要复现和排查，用户通常得反复改用例、重跑整条流程，无法像 IDE 一样停在某一步观察页面。

这一期把执行器变成可暂停的：

- 停在任意一步之前，手动「下一步」。
- 在步骤列表里设断点，「继续」跑到下一个断点。
- 暂停时查看用例变量、当前步骤的实际参数、已完成步骤的状态与截图。
- 调试不写执行记录，避免污染报告列表。

## 2. 边界

- 只调试**已保存用例**。AI 计划卡的单步执行放到后续，复用同一套控制器。
- 从起始地址重新执行，先导航再停在第一步之前。
- 不支持失败后「从中断处继续」、条件断点、暂停时改变量、单步进入 Playwright 内部逻辑。
- 调试期间修改用例只影响下一次运行；当前调试使用启动时的用例快照。
- 断点按用例保存在浏览器 localStorage，本机保留；调试证据落在 `runs/<runId>/`，但不进入执行记录。

## 3. 执行器：beforeStep

`runCaseOnPage` 新增可选钩子：

```ts
interface StepHookContext {
  step: Step                     // 已替换变量，执行器下一步就会执行它
  index: number                  // 0-based
  total: number
  variables: Record<string, string>
  evidenceDir: string
}

beforeStep?: (context: StepHookContext) => Promise<void>
```

- 在每个要执行的步骤前调用；条件不满足而跳过的步骤不打断。
- Promise 未 resolve 前，执行器停在该步骤之前。
- 钩子返回后再次检查取消信号，停止时不会误执行当前步骤。
- 普通回放不传钩子，行为与之前完全一致。

## 4. 调试控制器

`DebugController` 持有一次调试的状态机：

```text
running ──下一步──> 执行一步 ──> paused
paused  ──继续────> running（遇断点再 paused）
running ──暂停────> 当前步执行完后 paused
任意    ──停止────> stopped
```

状态：

```ts
interface DebugState {
  caseId: string
  runId: string
  status: 'paused' | 'running' | 'passed' | 'failed' | 'stopped'
  index: number                    // 当前/下一步，0-based
  total: number
  stepId?: string
  step?: Step                      // 已替换变量的当前步骤
  variables?: Record<string, string>
  breakpoints: string[]
  results: Record<string, {
    status: 'passed' | 'failed'
    durationMs: number
    error?: string
    skipped?: boolean
    screenshotUrl?: string
  }>
  error?: string
}
```

- 启动时先发一次 `running`，导航完成后在第一步前暂停。
- `next`：保持单步模式并放行当前门闩；下一步前再次暂停。
- `continue`：进入连续模式，放行门闩；遇到断点或结束再停。
- `pause`：切回单步模式；当前步骤执行完后，下一步前暂停。
- `stop`：中止执行并放行门闩，已完成的步骤与证据保留。
- 调试中可以通过 `set-breakpoints` 实时更新断点集合，界面与控制器保持同步。

调试不调用 `runs.save`；证据目录仍为 `runs/<runId>/`，截图通过 `/evidence/<runId>/...` 访问。

## 5. 接口

新增通道：

```text
debug:start   { caseId, breakpoints? } → { runId }
debug:command { action: next | continue | pause | stop | set-breakpoints, breakpoints? } → ok
debug:state   {} → DebugState | null
```

新增事件：

```text
event:debug-state → DebugState
```

- `/events` 建连 / 重连时补发一次当前 `debug-state`，避免断线期间错过暂停。
- 与录制、回放、计划执行、AI 计划、Copilot 操作互斥；调试中导航也会被拒绝。

## 6. 界面

- 中栏工具栏新增「调试」按钮（选中用例且空闲时可用）。
- 调试开始后，工具栏下方出现控制条：
  - `调试 · 已暂停 · 第 2/4 步 · 选择「节目类型」`
  - `下一步` / `继续`（暂停时）、`暂停`（执行中）、`停止`
  - 结束后显示 `已通过 / 未通过 / 已停止` 与 `关闭`
  - 可展开「变量与当前参数」：用例变量表 + 当前步骤替换后的 params/assertion。
- 步骤列表：
  - 每行左侧新增断点槽，点击切换红点；调试中切换会立即同步给控制器。
  - 当前步骤用琥珀色边框高亮；已完成步骤显示绿色对勾，失败步骤红色叉号与边框。
  - 失败的步骤结果包含错误与截图，可在调试结束后继续查看。

## 7. 验收

1. 选中一条 4 步用例，点「调试」→ 页面导航到起始地址后停在第一步之前。
2. 展开「变量与当前参数」，能看到变量与当前填写值。
3. 点「下一步」→ 第一步执行并停在第二步之前。
4. 在第三步设断点 → 点「继续」→ 越过第二步后停在第三步之前。
5. 再点「继续」→ 跑完剩余步骤，控制条显示「已通过」。
6. 执行记录数量不变；关闭调试后断点仍在。
7. 调试中「录制 / 回放 / 导航」被禁用或拒绝；停止后恢复。

## 8. 交付验证

### 自动化

- Runner 新增 `step-hook.integration.test.ts`：
  - 每个要执行的步骤前都会等待钩子，变量已替换；
  - 停止后不再执行被门闩拦住的步骤。
- Agent 新增 `debug-runner.test.ts`：
  - `下一步` → 暂停在第二步，第一步结果已记录；
  - `set-breakpoints` + `继续` → 命中断点暂停；
  - 再继续 → 全部通过，页面实际点击顺序正确；
  - `停止` → 状态为 stopped，未执行任何步骤。
- E2E 在演示用例上走通「暂停 → 下一步 → 断点继续 → 通过」，并校验调试前后 `run:list` 数量一致。
- `pnpm lint / typecheck / test / build / e2e` 全部通过。

### 已知边界

- 调试证据不会自动清理；后续可在设置里增加「清理未归档证据」。
- 断点按用例 id 保存；复制用例后需要重新设置断点。
- 调试中编辑用例不会影响当前执行，界面会在下一次调试时使用新内容。
