// ---------------------------------------------------------------------------
// trace-baseline.test.ts — the regression-monitoring half of the trace
// system: the baseline drift compare (cpu avg/max, stack headroom shrink,
// frame worst), its noise floors, and the report sidecar round-trip.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  buildTraceReport, evaluateBaseline, readTraceReportText, writeTraceReport,
  type TraceCapture, type TraceReport,
} from '../../../packages/cuttlefish/src/trace/report';

function captureWith(opts: {
  mainAvgCpu: number; // % per interval for main
  mainStack: number;  // unused bytes
  idle?: number;
}): TraceCapture {
  // Two intervals; main gets opts.mainAvgCpu of the sys delta, idle the rest.
  const mk = (seq: number, t: number, mainExec: number, idleExec: number, stack: number) => ({
    seq, tMs: t, sysExecCycles: 1_000_000 * seq, threads: [
      { name: 'main', execCycles: mainExec, stackUnusedBytes: stack, stackSizeBytes: 4096 },
      { name: 'idle', execCycles: idleExec, stackUnusedBytes: 64, stackSizeBytes: 128 },
    ],
  });
  // interval 1: sys delta 1e6, main delta = avg% * 1e6 / 100
  const d1 = Math.round(opts.mainAvgCpu * 10_000);
  return {
    schema: 'typecad-hal/trace@1',
    capturedAt: '2026-09-24T00:00:00Z',
    port: 'COM10',
    baudRate: 115200,
    intervalMs: 1000,
    samples: [
      mk(1, 1000, 0, 0, 4096),
      mk(2, 2000, d1, 1_000_000 - d1, opts.mainStack),
      mk(3, 3000, d1 * 2, 2_000_000 - d1 * 2, opts.mainStack),
    ],
  };
}

describe('evaluateBaseline', () => {
  const baseline: TraceReport = buildTraceReport(captureWith({ mainAvgCpu: 10, mainStack: 2000 }));

  it('passes when current matches baseline (noise within drift)', () => {
    const current = buildTraceReport(captureWith({ mainAvgCpu: 11, mainStack: 1980 }));
    const r = evaluateBaseline(current, baseline, 10);
    expect(r.pass).toBe(true);
  });

  it('regresses when CPU creeps beyond the drift percent', () => {
    const current = buildTraceReport(captureWith({ mainAvgCpu: 30, mainStack: 2000 }));
    const r = evaluateBaseline(current, baseline, 10);
    expect(r.pass).toBe(false);
    const avg = r.rows.find((x) => x.metric === 'cpu-avg' && x.thread === 'main');
    expect(avg?.verdict).toBe('regression');
  });

  it('CPU noise under the 3pp floor never regresses (a quiet thread cannot fail a run)', () => {
    // Baseline 1% → 10% drift allows 0.1pp; the 3pp floor must dominate:
    // 1% → 2% is a 100% relative move but only 1pp absolute — OK.
    const base = buildTraceReport(captureWith({ mainAvgCpu: 1, mainStack: 2000 }));
    const current = buildTraceReport(captureWith({ mainAvgCpu: 3.5, mainStack: 2000 }));
    expect(evaluateBaseline(current, base, 10).pass).toBe(true);
    // 1% → 5% crosses the floor — regression.
    const worse = buildTraceReport(captureWith({ mainAvgCpu: 5, mainStack: 2000 }));
    expect(evaluateBaseline(worse, base, 10).pass).toBe(false);
  });

  it('regresses when stack headroom SHRINKS beyond tolerance (32B floor)', () => {
    const current = buildTraceReport(captureWith({ mainAvgCpu: 10, mainStack: 1500 }));
    const r = evaluateBaseline(current, baseline, 10); // allowed = max(200, 32) = 200B
    const row = r.rows.find((x) => x.metric === 'stack-min' && x.thread === 'main');
    expect(row?.verdict).toBe('regression');
    expect(r.pass).toBe(false);
  });

  it('marks threads new in the current run without failing, and gone threads as gone', () => {
    const one = buildTraceReport(captureWith({ mainAvgCpu: 10, mainStack: 2000 }));
    // Build a report with an extra thread by cloning capture + adding it.
    const cap = captureWith({ mainAvgCpu: 10, mainStack: 2000 });
    for (const s of cap.samples) {
      s.threads.push({ name: 'worker', execCycles: 0, stackUnusedBytes: 100, stackSizeBytes: 512 });
    }
    const two = buildTraceReport(cap);
    const r = evaluateBaseline(two, one, 10);
    expect(r.rows.find((x) => x.thread === 'worker')?.verdict).toBe('new');
    expect(r.pass).toBe(true);
    const back = evaluateBaseline(one, two, 10);
    expect(back.rows.find((x) => x.thread === 'worker')?.verdict).toBe('gone');
    expect(back.pass).toBe(true);
  });

  it('regresses frame-max only when both sides have UI data', () => {
    const withUi = (maxMs: number): TraceReport => {
      const cap = captureWith({ mainAvgCpu: 10, mainStack: 2000 });
      cap.samples[1].ui = { frameCount: 10, avgFrameMsX10: 15, maxFrameMs: maxMs };
      cap.samples[2].ui = { frameCount: 10, avgFrameMsX10: 15, maxFrameMs: maxMs };
      return buildTraceReport(cap);
    };
    const r = evaluateBaseline(withUi(50), withUi(10), 10);
    expect(r.rows.find((x) => x.metric === 'frame-max')?.verdict).toBe('regression');
    expect(evaluateBaseline(withUi(12), withUi(10), 10).pass).toBe(true);
    // One side without UI → no frame row at all.
    const noUi = buildTraceReport(captureWith({ mainAvgCpu: 10, mainStack: 2000 }));
    const rows = evaluateBaseline(withUi(50), noUi, 10).rows;
    expect(rows.find((x) => x.metric === 'frame-max')).toBeUndefined();
  });
});

describe('report sidecar round-trip', () => {
  it('writeTraceReport → readTraceReportText is lossless; junk is rejected', () => {
    const report = buildTraceReport(captureWith({ mainAvgCpu: 10, mainStack: 2000 }));
    const text = JSON.stringify(report, null, 2) + '\n';
    const back = readTraceReportText(text)!;
    expect(back.schema).toBe('typecad-hal/trace-report@1');
    expect(back.capture.sessionCount).toBe(1);
    expect(back.threads.map((t) => t.name)).toContain('main');
    expect(readTraceReportText('{"schema":"typecad-hal/trace@1"}')).toBeUndefined();
    expect(readTraceReportText('not json')).toBeUndefined();
  });

  it('counts sessions from reboot-marked samples', () => {
    const cap = captureWith({ mainAvgCpu: 10, mainStack: 2000 });
    cap.samples[2].session = 1;
    expect(buildTraceReport(cap).capture.sessionCount).toBe(2);
  });

  it('aggregates on-device alarms (unique code+detail, first/last seen)', () => {
    const cap = captureWith({ mainAvgCpu: 10, mainStack: 2000 });
    cap.alarms = [
      { seq: 1, tMs: 1000, code: 'stack', detail: 'main:100' },
      { seq: 2, tMs: 2000, code: 'stack', detail: 'main:100' },
      { seq: 2, tMs: 2000, code: 'frame', detail: '33' },
    ];
    const report = buildTraceReport(cap);
    expect(report.alarms).toHaveLength(2);
    const stack = report.alarms!.find((a) => a.code === 'stack')!;
    expect(stack.count).toBe(2);
    expect(stack.firstTMs).toBe(1000);
    expect(stack.lastTMs).toBe(2000);
  });
});
