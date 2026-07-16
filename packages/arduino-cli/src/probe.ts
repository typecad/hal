// Low-level arduino-cli executor: runs `version` + `core list`, with an
// in-process cache and a for-test override hook. This module never throws.

import { spawnSync } from "node:child_process";

/**
 * Raw data gathered from arduino-cli (or injected by tests via the override hook).
 */
export interface ArduinoCliProbeData {
  /** arduino-cli binary was found on PATH and responded to `version`. */
  arduinoCliInstalled: boolean;
  /** arduino-cli version string if installed, e.g. "1.4.1". */
  arduinoCliVersion: string | undefined;
  /** Cores present on this machine, in Pack:Arch form (e.g. ["arduino:avr"]). */
  installedCores: string[];
  /**
   * True ONLY when the `version` probe failed with ENOENT (binary not on PATH).
   * Distinguishes "not found" from "found but errored" (binaryMissing=false +
   * arduinoCliInstalled=false => unresponsive).
   */
  binaryMissing?: boolean;
}

/**
 * Shape of the override hook's `fakeProbe` option (see `__setArduinoCliRunnerForTest`).
 * Mirrors ArduinoCliProbeData so tests inject exactly what a real run would return.
 */
export interface CheckArduinoEnvOptions {
  /** FOR TESTS ONLY: skip the real spawn and return this data directly. */
  fakeProbe?: ArduinoCliProbeData;
}

// ---- for-test override hook -------------------------------------------------

type ProbeRunner = () => ArduinoCliProbeData;
let testRunner: ProbeRunner | undefined;

/**
 * FOR TESTS ONLY. Replaces the real spawn-based executor with `runner`.
 * Pass `undefined` to restore the real executor. Exported from the package
 * surface so tests can call it without reaching into internals.
 */
export function __setArduinoCliRunnerForTest(runner: ProbeRunner | undefined): void {
  testRunner = runner;
}

// ---- in-process cache -------------------------------------------------------

let cached: ArduinoCliProbeData | undefined;

function resetCacheForTest(): void {
  cached = undefined;
}

// Exported so the smoke test (or a caller) can force a fresh probe.
export function __invalidateArduinoCliCacheForTest(): void {
  resetCacheForTest();
}

// ---- real executor ----------------------------------------------------------

function runRealProbe(): ArduinoCliProbeData {
  if (cached) return cached;

  // 1. version probe. Timeout is generous because arduino-cli cold-starts a Go
  // binary and this runs once per process (cached below); under CI/load a 5s
  // budget is too tight and produces spurious "unresponsive" results.
  const versionCmd = spawnSync("arduino-cli", ["version"], {
    encoding: "utf8",
    timeout: 15000,
  });

  // ENOENT => binary not on PATH at all.
  const binaryMissing = !!(versionCmd.error && (versionCmd.error as NodeJS.ErrnoException).code === "ENOENT");

  if (binaryMissing) {
    const data: ArduinoCliProbeData = {
      arduinoCliInstalled: false,
      arduinoCliVersion: undefined,
      installedCores: [],
      binaryMissing: true,
    };
    cached = data;
    return data;
  }

  // version probe errored OR non-zero (binary present but broken/unresponsive).
  if (versionCmd.error || versionCmd.status !== 0) {
    const data: ArduinoCliProbeData = {
      arduinoCliInstalled: false,
      arduinoCliVersion: undefined,
      installedCores: [],
      binaryMissing: false,
    };
    cached = data;
    return data;
  }

  // Parse a version token out of the first line, e.g. "arduino-cli  Version: 1.4.1 ...".
  const versionText = (versionCmd.stdout ?? "").trim();
  const versionMatch = versionText.match(/(\d+\.\d+\.\d+)/);
  const arduinoCliVersion = versionMatch ? versionMatch[1] : undefined;

  // 2. core list probe — installed cores only (no --all flag). `core list`
  // cold-runs in ~4-5s even unloaded, so the timeout must accommodate load;
  // this is a once-per-process cached call.
  const coresCmd = spawnSync("arduino-cli", ["core", "list", "--format", "json"], {
    encoding: "utf8",
    timeout: 30000,
  });

  let installedCores: string[] = [];
  if (!coresCmd.error && coresCmd.status === 0) {
    try {
      const parsed = JSON.parse(coresCmd.stdout ?? "") as { platforms?: { id?: string }[] };
      installedCores = (parsed.platforms ?? [])
        .map((p) => p?.id)
        .filter((id): id is string => typeof id === "string");
    } catch {
      // core list parse failed — treat as no cores known. Membership checks
      // will simply report "not installed", which is safe.
      installedCores = [];
    }
  }

  const data: ArduinoCliProbeData = {
    arduinoCliInstalled: true,
    arduinoCliVersion,
    installedCores,
    binaryMissing: false,
  };
  cached = data;
  return data;
}

/**
 * Run (or return cached) arduino-cli probe data. Respects the for-test override
 * and the in-process cache. Never throws.
 */
export function probeArduinoCli(options?: CheckArduinoEnvOptions): ArduinoCliProbeData {
  if (options?.fakeProbe) return options.fakeProbe;
  if (testRunner) return testRunner();
  return runRealProbe();
}
