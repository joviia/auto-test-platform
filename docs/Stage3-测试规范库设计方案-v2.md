# Stage 3 v2.1：测试规范、测试设计与测试数据（全局模型）

日期：2026-10-20
状态：方案待确认，未开始实现（v2.1 整合数据层）
取代：<Stage3-测试规范库设计方案.md>（v1 页面驱动路线）
规则清单：<Stage3-测试规范清单.md>（规则内容继续沿用）

> 结论先行：把规范、被测对象、数据规则、设计矩阵、用例绑定、执行覆盖串成一条链，核心是三层分离：
>
> 1. **规范/数据规则**回答「测什么、用哪些数据分区」；
> 2. **被测对象/设计场景**回答「这次测哪个表单的哪个字段、有效约束是什么」；
> 3. **绑定/执行**回答「落到哪个页面、哪条数据记录、哪次运行」。
>
> 规范不依赖页面，数据规则不依赖具体数据行，矩阵不依赖定位器。这样才能既覆盖企业规范，又能落到真实页面执行。

## 1. 全局模型

```text
第 1 层  规范层
         Standard / Pack / ProjectOverride
         短文本 ≤256，长文本 ≤1000，邮箱格式，必填，唯一……
              │ appliesTo(controlType / semanticType)
              ▼
第 2 层  数据规则层
         DataRule：分区 + 模板 + 预期 + 测试层级
         empty / valid / max / max+1 / duplicate……
              │
              │ 与被测对象一起实例化
              ▼
第 3 层  对象层
         TestObject / Field / Constraint / ControlType / SemanticType
         字段、控件类型、语义类型、有效约束、必填、弹窗/多步流程
              │
              ▼
第 4 层  设计层
         Scenario = 规范 × 字段 × 数据规则
         Matrix = 场景集合 + 覆盖摘要
              │ materialize
              ▼
第 5 层  数据层
         DataTemplate → DataRecord / DataSet
         字段值 + 前置条件 + 清理 + 种子
              │ bind
              ▼
第 6 层  绑定与执行层
         CaseBinding：流程 + 定位器 + 数据 + 断言
         Case / Run / Result / Coverage
```

一句话概括：

```text
规范决定「测什么分区」，
对象模型决定「这次测哪个字段、有效约束是多少」，
数据规则决定「用什么数据、预期是什么」，
绑定决定「怎么在页面上执行」，
覆盖决定「哪些分区真的执行了」。
```

数据规则在实现上挂在规范下（`TestStandard.dataRules`），逻辑上单独成层，因为它必须结合字段的有效约束才能实例化。

## 2. 为什么 v1 走歪

v1 的实际行为：

- 只有 HTML 写了 `required / minlength / maxlength` 才生成场景；
- 自定义组件、后端规则、需求里的约束读不到，于是大量字段被跳过；
- 为了读到表单，又加了「自动打开新建弹窗」；
- 为了减少假失败，又加了默认值跳过、纯空格跳过、多步表单正向跳过；
- 矩阵是临时的，执行不写运行记录，覆盖率无法统计。

结果是：**规范没有成为资产，矩阵只是页面的影子。** 页面写得少，就测得少；页面不可读，就几乎不能测。

v2 保留的部分：

- `Stage3-测试规范清单.md` 的规则分类与验收思路；
- 字段探测能力（只作为证据来源，不再是规则来源）；
- `fieldInvalid` / `fieldError` 等语义断言；
- Runner、定位器、录制与回放链路；
- 矩阵卡的交互外壳。

明确不再作为主线：

- 仅凭 HTML 约束决定是否生成场景；
- 自动打开表单作为默认动作；
- 静默跳过未知约束；
- 独立于运行记录的「测试设计执行」；
- 把 AI 当成触发按钮。

## 3. 设计原则

