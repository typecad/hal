import { describe, it, expect, beforeEach } from "vitest";
import {
  compileArduinoSketch,
  uploadArduinoSketch,
} from "../../../packages/framework-arduino/src";
import {
  __setArduinoCliRunnerForTest,
} from "@typecad/arduino-cli";

beforeEach(() => {
  // Ensure each test starts from a known probe state.
  __setArduinoCliRunnerForTest(undefined);
});

describe("framework-arduino compile/upload gate", () => {
  it("blocks compile with a clear message when arduino-cli is missing", () => {
    __setArduinoCliRunnerForTest(() => ({
      arduinoCliInstalled: false,
      arduinoCliVersion: undefined,
      installedCores: [],
      binaryMissing: true,
    }));
    // Point at a real dir so the pre-gate staging doesn't throw before the gate.
    const result = compileArduinoSketch(".", "arduino:avr:uno");
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/arduino-cli not found/i);
  });

  it("blocks compile when the core is missing", () => {
    __setArduinoCliRunnerForTest(() => ({
      arduinoCliInstalled: true,
      arduinoCliVersion: "1.4.1",
      installedCores: ["esp32:esp32"], // arduino:avr absent
      binaryMissing: false,
    }));
    const result = compileArduinoSketch(".", "arduino:avr:uno");
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/arduino:avr/);
    expect(result.output).toMatch(/arduino-cli core install arduino:avr/);
  });

  it("blocks upload when the core is missing", () => {
    __setArduinoCliRunnerForTest(() => ({
      arduinoCliInstalled: true,
      arduinoCliVersion: "1.4.1",
      installedCores: ["esp32:esp32"],
      binaryMissing: false,
    }));
    const result = uploadArduinoSketch(".", "arduino:avr:uno", "COM3");
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/arduino-cli core install arduino:avr/);
  });
});
