import type { GraphSnapshot } from "@my-pi/graph-model";

export interface GraphViewOptions {
  sessionToken: string;
  nonce: string;
  initialSnapshot: GraphSnapshot;
  apiBase?: string;
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}

/** Shared framework-free browser artifact used by the loopback portal and the MCP Apps adapter. */
export function renderGraphViewHtml(options: GraphViewOptions): string {
  const snapshot = jsonForScript(options.initialSnapshot);
  const token = jsonForScript(options.sessionToken);
  const apiBase = jsonForScript(options.apiBase ?? "");
  const nonce = options.nonce.replaceAll("\"", "");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>my-pi graph view</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: dark;
      font-family: ui-sans-serif, system-ui, sans-serif;
      --kpmg-blue: rgb(0 51 141);
      --kpmg-cobalt: rgb(30 73 226);
      --kpmg-light-blue: rgb(172 234 255);
      --kpmg-pacific: rgb(0 184 245);
      --kpmg-dark-blue: rgb(12 35 60);
      --kpmg-purple: rgb(114 19 234);
      --kpmg-pink: rgb(253 52 156);
      --kpmg-white: rgb(255 255 255);
      --status-warning: rgb(241 196 77);
      --color-bg-dashboard-shell: var(--kpmg-dark-blue);
      --color-bg-canvas: var(--kpmg-dark-blue);
      --color-border-on-dark: rgb(255 255 255 / .1);
      --color-text-primary: var(--kpmg-white);
      --color-text-muted: var(--kpmg-light-blue);
      background: var(--color-bg-dashboard-shell);
      color: var(--color-text-primary);
    }
    body { margin: 0; min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
    header { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; padding: .75rem 1rem; border-bottom: 1px solid var(--color-border-on-dark); background: var(--kpmg-blue); }
    header h1 { font-size: 1rem; margin: 0 .75rem 0 0; }
    button, select { color: var(--kpmg-white); background: var(--kpmg-blue); border: 1px solid var(--kpmg-light-blue); border-radius: .35rem; padding: .35rem .55rem; }
    button:hover, button:focus-visible { background: var(--kpmg-cobalt); }
    main { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 20rem; }
    #stage { position: relative; overflow: hidden; background: var(--kpmg-dark-blue); }
    svg { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }
    svg.dragging { cursor: grabbing; }
    .edge { stroke: var(--kpmg-light-blue); stroke-width: 1.2; opacity: .72; }
    .node { cursor: pointer; stroke: var(--kpmg-white); stroke-width: 1.2; }
    .node.selected { stroke: var(--status-warning); stroke-width: 3; }
    .node-label { fill: var(--kpmg-white); font-size: 11px; pointer-events: none; }
    aside { overflow: auto; padding: 1rem; border-left: 1px solid var(--color-border-on-dark); background: var(--color-bg-canvas); }
    aside h2 { font-size: .9rem; margin: 0 0 .5rem; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: .75rem; color: var(--kpmg-light-blue); }
    .banner { position: absolute; left: .75rem; right: .75rem; top: .75rem; padding: .5rem .75rem; border: 1px solid var(--status-warning); background: var(--status-warning); color: var(--kpmg-dark-blue); border-radius: .35rem; }
    .muted { color: var(--color-text-muted); font-size: .8rem; }
  </style>
</head>
<body>
  <header>
    <h1>my-pi graph view</h1>
    <div id="kinds" role="tablist" aria-label="Graph kind"></div>
    <label>Filter <select id="filter"><option value="">all node kinds</option></select></label>
    <button id="expand" type="button">bounded expand</button>
    <button id="trace" type="button">trace path</button>
    <span id="status" class="muted" aria-live="polite"></span>
  </header>
  <main>
    <section id="stage" aria-label="Read-only graph canvas"></section>
    <aside>
      <h2>Evidence inspector</h2>
      <p id="hint" class="muted">Select a node. This view is read-only.</p>
      <pre id="inspector"></pre>
    </aside>
  </main>
  <script nonce="${nonce}">
    (() => {
      const token = ${token};
      const initial = ${snapshot};
      const apiBase = ${apiBase};
      const kinds = ['code', 'impact', 'work', 'lineage'];
      const state = { snapshot: initial, selected: null, traceFrom: null, traceTo: null, scale: 1, offsetX: 0, offsetY: 0, dragging: false, lastX: 0, lastY: 0 };
      const colors = { code: 'var(--kpmg-cobalt)', impact: 'var(--kpmg-purple)', work: 'var(--kpmg-pacific)', lineage: 'var(--status-warning)' };
      const stage = document.getElementById('stage');
      const inspector = document.getElementById('inspector');
      const status = document.getElementById('status');
      const filter = document.getElementById('filter');
      const kindsElement = document.getElementById('kinds');
      const text = (value) => value == null ? '' : String(value);
      const escape = (value) => text(value).replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
      function visibleNodes() { const wanted = filter.value; return state.snapshot.nodes.filter((node) => !wanted || node.kind === wanted); }
      function render() {
        const nodes = visibleNodes();
        const byId = new Map(nodes.map((node) => [node.id, node]));
        const width = Math.max(stage.clientWidth, 480), height = Math.max(stage.clientHeight, 360);
        const cx = width / 2 + state.offsetX, cy = height / 2 + state.offsetY;
        const radius = Math.max(80, Math.min(width, height) * .32) * state.scale;
        const positions = new Map(nodes.map((node, index) => { const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1); return [node.id, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius }]; }));
        const edges = state.snapshot.edges.filter((edge) => byId.has(edge.source) && byId.has(edge.target));
        const lines = edges.map((edge) => { const a = positions.get(edge.source), b = positions.get(edge.target); return a && b ? '<line class="edge" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" aria-label="' + escape(edge.kind) + '" />' : ''; }).join('');
        const circles = nodes.map((node) => { const p = positions.get(node.id); const selected = state.selected === node.id ? ' selected' : ''; return '<g data-id="' + escape(node.id) + '"><circle class="node' + selected + '" cx="' + p.x + '" cy="' + p.y + '" r="18" fill="' + (colors[state.snapshot.kind] || 'var(--kpmg-blue)') + '" tabindex="0" /><text class="node-label" x="' + p.x + '" y="' + (p.y + 33) + '" text-anchor="middle">' + escape(node.label).slice(0, 48) + '</text></g>'; }).join('');
        stage.querySelector('svg')?.remove();
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', state.snapshot.kind + ' graph');
        svg.innerHTML = lines + circles; stage.prepend(svg);
        svg.querySelectorAll('[data-id]').forEach((group) => group.addEventListener('click', () => { const id = group.getAttribute('data-id'); if (id) selectNode(id); }));
        const traceState = state.traceFrom ? ' · trace start: ' + state.traceFrom + (state.traceTo ? ' → ' + state.traceTo : ' · select target') : '';
        status.textContent = state.snapshot.nodes.length + ' nodes, ' + state.snapshot.edges.length + ' edges' + (state.snapshot.truncated ? ' · truncated' : '') + (state.snapshot.degraded ? ' · degraded' : '') + traceState;
        if (state.snapshot.degraded || state.snapshot.truncated) { const banner = document.createElement('div'); banner.className = 'banner'; banner.textContent = (state.snapshot.degraded ? 'Degraded: ' + state.snapshot.degraded.reason : 'Bounded result: expand/trace remains read-only.'); stage.append(banner); }
      }
      function populateFilter() { const values = [...new Set(state.snapshot.nodes.map((node) => node.kind))].sort(); filter.innerHTML = '<option value="">all node kinds</option>' + values.map((value) => '<option value="' + escape(value) + '">' + escape(value) + '</option>').join(''); }
      function selectNode(id) { state.selected = id; if (state.traceFrom === null) { state.traceFrom = id; state.traceTo = null; } else if (state.traceFrom !== id) { state.traceTo = id; } const node = state.snapshot.nodes.find((item) => item.id === id); inspector.textContent = JSON.stringify({ node: node || {}, traceFrom: state.traceFrom, traceTo: state.traceTo }, null, 2); render(); }
      async function load(kind, operation = 'snapshot') { if (!apiBase) { status.textContent = 'graph expansion and trace are unavailable in this host'; return; } if (operation === 'expand' && !state.selected) { status.textContent = 'select a node before requesting a bounded expansion'; return; } if (operation === 'trace' && (!state.traceFrom || !state.traceTo)) { status.textContent = 'select a trace start and a different trace target'; return; } status.textContent = 'loading ' + operation + ' ' + kind + '…'; try { const base = '?kind=' + encodeURIComponent(kind); const query = operation === 'snapshot' ? base : operation === 'expand' ? base + '&operation=expand&nodeId=' + encodeURIComponent(state.selected) : base + '&operation=trace&fromNodeId=' + encodeURIComponent(state.traceFrom) + '&toNodeId=' + encodeURIComponent(state.traceTo) + '&depth=8'; const response = await fetch(apiBase + query, { headers: { 'x-my-pi-session': token } }); if (!response.ok) throw new Error('graph request rejected (' + response.status + ')'); state.snapshot = await response.json(); state.selected = null; state.traceFrom = null; state.traceTo = null; populateFilter(); render(); } catch (error) { status.textContent = text(error && error.message); } }
      kinds.forEach((kind) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = kind; button.setAttribute('role', 'tab'); button.addEventListener('click', () => { state.traceFrom = null; state.traceTo = null; load(kind); }); kindsElement.append(button); });
      filter.addEventListener('change', render); document.getElementById('expand').addEventListener('click', () => load(state.snapshot.kind, 'expand')); document.getElementById('trace').addEventListener('click', () => load(state.snapshot.kind, 'trace'));
      stage.addEventListener('wheel', (event) => { event.preventDefault(); state.scale = Math.min(3, Math.max(.4, state.scale * (event.deltaY < 0 ? 1.1 : .9))); render(); }, { passive: false });
      stage.addEventListener('pointerdown', (event) => { state.dragging = true; state.lastX = event.clientX; state.lastY = event.clientY; stage.querySelector('svg')?.classList.add('dragging'); });
      stage.addEventListener('pointermove', (event) => { if (!state.dragging) return; state.offsetX += event.clientX - state.lastX; state.offsetY += event.clientY - state.lastY; state.lastX = event.clientX; state.lastY = event.clientY; render(); });
      stage.addEventListener('pointerup', () => { state.dragging = false; stage.querySelector('svg')?.classList.remove('dragging'); });
      populateFilter(); render();
    })();
  </script>
</body>
</html>`;
}
