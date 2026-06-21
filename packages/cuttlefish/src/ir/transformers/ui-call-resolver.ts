// ---------------------------------------------------------------------------
// UI call resolver — intercepts ui.mount / ui.signal / ui.bind calls and
// lowers them to IR. This is the seam between author UI calls and the
// lowered tables / HAL ops.
//
// Pure-helper state (import map, signals, bindings) is module-scoped and reset
// per transpile run via resetUICallState(). The full tryResolveUICall() reads
// the active strategy from the compilation context (getContext().activeStrategy)
// and is invoked from call-statement.ts after tryResolveHALMethod.
// ---------------------------------------------------------------------------

import ts from "typescript";
import { Diagnostic } from "../../types.js";
import { StatementIR, HALOpIR } from "../../api/index.js";
import { makeSourceSpan } from "../ast-node-utils.js";
import { emitLinesToIR, halOpsToIR } from "./hal-emit-helpers.js";
import { resolveMount, MountRequest } from "./ui-mount.js";
import { emitSignalDecl, BindingSpec } from "./ui-reactive.js";
import { lowerOnMount, markEntryHasUI, getUIModule } from "../../ui/ui-registry.js";
import { expressionToIR } from "../expression-to-ir.js";
import { renderExprAsText } from "../render-expr.js";
import { resolveColor } from "../../ui/color.js";
import type { StyledNode } from "../../ui/style-resolver.js";
import { getContext } from "../build-ir-state.js";
import { escapeCppStringLiteral } from "../../utils/strings.js";

// ── Pure-helper state ───────────────────────────────────────────────────────

/** Maps an imported UI tree name (e.g. "screen") → its resolved .ui.html path. */
const uiModuleImports = new Map<string, string>();

/** Recorded signals: name → { cppType, initialValue, decl, emitted }. */
const signals = new Map<string, { cppType: string; initialValue: number | string | boolean; decl: string; emitted: boolean }>();

/** Recorded binding specs, accumulated for emit-time table generation. */
const bindings: BindingSpec[] = [];

/** Recorded press/release bindings: node index + pin + edge + handler name. */
export interface PressBinding {
  nodeIndex: number;
  pin: string;
  edge: "press" | "release";
  handlerName: string;
}
const pressBindings: PressBinding[] = [];

export function recordPressBinding(binding: PressBinding): void {
  pressBindings.push(binding);
}

export function uiPressBindings(): PressBinding[] {
  return pressBindings;
}

// ── Pin-watching specs (async event-loop input model) ───────────────────────

export interface WatchPinSpec {
  pin: string;
  /** Function name of the generated async watcher task. */
  fnName: string;
  /** C++ body of the callback (what happens on falling edge). */
  callbackBody: string;
}

const _watchPinSpecs: WatchPinSpec[] = [];

export function recordWatchPin(spec: WatchPinSpec): void {
  _watchPinSpecs.push(spec);
}

export function watchPinSpecs(): WatchPinSpec[] {
  return _watchPinSpecs;
}

export function registerUIModuleImport(name: string, htmlPath: string): void {
  uiModuleImports.set(name, htmlPath);
}

export function resolveUIModuleImport(name: string): string | undefined {
  return uiModuleImports.get(name);
}

export function recordSignal(name: string, cppType: string, initialValue: number | string | boolean): void {
  const decl = emitSignalDecl(name, cppType, initialValue);
  signals.set(name, { cppType, initialValue, decl, emitted: false });
}

/** Mark a signal as already emitted via its own var_decl (const X = ui.signal).
 *  Prevents uiSignalDecls() from double-declaring it at file scope. */
export function markSignalEmitted(name: string): void {
  const s = signals.get(name);
  if (s) s.emitted = true;
}

export function uiSignalNames(): string[] {
  return [...signals.keys()];
}

/** Is `name` a recorded UI signal? Used to lower `temp()` reads → `temp`. */
export function isSignalName(name: string): boolean {
  return signals.has(name);
}

