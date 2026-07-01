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
import { emitSignalDecl, BindingSpec, ListBindingSpec, recordListBinding, getListBindingsCount, InputBindingSpec, recordInputBinding, getInputBindingsCount, resetInputBindings } from "./ui-reactive.js";
import { lowerOnMount, markEntryHasUI, getUIModule } from "../../ui/ui-registry.js";
import { expressionToIR } from "../expression-to-ir.js";
import { renderExprAsText } from "../render-expr.js";
import { resolveColor } from "../../ui/color.js";
import { getDisplayProfile } from "../../ui/display-profile-store.js";
import { lowerCallbackBody, resetCallbackLoweringState } from "./ui-callback-lowering.js";
import { resolveDrawCanvasCall, resetCanvasBindings } from "./canvas-lowering.js";
import type { StyledNode } from "../../ui/style-resolver.js";
import { getContext } from "../build-ir-state.js";
import { escapeCppStringLiteral } from "../../utils/strings.js";

// ── Pure-helper state ───────────────────────────────────────────────────────

/** Maps an imported UI tree name (e.g. "screen") → its resolved .ui.html path. */
const uiModuleImports = new Map<string, string>();

/** Maps "treeName.elemId" (e.g. "screen.led") → node index in the UI tree. */
const elementValueMap = new Map<string, number>();

/** Register an element's node index for .value access. Called during
 *  build-ir.ts's import processing (alongside registerUIModuleImport). */
export function registerElementValue(treeName: string, elemId: string, htmlPath: string): void {
  const nodeIndex = resolveNodeIndex(htmlPath, elemId);
  elementValueMap.set(`${treeName}.${elemId}`, nodeIndex);
}

/** Resolve "screen.led" → node index, or undefined if not registered. */
export function resolveElementValue(treeName: string, elemId: string): number | undefined {
  return elementValueMap.get(`${treeName}.${elemId}`);
}

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

// ── Click handler specs (touch input) ───────────────────────────────────────

export interface ClickHandlerSpec {
  nodeIndex: number;
  /** Handler kind: click (short tap), hold (long press ≥600ms), release (finger up),
   *  change (input text committed via keyboard). */
  kind: "click" | "hold" | "release" | "change" | "rangechange";
  /** Function name of the generated handler. */
  fnName: string;
  /** C++ body of the callback. */
  callbackBody: string;
}

const _clickHandlers: ClickHandlerSpec[] = [];

export function recordClickHandler(spec: ClickHandlerSpec): void {
  _clickHandlers.push(spec);
}

export function clickHandlers(): ClickHandlerSpec[] {
  return _clickHandlers;
}

/** Max node index that has a click handler (for sizing the handler array). */
export function maxClickNodeIndex(): number {
  return _clickHandlers.reduce((max, h) => Math.max(max, h.nodeIndex), -1);
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
  // Runs are static-content only: a node with rich-text runs cannot also have
  // a PROP_TEXT binding (the binding model replaces the whole text buffer,
  // which is incompatible with the node's precomputed run geometry). Reject the
  // binding with a diagnostic instead of silently producing an unrenderable node.
  if (spec.property === "text" && isRunNode(spec.nodeIndex)) {
    _diagnostics.push({
      severity: "warning",
      message: `text binding on node ${spec.nodeIndex} ignored — node has rich-text runs (runs are static-only).`,
      code: "run-text-binding-conflict",
    });
    return;
  }
  bindings.push(spec);
}

export function uiBindings(): BindingSpec[] {
  return [...bindings];
}

// Node indices that carry rich-text runs (populated by auto-wire's tree walk,
// which assigns the same document-order indices the binding resolver uses).
const _runNodeIndices = new Set<number>();
export function markRunNode(nodeIndex: number): void { _runNodeIndices.add(nodeIndex); }
export function isRunNode(nodeIndex: number): boolean { return _runNodeIndices.has(nodeIndex); }

// Diagnostics collected during binding resolution (e.g. run-text-binding-conflict).
export interface CallResolverDiagnostic { severity: "warning" | "error"; message: string; code: string; }
const _diagnostics: CallResolverDiagnostic[] = [];
export function getDiagnostics(): CallResolverDiagnostic[] { return [..._diagnostics]; }

