/** 内置演示页：不依赖外部系统即可验证「录制 → 保存 → 回放」 */
export function demoHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ATP Agent · 演示系统</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #171717; background: #f4f6f9; }
  main { width: 460px; max-width: calc(100vw - 32px); background: #fff; border: 1px solid #e5e7eb;
    border-radius: 14px; padding: 26px 28px 22px; box-shadow: 0 12px 32px rgba(15, 23, 42, .06); }
  h1 { margin: 0 0 4px; font-size: 19px; letter-spacing: -.01em; }
  .muted { margin: 0 0 20px; color: #6b7280; font-size: 12px; }
  .field { display: block; margin-bottom: 14px; }
  .field span { display: block; margin-bottom: 6px; font-size: 12px; color: #374151; }
  input[type="text"], select { width: 100%; height: 38px; padding: 0 10px; border: 1px solid #d1d5db;
    border-radius: 8px; background: #fff; font: inherit; outline: none; }
  input[type="text"]:focus, select:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, .12); }
  .check { display: flex; align-items: center; gap: 8px; margin: 4px 0 20px; font-size: 13px; }
  button { width: 100%; height: 40px; border: 0; border-radius: 8px; background: #2563eb; color: #fff;
    font: inherit; font-weight: 600; cursor: pointer; }
  button:hover { background: #1d4ed8; }
  #toast { min-height: 22px; margin-top: 14px; font-size: 13px; text-align: center; }
  #toast.ok { color: #15803d; }
  #toast.bad { color: #b91c1c; }
</style>
</head>
<body>
<main>
  <h1>内容管理</h1>
  <p class="muted">ATP Agent 内置演示页。在这里操作，Agent 会实时记录步骤。</p>
  <form id="form">
    <label class="field">
      <span>内容名称</span>
      <input id="content-name" data-testid="content-name" aria-label="内容名称" placeholder="例如：节目_20261019" autocomplete="off" />
    </label>
    <label class="field">
      <span>节目类型</span>
      <select id="content-type" data-testid="content-type" aria-label="节目类型">
        <option value="movie">电影</option>
        <option value="series">剧集</option>
        <option value="variety">综艺</option>
      </select>
    </label>
    <label class="check">
      <input type="checkbox" id="show-title" data-testid="show-title" aria-label="显示标题" />
      显示标题
    </label>
    <button type="submit" id="save" data-testid="save">保存</button>
  </form>
  <div id="toast" role="status" aria-live="polite"></div>
</main>
<script>
  document.getElementById('form').addEventListener('submit', function (event) {
    event.preventDefault();
    var name = document.getElementById('content-name').value.trim();
    var toast = document.getElementById('toast');
    toast.textContent = name ? '保存成功：' + name : '请填写内容名称';
    toast.className = name ? 'ok' : 'bad';
  });
</script>
</body>
</html>`
}
