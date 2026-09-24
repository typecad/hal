// ---------------------------------------------------------------------------
// Trace report — CPU-load and stack aggregates over a capture
//
// CPU% is computed per consecutive-sample interval as
//   delta(thread.execCycles) / delta(sysExecCycles)
// (the sys counter includes idle, so idle appears as its own row and the
// column sums to ~100%). Stack headroom is the minimum unused-bytes seen —
// the high-water mark — which is exactly the number `query memory`'s static
// stack estimate should be checked against.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import type { TraceCapture, TraceSample } from './types.js';

export interface ThreadReport {
  name: string;
  /** Mean CPU share over the capture (%), null with no usable interval. */
  cpuAvgPct: number | null;
  /** Highest single-interval CPU share (%). */
  cpuMaxPct: number | null;
  /** Stack size in bytes (largest seen; 0 = unknown on the wire). */
  stackSizeBytes: number;
  /** Minimum unused stack bytes seen (the high-water mark); null = unknown. */
  stackMinUnusedBytes: number | null;
  /** Peak stack usage as % of stackSizeBytes; null when either input unknown. */
  stackPeakUsedPct: number | null;
}

export interface TraceReport {
  schema: 'typecad-hal/trace-report@1';
  capture: {
    sampleCount: number;
    /** Wall span covered (last sample tMs - first sample tMs). */
    durationMs: number;
    intervalMs: number | null;
    capturedAt: string;
    port: string;
  };
  threads: ThreadReport[];
  /** UI frame stats (UI-mounted programs only; absent when no [TR:UI lines). */
  ui?: {
    intervals: number;
    framesTotal: number;
    /** Overall average frame time in ms (1 decimal, fixed-point source). */
    avgFrameMs: number;
    /** Worst single frame in the capture (ms). */
    maxFrameMs: number;
    /** Per-phase ui_tick breakdown (present when [TR:UP lines were seen). */
    phases?: UiPhaseReport[];
  };
  /** Trace.mark / Trace.event summary — count + last value per name. */
  events?: EventReport[];
}

/** One ui_tick phase's share of tick time across the capture. */
export interface UiPhaseReport {
  /** Phase label (bindings / transitions / draw / scroll / flush). */
  label: string;
  /** Total µs spent in this phase over the capture. */
  totalUs: number;
  /** Share of all ui_tick phase time (%). */
  sharePct: number;
}

export interface EventReport {
  name: string;
  count: number;
  /** Last value seen (Trace.event only). */
  lastValue?: number;
  lastTMs: number;
}

interface ThreadAccumulator {
  name: string;
  intervals: number;
  cpuSum: number;
  cpuMax: number;
  stackSizeBytes: number;
  stackMinUnusedBytes: number | null;
}

/** Build the report from a capture artifact. */
export function buildTraceReport(capture: TraceCapture): TraceReport {
  const acc = new Map<string, ThreadAccumulator>();
  const touch = (name: string): ThreadAccumulator => {
    let a = acc.get(name);
    if (a === undefined) {
      a = {
        name,
        intervals: 0,
        cpuSum: 0,
        cpuMax: 0,
        stackSizeBytes: 0,
        stackMinUnusedBytes: null,
      };
      acc.set(name, a);
    }
    return a;
  };

  const samples = capture.samples;

  // Pre-pass — stack high-water from EVERY sighting (a single-sample capture
  // still gets stack rows; null readings never lower the known minimum).
  for (const s of samples) {
    for (const t of s.threads) {
      const a = touch(t.name);
      if (t.stackUnusedBytes !== null) {
        a.stackMinUnusedBytes = a.stackMinUnusedBytes === null
          ? t.stackUnusedBytes
          : Math.min(a.stackMinUnusedBytes, t.stackUnusedBytes);
      }
      if (t.stackSizeBytes > a.stackSizeBytes) a.stackSizeBytes = t.stackSizeBytes;
    }
  }

  // CPU intervals — consecutive sample pairs. Both samples must show the
  // thread and the sys counter must have advanced; a restarted thread
  // (counter reset) is skipped.
  for (let i = 1; i < samples.length; i++) {
    const prev: TraceSample = samples[i - 1];
    const cur: TraceSample = samples[i];
    const dSys = cur.sysExecCycles - prev.sysExecCycles;
    if (dSys <= 0) continue;
    const prevThreads = new Map(prev.threads.map((t) => [t.name, t.execCycles]));
    for (const t of cur.threads) {
      const prevExec = prevThreads.get(t.name);
      if (prevExec === undefined) continue;
      const dExec = t.execCycles - prevExec;
      if (dExec < 0) continue;
      const a = touch(t.name);
      const cpu = dExec / dSys;
      a.intervals++;
      a.cpuSum += cpu;
      if (cpu > a.cpuMax) a.cpuMax = cpu;
    }
  }

  const threads: ThreadReport[] = [...acc.values()].map((a) => ({
    name: a.name,
    cpuAvgPct: a.intervals > 0 ? round1(a.cpuSum / a.intervals * 100) : null,
    cpuMaxPct: a.intervals > 0 ? round1(a.cpuMax * 100) : null,
    stackSizeBytes: a.stackSizeBytes,
    stackMinUnusedBytes: a.stackMinUnusedBytes,
    stackPeakUsedPct: a.stackMinUnusedBytes !== null && a.stackSizeBytes > 0
      ? round1((1 - a.stackMinUnusedBytes / a.stackSizeBytes) * 100)
      : null,
  }));
  // Busiest thread first; ties (and no-interval captures) fall back to name
  // order so the table is stable across runs.
  threads.sort((x, y) => (y.cpuAvgPct ?? -1) - (x.cpuAvgPct ?? -1) || x.name.localeCompare(y.name));

  return {
    schema: 'typecad-hal/trace-report@1',
    capture: {
      sampleCount: samples.length,
      durationMs: samples.length >= 2 ? samples[samples.length - 1].tMs - samples[0].tMs : 0,
      intervalMs: capture.intervalMs,
      capturedAt: capture.capturedAt,
      port: capture.port,
    },
    threads,
    ...buildUiSummary(samples),
    ...(capture.events && capture.events.length > 0 ? { events: buildEventSummary(capture.events) } : {}),
  };
}

