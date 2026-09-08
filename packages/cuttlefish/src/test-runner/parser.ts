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
//   [TC:SUITE_END]
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
  return ['SUITE_START', 'DESCRIBE', 'IT', 'EXPECT', 'SUITE_END'].includes(tag);
}

/**
 * Split field string into segments.
 *
 * For EXPECT lines, the format is `matcher:expected:actual` where the actual
 * value is everything after the last colon-separated segment.
 * For DESCRIBE/IT, there's only one field (the name).
 */
function splitFields(tag: ProtocolTag, rest: string): string[] {
  if (tag === 'DESCRIBE' || tag === 'IT') {
    return [rest]; // name may contain colons — treat as single field
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

function buildResults(lines: ProtocolLine[]): DescribeResult[] {
  const describes: DescribeResult[] = [];
  let currentDescribe: DescribeResult | null = null;
  let currentTest: TestResult | null = null;

  for (const line of lines) {
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
