# Stage 3：测试规范库设计方案

日期：2026-10-19
状态：已被 v2 取代（2026-10-20）。v1 的页面驱动路线不再作为主线，S1 代码作为原型保留。
后继方案：<Stage3-测试规范库设计方案-v2.md>
配套清单：<Stage3-测试规范清单.md>（规则内容继续沿用）
交付说明：<Stage3.1-测试规范库-S1.md>（原型记录）

> 结论先行：断言库本身已经够用，缺的是「测试设计知识层」。把企业里成熟的测试规范做成平台内置、可配置、可审计的规则库，再由规则生成测试场景矩阵和带断言的用例，才能系统性覆盖必填、长度、格式、重复等边界，而不是靠 AI 每次自由发挥。
>
> 这不是「自动推荐断言」的翻版。规则只负责**生成候选场景和预期结果模板**，是否采用、错误文案是什么，仍由用户确认；断言是场景的一部分，不是事后猜出来的。

## 1. 问题

现在有三层缺口：

1. **断言层**：断言模型有 21 种，Runner 也能执行，但 AI 录制链路没有把断言写进草稿的工具和流程。
2. **设计层**：AI 习惯生成 happy path，必填、长度、格式、重复、权限、幂等这些常测边界没有系统覆盖。
3. **知识层**：团队已有的测试规范停留在文档和人的经验里，没有变成平台可执行的资产。

这一期先补第 2、3 层；第 1 层的录制断言闭环作为后续切片，二者互补。

## 2. 边界与非目标

- 第一版只做**表单字段**的规范：必填、长度、格式、重复、正常流。
- 规则库是确定性的：没有 AI 也能分析页面、生成矩阵和用例；AI 只负责语义识别、文案发现和解释。
- 场景草稿不直接写用例库；用户勾选并确认后才生成用例。
- 不自动提交真实业务数据；测试数据使用明显的合成值，重复校验只使用页面上已存在的值。
- 不做数据集/数据驱动、网络断言、控制台断言、权限矩阵；这些放到后续阶段。
- 不改 Runner 的执行模型；只复用现有步骤、变量、条件和断言。

## 3. 核心概念

四层职责要分清：

```text
测试规范（知识） → 测试设计（矩阵） → 用例生成（步骤+断言） → 执行与覆盖（报告）
```

| 层 | 回答的问题 | 谁负责 |
|---|---|---|
| 测试规范 | 这类页面/字段应该测什么？ | 平台内置规则 + 项目配置 |
| 测试设计 | 这次具体测哪些场景、用什么数据、预期是什么？ | 规则引擎生成，用户勾选 |
| 用例生成 | 怎么把这些场景变成可执行步骤和断言？ | 规则模板 + AI 补全 |
| 执行与覆盖 | 哪些规范真的被执行、通过、跳过了？ | Runner + 覆盖报告 |

关键原则：**规范不是提示词。** 提示词里的规则不可审计、不可版本化、无法统计覆盖；规则库必须是结构化数据，能列出「应用了哪条规则、为什么跳过、覆盖了哪个字段」。

## 4. 数据模型

### 4.1 内置规则 TestRule

规则是代码里的确定性问题生成器，随平台版本升级。

```ts
type RuleCategory =
  | 'required'
  | 'length'
  | 'format'
  | 'duplicate'
  | 'range'
  | 'enum'
  | 'date'
  | 'permission'
  | 'list'
  | 'idempotency'

interface TestRule {
  id: string                    // required-field
  version: number
  category: RuleCategory
  name: string                  // 必填校验
  description: string
  appliesTo: {
    inputTypes?: string[]       // text, email, tel, number, date...
    roles?: string[]            // textbox, combobox, checkbox...
    labelPatterns?: string[]    // 手机号、邮箱、名称...
    tags?: string[]             // form-field, list, ...
  }
  paramsSchema?: unknown        // 规则参数，如 min/max/pattern
  priority: 'blocker' | 'critical' | 'normal'
  build(context: RuleContext): ScenarioDraft[]
}

interface RuleContext {
  field: FieldDescriptor
  form: FormDescriptor
  page: PageDescriptor
  params: Record<string, unknown>
  expected?: ValidationExpectation
}
```

