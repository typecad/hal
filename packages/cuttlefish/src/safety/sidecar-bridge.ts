import type { SafetyMetadata } from "../safety-hook.js";
import { renderSafetySidecar as renderSidecar } from "./iso26262/sidecar-writer.js";

/** Render the safety sidecar artifact via the built-in ISO 26262 writer. */
export async function renderSafetySidecar(
  metadata: SafetyMetadata,
  toolVersion: string,
): Promise<string> {
  return renderSidecar(metadata, toolVersion);
}