export function resetUICallState(): void {
  uiModuleImports.clear();
  elementValueMap.clear();
  signals.clear();
  bindings.length = 0;
  pressBindings.length = 0;
  _watchPinSpecs.length = 0;
  _clickHandlers.length = 0;
  _runNodeIndices.clear();
  _diagnostics.length = 0;
  resetInputBindings();
  resetCallbackLoweringState();
  resetCanvasBindings();
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
  if (method === "bindList") {
    return resolveBindListCall(call, fileName, sourceText, diagnostics);
  }
  if (method === "bindInput") {
    return resolveBindInputCall(call, fileName, sourceText, diagnostics);
  }
  if (method === "watchPin") {
    return resolveWatchPinCall(call, fileName, sourceText, diagnostics);
  }
  if (method === "onTap") {
    return resolveOnTapCall(call, fileName, sourceText, diagnostics);
  }
  if (method === "drawCanvas") {
    return resolveDrawCanvasCall(call, fileName, sourceText, diagnostics);
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

  // Viewport from the display profile (data-driven, not hardcoded).
  const profile = getDisplayProfile();
  const viewport = { width: profile.width, height: profile.height };

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
    rotation: profile.rotation,
    backlight: profile.backlight,
    spiFrequency: profile.spiFrequency,
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

  // Shape 4: ternary with string literals (e.g. val === 0 ? 'Auto' : val === 1 ? 'Manual' : 'Off')
  // Lowers to a chain of if/else with snprintf.
  // Unwrap parentheses first: () => (cond ? 'a' : 'b')
  const unwrapped = ts.isParenthesizedExpression(body) ? body.expression : body;
  if (ts.isConditionalExpression(unwrapped)) {
    return lowerTernaryTextChain(unwrapped, sourceText, diagnostics) ?? warn();
  }

  return warn();
}

/** Lower a chain of ternary expressions with string branches to C++ if/else. */
function lowerTernaryTextChain(
  expr: ts.ConditionalExpression,
  sourceText: string,
  diagnostics: Diagnostic[],
): LoweredTextBody | null {
  const cases: { cond: string | null; value: string }[] = [];
  let current: ts.Expression = expr;

  while (ts.isConditionalExpression(current)) {
    const condText = renderExprAsText(expressionToIR(current.condition, sourceText, diagnostics));
    if (!ts.isStringLiteral(current.whenTrue)) return null;
    cases.push({ cond: condText, value: escapeCppStringLiteral(current.whenTrue.text) });
    current = current.whenFalse;
  }

  // The final else value
  if (ts.isStringLiteral(current)) {
    cases.push({ cond: null, value: escapeCppStringLiteral(current.text) });
  } else {
    return null;
  }

  const lines = cases.map((c, i) => {
    if (c.cond !== null) {
      const prefix = i === 0 ? "if" : "else if";
      return `${prefix} (${c.cond}) { snprintf(buf, size, "%s", "${c.value}"); }`;
    } else {
      return `else { snprintf(buf, size, "%s", "${c.value}"); }`;
    }
  });

  return { cppBody: lines.join(" ") };
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

/** Resolve ui.bindList(node, countFn, itemFn) — records a list binding spec.
 *  countFn: () => number (total item count)
 *  itemFn: (index) => string (text for item at index)
 *  Both arrows are lowered to C++ functions. */
function resolveBindListCall(
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  _diagnostics: Diagnostic[],
): StatementIR | null {
  if (call.arguments.length < 3) return null;
  const nodeArg = call.arguments[0];
  const countArg = call.arguments[1];
  const itemArg = call.arguments[2];

  // Resolve the <list> node index.
  let nodeIndex = 0;
  if (ts.isPropertyAccessExpression(nodeArg) && ts.isIdentifier(nodeArg.expression)) {
    const htmlPath = resolveUIModuleImport(nodeArg.expression.text);
    if (htmlPath) nodeIndex = resolveNodeIndex(htmlPath, nodeArg.name.text);
  }

  // Lower the count function: () => N → "return N;"
  let countBody = "return 0;";
  if (countArg && (ts.isArrowFunction(countArg) || ts.isFunctionExpression(countArg))) {
    const body = countArg.body;
    if (body && ts.isExpression(body)) {
      // Handle bare numeric/identifier directly (lowerTextBindingBody doesn't cover these).
      const exprText = (body as ts.Expression).getText();
      if (exprText && (/^\d+$/.test(exprText) || /^\w+$/.test(exprText))) {
        countBody = `return ${exprText};`;
      } else {
        // Try lowerTextBindingBody for more complex expressions.
        const { cppBody } = lowerTextBindingBody(body, fileName, sourceText, []);
        if (cppBody) {
          const m = /snprintf\([^,]+,\s*[^,]+,\s*"[^"]*"(?:,\s*(.+))?\)/.exec(cppBody);
          countBody = m?.[1] ? `return ${m[1].replace(/[;]\s*$/, "")};` : "return 0;";
        }
      }
    }
  }

  // Lower the item function: (i) => `text ${i}` → "snprintf(buf, size, ...);"
  let itemBody = "buf[0] = 0;";
  if (itemArg && (ts.isArrowFunction(itemArg) || ts.isFunctionExpression(itemArg))) {
    const body = itemArg.body;
    if (body && ts.isExpression(body)) {
      const { cppBody } = lowerTextBindingBody(body, fileName, sourceText, []);
      itemBody = cppBody || "buf[0] = 0;";
      // Replace the arrow's first parameter name with 'idx' (the C++ arg name).
      if (ts.isArrowFunction(itemArg) && itemArg.parameters.length > 0) {
        const paramName = itemArg.parameters[0].name.getText();
        if (paramName && paramName !== "idx") {
          itemBody = itemBody.replace(new RegExp(`\\b${paramName}\\b`, "g"), "idx");
        }
      }
    }
  }

  const countFnName = `__ui_list_count_${getListBindingsCount()}`;
  const itemFnName = `__ui_list_item_${getListBindingsCount()}`;
  const tapFnName = `__ui_list_tap_${getListBindingsCount()}`;

  // Optional 4th arg: onTap callback (index) => { ... }
  let tapFnBody: string | null = null;
  if (call.arguments.length >= 4) {
    const tapArg = call.arguments[3];
    if (tapArg && (ts.isArrowFunction(tapArg) || ts.isFunctionExpression(tapArg))) {
      const cbBody = lowerCallbackBody(tapArg, sourceText, _diagnostics);
      // Replace the arrow's parameter name with 'idx' (the C++ arg name).
      let body = cbBody || "";
      if (ts.isArrowFunction(tapArg) && tapArg.parameters.length > 0) {
        const paramName = tapArg.parameters[0].name.getText();
        if (paramName && paramName !== "idx") {
          body = body.replace(new RegExp(`\\b${paramName}\\b`, "g"), "idx");
        }
      }
      tapFnBody = body || null;
    }
  }

  recordListBinding({ nodeIndex, countFnName, itemFnName, tapFnName: tapFnBody ? tapFnName : null, countFnBody: countBody, itemFnBody: itemBody, tapFnBody });

  return {
    kind: "block",
    sourceSpan: makeSourceSpan(call, fileName, sourceText),
    body: [],
  };
}

/** Resolve ui.bindInput(node, callback) — records a two-way input binding.
 *  The callback fires (with the current text) whenever the bound <input>
 *  node's textBuffer changes at runtime (e.g. the user typed via the
 *  on-screen keyboard). Mirrors the bindList tap-callback lowering. */
function resolveBindInputCall(
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
): StatementIR | null {
  const nodeArg = call.arguments[0];
  const cbArg = call.arguments[1];
  if (!nodeArg || !cbArg) return null;

  // Resolve the <input> node index via the standard screen.<id> path.
  let nodeIndex = 0;
  if (ts.isPropertyAccessExpression(nodeArg) && ts.isIdentifier(nodeArg.expression)) {
    const htmlPath = resolveUIModuleImport(nodeArg.expression.text);
    if (htmlPath) nodeIndex = resolveNodeIndex(htmlPath, nodeArg.name.text);
  }

  const cbFnName = `__ui_input_cb_${getInputBindingsCount()}`;

  // Lower the callback body via the same mechanism as the bindList tap
  // callback. The arrow's first param is the typed string; rename it to
  // 'text' (the C++ arg name) so the body references resolve correctly.
  let cbFnBody = "";
  if (ts.isArrowFunction(cbArg) || ts.isFunctionExpression(cbArg)) {
    cbFnBody = lowerCallbackBody(cbArg, sourceText, diagnostics) || "";
    if (ts.isArrowFunction(cbArg) && cbArg.parameters.length > 0) {
      const paramName = cbArg.parameters[0].name.getText();
      if (paramName && paramName !== "text") {
        cbFnBody = cbFnBody.replace(new RegExp(`\\b${paramName}\\b`, "g"), "text");
      }
    }
  }

  recordInputBinding({ nodeIndex, cbFnName, cbFnBody });

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

  // Lower the callback body to C++ via the shared helper (same path as
  // onToggle). Handles console.* → platform transform, signal .set()/()
  // reads, and color-name resolution.
  let callbackBody = "";
  if (cbArg && (ts.isArrowFunction(cbArg) || ts.isFunctionExpression(cbArg))) {
    callbackBody = lowerCallbackBody(cbArg, sourceText, diagnostics);
  }

  const fnName = `__ui_watchpin_${_watchPinSpecs.length}`;
  recordWatchPin({ pin: String(pin), fnName, callbackBody });

  return {
    kind: "block",
    sourceSpan: makeSourceSpan(call, fileName, sourceText),
    body: [],
  };
}

/** Resolve ui.onTap([node]) — an awaitable tap notification.
 *  Lowers to a marker call IR whose callee ("__UI_TAP__") the async state
 *  machine recognizes and turns into a tap-counter poll. Must be awaited
 *  (statement-level). args[0] is the node filter: -1 = any tap, >=0 = node.
 *
 *  - await ui.onTap()           → args=[-1]   (resume on next tap anywhere)
 *  - await ui.onTap(screen.x)   → args=[idx]  (resume only when x is tapped) */
function resolveOnTapCall(
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
): StatementIR | null {
  const nodeArg = call.arguments[0];

  // Per-element form: await ui.onTap(screen.btn) → resolve the node index,
  // the same way onClick/onToggle do (screen.id property-access shape).
  if (nodeArg && ts.isPropertyAccessExpression(nodeArg) &&
      ts.isIdentifier(nodeArg.expression)) {
    const treeName = nodeArg.expression.text;          // "screen"
    const id = nodeArg.name.text;                       // "btn"
    const htmlPath = resolveUIModuleImport(treeName);
    if (htmlPath) {
      const nodeIndex = resolveNodeIndex(htmlPath, id);
      return {
        kind: "call",
        sourceSpan: makeSourceSpan(call, fileName, sourceText),
        callee: "__UI_TAP__",
        args: [{ kind: "number", value: nodeIndex }],
        isAwaited: true,
      };
    }
    // Unknown tree — fall through to the global form, with a warning.
    diagnostics.push({
      severity: "warning", code: "ui-ontap-arg",
      message: `ui.onTap(${nodeArg.getText()}) could not be resolved; awaiting any tap instead`,
    } as Diagnostic);
  }

  // Global form: await ui.onTap() — resume on the next tap anywhere.
  return {
    kind: "call",
    sourceSpan: makeSourceSpan(call, fileName, sourceText),
    callee: "__UI_TAP__",
    args: [{ kind: "number", value: -1 }],
    isAwaited: true,
  };
}

/** Look up a node's index in its tree by element id (pre-order DFS order). */
export function resolveNodeIndex(htmlPath: string, id: string): number {
  // Node indices follow pre-order DFS of the styled tree. The lowered tables
  // share this order, so we walk the registry's styled tree to find the id.
  const mod = getUIModule(htmlPath);
  if (!mod) return 0;
  let idx = 0;
  let found = -1;
  const walk = (n: StyledNode): boolean => {
    if (n.id === id) { found = idx; return true; }
    idx++;
    for (const c of n.children) { if (walk(c)) return true; }
    return false;
  };
  const roots = mod.allStyledScreens.length > 0 ? mod.allStyledScreens : [mod.styled];
  for (const root of roots) {
    if (walk(root)) break;
  }
  return found >= 0 ? found : 0;
}

/** Look up a node's HTML tag by element id (pre-order DFS order).
 *  Used to route generic callbacks (e.g. onChange) to the right lowering path
 *  based on element kind (range vs input). Returns "" if not found. */
export function resolveNodeTag(htmlPath: string, id: string): string {
  const mod = getUIModule(htmlPath);
  if (!mod) return "";
  let idx = 0;
  let foundTag = "";
  const walk = (n: StyledNode): boolean => {
    if (n.id === id) { foundTag = n.tag; return true; }
    idx++;
    for (const c of n.children) { if (walk(c)) return true; }
    return false;
  };
  const roots = mod.allStyledScreens.length > 0 ? mod.allStyledScreens : [mod.styled];
  for (const root of roots) {
    if (walk(root)) break;
  }
  return foundTag;
}
