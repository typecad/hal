// ---------------------------------------------------------------------------
// @typecad/ui — element type surface tests
//
// Guards the public TYPE surface declared in packages/ui/src/types.ts:
// __kind discriminant literals, .value/.text properties, callback signatures,
// the CanvasCtx primitive set, and the ScreenTree index signature. These are
// TYPE-LEVEL assertions enforced by `tsc -b` (CI: `npm run typecheck`); the
// deferred wrappers are checked by tsc but never executed.
//
// Pattern mirrors ui-signal-type.test.ts: function bodies hold the assertions,
// suppression directives cover the negative cases, and a tiny runtime block
// guards against import-time regressions.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type {
  TextElement,
  ButtonElement,
  ViewElement,
  CheckElement,
  SelectElement,
  RadioElement,
  ProgressElement,
  RangeElement,
  InputElement,
  CanvasElement,
  CanvasCtx,
  ScreenTree,
  PressBinding,
} from "@typecad/ui";
import { ui } from "@typecad/ui";

// ── Compile-time-only type assertions ─────────────────────────────────────
// Wrapper bodies are checked by tsc but never invoked. If a type regresses,
// the suppression directives become unused and tsc fails.

function _kindDiscriminantsAreLiteral() {
  const t: TextElement = { __kind: "text" } as TextElement;
  const b: ButtonElement = { __kind: "button" } as ButtonElement;
  const v: ViewElement = { __kind: "view" } as ViewElement;
  const c: CheckElement = { __kind: "check" } as CheckElement;
  const s: SelectElement = { __kind: "select" } as SelectElement;
  const r: RadioElement = { __kind: "radio" } as RadioElement;
  const p: ProgressElement = { __kind: "progress" } as ProgressElement;
  const rg: RangeElement = { __kind: "range" } as RangeElement;
  const i: InputElement = { __kind: "input" } as InputElement;
  const cv: CanvasElement = { __kind: "canvas" } as CanvasElement;
  void t; void b; void v; void c; void s; void r; void p; void rg; void i; void cv;
}

function _kindDiscriminantsRejectWrongLiteral() {
  // Test the literal-typed __kind property via indexed access. Assigning a
  // mismatched literal to the indexed type is a hard error (no `as` cast to
  // mask it): "text"["__kind"] is the literal "text", so "button" is rejected.
  // @ts-expect-error — "button" not assignable to TextElement["__kind"]: "text"
  const t: TextElement["__kind"] = "button";
  // @ts-expect-error — "text" not assignable to ButtonElement["__kind"]: "button"
  const b: ButtonElement["__kind"] = "text";
  // @ts-expect-error — "range" not assignable to CheckElement["__kind"]: "check"
  const c: CheckElement["__kind"] = "range";
  // @ts-expect-error — "canvas" not assignable to InputElement["__kind"]: "input"
  const i: InputElement["__kind"] = "canvas";
  void t; void b; void c; void i;
}

// ButtonElement extends UIElement & PressBinding, so it exercises the base
// .value / onClick / onHold / onRelease surface through an exported type.
// (UIElement itself is not re-exported from the package entry point.)
function _baseUIElementShape() {
  const e = {} as ButtonElement;
  const n: number = e.value;          // .value is number
  e.value = 42;                       // .value is writable
  e.onClick(() => {});                // onClick accepts a no-arg callback
  e.onHold(() => {});                 // onHold
  e.onRelease(() => {});              // onRelease
  void n;
}

function _baseUIElementRejectsNonNumberValue() {
  const e = {} as ButtonElement;
  // @ts-expect-error — .value is number, not string
  e.value = "x";
  // @ts-expect-error — .value is number, not boolean
  e.value = true;
}

function _inputElementHasTextNotJustValue() {
  const i = {} as InputElement;
  const s: string = i.text;           // .text is string
  i.text = "hello";                   // .text is writable
  i.onChange(() => {});               // onChange callback
  const n: number = i.value;          // still has .value: number
  void s; void n;
}

