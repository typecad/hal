import { describe, done } from '@typecad/expect';
import { D2, D4 } from '@typecad/board';

// Advanced language features + hardware peripherals beyond the basics suite.
// Exercises patterns that ESP32-S3 users will commonly need.

// ──────────────────────────────────────────────────────────────────────────
// Arrays — typed arrays, indexing, iteration
// ──────────────────────────────────────────────────────────────────────────

describe("Arrays")
  .it("Uint8Array indexing")
  .expect((() => {
    const arr = new Uint8Array([0xAA, 0x10, 0x20, 0xFF]);
    return arr[0];
  })).toBe(0xAA)
  .expect((() => {
    const arr = new Uint8Array([0xAA, 0x10, 0x20, 0xFF]);
    return arr[3];
  })).toBe(0xFF)
  .it("Int16Array indexing")
  .expect((() => {
    const arr = new Int16Array([4, -2, 7]);
    return arr[1];
  })).toBe(-2)
  .it("Float32Array indexing")
  .expect((() => {
    const arr = new Float32Array([1.0, 0.5, 0.25]);
    return Math.trunc(arr[1] * 10);
  })).toBe(5)
  .it("array length")
  .expect((() => {
    const arr = new Uint8Array([1, 2, 3, 4, 5]);
    return arr.length;
  })).toBe(5)
  .it("array iteration sum")
  .expect((() => {
    const arr = new Uint8Array([10, 20, 30, 40]);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      sum += arr[i];
    }
    return sum;
  })).toBe(100)

// ──────────────────────────────────────────────────────────────────────────
// Control flow — if/else, for, while, switch
// ──────────────────────────────────────────────────────────────────────────

describe("Control flow")
  .it("if/else chain")
  .expect((() => {
    function classify(v: number): number {
      if (v < 0) return -1;
      else if (v === 0) return 0;
      else return 1;
    }
    return classify(-5) + classify(0) + classify(42);
  })).toBe(0)
  .it("for loop accumulation")
  .expect((() => {
    let sum = 0;
    for (let i = 1; i <= 10; i++) {
      sum += i;
    }
    return sum;
  })).toBe(55)
  .it("while loop with break")
  .expect((() => {
    let i = 0;
    let result = 0;
    while (true) {
      if (i >= 5) break;
      result += i;
      i++;
    }
    return result;
  })).toBe(10)
  .it("switch statement")
  .expect((() => {
    function dayType(d: number): number {
      switch (d) {
        case 0: return 0;
        case 6: return 0;
        default: return 1;
      }
    }
    return dayType(0) + dayType(3) + dayType(6);
  })).toBe(1)
  .it("nested loops")
  .expect((() => {
    let count = 0;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 4; j++) {
        count++;
      }
    }
    return count;
  })).toBe(12)

// ──────────────────────────────────────────────────────────────────────────
// Functions — default params, recursion
// ──────────────────────────────────────────────────────────────────────────

describe("Functions")
  .it("default parameters")
  .expect((() => {
    function clamp(value: number, min: number = 0, max: number = 1023): number {
      return Math.max(min, Math.min(max, value));
    }
    return clamp(2000, 0);
  })).toBe(1023)
  .it("recursive factorial")
  .expect((() => {
    function factorial(n: number): number {
      if (n <= 1) return 1;
      return n * factorial(n - 1);
    }
    return factorial(5);
  })).toBe(120)

// ──────────────────────────────────────────────────────────────────────────
// GPIO advanced — multi-pin operations, rapid toggle
// ──────────────────────────────────────────────────────────────────────────

describe("GPIO advanced")
  .it("rapid toggle on D2 without crashing (100 iterations)")
  .expect((() => {
    const out = D2.asOutput();
    for (let i = 0; i < 100; i++) {
      out.toggle();
    }
    return 1;
  })).toBe(1)
  .it("two independent output pins (D2 + D4)")
  .expect((() => {
    const a = D2.asOutput();
    const b = D4.asOutput();
    a.high();
    b.low();
    Timing.delayMicroseconds(100);
    a.low();
    b.high();
    return 1;
  })).toBe(1)
  .it("read-modify-write on D4 (input then output then input)")
  .expect((() => {
    const inp1 = D4.asInputPullUp();
    const v1 = inp1.read() ? 1 : 0;
    const out = D4.asOutput(1);
    Timing.delayMicroseconds(100);
    const inp2 = D4.asInput();
    const v2 = inp2.read() ? 1 : 0;
    return v1 + v2 >= 1 ? 1 : 0;
  })).toBe(1)

// ──────────────────────────────────────────────────────────────────────────
// Timing precision — micros accuracy, delay consistency
// ──────────────────────────────────────────────────────────────────────────

describe("Timing precision")
  .it("Timing.delayMicroseconds is roughly accurate (100us)")
  .expect((() => {
    const t0 = Timing.micros();
    Timing.delayMicroseconds(100);
    const elapsed = Timing.micros() - t0;
    return (elapsed >= 80 && elapsed <= 1000) ? 1 : 0;
  })).toBe(1)
  .it("Timing.delay(10) measured via millis is roughly accurate")
  .expect((() => {
    const t0 = Timing.millis();
    Timing.delay(10);
    const elapsed = Timing.millis() - t0;
    return (elapsed >= 8 && elapsed <= 50) ? 1 : 0;
  })).toBe(1)
  .it("esp_timer_get_time is monotonic across multiple reads")
  .expect((() => {
    const a = Timing.micros();
    const b = Timing.micros();
    const c = Timing.micros();
    return (b >= a && c >= b) ? 1 : 0;
  })).toBe(1)
  .it("Timing.freeHeap is consistent across reads")
  .expect((() => {
    const h1 = Timing.freeHeap();
    const h2 = Timing.freeHeap();
    const delta = h1 > h2 ? h1 - h2 : h2 - h1;
    return delta < 10000 ? 1 : 0;
  })).toBe(1)

// ──────────────────────────────────────────────────────────────────────────
// FreeRTOS — multitasking (the ESP-IDF advantage over AVR)
// ──────────────────────────────────────────────────────────────────────────

describe("FreeRTOS multitasking")
  .it("heap has sufficient memory for typical operations (>50KB free)")
  .expect((() => {
    const h = Timing.freeHeap();
    return h > 50000 ? 1 : 0;
  })).toBe(1)
  .it("Timing.millis works across delay calls of varying length")
  .expect((() => {
    const t0 = Timing.millis();
    Timing.delay(5);
    Timing.delay(5);
    Timing.delay(5);
    const elapsed = Timing.millis() - t0;
    return (elapsed >= 12 && elapsed <= 50) ? 1 : 0;
  })).toBe(1)

done();
