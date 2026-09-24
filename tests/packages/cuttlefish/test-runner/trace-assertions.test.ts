// ---------------------------------------------------------------------------
// trace-assertions.test.ts — in-DSL trace assertions: the runner's host-side
// evaluation (arrival-ordered [TC:/[TR: replay, section windowing, the
// straddler skip) and the preprocessor's .trace() emission (dwell + marker).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { parseProtocolLinesWithTrace } from '../../../../packages/cuttlefish/src/test-runner/parser';
import { preprocess } from '../../../../packages/cuttlefish/src/test-runner/preprocessor';

/** One heartbeat group: HB then per-thread TH lines. CPU% for an interval is
 *  delta(exec)/delta(sys) — an idle-heavy fixture keeps the math obvious. */
function heartbeat(seq: number, tMs: number, mainDelta: number, sysDelta: number): string[] {
  const sysTotal = sysDelta * seq;
  const mainTotal = mainDelta * seq;
  const idleTotal = (sysDelta - mainDelta) * seq;
  return [
    `[TR:HB:${seq}:${tMs}:${sysTotal}]`,
    `[TR:TH:${seq}:main:${mainTotal}:4096:8192]`,
    `[TR:TH:${seq}:idle:${idleTotal}:128:256]`,
  ];
}

function stream(parts: (string | string[])[]): string[] {
  return parts.flatMap((p) => (Array.isArray(p) ? p : [p]));
}

describe('parseProtocolLinesWithTrace — in-DSL trace assertions', () => {
  const PREAMBLE = ['[TC:SUITE_START]'];

  it('evaluates the gate over the heartbeats that closed inside the it()', () => {
    // main takes 20% of every interval → cpu-avg:main<=30 passes.
    const lines = stream([
      PREAMBLE,
      '[TC:DESCRIBE:budget]',
      '[TC:IT:cheap redraw]',
      heartbeat(1, 1000, 0, 0), // its heartbeat arrived AFTER the IT — in-window
      heartbeat(2, 2000, 200_000, 1_000_000),
      heartbeat(3, 3000, 400_000, 2_000_000),
      heartbeat(4, 4000, 600_000, 3_000_000),
      heartbeat(5, 5000, 800_000, 4_000_000), // closes group 4 → 3 in-window samples
      '[TC:TRACE:cpu-avg:main<=30]',
      '[TC:SUITE_END]',
    ]);
    const describes = parseProtocolLinesWithTrace(lines);
    const assertion = describes[0].tests[0].assertions.find((a) => a.matcher === 'traceGate');
    expect(assertion).toBeDefined();
    expect(assertion!.passed).toBe(true);
    expect(assertion!.expected).toBe('cpu-avg:main<=30');
    expect(assertion!.actual).toContain('main: avg 20%');
    expect(assertion!.actual).toContain('over 3 intervals');
  });

  it('fails with the section values when the gate is violated', () => {
    const lines = stream([
      PREAMBLE,
      '[TC:DESCRIBE:budget]',
      '[TC:IT:greedy redraw]',
      heartbeat(1, 1000, 0, 0), // in-window under the opened-bound rule
      heartbeat(2, 2000, 800_000, 1_000_000), // main = 80%
      heartbeat(3, 3000, 1_600_000, 2_000_000),
      heartbeat(4, 4000, 2_400_000, 3_000_000),
      heartbeat(5, 5000, 3_200_000, 4_000_000),
      '[TC:TRACE:cpu-avg:main<=30]',
      '[TC:SUITE_END]',
    ]);
    const describes = parseProtocolLinesWithTrace(lines);
    const test = describes[0].tests[0];
    const assertion = test.assertions.find((a) => a.matcher === 'traceGate')!;
    expect(assertion.passed).toBe(false);
    expect(assertion.actual).toContain('avg 80%');
    expect(test.passed).toBe(false);
  });

  it('excludes the straddling heartbeat closed at the it() boundary', () => {
    // Heartbeat 1 closes exactly when the IT line arrives (watermark 1) —
    // its interval began before the test, so the section starts at sample 2.
    const lines = stream([
      PREAMBLE,
      '[TC:DESCRIBE:budget]',
      heartbeat(1, 1000, 999_999, 1_000_000), // nearly-all-main, pre-test
      '[TC:IT:scoped]',
      heartbeat(2, 2000, 100_000, 1_000_000), // 10% in-test
      heartbeat(3, 3000, 200_000, 2_000_000),
      heartbeat(4, 4000, 300_000, 3_000_000),
      '[TC:TRACE:cpu-avg:main<=30]',
      '[TC:SUITE_END]',
    ]);
    const describes = parseProtocolLinesWithTrace(lines);
    const assertion = describes[0].tests[0].assertions.find((a) => a.matcher === 'traceGate')!;
    // With the straddler included the average would be ~55%; scoped it is 10%.
    expect(assertion.passed).toBe(true);
    expect(assertion.actual).toContain('avg 10%');
  });

  it('fails with the dwell remedy when too few heartbeats closed inside the test', () => {
    const lines = stream([
      PREAMBLE,
      '[TC:DESCRIBE:budget]',
      '[TC:IT:too fast]',
      '[TC:TRACE:cpu-avg:main<=30]',
      heartbeat(1, 1000, 0, 0),
      heartbeat(2, 2000, 100_000, 1_000_000),
      '[TC:SUITE_END]',
    ]);
    const describes = parseProtocolLinesWithTrace(lines);
    const assertion = describes[0].tests[0].assertions.find((a) => a.matcher === 'traceGate')!;
    expect(assertion.passed).toBe(false);
    expect(assertion.actual).toContain('dwell');
  });

  it('fails with the tracing remedy when no [TR: lines arrived at all', () => {
    const lines = [
      '[TC:SUITE_START]',
      '[TC:DESCRIBE:budget]',
      '[TC:IT:untraced]',
      '[TC:TRACE:cpu-avg:main<=30]',
      '[TC:SUITE_END]',
    ];
    const describes = parseProtocolLinesWithTrace(lines);
    const assertion = describes[0].tests[0].assertions.find((a) => a.matcher === 'traceGate')!;
    expect(assertion.passed).toBe(false);
    expect(assertion.actual).toContain('zephyr.trace');
  });

  it('a malformed gate is a failed assertion, not a crashed run', () => {
    const lines = stream([
      PREAMBLE,
      '[TC:DESCRIBE:budget]',
      '[TC:IT:typo]',
      heartbeat(1, 1000, 0, 0),
      heartbeat(2, 2000, 100_000, 1_000_000),
      heartbeat(3, 3000, 200_000, 2_000_000),
      heartbeat(4, 4000, 300_000, 3_000_000),
      '[TC:TRACE:cpu<=]',
      '[TC:SUITE_END]',
    ]);
    const describes = parseProtocolLinesWithTrace(lines);
    const assertion = describes[0].tests[0].assertions.find((a) => a.matcher === 'traceGate')!;
    expect(assertion.passed).toBe(false);
    expect(assertion.actual).toContain('gate error');
  });

  it('plain EXPECT assertions still evaluate alongside trace gates', () => {
    const lines = stream([
      PREAMBLE,
      '[TC:DESCRIBE:mixed]',
      '[TC:IT:both kinds]',
      '[TC:EXPECT:toBe:1:1]',
      heartbeat(1, 1000, 0, 0),
      heartbeat(2, 2000, 100_000, 1_000_000),
      heartbeat(3, 3000, 200_000, 2_000_000),
      heartbeat(4, 4000, 300_000, 3_000_000),
      '[TC:TRACE:cpu-avg:main<=30]',
      '[TC:SUITE_END]',
    ]);
    const test = parseProtocolLinesWithTrace(lines)[0].tests[0];
    expect(test.assertions).toHaveLength(2);
    expect(test.assertions.find((a) => a.matcher === 'toBe')!.passed).toBe(true);
    expect(test.passed).toBe(true);
  });
});

