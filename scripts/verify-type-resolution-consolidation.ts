// ---------------------------------------------------------------------------
// verify-type-resolution-consolidation.ts
//
// Targeted verification that the three-phase type-resolution consolidation
// is wired end-to-end. This is NOT a transpile-pipeline demo — it exercises
// each phase's new public surface directly:
//
//   Phase 1 — IrTypeScope (symbol-types.ts): locals/globals/classFields resolve
//             through the explicit scope object; reset re-seeds from classFields.
//   Phase 2 — SymbolTable (symbol-table.ts): buildSymbolTable + mergeSymbolTable
//             + resolveInheritance aggregate cross-file field types, accessors,
//             function return types, and variable types.
//   Phase 3 — cppTypeFromCanonicalType (semantic-facts.ts): the concrete C++
//             type projection from a ts.Type's canonical category.
//
// Run:  npx tsx scripts/verify-type-resolution-consolidation.ts
// (or compile to dist first and run with node)
// ---------------------------------------------------------------------------

import assert from "node:assert";
import ts from "typescript";
import {
  createIrTypeScope,
  resetIrTypeScopeFunctionState,
  bindIrTypeScopeLocals,
  setScopeLocalType,
  getCurrentIrTypeScope,
  setCurrentIrTypeScope,
  requireCurrentIrTypeScope,
} from "../packages/cuttlefish/src/ir/symbol-types";
import {
  buildSymbolTable,
  mergeSymbolTable,
  resolveInheritance,
  createSymbolTable,
} from "../packages/cuttlefish/src/ir/symbol-table";
import {
  canonicalize,
  cppTypeFromCanonicalType,
} from "../packages/cuttlefish/src/orchestrator/semantic-facts";
import type { ProgramIR } from "../packages/cuttlefish/src/api";

let passed = 0;
const failed: string[] = [];

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    failed.push(`${name}: ${msg}`);
    console.log(`  \u2717 ${name}\n      ${msg}`);
  }
}

// ===========================================================================
// PHASE 1 — IrTypeScope
// ===========================================================================
console.log("\nPhase 1 — IrTypeScope (symbol-types.ts)");

check("createIrTypeScope yields three empty maps", () => {
  const scope = createIrTypeScope();
  assert.strictEqual(scope.locals.size, 0);
  assert.strictEqual(scope.globals.size, 0);
  assert.strictEqual(scope.classFields.size, 0);
});

check("setScopeLocalType writes to the current scope's locals", () => {
  const scope = createIrTypeScope();
  setCurrentIrTypeScope(scope);
  setScopeLocalType("x", "double");
  assert.strictEqual(scope.locals.get("x"), "double");
  assert.strictEqual(getCurrentIrTypeScope()?.locals.get("x"), "double");
});

check("resetFunctionScopeState clears locals and re-seeds from classFields", () => {
  const scope = createIrTypeScope();
  setCurrentIrTypeScope(scope);
  scope.classFields.set("this->count", "int");
  scope.locals.set("x", "double"); // will be wiped
  resetIrTypeScopeFunctionState(scope);
  assert.strictEqual(scope.locals.get("x"), undefined, "locals should be cleared");
  assert.strictEqual(
    scope.locals.get("this->count"),
    "int",
    "classFields should be re-seeded into locals",
  );
  assert.strictEqual(
    scope.classFields.get("this->count"),
    "int",
    "classFields survive a function reset",
  );
});

check("bindIrTypeScopeLocals copies (not aliases) the threaded map", () => {
  const scope = createIrTypeScope();
  setCurrentIrTypeScope(scope);
  scope.classFields.set("this->k", "int");
  const threaded = new Map<string, string>([["param", "std::string"]]);
  resetIrTypeScopeFunctionState(scope); // re-seeds this->k into scope.locals
  bindIrTypeScopeLocals(scope, threaded);
  // After bind: scope.locals has both classFields re-seed AND the threaded entry.
  assert.strictEqual(scope.locals.get("this->k"), "int");
  assert.strictEqual(scope.locals.get("param"), "std::string");
  // Crucially NOT aliased: a later reset clears scope.locals but leaves the
  // threaded map intact (this is the bug we caught and fixed in Phase 1).
  resetIrTypeScopeFunctionState(scope);
  assert.strictEqual(threaded.get("param"), "std::string", "threaded map survives reset");
  assert.strictEqual(scope.locals.get("param"), undefined, "scope.locals cleared");
});

check("requireCurrentIrTypeScope throws when none is set", () => {
  setCurrentIrTypeScope(undefined);
  assert.throws(() => requireCurrentIrTypeScope(), /no IrTypeScope is active/);
  // Restore for subsequent checks.
  setCurrentIrTypeScope(createIrTypeScope());
});

check("globals accumulate across function resets", () => {
  const scope = createIrTypeScope();
  setCurrentIrTypeScope(scope);
  scope.globals.set("CONFIG", "int");
  resetIrTypeScopeFunctionState(scope);
  assert.strictEqual(scope.globals.get("CONFIG"), "int", "globals survive function reset");
});