1. **规范先行，并给出默认值**：规范按控件类型定义默认约束（短文本 ≤256、长文本 ≤1000）；页面没有声明约束，直接用规范默认值生成断言。
2. **控件类型是桥**：表单分析只回答「这是什么控件」，规范回答「这种控件该测什么」。常规 HTML 控件自动分类；自定义组件或语义不明时才问人。
3. **设计、数据、绑定分离**：规范和数据规则不绑定具体页面；矩阵不绑定定位器；数据记录不绑定断言。
4. **字段显式约束优先，异常才确认**：字段有页面/需求约束时按字段约束测；没有时用规范默认值。页面约束比规范更宽松、或控件类型无法判断时，才标记待确认。
5. **负向单因素，正向基线**：负向校验一次只让一个字段无效，其他字段保持合法；正向用一条基线记录，边界值单独跑。不做全组合爆炸。
6. **UI 与 API 分层**：同一个 257 字，在 UI 层可能被截断，在接口层应报错。测试层级必须显式记录，不能混为一谈。
7. **数据是模板 + 快照**：不写死 257 个字，存 `repeat(maxLength+1)`；矩阵保存生成后的快照与种子，保证可解释、可复现。
8. **矩阵是设计资产，用例是执行资产**：矩阵保存场景与覆盖；用例保存步骤与绑定；两者双向追溯，不互相复制真相。
9. **AI 提议，人确认范围与例外**：AI 负责探测、分类、生成草案；测试范围、例外处理、写数据与执行由人确认。AI 不发明规范和预期。
10. **覆盖按分区，covered ≠ passed**：执行过就算覆盖，通过率单独统计；失败不能从覆盖率里消失。

## 4. 实体与关系

### 4.1 规范层

```ts
/** 控件形态：决定长度、日期、枚举等规则 */
type ControlType =
  | 'shortText' | 'longText' | 'number' | 'date' | 'dateRange'
  | 'select' | 'multiSelect' | 'checkbox' | 'radio'
  | 'upload' | 'unknown'

/** 数据语义：决定邮箱、手机号、URL 等格式规则 */
type SemanticType =
  | 'text' | 'email' | 'phone' | 'url'
  | 'name' | 'code' | 'amount'
  | 'date' | 'enum' | 'unknown'

type Partition =
  | 'empty' | 'validTypical' | 'validMin' | 'validMax'
  | 'invalidUnderMin' | 'invalidOverMax'
  | 'whitespace' | 'specialChars'
  | 'duplicate' | 'invalidFormat'

interface TestStandard {
  id: string
  version: string
  name: string
  category:
    | 'required' | 'length' | 'format' | 'duplicate'
    | 'range' | 'enum' | 'date' | 'relation'
  /**
   * 控件类型决定「长度/日期/枚举」规则；
   * 语义类型决定「邮箱/手机/URL」等格式规则。
   */
  appliesTo: {
    controlTypes?: ControlType[]
    semanticTypes?: SemanticType[]
  }
  /** 规范参数，例如 { maxLength: 256, inclusive: true } */
  params: Record<string, unknown>
  dataRules: DataRuleTemplate[]
}

interface DataRuleTemplate {
  id: string
  partition: Partition
  template: DataTemplate
  expected: ExpectedTemplate
  testLevel: 'ui' | 'api'
  priority: 'blocker' | 'critical' | 'normal'
  requires?: DataRequirement[]
}

interface DataRequirement {
  kind: 'existingRecord' | 'unique' | 'loggedIn' | 'environment'
  note?: string
}

type DataTemplate =
  | { kind: 'literal'; value: string }
  | { kind: 'repeat'; char: string; lengthExpr: string }   // 'maxLength + 1'
  | { kind: 'generated'; generator: string; params?: Record<string, unknown> }
  | { kind: 'existingRecord'; source: string }
  | { kind: 'dateOffset'; days: number }

type ExpectedTemplate =
  | { kind: 'invalid'; messageHint?: string }
  | { kind: 'success'; text?: string }
  | { kind: 'truncated'; toExpr: string }
```

> 本文省略的类型：`Step`、`PageEvidence`、`LocatorBinding`、`AssertionBinding` 复用现有实现；`ConstraintSnapshot`、`ExpectedResult`、`CoverageItemRef`、`MatrixCoverage` 是轻量结构，分别表示约束快照、解析后的预期、覆盖项引用和矩阵覆盖摘要。

数据规则是**模板**，不是固定数据。例如：

```ts
// 短文本长度规范
{
  id: 'std.short-text.length',
  version: '1.0.0',
  category: 'length',
  appliesTo: { controlTypes: ['shortText'] },
  params: { maxLength: 256, inclusive: true },
  dataRules: [
    { id: 'typical', partition: 'validTypical', template: { kind: 'literal', value: '合同A' }, expected: { kind: 'success' }, testLevel: 'ui', priority: 'normal' },
    { id: 'max', partition: 'validMax', template: { kind: 'repeat', char: '测', lengthExpr: 'maxLength' }, expected: { kind: 'success' }, testLevel: 'ui', priority: 'critical' },
    { id: 'over-max', partition: 'invalidOverMax', template: { kind: 'repeat', char: '测', lengthExpr: 'maxLength + 1' }, expected: { kind: 'invalid' }, testLevel: 'api', priority: 'critical' },
  ],
}
```

