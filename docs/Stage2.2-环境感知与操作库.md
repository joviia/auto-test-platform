# Stage 2.2 补充：环境感知与操作库

日期：2026-10-19
状态：已交付（2026-10-19）

## 1. 问题

现在的 Copilot 能看页面、能点击输入，但它只知道自己拿到的一个 URL，不知道平台正在做什么。

举几个例子：

- 用户说「把刚才的登录流程录下来」，它不知道平台有录制模式，也没有开始录制的工具。
- 用户选中了一条用例、一条运行记录，它只能拿到一个 id，不知道名称、步骤数、所属项目。
- 用户说「把音量拖到 80%」，它只能看到 `input[type=range]` 的当前值，看不到最小值、最大值和步长，只能猜坐标。
- 它点击、输入走的是 Playwright 直连，不经过录制器、步骤模型和元素库；操作做完就消失了，不能变成用例，也不能复用。

根因不是模型不够聪明，是 AI 走的链路和平台是并行的。它能操作页面，但不参与平台的业务流程。

这一期做两件事：

1. 把平台状态告诉 AI，并给它读取、录制、使用技能的入口。
2. 把复杂控件的操作做成确定性的「技能」，让 AI 直接调用，不用每次猜。

## 2. 环境快照

每次发消息，前端把当前工作环境压成一个对象，随 `ai:send` 一起传给 Agent。

```ts
interface AiEnvironment {
  mode: 'launch' | 'editing' | 'recording' | 'replaying' | 'plan'
  url?: string
  navTab?: 'cases' | 'plans' | 'skills'
  selectedKind?: 'project' | 'module' | 'case' | 'plan' | 'skill'
  projectId?: string
  projectName?: string
  caseId?: string
  caseName?: string
  planId?: string
  planName?: string
  runId?: string
  recording?: boolean
  recordedSteps?: number
  draftSteps?: number
  replaying?: boolean
  planProgress?: { caseName?: string; caseIndex: number; caseTotal: number; attempt?: number }
}
```

前端只在 `CopilotPanel` 里组装，数据全部来自现有的 `ui-store`、`useProjects`、`useCases`、`usePlans`，不新增全局状态。

Agent 把环境写进 system prompt 的「当前环境」段，同时保留原始对象。模型不用猜「现在是不是在录制」。

Copilot 头部增加一个「环境」按钮。展开后显示模型实际看到的字段。用户能检查上下文，模型说错话时也容易定位是上下文没给对，还是模型判断错。

## 3. 平台工具

新增四个工具：

| 工具 | 作用 |
| --- | --- |
| `workspace_state` | 读取项目、用例、计划、最近运行、元素数、技能数、录制状态 |
| `recording_start` | 开始录制；录制中 AI 的页面操作会被采集为步骤 |
| `recording_stop` | 停止录制，返回步数，并让界面弹出保存用例对话框 |
| `skill_list` / `skill_run` | 查看和运行操作库技能 |

`workspace_state` 解决「不知道平台里有什么」。`recording_start/stop` 解决「不知道要录制」。

写入类操作仍然遵守之前的约定：AI 不直接保存用例。`recording_stop` 只负责把草稿交给用户，保存由现有的「保存录制的用例」对话框完成。

## 4. 原子操作

补三个基础工具，缺口最大的先补：

- `browser_drag`：从元素中心拖拽 (dx, dy)，用于画布、排序、滑块兜底。
- `browser_hover`：悬停元素，用于展开菜单、提示框。
- `browser_wait_for`：等待元素可见/隐藏、文本出现、网络空闲，减少固定 `browser_wait`。

文件上传不做成通用原子操作，放在技能里做路径校验，避免模型把任意本地文件传到页面上。

## 5. 操作库

操作库是一组带参数、带验证的确定性操作。AI 通过 `skill_list` 看到技能清单，通过 `skill_run` 调用。

第一版是内置技能，先解决三类最容易失败的操作：

| 技能 | 参数 | 做法 |
| --- | --- | --- |
| `slider_set` | `ref`、`value` | 读 min/max/step；优先键盘，其次点击轨道，最后拖拽；读回值校验 |
| `hover_menu` | `ref` | 悬停后返回可见菜单项，供下一步点击 |
| `upload_file` | `ref`、`path` | 只允许 `~/.atp-agent/uploads` 下的文件；`setInputFiles` 后返回文件名和大小 |

技能与普通工具有三个区别：

