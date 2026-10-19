# Stage 2：AI 设计方案（待确认）

> 2026-10-19 · 目标：让 AI 成为测试工作台里的操作者与作者，而不是一个挂在右边的聊天抽屉。
>
> 结论先行：**不做悬浮抽屉，也不做以聊天为中心的界面**。AI 是右侧检查器里的一个常驻页签，配合三处「业务现场入口」和一个 `⌘K` 命令栏；AI 的产物是可编辑的测试计划/用例草稿，而不是一段对话。
>
> **已拍板**：① 右侧常驻页签；② 用例修改走计划卡/diff 卡显式应用；③ 默认模型 `deepseek-flash`（可配置）；④ 接入层用 Vercel AI SDK + 自有 `AiProvider` 封装（分析见 §6.3）。
>
> **能力边界（已确认）**：AI 必须是真正的 Browser Use Agent——能感知页面、自主规划、操作浏览器、验证结果，而不是只会改用例文本。所有操作在中栏实时可视化：目标高亮、动作说明、步骤进度、证据回看。

## 1. 问题定义

当前工作台的三栏职责已经清楚：

- 左：用例库与计划。
- 中：会话舞台（启动台 / 实时镜像 / 运行回看）。
- 右：步骤、元素、报告。

AI 如果以「抽屉」形式盖在中栏上，会出现四个问题：

1. **挡现场**：AI 操作浏览器时，用户最想看的是中栏镜像，抽屉恰好盖住它。
2. **注意力来回跳**：看面板 → 看页面 → 回面板，每次切换都要重新定位。
3. **上下文靠人搬运**：用户得把「哪个用例、哪一步、什么报错」复制进输入框。
4. **聊天记录不是工件**：对话结束后，没有留下可执行的用例、可回看的操作记录。

这不是我们独有的判断。2025–2026 年一批产品都在从「右侧 AI 抽屉」转向分层入口：微软把侧栏定位为当前任务的轻量上下文助手，重任务交给全屏工作区；Cursor 把工具调用做成可折叠卡片并提供密度控制；Claude Code 类产品把工具调用、结果、子任务内联成可折叠的卡片，完成后默认收起。也有中文产品分析直接指出，右侧抽屉的使用率低、打断工作流、与画布上下文脱节（该文给出的次月留存 <5% 属于其样本结论，不是行业定论，但问题描述与我们的观察一致）。

对我们的启示是：**AI 必须贴着「用例 / 运行 / 页面」工作，入口在业务现场，产物要落成工件。**

## 2. 设计原则

| 原则 | 具体做法 |
| --- | --- |
| 舞台永远可见 | AI 不覆盖中栏；AI 操作时中栏保持实时镜像 |
| 入口贴着任务 | 失败步骤旁「分析失败」、用例头「补断言/优化」、启动台「一句话建用例」 |
| 上下文自动带上 | 当前 URL、选中用例、选中运行/失败步骤、页面选中元素自动成为上下文 chip |
| 过程可见、默认收拢 | 工具调用卡片实时出现；完成后折叠成一行，可展开看参数与结果 |
| 产物优先 | AI 的交付物是计划卡、用例 diff、失败归因，不是一段散文 |
| 可中断 | 任何执行中都能「停止」，停止后保留已完成的部分 |
| 不假装 | 显示真实步骤名与耗时；每轮结束给出「已验证 / 假设 / 未完成」 |
| 本机优先 | 只把必要上下文发给模型；截图按需上传，不默认上传 |

## 3. 界面结构：三处入口 + 一个常驻页签

### 3.1 常驻 AI 页签（不做抽屉）

右侧检查器从 3 个页签变成 4 个：**步骤 / 元素 / 报告 / AI**。

```
┌──────────────┬──────────────────────────────────────┬──────────────────────┐
│  用例库       │  ◐ AI 操作 · 3/8「保存」 00:06 [停止][接管]│ 步骤 元素 报告 AI│
│              │        ┌────────────────────┐        │ ──────────────────── │
│  默认项目     │        │  ┌──────────────┐  │        │ 上下文 chips          │
│   ├ 登录      │        │  │  [保存] ←高亮 │  │        │ [用例 登录] [失败 #3] │
│   ├ 播放      │        │  └──────────────┘  │        │                      │
│   └ 搜索      │        │   Chrome 实时镜像   │        │  对话 / 工具卡片      │
│              │        └────────────────────┘        │  ▸ 点击「保存」 1.2s  │
│              │        点击「保存」 · 已截图          │  ▸ 断言 列表包含…     │
│              │                                      │ ┌──────────────────┐ │
│              │                                      │ │ 问 AI…  ⌘K  │ │
│              │                                      │ └──────────────────┘ │
└──────────────┴──────────────────────────────────────┴──────────────────────┘
```

