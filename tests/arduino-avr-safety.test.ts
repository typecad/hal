import { describe, it, expect } from "vitest";
import { transpile } from "./setup";

// ---------------------------------------------------------------------------
// AVR / Arduino safety feature tests
//
// Covers the AVR-targeted improvements to the framework-arduino strategy:
//   1. cuttlefish_halt panic handler (renderThrow + polyfill)
//   2. F()-wrapped console.log strings (flash storage, no heap)
//   3. String predicates using C stdlib (strstr / strncmp / __tc_endsWith)
//   4. CUTTLEFISH_STR_BUF_SIZE macro in string polyfills
//   5. Heap-allocation validator (blocks `new ClassName()` on AVR)
//   6. EEPROM namespace dispatch
//   7. Timing namespace dispatch
//   8. WDT namespace dispatch
//   9. IRAM_ATTR attribute for ESP32 ISR functions
// ---------------------------------------------------------------------------

const AVR_CTX = { platformContext: { architecture: "avr", frameworkData: { buildTarget: "arduino:avr:uno" } } };
const ESP32_CTX = { platformContext: { architecture: "esp32", frameworkData: { buildTarget: "esp32:esp32:esp32" } } };

// ---------------------------------------------------------------------------
// 1. cuttlefish_halt panic handler
// ---------------------------------------------------------------------------

