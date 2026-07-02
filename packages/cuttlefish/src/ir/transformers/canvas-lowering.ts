// ---------------------------------------------------------------------------
// Canvas callback lowering: rewrite `ctx.method(args)` calls inside a
// ui.drawCanvas(node, (ctx) => {...}) body into ui_display_* shim calls.
//
// `ctx` is a compile-time fiction — at runtime the callback draws into the
// node's offscreen CuttlefishCanvas16 set as the active __ui_gfx target, so the
// lowered body uses the SAME ui_display_* wrappers every other draw path uses.
// Colors resolve to RGB565 via the existing resolver; ctx.width/ctx.height map
// to __ui_canvas_w / __ui_canvas_h locals set by the emitted wrapper.
// ---------------------------------------------------------------------------

import ts from "typescript";
import { Diagnostic } from "../../types.js";
import { expressionToIR } from "../expression-to-ir.js";
import { renderExprAsText } from "../render-expr.js";
import { resolveColorInternal } from "../../ui/color.js";
import { getDisplayProfile } from "../../ui/display-profile-store.js";

/** One user draw callback: the node it targets + the lowered C++ body string. */
export interface DrawCanvasSpec {
  nodeIndex: number;
  fnName: string;       // e.g. "__ui_canvas_draw_0"
  callbackBody: string; // lowered body (statements, each terminated with ;)
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
    return resolveColorInternal(color, getDisplayProfile().colorFormat);
  } catch {
    return null;
  }
}

