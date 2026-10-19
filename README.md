# ATP — 本地 Web UI 自动化测试 Agent

在真实 Chrome 里「点点点」录制用例，结构化保存，一键回放；失败时能说清楚：哪一步、哪个元素、哪个断言、为什么。

不启动 Electron。`atp-agent` 是一个本地 CLI：启动本地 HTTP/SSE 服务、用 Playwright 控制真实 Chrome、把 React UI 直接开在浏览器里。数据全部留在本机。

- 技术栈与架构定稿：[docs/技术栈与架构选型.md](docs/技术栈与架构选型.md)
- 功能演进方案：[docs/功能演进方案.md](docs/功能演进方案.md)
- 测试工程与测试数据研究：[docs/测试工程与测试数据研究.md](docs/测试工程与测试数据研究.md)

## 技术栈

| 层 | 选型 |
| --- | --- |
| 运行时 | Node.js 24 LTS（最低 22.17），ESM |
| 语言 | TypeScript 7（Go 原生编译器） |
| HTTP | Hono 4 + `@hono/node-server`，SSE 用 `streamSSE` |
| 数据 | SQLite（WAL）+ better-sqlite3 + MikroORM 7 |
| 契约 | Zod 4（Agent / UI / Runner 共用） |
| 浏览器 | Playwright 1.64，优先系统 Chrome，持久化 profile |
| 前端 | React 19 + Vite 8 + HeroUI + TanStack Query + Zustand |
| CLI | Commander 15 + ora + picocolors + execa |
| 构建 | pnpm + turbo + tsup（Agent）+ Vite（Web） |
| 更新 | npm 模式（检查 + 显式更新）与版本化 bundle 模式（Ed25519 验签 + 原子切换） |

## 环境要求

- Node.js ≥ 22.17（推荐 24 LTS）
- pnpm ≥ 10
- 系统安装 Chrome 优先；没有时执行 `atp-agent install-browser`

## 快速开始

```bash
pnpm install
pnpm build

# 内置演示页：录制 4 步 → 保存 → 回放 → 查看截图证据
node apps/agent/dist/cli.js --demo
```

发布为 npm 包后：

```bash
npm i -g @atp/agent
atp-agent --demo
atp-agent --url http://localhost:8080
```

启动后终端会打印本地 UI 地址，并自动打开浏览器。录制时直接操作真实 Chrome，停止后可在 UI 中保存与回放。

## 常用命令

```bash
pnpm dev                # 开发构建并启动 Agent
pnpm build              # 全量构建
pnpm typecheck          # TS 严格检查
pnpm test               # 单测 + 集成测试
pnpm lint               # Biome

pnpm e2e                # Agent 全链路：录制 4 步 → 保存 → 回放 → 截图
pnpm e2e:update         # 版本化 bundle 更新：v1 → v2 → 启动校验
```

Agent CLI：

```bash
atp-agent [start] [选项]     # 默认命令
atp-agent doctor             # 环境、数据目录、数据库、浏览器、UI 自检
atp-agent install-browser    # 安装 Playwright Chromium
atp-agent update             # npm 模式安装最新版；bundle 模式下载并切换
atp-agent version [--json]   # 版本与安装形态
```

`start` 选项：`--url`、`--demo`、`--port`、`--data-dir`、`--profile`、`--headless`、`--no-open`、`--no-update-check`。

## 目录结构

```
apps/agent            # CLI、Hono 服务、Chrome 控制、录制/回放编排、更新服务
apps/web              # React UI（Vite），由 Agent 直接托管
packages/model        # Zod 领域模型 + IPC 契约（唯一事实源）
packages/core         # MikroORM 实体/仓储/工作单元/迁移、证据路径
packages/recorder     # 注入采集器、事件归一化、定位器生成
packages/runner       # Playwright 执行引擎、断言、定位解析、证据采集
scripts               # Agent E2E、更新 E2E、版本化 bundle 构建
docs                  # 方案与研究
```

## 数据与迁移

默认数据目录 `~/.atp-agent`：

```
atp.db                # SQLite（WAL）
profile/              # Chrome 专用 profile
runs/<runId>/         # 步骤截图、视频
exports/              # 导出的 Playwright spec
agent.json            # 运行中实例的端口与数据目录（0600）
update-check.json     # 更新检查缓存
```

- 迁移由 MikroORM Migrator 在启动时执行；迁移类通过 `migrationsList` 显式注册，打包后可运行。
- 检测到旧 Drizzle / `node:sqlite` 数据库（无 MikroORM 迁移表）时，先备份为 `atp.db.legacy-<时间戳>`，再按当前 schema 重建；不做旧数据搬运。

