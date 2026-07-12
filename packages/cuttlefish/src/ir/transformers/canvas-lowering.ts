// ---------------------------------------------------------------------------
// Canvas callback lowering: rewrite `ctx.method(args)` calls inside a
// ui.drawCanvas(node, (ctx) => {...}) body into ui_display_* shim calls.
//
// `ctx` is a compile-time fiction — at runtime the callback draws into the
// node's offscreen CuttlefishCanvas16 set as the active __ui_gfx target, so the
// lowered body uses the SAME ui_display_* wrappers every other draw path uses.
// Colors resolve to RGB565 via the existing resolver; ctx.width/ctx.height map
// to __ui_canvas_w / __ui_canvas_h locals set by the emitted wrapper.
//
// Block-body callbacks lower through lowerCallbackStatements (main
// statement-to-IR pipeline, same as setInterval / onClick), with an ambient
// canvas ctx so callToStatement / expressionToIR rewrite ctx.* forms. The
// resulting StatementIR[] is stored on DrawCanvasSpec and rendered at emit.
// ---------------------------------------------------------------------------

import ts from "typescript";
import { Diagnostic, type SourceSpan } from "../../types.js";
import { expressionToIR } from "../expression-to-ir.js";
import { renderExprAsText } from "../render-expr.js";
import { requireUIHook } from "../../ui-hook.js";
import { getDisplayProfile } from "../../stores/display-profile-store.js";
import {
  resolveColorIR,
  lowerCallbackStatements,
  renderStatementsCompact,
} from "./ui-callback-lowering.js";
import type { StatementIR } from "../../api/shared/ir-core.js";
import { makeSourceSpan } from "../ast-node-utils.js";
import { resolveNodeIndex, resolveUIModuleImport, pushUnknownElementDiagnostic } from "./ui-call-resolver.js";

/** One user draw callback: the node it targets + IR body (preferred) or
 *  lowered C++ body string (fallback / tests). */
export interface DrawCanvasSpec {
  nodeIndex: number;
  fnName: string;       // e.g. "__ui_canvas_draw_0"
  /** @deprecated Prefer bodyStatements; kept for compact-string fallbacks. */
  callbackBody: string;
  /** Statement IR produced by lowerCallbackStatements (main pipeline). */
  bodyStatements?: StatementIR[];
  /** Source span of the original (ctx) => {...} callback, when known. */
  sourceSpan?: SourceSpan;
}

const _canvasBindings: DrawCanvasSpec[] = [];

export function resetCanvasBindings(): void {
  _canvasBindings.length = 0;
}

export function canvasBindings(): DrawCanvasSpec[] {
  return _canvasBindings;
}

export function recordCanvasBinding(spec: DrawCanvasSpec): void {
  _canvasBindings.push(spec);
}

export function getCanvasBindingsCount(): number {
  return _canvasBindings.length;
}

