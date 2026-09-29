// ---------------------------------------------------------------------------
// param-mutation.ts — record-parameter const&& demotion.
//
// User-struct parameters pass by const& by design ("surface accidental
// mutations"). But a body that legitimately writes fields through the
// parameter (`step(t: Task) { t.runs += 1 }`) failed at g++ with
// "assignment of member in read-only object" — the designed escape
// (annotating Mutable<T>) is undocumented at the error site, and the
// engine's established philosophy for the identical situation on LOCAL
// declarations is to demote with an info diagnostic
// (ownership-const-content-mutated). This pass applies the same treatment
// to parameters: scan the body for field writes through a record-typed
// parameter and stamp ownershipKind='mutable' so renderParameters emits a
// non-const reference.
// ---------------------------------------------------------------------------

import type { StatementIR } from "../../api/index.js";

export interface ParamLike {
  name: string;
  cppType: string;
  ownershipKind?: 'owned' | 'shared' | 'mutable';
}

/** True when the C++ type is a user record (non-primitive, non-container,
 *  non-pointer) — the shapes renderParameters borrows as const&. */
function isRecordCppType(cppType: string): boolean {
  const t = cppType.trim();
  if (t === "auto" || t === "void") return false;
  if (t.endsWith("*") || t.endsWith("&")) return false;
  if (/^(?:const\s+)?(?:std::string|std::vector<|std::map<|std::set<|std::pair<|__tc_StaticArray<|StaticArray<)/.test(t)) return false;
  if (/^(?:u?int(?:8|16|32|64)_t|double|float|bool|char|short|long(?:\s+long)?|unsigned(?:\s+\w+)?|size_t|int|void)$/.test(t)) return false;
  return true;
}

/** Collect assignment targets of the form `<base>.<field>` / `<base>-><field>`
 *  reachable in the statement tree (bodies, branches, nested blocks). */
function collectFieldWriteBases(stmts: readonly StatementIR[], into: Set<string>): void {
  const walkStmt = (stmt: StatementIR): void => {
    if (stmt.kind === "assign") {
      const m = /^([A-Za-z_]\w*)(?:\.|->)/.exec(stmt.target);
      if (m) into.add(m[1]);
    }
    for (const key of ["body", "thenBranch", "elseBranch"] as const) {
      const branch = (stmt as unknown as { [k: string]: unknown })[key];
      if (Array.isArray(branch)) {
        for (const s of branch as StatementIR[]) walkStmt(s);
      }
    }
    if (stmt.kind === "switch") {
      for (const c of stmt.cases) {
        for (const s of c.body) walkStmt(s);
      }
    }
    // for/while conditions hold no writes; initializers are statements in body
  };
  for (const s of stmts) walkStmt(s);
}

/**
 * Returns the parameters with record-typed, body-mutated entries stamped
 * ownershipKind='mutable' (new array; untouched params are shared as-is).
 * A parameter that already carries explicit ownership is left alone.
 */
export function stampMutableRecordParams<T extends ParamLike>(
  parameters: readonly T[],
  statements: readonly StatementIR[],
): T[] {
  if (parameters.length === 0) return [...parameters];
  const writeBases = new Set<string>();
  collectFieldWriteBases(statements, writeBases);
  if (writeBases.size === 0) return [...parameters];
  return parameters.map((p) => {
    if (p.ownershipKind !== undefined) return p;
    if (!isRecordCppType(p.cppType)) return p;
    if (!writeBases.has(p.name)) return p;
    return { ...p, ownershipKind: 'mutable' as const };
  });
}
