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
import { Diagnostic, type SourceSpan } from "../../types.js";
import { StatementIR, HALOpIR } from "../../api/index.js";
import { makeDiagnostic, makeSourceSpan } from "../ast-node-utils.js";
import { emitLinesToIR, halOpsToIR } from "./hal-emit-helpers.js";
import { resolveMount, MountRequest } from "./ui-mount.js";
import { emitSignalDecl, BindingSpec, ListBindingSpec, recordListBinding, getListBindingsCount, InputBindingSpec, recordInputBinding, getInputBindingsCount, resetInputBindings } from "./ui-reactive.js";
import { requireUIHook, entryHasUI as hookEntryHasUI } from "../../ui-hook.js";
import { expressionToIR } from "../expression-to-ir.js";
import { renderExprAsText } from "../render-expr.js";
import { getDisplayProfile } from "../../stores/display-profile-store.js";
import { effectiveDisplaySize } from "../../api/shared/display-profile.js";
import {
  lowerCallbackStatements,
  lowerNamedOrInlineCallback,
  renameIdentifiersInStatements,
  renderStatementsCompact,
  resolveCallbackArg,
  resetCallbackLoweringState,
  resolveColorLiterals,
  resolveColorIR,
} from "./ui-callback-lowering.js";
import { resolveDrawCanvasCall, resetCanvasBindings } from "./canvas-lowering.js";
import { getContext } from "../build-ir-state.js";

/** Structural alias for @typecad/ui's StyledNode — only the properties
 *  accessed by the walk functions below are declared. Defined locally to
 *  avoid importing from @typecad/ui (circular build dependency). */
interface StyledNode {
  tag: string;
  id?: string;
  screenId: number;
  children: StyledNode[];
  [key: string]: unknown;
}
import { getCurrentIrTypeScope } from "../symbol-types.js";
import { inferExprCppType, type CppTypeHint } from "../type-resolution.js";
import { escapeCppStringLiteral, escapeSnprintfFormatFragment } from "../../utils/strings.js";

// ── Pure-helper state ───────────────────────────────────────────────────────

/** Maps an imported UI tree name (e.g. "screen") → its resolved .ui.html path. */
const uiModuleImports = new Map<string, string>();

/** Maps "treeName.elemId" (e.g. "screen.led") → node index in the UI tree. */
const elementValueMap = new Map<string, number>();

/** Register an element's node index for .value access. Called during
 *  build-ir.ts's import processing (alongside registerUIModuleImport).
 *
 *  Element ids here come from a tree walk over the SAME styled tree that
 *  resolveNodeIndex walks, so not-found is structurally unreachable in
 *  practice. We use resolveNodeIndexOrZero (which falls back to 0 on -1)
 *  rather than threading diagnostics through build-ir's tree-walk path. */
export function registerElementValue(treeName: string, elemId: string, htmlPath: string): void {
  const nodeIndex = resolveNodeIndexOrZero(htmlPath, elemId);
  elementValueMap.set(`${treeName}.${elemId}`, nodeIndex);
}

/** Internal helper: resolveNodeIndex that falls back to 0 on not-found.
 *  Used only by registerElementValue (an unreachable-not-found site). Every
 *  author-facing call site must use resolveNodeIndex directly and check for
 *  the -1 sentinel, emitting a `ui-unknown-element` diagnostic. */
function resolveNodeIndexOrZero(htmlPath: string, id: string, screenId?: string): number {
  const idx = resolveNodeIndex(htmlPath, id, screenId);
  return idx < 0 ? 0 : idx;
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
  /** C++ body of the callback (legacy/auto-wire string bake). Prefer bodyStatements. */
  callbackBody: string;
  /** Statement IR for the callback body (main pipeline). */
  bodyStatements?: StatementIR[];
  /** Source span of the original callback arrow/function, when known. */
  sourceSpan?: SourceSpan;
  /** True when fnName references an existing author-declared C++ function (from
   *  an on:* attribute like on:click="saveSettings"). When true, the emitter
   *  must NOT synthesize a wrapper void fnName() {...} — the function exists. */
  isNamedRef?: boolean;
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
  /** C++ body of the callback (legacy string bake). Prefer bodyStatements. */
  callbackBody: string;
  /** Statement IR for the callback body (main pipeline). */
  bodyStatements?: StatementIR[];
  /** Source span of the original callback arrow/function, when known. */
  sourceSpan?: SourceSpan;
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

// ── ui.window.* (native desktop window controls) ────────────────────────────

/** Detect `ui.window.<method>(...)` — a two-level property access chain.
 *  Returns the method name ("setTitle" / "setIcon") or undefined. */
function matchUIWindowCall(call: ts.CallExpression): string | undefined {
  // Shape: CallExpression { expression: PropertyAccessExpression {
  //   name: <method>, expression: PropertyAccessExpression {
  //     name: "window", expression: Identifier { text: "ui" } } } }
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  const inner = call.expression.expression;
  if (!ts.isPropertyAccessExpression(inner)) return undefined;
  if (!ts.isIdentifier(inner.expression) || inner.expression.text !== "ui") return undefined;
  if (!ts.isIdentifier(inner.name) || inner.name.text !== "window") return undefined;
  return call.expression.name.text;
}

/** Detect `ui.drawer.<method>(...)` — same shape as ui.window. Returns the
 *  method name ("open" / "close") or undefined. */
function matchUIDrawerCall(call: ts.CallExpression): string | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  const inner = call.expression.expression;
  if (!ts.isPropertyAccessExpression(inner)) return undefined;
  if (!ts.isIdentifier(inner.expression) || inner.expression.text !== "ui") return undefined;
  if (!ts.isIdentifier(inner.name) || inner.name.text !== "drawer") return undefined;
  return call.expression.name.text;
}