1. **有参数说明**。模型不需要自己推导坐标和时序。
2. **有结果验证**。技能内部读回状态，失败时返回可行动的原因。
3. **可复现**。同样的输入执行同样的步骤，不依赖模型这一次的判断。

技能执行复用现有的 Playwright 页面、元素 `ref` 和证据截图，不另造一套执行器。第二版再把「录制片段 → 参数化技能」和用户自定义技能接上。

### 滑块的处理顺序

滑块是最典型的例子。不同前端框架的实现差别很大，直接拖拽十次有三次会偏。

`slider_set` 的做法：

1. 读元素的 `min`、`max`、`step`、当前值，把目标值量化到步长。
2. 如果是原生 `input[type=range]`，先试键盘：聚焦、Home、按方向键。键盘事件是滑块最稳定的操作方式。
3. 键盘无效时，按目标比例点击轨道。
4. 仍然无效，才用鼠标从当前位置拖到目标位置。
5. 每一步之后读回值，差值超过一个步长就换下一种方式。
6. 成功返回实际值和尝试次数，失败返回原因。

## 6. 界面

- 左侧导航增加第三个页签「操作库」。
- 列表显示内置技能、分类、参数数量；右侧详情显示参数表和一个「让 Copilot 使用」按钮。
- 点击「让 Copilot 使用」把一句预置请求放进 Copilot，不自动执行。
- Copilot 头部增加「环境」按钮，展开后显示当前模式、项目、用例、计划、运行、录制和页面。
- 录制由 AI 停止时，复用现有的保存用例对话框，不新增一套确认界面。

## 7. 接口变更

新增 IPC：

```text
skill:list                                  → SkillManifest[]
```

新增工具事件：

```text
event:ai-recording-draft                    → RecordedDraft
```

扩展：

```text
ai:send.context.environment                 → AiEnvironment
```

## 8. 验收

1. 打开带滑块的演示页，对 Copilot 说「把音量调到 80%」。它先 `browser_snapshot`，再 `skill_run(slider_set)`，中栏能看到操作，结果读回值为 80。
2. 对 Copilot 说「帮我录一条创建流程」。它调用 `recording_start`，操作页面，调用 `recording_stop`，界面弹出保存对话框，保存后的用例步骤数与录制一致。
3. 切到「操作库」，能看到三个技能及参数；点击「让 Copilot 使用」后，Copilot 收到预置请求。
4. Copilot 头部的「环境」面板能看到当前项目、用例和录制状态。
5. 上述流程不依赖真实模型也能测的部分，进入 E2E；技能执行用 Playwright 集成测试覆盖。

## 9. 不在这一期

- 用户自定义技能、从录制生成技能。
- 技能落 SQLite、跨项目分享。
- iframe、Shadow DOM、虚拟列表的专门处理。
- 用例/计划写入工具与 diff 卡。
- 会话持久化。

这些放到 Stage 2.3 及以后。先把「AI 知道环境、复杂控件有确定性操作」这一层做扎实。


## 10. 交付验证

### 自动化

- Agent 单测：19 个通过，其中技能集成测试覆盖原生 range、aria slider、步长量化、悬停菜单、文件上传与路径越界拒绝。
- E2E：操作库三个技能与参数详情、Copilot 环境面板、模型设置、录制/回放/报告全部通过。
- `pnpm biome check .`、两个应用的 typecheck、生产构建均通过。

### 真实模型

用本机 `deepseek-flash` 实测三条：

1. 「把演示页的音量滑块调到 80」→ `browser_snapshot` → `skill_list` → `skill_run(slider_set)`，读回 80，页面文本同步显示「音量 80」。
2. 「展开用户菜单」并询问平台状态 → `workspace_state` → `run_get` → `skill_run(hover_menu)`，返回「个人资料 / 退出登录」两项。
3. 「录一条创建节目的用例」→ `recording_start` → 填写/选择/勾选/点击 → `recording_stop`，保存对话框显示 4 步、4 个元素，草稿被正确交给用户。

真实录制第一次验证时发现：`ai-recording-draft` 事件把草稿放在 `draft` 字段里，前端却按顶层草稿接收，导致界面崩溃。已改为扁平 payload（`{ type, ...draft }`）并在入口检查 `steps` 是否为数组。自动化 E2E 覆盖不到这一条，属于真实模型测试补上的问题。

### 未验证

- 真实模型下的文件上传（执行逻辑由集成测试覆盖；演示页未提供合适的本地图片）。
- iframe、Shadow DOM、自定义下拉的专项处理，按计划留到后续。
