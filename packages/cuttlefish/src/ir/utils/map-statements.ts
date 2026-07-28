// ---------------------------------------------------------------------------
// mapProgramStatements — produce a NEW ProgramIR with statements mapped by fn.
//
// The existing walkers in walk-ir.ts are read-only; filterProgramIR
// (ir/filter.ts) produces a new IR but only filters, never injects. This
// helper extends the "produce-new-IR" idiom to "map each statement to N
// statements," which is what the safety pinMode-intercept pass needs to
// inject companion ops.
//
// Non-mutating: every statement container is rebuilt; the input program is
// untouched. The shape mirrors walkProgramIR's enumeration of containers
// (walk-ir.ts:107-134): topLevelStatements, functions, classes
// (constructor/methods/getters/setters), namespaces (recursively).
//
// KNOWN LIMITATION (Part A scope): does NOT recurse into nested statement
// bodies (if/for/while/switch/cases). Statements at the top level of a
// function body, class method, namespace function, or the file's top level
// ARE mapped. pinMode calls inside `if (...) { pinMode(...); }` are not. The
// safety package's design (docs/superpowers/specs/2026-07-27-safety-package-
// part-a-design.md) explicitly bounds Part A to this. A future iteration can
// thread mapping into nested bodies by recursing into thenBranch/elseBranch/
// body/initializer/increment/cases — see walkNestedStatements (walk-ir.ts:3).
// ---------------------------------------------------------------------------

import type { ProgramIR, StatementIR } from "../../api/shared/index.js";
import type { NamespaceIR } from "../../api/shared/ir.js";

/** Map each statement in the program to zero or more statements. The result
 *  is a new ProgramIR; the input is not modified. */
export function mapProgramStatements(
  program: ProgramIR,
  fn: (stmt: StatementIR) => StatementIR[],
): ProgramIR {
  const mapList = (stmts: StatementIR[]): StatementIR[] => {
    const out: StatementIR[] = [];
    for (const s of stmts) {
      const mapped = fn(s);
      for (const m of mapped) out.push(m);
    }
    return out;
  };

  const newFunctions = program.functions.map((f) => ({
    ...f,
    statements: mapList(f.statements),
  }));

  const newClasses = program.classes.map((cls) => ({
    ...cls,
    constructor: cls.constructor
      ? { ...cls.constructor, statements: mapList(cls.constructor.statements) }
      : cls.constructor,
    methods: cls.methods.map((m) => ({ ...m, statements: mapList(m.statements) })),
    getters: cls.getters.map((g) => ({ ...g, statements: mapList(g.statements) })),
    setters: cls.setters.map((s) => ({ ...s, statements: mapList(s.statements) })),
  }));

  const newNamespaces = program.namespaces.map((ns) => mapNamespace(ns, fn));

  return {
    ...program,
    topLevelStatements: mapList(program.topLevelStatements),
    functions: newFunctions,
    classes: newClasses,
    namespaces: newNamespaces,
  };
}

function mapNamespace(ns: NamespaceIR, fn: (s: StatementIR) => StatementIR[]): NamespaceIR {
  const mapList = (stmts: StatementIR[]): StatementIR[] => {
    const out: StatementIR[] = [];
    for (const s of stmts) out.push(...fn(s));
    return out;
  };
  return {
    ...ns,
    functions: ns.functions.map((f) => ({ ...f, statements: mapList(f.statements) })),
    classes: ns.classes.map((cls) => ({
      ...cls,
      constructor: cls.constructor
        ? { ...cls.constructor, statements: mapList(cls.constructor.statements) }
        : cls.constructor,
      methods: cls.methods.map((m) => ({ ...m, statements: mapList(m.statements) })),
      getters: cls.getters.map((g) => ({ ...g, statements: mapList(g.statements) })),
      setters: cls.setters.map((s) => ({ ...s, statements: mapList(s.statements) })),
    })),
    children: ns.children ? ns.children.map((c) => mapNamespace(c, fn)) : ns.children,
  };
}
