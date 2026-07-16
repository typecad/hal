// Shared gate helper: runs checkArduinoEnv and formats a failure into the
// `output` string used by ArduinoCompileResult / ArduinoUploadResult.

import { checkArduinoEnv, type ArduinoEnvFailure } from "@typecad/arduino-cli";

/**
 * Returns the failure's `messages` joined as a single output string, or null
 * if the environment is OK. Never throws.
 */
export function arduinoEnvFailureOutput(fqbn?: string): string | null {
  const result = checkArduinoEnv(fqbn);
  if (result.ok) return null;
  return formatFailure(result);
}

/** Format an ArduinoEnvFailure into printable output lines. */
export function formatFailure(failure: ArduinoEnvFailure): string {
  const lines = [...failure.messages];
  if (failure.fixCommand) {
    lines.push(`  Fix: ${failure.fixCommand}`);
  }
  return lines.join("\n");
}