/** Detect ui.dialog.<method>(...) — same shape, resolves <dialog> ids. */
function matchUIDialogCall(call: ts.CallExpression): string | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  const inner = call.expression.expression;
  if (!ts.isPropertyAccessExpression(inner)) return undefined;
  if (!ts.isIdentifier(inner.expression) || inner.expression.text !== "ui") return undefined;
  if (!ts.isIdentifier(inner.name) || inner.name.text !== "dialog") return undefined;
  return call.expression.name.text;
}

/** Detect ui.toast('<id>') — show a <toast>; auto-closes via duration. */
function matchUIToastCall(call: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(call.expression)) return false;
  const inner = call.expression.expression;
  if (!ts.isIdentifier(inner) || inner.text !== "ui") return false;
  return ts.isIdentifier(call.expression.name) && call.expression.name.text === "toast";
}

/** Resolve ui.drawer.open('<id>') / ui.drawer.close('<id>' | ), and the
 *  dialog/toast aliases. The id resolves at BUILD time to the node index of
 *  the <drawer>/<dialog>/<toast> element, emitting ui_drawer_open(N) /
 *  ui_drawer_close(N) (or close_all with no argument) — the preview
 *  evaluates the same call dynamically. */
function resolveDrawerCall(
  method: string,
  call: ts.CallExpression,
  sourceText: string,
  diagnostics: Diagnostic[],
  kind = "drawer",
): StatementIR {
  const sourceSpan = makeSourceSpan(call, call.getSourceFile()?.fileName ?? "", sourceText);
  if (method !== "open" && method !== "close") {
    diagnostics.push(makeDiagnostic(
      sourceText, call.pos,
      `ui.${kind}.${method} is not supported — use open(id) or close(id?).`,
      "error", "UI_DRAWER_METHOD",
    ));
    return { kind: "block", sourceSpan, body: [] };
  }
  const arg = call.arguments[0];
  const emit = (stmt: string): StatementIR => ({
    kind: "call",
    callee: "__EMIT__",
    args: [{ kind: "string", value: stmt }],
    sourceSpan,
  });
  // close() with no id closes every open drawer.
  if (method === "close" && arg === undefined) return emit("ui_drawer_close_all();");
  let idText: string | undefined;
  if (arg && ts.isStringLiteral(arg)) idText = arg.text;
  if (idText === undefined) {
    diagnostics.push(makeDiagnostic(
      sourceText, call.pos,
      `ui.${kind}.${method} needs an id string literal (e.g. ui.${kind}.open('settings')).`,
      "error", "UI_DRAWER_ID",
    ));
    return { kind: "block", sourceSpan, body: [] };
  }
  const nodeIdx = resolveElementValue("screen", idText);
  if (nodeIdx === undefined) {
    diagnostics.push(makeDiagnostic(
      sourceText, call.pos,
      `ui.${kind}.${method}('${idText}'): no <${kind} id="${idText}"> in the mounted UI tree.`,
      "error", "UI_DRAWER_UNKNOWN_ID",
    ));
    return { kind: "block", sourceSpan, body: [] };
  }
  return emit(method === "open"
    ? `ui_drawer_open(${nodeIdx});`
    : `ui_drawer_close(${nodeIdx});`);
}

/** Resolve ui.window.setTitle / ui.window.setIcon. Native SDL only; on hardware
 *  these are silent no-ops (a desktop-only convenience, not an error). */
