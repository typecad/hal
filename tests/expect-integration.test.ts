// ---------------------------------------------------------------------------
// Quick smoke test: verify the example hardware test preprocesses correctly
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { preprocess } from '../packages/expect/src/host/preprocessor';
import fs from 'node:fs';
import path from 'node:path';

describe('example test preprocessing', () => {
  it('preprocesses the example file correctly', () => {
    const exampleSource = fs.readFileSync(
      path.join(__dirname, '..', 'examples', '09-expect-demo.test.ts'),
      'utf8',
    );

    const result = preprocess(exampleSource, '09-expect-demo.test.ts');

    // Should have Serial preamble
    expect(result).toContain('Serial.initialize({ baudRate: 115200 })');
    expect(result).toContain('[TC:SUITE_START]');

    // Should preserve non-expect imports
    expect(result).toContain("import { A0, A1 } from '@typecode'");
    expect(result).not.toContain("@typecode/expect");

    // Should have describe protocol lines
    expect(result).toContain('[TC:DESCRIBE:A0 analog read]');
    expect(result).toContain('[TC:DESCRIBE:A1 analog read]');

    // Should have it protocol lines
    expect(result).toContain('[TC:IT:reads a value in valid ADC range]');
    expect(result).toContain('[TC:IT:reads less than mid-scale when grounded]');
    expect(result).toContain('[TC:IT:returns a non-negative value]');
    expect(result).toContain('[TC:IT:is within 10-bit ADC range]');

    // Should have hoisted A0.read() calls
    expect(result).toMatch(/const __tc_v\d+: number = A0\.read\(\)/);
    expect(result).toMatch(/const __tc_v\d+: number = A1\.read\(\)/);

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
