# 测试设计交互调研：从「聊天卡片」到「设计工作台」

> 调研时间：2026-10-20。目的：回答当前测试设计卡「为什么不好用」，以及主流测试平台如何承载「规范 → 场景 → 数据 → 执行」这条链路。

## 0. 结论

当前设计卡的问题不是样式，而是**承载介质的错配**：

- 生成出来的是一份需要仔细审阅、编辑、分组、批量操作、长期保存的**结构化资产**；
- 却把它塞进了聊天流里的一个**窄卡片**，用逐行内联输入框编辑，用一排按钮串起「生成用例 → 执行 → 保存」三个动作。

主流产品几乎没有把测试设计矩阵放在聊天卡片里的。它们通常分成两类：

1. **测试管理工具**（TestRail、Xray、Zephyr、qTest、Azure Test Plans）：测试用例是核心资产；数据驱动是测试用例的一种属性——一个用例 + 一张数据表，表的每一行是一次执行迭代。
2. **AI 原生测试平台**（Testrail AI、Testsigma、Octomind、aqua cloud、mabl）：AI 先生成草案，草案进入**待审队列/工作台**，人审阅、编辑、批量接受后才进入用例库；未审的草案算覆盖缺口。

通用 AI 交互设计也给出同样的判断：短小、只需识别的内容用**内联预览**；长、复杂、需要编辑和深入操作的内容用**画布/独立面板**，让产物成为主焦点。

因此建议：**AI 侧栏只负责发起、摘要和状态；完整设计进入主区的「测试设计工作台」**。工作台采用「字段 × 规范」矩阵做总览，「场景表 + 数据迭代表」做审阅编辑，「详情抽屉」看步骤、断言和证据。

---

## 1. 主流测试管理工具怎么做

### 1.1 共同抽象：测试用例 + 参数 + 数据集

五家主流工具的核心模型高度一致：

```text
Test Case（步骤模板，步骤里写 ${参数}）
  └── Dataset（数据表：列 = 参数，行 = 一次迭代）
        ├── row 1 → iteration 1
        ├── row 2 → iteration 2
        └── ...
```

执行时不是为每个数据点建一条用例，而是**一条用例跑多行数据**。这正好对应当前「一个字段的长度规则产生 255/256/257 三条场景」的场景爆炸问题：主流做法是**一条「长度规则」用例 + 三行数据**。

### 1.2 各家细节

| 产品 | 参数写法 | 数据表 | 复用与执行 | 备注 |
|---|---|---|---|---|
| **TestRail**（Enterprise） | 用例文本字段中的变量占位符 | Dataset：列 = 变量，行 = 值组合；1 个默认 + 最多 99 个附加 | 按 dataset 创建 test run；可捆绑进同一 test plan；运行关闭时快照值 | 项目级变量上限 500；空值回退默认 dataset；支持 CSV 导入导出 |
| **Xray** | `${Param}`（步骤/数据/预期）；BDD 用 `<Param>` | 列 = 参数，行 = 迭代；支持 Text / List 类型 | 数据集作用域：Test → Test Plan > Test → Test Execution > Test，越靠近执行越优先 | 组合参数（`*` 后缀）自动生成笛卡尔积并支持 seeding；CSV 导入；官方说明「不提供基于参数的报告」 |
| **Zephyr Scale** | 步骤里输入 `{` 插入列名 | Test Script 页签启用 Test Data，表格列 = 变量 | Test Player 中每一行展开为一组步骤；数据集可在 Configurations 中复用 | 目前不能只执行某一行，总是遍历全部行 |
| **qTest** | Parameter（Identifier + Values） | Dataset = 多个参数的取值组合 | 一条参数化用例自动生成多条 Test Run | Parameters 是独立模块，支持 Excel 导入导出 |
| **Azure Test Plans** | 步骤动作/预期结果里写 `@param` | 步骤下方表格：每行一组参数值 | Shared Parameters 可跨用例复用；Test Runner 逐行迭代 | 一个用例只能挂一个 shared parameter set；Excel 粘贴导入导出 |

