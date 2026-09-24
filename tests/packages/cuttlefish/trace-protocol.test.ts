import { describe, it, expect } from 'vitest';
import { TraceLineParser } from '../../../packages/cuttlefish/src/trace/protocol';
import type { TraceCapture } from '../../../packages/cuttlefish/src/trace/types';
import { buildTraceReport, readTraceCapture, formatTraceReport, buildTimeline, evaluateGates } from '../../../packages/cuttlefish/src/trace/report';

// The wire: [TR:CFG:<v>:<interval>] once at boot, then per heartbeat a
// [TR:HB:<seq>:<tMs>:<sysExec>] header followed by one [TR:TH:...] line per
// live thread. Everything else on the console is noise the parser ignores.
describe('TraceLineParser', () => {
  it('groups thread lines under their heartbeat by seq', () => {
    const p = new TraceLineParser();
    p.feed('[TR:CFG:1:1000]');
    p.feed('[TR:HB:1:1002:500000]');
    p.feed('[TR:TH:1:main:200000:400:1024]');
    p.feed('[TR:TH:1:idle:300000:120:256]');
    p.feed('[TR:HB:2:2003:1000000]');
    p.feed('[TR:TH:2:main:400000:398:1024]');
    p.feed('[TR:TH:2:idle:600000:120:256]');
    const samples = p.finish();
    expect(samples).toHaveLength(2);
    expect(samples[0].seq).toBe(1);
    expect(samples[0].tMs).toBe(1002);
    expect(samples[0].sysExecCycles).toBe(500000);
    expect(samples[0].threads.map((t) => t.name)).toEqual(['main', 'idle']);
    expect(samples[1].threads[0].execCycles).toBe(400000);
    expect(p.meta).toEqual({ version: 1, intervalMs: 1000 });
    expect(p.malformed).toBe(0);
  });

  it('ignores interleaved user prints and empty lines', () => {
    const p = new TraceLineParser();
    p.feed('boot at 42 ms');
    p.feed('');
    p.feed('[TR:HB:5:500:100]');
    p.feed('hello from main');
    p.feed('[TR:TH:5:main:100:10:64]');
    p.feed('[TR:HB:6:600:200]');
    p.feed('[TR:TH:6:main:180:10:64]');
    const samples = p.finish();
    expect(samples).toHaveLength(2);
    expect(p.malformed).toBe(0);
  });

  it('drops thread lines whose heartbeat was never seen', () => {
    const p = new TraceLineParser();
    // Capture attached mid-interval: a TH arrives before any HB.
    p.feed('[TR:TH:9:main:123:8:128]');
    p.feed('[TR:HB:10:1000:2000]');
    p.feed('[TR:TH:10:main:500:8:128]');
    const samples = p.finish();
    expect(samples).toHaveLength(1);
    expect(samples[0].seq).toBe(10);
    expect(p.malformed).toBeGreaterThan(0);
  });

  it('reads the -1 stack sentinel as unknown (null), keeps zero-size as 0', () => {
    const p = new TraceLineParser();
    p.feed('[TR:HB:1:10:100]');
    p.feed('[TR:TH:1:main:60:-1:0]');
    const samples = p.finish();
    expect(samples[0].threads[0].stackUnusedBytes).toBeNull();
    expect(samples[0].threads[0].stackSizeBytes).toBe(0);
  });

  it('accepts bracketed and unbracketed lines (printf lines end with \\n, not ])', () => {
    const p = new TraceLineParser();
    p.feed('[TR:HB:1:10:100]');
    p.feed('[TR:TH:1:main:60:8:128]');
    p.feed('[TR:HB:2:20:200]');
    p.feed('[TR:TH:2:main:120:8:128]');
    const samples = p.finish();
    expect(samples).toHaveLength(2);
    expect(samples[0].threads[0].stackUnusedBytes).toBe(8);
  });

  it('names empty thread fields "unnamed"', () => {
    const p = new TraceLineParser();
    p.feed('[TR:HB:1:10:100]');
    p.feed('[TR:TH:1::40:8:64]');
    const samples = p.finish();
    expect(samples[0].threads[0].name).toBe('unnamed');
  });

  it('parses user events (Trace.mark without value, Trace.event with)', () => {
    const p = new TraceLineParser();
    p.feed('[TR:EV:1200:connected');
    p.feed('[TR:EV:1300:errors:3');
    p.feed('not a protocol line');
    p.finish();
    expect(p.eventList).toEqual([
      { tMs: 1200, name: 'connected' },
      { tMs: 1300, name: 'errors', value: 3 },
    ]);
  });

  it('attaches [TR:UI frame stats to the matching heartbeat by seq', () => {
    const p = new TraceLineParser();
    p.feed('[TR:HB:7:7000:700000]');
    p.feed('[TR:UI:7:60:12:33]');
    p.feed('[TR:TH:7:main:100:8:128]');
    p.feed('[TR:HB:8:8000:800000]');
    p.feed('[TR:UI:8:60:10:20]');
    const samples = p.finish();
    expect(samples[0].ui).toEqual({ frameCount: 60, avgFrameMsX10: 12, maxFrameMs: 33 });
    expect(samples[1].ui?.maxFrameMs).toBe(20);
    // A UI line with no live heartbeat is dropped as malformed.
    const stray = new TraceLineParser();
    stray.feed('[TR:UI:99:1:1:1]');
    expect(stray.malformed).toBe(1);
  });

  it('snapshot() is read-only: a mid-capture live write must not close the in-flight group', () => {
    // Regression: the capture live-write path used finish(), which closed
    // the just-opened heartbeat — every following UI/UP/TH line then landed
    // with no open group and counted as malformed (30 malformed lines on the
    // first real hardware capture).
    const p = new TraceLineParser();
    p.feed('[TR:HB:1:1000:1000]');
    p.feed('[TR:TH:1:main:100:8:128]');
    // Mid-capture live write — repeated, as the viewer path does per beat.
    // The in-flight group is excluded (complete heartbeats only)…
    expect(p.snapshot()).toEqual([]);
    p.feed('[TR:HB:2:2000:2000]');
    // …and once heartbeat 2 opens, heartbeat 1 is closed and visible —
    // without the snapshot having disturbed the parser state.
    expect(p.snapshot()).toEqual([{ seq: 1, tMs: 1000, sysExecCycles: 1000,
      threads: [{ name: 'main', execCycles: 100, stackUnusedBytes: 8, stackSizeBytes: 128 }] }]);
    p.feed('[TR:TH:2:main:250:8:128]');
    const samples = p.finish();
    expect(samples).toHaveLength(2);
    expect(samples[1].threads).toHaveLength(1); // not lost to a premature close
    expect(p.malformed).toBe(0);
  });

  it('merges [TR:UP tick-phase microseconds into the heartbeat ui stats', () => {
    const p = new TraceLineParser();
    p.feed('[TR:HB:3:3000:300000]');
    p.feed('[TR:UI:3:60:15:22]');
    p.feed('[TR:UP:3:120:45:600:80:210]');
    const samples = p.finish();
    expect(samples[0].ui?.phasesUs).toEqual([120, 45, 600, 80, 210]);
    // A UP line whose UI line was missed still creates the ui record with
    // zero frame stats (the phase data is independently valid).
    const q = new TraceLineParser();
    q.feed('[TR:HB:1:1000:100000]');
    q.feed('[TR:UP:1:10:10:10:10:10]');
    const s2 = q.finish();
    expect(s2[0].ui?.phasesUs).toEqual([10, 10, 10, 10, 10]);
    expect(s2[0].ui?.frameCount).toBe(0);
  });
});