### 4.2 字段描述 FieldDescriptor

页面分析产物，不直接落库。需要比现有快照多拿一些约束：

```ts
interface FieldDescriptor {
  ref: string                   // 页面内临时 ref
  elementId?: string            // 生成用例时解析成持久元素
  label: string                 // 内容名称
  role: string                  // textbox
  tag: string                   // input
  inputType?: string            // text/email/tel/number/date
  required?: boolean
  minLength?: number
  maxLength?: number
  pattern?: string
  ariaInvalid?: boolean
  formItemRef?: string          // 最近的表单项容器
  formItemText?: string         // 容器内已有文本/错误提示
  confidence: number            // 0-1，静态约束 > 语义识别 > AI 猜测
  source: 'html' | 'label' | 'project-rule' | 'ai'
}
```

需要在页面快照里补齐：`inputType`、`required`、`minLength`、`maxLength`、`pattern`、`aria-invalid`、最近表单项容器。现有 `browser_snapshot` 已返回 role/name/value/state，扩展这些字段不会改变已有使用方。

### 4.3 场景草稿 ScenarioDraft

```ts
interface ScenarioDraft {
  id: string
  ruleId: string
  title: string                 // 必填-空值
  fieldLabel: string            // 内容名称
  given: string                 // 当前在内容管理表单
  data: Record<string, string>  // 内容名称 = ""
  steps: StepDraft[]            // 填写、提交
  assertions: AssertionDraft[]  // 预期结果
  priority: 'blocker' | 'critical' | 'normal'
  tags: string[]
  skipReason?: string           // 无长度约束，跳过
  confidence: number
}
```

场景草稿是临时数据，不落库；用户确认后转成 `CaseFile` 草稿或直接保存。

### 4.4 项目规则 ProjectTestRule

内置规则描述「通用做法」，项目规则描述「这个系统的具体要求」：

```ts
interface ProjectTestRule {
  id: string
  projectId: string
  ruleId: string                // required-field / length / format...
  fieldMatch: {
    label?: string
    labelPattern?: string
    elementId?: string
  }
  params: Record<string, unknown>  // min/max, regex, allowed values
  expected?: {
    errorText?: string[]          // 「请输入内容名称」「不能为空」
    successText?: string[]        // 「保存成功」
  }
  enabled: boolean
}
```

第一版可以只支持内置规则 + 页面约束，不急着做项目规则编辑器；但数据模型要预留。

### 4.5 用例来源

为了让覆盖报告知道「这条用例来自哪条规范」，建议给用例加一个可选来源字段：

```ts
interface CaseOrigin {
  ruleId: string
  scenarioId: string
  fieldLabel?: string
  generatedAt: string
}
```

可以放在 `case.origin`，也可以先写进 `case.intent`/`groups`。推荐新增可选字段，避免污染展示语义。

## 5. 内置规则 v1

### 5.1 必填

- 数据：`""`、`"   "`。
- 适用：`required === true`，或标签命中「必填」「名称」「手机号」等。
- 步骤：填写空值 → 失焦/提交。
- 预期：
  - 字段进入无效状态（`aria-invalid`、`:invalid` 或表单项错误类）。
  - 表单项内出现错误提示。
  - 页面未跳转、未出现成功提示、列表数量不变。
- 断言：`fieldInvalid`（新增）+ `pageText contains`（发现到的错误文案）+ `urlContains`（当前路径）。
- 跳过：页面没有提交按钮，且失焦不触发校验。

### 5.2 长度

