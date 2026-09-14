import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GraphSnapshot, TheaterFrame } from "@my-pi/graph-model";

export interface GraphViewOptions {
  sessionToken: string;
  nonce: string;
  initialSnapshot: GraphSnapshot;
  apiBase?: string;
}

export interface TheaterViewOptions {
  sessionToken: string;
  nonce: string;
  initialFrame: TheaterFrame;
  apiBase?: string;
  isMcp?: boolean;
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}

let cachedKpmgTokenCss: string | null = null;

function moduleDirectory(): string {
  return typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
}

function getKpmgTokenCss(): string {
  if (cachedKpmgTokenCss !== null) return cachedKpmgTokenCss;

  const candidates = [
    join(process.cwd(), "design-system", "tokens", "colors.css"),
    join(moduleDirectory(), "..", "..", "..", "design-system", "tokens", "colors.css"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedKpmgTokenCss = readFileSync(candidate, "utf8");
      return cachedKpmgTokenCss;
    }
  }
  throw new Error("KPMG design-system color tokens are unavailable");
}

let cachedTheaterBundle: string | null = null;

export function getTheaterClientScript(): string {
  if (cachedTheaterBundle) return cachedTheaterBundle;

  const currentDir = moduleDirectory();
  const candidatePaths = [
    join(currentDir, "theater-client.bundle.js"),
    join(currentDir, "..", "dist", "theater-client.bundle.js"),
    join(process.cwd(), "apps", "my-pi-ui", "dist", "theater-client.bundle.js"),
  ];

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      cachedTheaterBundle = readFileSync(candidate, "utf8");
      return cachedTheaterBundle;
    }
  }

  // Fallback: bundle on the fly using esbuild if available
  try {
    const require = createRequire(import.meta.url);
    const esbuild = require("esbuild");
    const entry = join(process.cwd(), "apps", "my-pi-ui", "src", "theater-client.ts");
    if (existsSync(entry)) {
      const res = esbuild.buildSync({
        absWorkingDir: process.cwd(),
        entryPoints: [entry],
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "es2022",
        minify: true,
        write: false,
      });
      if (res.outputFiles?.[0]) {
        const bundle = res.outputFiles[0].text;
        cachedTheaterBundle = bundle;
        return bundle;
      }
    }
  } catch {
    // ignore
  }

  return "console.warn('my-pi theater client bundle not available');";
}

