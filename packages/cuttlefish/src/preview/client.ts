// Minimal local structural types matching @typecad/ui's PreviewPinControlSpec
// and PreviewSnapshot (packages/ui/src/preview/types.ts), covering only the
// fields this file reads. Duplicated here — rather than imported from
// @typecad/ui — because ui's preview/types.d.ts transitively imports
// @typecad/cuttlefish/api/shared; a static import here would make tsc
// resolve @typecad/ui's dist while building this package, which
// self-references back into this package's own dist/ output and causes
// TS5055 ("would overwrite input file") on rebuilds where dist/ already
// exists. See the comment in ui/ui-bridge.ts for the same pattern.
interface PreviewPinControlSpec {
  label: string;
}

interface PreviewSnapshot {
  profileName?: string;
  program: {
    width: number;
    height: number;
    colorFormat: string;
    display?: { driver?: string };
  };
  pinControls: PreviewPinControlSpec[];
  diagnostics: Array<{ severity: string; message: string }>;
}

// PreviewUIRuntime is loaded dynamically (see the import in the snapshot
// handler). Typed as any to avoid a static dependency on @typecad/ui.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let runtime: any;
let imageData: ImageData | undefined;
let pendingPointerMove: { x: number; y: number } | undefined;
let pendingPointerFrame = 0;

// ── Debug overlay ──────────────────────────────────────────────────────────
// A second canvas stacked exactly over the app canvas; strokes the runtime's
// per-frame debugInfo() geometry. Zero cost while every mode is off (the
// runtime capture flag is only set when a mode is on).
type DebugModes = { boxes: boolean; clips: boolean; dirty: boolean; inspect: boolean };
let debugModes: DebugModes = { boxes: false, clips: false, dirty: false, inspect: false };
let debugOverlay: HTMLCanvasElement | undefined;
let debugCtx: CanvasRenderingContext2D | undefined;
/** Re-syncs the overlay to the app canvas whenever layout changes its box
 *  (aspect-ratio application, max-height, container reflow). */
let overlayResizeObserver: ResizeObserver | undefined;
let dirtyFlashAlpha = 0;
/** CSS px per logical display px — the overlay backing store runs at this
 *  resolution so debug strokes are 1 CSS px thin (a 1-logical-px stroke on
 *  the app canvas's own backing store would upscale 3x thick and bury the
 *  content under investigation). */
let debugScale = 1;

// Stroke color per node kind: a screenshot should be self-describing.
// views cyan · text yellow · interactive magenta · img/canvas orange ·
// list green · screen transparent (skip; it's the whole panel).
function debugColor(tag: string, kind: string): string | undefined {
  if (tag === "screen") return undefined;
  if (tag === "img" || tag === "canvas") return "#ff9a3c";
  if (tag === "list") return "#3ddc84";
  if (["button", "input", "select", "check", "radio", "range", "progress", "drawer"].includes(tag)) return "#ff4fd8";
  if (kind === "text") return "#ffe14d";
  return "#3cc8ff";
}

function applyDebugCapture(): void {
  runtime?.setDebugCapture?.(debugModes.boxes || debugModes.clips || debugModes.dirty);
  const state = document.getElementById("debugState");
  if (state) {
    const on = (["boxes", "clips", "dirty", "inspect"] as const).filter((m) => debugModes[m]);
    state.textContent = on.length === 0
      ? "overlay: off — check a box or press D"
      : `overlay: ${on.join("+")}`;
  }
}