- 数据：`minLength - 1`、`minLength`、`maxLength`、`maxLength + 1`；中文、emoji、首尾空格各一组。
- 适用：存在 `minlength` / `maxlength`，或项目规则配置了范围。
- 预期：
  - 超范围：字段无效 + 错误提示，不提交。
  - 范围内：提交成功（或至少通过前端校验）。
- 断言：`fieldInvalid` / `pageText` + `value`（输入框保留的值，可选）+ 成功信号。
- 跳过：没有长度约束。不要凭空猜一个长度。

### 5.3 格式

- 数据来源：
  - `input type=email/tel/url/number/date`
  - `pattern` 属性
  - 标签关键词：手机号、邮箱、身份证、日期、金额
  - 项目规则配置的正则/示例
- 数据：合法值、非法值、前后空格、全角字符。
- 预期：非法值字段无效 + 错误提示；合法值提交成功。
- 断言：`fieldInvalid` + 错误文案 + 成功信号。
- 跳过：无法判断格式规则时，标记「需要项目配置」，不猜。

### 5.4 重复

- 适用：列表/表格里已有记录，或页面能读取到同字段的已有值。
- 数据：已有值、大小写变体、首尾空格变体。
- 预期：提示重复/已存在，列表数量不变，只保留一条。
- 断言：`pageText contains`（重复提示）+ `count`（生成时记录的行数）+ `urlContains`。
- 跳过：页面没有可复用的已有值，或重复校验需要创建前置数据。第一版不自动造数据，明确标记「需要前置数据」。
- 后续：用 setup 步骤或 API 夹具创建前置数据。

### 5.5 正常流

- 数据：项目配置的合法值，或按字段类型生成合成值；名称类字段加唯一后缀。
- 步骤：填写全部必填字段 → 提交。
- 预期：出现成功提示/跳转/列表新增一条。
- 断言：成功文案 + `urlContains` 或 `count + 1`。
- 作用：给负向用例提供对照，也验证规则没有把正常值误判。

### 5.6 规则适用与跳过

每条规则必须给出明确的适用性判断：

```text
应用：字段有 maxlength=50 → 长度规则生成 4 个场景
跳过：字段没有 maxlength，也没有项目规则 → 长度规则不生成，矩阵里显示跳过原因
```

矩阵中保留被跳过的规则，用户能看到「为什么没测」，而不是以为什么都覆盖了。

## 6. 字段识别与错误文案发现

### 6.1 静态识别（确定性）

从页面快照和 DOM 读取：

- `required`、`minlength`、`maxlength`、`pattern`
- `type`、`inputmode`
- `aria-required`、`aria-invalid`
- `disabled`、`readonly`
- 最近的 `.el-form-item` / `.ant-form-item` / `[role=group]` 容器

### 6.2 语义识别（AI 辅助）

- 标签文本：「内容名称」「手机号」「邮箱」「金额」「日期」。
- 页面上下文：新增/编辑表单、查询表单、设置表单。
- 按钮语义：「保存」「提交」「查询」「删除」。
- AI 只输出字段类型和建议的规则，不直接生成断言文案。

### 6.3 运行时发现（可选，但推荐）

对于没有明确错误文案的场景，执行一次轻量探测：

1. 填入非法值。
2. 失焦；如果无提示，再点提交。
3. 读取：
   - `aria-invalid` / `:invalid`
   - 表单项容器的可见文本
   - `role=alert`、toast、message 组件
4. 把发现的文案写入场景的 `expected.errorText`，由用户确认。
5. 如果探测产生了副作用（比如真的提交了），刷新页面或撤销。

探测只做一次，结果缓存在本次测试设计会话里，不反复触发。

### 6.4 置信度

- 1.0：HTML 约束直接给出。
- 0.8：标签关键词 + input type 一致。
- 0.5：仅 AI 语义猜测。
- < 0.5：不生成场景，标记「需要确认」。

矩阵里显示置信度；低置信度默认不勾选。

## 7. 测试设计矩阵

### 7.1 入口