/** Shared framework-free browser artifact used by the loopback portal and the MCP Apps adapter. */
export function renderGraphViewHtml(options: GraphViewOptions): string {
  const snapshot = jsonForScript(options.initialSnapshot);
  const token = jsonForScript(options.sessionToken);
  const apiBase = jsonForScript(options.apiBase ?? "");
  const nonce = options.nonce.replaceAll('"', "");
  const kpmgTokenCss = getKpmgTokenCss();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>my-pi graph view</title>
  <style nonce="${nonce}">
    ${kpmgTokenCss}
    :root {
      color-scheme: dark;
      font-family: ui-sans-serif, system-ui, sans-serif;
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

/**
 * Renders the 3D Agent Operations Theater view HTML.
 * Includes Three.js isometric 3D canvas, 2D SVG fallback, timeline scrubber,
 * 6-section inspector, and live/replay capabilities.
 */
export function renderTheaterViewHtml(options: TheaterViewOptions): string {
  const frameJson = jsonForScript(options.initialFrame);
  const token = jsonForScript(options.sessionToken);
  const apiBase = jsonForScript(options.apiBase ?? "");
  const isMcp = Boolean(options.isMcp);
  const nonce = options.nonce.replaceAll('"', "");
  const kpmgTokenCss = getKpmgTokenCss();
  const clientScript = getTheaterClientScript();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>my-pi agent operations theater</title>
  <style nonce="${nonce}">
    ${kpmgTokenCss}
    :root {
      color-scheme: dark;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --color-text-primary: var(--kpmg-white);
      --color-text-muted: var(--kpmg-light-blue);
      background: var(--color-bg-shell);
      color: var(--color-text-primary);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; overflow: hidden; }
    header {
      display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; padding: 0.6rem 1rem;
      border-bottom: 1px solid var(--color-border); background: var(--kpmg-blue); z-index: 20;
    }
    header h1 { font-size: 0.95rem; font-weight: 600; margin-right: 0.5rem; letter-spacing: -0.01em; white-space: nowrap; }
    .header-group { display: flex; align-items: center; gap: 0.4rem; }
    button, select {
      color: var(--kpmg-white); background: var(--kpmg-dark-blue); border: 1px solid var(--kpmg-cobalt);
      border-radius: 4px; padding: 0.3rem 0.55rem; font-size: 0.8rem; cursor: pointer; transition: background 0.15s, border-color 0.15s;
    }
    button:hover, button:focus-visible { background: var(--kpmg-cobalt); border-color: var(--kpmg-light-blue); }
    .kind-tab { background: transparent; border-color: transparent; font-weight: 500; }
    .kind-tab.active { background: var(--kpmg-cobalt); border-color: var(--kpmg-light-blue); font-weight: 600; }
    .mode-live { background: color-mix(in srgb, var(--status-success) 20%, transparent); border-color: var(--status-success); color: var(--status-success); font-weight: 700; }
    .mode-replay { background: color-mix(in srgb, var(--status-warning) 20%, transparent); border-color: var(--status-warning); color: var(--status-warning); font-weight: 700; }

    .badge {
      display: inline-flex; align-items: center; font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 6px; border-radius: 3px;
    }
    .badge-degraded { background: color-mix(in srgb, var(--status-error) 20%, transparent); color: var(--status-error); border: 1px solid var(--status-error); }
    .badge-truncated { background: color-mix(in srgb, var(--status-warning) 20%, transparent); color: var(--status-warning); border: 1px solid var(--status-warning); }
    .badge-stale { background: color-mix(in srgb, var(--status-warning) 15%, transparent); color: var(--status-warning); border: 1px dashed var(--status-warning); }
    .badge-empty { background: color-mix(in srgb, var(--kpmg-light-blue) 15%, transparent); color: var(--kpmg-light-blue); border: 1px solid var(--kpmg-light-blue); }

    main { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 24rem; position: relative; }
    #stage { position: relative; overflow: hidden; background: var(--color-bg-dashboard); outline: none; touch-action: none; }
    #theater-canvas { display: block; width: 100%; height: 100%; }
    #dom-overlay { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }

    .theater-label {
      position: absolute; transform: translate(-50%, -50%); background: color-mix(in srgb, var(--kpmg-dark-blue) 85%, transparent);
      border: 1px solid var(--kpmg-cobalt); border-radius: 4px; padding: 2px 6px; font-size: 11px;
      color: var(--kpmg-white); white-space: nowrap; pointer-events: auto; cursor: pointer; display: flex; align-items: center; gap: 4px;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .theater-label:hover, .theater-label.selected {
      border-color: var(--status-warning); box-shadow: 0 0 8px color-mix(in srgb, var(--status-warning) 50%, transparent);
    }

    #fallback-2d { position: absolute; inset: 0; background: var(--color-bg-dashboard); display: none; }
    #svg-stage { width: 100%; height: 100%; display: block; cursor: grab; }
    #svg-stage.dragging { cursor: grabbing; }

    #stage-banner {
      position: absolute; top: 12px; left: 12px; right: 12px; padding: 8px 12px;
      border-radius: 4px; font-size: 0.8rem; background: color-mix(in srgb, var(--status-warning) 95%, transparent);
      color: var(--kpmg-dark-blue); font-weight: 600; z-index: 15; display: none;
    }

    #timeline-bar {
      position: absolute; bottom: 12px; left: 12px; right: 12px;
      background: color-mix(in srgb, var(--kpmg-dark-blue) 92%, transparent); border: 1px solid var(--color-border);
      border-radius: 6px; padding: 8px 12px; display: flex; align-items: center; gap: 10px;
      backdrop-filter: blur(4px); z-index: 10;
    }
    #slider-sequence { flex: 1; cursor: pointer; accent-color: var(--kpmg-pacific); }
    #timeline-seq-display { font-size: 0.8rem; color: var(--kpmg-light-blue); white-space: nowrap; }

    aside {
      overflow-y: auto; padding: 1rem; border-left: 1px solid var(--color-border);
      background: var(--kpmg-dark-blue); display: flex; flex-direction: column; gap: 1rem;
    }
    aside h2 { font-size: 0.9rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--kpmg-light-blue); }
    .inspector-section {
      border: 1px solid var(--color-border); border-radius: 6px; padding: 0.75rem; background: color-mix(in srgb, var(--kpmg-blue) 10%, transparent);
    }
    .inspector-section h3 {
      font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
      color: var(--kpmg-light-blue); margin-bottom: 0.5rem;
    }
    .inspector-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .inspector-table th { text-align: left; color: var(--kpmg-light-blue); width: 28%; padding: 3px 0; }
    .inspector-table td { color: var(--kpmg-white); padding: 3px 0; word-break: break-all; }
    .kind-tag { background: color-mix(in srgb, var(--kpmg-cobalt) 25%, transparent); border: 1px solid var(--kpmg-cobalt); padding: 1px 4px; border-radius: 3px; font-size: 10px; }
    .trace-item, .evidence-item {
      background: color-mix(in srgb, var(--kpmg-blue) 20%, transparent); border: 1px solid var(--color-border); border-radius: 4px;
      padding: 6px; margin-bottom: 6px; font-size: 11px;
    }
    .trace-seq { font-weight: bold; color: var(--kpmg-pacific); margin-right: 4px; }
    .next-action-box {
      background: color-mix(in srgb, var(--status-success) 15%, transparent); border: 1px solid var(--status-success); border-radius: 4px;
      padding: 8px; font-size: 12px;
    }
    .error-item { color: var(--status-error); font-size: 11px; margin-bottom: 4px; }
    .muted { color: var(--color-text-muted); font-size: 0.8rem; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  </style>
</head>
<body>
  <header>
    <h1>my-pi theater</h1>
    <div id="kinds" class="header-group" role="tablist" aria-label="Graph kind"></div>
    <div class="header-group">
      <label for="filter" class="muted">Filter</label>
      <select id="filter"><option value="">all kinds</option></select>
    </div>
    <div class="header-group">
      <button id="mode-toggle" type="button" class="mode-live"><span id="mode-text">LIVE</span></button>
      <button id="btn-fit" type="button" title="Fit camera to scene">Fit</button>
      <button id="btn-reset-cam" type="button" title="Reset camera view">Reset Cam</button>
      <button id="btn-toggle-render" type="button" title="Toggle between 3D isometric and 2D fallback view">2D View</button>
    </div>
    <div class="header-group">
      <span id="badge-degraded" class="badge badge-degraded" style="display:none;">DEGRADED</span>
      <span id="badge-truncated" class="badge badge-truncated" style="display:none;">TRUNCATED</span>
      <span id="badge-stale" class="badge badge-stale" style="display:none;">STALE</span>
      <span id="badge-empty" class="badge badge-empty" style="display:none;">EMPTY</span>
      <span id="cursor-info" class="muted"></span>
      <span id="freshness" class="muted"></span>
    </div>
  </header>
  <main>
    <section id="stage" aria-label="Operations Theater Canvas" tabindex="0">
      <div id="stage-banner"></div>
      <canvas id="theater-canvas"></canvas>
      <div id="dom-overlay"></div>
      <div id="fallback-2d">
        <svg id="svg-stage" role="img" aria-label="2D fallback graph"></svg>
      </div>
      <div id="timeline-bar" style="display:none;">
        <button id="btn-play-pause" type="button">▶ Play</button>
        <button id="btn-step" type="button">Step ⏭</button>
        <input type="range" id="slider-sequence" min="0" max="0" value="0" aria-label="Replay sequence scrubber">
        <span id="timeline-seq-display">Event 0 of 0</span>
      </div>
    </section>
    <aside>
      <h2>Entity Inspector</h2>
      <div class="inspector-section">
        <h3>Identity</h3>
        <div id="inspector-identity"><p class="muted">No node selected.</p></div>
      </div>
      <div class="inspector-section">
        <h3>Trace</h3>
        <div id="inspector-trace"><p class="muted">No trace records.</p></div>
      </div>
      <div class="inspector-section">
        <h3>Evidence</h3>
        <div id="inspector-evidence"><p class="muted">No evidence attached.</p></div>
      </div>
      <div class="inspector-section">
        <h3>Provenance</h3>
        <div id="inspector-provenance"><p class="muted">Not observed</p></div>
      </div>
      <div class="inspector-section">
        <h3>Errors &amp; Quality</h3>
        <div id="inspector-error"><p class="muted">No active errors.</p></div>
      </div>
      <div class="inspector-section">
        <h3>Next Action</h3>
        <div id="inspector-next-action"><p class="muted">No next action recorded.</p></div>
      </div>
    </aside>
  </main>
  <script nonce="${nonce}">
    window.__MY_PI_THEATER_CONFIG__ = {
      token: ${token},
      initialFrame: ${frameJson},
      apiBase: ${apiBase},
      isMcp: ${isMcp}
    };
  </script>
  <script nonce="${nonce}">
    ${clientScript}
  </script>
</body>
</html>`;
}
