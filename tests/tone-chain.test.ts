import { describe, it, expect } from "vitest";
import { transpileArduino } from "./setup";

describe("Tone Chaining", () => {
  it("transpiles pin.tone(f).for(d) to Arduino tone calls", () => {
    const result = transpileArduino(`
      import { D13 } from '@typehal/board-arduino-uno';
      function test(): void {
        const led = D13.asOutput();
        led.tone(440).for(400);
      }
    `);

    // Verify both calls are emitted
    expect(result.cpp).toContain("tone(13, 440);");
    expect(result.cpp).toContain("tone(13, 440, 400);");
  });

  it("transpiles bare pin.tone(f) correctly", () => {
    const result = transpileArduino(`
      import { D13 } from '@typehal/board-arduino-uno';
      function test(): void {
        const led = D13.asOutput();
        led.tone(880);
      }
    `);

    expect(result.cpp).toContain("tone(13, 880);");
    expect(result.cpp).not.toContain(", 400);");
  });
});
