import type { ComplianceContext } from "./compliance-context.js";

/** Escape XML special characters in text/attribute content. */
function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === "&" ? "&amp;" :
    c === "'" ? "&apos;" :
    "&quot;",
  );
}

/**
 * Render the deviation ledger as an AUTOSAR ARXML XML projection.
 *
 * ARXML is the AUTOSAR-standard interchange format consumed by tooling
 * like Artop and DaVinci. This is a *projection* of the same ledger that
 * `renderRegistryJson` produces — single source of truth, two renderings.
 * Many teams only need the JSON; ARXML generation is gated behind
 * `--autosar-arxml` so projects that don't need it pay no cost.
 */
export function renderArxml(ctx: ComplianceContext, emittedArtifact: string): string {
  const deviations = ctx.ledger().all();
  const body = deviations.map((d) => {
    const source = d.source
      ? `\n    <SOURCE TS-FILE="${escapeXml(d.source.tsFile)}" TS-LINE="${d.source.tsLine}" KIND="${d.source.kind}"/>`
      : "";
    return `  <DEVIATION RULE="${d.ruleId}" LINE="${d.line}" END-LINE="${d.endLine}" STATUS="${d.reviewStatus}">
    <JUSTIFICATION>${escapeXml(d.justification)}</JUSTIFICATION>
    <SNIPPET>${escapeXml(d.snippet)}</SNIPPET>${source}
  </DEVIATION>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0" ARTIFACT="${escapeXml(emittedArtifact)}">
${body}
</AUTOSAR>
`;
}
