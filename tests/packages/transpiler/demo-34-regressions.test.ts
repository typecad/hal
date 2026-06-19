import { describe, it, expect } from "vitest";
import { transpile, transpileAVR, transpileNative, transpileArduino } from "../../setup";

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
// ── A: heap-allocation-avr is a WARNING (not an error) on AVR ───────────────
// `new`/`delete` ARE supported on the Arduino AVR core (it ships operator
// new/delete over avr-libc malloc/free — a real heap). The gate is a capacity
// heads-up (small heap ~1.5-1.8 KB), NOT a correctness refusal. It must fire
// as a WARNING regardless of HAL import structure (demo #34 Finding A made
// detection import-independent; demo #36 downgraded it from error to warning
// after verifying new+inheritance compiles and runs on the Uno).
describe("A: heap-allocation-avr fires as a warning regardless of HAL import", () => {
  it("warns about new Blinker() WITHOUT a HAL import", () => {
    const src = `
class Blinker { on: boolean; constructor() { this.on = false; } }
function run(): void { const b: Blinker = new Blinker(); }
run();
`;
    const res = transpileAVR(src);
    const diags = res.diagnostics.filter(d => d.code === "heap-allocation-avr");
    expect(diags.length).toBeGreaterThanOrEqual(1);
    // Must be a WARNING, not a hard error — new is valid on AVR.
    expect(diags[0].severity).toBe("warning");
  });

  it("warns about new Blinker() WITH a HAL import", () => {
    const src = `
import { LED } from '@typecad/board-arduino-uno';
class Blinker { on: boolean; constructor() { this.on = false; } }
const led = LED.asOutput();
function run(): void { const b: Blinker = new Blinker(); }
run();
`;
    const res = transpileAVR(src);
    const diags = res.diagnostics.filter(d => d.code === "heap-allocation-avr");
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].severity).toBe("warning");
  });

  it("does NOT warn on native (heap is ample there)", () => {
    const src = `
class Blinker { on: boolean; constructor() { this.on = false; } }
function run(): void { const b: Blinker = new Blinker(); }
run();
`;
    const res = transpileNative(src);
    const diags = res.diagnostics.filter(d => d.code === "heap-allocation-avr");
    expect(diags).toEqual([]);
  });
});

// ── C: pin method call from a function resolves regardless of declaration order
// HAL resolution is order-dependent today: a function body lowered before the
// `const led = LED.asOutput()` that registers `led` fails to inline and emits
// `led.high()` verbatim (avr-g++: 'led' was not declared in this scope).
describe("C: pin call from a function resolves regardless of declaration order", () => {
  it("inlines led.high() when the function is declared AFTER const led (already worked)", () => {
    const src = `
import { LED } from '@typecad/board-arduino-uno';
const led = LED.asOutput();
function driveLed(): void { led.high(); }
driveLed();
`;
    const res = transpileArduino(src);
    expect(res.cpp).toContain("digitalWrite(13, HIGH)");
  });

  it("inlines led.high() when the function is declared BEFORE const led (currently fails)", () => {
    const src = `
import { LED } from '@typecad/board-arduino-uno';
function driveLed(): void { led.high(); }
const led = LED.asOutput();
driveLed();
`;
    const res = transpileArduino(src);
    // Must inline — NOT emit the bare `led.high()` that references a
    // non-existent C++ variable.
    expect(res.cpp).toContain("digitalWrite(13, HIGH)");
    expect(res.cpp).not.toMatch(/\bled\.high\(\)/);
  });
});

// ── B: storing the return of a pin read captures the real value ────────────
// `const v = adc.readAnalog()` must emit `auto v = analogRead(14)` and
// reference `v` at use sites. Today the read is dropped and every use of `v`
// becomes the pin number `14` (the variable is wrongly registered as the pin
// instance).
describe("B: stored pin-method return value is captured, not substituted with the pin number", () => {
  it("emits auto v = analogRead(14) and references v", () => {
    const src = `
import { A0 } from '@typecad/board-arduino-uno';
const adc = A0.asInput();
const v: int32_t = adc.readAnalog();
console.log('' + v);
`;
    const res = transpileArduino(src);
    // The read must be captured into the variable.
    expect(res.cpp).toMatch(/auto v = analogRead\(14\)/);
    // The use site must reference `v`, NOT the literal pin number 14.
    expect(res.cpp).not.toMatch(/"%d", 14/);
  });

  it("a reassigned stored read keeps using the variable", () => {
    const src = `
import { A0 } from '@typecad/board-arduino-uno';
const adc = A0.asInput();
let v: int32_t = adc.readAnalog();
v = v + 1;
console.log('' + v);
`;
    const res = transpileArduino(src);
    expect(res.cpp).toMatch(/(auto|int32_t) v = analogRead\(14\)/);
    // `v + 1` must stay `v + 1`, not become `14 + 1`.
    expect(res.cpp).not.toMatch(/14 \+ 1/);
  });
});