内置规范用代码实现，保证可测试、可版本化；项目覆盖用数据保存（默认值、字段例外、错误文案、跳过原因）。

UI 截断不写死在规范里：它是字段 `maxlength` 证据产生的页面级场景；规范只定义「后端超长应无效」。没有 `maxlength` 时，UI 超长的预期取决于前端校验，未知则待确认。

### 4.2 控件分类

```ts
interface ControlClassification {
  controlType: ControlType
  semanticType: SemanticType
  confidence: number
  evidence: string[]   // tag、type、role、组件类名、可编辑性、标签/占位符
}
```

分类规则：

| 页面特征 | 控件类型 | 语义类型 |
|---|---|---|
| 单行 `input[type=text/search]` | `shortText` | 由标签/占位符推断：`name / code / email / phone / url / text` |
| `input[type=email/phone/url]` | `shortText` | `email / phone / url` |
| `textarea`、`contenteditable`、富文本 | `longText` | `text` |
| `input[type=number]`、数字组件 | `number` | `amount / code / text` |
| `input[type=date]`、日期组件 | `date` | `date` |
| `select`、`role=combobox`、自定义下拉 | `select / multiSelect` | `enum` |
| `checkbox / radio` | `checkbox / radio` | `enum` |
| `input[type=file]` | `upload` | `text` |
| 以上都不匹配 | `unknown` | `unknown`，标记待确认 |

控件类型和数据语义要分开：短文本可以是邮箱、手机号、名称；长度规范看控件类型，格式规范看语义类型。标签/占位符推断置信度低时，标记待确认。

### 4.3 被测对象层

```ts
interface TestObject {
  id: string
  projectId: string
  name: string
  kind: 'form' | 'flow' | 'list' | 'crud'
  entryUrl: string
  entrySteps: Step[]
  fields: TestField[]
  submit?: { name: string; expectation: string }
  flow?: { multiStep: boolean; steps?: string[] }
  pageEvidence?: PageEvidence
}

type FieldValue = string | string[]

interface TestField {
  id: string
  label: string
  controlType: ControlType
  semanticType: SemanticType
  classification: ControlClassification
  /** 有效值，由 constraints 中 kind='required' 的 applied 约束推导 */
  required: boolean
  constraints: FieldConstraint[]
  options?: string[]
  defaultValue?: FieldValue
  editable: boolean
  visible: boolean
  /** 页面证据：只用于绑定，不参与「要不要测」的判断 */
  evidence?: {
    ref?: string
    component?: string
    locatorHints?: string[]
  }
}

interface FieldConstraint {
  kind:
    | 'required' | 'minLength' | 'maxLength'
    | 'pattern' | 'min' | 'max'
    | 'unique' | 'enum' | 'dateRange'
  value?: string | number | string[]
  /** 边界语义：默认包含（≤ / ≥） */
  operator?: 'lte' | 'lt' | 'gte' | 'gt'
  source:
    | 'standard' | 'page' | 'requirement'
    | 'api_schema' | 'ai' | 'user' | 'project'
  /**
   * applied：已确定，可直接生成场景
   * pending：需要人确认
   * rejected：不采用
   */
  status: 'applied' | 'pending' | 'rejected'
  /** 规范对该控件类型的默认值，用于解释和冲突判断 */
  standardDefault?: {
    kind: FieldConstraint['kind']
    value?: string | number | string[]
  }
  note?: string
}

/** 构造完整数据记录时，非目标字段使用的合法基线 */
interface DataProfile {
  baseline: Record<string, FieldValue>   // fieldId -> valid value
  uniqueSuffix?: string
  environmentId?: string
}
```

必填性是字段级约束，不由控件类型决定：取页面必填标记、需求或项目配置；三者都没有时默认按「非必填」处理，并在设计卡注明。

`required` 规范只在 required 约束为 `applied: true` 时适用；可选字段的空值是正向场景，不套必填规范。

### 4.4 设计层

