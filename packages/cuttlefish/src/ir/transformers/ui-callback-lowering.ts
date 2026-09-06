// ---------------------------------------------------------------------------
// Shared lowering for UI callback bodies (onToggle, watchPin, onClick, …).
//
// Author callbacks lower through lowerStatementList (same IR the rest of the
// program uses) and are rendered at emit time by StatementRenderer /
// appendRenderedStatement. The old string-baking second pipeline is gone.
//
// UI-specific behaviour that still happens here:
//   - signal.set(value) → assign          (already in callToStatement)
//   - signal() → identifier               (already in expressionToIR)
//   - CSS color string literals → rgb int (resolveColorIR walk on the IR)
//   - canvas ctx.* → ui_display_*         (ambient canvas ctx + rewriteCanvasCall)
// ---------------------------------------------------------------------------

import ts from "typescript";
import { Diagnostic } from "../../types.js";
import { expressionToIR } from "../expression-to-ir.js";
import { renderExprAsText } from "../render-expr.js";
import { requireUIHook } from "../../ui-hook.js";
import { getDisplayProfile } from "../../stores/display-profile-store.js";
import { getContext, type PointerTracker } from "../build-ir-state.js";
import { makeSourceSpan } from "../ast-node-utils.js";
import { lowerStatementList } from "../statement-to-ir.js";
import {
  callbackContextLabel,
  unsupportedStatementHint,
  type CallbackContextId,
} from "./callback-context-registry.js";
import { isSignalName } from "./ui-call-resolver.js";
import { rewriteCanvasCall } from "./canvas-lowering.js";
import type { ExpressionIR, StatementIR } from "../../api/shared/ir-core.js";
import { resolveStrategy } from "../../platform/registry.js";
import { StatementRenderer } from "../../emit/statement-renderer.js";
import { createEmissionScopeState } from "../../emit/snprintf-helpers.js";
import { getCurrentIrTypeScope } from "../symbol-types.js";
import { type CppTypeHint } from "../type-resolution.js";

// ── Color-literal resolution ───────────────────────────────────────────────

const COLOR_LITERAL_RE =
  /"(#[0-9a-fA-F]{8}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|(rgb|rgba|hsl|hsla)\([^)]*\)|[A-Za-z]+)"/g;

/** Rewrite CSS color string literals in a rendered C++ expression. Prefer
 *  resolveColorIR on IR for new code. */
export function resolveColorLiterals(raw: string): string {
  const fmt = getDisplayProfile().colorFormat;
  const resolveColorInternal = requireUIHook().resolveColorInternal;
  return raw.replace(COLOR_LITERAL_RE, (match: string, color: string) => {
    try {
      return `0x${resolveColorInternal(color, fmt).toString(16)}`;
    } catch {
      return match;
    }
  });
}

/** Walk an ExpressionIR tree and rewrite CSS color string-literal nodes into
 *  raw hex nodes the ExpressionRenderer emits as a bare int. */
export function resolveColorIR(expr: ExpressionIR): ExpressionIR {
  const fmt = getDisplayProfile().colorFormat;
  const resolveColorInternal = requireUIHook().resolveColorInternal;
  const walk = (e: ExpressionIR): ExpressionIR => {
    if (e.kind === "string") {
      try {
        const hex = resolveColorInternal(e.value, fmt);
        return { kind: "raw", value: `0x${hex.toString(16)}` };
      } catch {
        return e;
      }
    }
    if (e.kind === "ternary") {
      return {
        ...e,
        condition: walk(e.condition),
        whenTrue: walk(e.whenTrue),
        whenFalse: walk(e.whenFalse),
      };
    }
    if (e.kind === "binary") return { ...e, left: walk(e.left), right: walk(e.right) };
    if (e.kind === "unary") return { ...e, operand: walk(e.operand) };
    if (e.kind === "string_concat") return { ...e, parts: e.parts.map(walk) };
    if (e.kind === "template_string") return { ...e, expression: walk(e.expression) };
    if (e.kind === "method-call") return { ...e, args: e.args.map(walk) };
    if (e.kind === "property-access") return { ...e, object: walk(e.object) };
    if (e.kind === "element-access") {
      return { ...e, object: walk(e.object), index: walk(e.index) };
    }
    if (e.kind === "array") return { ...e, elements: e.elements.map(walk) };
    if (e.kind === "object") {
      return { ...e, fields: e.fields.map((f) => ({ ...f, value: walk(f.value) })) };
    }
    if (e.kind === "await") return { ...e, value: walk(e.value) };
    if (e.kind === "paren") return { ...e, inner: walk(e.inner) };
    return e;
  };
  return walk(expr);
}