## 打包与更新

npm 单包：`apps/agent` 由 tsup 把工作区内部包内联，第三方依赖保持 external；Web 产物复制到 `dist/web`。

版本化独立包：

```bash
ATP_UPDATE_PRIVATE_KEY="$(cat private.pem)" \
  node scripts/build-release.mjs --base-url https://example.com/releases
# 产物：release/versions/<v>/{app,runtime}、release/bin/atp-agent、release/latest.json
```

- manifest 使用 Ed25519 签名；启动器内置公钥（`ATP_UPDATE_PUBLIC_KEY`）。
- 更新下载后校验 SHA-256，解压到 `versions/.staging-*`，执行 `version --json` 健康检查，再原子切换到 `current`。
- 失败（签名、校验和、下载、健康检查）保留旧版本并清理 staging。
- npm 模式不在后台修改全局包，只提示 `atp-agent update`。

更新 E2E 使用本地 HTTP 服务器提供 v1/v2 包，验证真实下载、验签、切换与启动：

```bash
pnpm e2e:update
```

## 当前状态

已交付：

- 真实 Chrome 录制 / 回放、iframe framePath、元素候选定位与逐候选失败归因
- 项目 / 模块 / 用例 / 元素库；套件 / 计划 / 批量执行 / 重试 / 超时 / 重跑失败 / 计划报告
- 变量 `${VAR}`、步骤条件、断言库、步骤截图与视频证据
- Electron 完全移除；renderer 独立为 `apps/web`；Agent 由 Hono 托管
- MikroORM 7 数据层（`defineEntity`、仓储、工作单元、迁移、旧库备份）
- Commander CLI、doctor、单实例锁、优雅退出
- npm 与 bundle 两种更新路径
- M1 录制语义化：意图视图 / 原始步骤切换、自定义下拉合并为复合 select、弹窗/导航分组、意图摘要、待确认项合并或忽略

下一步：AI/MCP（Tool Registry、MCP Server、AI 助手、审计日志）。

## 录制语义化（M1）

执行层只认原语（click / fill / select / press / scroll / drag / wait / assert），意图层是投影，不改变回放行为。

- 自定义下拉：触发器点击后 1.5s 内点击 `role=option` / `menuitem`，合并为一条 `select`（`params.mode='custom'`）；回放时点击触发器、等待弹层、按选项文本选择并校验结果。
- 开关 / 单选：根据点击后的 `checked` / `aria-checked` 显示「开启 / 关闭」「选择 独播标识 = 非独播」。
- 弹窗：点击后出现 `role=dialog` / `aria-modal` 时，从打开到关闭的步骤归入同一组，组名取弹窗标题；组可折叠、改名、还原为原始步骤。
- 导航：URL 变化时生成导航分组。
- 字段命名：`aria-label` → 关联 label → `placeholder` → `name` → 就近表单项标签 → 元素名。
- 不确定的下拉不静默合并，标为「待确认」，可一键合并或忽略。

步骤区默认意图视图，可切换原始步骤；展开后仍能看到原始动作、定位器与命中候选。

## 元素定位策略

回放不默认取「候选里的第一个」，而是按优先级寻找唯一可交互实例：

1. 候选顺序：`data-testid` → 作用域语义（弹窗 / 表格行 / 激活 Tab / 具名容器）→ 全局语义（role / 文本）→ CSS → XPath。
2. 每个候选收集全部匹配，只有「恰好一个可见、未禁用、未被遮罩层覆盖」的元素才胜出；多命中、遮罩、隐藏、禁用都会继续尝试下一候选。
3. 作用域：弹窗内同名元素优先取弹窗内实例；同名弹窗叠加按 `z-index` 取最上层；支持嵌套作用域链。
4. 只有 CSS/XPath 命中时标记 `degraded`，报告提示补充 `data-testid`，不把 XPath 当默认方案。
5. 无法唯一确定时直接失败，记录每个候选的命中数、不可用原因与遮挡元素，避免静默点错。

## 已知限制

- 真实系统 Chrome 优先；无 Chrome 时需 `atp-agent install-browser`。
- 自动更新源默认指向 GitHub Releases，可通过 `ATP_UPDATE_URL` 覆盖；发布需配置签名私钥与平台矩阵。
- 多标签页录制仍在 backlog；同域/跨域 iframe 已支持。
- 依赖注入采集器的页面（如部分 CSP 严格站点）需允许 `addInitScript`；页面级限制会记录到录制诊断。
