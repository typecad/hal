import type { ProgramIR, Diagnostic } from "../../api/index.js";
import type { SafetyTransformContext } from "../../safety-hook.js";
import { asilLevel, ASIL_THRESHOLDS } from "./asil.js";

/** B5: Init completeness (ISO 26262 Part 6, §7.4.5 — ASIL D).
 *
 *  Checks that every identifier used in a safety-critical function (ASIL D)
 *  was initialized in setup() or at file scope. An uninitialized variable
 *  in a safety-critical path is a potential source of undefined behavior.
 *
 *  Approach: collect identifiers assigned/declared in setup() and top-level
 *  (the "init set"), then walk each ASIL D function's statements looking
 *  for identifiers used before any local assignment. Reports each as a
 *  warning. */
export function checkInitCompleteness(
  program: ProgramIR,
  _ctx: SafetyTransformContext,
): Diagnostic[] {
  const diags: Diagnostic[] = [];

  // Collect the "init set": identifiers declared/assigned in setup() and
  // top-level statements. These are considered initialized.
  const initSet = new Set<string>();

  // Top-level var_decls and assignments
  for (const stmt of program.topLevelStatements) {
    collectAssignedNames(stmt, initSet);
  }

  // setup() statements
  const setupFn = program.functions.find(fn => fn.originalName === "setup");
  if (setupFn) {
    for (const stmt of setupFn.statements) {
      collectAssignedNames(stmt, initSet);
    }
  }

  // Check each ASIL D function for use of identifiers not in the init set
  for (const fn of program.functions) {
    if (fn.originalName === "setup" || fn.originalName === "loop") continue;
    if (asilLevel(fn.decorators) < ASIL_THRESHOLDS.dynamicAlloc) continue;

    // Collect locally-declared names in this function (params + local vars)
    const localNames = new Set<string>();
    for (const param of fn.parameters) {
      localNames.add(param.name);
    }

    // Walk statements — look for identifiers used before local declaration
    for (const stmt of fn.statements) {
      checkUsedBeforeDeclared(stmt, fn.originalName, initSet, localNames, diags);
    }
  }

  return diags;
}

/** Collect names that are declared or assigned in a statement tree. */
function collectAssignedNames(stmt: any, names: Set<string>): void {
  if (!stmt || typeof stmt !== "object") return;

  if (stmt.kind === "var_decl" && typeof stmt.name === "string") {
    names.add(stmt.name);
  }
  if (stmt.kind === "assign" && typeof stmt.target === "string") {
    names.add(stmt.target);
  }
  if (stmt.kind === "update" && typeof stmt.target === "string") {
    names.add(stmt.target);
  }

  for (const key of Object.keys(stmt)) {
    const val = stmt[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === "object" && typeof item.kind === "string") {
          collectAssignedNames(item, names);
        }
      }
    } else if (val && typeof val === "object" && typeof val.kind === "string") {
      collectAssignedNames(val, names);
    }
  }
}

/** Check if a statement uses identifiers that were never initialized. */
function checkUsedBeforeDeclared(
  stmt: any,
  fnName: string,
  initSet: Set<string>,
  localNames: Set<string>,
  diags: Diagnostic[],
): void {
  if (!stmt || typeof stmt !== "object") return;

  // Check identifiers used in expressions
  if (stmt.kind === "identifier" && typeof stmt.value === "string") {
    const name = stmt.value;
    // Skip if it's initialized at file scope/setup, or declared locally,
    // or it's a known built-in (skip common names).
    if (!initSet.has(name) && !localNames.has(name) && !isBuiltin(name)) {
      diags.push({
        severity: "warning",
        code: "ISO26262_B5_INIT_COMPLETENESS",
        message: `Variable '${name}' used in ${fnName}() may not be initialized in setup() or at file scope`,
        hint: "ASIL D requires all variables in safety-critical paths to be initialized before use. Initialize in setup() or declare at file scope.",
      });
    }
  }

  // Recurse
  for (const key of Object.keys(stmt)) {
    const val = stmt[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === "object" && typeof item.kind === "string") {
          checkUsedBeforeDeclared(item, fnName, initSet, localNames, diags);
        }
      }
    } else if (val && typeof val === "object" && typeof val.kind === "string") {
      checkUsedBeforeDeclared(val, fnName, initSet, localNames, diags);
    }
  }
}

function isBuiltin(name: string): boolean {
  // Common names that don't need explicit init
  const builtins = new Set([
    "true", "false", "null", "undefined", "undefined_t",
    "console", "Math", "Timing", "Serial", "WDT", "Preferences",
    "delay", "millis", "micros", "delayMicroseconds",
    "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "INPUT_PULLDOWN",
    "LED_BUILTIN", "Serial",
    // Cuttlefish internal names
    "__tc_", "SafeReadResult", "SafeWriteResult", "SafeVariable", "SafeInt",
    "safe", "volatile",
  ]);
  if (builtins.has(name)) return true;
  // Skip names starting with __ (cuttlefish internal)
  if (name.startsWith("__")) return true;
  // Skip all-caps names (likely macros/constants)
  if (name === name.toUpperCase() && name.length > 1) return true;
  return false;
}
