# Stage 2.3 收尾：AI 计划卡与会话持久化

日期：2026-10-19
状态：已交付（2026-10-19）

## 1. 问题

Copilot 现在能读页面、直接操作、执行已有用例，也能对已有用例提修改建议。但还缺两件事：

1. **从一句话生成新用例**。用户说「从当前页面生成一条可执行的测试用例」，AI 只能在对话里描述步骤，不能给出一条可执行、可保存的用例。
2. **对话不能跨重启**。会话只存在 Agent 内存里，重启后历史全部丢失，也没法回到之前的讨论继续。

这一期把这两个缺口补上：

- AI 先生成一张**计划卡**：列出可执行步骤，用户确认后在中栏执行，通过后保存为用例。
- 会话与消息写入 SQLite，右侧新增「历史会话」入口，重启后可以恢复并继续。

## 2. 边界

- 计划卡不直接写数据库。执行与保存都由用户点击触发，和修改建议的确认模型一致。
- 计划卡只覆盖现有 8 个动作中的 7 个：click / fill / select / press / scroll / wait / assert。hover、双击、右键、上传等动作随 L2 补齐，不在这一期。
- 计划卡的目标元素由 AI 通过最近一次快照的 `ref` 指定，平台在生成计划时立即解析成持久定位器。ref 本身不进入用例。
- 跨域 iframe、Shadow DOM、多标签页暂不支持；快照只观察顶层页面。
- 会话正文按本地数据对待：只写本机 SQLite，不发往任何服务端。工具卡里的输入仍可能包含用户填写的内容，和录制数据同等处理。

## 3. 计划卡数据

AI 提交的是「要做什么」，不是一份完整 CaseFile。平台负责把它变成可执行的用例结构。

### 3.1 工具输入

```ts
case_plan({
  name: string,            // 建议的用例名
  summary: string,         // 一句话说明测什么、怎么验证
  startUrl?: string,       // 缺省用当前页面地址
  steps: Array<{
    action: 'click' | 'fill' | 'select' | 'press' | 'scroll' | 'wait' | 'assert'
    ref?: string           // 元素动作必填，来自最近一次 browser_snapshot
    name?: string          // 展示用名称，缺省取快照名称
    value?: string         // fill 的值 / select 的选项文本
    key?: string           // press
    x?: number; y?: number // scroll
    timeoutMs?: number     // wait
    assertion?: Assertion  // assert
  }>
})
```

工具执行时：

1. 要求最近一次快照存在且 ref 有效；失效时返回可行动的错误，提示重新快照。
2. 逐个 ref 在页面里解析出角色、可读名、testId、文本、CSS 路径与 XPath。
3. 生成定位器候选，顺序与录制一致：
   `testId → role + name → text → css → xpath`。
   其中 css/xpath 只在页面内唯一或作为兜底时使用，避免把结构性选择器当成主定位。
4. 生成 `CaseFile` 草稿：
   - `case.id = ai-plan-<时间戳>`；`case.name = name`；`case.startUrl = startUrl ?? 当前 URL`。
   - 每个元素动作生成一个 `Element`，id 形如 `el-plan-001`。
   - 每个步骤生成 `display`：`{ verb, field, value }`，供卡片展示。
   - `select` 按目标标签决定 `mode`：原生 `select` 用 `native`，其余用 `custom`。
   - `assert` 直接使用传入的 `assertion`。
5. 通过 `event:ai-plan-proposal` 把完整草稿发给界面，工具只返回步骤数、起始地址与解析失败的步骤。

### 3.2 界面数据

```ts
interface AiPlanProposal {
  proposalId: string
  name: string
  summary: string
  startUrl: string
  caseFile: CaseFile
  createdAt: string
}
```

界面保存的是可编辑草稿，因此卡片状态额外维护：

```ts
type AiPlanStatus = 'pending' | 'running' | 'passed' | 'failed' | 'saved'
```

卡片可以：

- 删除步骤、上移 / 下移。
- 编辑 fill / select 的值、press 的按键、assert 的期望值。
- 执行、停止、保存为用例、放弃。
- 执行后显示每步状态、耗时与截图缩略图；失败步骤标红并可展开错误。

目标元素不可在卡片里改。定位不对时让 Copilot 重新快照、重新生成计划，比在卡片里手填选择器更可靠。

## 4. 执行与保存

### 4.1 在中栏执行

