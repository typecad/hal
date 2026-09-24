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

import { readFileSync, writeFileSync } from 'node:fs';
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
    /** Sessions in the capture (>1 = the device rebooted mid-capture; the
     *  parser splits them on a repeated CFG or uptime going backwards). */
    sessionCount: number;
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
  /** On-device threshold alarms (zephyr.trace.alarms), deduplicated by
   *  code+detail with first/last seen. */
  alarms?: AlarmReport[];
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

export interface AlarmReport {
  code: string;
  detail: string;
  count: number;
  firstTMs: number;
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
      sessionCount: samples.reduce((m, s) => Math.max(m, s.session ?? 0), 0) + 1,
    },
    threads,
    ...buildUiSummary(samples),
    ...(capture.events && capture.events.length > 0 ? { events: buildEventSummary(capture.events) } : {}),
    ...(capture.alarms && capture.alarms.length > 0 ? { alarms: buildAlarmSummary(capture.alarms) } : {}),
  };
}

function buildAlarmSummary(alarms: NonNullable<TraceCapture['alarms']>): AlarmReport[] {
  const byKey = new Map<string, AlarmReport>();
  for (const a of alarms) {
    const key = `${a.code}:${a.detail}`;
    let row = byKey.get(key);
    if (row === undefined) {
      row = { code: a.code, detail: a.detail, count: 0, firstTMs: a.tMs, lastTMs: a.tMs };
      byKey.set(key, row);
    }
    row.count++;
    row.lastTMs = a.tMs;
  }
  return [...byKey.values()].sort((a, b) => a.firstTMs - b.firstTMs);
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

/** Full-capture aggregates the viewer needs even when only a window of
 *  points travels the wire (the hour-scale path: the page fetches a slice,
 *  the summary keeps the whole-capture context honest). */
export interface TimelineSummary {
  tMin: number;
  tMax: number;
  sampleCount: number;
  /** Whole-capture CPU average per thread (the lane label number). */
  avgCpu: Record<string, number>;
  eventCount: number;
  alarmCount: number;
  sessions: number;
}

/** Per-sample timeline series for the viewer: CPU% per thread per interval
 *  (delta-based, same math as buildTraceReport) + UI frame times + events.
 *  On-device alarms ride the events axis with alarm:true — same timeline,
 *  louder tick. */
export interface TimelinePoint {
  tMs: number;
  /** CPU % keyed by thread name for this interval. */
  cpu: Record<string, number>;
  ui?: { avgFrameMs: number; maxFrameMs: number; phasesUs?: number[] };
}

export function buildTimeline(capture: TraceCapture): {
  points: TimelinePoint[];
  events: Array<NonNullable<TraceCapture['events']>[number] & { alarm?: true }>;
  summary: TimelineSummary;
} {
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
  const events: Array<NonNullable<TraceCapture['events']>[number] & { alarm?: true }> = [
    ...(capture.events ?? []).map((e) => ({ ...e })),
    ...(capture.alarms ?? []).map((a) => ({ tMs: a.tMs, name: `${a.code}:${a.detail}`, alarm: true as const })),
  ];
  const avgCpu: Record<string, number> = {};
  const acc = new Map<string, { sum: number; n: number }>();
  for (const p of points) {
    for (const [name, v] of Object.entries(p.cpu)) {
      const a = acc.get(name) ?? { sum: 0, n: 0 };
      a.sum += v;
      a.n += 1;
      acc.set(name, a);
    }
  }
  for (const [name, a] of acc) avgCpu[name] = a.n > 0 ? Math.round(a.sum / a.n) : 0;
  const summary: TimelineSummary = {
    tMin: samples.length > 0 ? samples[0].tMs : 0,
    tMax: samples.length > 0 ? samples[samples.length - 1].tMs : 0,
    sampleCount: samples.length,
    avgCpu,
    eventCount: capture.events?.length ?? 0,
    alarmCount: capture.alarms?.length ?? 0,
    sessions: samples.reduce((m, s) => Math.max(m, s.session ?? 0), 0) + (samples.length > 0 ? 1 : 0),
  };
  return { points, events, summary };
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
  lines.push(`Trace report — ${c.sampleCount} samples over ${(c.durationMs / 1000).toFixed(1)}s (port ${c.port})`
    + (c.sessionCount > 1 ? ` — ${c.sessionCount} sessions (the device rebooted mid-capture)` : ''));
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
  if (report.alarms !== undefined && report.alarms.length > 0) {
    lines.push(`Alarms (on-device thresholds): ${report.alarms.map((a) => `${a.code}[${a.detail}]×${a.count}`).join(', ')}`);
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

/** One heartbeat interval, ranked for `trace report --worst` — the "which
 *  interval spiked, and where" view over an existing capture. */
export interface WorstInterval {
  fromTMs: number;
  toTMs: number;
  /** Per-thread CPU % for this interval. */
  cpu: Record<string, number>;
  /** Present for UI programs. */
  maxFrameMs?: number;
  phasesUs?: number[];
  /** The sort key actually used (worst frame ms, or the top thread CPU %). */
  rankMs?: number;
  rankCpuPct?: number;
}

/** Top-N intervals by worst UI frame (UI captures) or top thread CPU. */
export function buildWorstIntervals(capture: TraceCapture, n: number): WorstInterval[] {
  const rows: WorstInterval[] = [];
  const samples = capture.samples;
  const hasUi = samples.some((s) => s.ui !== undefined);
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
    const row: WorstInterval = { fromTMs: prev.tMs, toTMs: cur.tMs, cpu };
    if (cur.ui !== undefined) {
      row.maxFrameMs = cur.ui.maxFrameMs;
      if (cur.ui.phasesUs !== undefined) row.phasesUs = [...cur.ui.phasesUs];
    }
    if (hasUi) {
      row.rankMs = row.maxFrameMs ?? 0;
    } else {
      row.rankCpuPct = Math.max(0, ...Object.values(cpu).map((v) => (v === undefined ? 0 : v)));
    }
    rows.push(row);
  }
  rows.sort((a, b) => (b.rankMs ?? b.rankCpuPct ?? 0) - (a.rankMs ?? a.rankCpuPct ?? 0));
  return rows.slice(0, Math.max(1, n));
}

/** Human table for the --worst section. */
export function formatWorstIntervals(rows: WorstInterval[]): string {
  const lines: string[] = [];
  const PHASE_LABELS = ['bind', 'trans', 'draw', 'scroll', 'flush'];
  lines.push('Worst intervals (by max frame):');
  for (const r of rows) {
    const span = `${(r.fromTMs / 1000).toFixed(1)}–${(r.toTMs / 1000).toFixed(1)}s`;
    const cpu = Object.entries(r.cpu)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .slice(0, 3)
      .map(([name, v]) => `${name} ${v}%`)
      .join(', ');
    const frame = r.maxFrameMs !== undefined ? `frame max ${r.maxFrameMs} ms` : 'no UI data';
    const phases = r.phasesUs !== undefined && r.phasesUs.some((v) => v > 0)
      ? ` · phases ${r.phasesUs.map((v, i) => `${PHASE_LABELS[i]} ${fmtUs(v)}`).join(' ')}`
      : '';
    lines.push(`  ${span}  ${frame}  ${cpu}${phases}`);
  }
  return lines.join('\n');
}

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

// ── Baseline drift (regression monitoring across runs) ─────────────────────
//
// Every capture stamps its report beside the build (trace-report.json, the
// sbom/audit sidecar pattern). The next run compares against that stamp:
// a metric "regresses" when it moved against you by more than the drift
// tolerance — CPU metrics additionally never regress below a 3-percentage-
// point floor, so idle noise on a quiet thread cannot fail a run.

export interface BaselineRow {
  metric: string;
  thread: string | null;
  baseline: number | null;
  current: number | null;
  verdict: 'ok' | 'regression' | 'new' | 'gone' | 'no-data';
}

export interface BaselineResult {
  pass: boolean;
  rows: BaselineRow[];
}

/** Load + shape-check a baseline report (the stamped sidecar or a report
 *  --json dump). Undefined on anything that is not a trace-report@1. */
export function readTraceReportText(text: string): TraceReport | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const r = raw as Partial<TraceReport>;
  if (r.schema !== 'typecad-hal/trace-report@1' || !Array.isArray(r.threads)) return undefined;
  return r as TraceReport;
}

/** Write a report sidecar (the build-adjacent stamp `trace capture` keeps
 *  beside the build — the next run's baseline). */
export function writeTraceReport(filePath: string, report: TraceReport): void {
  writeFileSync(filePath, JSON.stringify(report, null, 2) + '\n');
}

/** Compare current vs baseline at `driftPct` tolerance (allowed regression as
 *  a percent of the baseline value; CPU metrics also floor at 3pp absolute). */
export function evaluateBaseline(
  current: TraceReport,
  baseline: TraceReport,
  driftPct: number,
): BaselineResult {
  const rows: BaselineRow[] = [];
  const byName = new Map(baseline.threads.map((t) => [t.name, t]));
  const seen = new Set<string>();
  const cpuRegression = (label: string, thread: string, base: number | null, cur: number | null): void => {
    if (base === null || cur === null) {
      rows.push({ metric: label, thread, baseline: base, current: cur, verdict: 'no-data' });
      return;
    }
    const allowed = Math.max(base * driftPct / 100, 3);
    rows.push({
      metric: label, thread, baseline: base, current: cur,
      verdict: cur - base > allowed ? 'regression' : 'ok',
    });
  };
  for (const t of current.threads) {
    seen.add(t.name);
    const b = byName.get(t.name);
    if (b === undefined) {
      rows.push({ metric: 'cpu-avg', thread: t.name, baseline: null, current: t.cpuAvgPct, verdict: 'new' });
      continue;
    }
    cpuRegression('cpu-avg', t.name, b.cpuAvgPct, t.cpuAvgPct);
    cpuRegression('cpu-max', t.name, b.cpuMaxPct, t.cpuMaxPct);
    // Stack headroom REGRESSES when it SHRINKS beyond tolerance.
    if (b.stackMinUnusedBytes === null || t.stackMinUnusedBytes === null) {
      rows.push({ metric: 'stack-min', thread: t.name, baseline: b.stackMinUnusedBytes, current: t.stackMinUnusedBytes, verdict: 'no-data' });
    } else {
      const allowed = Math.max(b.stackMinUnusedBytes * driftPct / 100, 32);
      rows.push({
        metric: 'stack-min', thread: t.name, baseline: b.stackMinUnusedBytes, current: t.stackMinUnusedBytes,
        verdict: b.stackMinUnusedBytes - t.stackMinUnusedBytes > allowed ? 'regression' : 'ok',
      });
    }
  }
  for (const b of baseline.threads) {
    if (!seen.has(b.name)) {
      rows.push({ metric: 'cpu-avg', thread: b.name, baseline: b.cpuAvgPct, current: null, verdict: 'gone' });
    }
  }
  // Frame time — capture-wide, only when both sides have UI data.
  if (baseline.ui !== undefined && current.ui !== undefined) {
    const base = baseline.ui.maxFrameMs;
    const cur = current.ui.maxFrameMs;
    const allowed = Math.max(base * driftPct / 100, 2);
    rows.push({
      metric: 'frame-max', thread: null, baseline: base, current: cur,
      verdict: cur - base > allowed ? 'regression' : 'ok',
    });
  }
  return { pass: !rows.some((r) => r.verdict === 'regression'), rows };
}

/** The drift table for terminal output (regressions last, so they end the
 *  run's story). */
export function formatBaseline(result: BaselineResult): string {
  const rank = (v: BaselineRow['verdict']): number =>
    v === 'regression' ? 0 : v === 'no-data' ? 1 : v === 'gone' ? 2 : v === 'new' ? 3 : 4;
  const lines = ['Baseline drift (regressions first):', '  metric            thread          baseline   current   verdict'];
  for (const r of [...result.rows].sort((a, b) => rank(a.verdict) - rank(b.verdict))) {
    const metric = r.metric.padEnd(18);
    const thread = (r.thread ?? '').padEnd(16);
    const base = r.baseline === null ? '—' : String(r.baseline);
    const cur = r.current === null ? '—' : String(r.current);
    lines.push(`  ${metric}${thread}${base.padEnd(10)} ${cur.padEnd(9)} ${r.verdict}`);
  }
  return lines.join('\n');
}