/** Apply resolveColorIR across every expression nested in a StatementIR tree.
 *  When a var_decl's initializer fully resolves to color hex, retarget its
 *  cppType to the display color int. */
export function resolveColorsInStatements(statements: StatementIR[]): StatementIR[] {
  const walkExpr = (e?: ExpressionIR): ExpressionIR | undefined => (e ? resolveColorIR(e) : undefined);
  const isColorHexExpr = (e: ExpressionIR): boolean => {
    if (e.kind === "raw" && /^0x[0-9a-fA-F]+$/.test(e.value.trim())) return true;
    if (e.kind === "ternary") return isColorHexExpr(e.whenTrue) && isColorHexExpr(e.whenFalse);
    if (e.kind === "paren") return isColorHexExpr(e.inner);
    return false;
  };
  const colorCppType = (): string => {
    const fmt = getDisplayProfile().colorFormat;
    return fmt === "rgb888" || fmt === "rgb666" ? "uint32_t" : "uint16_t";
  };
  const walk = (s: StatementIR): StatementIR => {
    switch (s.kind) {
      case "var_decl": {
        const initializer = walkExpr(s.initializer);
        if (initializer && isColorHexExpr(initializer)) {
          return { ...s, initializer, cppType: colorCppType() };
        }
        return { ...s, initializer };
      }
      case "assign":
        return { ...s, value: resolveColorIR(s.value) };
      case "call":
        return { ...s, args: s.args.map(resolveColorIR) };
      case "return":
        return { ...s, value: walkExpr(s.value) };
      case "if":
        return {
          ...s,
          condition: resolveColorIR(s.condition),
          thenBranch: s.thenBranch.map(walk),
          elseBranch: s.elseBranch?.map(walk),
        };
      case "while":
      case "do_while":
        return { ...s, condition: resolveColorIR(s.condition), body: s.body.map(walk) };
      case "for":
        return {
          ...s,
          initializer: s.initializer ? walk(s.initializer) : undefined,
          condition: walkExpr(s.condition),
          increment: s.increment ? walk(s.increment) : undefined,
          body: s.body.map(walk),
        };
      case "block":
        return { ...s, body: s.body.map(walk) };
      default:
        return s;
    }
  };
  return statements.map(walk);
}

/** Recursively rename identifiers in a StatementIR tree (e.g. bindInput
 *  param → `text`, list tap param → `idx`). */
export function renameIdentifiersInStatements(
  statements: StatementIR[],
  from: string,
  to: string,
): StatementIR[] {
  if (from === to) return statements;
  const renameExpr = (e: ExpressionIR): ExpressionIR => {
    if (e.kind === "identifier" && e.value === from) return { ...e, value: to };
    if (e.kind === "ternary") {
      return {
        ...e,
        condition: renameExpr(e.condition),
        whenTrue: renameExpr(e.whenTrue),
        whenFalse: renameExpr(e.whenFalse),
      };
    }
    if (e.kind === "binary") return { ...e, left: renameExpr(e.left), right: renameExpr(e.right) };
    if (e.kind === "unary") return { ...e, operand: renameExpr(e.operand) };
    if (e.kind === "string_concat") return { ...e, parts: e.parts.map(renameExpr) };
    if (e.kind === "template_string") return { ...e, expression: renameExpr(e.expression) };
    if (e.kind === "method-call") return { ...e, args: e.args.map(renameExpr) };
    if (e.kind === "property-access") return { ...e, object: renameExpr(e.object) };
    if (e.kind === "element-access") {
      return { ...e, object: renameExpr(e.object), index: renameExpr(e.index) };
    }
    if (e.kind === "array") return { ...e, elements: e.elements.map(renameExpr) };
    if (e.kind === "object") {
      return { ...e, fields: e.fields.map((f) => ({ ...f, value: renameExpr(f.value) })) };
    }
    if (e.kind === "raw" && e.value === from) return { kind: "identifier", value: to };
    if (e.kind === "await") return { ...e, value: renameExpr(e.value) };
    if (e.kind === "paren") return { ...e, inner: renameExpr(e.inner) };
    return e;
  };
  const renameStmt = (s: StatementIR): StatementIR => {
    switch (s.kind) {
      case "var_decl":
        return {
          ...s,
          name: s.name === from ? to : s.name,
          initializer: s.initializer ? renameExpr(s.initializer) : undefined,
        };
      case "assign":
        return {
          ...s,
          target: s.target === from ? to : s.target,
          value: renameExpr(s.value),
        };
      case "call":
        return { ...s, args: s.args.map(renameExpr) };
      case "return":
        return { ...s, value: s.value ? renameExpr(s.value) : undefined };
      case "if":
        return {
          ...s,
          condition: renameExpr(s.condition),
          thenBranch: s.thenBranch.map(renameStmt),
          elseBranch: s.elseBranch?.map(renameStmt),
        };
      case "while":
      case "do_while":
        return {
          ...s,
          condition: renameExpr(s.condition),
          body: s.body.map(renameStmt),
        };
      case "for":
        return {
          ...s,
          initializer: s.initializer ? renameStmt(s.initializer) : undefined,
          condition: s.condition ? renameExpr(s.condition) : undefined,
          increment: s.increment ? renameStmt(s.increment) : undefined,
          body: s.body.map(renameStmt),
        };
      case "block":
        return { ...s, body: s.body.map(renameStmt) };
      default:
        return s;
    }
  };
  return statements.map(renameStmt);
}