function buildUiSummary(samples: TraceSample[]): { ui: NonNullable<TraceReport['ui']> } | Record<string, never> {
  let intervals = 0;
  let framesTotal = 0;
  let totalMsX10 = 0;
  let maxFrameMs = 0;
  let phaseIntervals = 0;
  const phaseTotals = [0, 0, 0, 0, 0];
  const PHASE_LABELS = ['bindings', 'transitions', 'draw', 'scroll', 'flush'];
  for (const s of samples) {
    if (s.ui === undefined) continue;
    intervals++;
    framesTotal += s.ui.frameCount;
    totalMsX10 += s.ui.frameCount * s.ui.avgFrameMsX10;
    if (s.ui.maxFrameMs > maxFrameMs) maxFrameMs = s.ui.maxFrameMs;
    if (s.ui.phasesUs !== undefined) {
      phaseIntervals++;
      for (let i = 0; i < 5; i++) phaseTotals[i] += s.ui.phasesUs[i];
    }
  }
  if (intervals === 0) return {};
  const phaseSum = phaseTotals.reduce((a, b) => a + b, 0);
  return {
    ui: {
      intervals,
      framesTotal,
      avgFrameMs: framesTotal > 0 ? round1(totalMsX10 / 10 / framesTotal) : 0,
      maxFrameMs,
      ...(phaseIntervals > 0 && phaseSum > 0
        ? {
            phases: phaseTotals.map((totalUs, i) => ({
              label: PHASE_LABELS[i],
              totalUs,
              sharePct: round1((totalUs / phaseSum) * 100),
            })),
          }
        : {}),
    },
  };
}

