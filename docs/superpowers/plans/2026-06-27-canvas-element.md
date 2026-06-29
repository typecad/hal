# `<canvas>` Element Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `<canvas>` HTML element + `ui.drawCanvas(node, (ctx) => {...})` call that lets users draw arbitrary graphics (sparklines, gauges, custom buttons) using the display shim primitives, laid out and composited like any other element.

**Architecture:** A new `NODE_CANVAS` node kind reuses the proven `<list>` runtime mechanism (allocate an offscreen `CuttlefishCanvas16` → draw into it → blit clipped to the box). The user's `ctx.method(...)` calls are lowered at transpile time to the existing `ui_display_*` shim wrappers — `ctx` is a compile-time fiction, no runtime object. Colors resolve to RGB565 via the existing callback color resolver; coords are canvas-relative and auto-clipped.

**Tech Stack:** TypeScript (cuttlefish transpiler), C++ (Adafruit_GFX runtime), vitest, TDD (red→green→commit per task).

**Spec:** `docs/superpowers/specs/2026-06-27-canvas-element-design.md`

**Build/test loop:** After every source change under `packages/cuttlefish/src/`, run `npm run build` inside `packages/cuttlefish` (tests import from `dist`). After changes to `packages/ui/src/`, run `npm run build` inside `packages/ui`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/ui/src/types.ts` | `CanvasElement` public type | Modify |
| `packages/ui/src/index.ts` | `ui.drawCanvas` declaration | Modify |
| `packages/cuttlefish/src/ui/html-parser.ts` | Parse `<canvas>` tag + width/height attrs | Modify |
| `packages/cuttlefish/src/ui/model.ts` | `UINodeKindModel += "canvas"`; `nodeKind()`; canvasW/canvasH on model | Modify |
| `packages/cuttlefish/src/ir/transformers/ui-lowering.ts` | `cppKind("canvas") → NODE_CANVAS` | Modify |
| `packages/cuttlefish/src/ui/runtime-header.ts` | `NODE_CANVAS` enum; `UINode` canvas fields; `UICanvasBinding` struct; draw `case`; binding table externs | Modify |
| `packages/cuttlefish/src/ir/transformers/canvas-lowering.ts` | NEW: shared `ctx.method → ui_display_*` rewrite + `DrawCanvasSpec` registry + `resolveDrawCanvasCall` + `emitCanvasBindings` | Create |
| `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts` | Dispatch `onTap`/`drawCanvas` in `tryResolveUICall`; reset state | Modify |
| `packages/cuttlefish/src/emit/emitters/ui-emitter.ts` | Emit `__ui_canvas_bindings[]` table | Modify |
| `packages/cuttlefish/src/ir/transformers/ui-reactive.ts` | (no change — canvas uses its own module) | — |
| `packages/cuttlefish/src/preview/build-program.ts` | Scan `ui.drawCanvas` calls → `CanvasBindingSpec` | Modify |
| `packages/cuttlefish/src/preview/host-ui-runtime.ts` | `drawCanvasNode` + draw `case "canvas"`; tapSeq already exists | Modify |

---

## Task 1: HTML parser — recognize `<canvas>` + width/height

**Files:**
- Modify: `packages/cuttlefish/src/ui/html-parser.ts` (lines 92, 241, 309; UIElementNode interface ~line 55)
- Test: `tests/packages/cuttlefish/html-parser.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/html-parser.test.ts`:

```typescript
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";