```ts
interface DesignSession {
  id: string
  projectId: string
  objectId: string
  standardPack: { id: string; version: string }
  status: 'draft' | 'confirmed' | 'archived'
  brief: string
  questions: DesignQuestion[]
  matrixId?: string
  createdAt: string
  updatedAt: string
}

interface DesignQuestion {
  id: string
  fieldId?: string
  kind: 'classification' | 'constraintConflict' | 'required' | 'dataSource' | 'writeData'
  question: string
  options: Array<{ value: string; label: string; recommended?: boolean }>
  answer?: string
  status: 'open' | 'answered' | 'skipped'
}

interface DesignScenario {
  id: string
  standardId: string
  standardVersion: string
  /** 单字段规则通常一个；跨字段规则（如开始/结束日期）两个及以上 */
  fieldIds: string[]
  dataRuleId: string
  partition: Partition
  title: string
  /** 生成本场景时使用的有效约束快照 */
  effectiveConstraint: ConstraintSnapshot
  expected: ExpectedResult
  testLevel: 'ui' | 'api'
  priority: 'blocker' | 'critical' | 'normal'
  status: 'ready' | 'pending' | 'excluded'
  dataRecordId?: string
  /** 本场景覆盖的覆盖项 */
  covers: CoverageItemRef[]
  /** 依据了哪些约束 */
  constraintRefs: string[]
}

interface DesignMatrix {
  id: string
  sessionId: string
  objectId: string
  standardPack: { id: string; version: string }
  scenarios: DesignScenario[]
  coverage: MatrixCoverage
  createdAt: string
}
```

核心公式：

```text
Scenario        = Standard × Field × DataRule
effective       = field override ?? page constraint ?? standard default
expected        = resolve(dataRule.expected, field.required, testLevel)
dataRecord      = baseline profile + dataRule.template
```

模板里的 `maxLength`、`minLength` 等变量，在实例化时取字段的**有效约束**，而不是规范参数本身。所以同一个短文本规范：

- 合同名称（页面 `maxlength=50`）→ 49 / 50 / 51；
- 被授权方（无页面约束）→ 255 / 256 / 257。

矩阵保存的是**场景快照**：规范版本、有效约束、数据规则、生成记录都固化下来，后续规范升级不会悄悄改变历史设计。

### 4.5 数据层

```ts
interface DataRecord {
  id: string
  /** fieldId -> 实际值；可能包含 257 个字符，也可能只存生成元数据 */
  values: Record<string, FieldValue>
  preconditions?: Step[]
  cleanup?: Step[]
  source: 'generated' | 'manual' | 'existing'
  seed?: string
  uniqueKey?: string
}

interface DataSet {
  id: string
  records: DataRecord[]
  purpose: string
}
```

关键约定：

- **预期结果不属于数据记录**。同一条 257 字记录，在 UI 层可能预期截断，在 API 层预期无效；预期放在场景/绑定上。
- **数据记录是快照**。生成时记录实际值；如果运行时需要重新生成（日期、唯一后缀），记录新的实际值与种子。
- **一条记录可以服务多个场景**。例如同一条合法记录可用于「上边界」和「正常流」，但每个场景的预期分别定义。
- **一条记录是完整表单数据**，不是单个字段值。目标字段之外的字段由基线 profile 填充为合法值。
- **数据可以复用，但不可变**。编辑数据生成新记录，不修改已被运行引用的记录。

### 4.6 绑定层

```ts
interface CaseBinding {
  id: string
  scenarioId: string
  dataRecordId: string
  caseId?: string
  flow: Step[]
  fieldBindings: Record<string, LocatorBinding>
  assertionBindings: Record<string, AssertionBinding>
  bindingVersion: string
}
```

绑定步骤：

1. 打开入口（列表页 → 弹窗/新页面；多步流程按 `flow.steps`）；
2. 用基线记录填写所有字段；
3. 用目标数据覆盖被测字段；
4. 提交 / 下一步；
5. 按场景预期断言（字段无效、错误文案、成功文案、URL、值截断）。

定位器与矩阵分离：页面改版时重新绑定，不修改设计。弹窗/多步流程在对象模型里描述，不靠每条用例的临时补丁。

### 4.7 执行与覆盖