/** True if `text` is a quoted CSS color string. */
function isColorLiteral(text: string): boolean {
  const t = text.trim();
  return /^["'](#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})|[a-z]+|rgba?\([^)]*\))["']$/i.test(t);
}

/** Lower a CSS color string to the target's internal color literal, or null if not a color. */
function tryColor(text: string): number | null {
  if (!isColorLiteral(text)) return null;
  const color = text.trim().replace(/^["']|["']$/g, "");
  try {
    return requireUIHook().resolveColorInternal(color, getDisplayProfile().colorFormat);
  } catch {
    return null;
  }
}

/** Substitute ctx.width/ctx.height references (bare or embedded in a
 *  compound expression, e.g. `ctx.height - 4`) with the wrapper's locals. */
function substituteCanvasDims(raw: string, ctxName: string): string {
  return raw
    .replace(new RegExp(`\\b${ctxName}\\.width\\b`, "g"), "__ui_canvas_w")
    .replace(new RegExp(`\\b${ctxName}\\.height\\b`, "g"), "__ui_canvas_h");
}

/** Lower one argument expression to its C++ text. Color strings → rgb565 hex. */
function lowerArg(arg: ts.Expression, ctxName: string, sourceText: string, diagnostics: Diagnostic[]): string {
  if (
    ts.isPropertyAccessExpression(arg) &&
    ts.isIdentifier(arg.expression) &&
    arg.expression.text === ctxName &&
    (arg.name.text === "width" || arg.name.text === "height")
  ) {
    return arg.name.text === "width" ? "__ui_canvas_w" : "__ui_canvas_h";
  }
  let raw = renderExprAsText(expressionToIR(arg, sourceText, diagnostics));
  raw = substituteCanvasDims(raw, ctxName);
  const color = tryColor(raw);
  if (color !== null) raw = `0x${color.toString(16)}`;
  return raw;
}

/** Lower an argument known (by its position) to be a color. Resolves color
 *  string literals at the IR level (via resolveColorIR) BEFORE rendering, so
 *  ternaries like `temp() > 25 ? '#a33' : '#33a'` resolve both branches. */
function lowerColorArg(arg: ts.Expression, ctxName: string, sourceText: string, diagnostics: Diagnostic[]): string {
  const ir = resolveColorIR(expressionToIR(arg, sourceText, diagnostics));
  return substituteCanvasDims(renderExprAsText(ir), ctxName);
}

/** ctx method name → shim callee. */
const CANVAS_METHODS: Record<string, string> = {
  drawPixel: "ui_display_draw_pixel",
  fillRect: "ui_display_fill_rect",
  rect: "ui_display_draw_rect",
  fillRoundRect: "ui_display_fill_round_rect",
  roundRect: "ui_display_draw_round_rect",
  line: "ui_display_draw_line",
  hline: "ui_display_draw_fast_hline",
  vline: "ui_display_draw_fast_vline",
  fillCircle: "ui_display_fill_circle",
  circle: "ui_display_draw_circle",
  rgbBitmap: "ui_display_draw_rgb_bitmap",
};

/** Argument index (0-based) of the color parameter for each ctx method. */
const COLOR_ARG_INDEX: Record<string, number> = {
  drawPixel: 2,
  fillRect: 4,
  rect: 4,
  fillRoundRect: 5,
  roundRect: 5,
  line: 4,
  hline: 3,
  vline: 3,
  fillCircle: 3,
  circle: 3,
};

/**
 * If `call` is a `<ctxName>.method(args)` call we recognize, return the lowered
 * C++ statement(s) (each terminated with `;`). Otherwise return null (and push
 * a diagnostic if it IS a ctx call with an unknown method).
 */
export function rewriteCanvasCall(
  call: ts.CallExpression,
  ctxName: string,
  diagnostics: Diagnostic[],
  sourceText: string = "",
): string | null {
  if (
    !ts.isPropertyAccessExpression(call.expression) ||
    !ts.isIdentifier(call.expression.expression) ||
    call.expression.expression.text !== ctxName
  ) {
    return null;
  }
  const method = call.expression.name.text;
  const args = call.arguments;

  if (method === "text") {
    if (args.length < 3) {
      diagnostics.push({
        severity: "error", code: "ui-canvas-method",
        message: `ctx.text() requires at least 3 arguments (x, y, text); got ${args.length}.`,
        source: sourceText.slice(Math.max(0, call.getStart() - 20), call.getEnd()).trim(),
      } as Diagnostic);
      return null;
    }
    const x = lowerArg(args[0], ctxName, sourceText, diagnostics);
    const y = lowerArg(args[1], ctxName, sourceText, diagnostics);
    const str = renderExprAsText(expressionToIR(args[2], sourceText, diagnostics));
    const colorText = args.length >= 4 ? lowerColorArg(args[3], ctxName, sourceText, diagnostics) : "0xffff";
    return `ui_display_set_cursor(${x}, ${y}); ui_display_set_text_color_solid(${colorText}); ui_display_print(${str});`;
  }

  if (method === "fillScreen") {
    if (args.length < 1) {
      diagnostics.push({
        severity: "error", code: "ui-canvas-method",
        message: `ctx.fillScreen() requires a color argument.`,
        source: sourceText.slice(Math.max(0, call.getStart() - 20), call.getEnd()).trim(),
      } as Diagnostic);
      return null;
    }
    const colorText = lowerColorArg(args[0], ctxName, sourceText, diagnostics);
    return `ui_display_fill_rect(0, 0, __ui_canvas_w, __ui_canvas_h, ${colorText});`;
  }

  const shim = CANVAS_METHODS[method];
  if (!shim) {
    diagnostics.push({
      severity: "error", code: "ui-canvas-method",
      message: `Unknown canvas method ctx.${method}() — supported: drawPixel, fillRect, rect, fillRoundRect, roundRect, line, hline, vline, fillCircle, circle, rgbBitmap, text, fillScreen`,
      source: sourceText.slice(Math.max(0, call.getStart() - 20), call.getEnd()).trim(),
    } as Diagnostic);
    return null;
  }
  const colorIdx = COLOR_ARG_INDEX[method];
  const loweredArgs = args
    .map((a, i) => (i === colorIdx ? lowerColorArg(a, ctxName, sourceText, diagnostics) : lowerArg(a, ctxName, sourceText, diagnostics)))
    .join(", ");
  return `${shim}(${loweredArgs});`;
}

/**
 * Lower an entire ui.drawCanvas callback body through the main statement-to-IR
 * pipeline (ambient canvas ctx rewrites ctx.* during lowering). Returns a
 * compact-rendered C++ string for unit tests / callers that still want text.
 */
export function lowerCanvasBody(
  cbArg: ts.ArrowFunction | ts.FunctionExpression,
  sourceText: string,
  diagnostics: Diagnostic[],
  fileName = "canvas.ts",
): string {
  const statements = lowerCallbackStatements(cbArg, fileName, sourceText, diagnostics, "ui-draw-canvas");
  return renderStatementsCompact(statements);
}

/** Emit the canvas binding table + callback functions.
 *
 * When `emitStatements` is provided, bodyStatements are rendered through it
 * (StatementRenderer path). Otherwise falls back to compact string paste of
 * callbackBody (tests / no-emitter contexts). */
export function emitCanvasBindings(
  specs: DrawCanvasSpec[],
  emitLine?: (line: string, span?: SourceSpan) => void,
  emitStatements?: (statements: StatementIR[], indent: string, span?: SourceSpan) => void,
): string {
  const lines: string[] = [];
  const push = (line: string, span?: SourceSpan) => {
    lines.push(line);
    emitLine?.(line, span);
  };

  if (specs.length === 0) {
    push(`UICanvasBinding __ui_canvas_bindings[] = {};`);
    push(`const uint16_t __ui_canvas_binding_count = 0;`);
    return lines.join("\n");
  }
  for (const spec of specs) {
    push(`void ${spec.fnName}(CuttlefishCanvas16* __c) {`, spec.sourceSpan);
    push(`  int16_t __ui_canvas_w = __c ? display_canvasWidth(__c) : __ui_canvas_fallback_w;`);
    push(`  int16_t __ui_canvas_h = __c ? display_canvasHeight(__c) : __ui_canvas_fallback_h;`);
    if (spec.bodyStatements && emitStatements) {
      emitStatements(spec.bodyStatements, "  ", spec.sourceSpan);
    } else if (spec.bodyStatements) {
      push(`  ${renderStatementsCompact(spec.bodyStatements)}`, spec.sourceSpan);
    } else {
      push(`  ${spec.callbackBody || ""}`, spec.sourceSpan);
    }
    push(`}`);
  }
  push(`UICanvasBinding __ui_canvas_bindings[] = {`);
  for (const spec of specs) {
    push(`  { .node=${spec.nodeIndex}, .fn=${spec.fnName} },`);
  }
  push(`};`);
  push(`const uint16_t __ui_canvas_binding_count = ${specs.length};`);
  return lines.join("\n");
}

/**
 * Resolve a `ui.drawCanvas(node, (ctx) => {...})` call.
 * Records a DrawCanvasSpec with bodyStatements from the main IR pipeline.
 */
export function resolveDrawCanvasCall(
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
): StatementIR | null {
  const nodeArg = call.arguments[0];
  const cbArg = call.arguments[1];
  if (!nodeArg || !ts.isPropertyAccessExpression(nodeArg) || !ts.isIdentifier(nodeArg.expression)) return null;
  if (!cbArg || !(ts.isArrowFunction(cbArg) || ts.isFunctionExpression(cbArg))) return null;

  const treeName = nodeArg.expression.text;
  const id = nodeArg.name.text;
  const htmlPath = resolveUIModuleImport(treeName);
  if (!htmlPath) return null;

  const nodeIndex = resolveNodeIndex(htmlPath, id);
  if (nodeIndex < 0) {
    pushUnknownElementDiagnostic(diagnostics, "ui.drawCanvas", id, treeName);
    return null;
  }
  const bodyStatements = lowerCallbackStatements(cbArg, fileName, sourceText, diagnostics, "ui-draw-canvas");
  const fnName = `__ui_canvas_draw_${getCanvasBindingsCount()}`;
  recordCanvasBinding({
    nodeIndex,
    fnName,
    // Legacy compact string for tests / emitCanvasBindings without emitStatements.
    callbackBody: renderStatementsCompact(bodyStatements),
    bodyStatements,
    sourceSpan: makeSourceSpan(cbArg, fileName, sourceText),
  });

  return {
    kind: "block",
    sourceSpan: makeSourceSpan(call, fileName, sourceText),
    body: [],
  };
}