/** Lower one argument expression to its C++ text. Color strings → rgb565 hex. */
function lowerArg(arg: ts.Expression, ctxName: string, sourceText: string, diagnostics: Diagnostic[]): string {
  // ctx.width / ctx.height → __ui_canvas_w / __ui_canvas_h (as a whole arg)
  if (
    ts.isPropertyAccessExpression(arg) &&
    ts.isIdentifier(arg.expression) &&
    arg.expression.text === ctxName &&
    (arg.name.text === "width" || arg.name.text === "height")
  ) {
    return arg.name.text === "width" ? "__ui_canvas_w" : "__ui_canvas_h";
  }
  let raw = renderExprAsText(expressionToIR(arg, sourceText, diagnostics));
  // ctx.width / ctx.height embedded in a compound expression (e.g. ctx.height - 4).
  // expressionToIR leaves these as literal text, so substitute on the rendered string.
  raw = raw.replace(new RegExp(`\\b${ctxName}\\.width\\b`, "g"), "__ui_canvas_w");
  raw = raw.replace(new RegExp(`\\b${ctxName}\\.height\\b`, "g"), "__ui_canvas_h");
  const color = tryColor(raw);
  if (color !== null) raw = `0x${color.toString(16)}`;
  return raw;
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

/**
 * If `call` is a `<ctxName>.method(args)` call we recognize, return the lowered
 * C++ statement(s) (each terminated with `;`). Otherwise return null (and push
 * a diagnostic if it IS a ctx call with an unknown method).
 *
 * `text`, `fillScreen` are handled specially (multi-statement / target-specific).
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

  // ctx.text(x, y, str [, color]) → set_cursor; set_text_color_solid; print;
  if (method === "text") {
    if (args.length < 3) return null;
    const x = lowerArg(args[0], ctxName, sourceText, diagnostics);
    const y = lowerArg(args[1], ctxName, sourceText, diagnostics);
    const str = renderExprAsText(expressionToIR(args[2], sourceText, diagnostics));
    const colorArg = args.length >= 4 ? tryColor(lowerArg(args[3], ctxName, sourceText, diagnostics)) : null;
    const color = colorArg !== null ? colorArg : 0xffff;
    return `ui_display_set_cursor(${x}, ${y}); ui_display_set_text_color_solid(0x${color!.toString(16)}); ui_display_print(${str});`;
  }

  // ctx.fillScreen(color) → clear the whole canvas buffer
  if (method === "fillScreen") {
    if (args.length < 1) return null;
    const color = tryColor(lowerArg(args[0], ctxName, sourceText, diagnostics)) ?? 0x0000;
    return `ui_display_fill_rect(0, 0, __ui_canvas_w, __ui_canvas_h, 0x${color.toString(16)});`;
  }

  const shim = CANVAS_METHODS[method];
  if (!shim) {
    diagnostics.push({
      severity: "warning", code: "ui-canvas-method",
      message: `Unknown canvas method ctx.${method}() — supported: drawPixel, fillRect, rect, fillRoundRect, roundRect, line, hline, vline, fillCircle, circle, rgbBitmap, text, fillScreen`,
    } as Diagnostic);
    return null;
  }
  const loweredArgs = args.map(a => lowerArg(a, ctxName, sourceText, diagnostics)).join(", ");
  return `${shim}(${loweredArgs});`;
}

/**
 * Lower an entire ui.drawCanvas callback body to a single C++ string of
 * space-joined statements. Recognizes ctx.X(...) calls.
 */
export function lowerCanvasBody(
  cbArg: ts.ArrowFunction | ts.FunctionExpression,
  sourceText: string,
  diagnostics: Diagnostic[],
): string {
  const ctxName = cbArg.parameters[0]?.name.getText() ?? "ctx";
  const body = cbArg.body;

  const lowerStmt = (expr: ts.Expression): string | null => {
    if (ts.isCallExpression(expr)) {
      return rewriteCanvasCall(expr, ctxName, diagnostics, sourceText);
    }
    return null;
  };

  if (ts.isExpression(body)) {
    return lowerStmt(body) ?? "";
  }
  if (ts.isBlock(body)) {
    const parts: string[] = [];
    for (const stmt of body.statements) {
      if (ts.isExpressionStatement(stmt) && stmt.expression) {
        const rewritten = lowerStmt(stmt.expression);
        if (rewritten) parts.push(rewritten);
      }
    }
    return parts.join(" ");
  }
  return "";
}

/** Emit the canvas binding table + callback functions as a C++ string. */
export function emitCanvasBindings(specs: DrawCanvasSpec[]): string {
  if (specs.length === 0) {
    return `UICanvasBinding __ui_canvas_bindings[] = {};\nconst uint16_t __ui_canvas_binding_count = 0;`;
  }
  const lines: string[] = [];
  for (const spec of specs) {
    // The wrapper sets the canvas dims as locals + runs the lowered body.
    // __c is null only when the runtime falls back to drawing directly into the
    // current display target because the node offscreen canvas allocation failed.
    lines.push(`void ${spec.fnName}(CuttlefishCanvas16* __c) {`);
    lines.push(`  int16_t __ui_canvas_w = __c ? display_canvasWidth(__c) : __ui_canvas_fallback_w;`);
    lines.push(`  int16_t __ui_canvas_h = __c ? display_canvasHeight(__c) : __ui_canvas_fallback_h;`);
    lines.push(`  ${spec.callbackBody || ""}`);
    lines.push(`}`);
  }
  lines.push(`UICanvasBinding __ui_canvas_bindings[] = {`);
  for (const spec of specs) {
    lines.push(`  { .node=${spec.nodeIndex}, .fn=${spec.fnName} },`);
  }
  lines.push(`};`);
  lines.push(`const uint16_t __ui_canvas_binding_count = ${specs.length};`);
  return lines.join("\n");
}

import { makeSourceSpan } from "../ast-node-utils.js";
import type { StatementIR } from "../../api/index.js";
import { resolveNodeIndex, resolveUIModuleImport } from "./ui-call-resolver.js";

/**
 * Resolve a `ui.drawCanvas(node, (ctx) => {...})` call.
 *  - node: screen.<id> property access → resolve to a node index
 *  - callback: arrow whose body is lowered via lowerCanvasBody
 * Records a DrawCanvasSpec and returns an empty block IR.
 * Returns null if the call doesn't match the expected shape.
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

  const treeName = nodeArg.expression.text;       // "screen"
  const id = nodeArg.name.text;                    // "spark"
  const htmlPath = resolveUIModuleImport(treeName);
  if (!htmlPath) return null;

  const nodeIndex = resolveNodeIndex(htmlPath, id);
  const callbackBody = lowerCanvasBody(cbArg, sourceText, diagnostics);
  const fnName = `__ui_canvas_draw_${getCanvasBindingsCount()}`;
  recordCanvasBinding({ nodeIndex, fnName, callbackBody });

  return {
    kind: "block",
    sourceSpan: makeSourceSpan(call, fileName, sourceText),
    body: [],
  };
}
