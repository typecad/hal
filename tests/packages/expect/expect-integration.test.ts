// ---------------------------------------------------------------------------
// Quick smoke test: verify the example hardware test preprocesses correctly
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { preprocess } from '../../../packages/expect/src/host/preprocessor';

// Inline copy of the (deleted) examples/09-expect-demo.test.ts — the reference
// @typecad/expect user-facing program. Kept here as the preprocessing fixture
// so the smoke test does not depend on the removed Arduino-era examples dir.
const exampleSource = `// ---------------------------------------------------------------------------
// Example: Hardware test file for @typecad/expect
//
// This file demonstrates the full user-facing API.  It reads analog pin A0
// and asserts the value using vitest-style fluent chaining.
// ---------------------------------------------------------------------------

import { describe, done } from '@typecad/expect';
import { A0, A1 } from '@typecad/board';

describe("A0 analog read")
  .it("reads a value in valid ADC range")
    .expect(A0.readAnalog()).toBeWithinRange(0, 1023)
  .it("reads less than mid-scale when grounded")
    .expect(A0.readAnalog()).toBeLessThan(512);

describe("A1 analog read")
  .it("returns a non-negative value")
    .expect(A1.readAnalog()).toBeGreaterThanOrEqual(0)
  .it("is within 10-bit ADC range")
    .expect(A1.readAnalog()).toBeLessThanOrEqual(1023);

done();
`;

describe('example test preprocessing', () => {
  it('preprocesses the example file correctly', () => {
    const result = preprocess(exampleSource, '09-expect-demo.test.ts');

    // Should have Serial preamble
    expect(result).toContain('__tc_println("[TC:SUITE_START]");');
    expect(result).toContain('[TC:SUITE_START]');

    // Should preserve non-expect imports
    expect(result).toContain("import { A0, A1 } from '@typecad/board'");
    expect(result).not.toContain("@typecad/expect");

    // Should have describe protocol lines
    expect(result).toContain('[TC:DESCRIBE:A0 analog read]');
    expect(result).toContain('[TC:DESCRIBE:A1 analog read]');

    // Should have it protocol lines
    expect(result).toContain('[TC:IT:reads a value in valid ADC range]');
    expect(result).toContain('[TC:IT:reads less than mid-scale when grounded]');
    expect(result).toContain('[TC:IT:returns a non-negative value]');
    expect(result).toContain('[TC:IT:is within 10-bit ADC range]');

    // Should have hoisted A0.readAnalog() calls
    expect(result).toMatch(/const __tc_v\d+: number = A0\.readAnalog\(\)/);
    expect(result).toMatch(/const __tc_v\d+: number = A1\.readAnalog\(\)/);

    // Should have correct matchers
    expect(result).toContain('[TC:EXPECT:toBeWithinRange:0,1023:');
    expect(result).toContain('[TC:EXPECT:toBeLessThan:512:');
    expect(result).toContain('[TC:EXPECT:toBeGreaterThanOrEqual:0:');
    expect(result).toContain('[TC:EXPECT:toBeLessThanOrEqual:1023:');

    // Should have SUITE_END and idle loop
    expect(result).toContain('[TC:SUITE_END]');
    expect(result).toContain('while (true)');
  });
});
