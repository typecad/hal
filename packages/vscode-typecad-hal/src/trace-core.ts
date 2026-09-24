// ---------------------------------------------------------------------------
// trace-core.ts — the pure half of the Trace panel: capture parsing, the
// per-interval timeline math, and the webview page. No 'vscode' import so
// the monorepo suite exercises it directly (the board-facts.ts pattern);
// trace.ts is the thin command/panel shell over these.
//
// The timeline math mirrors cuttlefish's src/trace/report.ts buildTimeline:
// CPU% per thread = delta(execCycles)/delta(sysExecCycles) computed host-side
// (idle is its own row, columns sum to ~100%), UI frames carry avg/max ms
// plus the five ui_tick phase spans. The page is the same canvas drawing as
// the CLI's `trace view`, retargeted from HTTP polling to webview messages.
// ---------------------------------------------------------------------------

/** Minimal capture artifact shapes (schema typecad-hal/trace@1). */
export interface TraceThreadSample {
  name: string;
  execCycles: number;
}
export interface TraceUiStats {
  frameCount: number;
  avgFrameMsX10: number;
  maxFrameMs: number;
  phasesUs?: number[];
}
export interface TraceSample {
  seq: number;
  tMs: number;
  sysExecCycles: number;
  threads: TraceThreadSample[];
  ui?: TraceUiStats;
}
export interface TraceEvent {
  tMs: number;
  name: string;
  value?: number;
}
export interface TraceCapture {
  schema: string;
  capturedAt: string;
  port: string;
  intervalMs: number | null;
  samples: TraceSample[];
  events?: TraceEvent[];
}

export interface TimelinePoint {
  tMs: number;
  /** CPU % keyed by thread name for this interval. */
  cpu: Record<string, number>;
  ui?: { avgFrameMs: number; maxFrameMs: number; phasesUs?: number[] };
}

export interface TimelineData {
  capturedAt: string;
  port: string;
  intervalMs: number | null;
  sampleCount: number;
  points: TimelinePoint[];
  events: TraceEvent[];
}

/** Parse + shape-check a capture file's text. Undefined on anything that is
 *  not a trace@1 capture (missing file, partial write, other JSON). */
export function readCapture(text: string): TraceCapture | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const c = raw as Partial<TraceCapture>;
  if (c.schema !== 'typecad-hal/trace@1' || !Array.isArray(c.samples)) return undefined;
  return c as TraceCapture;
}

/** Per-interval series for the viewer (same math as the CLI report). */
export function buildTimelineData(capture: TraceCapture): TimelineData {
  const points: TimelinePoint[] = [];
  const samples = capture.samples;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    const dSys = cur.sysExecCycles - prev.sysExecCycles;
    const cpu: Record<string, number> = {};
    if (dSys > 0) {
      const prevThreads = new Map(prev.threads.map((t) => [t.name, t.execCycles]));
      for (const t of cur.threads) {
        const prevExec = prevThreads.get(t.name);
        if (prevExec === undefined) continue;
        const dExec = t.execCycles - prevExec;
        if (dExec < 0) continue;
        cpu[t.name] = Math.round((dExec / dSys) * 1000) / 10;
      }
    }
    points.push({
      tMs: cur.tMs,
      cpu,
      ...(cur.ui !== undefined
        ? {
            ui: {
              avgFrameMs: cur.ui.avgFrameMsX10 / 10,
              maxFrameMs: cur.ui.maxFrameMs,
              ...(cur.ui.phasesUs !== undefined ? { phasesUs: [...cur.ui.phasesUs] } : {}),
            },
          }
        : {}),
    });
  }
  return {
    capturedAt: capture.capturedAt,
    port: capture.port,
    intervalMs: capture.intervalMs,
    sampleCount: samples.length,
    points,
    events: capture.events ?? [],
  };
}

/** The webview page: canvas timeline driven by postMessage (initial payload
 *  baked in; live updates pushed by the extension's file watcher). */
