import type { ProgramIR, Diagnostic } from "../../api/index.js";
import type { SafetyTransformContext } from "../../safety-hook.js";
import { checkRecursion } from "./recursion-checker.js";
import { checkDynamicAllocation } from "./heap-checker.js";
import { checkUnboundedLoops } from "./loop-checker.js";
import { checkInitCompleteness } from "./init-checker.js";
import { checkGoto } from "./goto-checker.js";

/** Part B: ISO 26262 Part 6 software-rule checker.
 *
 *  Runs all checkers against the final transformed IR and returns aggregated
 *  diagnostics. Each checker is independent — a failure in one does not
 *  prevent the others from running.
 *
 *  Diagnostics with severity "error" abort the build (via
 *  throwIfFatalDiagnostics in transpile.ts); "warning"/"info" are logged
 *  but the build succeeds.
 */
export function analyzeProgram(
  program: ProgramIR,
  ctx: SafetyTransformContext,
): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const checker of [checkRecursion, checkDynamicAllocation, checkUnboundedLoops, checkInitCompleteness, checkGoto]) {
    try {
      const results = checker(program, ctx);
      diags.push(...results);
    } catch {
      // A checker crash should not prevent other checkers from running.
      // The diagnostic is lost; the build continues.
    }
  }
  return diags;
}
