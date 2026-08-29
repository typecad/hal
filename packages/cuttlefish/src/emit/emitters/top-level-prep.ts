import type { ExpressionIR, StatementIR, VariableDeclarationIR, AssignmentIR } from "../../api/index.js";
import {
  applySymbolMap,
  statementRequiresRuntime,
  collectPointerVarTypes,
  collectExpressionIdentifiers,
  isRuntimeExpression,
} from "../utils/index.js";
import { appendSourceLine } from "./line-appender.js";
import type { EmitterContext } from "./emitter-context.js";
import { topLevelClasses } from "../../ir/build-ir-state.js";

function exprContainsTimingCall(expr: ExpressionIR, timingVarNames: Set<string>): boolean {
  if (!expr || typeof expr !== 'object' || !expr.kind) return false;
  switch (expr.kind) {
    case "method-call":
      return /\bmillis\b/.test(expr.callee) || /\bmicros\b/.test(expr.callee);
    case "raw":
      return /\bmillis\s*\(/.test(expr.value) || /\bmicros\s*\(/.test(expr.value);
    case "identifier":
      return timingVarNames.has(expr.value);
    case "binary":
      return exprContainsTimingCall(expr.left, timingVarNames) || exprContainsTimingCall(expr.right, timingVarNames);
    case "unary":
      return exprContainsTimingCall(expr.operand, timingVarNames);
    case "paren":
      return exprContainsTimingCall(expr.inner, timingVarNames);
    case "ternary":
      return exprContainsTimingCall(expr.condition, timingVarNames) || exprContainsTimingCall(expr.whenTrue, timingVarNames) || exprContainsTimingCall(expr.whenFalse, timingVarNames);
    case "property-access":
      return exprContainsTimingCall(expr.object, timingVarNames);
    case "element-access":
      return exprContainsTimingCall(expr.object, timingVarNames) || exprContainsTimingCall(expr.index, timingVarNames);
    default:
      return false;
  }
}

function scanForTimingAssignments(stmts: StatementIR[], timingVarNames: Set<string>): void {
  for (const stmt of stmts) {
    if (stmt.kind === "var_decl" && stmt.initializer && exprContainsTimingCall(stmt.initializer, timingVarNames)) {
      timingVarNames.add(stmt.name);
    }
    if (stmt.kind === "assign" && exprContainsTimingCall(stmt.value, timingVarNames)) {
      timingVarNames.add(stmt.target);
    }
    if ("body" in stmt && Array.isArray(stmt.body)) scanForTimingAssignments(stmt.body, timingVarNames);
    if ("thenBranch" in stmt && Array.isArray(stmt.thenBranch)) scanForTimingAssignments(stmt.thenBranch, timingVarNames);
    if ("elseBranch" in stmt && Array.isArray(stmt.elseBranch)) scanForTimingAssignments(stmt.elseBranch, timingVarNames);
    if ("cases" in stmt && Array.isArray(stmt.cases)) {
      for (const c of stmt.cases) scanForTimingAssignments(c.body, timingVarNames);
    }
    if ("tryBlock" in stmt && Array.isArray(stmt.tryBlock)) scanForTimingAssignments(stmt.tryBlock, timingVarNames);
    if ("catchBlock" in stmt && Array.isArray(stmt.catchBlock)) scanForTimingAssignments(stmt.catchBlock, timingVarNames);
    if ("finallyBlock" in stmt && Array.isArray(stmt.finallyBlock)) scanForTimingAssignments(stmt.finallyBlock, timingVarNames);
  }
}

function promoteVarDecls(stmts: StatementIR[], timingVarNames: Set<string>): void {
  for (const stmt of stmts) {
    if (stmt.kind === "var_decl" && timingVarNames.has(stmt.name)) {
      const t = stmt.cppType;
      if (t === "auto" || t === "int" || t === "long" || t === "unsigned int" || t === "short" || t === "unsigned short") {
        (stmt as VariableDeclarationIR).cppType = "unsigned long";
      }
    }
    if ("body" in stmt && Array.isArray(stmt.body)) promoteVarDecls(stmt.body, timingVarNames);
    if ("thenBranch" in stmt && Array.isArray(stmt.thenBranch)) promoteVarDecls(stmt.thenBranch, timingVarNames);
    if ("elseBranch" in stmt && Array.isArray(stmt.elseBranch)) promoteVarDecls(stmt.elseBranch, timingVarNames);
    if ("cases" in stmt && Array.isArray(stmt.cases)) {
      for (const c of stmt.cases) promoteVarDecls(c.body, timingVarNames);
    }
    if ("tryBlock" in stmt && Array.isArray(stmt.tryBlock)) promoteVarDecls(stmt.tryBlock, timingVarNames);
    if ("catchBlock" in stmt && Array.isArray(stmt.catchBlock)) promoteVarDecls(stmt.catchBlock, timingVarNames);
    if ("finallyBlock" in stmt && Array.isArray(stmt.finallyBlock)) promoteVarDecls(stmt.finallyBlock, timingVarNames);
  }
}

function rewriteAsIdentifier(expr: ExpressionIR & Record<string, unknown>, callbackName: string): void {
  expr.kind = "identifier";
  expr.value = callbackName;
}

function collectCallbackFromExpression(
  expr: ExpressionIR,
  callbackFunctions: { name: string; params: string[]; statements: StatementIR[]; debounceMs?: number; isInterruptHandler?: boolean; returnType?: string; typedParams?: { name: string; cppType: string }[] }[],
  isrPrefix: string,
  counter: { value: number },
): void {
  if (expr.kind === "callback") {
    const callbackName = `${isrPrefix}_isr_${counter.value++}`;
    callbackFunctions.push({
      name: callbackName,
      params: expr.params,
      statements: expr.statements,
      debounceMs: expr.debounceMs,
      isInterruptHandler: (expr as any).isInterruptHandler,
    });
    rewriteAsIdentifier(expr, callbackName);
    return;
  }
  // Extract lambda expressions as ISR/callback functions. This is needed for
  // lambdas passed to HAL methods (onFalling(() => {...})) and other callback
  // registrations. The ONLY case we must NOT extract is a lambda assigned to a
  // variable as a value (e.g. `const square = (x) => x*x`), because extracting
  // it strips the parameter and breaks the call site. That case is guarded by
  // the caller (collectCallbackFromStatement) which skips var_decl initializers.
  if (expr.kind === "lambda") {
    const callbackName = `${isrPrefix}_isr_${counter.value++}`;
    const lam = expr as any;
    // Preserve the lambda's return type and typed params so a
    // `(x): int16_t => {...}` callback lowers to `int16_t name(int16_t)`
    // rather than the default `void name()`. The historical ISR/HAL path
    // leaves these unset (defaults to void()).
    // Keep `auto` params (so the ISR isn't arity-stripped) and an `auto`
    // return type (C++14 return-type deduction) — both let the __tc_*
    // template helpers deduce types via decltype instead of failing on a
    // void(auto) callable. Only drop a param when it has no cppType at all.
    const lamParams: { name: string; cppType: string }[] = (lam.params ?? [])
      .filter((p: { name: string; cppType: string }) => p && p.name && p.cppType && p.cppType !== "void");
    const returnType =
      lam.returnType && lam.returnType !== "void"
        ? lam.returnType
        : undefined;
    callbackFunctions.push({
      name: callbackName,
      params: lamParams.map((p: { name: string }) => p.name),
      statements: lam.statements ?? lam.body ?? [],
      debounceMs: lam.debounceMs,
      returnType,
      typedParams: lamParams,
    });
    rewriteAsIdentifier(expr, callbackName);
    return;
  }
  if (expr.kind === "method-call") {
    for (const arg of expr.args) {
      if (arg.kind === "callback") {
        const callbackName = `${isrPrefix}_isr_${counter.value++}`;
        callbackFunctions.push({
          name: callbackName,
          params: arg.params,
          statements: arg.statements,
          debounceMs: arg.debounceMs,
        });
        rewriteAsIdentifier(arg, callbackName);
      } else {
        collectCallbackFromExpression(arg, callbackFunctions, isrPrefix, counter);
      }
    }
  }
  if (expr.kind === "raw") return;
  if ("args" in expr && Array.isArray(expr.args)) {
    for (const arg of expr.args) { collectCallbackFromExpression(arg, callbackFunctions, isrPrefix, counter); }
  }
  if ("initializer" in expr && expr.initializer) { collectCallbackFromExpression(expr.initializer as ExpressionIR, callbackFunctions, isrPrefix, counter); }
  if ("value" in expr && expr.value && typeof expr.value === "object") { collectCallbackFromExpression(expr.value, callbackFunctions, isrPrefix, counter); }
  if ("left" in expr) { collectCallbackFromExpression(expr.left, callbackFunctions, isrPrefix, counter); }
  if ("right" in expr) { collectCallbackFromExpression(expr.right, callbackFunctions, isrPrefix, counter); }
  if ("condition" in expr && typeof expr.condition === "object") { collectCallbackFromExpression(expr.condition, callbackFunctions, isrPrefix, counter); }
  if ("whenTrue" in expr) { collectCallbackFromExpression(expr.whenTrue, callbackFunctions, isrPrefix, counter); }
  if ("whenFalse" in expr) { collectCallbackFromExpression(expr.whenFalse, callbackFunctions, isrPrefix, counter); }
  if ("inner" in expr) { collectCallbackFromExpression(expr.inner, callbackFunctions, isrPrefix, counter); }
  if ("object" in expr && typeof expr.object === "object" && expr.kind !== "instanceof") { collectCallbackFromExpression(expr.object, callbackFunctions, isrPrefix, counter); }
  if ("elements" in expr && Array.isArray(expr.elements)) {
    for (const e of expr.elements) { collectCallbackFromExpression(e, callbackFunctions, isrPrefix, counter); }
  }
}

function collectCallbacks(
  statements: StatementIR[],
  callbackFunctions: { name: string; params: string[]; statements: StatementIR[]; debounceMs?: number; isInterruptHandler?: boolean; returnType?: string; typedParams?: { name: string; cppType: string }[] }[],
  isrPrefix: string,
  counter: { value: number },
): void {
  for (const stmt of statements) {
    if (stmt.kind === "call") {
      // __EXPR_STMT__ statements carry an expression IR (args[0]) that the
      // statement renderer renders at EMIT time via the expression renderer
      // (which handles lambdas inline via renderLambda). Do NOT hoist lambdas
      // from these — they must stay inline to preserve closure captures.
      if (stmt.callee === "__EXPR_STMT__") continue;
      for (const arg of stmt.args) {
        collectCallbackFromExpression(arg, callbackFunctions, isrPrefix, counter);
      }
    }
    if (stmt.kind === "var_decl" && stmt.initializer) {
      // A lambda directly assigned to a variable (e.g. `const square = (x) => x*x`)
      // is a VALUE, not a callback — extracting it strips its parameters and
      // breaks the call site. Skip direct-lambda initializers, but still
      // recurse to find callbacks nested inside (e.g. `const f = foo(() => {})`).
      if (stmt.initializer.kind !== "lambda") {
        collectCallbackFromExpression(stmt.initializer, callbackFunctions, isrPrefix, counter);
      }
    }
    if ("body" in stmt && Array.isArray(stmt.body)) {
      collectCallbacks(stmt.body, callbackFunctions, isrPrefix, counter);
    }
    if ("thenBranch" in stmt && Array.isArray(stmt.thenBranch)) {
      collectCallbacks(stmt.thenBranch, callbackFunctions, isrPrefix, counter);
    }
    if ("elseBranch" in stmt && Array.isArray(stmt.elseBranch)) {
      collectCallbacks(stmt.elseBranch, callbackFunctions, isrPrefix, counter);
    }
    if ("cases" in stmt && Array.isArray(stmt.cases)) {
      for (const c of stmt.cases) {
        collectCallbacks(c.body, callbackFunctions, isrPrefix, counter);
      }
    }
    if ("value" in stmt && stmt.value) {
      collectCallbackFromExpression(stmt.value, callbackFunctions, isrPrefix, counter);
    }
  }
}

function replacePlaceholderInStmt(stmt: any, placeholder: string, replacement: string): void {
  if (stmt.kind === "call" && stmt.callee === "__EMIT__" && stmt.args) {
    for (const arg of stmt.args) {
      if (arg.kind === "string" && typeof arg.value === "string" && arg.value.includes(placeholder)) {
        arg.value = arg.value.replace(placeholder, replacement);
      }
    }
  }
  if (stmt.kind === "hal-op" && stmt.operation) {
    if (stmt.operation.operation === "raw" && typeof stmt.operation.code === "string") {
      stmt.operation.code = stmt.operation.code.replaceAll(placeholder, replacement);
    } else {
      for (const [key, val] of Object.entries(stmt.operation)) {
        if (typeof val === "string" && val.includes(placeholder)) {
          stmt.operation[key] = val.replaceAll(placeholder, replacement);
        }
      }
    }
  }
  for (const key of ["body", "thenBranch", "elseBranch"]) {
    if (Array.isArray(stmt[key])) {
      for (const s of stmt[key]) replacePlaceholderInStmt(s, placeholder, replacement);
    }
  }
  if (stmt.cases && Array.isArray(stmt.cases)) {
    for (const c of stmt.cases) {
      if (c.body) for (const s of c.body) replacePlaceholderInStmt(s, placeholder, replacement);
    }
  }
  if (stmt.statements && Array.isArray(stmt.statements)) {
    for (const s of stmt.statements) replacePlaceholderInStmt(s, placeholder, replacement);
  }
}

function replacePlaceholderInAllStatements(statements: StatementIR[], placeholder: string, replacement: string): void {
  for (const stmt of statements) {
    replacePlaceholderInStmt(stmt, placeholder, replacement);
  }
}

function removeShadowingVarDecls(
  statements: StatementIR[],
  globalVarNames: Set<string>,
  isrIdentifiers: Set<string>
): StatementIR[] {
  const result: StatementIR[] = [];
  for (const stmt of statements) {
    if (stmt.kind === "var_decl" && globalVarNames.has(stmt.name) && isrIdentifiers.has(stmt.name)) {
      continue;
    }
    result.push(stmt);
    // Recursively process nested statements
    if ("body" in stmt && Array.isArray(stmt.body)) {
      (stmt as any).body = removeShadowingVarDecls(stmt.body, globalVarNames, isrIdentifiers);
    }
    if ("thenBranch" in stmt && Array.isArray(stmt.thenBranch)) {
      (stmt as any).thenBranch = removeShadowingVarDecls(stmt.thenBranch, globalVarNames, isrIdentifiers);
    }
    if ("elseBranch" in stmt && Array.isArray(stmt.elseBranch)) {
      (stmt as any).elseBranch = removeShadowingVarDecls(stmt.elseBranch, globalVarNames, isrIdentifiers);
    }
    if ("cases" in stmt && Array.isArray(stmt.cases)) {
      for (const c of stmt.cases) {
        if (c.body) {
          c.body = removeShadowingVarDecls(c.body, globalVarNames, isrIdentifiers);
        }
      }
    }
    if ("tryBlock" in stmt && Array.isArray(stmt.tryBlock)) {
      (stmt as any).tryBlock = removeShadowingVarDecls(stmt.tryBlock, globalVarNames, isrIdentifiers);
    }
    if ("catchBlock" in stmt && Array.isArray(stmt.catchBlock)) {
      (stmt as any).catchBlock = removeShadowingVarDecls(stmt.catchBlock, globalVarNames, isrIdentifiers);
    }
    if ("finallyBlock" in stmt && Array.isArray(stmt.finallyBlock)) {
      (stmt as any).finallyBlock = removeShadowingVarDecls(stmt.finallyBlock, globalVarNames, isrIdentifiers);
    }
  }
  return result;
}

function collectIdentifierNames(statements: StatementIR[]): Set<string> {
  const names = new Set<string>();
  function scanStmt(stmt: StatementIR) {
    if (stmt.kind === "var_decl") { names.add(stmt.name); }
    if (stmt.kind === "assign") { names.add(stmt.target); }
    if ("body" in stmt && Array.isArray(stmt.body)) { for (const s of stmt.body) scanStmt(s); }
    if ("thenBranch" in stmt && Array.isArray(stmt.thenBranch)) { for (const s of stmt.thenBranch) scanStmt(s); }
    if ("elseBranch" in stmt && Array.isArray(stmt.elseBranch)) { for (const s of stmt.elseBranch) scanStmt(s); }
    if ("cases" in stmt && Array.isArray(stmt.cases)) { for (const c of stmt.cases) for (const s of c.body) scanStmt(s); }
    if ("value" in stmt && stmt.value && typeof stmt.value === "object") { scanExpr(stmt.value); }
    if ("callee" in stmt && typeof stmt.callee === "string") {
      const parts = stmt.callee.split(/[\.\-\>]/);
      for (const p of parts) { if (/^[a-zA-Z_]\w*$/.test(p)) names.add(p); }
    }
    if ("args" in stmt && Array.isArray(stmt.args)) { for (const a of stmt.args) scanExpr(a); }
  }
  function scanExpr(expr: ExpressionIR) {
    if (expr.kind === "identifier") { names.add(expr.value); }
    if ("left" in expr) { scanExpr(expr.left); }
    if ("right" in expr) { scanExpr(expr.right); }
    if ("value" in expr && expr.value && typeof expr.value === "object") { scanExpr(expr.value); }
    if ("elements" in expr && Array.isArray(expr.elements)) { for (const e of expr.elements) scanExpr(e); }
    if ("args" in expr && Array.isArray(expr.args)) { for (const a of expr.args) scanExpr(a); }
    if ("initializer" in expr && expr.initializer) { scanExpr(expr.initializer as ExpressionIR); }
    if ("condition" in expr && typeof expr.condition === "object") { scanExpr(expr.condition); }
    if ("whenTrue" in expr) { scanExpr(expr.whenTrue); }
    if ("whenFalse" in expr) { scanExpr(expr.whenFalse); }
    if ("inner" in expr) { scanExpr(expr.inner); }
    if ("object" in expr && typeof expr.object === "object" && expr.kind !== "instanceof") { scanExpr(expr.object); }
  }
  for (const stmt of statements) { scanStmt(stmt); }
  return names;
}

export function runTopLevelPreprocessing(ctx: EmitterContext): void {
  const { program, strategy, symbolMap, isEntryFile, mappedFunctions } = ctx;

  // Compile-time vs runtime separation
  let compiletimeVarNames = new Set<string>(
    program.topLevelStatements
      .filter((stmt) => stmt.kind === "var_decl" && !statementRequiresRuntime(stmt))
      .map((stmt) => (stmt as { name: string }).name)
  );
  ctx.compiletimeVarNames = compiletimeVarNames;

  const topLevelDeclarations = program.topLevelStatements.filter(
    (item) => !statementRequiresRuntime(item)
  );
  const topLevelExecutables = program.topLevelStatements.filter(
    (item) => statementRequiresRuntime(item)
  );

  // Reclassification pass: compile-time var_decls whose initializer references
  // runtime variable names must be demoted to runtime so they stay inside main().
  // This handles cases like `const arr = [runtimeVar1, runtimeVar2]` where the
  // array literal itself looks compile-time (identifiers are not "runtime expressions")
  // but it references variables that will only exist inside main().
  //
  // Additionally, a compile-time `const`/`let` that reads a top-level variable
  // which is MUTATED at runtime (any `assign` target) must also be demoted.
  // Otherwise the hoisted global captures the variable's startup value and never
  // sees runtime mutations — e.g. `const reached = descended` freezes `reached`
  // at `descended`'s initial value because both are emitted as file-scope globals
  // initialized before main(), while the `descended = depth` assignments run
  // inside main().
  {
    // Collect every variable name that is the target of an assignment anywhere
    // in the program (top-level statements + function/method bodies). Such
    // names carry runtime-dependent values even if their declaration looked
    // compile-time (e.g. `let descended = 0`).
    const mutatedNames = new Set<string>();
    const scanStmtForAssigns = (stmt: any): void => {
      if (!stmt || typeof stmt !== 'object' || !stmt.kind) return;
      if (stmt.kind === "assign" && typeof stmt.target === "string") {
        mutatedNames.add(stmt.target);
      }
      for (const key of Object.keys(stmt)) {
        if (key === "kind" || key === "loc" || key === "range" || key === "sourceSpan") continue;
        const val = stmt[key];
        if (Array.isArray(val)) {
          for (const item of val) {
            if (item && typeof item === 'object') scanStmtForAssigns(item);
          }
        } else if (val && typeof val === 'object') {
          scanStmtForAssigns(val);
        }
      }
    };
    for (const stmt of program.topLevelStatements) scanStmtForAssigns(stmt);
    for (const fn of program.functions) {
      for (const stmt of fn.statements) scanStmtForAssigns(stmt);
    }
    for (const cls of program.classes) {
      for (const method of cls.methods) {
        for (const stmt of method.statements) scanStmtForAssigns(stmt);
      }
      if (cls.constructor) {
        for (const stmt of cls.constructor.statements) scanStmtForAssigns(stmt);
      }
    }

    const runtimeVarNames = new Set<string>();
    for (const stmt of topLevelExecutables) {
      if (stmt.kind === "var_decl") {
        runtimeVarNames.add(stmt.name);
      }
    }
    const demoted = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const stmt of topLevelDeclarations) {
        if (stmt.kind !== "var_decl" || !stmt.initializer) continue;
        if (demoted.has(stmt.name)) continue;
        const referenced = collectExpressionIdentifiers(stmt.initializer);
        for (const ref of referenced) {
          // Demote if the reference is to a runtime-classified var OR to any
          // mutated name (its value depends on runtime assignments).
          if (runtimeVarNames.has(ref) || mutatedNames.has(ref)) {
            demoted.add(stmt.name);
            runtimeVarNames.add(stmt.name);
            changed = true;
            break;
          }
        }
      }
    }
    if (demoted.size > 0) {
      compiletimeVarNames = new Set(
        [...compiletimeVarNames].filter((n) => !demoted.has(n))
      );
      for (let i = topLevelDeclarations.length - 1; i >= 0; i--) {
        const stmt = topLevelDeclarations[i];
        if (stmt.kind === "var_decl" && demoted.has(stmt.name)) {
          topLevelDeclarations.splice(i, 1);
          topLevelExecutables.push(stmt);
        }
      }
      topLevelExecutables.sort((a, b) => {
        const aIdx = program.topLevelStatements.indexOf(a);
        const bIdx = program.topLevelStatements.indexOf(b);
        return aIdx - bIdx;
      });
      ctx.compiletimeVarNames = compiletimeVarNames;
    }
  }

  const filteredTopLevelDeclarations = ctx.reservedNames.size > 0
    ? topLevelDeclarations.filter((item) => {
      if (item.kind === "var_decl") {
        return !ctx.reservedNames.has(item.name);
      }
      return true;
    })
    : topLevelDeclarations;
  const filteredTopLevelExecutables_presuppress = ctx.reservedNames.size > 0
    ? topLevelExecutables.filter((item) => {
      if (item.kind === "var_decl") {
        return !ctx.reservedNames.has(item.name);
      }
      return true;
    })
    : topLevelExecutables;

  const entrypointFunctionName = strategy.entrypointFunctionName();
  const entrypointCallNames = new Set<string>([entrypointFunctionName]);
  for (const fn of program.functions) {
    const mappedName = ctx.statementRenderer.mapFunctionName(fn.originalName);
    if (mappedName === entrypointFunctionName) {
      entrypointCallNames.add(fn.originalName);
      entrypointCallNames.add(applySymbolMap(fn.originalName, symbolMap));
    }
  }

  const filteredTopLevelExecutables = filteredTopLevelExecutables_presuppress.filter((statement) => {
    if (statement.kind !== "call") {
      return true;
    }
    const mappedCallee = applySymbolMap(statement.callee, symbolMap);
    if (!entrypointCallNames.has(statement.callee) && !entrypointCallNames.has(mappedCallee)) {
      return !ctx.asyncFunctionOriginalNames.has(statement.callee) && !ctx.asyncFunctionMappedNames.has(statement.callee);
    }
    return false;
  });
  ctx.filteredTopLevelExecutables = filteredTopLevelExecutables;

  const emittedTopLevelStatements = isEntryFile
    ? filteredTopLevelDeclarations
    : [
      ...filteredTopLevelDeclarations,
      ...filteredTopLevelExecutables.filter((statement) => statement.kind === "var_decl"),
    ];
  ctx.filteredTopLevelDeclarations = filteredTopLevelDeclarations;
  ctx.emittedTopLevelStatements = emittedTopLevelStatements;

  // Collect pointer variable types
  const allExecutableStatements: StatementIR[] = [...filteredTopLevelExecutables];
  for (const fn of mappedFunctions) {
    allExecutableStatements.push(...fn.statements);
  }
  const globalPointerVarTypes = collectPointerVarTypes(allExecutableStatements, ctx.classNameMap);
  // Populate the existing ctx.globalPointerVarTypes map in place (rather than
  // reassigning) so the ExpressionRenderer — constructed earlier in setup with
  // the same Map reference — observes the resolved pointer types when it later
  // decides `->` vs `.` for bare identifiers (e.g. ISR-captured globals).
  ctx.globalPointerVarTypes.clear();
  for (const [k, v] of globalPointerVarTypes) ctx.globalPointerVarTypes.set(k, v);

  // Promote timing variables to unsigned long
  {
    const timingVarNames = new Set<string>();
    const allStatementsForTiming: StatementIR[] = [...emittedTopLevelStatements];
    for (const fn of mappedFunctions) {
      allStatementsForTiming.push(...fn.statements);
    }
    for (let pass = 0; pass < 3; pass++) {
      const prevSize = timingVarNames.size;
      scanForTimingAssignments(allStatementsForTiming, timingVarNames);
      if (timingVarNames.size === prevSize) break;
    }
    promoteVarDecls(allStatementsForTiming, timingVarNames);
  }

  // Collect callback functions
  const callbackFunctions: { name: string; params: string[]; statements: StatementIR[]; debounceMs?: number; isInterruptHandler?: boolean; returnType?: string; typedParams?: { name: string; cppType: string }[] }[] = [];
  const counter = { value: 0 };

  collectCallbacks(filteredTopLevelExecutables, callbackFunctions, ctx.isrPrefix, counter);
  for (const fn of mappedFunctions) {
    collectCallbacks(fn.statements, callbackFunctions, ctx.isrPrefix, counter);
  }
  for (const cls of program.classes) {
    if (cls.constructor) {
      collectCallbacks(cls.constructor.statements, callbackFunctions, ctx.isrPrefix, counter);
    }
    for (const method of cls.methods) {
      collectCallbacks(method.statements, callbackFunctions, ctx.isrPrefix, counter);
    }
    for (const getter of cls.getters) {
      collectCallbacks(getter.statements, callbackFunctions, ctx.isrPrefix, counter);
    }
    for (const setter of cls.setters) {
      collectCallbacks(setter.statements, callbackFunctions, ctx.isrPrefix, counter);
    }
  }

  // Process registered callbacks from HAL resolver
  for (const rc of (program.registeredCallbacks ?? [])) {
    const callbackName = `${ctx.isrPrefix}_isr_${counter.value++}`;
    const callbackIR = rc.callbackIR as ExpressionIR & { kind: "callback"; body?: StatementIR[]; returnType?: string; typedParams?: { name: string; cppType: string }[] };
    callbackFunctions.push({
      name: callbackName,
      params: callbackIR.params,
      statements: callbackIR.statements ?? callbackIR.body ?? [],
      debounceMs: callbackIR.debounceMs,
      isInterruptHandler: (callbackIR as any).isInterruptHandler,
      ...(callbackIR.returnType ? { returnType: callbackIR.returnType } : {}),
      ...(callbackIR.typedParams ? { typedParams: callbackIR.typedParams } : {}),
    });
    replacePlaceholderInAllStatements(filteredTopLevelExecutables, rc.placeholderName, callbackName);
    for (const fn of mappedFunctions) {
      replacePlaceholderInAllStatements(fn.statements, rc.placeholderName, callbackName);
    }
  }
  ctx.callbackFunctions = callbackFunctions;

  // Promote function-referenced runtime var_decls to file scope.
  // Runtime top-level vars are emitted inside setup()/main(), which free
  // functions cannot access. Promoting them to file-scope globals and
  // replacing the declaration with an assignment inside the entrypoint
  // makes them visible to all functions while preserving init order.
  const promotedVarDecls = new Map<string, { cppType: string; index: number }>();
  const globalVarNames = new Set<string>();
  for (const stmt of filteredTopLevelDeclarations) {
    if (stmt.kind === "var_decl") {
      globalVarNames.add(stmt.name);
    }
  }
  // Collect identifiers referenced by ALL functions (ISR callbacks + free functions)
  const allFuncIdentifiers = new Set<string>();
  for (const cb of callbackFunctions) {
    for (const id of collectIdentifierNames(cb.statements)) {
      allFuncIdentifiers.add(id);
    }
  }
  for (const fn of mappedFunctions) {
    for (const id of collectIdentifierNames(fn.statements)) {
      allFuncIdentifiers.add(id);
    }
  }
  if (allFuncIdentifiers.size > 0 && filteredTopLevelExecutables.length > 0) {
    for (let i = 0; i < filteredTopLevelExecutables.length; i++) {
      const stmt = filteredTopLevelExecutables[i];
      if (stmt.kind === "var_decl" && allFuncIdentifiers.has(stmt.name)) {
        if (globalVarNames.has(stmt.name)) {
          continue;
        }
        const varType = strategy.normalizeCppType(stmt.cppType);
        promotedVarDecls.set(stmt.name, { cppType: varType, index: i });
        filteredTopLevelExecutables[i] = {
          kind: "assign",
          sourceSpan: stmt.sourceSpan,
          leadingComments: stmt.leadingComments,
          trailingComments: stmt.trailingComments,
          target: stmt.name,
          operator: "=",
          value: stmt.initializer,
        } as AssignmentIR;
      }
    }
  }
  ctx.promotedVarDecls = promotedVarDecls;

  // Remove local var_decls that shadow global variables and are referenced by ISRs
  // Re-collect names of global variables (now including promoted ones)
  const globalVarNames2 = new Set<string>();
  for (const stmt of filteredTopLevelDeclarations) {
    if (stmt.kind === "var_decl") {
      globalVarNames2.add(stmt.name);
    }
  }
  for (const varName of promotedVarDecls.keys()) {
    globalVarNames2.add(varName);
  }
  // Remove local var_decls that shadow globals and are ISR-referenced
  if (callbackFunctions.length > 0) {
    const isrIdentifiers = new Set<string>();
    for (const cb of callbackFunctions) {
      for (const id of collectIdentifierNames(cb.statements)) {
        isrIdentifiers.add(id);
      }
    }
    for (const fn of mappedFunctions) {
      fn.statements = removeShadowingVarDecls(fn.statements, globalVarNames2, isrIdentifiers);
    }
  }

  // fixPointerFieldAccess was a post-hoc string rewriter that converted
  // already-rendered `.` member access to `->` when the receiver resolved to a
  // pointer. It has been REMOVED. The pointer/value decision is now made once,
  // structurally, where the resolved C++ type of the receiver is known:
  //
  //   - For `property-access` / `method-call` IR nodes, `expressionToIR` sets
  //     `isPointer` via `resolveExprCppType` + `parsedIsPointer`, and the IR
  //     also falls back to the module-scope `globalPointerVarTypes` registry
  //     (threaded into ExpressionRenderer / StatementRenderer) for receivers
  //     whose type wasn't visible at IR build time — notably ISR-captured
  //     globals (`const btn = new Button()` accessed inside a hoisted callback).
  //   - For assign/update targets and free `call` statements, the renderer
  //     arrows the leading receiver when it is a known global pointer.
  //
  // Why the rewriter had to go: it operated on rendered C++ text and keyed off
  // *names*, not symbols. A name collision between a class value-field and a
  // same-named pointer local (demo #23 Finding B: `this.heap` value field vs.
  // a `heap` pointer local) let the `\b`/`(^|[^>.])` regex rewrite
  // `this->heap.x` → `this->heap->x` (wrong: heap is a value), producing
  // `base operand of '->' has non-pointer type 'std::vector<Job>'`. The demo
  // history (#15–#23) is a series of these name-vs-symbol mismatches; each fix
  // tightened one regex and exposed the next. Removing the rewriter (and its
  // three duplicate copies) eliminates the whole class of bug.
  //
  // The field on EmitterContext remains as a permanent identity no-op because
  // several render call sites still thread it as `calleeTransformer`; it no
  // longer inspects or mutates its argument.
  ctx.fixPointerFieldAccess = function fixPointerFieldAccess(callee: string): string {
    return callee;
  };
}
