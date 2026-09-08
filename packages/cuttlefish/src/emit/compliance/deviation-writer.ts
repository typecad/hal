import type { ComplianceContext } from "./compliance-context.js";
import type { Deviation } from "./types.js";
import { RULES } from "./rules.js";

export interface RegistryJson {
  schemaVersion: string;
  standard: string;
  tool: string;
  toolVersion: string;
  generatedAt: string;
  emittedArtifact: string;
  ruleSubset: { id: string; category: string }[];
  summary: {
    totalDeviations: number;
    byRule: Record<string, number>;
  };
  deviations: Array<Deviation & {
    /** C++ location of the deviation, mirroring the diagnostic messages. */
    cpp?: { file: string; line: number };
  }>;
}

/**
 * Renders the ledger as the sidecar registry JSON. Pure function — does
 * not touch the filesystem; the caller (finalizeOutput) writes the string.
 */
export function renderRegistryJson(
  ctx: ComplianceContext,
  emittedArtifact: string,
  toolVersion: string,
): string {
  const deviations = [...ctx.ledger().all()];
  const byRule: Record<string, number> = {};
  for (const d of deviations) {
    byRule[d.ruleId] = (byRule[d.ruleId] ?? 0) + 1;
  }

  // Derive the C++ artifact name for the cpp field. For header deviations,
  // the artifact is the .h file (derived from the source artifact name).
  const sourceArtifact = emittedArtifact;
  const headerArtifact = emittedArtifact.replace(/\.\w+$/, ".h");

  const payload: RegistryJson = {
    schemaVersion: "1.0.0",
    standard: "AUTOSAR C++14",
    tool: "typecad-hal",
    toolVersion,
    generatedAt: new Date().toISOString(),
    emittedArtifact,
    ruleSubset: RULES.filter((r) => r.enabled).map((r) => ({ id: r.id, category: r.category })),
    summary: {
      totalDeviations: deviations.length,
      byRule,
    },
    deviations: deviations.map((d) => ({
      ...d,
      cpp: {
        file: d.file === "header" ? headerArtifact : sourceArtifact,
        line: d.line,
      },
    })),
  };

  return JSON.stringify(payload, null, 2);
}