关键细节：

- **宽度可拖拽**：右侧默认 404px，可拖到 360–560px，宽度记在本地。中栏最小可用宽度 640px，低于时不再允许继续拉宽。
- **AI 运行时自动出现状态条**：状态条放在中栏顶部（与录制/回放/计划同一条槽位），36px 高，不覆盖镜像；显示当前工具名、步号、耗时和「停止 / 接管」。
- **中栏可视化**：AI 操作时在镜像上叠加目标元素高亮框与动作说明（点击 / 输入 / 选择 / 断言）；每步自动截图，底部说明条可展开证据。高亮坐标来自工具返回的 `getBoundingClientRect` 与视口尺寸，按 `object-contain` 映射到镜像显示区域，不修改被测页面 DOM。
- **接管**：状态条的「接管」= 停止 AI 循环 + 聚焦真实 Chrome；已完成动作与证据保留，不丢上下文。
- **页签切换不抢焦点**：会话从 AI 页签发起时停留在 AI；从上下文按钮发起时自动切到 AI；AI 持续运行时如果用户切到「步骤」，AI 页签显示活动小圆点，不强行拉回。
- **收起检查器**：保留现有「启动台整幅模式」；AI 页签也遵循这一规则，没有打开任何东西时整幅显示启动台。
- **窄窗口降级**：宽度 < 1100px 时，右侧页签改为覆盖中栏的全高面板（带返回按钮）；再窄则用底部全屏面板。桌面为主，降级只保证可用。

### 3.2 三处业务现场入口

不要求用户先打开聊天框再描述问题，入口直接出现在需要 AI 的地方：

1. **失败步骤旁**（报告 / 运行回看）：「分析这一步」
   - 自动上下文：用例、运行、失败步骤、错误信息、候选定位、截图。
   - AI 首轮输出：失败归因（定位失效 / 遮挡 / 时序 / 数据）+ 建议修复 + 一键生成 diff。
2. **用例头部**：「补断言」「优化步骤」「生成用例描述」
   - 自动上下文：整个用例结构、元素表、最近一次运行。
3. **启动台 AI 输入框**：「用一句话开始测试」
   - 自动上下文：当前页面、选中项目；目标是产出一份可编辑的计划。
   - 录制中也可用：「帮我完成当前这一步」。

这些入口都是普通按钮，不打开任何浮层；点击后切到 AI 页签并带上上下文。

### 3.3 `⌘K` 命令栏

一个居中的临时命令面板（Spotlight 形态），不是聊天抽屉：

- 输入框第一行永远是「问 AI：<输入>」，回车发送到页签。
- 下方是动作列表：分析当前失败 / 从当前页面生成用例 / 为当前用例补断言 / 运行当前用例 / 打开演示页 / 新建用例 / 最近会话。
- `Esc` 关闭，焦点回到原处；命令面板不保留历史，历史在 AI 页签里。
- 没有选中任何对象时，动作会自动隐藏或禁用，并说明原因。

### 3.4 为什么不是其他形态

| 形态 | 判断 |
| --- | --- |
| 悬浮抽屉（原型里的做法） | 盖住镜像、打断视线，弃用 |
| 中栏聊天为主 | 与「舞台中心」冲突，AI 会取代现场，弃用 |
| 底部常驻聊天条 | 长期占用舞台高度；只保留 `⌘K` 作为快捷入口 |
| 独立窗口 | 上下文断裂，弃用 |
| 右栏页签 + 现场入口 + `⌘K` | **采用**：不挡舞台、上下文自动、入口贴着任务 |

## 4. 对话与工具卡片

### 4.1 一次 AI 回合的结构

```
用户指令（可带上下文 chips）
├─ 思考摘要（默认折叠，一行）        ← 不展示逐字推理
├─ 工具卡片 1（点击「内容管理」）
├─ 工具卡片 2（填写「内容名称」）
├─ 工具卡片 3（断言 列表包含…）      ← 失败时自动展开
├─ 助手说明（2–4 句）
└─ 结论脚注：已验证 / 假设 / 未完成
```

