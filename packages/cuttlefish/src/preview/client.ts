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

function canvasPoint(canvas: HTMLCanvasElement, event: PointerEvent, width: number, height: number): { x: number; y: number } {
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

  // Set the canvas CSS aspect-ratio to match the display (e.g. 128:64 for
  // OLED, 320:240 for TFT) so the browser scales it proportionally.
  document.documentElement.style.setProperty("--display-aspect", `${snapshot.program.width} / ${snapshot.program.height}`);

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
    },
    onDiagnostics: (message: string) => {
      extraDiagnostics.push(message);
      renderDiagnostics(snapshot, extraDiagnostics);
    },
  });

  canvas.onpointerdown = (event) => {
    if (!runtime) return;
    canvas.setPointerCapture(event.pointerId);
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
