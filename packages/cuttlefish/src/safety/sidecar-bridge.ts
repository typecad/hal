import type { SafetyMetadata } from "../safety-hook.js";

/** Dynamically import the safety package's sidecar renderer.
 *  Uses a variable-held specifier so tsc doesn't try to resolve the
 *  @typecad/safety types at build time (avoids circular dependency). */
export async function renderSafetySidecar(
  metadata: SafetyMetadata,
  toolVersion: string,
): Promise<string> {
  const spec = "@typecad/safety/iso26262/sidecar-writer";
  try {
    const mod = await import(spec);
    return mod.renderSafetySidecar(metadata, toolVersion);
  } catch {
    // Fallback: inline the renderer so the sidecar is produced even if
    // the subpath export isn't configured.
    return JSON.stringify({
      schemaVersion: "1.0.0",
      standard: "ISO 26262 Part 6",
      tool: "cuttlefish (@typecad/safety)",
      toolVersion,
      generatedAt: new Date().toISOString(),
      safetyFunctions: metadata.functions,
    }, null, 2);
  }
}
