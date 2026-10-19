# Stage 2.5：命名统一与语音输入

日期：2026-10-19
状态：已交付（2026-10-19）

## 1. 问题

1. 产品里的 AI 助手一直叫「Copilot」，与「AI 计划」「AI 调用方式」「模型设置」等命名不统一。
2. AI 输入框只有键盘输入。测试同学在描述页面操作时，用语音口述比打字更自然。

这一期做两件事：

- 用户可见文案与内部代码标识统一从 Copilot 改为 AI。
- AI 输入框新增语音按钮，使用浏览器自带的 Web Speech API 把识别结果追加到输入框。

## 2. 边界

- 不接入第三方语音 API，不需要密钥；音频由浏览器处理，ATP Agent 不接触音频流，不落盘。
- 使用浏览器默认的识别通道；是否在设备本地识别由浏览器与系统语音包决定，平台不自动下载语言包。
- 只在支持 `SpeechRecognition` / `webkitSpeechRecognition` 的浏览器显示麦克风按钮（Chrome、Safari）；Firefox 隐藏。
- 语言固定 `zh-CN`。识别结果只追加到输入框，不自动发送。
- 不支持语音编辑指令（删除、撤销、格式化）；听写文本与键盘输入走同一条发送链路。

## 3. 命名

| 旧 | 新 |
|---|---|
| `apps/agent/src/copilot/` | `apps/agent/src/ai/` |
| `CopilotService` / `CopilotEvent` / `CopilotProvider` | `AiService` / `AiEvent` / `AiProvider` |
| `CopilotSkill` / `COPILOT_SKILLS` | `AiSkill` / `AI_SKILLS` |
| `CopilotTool` / `COPILOT_TOOLS` / `COPILOT_TOOL_MAP` | `AiTool` / `AI_TOOLS` / `AI_TOOL_MAP` |
| `CopilotPanel` / `AiRightTab: 'copilot'` | `AiPanel` / `'ai'` |
| 用户文案「Copilot」 | 「AI」 |

系统提示词改为「ATP 的 AI 测试助手」。IPC 通道与事件本来就是 `ai:*` / `event:ai-*`，保持不变。页签状态不持久化，无需迁移。

## 4. 语音输入

### 4.1 Hook

新增 `apps/web/src/ai/useSpeechInput.ts`：

```ts
useSpeechInput({ lang = 'zh-CN', onFinal })
  → { supported, listening, interim, error, start, stop, cancel, toggle }
```

- 每次开始新建一个 `SpeechRecognition`，设置 `continuous = true`、`interimResults = true`、`lang = zh-CN`。
- `onresult` 只把 `isFinal` 的片段交给 `onFinal`；临时结果放在 `interim` 里做提示，不写输入框。
- `stop()` 保留已说出的结果；`cancel()` 调 `abort()` 并丢弃尚未返回的结果，用于发送与卸载。
- `onend` 结束聆听，不自动重启，避免权限失败时反复弹窗。
- 错误映射为中文：权限被拒绝、未检测到麦克风、语音服务连接失败、没有听到语音、不支持中文、其他。
- `apps/web/src/ai/speech.ts` 提供最小类型声明（TS 的 DOM lib 不含 Web Speech API）。

### 4.2 界面

在输入框底部工具栏、发送/停止按钮左侧加入麦克风图标：

- 空闲：灰色 `Mic`，`aria-label="语音输入"`。
- 聆听中：红色高亮、脉冲圆点，提示行显示「正在聆听…」与临时识别文本；按钮变为「停止语音输入」。
- 出错：提示行显示「语音输入不可用：…」。
- AI 执行中禁用。
- 发送时先 `cancel()`，避免识别结果落到已清空的输入框。
- 识别结果追加到已有文本，中间补一个空格。

## 5. 验收

1. 右侧页签、面板标题、顶栏入口、⌘K、空状态、模型设置、操作库入口、消息落款均显示 AI；源码与用户界面文案中不再出现旧名称（本文件作为迁移记录保留旧名）。
2. 点击语音按钮，首次弹出麦克风权限；允许后口述内容出现在输入框，再点按钮停止。
3. 拒绝权限时输入框下方显示可读错误，页面不崩溃。
4. Firefox 不显示语音按钮；Safari 可用。
5. 语音内容发送后 AI 正常处理；录制、回放、调试等既有流程不受影响。

## 6. 交付验证

- E2E 用假的 `SpeechRecognition` 验证「点击语音按钮 → 识别文本回填 → 按钮恢复空闲」，不依赖真实麦克风。
- E2E 的页签与文案定位同步改为 AI。
- `pnpm lint / typecheck / test / build / e2e` 全部通过。

## 7. 已知边界

- Chrome 的默认识别通道可能使用浏览器语音服务；如需强制本机识别，需要系统语音包已安装，后续可在设置里增加显式开关。
- 连续识别在长时间静音后可能由浏览器自行结束；本期不自动重启。
- 不支持多语言切换与语音命令。