// CPU% is computed from consecutive samples as delta(exec)/delta(sys) — the
// sys counter includes idle, so the idle row shows up and the column sums
// to ~100%. Stack high-water is the min unused-bytes seen.
describe('buildTraceReport', () => {
  const capture: TraceCapture = {
    schema: 'typecad-hal/trace@1',
    capturedAt: '2026-09-23T00:00:00Z',
    port: 'TEST',
    baudRate: 115200,
    intervalMs: 1000,
    samples: [
      { seq: 1, tMs: 1000, sysExecCycles: 1_000_000, threads: [
        { name: 'main', execCycles: 100_000, stackUnusedBytes: 900, stackSizeBytes: 1024 },
        { name: 'idle', execCycles: 800_000, stackUnusedBytes: 200, stackSizeBytes: 256 },
      ] },
      { seq: 2, tMs: 2000, sysExecCycles: 2_000_000, threads: [
        { name: 'main', execCycles: 350_000, stackUnusedBytes: 512, stackSizeBytes: 1024 },
        { name: 'idle', execCycles: 1_550_000, stackUnusedBytes: 200, stackSizeBytes: 256 },
      ] },
      { seq: 3, tMs: 3000, sysExecCycles: 3_000_000, threads: [
        { name: 'main', execCycles: 500_000, stackUnusedBytes: 700, stackSizeBytes: 1024 },
        { name: 'idle', execCycles: 2_400_000, stackUnusedBytes: 190, stackSizeBytes: 256 },
      ] },
    ],
  };

  it('computes per-thread CPU avg/max from cycle deltas against the sys counter', () => {
    const report = buildTraceReport(capture);
    const main = report.threads.find((t) => t.name === 'main');
    // main intervals: 250k/1M = 25%, then 150k/1M = 15% → avg 20.0, max 25.0.
    expect(main?.cpuAvgPct).toBe(20);
    expect(main?.cpuMaxPct).toBe(25);
    const idle = report.threads.find((t) => t.name === 'idle');
    expect(idle?.cpuAvgPct).toBe(80);
    expect(report.capture.sampleCount).toBe(3);
    expect(report.capture.durationMs).toBe(2000);
  });

  it('stack high-water is the minimum unused seen; peak used = size - min', () => {
    const report = buildTraceReport(capture);
    const main = report.threads.find((t) => t.name === 'main');
    expect(main?.stackMinUnusedBytes).toBe(512);
    expect(main?.stackSizeBytes).toBe(1024);
    expect(main?.stackPeakUsedPct).toBe(50);
    const idle = report.threads.find((t) => t.name === 'idle');
    expect(idle?.stackMinUnusedBytes).toBe(190);
    expect(idle?.stackPeakUsedPct).toBe(25.8);
  });

  it('sorts busiest-first and handles single-sample captures (no CPU column data)', () => {
    const single: TraceCapture = {
      ...capture,
      samples: [capture.samples[0]],
    };
    const report = buildTraceReport(single);
    expect(report.capture.durationMs).toBe(0);
    expect(report.threads.every((t) => t.cpuAvgPct === null)).toBe(true);
    // Stack rows still exist.
    expect(report.threads.some((t) => t.name === 'main' && t.stackMinUnusedBytes === 900)).toBe(true);
    // Busiest-first ordering on the full capture.
    const full = buildTraceReport(capture);
    expect(full.threads[0].name).toBe('idle');
  });

  it('skips CPU intervals for a restarted thread (counter went backwards)', () => {
    const restarted: TraceCapture = {
      ...capture,
      samples: [
        { seq: 1, tMs: 0, sysExecCycles: 100, threads: [
          { name: 'worker', execCycles: 90, stackUnusedBytes: null, stackSizeBytes: 0 },
        ] },
        { seq: 2, tMs: 1000, sysExecCycles: 200, threads: [
          { name: 'worker', execCycles: 5, stackUnusedBytes: null, stackSizeBytes: 0 },
        ] },
        { seq: 3, tMs: 2000, sysExecCycles: 300, threads: [
          { name: 'worker', execCycles: 45, stackUnusedBytes: null, stackSizeBytes: 0 },
        ] },
      ],
    };
    const report = buildTraceReport(restarted);
    const worker = report.threads.find((t) => t.name === 'worker');
    // Only the 5→45 interval counts (40/100 = 40%); the reset pair is dropped.
    expect(worker?.cpuAvgPct).toBe(40);
    expect(worker?.cpuMaxPct).toBe(40);
  });

  it('formatTraceReport renders a table with every thread', () => {
    const text = formatTraceReport(buildTraceReport(capture));
    expect(text).toContain('idle');
    expect(text).toContain('main');
    expect(text).toContain('CPU avg');
    expect(text).toContain('Headroom');
  });
});

