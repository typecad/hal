import type { ProgramIR, Diagnostic } from "../../api/index.js";
import type { SafetyTransformContext } from "../../safety-hook.js";
import { asilLevel, ASIL_THRESHOLDS } from "./asil.js";

/** B2: No dynamic allocation after init (ISO 26262 Part 6, §7.4.11 — ASIL D).
 *
 *  Only checks functions decorated with @asilD.
 *  Lower ASIL levels and QM functions are skipped. */
export function checkDynamicAllocation(
  program: ProgramIR,
  _ctx: SafetyTransformContext,
): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const initFnNames = new Set(["setup", "main", "__top_level__"]);

  for (const fn of program.functions) {
    if (initFnNames.has(fn.originalName)) continue;
    if (asilLevel(fn.decorators) < ASIL_THRESHOLDS.dynamicAlloc) continue;
    for (const stmt of fn.statements) {
      scanForAllocation(stmt, fn.originalName, diags);
    }
  }

  for (const cls of program.classes) {
    for (const method of cls.methods) {
      if (!method.name || initFnNames.has(method.name)) continue;
      if (asilLevel(method.decorators) < ASIL_THRESHOLDS.dynamicAlloc) continue;
      for (const stmt of method.statements) {
        scanForAllocation(stmt, method.name, diags);
      }
    }
  }

  return diags;
}

function scanForAllocation(stmt: any, fnName: string, diags: Diagnostic[]): void {
  if (!stmt || typeof stmt !== "object") return;

  if (stmt.kind === "raw" && typeof stmt.value === "string") {
    if (/\bnew\s+[A-Z_]/.test(stmt.value) || /\bmalloc\s*\(/.test(stmt.value) || /\bcalloc\s*\(/.test(stmt.value)) {
      diags.push({
        severity: "error",
        code: "ISO26262_B2_DYNAMIC_ALLOC",
        message: `Dynamic allocation in ${fnName}(): ${stmt.value.trim().slice(0, 80)}`,
        hint: "ASIL D forbids dynamic allocation after initialization. Pre-allocate in setup() or use a fixed-size buffer.",
      });
    }
  }

  for (const key of Object.keys(stmt)) {
    const val = stmt[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === "object" && typeof item.kind === "string") {
          scanForAllocation(item, fnName, diags);
        }
      }
    } else if (val && typeof val === "object" && typeof val.kind === "string") {
      scanForAllocation(val, fnName, diags);
    }
  }
}
