# UI/UX 调研与中栏产品形态方案（待确认）

> 2026-10-19 · 调研对象：测试录制/回放产品、浏览器 Agent 产品、Agent 工作台
>
> 结论先行：中栏不应该「换成 AI Agent」。它应该从「浏览器占位」升级为**会话舞台（Session Stage）**；AI 是副驾与命令入口，不是主舞台。

## 1. 问题不是「中间空了」

Web 模式下，真实页面在 Agent 启动的 Chrome 窗口里，中栏只剩一张说明卡。表面看是缺内容，实际是三个问题叠加：

1. **注意力分裂**：用户在 Chrome 窗口操作，在 UI 里看步骤，来回切换。
2. **会话不可见**：录制/回放/计划执行发生在别处，UI 只能显示文字进度，没有「现场」。
3. **空态无入口**：没有页面时，中栏不提供「接下来能做什么」。

如果只是塞一个聊天框，问题 1、2 仍在，而且会让「测试工作台」变成「聊天工具」。同类产品的共同做法是：**把运行现场放在舞台中心，把解释与操作用时间轴/侧栏承载。**

## 2. 同类产品怎么排布

### 2.1 测试录制与回放

| 产品 | 布局 | 关键设计 | 对我们的启示 |
| --- | --- | --- | --- |
| **Playwright UI Mode / Trace Viewer** | 顶部 filmstrip 时间轴；左侧 Action List；右侧 Snapshot / Source / Network / Console | Before / Action / After 三态快照；点动作 → 页面回到那一刻；时间轴可当作日志过滤器 | 中栏应能「点步骤看当时画面」，而不是只有文字步骤 |
| **Cypress Open Mode** | 左 Command Log，右应用预览 | hover 命令 → 预览回到当时状态；点击固定快照 | 步骤与页面状态的联动是核心，不是附属功能 |
| **mabl / Testim / Reflect** | 录制器 + 步骤列表 + 截图/日志证据 | 录制即成用例；失败时给截图、DOM 快照、候选元素 | 证据必须随手可见；「可解释的失败」比花哨动画重要 |
| **QA Wolf** | 运行详情 + WebRTC 实时画面 | 实时观看执行、可接管、移动端也能看 | 实时画面已经是测试产品的默认预期 |
| **Skyvern** | 左 Browser pane（Live / Recording / Screenshots 三视图）+ 右 Run pane 时间轴 | 点击时间轴项 → Browser pane 显示对应截图；「Take control」接管 | 与我们的场景最接近：**现场 + 时间轴 + 接管** 三件套 |
| **Browserbase Director** | 自然语言工作流 + 实时执行可视化 + session replay | 执行过程可视化、回放 | 运行现场是产品的一部分，不是调试附属品 |
| **browser-use web-ui** | 聊天/步骤 + 实时截图视图 | 步骤与截图交错流式输出 | 聊天可以与现场并存，但现场是主视图 |

### 2.2 浏览器 Agent 工作台

| 产品 | 布局 | 关键设计 | 启示 |
| --- | --- | --- | --- |
| **OpenAI Operator / ChatGPT Agent** | 左聊天叙述 + 右实时浏览器；另有 reasoning timeline | 每个动作截图；可随时接管；接管期间不记录 | 「边做边讲」有价值，但双栏叙述容易啰嗦；主视图仍是浏览器 |
| **Claude in Chrome** | Chrome 侧边栏，网页本身是主视图 | 侧边栏承载对话与会话历史；auto-approve；页面不被挤走 | **不要用对话取代页面**；Agent 应贴着页面工作 |
| **Claude Code / Cursor** | 对话/工具调用流 + 文件 diff / 终端等工件 | 工具调用卡片内联；结果落在可检查的工件上 | Agent UI 的本质是「对话 + 可验证工件」，不是纯聊天 |

### 2.3 提炼出的模式

- **P1 舞台中心**：页面或运行现场是主角，聊天/步骤是配角。
- **P2 时间轴绑定**：任一步骤都能定位到那一刻的画面与证据。
- **P3 现场接管**：实时画面之外，必须能一键回到真实浏览器操作。
- **P4 渐进披露**：默认意图视图；原始动作、定位器、诊断按需展开。
- **P5 空态即入口**：空态给最近用例、继续上次会话、打开 URL、开始录制，而不是一句说明。
- **P6 单一注意力**：AI 不抢主舞台，以可折叠副驾或命令栏存在。

