# @atp/agent

ATP 本地 Web UI 自动化测试 Agent：用真实 Chrome 录制、保存、回放，不启动 Electron。

```bash
npm i -g @atp/agent
atp-agent --demo
atp-agent --url http://localhost:8080
```

- 启动后打印本地 UI 地址，并自动打开浏览器。
- 默认数据目录 `~/.atp-agent`：SQLite、Chrome profile、截图/视频证据。
- 录制结束后生成意图层：可读步骤、下拉合并、弹窗分组、一句话摘要；原始步骤可切换查看。
- `atp-agent doctor` 自检环境；`atp-agent install-browser` 安装 Playwright Chromium。
- `atp-agent update` 检查并更新（npm 安装模式），版本化独立包支持静默更新。

需要 Node.js ≥ 22.17。
