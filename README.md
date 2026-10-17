# 自动化测试平台（auto-test-platform）

面向普通人的 Web UI 自动化测试平台：在内置浏览器里「点点点」录制用例，结构化管理，一键回放，失败时有理有据（哪一步、哪个元素、哪个断言、为什么）。

- 技术方案：[docs/技术方案.md](docs/技术方案.md)
- 功能演进方案：[docs/功能演进方案.md](docs/功能演进方案.md)
- 测试工程与测试数据研究：[docs/测试工程与测试数据研究.md](docs/测试工程与测试数据研究.md)
- 当前阶段：L1（测试执行闭环）已交付，下一步 L2（场景覆盖与测试设计模板）

## 环境要求

- Node.js ≥ 22（`node:sqlite` 内置）
- pnpm ≥ 10
- macOS（M1 目标平台）；首次 `pnpm install` 会自动下载 Electron 与 Playwright Chromium

## 常用命令

```bash
pnpm install            # 安装 + postinstall（electron 二进制 / chromium）
pnpm dev                # 启动桌面应用（turbo 编排）
pnpm build              # 全量构建（packages → desktop）
pnpm typecheck          # TS 严格检查
pnpm lint               # biome 检查
pnpm test               # 全部单测/集成测试
pnpm -F @atp/desktop dist   # 打包 dmg（输出 apps/desktop/release/）
```

## 三幕剧走查（MVP 验收）

被测页：`packages/runner/fixtures/login-form/index.html`（账号 admin / admin123）。

**CLI 级（最快）：**

```bash
pnpm -F @atp/runner replay examples/login-success.case.json   # 幕2：回放通过
node scripts/fixture.mjs break                                # 幕3：改坏页面
pnpm -F @atp/runner replay examples/login-success.case.json   # 失败报告：逐候选失效原因
node scripts/fixture.mjs restore                              # 复原
```

**应用级：** `pnpm dev` → 新建项目 → 网址栏输入 `file://<仓库>/packages/runner/fixtures/login-form/index.html` → 打开 → 选择设备预设（可选）→ 开始录制 → 登录 → 停止录制 → 保存 → 回放（默认中栏嵌入，可切独立窗口录视频）→ 右栏「报告」看步骤级结果与证据。

**自动化：**

```bash
pnpm build
./node_modules/.bin/electron apps/desktop/out/main/index.js --remote-debugging-port=9222 &
node scripts/e2e-recording.mjs    # 录制+回放全流程（直查 SQLite 断言）
node scripts/e2e-plan.mjs         # 套件 → 计划 → 批量执行 → 重跑失败 → 报告筛选
node scripts/e2e-iframe.mjs       # iframe 录制与 framePath 回放
```

> 直启构建产物时 userData 目录是 `~/Library/Application Support/Electron`，
> 需同时设置 `ATP_E2E_DB`（见「已知限制」第 7 条）；若 9222 已被其他实例占用，
> 换一个 `--remote-debugging-port` 并设置 `ATP_E2E_CDP` 指向它。

## 目录结构

```
apps/desktop        # Electron 应用（main/preload/renderer）
packages/model      # zod schema + IPC 契约（唯一事实源，零 Electron 依赖）
packages/recorder   # 录制采集器/归一化/定位器生成（零 Electron 依赖）
packages/runner     # Playwright 回放引擎 + 证据采集（零 Electron 依赖）
scripts/            # fixture break/restore、E2E
docs/               # 技术方案
```

## M1 验收对照（方案 §6.1）

| # | 验收项 | 状态 |
| --- | --- | --- |
| 1 | Electron 应用可安装、可运行 | ✅ dmg 出包，打包版 E2E 全流程通过 |
| 2 | 录制：click / fill / select / 按键 / 断言 / 滚动 / 等待 / 拖拽 | ✅ E2E 覆盖 click/fill；断言库（状态/文本/值/属性/样式/数量/页面级）、变量与条件已实现并有 runner 单测 |
| 3 | 用例管理：项目 / 模块树 / 用例 / 步骤编辑排序 / 元素库 | ✅ |
| 4 | 一键回放 + 执行记录（步骤级结果） | ✅ 双模式：中栏 CDP 嵌入回放（步骤截图）/ 独立窗口回放（全程视频）；E2E 均覆盖 |
| 5 | 证据：每步截图 + 全程视频 + 失败报告有理有据 | ✅ 三幕剧幕 3（CLI 级）验证失败报告逐候选归因；应用级同链路 |