反模式：纯聊天居中、没有时间轴的长日志、截图墙、页面与步骤互不关联。

## 3. ATP 的中栏：Session Stage

保持现有三栏骨架（左 288 / 中自适应 / 右 404），中栏按会话状态切换三种形态：

### 3.1 Live（有页面 / 录制 / 回放）

```
┌────────────────────────────────────────────────────────────┐
│ URL / 设备 / 缩放        [打开] [开始录制] [回放用例]        │
├────────────────────────────────────────────────────────────┤
│                                                            │
│             真实 Chrome 的实时镜像（只读）                   │
│             顶部角标：正在录制 · 00:42   [在 Chrome 中接管]  │
│                                                            │
├────────────────────────────────────────────────────────────┤
│ 步骤胶片条：①填写名称 ②选择类型 ③开启标题 ④保存             │
└────────────────────────────────────────────────────────────┘
```

- 镜像默认**只读**，避免半成品输入转发带来 IME、拖拽、文件选择等坑。
- 点击「在 Chrome 中接管」调用现有 `browser:focus`，把真实窗口拉到前台。
- 录制时：红框/计时；新步骤出现时右侧高亮，胶片条追加，镜像可闪一下元素（后续用 CDP Overlay）。
- 回放/计划时：镜像播放当前步骤；右侧步骤逐项打勾；失败停在该帧并展开候选与遮挡归因。
- 实时画面不可用时降级为「最近一步截图 + 状态」，不白屏。

### 3.2 Review（选中一次运行/报告）

- 顶部胶片条按步骤排列截图；点步骤 → 中栏显示该步截图/视频定位。
- 右侧仍是用例步骤与失败归因；中栏负责「看证据」，右侧负责「改用例」。
- 这与 Playwright Trace Viewer / Skyvern 的「时间轴 ↔ 画面」一致，但只保留与测试相关的证据，不堆网络面板。

### 3.3 Launchpad（没有页面）

空态不是说明卡，而是启动台：

- 继续上次会话 / 最近 5 个用例（点击直接回放）。
- 三个主动作：打开被测地址、从当前页开始录制、打开演示页。
- 一个 AI 指令输入框（Stage 2 接入；占位时明确标注「即将支持」）。
- 计划页签下则显示「运行计划」入口与最近执行。

### 3.4 AI 放在哪

- **不放在中栏**。中栏是现场；AI 放在右侧可折叠的「AI」页签，以及全局 `⌘K` 命令栏。
- AI 执行工具调用时，中栏自动切到 Live，让用户看到它在点什么；工具调用卡片显示参数、结果、可撤销操作（后续）。
- 这与 Claude in Chrome 的侧边栏、Cursor 的对话+工件一致：**对话解释，舞台验证**。

## 4. 技术可行性

### 4.1 实时镜像

Agent 已经用 Playwright 控制真实 Chrome，可以直接开 CDP session：

```ts
const cdp = await context.newCDPSession(page)
await cdp.send('Page.startScreencast', {
  format: 'jpeg',
  quality: 60,
  maxWidth: 1600,
  everyNthFrame: 1,
})
cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
  latest = Buffer.from(data, 'base64') // 只保留最新一帧
  pendingAck = sessionId
  await cdp.send('Page.screencastFrameAck', { sessionId })
})
```

- 帧只在页面重绘时产生；静止页面不耗 CPU。
- 必须逐帧 ack，否则流会停。
- 传输方式比较：
  - **MJPEG**（`multipart/x-mixed-replace`）：`<img src="/api/live/stream">` 直接显示，实现最简单、开销最低。**推荐**。
  - SSE + base64：与现有事件流一致，但 base64 膨胀 33%，且会挤占事件通道。
  - WebSocket：为后续交互式接管预留，当前不必。
- 生命周期：有订阅者才启动；页面切换重绑；UI 关闭/Agent 停止时 `stopScreencast`。
- 背压：只保留最新帧；慢订阅者丢帧；JPEG q60、最大边 1600，单帧约 30–120KB。
- 降级：CDP 不可用 → 1–2 fps `Page.captureScreenshot` 轮询 → 最近步骤静态截图。

### 4.2 接管（后续）

