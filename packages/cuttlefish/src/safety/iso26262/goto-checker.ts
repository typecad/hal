import type { ProgramIR, Diagnostic } from "../../api/index.js";
import type { SafetyTransformContext } from "../../safety-hook.js";
import { asilLevel, ASIL_THRESHOLDS } from "./asil.js";

/** B6: No unconstrained goto (ISO 26262 Part 6, §7.4.8 — ASIL C+).
 *
 *  Scans for goto statements in emitted IR. Cuttlefish's only source of
 *  goto is labeled break lowering (TS `break labelName;` → C++ `goto
 *  __break_labelName;`). While this is a controlled use, ISO 26262 C+
 *  restricts goto to specific patterns (forward, within the same block).
 *  Reports each goto as an info-level diagnostic for awareness. */
export function checkGoto(
  program: ProgramIR,
  _ctx: SafetyTransformContext,
): Diagnostic[] {
  const diags: Diagnostic[] = [];

  for (const fn of program.functions) {
    if (asilLevel(fn.decorators) < ASIL_THRESHOLDS.unboundedLoop) continue;
    for (const stmt of fn.statements) {
      scanForGoto(stmt, fn.originalName, diags);
    }
  }

  for (const cls of program.classes) {
    for (const method of cls.methods) {
      if (!method.name) continue;
      if (asilLevel(method.decorators) < ASIL_THRESHOLDS.unboundedLoop) continue;
      for (const stmt of method.statements) {
        scanForGoto(stmt, method.name, diags);
      }
    }
  }

  return diags;
}

function scanForGoto(stmt: any, fnName: string, diags: Diagnostic[]): void {
  if (!stmt || typeof stmt !== "object") return;

  // Check for goto in raw expressions (lowered from labeled break)
  if (stmt.kind === "raw" && typeof stmt.value === "string") {
    if (/\bgoto\s+\w+/.test(stmt.value)) {
      const match = stmt.value.match(/\bgoto\s+(\w+)/);
      const label = match ? match[1] : "unknown";
      diags.push({
        severity: "info",
        code: "ISO26262_B6_GOTO",
        message: `goto ${label} in ${fnName}() — lowered from labeled break`,
        hint: "ISO 26262 C+ restricts goto. Consider restructuring with a flag variable or early return.",
      });
    }
  }

  // Check for the "labeled" statement kind (cuttlefish's IR representation
  // of labeled break — the actual goto is emitted as a raw statement
  // during rendering, but the labeled IR node is present at analysis time).
  if (stmt.kind === "labeled" && typeof stmt.label === "string") {
    diags.push({
      severity: "info",
      code: "ISO26262_B6_GOTO",
      message: `Labeled break '${stmt.label}' in ${fnName}() will lower to goto`,
      hint: "ISO 26262 C+ restricts goto. Consider restructuring with a flag variable or early return.",
    });
  }

  // Recurse
  for (const key of Object.keys(stmt)) {
    const val = stmt[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === "object" && typeof item.kind === "string") {
          scanForGoto(item, fnName, diags);
        }
      }
    } else if (val && typeof val === "object" && typeof val.kind === "string") {
      scanForGoto(val, fnName, diags);
    }
  }
}