/** The recorded C++ type of a signal, or undefined if not a signal.
 *  Used by the text-binding lowerer to pick %d vs %g (spec §5.3). */
export function signalCppType(name: string): string | undefined {
  return signals.get(name)?.cppType;
}

export function uiSignalDecls(): string[] {
  // Skip signals already emitted via their own const X = ui.signal(...) var_decl
  // — those are declared in the function body, not at file scope.
  return [...signals.values()].filter((s) => !s.emitted).map((s) => s.decl);
}

export function recordBinding(spec: BindingSpec): void {
  bindings.push(spec);
}

export function uiBindings(): BindingSpec[] {
  return [...bindings];
}

export function resetUICallState(): void {
  uiModuleImports.clear();
  signals.clear();
  bindings.length = 0;
  pressBindings.length = 0;
  _watchPinSpecs.length = 0;
}

// ── Signal name synthesis ───────────────────────────────────────────────────

let signalCounter = 0;
function nextSyntheticSignalName(): string {
  return `__ui_sig_${signalCounter++}`;
}

// ── Call detection ──────────────────────────────────────────────────────────

/** Is this call expression a `ui.<method>(...)` call? */
export function isUICall(call: ts.CallExpression): call is ts.CallExpression & { expression: ts.PropertyAccessExpression } {
  return (
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === "ui"
  );
}

// ── Argument extraction ─────────────────────────────────────────────────────

/** Read the display/bus/cs/dc/rst from a ui.mount options object literal. */
function extractMountOptions(
  optsExpr: ts.Expression | undefined,
  diagnostics: Diagnostic[],
): Partial<MountRequest> | null {
  if (!optsExpr || !ts.isObjectLiteralExpression(optsExpr)) {
    diagnostics.push({
      severity: "error",
      code: "ui-mount-opts",
      message: "ui.mount expects an options object { display, bus, cs, dc, rst }",
    } as Diagnostic);
    return null;
  }
  const opts: Record<string, string | number> = {};
  for (const prop of optsExpr.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    const key = prop.name.text;
    if (ts.isStringLiteral(prop.initializer)) opts[key] = prop.initializer.text;
    else if (ts.isNumericLiteral(prop.initializer)) opts[key] = Number(prop.initializer.text);
  }
  return opts as Partial<MountRequest>;
}

// ── The main resolver ───────────────────────────────────────────────────────

export interface UICallOptions {
  /** When the call is `const X = ui.signal(...)`, the declaration name X. */
  constName?: string;
}

/**
 * Resolve a ui.* call to IR. Returns null if the call is not a ui.* call
 * (so the caller falls through to other handling).
 *
 * Reads the active PlatformGraphicsStrategy from the compilation context to
 * validate the driver and resolve colors/storage.
 */
export function tryResolveUICall(
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  options: UICallOptions = {},
): StatementIR | null {
  if (!isUICall(call)) return null;

  const method = call.expression.name.text;

  if (method === "mount") {
    return resolveMountCall(call, fileName, sourceText, diagnostics);
  }
  if (method === "signal") {
    return resolveSignalCall(call, fileName, sourceText, options);
  }
  if (method === "bind") {
    return resolveBindCall(call, fileName, sourceText, diagnostics);
  }
  if (method === "watchPin") {
    return resolveWatchPinCall(call, fileName, sourceText, diagnostics);
  }
  // Unknown ui.* method — let it fall through
  return null;
}