```ts
interface CoverageItem {
  id: string
  standardId: string
  /** 单字段规则一个；跨字段规则多个 */
  fieldIds: string[]
  partition: Partition
  required: boolean
}

interface CoverageSummary {
  designCoverage: number      // ready 覆盖项 / 适用覆盖项
  executionCoverage: number   // 已执行覆盖项 / 适用覆盖项
  passRate: number            // 通过 / 已执行
  pending: number
  excluded: number
  blocked: number
}
```

口径：

- **适用**：规范适用于该控件类型，字段可见且可编辑。
- **覆盖**：至少有一条绑定用例执行过该覆盖项，**通过或失败都算覆盖**。
- **通过率**：通过数 / 已执行数，单独统计。
- **待确认/排除/阻塞**：分别计数，不混入覆盖。
- **设计覆盖 vs 执行覆盖**：设计覆盖看矩阵是否齐全，执行覆盖看是否真的跑了。

### 4.8 AI 设计会话

AI 的职责：

1. 读取页面，识别入口、字段、控件类型；
2. 提出对象模型草案和有效约束；
3. 套用规范，生成矩阵与数据记录草案；
4. 只对「控件类型不明、页面约束超规范、必填性不明、重复数据来源、写数据」提问；
5. 解释每条场景的依据与数据来源。

AI 不做：

- 发明规范或预期结果；
- 在冲突时静默选一个值；
- 未经确认填写并提交真实表单；
- 把 AI 推断直接标成 `applied`。

无 AI 模式：

- 手动编辑字段、控件类型、约束；
- 规则引擎照常生成矩阵与数据；
- AI 只是加速探测，不是前置条件。

## 5. 端到端示例：CCMS「新建版权合同」

### 5.1 对象与有效约束

| 字段 | 控件类型 | 语义 | 字段约束 | 有效约束 | 说明 |
|---|---|---|---|---|---|
| 合同名称 | shortText | name | 必填；页面 `maxlength=50` | max 50 | 覆盖规范默认 256 |
| 内容提供商 | select | enum | 默认「自有内容」；必填标记 | 必填 | 已有默认值，空值需先清空 |
| 授权平台 | multiSelect | enum | 必填 | 必填 | 选项来自页面 |
| 被授权方 | shortText | name | 无 | max 256 | 使用规范默认 |
| 权利类型 | select | enum | 无 | 枚举 | 选项来自页面 |
| 授权开始/结束 | date | date | 无 | 合法日期；开始 ≤ 结束 | 跨字段规则 |
| 备注 | longText | text | 无 | max 1000 | 使用规范默认 |

### 5.2 数据规则示例

**合同名称（max 50）**

| 分区 | 数据 | 预期（UI） | 预期（API） |
|---|---|---|---|
| empty | `''` | 字段无效 + 错误提示 | 400 |
| validTypical | `测试合同-A` | 成功 | 201 |
| validMax | 50 字 | 成功 | 201 |
| invalidOverMax | 51 字 | 截断为 50 字（`maxlength`） | 400 |
| duplicate | 已存在的合同名称 | 字段无效 + 重复提示 | 409 |

**被授权方（max 256，无页面约束）**

| 分区 | 数据 | 预期（UI） | 预期（API） |
|---|---|---|---|
| empty | `''` | 若可选则成功 | 201 |
| validMax | 256 字 | 成功 | 201 |
| invalidOverMax | 257 字 | 待确认（前端校验 / 后端报错 / 无提示） | 400 |

**备注（max 1000）**

| 分区 | 数据 | 预期（UI） | 预期（API） |
|---|---|---|---|
| validMax | 1000 字 | 成功 | 201 |
| invalidOverMax | 1001 字 | 待确认（截断 / 报错取决于组件） | 400 |

### 5.3 完整数据记录

```json
{
  "合同名称": "测试合同-20261020-001",
  "内容提供商": "自有内容",
  "授权平台": ["平台A"],
  "被授权方": "测试被授权方",
  "权利类型": "信息网络传播权",
  "授权开始": "2026-10-20",
  "授权结束": "2027-10-19",
  "备注": ""
}
```

测试「合同名称 51 字」时，只覆盖目标字段：

```json
{
  "合同名称": "测测测……（51 字）",
  "内容提供商": "自有内容",
  "授权平台": ["平台A"],
  "被授权方": "测试被授权方",
  "权利类型": "信息网络传播权",
  "授权开始": "2026-10-20",
  "授权结束": "2027-10-19",
  "备注": ""
}
```

### 5.4 关键判断：UI 截断不是后端校验

