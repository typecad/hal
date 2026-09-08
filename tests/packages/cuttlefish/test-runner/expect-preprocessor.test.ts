// ---------------------------------------------------------------------------
// Unit tests for @typecad/hal/testing — Preprocessor
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { preprocess } from '../../../../packages/cuttlefish/src/test-runner/preprocessor';

describe('preprocessor', () => {
  it('strips @typecad/hal/testing imports', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
import { A0 } from '@typecad/hal';
done();
`;
    const result = preprocess(source);
    expect(result).not.toContain("@typecad/hal/testing");
    expect(result).toContain("@typecad/hal");
  });

  it('preserves non-expect imports', () => {
    const source = `
import { A0 } from '@typecad/hal';
import { describe, done } from '@typecad/hal/testing';
done();
`;
    const result = preprocess(source);
    expect(result).toContain("import { A0 } from '@typecad/hal'");
  });

  it('synthesizes a @typecad/hal import for substituted test pins', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
describe("Basics")
  .it("led")
    .expect(LED_PIN.read()).toBe(1);
done();
`;
    const substitutions = new Map([['LED_PIN', 'PB5']]);
    const result = preprocess(source, 'test.ts', { testPins: substitutions });
    // The role const is replaced by the board pin symbol and the pin's
    // import is synthesized from the user-facing specifier.
    expect(result).toContain("import { PB5 } from '@typecad/hal';");
    expect(result).toContain('PB5.read()');
    expect(result).not.toContain('LED_PIN');
  });

  it('emits the protocol preamble', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
done();
`;
    const result = preprocess(source);
    expect(result).toContain('__tc_println("[TC:SUITE_START]");');
    expect(result).toContain('[TC:SUITE_START]');
  });

  it('transforms describe() to protocol line', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
describe("A0 analog read")
  .it("reads zero")
    .expect(0).toBe(0);
done();
`;
    const result = preprocess(source);
    expect(result).toContain('[TC:DESCRIBE:A0 analog read]');
  });

  it('transforms .it() to protocol line', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
describe("group")
  .it("test name")
    .expect(42).toBe(42);
done();
`;
    const result = preprocess(source);
    expect(result).toContain('[TC:IT:test name]');
  });

  it('transforms .expect(value).toBe(expected) to protocol lines', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
describe("group")
  .it("test")
    .expect(42).toBe(0);
done();
`;
    const result = preprocess(source);
    expect(result).toContain('[TC:EXPECT:toBe:0:');
    expect(result).toContain('__tc_print(42)');
  });

  it('hoists complex expressions into const declarations', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
import { A0 } from '@typecad/hal';
describe("analog")
  .it("reads")
    .expect(A0.read()).toBe(0);
done();
`;
    const result = preprocess(source);
    // Should hoist A0.read() to a const
    expect(result).toMatch(/const __tc_v\d+: number = A0\.read\(\)/);
    // Should use the hoisted variable in the protocol print
    expect(result).toMatch(/__tc_print\(__tc_v\d+\)/);
  });

  it('does not hoist simple expressions', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
describe("group")
  .it("test")
    .expect(42).toBe(42);
done();
`;
    const result = preprocess(source);
    // Simple number literal should be inlined
    expect(result).not.toMatch(/const __tc_v/);
    expect(result).toContain('__tc_print(42)');
  });

  it('transforms done() to SUITE_END + idle loop', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
done();
`;
    const result = preprocess(source);
    expect(result).toContain('[TC:SUITE_END]');
    expect(result).toContain('while (true)');
  });

  it('handles multiple describe chains', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
describe("group1")
  .it("test1").expect(1).toBe(1);
describe("group2")
  .it("test2").expect(2).toBe(2);
done();
`;
    const result = preprocess(source);
    expect(result).toContain('[TC:DESCRIBE:group1]');
    expect(result).toContain('[TC:DESCRIBE:group2]');
    expect(result).toContain('[TC:IT:test1]');
    expect(result).toContain('[TC:IT:test2]');
  });

  it('handles multiple it() calls in one chain', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
describe("group")
  .it("first").expect(1).toBe(1)
  .it("second").expect(2).toBe(2);
done();
`;
    const result = preprocess(source);
    expect(result).toContain('[TC:IT:first]');
    expect(result).toContain('[TC:IT:second]');
  });

  it('transforms toBeLessThan matcher', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
describe("group")
  .it("test").expect(10).toBeLessThan(100);
done();
`;
    const result = preprocess(source);
    expect(result).toContain('[TC:EXPECT:toBeLessThan:100:');
  });

  it('transforms toBeGreaterThan matcher', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
describe("group")
  .it("test").expect(50).toBeGreaterThan(10);
done();
`;
    const result = preprocess(source);
    expect(result).toContain('[TC:EXPECT:toBeGreaterThan:10:');
  });

  it('transforms toBeWithinRange matcher with two args', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
describe("group")
  .it("test").expect(25).toBeWithinRange(20, 30);
done();
`;
    const result = preprocess(source);
    expect(result).toContain('[TC:EXPECT:toBeWithinRange:20,30:');
  });

  it('transforms toBeTruthy matcher (no args)', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
describe("group")
  .it("test").expect(1).toBeTruthy();
done();
`;
    const result = preprocess(source);
    expect(result).toContain('[TC:EXPECT:toBeTruthy:');
  });

  it('preserves non-test statements', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
import { A0 } from '@typecad/hal';
const x: number = 42;
describe("group")
  .it("test").expect(x).toBe(42);
done();
`;
    const result = preprocess(source);
    expect(result).toContain('const x: number = 42');
  });

  it('handles toBeCloseTo with precision', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
describe("group")
  .it("test").expect(3).toBeCloseTo(3, 2);
done();
`;
    const result = preprocess(source);
    expect(result).toContain('[TC:EXPECT:toBeCloseTo:3,2:');
  });

  it('extracts arrow function with block body from expect()', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
describe("Variables and Scoping")
  .it("const and let assignment")
    .expect(() => {
      const fixed = 10;
      let mutable = 5;
      mutable += fixed;
      return mutable;
    }).toBe(15);
done();
`;
    const result = preprocess(source);
    // Should emit a named function definition
    expect(result).toMatch(/function __tc_fn\d+\(\): number \{/);
    expect(result).toContain('const fixed = 10');
    expect(result).toContain('let mutable = 5');
    expect(result).toContain('mutable += fixed');
    expect(result).toContain('return mutable');
    // Should call the named function as the actual value (inlined since it's a simple call)
    expect(result).toMatch(/__tc_print\(__tc_fn\d+\(\)\)/);
    // The matcher protocol should be present
    expect(result).toContain('[TC:EXPECT:toBe:15:');
  });

  it('extracts arrow function with expression body from expect()', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
describe("group")
  .it("test")
    .expect(() => 1 + 2).toBe(3);
done();
`;
    const result = preprocess(source);
    // Expression body should be wrapped in { return ...; }
    expect(result).toMatch(/function __tc_fn\d+\(\): number \{ return 1 \+ 2; \}/);
    expect(result).toContain('[TC:EXPECT:toBe:3:');
  });

  it('extracts function expression from expect()', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
describe("group")
  .it("test")
    .expect(function () { const x = 5; return x * 2; }).toBe(10);
done();
`;
    const result = preprocess(source);
    expect(result).toMatch(/function __tc_fn\d+\(\): number \{/);
    expect(result).toContain('const x = 5');
    expect(result).toContain('return x * 2');
    expect(result).toContain('[TC:EXPECT:toBe:10:');
  });

  it('extracts IIFE arrow function from expect()', () => {
    const source = `
import { describe, done } from '@typecad/hal/testing';
describe("Variables and Scoping")
  .it("const and let assignment")
    .expect(
      (() => {
        const fixed = 10;
        let mutable = 5;
        mutable += fixed;
        return mutable;
      })()
    ).toBe(15);
done();
`;
    const result = preprocess(source);
    expect(result).toMatch(/function __tc_fn\d+\(\): number \{/);
    expect(result).toContain('const fixed = 10');
    expect(result).toContain('mutable += fixed');
    expect(result).toMatch(/__tc_print\(__tc_fn\d+\(\)\)/);
    expect(result).toContain('[TC:EXPECT:toBe:15:');
    // Must NOT contain the raw IIFE in __tc_print
    expect(result).not.toContain('__tc_print((() =>');
  });
});