setCurrentIrTypeScope(undefined);

// ===========================================================================
// PHASE 2 — SymbolTable
// ===========================================================================
console.log("\nPhase 2 — SymbolTable (symbol-table.ts)");

// Fabricate two minimal ProgramIRs (one per "file") to exercise aggregation +
// inheritance. The shapes mirror what build-ir produces.
const fileA: ProgramIR = {
  fileName: "a.ts",
  functions: [
    { originalName: "getScore", name: "getScore", returnType: "double", parameters: [], body: [], locals: [] } as any,
  ],
  classes: [
    {
      name: "Animal",
      extendsClass: undefined,
      fields: [{ name: "name", cppType: "std::string" } as any],
      getters: [{ name: "name" } as any],
      setters: [],
      constructors: [],
      methods: [],
    } as any,
    {
      name: "Dog",
      extendsClass: "Animal",
      fields: [{ name: "breed", cppType: "std::string" } as any],
      getters: [],
      setters: [],
      constructors: [],
      methods: [],
    } as any,
  ],
  interfaces: [
    {
      name: "Bank",
      fields: [
        { name: "id", cppType: "int" } as any,
        { name: "balance", cppType: "double" } as any,
      ],
    } as any,
  ],
  enums: [],
  namespaces: [],
  topLevelStatements: [
    { kind: "var_decl", name: "PI", cppType: "double" } as any,
    { kind: "var_decl", name: "scratch", cppType: "auto" } as any, // auto excluded
  ],
} as any;

const fileB: ProgramIR = {
  fileName: "b.ts",
  functions: [
    { originalName: "getName", name: "getName", returnType: "std::string", parameters: [], body: [], locals: [] } as any,
  ],
  classes: [],
  interfaces: [],
  enums: [],
  namespaces: [],
  topLevelStatements: [
    { kind: "var_decl", name: "PI", cppType: "int" } as any, // last-write-wins
    { kind: "var_decl", name: "count", cppType: "int" } as any,
  ],
} as any;

check("buildSymbolTable collects one file's facts", () => {
  const t = buildSymbolTable(fileA);
  assert.strictEqual(t.classNames.has("Animal"), true);
  assert.strictEqual(t.classNames.has("Dog"), true);
  assert.strictEqual(t.classFieldTypes.get("Animal")?.get("name"), "std::string");
  assert.strictEqual(t.classFieldTypes.get("Bank")?.get("id"), "int");
  assert.strictEqual(t.classAccessors.get("Animal")?.get("name"), "getter");
  assert.strictEqual(t.functionReturnTypes.get("getScore"), "double");
  assert.strictEqual(t.variableTypes.get("PI"), "double");
  assert.strictEqual(t.variableTypes.has("scratch"), false, "auto vars excluded");
  // extends relationship recorded, NOT yet inherited:
  assert.strictEqual(t.extends.get("Dog"), "Animal");
  assert.strictEqual(
    t.classFieldTypes.get("Dog")?.has("name"),
    false,
    "inheritance not applied until resolveInheritance",
  );
});

check("mergeSymbolTable unions two files + last-write-wins for vars", () => {
  const cross = createSymbolTable();
  mergeSymbolTable(cross, buildSymbolTable(fileA));
  mergeSymbolTable(cross, buildSymbolTable(fileB));
  assert.strictEqual(cross.classNames.has("Animal"), true);
  assert.strictEqual(cross.functionReturnTypes.get("getName"), "std::string");
  assert.strictEqual(cross.functionReturnTypes.get("getScore"), "double");
  // PI last-write-wins: fileB's int overwrote fileA's double
  assert.strictEqual(cross.variableTypes.get("PI"), "int");
  assert.strictEqual(cross.variableTypes.get("count"), "int");
});

check("resolveInheritance copies parent fields the child lacks (parent wins rule)", () => {
  const cross = createSymbolTable();
  mergeSymbolTable(cross, buildSymbolTable(fileA));
  resolveInheritance(cross);
  const dogFields = cross.classFieldTypes.get("Dog");
  assert.ok(dogFields, "Dog should have a field entry after inheritance");
  assert.strictEqual(dogFields!.get("breed"), "std::string", "own field retained");
  assert.strictEqual(dogFields!.get("name"), "std::string", "inherited parent field");
});

check("resolveInheritance: child field declaration wins over parent", () => {
  const parentChild: ProgramIR = {
    fileName: "x.ts",
    classes: [
      { name: "Base", extendsClass: undefined, fields: [{ name: "v", cppType: "int" } as any], getters: [], setters: [], constructors: [], methods: [] } as any,
      { name: "Derived", extendsClass: "Base", fields: [{ name: "v", cppType: "double" } as any], getters: [], setters: [], constructors: [], methods: [] } as any,
    ],
    interfaces: [],
    functions: [],
    enums: [],
    namespaces: [],
    topLevelStatements: [],
  } as any;
  const cross = createSymbolTable();
  mergeSymbolTable(cross, buildSymbolTable(parentChild));
  resolveInheritance(cross);
  assert.strictEqual(
    cross.classFieldTypes.get("Derived")?.get("v"),
    "double",
    "child's own field wins over parent's",
  );
});