来源：

- TestRail: <https://support.testrail.com/hc/en-us/articles/7768851133716-Test-parameterization-variables-and-datasets>
- Xray: <https://getxraydocs.atlassian.net/wiki/spaces/XRAYCLOUD/pages/44566351/Parameterized+Tests>
- Zephyr Scale: <https://support.smartbear.com/zephyr/docs/en/test-cases/data-driven-test-design.html>
- qTest: <https://docs.tricentis.com/qtest-2025.8/content/parameters/user_guides/parameters.htm>
- Azure Test Plans: <https://learn.microsoft.com/en-us/azure/devops/test/repeat-test-with-different-data?view=azure-devops>

### 1.3 对 ATP 的启示

1. **数据表是测试用例的一部分，不是场景列表里的一个输入框。** 当前每个场景一行、行内一个 `input` 的交互，在数据一多时就不可读。
2. **数据集要能复用。** 同一套「短文本边界值」可以复用到合同名称、被授权方、备注；不需要每个字段重新生成一遍。
3. **预期结果要能随数据行变化。** Xray/TestRail 的预期文本里可以引用参数；主流的「257 字」行预期是 `invalid`，而「50 字截断」行预期是具体值。
4. **执行是按行迭代，不是按场景逐条点。** 运行结果应该落到「用例 + 迭代行」，而不是把每一行当成独立用例。
5. **覆盖率和通过率分开。** 这是主流测试管理工具的共识，也是当前模型已经做对的部分。

### 1.4 国内工具的补充观察

国内测试管理工具的强项通常在「用例库、评审、需求关联」，数据驱动能力相对弱一些：

- **禅道**：开源版用例模板没有独立的「测试数据」字段，需要企业版自定义；参数化实践多靠多条步骤数据、CSV 导入，或配合 ZenData 生成数据。
- **PingCode**：公开资料强调用例库、用例评审、需求-用例-缺陷追踪和测试计划，未检索到原生的参数化/数据驱动用例能力。
- **MeterSphere**：参数化主要落在接口自动化场景层（列表参数、CSV 参数、循环控制器），不是测试设计层的「用例 + 数据集」模型。

这从反面说明：**「规范/规则 → 用例模板 → 数据集」这一层，主流产品并没有做得很好；ATP 的机会恰恰在这里。** 但也应借鉴它们成熟的用例库、评审和执行闭环，而不是把设计做成另一套孤立的清单。


---

## 2. AI 生成测试用例的产品怎么做

### 2.1 TestRail AI：Define → Review/Edit/Select → Generate

TestRail 9.5（2025-09）的 AI 用例生成流程明确分成三步：

1. **Define**：输入需求、选择模板和目录；
2. **Review, edit, and select**：审阅 AI 建议的用例，实时修改，选择哪些进入下一步；
3. **Generate**：生成带步骤和预期结果的完整用例。

它强调的是「在生成前引导 AI」，而不是「生成后收拾残局」。来源：<https://www.testrail.com/lp/ai-test-management/>

### 2.2 Testsigma：Pending 待审队列 + 批量接受

Testsigma 的 Atto 生成用例后，用例进入 **Pending** 状态，而不是直接入库：

- 顶部显示 Accepted / Pending / Rejected 数量；
- 用例**按 scenario 分组**，展开后看到优先级、名称、模块、类型、状态；
- 点开单条进入详情：标题、模块、类型、状态、描述、前置条件、编号步骤与预期结果；
- 支持勾选后底部批量操作：Select All / Reject / Save to Library；
- 保存时选择目录，Atto 会按功能分类推荐目录；
- **Pending 未处理算覆盖缺口**；Rejected 不计入覆盖；Accepted 才进入用例库；
- 覆盖率随接受实时更新。

