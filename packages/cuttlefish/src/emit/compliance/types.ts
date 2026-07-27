/**
 * Shared types for the AUTOSAR C++14 compliance module.
 * See docs/superpowers/specs/2026-07-26-autosar-compliance-design.md.
 */

export type ComplianceMode = "off" | "warn" | "strict";

export type RuleSeverity = "required" | "advisory";

export type RuleCategory = "C" | "D";
// C = enforce-by-construction (renderer picks a compliant spelling)
// D = deviation-required (unavoidable; gets inline comment + registry entry)

export type DeviationKind =
  | "hal-instance"
  | "lowered-exception"
  | "ts-literal"
  | "polyfill"
  | "freestanding-function"
  | "raw-array"
  | "other";

/** A single AUTOSAR C++14 rule entry in the curated subset. */
export interface RuleEntry {
  id: string;             // e.g. "M5-0-7"
  title: string;
  severity: RuleSeverity;
  category: RuleCategory;
  /** Anchored regex that detects the banned construct in emitted text. Optional: absence means rule is enforced structurally only. */
  detect?: RegExp;
  /** Regex that, if matched on the same line, suppresses the detect match (e.g. the `static_cast` spelling for M5-0-7). */
  exempt?: RegExp;
  /** Per-rule kill switch. When false, the rule is loaded but neither renderer-gated nor self-checked. */
  enabled: boolean;
  /**
   * Known unavoidable patterns for this rule. When the self-check detects a
   * match for a knownPattern, it records a deviation (instead of flagging an
   * unrecorded-violation) and suppresses the diagnostic. Used for rules whose
   * violations are structural and can't be eliminated (e.g. function-pointer
   * typedefs in ESP32 callbacks, signed bitwise in display color math).
   */
  knownPatterns?: Array<{ detect: RegExp; justification: string; kind: DeviationKind }>;
}

/** One recorded deviation, accumulated during emit. */
export interface Deviation {
  ruleId: string;
  file: "source" | "header";
  line: number;          // 1-based
  endLine: number;       // inclusive; equals `line` for single-line deviations
  snippet: string;
  justification: string;
  reviewStatus: "auto-generated" | "accepted";
  /** Traceability back to the originating TypeScript. Populated from the source-map. */
  source?: {
    tsFile: string;
    tsLine: number;
    kind: DeviationKind;
  };
}

/** A finding from the post-emit self-check pass. */
export interface SelfCheckFinding {
  ruleId: string;
  severity: RuleSeverity;
  line: number;          // 1-based, into the emitted file
  file: "source" | "header";
  snippet: string;
  kind: "unrecorded-violation" | "orphan-deviation";
}

// Tagged sentinel export so `import * as` resolves to a non-empty namespace
// even though every other export here is a type. This lets the types.test.ts
// runtime-import check actually verify the module is present.
export const COMPLIANCE_TYPES_MODULE = true;
