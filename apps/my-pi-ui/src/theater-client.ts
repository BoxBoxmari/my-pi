import * as THREE from "three";
import {
  eventToMotionCue,
  type GraphEdge,
  type GraphKind,
  type GraphNode,
  type SceneCue,
  type TheaterEvent,
  type TheaterFrame,
} from "@my-pi/graph-model";
import { buildInspectorObservation, escapeHtml } from "./inspector.js";

interface WindowWithConfig extends Window {
  __MY_PI_THEATER_CONFIG__?: {
    token: string;
    initialFrame: TheaterFrame;
    apiBase?: string;
    isMcp?: boolean;
    reduceMotion?: boolean;
  };
}

(() => {
  const win = window as WindowWithConfig;
  const config = win.__MY_PI_THEATER_CONFIG__;
  if (!config) return;

  const { token, initialFrame, apiBase = "", isMcp = false } = config;
  try {
    const persisted = window.sessionStorage.getItem("my-pi.theater.cursor");
    if (persisted !== null && /^\d+$/.test(persisted) && Number(persisted) > Number(initialFrame.cursor.lastSequence ?? "0")) {
      initialFrame.cursor.lastSequence = persisted;
    }
  } catch {}
  let currentFrame: TheaterFrame = initialFrame;
  let selectedNodeId: string | null = null;
  let isReplayMode = false;
  let replayIndex = 0;
  let replayTimer: number | null = null;
  let is2DFallback = false;

  const prefersReducedMotion = config.reduceMotion === true;

  // DOM Elements
  const stage = document.getElementById("stage") as HTMLElement;
  const canvas3d = document.getElementById("theater-canvas") as HTMLCanvasElement;
  const fallback2d = document.getElementById("fallback-2d") as HTMLElement;
  const svgStage = document.getElementById("svg-stage") as unknown as SVGSVGElement;
  const domOverlay = document.getElementById("dom-overlay") as HTMLElement;
  const stageBanner = document.getElementById("stage-banner") as HTMLElement;

  const kindsElem = document.getElementById("kinds") as HTMLElement;
  const filterSelect = document.getElementById("filter") as HTMLSelectElement;
  const modeToggle = document.getElementById("mode-toggle") as HTMLButtonElement;
  const modeText = document.getElementById("mode-text") as HTMLElement;
  const cursorInfo = document.getElementById("cursor-info") as HTMLElement;
  const freshnessElem = document.getElementById("freshness") as HTMLElement;
  const streamStatusElem = document.getElementById("stream-status") as HTMLElement;

  const badgeDegraded = document.getElementById("badge-degraded") as HTMLElement;
  const badgeTruncated = document.getElementById("badge-truncated") as HTMLElement;
  const badgeStale = document.getElementById("badge-stale") as HTMLElement;
  const badgeEmpty = document.getElementById("badge-empty") as HTMLElement;

  const btnFit = document.getElementById("btn-fit") as HTMLButtonElement;
  const btnResetCam = document.getElementById("btn-reset-cam") as HTMLButtonElement;
  const btnToggleRender = document.getElementById("btn-toggle-render") as HTMLButtonElement;

  // Left Rail Elements
  const btnRailFit = document.getElementById("btn-rail-fit") as HTMLButtonElement | null;
  const btnRailReset = document.getElementById("btn-rail-reset") as HTMLButtonElement | null;
  const btnRailRender = document.getElementById("btn-rail-render") as HTMLButtonElement | null;
  const btnRailTimeline = document.getElementById("btn-rail-timeline") as HTMLButtonElement | null;
  const btnRailLegend = document.getElementById("btn-rail-legend") as HTMLButtonElement | null;
  const legendPopover = document.getElementById("legend-popover") as HTMLElement | null;
  const railRenderLabel = document.getElementById("rail-render-label") as HTMLElement | null;

  const inspIdentity = document.getElementById("inspector-identity") as HTMLElement;
  const inspTrace = document.getElementById("inspector-trace") as HTMLElement;
  const inspEvidence = document.getElementById("inspector-evidence") as HTMLElement;
  const inspProvenance = document.getElementById("inspector-provenance") as HTMLElement;
  const inspError = document.getElementById("inspector-error") as HTMLElement;
  const inspNextAction = document.getElementById("inspector-next-action") as HTMLElement;

  const timelineBar = document.getElementById("timeline-bar") as HTMLElement;
  const btnPlayPause = document.getElementById("btn-play-pause") as HTMLButtonElement;
  const btnStep = document.getElementById("btn-step") as HTMLButtonElement;
  const sliderSeq = document.getElementById("slider-sequence") as HTMLInputElement;
  const timelineSeqDisplay = document.getElementById("timeline-seq-display") as HTMLElement;

  const colors = {
    work: 0x00b8f5,          // KPMG Pacific
    work_item: 0x00b8f5,     // KPMG Pacific
    agent_session: 0x1e49e6, // KPMG Cobalt
    intent: 0x7213ea,        // KPMG Purple
    code: 0x1e49e6,          // KPMG Cobalt
    file: 0x00338d,          // KPMG Blue
    impact: 0xfd349c,        // KPMG Pink
    lineage: 0xf1c44d,       // Warning amber
    default: 0x00b8f5,
  };

  // Node position map: nodeId -> { x, y, z }
  const nodePositions = new Map<string, { x: number; y: number; z: number }>();
  const nodeMeshes = new Map<string, THREE.Object3D>();
  const edgeLines: THREE.Line[] = [];
  const overlayLabels = new Map<string, HTMLElement>();
  const activeCues = new Map<string, { cue: SceneCue; startTime: number; mesh?: THREE.Object3D; ripple?: THREE.Mesh; tracer?: THREE.Mesh; endY?: number }>();

  // Setup Three.js
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.OrthographicCamera | null = null;
  let animationFrameId: number | null = null;

  function initThree(): boolean {
    try {
      const gl = canvas3d.getContext("webgl2") || canvas3d.getContext("webgl");
      if (!gl) throw new Error("WebGL is not supported");

      renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(stage.clientWidth, stage.clientHeight);

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf4f7fa); // Bright spatial architectural studio

      const aspect = stage.clientWidth / stage.clientHeight;
      const d = 520;
      camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 3500);
      camera.position.set(400, 420, 400);
      camera.lookAt(0, 0, 0);

      // Lighting
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.95);
      scene.add(ambientLight);

      const dirLight = new THREE.DirectionalLight(0xffffff, 1.15);
      dirLight.position.set(350, 650, 350);
      scene.add(dirLight);

      const fillLight = new THREE.DirectionalLight(0x0091da, 0.35);
      fillLight.position.set(-250, 300, -250);
      scene.add(fillLight);

      // Grid ground helper (subtle, clean KPMG Navy)
      const grid = new THREE.GridHelper(1000, 25, 0x00338d, 0x0091da);
      if (Array.isArray(grid.material)) {
        grid.material.forEach((m) => { m.opacity = 0.12; m.transparent = true; });
      } else {
        grid.material.opacity = 0.12;
        grid.material.transparent = true;
      }
      grid.position.y = -1;
      scene.add(grid);

      canvas3d.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        switchTo2D("WebGL context was lost");
      });

      return true;
    } catch (err) {
      switchTo2D(err instanceof Error ? err.message : "WebGL initialization failed");
      return false;
    }
  }

  function switchTo2D(reason?: string): void {
    is2DFallback = true;
    if (renderer) {
      renderer.dispose();
      renderer = null;
    }
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    canvas3d.style.display = "none";
    fallback2d.style.display = "block";
    btnToggleRender.textContent = "2D Active (Switch 3D)";
    if (railRenderLabel) railRenderLabel.textContent = "2D";

    currentFrame.quality.degraded = true;
    if (reason && !currentFrame.quality.reasons.includes(reason)) {
      currentFrame.quality.reasons.push(reason);
    }
    updateQualityBadges();
    showBanner(`Degraded: ${reason || "2D fallback active"}`);
    render2D();
  }

  function switchTo3D(): void {
    if (!initThree()) return;
    is2DFallback = false;
    canvas3d.style.display = "block";
    fallback2d.style.display = "none";
    btnToggleRender.textContent = "3D Active (Switch 2D)";
    if (railRenderLabel) railRenderLabel.textContent = "3D";
    hideBanner();
    buildScene();
    requestRender();
  }

  function computeLayout(nodes: GraphNode[]): void {
    nodePositions.clear();
    const workItems = nodes.filter((n) => n.kind === "work" || n.kind === "work_item");
    const agents = nodes.filter((n) => n.kind === "agent_session");
    const intents = nodes.filter((n) => n.kind === "intent");
    const others = nodes.filter((n) => n.kind !== "work" && n.kind !== "work_item" && n.kind !== "agent_session" && n.kind !== "intent");

    // Agents in elevated inner circle
    const rAgent = Math.max(110, agents.length * 36);
    agents.forEach((node, i) => {
      const theta = (i / Math.max(agents.length, 1)) * Math.PI * 2;
      nodePositions.set(node.id, {
        x: Math.cos(theta) * rAgent,
        y: 22,
        z: Math.sin(theta) * rAgent,
      });
    });

    // Work items on ground circle
    const rWork = Math.max(240, workItems.length * 42);
    workItems.forEach((node, i) => {
      const theta = (i / Math.max(workItems.length, 1)) * Math.PI * 2;
      nodePositions.set(node.id, {
        x: Math.cos(theta) * rWork,
        y: 4,
        z: Math.sin(theta) * rWork,
      });
    });

    // Intents between agent and work
    const rIntent = (rAgent + rWork) / 2;
    intents.forEach((node, i) => {
      const theta = (i / Math.max(intents.length, 1)) * Math.PI * 2 + 0.25;
      nodePositions.set(node.id, {
        x: Math.cos(theta) * rIntent,
        y: 12,
        z: Math.sin(theta) * rIntent,
      });
    });

    // Others in outer perimeter
    const rOuter = rWork + 130;
    others.forEach((node, i) => {
      const theta = (i / Math.max(others.length, 1)) * Math.PI * 2 + 0.4;
      nodePositions.set(node.id, {
        x: Math.cos(theta) * rOuter,
        y: 8,
        z: Math.sin(theta) * rOuter,
      });
    });
  }

  function createAgentTokenMesh(colorHex: number): THREE.Group {
    const group = new THREE.Group();

    // Base pedestal plinth in dark architectural navy
    const plinthGeo = new THREE.CylinderGeometry(14, 16, 4, 32);
    const plinthMat = new THREE.MeshLambertMaterial({ color: 0x00338d });
    const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
    plinthMesh.position.y = 2;
    group.add(plinthMesh);

    // Glowing base ring
    const ringGeo = new THREE.RingGeometry(16, 18.5, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.y = 0.5;
    group.add(ringMesh);

    // Vertical light pin connector
    const pinGeo = new THREE.CylinderGeometry(1.5, 1.5, 12, 16);
    const pinMat = new THREE.MeshBasicMaterial({ color: 0x0091da });
    const pinMesh = new THREE.Mesh(pinGeo, pinMat);
    pinMesh.position.y = 9;
    group.add(pinMesh);

    // Faceted procedural avatar body (Dodecahedron)
    const avatarGeo = new THREE.DodecahedronGeometry(8.5, 0);
    const avatarMat = new THREE.MeshLambertMaterial({ color: colorHex });
    const avatarMesh = new THREE.Mesh(avatarGeo, avatarMat);
    avatarMesh.position.y = 19;
    group.add(avatarMesh);

    // Floating crown gem
    const crownGeo = new THREE.OctahedronGeometry(3.5, 0);
    const crownMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const crownMesh = new THREE.Mesh(crownGeo, crownMat);
    crownMesh.position.y = 29;
    group.add(crownMesh);

    group.userData = {
      isAgent: true,
      baseY: 22,
      phase: Math.random() * Math.PI * 2,
      avatar: avatarMesh,
      crown: crownMesh,
    };

    return group;
  }

  function createWorkPlatformMesh(colorHex: number, state?: string): THREE.Group {
    const group = new THREE.Group();

    // Bottom structural plinth
    const plinthGeo = new THREE.CylinderGeometry(24, 26, 6, 32);
    const plinthMat = new THREE.MeshLambertMaterial({ color: 0x0c233c });
    const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
    plinthMesh.position.y = 3;
    group.add(plinthMesh);

    // Upper platform slab
    const slabGeo = new THREE.CylinderGeometry(22, 22, 3, 32);
    const slabMat = new THREE.MeshLambertMaterial({ color: colorHex });
    const slabMesh = new THREE.Mesh(slabGeo, slabMat);
    slabMesh.position.y = 6.5;
    group.add(slabMesh);

    // Status beacon indicator pip
    let gemColor = 0x0091da; // active
    if (state === "completed") gemColor = 0x10b981;
    else if (state === "ready") gemColor = 0xf59e0b;
    else if (state === "blocked") gemColor = 0xef4444;

    const gemGeo = new THREE.SphereGeometry(3.5, 16, 16);
    const gemMat = new THREE.MeshBasicMaterial({ color: gemColor });
    const gemMesh = new THREE.Mesh(gemGeo, gemMat);
    gemMesh.position.set(0, 11, 0);
    group.add(gemMesh);

    group.userData = {
      isWork: true,
      baseY: 4,
      slab: slabMesh,
      gem: gemMesh,
    };

    return group;
  }

  function createIntentBeaconMesh(colorHex: number): THREE.Group {
    const group = new THREE.Group();

    // Base plinth
    const baseGeo = new THREE.CylinderGeometry(10, 12, 4, 16);
    const baseMat = new THREE.MeshLambertMaterial({ color: 0x0c233c });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = 2;
    group.add(baseMesh);

    // Hexagonal crystal pillar
    const pillarGeo = new THREE.CylinderGeometry(4.5, 6.5, 36, 6);
    const pillarMat = new THREE.MeshLambertMaterial({ color: colorHex });
    const pillarMesh = new THREE.Mesh(pillarGeo, pillarMat);
    pillarMesh.position.y = 20;
    group.add(pillarMesh);

    // Holographic rising light shaft
    const shaftGeo = new THREE.CylinderGeometry(5, 7.5, 60, 16);
    const shaftMat = new THREE.MeshBasicMaterial({ color: 0x7213ea, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending });
    const shaftMesh = new THREE.Mesh(shaftGeo, shaftMat);
    shaftMesh.position.y = 32;
    group.add(shaftMesh);

    // Orbital ring
    const ringGeo = new THREE.RingGeometry(10, 12, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00b8f5, side: THREE.DoubleSide, transparent: true, opacity: 0.75 });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 3;
    ringMesh.position.y = 22;
    group.add(ringMesh);

    group.userData = {
      isIntent: true,
      baseY: 12,
      beam: shaftMesh,
      orbitalRing: ringMesh,
    };

    return group;
  }

  function createDefaultNodeMesh(colorHex: number): THREE.Mesh {
    const geo = new THREE.BoxGeometry(32, 6, 24);
    const mat = new THREE.MeshLambertMaterial({ color: colorHex });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 3;
    return mesh;
  }

  function buildScene(): void {
    if (!scene) return;

    // Clear existing meshes
    nodeMeshes.forEach((mesh) => scene?.remove(mesh));
    nodeMeshes.clear();
    edgeLines.forEach((line) => scene?.remove(line));
    edgeLines.length = 0;
    domOverlay.innerHTML = "";
    overlayLabels.clear();

    const nodes = filterVisibleNodes();
    computeLayout(nodes);

    nodes.forEach((node) => {
      const pos = nodePositions.get(node.id) ?? { x: 0, y: 0, z: 0 };
      const colorHex = (colors as Record<string, number>)[node.kind] ?? colors.default;

      let obj: THREE.Object3D;
      if (node.kind === "agent_session") {
        obj = createAgentTokenMesh(colorHex);
      } else if (node.kind === "work" || node.kind === "work_item") {
        const state = (node.attributes as Record<string, unknown> | undefined)?.state as string | undefined;
        obj = createWorkPlatformMesh(colorHex, state);
      } else if (node.kind === "intent") {
        obj = createIntentBeaconMesh(colorHex);
      } else {
        obj = createDefaultNodeMesh(colorHex);
      }

      obj.position.set(pos.x, pos.y, pos.z);
      (obj as unknown as { __nodeId: string }).__nodeId = node.id;
      scene?.add(obj);
      nodeMeshes.set(node.id, obj);

      // DOM Overlay pill
      const labelElem = document.createElement("button");
      labelElem.className = `dom-node-pill pill-${node.kind}${node.id === selectedNodeId ? " selected" : ""}`;
      labelElem.setAttribute("role", "button");
      labelElem.setAttribute("aria-label", `${node.label} (${node.kind})`);
      labelElem.tabIndex = 0;
      labelElem.innerHTML = `<span class="pill-dot"></span><span class="pill-text">${escapeHtml(node.label).slice(0, 32)}</span>`;
      labelElem.addEventListener("click", () => selectNode(node.id));
      labelElem.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectNode(node.id);
        }
      });
      domOverlay.appendChild(labelElem);
      overlayLabels.set(node.id, labelElem);
    });

    // Edges
    const byId = new Set(nodes.map((n) => n.id));
    currentFrame.graph.edges.forEach((edge) => {
      if (!byId.has(edge.source) || !byId.has(edge.target)) return;
      const p1 = nodePositions.get(edge.source);
      const p2 = nodePositions.get(edge.target);
      if (!p1 || !p2) return;

      const v1 = new THREE.Vector3(p1.x, p1.y + 4, p1.z);
      const v2 = new THREE.Vector3(p2.x, p2.y + 4, p2.z);
      const points = [v1, v2];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({
        color: edge.kind === "executed_by" ? 0x1e49e6 : 0x0091da,
        transparent: true,
        opacity: edge.kind === "executed_by" ? 0.8 : 0.4,
      });
      const line = new THREE.Line(geo, mat);
      scene?.add(line);
      edgeLines.push(line);
    });

    requestRender();
  }

  function filterVisibleNodes(): GraphNode[] {
    const filter = filterSelect.value;
    return currentFrame.graph.nodes.filter((node) => !filter || node.kind === filter);
  }

  function render2D(): void {
    const nodes = filterVisibleNodes();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const width = Math.max(stage.clientWidth, 480);
    const height = Math.max(stage.clientHeight, 360);
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.max(80, Math.min(width, height) * 0.35);

    const positions = new Map<string, { x: number; y: number }>();
    nodes.forEach((node, i) => {
      const angle = (Math.PI * 2 * i) / Math.max(nodes.length, 1);
      positions.set(node.id, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    });

    const lines = currentFrame.graph.edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => {
        const a = positions.get(e.source);
        const b = positions.get(e.target);
        return a && b ? `<line class="edge" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="var(--kpmg-light-blue)" stroke-width="1.5" opacity="0.72" />` : "";
      })
      .join("");

    const circles = nodes
      .map((n) => {
        const p = positions.get(n.id) ?? { x: cx, y: cy };
        const sel = selectedNodeId === n.id ? ' stroke="var(--status-warning)" stroke-width="3"' : ' stroke="var(--kpmg-white)" stroke-width="1.2"';
        const fill = (colors as Record<string, number>)[n.kind] ? `#${(colors as Record<string, number>)[n.kind]!.toString(16).padStart(6, "0")}` : "var(--kpmg-blue)";
        return `<g data-id="${escapeHtml(n.id)}" style="cursor:pointer;"><circle cx="${p.x}" cy="${p.y}" r="18" fill="${fill}"${sel} /><text x="${p.x}" y="${p.y + 32}" text-anchor="middle" fill="#0c233c" font-size="11px" font-weight="600">${escapeHtml(n.label).slice(0, 32)}</text></g>`;
      })
      .join("");

    svgStage.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svgStage.innerHTML = lines + circles;

    svgStage.querySelectorAll("[data-id]").forEach((grp) => {
      grp.addEventListener("click", () => {
        const id = grp.getAttribute("data-id");
        if (id) selectNode(id);
      });
    });
  }

  function requestRender(): void {
    if (animationFrameId !== null || !renderer || !scene || !camera) return;
    animationFrameId = requestAnimationFrame(renderFrame);
  }

  function renderFrame(time: number): void {
    animationFrameId = null;
    if (!renderer || !scene || !camera) return;

    let animating = false;
    activeCues.forEach((active, key) => {
      const elapsed = time - active.startTime;
      const cue = active.cue;
      const duration = cue.durationMs ?? 1000;
      const progress = Math.min(elapsed / duration, 1);

      if (!prefersReducedMotion) {
        if (cue.type === "pulse") {
          if (active.mesh) {
            const scale = 1 + Math.sin(progress * Math.PI) * 0.32;
            active.mesh.scale.set(scale, scale, scale);
          }
          if (active.ripple) {
            active.ripple.scale.set(1 + progress * 3.8, 1 + progress * 3.8, 1);
            (active.ripple.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.85;
          }
        } else if (cue.type === "claim") {
          if (active.tracer && (active as unknown as { sourcePos?: THREE.Vector3; targetPos?: THREE.Vector3 }).sourcePos) {
            const { sourcePos, targetPos } = active as unknown as { sourcePos: THREE.Vector3; targetPos: THREE.Vector3 };
            active.tracer.position.lerpVectors(sourcePos, targetPos, progress);
            active.tracer.position.y += Math.sin(progress * Math.PI) * 36;
          }
          if (progress > 0.6 && active.mesh) {
            const b = 1 + Math.sin(progress * Math.PI) * 0.18;
            active.mesh.scale.set(b, b, b);
          }
        } else if (cue.type === "blocked") {
          if (active.ripple) {
            (active.ripple.material as THREE.MeshBasicMaterial).opacity = Math.sin(progress * Math.PI * 6) * 0.45 + 0.45;
          }
        } else if (cue.type === "intent") {
          if (active.mesh && active.mesh.userData?.beam) {
            const s = 1 + Math.sin(progress * Math.PI) * 0.5;
            active.mesh.userData.beam.scale.set(s, 1, s);
          }
        } else if (cue.type === "settle") {
          if (active.mesh) {
            const bounce = 1 + (1 - progress) * 0.22 * Math.sin(progress * Math.PI * 4);
            active.mesh.scale.set(bounce, bounce, bounce);
          }
          if (active.ripple) {
            active.ripple.scale.set(1 + progress * 3.2, 1 + progress * 3.2, 1);
            (active.ripple.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.8;
          }
        }
      }

      if (progress >= 1) {
        if (active.mesh) active.mesh.scale.set(1, 1, 1);
        if (active.ripple) scene?.remove(active.ripple);
        if (active.tracer) scene?.remove(active.tracer);
        activeCues.delete(key);
      } else {
        animating = true;
      }
    });

    renderer.render(scene, camera);
    updateDomOverlayPositions();
    if (animating) requestRender();
  }

  function updateDomOverlayPositions(): void {
    if (!camera) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const pos = new THREE.Vector3();

    overlayLabels.forEach((elem, id) => {
      const mesh = nodeMeshes.get(id);
      if (!mesh) return;

      mesh.getWorldPosition(pos);
      pos.y += 20;
      pos.project(camera!);

      const x = (pos.x * 0.5 + 0.5) * w;
      const y = (-pos.y * 0.5 + 0.5) * h;
      elem.style.left = `${x}px`;
      elem.style.top = `${y}px`;
      elem.style.display = pos.z < 1 ? "flex" : "none";
    });
  }

  function applyCue(cue: SceneCue): void {
    const targetMesh = nodeMeshes.get(cue.targetNodeId);
    const pos = targetMesh ? targetMesh.position : (nodePositions.get(cue.targetNodeId) ?? { x: 0, y: 0, z: 0 });

    if (cue.type === "pulse") {
      const ringGeo = new THREE.RingGeometry(12, 15, 32);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x1e49e6, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
      const ripple = new THREE.Mesh(ringGeo, ringMat);
      ripple.rotation.x = Math.PI / 2;
      ripple.position.set(pos.x, 0.5, pos.z);
      scene?.add(ripple);
      activeCues.set(cue.id, { cue, startTime: performance.now(), mesh: targetMesh, ripple });
    } else if (cue.type === "claim") {
      const sourceMesh = cue.sourceNodeId ? nodeMeshes.get(cue.sourceNodeId) : undefined;
      const sPos = sourceMesh ? sourceMesh.position.clone() : new THREE.Vector3(0, 22, 0);
      const tPos = targetMesh ? targetMesh.position.clone() : new THREE.Vector3(0, 4, 0);
      const tracerGeo = new THREE.SphereGeometry(4.5, 12, 12);
      const tracerMat = new THREE.MeshBasicMaterial({ color: 0x00b8f5 });
      const tracer = new THREE.Mesh(tracerGeo, tracerMat);
      tracer.position.copy(sPos);
      scene?.add(tracer);
      activeCues.set(cue.id, {
        cue,
        startTime: performance.now(),
        mesh: targetMesh,
        tracer,
        sourcePos: sPos,
        targetPos: tPos,
      } as never);
    } else if (cue.type === "settle") {
      const ringGeo = new THREE.RingGeometry(16, 20, 32);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
      const ripple = new THREE.Mesh(ringGeo, ringMat);
      ripple.rotation.x = Math.PI / 2;
      ripple.position.set(pos.x, 0.5, pos.z);
      scene?.add(ripple);
      activeCues.set(cue.id, { cue, startTime: performance.now(), mesh: targetMesh, ripple });
    } else if (cue.type === "blocked") {
      const ringGeo = new THREE.RingGeometry(22, 25, 32);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
      const ripple = new THREE.Mesh(ringGeo, ringMat);
      ripple.rotation.x = Math.PI / 2;
      ripple.position.set(pos.x, 14, pos.z);
      scene?.add(ripple);
      activeCues.set(cue.id, { cue, startTime: performance.now(), mesh: targetMesh, ripple });
    } else {
      activeCues.set(cue.id, {
        cue,
        startTime: performance.now(),
        mesh: targetMesh,
      });
    }
    requestRender();
  }

  function selectNode(id: string): void {
    selectedNodeId = id;
    overlayLabels.forEach((elem, nid) => {
      if (nid === id) elem.classList.add("selected");
      else elem.classList.remove("selected");
    });

    const node = currentFrame.graph.nodes.find((n) => n.id === id);
    populateInspector(node);

    if (is2DFallback) {
      render2D();
    }
  }

  function populateInspector(node?: GraphNode): void {
    if (!node) {
      inspIdentity.innerHTML = '<p class="muted">No node selected.</p>';
      inspTrace.innerHTML = '<p class="muted">No trace records.</p>';
      inspEvidence.innerHTML = '<p class="muted">No evidence attached.</p>';
      inspProvenance.innerHTML = '<p class="muted">Not observed</p>';
      inspError.innerHTML = '<p class="muted">No active errors.</p>';
      inspNextAction.innerHTML = '<p class="muted">No next action recorded.</p>';
      return;
    }

    const observation = buildInspectorObservation(node);

    // 1. Identity & Current Status
    inspIdentity.innerHTML = `
      <table class="inspector-table">
        <tr><th>ID</th><td><code>${escapeHtml(node.id)}</code></td></tr>
        <tr><th>Kind</th><td><span class="kind-tag">${escapeHtml(node.kind)}</span></td></tr>
        <tr><th>Label</th><td><strong>${escapeHtml(node.label)}</strong></td></tr>
        ${observation.stateRowHtml}
      </table>
    `;

    // 2. Trace
    const relatedEvents = currentFrame.events.filter(
      (e) => e.actor.id === node.id || (e.payload && JSON.stringify(e.payload).includes(node.id))
    );
    if (relatedEvents.length === 0) {
      inspTrace.innerHTML = '<p class="muted">No trace records recorded for this entity.</p>';
    } else {
      inspTrace.innerHTML = relatedEvents
        .slice(-5)
        .map(
          (e) => `
          <div class="trace-item">
            <span class="trace-seq">#${e.sequence}</span>
            <span class="trace-type">${escapeHtml(e.eventType)}</span>
            <span class="trace-actor">${escapeHtml(e.actor.name || e.actor.id || e.actor.kind)}</span>
            <span class="trace-time">${new Date(e.occurredAt).toLocaleTimeString()}</span>
          </div>
        `
        )
        .join("");
    }

    // 3. Evidence
    if (!node.evidence || node.evidence.length === 0) {
      inspEvidence.innerHTML = '<p class="muted">No evidence attached to this node.</p>';
    } else {
      inspEvidence.innerHTML = node.evidence
        .map(
          (ev) => `
          <div class="evidence-item">
            <div><strong>Type:</strong> ${escapeHtml(ev.type)}</div>
            <div><strong>ID:</strong> <code>${escapeHtml(ev.id)}</code></div>
            ${ev.locator ? `<div><strong>Locator:</strong> ${escapeHtml(ev.locator)}</div>` : ""}
          </div>
        `
        )
        .join("");
    }

    // 4. Provenance
    inspProvenance.innerHTML = observation.provenanceHtml;

    // 5. Error
    if (currentFrame.quality.degraded && currentFrame.quality.reasons.length > 0) {
      inspError.innerHTML = currentFrame.quality.reasons.map((r) => `<div class="error-item">⚠️ ${escapeHtml(r)}</div>`).join("");
    } else {
      inspError.innerHTML = '<p class="muted">No active errors.</p>';
    }

    // 6. Next Action (Strict Zero Speculation)
    const nextAction = (node.attributes as Record<string, unknown> | undefined)?.next_action;
    if (nextAction && typeof nextAction === "string") {
      inspNextAction.innerHTML = `<div class="next-action-box"><strong>Next Action:</strong> ${escapeHtml(nextAction)}</div>`;
    } else {
      inspNextAction.innerHTML = '<p class="muted">No next action recorded</p>';
    }
  }

  function updateQualityBadges(): void {
    const q = currentFrame.quality;
    badgeDegraded.style.display = q.degraded ? "inline-flex" : "none";
    badgeTruncated.style.display = q.truncated ? "inline-flex" : "none";
    badgeStale.style.display = q.stale ? "inline-flex" : "none";
    badgeEmpty.style.display = q.empty ? "inline-flex" : "none";

    const lastSeq = currentFrame.cursor.lastSequence ?? (currentFrame.events.at(-1)?.sequence || "0");
    cursorInfo.textContent = `seq: ${lastSeq}`;
    freshnessElem.textContent = q.generatedAt ? new Date(q.generatedAt).toLocaleTimeString() : "just now";
  }

  function showBanner(text: string): void {
    stageBanner.textContent = text;
    stageBanner.style.display = "block";
  }

  function hideBanner(): void {
    stageBanner.style.display = "none";
  }

  // Live event stream (SSE)
  let liveSource: EventSource | null = null;
  let liveReconnectTimer: number | null = null;
  let streamState: "connecting" | "live" | "reconnecting" | "offline" = "connecting";

  function updateStreamStatus(): void {
    const now = new Date().toLocaleTimeString();
    if (isMcp || !apiBase || isReplayMode) {
      streamStatusElem.textContent = now;
      return;
    }
    const label = streamState === "live" ? "● live" : streamState === "connecting" ? "○ connecting" : streamState === "reconnecting" ? "○ reconnecting" : "● offline";
    streamStatusElem.textContent = `${label} · ${now}`;
  }

  function disconnectLiveStream(): void {
    if (liveSource) {
      liveSource.close();
      liveSource = null;
    }
    if (liveReconnectTimer !== null) {
      clearTimeout(liveReconnectTimer);
      liveReconnectTimer = null;
    }
  }

  function connectLiveStream(): void {
    if (isReplayMode || !apiBase || isMcp || liveSource) return;
    const lastSeq = currentFrame.cursor.lastSequence ?? "0";
    const url = `${apiBase}/stream?kind=${encodeURIComponent(currentFrame.scope.kind)}&afterSequence=${encodeURIComponent(lastSeq)}&session=${encodeURIComponent(token)}`;
    const source = new EventSource(url);
    liveSource = source;
    streamState = "connecting";
    updateStreamStatus();

    source.onopen = () => {
      if (source !== liveSource) return;
      streamState = "live";
      updateStreamStatus();
    };

    source.onmessage = (event) => {
      if (source !== liveSource) return;
      let data: { events?: TheaterEvent[]; throughSequence?: string; error?: string };
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.error || !Array.isArray(data.events) || data.events.length === 0) return;
      processLiveEvents({ events: data.events, throughSequence: data.throughSequence });
    };

    source.onerror = () => {
      if (source !== liveSource) return;
      streamState = "reconnecting";
      updateStreamStatus();
      disconnectLiveStream();
      liveReconnectTimer = window.setTimeout(() => {
        liveReconnectTimer = null;
        connectLiveStream();
      }, 1500);
    };
  }

  function processLiveEvents(data: { events: TheaterEvent[]; throughSequence?: string }): void {
    const structuralTypes = [
      "WorkItemCreated",
      "WorkItemClaimed",
      "WorkItemCompleted",
      "Completed",
      "WorkItemBlocked",
      "Blocked",
      "WorkItemUnblocked",
      "AgentJoined",
      "AgentDeparted",
      "IntentDeclared",
      "WorkItemEvaluationRequested",
      "WorkItemEvaluationAccepted",
      "EvaluationAccepted",
    ];
    let hasStructural = false;

    data.events.forEach((ev: TheaterEvent) => {
      currentFrame.events.push(ev);
      const eType = ev.eventType || (ev as unknown as { type?: string }).type || "";
      if (structuralTypes.includes(eType)) {
        hasStructural = true;
      }
      const cue = eventToMotionCue(ev, currentFrame.graph);
      if (cue) applyCue(cue);
    });
    currentFrame.cursor.lastSequence = data.throughSequence || data.events.at(-1)?.sequence;
    try {
      if (currentFrame.cursor.lastSequence !== undefined) {
        window.sessionStorage.setItem("my-pi.theater.cursor", String(currentFrame.cursor.lastSequence));
      }
    } catch {}
    updateQualityBadges();

    if (hasStructural) void refreshGraph();
  }

  async function refreshGraph(): Promise<void> {
    if (!apiBase) return;
    try {
      const graphRes = await fetch(`${apiBase}?kind=${encodeURIComponent(currentFrame.scope.kind)}`, {
        headers: { "x-my-pi-session": token },
      });
      if (!graphRes.ok) return;
      currentFrame.graph = await graphRes.json();
      currentFrame.quality.empty = currentFrame.graph.nodes.length === 0;
      currentFrame.quality.truncated = currentFrame.graph.truncated;
      currentFrame.quality.degraded = Boolean(currentFrame.graph.degraded);
      populateFilterOptions();
      if (is2DFallback) render2D();
      else buildScene();
      if (selectedNodeId) {
        populateInspector(currentFrame.graph.nodes.find((n) => n.id === selectedNodeId));
      }
    } catch {
      // ignore graph refresh failure
    }
  }

  // Replay logic
  function setReplayMode(enable: boolean): void {
    isReplayMode = enable;
    if (isReplayMode) {
      disconnectLiveStream();
      modeToggle.classList.remove("mode-live");
      modeToggle.classList.add("mode-replay");
      modeText.textContent = "REPLAY";
      timelineBar.classList.remove("hidden");
      timelineBar.style.display = "flex";
      sliderSeq.max = String(Math.max(currentFrame.events.length - 1, 0));
      sliderSeq.value = "0";
      replayIndex = 0;
      updateReplayStep();
    } else {
      modeToggle.classList.add("mode-live");
      modeToggle.classList.remove("mode-replay");
      modeText.textContent = "LIVE";
      timelineBar.classList.add("hidden");
      timelineBar.style.display = "none";
      if (replayTimer !== null) {
        clearInterval(replayTimer);
        replayTimer = null;
        btnPlayPause.textContent = "▶ Play";
      }
      connectLiveStream();
    }
  }

  function updateReplayStep(): void {
    const total = currentFrame.events.length;
    timelineSeqDisplay.textContent = `Event ${replayIndex + 1} of ${total}`;
    sliderSeq.value = String(replayIndex);

    const ev = currentFrame.events[replayIndex];
    if (ev) {
      cursorInfo.textContent = `seq: ${ev.sequence}`;
      const cue = eventToMotionCue(ev, currentFrame.graph);
      if (cue) applyCue(cue);
      if (selectedNodeId) {
        populateInspector(currentFrame.graph.nodes.find((n) => n.id === selectedNodeId));
      }
    }
  }

  // Event Listeners
  btnPlayPause.addEventListener("click", () => {
    if (replayTimer !== null) {
      clearInterval(replayTimer);
      replayTimer = null;
      btnPlayPause.textContent = "▶ Play";
    } else {
      btnPlayPause.textContent = "⏸ Pause";
      replayTimer = window.setInterval(() => {
        if (replayIndex < currentFrame.events.length - 1) {
          replayIndex++;
          updateReplayStep();
        } else {
          clearInterval(replayTimer!);
          replayTimer = null;
          btnPlayPause.textContent = "▶ Play";
        }
      }, 600);
    }
  });

  btnStep.addEventListener("click", () => {
    if (replayIndex < currentFrame.events.length - 1) {
      replayIndex++;
      updateReplayStep();
    }
  });

  sliderSeq.addEventListener("input", () => {
    replayIndex = Number(sliderSeq.value);
    updateReplayStep();
  });

  modeToggle.addEventListener("click", () => {
    setReplayMode(!isReplayMode);
  });

  btnToggleRender.addEventListener("click", () => {
    if (is2DFallback) switchTo3D();
    else switchTo2D("Manual 2D mode toggled by operator");
  });

  btnResetCam.addEventListener("click", () => {
    if (camera) {
      camera.position.set(400, 420, 400);
      camera.zoom = 1;
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      requestRender();
    }
  });

  btnFit.addEventListener("click", () => {
    if (camera) {
      camera.zoom = 0.85;
      camera.updateProjectionMatrix();
      requestRender();
    }
  });

  // Left Rail button bindings
  btnRailFit?.addEventListener("click", () => btnFit.click());
  btnRailReset?.addEventListener("click", () => btnResetCam.click());
  btnRailRender?.addEventListener("click", () => btnToggleRender.click());
  btnRailTimeline?.addEventListener("click", () => modeToggle.click());
  btnRailLegend?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (legendPopover) {
      legendPopover.classList.toggle("hidden");
    }
  });
  window.addEventListener("click", (e) => {
    if (legendPopover && !legendPopover.classList.contains("hidden") && !legendPopover.contains(e.target as Node) && e.target !== btnRailLegend) {
      legendPopover.classList.add("hidden");
    }
  });

  // Pan controls with mouse drag
  let isDragging = false;
  let lastMouseX = 0;
  let lastMouseY = 0;

  stage.addEventListener("pointerdown", (e) => {
    isDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  });

  window.addEventListener("pointermove", (e) => {
    if (!isDragging || !camera) return;
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    camera.position.x -= dx * 0.8;
    camera.position.z += dy * 0.8;
    requestRender();
  });

  window.addEventListener("pointerup", () => {
    isDragging = false;
  });

  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (!camera) return;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    camera.zoom = Math.min(4, Math.max(0.2, camera.zoom * factor));
    camera.updateProjectionMatrix();
    requestRender();
  }, { passive: false });

  // Escape key deselects
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      selectedNodeId = null;
      overlayLabels.forEach((el) => el.classList.remove("selected"));
      populateInspector(undefined);
    }
  });

  // Populate graph kind tabs
  const availableKinds: GraphKind[] = ["work", "code", "impact", "lineage"];
  availableKinds.forEach((kind) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `kind-tab${kind === currentFrame.scope.kind ? " active" : ""}`;
    btn.textContent = kind;
    btn.setAttribute("role", "tab");
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".kind-tab").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      if (apiBase) {
        try {
          const res = await fetch(`${apiBase}?kind=${encodeURIComponent(kind)}`, {
            headers: { "x-my-pi-session": token },
          });
          if (res.ok) {
            currentFrame.graph = await res.json();
            currentFrame.scope.kind = kind;
            currentFrame.quality.empty = currentFrame.graph.nodes.length === 0;
            currentFrame.quality.truncated = currentFrame.graph.truncated;
            currentFrame.quality.degraded = Boolean(currentFrame.graph.degraded);
            buildScene();
            updateQualityBadges();
            disconnectLiveStream();
            connectLiveStream();
          }
        } catch {
          // keep existing
        }
      }
    });
    kindsElem.appendChild(btn);
  });

  // Filter dropdown
  function populateFilterOptions(): void {
    const kinds = [...new Set(currentFrame.graph.nodes.map((n) => n.kind))].sort();
    filterSelect.innerHTML = '<option value="">all kinds</option>' + kinds.map((k) => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join("");
  }
  filterSelect.addEventListener("change", () => {
    if (is2DFallback) render2D();
    else buildScene();
  });

  // Initial setup
  populateFilterOptions();
  updateQualityBadges();
  switchTo3D();

  // Live event stream
  updateStreamStatus();
  setInterval(updateStreamStatus, 1000);
  connectLiveStream();
})();