## L1 验收对照（功能演进方案 §5 · 测试执行闭环）

| # | 验收项 | 状态 |
| --- | --- | --- |
| 1 | 用例 → 套件 → 计划 → 批量执行 → 计划报告 | ✅ 左栏「测试计划」分段；套件/计划弹窗；右栏计划执行面板与历史报告 |
| 2 | 重试 / 超时 / 失败继续或即停 / 取消 | ✅ 计划级配置；每次尝试独立落库并标注重试次数 |
| 3 | 执行记录钉住用例版本 | ✅ `runs.case_snapshot` 保存执行时的用例 JSON；用例被删后报告仍能显示名称（未单独建 `case_versions` 表） |
| 4 | 失败用例可重跑 | ✅ 计划报告内「重跑本次失败用例（N）」，只跑失败子集并沿用计划策略 |
| 5 | 报告按计划筛选 | ✅ 报告页下拉选择计划，含重试记录与「第 N 次」标记 |
| 6 | iframe 用例回放通过 | ✅ 元素记录 `framePath`，回放/断言按 frame 索引定位；E2E 覆盖 |
| 7 | 一键批量执行 E2E | ✅ `scripts/e2e-plan.mjs`：3 条用例 × 重试 → 重跑失败 → 报告筛选 |

> 交互偏差：套件成员通过「新建/编辑套件」弹窗内的用例勾选维护，
> 暂未在用例树上做多选 → 右键加入（留待 L2 与批量操作一起补）。

## M1 已知限制

1. **打包版回放依赖本机 Playwright 缓存**（`~/Library/Caches/ms-playwright`）：M1 的 chromium 二进制不进 dmg，启动前请执行 `pnpm -F @atp/runner exec playwright install chromium`
2. **自动更新未生效**：electron-updater 代码路径已就绪（打包版对缺失 feed 优雅跳过，已验证）；真实更新需 macOS 签名 + 公证 + feed 服务器
3. 录制支持 click / fill / select / 按键 / 断言 / 滚动 / 等待 / 拖拽（含滑块验证码），含同域/跨域 iframe；支持设备预设（Desktop/Laptop/Tablet/iPhone/Android，横竖屏与缩放）、用例变量 `${VAR}` 与步骤条件；弹窗、多标签在 backlog
4. **打包版受控浏览器加载 file:// 页面失败**（chrome-error，dev 正常）——被测页请用 http(s) 地址；根因待查
5. drizzle ORM 为 1.0 beta（`node:sqlite` 适配器仅在 beta 线）；其事务对失败语句不回滚，已规避（元素写入置于步骤之后并依赖主键唯一）
6. 用户数据目录：dev / 构建产物直启 / 打包版分别为 `~/Library/Application Support/` 下的 `@atp/desktop`、`Electron`、`@atp/desktop`
7. E2E 用法：`node scripts/e2e-recording.mjs` / `e2e-plan.mjs` / `e2e-iframe.mjs`，环境变量 `ATP_E2E_CDP`（默认 9222）、`ATP_E2E_DB`（默认 @atp/desktop 路径）；直启构建产物时数据库在 `~/Library/Application Support/Electron`，两个变量都要覆盖
8. 嵌入回放通过本地 CDP 驱动受控视图：仅绑定 `127.0.0.1` 的随机端口，不对外开放

## Backlog（按 [docs/功能演进方案.md](docs/功能演进方案.md)）

- **L2 场景覆盖与测试设计模板**：hover / 双击 / 右键 / 组合键 / 上传下载 / 弹窗多标签 / 容器滚动 / 数据提取；测试设计模板；自建 Demo Admin；全局元素库；用例树多选与批量加入套件
- **L3 断言与证据**：网络断言、控制台断言、软断言；Trace / HAR / 控制台日志
- **L4 测试数据与环境**：环境与变量作用域、密钥（safeStorage）、数据配方/数据集/数据档、setup/teardown、登录态复用
- **L5 度量与规模化**：质量看板、flaky、运行对比、定时与通知、视觉/可访问性/性能断言、用例版本与导入导出、CLI 批量 + JUnit
- 远期（云化后再评估）：服务端、多用户、分布式执行