- 工具卡片按时间顺序内联，不集中堆在回答下方。
- 同一工具连续调用合并为一张卡：「点击 ×3」，展开后逐条显示。
- 完成后整轮默认收拢为摘要；用户点「展开过程」看全部卡片。提供「简洁 / 标准 / 详细」三档密度，默认标准。
- 流式输出时保持输入区位置稳定；用户向上滚动后停止自动跟随，出现「回到最新」。

### 4.2 工具卡片规格

折叠态（一行）：

```
[图标] 点击「保存」            ✓ 完成 · 1.2s   ▸
```

展开态：

- 参数：语义化字段（目标名称、值），不直接展示 CSS/XPath。
- 结果：成功摘要；失败时显示错误、候选元素、遮挡归因。
- 证据：操作后截图缩略图，点击在中栏打开该帧（回看模式），旁边有「在实时画面中查看」。
- 失败卡：红色左侧竖线，自动展开，附「让 AI 修复这一步」。

状态：排队 / 执行中（工具名 + 已耗时，可停止）/ 完成 / 失败 / 已取消。禁止无限 spinner。

### 4.3 上下文 chips

输入框上方固定显示本轮会发送的上下文：

```
[页面 内容管理 ×] [用例 新建电影 ×] [失败步骤 #3 ×] [+ 添加]
```

- 默认自动带：当前 URL；选中的用例；选中的运行/失败步骤；元素检查器里选中的元素。
- 用户可移除；移除后本轮不再发送。
- 不默认发送截图、Cookie、Storage。模型需要看画面时调用 `browser.screenshot` 工具按需获取。

## 5. 核心能力：Browser Use、计划与用例

这是 Stage 2 的主交付物，也是与「聊天机器人」的分水岭。

### 5.1 Browser Use 循环

AI 不是「一次生成一段脚本」，而是像人一样循环：观察 → 决策 → 操作 → 验证。

1. **观察**：`browser.snapshot` 返回当前 URL、标题、可交互元素的语义列表（ref / 角色 / 名称 / 值 / 状态）；必要时 `browser.screenshot` 取画面。
2. **决策**：模型决定下一步；任务超过 3 步时先用 `agent.update_plan` 写出或更新计划。
3. **操作**：调用 `browser.click / fill / select / check / press / scroll / navigate`，统一走真实 Chrome；每次操作返回目标元素矩形与视口尺寸，供中栏高亮。
4. **验证**：操作后自动重新快照；关键节点调用 `browser.assert_visible / assert_text / assert_value`；失败时保留现场，允许重试或改计划。
5. **收尾**：给出已完成 / 已验证 / 未完成；需要时把过程沉淀为用例。

约束：

- 单轮最多 20 个模型步，单任务默认 5 分钟；达到上限暂停并汇报，不静默继续。
- 每次操作后自动截图作为证据；模型默认只看语义快照，需要看画面时显式调用 `browser.screenshot`。
- 工具只暴露语义操作，不提供任意 `evaluate`；定位不猜 CSS/XPath。
- AI 操作与人工操作走同一套录制、回放、证据链路，行为不分叉。
- 随时可停止/接管；停止后保留已完成动作与证据。

「真的 Agent」体现在三件事：**自主循环、页面感知、结果验证**，而不是把一句自然语言翻译成一段固定脚本。

### 5.2 计划卡片

AI 对「生成用例」类请求，优先生成计划卡；执行时仍走 Browser Use 循环，逐步观察与验证：

```
┌ AI 计划 · 新建一条电影内容 ─────────────────────┐
│ 1  打开  内容管理                            编辑 │
│ 2  填写  内容名称 = 「测试电影」                   │
│ 3  选择  节目类型 = 电影                          │
│ 4  开启  显示标题                                │
│ 5  点击  保存                                    │
│ 6  断言  列表中包含「测试电影」                   │
│                                                  │
│ [在中栏执行]  [保存为用例]  [继续讨论]            │
└──────────────────────────────────────────────────┘
```

- 每一步可编辑、删除、拖动排序；目标元素用语义名（角色 + 可读名），不暴露选择器。
- 「在中栏执行」：把计划转成 `CaseFile`，复用现有 runner 在真实 Chrome 执行；中栏实时镜像，右侧步骤逐项打勾，证据落盘。
- 「保存为用例」：执行成功后可保存；未执行也可保存为草稿（标明「未验证」）。
- 执行结果直接反馈到计划卡：每步状态、耗时、证据缩略图；失败步骤可「让 AI 修复」。

### 5.3 直接操作模式（Agent 默认）

对「帮我点开设置页并截图」「把这个流程走一遍」这类任务，AI 直接进入 Browser Use 循环，不必先生成计划：

