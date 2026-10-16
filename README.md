# 自动化测试平台（auto-test-platform）

面向普通人的 Web UI 自动化测试平台：在内置浏览器里「点点点」录制用例，结构化管理，一键回放，失败时有理有据（哪一步、哪个元素、哪个断言、为什么）。

- 技术方案：[docs/技术方案.md](docs/技术方案.md)
- 当前阶段：M1（Electron 桌面端 MVP）

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

**应用级：** `pnpm dev` → 新建项目 → 网址栏输入 `file://<仓库>/packages/runner/fixtures/login-form/index.html` → 打开 → 开始录制 → 登录 → 停止录制 → 保存 → 回放 → 右栏「报告」看步骤级结果与全程视频。

**自动化：**

```bash
pnpm build
./node_modules/.bin/electron apps/desktop/out/main/index.js --remote-debugging-port=9222 &
node scripts/e2e-recording.mjs    # 录制+回放全流程 E2E，直查 SQLite 断言
```

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
| 2 | 录制：click / fill / select / 按键 / 断言（可见·文本·值） | ✅ E2E 覆盖 click/fill；select/按键/断言拾取已实现（断言拾取未自动化覆盖，手动走查） |
| 3 | 用例管理：项目 / 模块树 / 用例 / 步骤编辑排序 / 元素库 | ✅ |
| 4 | 一键回放 + 执行记录（步骤级结果） | ✅ E2E：run 落库 status=passed 3 步 |
| 5 | 证据：每步截图 + 全程视频 + 失败报告有理有据 | ✅ 三幕剧幕 3（CLI 级）验证失败报告逐候选归因；应用级同链路 |

## M1 已知限制

1. **打包版回放依赖本机 Playwright 缓存**（`~/Library/Caches/ms-playwright`）：M1 的 chromium 二进制不进 dmg，启动前请执行 `pnpm -F @atp/runner exec playwright install chromium`
2. **自动更新未生效**：electron-updater 代码路径已就绪（打包版对缺失 feed 优雅跳过，已验证）；真实更新需 macOS 签名 + 公证 + feed 服务器
3. 录制支持 click / fill / select / 按键 / 断言（可见·文本·值）；拖拽、iframe、弹窗在 backlog
4. **打包版受控浏览器加载 file:// 页面失败**（chrome-error，dev 正常）——被测页请用 http(s) 地址；根因待查
5. drizzle ORM 为 1.0 beta（`node:sqlite` 适配器仅在 beta 线）；其事务对失败语句不回滚，已规避（元素写入置于步骤之后并依赖主键唯一）
6. 用户数据目录：dev / 构建产物直启 / 打包版分别为 `~/Library/Application Support/` 下的 `@atp/desktop`、`Electron`、`@atp/desktop`
7. E2E 用法：`node scripts/e2e-recording.mjs [fixtureUrl]`，环境变量 `ATP_E2E_CDP`（默认 9222）、`ATP_E2E_DB`（默认 @atp/desktop 路径）；打包版验收取 http fixture

## Backlog（按方案里程碑）

- M2：Web 平台化（服务端 + 管理台 + 多人协作，packages 直接复用）
- M3：网页端串流远控受控浏览器（CDP screencast 桥）；回放嵌回中栏（connectOverCDP）
- M4：定时执行 / CI / 通知 / 多环境参数化；录制会话本身录视频
- 远期：演示视频+配音、定位器自愈、AI 生成用例、ffmpeg 转码 MP4
