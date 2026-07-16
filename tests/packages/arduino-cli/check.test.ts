import { describe, it, expect } from "vitest";
import { checkArduinoEnv } from "@typecad/arduino-cli";

// All FQBN-derivation + set-membership tests use the for-test override hook so
// they never invoke a real arduino-cli binary.
describe("checkArduinoEnv — FQBN derivation", () => {
  it("derives arduino:avr from arduino:avr:uno", () => {
    const result = checkArduinoEnv("arduino:avr:uno");
    expect(result.check.requiredCore).toBe("arduino:avr");
  });

  it("derives esp32:esp32 from esp32:esp32:esp32", () => {
    const result = checkArduinoEnv("esp32:esp32:esp32");
    expect(result.check.requiredCore).toBe("esp32:esp32");
  });

  it("treats a 2-segment FQBN as a valid Pack:Arch", () => {
    const result = checkArduinoEnv("arduino:avr");
    expect(result.check.requiredCore).toBe("arduino:avr");
  });

  it("returns undefined requiredCore for a malformed (1-segment) FQBN", () => {
    const result = checkArduinoEnv("garbage");
    expect(result.check.requiredCore).toBeUndefined();
    // Malformed FQBN: we can't check a core, so we don't fail on core grounds.
    expect(result.ok).toBe(true);
  });

  it("returns undefined requiredCore for an empty FQBN and does not fail", () => {
    const result = checkArduinoEnv("");
    expect(result.check.requiredCore).toBeUndefined();
    expect(result.ok).toBe(true);
  });
});

describe("checkArduinoEnv — core presence", () => {
  it("reports ok when the required core is in the installed set", () => {
    const result = checkArduinoEnv("arduino:avr:uno", {
      fakeProbe: {
        arduinoCliInstalled: true,
        arduinoCliVersion: "1.4.1",
        installedCores: ["arduino:avr", "esp32:esp32"],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.check.requiredCoreInstalled).toBe(true);
      expect(result.check.installedCores).toContain("arduino:avr");
    }
  });

  it("fails with core-not-installed when the core is absent", () => {
    const result = checkArduinoEnv("arduino:avr:uno", {
      fakeProbe: {
        arduinoCliInstalled: true,
        arduinoCliVersion: "1.4.1",
        installedCores: ["esp32:esp32"], // arduino:avr missing
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("core-not-installed");
      expect(result.fixCommand).toBe("arduino-cli core install arduino:avr");
      expect(result.messages.some((m) => m.includes("arduino:avr"))).toBe(true);
    }
  });

  it("does not fail on core grounds when fqbn is malformed even if the core list is empty", () => {
    const result = checkArduinoEnv("not-an-fqbn", {
      fakeProbe: {
        arduinoCliInstalled: true,
        arduinoCliVersion: "1.4.1",
        installedCores: [],
      },
    });
    expect(result.ok).toBe(true);
  });
});

describe("checkArduinoEnv — binary presence", () => {
  it("fails with arduino-cli-not-found when the binary is absent", () => {
    const result = checkArduinoEnv("arduino:avr:uno", {
      fakeProbe: {
        arduinoCliInstalled: false,
        arduinoCliVersion: undefined,
        installedCores: [],
        // Simulates the ENOENT case: the probe could not run at all.
        binaryMissing: true,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("arduino-cli-not-found");
      // The fix hint should point to installing arduino-cli itself.
      expect(result.messages.some((m) => /arduino-cli/i.test(m))).toBe(true);
    }
  });

  it("fails with arduino-cli-unresponsive when found but version errored", () => {
    const result = checkArduinoEnv(undefined, {
      fakeProbe: {
        arduinoCliInstalled: false, // version probe errored
        arduinoCliVersion: undefined,
        installedCores: [],
        binaryMissing: false, // it WAS found, just didn't respond
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("arduino-cli-unresponsive");
    }
  });

  it("checks arduino-cli presence only when fqbn is undefined", () => {
    const result = checkArduinoEnv(undefined, {
      fakeProbe: {
        arduinoCliInstalled: true,
        arduinoCliVersion: "1.4.1",
        installedCores: [],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.check.requiredCore).toBeUndefined();
      expect(result.check.requiredCoreInstalled).toBe(false);
    }
  });
});