- 中栏实时镜像 + 顶部 AI 状态条（步号 / 工具 / 耗时 / 停止 / 接管）。
- 镜像上高亮当前目标元素，底部显示动作说明；点击、输入、选择有短促反馈。
- 每步产生工具卡片与截图证据；右侧 AI 同步显示循环进度。
- 结束给出「已验证 / 假设 / 未完成」，并可以把过程保存为用例。

判定规则写进系统提示词：探索性、单步、验证性任务直接操作；要产出可复用用例、或修改已有用例时，先出计划 / diff。默认就是「能操作浏览器」的 Agent，不需要用户额外授权开关。

### 5.4 修改现有用例：diff 卡片

AI 对现有用例的修改不静默写入，而是给出 diff 卡：

```
修改用例「登录」                        +2 步  ~1 步  -0 步
  3  点击「登录」 → 点击「登录按钮」
  + 4  断言 页面包含「欢迎回来」
  + 5  等待 网络空闲
[应用修改] [放弃]        应用前自动保存版本，可撤销
```

这不是权限审批，而是可逆性设计：浏览器操作可以直接做，不可逆的用例写入给出可检查的变更。

### 5.5 执行记录

每个 AI 会话保留一份动作清单（会话结束后仍可查）：

- 时间、工具、目标、结果、证据链接。
- 用例修改保留版本快照，支持「撤销这一轮」。
- 动作清单不依赖聊天记录存在，聊天只是叙述。

## 6. Agent 侧架构

### 6.1 分层

```
Web UI
  │  POST /api/invoke  ai:*          SSE: ai-delta / ai-tool / ai-plan / ai-done
  ▼
AiService（会话、上下文、取消、持久化）
  ├─ Provider（Vercel AI SDK：DeepSeek / Anthropic / OpenAI-compatible / Stub）
  └─ ToolRegistry（Zod schema + 执行器 + 展示元数据）
        ├─ browser.*   → ChromeController / LiveView
        ├─ case.*      → MikroORM uow
        ├─ run.*       → runner + 证据
        └─ recorder.*  → 现有录制器
```

- `Provider` 接口只暴露流式事件：`text-delta`、`tool-use`、`tool-result`、`done`、`error`。方便用 `StubProvider` 做无网络 E2E。
- `ToolRegistry` 与传输方式无关；后续 `POST /mcp` 直接复用同一份注册表。
- 会话与消息落 SQLite（`ai_sessions` / `ai_messages`），与现有数据层一致；动作清单落 `ai_actions` 或消息内容块。
- 取消：`AbortController` 同时中断模型流与工具执行；已完成的工具卡片保留。

### 6.2 模型与配置

默认 `deepseek-flash`；三种访问方式都要支持，用 profile 配置，不在代码里判断协议：

| 方式 | AI SDK provider | 典型配置 |
| --- | --- | --- |
| DeepSeek 官方 | `@ai-sdk/deepseek` | `DEEPSEEK_API_KEY` + model |
| OpenAI 兼容网关 | `@ai-sdk/openai-compatible` | `baseURL` + key + model |
| Anthropic 兼容网关 | `@ai-sdk/anthropic` | `baseURL` + key + model |
| Claude 官方 | `@ai-sdk/anthropic` | `ANTHROPIC_API_KEY` + model |

`~/.atp-agent/config.json`：

```json
{
  "ai": {
    "active": "company",
    "profiles": {
      "company": {
        "kind": "openai-compatible",
        "baseURL": "https://gateway.example.com/v1",
        "model": "deepseek-flash",
        "apiKeyEnv": "ATP_AI_API_KEY"
      },
      "deepseek": {
        "kind": "deepseek",
        "model": "deepseek-flash",
        "apiKeyEnv": "DEEPSEEK_API_KEY"
      },
      "gateway": {
        "kind": "anthropic",
        "baseURL": "https://gateway.example.com",
        "model": "deepseek-flash",
        "apiKeyEnv": "ATP_AI_API_KEY"
      },
      "claude": {
        "kind": "anthropic",
        "model": "claude-sonnet-5-5",
        "apiKeyEnv": "ANTHROPIC_API_KEY"
      }
    }
  }
}
```

- 环境变量可覆盖：`ATP_AI_PROFILE`、`ATP_AI_MODEL`、`ATP_AI_BASE_URL`、`ATP_AI_API_KEY`。
- 面板头部显示实际 provider / model，可切换 profile；切换只影响新会话。
- 不做登录页；没有 key 或配置错误时显示配置卡（列出读取的变量名与示例），其余功能不受影响。

