import type { ProgramIR, Diagnostic } from "@typecad/cuttlefish/api";
import type { SafetyTransformContext } from "@typecad/cuttlefish/safety-hook-types";

/** B3: Unbounded loop detection (ISO 26262 Part 6, §7.4.10).
 *
 *  Scans for while(true), while(1), for(;;), and while conditions that
 *  are constant-literal true. Bounded loops (for (i=0; i<N; i++),
 *  while (sensorRead())) are allowed.
 *
 *  Returns warnings for each unbounded loop found. */
export function checkUnboundedLoops(
  program: ProgramIR,
  _ctx: SafetyTransformContext,
): Diagnostic[] {
  const diags: Diagnostic[] = [];

  for (const fn of program.functions) {
    for (const stmt of fn.statements) {
      scanForUnboundedLoop(stmt, fn.originalName, diags);
    }
  }

  for (const cls of program.classes) {
    for (const method of cls.methods) {
      if (!method.name) continue;
      for (const stmt of method.statements) {
        scanForUnboundedLoop(stmt, method.name, diags);
      }
    }
  }

  return diags;
}

function scanForUnboundedLoop(stmt: any, fnName: string, diags: Diagnostic[]): void {
  if (!stmt || typeof stmt !== "object") return;

  // while(true) / while(1) — condition is a literal true or non-zero number
  if (stmt.kind === "while") {
    const cond = stmt.condition;
    if (isConstantTrue(cond)) {
      diags.push({
        severity: "warning",
        code: "ISO26262_B3_UNBOUNDED_LOOP",
        message: `Unbounded while(true) in ${fnName}()`,
        hint: "Use a bounded loop counter or a timeout guard to ensure termination.",
      });
    }
  }

  // for(;;) — empty condition
  if (stmt.kind === "for" && !stmt.condition) {
    diags.push({
      severity: "warning",
      code: "ISO26262_B3_UNBOUNDED_LOOP",
      message: `Unbounded for(;;) in ${fnName}()`,
      hint: "Use a bounded loop counter or a timeout guard to ensure termination.",
    });
  }

  // do-while(true)
  if (stmt.kind === "do_while") {
    const cond = stmt.condition;
    if (isConstantTrue(cond)) {
      diags.push({
        severity: "warning",
        code: "ISO26262_B3_UNBOUNDED_LOOP",
        message: `Unbounded do-while(true) in ${fnName}()`,
        hint: "Use a bounded loop counter or a timeout guard to ensure termination.",
      });
    }
  }

  // Recurse into child statements
  for (const key of Object.keys(stmt)) {
    const val = stmt[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === "object" && typeof item.kind === "string") {
          scanForUnboundedLoop(item, fnName, diags);
        }
      }
    } else if (val && typeof val === "object" && typeof val.kind === "string") {
      scanForUnboundedLoop(val, fnName, diags);
    }
  }
}

function isConstantTrue(expr: any): boolean {
  if (!expr) return false;
  if (expr.kind === "raw" && typeof expr.value === "string") {
    return /^(true|1)$/.test(expr.value.trim());
  }
  // Boolean literal or non-zero number literal
  if (expr.kind === "boolean" && expr.value === true) return true;
  if (expr.kind === "number" && expr.value !== 0) return true;
  return false;
}