`ai:plan-run` 立即返回 `runId`，实际执行在后台进行，避免 60 秒 IPC 超时：

1. 重新校验没有录制、回放或计划在执行。
2. 用卡片当前草稿构造 CaseFile，通过 `runCaseOnPage` 在真实 Chrome 上执行。
3. 逐步发送 `event:ai-plan-progress`：`{ proposalId, runId, index, total, status }`。
4. 结束后发送 `event:ai-plan-result`：每步状态、耗时、错误与截图 URL。
5. `ai:plan-stop` 中止执行；已完成的步骤与证据保留。

执行不写 `runs` 表：计划还没有对应的用例记录，提前写会污染执行列表。证据仍落在 `runDir(runId)`，通过 `/evidence/<runId>/...` 访问。

### 4.2 保存为用例

复用现有「保存用例」表单，增加一个可传入草稿的入口：

- 项目、模块、用例名可改；初始项目取当前项目，初始名称取 `plan.name`。
- 写入仍走 `case:create` + `case:update`，与录制保存完全同一条链路。
- 保存后卡片显示「已保存为用例」，提供「打开用例」；同时刷新用例树与缓存。
- 没执行过或执行失败时保存，卡片和保存结果标记「未验证」，不伪装成已通过。

## 5. 会话持久化

### 5.1 表结构

新增两张表（第二个迁移，不影响已有本地库）：

```sql
create table ai_sessions (
  id text not null primary key,
  title text not null,
  created_at text not null,
  updated_at text not null
);

create table ai_messages (
  id text not null primary key,
  session_id text not null,
  seq integer not null,
  role text not null,          -- user | assistant
  payload text not null,       -- JSON：正文、工具卡、取消/错误
  created_at text not null
);
create index ai_messages_session_id_index on ai_messages (session_id);
```

`payload`：

- user：`{ text }`
- assistant：`{ text, reasoning, tools, cancelled?, error? }`

`tools` 与界面工具卡同构：`callId / name / label / input / status / durationMs / output / error / evidenceUrl / target`。这样重启后恢复的不只是文字，还包括工具调用与证据缩略图。

### 5.2 写入时机

- 首条消息创建会话，标题取首条用户消息（压缩空白、截 40 字）。
- 用户消息在发送时落库。
- 助手消息在 `finally` 落库，覆盖正常完成、取消与错误三种情况。
- 会话 `updated_at` 随消息更新；内存里的模型上下文仍保留最近 40 条。

### 5.3 恢复

- 新增 `ai:session-list`、`ai:session-get`、`ai:session-delete` 三个通道。
- 右侧 Copilot 头部新增「历史」按钮，弹层列出最近 30 个会话：标题、更新时间、消息数。
- 选中后重建界面消息并设置 `aiSessionId`；下一条消息继续使用同一会话。
- Agent 重启后首次发送某会话消息时，从 SQLite 读出 user / assistant 正文，重建模型上下文；工具卡不进入模型上下文，只用于界面还原。
- 「新会话」只清空当前界面，不删除历史；删除必须显式点历史列表里的删除。

## 6. 界面

计划卡固定在 Copilot 输入框上方，和修改建议卡并排堆叠，最多保留 3 张：

```
┌ AI 计划 · 新建一条内容 ────────────────────────────┐
│ 新建内容并验证保存成功                                │
│ 起始页  demo.example.com/demo                        │
│                                                      │
│ 1  填写  内容名称 = 「AI计划_xxx」           ↑ ↓ ×   │
│ 2  点击  保存                                 ↑ ↓ ×   │
│ 3  断言  页面包含「保存成功」                 ↑ ↓ ×   │
│                                                      │
│ [在中栏执行]  [保存为用例]  [放弃]                    │
└──────────────────────────────────────────────────────┘
```

执行中：

- 按钮变为「停止」，步骤左侧显示转圈；完成一项变成对勾 / 叉号。
- 卡片底部显示 `3/3 步 · 通过 · 1.2s`；失败时显示错误摘要。
- 右侧步骤与中栏实时画面同步，用户能直接看到每一次点击和输入。

历史会话弹层：

- 顶部说明「会话保存在本机」。
- 每行：标题、相对时间、消息数、删除按钮。
- 空状态提示「还没有历史会话」。

## 7. 接口变更

新增工具：

```text
case_plan(name, summary, startUrl?, steps)   → 生成可执行用例计划卡，不写库
```