- 页面 `maxlength=50` 时，用键盘输入第 51 个字会被浏览器截断。UI 层能验证的是「值被截为 50」，不是「后端拒绝 51」。
- 要验证字段级 50 字规则在后端也生效，需要 API 层，或用脚本绕过 `maxlength` 直接赋值再提交。
- 因此同一个「51 字」数据，在矩阵里可以有两个场景：UI 截断（来自页面 `maxlength` 证据）和 API 无效（来自规范规则）。P0 若只做 UI，API 场景标记待确认/未覆盖，不生成必然失败的 UI 用例。

### 5.5 矩阵与覆盖

预计场景：

| 规范 | 场景数（示例） |
|---|---|
| 必填 | 3（合同名称、内容提供商、授权平台） |
| 长度 | 8（合同名称 3 + 被授权方 3 + 备注 2） |
| 格式 | 1（如有邮箱/电话） |
| 重复 | 1（合同名称） |
| 日期/范围 | 2（非法日期、开始 > 结束） |
| 正常流 | 1 |
| 合计 | 约 16 |

覆盖摘要：

```text
设计覆盖：16 / 18 个适用覆盖项（2 个 API 场景待确认）
执行覆盖：14 / 18（UI 可执行部分全部跑完）
通过率：13 / 14
待确认：2（API 长度校验）
排除：0
```

## 6. 关键规则

### 6.1 约束取值顺序

1. **字段级显式规则**：需求、接口 schema、项目配置或用户输入。
2. **页面显式约束**：`maxlength`、`minlength`、`min/max`、`required` 等，作为该字段的实现证据。
3. **规范默认值**：以上都没有时，按控件类型取默认值。

判定：

- 更严格的字段约束（max 更小、min 更大）：按字段约束生成，标注「字段覆盖」，不打断用户。
- 更宽松的字段约束（max 更大、min 更小）：标记待确认（实现比规范宽松）。
- 页面没有约束：直接用规范默认值，标注「规范默认」。
- 控件类型无法判断：标记待确认，不猜。

### 6.2 数据分区

| 规范对象 | 默认分区 |
|---|---|
| 短文本（控件） | empty（若必填）、validTypical、validMin（若有 min）、validMax、invalidOverMax、whitespace（可选）、specialChars（可选）、duplicate（若唯一） |
| 长文本（控件） | empty（若必填）、validTypical、validMax、invalidOverMax |
| 数字（控件） | empty、valid、min-1、min、max、max+1、精度、非数字 |
| 日期（控件） | empty、valid、invalidFormat、min-1、max+1、跨字段范围 |
| 下拉（控件） | empty（若必填）、validOption、invalidOption（若可构造） |
| 邮箱/手机/URL（语义） | empty（若必填）、valid、invalidFormat |
| 上传（控件） | 类型、大小、空文件（后续） |

长度/日期/枚举看控件类型；格式看语义类型。一个短文本邮箱字段会同时得到「长度」和「格式」两组规则。

不是所有分区都生成：只生成适用的分区；不适用的在矩阵中显示「不适用」及原因。

### 6.3 场景生成策略

- **负向校验**：一次只让一个目标字段无效，其他字段保持基线合法（OFAT）。这样失败能定位到唯一字段。
- **正向**：一条完整基线记录 + 每个字段的合法边界值（min/max）。
- **跨字段规则**：日期范围、重复、关联字段用专门规则生成，不靠通用组合。
- **组合强度**：P0 只做分区覆盖；P1 可对高风险字段做 pairwise；不做全笛卡尔积。
- **上限**：矩阵生成时给出场景数上限与覆盖摘要，超出时提示，不静默截断。

### 6.4 测试层级

- `ui`：真实页面；关注 `maxlength` 截断、自定义组件行为、`fieldInvalid` / `fieldError`。
- `api`：绕过 UI 限制；关注状态码、错误码、后端长度/格式/唯一性校验。
- UI 的截断场景由字段的 `maxlength` 证据附加，不是规范的默认规则；没有 `maxlength` 时，超长场景的 UI 预期取决于前端校验，未知则待确认。
- 同一数据规则可以有两个层级版本；矩阵分别显示。
- 如果不知道校验发生在哪一层（前端字段错误 / 后端 toast / 无提示），预期先标记待确认，选择 `fieldError` / `pageText` / API 断言，不硬套 `fieldInvalid`。
- P0 以 UI 为主；API 场景可以先生成但标记「待确认/未覆盖」，避免假失败。

