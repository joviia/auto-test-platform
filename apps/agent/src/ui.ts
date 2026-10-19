/** Agent 自带的最小 Web UI：录制、保存、回放、演示 */
export function renderUi(token: string): string {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ATP Agent</title>
<style>
  :root { color-scheme: light; --bg:#f6f7f9; --card:#fff; --border:#e5e7eb; --text:#171717;
    --muted:#6b7280; --accent:#2563eb; --green:#15803d; --red:#dc2626; --amber:#b45309; }
  * { box-sizing: border-box; }
  body { margin:0; font:13px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color:var(--text); background:var(--bg); }
  button { font:inherit; cursor:pointer; border:1px solid var(--border); background:#fff;
    border-radius:7px; padding:6px 11px; color:var(--text); }
  button:hover { background:#f9fafb; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button.primary:hover { background:#1d4ed8; }
  button.danger { color:var(--red); border-color:#fecaca; background:#fff5f5; }
  button:disabled { opacity:.45; cursor:not-allowed; }
  input { font:inherit; height:34px; padding:0 9px; border:1px solid var(--border); border-radius:7px;
    outline:none; background:#fff; color:var(--text); }
  input:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(37,99,235,.12); }
  header { position:sticky; top:0; z-index:5; background:rgba(255,255,255,.92);
    backdrop-filter:blur(8px); border-bottom:1px solid var(--border); padding:10px 16px; }
  .row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .brand { font-weight:700; letter-spacing:-.01em; margin-right:4px; }
  .badge { font-size:11px; padding:2px 7px; border-radius:999px; background:#f3f4f6; color:#4b5563; }
  .badge.rec { background:#fef2f2; color:var(--red); }
  .badge.run { background:#eff6ff; color:var(--accent); }
  .badge.ok { background:#f0fdf4; color:var(--green); }
  .badge.fail { background:#fef2f2; color:var(--red); }
  .addr { flex:1; min-width:220px; display:flex; gap:6px; }
  .addr input { flex:1; }
  main { max-width:1240px; margin:0 auto; padding:14px 16px 32px; display:grid;
    grid-template-columns:minmax(0,1.5fr) minmax(300px,1fr); gap:14px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
  .card-h { display:flex; align-items:center; gap:8px; padding:9px 12px; border-bottom:1px solid var(--border);
    font-weight:600; font-size:12px; }
  .card-h .muted { font-weight:400; margin-left:auto; }
  .card-b { padding:10px 12px; }
  .muted { color:var(--muted); }
  .steps { max-height:62vh; overflow:auto; }
  .step { display:flex; align-items:baseline; gap:8px; padding:7px 12px; border-bottom:1px solid #f3f4f6; }
  .step:last-child { border-bottom:0; }
  .step .idx { width:30px; flex:none; color:#9ca3af; font:11px ui-monospace, SFMono-Regular, monospace; }
  .step .act { flex:none; font-size:11px; padding:1px 6px; border-radius:4px; background:#eff6ff; color:#1d4ed8; }
  .step .label { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .step .val { flex:none; max-width:38%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    color:var(--muted); font:11px ui-monospace, SFMono-Regular, monospace; }
  .empty { padding:26px 12px; text-align:center; color:var(--muted); font-size:12px; }
  .toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding:10px 12px;
    border-bottom:1px solid var(--border); background:#fbfbfc; }
  .tools { display:flex; gap:8px; flex-wrap:wrap; }
  .save-row { display:none; gap:6px; align-items:center; padding:9px 12px; border-bottom:1px solid var(--border);
    background:#f8fafc; }
  .save-row.on { display:flex; }
  .cases { max-height:28vh; overflow:auto; }
  .case { display:flex; gap:8px; align-items:center; padding:8px 12px; border-bottom:1px solid #f3f4f6; }
  .case:last-child { border-bottom:0; }
  .case .name { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .case .meta { flex:none; color:var(--muted); font-size:11px; }
  .result { max-height:34vh; overflow:auto; padding:10px 12px; }
  .rstep { padding:7px 8px; border:1px solid var(--border); border-radius:7px; margin-bottom:6px; }
  .rstep.fail { border-color:#fecaca; background:#fffafa; }
  .rstep .top { display:flex; gap:7px; align-items:center; }
  .rstep img { display:block; width:100%; max-height:150px; object-fit:cover; object-position:top;
    border-radius:5px; margin-top:6px; border:1px solid var(--border); }
  .rstep .err { color:var(--red); font-size:11px; margin-top:3px; }
  #toast { position:fixed; left:50%; bottom:22px; transform:translateX(-50%); z-index:20;
    background:#111827; color:#fff; padding:8px 14px; border-radius:8px; font-size:12px;
    opacity:0; pointer-events:none; transition:opacity .18s; max-width:80vw; }
  #toast.on { opacity:1; }
  #toast.bad { background:#991b1b; }
  @media (max-width: 860px) { main { grid-template-columns:1fr; } }
</style>
</head>
<body>
<header>
  <div class="row">
    <span class="brand">ATP Agent</span>
    <span id="engine" class="badge">浏览器启动中…</span>
    <span id="recBadge" class="badge">空闲</span>
    <div class="addr">
      <input id="url" placeholder="http://localhost:8080/…" spellcheck="false" />
      <button id="go">打开</button>
      <button id="demoPage">演示页</button>
    </div>
  </div>
</header>
<main>
  <section class="card">
    <div class="toolbar">
      <div class="tools">
        <button id="start" class="primary">开始录制</button>
        <button id="stop" disabled>停止录制</button>
        <button id="demo">演示操作</button>
      </div>
      <span id="stepCount" class="muted" style="margin-left:auto">0 步</span>
    </div>
    <div id="saveRow" class="save-row">
      <span class="muted">录制完成</span>
      <input id="caseName" placeholder="用例名称" style="flex:1" />
      <button id="save" class="primary">保存</button>
    </div>
    <div id="steps" class="steps"><div class="empty">还没有步骤。点「开始录制」，然后在 Chrome 里操作。</div></div>
  </section>
  <aside style="display:flex;flex-direction:column;gap:14px;min-width:0">
    <section class="card">
      <div class="card-h">用例 <span id="caseCount" class="muted"></span></div>
      <div id="cases" class="cases"><div class="empty">还没有保存的用例</div></div>
    </section>
    <section class="card">
      <div class="card-h">回放结果 <span id="replayHint" class="muted"></span></div>
      <div id="result" class="result"><div class="empty">还没有回放</div></div>
    </section>
  </aside>
</main>
<div id="toast"></div>
<script>
  var TOKEN = __ATP_TOKEN__;
  var state = { engine: '', url: '', recording: false, replaying: false, cases: [], steps: [], draft: null, result: null };
  var $ = function (id) { return document.getElementById(id); };
  var ACTION = { click:'点击', fill:'输入', select:'选择', press:'按键', scroll:'滚动', drag:'拖拽', assert:'断言' };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function withToken(path) { return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN); }
  function toast(message, bad) {
    var el = $('toast');
    el.textContent = message;
    el.className = 'on' + (bad ? ' bad' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.className = ''; }, 3200);
  }
  async function api(path, body) {
    var res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'x-atp-token': TOKEN },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || ('请求失败：' + res.status));
    return data;
  }
  function setStatus() {
    $('engine').textContent = state.engine || '浏览器未就绪';
    var badge = $('recBadge');
    if (state.recording) { badge.textContent = '录制中'; badge.className = 'badge rec'; }
    else if (state.replaying) { badge.textContent = '回放中'; badge.className = 'badge run'; }
    else { badge.textContent = '空闲'; badge.className = 'badge'; }
    $('start').disabled = state.recording || state.replaying;
    $('stop').disabled = !state.recording;
    $('demo').disabled = state.replaying;
    if (document.activeElement !== $('url')) $('url').value = state.url || '';
  }
  function renderSteps() {
    $('stepCount').textContent = state.steps.length + ' 步';
    if (!state.steps.length) {
      $('steps').innerHTML = '<div class="empty">还没有步骤。点「开始录制」，然后在 Chrome 里操作。</div>';
      return;
    }
    $('steps').innerHTML = state.steps.map(function (s, i) {
      var val = s.value == null ? '' : s.value;
      return '<div class="step"><span class="idx">' + (i + 1) + '</span><span class="act">' +
        esc(ACTION[s.action] || s.action) + '</span><span class="label">' + esc(s.label) +
        '</span><span class="val">' + esc(val) + '</span></div>';
    }).join('');
    $('steps').scrollTop = $('steps').scrollHeight;
  }
  function renderDraft() {
    $('saveRow').className = 'save-row' + (state.draft ? ' on' : '');
    if (state.draft && !$('caseName').value) {
      $('caseName').value = '录制 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
    }
  }
  function renderCases() {
    $('caseCount').textContent = state.cases.length ? String(state.cases.length) : '';
    if (!state.cases.length) {
      $('cases').innerHTML = '<div class="empty">还没有保存的用例</div>';
      return;
    }
    $('cases').innerHTML = state.cases.map(function (c) {
      return '<div class="case"><span class="name">' + esc(c.name) + '</span><span class="meta">' +
        c.stepCount + ' 步</span><button data-replay="' + esc(c.id) + '">回放</button></div>';
    }).join('');
    Array.prototype.forEach.call($('cases').querySelectorAll('[data-replay]'), function (btn) {
      btn.addEventListener('click', function () { replay(btn.getAttribute('data-replay')); });
    });
  }
  function renderResult() {
    var r = state.result;
    if (!r) { $('result').innerHTML = '<div class="empty">还没有回放</div>'; $('replayHint').textContent = ''; return; }
    $('replayHint').innerHTML = '<span class="badge ' + (r.status === 'passed' ? 'ok' : 'fail') + '">' +
      (r.status === 'passed' ? '通过' : '失败') + '</span>';
    var html = '';
    if (r.error) html += '<p class="err">' + esc(r.error) + '</p>';
    html += r.steps.map(function (s) {
      var ok = s.status === 'passed';
      var img = s.screenshotUrl ? '<img src="' + esc(withToken(s.screenshotUrl)) + '" alt="步骤截图" />' : '';
      var err = s.error ? '<div class="err">' + esc(s.error) + '</div>' : '';
      return '<div class="rstep ' + (ok ? '' : 'fail') + '"><div class="top"><span class="badge ' +
        (ok ? 'ok' : 'fail') + '">' + (ok ? '通过' : '失败') + '</span><span class="muted">#' +
        (s.index + 1) + '</span><span>' + esc(ACTION[s.action] || s.action) + '</span><span class="muted" style="margin-left:auto">' +
        (s.durationMs || 0) + 'ms</span></div>' + err + img + '</div>';
    }).join('');
    $('result').innerHTML = html;
  }
  function connect() {
    var es = new EventSource(withToken('/events'));
    es.addEventListener('status', function (m) {
      var d = JSON.parse(m.data);
      state.engine = d.engine; state.url = d.url; state.recording = d.recording; state.replaying = d.replaying;
      setStatus();
    });
    es.addEventListener('step', function (m) {
      var d = JSON.parse(m.data);
      state.steps.push(d.step);
      if (state.steps.length > 500) state.steps.shift();
      renderSteps();
    });
    es.addEventListener('draft', function (m) {
      state.draft = JSON.parse(m.data);
      renderDraft();
      toast('录制完成：' + state.draft.stepCount + ' 步，可以保存');
    });
    es.addEventListener('cases', function (m) { state.cases = JSON.parse(m.data).cases; renderCases(); });
    es.addEventListener('replay-result', function (m) {
      state.result = JSON.parse(m.data).result;
      renderResult();
    });
    es.addEventListener('error', function (m) {
      // EventSource 自身错误没有 data
      if (!m.data) return;
      toast(JSON.parse(m.data).message, true);
    });
  }

  async function navigate() {
    var url = $('url').value.trim();
    if (!url) { toast('请输入地址', true); return; }
    try { await api('/api/navigate', { url: url }); }
    catch (err) { toast(err.message, true); }
  }
  async function start() {
    try { state.steps = []; state.draft = null; state.result = null; renderSteps(); renderDraft(); renderResult();
      await api('/api/recording/start', {}); }
    catch (err) { toast(err.message, true); }
  }
  async function stop() {
    try { await api('/api/recording/stop', {}); }
    catch (err) { toast(err.message, true); }
  }
  async function save() {
    var name = $('caseName').value.trim();
    if (!name) { $('caseName').focus(); toast('请填写用例名称', true); return; }
    try {
      var summary = await api('/api/cases', { name: name });
      state.draft = null; renderDraft();
      toast('已保存：' + summary.name);
    } catch (err) { toast(err.message, true); }
  }
  async function replay(id) {
    try { state.result = null; renderResult(); $('replayHint').textContent = '执行中…';
      await api('/api/cases/' + encodeURIComponent(id) + '/replay', {}); }
    catch (err) { toast(err.message, true); }
  }
  async function demo() {
    try {
      if (!state.recording) await start();
      await api('/api/demo', {});
    } catch (err) { toast(err.message, true); }
  }
  async function openDemo() {
    try { await api('/api/navigate', { url: location.origin + '/demo' }); }
    catch (err) { toast(err.message, true); }
  }

  $('go').addEventListener('click', navigate);
  $('url').addEventListener('keydown', function (e) { if (e.key === 'Enter') navigate(); });
  $('start').addEventListener('click', start);
  $('stop').addEventListener('click', stop);
  $('save').addEventListener('click', save);
  $('caseName').addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
  $('demo').addEventListener('click', demo);
  $('demoPage').addEventListener('click', openDemo);

  api('/api/state').then(function (s) {
    state.engine = s.engine; state.url = s.url; state.recording = s.recording; state.replaying = s.replaying;
    state.cases = s.cases || [];
    setStatus(); renderCases();
  }).catch(function (err) { toast(err.message, true); });
  connect();
  renderSteps(); renderCases(); renderResult();
</script>
</body>
</html>`
  return html.replace('__ATP_TOKEN__', JSON.stringify(token))
}