来源：<https://testsigma.com/docs/test-management/qi-home/review-and-accept-test-cases/>

这是与当前设计卡最直接的对照：主流把「AI 生成」当成一个**审阅队列**，而不是一张即时执行卡。

### 2.3 Octomind：推荐用例 → 修改提示词 → 生成 → 校验

Octomind 的流程：

- AI 先探索站点，给出推荐用例列表；
- 生成前把 AI 准备好的 prompt 展示给用户，可自然语言修改、重命名，再 Generate / Finalize；
- 生成后可在右侧面板 Validate，确认用例能跑通；
- 成功的用例自动切换为 Active；失败步骤显示黄色告警并提供 Repair；
- 用例以列表行呈现，行尾 `+` 可以继续生成推荐用例。

来源：<https://octomind.mintlify.dev/docs/build-tests/recommended-tests>

启示：**生成前可改意图，生成后可先验证再启用**。当前设计卡是「先生成场景，再生成用例，再执行」，中间没有「预览/校验」这一步，用户无法在入库前知道用例长什么样。

### 2.4 aqua cloud：先选测试设计技术，再生成

aqua 的 AI Copilot 在生成前让用户选择测试设计技术：

- Boundary Value Analysis（边界值）
- Equivalence Partitioning（等价类）
- Decision Table Testing（决策表）

生成后先预览，可重新生成，只保留想要的；同时生成测试数据集，并把变量插入每条用例。

来源：<https://docs.aqua-cloud.io/documentation/ai-copilot/generate-test-cases-with-ai-copilot-using-test-design-techniques>

启示：用户心智不是「一键生成 12 条」，而是「我这次要按哪些规范/技术来设计」。这与你之前定的「先有规范，再看组件，再出断言」完全一致。设计入口应该让用户看见并调整**规范范围**，而不是只给一个「重新分析」图标。

### 2.5 mabl / QA Wolf：生成在列表或覆盖矩阵里，不在聊天里

- mabl 的 Test Creation Agent 从自然语言生成端到端测试，测试进入 **plans**，在列表/计划中维护；生成结果需要 review before using。
- QA Wolf 的流程是 **Outline → Create → Run**：AI 先给出可测试路径的 coverage outline，用户批准 coverage matrix，再生成 Playwright 测试；失败由人工辅助 AI 分诊。

来源：

- mabl: <https://www.everydev.ai/tools/mabl>
- QA Wolf: <https://docs.qawolf.com/qawolf/Welcome-to-QA-Wolf>

启示：**覆盖矩阵是给人审批的，不是聊天里的装饰。** 当前卡片把覆盖率压缩成一行百分比，用户无法点进去看「哪个字段的哪个分区没覆盖」。

---

## 3. 通用 AI 交互原则

### 3.1 内联预览 vs 画布预览

AWS Cloudscape 的 Generative AI 模式给出了明确判断：

| 维度 | 内联预览 | 画布/侧面板预览 |
|---|---|---|
| 复杂度 | 简单、自包含 | 复杂、可交互 |
| 长度 | 短 | 长 |
| 用户意图 | 快速识别、基础动作 | 详细审阅、编辑、交互 |
| 动作 | 下载、复制、分享 | 编辑、标注、完成工作流 |
| 交互深度 | 最小，不需要打开 | 深入，用户要在里面工作 |
| 对话流 | 保持聊天流很重要 | 产物成为主焦点 |

来源：<https://cloudscape.design/gen-ai/patterns/artifact-previews/index.html.md>

测试设计矩阵显然属于右列：长、复杂、需要编辑、需要深入操作、产物是主焦点。把它放在聊天卡片里，等于用内联预览承载画布内容。

### 3.2 Human-in-the-loop 的状态机

AI UX Playground 把「人在回路」拆成六个状态：

```text
Proposed → Under review → Editing → Approved → Executed
                         ↘ Rejected
```

必要元素：