describe('report UI + events sections', () => {
  const captureWithExtras: TraceCapture = {
    schema: 'typecad-hal/trace@1',
    capturedAt: '2026-09-23T00:00:00Z',
    port: 'TEST',
    baudRate: 115200,
    intervalMs: 1000,
    samples: [
      { seq: 1, tMs: 1000, sysExecCycles: 1000, ui: { frameCount: 60, avgFrameMsX10: 16, maxFrameMs: 33 }, threads: [] },
      { seq: 2, tMs: 2000, sysExecCycles: 2000, ui: { frameCount: 60, avgFrameMsX10: 20, maxFrameMs: 21 }, threads: [] },
      { seq: 3, tMs: 3000, sysExecCycles: 3000, threads: [] },
    ],
    events: [
      { tMs: 1100, name: 'boot' },
      { tMs: 1500, name: 'errors', value: 1 },
      { tMs: 2500, name: 'errors', value: 4 },
    ],
  };

  it('summarizes UI frame stats across intervals', () => {
    const report = buildTraceReport(captureWithExtras);
    expect(report.ui).toBeDefined();
    expect(report.ui?.intervals).toBe(2);
    expect(report.ui?.framesTotal).toBe(120);
    // total ms = 60*1.6 + 60*2.0 = 216 → avg 1.8.
    expect(report.ui?.avgFrameMs).toBe(1.8);
    expect(report.ui?.maxFrameMs).toBe(33);
  });

  it('summarizes events by name with count + last value', () => {
    const report = buildTraceReport(captureWithExtras);
    const errors = report.events?.find((e) => e.name === 'errors');
    expect(errors?.count).toBe(2);
    expect(errors?.lastValue).toBe(4);
    expect(report.events?.[0].name).toBe('errors'); // count-desc
  });

  it('omits both sections when the capture has neither', () => {
    const cpuOnly: TraceCapture = {
      schema: 'typecad-hal/trace@1',
      capturedAt: '2026-09-23T00:00:00Z',
      port: 'TEST',
      baudRate: 115200,
      intervalMs: null,
      samples: [
        { seq: 1, tMs: 1000, sysExecCycles: 1000, threads: [{ name: 'main', execCycles: 100, stackUnusedBytes: 8, stackSizeBytes: 128 }] },
        { seq: 2, tMs: 2000, sysExecCycles: 2000, threads: [{ name: 'main', execCycles: 250, stackUnusedBytes: 8, stackSizeBytes: 128 }] },
      ],
    };
    const report = buildTraceReport(cpuOnly);
    expect(report.ui).toBeUndefined();
    expect(report.events).toBeUndefined();
  });

  it('buildTimeline computes per-interval CPU series and passes events through', () => {
    const withEvents: TraceCapture = {
      schema: 'typecad-hal/trace@1',
      capturedAt: '2026-09-23T00:00:00Z',
      port: 'TEST',
      baudRate: 115200,
      intervalMs: 1000,
      samples: captureWithExtras.samples,
      events: captureWithExtras.events,
    };
    const { points, events } = buildTimeline(withEvents);
    expect(points).toHaveLength(2);
    // points[0] covers the interval ENDING at sample 2 — it carries that
    // sample's frame stats (the interval's own accrual), not sample 1's.
    expect(points[0].ui).toEqual({ avgFrameMs: 2, maxFrameMs: 21 });
    expect(events).toHaveLength(3);
    expect(events[2].value).toBe(4);
  });
});