交互式镜像需要转发 `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`，还要处理坐标映射、IME、拖拽、文件选择、滚动惯性、新标签页。建议 Stage 3 再做；当前用「聚焦真实 Chrome」即可，行为确定。

### 4.3 与 AI/MCP 的衔接

- Tool Registry 中的 `browser.*` 工具与 Session Stage 共用同一套事件（动作开始/结束、截图、URL）。
- AI 的工具调用卡片直接消费这些事件；AI 驱动时中栏自动 Live。
- MCP 默认可写，不额外加权限层（按已确认的边界）。

## 5. 分期与验收

### Stage 0：空态与证据联动（0.5–1 天，无后端新能力）

- Launchpad：最近用例、继续上次、打开 URL、录制入口。
- Review：用已有运行截图做胶片条，点步骤定位截图。
- 验收：无页面时中栏不出现空白说明卡；选中运行后点任一步骤能看到对应截图。

### Stage 1：实时镜像（2–3 天）

- `LiveViewService` + MJPEG 端点 + 订阅生命周期 + 降级。
- 录制/回放/计划状态与镜像联动；「在 Chrome 中接管」。
- 验收：打开页面 1s 内出画面；录制时 ≥5 fps；关闭 UI 后 screencast 停止、CPU 回落；页面崩溃显示最后帧与状态。

### Stage 2：AI（并入 AI/MCP 切片）

- 右侧 AI 页签 + `⌘K` 命令栏；工具调用卡片；AI 操作时自动 Live。
- 验收：从一句指令到浏览器动作，用户能在中栏看到每一步；没有「黑箱执行」。

### Stage 3：交互式镜像（可选）

- 输入转发、接管/交还模式、接管期间不记录动作。

## 6. 风险与待确认

1. **双视图困惑**：真实 Chrome 与镜像同时存在。缓解：镜像明确标注「只读镜像」，并提供「在 Chrome 中接管」；设置里可关闭镜像只看步骤。
2. **AI 入口位置**：右侧页签 vs 底部命令栏。建议两者都要：常驻用页签，快捷用 `⌘K`。
3. **多标签页**：当前只镜像受控 page；多标签页录制仍在 backlog。
4. **性能**：低配机器上 JPEG 编码约 2–3% CPU；默认 5–8 fps，可在设置里降为「仅步骤截图」。

## 7. Stage 1 实现记录（2026-10-19）

Stage 1 已按方案落地：

- Agent 新增 `LiveView`：CDP `Page.startScreencast` + 逐帧 ack，只保留最新帧，按 8 fps 上限分发。
- `GET /api/live/stream` 返回 `multipart/x-mixed-replace`（MJPEG），UI 用 `<img>` 直接显示。
- 订阅生命周期：首个订阅者接入才启动，最后一个离开 1.2s 后停止；页面重建时重绑。
- 遮挡问题：Chrome 窗口在后台时默认停止重绘，启动参数关闭后台节流；再加 watchdog，2s 无新帧时用截图兜底。
- UI：`LiveMirror` 负责连接/断线重连/兜底态；左上角「实时镜像 · 只读」，右上角「在 Chrome 中接管」。
- E2E 增加实时镜像断言：中栏 `<img>` 的首帧必须成功解码。

仍未做（按计划留给 Stage 3）：输入转发、接管/交还模式、多标签页镜像。

## 8. 参考

- Playwright UI Mode / Trace Viewer：https://playwright.dev/docs/test-ui-mode
- Cypress Open Mode（Command Log、time travel）：https://docs.cypress.io/app/core-concepts/open-mode
- Skyvern Run Details（Live / Recording / Screenshots + timeline + Take control）：https://docs-new.skyvern.com/cloud/viewing-results/run-details
- Browserbase Director：https://www.browserbase.com/ （Director 发布报道：https://martechseries.com/predictive-ai/ai-platforms-machine-learning/browserbase-launches-director-to-automate-the-web-for-everyone-announces-40m-series-b/）
- browser-use web-ui：https://github.com/browser-use/web-ui
- QA Wolf（live streaming / takeover）：https://www.qawolf.com/changelog
- OpenAI Operator（chat + live browser）：https://openai.com/index/introducing-operator/
- Claude in Chrome（side panel）：https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome
- Chrome DevTools Protocol `Page.startScreencast`：https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-startScreencast
- Playwright `CDPSession`：https://playwright.dev/docs/api/class-cdpsession
