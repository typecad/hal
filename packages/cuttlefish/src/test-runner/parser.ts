// ---------------------------------------------------------------------------
// cuttlefish test-runner — Protocol parser
//
// Parses protocol lines from serial output into structured test results.
//
// Protocol format:
//   [TC:SUITE_START]
//   [TC:DESCRIBE:name]
//   [TC:IT:name]
//   [TC:EXPECT:matcher:expected:actual]
//   [TC:TRACE:gate]          in-DSL trace assertion (host-evaluated)
//   [TC:SUITE_END]
//
// In-DSL trace assertions: the device emits [TC:TRACE:<gate>] at the
// assertion point; the interleaved [TR: heartbeat lines feed the shared
// TraceLineParser in arrival order, and the host evaluates the gate (the
// trace-gate grammar: cpu-avg:main<=30, frame-max<=20, ...) over the
// heartbeats that closed inside the enclosing it(). The device does not
// wait for a verdict — the assertion lands as an ordinary (precomputed)
// test result.
// ---------------------------------------------------------------------------

import type {
  ProtocolLine,
  ProtocolTag,
  DescribeResult,
  TestResult,
  AssertionResult,
  MatcherName,
} from './types.js';
import { evaluate } from './evaluator.js';
import { TraceLineParser } from '../trace/protocol.js';
import { buildTraceReport, evaluateGates } from '../trace/report.js';
import type { TraceCapture, TraceSample } from '../trace/types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse raw protocol lines into structured describe/test/assertion results.
 */
export function parseProtocolLines(rawLines: string[]): DescribeResult[] {
  const lines = rawLines.map(parseSingleLine).filter(Boolean) as ProtocolLine[];
  return buildResults(lines);
}

/**
 * Parse an arrival-ordered serial stream — [TC: protocol AND [TR: trace lines
 * interleaved — evaluating in-DSL trace assertions against the heartbeats
 * that closed inside each it(). This is the runner's entry point; the
 * trace-less variant stays for callers holding protocol lines only.
 */
export function parseProtocolLinesWithTrace(allLines: string[]): DescribeResult[] {
  const traceParser = new TraceLineParser();
  const lines: ProtocolLine[] = [];
  // Heartbeat watermarks at the arrival of each protocol line. The IT bound
  // uses OPENED groups (a sample belongs to a test when its heartbeat
  // arrived inside it); the TRACE bound uses CLOSED groups (an unclosed
  // group's interval extends past the assertion point).
  const watermarks: Array<{ opened: number; closed: number }> = [];
  let sawTraceWire = false;
  for (const raw of allLines) {
    if (raw.trim().startsWith('[TR:')) {
      traceParser.feed(raw);
      sawTraceWire = true;
      continue;
    }
    const parsed = parseSingleLine(raw);
    if (parsed !== null) {
      lines.push(parsed);
      watermarks.push({ opened: traceParser.openedCount, closed: traceParser.sampleCount });
    }
  }
  return buildResults(lines, {
    watermarks,
    closedSamples: () => traceParser.snapshot(),
    sawTraceWire,
  });
}

// ---------------------------------------------------------------------------
// Internal — Line parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single protocol line into its tag and fields.
 *
 * Format: `[TC:TAG:field1:field2:...]`
 *
 * The last field of EXPECT lines may contain colons (e.g. string values),
 * so we parse carefully.
 */
function parseSingleLine(raw: string): ProtocolLine | null {
  // Strip brackets: "[TC:..." → "TC:..."
  const inner = raw.replace(/^\[/, '').replace(/\]$/, '');
  if (!inner.startsWith('TC:')) return null;

  // Split on first `:` after `TC` to get the tag
  const withoutPrefix = inner.slice(3); // remove "TC:"
  const colonIdx = withoutPrefix.indexOf(':');

  let tag: string;
  let rest: string;

  if (colonIdx === -1) {
    tag = withoutPrefix;
    rest = '';
  } else {
    tag = withoutPrefix.slice(0, colonIdx);
    rest = withoutPrefix.slice(colonIdx + 1);
  }

  if (!isValidTag(tag)) return null;

  const fields = rest.length > 0 ? splitFields(tag as ProtocolTag, rest) : [];

  return { tag: tag as ProtocolTag, fields, raw };
}

