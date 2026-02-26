// ---------------------------------------------------------------------------
// Unit tests for @typecode/expect — Protocol parser
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { parseProtocolLines } from '../packages/expect/src/host/parser';

describe('parser', () => {
  it('parses a minimal test suite', () => {
    const lines = [
      '[TC:SUITE_START]',
      '[TC:DESCRIBE:A0 reads]',
      '[TC:IT:reads zero]',
      '[TC:EXPECT:toBe:0:0]',
      '[TC:SUITE_END]',
    ];
    const result = parseProtocolLines(lines);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('A0 reads');
    expect(result[0].tests).toHaveLength(1);
    expect(result[0].tests[0].name).toBe('reads zero');
    expect(result[0].tests[0].assertions).toHaveLength(1);
    expect(result[0].tests[0].assertions[0].matcher).toBe('toBe');
    expect(result[0].tests[0].assertions[0].expected).toBe('0');
    expect(result[0].tests[0].assertions[0].actual).toBe('0');
    expect(result[0].tests[0].assertions[0].passed).toBe(true);
  });

  it('detects failing assertion', () => {
    const lines = [
      '[TC:SUITE_START]',
      '[TC:DESCRIBE:test]',
      '[TC:IT:fails]',
      '[TC:EXPECT:toBe:0:42]',
      '[TC:SUITE_END]',
    ];
    const result = parseProtocolLines(lines);

    expect(result[0].tests[0].assertions[0].passed).toBe(false);
    expect(result[0].tests[0].passed).toBe(false);
    expect(result[0].passed).toBe(false);
  });

  it('handles multiple describes', () => {
    const lines = [
      '[TC:SUITE_START]',
      '[TC:DESCRIBE:group1]',
      '[TC:IT:test1]',
      '[TC:EXPECT:toBe:1:1]',
      '[TC:DESCRIBE:group2]',
      '[TC:IT:test2]',
      '[TC:EXPECT:toBe:2:2]',
      '[TC:SUITE_END]',
    ];
    const result = parseProtocolLines(lines);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('group1');
    expect(result[1].name).toBe('group2');
  });

  it('handles multiple it() in one describe', () => {
    const lines = [
      '[TC:SUITE_START]',
      '[TC:DESCRIBE:group]',
      '[TC:IT:first]',
      '[TC:EXPECT:toBe:1:1]',
      '[TC:IT:second]',
      '[TC:EXPECT:toBe:2:2]',
      '[TC:SUITE_END]',
    ];
    const result = parseProtocolLines(lines);

    expect(result[0].tests).toHaveLength(2);
    expect(result[0].tests[0].name).toBe('first');
    expect(result[0].tests[1].name).toBe('second');
  });

  it('handles multiple assertions per test', () => {
    const lines = [
      '[TC:SUITE_START]',
      '[TC:DESCRIBE:group]',
      '[TC:IT:multi]',
      '[TC:EXPECT:toBe:0:0]',
      '[TC:EXPECT:toBeLessThan:100:50]',
      '[TC:EXPECT:toBeGreaterThan:10:50]',
      '[TC:SUITE_END]',
    ];
    const result = parseProtocolLines(lines);

    expect(result[0].tests[0].assertions).toHaveLength(3);
    expect(result[0].tests[0].assertions[0].matcher).toBe('toBe');
    expect(result[0].tests[0].assertions[1].matcher).toBe('toBeLessThan');
    expect(result[0].tests[0].assertions[2].matcher).toBe('toBeGreaterThan');
    expect(result[0].tests[0].passed).toBe(true);
  });

  it('parses toBeWithinRange with comma-separated expected', () => {
    const lines = [
      '[TC:SUITE_START]',
      '[TC:DESCRIBE:group]',
      '[TC:IT:range]',
      '[TC:EXPECT:toBeWithinRange:20,30:25]',
      '[TC:SUITE_END]',
    ];
    const result = parseProtocolLines(lines);

    const assertion = result[0].tests[0].assertions[0];
    expect(assertion.matcher).toBe('toBeWithinRange');
    expect(assertion.expected).toBe('20,30');
    expect(assertion.actual).toBe('25');
    expect(assertion.passed).toBe(true);
  });

  it('parses toBeTruthy with empty expected', () => {
    const lines = [
      '[TC:SUITE_START]',
      '[TC:DESCRIBE:group]',
      '[TC:IT:truthy]',
      '[TC:EXPECT:toBeTruthy::42]',
      '[TC:SUITE_END]',
    ];
    const result = parseProtocolLines(lines);

    const assertion = result[0].tests[0].assertions[0];
    expect(assertion.matcher).toBe('toBeTruthy');
    expect(assertion.actual).toBe('42');
    expect(assertion.passed).toBe(true);
  });

  it('handles missing SUITE_END gracefully', () => {
    const lines = [
      '[TC:SUITE_START]',
      '[TC:DESCRIBE:group]',
      '[TC:IT:test]',
      '[TC:EXPECT:toBe:1:1]',
    ];
    const result = parseProtocolLines(lines);

    expect(result).toHaveLength(1);
    expect(result[0].tests).toHaveLength(1);
  });

  it('ignores non-protocol lines', () => {
    const lines = [
      'some debug output',
      '[TC:SUITE_START]',
      '[TC:DESCRIBE:group]',
      'more debug',
      '[TC:IT:test]',
      '[TC:EXPECT:toBe:1:1]',
      '[TC:SUITE_END]',
    ];
    // Non-protocol lines are already filtered by serial reader,
    // but parser should handle them gracefully
    const result = parseProtocolLines(lines);

    expect(result).toHaveLength(1);
  });

  it('describe is marked passed when all tests pass', () => {
    const lines = [
      '[TC:SUITE_START]',
      '[TC:DESCRIBE:group]',
      '[TC:IT:a]',
      '[TC:EXPECT:toBe:1:1]',
      '[TC:IT:b]',
      '[TC:EXPECT:toBe:2:2]',
      '[TC:SUITE_END]',
    ];
    const result = parseProtocolLines(lines);
    expect(result[0].passed).toBe(true);
  });

  it('describe is marked failed when any test fails', () => {
    const lines = [
      '[TC:SUITE_START]',
      '[TC:DESCRIBE:group]',
      '[TC:IT:a]',
      '[TC:EXPECT:toBe:1:1]',
      '[TC:IT:b]',
      '[TC:EXPECT:toBe:2:99]',
      '[TC:SUITE_END]',
    ];
    const result = parseProtocolLines(lines);
    expect(result[0].passed).toBe(false);
    expect(result[0].tests[0].passed).toBe(true);
    expect(result[0].tests[1].passed).toBe(false);
  });
});
