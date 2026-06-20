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
import { Diagnostic } from "../../types";
import { StatementIR, HALOpIR } from "../../api";
import { makeSourceSpan } from "../ast-node-utils";
import { emitLinesToIR, halOpsToIR } from "./hal-emit-helpers";
import { resolveMount, MountRequest } from "./ui-mount";
import { emitSignalDecl, BindingSpec } from "./ui-reactive";
import { lowerOnMount, markEntryHasUI, getUIModule } from "../../ui/ui-registry";
import type { StyledNode } from "../../ui/style-resolver";
import { getContext } from "../build-ir-state";

// ── Pure-helper state ───────────────────────────────────────────────────────

/** Maps an imported UI tree name (e.g. "screen") → its resolved .ui.html path. */
const uiModuleImports = new Map<string, string>();

/** Recorded signals: name → { cppType, initialValue, decl, emitted }. */
const signals = new Map<string, { cppType: string; initialValue: number | string | boolean; decl: string; emitted: boolean }>();

/** Recorded binding specs, accumulated for emit-time table generation. */
const bindings: BindingSpec[] = [];

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
  // Unknown ui.* method — let it fall through (will likely emit a diagnostic
  // downstream, but we don't claim it).
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

  // ILI9341 default viewport; opts may carry width/height overrides (future).
  const viewport = { width: 240, height: 320 };

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
  recordBinding({ nodeIndex, property, fnName });

  return {
    kind: "block",
    sourceSpan: makeSourceSpan(call, fileName, sourceText),
    body: [],
  };
}

/** Look up a node's index in its tree by element id (pre-order DFS order). */
function resolveNodeIndex(htmlPath: string, id: string): number {
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