function buildEventSummary(events: NonNullable<TraceCapture['events']>): EventReport[] {
  const byName = new Map<string, EventReport>();
  for (const ev of events) {
    let row = byName.get(ev.name);
    if (row === undefined) {
      row = { name: ev.name, count: 0, lastTMs: ev.tMs };
      byName.set(ev.name, row);
    }
    row.count++;
    row.lastTMs = ev.tMs;
    if (ev.value !== undefined) row.lastValue = ev.value;
  }
  return [...byName.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Per-sample timeline series for the viewer: CPU% per thread per interval
 *  (delta-based, same math as buildTraceReport) + UI frame times + events. */
export interface TimelinePoint {
  tMs: number;
  /** CPU % keyed by thread name for this interval. */
  cpu: Record<string, number>;
  ui?: { avgFrameMs: number; maxFrameMs: number; phasesUs?: number[] };
}

export function buildTimeline(capture: TraceCapture): { points: TimelinePoint[]; events: NonNullable<TraceCapture['events']> } {
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
        cpu[t.name] = round1((dExec / dSys) * 100);
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
  return { points, events: capture.events ?? [] };
}

/** Read + shape-check a capture artifact file. Throws with context on a
 *  non-trace@1 file (the capture path's schema string is the contract). */
export function readTraceCapture(filePath: string): TraceCapture {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read trace capture ${filePath}: ${(err as Error).message}`);
  }
  const capture = raw as Partial<TraceCapture>;
  if (capture.schema !== 'typecad-hal/trace@1' || !Array.isArray(capture.samples)) {
    throw new Error(`${filePath} is not a typecad-hal/trace@1 capture (got schema: ${String(capture.schema)})`);
  }
  return capture as TraceCapture;
}

/** Human-readable report (the console table `trace report` prints). */
export function formatTraceReport(report: TraceReport): string {
  const c = report.capture;
  const lines: string[] = [];
  lines.push(`Trace report — ${c.sampleCount} samples over ${(c.durationMs / 1000).toFixed(1)}s (port ${c.port})`);
  if (c.sampleCount < 2) {
    lines.push('Not enough samples for CPU percentages (need ≥ 2 heartbeats).');
  }
  if (report.ui !== undefined) {
    lines.push(`UI frames: ${report.ui.framesTotal} frames, avg ${report.ui.avgFrameMs} ms, worst ${report.ui.maxFrameMs} ms`);
    if (report.ui.phases !== undefined) {
      lines.push(`UI tick phases: ${report.ui.phases.map((p) => `${p.label} ${p.sharePct}% (${fmtUs(p.totalUs)})`).join(' · ')}`);
    }
  }
  if (report.events !== undefined && report.events.length > 0) {
    lines.push(`Events: ${report.events.map((e) => `${e.name}×${e.count}${e.lastValue !== undefined ? ` (last ${e.lastValue})` : ''}`).join(', ')}`);
  }
  const nameW = Math.max(8, ...report.threads.map((t) => t.name.length + 2));
  const fmt = (v: number | null, suffix = ''): string => (v === null ? '  —  ' : v.toFixed(1) + suffix);
  lines.push('');
  lines.push(`${'Thread'.padEnd(nameW)}  ${'CPU avg'.padStart(7)}  ${'CPU max'.padStart(7)}  ${'Stack peak'.padStart(10)}  ${'Stack size'.padStart(10)}  ${'Headroom'.padStart(8)}`);
  for (const t of report.threads) {
    const peak = t.stackMinUnusedBytes === null ? '—' : `${t.stackSizeBytes - t.stackMinUnusedBytes} B`;
    const size = t.stackSizeBytes > 0 ? `${t.stackSizeBytes} B` : '—';
    const headroom = t.stackMinUnusedBytes === null || t.stackSizeBytes === 0
      ? '—'
      : `${t.stackMinUnusedBytes} B`;
    lines.push(
      `${t.name.padEnd(nameW)}  ${fmt(t.cpuAvgPct, '%').padStart(7)}  ${fmt(t.cpuMaxPct, '%').padStart(7)}  ${peak.padStart(10)}  ${size.padStart(10)}  ${headroom.padStart(8)}`,
    );
  }
  return lines.join('\n');
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function fmtUs(us: number): string {
  return us >= 10000 ? `${(us / 1000).toFixed(1)} ms` : `${Math.round(us)} µs`;
}

// ---------------------------------------------------------------------------
// CI gates — `trace report --gate <metric><=|>=><limit>` (repeatable).
//
// The audit --strict pattern applied to runtime evidence: a capture becomes
// a regression gate. cpu-* compare the report's avg/max CPU % of a thread;
// frame-max the worst UI frame in ms; stack-min the high-water headroom in
// bytes (a MINIMUM bound — "<= n" would always pass and is rejected).
// ---------------------------------------------------------------------------

const GATE_RE = /^(cpu-avg|cpu-max|frame-max|stack-min)(?::([A-Za-z0-9_.-]+))?(<=|>=)([0-9]+(?:\.[0-9]+)?)$/;

/** Evaluate gates against a report. Throws on a malformed gate expression. */
export function evaluateGates(report: TraceReport, gates: readonly string[]): { pass: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const gate of gates) {
    const m = GATE_RE.exec(gate);
    if (m === null) {
      throw new Error(
        `Malformed gate '${gate}'. Form: --gate cpu-avg:main<=50 | cpu-max:idle>=95 | frame-max<=20 | stack-min:main>=256.`,
      );
    }
    const [, metric, thread, op, limitRaw] = m;
    const limit = Number(limitRaw);

    let actual: number | null = null;
    let describe = '';
    if (metric === 'cpu-avg' || metric === 'cpu-max' || metric === 'stack-min') {
      const row = report.threads.find((t) => t.name === thread);
      if (row !== undefined) {
        if (metric === 'cpu-avg') actual = row.cpuAvgPct;
        else if (metric === 'cpu-max') actual = row.cpuMaxPct;
        else actual = row.stackMinUnusedBytes;
      }
      describe = `${metric}:${thread}`;
    } else if (metric === 'frame-max') {
      actual = report.ui?.maxFrameMs ?? null;
      describe = 'frame-max';
    }

    if (actual === null || actual === undefined) {
      violations.push(`${describe}: no data (thread/metric absent from this capture) — gate '${gate}' cannot pass`);
      continue;
    }
    if (metric === 'stack-min' && op === '<=') {
      throw new Error(`Gate '${gate}': stack-min is a minimum bound — use stack-min:<thread>>=<bytes>.`);
    }
    const ok = op === '<=' ? actual <= limit : actual >= limit;
    if (!ok) {
      violations.push(`${describe}: ${actual} violates '${gate}'`);
    }
  }
  return { pass: violations.length === 0, violations };
}