describe('preprocessor — .trace() emission', () => {
  const SOURCE = `
import { describe, done } from '@typecad/hal/testing';
describe("budget")
  .it("cheap redraw").expect(1).toBe(1)
  .trace("cpu-avg:main<=30", 2500)
  .trace("frame-max<=20");
done();
`;

  it('emits the marker (colons preserved) and the dwell delay before it', () => {
    const out = preprocess(SOURCE);
    expect(out).toContain('[TC:TRACE:cpu-avg:main<=30]');
    expect(out).toContain('[TC:TRACE:frame-max<=20]');
    // The dwell reuses the shim's delay call with the given milliseconds.
    expect(out).toMatch(/k_msleep\(2500\)|delay\(2500\)/);
    // Dwell BEFORE its marker; the dwell-less trace emits no extra delay of its own.
    const dwellAt = out.search(/k_msleep\(2500\)|delay\(2500\)/);
    const markerAt = out.indexOf('[TC:TRACE:cpu-avg:main<=30]');
    expect(dwellAt).toBeGreaterThan(-1);
    expect(dwellAt).toBeLessThan(markerAt);
  });

  it('keeps the chain order: expect protocol then trace markers', () => {
    const out = preprocess(SOURCE);
    const expectAt = out.indexOf('[TC:EXPECT:');
    const traceAt = out.indexOf('[TC:TRACE:cpu-avg');
    expect(expectAt).toBeGreaterThan(-1);
    expect(expectAt).toBeLessThan(traceAt);
  });
});
