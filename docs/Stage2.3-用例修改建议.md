# Stage 2.3 补充：用例修改建议

日期：2026-10-19
状态：已交付（2026-10-19）

## 1. 问题

到 Stage 2.2，Copilot 已经能读用例、发现冗余步骤。例如「登陆」用例里有一次账号框回车和一次重复填写，AI 能准确说出来。

但闭环断在最后一步：它只能用文字建议，用户还得自己回到步骤面板逐步删除。如果让 AI 直接调用 `case:update`，风险更大——用户没看到改了什么，用例就变了。

这一期补的是「提议 → 看 diff → 确认应用」：

1. AI 只提交修改建议，不写数据库。
2. 界面把建议渲染成逐步 diff，用户逐条看清后再决定。
3. 应用后可以撤销；期间用例被改过则拒绝应用。

## 2. 边界

写入仍然由用户触发：

- `case_propose` 只生成 `event:ai-case-proposal`，不调用 `case:update`。
- 系统提示明确要求 AI 不能声称「已修改」，只能说「已生成建议」。
- 应用、忽略、撤销三个动作都在用户的点击里发生。
- 应用前以服务端最新的 `updatedAt` 复核一次，避免覆盖用户在建议生成后的手动保存。

## 3. 提案数据

```ts
interface AiCaseProposal {
  proposalId: string
  caseId: string
  caseName: string
  summary: string          // 一句话说明改了什么、为什么
  baseUpdatedAt: string    // 生成建议时用例行的更新时间
  before: CaseFile         // 生成建议时的完整快照
  after: CaseFile          // 修改后的完整用例
  createdAt: string
}
```

同时携带 `before` 与 `after`，而不是只带 `after`：

- diff 以生成建议时的快照为基准，不会因为期间有人改了用例而显示成另一组差异。
- 撤销直接使用 `before`，不依赖前端缓存是否还在。
- 冲突检测只需要比较 `baseUpdatedAt` 与当前行的 `updatedAt`。

## 4. 操作集

模型提交的是「改哪几步」，不是一整份新用例：

| 操作 | 参数 | 说明 |
| --- | --- | --- |
| `remove_step` | `stepId` | 删除冗余步骤 |
| `update_step` | `step`（完整步骤） | 修改参数、显示文案或断言 |
| `add_step` | `step`、`afterStepId?` | 在指定步骤后插入；省略则追加 |
| `move_step` | `stepId`、`afterStepId?` | 调整顺序 |
| `update_case` | `name`、`startUrl`、`intent`、`groups`、`variables` | 整体替换所传字段 |
| `upsert_element` | `element` | 新增或更新元素 |
| `remove_element` | `elementId` | 删除元素；仍被步骤引用时拒绝 |

为什么不直接提交 `steps` 全量数组：

1. 不需要修改的步骤不用原样回显，模型少抄一遍，就不会把 `display`、`condition` 等字段漏掉。
2. 平台按 `step.id` 计算 diff，新增/删除/修改/换序都能准确归类。
3. 应用前可以逐条校验引用完整性。

校验规则：

- 步骤 id 必须唯一；用例至少保留一个步骤。
- 步骤引用的 `elementId` 必须存在于合并后的 `elements`。
- 步骤的 `groupId` 必须存在于合并后的 `groups`。
- 删除仍被引用的元素直接报错，错误回给模型重试。
- 应用后没有产生任何变化时拒绝生成空提案。

## 5. 应用与撤销

应用：

1. 重新读取 `case:list`，比较该用例的 `updatedAt` 与 `baseUpdatedAt`。
2. 不一致 → 卡片进入冲突状态，禁用应用，提示让 Copilot 重新生成。
3. 一致 → 调用 `case:update(proposal.after)`，写入内存缓存并刷新用例列表。
4. 卡片切到「已应用」，保留 diff，提供「撤销」。

撤销调用 `case:update(proposal.before)`，然后用最新的行更新时间刷新 `baseUpdatedAt`，卡片回到待应用状态。用户可以再次应用，不会因为撤销产生的 `updatedAt` 变化被误判为冲突。

