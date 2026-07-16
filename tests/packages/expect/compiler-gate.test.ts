import { describe, it, expect, beforeEach } from "vitest";
import { compileSketch, uploadSketch } from "../../../packages/expect/src/host/compiler";
import { __setArduinoCliRunnerForTest } from "@typecad/arduino-cli";

beforeEach(() => {
  __setArduinoCliRunnerForTest(undefined);
});

describe("expect host compiler gate", () => {
  it("blocks compileSketch with an install hint when arduino-cli is missing", () => {
    __setArduinoCliRunnerForTest(() => ({
      arduinoCliInstalled: false,
      arduinoCliVersion: undefined,
      installedCores: [],
      binaryMissing: true,
    }));
    const result = compileSketch(".", "arduino:avr:uno");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/arduino-cli not found/i);
  });

  it("blocks compileSketch when the core is missing", () => {
    __setArduinoCliRunnerForTest(() => ({
      arduinoCliInstalled: true,
      arduinoCliVersion: "1.4.1",
      installedCores: ["esp32:esp32"],
      binaryMissing: false,
    }));
    const result = compileSketch(".", "arduino:avr:uno");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/arduino-cli core install arduino:avr/);
  });

  it("blocks uploadSketch when the core is missing", () => {
    __setArduinoCliRunnerForTest(() => ({
      arduinoCliInstalled: true,
      arduinoCliVersion: "1.4.1",
      installedCores: ["esp32:esp32"],
      binaryMissing: false,
    }));
    const result = uploadSketch(".", "arduino:avr:uno", "COM3");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/arduino-cli core install arduino:avr/);
  });
});
