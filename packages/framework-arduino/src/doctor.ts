// ---------------------------------------------------------------------------
// @typecad/framework-arduino — Arduino environment doctor
//
// `cuttlefish doctor` (Arduino framework) — verify arduino-cli is installed
// and the board's core (derived from the FQBN in cuttlefish.config.ts) is
// present. Exits 0 if the environment is OK, non-zero otherwise. Reuses
// checkArduinoEnv so the detection logic is shared with the build/test gates.
//
// This logic used to live inline in @typecad/cuttlefish's cli.ts (Phase 5
// decoupling). It was moved here because it is Arduino-specific (it shells out
// to arduino-cli and inspects the Arduino core install). Cuttlefish now
// dispatches the `doctor` command through the loaded framework's `doctor`
// export.
// ---------------------------------------------------------------------------

import * as ui from "@typecad/cuttlefish/utils/ui";
import { loadCuttlefishConfig } from "@typecad/cuttlefish/config-loader";
import { checkArduinoEnv } from "@typecad/arduino-cli";

/**
 * Verify arduino-cli is installed and the board's core (derived from the FQBN
 * in cuttlefish.config.ts) is present. Sets process.exitCode = 1 on failure.
 */
export function runDoctor(): void {
  ui.printHeader();
  ui.printStep("Checking arduino-cli environment...");

  const config = loadCuttlefishConfig(process.cwd());
  const fqbn = config?.buildTarget;

  const result = checkArduinoEnv(fqbn);
  const check = result.check;

  // arduino-cli presence line
  if (check.arduinoCliInstalled) {
    ui.printInfo(`arduino-cli .... ${check.arduinoCliVersion ?? "unknown"}  ✓`);
  } else if (!result.ok && result.reason === "arduino-cli-not-found") {
    ui.printError(`arduino-cli .... NOT FOUND on PATH`);
  } else {
    ui.printError(`arduino-cli .... found but unresponsive`);
  }

  // core presence line (only meaningful if we have an FQBN)
  if (fqbn) {
    if (check.requiredCore) {
      const status = check.requiredCoreInstalled ? "installed ✓" : "NOT installed ✗";
      const line = `${check.requiredCore} ....... ${status}`;
      if (check.requiredCoreInstalled) {
        ui.printInfo(line);
      } else {
        ui.printError(line);
        ui.printInfo(`  → run: arduino-cli core install ${check.requiredCore}`);
      }
    }
  } else {
    ui.printInfo("(no buildTarget in cuttlefish.config.ts — skipping core check)");
  }

  // Exit code
  if (result.ok) {
    ui.printSuccess("Environment OK");
    return; // exitCode stays unset => 0
  }
  if (!result.ok) {
    for (const line of result.messages) ui.printInfo(line);
    process.exitCode = 1;
  }
}