// ── Console-in-callback tracking (legacy string-bake leftover) ─────────────

export function resetCallbackLoweringState(): void {
  endCanvasAmbient();
}

// ── Ambient canvas context ─────────────────────────────────────────────────
// While lowerCallbackStatements is lowering a drawCanvas body, callToStatement
// and expressionToIR consult these to rewrite ctx.* calls / ctx.width|height.

let _canvasAmbientCtx: string | null = null;
let _canvasAmbientDiagnostics: Diagnostic[] | null = null;
let _canvasAmbientSourceText: string | null = null;

export function beginCanvasAmbient(
  ctxName: string,
  diagnostics: Diagnostic[],
  sourceText: string,
): void {
  _canvasAmbientCtx = ctxName;
  _canvasAmbientDiagnostics = diagnostics;
  _canvasAmbientSourceText = sourceText;
}

export function endCanvasAmbient(): void {
  _canvasAmbientCtx = null;
  _canvasAmbientDiagnostics = null;
  _canvasAmbientSourceText = null;
}

export function getCanvasAmbientCtx(): string | null {
  return _canvasAmbientCtx;
}

export function getCanvasAmbientDiagnostics(): Diagnostic[] | null {
  return _canvasAmbientDiagnostics;
}

export function getCanvasAmbientSourceText(): string | null {
  return _canvasAmbientSourceText;
}

// ── Type-map seeding for callbacks ─────────────────────────────────────────

function callbackTypeMaps(): {
  functionReturnTypes: Map<string, CppTypeHint>;
  localVariableTypes: Map<string, CppTypeHint>;
  pointerVars: PointerTracker;
} {
  const scope = getCurrentIrTypeScope();
  const localVariableTypes = new Map<string, CppTypeHint>();
  if (scope) {
    for (const [k, v] of scope.globals) localVariableTypes.set(k, v as CppTypeHint);
    for (const [k, v] of scope.locals) {
      if (!localVariableTypes.has(k)) localVariableTypes.set(k, v as CppTypeHint);
    }
  }
  const functionReturnTypes = new Map<string, CppTypeHint>(
    [...(getContext().activeFunctionReturnTypes ?? new Map())] as Array<[string, CppTypeHint]>,
  );
  return { functionReturnTypes, localVariableTypes, pointerVars: new Map() };
}

// ── Compact expression helper (concise-body / legacy) ──────────────────────

/**
 * Lower a single callback-body expression to a C++ string (no trailing `;`).
 * Used for concise arrow bodies and as a compact-render fallback. Block bodies
 * go through lowerStatementList instead.
 */