#### 6.2.1 当前模型目录（2026-10-19 核对）

DeepSeek 已进入 V4 系列，旧模型名 `deepseek-chat` / `deepseek-reasoner` 于 **2026-07-24 15:59 UTC 停用**，不能再作为默认值；`deepseek-v4-flash` 与 `deepseek-v4-flash-vision-exp` 仍被接受但会路由到 V4.1-Flash。

| 模型 ID | 版本 | 上下文 | 最大输出 | 输入 | 思考 |
| --- | --- | --- | --- | --- | --- |
| `deepseek-flash` | DeepSeek-V4.1-Flash-1017 | 1M | 384K | 文本 + 图片 | 默认开启，`low` / `high` / `max`，默认 `high` |
| `deepseek-v4-pro` | DeepSeek-V4-Pro-0813 | 1M | 384K | 文本 | 默认开启，`low` / `high` / `max` |

- Base URL 仍为 `https://api.deepseek.com`，鉴权方式不变。
- 思考模式通过 OpenAI 格式的 `thinking.type` + `reasoning_effort` 控制；AI SDK 对应 `providerOptions.deepseek.thinking` 与 `reasoningEffort`。
- 思考模式下带 `tools` 时，历史里的 `reasoning_content` 必须回传，否则可能 400。AI SDK 的 `responseMessages` 会保留 reasoning 片段；首次接真实 key 时必须验证多步工具循环，不能只在单轮聊天里验证。
- Anthropic 当前模型：`claude-opus-5-5`（通用推荐）、`claude-sonnet-5-5`、`claude-haiku-5-5`、`claude-fable-5-1`。

#### 6.2.2 模型设置弹窗（已实现，2026-10-19）

原型：<prototypes/ai-settings.html>（本地文件，含未配置 / 已保存 / 测试中 / 失败 / 环境变量五种状态）。

- **入口**：顶栏右侧齿轮（全局）；AI 头部的模型徽标（点击打开）；无 key 提示卡上的「打开模型设置」。
- **布局**：单列紧凑弹窗（约 700px），保持与保存用例弹窗一致。自上而下：服务商三选一（DeepSeek / Anthropic / OpenAI 兼容）、密钥、模型、思考强度、接口地址、测试结果；底部固定「取消 / 测试连接 / 保存」。窄屏自动单列滚动。原型里的双栏与「当前生效」卡片不再采用，避免信息重复和视觉噪音。
- **密钥**：只写不读。保存后只显示 `…9f3a` 与来源标签（环境变量 / 本机保存）；输入新值走「替换」；清除需要二次确认，保存后生效。写入 `~/.atp-agent/config.json`（合并已有 profile、原子写入、0600），IPC 与日志不回传明文，错误信息里的密钥会被替换为 `***`。
- **模型**：DeepSeek 默认 `deepseek-flash`，可选 `deepseek-v4-pro`；Anthropic 默认 `claude-opus-5-5`。模型名可手填，也可从服务商 `/models` 刷新后作为候选；下方显示上下文 / 输出 / 图片能力。
- **思考强度**：DeepSeek 暴露「关闭 / 低 / 高 / 最高」，默认高；Anthropic 由模型自行管理；网关不暴露。通过 `providerOptions.deepseek.thinking` + `reasoningEffort` 传入。
- **测试连接**：用当前未保存的值做一次真实调用（`generateText` + `ping` 工具），验证鉴权与工具调用，展示耗时；401 / 403 / 404 / 429 / 超时 / 缺 Base URL 给中文可行动错误，不写入配置。
- **环境变量优先**：环境变量 > 本机配置 > 默认探测。检测到同名环境变量时显示黄色提示条，说明本机保存的密钥不会生效。
- **热生效**：保存后 `AiService.reload()` 重建 provider，不重启 Agent；正在执行的任务持有旧 provider 不被打断，新消息生效。
- **实现面**：`ai:config` 增加 kind / baseURL / hasKey / keyHint / keySource / keyEnv / thinking；新增 `ai:saveConfig`、`ai:test`、`ai:models`；`ai/config.ts` 负责解析与 0600 持久化；`AiSettingsDialog.tsx` 负责界面。实际模型 ID 以服务商返回为准，不做硬编码回退。
- 模型不支持 tool calling 时自动降级为只读问答，并明确提示原因，不静默失败。
- 截图按需上传：模型调用 `browser.screenshot` 才把画面作为工具结果发回；默认只发可访问性快照。