function drawDebugOverlay(width: number, height: number): void {
  if (!debugOverlay || !debugCtx) return;
  const ctx = debugCtx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, debugOverlay.width, debugOverlay.height);
  ctx.setTransform(debugScale, 0, 0, debugScale, 0, 0);
  const anyVisual = debugModes.boxes || debugModes.clips || debugModes.dirty;
  if (!anyVisual || !runtime?.debugInfo) return;
  const info = runtime.debugInfo();
  if (debugModes.dirty) {
    // Flash the regions repainted this frame; fades until the next repaint.
    dirtyFlashAlpha = Math.min(0.55, dirtyFlashAlpha + 0.35);
    ctx.fillStyle = `rgba(255, 225, 77, ${dirtyFlashAlpha.toFixed(2)})`;
    for (const r of info.painted) ctx.fillRect(r.x, r.y, r.w, r.h);
  } else {
    dirtyFlashAlpha = 0;
  }
  // 1 CSS px regardless of the app canvas's logical upscaling — thicker
  // strokes bury the content being inspected.
  ctx.lineWidth = Math.max(1 / debugScale, 0.5);
  if (debugModes.clips) {
    // Viewport tint guarantees visibility at any stroke sampling; the dashed
    // outline marks the exact clip edges.
    for (const c of info.clips) {
      ctx.fillStyle = "rgba(61, 220, 132, 0.08)";
      ctx.fillRect(c.x, c.y, c.w, c.h);
    }
    ctx.strokeStyle = "#3ddc84";
    ctx.setLineDash([3, 2]);
    for (const c of info.clips) ctx.strokeRect(c.x, c.y, c.w - 1, c.h - 1);
    ctx.setLineDash([]);
  }
  if (debugModes.boxes) {
    for (const n of info.nodes) {
      const color = debugColor(n.tag, n.kind);
      if (!color) continue;
      ctx.strokeStyle = color;
      ctx.strokeRect(n.x + 0.5, n.y + 0.5, n.w - 1, n.h - 1);
      // Untappable interactive elements get a red corner mark — the
      // id-less-element trap (the preview wires by id).
      if (!n.tappable && ["button", "input", "select", "check", "radio", "list"].includes(n.tag)) {
        ctx.strokeStyle = "#ff5252";
        ctx.beginPath();
        ctx.moveTo(n.x, n.y);
        ctx.lineTo(n.x + 6, n.y);
        ctx.moveTo(n.x, n.y);
        ctx.lineTo(n.x, n.y + 6);
        ctx.stroke();
      }
    }
  }
}

function inspectAt(px: number, py: number, width: number, height: number, report: (msg: string) => void): boolean {
  if (!runtime?.debugHit) return false;
  const i = runtime.debugHit(px, py);
  if (i < 0) {
    report(`inspect (${px},${py}): empty space`);
    return true;
  }
  const info = runtime.debugInfo();
  const n = info.nodes.find((x: { i: number }) => x.i === i);
  if (!n) return false;
  report(`inspect #${i}${n.id ? ` '${n.id}'` : ""} <${n.tag}> kind=${n.kind} box=${n.x},${n.y} ${n.w}x${n.h} tappable=${n.tappable}`);
  return true;
}

function wireDebugControls(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  report: (msg: string) => void,
  redraw: () => void,
): void {
  const modesBox = document.getElementById("debugModes");
  if (modesBox) {
    // ?debug=boxes,clips,dirty,inspect seeds the initial state.
    const params = new URLSearchParams(location.search);
    const seeded = (params.get("debug") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    for (const input of Array.from(modesBox.querySelectorAll<HTMLInputElement>("input[data-mode]"))) {
      const mode = input.dataset.mode as keyof DebugModes;
      if (seeded.includes(mode)) debugModes[mode] = true;
      input.checked = debugModes[mode];
      input.addEventListener("change", () => {
        debugModes[mode] = input.checked;
        applyDebugCapture();
        redraw();
      });
    }
  }
  // D cycles boxes → clips → dirty → off (inspect stays manual — it blocks
  // normal input and shouldn't be cycled into by accident).
  window.addEventListener("keydown", (e) => {
    if (e.key !== "d" && e.key !== "D") return;
    const on = debugModes.boxes || debugModes.clips || debugModes.dirty;
    if (!on) debugModes = { ...debugModes, boxes: true };
    else if (debugModes.boxes) debugModes = { ...debugModes, boxes: false, clips: true };
    else if (debugModes.clips) debugModes = { ...debugModes, clips: false, dirty: true };
    else debugModes = { ...debugModes, dirty: false };
    for (const input of Array.from((modesBox ?? document).querySelectorAll<HTMLInputElement>("input[data-mode]"))) {
      const mode = input.dataset.mode as keyof DebugModes;
      input.checked = debugModes[mode];
    }
    applyDebugCapture();
    redraw();
  });
  // Inspect taps: while inspect mode is on, taps report instead of
  // interacting. Ctrl-click always inspects without entering the mode.
  const inspectPointer = (event: PointerEvent, force: boolean): boolean => {
    if (!force && !debugModes.inspect) return false;
    const p = canvasPoint(canvas, event, width, height);
    inspectAt(p.x, p.y, width, height, report);
    return true;
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (inspectPointer(event, event.ctrlKey || event.metaKey)) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  }, true);
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing preview element #${id}`);
  return el as T;
}