function resolveMountCall(
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
): StatementIR | null {
  const treeArg = call.arguments[0];
  const optsArg = call.arguments[1];
  if (!treeArg || !ts.isIdentifier(treeArg)) {
    diagnostics.push({
      severity: "error", code: "ui-mount-tree",
      message: "ui.mount's first argument must be an imported UI tree (e.g. `screen`)",
    } as Diagnostic);
    return null;
  }

  const htmlPath = resolveUIModuleImport(treeArg.text);
  if (!htmlPath) {
    diagnostics.push({
      severity: "error", code: "ui-mount-tree",
      message: `ui.mount: "${treeArg.text}" is not a recognized UI tree import. Did you import it from a .ui.html file?`,
    } as Diagnostic);
    return null;
  }

  const opts = extractMountOptions(optsArg, diagnostics);
  if (!opts || opts.display === undefined || opts.bus === undefined ||
      opts.cs === undefined || opts.dc === undefined || opts.rst === undefined) {
    return null;
  }

  const strategy = getContext().activeStrategy;
  if (!strategy) {
    diagnostics.push({
      severity: "error", code: "ui-no-strategy",
      message: "ui.mount: no active platform strategy (cannot resolve display driver)",
    } as Diagnostic);
    return null;
  }

  // ILI9341 viewport in landscape (setRotation(1) swaps 240×320 → 320×240).
  // The driver hardcodes setRotation(1), so layout must use the landscape dims.
  const viewport = { width: 320, height: 240 };

  // Final layout + lower using the mount's viewport.
  const lowered = lowerOnMount(htmlPath, {
    colorFormat: strategy.colorFormat(),
    storage: strategy.graphicsCapacity().nodeStorage,
    viewport,
  });

  const req: MountRequest = {
    display: String(opts.display),
    bus: String(opts.bus),
    cs: Number(opts.cs),
    dc: Number(opts.dc),
    rst: Number(opts.rst),
  };
  const displayInitOp = resolveMount(req, strategy, viewport);

  // Mark the entry file as having a UI → gates runtime header + table injection.
  markEntryHasUI();

  return halOpsToIR([displayInitOp], call, fileName, sourceText);
}

function resolveSignalCall(
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  options: UICallOptions,
): StatementIR | null {
  const valueArg = call.arguments[0];
  if (!valueArg) return null;

  // Infer initial value + cpp type from the literal.
  let initialValue: number | string | boolean = 0;
  let cppType = "int";
  if (ts.isNumericLiteral(valueArg)) {
    initialValue = Number(valueArg.text);
    cppType = Number.isInteger(initialValue) ? "int" : "double";
  } else if (ts.isStringLiteral(valueArg)) {
    initialValue = valueArg.text;
    cppType = "const char*";
  } else if (valueArg.kind === ts.SyntaxKind.TrueKeyword || valueArg.kind === ts.SyntaxKind.FalseKeyword) {
    initialValue = valueArg.kind === ts.SyntaxKind.TrueKeyword;
    cppType = "bool";
  }

  const name = options.constName ?? nextSyntheticSignalName();
  recordSignal(name, cppType, initialValue);

  // The signal lowers to a device variable declaration, emitted as a raw line.
  // The call itself produces no statement (the var decl is emitted at file scope
  // via uiSignalDecls() at emit time), so return an empty block.
  return {
    kind: "block",
    sourceSpan: makeSourceSpan(call, fileName, sourceText),
    body: [],
  };
}

// ── Text-binding lowering (spec §5) ──────────────────────────────────────────

/** Result of lowering a text-binding arrow body. */
export interface LoweredTextBody {
  /** Imperative C++ statement(s) writing into `buf` (the textFn param). */
  cppBody: string;
}

/** Format specifier for a single numeric interpolation per spec §5.3.
 *  - bare int/uint/bool signal read  → "%d"
 *  - bare float/double signal read   → "%g"
 *  - anything else (arithmetic, non-signal, literal) → "%d" (default; v1) */
function numericFormat(expr: ts.Expression): string {
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) &&
      expr.arguments.length === 0 && isSignalName(expr.expression.text)) {
    const t = signalCppType(expr.expression.text);
    if (t === "float" || t === "double") return "%g";
  }
  return "%d";
}

/** Lower a single expression as a snprintf argument.
 *  - signal read `name()` → "name"
 *  - numeric literal / other → rendered via the shared expression renderer */