### 6.5 数据生命周期

- 生成：模板 + 有效约束 + 种子；唯一字段加运行级后缀。
- 空值构造：下拉/组件有默认值时，需要先清空；无法清空的字段标记待确认，不生成必然失败的场景。
- **组合约束**：长度边界值必须同时满足字段的语义格式（邮箱/手机/URL）。例如邮箱 local part 上限 64、地址总长上限 254，规范默认的 255/256 字无法构成合法邮箱；此时标记「数据待构造」并跳过，不生成格式非法的正向数据。
- 前置：重复校验引用已有记录；需要造数据的场景显式声明 `preconditions`。
- 清理：正向/写数据场景必须有 `cleanup`，或使用专用测试环境。
- 真实环境默认只跑负向；正向写数据必须由用户确认。
- 数据记录保存实际值；重跑时可选重新生成或复用快照。
- AI 提示词不包含真实业务数据；数据只保存在本地。

### 6.6 覆盖口径

- 覆盖项 = 规范 × 字段 × 分区。
- 设计覆盖 = 有 ready 场景的覆盖项 / 适用覆盖项。
- 执行覆盖 = 已执行过的覆盖项 / 适用覆盖项。
- 通过率 = 通过 / 已执行。
- `pending`、`excluded`、`blocked` 单独统计。
- 一个场景可以覆盖多个覆盖项（如正常流覆盖多个字段的 valid 分区），但负向场景只记目标覆盖项，避免虚高。

## 7. 交互形态

测试设计不是顶栏按钮，而是 AI 对话里的「设计会话」：

- **入口**：在 AI 对话中提出需求，或 AI 识别到表单时主动建议；不提供独立顶栏工具按钮。
- **对象摘要**：功能名、入口、字段数、流程步骤。
- **字段表**：字段、控件类型、有效约束、来源、确认状态；约束可直接编辑。
- **例外问题**：只列控件分类不明、页面约束超规范、必填性不明、重复数据来源、写数据确认。
- **矩阵**：按规范/字段分组，每行显示分区、数据预览（如「257 字」）、预期、测试层级、状态。
- **覆盖摘要**：规范 × 字段 × 分区；设计覆盖、执行覆盖、通过率、待确认。
- **操作**：确认、生成用例、保存到用例库、执行。
- **可解释**：点击场景显示「规范 + 有效约束 + 数据模板 + 预期理由」。
- **持久化**：设计会话、矩阵、数据记录可重新打开，不丢失。

## 8. 全局检查：这个模型是否合理

| 检查点 | 结论 | 处理 |
|---|---|---|
| 规范与页面解耦 | 成立 | 规范默认 + 字段覆盖；页面只提供证据 |
| 规范与数据分离 | 成立 | DataRule/DataTemplate 与 DataRecord 分开 |
| 控件类型与语义类型 | 已拆分 | 长度/日期看控件，格式看语义；避免短文本邮箱漏格式规则 |
| 场景与绑定分离 | 成立 | 矩阵不存定位器；绑定独立版本化 |
| 预期结果归属 | 需明确 | 放在 Scenario/CaseBinding，不放在 DataRecord |
| UI 与 API | 关键边界 | `testLevel` 显式；P0 UI-only，API 待确认 |
| 数据爆炸 | 可控 | 负向 OFAT、正向基线；P1 再做 pairwise |
| 必填性 | 需区分 | 字段级约束，不是控件类型默认 |
| 跨字段规则 | 已覆盖 | Scenario/CoverageItem 用 `fieldIds`；日期范围、确认密码等专用规则 |
| 页面约束冲突 | 有规则 | 更严格按页面，更宽松待确认 |
| 写数据清理 | 风险 | 写操作需确认 + cleanup；真实环境默认负向 |
| 覆盖口径 | 需明确 | covered ≠ passed；设计覆盖与执行覆盖分开 |
| 矩阵与用例 | 需定义 | 矩阵是设计源，用例是执行物，双向 trace |
| AI 边界 | 成立 | AI 分类/提问，不发明规范和预期 |
| 多步/弹窗 | P1 | 流程模型；P0 先单步/弹窗 |
| 数据唯一性 | 需机制 | 运行级后缀 + 快照 |
| 长度语义 | 开放 | 字符 vs UTF-16；inclusive/exclusive |
| 真实数据安全 | 约束 | 本地、脱敏、不默认写 |