function _callbackSignaturesByElement() {
  const check = {} as CheckElement;
  check.onToggle(4, () => {});        // onToggle(pin, onChange?)
  const view = {} as ViewElement;
  view.onToggle(4, () => {});         // ViewElement also has onToggle
  const range = {} as RangeElement;
  range.onChange(() => {});           // RangeElement.onChange(no-arg cb)
  const input = {} as InputElement;
  input.onChange(() => {});           // InputElement.onChange(no-arg cb)
  void check; void view; void range; void input;
}

function _pressBindingPinApi() {
  const pb = {} as PressBinding;
  pb.onPress(4);                      // onPress(number)
  pb.onPress("D2");                   // onPress(string) — GPIO name
  pb.onRelease(4);
  pb.onRelease("D2");
  void pb;
}

function _canvasCtxSurface() {
  const ctx = {} as CanvasCtx;
  const w: number = ctx.width;        // readonly number
  const h: number = ctx.height;       // readonly number
  // Every documented primitive must exist:
  ctx.drawPixel(0, 0, "red");
  ctx.fillRect(0, 0, 10, 10, "blue");
  ctx.rect(0, 0, 10, 10, "blue");
  ctx.fillRoundRect(0, 0, 10, 10, 2, "blue");
  ctx.roundRect(0, 0, 10, 10, 2, "blue");
  ctx.line(0, 0, 10, 10, "lime");
  ctx.hline(0, 0, 10, "lime");
  ctx.vline(0, 0, 10, "lime");
  ctx.fillCircle(5, 5, 3, "red");
  ctx.circle(5, 5, 3, "red");
  ctx.rgbBitmap(0, 0, [255, 0, 0], 1, 1);
  ctx.text(0, 12, "hi", "white");
  ctx.text(0, 12, "hi");              // color optional
  ctx.fillScreen("black");
  void w; void h;
}

function _canvasCtxWidthHeightAreNotWritable() {
  const ctx = {} as CanvasCtx;
  // @ts-expect-error — width is readonly
  ctx.width = 100;
  // @ts-expect-error — height is readonly
  ctx.height = 100;
}

function _canvasCtxRejectsUndocumentedMethod() {
  const ctx = {} as CanvasCtx;
  // @ts-expect-error — fillTriangle is not part of the CanvasCtx surface
  ctx.fillTriangle(0, 0, 10, 0, 5, 10, "red");
  void ctx;
}

function _screenTreeAcceptsElementsRejectsPrimitives() {
  const tree = {} as ScreenTree;
  // Each documented element kind is assignable to the index signature.
  tree.a = {} as TextElement;
  tree.b = {} as ButtonElement;
  tree.c = {} as CanvasElement;
  tree.d = {} as InputElement;
  // @ts-expect-error — a plain number is not a valid element
  tree.n = 42;
  // @ts-expect-error — a plain string is not a valid element
  tree.s = "x";
}

// Reference the wrappers so they're not tree-shaken from type-checking.
void _kindDiscriminantsAreLiteral;
void _kindDiscriminantsRejectWrongLiteral;
void _baseUIElementShape;
void _baseUIElementRejectsNonNumberValue;
void _inputElementHasTextNotJustValue;
void _callbackSignaturesByElement;
void _pressBindingPinApi;
void _canvasCtxSurface;
void _canvasCtxWidthHeightAreNotWritable;
void _canvasCtxRejectsUndocumentedMethod;
void _screenTreeAcceptsElementsRejectsPrimitives;

// ── Runtime sanity (no calls to the throwing stubs) ───────────────────────

describe("@typecad/ui element type surface", () => {
  it("re-exports element types without an import-time regression", () => {
    // The type imports above already proved the module loads. Sanity-check
    // the runtime namespace is intact alongside the type assertions.
    expect(typeof ui.mount).toBe("function");
    expect(typeof ui.signal).toBe("function");
  });
});