- AI 面板工具栏：「测试设计」。
- ⌘K：「为当前页面设计测试」。
- 用例编辑器：「为这条用例补边界场景」。

### 7.2 矩阵卡

```text
┌ 测试设计 · 内容管理 ─────────────────────────────────────┐
│ 识别 4 个字段 · 应用 3 类规范 · 生成 14 个场景 · 跳过 2 个 │
│                                                          │
│ ☑ 场景                 字段      数据          预期      │
│ ☑ 必填-空值            内容名称  ""            报错      │
│ ☑ 必填-纯空格          内容名称  "   "         报错      │
│ ☑ 长度-49 字           内容名称  49 字         通过      │
│ ☑ 长度-51 字           内容名称  51 字         报错      │
│ ☐ 格式-非法邮箱        邮箱      abc          报错      │
│ …                                                        │
│                                                          │
│ [全选] [生成用例] [执行选中] [导出矩阵]                   │
└──────────────────────────────────────────────────────────┘
```

每行包含：

- 复选框、场景标题、字段、数据预览、预期、优先级、来源规则、置信度。
- 可展开查看步骤与断言；数据、预期文案可编辑。
- 跳过项置灰，显示原因。

### 7.3 生成与执行

- 「生成用例」：每条选中场景生成一个 `CaseFile` 草稿；名称格式 `内容管理-必填-空值`。
- 生成后可以：
  - 立即执行（复用计划卡的中栏执行，不写 runs 表）。
  - 保存到用例库（复用保存对话框）。
  - 批量保存为一个计划（后续）。
- 执行结果回填到矩阵行：通过/失败/未执行。

### 7.4 覆盖统计

- 字段覆盖：有规则的字段 / 总字段。
- 规则覆盖：应用规则 / 可用规则。
- 场景覆盖：已执行 / 已生成。
- 跳过原因统计：无约束、需要前置数据、低置信度。

## 8. 断言策略

### 8.1 复用现有断言

21 种断言已经覆盖大部分需求：

- 失败：`pageText contains`（错误文案）、`textContains`（表单项文本）、`urlContains`（未跳转）、`count`（数量不变）。
- 成功：`pageText contains`（成功提示）、`urlContains`、`count + 1`、`visible`。

### 8.2 建议新增两个语义断言

错误文案因项目而异，直接匹配文本容易脆。建议增加：

```ts
// 字段处于无效状态
{ type: 'fieldInvalid' }

// 字段所在表单项显示错误；expected 可选
{ type: 'fieldError', expected?: string }
```

实现信号按优先级：

1. `aria-invalid="true"`
2. `:invalid`（原生表单校验）
3. 最近的 form-item 容器带 `is-error` / `ant-form-item-has-error` 等类
4. 容器内出现可见的错误文本

`fieldError` 需要表单项容器定位器；生成用例时一并登记为元素。若第一版不扩展元素模型，可以先只用 `pageText contains` + `fieldInvalid`。

### 8.3 断言模板

每个规则产出断言模板，而不是让 AI 自由写：

```ts
function validationAssertions(field, expected): AssertionDraft[] {
  return [
    { type: 'fieldInvalid', elementRef: field.ref },
    ...(expected.errorText ? [{ type: 'pageText', match: 'contains', expected: expected.errorText }] : []),
    { type: 'urlContains', expected: currentPath },
  ]
}
```

正常流：

```ts
function successAssertions(expectation): AssertionDraft[] {
  return [
    { type: 'pageText', match: 'contains', expected: expectation.successText },
    { type: 'count', op: '=', expected: currentCount + 1 },
  ]
}
```

## 9. 架构与接口

### 9.1 代码位置

建议新增 `packages/test-design`：

```text
packages/test-design/
  src/
    rules/required.ts
    rules/length.ts
    rules/format.ts
    rules/duplicate.ts
    rules/happy-path.ts
    analyze.ts          // 字段识别、规则匹配、矩阵生成
    generate.ts         // 场景 → CaseFile 草稿
    assertions.ts       // 断言模板
    index.ts
```

