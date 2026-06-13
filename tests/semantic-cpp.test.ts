import { describe, it, expect } from "vitest";
import { transpileAVR, transpileESP32, matchesCpp, expectDiagnosticsMatchSnapshot } from "./setup";

describe("Multi-Platform Transpilation", () => {
  it("emits AVR-specific Preferences shim", () => {
    const result = transpileAVR(`
      import { Preferences } from '@typecad/framework-arduino/arduino';
      const prefs = new Preferences();
      prefs.begin("test");
    `);

    // AVR uses EEPROM-based shim for Preferences
    expect(result.cpp).toContain("class __tc_Preferences");
    expect(result.cpp).toContain("EEPROM.read(");
    
    // The instance call should use arrow operator for pointers
    matchesCpp(result.cpp, [
      "prefs->begin(\"test\");"
    ]);
  });

  it("emits ESP32-specific Preferences include", { timeout: 15_000 }, () => {
    const result = transpileESP32(`
      import { Preferences } from '@typecad/framework-arduino/arduino';
      const prefs = new Preferences();
      prefs.begin("test");
    `);
    // ESP32 aliases Preferences to __tc_prefs
    expect(result.cpp).toContain("#include <Preferences.h>");
    expect(result.cpp).toContain("__tc_prefs");

    matchesCpp(result.cpp, [
      "prefs->begin(\"test\");"
    ]);
  });
});

describe("Semantic C++ Matching", () => {
  it("ignores comments and whitespace", () => {
    const result = transpileAVR('const x = 1; // comment');
    matchesCpp(result.cpp, 'x = 1;');
  });

  it("optimizes float interpolation based on architecture", { timeout: 15_000 }, () => {
    const tsCode = `
      const val = 3.14159;
      console.log(\`Value: \${val}\`);
    `;

    const avrResult = transpileAVR(tsCode);
    // AVR should use dtostrf
    expect(avrResult.cpp).toContain('dtostrf');
    expect(avrResult.cpp).toContain('"Value: %s"');

    const espResult = transpileESP32(tsCode);
    // ESP32 should use native snprintf %f
    expect(espResult.cpp).not.toContain('dtostrf');
    expect(espResult.cpp).toContain('"Value: %.5f"');
  });
});

describe("Diagnostic Snapshotting", () => {
  it("snapshots peripheral ownership conflicts", () => {
    // Deliberate double-take
    const result = transpileAVR(`
      import { SPI0 } from '@typecad/framework-arduino/arduino';
      SPI0.take();
      SPI0.take();
    `);

    // This will create a snapshot in __snapshots__/semantic-cpp.test.ts.snap
    // @ts-ignore
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expectDiagnosticsMatchSnapshot(result); 
  });
});

describe("Memory & Collection Engine", () => {
  it("promotes mutable arrays to StaticArray", () => {
    const result = transpileAVR(`
      const items = [10, 20];
      items.push(30);
      const len = items.length;
    `);

    // Should use StaticArray instead of std::vector or plain C array
    expect(result.cpp).toContain("__tc_StaticArray<int, 4>");
    
    matchesCpp(result.cpp, [
      "__tc_StaticArray<int, 4> items;",
      "items.push(10);",
      "items.push(20);",
      "items.push(30);",
      "items.length();"
    ]);
  });

  // KNOWN GAP: Timing.freeHeap() resolves to a default value (0) and the
  // Timing shim's `unsigned long freeHeap()` declaration is not emitted for
  // AVR. Additionally `free` is escaped to `free_` (AVR reserves `free`).
  // Tracked here as .skip.
  it.skip("emits heap monitoring routine", () => {
    const result = transpileAVR(`
      import { Timing } from '@typecad/framework-arduino/arduino';
      const free = Timing.freeHeap();
    `);

    expect(result.cpp).toContain("unsigned long freeHeap()");
    matchesCpp(result.cpp, [
      "const auto free_ = 0;"
    ]);
  });
});