## 6. 界面

- 建议卡固定在 Copilot 输入框上方，不跟随消息列表滚走。
- 头部：用例名、AI 的摘要、`−n / +n / ~n` 计数、步数变化。
- 中部：按 `after` 顺序列出新增与修改的步骤，再列出删除的步骤；修改项显示「旧 → 新」，显示文案相同则写「参数有调整」；最多展示 6 项，超出折叠。
- 换序与用例元信息变化用独立标签提示。
- 冲突提示为琥珀色说明，应用按钮禁用。
- 已应用状态显示「已写入用例 / 撤销」；关闭卡片只移除建议，不回滚。
- 多条建议可以同时存在；应用其中一条后，其余建议会因服务端复核失败而进入冲突状态。

## 7. 接口变更

新增工具：

```text
case_propose(caseId, summary, operations)   → 校验操作集并提交建议
```

新增事件：

```text
event:ai-case-proposal                      → AiCaseProposal
```

没有新增 invoke 通道；应用与撤销复用现有的 `case:update`。

## 8. 验收

1. 选中「登陆」用例，对 Copilot 说「找出冗余步骤并给出修改建议」。
2. AI 先 `case_get`，再 `case_propose`；输入框上方出现修改建议卡，列出删除的两步。
3. 点「应用修改」后步骤数从 6 变 4，左侧树与步骤页签同步刷新。
4. 点「撤销」后恢复 6 步；再次应用仍然可用。
5. 建议生成后手动保存一次用例，再点应用，界面提示冲突并拒绝写入。
6. AI 的回复中不能出现「已经修改」这类表述。
7. Markdown 回复中的表格、加粗、列表正常渲染。

## 9. 交付验证

### 自动化

- Agent 单测：37 个通过。新增 `proposals.test.ts` 覆盖删除/修改/新增/移动/元信息更新、元素引用校验、重复 id、空用例、无变化提案。
- E2E：在 StubProvider 下走通「生成建议 → 卡片显示 4 步 → 3 步 → 应用 → 撤销 → 恢复 4 步」，并校验 IPC 里的真实步骤数。
- `pnpm biome check`、两个应用 typecheck、生产构建均通过。

### 真实模型

用本机 `deepseek-flash` 实测：

1. 对「登陆」用例说「找出冗余步骤并给出修改建议，只提议不要直接改」。
2. AI 调用 `case_get`、`workspace_state`、`run_get`，随后 `case_propose`，建议删除 `s-002`（账号框回车）与 `s-003`（重复填写账号），摘要解释了中途提交的风险。
3. 卡片显示 `−2`、`6 步 → 4 步`；应用后 IPC 查询为 4 步，左侧树同步为 4 步。
4. 撤销后 IPC 查询恢复 6 步。
5. 另发一条要求用 Markdown 表格总结的消息，回复渲染出 1 个表格、6 行数据、2 条无序列表与加粗文本，`**` 不再原样显示。

## 10. 运行态恢复（2026-10-19 补充）

实际使用中出现过一次「卡死」：输入框一直显示「停止」，点停止没有反应。

原因不是模型请求没结束，而是 SSE 短暂断线时 `ai-done` 丢了。前端 `aiRunning` 永远保持 true；此时服务端已经没有活动任务，`ai:cancel` 找不到可中止的请求，属于空操作，界面就再也回不到可发送状态。

修复分三层：

1. **停止按钮兜底**：调用 `ai:cancel` 后，无论服务端是否存在活动任务，本地都解除执行态；有 pending 消息时标记为已取消。
2. **运行态快照**：新增 `event:ai-state`。SSE 建连 / 重连时下发一次，之后每 5 秒随心跳下发。收到 `running: false` 时，前端清掉残留的转圈与活动工具。
3. **日志**：Agent 输出 `[ai] start / tool start / tool ok / tool error / done / cancel ignored / error`，工具输入与用户文本不落日志，错误信息做常见密钥形态脱敏。

验证方式：用 Playwright 在页面初始化时拦截 `ai-done` 事件，模拟断线丢失。界面在 5 秒心跳内自动恢复为「发送」；另一组测试中点击「停止」也能立即恢复。全量 E2E 通过。