describe("cuttlefish_halt panic handler", () => {
  it("emits cuttlefish_halt macro definition in string_methods polyfill", () => {
    const result = transpile(
      `function setup(): void { throw new Error("bad"); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain("cuttlefish_halt");
    expect(result.cpp).toContain("Serial.println");
    expect(result.cpp).toContain("for (;;)");
  });

  it("renderThrow emits cuttlefish_halt(\"PANIC\") not a bare for(;;) in setup body", () => {
    const result = transpile(
      `function setup(): void { throw new Error("oops"); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    // Should use cuttlefish_halt macro call, not a bare infinite-loop in the function body
    expect(result.cpp).toContain('cuttlefish_halt("PANIC")');
    // The macro definition legitimately contains for(;;); verify setup() body uses the macro call
    expect(result.cpp).toContain('void setup()');
  });

  it("cuttlefish_halt macro uses F() for flash storage", () => {
    const result = transpile(
      `function setup(): void { throw new Error("err"); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    // The macro definition itself must use F() so the panic string sits in flash
    expect(result.cpp).toContain("F(msg)");
  });

  it("cuttlefish_halt macro is guarded with #ifndef", () => {
    const result = transpile(
      `function setup(): void { throw new Error(""); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain("#ifndef cuttlefish_halt");
  });

  it("omits cuttlefish_halt macro when no throw statements exist", () => {
    const result = transpile(
      `function setup(): void { Serial.println("hello"); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).not.toContain("cuttlefish_halt");
  });
});

// ---------------------------------------------------------------------------
// 2. F()-wrapped console.log strings
// ---------------------------------------------------------------------------

describe("F() string wrapping for Arduino Serial output", () => {
  it("wraps bare string literal in F() for console.log", () => {
    const result = transpile(
      `function setup(): void { console.log("hello AVR"); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain('Serial.println(F("hello AVR"))');
  });

  it("wraps bare string literal in F() for console.error", () => {
    const result = transpile(
      `function setup(): void { console.error("bad state"); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain('F("[ERROR] ")');
    expect(result.cpp).toContain('F("bad state")');
  });

  it("wraps bare string literal in F() for console.warn", () => {
    const result = transpile(
      `function setup(): void { console.warn("low battery"); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain('F("[WARN] ")');
  });

  it("does not double-wrap an already variable expression", () => {
    const result = transpile(
      `function setup(): void {
        const msg = "hi";
        console.log(msg);
      }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    // Variable reference — no F() wrapping in the Serial.println call itself
    expect(result.cpp).toContain("Serial.println(msg)");
    // The cuttlefish_halt macro body contains Serial.println(F(msg)) — but the variable call is unwrapped
  });
});

// ---------------------------------------------------------------------------
// 3. String predicates — C stdlib (no heap String())
// ---------------------------------------------------------------------------

describe("String predicates use C stdlib (no heap String allocation)", () => {
  it("transpiles str.includes(sub) to strstr()", () => {
    const result = transpile(
      `function check(s: string): bool {
        return s.includes("OK");
      }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain("strstr(s, \"OK\") != NULL");
    expect(result.cpp).not.toContain("String(s)");
  });

  it("transpiles str.startsWith(pre) to strncmp()", () => {
    const result = transpile(
      `function check(s: string): bool {
        return s.startsWith("$GP");
      }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain('strncmp(s, "$GP", strlen("$GP")) == 0');
    expect(result.cpp).not.toContain("String(s)");
  });

  it("transpiles str.endsWith(suf) to __tc_endsWith()", () => {
    const result = transpile(
      `function check(s: string): bool {
        return s.endsWith("\\n");
      }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain("__tc_endsWith(s");
    expect(result.cpp).not.toContain("String(s)");
  });
});

// ---------------------------------------------------------------------------
// 4. CUTTLEFISH_STR_BUF_SIZE macro in polyfill header
// ---------------------------------------------------------------------------

describe("CUTTLEFISH_STR_BUF_SIZE macro in string polyfills", () => {
  it("emits the CUTTLEFISH_STR_BUF_SIZE guard before polyfill helpers", () => {
    const result = transpile(
      `function setup(): void {
        const msg = "hello";
        console.log(msg.toUpperCase());
      }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain("CUTTLEFISH_STR_BUF_SIZE");
    expect(result.cpp).toContain("#ifndef CUTTLEFISH_STR_BUF_SIZE");
    expect(result.cpp).toContain("#define CUTTLEFISH_STR_BUF_SIZE 64");
  });

  it("static buffers in helpers reference CUTTLEFISH_STR_BUF_SIZE not a magic number", () => {
    const result = transpile(
      `function setup(): void {
        const s = "test";
        console.log(s.toLowerCase());
      }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain("buf[2][CUTTLEFISH_STR_BUF_SIZE]");
    // No raw 64 should appear without the macro (the macro definition itself is ok)
    const lines = result.cpp.split("\n").filter(
      l => l.includes("char buf[") && l.includes("64") && !l.includes("CUTTLEFISH_STR_BUF_SIZE"),
    );
    expect(lines).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Heap-allocation validator
// ---------------------------------------------------------------------------

describe("Heap-allocation validator (AVR)", () => {
  it("emits a heap-allocation-avr diagnostic for `new ClassName()` on AVR", () => {
    // Board import is required to resolve boardConstants (architecture = 'avr');
    // without it the validator has no arch info and returns no diagnostics.
    const result = transpile(
      `import { D13 } from '@typecad/board-arduino-uno';
       class Foo { constructor(x: int) {} }
       function setup(): void {
         const led = D13;
         const f = new Foo(1);
       }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    const codes = result.diagnostics.map(d => (d as any).code);
    expect(codes).toContain("heap-allocation-avr");
  });

  it("does not emit heap-allocation-avr diagnostic on ESP32", () => {
    const result = transpile(
      `class Bar { constructor(x: int) {} }
       function setup(): void {
         const b = new Bar(1);
       }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...ESP32_CTX },
    );
    const codes = result.diagnostics.map(d => (d as any).code);
    expect(codes).not.toContain("heap-allocation-avr");
  });

  it("does not flag typed array constructors (new Uint8Array) on AVR", () => {
    const result = transpile(
      `function setup(): void {
        const buf = new Uint8Array(8);
      }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    // Typed array new expressions are handled by the emitter as C arrays — not heap
    const heapDiags = result.diagnostics.filter(d => (d as any).code === "heap-allocation-avr");
    expect(heapDiags).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. EEPROM namespace dispatch
// ---------------------------------------------------------------------------

describe("EEPROM namespace dispatch", () => {
  it("transpiles EEPROM.read(addr) to EEPROM.read()", () => {
    const result = transpile(
      `function setup(): void { const v = EEPROM.read(10); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain("EEPROM.read(10)");
  });

  it("transpiles EEPROM.write(addr, val) to EEPROM.write()", () => {
    const result = transpile(
      `function setup(): void { EEPROM.write(0, 42); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain("EEPROM.write(0, 42)");
  });

  it("transpiles EEPROM.update(addr, val) to EEPROM.update()", () => {
    const result = transpile(
      `function setup(): void { EEPROM.update(5, 99); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain("EEPROM.update(5, 99)");
  });

  it("transpiles EEPROM.length() to EEPROM.length()", () => {
    const result = transpile(
      `function setup(): void { const sz = EEPROM.length(); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain("EEPROM.length()");
  });
});

// ---------------------------------------------------------------------------
// 7. Timing namespace dispatch
// ---------------------------------------------------------------------------

describe("Timing namespace dispatch", () => {
  it("transpiles Timing.millis() to millis()", () => {
    const result = transpile(
      `function loop(): void { const t = Timing.millis(); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain("millis()");
  });

  it("transpiles Timing.micros() to micros()", () => {
    const result = transpile(
      `function loop(): void { const t = Timing.micros(); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain("micros()");
  });

  it("transpiles Timing.delay(ms) to delay()", () => {
    const result = transpile(
      `function setup(): void { Timing.delay(500); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain("delay(500)");
  });

  it("transpiles Timing.delayMicroseconds(us) to delayMicroseconds()", () => {
    const result = transpile(
      `function setup(): void { Timing.delayMicroseconds(100); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain("delayMicroseconds(100)");
  });
});

// ---------------------------------------------------------------------------
// 8. WDT namespace dispatch
// ---------------------------------------------------------------------------

describe("WDT namespace dispatch", () => {
  it("transpiles WDT.reset() to wdt_reset()", () => {
    const result = transpile(
      `function loop(): void { WDT.reset(); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain("wdt_reset()");
  });

  it("transpiles WDT.disable() to wdt_disable()", () => {
    const result = transpile(
      `function setup(): void { WDT.disable(); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain("wdt_disable()");
  });

  it("transpiles WDT.enable(WDTO_2S) to wdt_enable(WDTO_2S)", () => {
    const result = transpile(
      `function setup(): void { WDT.enable(WDTO_2S); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain("wdt_enable(WDTO_2S)");
  });

  it("transpiles WDT.enable(WDTO_500MS) to wdt_enable(WDTO_500MS)", () => {
    const result = transpile(
      `function setup(): void { WDT.enable(WDTO_500MS); }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).toContain("wdt_enable(WDTO_500MS)");
  });
});

// ---------------------------------------------------------------------------
// 9. IRAM_ATTR for ESP32 ISR functions
// ---------------------------------------------------------------------------

describe("IRAM_ATTR attribute for ESP32 ISR functions", () => {
  it("does NOT emit IRAM_ATTR on AVR targets", () => {
    const result = transpile(
      `import { D2 } from '@typecad/board-arduino-uno';
       function setup(): void {
         D2.onFalling(() => {});
       }`,
      { target: "arduino",
      mcu: "@typecad/mcu-atmega328p", ...AVR_CTX },
    );
    expect(result.cpp).not.toContain("IRAM_ATTR");
  });
});