### 6.3 SDK 选型：Anthropic SDK vs Vercel AI SDK（已采用 Vercel）

| 维度 | Anthropic SDK | Vercel AI SDK（采用） |
| --- | --- | --- |
| Provider 覆盖 | 仅 Claude | DeepSeek / Claude / OpenAI-compatible / 20+ |
| 默认模型为 DeepSeek | 需要另写一套 OpenAI 兼容适配与循环 | `@ai-sdk/deepseek` 或 `@ai-sdk/openai-compatible` 直接接 |
| 工具循环 | 自己维护 messages / tool_use / tool_result | `streamText` + `tools` + `stopWhen: stepCountIs(n)` |
| 流式事件 | 原生事件，控制最细 | `fullStream` 的 text/tool-call/tool-result 事件，够用且统一 |
| Claude 专有能力 | 一等公民：prompt caching、thinking、MCP、beta | 通过 provider options 可用，但抽象层可能滞后 |
| 类型与工具 schema | 每个工具的 `tool_use` 输入类型更精确 | Zod schema，跨 provider 统一 |
| 测试 | 自己 mock | 可用 `ai/test` mock；但本项目在 Provider 边界自建 Stub，避免其 Vitest 依赖 |
| 版本风险 | 稳定 | 大版本变动较频繁，需要锁版本 |
| 适配成本 | 双 provider 要两套循环 | 换模型基本是改配置 |

结论：**已确定用 Vercel AI SDK 作为接入层，外面再包一层自己的 `AiProvider` 接口。**

理由：

1. 默认模型是 DeepSeek，未来还可能在 Claude / 其他网关之间切换；统一 provider 接口的价值大于 Claude 专有能力的收益。
2. 工具循环、流式分块、停止条件都是现成的，正好映射到本方案的 SSE 与工具卡片。
3. 抽象层开销约 10–20ms 首 token，对本地测试助手可以忽略。
4. 自有 `AiProvider` 边界保证可撤退：如果以后 Claude 专有能力变得关键，可以只替换这一层，不动会话、工具、UI。

具体做法：

- `ai` + `@ai-sdk/deepseek`（默认）+ `@ai-sdk/anthropic`（可选）+ `@ai-sdk/openai-compatible`（自建网关）。
- 工具用 Zod 定义，直接传给 `streamText`；`stopWhen: stepCountIs(50)` 控制单轮上限，达到上限时向用户说明「任务可能未完成，可回复继续」。
- 消费 `fullStream`，映射成 `ai-delta` / `ai-tool-start` / `ai-tool-result` / `ai-done`。
- 不用 `useChat`，UI 保持自己的消息与卡片模型；SDK 只在 Agent 进程内使用。
- 测试用自建 `StubProvider`，不把 `ai/test` 带进运行时（其在部分版本硬依赖 Vitest）。

### 6.4 语义快照与操作

AI 不猜 CSS/XPath。第一个工具是 `browser.snapshot`：

```
URL: http://…/demo
标题: 内容管理
[e1] textbox  「内容名称」 value="节目_123"
[e2] combobox 「节目类型」 value="电影"
[e3] checkbox 「显示标题」 checked=false
[e4] button   「保存」
```

- 实现：向可交互节点注入临时 `data-atp-ref`，返回角色、可读名、值、状态；操作工具接收 `ref`。
- 导航后 ref 失效，需要重新快照；工具卡片只显示人类可读名。
- 每个操作工具返回 `target: { rect, viewport }`（元素在 CSS 像素下的矩形与视口尺寸），中栏据此在镜像上画高亮框；不改被测页面 DOM。
- 操作后自动截一张低质量证据图，挂到工具卡上。

### 6.5 与录制/回放/计划的关系

- AI 操作走真实 Chrome，因此录制中同样会沉淀为步骤（与人工操作一致），状态条会标明。
- 计划执行复用 `runCaseOnPage`，结果与现有报告、证据、步骤面板完全一致。
- AI 不做「另一套执行引擎」，避免行为分叉。

## 7. 状态、错误与边界