describe('evaluateGates (CI regression gates)', () => {
  const capture: TraceCapture = {
    schema: 'typecad-hal/trace@1',
    capturedAt: '2026-09-23T00:00:00Z',
    port: 'GATE',
    baudRate: 115200,
    intervalMs: 1000,
    samples: [
      { seq: 1, tMs: 1000, sysExecCycles: 1000000, threads: [
        { name: 'main', execCycles: 150000, stackUnusedBytes: 300, stackSizeBytes: 1024 },
      ], ui: { frameCount: 60, avgFrameMsX10: 16, maxFrameMs: 18 } },
      { seq: 2, tMs: 2000, sysExecCycles: 2000000, threads: [
        { name: 'main', execCycles: 320000, stackUnusedBytes: 512, stackSizeBytes: 1024 },
      ], ui: { frameCount: 60, avgFrameMsX10: 16, maxFrameMs: 22 } },
    ],
  };
  const report = buildTraceReport(capture);

  it('passes satisfied gates and fails violated ones with context', () => {
    const ok = evaluateGates(report, ['cpu-avg:main<=20', 'cpu-max:main<=25', 'frame-max<=25', 'stack-min:main>=250']);
    expect(ok.pass).toBe(true);
    const bad = evaluateGates(report, ['cpu-avg:main<=10', 'stack-min:main>=400']);
    expect(bad.pass).toBe(false);
    expect(bad.violations.some((v) => v.includes('cpu-avg:main: 17'))).toBe(true);
    expect(bad.violations.some((v) => v.includes("violates 'stack-min:main>=400'"))).toBe(true);
  });

  it('fails a gate whose metric/thread is absent from the capture (cannot pass on no data)', () => {
    const r = evaluateGates(report, ['cpu-avg:ghost<=50', 'frame-max<=20']);
    // frame-max exists here; ghost does not.
    expect(r.pass).toBe(false);
    expect(r.violations[0]).toContain('cpu-avg:ghost');
  });

  it('rejects malformed expressions and nonsense directions', () => {
    expect(() => evaluateGates(report, ['cpu<=50'])).toThrow(/Malformed gate/);
    expect(() => evaluateGates(report, ['stack-min:main<=100'])).toThrow(/minimum bound/);
  });

  it('frame-max with no UI data is a violation, not a silent pass', () => {
    const noUi = buildTraceReport({ ...capture, samples: capture.samples.map((s) => ({ ...s, ui: undefined })) });
    const r = evaluateGates(noUi, ['frame-max<=20']);
    expect(r.pass).toBe(false);
    expect(r.violations[0]).toContain('frame-max');
  });
});

describe('readTraceCapture', () => {
  it('rejects a non-trace@1 file with context', async () => {
    const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'trace-artifact-'));
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ schema: 'typecad-hal/security-audit@1' }));
    expect(() => readTraceCapture(bad)).toThrow(/not a typecad-hal\/trace@1 capture/);
    rmSync(dir, { recursive: true, force: true });
  });
});