function lowerInterpolationArg(expr: ts.Expression, sourceText: string, diagnostics: Diagnostic[]): string {
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) &&
      expr.arguments.length === 0 && isSignalName(expr.expression.text)) {
    return expr.expression.text;
  }
  return renderExprAsText(expressionToIR(expr, sourceText, diagnostics));
}

/**
 * Lower a text-binding arrow body to an imperative C++ statement that writes
 * into `buf` (the textFn's first parameter, size `size`). Recognizes three
 * shapes (spec §5.2): String(<numeric>), a bare string literal, and a template
 * literal with numeric interpolations. Anything else produces a safe no-op
 * (`buf[0] = 0;`) plus a `ui-bind-text-unlowered` warning so the author sees it.
 *
 * Pure function of the AST + the recorded signal table; no side effects beyond
 * pushing diagnostics.
 */
export function lowerTextBindingBody(
  body: ts.Expression,
  _fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
): LoweredTextBody {
  const warn = (): LoweredTextBody => {
    diagnostics.push({
      severity: "warning",
      code: "ui-bind-text-unlowered",
      message: `ui.bind text: this arrow-body shape is not supported in v1. Supported: String(<signal>), a string literal, or a template literal with numeric interpolations. The node will display an empty string.`,
    } as Diagnostic);
    return { cppBody: "buf[0] = 0;" };
  };

  // Shape 1: String(<numeric expr>)
  if (ts.isCallExpression(body) && ts.isIdentifier(body.expression) &&
      body.expression.text === "String" && body.arguments.length === 1) {
    const arg = body.arguments[0];
    const fmt = numericFormat(arg);
    const argText = lowerInterpolationArg(arg, sourceText, diagnostics);
    return { cppBody: `snprintf(buf, size, "${fmt}", ${argText});` };
  }

  // Shape 2: bare string literal
  if (ts.isStringLiteral(body)) {
    const escaped = escapeCppStringLiteral(body.text);
    return { cppBody: `snprintf(buf, size, "%s", "${escaped}");` };
  }

  // Shape 3: template literal with numeric interpolations.
  // Build the format string by alternating literal fragments and %specifiers,
  // and collect the matching argument expressions in order.
  if (ts.isTemplateExpression(body)) {
    const fmtBuf: string[] = [escapeCppStringLiteral(body.head.text)];
    const args: string[] = [];
    for (const span of body.templateSpans) {
      fmtBuf.push(numericFormat(span.expression));
      args.push(lowerInterpolationArg(span.expression, sourceText, diagnostics));
      fmtBuf.push(escapeCppStringLiteral(span.literal.text));
    }
    const fmt = fmtBuf.join("");
    const argList = args.length ? ", " + args.join(", ") : "";
    return { cppBody: `snprintf(buf, size, "${fmt}"${argList});` };
  }

  return warn();
}

function resolveBindCall(
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
): StatementIR | null {
  const nodeArg = call.arguments[0];
  const propArg = call.arguments[1];
  const fnArg = call.arguments[2];

  if (!nodeArg || !propArg || !fnArg) return null;

  // nodeArg is expected to be `screen.<id>` — a property access on an imported
  // UI tree. Resolve the node index from the lowered tree's id ordering.
  let nodeIndex = 0;
  if (ts.isPropertyAccessExpression(nodeArg) && ts.isIdentifier(nodeArg.expression)) {
    const htmlPath = resolveUIModuleImport(nodeArg.expression.text);
    if (htmlPath) {
      nodeIndex = resolveNodeIndex(htmlPath, nodeArg.name.text);
    }
  }

  let property = "text";
  if (ts.isStringLiteral(propArg)) property = propArg.text;

  const fnName = `__ui_bind_${property}_${bindings.length}`;

  // Text bindings lower through a dedicated path (spec §5) that emits an
  // imperative snprintf statement into the node's buffer. Color/numeric
  // bindings keep the generic expression path with color-literal resolution.
  let cppExpr = "";
  let cppBody: string | undefined;
  if (fnArg && (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg))) {
    const body = fnArg.body;
    if (ts.isExpression(body)) {
      if (property === "text") {
        cppBody = lowerTextBindingBody(body, fileName, sourceText, diagnostics).cppBody;
      } else {
        let raw = renderExprAsText(expressionToIR(body, sourceText, diagnostics));
        // Resolve color string literals to RGB565 hex values. Handles hex,
        // named colors, and rgb()/rgba().
        raw = raw.replace(/"(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|[a-z]+|rgba?\([^)]*\))"/g, (match: string, color: string) => {
          try {
            return `0x${resolveColor(color, "rgb565").toString(16)}`;
          } catch { return match; }
        });
        cppExpr = raw;
      }
    }
  }
  recordBinding({ nodeIndex, property, fnName, cppExpr, cppBody });

  return {
    kind: "block",
    sourceSpan: makeSourceSpan(call, fileName, sourceText),
    body: [],
  };
}

