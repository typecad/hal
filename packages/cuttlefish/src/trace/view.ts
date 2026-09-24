// ---------------------------------------------------------------------------
// trace view — a local HTTP viewer over a capture artifact
//
// Serves a dependency-free canvas page that polls /trace/data: per-thread
// CPU lanes (one bar per heartbeat interval), the UI frame-time line, and
// Trace.mark/event markers. Live viewing works by running `trace capture`
// with its --output pointed at the same file — capture rewrites the
// artifact after every closed heartbeat.
// ---------------------------------------------------------------------------

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readTraceCapture, buildTimeline } from './report.js';

export interface ViewOptions {
  input: string;
  httpPort: number;
}

export function runTraceViewServer(options: ViewOptions): void {
  const input = path.resolve(process.cwd(), options.input);
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(viewerPage());
      return;
    }
    if (url === '/trace/data') {
      if (!existsSync(input)) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: `no capture at ${path.basename(input)} yet` }));
        return;
      }
      try {
        const capture = readTraceCapture(input);
        const { points, events } = buildTimeline(capture);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          capturedAt: capture.capturedAt,
          port: capture.port,
          intervalMs: capture.intervalMs,
          sampleCount: capture.samples.length,
          points,
          events,
        }));
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  server.listen(options.httpPort, () => {
    console.log(`Trace viewer: http://127.0.0.1:${options.httpPort} (data: ${input})`);
    console.log('Run `typecad-hal trace capture --output <same file>` in another terminal for live updates. Ctrl+C to stop.');
  });
}

function viewerPage(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>typecad-hal trace</title>
<style>
  body { font: 13px/1.4 system-ui, sans-serif; margin: 16px; background: #111; color: #ddd; }
  h1 { font-size: 15px; margin: 0 0 8px; }
  #meta { color: #888; margin-bottom: 10px; }
  canvas { width: 100%; height: auto; background: #181818; border: 1px solid #333; }
</style></head><body>
<h1>typecad-hal trace viewer</h1>
<div id="meta">waiting for data…</div>
<canvas id="c" width="1200" height="560"></canvas>
<script>
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const meta = document.getElementById('meta');

async function refresh() {
  let d;
  try {
    const r = await fetch('/trace/data');
    if (!r.ok) { meta.textContent = (await r.json()).error; return; }
    d = await r.json();
  } catch (e) { meta.textContent = String(e); return; }
  meta.textContent = d.sampleCount + ' samples · port ' + d.port +
    (d.intervalMs ? ' · interval ' + d.intervalMs + ' ms' : '') +
    ' · ' + d.events.length + ' events';
  draw(d);
}

function draw(d) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const pts = d.points;
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
    // Per-interval tick-phase shares as a thin stacked bar under the frame
    // line (bindings / transitions / draw / scroll / flush).
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
setInterval(refresh, 1500);
</script></body></html>
`;
}