function isValidTag(tag: string): tag is ProtocolTag {
  return ['SUITE_START', 'DESCRIBE', 'IT', 'EXPECT', 'TRACE', 'SUITE_END'].includes(tag);
}

/**
 * Split field string into segments.
 *
 * For EXPECT lines, the format is `matcher:expected:actual` where the actual
 * value is everything after the last colon-separated segment.
 * For DESCRIBE/IT, there's only one field (the name).
 */
function splitFields(tag: ProtocolTag, rest: string): string[] {
  if (tag === 'DESCRIBE' || tag === 'IT' || tag === 'TRACE') {
    return [rest]; // name/gate may contain colons — treat as single field
  }

  if (tag === 'EXPECT') {
    // Format: matcher:expected:actual
    // matcher is always a single word, expected may contain commas (for range)
    // actual is the last segment (everything after the last unescaped colon)
    return splitExpectFields(rest);
  }

  return rest.split(':');
}

/**
 * Split EXPECT fields: `toBe:0:11` → ['toBe', '0', '11']
 *
 * We know the structure: matcher is first, then expected value(s), then actual
 * value as the final segment.
 */
function splitExpectFields(rest: string): string[] {
  const parts = rest.split(':');
  if (parts.length < 3) return parts;

  // First part is the matcher name
  const matcher = parts[0];
  // Last part is the actual value
  const actual = parts[parts.length - 1];
  // Everything in between is the expected value (may have been split on : if
  // it contained colons, so rejoin)
  const expected = parts.slice(1, -1).join(':');

  return [matcher, expected, actual];
}

// ---------------------------------------------------------------------------
// Internal — Result building
// ---------------------------------------------------------------------------

/** Trace context for buildResults: per-protocol-line heartbeat watermarks
 *  (arrival-ordered), the closed samples, and whether any [TR: line arrived
 *  at all (an untraced test firmware fails trace gates with the remedy). */
interface TraceContext {
  watermarks: Array<{ opened: number; closed: number }>;
  closedSamples: () => TraceSample[];
  sawTraceWire: boolean;
}

function buildResults(lines: ProtocolLine[], trace?: TraceContext): DescribeResult[] {
  const describes: DescribeResult[] = [];
  let currentDescribe: DescribeResult | null = null;
  let currentTest: TestResult | null = null;
  let itWatermark = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    switch (line.tag) {
      case 'SUITE_START':
        // No-op — we already know we're starting
        break;

      case 'DESCRIBE': {
        // Close previous test + describe if open
        if (currentTest && currentDescribe) {
          finalizeTest(currentTest);
          currentDescribe.tests.push(currentTest);
          currentTest = null;
        }
        if (currentDescribe) {
          finalizeDescribe(currentDescribe);
          describes.push(currentDescribe);
        }
        currentDescribe = {
          name: line.fields[0] ?? 'unnamed',
          tests: [],
          passed: true,
        };
        break;
      }

      case 'IT': {
        // Close previous test if open
        if (currentTest && currentDescribe) {
          finalizeTest(currentTest);
          currentDescribe.tests.push(currentTest);
        }
        currentTest = {
          name: line.fields[0] ?? 'unnamed',
          assertions: [],
          passed: true,
          durationMs: 0,
        };
        itWatermark = trace !== undefined ? (trace.watermarks[lineIdx]?.opened ?? 0) : 0;
        break;
      }

      case 'TRACE': {
        if (!currentTest) break; // TRACE outside of IT — nothing to attach to
        if (trace === undefined) break; // protocol-lines-only caller: no heartbeats to evaluate over
        // The asserted window: samples whose heartbeat arrived after the
        // it() opened (opened-bound; a heartbeat inside the test owns its
        // interval even though the NEXT heartbeat closes it later) and
        // which closed before this assertion point.
        const end = trace.watermarks[lineIdx]?.closed ?? 0;
        const section = trace.closedSamples().slice(itWatermark, end);
        currentTest.assertions.push(evaluateTraceGate(line.fields[0] ?? '', section, trace.sawTraceWire));
        break;
      }

      case 'EXPECT': {
        if (!currentTest) {
          // EXPECT outside of IT — create an implicit test
          currentTest = {
            name: '(implicit)',
            assertions: [],
            passed: true,
            durationMs: 0,
          };
        }
        const [matcher, expected, actual] = line.fields;
        if (matcher) {
          const assertion: AssertionResult = {
            matcher: matcher as MatcherName,
            expected: expected ?? '',
            actual: actual ?? '',
            passed: evaluate(matcher as MatcherName, expected ?? '', actual ?? ''),
          };
          currentTest.assertions.push(assertion);
        }
        break;
      }

      case 'SUITE_END': {
        if (currentTest && currentDescribe) {
          finalizeTest(currentTest);
          currentDescribe.tests.push(currentTest);
          currentTest = null;
        }
        if (currentDescribe) {
          finalizeDescribe(currentDescribe);
          describes.push(currentDescribe);
          currentDescribe = null;
        }
        break;
      }
    }
  }

  // Handle unterminated groups
  if (currentTest && currentDescribe) {
    finalizeTest(currentTest);
    currentDescribe.tests.push(currentTest);
  }
  if (currentDescribe) {
    finalizeDescribe(currentDescribe);
    describes.push(currentDescribe);
  }

  return describes;
}

