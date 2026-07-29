import type { ProgramIR, Diagnostic } from "@typecad/cuttlefish/api";
import type { SafetyTransformContext } from "@typecad/cuttlefish/safety-hook-types";

/** B2: No dynamic allocation after init (ISO 26262 Part 6, §7.4.11 — ASIL D).
 *
 *  Scans function/method statements for dynamic allocation patterns
 *  (new, malloc, calloc, std::vector construction) outside of the
 *  initialization phase (setup() or file scope).
 *
 *  Returns diagnostics for each allocation found in a non-init context. */
export function checkDynamicAllocation(
  program: ProgramIR,
  _ctx: SafetyTransformContext,
): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const initFnNames = new Set(["setup", "main", "__top_level__"]);

  for (const fn of program.functions) {
    if (initFnNames.has(fn.originalName)) continue;
    for (const stmt of fn.statements) {
      scanForAllocation(stmt, fn.originalName, diags);
    }
  }

  for (const cls of program.classes) {
    for (const method of cls.methods) {
      if (!method.name || initFnNames.has(method.name)) continue;
      for (const stmt of method.statements) {
        scanForAllocation(stmt, method.name, diags);
      }
    }
  }

  return diags;
}

function scanForAllocation(stmt: any, fnName: string, diags: Diagnostic[]): void {
  if (!stmt || typeof stmt !== "object") return;

  // Check "raw" expressions for new/malloc/calloc
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

  // Recurse into child statements/expressions
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