export function lowerCallbackExpr(
  expr: ts.Expression,
  sourceText: string,
  diagnostics: Diagnostic[],
): string {
  if (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    expr.expression.name.text === "set" &&
    ts.isIdentifier(expr.expression.expression) &&
    isSignalName(expr.expression.expression.text)
  ) {
    const sigName = expr.expression.expression.text;
    const argText = expr.arguments[0]
      ? renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics))
      : "0";
    return `${sigName} = ${argText}`;
  }

  if (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.arguments.length === 0 &&
    isSignalName(expr.expression.text)
  ) {
    return expr.expression.text;
  }

  let raw = renderExprAsText(expressionToIR(expr, sourceText, diagnostics));
  raw = resolveColorLiterals(raw);
  return raw;
}

// ── Canvas disallowed-statement reject ─────────────────────────────────────

const CANVAS_DISALLOWED_KINDS = new Set([
  "try",
  "throw",
  "switch",
  "class",
  "function",
]);

function rejectDisallowedCanvasStatements(
  statements: StatementIR[],
  diagnostics: Diagnostic[],
  sourceText: string,
): void {
  const walk = (s: StatementIR): void => {
    if (CANVAS_DISALLOWED_KINDS.has(s.kind)) {
      diagnostics.push({
        severity: "error",
        code: "ui-callback-unsupported-statement",
        message: `Unsupported statement in ${callbackContextLabel("ui-draw-canvas")}: '${s.kind}' cannot be lowered here.`,
        hint: unsupportedStatementHint("ui-draw-canvas"),
        source: sourceText.slice(0, 80),
      } as Diagnostic);
      return;
    }
    if (s.kind === "if") {
      for (const n of s.thenBranch) walk(n);
      for (const n of s.elseBranch ?? []) walk(n);
    } else if (s.kind === "while" || s.kind === "do_while" || s.kind === "for" || s.kind === "block") {
      for (const n of s.body) walk(n);
    }
  };
  for (const s of statements) walk(s);
}

// ── Primary IR lowering ────────────────────────────────────────────────────

/**
 * Lower an arrow/function-expression callback body to StatementIR[] through
 * the same lowerStatementList path setInterval uses.
 */
export function lowerCallbackStatements(
  cbArg: ts.ArrowFunction | ts.FunctionExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  contextId: CallbackContextId = "ui-event-callback",
): StatementIR[] {
  const fnName = `__ui_cb_${contextId}`;
  const isCanvas = contextId === "ui-draw-canvas";
  const diagStart = diagnostics.length;
  const { functionReturnTypes, localVariableTypes, pointerVars } = callbackTypeMaps();

  if (isCanvas) {
    const ctxName = cbArg.parameters[0]?.name.getText() ?? "ctx";
    beginCanvasAmbient(ctxName, diagnostics, sourceText);
  }

  try {
    let statements: StatementIR[];
    if (ts.isBlock(cbArg.body)) {
      statements = lowerStatementList(
        cbArg.body.statements,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        localVariableTypes,
        fnName,
        undefined,
        pointerVars,
      );
    } else {
      let exprText: string;
      if (isCanvas && ts.isCallExpression(cbArg.body)) {
        const ctxName = cbArg.parameters[0]?.name.getText() ?? "ctx";
        exprText = rewriteCanvasCall(cbArg.body, ctxName, diagnostics, sourceText) ?? "";
      } else {
        exprText = lowerCallbackExpr(cbArg.body, sourceText, diagnostics);
      }
      statements = [{
        kind: "call",
        sourceSpan: makeSourceSpan(cbArg.body, fileName, sourceText),
        callee: "__EMIT__",
        args: [{ kind: "string", value: exprText.replace(/;$/, "") }],
      }];
    }

    statements = resolveColorsInStatements(statements);

    if (isCanvas) {
      rejectDisallowedCanvasStatements(statements, diagnostics, sourceText);
    }

    for (let i = diagStart; i < diagnostics.length; i++) {
      const d = diagnostics[i];
      if (d.code === "TS2CPP_UNSUPPORTED_STMT" && d.severity === "error") {
        d.code = "ui-callback-unsupported-statement";
        d.message = `Unsupported statement in ${callbackContextLabel(contextId)}.`;
        d.hint = unsupportedStatementHint(contextId);
      }
    }

    return statements;
  } finally {
    if (isCanvas) endCanvasAmbient();
  }
}

// ── Named / inline callback resolution ─────────────────────────────────────

export type ResolvedCallbackArg =
  | { kind: "inline"; fn: ts.ArrowFunction | ts.FunctionExpression }
  | { kind: "named"; name: string };