| 场景 | 表现 |
| --- | --- |
| 未配置 key | 配置卡 + 命令示例；不阻塞其他功能 |
| 模型首 token 慢 | 「正在思考…」+ 已耗时；超过 15s 提示可停止 |
| 模型观察页面 | 状态条「正在观察页面…」；显示最后一次快照摘要 |
| 用户接管 | 停止 AI 循环并聚焦 Chrome；已完成动作与证据保留 |
| 工具执行中 | 卡片显示工具名与耗时；顶部状态条可停止 |
| 工具失败 | 卡片自动展开，给候选、遮挡归因与「让 AI 修复」 |
| 流断开 | 保留已收到内容，显示「连接中断，重试」 |
| 达到最大轮数 | 停止并总结已完成、未完成 |
| 会话过长 | 自动摘要旧轮次，保留工件与动作清单 |
| 无选中对象 | 上下文 chips 为空，输入框提示可用的三种问法 |

## 8. 键盘与可访问性

- `⌘K` / `Ctrl+K`：打开命令栏；`Esc` 关闭并把焦点还给触发元素。
- `Enter` 发送，`Shift+Enter` 换行；输入框 placeholder 里写明。
- 工具卡可用键盘展开/折叠；状态变化用 polite live region，不逐 token 播报。
- 尊重 `prefers-reduced-motion`；流式输出不改变按钮位置。
- AI 运行中 `Esc` 不直接取消（避免误触），取消用状态条或卡片上的「停止」。

## 9. 分期与验收

### Stage 2.1：AI 骨架 + 页面感知（先交付可感知的一层）

> **状态（2026-10-19）**：已交付。会话暂存 Agent 内存（单次运行内保留多轮上下文）；SQLite 会话历史与「最近会话」随 2.3 的会话管理一起交付，避免只写不读的半成品。

- 右侧 AI 页签、可拖拽宽度、上下文 chips、命令栏。
- Vercel AI SDK（默认 DeepSeek profile）+ 自有 `AiProvider` 封装 + StubProvider、SSE 事件。
- 感知工具：`browser.snapshot`（语义 ref）、`browser.screenshot`、`case.list/get`、`run.list/get`。
- 工具卡片（折叠/展开/失败态）、思考摘要、结论脚注、顶部 AI 状态条。
- **验收**：选中失败运行 → 点「让 AI 分析」→ 自动带上下文 → AI 先快照/截图再输出归因与建议；全程中栏镜像可见。

#### 2.1 补充：模型设置（真实模型前置）

> **状态（2026-10-19）**：已交付。保存 / 掩码回显 / 0600 权限 / 清除密钥 / 回到演示模式已由 `scripts/e2e-agent.mjs` 自动验证；真实 DeepSeek key 的「测试通过 → 真实工具调用」需在本机粘贴后验收。

- 顶栏齿轮 + AI 模型徽标 + 无 key 提示卡三处入口。
- 支持 DeepSeek 官方 / Anthropic 官方 / OpenAI 兼容网关；密钥、模型、思考强度、Base URL。
- 真实「测试连接」：鉴权 + 一次工具调用；错误可行动；环境变量优先级可见。
- 保存后热生效，写入本机 0600 配置文件，界面不回读明文。
- **验收**：粘贴真实 DeepSeek key → 测试通过 → AI 头部从「演示模式」变为 `deepseek-flash` → 发一条消息能完成真实工具调用。

### Stage 2.2：Browser Use 操作 + 中栏可视化（关键切片）

> **状态（2026-10-19）**：部分交付。环境快照、平台工具（录制/平台状态/case_run）、drag/hover/wait_for、操作库 v1（slider_set / hover_menu / upload_file）与左栏「操作库」已落地，详见 <Stage2.2-环境感知与操作库.md>。iframe、Shadow DOM、自定义下拉与完整动作验证仍在后续。
- 语义 ref 快照、`browser.navigate/click/fill/select/check/press/scroll/wait/assert`。
- Browser Use 循环：观察 → 决策 → 操作 → 验证；自动快照、失败重试、最大步数/时长。
- 顶部 AI 状态条（步号 / 工具 / 耗时 / 停止 / 接管）。
- 中栏可视化：目标元素高亮框、动作说明、点击/输入反馈、每步证据缩略图。
- 动作清单与证据落盘；AI 与人工共用录制/回放链路。
- **验收**：一句「把这个创建流程走一遍」→ AI 自主完成多步操作与断言，中栏能看到高亮与画面变化；停止后 1s 内不再有动作；每步都有可回看的证据；失败时能说明原因并重试或停下。

Stage 2.2 是 Agent 能力的验收门槛：如果只能按固定脚本演示，不算通过。

### Stage 2.3：计划与用例

> **状态（2026-10-19）**：已交付。`case_propose` 工具、修改建议卡、逐条 diff、应用/撤销、应用前冲突复核已落地；`case_plan` 计划卡（生成 / 中栏执行 / 保存为用例）与 AI 会话 SQLite 持久化、最近会话恢复也已完成，详见 <Stage2.3-用例修改建议.md> 与 <Stage2.3-计划卡与会话持久化.md>。

