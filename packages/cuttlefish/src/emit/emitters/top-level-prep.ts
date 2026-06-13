import type { ExpressionIR, StatementIR, VariableDeclarationIR, AssignmentIR } from "../../api";
import {
  applySymbolMap,
  statementRequiresRuntime,
  collectPointerVarTypes,
  collectExpressionIdentifiers,
  inferObjectFieldType,
  isRuntimeExpression,
} from "../utils";
import { appendSourceLine } from "./line-appender";
import type { EmitterContext } from "./emitter-context";
import { topLevelClasses } from "../../ir/build-ir-state";

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
  callbackFunctions: { name: string; params: string[]; statements: StatementIR[]; debounceMs?: number }[],
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
    });
    rewriteAsIdentifier(expr, callbackName);
    return;
  }
  if (expr.kind === "lambda") {
    const callbackName = `${isrPrefix}_isr_${counter.value++}`;
    callbackFunctions.push({
      name: callbackName,
      params: (expr as any).params ?? [],
      statements: (expr as any).statements ?? (expr as any).body ?? [],
      debounceMs: (expr as any).debounceMs,
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
  callbackFunctions: { name: string; params: string[]; statements: StatementIR[]; debounceMs?: number }[],
  isrPrefix: string,
  counter: { value: number },
): void {
  for (const stmt of statements) {
    if (stmt.kind === "call") {
      for (const arg of stmt.args) {
        collectCallbackFromExpression(arg, callbackFunctions, isrPrefix, counter);
      }
    }
    if (stmt.kind === "var_decl" && stmt.initializer) {
      collectCallbackFromExpression(stmt.initializer, callbackFunctions, isrPrefix, counter);
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
  if (stmt.kind === "hal-op" && stmt.operation && stmt.operation.operation === "raw" && typeof stmt.operation.code === "string") {
    stmt.operation.code = stmt.operation.code.replace(placeholder, replacement);
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
  {
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
          if (runtimeVarNames.has(ref)) {
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
  ctx.globalPointerVarTypes = globalPointerVarTypes;

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
  const callbackFunctions: { name: string; params: string[]; statements: StatementIR[]; debounceMs?: number }[] = [];
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
    callbackFunctions.push({
      name: callbackName,
      params: rc.callbackIR.params,
      statements: rc.callbackIR.statements,
      debounceMs: rc.callbackIR.debounceMs,
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

  // Collect pointer struct fields and build fixPointerFieldAccess
  const pointerStructFields = new Set<string>();
  for (const stmt of allExecutableStatements) {
    if (stmt.kind === "var_decl" && stmt.initializer?.kind === "object") {
      const structName = stmt.name;
      for (const field of stmt.initializer.fields) {
        const fieldType = inferObjectFieldType(field.value, globalPointerVarTypes, ctx.knownFunctionReturnTypes, undefined, undefined, ctx.largeEnumNames, structName, field.name, strategy.defaultNumericType(), (o, n) => strategy.resolvePinType?.(o, n));
        if (fieldType.endsWith("*")) {
          pointerStructFields.add(`${structName}.${field.name}`);
        }
      }
    }
  }

  ctx.fixPointerFieldAccess = function fixPointerFieldAccess(callee: string): string {
    for (const [varName, varType] of globalPointerVarTypes) {
      if (varType.endsWith("*")) {
        const pattern = new RegExp(`\\b${varName}\\.`, "g");
        callee = callee.replace(pattern, `${varName}->`);
      }
    }
    for (const pointerField of pointerStructFields) {
      const pattern = new RegExp(`(^|[^>])${pointerField.replace(".", "\\.")}\\.`, "g");
      callee = callee.replace(pattern, `$1${pointerField}->`);
    }
    if (ctx.currentClassPointerFields) {
      for (const fieldName of ctx.currentClassPointerFields) {
        callee = callee.replace(
          new RegExp(`this->${fieldName}\\.`, "g"),
          `this->${fieldName}->`
        );
      }
    }
    if (ctx.currentClassPointerFieldTypes) {
      for (const [fieldName, fieldType] of ctx.currentClassPointerFieldTypes) {
        const className = fieldType.replace(/\*$/, "");
        const classDef = topLevelClasses.get(className);
        if (classDef) {
          for (const subField of classDef.fields) {
            if ((subField.cppType as string).endsWith("*")) {
              callee = callee.replace(
                new RegExp(`->${fieldName}->${subField.name}\\.`, "g"),
                `->${fieldName}->${subField.name}->`
              );
            }
          }
        }
      }
    }
    return callee;
  };
}