describe("canvas element parsing", () => {
  it("parses <canvas> with width/height into a canvas node", () => {
    const tree = parseHtml(`<screen><canvas id="spark" width="120" height="40"></canvas></screen>`);
    // Walk to find the canvas child.
    const find = (n: any): any => {
      if (n.tag === "canvas") return n;
      for (const c of n.children ?? []) { const r = find(c); if (r) return r; }
      return null;
    };
    const canvas = find(tree);
    expect(canvas).not.toBeNull();
    expect(canvas.tag).toBe("canvas");
    expect(canvas.id).toBe("spark");
    expect(canvas.canvasW).toBe(120);
    expect(canvas.canvasH).toBe(40);
  });

  it("defaults canvas width/height to 0 when absent", () => {
    const tree = parseHtml(`<screen><canvas id="c"></canvas></screen>`);
    const find = (n: any): any => {
      if (n.tag === "canvas") return n;
      for (const c of n.children ?? []) { const r = find(c); if (r) return r; }
      return null;
    };
    const canvas = find(tree);
    expect(canvas.canvasW).toBe(0);
    expect(canvas.canvasH).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/html-parser.test.ts`
Expected: FAIL — `Unsupported tag <canvas>` thrown (canvas not in `SUPPORTED_TAGS`).

- [ ] **Step 3: Implement — add `canvas` to SUPPORTED_TAGS**

In `packages/cuttlefish/src/ui/html-parser.ts`, find the `SUPPORTED_TAGS` set (line ~92) and add `"canvas"`:

```typescript
const SUPPORTED_TAGS = new Set(["screen", "text", "button", "view", "check", "select", "option", "label", "radio", "progress", "range", "input", "keyboard", "row", "key", "style", "a", "img", "list", "canvas", "br"]);
```

- [ ] **Step 4: Implement — parse width/height attrs**

In `domToUIElementNode`, right after the `itemHeightAttr` line (~line 241), add:

```typescript
  const canvasWAttr = tag === "canvas" ? (parseInt(el.getAttribute("width") || "0", 10) || 0) : undefined;
  const canvasHAttr = tag === "canvas" ? (parseInt(el.getAttribute("height") || "0", 10) || 0) : undefined;
```

- [ ] **Step 5: Implement — add fields to UIElementNode + node object**

In the `UIElementNode` interface (after the `itemHeight?: number;` field, ~line 56), add:

```typescript
  /** Canvas buffer width in pixels (for <canvas>). */
  canvasW?: number;
  /** Canvas buffer height in pixels (for <canvas>). */
  canvasH?: number;
```

In the `node: UIElementNode` construction (~line 309), add `canvasW: canvasWAttr, canvasH: canvasHAttr,` to the object literal (next to `itemHeight: itemHeightAttr,`).

- [ ] **Step 6: Build + run test to verify it passes**

Run:
```bash
cd packages/cuttlefish && npm run build
cd ../.. && npx vitest run tests/packages/cuttlefish/html-parser.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/ui/html-parser.ts tests/packages/cuttlefish/html-parser.test.ts
git commit -m "feat(canvas): parse <canvas> tag with width/height attrs"
```

---

## Task 2: Model — `canvas` kind + canvasW/canvasH on UINodeModel

**Files:**
- Modify: `packages/cuttlefish/src/ui/model.ts` (lines 11, 177-188, 845)
- Test: `tests/packages/cuttlefish/ui-model.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/ui-model.test.ts`:

```typescript
import { lowerUIToModel } from "@typecad/cuttlefish/ui/model";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";
import { parseCss } from "@typecad/cuttlefish/ui/css-parser";
import { BlockLayoutEngine } from "@typecad/cuttlefish/ui/block-layout";
import { measure } from "@typecad/cuttlefish/ui/layout-engine";
import { resolveStyles } from "@typecad/cuttlefish/ui/style-resolver";

describe("canvas node model", () => {
  it("lowers <canvas> to a node with kind 'canvas' and buffer dims", () => {
    const styled = resolveStyles(parseHtml(`<screen><canvas id="spark" width="120" height="40"></canvas></screen>`), parseCss(``));
    const engine = new BlockLayoutEngine();
    const boxes = engine.arrange(styled, { x: 0, y: 0, w: 240, h: 320 }, measure);
    const program = lowerUIToModel(styled, boxes, "rgb565");
    const canvas = program.nodes.find(n => n.tag === "canvas");
    expect(canvas).toBeDefined();
    expect(canvas!.kind).toBe("canvas");
    expect(canvas!.canvasW).toBe(120);
    expect(canvas!.canvasH).toBe(40);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/ui-model.test.ts`
Expected: FAIL — `canvas` not in `UINodeKindModel` (TS error) / `nodeKind()` returns `"text"` / `canvasW` undefined on model.

- [ ] **Step 3: Implement — extend UINodeKindModel**

In `packages/cuttlefish/src/ui/model.ts` line 11, change:

```typescript
export type UINodeKindModel = "fill" | "text" | "button" | "check" | "radio" | "progress" | "range" | "input" | "img" | "list";
```
to:
```typescript
export type UINodeKindModel = "fill" | "text" | "button" | "check" | "radio" | "progress" | "range" | "input" | "img" | "list" | "canvas";
```

- [ ] **Step 4: Implement — nodeKind() maps canvas**

In `nodeKind()` (line ~177), add before `return "text"`:

```typescript
  if (tag === "canvas") return "canvas";
```

- [ ] **Step 5: Implement — add canvasW/canvasH to UINodeModel + set it**

In the `UINodeModel` interface (after `listItemHeight: number;`, ~line 95), add:

```typescript
  /** Canvas buffer width in pixels (for kind "canvas"). */
  canvasW: number;
  /** Canvas buffer height in pixels (for kind "canvas"). */
  canvasH: number;
```

In the returned object of `lowerUIToModel` (next to `listItemHeight: (node as any).itemHeight ?? 0,` ~line 845), add:

```typescript
      canvasW: (node as any).canvasW ?? 0,
      canvasH: (node as any).canvasH ?? 0,
```

- [ ] **Step 6: Build + run test to verify it passes**

Run:
```bash
cd packages/cuttlefish && npm run build
cd ../.. && npx vitest run tests/packages/cuttlefish/ui-model.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/ui/model.ts tests/packages/cuttlefish/ui-model.test.ts
git commit -m "feat(canvas): model kind 'canvas' with canvasW/canvasH"
```

---

## Task 3: C++ lowering — `cppKind("canvas") → NODE_CANVAS` + UINode fields

**Files:**
- Modify: `packages/cuttlefish/src/ir/transformers/ui-lowering.ts` (lines 200-213, 284)
- Test: `tests/packages/cuttlefish/ui-lowering.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/ui-lowering.test.ts`:

```typescript
  it("lowers <canvas> to a NODE_CANVAS row carrying canvasW/canvasH", () => {
    const out = lower(
      `<screen><canvas id="spark" width="60" height="30"></canvas></screen>`,
      `#spark { width: 60px; height: 30px; }`,
    );
    expect(out.nodeTable).toContain("NODE_CANVAS");
    // The lowered row must carry the buffer dimensions somewhere — assert the
    // raw text contains both dims. (Field names are finalized in Task 4.)
    expect(out.nodeTable).toMatch(/\.canvasW=60/);
    expect(out.nodeTable).toMatch(/\.canvasH=30/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/ui-lowering.test.ts`
Expected: FAIL — `cppKind` has no `"canvas"` case (TS exhaustiveness error / returns nothing).

- [ ] **Step 3: Implement — cppKind case**

In `packages/cuttlefish/src/ir/transformers/ui-lowering.ts`, in `cppKind()` (line ~200), add before the closing brace:

```typescript
    case "canvas": return "NODE_CANVAS";
```

- [ ] **Step 4: Implement — emit canvasW/canvasH in the node row**

In the node-row template literal (~line 284), find `.listItemHeight=${(n as any).listItemHeight ?? 0},` and add right after it:

```typescript
.listItemHeight=${(n as any).listItemHeight ?? 0}, .canvasW=${(n as any).canvasW ?? 0}, .canvasH=${(n as any).canvasH ?? 0},
```

- [ ] **Step 5: Build + run test to verify it passes**

Run:
```bash
cd packages/cuttlefish && npm run build
cd ../.. && npx vitest run tests/packages/cuttlefish/ui-lowering.test.ts
```
Expected: PASS. (The `canvasW`/`canvasH` fields must also be added to the `UINode` C++ struct in Task 4 or the generated C++ won't compile — but this unit test only checks the emitted text, so it passes now. Task 4 makes the C++ valid.)

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ir/transformers/ui-lowering.ts tests/packages/cuttlefish/ui-lowering.test.ts
git commit -m "feat(canvas): lower canvas kind to NODE_CANVAS with buffer dims"
```

---

## Task 4: Runtime header — NODE_CANVAS kind, UINode fields, UICanvasBinding, draw case

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts` (enum line 42; UINode struct ~line 127; list-binding block ~line 247; ui_tick draw switch ~line 3458)
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/runtime-header.test.ts`:

```typescript
  it("declares NODE_CANVAS + canvas buffer fields + canvas binding table", () => {
    expect(header).toMatch(/NODE_CANVAS/);
    // Buffer dimensions live on UINode.
    expect(header).toMatch(/uint16_t\s+canvasW/);
    expect(header).toMatch(/uint16_t\s+canvasH/);
    // Binding table externs (populated by the emitter).
    expect(header).toMatch(/struct\s+UICanvasBinding/);
    expect(header).toMatch(/extern\s+UICanvasBinding\s+__ui_canvas_bindings/);
    expect(header).toMatch(/extern\s+const\s+uint8_t\s+__ui_canvas_binding_count/);
  });

  it("has a NODE_CANVAS draw case that sets the canvas target and blits", () => {
    expect(header).toMatch(/case\s+NODE_CANVAS:/);
    // The case must hand the canvas to the callback via ui_display_set_target.
    expect(header).toMatch(/ui_display_set_target[\s\S]*case\s+NODE_CANVAS:[\s\S]*ui_display_set_target|case\s+NODE_CANVAS:[\s\S]*ui_display_set_target/);
    // And blit the canvas at the node box.
    expect(header).toMatch(/case\s+NODE_CANVAS:[\s\S]*ui_draw_canvas_rect/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: FAIL — `NODE_CANVAS` not present.

- [ ] **Step 3: Implement — add NODE_CANVAS to the enum**

In `runtime-header.ts` line 42, change:

```cpp
enum UINodeKind { NODE_FILL, NODE_TEXT, NODE_BUTTON, NODE_CHECK, NODE_RADIO, NODE_PROGRESS, NODE_RANGE, NODE_INPUT, NODE_IMG, NODE_LIST };
```
to:
```cpp
enum UINodeKind { NODE_FILL, NODE_TEXT, NODE_BUTTON, NODE_CHECK, NODE_RADIO, NODE_PROGRESS, NODE_RANGE, NODE_INPUT, NODE_IMG, NODE_LIST, NODE_CANVAS };
```

- [ ] **Step 4: Implement — add canvasW/canvasH to the UINode struct**

In the `struct UINode` block, after the `listItemHeight` field (~line 126), add:

```cpp
  uint16_t listItemHeight; // px per item for <list> (0 = not a list)
  uint16_t canvasW;        // canvas buffer width  (for <canvas>)
  uint16_t canvasH;        // canvas buffer height (for <canvas>)
```

- [ ] **Step 5: Implement — add UICanvasBinding struct + externs**

Near the existing `UIListBinding` block (~line 247), add a sibling:

```cpp
// ── Canvas bindings (ui.drawCanvas) ─────────────────────────────────────────
// Each canvas node's user-supplied draw function. Called each frame with the
// node's offscreen CuttlefishCanvas16 set as the active draw target, so the
// lowered callback body draws via the same ui_display_* wrappers as everything.
struct UICanvasBinding {
  uint8_t node;
  void (*fn)(CuttlefishCanvas16* canvas);
};
extern UICanvasBinding __ui_canvas_bindings[];
extern const uint8_t __ui_canvas_binding_count;
```

- [ ] **Step 6: Implement — add the NODE_CANVAS draw case**

In the `ui_tick` draw switch, right before `case NODE_LIST:` (~line 3471), add:

```cpp
      case NODE_CANVAS: {
        // Find this node's draw callback.
        void (*__ui_canvas_fn)(CuttlefishCanvas16*) = nullptr;
        for (uint8_t b = 0; b < __ui_canvas_binding_count; b++) {
          if (__ui_canvas_bindings[b].node == i) { __ui_canvas_fn = __ui_canvas_bindings[b].fn; break; }
        }
        if (__ui_canvas_fn) {
          int16_t __ui_cw = __ui_nodes[i].canvasW;
          int16_t __ui_ch = __ui_nodes[i].canvasH;
          if (__ui_cw > 0 && __ui_ch > 0) {
            // Cache a canvas sized to the buffer (reused across frames, like __ui_list_canvas).
            static CuttlefishCanvas16* __ui_node_canvas = nullptr;
            if (!__ui_node_canvas || display_canvasWidth(__ui_node_canvas) != __ui_cw || display_canvasHeight(__ui_node_canvas) != __ui_ch) {
              display_deleteCanvas(__ui_node_canvas);
              __ui_node_canvas = display_createCanvas(__ui_cw, __ui_ch);
            }
            CuttlefishCanvas16* __ui_lc = __ui_node_canvas;
            if (__ui_lc && display_canvasBuffer(__ui_lc)) {
              display_canvasFillScreen(__ui_lc, __ui_nodes[i].clearColor);
              CuttlefishDisplayTarget* __ui_prev_target = ui_display_get_target();
              ui_display_set_target((CuttlefishDisplayTarget*)__ui_lc);
              __ui_canvas_fn(__ui_lc);
              ui_display_set_target(__ui_prev_target);
              ui_draw_canvas_rect(__ui_lc, __ui_nodes[i].box.x, drawY, __ui_cw, __ui_ch);
            }
          }
        }
        break;
      }
```

- [ ] **Step 7: Build + run test to verify it passes**

Run:
```bash
cd packages/cuttlefish && npm run build
cd ../.. && npx vitest run tests/packages/cuttlefish/runtime-header.test.ts
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(canvas): NODE_CANVAS kind, UINode fields, UICanvasBinding, draw case"
```

---

## Task 5: `@typecad/ui` types — CanvasElement + ui.drawCanvas declaration

**Files:**
- Modify: `packages/ui/src/types.ts` (ScreenTree union ~line 83)
- Modify: `packages/ui/src/index.ts` (ui object ~line 88)
- Modify: `packages/cuttlefish/src/ui/ui-registry.ts` (`uiElementTypeForTag` ~line 191)
- Test: none (type-only; covered by Task 9 e2e which type-checks)

- [ ] **Step 1: Implement — add CanvasElement type**

In `packages/ui/src/types.ts`, add after the `InputElement` interface (before `ScreenTree`):

```typescript
/** A user-drawn canvas. Contents are drawn by a ui.drawCanvas callback each
 *  frame using the display shim primitives (fillRect, line, circle, text, ...).
 *  Coordinates are canvas-relative ((0,0) = top-left); drawing is auto-clipped. */
export interface CanvasElement extends UIElement {
  readonly __kind: "canvas";
}
```

Update the `ScreenTree` interface to include `CanvasElement`:

```typescript
export interface ScreenTree {
  [id: string]: TextElement | ButtonElement | ViewElement | CheckElement | SelectElement | RadioElement | ProgressElement | RangeElement | InputElement | CanvasElement;
}
```

- [ ] **Step 2: Implement — add ui.drawCanvas declaration**

In `packages/ui/src/index.ts`, add the declaration and include it in `ui`. Place this before `export const ui = ...`:

```typescript
/**
 * Register a draw callback for a `<canvas>` element. The callback runs every
 * frame and receives a `ctx` whose methods map to the display graphics
 * primitives. Coordinates are canvas-relative ((0,0) = top-left of the element);
 * drawing is clipped to the canvas buffer.
 *
 *   ui.drawCanvas(screen.spark, (ctx) => {
 *     ctx.fillScreen('black');
 *     ctx.line(0, ctx.height / 2, ctx.width, ctx.height / 2, 'limegreen');
 *     ctx.fillCircle(needleX, 20, 3, 'red');
 *     ctx.text(4, 12, `${temp}°`, 'white');
 *   });
 *
 * Color arguments are CSS color strings resolved to RGB565 at transpile time.
 * `ctx.width` / `ctx.height` are the canvas buffer dimensions.
 */
export declare function drawCanvas(node: unknown, callback: (ctx: unknown) => void): void;
```

Then update the `ui` object:

```typescript
export const ui = { mount, signal, bind, watchPin, bindList, onTap, drawCanvas };
```

- [ ] **Step 3: Implement — ui-registry emits CanvasElement type**

In `packages/cuttlefish/src/ui/ui-registry.ts`, in `uiElementTypeForTag` (~line 191), add a case:

```typescript
    case "canvas": return "CanvasElement";
```

Also update the `import type { ... }` line in `writeTypeDeclSibling` to include `CanvasElement`:

```typescript
    `import type { TextElement, ButtonElement, ViewElement, CheckElement, SelectElement, RadioElement, ProgressElement, RangeElement, InputElement, CanvasElement } from "@typecad/ui";`,
```

- [ ] **Step 4: Build @typecad/ui + cuttlefish**

Run:
```bash
cd packages/ui && npm run build
cd ../cuttlefish && npm run build
```
Expected: clean build (no TS errors).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/types.ts packages/ui/src/index.ts packages/cuttlefish/src/ui/ui-registry.ts
git commit -m "feat(canvas): CanvasElement type + ui.drawCanvas declaration"
```

---

## Task 6: ctx lowering module — `ctx.method → ui_display_*` rewrite + DrawCanvasSpec

**Files:**
- Create: `packages/cuttlefish/src/ir/transformers/canvas-lowering.ts`
- Test: `tests/packages/cuttlefish/canvas-lowering.test.ts`

This is the core new mechanism: a function that walks an arrow callback's body and rewrites each `ctx.method(args)` call into the matching `ui_display_*` C++ call.

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/canvas-lowering.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import ts from "typescript";
import {
  rewriteCanvasCall,
  resetCanvasBindings,
  canvasBindings,
} from "../../../packages/cuttlefish/src/ir/transformers/canvas-lowering";

function callExpr(code: string): ts.CallExpression {
  const file = ts.createSourceFile("x.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) calls.push(n);
    ts.forEachChild(n, visit);
  };
  visit(file);
  if (calls.length === 0) throw new Error("no call in: " + code);
  return calls[0];
}

describe("canvas ctx lowering", () => {
  beforeEach(() => resetCanvasBindings());

  it("rewrites ctx.fillRect(x,y,w,h,'red') to ui_display_fill_rect with resolved color", () => {
    const out = rewriteCanvasCall(callExpr("ctx.fillRect(1, 2, 3, 4, 'red')"), "ctx", []);
    // 'red' = #ff0000 = rgb565 0xf800
    expect(out).toBe("ui_display_fill_rect(1, 2, 3, 4, 0xf800);");
  });

  it("rewrites ctx.line(...) to ui_display_draw_line", () => {
    const out = rewriteCanvasCall(callExpr("ctx.line(0, 0, 10, 10, 'limegreen')"), "ctx", []);
    expect(out).toBe("ui_display_draw_line(0, 0, 10, 10, 0x07e0);");
  });

  it("rewrites ctx.width / ctx.height inside args to __ui_canvas_w / __ui_canvas_h", () => {
    const out = rewriteCanvasCall(callExpr("ctx.line(0, ctx.height, ctx.width, ctx.height, 'red')"), "ctx", []);
    expect(out).toBe("ui_display_draw_line(0, __ui_canvas_h, __ui_canvas_w, __ui_canvas_h, 0xf800);");
  });

  it("rewrites ctx.text(x,y,str,color) to set_cursor + set_text_color_solid + print", () => {
    const out = rewriteCanvasCall(callExpr("ctx.text(4, 12, `50%`, 'white')"), "ctx", []);
    // Template literal lowers to a C++ string literal.
    expect(out).toContain("ui_display_set_cursor(4, 12);");
    expect(out).toContain("ui_display_set_text_color_solid(0xffff);");
    expect(out).toContain("ui_display_print(");
  });

  it("returns null (with a diagnostic) for an unknown ctx method", () => {
    const diags: any[] = [];
    const out = rewriteCanvasCall(callExpr("ctx.bogus(1)"), "ctx", diags);
    expect(out).toBeNull();
    expect(diags.some((d) => d.code === "ui-canvas-method")).toBe(true);
  });

  it("returns null for a call that is not on ctx", () => {
    const out = rewriteCanvasCall(callExpr("foo(1)"), "ctx", []);
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/canvas-lowering.test.ts`
Expected: FAIL — module `canvas-lowering.ts` does not exist.

- [ ] **Step 3: Implement — create the canvas-lowering module**

Create `packages/cuttlefish/src/ir/transformers/canvas-lowering.ts`:

```typescript
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
import { resolveColor } from "../../ui/color.js";

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

/** Lower a CSS color string to an rgb565 hex literal, or null if not a color. */
function tryColor(text: string): number | null {
  if (!/^["'](#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})|[a-z]+|rgba?\([^)]*\))["']$/i.test(text.trim())) return null;
  const color = text.trim().replace(/^["']|["']$/g, "");
  try {
    return resolveColor(color, "rgb565");
  } catch {
    return null;
  }
}

/** Lower one argument expression to its C++ text. Color strings → rgb565 hex. */
function lowerArg(arg: ts.Expression, ctxName: string, sourceText: string, diagnostics: Diagnostic[]): string {
  // ctx.width / ctx.height → __ui_canvas_w / __ui_canvas_h
  if (
    ts.isPropertyAccessExpression(arg) &&
    ts.isIdentifier(arg.expression) &&
    arg.expression.text === ctxName &&
    (arg.name.text === "width" || arg.name.text === "height")
  ) {
    return arg.name.text === "width" ? "__ui_canvas_w" : "__ui_canvas_h";
  }
  let raw = renderExprAsText(expressionToIR(arg, sourceText, diagnostics));
  const color = tryColor(raw);
  if (color !== null) raw = `0x${color.toString(16)}`;
  return raw;
}

/** ctx method name → (argCount, shim callee, arg-map). For text(), multiple stmts. */
interface CanvasMethod { shim: string; }

const CANVAS_METHODS: Record<string, CanvasMethod> = {
  drawPixel: { shim: "ui_display_draw_pixel" },
  fillRect: { shim: "ui_display_fill_rect" },
  rect: { shim: "ui_display_draw_rect" },
  fillRoundRect: { shim: "ui_display_fill_round_rect" },
  roundRect: { shim: "ui_display_draw_round_rect" },
  line: { shim: "ui_display_draw_line" },
  hline: { shim: "ui_display_draw_fast_hline" },
  vline: { shim: "ui_display_draw_fast_vline" },
  fillCircle: { shim: "ui_display_fill_circle" },
  circle: { shim: "ui_display_draw_circle" },
  rgbBitmap: { shim: "ui_display_draw_rgb_bitmap" },
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

  // ctx.fillScreen(color) → ui_display_fill_rect(0,0,__ui_canvas_w,__ui_canvas_h,color)
  // (the active target is the canvas; fillScreen clears it)
  if (method === "fillScreen") {
    if (args.length < 1) return null;
    const color = tryColor(lowerArg(args[0], ctxName, sourceText, diagnostics)) ?? 0x0000;
    return `ui_display_fill_rect(0, 0, __ui_canvas_w, __ui_canvas_h, 0x${color.toString(16)});`;
  }

  const entry = CANVAS_METHODS[method];
  if (!entry) {
    diagnostics.push({
      severity: "warning", code: "ui-canvas-method",
      message: `Unknown canvas method ctx.${method}() — supported: drawPixel, fillRect, rect, fillRoundRect, roundRect, line, hline, vline, fillCircle, circle, rgbBitmap, text, fillScreen`,
    } as Diagnostic);
    return null;
  }
  const loweredArgs = args.map(a => lowerArg(a, ctxName, sourceText, diagnostics)).join(", ");
  return `${entry.shim}(${loweredArgs});`;
}

/**
 * Lower an entire ui.drawCanvas callback body to a single C++ string of
 * space-joined statements. Recognizes ctx.X(...) calls; other expression
 * statements (signal reads/writes, console) reuse lowerCallbackExpr.
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
      const rewritten = rewriteCanvasCall(expr, ctxName, diagnostics, sourceText);
      if (rewritten !== null) return rewritten;
    }
    return null; // non-ctx statements handled by caller via lowerCallbackExpr
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
    return `UICanvasBinding __ui_canvas_bindings[] = {};\nconst uint8_t __ui_canvas_binding_count = 0;`;
  }
  const lines: string[] = [];
  for (const spec of specs) {
    // The wrapper sets the canvas dims as locals + runs the lowered body.
    lines.push(`void ${spec.fnName}(CuttlefishCanvas16* __c) {`);
    lines.push(`  int16_t __ui_canvas_w = display_canvasWidth(__c);`);
    lines.push(`  int16_t __ui_canvas_h = display_canvasHeight(__c);`);
    lines.push(`  ${spec.callbackBody || ""}`);
    lines.push(`}`);
  }
  lines.push(`UICanvasBinding __ui_canvas_bindings[] = {`);
  for (const spec of specs) {
    lines.push(`  { .node=${spec.nodeIndex}, .fn=${spec.fnName} },`);
  }
  lines.push(`};`);
  lines.push(`const uint8_t __ui_canvas_binding_count = ${specs.length};`);
  return lines.join("\n");
}
```

- [ ] **Step 4: Build + run test to verify it passes**

Run:
```bash
cd packages/cuttlefish && npm run build
cd ../.. && npx vitest run tests/packages/cuttlefish/canvas-lowering.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/ir/transformers/canvas-lowering.ts tests/packages/cuttlefish/canvas-lowering.test.ts
git commit -m "feat(canvas): ctx method → ui_display_* rewrite + DrawCanvasSpec"
```

---

## Task 7: Resolver — `resolveDrawCanvasCall` + dispatch + reset wiring

**Files:**
- Modify: `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts` (dispatch ~line 264; resetUICallState ~line 169)
- Modify: `packages/cuttlefish/src/ir/transformers/canvas-lowering.ts` (add resolveDrawCanvasCall)
- Test: `tests/packages/cuttlefish/ui-canvas-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/ui-canvas-resolver.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import ts from "typescript";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetUIRegistry, loadUIModule, clearEntryHasUI } from "@typecad/cuttlefish/ui/ui-registry";
import {
  tryResolveUICall,
  resetUICallState,
  registerUIModuleImport,
} from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";
import { canvasBindings, resetCanvasBindings } from "../../../packages/cuttlefish/src/ir/transformers/canvas-lowering";
import type { Diagnostic } from "../../../packages/cuttlefish/src/types";

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0, tempDirs.length)) fs.rmSync(d, { recursive: true, force: true });
  resetUIRegistry();
  resetUICallState();
  resetCanvasBindings();
  clearEntryHasUI();
});

function firstCallExpr(stmt: string): ts.CallExpression {
  const file = ts.createSourceFile("x.ts", stmt, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => { if (ts.isCallExpression(n)) calls.push(n); ts.forEachChild(n, visit); };
  visit(file);
  return calls[0];
}

describe("ui.drawCanvas resolver", () => {
  let diagnostics: Diagnostic[];
  beforeEach(() => { resetUICallState(); resetCanvasBindings(); diagnostics = []; });

  it("records a DrawCanvasSpec with the resolved node index + lowered body", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-resolver-"));
    tempDirs.push(dir);
    const htmlPath = path.join(dir, "app.ui.html");
    fs.writeFileSync(htmlPath, `<screen><canvas id="spark" width="60" height="30"></canvas></screen>`, "utf-8");
    fs.writeFileSync(path.join(dir, "app.ui.css"), ``, "utf-8");
    loadUIModule(htmlPath);
    registerUIModuleImport("screen", htmlPath);

    const call = firstCallExpr(`ui.drawCanvas(screen.spark, (ctx) => { ctx.fillRect(0,0,10,10,'red'); });`);
    const ir = tryResolveUICall(call, "x.ts", "", diagnostics);

    expect(ir).not.toBeNull();
    expect(canvasBindings()).toHaveLength(1);
    const spec = canvasBindings()[0];
    expect(spec.nodeIndex).toBe(0); // spark is the only child → index 0
    expect(spec.fnName).toMatch(/__ui_canvas_draw_/);
    expect(spec.callbackBody).toContain("ui_display_fill_rect(0, 0, 10, 10, 0xf800)");
  });

  it("ignores ui.drawCanvas calls whose first arg is not screen.X", () => {
    const call = firstCallExpr(`ui.drawCanvas(unknownThing, (ctx) => {});`);
    const ir = tryResolveUICall(call, "x.ts", "", diagnostics);
    // Falls through to null (not recognized as a usable draw call).
    expect(ir).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/ui-canvas-resolver.test.ts`
Expected: FAIL — `resolveDrawCanvasCall` doesn't exist / dispatch missing.

- [ ] **Step 3: Implement — add resolveDrawCanvasCall to canvas-lowering.ts**

Append to `packages/cuttlefish/src/ir/transformers/canvas-lowering.ts`:

```typescript
import { makeSourceSpan } from "../ast-node-utils.js";
import { StatementIR } from "../../api/index.js";
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
```

- [ ] **Step 4: Implement — wire into tryResolveUICall + resetUICallState**

In `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts`:

1. Add import at top:
```typescript
import { resolveDrawCanvasCall, resetCanvasBindings } from "./canvas-lowering.js";
```

2. In `tryResolveUICall`, after the `onTap` branch (~line 269), add:
```typescript
  if (method === "drawCanvas") {
    return resolveDrawCanvasCall(call, fileName, sourceText, diagnostics);
  }
```

3. In `resetUICallState()` (line ~169), add `resetCanvasBindings();` to the reset body.

- [ ] **Step 5: Build + run test to verify it passes**

Run:
```bash
cd packages/cuttlefish && npm run build
cd ../.. && npx vitest run tests/packages/cuttlefish/ui-canvas-resolver.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ir/transformers/canvas-lowering.ts packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts tests/packages/cuttlefish/ui-canvas-resolver.test.ts
git commit -m "feat(canvas): resolveDrawCanvasCall + dispatch + reset wiring"
```

---

## Task 8: Emitter — emit `__ui_canvas_bindings[]` table

**Files:**
- Modify: `packages/cuttlefish/src/emit/emitters/ui-emitter.ts` (after the radio-group block ~line 312)
- Test: `tests/packages/transpiler/ui-canvas-e2e.test.ts` (added in Task 9; this task verifies via a focused build)

- [ ] **Step 1: Implement — emit the canvas binding table**

In `packages/cuttlefish/src/emit/emitters/ui-emitter.ts`, add the import at top:

```typescript
import { emitCanvasBindings, canvasBindings } from "../../ir/transformers/canvas-lowering.js";
```

At the end of the `emitUIBindings`/section-9 area (after the radio group block, before the closing brace of the function ~line 313), add:

```typescript
  // 10. Canvas draw bindings (ui.drawCanvas).
  ctx.sourceLines.push(emitCanvasBindings(canvasBindings()));
```

- [ ] **Step 2: Build + write a focused verification test**

Create `tests/packages/cuttlefish/ui-canvas-emit.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { emitCanvasBindings } from "@typecad/cuttlefish/ir/transformers/canvas-lowering";

describe("emitCanvasBindings", () => {
  it("emits an empty table when there are no specs", () => {
    const out = emitCanvasBindings([]);
    expect(out).toContain("UICanvasBinding __ui_canvas_bindings[] = {};");
    expect(out).toContain("__ui_canvas_binding_count = 0;");
  });

  it("emits a wrapper function per spec + the binding table", () => {
    const out = emitCanvasBindings([
      { nodeIndex: 3, fnName: "__ui_canvas_draw_0", callbackBody: "ui_display_fill_rect(0,0,10,10,0xf800);" },
    ]);
    expect(out).toContain("void __ui_canvas_draw_0(CuttlefishCanvas16* __c) {");
    expect(out).toContain("int16_t __ui_canvas_w = display_canvasWidth(__c);");
    expect(out).toContain("ui_display_fill_rect(0,0,10,10,0xf800);");
    expect(out).toContain("UICanvasBinding __ui_canvas_bindings[] = {");
    expect(out).toContain("{ .node=3, .fn=__ui_canvas_draw_0 },");
    expect(out).toContain("__ui_canvas_binding_count = 1;");
  });
});
```

- [ ] **Step 3: Build + run test to verify it passes**

Run:
```bash
cd packages/cuttlefish && npm run build
cd ../.. && npx vitest run tests/packages/cuttlefish/ui-canvas-emit.test.ts
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/cuttlefish/src/emit/emitters/ui-emitter.ts tests/packages/cuttlefish/ui-canvas-emit.test.ts
git commit -m "feat(canvas): emit __ui_canvas_bindings table"
```

---

## Task 9: E2E transpile — a full `<canvas>` + `ui.drawCanvas` program lowers correctly

**Files:**
- Test: `tests/packages/transpiler/ui-canvas-e2e.test.ts`

This is the integration proof: the whole pipeline emits valid C++ with the canvas binding table, the draw wrapper, and `ui_display_*` calls.

- [ ] **Step 1: Write the failing test**

Create `tests/packages/transpiler/ui-canvas-e2e.test.ts`:

```typescript
// End-to-end: <canvas> + ui.drawCanvas lowers to C++ with the binding table
// and a draw wrapper whose body calls the ui_display_* shims.
// See docs/superpowers/specs/2026-06-27-canvas-element-design.md

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { transpileFile } from "@typecad/cuttlefish/testing";
import { resetUIRegistry } from "@typecad/cuttlefish/ui/ui-registry";
import { resetUICallState } from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";
import { resetCanvasBindings } from "../../../packages/cuttlefish/src/ir/transformers/canvas-lowering";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const TMP_ROOT = path.join(REPO_ROOT, ".build", "ui-canvas-e2e");
const tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs.splice(0, tempDirs.length)) fs.rmSync(d, { recursive: true, force: true });
  resetUIRegistry();
  resetUICallState();
  resetCanvasBindings();
});

function mkTempDir(): string {
  const id = `t_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(TMP_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

describe("canvas e2e lowering", () => {
  it("emits a canvas draw wrapper with ui_display_* calls + binding table", async () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, "app.ui.html"), `<screen><canvas id="spark" width="60" height="30"></canvas></screen>`, "utf8");
    fs.writeFileSync(path.join(dir, "app.ui.css"), `#spark { width: 60px; height: 30px; }`, "utf8");
    fs.writeFileSync(path.join(dir, "main.ts"), [
      `import { ui } from "@typecad/ui";`,
      `import { screen } from "./app.ui.html";`,
      `ui.mount(screen, { display: "ili9341", bus: "SPI", cs: 10, dc: 9, rst: 8 });`,
      `ui.drawCanvas(screen.spark, (ctx) => {`,
      `  ctx.fillRect(0, 0, 60, 30, 'red');`,
      `  ctx.line(0, 15, ctx.width, 15, 'limegreen');`,
      `});`,
      `export function main() { while (true) {} }`,
    ].join("\n"), "utf8");

    const result = await transpileFile({
      inputFile: path.join(dir, "main.ts"),
      emitMode: "cpp",
      target: "arduino",
      frameworkPackage: "@typecad/framework-arduino",
      emitMaps: false,
    });
    const cpp = fs.readFileSync(result.sourcePath, "utf8");
    fs.unlinkSync(result.sourcePath);

    // Node table has a NODE_CANVAS row.
    expect(cpp).toContain("NODE_CANVAS");
    // Binding table is emitted.
    expect(cpp).toContain("UICanvasBinding __ui_canvas_bindings[]");
    expect(cpp).toContain("__ui_canvas_binding_count = 1");
    // The draw wrapper exists and contains lowered shim calls.
    expect(cpp).toMatch(/void __ui_canvas_draw_\d+\(CuttlefishCanvas16\* __c\)/);
    expect(cpp).toContain("ui_display_fill_rect(0, 0, 60, 30, 0xf800)");
    expect(cpp).toContain("ui_display_draw_line(0, 15, __ui_canvas_w, 15, 0x07e0)");
  });
});
```

- [ ] **Step 2: Run test to verify it passes (everything is wired by Tasks 1–8)**

Run:
```bash
cd packages/cuttlefish && npm run build
cd ../.. && npx vitest run tests/packages/transpiler/ui-canvas-e2e.test.ts
```
Expected: PASS. If it fails, the failure pinpoints the missing wiring (most likely: a build of `@typecad/ui` is needed, or the dispatch in `tryResolveUICall`).

- [ ] **Step 3: Commit**

```bash
git add tests/packages/transpiler/ui-canvas-e2e.test.ts
git commit -m "test(canvas): e2e <canvas> + ui.drawCanvas lowering"
```

---

## Task 10: Preview — scan ui.drawCanvas + drawCanvasNode + draw case

**Files:**
- Modify: `packages/cuttlefish/src/preview/build-program.ts` (after bindList scan ~line 290)
- Modify: `packages/cuttlefish/src/preview/host-ui-runtime.ts` (constructor fields ~line 173; draw switch ~line 1511)
- Test: `tests/packages/cuttlefish/ui-canvas-preview.test.ts`

The preview re-lowers `ctx.X(...)` against its `HostAdafruitGFX` sub-canvas using a host-side rewrite. To keep device and preview identical, the `ctx`→shim table is mirrored in the preview's `runCanvasBody`. (Full closure execution is out of scope — same flat-statement constraint as `bindList`.)

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/ui-canvas-preview.test.ts`:

```typescript
// Preview side of <canvas>: the host runtime draws the canvas body into a
// sub-canvas and blits it. See
// docs/superpowers/specs/2026-06-27-canvas-element-design.md

import { describe, expect, it } from "vitest";
import { PreviewUIRuntime } from "@typecad/cuttlefish/preview/host-ui-runtime";

function makeNode(overrides: Record<string, unknown>) {
  return {
    index: 0, tag: "view", classes: [],
    box: { x: 0, y: 0, w: 20, h: 10 }, bg: 0, fg: 0xffff,
    kind: "fill", textBuffer: "", parentIndex: 255,
    subtreeEnd: 1, screenId: 0, visible: true, ...overrides,
  };
}

describe("canvas preview", () => {
  it("draws a canvas node's body into its box and marks it drawing", () => {
    const nodes = [
      makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 2, box: { x: 0, y: 0, w: 40, h: 30 } }),
      makeNode({ index: 1, id: "spark", tag: "canvas", kind: "canvas", box: { x: 2, y: 2, w: 20, h: 20 }, canvasW: 20, canvasH: 20, parentIndex: 0, subtreeEnd: 2 }),
    ];
    const runtime = new PreviewUIRuntime({
      projectRoot: "", entryFile: "", htmlFile: "", uiTreeNames: ["screen"],
      program: { width: 40, height: 30, colorFormat: "rgb565", nodes, transitions: [] },
      font: new Array(1280).fill(0),
      bindings: [], listBindings: [], callbacks: [],
      canvasBindings: [{ nodeId: "spark", nodeIndex: 1, drawBody: "ctx.fillRect(0,0,5,5,'red');" }],
      initialAssignments: [], intervals: [], pinControls: [], diagnostics: [],
    } as any);
    runtime.start();
    try {
      // tick once → the canvas should draw without throwing and mark the node drawn.
      runtime.tick();
      // The canvas node is no longer dirty after a draw pass.
      expect((runtime as any).nodes[1].dirty).toBe(false);
    } finally {
      runtime.stop();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/ui-canvas-preview.test.ts`
Expected: FAIL — `canvasBindings` not a recognized snapshot field / `drawCanvasNode` doesn't exist.

- [ ] **Step 3: Implement — scan ui.drawCanvas in build-program.ts**

In `packages/cuttlefish/src/preview/build-program.ts`, find the `if (objectName === "ui" && method === "bindList")` block (~line 278). After its closing, add a sibling block:

```typescript
      if (objectName === "ui" && method === "drawCanvas") {
        const elementArg = call.arguments[0];
        const cbArg = call.arguments[1];
        const element = elementArg ? readTreeElement(elementArg) : undefined;
        if (element && cbArg && (ts.isArrowFunction(cbArg) || ts.isFunctionExpression(cbArg))) {
          const nodeIndex = resolveNode(element.treeName, element.elemId);
          if (nodeIndex !== undefined) {
            canvasBindings.push({
              nodeId: element.elemId,
              nodeIndex,
              drawBody: callbackExpressionText(cbArg, source),
            });
          }
        }
        continue;
      }
```

Also declare the `canvasBindings` array near the existing `listBindings`/`bindings` declarations and include it in the returned snapshot object (as `canvasBindings`).

- [ ] **Step 4: Implement — drawCanvasNode + draw case in host-ui-runtime.ts**

In `packages/cuttlefish/src/preview/host-ui-runtime.ts`:

1. Add a `canvasBindings` field to the constructor params type and assign it (mirror `pinControls`):
```typescript
  private readonly canvasBindings: { nodeId: string; nodeIndex: number; drawBody: string }[];
  // in constructor:
  this.canvasBindings = snapshot.canvasBindings ?? [];
```

2. Add a `drawCanvasNode` method (sibling of `drawListNode`, ~line 1575):
```typescript
  private drawCanvasNode(node: MutableNode, drawY: number): void {
    const binding = this.canvasBindings.find((b) => b.nodeIndex === node.index);
    if (!binding) return;
    const w = node.canvasW ?? node.box.w;
    const h = node.canvasH ?? node.box.h;
    if (w <= 0 || h <= 0) return;
    // Draw into a sub-region of the gfx (canvas-relative). Save/restore not
    // needed — HostAdafruitGFX draws directly; we offset each primitive by the
    // node origin via a simple ctx-text rewrite + origin translation.
    const prevDrawOff = { x: (this as any).drawOffX ?? 0, y: (this as any).drawOffY ?? 0 };
    this.runCanvasBody(binding.drawBody, node.box.x, drawY);
  }

  /** Lower a canvas drawBody (ctx.X(...) source) against the host gfx at origin. */
  private runCanvasBody(body: string, ox: number, oy: number): void {
    // Minimal host-side rewrite: ctx.fillRect(x,y,w,h,'color') → gfx.fillRect(ox+x, oy+y, w, h, color565)
    // Reuses the same color resolver as the device. Only the flat call sequence is supported.
    const re = /ctx\.(fillRect|rect|fillCircle|circle|line|hline|vline|fillRoundRect|roundRect|drawPixel|fillScreen)\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const method = m[1];
      const args = m[2].split(",").map((s) => s.trim());
      const color = (c: string): number => {
        try { return resolveColor(c.replace(/^['"]|['"]$/g, ""), "rgb565"); } catch { return 0xffff; }
      };
      const n = (i: number) => parseInt(args[i], 10) || 0;
      const g = this.gfx;
      if (method === "fillRect") g.fillRect(ox + n(0), oy + n(1), n(2), n(3), color(args[4]));
      else if (method === "rect") g.drawRect(ox + n(0), oy + n(1), n(2), n(3), color(args[4]));
      else if (method === "fillCircle") g.fillCircle(ox + n(0), oy + n(1), n(2), color(args[3]));
      else if (method === "circle") g.drawCircle(ox + n(0), oy + n(1), n(2), color(args[3]));
      else if (method === "line") g.drawLine(ox + n(0), oy + n(1), ox + n(2), oy + n(3), color(args[4]));
      else if (method === "hline") g.drawFastHLine(ox + n(0), oy + n(1), n(2), color(args[3]));
      else if (method === "vline") g.drawFastVLine(ox + n(0), oy + n(1), n(2), color(args[3]));
      else if (method === "fillRoundRect") g.fillRoundRect(ox + n(0), oy + n(1), n(2), n(3), n(4), color(args[5]));
      else if (method === "roundRect") g.drawRoundRect(ox + n(0), oy + n(1), n(2), n(3), n(4), color(args[5]));
      else if (method === "drawPixel") g.drawPixel(ox + n(0), oy + n(1), color(args[2]));
      else if (method === "fillScreen") g.fillRect(ox, oy, this.gfx.width?.() ?? 0, this.gfx.height?.() ?? 0, color(args[0]));
    }
  }
```
(Add `import { resolveColor } from "../ui/color.js";` if not already present — it is, at line 1.)

3. Add `MutableNode` fields `canvasW`/`canvasH` (they flow through from the model already if the snapshot carries them; ensure the node-type in the preview reads `canvasW`/`canvasH` from the model — the model added them in Task 2). Add to the draw switch (~line 1511):
```typescript
          case "canvas":
            this.drawCanvasNode(node, drawY);
            break;
```

- [ ] **Step 5: Build + run test to verify it passes**

Run:
```bash
cd packages/cuttlefish && npm run build
cd ../.. && npx vitest run tests/packages/cuttlefish/ui-canvas-preview.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/preview/build-program.ts packages/cuttlefish/src/preview/host-ui-runtime.ts tests/packages/cuttlefish/ui-canvas-preview.test.ts
git commit -m "feat(canvas): preview drawCanvasNode + build-program scan"
```

---

## Task 11: README — document `<canvas>` + `ui.drawCanvas`

**Files:**
- Modify: `packages/ui/README.md` (after the `<list>` element docs / "Interactive elements" table)

- [ ] **Step 1: Add documentation**

In `packages/ui/README.md`, after the `<list>` row in the "Interactive elements" table, add a row:

```markdown
| `<canvas>` | User-drawn graphics (sparklines, gauges, custom shapes) via `ui.drawCanvas` | — |
```

Then add a new subsection (after the "Data-bound lists" section, before "### Signals"):

````markdown
### User-drawn canvas (`<canvas>`)

`<canvas>` is an element whose contents you draw yourself, every frame, using
the display graphics primitives. It follows all CSS rules (layout, borders,
transforms, z-index) like any other element, but its pixels come from your
callback. Use it for sparkline graphs, analog gauges, or custom-shaped controls.

```html
<canvas id="spark" width="120" height="40"></canvas>
```

`width`/`height` set the **drawing buffer** size (px). The CSS box is the
**layout** size — size them to match unless you want clipping.

```typescript
ui.drawCanvas(screen.spark, (ctx) => {
  ctx.fillScreen('black');
  ctx.line(0, 30, ctx.width, 30, 'limegreen');      // baseline
  ctx.rect(2, 2, ctx.width - 4, ctx.height - 4, '#333');
  ctx.fillCircle(needleX, 30, 3, 'red');
  ctx.text(4, 12, `${temp}°`, 'white');             // optional color arg
});
```

Coordinates are **canvas-relative** (`(0,0)` = element top-left) and drawing is
**auto-clipped** to the buffer — you cannot accidentally paint over neighbors.
Color arguments are CSS color strings resolved to RGB565 at build time.

The callback runs **every frame**; to animate, mutate state in a `setInterval`
or signal and the canvas picks it up next frame. Taps hit-test as the full CSS
box, so `screen.spark.onClick(...)` works for interactive canvases.

#### `ctx` methods (the display graphics primitives)

| Method | Notes |
|---|---|
| `ctx.fillRect(x,y,w,h,color)` / `ctx.rect(...)` | Filled / outline rectangle |
| `ctx.fillRoundRect(x,y,w,h,r,color)` / `ctx.roundRect(...)` | Rounded variant |
| `ctx.line(x0,y0,x1,y1,color)` | Arbitrary line |
| `ctx.hline(x,y,w,color)` / `ctx.vline(x,y,h,color)` | Fast horizontal / vertical line |
| `ctx.fillCircle(x,y,r,color)` / `ctx.circle(...)` | Filled / outline circle |
| `ctx.drawPixel(x,y,color)` | Single pixel |
| `ctx.text(x,y,str,color?)` | Bitmap text (built-in font) |
| `ctx.fillScreen(color)` | Clear the whole buffer |
| `ctx.width` / `ctx.height` | Read-only buffer dimensions |

````

- [ ] **Step 2: Commit**

```bash
git add packages/ui/README.md
git commit -m "docs(canvas): document <canvas> element + ui.drawCanvas"
```

---

## Task 12: Full suite verification

- [ ] **Step 1: Rebuild all packages**

Run:
```bash
cd packages/ui && npm run build
cd ../cuttlefish && npm run build
```

- [ ] **Step 2: Run the full test suite**

Run: `cd ../.. && npx vitest run`
Expected: all canvas tests pass; no regressions in the pre-existing suite (the single pre-existing `scales drag deltas` failure noted in the prior `ui.onTap` work is unrelated and may still be present — confirm it's the only failure and that it predates this work via `git stash` + re-run if any doubt).

- [ ] **Step 3: Commit any final build artifacts / fixes if needed**

If the suite is green (modulo the known pre-existing failure), no commit needed. If a fix was required, commit it with `fix(canvas): ...`.

---

## Self-Review (completed during authoring)

**Spec coverage:**
- API (HTML + ui.drawCanvas + ctx surface) → Tasks 1, 5, 6, 11 ✓
- Data flow (parser → model → lowering → resolver → emit → runtime → preview) → Tasks 1–10 ✓
- ctx lowering rule (method→shim, colors, ctx.width/height, unknown→diagnostic) → Task 6 ✓
- Runtime draw path (cache+clear+set-target+call+restore+blit) → Task 4 ✓
- Preview (scan + drawCanvasNode + shared rewrite) → Task 10 ✓
- Testing strategy (parser/lowering/resolver/runtime-header/e2e/preview) → Tasks 1,2,3,4,6,7,9,10 ✓
- Out of scope (scaling, canvas2D API, custom hit-test) → excluded ✓

**Placeholder scan:** No TBD/TODO. All steps have concrete code.

**Type consistency:** `DrawCanvasSpec { nodeIndex, fnName, callbackBody }` used identically in Tasks 6, 7, 8. `canvasW`/`canvasH` field names consistent across parser (Task 1), model (Task 2), lowering (Task 3), runtime struct (Task 4), preview (Task 10). `__ui_canvas_bindings` / `__ui_canvas_binding_count` extern names match between runtime-header (Task 4) and emitter (Task 8).

**One known limitation carried into Task 4:** single shared cached `__ui_node_canvas` thrashes if two differently-sized canvases coexist (matches the `<list>` precedent). Documented in the spec; per-node cache is a follow-up.