- ~~用例 diff 卡与撤销~~ 已交付。
- 计划卡（编辑/排序/删除）、`在中栏执行`、`保存为用例`。
- AI 会话与消息落 SQLite（`ai_sessions` / `ai_messages`），新增「最近会话」恢复入口。
- **验收**：一句话生成 5 步计划 → 中栏执行通过 → 保存后用例与人工录制的结构一致 → 修改已有用例必须先看到 diff。

### Stage 2.4：MCP 与增强

- `POST /mcp` 暴露同一份 ToolRegistry；外部 MCP 客户端可驱动浏览器与用例。
- 焦点模式（折叠左栏、加宽 AI）、密度控制、会话摘要。
- **验收**：Claude Desktop / 其他 MCP 客户端能列出工具并完成一次录制回放。

每期都跑：`lint`、`typecheck`、`unit`、`build`、`e2e`（StubProvider，不需要网络与 key）。

## 10. 已确认与待补充

已确认：

1. 界面形态：右侧常驻页签 + 现场入口 + `⌘K`。
2. 用例写入：计划卡 / diff 卡显式应用。
3. 默认模型：`deepseek-flash`（可配置）。
4. 接入层：Vercel AI SDK + 自有 `AiProvider` 封装。
5. 三种访问方式都支持：DeepSeek 官方、OpenAI 兼容网关、Anthropic 兼容网关。
6. AI 必须是真正的 Browser Use Agent，操作在中栏可视化。

待补充：

1. ~~`deepseek-flash` 的 endpoint / model id 与 key 的环境变量名~~ 已确认（2026-10-19）：`https://api.deepseek.com`，`deepseek-flash` / `deepseek-v4-pro`，`DEEPSEEK_API_KEY`；旧名已停用。
2. 是否同时接 Claude profile（默认仍 DeepSeek）——设置弹窗已提供 Anthropic 连接，默认仍 DeepSeek。
3. AI 会话是否需要跨重启保留（默认保留在 SQLite，随 2.3 交付）。

## 11. 参考

- AI UI patterns（side dock / tool cards / streaming / anti-patterns）：<https://github.com/truongnat/aix/blob/main/content/skills/design-system-pro/references/ai-copilot-ui-patterns-deep-dive.md>
- LukeW，An Alternative Chat UI Layout（两栏 agentic chat）：<https://www.lukew.com/ff/2135/an-alternative-chat-ui-layout>
- 16 AI agent UI design patterns（plan、tool card、diff、undo、审批分级）：<https://www.setproduct.com/blog/ai-agent-ui-design-patterns>
- Cursor 3.4 changelog（工具调用密度、全屏页签）：<https://cursor.com/ko/changelog/3-4>
- Cursor agent UI UX case study：<https://dev.to/designstudiouiux/how-cursor-nails-ai-agent-ui-design-a-ux-case-study-ng8>
- 右侧 AI 抽屉的产品分析（中文，含留存数据与替代方案）：<http://www.woshipm.com/share/6423032.html>
- Microsoft 365 AI 助手新版设计（侧栏与全屏的分工）：<https://windowsreport.com/microsoft-details-its-ai-forward-copilot-design-system-plan/>
- Claude Code transcript 视图模式讨论（工具调用默认收起）：<https://github.com/anthropics/claude-code/issues/73413>
- Claude Code transcript 卡片实现参考：<https://blog.gitcode.com/3d9bdaa17f8c7d4f4a2c74ede3f24a12.html>
- Vercel AI SDK 文档（streamText / tools / stopWhen / fullStream）：<https://ai-sdk.dev/docs>
- AI SDK Testing（MockLanguageModel、simulateReadableStream）：<https://ai-sdk.dev/v5/docs/ai-sdk-core/testing>
- DeepSeek provider（`@ai-sdk/deepseek`）：<https://ai-sdk.dev/providers/ai-sdk-providers/deepseek>
- OpenAI 兼容 provider（自建网关 / Ollama）：<https://ai-sdk.dev/providers/openai-compatible-providers>
- Anthropic SDK vs Vercel AI SDK 对比：<https://dev.to/muhammad_moeed/claude-agent-sdk-vs-vercel-ai-sdk-6-which-to-pick-in-2026-2jj>

- 语音输入与命名统一见 <Stage2.5-AI语音输入与命名统一.md>。