职责：

- 不依赖 Playwright 页面对象，只接收字段/页面描述，方便单测。
- Agent 负责把页面快照转成 `FieldDescriptor`，调用规则库。
- Web 只负责展示矩阵和勾选，不重复实现规则逻辑。

### 9.2 数据模型

- `packages/model/src/domain/test-design.ts`：`TestRule`、`FieldDescriptor`、`ScenarioDraft`、`DesignMatrix`、`CaseOrigin`。
- `packages/model/src/ipc/channels.ts`：新增 `design:start`、`design:state`、`design:generate`、`design:cancel`。
- 事件：`event:design-progress`、`event:design-result`。
- 项目规则表（后续）：`project_test_rules`，字段见 §4.4。

### 9.3 Agent 接口

- `designStart({ caseId?, url?, rules? })`：返回 `designId`，后台分析并发送进度。
- `designGenerate({ designId, scenarioIds })`：返回 `CaseFile[]` 草稿。
- `designCancel()`。
- 分析步骤：
  1. 获取当前页面快照。
  2. 扩充字段约束（HTML + 语义 + 项目规则）。
  3. 运行时探测错误文案（可选）。
  4. 匹配规则、生成场景。
  5. 发送矩阵。

探测可能需要操作页面，必须与录制/回放/调试/AI 执行互斥；加锁规则与现有 `busy` 守卫一致。

### 9.4 AI 工具

- `design_analyze`：让 AI 触发分析并拿到矩阵摘要。
- `design_generate`：把选中的场景转成用例草稿。
- `design_explain`：解释为什么某条规则被跳过、为什么某条断言这样写。

AI 不是必需路径；没有模型时，界面按钮也能完成分析和生成。

### 9.5 界面

- `apps/web/src/ai/TestDesignCard.tsx`：矩阵卡。
- `apps/web/src/state/ui-store.ts`：`design` 状态、勾选、生成结果。
- 复用 `AiPlanCard` 的卡片样式、`SaveCaseDialog` 的保存流程、`BrowserStage` 的执行展示。
- 矩阵卡固定在 AI 输入框上方，和计划卡/建议卡并排；最多保留 1 张，避免堆叠。

## 10. 与现有能力的关系

### 10.1 录制断言闭环

规范库解决「系统性覆盖」，录制断言闭环解决「探索式操作后的验证点」。两者共用断言模板和语义断言，但不互相阻塞。

顺序建议：

1. 先做规范库 v1（本方案）。
2. 再做录制断言闭环。
3. 最后做网络/控制台/软断言。

### 10.2 AI 计划卡

- 计划卡负责「从一句话生成一条流程」。
- 测试设计卡负责「从一个页面生成一组边界场景」。
- 两者都产出 `CaseFile` 草稿，复用同一套执行/保存链路。

### 10.3 用例修改建议

- 生成后的用例可以继续用 `case_propose` 修改。
- 不建议让 AI 直接批量改已有用例的断言；规范库生成的是新场景，避免覆盖用户手工内容。

## 11. 覆盖报告

报告页新增「测试设计覆盖」区块：

```text
内容管理表单
- 识别字段：4
- 应用规范：必填、长度、格式
- 生成场景：14
- 已执行：12（通过 10 / 失败 2）
- 跳过：2（长度：无 maxlength；重复：需要前置数据）
```

用例详情显示来源：

```text
来源：测试规范 / 长度校验 / maxLength=50
```

这样团队能回答三个问题：测了什么、没测什么、为什么没测。

## 12. 交付顺序

### S1：表单规范 v1（垂直切片）✅ 已交付

交付说明：<Stage3.1-测试规范库-S1.md>

范围：