- **Action**：具体说明会发生什么（动词 + 对象）；
- **Scope**：目标、数量、边界，并能查看/编辑细节；
- **Impact**：谁会受影响、是否持久、是否可见；
- **Reason**：为什么现在需要确认；
- **Alternatives**：编辑和拒绝要同样显眼；
- **Recovery**：能否取消、撤销或只能事后补救。

反模式：

- 静默自动应用，只留一个隐藏的 undo；
- 审批界面不展示实际 payload（例如不展示 diff、邮件正文、金额）；
- 一个全局「总是允许」，之后不再询问；
- 副作用已经发生后才请求批准。

来源：<https://aiuxplayground.com/pattern/human-in-the-loop>

对照当前设计卡：用户看到的是场景标题和一行数据，看不到生成的步骤和断言（payload 不完整）；「执行选中」直接产生运行副作用；「保存到用例库」也没有 diff。审批要素缺失。

### 3.3 聊天是控制面，产物是画布

Anthropic Artifacts / ChatGPT Canvas 以及多数 Agent 产品的共同模式：

- 聊天负责表达意图、调整方向、解释结果；
- 产物进入独立画布，用户直接编辑、版本化、审阅；
- 应用前展示 diff 或完整内容，而不是在聊天里逐条确认。

这与 Cloudscape 的判断一致，也是「设计卡」最根本的问题：**把控制面和产物混在了一起**。

---

## 4. 当前设计卡的具体问题

结合 `apps/web/src/ai/TestDesignCard.tsx` 的实现，逐条对照：

| 问题 | 现状 | 主流做法 |
|---|---|---|
| 宽度不足 | 卡片在右侧 AI 面板内，约 300px | 主区工作台 / 画布 |
| 信息密度失控 | 9.5px 字号、`max-h-56` 滚动、字段详情折叠 | 表格 + 详情抽屉，分层展示 |
| 场景爆炸 | 一个数据点一条场景，行内一个输入框 | 一条用例 + 数据表多行迭代 |
| 预期不可见 | 列表只显示数据，不显示预期/断言 | 详情展示步骤、预期、断言 |
| 动作顺序不清 | 生成用例 → 执行选中 → 保存到用例库，三个按钮平铺 | Accept → 入库；从计划/运行执行 |
| 无法批量编辑 | 逐行改数据 | 数据表批量编辑、CSV 导入 |
| 待确认不可处理 | 只显示「待确认」和原因 | 待审队列，可编辑约束/补数据/接受/拒绝 |
| 会话易丢失 | 卡片可关闭，聊天滚动后难找回 | 持久化设计会话，独立入口 |
| 覆盖不可下钻 | 一行百分比 | 字段 × 规范矩阵，点单元格看缺口 |
| 无预览/校验 | 生成用例后直接执行 | 先预览 diff，再试跑/校验，再入库 |

---

## 5. 建议的目标交互

