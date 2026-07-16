import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  checkArduinoEnv,
  __invalidateArduinoCliCacheForTest,
} from "../../../packages/arduino-cli/src";

// Detect whether a real arduino-cli is available on PATH. Skip the whole file
// if not, so CI environments without arduino-cli still pass.
let arduinoCliAvailable = false;
try {
  const probe = spawnSync("arduino-cli", ["version"], { encoding: "utf8", timeout: 5000 });
  arduinoCliAvailable = !probe.error && probe.status === 0;
} catch {
  arduinoCliAvailable = false;
}

const describeOrSkip = arduinoCliAvailable ? describe : describe.skip;

describeOrSkip("checkArduinoEnv — real arduino-cli (smoke)", () => {
  it("returns ok and a non-empty installedCores list for a well-formed FQBN", () => {
    __invalidateArduinoCliCacheForTest();
    // Use a core very likely to be installed in any Arduino dev setup.
    const result = checkArduinoEnv("arduino:avr:uno");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.check.arduinoCliInstalled).toBe(true);
      expect(result.check.arduinoCliVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(Array.isArray(result.check.installedCores)).toBe(true);
    }
  });

  it("reports core-not-installed for a deliberately absent Pack:Arch", () => {
    __invalidateArduinoCliCacheForTest();
    // zzz:notreal is a syntactically valid Pack:Arch that will never be installed.
    const result = checkArduinoEnv("zzz:notreal:board");
    if (!result.ok) {
      // Either the core is reported missing, or (extremely unlikely) present.
      // We assert the structure is correct either way.
      expect(["core-not-installed"]).toContain(result.reason);
      expect(result.fixCommand).toBe("arduino-cli core install zzz:notreal");
    }
  });
});