## 11. 实时画面订阅泄漏（2026-10-19 补充）

实际使用中「很多地方都会卡死」，保存、开弹层、切换标签页后都可能出现。日志里的服务端请求全部是毫秒级，问题不在 IPC；`/api/state` 的 `liveSubscribers` 暴露了真正的原因：**实时画面订阅只增不减**。

根因：

- 中栏实时画面是 MJPEG 长连接。弹层打开、标签页切后台、流重连时，React 会卸载或替换 `<img>`。
- **移除 `<img>` 或停止渲染并不等于取消请求**。Chrome 会继续下载这条 multipart 流，服务端的订阅者集合也就不会减少。
- 每次开弹层、切标签、重连都留下一份死订阅。服务端持续向死流写帧，浏览器端多个长连接占满同源连接池，新的 `fetch` 开始排队——表现就是「很多地方都会卡死」。

修复：

1. **显式结束流**：暂停时把 `<img>` 的 `src` 换成 1x1 data URI，而不是仅仅卸载元素；这样 Chrome 会真正 abort 请求，服务端 `cancel` 生效。
2. **两种暂停条件**：标签页 `visibilityState !== 'visible'`；舞台被弹层 / 下拉遮挡（复用 `hideForOverlay`）。
3. **降低推流成本**：screencast 从 1600×1000/q60/每帧 改为 1280×800/q55/每 3 帧，服务端分发上限约 6fps。
4. **可观测**：`/api/state` 增加 `sseClients`、`liveSubscribers`；日志增加 `[sse] connect/disconnect`、`[live] stream open/closed`、`[ipc] ->/<-`。

验证：

- 无头浏览器实测：舞台打开 `liveSubscribers=1`；切到后台或打开模型设置弹层后变为 0；恢复可见 / 关闭弹层后回到 1，且不再出现重复连接。
- E2E 新增「实时画面暂停/恢复」断言，全量通过。

## 12. 自定义下拉选择（2026-10-19 补充）

录制 Element Plus、Ant Design 等组件库的下拉时，采集到的是 `role="combobox"` 的 `<input>`，而不是原生 `<select>`。回放与 Copilot 的 `browser_select` 直接调用 `selectOption` 会报 `Element is not a <select> element`。

修复：

1. `browser_select` 先读取目标标签：`select` 走原生 `selectOption`（允许按 value 或可见文本匹配）；其余走新增的 `selectCustom`。
2. `selectCustom` 的流程：必要时点击触发器展开 → 等待可见弹层（`listbox` / `menu` / `.el-select-dropdown` / `.ant-select-dropdown` 等）→ 按 option / menuitem / 精确可见文本匹配并点击。
3. 点击前检查 `aria-expanded`，已展开时不再点击，避免把弹层收起。
4. 选中校验：option 的 `aria-selected`、触发器文本/值包含选项，或弹层已收起（部分组件库不写 aria 状态）。
5. 失败时输出诊断：可见弹层数、触发器文本/值/展开状态、可见选项列表，便于定位是文案不一致还是弹层结构不同。
6. 录制得到的 `select` 步骤在 `mode=custom` 时同样走这套逻辑。

验证：

- 新增 `select-custom.integration.test.ts`，用 Element Plus 结构夹具覆盖「展开选择」「已展开不重复点击」「选项不存在报错」，Runner 18 个测试通过。
- 真实模型在用户实际应用上执行 `browser_select`，612ms 选中「电影」，7 次工具调用全部成功。
- 全量 E2E 通过。

## 13. 已知边界

- 撤销会恢复到应用前的快照。如果应用之后又手动改过用例，点撤销会覆盖这些改动；当前没有二次确认。
- diff 卡只展示步骤与用例元信息，元素定位器的候选变化没有专门的对比视图。
- 应用后 AI 的上下文里仍是旧用例；用户继续对话时，AI 需要重新 `case_get` 才能看到最新结构（系统提示已要求修改前先读取）。
- 计划编辑、会话持久化、从录制生成技能不在这一期。