function resolveWindowCall(
  method: string,
  call: ts.CallExpression,
  sourceText: string,
  diagnostics: Diagnostic[],
): StatementIR {
  const fileName = call.getSourceFile()?.fileName ?? "";
  const isSDL: boolean = (() => { try { return getDisplayProfile().driver === "sdl"; } catch { return false; } })();
  const sourceSpan = makeSourceSpan(call, fileName, sourceText);

  if (method === "setTitle") {
    if (!isSDL) return { kind: "block", sourceSpan, body: [] };
    const arg = call.arguments[0];
    if (!arg) return { kind: "block", sourceSpan, body: [] };

    // String literal: pass directly as a const char*.
    if (ts.isStringLiteral(arg)) {
      const escaped = escapeCppStringLiteral(arg.text);
      return {
        kind: "call",
        callee: "__EMIT__",
        args: [{ kind: "string", value: `ui_window_set_title("${escaped}");` }],
        sourceSpan,
      };
    }

    // Template literal with interpolations: build a snprintf into a local buffer
    // (same format-building logic as lowerTextBindingBody Shape 3), then pass
    // the buffer to ui_window_set_title. Handles `taps: ${count}` correctly.
    if (ts.isTemplateExpression(arg)) {
      const fmtBuf: string[] = [escapeSnprintfFormatFragment(arg.head.text)];
      const snprintfArgs: string[] = [];
      for (const span of arg.templateSpans) {
        fmtBuf.push(numericFormat(span.expression));
        snprintfArgs.push(lowerInterpolationArg(span.expression, sourceText, diagnostics));
        fmtBuf.push(escapeSnprintfFormatFragment(span.literal.text));
      }
      const fmt = fmtBuf.join("");
      const argList = snprintfArgs.length ? ", " + snprintfArgs.join(", ") : "";
      return {
        kind: "call",
        callee: "__EMIT__",
        args: [{ kind: "string", value: `{ char __title[128]; snprintf(__title, sizeof(__title), "${fmt}"${argList}); ui_window_set_title(__title); }` }],
        sourceSpan,
      };
    }

    // Any other expression (signal read, concatenation, etc): render it and
    // pass as a const char* if it's string-compatible. Signal reads like
    // count() lower to the variable name; string signals work directly.
    const argText = renderExprAsText(expressionToIR(arg, sourceText, diagnostics));
    return {
      kind: "call",
      callee: "__EMIT__",
      args: [{ kind: "string", value: `ui_window_set_title(${argText});` }],
      sourceSpan,
    };
  }

  if (method === "setIcon") {
    // Runtime icon changes need SDL_image. For v1, recommend the config option.
    if (isSDL) {
      diagnostics.push({
        severity: "warning",
        code: "ui-window-seticon-runtime",
        message: `ui.window.setIcon at runtime requires SDL_image, which isn't bundled. Use the display.icon config option for the launch icon (loaded once via core SDL2 SDL_LoadBMP).`,
      } as Diagnostic);
    }
    return { kind: "block", sourceSpan, body: [] };
  }

  // Unknown ui.window.* method — silent no-op (forward-compatible).
  return { kind: "block", sourceSpan, body: [] };
}

// ── Argument extraction ─────────────────────────────────────────────────────