function renderDiagnostics(snapshot: PreviewSnapshot, extra: string[] = []): void {
  const diagnostics = byId<HTMLDivElement>("diagnostics");
  const messages = [
    ...snapshot.diagnostics.map((d: { severity: string; message: string }) => `${d.severity}: ${d.message}`),
    ...extra,
  ];
  diagnostics.replaceChildren(...messages.map((message) => {
    const div = document.createElement("div");
    div.textContent = message;
    return div;
  }));
}

function canvasPoint(canvas: HTMLCanvasElement, event: { clientX: number; clientY: number }, width: number, height: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.floor(((event.clientX - rect.left) / rect.width) * width),
    y: Math.floor(((event.clientY - rect.top) / rect.height) * height),
  };
}

function renderPinControls(controls: PreviewPinControlSpec[]): void {
  const panel = byId<HTMLDivElement>("pins");
  panel.replaceChildren();
  if (controls.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No GPIO controls";
    panel.append(empty);
    return;
  }
  for (const control of controls) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = control.label;
    button.addEventListener("click", () => runtime?.triggerPin(control));
    panel.append(button);
  }
}

function flushPointerMove(): void {
  pendingPointerFrame = 0;
  if (!runtime || !pendingPointerMove) return;
  const point = pendingPointerMove;
  pendingPointerMove = undefined;
  runtime.pointerMove(point.x, point.y);
}

