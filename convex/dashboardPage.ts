export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PAI Memory</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #e6edf3; --text-dim: #8b949e; --accent: #58a6ff;
    --green: #3fb950; --yellow: #d29922; --purple: #bc8cff;
    --red: #f85149; --orange: #d18616;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.5; }
  .container { max-width: 1200px; margin: 0 auto; padding: 24px; }

  header { display: flex; align-items: center; justify-content: space-between;
    padding: 16px 0; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
  header h1 { font-size: 20px; font-weight: 600; }
  header h1 span { color: var(--accent); }

  .stats-bar { display: flex; gap: 24px; margin-bottom: 24px; flex-wrap: wrap; }
  .stat { background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 12px 20px; min-width: 140px; }
  .stat-value { font-size: 28px; font-weight: 700; color: var(--accent); }
  .stat-label { font-size: 12px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }

  .controls { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; align-items: center; }
  .controls select, .controls input {
    background: var(--surface); border: 1px solid var(--border); color: var(--text);
    border-radius: 6px; padding: 8px 12px; font-size: 14px; }
  .controls select:focus, .controls input:focus { outline: none; border-color: var(--accent); }
  .controls input { flex: 1; min-width: 200px; }
  .tab-bar { display: flex; gap: 0; margin-bottom: 20px; }
  .tab { padding: 8px 20px; cursor: pointer; border: 1px solid var(--border);
    background: var(--surface); color: var(--text-dim); font-size: 14px;
    transition: all 0.15s; }
  .tab:first-child { border-radius: 6px 0 0 6px; }
  .tab:last-child { border-radius: 0 6px 6px 0; }
  .tab.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .tab:hover:not(.active) { color: var(--text); }

  .card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
  .card { background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 16px; transition: border-color 0.15s; }
  .card:hover { border-color: var(--accent); }
  .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .card-title { font-weight: 600; font-size: 15px; }
  .card-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 12px; font-weight: 500; }
  .badge-type { background: #1f3a5f; color: var(--accent); }
  .badge-project { background: #2a1f3a; color: var(--purple); }
  .badge-signal { background: #1a3a1a; color: var(--green); }
  .badge-nosignal { background: #3a2a1a; color: var(--orange); }
  .badge-role { background: #2a2a2a; color: var(--text-dim); }
  .card-content { font-size: 13px; color: var(--text-dim); max-height: 120px;
    overflow: hidden; white-space: pre-wrap; word-break: break-word; }
  .card-content.expanded { max-height: none; }
  .card-date { font-size: 11px; color: var(--text-dim); margin-top: 8px; }
  .card-expand { font-size: 12px; color: var(--accent); cursor: pointer;
    margin-top: 4px; background: none; border: none; }

  .graph-view { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
  .edge-card { background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 12px 16px; font-size: 14px; }
  .edge-card .subject { color: var(--accent); font-weight: 600; }
  .edge-card .predicate { color: var(--yellow); }
  .edge-card .object { color: var(--green); font-weight: 600; }
  .edge-card .confidence { color: var(--text-dim); font-size: 12px; }

  .empty { text-align: center; padding: 60px; color: var(--text-dim); }
  .loading { text-align: center; padding: 40px; color: var(--text-dim); }
  .error { text-align: center; padding: 40px; color: var(--red); }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1><span>PAI</span> Memory</h1>
    <div id="status" style="font-size:12px;color:var(--text-dim)">connecting...</div>
  </header>

  <div class="stats-bar" id="stats"></div>

  <div class="tab-bar">
    <div class="tab active" data-table="memories">Memories</div>
    <div class="tab" data-table="chunks">Chunks</div>
    <div class="tab" data-table="graph">Graph</div>
  </div>

  <div class="controls">
    <select id="filter-type"><option value="">All types</option></select>
    <select id="filter-project"><option value="">All projects</option></select>
    <input type="text" id="search" placeholder="Filter by text...">
  </div>

  <div id="content" class="card-grid"></div>
</div>

<script>
const BASE = window.location.origin;
let currentTable = 'memories';
let allData = [];
let statsData = null;

async function apiCall(path) {
  const res = await fetch(BASE + path, {
    headers: { 'Authorization': new URLSearchParams(window.location.search).get('token') ? 'Bearer ' + new URLSearchParams(window.location.search).get('token') : '' }
  });
  return res.json();
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diffH = (now - d) / 3600000;
  if (diffH < 1) return Math.round(diffH * 60) + 'm ago';
  if (diffH < 24) return Math.round(diffH) + 'h ago';
  if (diffH < 168) return Math.round(diffH / 24) + 'd ago';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function truncate(s, n) { return s && s.length > n ? s.slice(0, n) + '...' : s || ''; }

function renderStats() {
  if (!statsData) return;
  const el = document.getElementById('stats');
  const s = statsData;
  el.innerHTML = [
    { v: s.memories.total, l: 'Memories' },
    { v: s.chunks.total, l: 'Chunks' },
    { v: s.chunks.signal, l: 'Signal' },
    { v: s.graph.total, l: 'Graph Edges' },
    { v: s.projects.length, l: 'Projects' },
  ].map(x => '<div class="stat"><div class="stat-value">' + x.v + '</div><div class="stat-label">' + x.l + '</div></div>').join('');
}

function renderMemory(m) {
  return '<div class="card"><div class="card-header"><div class="card-title">' + esc(m.title) + '</div></div>'
    + '<div class="card-meta">'
    + '<span class="badge badge-type">' + esc(m.type) + '</span>'
    + (m.project ? '<span class="badge badge-project">' + esc(m.project) + '</span>' : '')
    + (m.tags ? m.tags.map(t => '<span class="badge badge-role">' + esc(t) + '</span>').join('') : '')
    + '</div>'
    + '<div class="card-content" id="cc-' + m.id + '">' + esc(m.content) + '</div>'
    + (m.content && m.content.length > 200 ? '<button class="card-expand" onclick="toggleExpand(\\'' + m.id + '\\')">show more</button>' : '')
    + '<div class="card-date">' + fmtDate(m.createdAt) + '</div></div>';
}

function renderChunk(c) {
  return '<div class="card"><div class="card-header"><div class="card-title">' + esc(c.chunkType) + '</div></div>'
    + '<div class="card-meta">'
    + '<span class="badge badge-role">' + esc(c.role) + '</span>'
    + (c.isSignal ? '<span class="badge badge-signal">signal</span>' : '<span class="badge badge-nosignal">noise</span>')
    + (c.project ? '<span class="badge badge-project">' + esc(c.project) + '</span>' : '')
    + '</div>'
    + '<div class="card-content" id="cc-' + c.id + '">' + esc(c.content) + '</div>'
    + (c.content && c.content.length > 200 ? '<button class="card-expand" onclick="toggleExpand(\\'' + c.id + '\\')">show more</button>' : '')
    + '<div class="card-date">' + esc(c.sessionId?.slice(0, 8) || '') + ' &middot; ' + fmtDate(c.createdAt) + '</div></div>';
}

function renderEdge(e) {
  return '<div class="edge-card">'
    + '<span class="subject">' + esc(e.subject) + '</span> '
    + '<span class="predicate">' + esc(e.predicate) + '</span> '
    + '<span class="object">' + esc(e.object) + '</span>'
    + '<div class="confidence">confidence: ' + (e.confidence * 100).toFixed(0) + '%</div>'
    + '</div>';
}

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

window.toggleExpand = function(id) {
  const el = document.getElementById('cc-' + id);
  if (el) el.classList.toggle('expanded');
};

function render() {
  const typeFilter = document.getElementById('filter-type').value;
  const projFilter = document.getElementById('filter-project').value;
  const searchTerm = document.getElementById('search').value.toLowerCase();

  let filtered = allData;
  if (typeFilter) filtered = filtered.filter(d => (d.type || d.chunkType) === typeFilter);
  if (projFilter) filtered = filtered.filter(d => d.project === projFilter);
  if (searchTerm) filtered = filtered.filter(d =>
    (d.title || '').toLowerCase().includes(searchTerm) ||
    (d.content || '').toLowerCase().includes(searchTerm) ||
    (d.subject || '').toLowerCase().includes(searchTerm) ||
    (d.object || '').toLowerCase().includes(searchTerm)
  );

  const el = document.getElementById('content');
  if (filtered.length === 0) {
    el.innerHTML = '<div class="empty">No items found</div>';
    el.className = '';
    return;
  }

  if (currentTable === 'graph') {
    el.className = 'graph-view';
    el.innerHTML = filtered.map(renderEdge).join('');
  } else if (currentTable === 'chunks') {
    el.className = 'card-grid';
    el.innerHTML = filtered.map(renderChunk).join('');
  } else {
    el.className = 'card-grid';
    el.innerHTML = filtered.map(renderMemory).join('');
  }
}

function populateFilters() {
  // Types from current data
  const typeSet = new Set();
  allData.forEach(d => {
    if (d.type) typeSet.add(d.type);
    if (d.chunkType) typeSet.add(d.chunkType);
  });

  const typeEl = document.getElementById('filter-type');
  typeEl.innerHTML = '<option value="">All types</option>' +
    [...typeSet].sort().map(t => '<option value="' + t + '">' + t + '</option>').join('');

  // Projects from stats (all projects across all tables)
  const projects = statsData?.projects || [];
  const projEl = document.getElementById('filter-project');
  projEl.innerHTML = '<option value="">All projects</option>' +
    projects.map(p => '<option value="' + p + '">' + p + '</option>').join('');
}

async function loadStats() {
  try {
    const res = await fetch(BASE + '/api/stats', {
      headers: { 'Authorization': 'Bearer ' + (new URLSearchParams(window.location.search).get('token') || '') }
    });
    statsData = await res.json();
    renderStats();
  } catch {}
}

async function loadData() {
  const el = document.getElementById('content');
  el.innerHTML = '<div class="loading">Loading...</div>';
  el.className = '';

  const typeFilter = document.getElementById('filter-type').value;
  const projFilter = document.getElementById('filter-project').value;

  let url = BASE + '/api/data?table=' + currentTable + '&limit=500';
  if (typeFilter) url += '&type=' + encodeURIComponent(typeFilter);
  if (projFilter) url += '&project=' + encodeURIComponent(projFilter);

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + (new URLSearchParams(window.location.search).get('token') || '') }
    });
    const data = await res.json();
    allData = data.items || [];
    document.getElementById('status').textContent = allData.length + ' items';
    populateFilters();
    render();
  } catch (err) {
    el.innerHTML = '<div class="error">Failed to load: ' + err.message + '</div>';
    el.className = '';
  }
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTable = tab.dataset.table;
    loadData();
  });
});

document.getElementById('filter-type').addEventListener('change', loadData);
document.getElementById('filter-project').addEventListener('change', loadData);
document.getElementById('search').addEventListener('input', render);

loadStats().then(() => loadData());
</script>
</body>
</html>`;
