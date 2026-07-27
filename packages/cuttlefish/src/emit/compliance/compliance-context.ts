import { DeviationLedger } from "./deviation-ledger.js";
import { getRule, rulesByCategory } from "./rules.js";
import type { ComplianceMode, DeviationKind } from "./types.js";

/**
 * Per-emit compliance bag, threaded through EmitterContext. Owns the
 * deviation ledger and exposes the renderer-facing API.
 *
 * When mode === "off" (the default), every method is a no-op: helpers
 * return their input unchanged, nothing is recorded. This is what lets
 * the feature land without changing any existing emitted output.
 */
export class ComplianceContext {
  private readonly ledgerInstance = new DeviationLedger();
  private readonly bannedKinds: Set<string>;

  constructor(private readonly complianceMode: ComplianceMode) {
    // Precompute the set of [C]-category rule ids once.
    this.bannedKinds = new Set(rulesByCategory("C").map((r) => r.id));
  }

  mode(): ComplianceMode {
    return this.complianceMode;
  }

  isEnabled(): boolean {
    return this.complianceMode !== "off";
  }

  ledger(): Readonly<DeviationLedger> {
    return this.ledgerInstance;
  }

  /**
   * Record a deviation for a known unavoidable pattern (used by the
   * self-check's knownPatterns mechanism). Unlike emitWithDeviation, this
   * does NOT append an inline comment — the deviation is recorded in the
   * ledger only, so the sidecar lists it. The emitted C++ text is unchanged.
   */
  recordKnownDeviation(
    ruleId: string,
    justification: string,
    line: number,
    file: "source" | "header",
    snippet: string,
    source?: { tsFile: string; tsLine: number; kind: DeviationKind },
  ): void {
    if (!this.isEnabled()) return;
    this.ledgerInstance.record({
      ruleId,
      file,
      line,
      snippet,
      justification,
      source,
    });
  }

  /** Renderer gate: should it avoid the banned spelling for this rule? */
  isBanned(ruleId: string): boolean {
    if (!this.isEnabled()) return false;
    return this.bannedKinds.has(ruleId);
  }

  /**
   * Returns `line` with an appended inline deviation comment, and records
   * the deviation(s) to the ledger atomically. The two cannot drift apart.
   *
   * `line` is the C++ text the renderer was already going to emit (without
   * a trailing newline). `currentLine` is the 1-based line number it will
   * occupy in the emitted file (used for the ledger).
   */
  emitWithDeviation(
    line: string,
    ruleId: string | string[],
    justification: string,
    currentLine: number = 0,
    file: "source" | "header" = "source",
    source?: { tsFile: string; tsLine: number; kind: DeviationKind },
  ): string {
    if (!this.isEnabled()) return line;
    const ids = Array.isArray(ruleId) ? ruleId : [ruleId];
    for (const id of ids) {
      if (!getRule(id)) {
        throw new Error(`Unknown AUTOSAR rule id: ${id}`);
      }
    }
    const tag = ids.join(", ");
    for (const id of ids) {
      this.ledgerInstance.record({
        ruleId: id,
        file,
        line: currentLine,
        snippet: line,
        justification,
        source,
      });
    }
    return `${line}  // AUTOSAR Deviation ${tag}: ${justification}`;
  }

  /**
   * Opens a deviation region. Returns the opening line with the inline
   * comment appended (the renderer emits this as the first line of the
   * block). The matching closeDeviationRegion records the endLine.
   */
  openDeviationRegion(
    ruleId: string,
    justification: string,
    startLine: number,
    openingSnippet: string,
    file: "source" | "header" = "source",
  ): string {
    if (!this.isEnabled()) return openingSnippet;
    if (!getRule(ruleId)) {
      throw new Error(`Unknown AUTOSAR rule id: ${ruleId}`);
    }
    this.ledgerInstance.openRegion({
      ruleId,
      file,
      line: startLine,
      snippet: openingSnippet,
      justification,
    });
    return `${openingSnippet}  // AUTOSAR Deviation ${ruleId}: ${justification}`;
  }

  closeDeviationRegion(endLine: number): void {
    if (!this.isEnabled()) return;
    this.ledgerInstance.closeRegion(endLine);
  }

  /**
   * Optional positive assertion: "I deliberately satisfied ruleId here."
   * No-op today; recorded for future coverage tooling.
   */
  noteCompliant(_ruleId: string): void {
    // intentionally no-op; reserved for future use.
  }
}