### 5.1 总体结构：AI 发起 + 设计工作台

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 设计会话：新建版权合同   页面：/contracts/new   规范：短文本/长文本/格式…      │
│ 12 场景 · 8 可执行 · 2 待确认 · 2 跳过   设计覆盖 67%   已接受 0   执行 0/8  │
├───────────────┬──────────────────────────────────────────────┬───────────────┤
│ 字段 / 规则    │ 场景表（按字段分组）                          │ 详情 / 预览    │
│               │                                              │               │
│ ▼ 合同名称 5  │ ▼ 合同名称                                    │ 标题           │
│   必填 1      │  ☐ 必填 · 空值          数据 [空]  预期 拒绝  │ 规则/分区      │
│   长度 3      │  ☐ 长度 · 255/256/257   数据 ▸ 3 行 预期 通过  │ 数据行（表格） │
│   重复 1      │  ☐ 重复 · 已存在名称    数据 [xxx] 预期 拒绝  │ 预期/断言      │
│ ▼ 授权平台 3  │ ▼ 授权平台                                    │ 步骤预览       │
│   ...         │  ☐ 必填 · 空值          数据 [空]  预期 拒绝  │ 证据/来源      │
│               │  ...                                         │               │
├───────────────┴──────────────────────────────────────────────┴───────────────┤
│ 已选 6 条 · [接受并入库] [拒绝] [创建执行] [导出 CSV] [重新分析]              │
└──────────────────────────────────────────────────────────────────────────────┘
```

三个区域各司其职：

1. **左侧字段/规则树**：回答「设计覆盖了哪些对象、哪些规范」。点击筛选中间表。
2. **中间场景表**：回答「生成了什么、数据是什么、预期是什么、状态是什么」。支持分组、批量选择、内联编辑。
3. **右侧详情抽屉**：回答「这条用例具体怎么跑、断言什么、为什么这样设计」。展示步骤、预期、断言、数据行、来源与证据。

### 5.2 两种视图：矩阵总览 + 场景清单

主流工具多采用「用例列表 + 详情」，但你的模型天然适合一张总览矩阵。建议提供两个页签：

**矩阵视图**（回答覆盖是否完整）

```text
              必填    长度    格式    重复    下拉    日期范围   正常流
合同名称        ●       ●       -       ●       -       -          ●
被授权方        ●       ●       -       ●       -       -          ●
联系邮箱        -       ●       ●       -       -       -          ●
备注            -       ●       -       -       -       -          ●
```

- 单元格显示状态：`● 已覆盖`、`◐ 部分`、`○ 待确认`、`— 不适用`；
- 点击单元格 → 中间表过滤到该字段 + 规范；
- 顶部统计设计覆盖 / 执行覆盖 / 通过率。

**场景视图**（回答具体怎么测）

按字段分组的可展开列表，每个场景一行；展开后是数据行表格：

```text
▼ 合同名称 · 长度校验
  ┌────┬──────────────┬──────────┬──────────┬────────┐
  │ ✓  │ 分区          │ 数据      │ 预期      │ 状态    │
  ├────┼──────────────┼──────────┼──────────┼────────┤
  │ ☐  │ validMax-1   │ 255 字    │ 通过      │ 可执行  │
  │ ☐  │ validMax     │ 256 字    │ 通过      │ 可执行  │
  │ ☐  │ invalidOver  │ 257 字    │ 拒绝      │ 待确认  │
  └────┴──────────────┴──────────┴──────────┴────────┘
```

这直接解决「一个数据点一条场景」的爆炸：**场景是用例模板，数据行是迭代**。当前 `DesignScenario` 里的 `value` 应该下沉为 `DesignDataRecord` 的一行；一个场景可以关联多条数据记录。

### 5.3 审阅队列，而不是即时执行

采用 Testsigma 的状态模型，但保留 ATP 的本地资产语义：

```text
AI 生成 → Pending（待审）
            ├── 编辑数据/预期/约束
            ├── Accept → 进入用例库（Accepted）
            └── Reject → 不计入覆盖（Rejected）