新增事件：

```text
event:ai-plan-proposal   → AiPlanProposal
event:ai-plan-progress   → { proposalId, runId, index, total, status }
event:ai-plan-result     → { proposalId, runId, status, steps, error? }
```

新增通道：

```text
ai:plan-run       { proposalId, caseFile } → { runId }
ai:plan-stop      {}                       → ok
ai:session-list   { limit? }               → AiSessionRow[]
ai:session-get    { id }                   → { session, messages }
ai:session-delete { id }                   → ok
```

保存用例复用 `case:create` / `case:update`。

## 8. 验收

1. 在演示页对 Copilot 说「从当前页面生成一条测试用例」。
2. AI 先 `browser_snapshot`，再 `case_plan`；输入框上方出现计划卡，包含填写、点击、断言三步。
3. 删除一步再移回，卡片步骤数与顺序正确；修改填写值后执行，页面输入的是新值。
4. 点「在中栏执行」：中栏能看到真实操作；卡片逐步打勾，结束后显示通过时长与截图。
5. 点「保存为用例」：用例出现在左侧树，步骤数与卡片一致；打开后元素定位器可回放通过。
6. 未执行直接保存时显示「未验证」。
7. 发消息后打开「历史」：能看到当前会话；点进去消息、工具卡与截图完整恢复；继续发消息沿用同一会话。
8. 重启 Agent 后打开历史，之前的会话仍可读取并继续。
9. 全量 `lint / typecheck / unit / build / e2e` 通过。

## 9. 交付顺序

1. **会话持久化**：迁移、实体、仓储、CopilotService 落库、IPC、历史弹层、单测。
2. **计划卡**：`case_plan` 工具、ref 解析与候选生成、事件与草稿卡、执行 / 停止 / 保存、E2E。
3. **文档与真实模型验证**：更新本文件与 Stage 2.3 状态；用真实模型生成并执行一条计划。

每一步单独可验证，不把两个功能绑成一个提交。

## 10. 风险与已知边界

- 计划卡的目标元素在生成时解析；页面结构变化后定位会失效，执行失败时提示重新生成。
- 计划不做数据驱动与变量替换以外的参数化；需要多组数据时走后续 L4。
- 会话正文包含页面文本与操作参数，属于本地测试数据；不提供导出与云同步。
- 恢复的模型上下文只有文本，不含历史工具调用细节，可能比连续在线的上下文略少；必要时 AI 会重新读取用例或页面。

## 11. 交付验证

### 自动化

- Core：新增 `ai-sessions.test.ts`，覆盖会话创建、消息顺序、工具卡、消息数统计、删除，以及「在已有库上补第二个迁移」。
- Agent：新增 `case-plan.test.ts`，覆盖 ref 解析为持久定位器、自定义下拉 `mode=custom`、页面级断言、失效 ref 与缺少 ref/value 的可行动错误。
- Agent：新增 `service-session.test.ts`，模拟 Agent 重启后从 SQLite 恢复历史并继续同一会话；消息数从 2 增长到 4。
- E2E：在 Stub 下走通「从页面生成计划卡 → 中栏执行 → 提示已通过 → 保存为用例」，并通过 IPC 校验新用例为 3 步、2 个元素、填写值以 `AI计划_` 开头；同时校验会话落库与历史恢复。
- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm e2e` 全部通过。

### 真实模型

用本机 `deepseek-flash` 实测：

1. 在演示页发送「从当前页面生成一条测试用例：填写内容名称，保存，并验证保存成功。只提议计划，不要自己执行。」
2. AI 先快照页面，再调用 `case_plan`，生成「内容管理-填写内容名称并保存」计划卡。
3. 点「在中栏执行」后真实 Chrome 完成填写与保存，卡片状态变为「已通过」。
4. 点「保存为用例」成功写入，卡片显示「已保存为用例」。

### 顺手修复

启动阶段 UI 会先发一次 `view:emulate({clear:true})`，此时 Chrome 尚未就绪会产生一次 500。现在 Agent 在浏览器未就绪时直接忽略这次初始化调用，日志不再出现无关错误。

## 12. 后续

单步调试（下一步 / 继续 / 断点 / 暂停时查看变量）已单独排期，Runner 会在 `runCaseOnPage` 中增加 `beforeStep` 钩子；计划卡的执行控制器可以直接复用。