async function loadSnapshot(): Promise<PreviewSnapshot> {
  const res = await fetch("/snapshot.json", { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return await res.json() as PreviewSnapshot;
}

async function start(): Promise<void> {
  const snapshot = await loadSnapshot();
  runtime?.stop();
  runtime = undefined;

  const canvas = byId<HTMLCanvasElement>("display");
  canvas.width = snapshot.program.width;
  canvas.height = snapshot.program.height;
  imageData = new ImageData(snapshot.program.width, snapshot.program.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.imageSmoothingEnabled = false;

  // Debug overlay: same backing resolution + CSS as the app canvas, stacked
  // exactly on top; pointer-events pass through to the app canvas below.
  debugOverlay?.remove();
  debugOverlay = document.createElement("canvas");
  debugOverlay.id = "debugOverlay";
  debugOverlay.width = snapshot.program.width;
  debugOverlay.height = snapshot.program.height;
  canvas.parentElement?.appendChild(debugOverlay);
  debugCtx = debugOverlay.getContext("2d") ?? undefined;
  const syncOverlayBox = (): void => {
    if (!debugOverlay) return;
    const rect = canvas.getBoundingClientRect();
    const parent = canvas.parentElement!;
    const prect = parent.getBoundingClientRect();
    debugOverlay.style.left = `${rect.left - prect.left}px`;
    debugOverlay.style.top = `${rect.top - prect.top}px`;
    debugOverlay.style.width = `${rect.width}px`;
    debugOverlay.style.height = `${rect.height}px`;
    // Backing store at CSS-pixel resolution: strokes draw at device-crisp
    // 1 CSS px regardless of the app canvas's logical upscaling.
    const dpr = window.devicePixelRatio || 1;
    debugOverlay.width = Math.max(1, Math.round(rect.width * dpr));
    debugOverlay.height = Math.max(1, Math.round(rect.height * dpr));
    debugScale = (rect.width * dpr) / snapshot.program.width;
  };
  // Set the canvas CSS aspect-ratio to match the display (e.g. 128:64 for
  // OLED, 320:240 for TFT) BEFORE syncing the overlay: the canvas is
  // vertically centered (place-items: center), so applying the real aspect
  // after the sync SHRANK it and moved it DOWN — the overlay stayed at the
  // old 4/3-fallback position and every debug box sat that far above its
  // element. A ResizeObserver re-syncs on any later layout-driven size
  // change (max-height kicking in, container reflow), not just window
  // resizes.
  document.documentElement.style.setProperty("--display-aspect", `${snapshot.program.width} / ${snapshot.program.height}`);
  syncOverlayBox();
  window.addEventListener("resize", syncOverlayBox);
  if (typeof ResizeObserver !== "undefined") {
    overlayResizeObserver?.disconnect();
    overlayResizeObserver = new ResizeObserver(() => syncOverlayBox());
    overlayResizeObserver.observe(canvas);
  }

  const status = byId<HTMLDivElement>("status");
  status.textContent = `${snapshot.profileName ?? snapshot.program.display?.driver ?? "display"} ${snapshot.program.width}x${snapshot.program.height} ${snapshot.program.colorFormat}`;

  const extraDiagnostics: string[] = [];
  // Routed through a variable (not a string literal) so tsc types this as
  // `any` and never resolves @typecad/ui's declaration files — see the
  // comment in ui/ui-bridge.ts for why a literal specifier here causes
  // TS5055 on rebuilds where dist/ already exists.
  const hostRuntimePath = "@typecad/ui/preview/host-ui-runtime";
  const { PreviewUIRuntime } = await import(hostRuntimePath);
  runtime = new PreviewUIRuntime(snapshot, {
    onFrame: (rgba: Uint8Array) => {
      if (!imageData) return;
      imageData.data.set(rgba);
      ctx.putImageData(imageData, 0, 0);
      drawDebugOverlay(snapshot.program.width, snapshot.program.height);
    },
    onDiagnostics: (message: string) => {
      extraDiagnostics.push(message);
      renderDiagnostics(snapshot, extraDiagnostics);
    },
  });

  // Mouse wheel scrolls the scroll owner under the cursor — same hit-scan
  // as a drag (lists, scroll containers). Without this, wheel-scrolling a
  // canvas preview does nothing.
  canvas.onwheel = (event) => {
    if (!runtime) return;
    event.preventDefault();
    const p = canvasPoint(canvas, event, snapshot.program.width, snapshot.program.height);
    // deltaMode: 0 = pixels, 1 = lines, 2 = pages.
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
    runtime.wheel(p.x, p.y, event.deltaY * scale);
  };
  canvas.onpointerdown = (event) => {
    if (!runtime) return;
    // Capture keeps drags flowing when the pointer leaves the canvas, but
    // synthetic pointers (CDP/browser automation) have no capturable
    // pointerId — setPointerCapture throws InvalidPointerId for them and
    // would kill the tap before runtime.pointerDown runs. Losing capture
    // only degrades off-canvas drags, so swallow the failure.
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* not a capturable pointer — canvas-local move/up still arrive */
    }
    const p = canvasPoint(canvas, event, snapshot.program.width, snapshot.program.height);
    runtime.pointerDown(p.x, p.y);
  };
  canvas.onpointermove = (event) => {
    if (!runtime) return;
    pendingPointerMove = canvasPoint(canvas, event, snapshot.program.width, snapshot.program.height);
    if (!pendingPointerFrame) pendingPointerFrame = requestAnimationFrame(flushPointerMove);
  };
  const pointerUp = () => {
    if (pendingPointerFrame) {
      cancelAnimationFrame(pendingPointerFrame);
      flushPointerMove();
    }
    runtime?.pointerUp();
  };
  canvas.onpointerup = pointerUp;
  canvas.onpointercancel = pointerUp;

  renderPinControls(snapshot.pinControls);
  renderDiagnostics(snapshot);
  wireDebugControls(
    canvas,
    snapshot.program.width,
    snapshot.program.height,
    (message) => {
      extraDiagnostics.push(message);
      renderDiagnostics(snapshot, extraDiagnostics);
    },
    () => drawDebugOverlay(snapshot.program.width, snapshot.program.height),
  );
  applyDebugCapture();
  runtime.start();
}

void start().catch((error) => {
  byId<HTMLDivElement>("diagnostics").textContent = error instanceof Error ? error.message : String(error);
});

const events = new EventSource("/events");
events.addEventListener("reload", () => {
  void start().catch((error) => {
    byId<HTMLDivElement>("diagnostics").textContent = error instanceof Error ? error.message : String(error);
  });
});