Accepted → 加入执行计划 / 立即执行 → Run
```

- 顶部固定显示 Accepted / Pending / Rejected 数量；
- Pending 算设计覆盖缺口，Rejected 不算；
- 「接受」时选择模块/目录，并展示将写入的用例名、步骤数、断言数；
- 批量接受/拒绝；
- 接受后不立刻执行，执行走现有「计划/运行」链路，避免设计面板承担运行器职责。

### 5.4 数据编辑：表格而不是单行输入

- 场景展开后是数据表，列 = 字段，行 = 迭代；
- 支持单元格编辑、整行复制、删除行、新增行；
- 支持从 CSV 导入/导出；
- 生成数据时显示构造依据：`规范默认 256`、`页面 maxlength=50`、`格式 email`；
- 无法构造合法值的行标记「数据待构造」，不生成假阳性。

### 5.5 生成前：规范范围与测试层级

参考 aqua cloud 的「先选技术」与 TestRail 的「Define」：

- 生成前弹出/展开一个 Define 区：
  - 范围：当前页面 / 指定弹窗 / 指定字段；
  - 规范：必填、长度、格式、重复、下拉、日期范围、正常流（可勾选）；
  - 层级：UI / API（P0 只 UI）；
  - 数据策略：规范默认 / 页面覆盖 / 自定义数据集。
- 生成后先给摘要：`识别 5 个字段，将生成 12 个场景，其中 8 可执行、2 待确认、2 跳过`；
- 用户确认后再进入工作台，避免「一点就生成一屏」。

### 5.6 生成后：先预览，再接受

参考 Octomind 的 Validate 与 HITL 的 payload 要求：

- 详情抽屉展示生成的步骤和断言（可折叠）；
- 提供「试跑这一条」：只跑当前场景，展示证据、截图、失败原因；
- 接受前展示 diff：将新增哪些用例、写入哪个模块、带哪些步骤；
- 失败/不可执行的场景不允许接受为可执行用例，只能保存为草稿或标记待确认。

### 5.7 AI 侧栏的角色

AI 侧栏不再是设计矩阵的容器，而是：

- **入口**：识别意图，问清范围（页面/字段/规范/层级）；
- **摘要卡**：`已生成 12 个场景（可执行 8，待确认 2，跳过 2）`，两个动作：`打开设计工作台`、`重新分析`；
- **解释**：回答「为什么这条待确认」「这个字段用了哪条规范」；
- **会话恢复**：从设计工作台回到 AI，继续调整范围或重新生成。

卡片高度控制在 3–5 行，不再内嵌场景列表。

---

## 6. 数据模型调整建议

当前模型（`packages/model/src/domain/test-design.ts`）已经有 `DesignScenario`、`DesignDataRecord`、`DesignCoverage`，方向是对的；需要把「场景 vs 数据」的层级再拉开：

```text
DesignScenario（用例模板）
  id, fieldRef(s), ruleId, title, kind, expected, testLevel,
  status: pending | ready | accepted | rejected,
  dataRecordIds: string[]        // 一个场景多条迭代
  steps?: BlueprintStep[]        // 生成后预览
  assertions?: Assertion[]

DesignDataRecord（一次迭代）
  id, values, expectedValue?, source, preconditions, cleanup

DesignDataset（可复用数据集，P1）
  id, name, columns, rows, scope
