export { ComplianceContext } from "./compliance-context.js";
export { DeviationLedger } from "./deviation-ledger.js";
export { runSelfCheck } from "./rule-engine.js";
export { renderRegistryJson } from "./deviation-writer.js";
export { renderArxml } from "./arxml-writer.js";
export { RULES, getRule, rulesByCategory } from "./rules.js";
export type {
  ComplianceMode,
  RuleEntry,
  RuleSeverity,
  RuleCategory,
  Deviation,
  DeviationKind,
  SelfCheckFinding,
} from "./types.js";
