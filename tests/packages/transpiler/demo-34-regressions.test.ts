import { describe, it, expect } from "vitest";
import { transpile, transpileAVR, transpileNative } from "../../setup";

// ── D: inline ternary of two string literals as a `+` operand ───────────────
// A ternary whose two branches are string literals must infer `const char*`
// (what it renders as), NOT `std::string`, so the concat/snprintf path does
// not wrap it in an invalid `.c_str()`.
describe("D: inline ternary of string literals in concat", () => {
  it("compiles 'x=' + (cond ? 'a' : 'b') without an invalid .c_str()", () => {
    const src = `
function tag(on: boolean): string {
  return 'x=' + (on ? 'a' : 'b');
}
console.log(tag(true));
`;
    const res = transpile(src, { target: "arduino" });
    // The invalid form was `(on ? "a" : "b").c_str()`; it must not appear.
    expect(res.cpp).not.toMatch(/\)\.c_str\(\)/);
    // The ternary should render as a bare conditional, fed straight to snprintf.
    expect(res.cpp).toMatch(/\(on \? "a" : "b"\)/);
  });
});

// ── A: heap-allocation-avr detection is independent of HAL imports ──────────
// `new MyClass()` on AVR must be flagged whether or not a HAL/board import is
// present. Today the no-import case is silently allowed (the gate keys off
// `raw` IR text whose presence depends on import structure).
describe("A: heap-allocation-avr detected regardless of HAL import", () => {
  it("flags new Blinker() WITHOUT a HAL import (currently silently allowed)", () => {
    const src = `
class Blinker { on: boolean; constructor() { this.on = false; } }
function run(): void { const b: Blinker = new Blinker(); }
run();
`;
    const res = transpileAVR(src);
    const errs = res.diagnostics.filter(d => d.code === "heap-allocation-avr");
    expect(errs.length).toBeGreaterThanOrEqual(1);
  });

  it("flags new Blinker() WITH a HAL import (already worked)", () => {
    const src = `
import { LED } from '@typecad/board-arduino-uno';
class Blinker { on: boolean; constructor() { this.on = false; } }
const led = LED.asOutput();
function run(): void { const b: Blinker = new Blinker(); }
run();
`;
    const res = transpileAVR(src);
    const errs = res.diagnostics.filter(d => d.code === "heap-allocation-avr");
    expect(errs.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flag new on native (heap is safe there)", () => {
    const src = `
class Blinker { on: boolean; constructor() { this.on = false; } }
function run(): void { const b: Blinker = new Blinker(); }
run();
`;
    const res = transpileNative(src);
    const errs = res.diagnostics.filter(d => d.code === "heap-allocation-avr");
    expect(errs).toEqual([]);
  });
});