function findTopLevelCallable(
  name: string,
  sourceFile: ts.SourceFile,
):
  | { kind: "function"; decl: ts.FunctionDeclaration }
  | { kind: "arrow"; fn: ts.ArrowFunction | ts.FunctionExpression }
  | undefined {
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name && stmt.body) {
      return { kind: "function", decl: stmt };
    }
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(d.name) &&
          d.name.text === name &&
          d.initializer &&
          (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
        ) {
          return { kind: "arrow", fn: d.initializer };
        }
      }
    }
  }
  return undefined;
}

/** Resolve a UI callback arg to an inline arrow or a named free-function ref.
 *  Unresolvable identifiers produce a fatal diagnostic (fail closed). */
export function resolveCallbackArg(
  cbArg: ts.Expression | undefined,
  sourceFile: ts.SourceFile | undefined,
  diagnostics: Diagnostic[],
  label: string,
): ResolvedCallbackArg | undefined {
  if (!cbArg) return undefined;

  if (ts.isArrowFunction(cbArg) || ts.isFunctionExpression(cbArg)) {
    return { kind: "inline", fn: cbArg };
  }

  if (ts.isIdentifier(cbArg)) {
    const name = cbArg.text;
    const sf = sourceFile ?? cbArg.getSourceFile();
    if (sf && findTopLevelCallable(name, sf)) {
      return { kind: "named", name };
    }
    diagnostics.push({
      severity: "error",
      code: "ui-callback-unresolved-name",
      message: `${label}: cannot resolve '${name}' to a top-level function or arrow. Pass an inline arrow, or declare '${name}' at module scope.`,
      hint: `Example: use an inline arrow (() => { /* ... */ }) or declare function ${name}() { ... } at top level.`,
    } as Diagnostic);
    return undefined;
  }

  diagnostics.push({
    severity: "error",
    code: "ui-callback-unsupported-arg",
    message: `${label}: callback must be an inline arrow/function expression or a top-level function name.`,
  } as Diagnostic);
  return undefined;
}

/**
 * Resolve + lower a callback when the C++ wrapper signature may differ from
 * the author's function (bindInput, list tap). Returns statements + param
 * names for IR-level rename.
 */
export function lowerNamedOrInlineCallback(
  cbArg: ts.Expression | undefined,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  label: string,
  contextId: CallbackContextId = "ui-event-callback",
): { statements: StatementIR[]; paramNames: string[] } | undefined {
  if (!cbArg) return undefined;

  if (ts.isArrowFunction(cbArg) || ts.isFunctionExpression(cbArg)) {
    const paramNames = cbArg.parameters
      .map((p) => (ts.isIdentifier(p.name) ? p.name.text : ""))
      .filter(Boolean);
    return {
      statements: lowerCallbackStatements(cbArg, fileName, sourceText, diagnostics, contextId),
      paramNames,
    };
  }

  if (ts.isIdentifier(cbArg)) {
    const name = cbArg.text;
    const sf = cbArg.getSourceFile();
    const found = sf ? findTopLevelCallable(name, sf) : undefined;
    if (found?.kind === "arrow") {
      const paramNames = found.fn.parameters
        .map((p) => (ts.isIdentifier(p.name) ? p.name.text : ""))
        .filter(Boolean);
      return {
        statements: lowerCallbackStatements(found.fn, fileName, sourceText, diagnostics, contextId),
        paramNames,
      };
    }
    if (found?.kind === "function" && found.decl.body) {
      const paramNames = found.decl.parameters
        .map((p) => (ts.isIdentifier(p.name) ? p.name.text : ""))
        .filter(Boolean);
      const { functionReturnTypes, localVariableTypes, pointerVars } = callbackTypeMaps();
      const diagStart = diagnostics.length;
      const statements = resolveColorsInStatements(
        lowerStatementList(
          found.decl.body.statements,
          fileName,
          sourceText,
          diagnostics,
          functionReturnTypes,
          localVariableTypes,
          `__ui_cb_${contextId}`,
          undefined,
          pointerVars,
        ),
      );
      for (let i = diagStart; i < diagnostics.length; i++) {
        const d = diagnostics[i];
        if (d.code === "TS2CPP_UNSUPPORTED_STMT" && d.severity === "error") {
          d.code = "ui-callback-unsupported-statement";
          d.message = `Unsupported statement in ${callbackContextLabel(contextId)}.`;
          d.hint = unsupportedStatementHint(contextId);
        }
      }
      return { statements, paramNames };
    }
    diagnostics.push({
      severity: "error",
      code: "ui-callback-unresolved-name",
      message: `${label}: cannot resolve '${name}' to a top-level function or arrow.`,
      hint: `Pass an inline arrow, or declare '${name}' at module scope.`,
    } as Diagnostic);
    return undefined;
  }

  diagnostics.push({
    severity: "error",
    code: "ui-callback-unsupported-arg",
    message: `${label}: callback must be an inline arrow/function expression or a top-level function name.`,
  } as Diagnostic);
  return undefined;
}