```

关键变化：

1. `DesignScenario.value` 下沉到 `DesignDataRecord`；场景只保留模板级信息。
2. `status` 增加 `accepted` / `rejected`，把「可执行」与「已入库」分开。
3. `coverage` 增加 `accepted` 维度：设计覆盖、接受覆盖、执行覆盖、通过率四个口径。
4. `DesignDataRecord` 增加 `expectedValue`，支持同一场景不同数据行不同预期（例如截断行）。
5. 生成用例时，一个场景生成一条用例，数据行生成迭代；不再一条数据一条用例。

---

## 7. 落地顺序建议

### P0：把「卡片」换成「工作台」

- 新增主区「设计」入口（左侧导航或全屏面板）；
- AI 卡片缩成摘要 + 打开工作台；
- 工作台：字段/规则树 + 场景表 + 详情抽屉；
- 场景按字段分组，数据行可展开编辑；
- 详情展示预期、步骤、断言；
- Accept / Reject / 批量操作；
- 执行走现有运行链路，结果回写。

### P1：数据与评审增强

- 可复用数据集、CSV 导入导出；
- 矩阵视图与覆盖下钻；
- 生成前 Define 区（规范/范围/层级）；
- 试跑单条 + diff 预览；
- API 层级场景。

### P2：协作与治理

- 设计会话版本、审计记录；
- 规范库可视化编辑；
- 与需求/缺陷系统联动。

---

## 8. 已确认方案（P0 已落地）

1. **入口形态**：AI 对话只出 3–5 行摘要卡，完整设计进全屏工作台；详情与 AI 收进按需右抽屉（v2，见 8.2）。
2. **场景与数据的关系**：采用「一条场景 + 多行数据」。场景是用例模板，数据行是迭代；同一规范下不同预期拆成不同场景（合法边界 / 非法边界）。
3. **接受后的动作**：P0 只入库并标记 `accepted`；加入现有计划放 P1。
4. **矩阵视图**：P0 保留，用于回答「覆盖是否完整」，点击单元格下钻到场景视图。

### 8.1 落地口径

- **场景状态**：`ready | partial | pending` 由数据行派生；`accepted | rejected | excluded` 是审阅状态，编辑数据会重置回派生状态。
- **执行层**：P0 每个可执行数据行生成一条用例（名称带行标签）；参数化用例 / Runner 数据集放 P1。
- **覆盖口径**：设计/接受/执行覆盖都按数据行计算，通过率单独统计；被拒绝场景不计入覆盖。
- **持久化**：`design_sessions` 仍存整份矩阵 JSON；`revision` 做乐观并发，浏览器手改与 AI 直写都带 `baseRevision`，冲突提示重新加载。旧快照（`schemaVersion !== 2`）直接丢弃。
- **AI 直接操作**：`design_query / design_select / design_update_data / design_decide / design_run`。
  - 直接执行：读摘要、筛选/选择、改数据行、接受/拒绝、执行非写数据行；
  - 仍需用户确认：保存到用例库、执行 `requiresWrite` 的行；
  - 每次直写推送 `event:design-updated`，工作台替换矩阵并保留撤销；选择/筛选/视图走 `event:design-command`。
- **执行结果**：按 `scenarioId + dataRecordId` 回写行 `lastRun`，工作台自动持久化，刷新后覆盖与通过率不丢。
- **全屏与原生浏览器**：工作台打开时 `useOverlayGuard` 收起原生视图，MJPEG 镜像也暂停；关闭后恢复。头部「返回页面」或 `Esc` 关闭。
- **主要文件**：
  - 模型与引擎：`packages/model/src/domain/test-design.ts`、`packages/test-design/src/index.ts`
  - 持久化与 IPC：`packages/core/src/db/repositories/design-sessions.ts`、`packages/model/src/ipc/contract.ts`
  - Agent：`apps/agent/src/design.ts`、`apps/agent/src/agent.ts`、`apps/agent/src/ai/design-tools.ts`
  - Web：`apps/web/src/design/*`、`apps/web/src/ai/AiPanel.tsx`、`apps/web/src/ai/TestDesignCard.tsx`
- **验收**：`pnpm e2e` 覆盖「摘要卡 → 工作台 → 矩阵下钻 → 抽屉打开/关闭 → 编辑持久化 → AI 筛选/改数据/撤销 → 排除 → 按行执行 → 接受入库」。

### 8.2 v2：两栏 + 按需抽屉

v1 的三栏常驻（左字段树 + 中场景列表 + 右详情）在 1440×900 下同时出现 5 个区域，统计与徽章重复，主操作被淹没。v2 按「一个主画布 + 按需浮层」收敛：

- **布局**：顶栏 52px（返回、范围与 URL、场景/矩阵切换、覆盖摘要、保存状态、AI、`⋯`）；场景视图下为 40px 筛选条 + 全宽场景列表（`max-w-1040` 居中）；底部 48px 操作栏。矩阵视图不显示筛选条。
- **筛选条替代左树**：字段下拉、规范多选浮层（`filter.ruleIds`）、状态下拉；右侧显示当前可见的可执行行数、`全选可执行`、`清空`、`跳过 N 项` 原因浮层、`清除`。筛选条不换行（可压缩字段/规范控件，其余 `shrink-0`）。
- **场景行**：44px 高，标题剥离字段名与页面范围前缀（`内容名称-长度-合法边界` → `长度-合法边界`，`ATP Agent · 演示系统-正常流` → `正常流`），第二行是数据摘要（`4 行 · 49/50/50… → 通过`）；状态用「圆点 + 文字」，不再用大色块。展开后是语义化表格（选择/分区/数据/预期/状态/结果），数据值单元格直接可编辑并自动持久化。
- **按需抽屉**：场景标题或数据行打开 380px 右抽屉（详情 | AI），默认关闭；`Esc` 先关抽屉、再关工作台；切到矩阵视图自动关闭。≥1280px 时主内容让位（`xl:pr-[380px]`），更窄时抽屉覆盖内容并带轻遮罩。
- **详情层级**：场景标题 13px，元信息只保留「规范 · 字段」，关联字段显示字段名而不是 `df-2`，断言预览压成三行。
- **底栏**：只保留 `已选 N 个场景 / M 行 · X 行会写业务数据`、`排除所选`、`接受并入库`、`执行选中/停止`。AI 直写后的撤销条在画布底部停留 10 秒，`⋯` 菜单同时保留入口。
- **矩阵**：顶部一行紧凑指标（设计/接受/执行/通过率 + 细进度条），表格独占全宽，单元格点击回到场景视图并应用 `{ fieldRef, ruleIds: [ruleId] }`。
- **落地文件**：新增 `apps/web/src/design/DesignFilterBar.tsx`、`scenario-title.ts`；删除 `DesignFieldTree.tsx`；`DesignUndoEntry` 增加 `at` 用于撤销条过期。

---

## 9. 参考资料

### 测试管理工具

- TestRail — Test parameterization, variables, and datasets: <https://support.testrail.com/hc/en-us/articles/7768851133716-Test-parameterization-variables-and-datasets>
- Xray — Parameterized Tests: <https://getxraydocs.atlassian.net/wiki/spaces/XRAYCLOUD/pages/44566351/Parameterized+Tests>
- Zephyr Scale — Data-Driven Test Design: <https://support.smartbear.com/zephyr/docs/en/test-cases/data-driven-test-design.html>
- qTest — Parameters: <https://docs.tricentis.com/qtest-2025.8/content/parameters/user_guides/parameters.htm>
- Azure Test Plans — Repeat a test with different data: <https://learn.microsoft.com/en-us/azure/devops/test/repeat-test-with-different-data?view=azure-devops>

### AI 生成与评审

- TestRail AI Test Management: <https://www.testrail.com/lp/ai-test-management/>
- Testsigma — Review and Accept Test Cases: <https://testsigma.com/docs/test-management/qi-home/review-and-accept-test-cases/>
- Testsigma — QI Home Overview: <https://testsigma.com/docs/test-management/qi-home/overview/>
- Octomind — Recommended tests: <https://octomind.mintlify.dev/docs/build-tests/recommended-tests>
- Octomind — Create first tests: <https://octomind.mintlify.dev/docs/get-started/create-first-tests>
- aqua cloud — Generate test cases with AI Copilot using test design techniques: <https://docs.aqua-cloud.io/documentation/ai-copilot/generate-test-cases-with-ai-copilot-using-test-design-techniques>
- mabl overview: <https://www.everydev.ai/tools/mabl>
- QA Wolf docs: <https://docs.qawolf.com/qawolf/Welcome-to-QA-Wolf>

### AI 交互模式

- AWS Cloudscape — Artifact previews: <https://cloudscape.design/gen-ai/patterns/artifact-previews/index.html.md>
- AI UX Playground — Human in the loop: <https://aiuxplayground.com/pattern/human-in-the-loop>
- Beach — Designing for Delegation: <https://beach.io/blog/designing-for-delegation-ux-patterns-for-agent-driven-products>
- Designing Agents Beyond the Chatbox: <https://www.smfclearinghouse.com/guides/designing-agents-beyond-chatbox/>
