import { describe, it, expect } from "vitest";
import { parseArduinoMemoryUsage } from "../packages/framework-arduino/src/arduino-compile";

describe("Memory Usage Reporting", () => {
  it("should parse typical AVR memory usage output", () => {
    const output = `
Sketch uses 924 bytes (3%) of program storage space. Maximum is 32256 bytes.
Global variables use 9 bytes (0%) of dynamic memory, leaving 2039 bytes for local variables. Maximum is 2048 bytes.
    `;
    const usage = parseArduinoMemoryUsage(output);
    expect(usage.flashUsed).toBe(924);
    expect(usage.flashTotal).toBe(32256);
    expect(usage.ramUsed).toBe(9);
    expect(usage.ramTotal).toBe(2048);
  });

  it("should parse typical ESP32 memory usage output", () => {
    const output = `
Sketch uses 234567 bytes (17%) of program storage space. Maximum is 1310720 bytes.
Global variables use 12345 bytes (3%) of dynamic memory, leaving 315335 bytes for local variables. Maximum is 327680 bytes.
    `;
    const usage = parseArduinoMemoryUsage(output);
    expect(usage.flashUsed).toBe(234567);
    expect(usage.flashTotal).toBe(1310720);
    expect(usage.ramUsed).toBe(12345);
    expect(usage.ramTotal).toBe(327680);
  });

  it("should return empty object if no matches found", () => {
    const output = "Compiling sketch...\nDone.";
    const usage = parseArduinoMemoryUsage(output);
    expect(usage).toEqual({});
  });
});
