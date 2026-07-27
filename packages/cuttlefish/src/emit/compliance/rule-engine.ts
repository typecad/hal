import type { ComplianceContext } from "./compliance-context.js";
import { RULES } from "./rules.js";
import type { SelfCheckFinding } from "./types.js";

const DEVIATION_COMMENT = /\/\/\s*AUTOSAR\s+Deviation\s+([A-Z]\d[\d-]*[A-Z\d, ]*)/i;

/**
 * Final self-check pass, run inside finalizeOutput after all renderers
 * have pushed lines. Walks the emitted text once and reports:
 *   - unrecorded-violation: a banned construct with no matching deviation comment
 *   - orphan-deviation: a ledger entry with no matching inline comment
 *
 * Two layers: renderers are the primary enforcement (Pattern 1 picks the
 * compliant spelling by construction); this is the secondary net. Neither
 * is expected to be perfect alone.
 */
export function runSelfCheck(
  ctx: ComplianceContext,
  sourceLines: readonly string[],
  headerLines: readonly string[],
): SelfCheckFinding[] {
  if (!ctx.isEnabled()) return [];

  const findings: SelfCheckFinding[] = [];

  // Pass 1: detect banned constructs in source and header lines.
  for (const file of ["source", "header"] as const) {
    const lines = file === "source" ? sourceLines : headerLines;
    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1;
      const line = lines[i];

      // Strip trailing // comments and skip full comment lines before
      // running detect regexes — rules shouldn't match words in prose.
      // Preserve deviation comments (checked separately below).
      const deviationCommentMatch = line.match(DEVIATION_COMMENT);
      const codePart = line.replace(/\s*\/\/(?!.*AUTOSAR Deviation).*$/, "");
      const isFullComment = /^\s*(\/\/|\/\*|\*)/.test(line);
      const detectTarget = isFullComment ? "" : codePart;

      // Extract any deviation ruleIds already present on this line.
      const commentedIds = new Set<string>();
      if (deviationCommentMatch) {
        for (const id of deviationCommentMatch[1].split(",").map((s) => s.trim())) {
          commentedIds.add(id);
        }
      }

      for (const rule of RULES) {
        if (!rule.detect) continue;
        if (!rule.enabled) continue;
        if (rule.exempt && rule.exempt.test(detectTarget)) continue;
        if (!rule.detect.test(detectTarget)) continue;

        // Check knownPatterns: if this match falls under a known unavoidable
        // pattern, record a deviation and suppress the finding.
        if (rule.knownPatterns) {
          const known = rule.knownPatterns.find((kp) => kp.detect.test(detectTarget));
          if (known) {
            ctx.recordKnownDeviation(rule.id, known.justification, lineNo, file, line.trim(), {
              tsFile: "",
              tsLine: 0,
              kind: known.kind,
            });
            continue;
          }
        }

        // Match found. Is it covered by an inline comment or a ledger entry?
        const covered =
          commentedIds.has(rule.id) || ctx.ledger().hasEntry(file, lineNo, rule.id);
        if (!covered) {
          findings.push({
            ruleId: rule.id,
            severity: rule.severity,
            line: lineNo,
            file,
            snippet: line.trim(),
            kind: "unrecorded-violation",
          });
        }
      }
    }
  }

  // Pass 2: orphan-deviation detection. For every ledger entry, confirm an
  // inline comment exists at the recorded opening line in the right file.
  // Skip entries from rules that have knownPatterns — those are intentionally
  // inline-comment-less deviations (the emitted text is pre-baked shim strings
  // that can't carry inline comments; the deviation lives in the sidecar only).
  const rulesWithKnownPatterns = new Set(
    RULES.filter((r) => r.knownPatterns).map((r) => r.id),
  );
  for (const dev of ctx.ledger().all()) {
    if (rulesWithKnownPatterns.has(dev.ruleId)) continue;
    const lines = dev.file === "source" ? sourceLines : headerLines;
    const openingLine = lines[dev.line - 1] ?? "";
    const commentMatch = openingLine.match(DEVIATION_COMMENT);
    const coversThis =
      commentMatch &&
      commentMatch[1].split(",").map((s) => s.trim()).includes(dev.ruleId);
    if (!coversThis) {
      // Opening line must carry the comment.
      findings.push({
        ruleId: dev.ruleId,
        severity: "required",
        line: dev.line,
        file: dev.file,
        snippet: openingLine.trim(),
        kind: "orphan-deviation",
      });
    }
  }

  return findings;
}