check("accessor merge: getter+setter across files → both", () => {
  const withGetter: ProgramIR = {
    fileName: "g.ts", classes: [{ name: "C", extendsClass: undefined, fields: [], getters: [{ name: "x" } as any], setters: [], constructors: [], methods: [] } as any],
    interfaces: [], functions: [], enums: [], namespaces: [], topLevelStatements: [],
  } as any;
  const withSetter: ProgramIR = {
    fileName: "s.ts", classes: [{ name: "C", extendsClass: undefined, fields: [], getters: [], setters: [{ name: "x" } as any], constructors: [], methods: [] } as any],
    interfaces: [], functions: [], enums: [], namespaces: [], topLevelStatements: [],
  } as any;
  const cross = createSymbolTable();
  mergeSymbolTable(cross, buildSymbolTable(withGetter));
  mergeSymbolTable(cross, buildSymbolTable(withSetter));
  assert.strictEqual(cross.classAccessors.get("C")?.get("x"), "both");
});

// ===========================================================================
// PHASE 3 — cppTypeFromCanonicalType
// ===========================================================================
console.log("\nPhase 3 — cppTypeFromCanonicalType (semantic-facts.ts)");

function analyze(expr: string): { checker: ts.TypeChecker; typeOf: (name: string) => ts.Type } {
  const fileName = "phase3.ts";
  const sourceText = expr;
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  // Use the default lib so typed-array and built-in types resolve correctly
  // (a custom no-lib host would make Uint8Array etc. resolve to "any").
  const host = ts.createCompilerHost({});
  const realGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (n, ...rest) =>
    n === fileName ? source : realGetSourceFile(n, ...rest);
  const program = ts.createProgram({
    rootNames: [fileName],
    options: { target: ts.ScriptTarget.Latest, lib: ["lib.es2020.d.ts", "lib.dom.d.ts"] },
    host,
  });
  const checker = program.getTypeChecker();
  return {
    checker,
    typeOf: (name: string) => {
      let found: ts.Type | undefined;
      source.forEachChild(function visit(node) {
        if (ts.isIdentifier(node) && node.text === name && !found) {
          found = checker.getTypeAtLocation(node);
        }
        ts.forEachChild(node, visit);
      });
      if (!found) throw new Error(`no identifier '${name}' in: ${expr}`);
      return found;
    },
  };
}

check("number → double, string → std::string, boolean → bool", () => {
  const { checker, typeOf } = analyze(`const n = 42; const s = "hi"; const b = true;`);
  expectCpp(checker, typeOf("n"), "double");
  expectCpp(checker, typeOf("s"), "std::string");
  expectCpp(checker, typeOf("b"), "bool");
});

check("typed arrays → element pointer types", () => {
  const { checker, typeOf } = analyze(`const u8 = new Uint8Array(4); const f64 = new Float64Array(2);`);
  expectCpp(checker, typeOf("u8"), "uint8_t*");
  expectCpp(checker, typeOf("f64"), "double*");
});

check("class/interface → bare struct name", () => {
  const { checker, typeOf } = analyze(
    `interface Account { id: number; }\n     class Bank { name: string = ""; }\n     const a: Account = { id: 1 };\n     const bk = new Bank();`,
  );
  expectCpp(checker, typeOf("a"), "Account");
  expectCpp(checker, typeOf("bk"), "Bank");
});

check("arrays/maps/sets → undefined (SymbolTable concern)", () => {
  const { checker, typeOf } = analyze(`const arr = [1,2,3]; const m = new Map<string,number>();`);
  expectCpp(checker, typeOf("arr"), undefined, "array");
  expectCpp(checker, typeOf("m"), undefined, "map");
});

function expectCpp(
  checker: ts.TypeChecker,
  type: ts.Type,
  expected: string | undefined,
  categoryOverride?: import("../packages/cuttlefish/src/orchestrator/semantic-facts").CanonicalType,
): void {
  const category = categoryOverride ?? canonicalize(checker, type);
  const got = cppTypeFromCanonicalType(checker, type, category);
  assert.strictEqual(
    got,
    expected,
    `category=${category} expected cppType=${expected ?? "undefined"} got=${got ?? "undefined"}`,
  );
}

// ===========================================================================
// Summary
// ===========================================================================
console.log(`\n${passed} passed, ${failed.length} failed`);
if (failed.length > 0) {
  console.log("\nFailures:");
  for (const f of failed) console.log(`  \u2717 ${f}`);
  process.exit(1);
}
console.log("All three phases verified.");
