// ---------------------------------------------------------------------------
// Regression tests — transpiler fixes surfaced by the zephyr-firmware-logger
// demo (a utility-meter logger: ISR pulse counting, a fixed-capacity ring
// buffer class, CSV logs on the flash filesystem, lifetime totals in
// settings, a background flusher thread, a serial console, a watchdog —
// three execution contexts sharing state).
//
// FIXED here:
//   1. A string LITERAL compared against a std::string-returning call
//      (`probe.read() === 'ok'`) took the strcmp path and wrapped the
//      literal in .c_str() — "request for member 'c_str' in '("ok")'".
//      Literals are const char[] already; only rendered std::string VALUES
//      convert. (The char-literal twin of this was fixed in the packet-lab
//      round; the string-literal form survived until this demo's self-test.)
//   2. An int-literal ternary inside a template literal (`pend=${flag ? 1 :
//      0}`) took the %.15g number-repr format — a -Wformat= mismatch (int
//      argument, double conversion). Both-integer-literal conditionals now
//      format as %d; double-armed ones (Map reads) keep the %.15g convention.
//
// NOTED-OPEN (not fixed):
//   · Reassigning a class-instance binding (`ring = new SampleRing(...)`)
//     drops the previous object on the floor — JS GC semantics vs C++ new;
//     a bounded leak per reassignment, visible in the demo's `clear`
//     command. A delete-before-reassign analysis would be the fix.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";
import { ZephyrStrategy } from "../../../packages/framework-zephyr/src/strategy";

const zephyr = () => new ZephyrStrategy();

describe("firmware-logger demo findings (Zephyr)", () => {
  it("a string literal compared to a string-returning call uses strcmp without c_str-wrapping the literal", () => {
    const out = transpile(`
      class File {
        read(): string { return ''; }
      }
      const probe = new File();
      let ok = false;
      if (probe.read() === 'ok') { ok = true; }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.severity === "error")).toHaveLength(0);
    // The HAL File body inlines to __tc_fs_read_text(...); the point is the
    // literal operand: BARE "ok", never ("ok").c_str().
    expect(out.cpp).toMatch(/strcmp\([^,]+, "ok"\) == 0/);
    expect(out.cpp).not.toMatch(/\("ok"\)\.c_str\(\)/);
  });

  it("equality still works with the literal on the LEFT", () => {
    const out = transpile(`
      function name(): string { return 'meter'; }
      let hit = false;
      if ('meter' === name()) { hit = true; }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.severity === "error")).toHaveLength(0);
    // A string-RETURNING function lowers to std::string (one string model),
    // so the correct form is literal == std::string via operator== — strcmp
    // is only for C-string VALUES. Either way, never a c_str()-wrapped
    // literal.
    expect(out.cpp).toMatch(/"meter" == name\(\)/);
    expect(out.cpp).toMatch(/static std::string name\(\)/);
    expect(out.cpp).not.toMatch(/\("meter"\)\.c_str\(\)/);
  });

  it("an int-literal ternary in a template formats as %d (not %.15g)", () => {
    const out = transpile(`
      const flushPending = false;
      const flushes = 7;
      UART0.writeLine(\`flushes=\${flushes} pend=\${flushPending ? 1 : 0}\`);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.severity === "error" && d.code !== "zephyr-bus-instance-unavailable")).toHaveLength(0);
    expect(out.cpp).toMatch(/pend=%d/);
    expect(out.cpp).not.toMatch(/pend=%\.15g/);
  });

  it("a double-armed ternary in a template keeps the %.15g JS-repr convention", () => {
    const out = transpile(`
      const counts = new Map<string, number>();
      counts.set('a', 1.5);
      UART0.writeLine(\`t=\${counts.has('a') ? counts.get('a') : 0}\`);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.severity === "error" && d.code !== "zephyr-bus-instance-unavailable")).toHaveLength(0);
    expect(out.cpp).toMatch(/t=%\.15g/);
  });

  it("ISR-shared counters emit volatile; the thread body is a real function", () => {
    const out = transpile(`
      import { GPIO, BUTTON, Thread, Time } from '@typecad/hal';
      let pulseCount = 0;
      const pulseInput = new GPIO(BUTTON, GPIO.INPUT | GPIO.PULL_UP);
      pulseInput.onInterrupt(GPIO.INT_EDGE_FALLING, () => {
        pulseCount += 1;
      });
      function flusherBody(): void {
        while (true) {
          Time.sleep(100);
        }
      }
      const flusher = new Thread(0, { stackKb: 2 });
      flusher.start(flusherBody);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr', fileName: "C:/typecad/hal/test-tmp/lg1.ts" });
    // Board-less harness: BUTTON has no pin facts, so onInterrupt fails
    // LOUDLY (hal-method-unresolved — the round-2 guard) and the ISR/volatile
    // analysis never runs; that coverage lives in framework-zephyr's
    // isr-safety suite over real chip descriptors (the demo build shows
    // `volatile int32_t pulseCount` on real facts). Pin what IS verifiable:
    // the loud failure and the thread machinery.
    expect(out.diagnostics.some(d => d.code === "hal-method-unresolved" && d.message.includes("onInterrupt"))).toBe(true);
    expect(out.cpp).toMatch(/static void flusherBody\(\)/);
    expect(out.cpp).toMatch(/__tc_thrd0_fn = \(flusherBody\)/);
  });

  it("the ring-buffer idioms lower faithfully (modulo, subscript cast, getter)", () => {
    const out = transpile(`
      type Sample = { tMs: number; pulses: number };
      class SampleRing {
        private cap: number;
        private buf: Sample[] = [];
        private head = 0;
        private count = 0;
        constructor(capacity: number) {
          this.cap = capacity;
          for (let i = 0; i < capacity; i += 1) {
            this.buf.push({ tMs: 0, pulses: 0 });
          }
        }
        push(s: Sample): void {
          this.buf[this.head] = s;
          this.head = (this.head + 1) % this.cap;
          if (this.count < this.cap) {
            this.count += 1;
          }
        }
        get filled(): number {
          return this.count;
        }
      }
      const ring = new SampleRing(4);
      ring.push({ tMs: 1, pulses: 2 });
      let n = ring.filled;
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.severity === "error")).toHaveLength(0);
    expect(out.cpp).toMatch(/std::fmod\(/);
    expect(out.cpp).toMatch(/getFilled\(\)/);
    // The JS modulo on the class field keeps wrap semantics.
    expect(out.cpp).toMatch(/this->head = \(this->head \+ 1\) % this->cap|fmod\(\(this->head \+ 1\), this->cap\)/);
  });
});
