import type { ProgramIR } from "../../api/index.js";
import type { SafetyTransformContext, SafetyMetadata, SafetyFunctionMetadata } from "../../safety-hook.js";
import { asilLevel } from "./asil.js";
import { analyzeProgram } from "./analyze.js";

/** Part C: collect safety metadata for sidecar artifact generation.
 *
 *  Walks the program IR and collects structured metadata about each
 *  safety-critical function (those with ASIL annotations):
 *  - ASIL level (from // @asilD / @asilC / @asilB comments)
 *  - Source location (TS file + line)
 *  - Safety mechanisms used (safe.read, safe.write, SafeVariable, SafeInt)
 *  - Rule check results (B1–B6 pass/warning/error)
 *
 *  The caller writes the returned metadata as a sidecar JSON file
 *  alongside the emitted C++ artifact. */
export function collectSafetyMetadata(
  program: ProgramIR,
  ctx: SafetyTransformContext,
): SafetyMetadata[] {
  const functions: SafetyFunctionMetadata[] = [];

  // Run the analyzers to get current rule results per function
  const diagnostics = analyzeProgram(program, ctx);
  const diagsByFunction = new Map<string, typeof diagnostics>();
  for (const d of diagnostics) {
    // Extract function name from the message (format: "Recursion detected: ..."
    // or "Dynamic allocation in fnName(): ...")
    const fnMatch = d.message.match(/in (\w+)\(\)/);
    const fnName = fnMatch ? fnMatch[1] : "";
    if (fnName) {
      if (!diagsByFunction.has(fnName)) {
        diagsByFunction.set(fnName, []);
      }
      diagsByFunction.get(fnName)!.push(d);
    }
  }

  const allRuleIds = ["B1_RECURSION", "B2_DYNAMIC_ALLOC", "B3_UNBOUNDED_LOOP", "B5_INIT_COMPLETENESS", "B6_GOTO"];

  for (const fn of program.functions) {
    const level = asilLevel(fn.decorators);
    if (level === 0) continue;

    const asilName = level === 4 ? "D" : level === 3 ? "C" : level === 2 ? "B" : level === 1 ? "A" : "QM";

    // Detect safety mechanisms used in this function
    const mechanisms = detectMechanisms(fn);

    // Build rule results: pass by default, override with diagnostics
    const rules: Record<string, "pass" | { severity: string; message: string }> = {};
    for (const ruleId of allRuleIds) {
      const fullCode = `ISO26262_${ruleId}`;
      const matchingDiags = (diagsByFunction.get(fn.originalName) ?? [])
        .filter(d => d.code === fullCode);
      if (matchingDiags.length > 0) {
        // Use the first matching diagnostic (they're all the same rule)
        rules[ruleId] = {
          severity: matchingDiags[0].severity,
          message: matchingDiags[0].message,
        };
      } else {
        rules[ruleId] = "pass";
      }
    }

    functions.push({
      name: fn.originalName,
      asilLevel: asilName,
      source: fn.sourceSpan ? {
        tsFile: fn.sourceSpan.filePath,
        tsLine: fn.sourceSpan.startLine,
      } : undefined,
      mechanisms,
      rules,
    });
  }

  // Also scan class methods
  for (const cls of program.classes) {
    for (const method of cls.methods) {
      if (!method.name) continue;
      const level = asilLevel(method.decorators);
      if (level === 0) continue;

      const asilName = level === 4 ? "D" : level === 3 ? "C" : level === 2 ? "B" : level === 1 ? "A" : "QM";
      const mechanisms = detectMechanisms({ parameters: [], statements: method.statements });

      const rules: Record<string, "pass" | { severity: string; message: string }> = {};
      for (const ruleId of allRuleIds) {
        rules[ruleId] = "pass";
      }

      functions.push({
        name: `${cls.name}::${method.name}`,
        asilLevel: asilName,
        mechanisms,
        rules,
      });
    }
  }

  return [{ functions }];
}

/** Scan a function's statements for safety-mechanism usage. */
function detectMechanisms(fn: { parameters: any[]; statements: any[] }): string[] {
  const mechanisms = new Set<string>();

  const scan = (stmt: any): void => {
    if (!stmt || typeof stmt !== "object") return;

    // HAL ops (safe.read → safety.read_safe, safe.write → safety.write_verify)
    if (stmt.kind === "hal-op" && typeof stmt.operation === "string") {
      if (stmt.operation === "safety.read_safe") mechanisms.add("safe.read");
      if (stmt.operation === "safety.write_verify") mechanisms.add("safe.write");
    }

    // Raw expressions mentioning SafeVariable or SafeInt
    if (stmt.kind === "raw" && typeof stmt.value === "string") {
      if (/\bSafeVariable</.test(stmt.value)) mechanisms.add("SafeVariable");
      if (/\bSafeInt/.test(stmt.value)) mechanisms.add("SafeInt");
    }

    // var_decl with cppType containing SafeVariable<SafeInt
    if (stmt.kind === "var_decl" && typeof stmt.cppType === "string") {
      if (/SafeVariable</.test(stmt.cppType)) mechanisms.add("SafeVariable");
      if (/SafeInt/.test(stmt.cppType)) mechanisms.add("SafeInt");
    }

    // Recurse
    for (const key of Object.keys(stmt)) {
      const val = stmt[key];
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === "object" && typeof item.kind === "string") {
            scan(item);
          }
        }
      } else if (val && typeof val === "object" && typeof val.kind === "string") {
        scan(val);
      }
    }
  };

  for (const stmt of fn.statements) {
    scan(stmt);
  }

  return [...mechanisms].sort();
}
