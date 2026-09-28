"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.readCapture = readCapture;
exports.buildTimelineData = buildTimelineData;
exports.viewerHtml = viewerHtml;
/** Parse + shape-check a capture file's text. Undefined on anything that is
 *  not a trace@1 capture (missing file, partial write, other JSON). */
function readCapture(text) {
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch {
        return undefined;
    }
    const c = raw;
    if (c.schema !== 'typecad-hal/trace@1' || !Array.isArray(c.samples))
        return undefined;
    return c;
}
/** Per-interval series for the viewer (same math as the CLI report). */
function buildTimelineData(capture) {
    const points = [];
    const samples = capture.samples;
    for (let i = 1; i < samples.length; i++) {
        const prev = samples[i - 1];
        const cur = samples[i];
        const dSys = cur.sysExecCycles - prev.sysExecCycles;
        const cpu = {};
        if (dSys > 0) {
            const prevThreads = new Map(prev.threads.map((t) => [t.name, t.execCycles]));
            for (const t of cur.threads) {
                const prevExec = prevThreads.get(t.name);
                if (prevExec === undefined)
                    continue;
                const dExec = t.execCycles - prevExec;
                if (dExec < 0)
                    continue;
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
    const avgAcc = new Map();
    const avgCpu = {};
    for (const p of points) {
        for (const [name, v] of Object.entries(p.cpu)) {
            const a = avgAcc.get(name) ?? { sum: 0, n: 0 };
            a.sum += v;
            a.n += 1;
            avgAcc.set(name, a);
        }
    }
    for (const [name, a] of avgAcc)
        avgCpu[name] = a.n > 0 ? Math.round(a.sum / a.n) : 0;
    return {
        capturedAt: capture.capturedAt,
        port: capture.port,
        intervalMs: capture.intervalMs,
        summary: {
            tMin: samples.length > 0 ? samples[0].tMs : 0,
            tMax: samples.length > 0 ? samples[samples.length - 1].tMs : 0,
            sampleCount: samples.length,
            avgCpu,
            eventCount: capture.events?.length ?? 0,
            alarmCount: capture.alarms?.length ?? 0,
            sessions: samples.reduce((m, s) => Math.max(m, s.session ?? 0), 0) + (samples.length > 0 ? 1 : 0),
        },
        points,
        // Alarms ride the events axis — same timeline, louder (red) tick.
        events: [
            ...(capture.events ?? []),
            ...(capture.alarms ?? []).map((a) => ({ tMs: a.tMs, name: `${a.code}:${a.detail}`, alarm: true })),
        ],
    };
}
/** The webview page: canvas timeline driven by postMessage (initial payload
 *  baked in; live updates pushed by the extension's file watcher). */
function viewerHtml(initial) {
    return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  body { font: 13px/1.4 var(--vscode-font-family, system-ui), sans-serif; margin: 12px;
         background: var(--vscode-editor-background, #111); color: var(--vscode-editor-foreground, #ddd); }
  h1 { font-size: 13px; margin: 0 0 8px; font-weight: 600; }
  #meta { color: var(--vscode-descriptionForeground, #888); margin-bottom: 10px; }
  canvas { width: 100%; height: auto; background: var(--vscode-editorWidget-background, #181818);
           border: 1px solid var(--vscode-widget-border, #333); }
  #scrubrow { margin-top: 8px; }
  #scrub { width: 100%; accent-color: var(--vscode-focusBorder, #3a6ea5); }
  #scrublabel { color: var(--vscode-descriptionForeground, #888); font-size: 11px; margin-top: 2px; }
</style></head><body>
<h1>typeCAD/hal trace</h1>
<div id="meta">waiting for data…</div>
<canvas id="c" width="1200" height="560"></canvas>
<div id="scrubrow" style="display:none;">
  <input id="scrub" type="range" min="0" max="0" step="250" value="0">
  <div id="scrublabel"></div>
</div>
<script>
const vscode = acquireVsCodeApi();

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const meta = document.getElementById('meta');
const scrubRow = document.getElementById('scrubrow');
const scrub = document.getElementById('scrub');
const scrubLabel = document.getElementById('scrublabel');
// Rolling window: once the capture outgrows WINDOW_MS the chart shows a
// fixed-width window — the column width settles instead of shrinking forever
// as the capture grows — and the slider pans the window back through history.
// At the slider's right end the view snaps back to live-following. The CLI
// page (view.ts) defaults to the same 60s and also takes ?window=<seconds>.
const WINDOW_MS = 60000;
let follow = true;
scrub.addEventListener('input', () => {
  follow = Number(scrub.value) >= Number(scrub.max) - 250;
  draw(d);
});
let d = ${JSON.stringify(initial)};
function draw(d) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (d.error) { meta.textContent = d.error; scrubRow.style.display = 'none'; return; }
  const pts = d.points;
  const sum = d.summary;
  const totalEvents = sum ? sum.eventCount + sum.alarmCount : d.events.length;
  meta.textContent = (sum ? sum.sampleCount : pts.length + 1) + ' samples · port ' + d.port +
    (d.intervalMs ? ' · interval ' + d.intervalMs + ' ms' : '') +
    ' · ' + totalEvents + ' events' +
    (sum && sum.alarmCount > 0 ? ' · ' + sum.alarmCount + ' ALARMS' : '') +
    (sum && sum.sessions > 1 ? ' · ' + sum.sessions + ' sessions (device rebooted)' : '');
  if (pts.length === 0) {
    ctx.fillStyle = '#666';
    ctx.fillText('waiting for ≥ 2 heartbeats… (CPU % needs a PAIR of samples to form a delta — the chart starts on the second heartbeat)', 20, 40);
    scrubRow.style.display = 'none';
    return;
  }
  const names = [...new Set(pts.flatMap(p => Object.keys(p.cpu)))].sort();
  const idleName = names.find(n => n === 'idle') ?? null;
  const lanes = names.filter(n => n !== idleName).concat(idleName ? [idleName] : []);
  const hasUi = pts.some(p => p.ui);
  // No UI chart → the lanes take the vertical space it would have occupied
  // (taller bars) instead of leaving a blank band above the events row.
  const top = 40, laneH = Math.max(24, Math.min(hasUi ? 64 : 120, Math.floor((H - top - (hasUi ? 140 : 70)) / lanes.length)));
  // View window: the whole capture until it outgrows WINDOW_MS, then a fixed
  // span — the column width settles instead of shrinking forever. The scrub
  // slider pans the window; at its right end the view keeps following live.
  // Bounds prefer the whole-capture summary (points arrive whole here, but
  // the summary is the contract shared with the CLI page).
  const tMin = sum ? sum.tMin : pts[0].tMs;
  const tMax = sum ? Math.max(sum.tMax, tMin + 1) : Math.max(pts[pts.length - 1].tMs, tMin + 1);
  const windowed = tMax - tMin > WINDOW_MS;
  let t0, t1;
  if (!windowed) {
    follow = true;
    scrubRow.style.display = 'none';
    t0 = tMin; t1 = tMax;
  } else {
    scrubRow.style.display = '';
    scrub.min = tMin; scrub.max = tMax - WINDOW_MS; scrub.step = 250;
    if (follow) scrub.value = String(tMax - WINDOW_MS);
    let v = Number(scrub.value);
    if (!Number.isFinite(v)) v = tMax - WINDOW_MS;
    t0 = Math.min(Math.max(v, tMin), tMax - WINDOW_MS);
    t1 = t0 + WINDOW_MS;
    const fmt = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
    scrubLabel.textContent = (follow ? 'live — most recent ' + Math.round(WINDOW_MS / 1000) + 's'
      : 'paused — ' + fmt(t0 - tMin) + ' to ' + fmt(t1 - tMin)) + ' of ' + fmt(tMax - tMin) + ' captured';
  }
  const inView = windowed ? pts.filter(p => p.tMs >= t0 && p.tMs <= t1) : pts;
  const x = t => 84 + (t - t0) / (t1 - t0) * (W - 120);
  const step = Math.max(2, (W - 120) / (inView.length || 1) * 0.8);
  ctx.font = '12px system-ui';
  // Section header + how-to-read line.
  ctx.fillStyle = '#888'; ctx.textAlign = 'left';
  ctx.fillText('CPU load — bar height = the thread share of wall time in that interval; lanes sum to ~100% (idle included) · one column = one interval'
    + (windowed ? ' · drag the slider below to look back' : ''), 84, 24);
  // Per-lane averages (label suffix) — the whole-capture numbers from the
  // summary when present, computed from the points otherwise.
  const avg = {};
  lanes.forEach(n => {
    if (sum && sum.avgCpu && sum.avgCpu[n] !== undefined) { avg[n] = sum.avgCpu[n]; return; }
    let s = 0, c = 0; pts.forEach(p => { if (p.cpu[n] !== undefined) { s += p.cpu[n]; c++; } });
    avg[n] = c ? Math.round(s / c) : 0;
  });
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
    inView.forEach(p => {
      const v = p.cpu[name];
      if (v === undefined || v <= 0) return;
      const h = Math.min(laneH - 8, v / 100 * (laneH - 8));
      // Columns are centered on the sample tick, so the first/last would
      // cross the plot borders (very visible when few samples make the
      // columns wide) — clamp each rect to [84, W-30].
      const bx = Math.max(84, x(p.tMs) - step / 2);
      const bw = Math.min(step, W - 30 - bx);
      if (bw > 0) ctx.fillRect(bx, yBase - h, bw, h);
    });
  });
  // Percent scale on the RIGHT margin (the plot ends at W-30; the strip
  // lives in the empty 30px beyond it), aligned to the first lane — the
  // left column belongs to the lane name labels and must not collide.
  ctx.fillStyle = '#666'; ctx.textAlign = 'right'; ctx.font = '10px system-ui';
  ctx.fillText('100%', W - 6, top + 5);
  ctx.fillText('50%', W - 6, top + 2 + (laneH - 8) / 2 + 3);
  ctx.fillText('0%', W - 6, top + laneH - 1);
  ctx.font = '12px system-ui';
  if (hasUi) {
    const yUi = top + lanes.length * laneH + 26;
    const yZero = yUi + 60;
    ctx.fillStyle = '#c9a227'; ctx.textAlign = 'left';
    ctx.fillText('UI frame time — line = WORST frame in the interval; stacked bars = where the tick time went', 84, yUi - 8);
    let maxV = 0; inView.forEach(p => { if (p.ui) maxV = Math.max(maxV, p.ui.maxFrameMs); });
    maxV = Math.max(maxV, 1);
    ctx.fillStyle = '#666'; ctx.textAlign = 'right'; ctx.font = '10px system-ui';
    ctx.fillText(maxV.toFixed(0) + ' ms', 78, yUi + 4);
    ctx.fillText('0', 78, yZero + 3);
    ctx.font = '12px system-ui';
    ctx.strokeStyle = '#c9a227'; ctx.beginPath(); let started = false;
    inView.forEach(p => {
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
    inView.forEach(p => {
      if (!p.ui || !p.ui.phasesUs) return;
      const total = p.ui.phasesUs.reduce((a, b) => a + b, 0);
      if (total <= 0) return;
      let fx = Math.max(84, x(p.tMs) - step / 2);
      const avail = Math.max(0, Math.min(step, W - 30 - fx));
      p.ui.phasesUs.forEach((v, i) => {
        const w = (v / total) * avail;
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
  const evShown = d.events.filter(ev => ev.tMs >= t0 && ev.tMs <= t1);
  ctx.fillText('events (' + evShown.length + (evShown.length < totalEvents ? ' of ' + totalEvents : '')
    + ') — one tick per Trace.mark / Trace.event call · on-device ALARMS tick red', 84, yEv + 10);
  evShown.forEach(ev => {
    ctx.strokeStyle = ev.alarm ? '#f66' : '#a55';
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
//# sourceMappingURL=trace-core.js.map