/** Resolve ui.watchPin(pin, callback) — records a pin-watching spec.
 * The callback body is lowered to C++ for the generated async watcher. */
function resolveWatchPinCall(
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
): StatementIR | null {
  const pinArg = call.arguments[0];
  const cbArg = call.arguments[1];
  if (!pinArg) return null;

  const pin = ts.isIdentifier(pinArg) ? pinArg.text
    : ts.isNumericLiteral(pinArg) ? pinArg.text
    : pinArg.getText();

  // Lower the callback body to C++. Handles signal.set(v) → v = expr,
  // and signal() reads → signal variable references.
  let callbackBody = "";
  if (cbArg && (ts.isArrowFunction(cbArg) || ts.isFunctionExpression(cbArg))) {
    const body = cbArg.body;
    const lowerExpr = (expr: ts.Expression): string => {
      // signal.set(value) → signal = value
      if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) &&
          expr.expression.name.text === "set" && ts.isIdentifier(expr.expression.expression) &&
          isSignalName(expr.expression.expression.text)) {
        const sigName = expr.expression.expression.text;
        const argText = expr.arguments[0] ? renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics)) : "0";
        return `${sigName} = ${argText}`;
      }
      // signal() → signal (read)
      if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) &&
          expr.arguments.length === 0 && isSignalName(expr.expression.text)) {
        return expr.expression.text;
      }
      let raw = renderExprAsText(expressionToIR(expr, sourceText, diagnostics));
      raw = raw.replace(/"(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|[a-z]+|rgba?\([^)]*\))"/g, (match: string, color: string) => {
        try { return `0x${resolveColor(color, "rgb565").toString(16)}`; } catch { return match; }
      });
      return raw;
    };

    if (ts.isExpression(body)) {
      callbackBody = lowerExpr(body) + ";";
    } else if (ts.isBlock(body)) {
      const parts: string[] = [];
      for (const stmt of body.statements) {
        if (ts.isExpressionStatement(stmt) && stmt.expression) {
          parts.push(lowerExpr(stmt.expression) + ";");
        }
      }
      callbackBody = parts.join(" ");
    }
  }

  const fnName = `__ui_watchpin_${_watchPinSpecs.length}`;
  recordWatchPin({ pin: String(pin), fnName, callbackBody });

  return {
    kind: "block",
    sourceSpan: makeSourceSpan(call, fileName, sourceText),
    body: [],
  };
}

/** Look up a node's index in its tree by element id (pre-order DFS order). */
export function resolveNodeIndex(htmlPath: string, id: string): number {
  // Node indices follow pre-order DFS of the styled tree. The lowered tables
  // share this order, so we walk the registry's styled tree to find the id.
  const mod = getUIModule(htmlPath);
  if (!mod) return 0;
  let idx = 0;
  let found = 0;
  const walk = (n: StyledNode): boolean => {
    if (n.id === id) { found = idx; return true; }
    idx++;
    for (const c of n.children) { if (walk(c)) return true; }
    return false;
  };
  walk(mod.styled);
  return found;
}