export function viewerHtml(initial: TimelineData | { error: string }): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  body { font: 13px/1.4 var(--vscode-font-family, system-ui), sans-serif; margin: 12px;
         background: var(--vscode-editor-background, #111); color: var(--vscode-editor-foreground, #ddd); }
  h1 { font-size: 13px; margin: 0 0 8px; font-weight: 600; }
  #meta { color: var(--vscode-descriptionForeground, #888); margin-bottom: 10px; }
  canvas { width: 100%; height: auto; background: var(--vscode-editorWidget-background, #181818);
           border: 1px solid var(--vscode-widget-border, #333); }
</style></head><body>
<h1>typecad-hal trace</h1>
<div id="meta">waiting for data…</div>
<canvas id="c" width="1200" height="560"></canvas>
<script>
const vscode = acquireVsCodeApi();
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const meta = document.getElementById('meta');
let d = ${JSON.stringify(initial)};

function refresh() { draw(d); }
window.addEventListener('message', (e) => {
  d = e.data;
  refresh();
});

function draw(d) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (d.error) { meta.textContent = d.error; return; }
  const pts = d.points;
  meta.textContent = d.sampleCount + ' samples · port ' + d.port +
    (d.intervalMs ? ' · interval ' + d.intervalMs + ' ms' : '') +
    ' · ' + d.events.length + ' events';
  if (pts.length === 0) {
    ctx.fillStyle = '#666';
    ctx.fillText('waiting for ≥ 2 heartbeats…', 20, 30);
    return;
  }
  const names = [...new Set(pts.flatMap(p => Object.keys(p.cpu)))].sort();
  const idleName = names.find(n => n === 'idle') ?? null;
  const lanes = names.filter(n => n !== idleName).concat(idleName ? [idleName] : []);
  const hasUi = pts.some(p => p.ui);
  const top = 28, laneH = Math.max(18, Math.min(64, Math.floor((H - top - 90) / lanes.length)));
  const t0 = pts[0].tMs, t1 = Math.max(pts[pts.length - 1].tMs, t0 + 1);
  const x = t => 60 + (t - t0) / (t1 - t0) * (W - 90);
  const step = Math.max(2, (W - 90) / pts.length * 0.8);
  ctx.font = '12px system-ui';
  lanes.forEach((name, li) => {
    const yBase = top + li * laneH + laneH - 4;
    ctx.fillStyle = '#777'; ctx.textAlign = 'right';
    ctx.fillText(name, 54, yBase - laneH / 2 + 4);
    ctx.strokeStyle = '#2a2a2a'; ctx.beginPath();
    ctx.moveTo(60, yBase); ctx.lineTo(W - 30, yBase); ctx.stroke();
    ctx.fillStyle = name === 'idle' ? '#4a5a4a' : '#3a6ea5';
    pts.forEach(p => {
      const v = p.cpu[name];
      if (v === undefined || v <= 0) return;
      const h = Math.min(laneH - 8, v / 100 * (laneH - 8));
      ctx.fillRect(x(p.tMs) - step / 2, yBase - h, step, h);
    });
  });
  if (hasUi) {
    const yUi = top + lanes.length * laneH + 22;
    ctx.fillStyle = '#c9a227'; ctx.textAlign = 'left';
    ctx.fillText('UI frame ms (max) + tick phases', 60, yUi - 6);
    let maxV = 0; pts.forEach(p => { if (p.ui) maxV = Math.max(maxV, p.ui.maxFrameMs); });
    maxV = Math.max(maxV, 1);
    ctx.strokeStyle = '#c9a227'; ctx.beginPath(); let started = false;
    pts.forEach(p => {
      if (!p.ui) { started = false; return; }
      const y = yUi + 60 - (p.ui.maxFrameMs / maxV) * 56;
      if (!started) { ctx.moveTo(x(p.tMs), y); started = true; } else ctx.lineTo(x(p.tMs), y);
    });
    ctx.stroke();
    const phaseColors = ['#7a5ca8', '#5c8aa8', '#a85c6e', '#6ea85c', '#a89a5c'];
    const yPh = yUi + 66;
    pts.forEach(p => {
      if (!p.ui || !p.ui.phasesUs) return;
      const total = p.ui.phasesUs.reduce((a, b) => a + b, 0);
      if (total <= 0) return;
      let fx = x(p.tMs) - step / 2;
      p.ui.phasesUs.forEach((v, i) => {
        const w = (v / total) * step;
        ctx.fillStyle = phaseColors[i] ?? '#888';
        ctx.fillRect(fx, yPh, w, 8);
        fx += w;
      });
    });
    ctx.fillStyle = '#888'; ctx.textAlign = 'left'; ctx.font = '10px system-ui';
    ctx.fillText('bindings · transitions · draw · scroll · flush', 60, yPh + 20);
    ctx.font = '12px system-ui';
  }
  const yEv = H - 26;
  ctx.textAlign = 'left'; ctx.fillStyle = '#a55';
  ctx.fillText('events', 60, yEv + 10);
  d.events.forEach(ev => {
    if (ev.tMs < t0 || ev.tMs > t1) return;
    ctx.strokeStyle = '#a55';
    ctx.beginPath(); ctx.moveTo(x(ev.tMs), top); ctx.lineTo(x(ev.tMs), yEv); ctx.stroke();
  });
  ctx.fillStyle = '#888'; ctx.textAlign = 'left';
  ctx.fillText((t0 / 1000).toFixed(0) + ' s', 60, H - 6);
  ctx.textAlign = 'right'; ctx.fillText((t1 / 1000).toFixed(0) + ' s', W - 30, H - 6);
}
refresh();
</script></body></html>
`;
}
