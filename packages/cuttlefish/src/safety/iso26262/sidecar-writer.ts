import type { SafetyMetadata } from "../../safety-hook.js";

/** Sidecar JSON schema for the safety metadata artifact. */
export interface SafetySidecar {
  schemaVersion: string;
  standard: string;
  tool: string;
  toolVersion: string;
  generatedAt: string;
  safetyFunctions: Array<{
    name: string;
    asilLevel: string;
    source?: { tsFile: string; tsLine: number };
    mechanisms: string[];
    rules: Record<string, "pass" | { severity: string; message: string }>;
  }>;
}

/** Render safety metadata as a sidecar JSON string.
 *  Pure function — does not touch the filesystem. */
export function renderSafetySidecar(
  metadata: SafetyMetadata,
  toolVersion: string,
): string {
  const payload: SafetySidecar = {
    schemaVersion: "1.0.0",
    standard: "ISO 26262 Part 6",
    tool: "typecad-hal (safety)",
    toolVersion,
    generatedAt: new Date().toISOString(),
    safetyFunctions: metadata.functions,
  };

  return JSON.stringify(payload, null, 2);
}