// ── Compact render (tests / legacy string fallbacks) ───────────────────────

export function renderStatementsCompact(statements: StatementIR[]): string {
  const strategy = getContext().activeStrategy ?? resolveStrategy("generic");
  const { functionReturnTypes, localVariableTypes } = callbackTypeMaps();
  const knownVariableTypes = new Map(
    [...localVariableTypes].map(([k, v]) => [k, { cppType: v }]),
  );
  const renderer = new StatementRenderer({
    strategy,
    knownFunctionReturnTypes: functionReturnTypes,
    pointerVarTypes: new Map(),
    globalPointerVarTypes: new Map(),
    classNameMap: new Map(),
    enumNames: new Set(),
    largeEnumNames: new Set(),
    boardConstants: undefined,
    knownVariableTypes,
    stringVarNames: new Set(),
    crossModuleClassNames: new Set(),
  });
  const scope = createEmissionScopeState();
  for (const [k, v] of knownVariableTypes) scope.knownVariableTypes.set(k, v);
  const parts: string[] = [];

  const renderOne = (s: StatementIR): void => {
    if (s.kind === "if") {
      const { statement: head } = renderer.renderWithPrelude(s, false, undefined, scope.knownVariableTypes);
      const thenParts: string[] = [];
      for (const n of s.thenBranch) {
        const before = parts.length;
        renderOne(n);
        thenParts.push(...parts.splice(before));
      }
      if (s.elseBranch && s.elseBranch.length > 0) {
        const elseParts: string[] = [];
        for (const n of s.elseBranch) {
          const before = parts.length;
          renderOne(n);
          elseParts.push(...parts.splice(before));
        }
        parts.push(`${head} { ${thenParts.join(" ")} } else { ${elseParts.join(" ")} }`);
      } else {
        parts.push(`${head} { ${thenParts.join(" ")} }`);
      }
      return;
    }
    if (s.kind === "for" || s.kind === "while" || s.kind === "do_while") {
      const { statement: head } = renderer.renderWithPrelude(s, false, undefined, scope.knownVariableTypes);
      const bodyParts: string[] = [];
      for (const n of s.body) {
        const before = parts.length;
        renderOne(n);
        bodyParts.push(...parts.splice(before));
      }
      if (s.kind === "do_while") {
        parts.push(`do { ${bodyParts.join(" ")} } ${head}`);
      } else {
        parts.push(`${head} { ${bodyParts.join(" ")} }`);
      }
      return;
    }
    if (s.kind === "block") {
      for (const n of s.body) renderOne(n);
      return;
    }
    const { prelude, statement } = renderer.renderWithPrelude(s, false, undefined, scope.knownVariableTypes);
    for (const line of prelude) parts.push(line.endsWith(";") ? line : `${line};`);
    parts.push(statement.endsWith(";") || statement.endsWith("}") ? statement : `${statement};`);
  };

  for (const s of statements) renderOne(s);
  return parts.join(" ");
}

/**
 * Lower an arrow/function-expression callback's body to a single C++ string.
 * Routes through lowerCallbackStatements then compact-renders. Prefer storing
 * bodyStatements on the handler spec and rendering at emit time.
 */
export function lowerCallbackBody(
  cbArg: ts.ArrowFunction | ts.FunctionExpression,
  sourceText: string,
  diagnostics: Diagnostic[],
  contextId: CallbackContextId = "ui-event-callback",
  fileName = "callback.ts",
): string {
  const statements = lowerCallbackStatements(cbArg, fileName, sourceText, diagnostics, contextId);
  return renderStatementsCompact(statements);
}