/** Read display wiring overrides from an optional ui.mount options object literal. */
function extractMountOptions(
  optsExpr: ts.Expression | undefined,
  diagnostics: Diagnostic[],
): Partial<MountRequest> | null {
  if (!optsExpr) {
    return {};
  }
  if (!ts.isObjectLiteralExpression(optsExpr)) {
    diagnostics.push({
      severity: "error",
      code: "ui-mount-opts",
      message: "ui.mount expects an optional options object, e.g. ui.mount(screen) or ui.mount(screen, { display, bus, cs, dc, rst, rotation, backlight, spiFrequency, address, reset })",
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
/** Push a `ui-unknown-element` error diagnostic. Used by every author-facing
 *  binding/method call site when resolveNodeIndex returns -1, so a typo'd
 *  element id fails the build instead of silently re-targeting node 0.
 *  Exported so call-statement.ts and canvas-lowering.ts can share the exact
 *  same diagnostic shape across all element-binding entry points. */
export function pushUnknownElementDiagnostic(
  diagnostics: Diagnostic[],
  callLabel: string,
  id: string,
  treeName: string,
): void {
  diagnostics.push({
    severity: "error",
    code: "ui-unknown-element",
    message: `${callLabel}: element "${id}" not found in screen "${treeName}"`,
    hint: `Check the id attribute in your .ui.html file. Screen "${treeName}" does not contain an element with id "${id}".`,
  } as Diagnostic);
}

export function tryResolveUICall(
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  options: UICallOptions = {},
): StatementIR | null {
  // ui.window.<method>(...) — two-level property access (ui.window.setTitle).
  // isUICall only matches ui.<method> (one level), so detect this shape first.
  const windowCall = matchUIWindowCall(call);
  if (windowCall) return resolveWindowCall(windowCall, call, sourceText, diagnostics);

  // ui.drawer.open('id') / ui.drawer.close('id'|) — also a two-level chain.
  const drawerCall = matchUIDrawerCall(call);
  if (drawerCall) return resolveDrawerCall(drawerCall, call, sourceText, diagnostics);
  const dialogCall = matchUIDialogCall(call);
  if (dialogCall) return resolveDrawerCall(dialogCall, call, sourceText, diagnostics, "dialog");
  if (matchUIToastCall(call)) {
    // ui.toast('<id>') — show a <toast>; the duration attribute drives the
    // auto-close. Same open lowering as a drawer.
    const sourceSpan = makeSourceSpan(call, call.getSourceFile()?.fileName ?? "", sourceText);
    const arg = call.arguments[0];
    let idText: string | undefined;
    if (arg && ts.isStringLiteral(arg)) idText = arg.text;
    if (idText === undefined) {
      diagnostics.push(makeDiagnostic(
        sourceText, call.pos,
        "ui.toast needs a toast id string literal (e.g. ui.toast('saved')).",
        "error", "UI_TOAST_ID",
      ));
      return { kind: "block", sourceSpan, body: [] };
    }
    const nodeIdx = resolveElementValue("screen", idText);
    if (nodeIdx === undefined) {
      diagnostics.push(makeDiagnostic(
        sourceText, call.pos,
        `ui.toast('${idText}'): no <toast id="${idText}"> in the mounted UI tree.`,
        "error", "UI_TOAST_UNKNOWN_ID",
      ));
      return { kind: "block", sourceSpan, body: [] };
    }
    return {
      kind: "call",
      sourceSpan,
      callee: "__EMIT__",
      args: [{ kind: "string", value: `ui_drawer_open(${nodeIdx});` }],
    };
  }

  if (!isUICall(call)) return null;

  const method = call.expression.name.text;

  if (method === "mount") {
    return resolveMountCall(call, fileName, sourceText, diagnostics);
  }
  if (method === "signal") {
    return resolveSignalCall(call, fileName, sourceText, diagnostics, options);
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
  if (!opts) {
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
  const viewport = effectiveDisplaySize(profile);

  const req: MountRequest = {
    display: opts.display !== undefined ? String(opts.display) : profile.driver,
    bus: opts.bus !== undefined ? String(opts.bus) : profile._mountBus,
    cs: opts.cs !== undefined ? Number(opts.cs) : profile._mountCs,
    dc: opts.dc !== undefined ? Number(opts.dc) : profile._mountDc,
    rst: opts.rst !== undefined ? Number(opts.rst) : profile._mountRst,
    rotation: opts.rotation !== undefined ? Number(opts.rotation) : profile.rotation,
    backlight: opts.backlight !== undefined ? Number(opts.backlight) : profile.backlight,
    spiFrequency: opts.spiFrequency !== undefined ? Number(opts.spiFrequency) : profile.spiFrequency,
    address: opts.address !== undefined ? Number(opts.address) : profile._mountAddress,
    reset: opts.reset !== undefined ? Number(opts.reset) : profile._mountReset,
  };

  // SPI-bus displays (ILI9341, ST7796, etc.) need bus/cs/dc/rst wiring. Host
  // render targets (sdl, native-preview) have no SPI pins. I2C displays
  // (ssd1309) need address/reset instead of SPI pins.
  const isI2C = req.bus === "I2C" || req.bus === "i2c";
  const spiDisplay = !isI2C && req.display !== "sdl" && req.display !== "native-preview";
  if (spiDisplay && (req.bus === undefined || req.cs === undefined ||
      req.dc === undefined || req.rst === undefined)) {
    return null;
  }

  // Final layout + lower using the mount's viewport. Source the colorFormat
  // from the resolved display profile (authoritative — set from config), not
  // strategy.colorFormat() (capability-level, may default to rgb565 before the
  // profile is wired into the strategy). This ensures node colors lower at the
  // target's true depth (rgb888 for SDL → full 888, no 565 quantization).
  const ui = requireUIHook();
  const lowered = ui.lowerOnMount(htmlPath, {
    colorFormat: profile.colorFormat,
    storage: strategy.graphicsCapacity().nodeStorage,
    viewport,
  });

  const displayInitOp = resolveMount(req, strategy, viewport);

  // Mark the entry file as having a UI → gates runtime header + table injection.
  ui.markEntryHasUI();

  return halOpsToIR([displayInitOp], call, fileName, sourceText);
}

function resolveSignalCall(
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
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
  } else {
    // Unsupported initializer (object, array, null, identifier, template
    // literal, ...). The @typecad/ui package's Signal<T extends SignalValue>
    // constraint should catch most of these at editor time; this diagnostic
    // is the build-time defense for anything that slips past the type system.
    // Default to int=0 and continue (signals are often transient state).
    diagnostics.push({
      severity: "warning",
      code: "ui-signal-initializer",
      message: `ui.signal: unsupported initial value "${valueArg.getText()}". Only number, string, and boolean literals are supported; defaulting to 0 (int).`,
      hint: 'Use a literal: ui.signal(0), ui.signal("label"), or ui.signal(true).',
    } as Diagnostic);
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

/** Format specifier for a single signal/numeric interpolation per spec §5.3.
 *  Prefer signal types; otherwise consult IrTypeScope globals + activeFunctionReturnTypes
 *  via inferExprCppType for named free-function results (e.g. Math.floor → %g). */
function bindingTypeMaps(): {
  functionReturnTypes: Map<string, CppTypeHint>;
  localVariableTypes: Map<string, CppTypeHint>;
} {
  const scope = getCurrentIrTypeScope();
  const localVariableTypes = new Map<string, CppTypeHint>();
  if (scope) {
    for (const [k, v] of scope.globals) localVariableTypes.set(k, v as CppTypeHint);
  }
  const functionReturnTypes = new Map<string, CppTypeHint>(
    [...(getContext().activeFunctionReturnTypes ?? new Map())] as Array<[string, CppTypeHint]>,
  );
  return { functionReturnTypes, localVariableTypes };
}

function numericFormat(expr: ts.Expression): string {
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) &&
      expr.arguments.length === 0 && isSignalName(expr.expression.text)) {
    const t = signalCppType(expr.expression.text);
    if (t === "float" || t === "double") return "%g";
    if (t === "const char*" || t === "String" || t === "char*") return "%s";
    return "%d";
  }
  const { functionReturnTypes, localVariableTypes } = bindingTypeMaps();
  const inferred = inferExprCppType(expr, functionReturnTypes, localVariableTypes, "");
  if (inferred === "float" || inferred === "double") return "%g";
  if (inferred === "const char*" || inferred === "char*" || inferred === "std::string" || inferred === "__tc_str_ptr") return "%s";
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

  // Shape 1: String(<signal or numeric expr>) — the format specifier comes
  // from the signal's recorded C++ type (%d for int/bool, %g for float/double,
  // %s for const char*/String); anything else defaults to %d.
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

  // Shape 3: template literal with signal/numeric interpolations.
  // Build the format string by alternating literal fragments and %specifiers,
  // and collect the matching argument expressions in order. Each interpolation's
  // specifier comes from the signal's C++ type (%d/%g/%s); compound expressions
  // default to %d. The literal fragments become part of the snprintf *format*
  // string, so any embedded `%` must be doubled (escapeSnprintfFormatFragment)
  // — otherwise a body like `meter: ${v}%` produces a malformed format string.
  if (ts.isTemplateExpression(body)) {
    const fmtBuf: string[] = [escapeSnprintfFormatFragment(body.head.text)];
    const args: string[] = [];
    for (const span of body.templateSpans) {
      fmtBuf.push(numericFormat(span.expression));
      args.push(lowerInterpolationArg(span.expression, sourceText, diagnostics));
      fmtBuf.push(escapeSnprintfFormatFragment(span.literal.text));
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

  // Shape 5 fallback: snprintf a scalar/string expression via the main IR
  // path (covers `x + "°C"`, helper calls, `.toFixed()`, bare identifiers,
  // etc.). Reject containers/objects — those can't snprintf meaningfully.
  if (
    ts.isArrayLiteralExpression(unwrapped) ||
    ts.isObjectLiteralExpression(unwrapped) ||
    ts.isNewExpression(unwrapped) ||
    ts.isClassExpression(unwrapped)
  ) {
    return warn();
  }
  const fmt = numericFormat(body);
  const argText = lowerInterpolationArg(body, sourceText, diagnostics);
  if (argText && argText !== "0 /* unsupported_expr */" && !argText.trimStart().startsWith("{")) {
    return { cppBody: `snprintf(buf, size, "${fmt}", ${argText});` };
  }

  return warn();
}

/**
 * Lower a `{expr}` interpolation text string to an imperative snprintf body
 * that writes into `buf`/`size`. Mirrors `lowerTextBindingBody` Shape 3 but
 * operates on a raw string (from HTML markup) rather than a TS AST node.
 *
 * Each `{...}` span becomes a `%d` argument (v1: numeric default — the dominant
 * use case is counters/progress; string-signal interpolation should use the
 * `ui.bind` path which has TS type information). Literal `%` in surrounding text
 * is escaped to `%%` so snprintf doesn't misread it.
 *
 *   "taps: {count}"          → 'snprintf(buf, size, "taps: %d", count);'
 *   "a:{x} b:{y}"            → 'snprintf(buf, size, "a:%d b:%d", x, y);'
 *   "{n}% done"              → 'snprintf(buf, size, "%d%% done", n);'
 *
 * Empty braces `{}` are treated as literal text (not interpolation). Returns
 * null if no interpolation is present (caller keeps the static text).
 */
export function lowerInterpolationText(raw: string): string | null {
  // Scan for non-empty {expr} spans. Track brace depth so `{a + {b}}` (malformed)
  // is handled conservatively: only top-level `{...}` with no nested braces is
  // treated as an interpolation.
  const fmtBuf: string[] = [];
  const args: string[] = [];
  let i = 0;
  let hasInterp = false;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "{") {
      // Find the matching close brace at the same depth.
      let depth = 1;
      let j = i + 1;
      while (j < raw.length && depth > 0) {
        if (raw[j] === "{") depth++;
        else if (raw[j] === "}") depth--;
        if (depth === 0) break;
        j++;
      }
      const content = raw.slice(i + 1, j);
      // Only non-empty, non-nested braces count as an interpolation.
      if (depth === 0 && content.length > 0 && !content.includes("{")) {
        hasInterp = true;
        args.push(content.trim());
        fmtBuf.push("%d");
        i = j + 1;
        continue;
      }
      // Else: literal '{' (empty {} or nested). Emit it verbatim.
    }
    // Literal character — escape % for snprintf format-string safety.
    fmtBuf.push(ch === "%" ? "%%" : escapeCppStringLiteral(ch));
    i++;
  }
  if (!hasInterp) return null;
  const fmt = fmtBuf.join("");
  const argList = args.length ? ", " + args.join(", ") : "";
  return `snprintf(buf, size, "${fmt}"${argList});`;
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

/** Extract the compute expression from a bind count/bindFn argument:
 *  arrow/fn-expr with expression body → that expr
 *  arrow/fn-expr with block → last return's expression
 *  identifier → top-level FunctionDeclaration last return or const-arrow body
 *  else diagnose and return undefined. */
function extractBindComputeExpr(
  arg: ts.Expression,
  diagnostics: Diagnostic[],
  label: string,
): ts.Expression | undefined {
  const lastReturnExpr = (body: ts.Block): ts.Expression | undefined => {
    for (let i = body.statements.length - 1; i >= 0; i--) {
      const s = body.statements[i];
      if (ts.isReturnStatement(s) && s.expression) return s.expression;
    }
    return undefined;
  };

  if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
    if (ts.isBlock(arg.body)) {
      const expr = lastReturnExpr(arg.body);
      if (!expr) {
        diagnostics.push({
          severity: "error",
          code: "ui-bind-unlowered",
          message: `${label}: block callback must end with a return expression.`,
        } as Diagnostic);
      }
      return expr;
    }
    return arg.body;
  }

  if (ts.isIdentifier(arg)) {
    const name = arg.text;
    const sf = arg.getSourceFile();
    for (const stmt of sf.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name && stmt.body) {
        const expr = lastReturnExpr(stmt.body);
        if (!expr) {
          diagnostics.push({
            severity: "error",
            code: "ui-bind-unlowered",
            message: `${label}: function '${name}' must end with a return expression.`,
          } as Diagnostic);
        }
        return expr;
      }
      if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) {
          if (
            ts.isIdentifier(d.name) &&
            d.name.text === name &&
            d.initializer &&
            (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
          ) {
            const fn = d.initializer;
            if (ts.isBlock(fn.body)) {
              const expr = lastReturnExpr(fn.body);
              if (!expr) {
                diagnostics.push({
                  severity: "error",
                  code: "ui-bind-unlowered",
                  message: `${label}: '${name}' must end with a return expression.`,
                } as Diagnostic);
              }
              return expr;
            }
            return fn.body;
          }
        }
      }
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
    code: "ui-bind-unlowered",
    message: `${label}: expected an inline arrow/function or a top-level function name.`,
  } as Diagnostic);
  return undefined;
}

/** Rename a param only inside snprintf args AFTER the format string's closing `")`
 *  so format fragments like `"%d"` are never corrupted. */
function renameParamInSnprintfArgs(cppBody: string, from: string, to: string): string {
  if (from === to) return cppBody;
  const closeFmt = cppBody.indexOf('")');
  if (closeFmt < 0) {
    return cppBody.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  }
  const head = cppBody.slice(0, closeFmt + 2);
  const tail = cppBody.slice(closeFmt + 2).replace(new RegExp(`\\b${from}\\b`, "g"), to);
  return head + tail;
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
    const treeName = nodeArg.expression.text;
    const htmlPath = resolveUIModuleImport(treeName);
    if (htmlPath) {
      const resolved = resolveNodeIndex(htmlPath, nodeArg.name.text);
      if (resolved < 0) {
        pushUnknownElementDiagnostic(diagnostics, "ui.bind", nodeArg.name.text, treeName);
        return null;
      }
      nodeIndex = resolved;
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
  let bodyIR: import("../../api/shared/ir-core.js").ExpressionIR | undefined;

  const body = extractBindComputeExpr(fnArg, diagnostics, "ui.bind");
  if (!body) {
    // diagnose already emitted; still record a stub so the table stays well-formed
    if (property === "text") cppBody = "buf[0] = 0;";
  } else if (property === "text") {
    cppBody = lowerTextBindingBody(body, fileName, sourceText, diagnostics).cppBody;
  } else {
    const ir = expressionToIR(body, sourceText, diagnostics);
    bodyIR = resolveColorIR(ir);
    cppExpr = resolveColorLiterals(renderExprAsText(ir));
  }
  recordBinding({ nodeIndex, property, fnName, cppExpr, cppBody, bodyIR });

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
  diagnostics: Diagnostic[],
): StatementIR | null {
  if (call.arguments.length < 3) return null;
  const nodeArg = call.arguments[0];
  const countArg = call.arguments[1];
  const itemArg = call.arguments[2];

  // Resolve the <list> node index.
  let nodeIndex = 0;
  if (ts.isPropertyAccessExpression(nodeArg) && ts.isIdentifier(nodeArg.expression)) {
    const treeName = nodeArg.expression.text;
    const htmlPath = resolveUIModuleImport(treeName);
    if (htmlPath) {
      const resolved = resolveNodeIndex(htmlPath, nodeArg.name.text);
      if (resolved < 0) {
        pushUnknownElementDiagnostic(diagnostics, "ui.bindList", nodeArg.name.text, treeName);
        return null;
      }
      nodeIndex = resolved;
    }
  }

  // Lower the count function via extractBindComputeExpr → return StatementIR.
  let countBody = "return 0;";
  let countStatements: StatementIR[] | undefined;
  let countSourceSpan: SourceSpan | undefined;
  if (countArg) {
    countSourceSpan = makeSourceSpan(countArg, fileName, sourceText);
    const countExpr = extractBindComputeExpr(countArg, diagnostics, "ui.bindList countFn");
    if (countExpr) {
      const exprIR = expressionToIR(countExpr, sourceText, diagnostics);
      countStatements = [{
        kind: "return",
        sourceSpan: makeSourceSpan(countExpr, fileName, sourceText),
        value: exprIR,
      }];
      countBody = `return ${renderExprAsText(exprIR)};`;
    }
  }

  // Lower the item function.
  let itemBody = "buf[0] = 0;";
  let itemStatements: StatementIR[] | undefined;
  let itemSourceSpan: SourceSpan | undefined;
  if (itemArg) {
    itemSourceSpan = makeSourceSpan(itemArg, fileName, sourceText);
    if (ts.isArrowFunction(itemArg) || ts.isFunctionExpression(itemArg)) {
      const paramName =
        itemArg.parameters.length > 0 && ts.isIdentifier(itemArg.parameters[0].name)
          ? itemArg.parameters[0].name.text
          : "";
      const body = itemArg.body;
      if (ts.isExpression(body)) {
        const { cppBody } = lowerTextBindingBody(body, fileName, sourceText, diagnostics);
        itemBody = renameParamInSnprintfArgs(cppBody || "buf[0] = 0;", paramName, "idx");
        itemStatements = [{
          kind: "call",
          sourceSpan: makeSourceSpan(body, fileName, sourceText),
          callee: "__EMIT__",
          args: [{ kind: "string", value: itemBody.replace(/;$/, "") }],
        }];
      } else {
        let stmts = lowerCallbackStatements(itemArg, fileName, sourceText, diagnostics, "ui-event-callback");
        if (paramName && paramName !== "idx") {
          stmts = renameIdentifiersInStatements(stmts, paramName, "idx");
        }
        itemStatements = stmts;
        itemBody = renderStatementsCompact(stmts) || "buf[0] = 0;";
      }
    } else {
      // Named ref / other — treat as text-binding expression extractor.
      const body = extractBindComputeExpr(itemArg, diagnostics, "ui.bindList itemFn");
      if (body) {
        const { cppBody } = lowerTextBindingBody(body, fileName, sourceText, diagnostics);
        itemBody = cppBody || "buf[0] = 0;";
        itemStatements = [{
          kind: "call",
          sourceSpan: makeSourceSpan(body, fileName, sourceText),
          callee: "__EMIT__",
          args: [{ kind: "string", value: itemBody.replace(/;$/, "") }],
        }];
      }
    }
  }

  const countFnName = `__ui_list_count_${getListBindingsCount()}`;
  const itemFnName = `__ui_list_item_${getListBindingsCount()}`;
  const tapFnName = `__ui_list_tap_${getListBindingsCount()}`;

  // Optional 4th arg: onTap callback (index) => { ... }
  let tapFnBody: string | null = null;
  let tapStatements: StatementIR[] | undefined;
  let tapSourceSpan: SourceSpan | undefined;
  if (call.arguments.length >= 4) {
    const tapArg = call.arguments[3];
    tapSourceSpan = makeSourceSpan(tapArg, fileName, sourceText);
    const lowered = lowerNamedOrInlineCallback(
      tapArg, fileName, sourceText, diagnostics, "ui.bindList tap", "ui-event-callback",
    );
    if (lowered) {
      let stmts = lowered.statements;
      const paramName = lowered.paramNames[0];
      if (paramName && paramName !== "idx") {
        stmts = renameIdentifiersInStatements(stmts, paramName, "idx");
      }
      tapStatements = stmts;
      tapFnBody = renderStatementsCompact(stmts) || null;
    }
  }

  recordListBinding({
    nodeIndex,
    countFnName,
    itemFnName,
    tapFnName: tapStatements || tapFnBody ? tapFnName : null,
    countFnBody: countBody,
    itemFnBody: itemBody,
    tapFnBody,
    countStatements,
    itemStatements,
    tapStatements,
    countSourceSpan,
    itemSourceSpan,
    tapSourceSpan,
  });

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
    const treeName = nodeArg.expression.text;
    const htmlPath = resolveUIModuleImport(treeName);
    if (htmlPath) {
      const resolved = resolveNodeIndex(htmlPath, nodeArg.name.text);
      if (resolved < 0) {
        pushUnknownElementDiagnostic(diagnostics, "ui.bindInput", nodeArg.name.text, treeName);
        return null;
      }
      nodeIndex = resolved;
    }
  }

  const cbFnName = `__ui_input_cb_${getInputBindingsCount()}`;

  const lowered = lowerNamedOrInlineCallback(
    cbArg, fileName, sourceText, diagnostics, "ui.bindInput", "ui-event-callback",
  );
  let bodyStatements: StatementIR[] | undefined;
  let cbFnBody = "";
  if (lowered) {
    bodyStatements = lowered.statements;
    const paramName = lowered.paramNames[0];
    if (paramName && paramName !== "text") {
      bodyStatements = renameIdentifiersInStatements(bodyStatements, paramName, "text");
    }
    cbFnBody = renderStatementsCompact(bodyStatements);
  }

  recordInputBinding({
    nodeIndex,
    cbFnName,
    cbFnBody,
    bodyStatements,
    sourceSpan: makeSourceSpan(cbArg, fileName, sourceText),
  });

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

  let bodyStatements: StatementIR[] | undefined;
  const resolved = resolveCallbackArg(cbArg, cbArg?.getSourceFile(), diagnostics, "ui.watchPin");
  if (resolved?.kind === "inline") {
    bodyStatements = lowerCallbackStatements(resolved.fn, fileName, sourceText, diagnostics, "ui-event-callback");
  } else if (resolved?.kind === "named") {
    bodyStatements = [{
      kind: "call",
      sourceSpan: makeSourceSpan(cbArg!, fileName, sourceText),
      callee: resolved.name,
      args: [],
    }];
  }

  const fnName = `__ui_watchpin_${_watchPinSpecs.length}`;
  recordWatchPin({
    pin: String(pin),
    fnName,
    callbackBody: "",
    bodyStatements,
    sourceSpan: cbArg ? makeSourceSpan(cbArg, fileName, sourceText) : undefined,
  });

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
      if (nodeIndex < 0) {
        // Tree resolved but the element id wasn't found in it. Hard error —
        // silently falling back to "any tap" would hide a typo and change
        // the program's behavior (a per-element awaiter would resume on the
        // wrong tap).
        pushUnknownElementDiagnostic(diagnostics, "ui.onTap", id, treeName);
        return null;
      }
      return {
        kind: "call",
        sourceSpan: makeSourceSpan(call, fileName, sourceText),
        callee: "__UI_TAP__",
        args: [{ kind: "number", value: nodeIndex }],
        isAwaited: true,
      };
    }
    // Unknown tree (not a recognized UI import) — fall through to the global
    // form, with a warning. This is a different failure mode than a typo'd
    // element id: the receiver isn't a UI tree at all.
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

/** Look up a node's index in its tree by element id (pre-order DFS order).
 *  Returns the node index, or `-1` if the id is not found (or the module
 *  isn't loaded). Callers must check for `-1` and emit a `ui-unknown-element`
 *  diagnostic — silently treating `-1` as a valid index would target node 0
 *  (the screen root), which is the silent-miscompilation failure mode this
 *  guard exists to prevent. */
export function resolveNodeIndex(htmlPath: string, id: string, screenId?: string): number {
  // Node indices follow pre-order DFS of the styled tree. The lowered tables
  // share this order, so we walk the registry's styled tree to find the id.
  // When screenId is given (grouped handle screen.groups.<screenId>.<id>),
  // search only within that screen root.
  const mod = requireUIHook().getUIModule(htmlPath);
  if (!mod) return -1;
  let idx = 0;
  let found = -1;
  const walk = (n: StyledNode): boolean => {
    // TS handle name: prefer `ref`, fall back to `id` (backward-compatible).
    if ((n.ref ?? n.id) === id) { found = idx; return true; }
    idx++;
    for (const c of n.children) { if (walk(c)) return true; }
    return false;
  };
  const allRoots: StyledNode[] = mod.allStyledScreens.length > 0 ? mod.allStyledScreens as StyledNode[] : [mod.styled as StyledNode];
  const roots = screenId ? allRoots.filter(r => r.id === screenId) : allRoots;
  for (const root of roots) {
    if (walk(root)) break;
  }
  return found;
}

/** Look up a node's HTML tag by element id (pre-order DFS order).
 *  Used to route generic callbacks (e.g. onChange) to the right lowering path
 *  based on element kind (range vs input). Returns "" if not found. */
export function resolveNodeTag(htmlPath: string, id: string, screenId?: string): string {
  const mod = requireUIHook().getUIModule(htmlPath);
  if (!mod) return "";
  let idx = 0;
  let foundTag = "";
  const walk = (n: StyledNode): boolean => {
    if ((n.ref ?? n.id) === id) { foundTag = n.tag; return true; }
    idx++;
    for (const c of n.children) { if (walk(c)) return true; }
    return false;
  };
  const allRoots: StyledNode[] = mod.allStyledScreens.length > 0 ? mod.allStyledScreens as StyledNode[] : [mod.styled as StyledNode];
  const roots = screenId ? allRoots.filter(r => r.id === screenId) : allRoots;
  for (const root of roots) {
    if (walk(root)) break;
  }
  return foundTag;
}
