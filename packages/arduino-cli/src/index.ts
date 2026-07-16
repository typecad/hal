// @typecad/arduino-cli — arduino-cli environment detection.
// Verifies arduino-cli is installed and the board's required core is present.

import {
  probeArduinoCli,
  __setArduinoCliRunnerForTest,
  __invalidateArduinoCliCacheForTest,
  type ArduinoCliProbeData,
  type CheckArduinoEnvOptions,
} from "./probe.js";

export { __setArduinoCliRunnerForTest, __invalidateArduinoCliCacheForTest };
export type { ArduinoCliProbeData, CheckArduinoEnvOptions };

// ---- public result types ----------------------------------------------------

export interface ArduinoEnvCheck {
  /** arduino-cli binary was found on PATH and responded to `version`. */
  arduinoCliInstalled: boolean;
  /** arduino-cli version string if installed, e.g. "1.4.1". */
  arduinoCliVersion: string | undefined;
  /** Cores present on this machine, in Pack:Arch form, e.g. ["arduino:avr","esp32:esp32"]. */
  installedCores: string[];
  /** The Pack:Arch derived from the given fqbn, e.g. "arduino:avr". undefined if fqbn is malformed. */
  requiredCore: string | undefined;
  /** requiredCore is present in installedCores. false if fqbn malformed or core absent. */
  requiredCoreInstalled: boolean;
}

export type ArduinoEnvOk = { ok: true; check: ArduinoEnvCheck };

export type ArduinoEnvFailure = {
  ok: false;
  reason:
    | "arduino-cli-not-found"
    | "arduino-cli-unresponsive"
    | "core-not-installed";
  check: ArduinoEnvCheck;
  /** Human-readable lines ready to print. */
  messages: string[];
  /** Exact command the user should run, when applicable. */
  fixCommand: string | undefined;
};

export type ArduinoEnvResult = ArduinoEnvOk | ArduinoEnvFailure;

// ---- helpers ----------------------------------------------------------------

/** Derive the Pack:Arch core id from an FQBN. Returns undefined for malformed input. */
export function deriveRequiredCore(fqbn: string | undefined): string | undefined {
  if (!fqbn) return undefined;
  const parts = fqbn.split(":");
  if (parts.length < 2) return undefined;
  const core = `${parts[0]}:${parts[1]}`;
  // Reject empty segments, e.g. ":avr" or "arduino:".
  if (parts[0].length === 0 || parts[1].length === 0) return undefined;
  return core;
}

// ---- main entry point -------------------------------------------------------

/**
 * Verify the environment can build for `fqbn`. Cheap and side-effect-free:
 * runs `arduino-cli version` then `arduino-cli core list --format json`, caches
 * both for the process lifetime, and reports what (if anything) is missing.
 *
 * - If `fqbn` is undefined/empty, checks arduino-cli presence only.
 * - Never installs anything. Never mutates the user environment.
 * - Never throws — always returns a result. Callers decide how to react.
 *
 * `options` is for-test only (injects fake probe data).
 */
export function checkArduinoEnv(fqbn?: string, options?: CheckArduinoEnvOptions): ArduinoEnvResult {
  const probe = probeArduinoCli(options);
  const requiredCore = deriveRequiredCore(fqbn);

  const check: ArduinoEnvCheck = {
    arduinoCliInstalled: probe.arduinoCliInstalled,
    arduinoCliVersion: probe.arduinoCliVersion,
    installedCores: probe.installedCores,
    requiredCore,
    requiredCoreInstalled: requiredCore ? probe.installedCores.includes(requiredCore) : false,
  };

  // 1. arduino-cli binary missing entirely.
  if (probe.binaryMissing) {
    const hint = requiredCore
      ? `\n  (then run: arduino-cli core install ${requiredCore})`
      : "";
    return {
      ok: false,
      reason: "arduino-cli-not-found",
      check,
      messages: [
        `arduino-cli not found on PATH. Install it: https://arduino.github.io/arduino-cli/${hint}`,
      ],
      fixCommand: undefined,
    };
  }

  // 2. arduino-cli found but unresponsive (version probe errored).
  if (!probe.arduinoCliInstalled) {
    return {
      ok: false,
      reason: "arduino-cli-unresponsive",
      check,
      messages: [
        "arduino-cli was found on PATH but did not respond to `arduino-cli version`. Check your installation.",
      ],
      fixCommand: undefined,
    };
  }

  // 3. arduino-cli healthy — only check the core if we have a well-formed FQBN.
  // A malformed/absent FQBN is not a core-install problem; report ok.
  if (requiredCore && !check.requiredCoreInstalled) {
    return {
      ok: false,
      reason: "core-not-installed",
      check,
      messages: [
        `arduino-cli found but required core '${requiredCore}' is not installed.`,
        `  Run: arduino-cli core install ${requiredCore}`,
      ],
      fixCommand: `arduino-cli core install ${requiredCore}`,
    };
  }

  return { ok: true, check };
}