function finalizeTest(test: TestResult): void {
  test.passed = test.assertions.every(a => a.passed);
}

function finalizeDescribe(desc: DescribeResult): void {
  desc.passed = desc.tests.every(t => t.passed);
}


// ---------------------------------------------------------------------------
// In-DSL trace assertion evaluation
// ---------------------------------------------------------------------------

/** Evaluate one trace gate over the heartbeats that closed inside the test.
 *  Never throws — an authoring error (malformed gate) or an unsampleable
 *  window is a failed assertion with the remedy, not a crashed run. */
function evaluateTraceGate(gate: string, section: TraceSample[], sawTraceWire: boolean): AssertionResult {
  const fail = (actual: string): AssertionResult => ({ matcher: 'traceGate', expected: gate, actual, passed: false });
  if (!sawTraceWire) {
    return fail('no [TR: heartbeat lines on the wire — build the test firmware with zephyr.trace: { enabled: true }');
  }
  if (section.length < 2) {
    return fail(
      `only ${section.length} heartbeat${section.length === 1 ? '' : 's'} closed inside the test — dwell before the assertion (.trace(gate, ms)) or lower zephyr.trace.intervalMs`,
    );
  }
  const capture: TraceCapture = {
    schema: 'typecad-hal/trace@1',
    capturedAt: '',
    port: '',
    baudRate: 115200,
    intervalMs: null,
    samples: section,
  };
  try {
    const report = buildTraceReport(capture);
    const result = evaluateGates(report, [gate]);
    const intervals = section.length - 1;
    return {
      matcher: 'traceGate',
      expected: gate,
      actual: `${describeGate(gate, report)} (over ${intervals} interval${intervals === 1 ? '' : 's'})`,
      passed: result.pass,
    };
  } catch (err) {
    return fail(`gate error: ${(err as Error).message}`);
  }
}

/** The gate's actual value(s) from the section report, for the failure
 *  message — "main: avg 32.1%, max 35.0%" answers what the gate saw. */
function describeGate(gate: string, report: ReturnType<typeof buildTraceReport>): string {
  const m = /^(cpu-avg|cpu-max|frame-max|stack-min)(?::([A-Za-z0-9_.-]+))?/.exec(gate);
  if (m === null) return 'unknown metric';
  const [, metric, thread] = m;
  if (metric === 'frame-max') {
    return report.ui !== undefined ? `worst frame ${report.ui.maxFrameMs} ms` : 'no UI frames';
  }
  const row = report.threads.find((t) => t.name === thread);
  if (row === undefined) return `thread '${thread ?? ''}' absent from the section`;
  if (metric === 'stack-min') {
    return row.stackMinUnusedBytes !== null ? `${row.name} headroom ${row.stackMinUnusedBytes} B` : `${row.name} headroom unknown`;
  }
  const v = metric === 'cpu-avg' ? row.cpuAvgPct : row.cpuMaxPct;
  return `${row.name}: avg ${row.cpuAvgPct ?? '—'}%, max ${row.cpuMaxPct ?? '—'}%`;
}