- `packages/test-design`：required / length / format / happy-path 四条规则。
- 字段识别：HTML 约束 + 标签语义。
- 测试设计矩阵卡：在 AI 对话中触发，勾选、编辑数据、跳过原因。
- 列表/查询页：自动点击「新建/新增」入口，分析弹窗或新页面中的表单。
- 生成 1 个场景 = 1 条用例，带断言。
- 执行选中（复用计划执行链路）。
- 演示页补充 `maxlength`、`pattern`，便于验收。
- 单测 + E2E。

验收：

1. 在演示页点「测试设计」，矩阵出现必填、长度、格式、正常流场景。
2. 未配置长度约束的字段显示「跳过：无长度约束」，不生成假场景。
3. 勾选全部 → 生成用例 → 执行；必填/长度/格式用例按预期通过，正常流通过。
4. 失败场景在矩阵卡显示「未通过」；期望/实际详情与报告页回看随 S2 接入运行记录（S1 执行不落库）。
5. 无 AI/无密钥时，整条链路仍可用。

### S2：重复校验与文案发现

- `duplicate` 规则：只使用页面上已有值；无值则跳过。
- 运行时探测错误文案，用户确认后写入场景。
- AI 语义识别：标签、字段类型、规则建议。
- 用例来源字段与覆盖统计。
- E2E：重复提交场景。

### S3：项目规则与更多规则包

- 项目规则编辑器（字段 → 规则 → 参数/文案）。
- 列表/查询：空态、分页、筛选、排序。
- CRUD：创建、编辑、删除、取消。
- 权限矩阵、状态流转、幂等/重复提交。
- 数据集与数据驱动（L4）。

## 13. 测试与验证

### 单元测试

- 规则匹配：字段约束 → 预期场景数量。
- 数据生成：边界值、中文、emoji、空格。
- 断言模板：必填/长度/格式/重复/正常流。
- 矩阵序列化与勾选状态。

### 集成测试

- 演示页快照 → 字段识别 → 矩阵。
- 选中场景 → `CaseFile` 草稿 schema 校验通过。
- 草稿执行 → 断言结果符合预期。

### E2E

- 打开演示页 → 测试设计 → 矩阵 → 勾选 → 生成 → 执行 → 覆盖统计。
- 断言失败路径：修改期望文案后执行，报告显示期望/实际与截图。
- 无 AI 模式：Stub/无密钥下链路可用。

### 手动验收

- 在真实业务表单上分析字段，观察误判和跳过原因。
- 重复校验使用已有值，确认不会创建脏数据。
- 检查矩阵卡在窄屏、长文案、多字段下的布局。

## 14. 风险与开放问题

1. **错误文案差异**：不同项目文案完全不同。用语义断言 + 运行时发现 + 项目配置三层兜底，不能只靠硬编码。
2. **字段识别误判**：AI 语义识别可能把「备注」当成必填。用置信度 + 默认不勾选 + 用户确认。
3. **重复校验前置数据**：第一版不自动造数据，明确跳过；后续用 setup 步骤或夹具。
4. **测试数据清理**：正常流会创建记录。第一版用唯一名称并提示用户；后续加 teardown。
5. **探测副作用**：运行时探测可能触发提交。优先失焦，其次提交后刷新；必要时要求用户确认。
6. **矩阵规模**：字段多时场景会很多。按优先级分组、默认只勾 blocker/critical，支持全选。
7. **用例粒度**：一条场景一条用例，便于定位和并行；后续再支持数据驱动合并。
8. **语义断言实现**：`fieldInvalid`/`fieldError` 需要兼容 Element Plus、Ant Design 和原生表单；先支持常见信号，找不到时退回文本断言。
9. **规则库维护**：内置规则要版本化；项目规则要能导入导出，避免绑定单一项目。

## 15. 后续

- 录制断言闭环（验收卡）。
- 网络/控制台/软断言。
- 数据集与数据驱动。
- 列表、CRUD、权限、状态流转规则包。
- 覆盖看板：项目级规范覆盖率、跳过原因趋势、flaky 场景。