整体判断：**模型成立；建议先按下面六条默认边界实现，评审时可改。**

1. **预期归属**：预期在场景/绑定，不在数据记录。
2. **UI/API**：P0 只做 UI；API 场景生成但标记待确认，不混跑。
3. **数据爆炸**：负向 OFAT，正向基线，不做全组合。
4. **写数据**：必须确认 + cleanup；真实环境默认只跑负向。
5. **覆盖口径**：覆盖 = 已执行分区；通过率单独算。
6. **长度语义**：按字符计数（Unicode code point），默认包含边界；`operator` 显式记录。

## 9. 交付顺序

### P0：规范 + 数据规则 + 设计会话（垂直切片）

- 规范：必填、长度（短文本 256 / 长文本 1000）、格式（邮箱/手机/URL）、下拉/日期基础规则、重复（有现成数据源时；否则待确认）。
- 数据层：DataRule、DataTemplate、DataRecord、DataProfile；分区覆盖。
- 对象模型：字段、控件类型/语义类型、有效约束、来源、确认状态。
- AI 设计会话：探测、分类、套规范、生成矩阵与数据；只问例外。
- 矩阵持久化、数据预览、覆盖摘要。
- UI 层负向执行；正向/写数据显式确认 + cleanup。
- 单层弹窗表单：入口点击 + 单表单；多步流程放到 P1。
- CCMS「新建版权合同」验收。
- 生成用例走现有 Runner 与运行记录，保存到用例库，矩阵与用例双向追溯。

验收：

1. CCMS 列表页发起设计，AI 询问是否打开新建表单。
2. 打开后按控件类型/语义类型分类 9 个字段：短文本默认 ≤256，长文本默认 ≤1000。
3. 合同名称页面 `maxlength=50` 被识别为字段覆盖，按 49/50/51 生成；不逐字段确认。
4. 生成 ≥15 条场景，包含必填、长度、重复、日期/范围、正常流。
5. 每条场景能看到规范、有效约束、数据模板、预期、测试层级。
6. UI 层可执行场景走正常运行记录；API 场景标待确认/未覆盖。
7. 没有配置模型密钥时，仍可手动确认控件类型/约束并生成矩阵。

### P1：流程与数据增强

- API 层执行，UI/API 同一场景双层级结果。
- 重复校验的数据准备、前置与清理。
- 多步表单、复杂弹窗流程建模。
- pairwise / 混合强度组合。
- 项目级规范覆盖配置。
- 失败重跑、按规范/字段/分区筛选。
- 页面改版后的重新绑定。

### P2：规范资产化

- 项目规范包编辑/导入导出。
- 需求文档、OpenAPI schema 导入字段与约束。
- 列表/CRUD/权限/状态流转规则包。
- 覆盖看板与趋势。
- 数据脱敏、数据集管理、环境隔离。

## 10. 与现有代码的关系

保留并复用：

- 字段探测（`designPage`）——降级为「控件分类与证据采集」，不作为规则来源；
- 语义断言 `fieldInvalid` / `fieldError`；
- Runner、定位器、回放、证据；
- 矩阵卡的 UI 结构；
- 数据编辑交互。

降级或移除：

- 仅凭 HTML 约束生成/跳过场景的逻辑；
- 自动打开新建表单作为默认行为；
- 不落运行记录的设计执行；
- 临时矩阵状态与一次性卡片；
- 把浏览器截断当作后端校验的预期。

当前 S1 代码作为原型保留，不在此基础上继续打补丁；P0 开始时按 v2.1 重构数据模型和交互。

## 11. 开放问题

- 短文本 256、长文本 1000 作为 v1 默认值；是否还需要更细的分类（名称类 50、搜索框 50）？
- 长度按 Unicode code point 还是 UTF-16 code unit 计数？emoji 算几个字？
- 页面约束与规范冲突时，「更严格按页面、更宽松待确认」是否作为固定策略？
- P0 是否只做 UI 层？API 层是 P1 还是 P0 的一部分？
- 真实环境的正向写数据默认禁止，还是每次确认？
- 重复校验的数据来源优先级：列表已有值 > 用户指定 > 自动造数？
- 设计会话保存为独立资产，还是直接落成测试计划/套件？
- 矩阵场景与用例保持一对一，还是允许一个场景绑定多条数据记录？
