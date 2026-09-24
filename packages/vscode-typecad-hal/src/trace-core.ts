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
const vscode = acquireVsCodeApi();
let d = ${JSON.stringify(initial)};
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
    ctx.fillText('waiting for ≥ 2 heartbeats… (CPU % needs a PAIR of samples to form a delta — the chart starts on the second heartbeat)', 20, 40);
    return;
  }
  const names = [...new Set(pts.flatMap(p => Object.keys(p.cpu)))].sort();
  const idleName = names.find(n => n === 'idle') ?? null;
  const lanes = names.filter(n => n !== idleName).concat(idleName ? [idleName] : []);
  const hasUi = pts.some(p => p.ui);
  const top = 40, laneH = Math.max(24, Math.min(64, Math.floor((H - top - 140) / lanes.length)));
  const t0 = pts[0].tMs, t1 = Math.max(pts[pts.length - 1].tMs, t0 + 1);
  const x = t => 84 + (t - t0) / (t1 - t0) * (W - 120);
  const step = Math.max(2, (W - 120) / pts.length * 0.8);
  ctx.font = '12px system-ui';
  // Section header + how-to-read line.
  ctx.fillStyle = '#888'; ctx.textAlign = 'left';
  ctx.fillText('CPU load — bar height = thread\'s % of wall time in that interval; lanes sum to ~100% (idle included) · one column = one interval', 84, 24);
  // Per-lane averages (label suffix).
  const avg = {};
  lanes.forEach(n => { let s = 0, c = 0; pts.forEach(p => { if (p.cpu[n] !== undefined) { s += p.cpu[n]; c++; } }); avg[n] = c ? Math.round(s / c) : 0; });
  // Time gridlines (behind everything).
  for (let k = 0; k <= 4; k++) {
    const tx = x(t0 + (t1 - t0) * k / 4);
    ctx.strokeStyle = '#333'; ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.moveTo(tx, top - 6); ctx.lineTo(tx, H - 44); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  lanes.forEach((name, li) => {
    const yTop = top + li * laneH + 2;
    const yBase = top + li * laneH + laneH - 4;
    ctx.fillStyle = name === 'idle' ? '#6a7a6a' : '#aaa'; ctx.textAlign = 'right';
    ctx.fillText(name + ' · ' + avg[name] + '%', 78, yBase - laneH / 2 + 4);
    ctx.strokeStyle = '#2a2a2a'; ctx.beginPath(); ctx.moveTo(84, yBase); ctx.lineTo(W - 30, yBase); ctx.stroke();
    const yMid = yBase - (laneH - 8) / 2;
    ctx.strokeStyle = '#222'; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(84, yMid); ctx.lineTo(W - 30, yMid); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = name === 'idle' ? '#4a5a4a' : '#3a6ea5';
    pts.forEach(p => {
      const v = p.cpu[name];
      if (v === undefined || v <= 0) return;
      const h = Math.min(laneH - 8, v / 100 * (laneH - 8));
      ctx.fillRect(x(p.tMs) - step / 2, yBase - h, step, h);
    });
  });
  // Percent scale, aligned to the first lane (all lanes share the same 0–100% scale).
  ctx.fillStyle = '#666'; ctx.textAlign = 'right'; ctx.font = '10px system-ui';
  ctx.fillText('100%', 78, top + 2 + 3);
  ctx.fillText('50%', 78, top + 2 + (laneH - 8) / 2 + 3);
  ctx.fillText('0%', 78, top + laneH - 4 + 3);
  ctx.font = '12px system-ui';
  if (hasUi) {
    const yUi = top + lanes.length * laneH + 26;
    const yZero = yUi + 60;
    ctx.fillStyle = '#c9a227'; ctx.textAlign = 'left';
    ctx.fillText('UI frame time — line = WORST frame in the interval; stacked bars = where the tick time went', 84, yUi - 8);
    let maxV = 0; pts.forEach(p => { if (p.ui) maxV = Math.max(maxV, p.ui.maxFrameMs); });
    maxV = Math.max(maxV, 1);
    ctx.fillStyle = '#666'; ctx.textAlign = 'right'; ctx.font = '10px system-ui';
    ctx.fillText(maxV.toFixed(0) + ' ms', 78, yUi + 4);
    ctx.fillText('0', 78, yZero + 3);
    ctx.font = '12px system-ui';
    ctx.strokeStyle = '#c9a227'; ctx.beginPath(); let started = false;
    pts.forEach(p => {
      if (!p.ui) { started = false; return; }
      const y = yZero - (p.ui.maxFrameMs / maxV) * 56;
      if (!started) { ctx.moveTo(x(p.tMs), y); started = true; } else ctx.lineTo(x(p.tMs), y);
    });
    ctx.stroke();
    const phaseColors = ['#7a5ca8', '#5c8aa8', '#a85c6e', '#6ea85c', '#a89a5c'];
    const phaseLabels = ['bindings', 'transitions', 'draw', 'scroll', 'flush'];
    const phaseTotals = [0, 0, 0, 0, 0]; let phaseSum = 0;
    pts.forEach(p => { if (p.ui && p.ui.phasesUs) p.ui.phasesUs.forEach((v, i) => { phaseTotals[i] += v; phaseSum += v; }); });
    const yPh = yUi + 68;
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
    // Legend: color swatch + name + this capture's total share per phase.
    let lx = 84;
    phaseColors.forEach((c, i) => {
      const share = phaseSum > 0 ? Math.round(phaseTotals[i] / phaseSum * 100) : 0;
      const text = phaseLabels[i] + ' ' + share + '%';
      ctx.fillStyle = c; ctx.fillRect(lx, yPh + 14, 9, 9);
      ctx.fillStyle = '#888'; ctx.textAlign = 'left';
      ctx.fillText(text, lx + 13, yPh + 22);
      lx += 13 + ctx.measureText(text).width + 14;
    });
  }
  const yEv = H - 34;
  ctx.textAlign = 'left'; ctx.fillStyle = '#a55';
  ctx.fillText('events (' + d.events.length + ') — one tick per Trace.mark / Trace.event call', 84, yEv + 10);
  d.events.forEach(ev => {
    if (ev.tMs < t0 || ev.tMs > t1) return;
    ctx.strokeStyle = '#a55';
    ctx.beginPath(); ctx.moveTo(x(ev.tMs), top); ctx.lineTo(x(ev.tMs), yEv); ctx.stroke();
  });
  ctx.fillStyle = '#888';
  for (let k = 0; k <= 4; k++) {
    const t = t0 + (t1 - t0) * k / 4;
    ctx.textAlign = k === 0 ? 'left' : k === 4 ? 'right' : 'center';
    ctx.fillText((t / 1000).toFixed(0) + ' s', x(t), H - 8);
  }
}
window.addEventListener('message', (e) => { d = e.data; draw(d); });
draw(d);

</script></body></html>
`;
}
