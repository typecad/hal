# `<canvas>` element — user-drawn graphics via the display shim

**Date:** 2026-06-27
**Status:** Approved (Sections 1–5)
**Scope:** New `<canvas>` HTML element + `ui.drawCanvas` registration call.

## Problem

The UI elements cover standard controls (button, check, text, progress, range,
list, img). There is no way for a user to draw their own graphics — a sparkline
graph, an analog gauge, or a custom-shaped control. The display shim already
exposes a clean set of GFX primitives (`drawLine`, `fillRect`, `fillCircle`,
text, etc.), but those are only reachable from the internal runtime, never from
author code. This feature exposes them through a CSS-laid-out `<canvas>` element
whose contents a user callback draws every frame.

## Decision summary (from brainstorming)

- **Draw API shape:** `ui.drawCanvas(node, (ctx) => { ... })` — a callback that
  draws onto a `ctx` handle. Mirrors `ui.bindList`.
- **Redraw model:** every frame (like `ui.bind`). Animate by mutating state; the
  callback re-reads it next frame.
- **Coords & clipping:** canvas-relative (`(0,0)` = element top-left), auto-clipped
  to the buffer — exactly like `<list>` today (draw to offscreen canvas, blit).
- **Interaction:** rectangular hit-test over the full CSS box; reuses the
  existing `onClick`/`onHold`/`onRelease`.
- **Approach:** A — compile-time `ctx` method rewrite. `ctx` is a lowering
  fiction; the callback body lowers to `ui_display_*` shim calls against the
  node's offscreen canvas. Reuses the proven `<list>` allocate→draw→blit→clip
  runtime mechanism.

## API

HTML:
```html
<canvas id="spark" width="120" height="40"></canvas>
```
`width`/`height` attrs set the **drawing buffer** size (px). The CSS box
(via `width:`/`height:` in CSS) is the **layout** size. If CSS does not size
the element, the buffer size is used. Follows all CSS rules (borders,
transforms, z-index, transitions, `:pressed`) like every other element.

Authoring (`main.ts`):
```ts
ui.drawCanvas(screen.spark, (ctx) => {
  ctx.fillScreen('black');
  ctx.line(0, 30, ctx.width, 30, 'limegreen');       // baseline
  ctx.rect(2, 2, ctx.width - 4, ctx.height - 4, '#333');
  ctx.fillCircle(needleX, 30, 3, 'red');
  ctx.text(4, 12, `${temp}°`, 'white');              // optional color
});
```

### `ctx` surface (exactly the display shim primitives)

| Method | Underlying shim |
|---|---|
| `ctx.drawPixel(x,y,color)` | drawPixel |
| `ctx.fillRect(x,y,w,h,color)` | fillRect |
| `ctx.rect(x,y,w,h,color)` | drawRect |
| `ctx.fillRoundRect(x,y,w,h,r,color)` | fillRoundRect |
| `ctx.roundRect(x,y,w,h,r,color)` | drawRoundRect |
| `ctx.line(x0,y0,x1,y1,color)` | drawLine |
| `ctx.hline(x,y,w,color)` / `ctx.vline(x,y,h,color)` | drawFastHLine / drawFastVLine |
| `ctx.fillCircle(x,y,r,color)` / `ctx.circle(x,y,r,color)` | fillCircle / drawCircle |
| `ctx.rgbBitmap(x,y,data,w,h)` | drawRGBBitmap |
| `ctx.text(x,y,str,color?)` | setCursor + setTextColor + print |
| `ctx.fillScreen(color)` | fillScreen |
| `ctx.width` / `ctx.height` | read-only buffer dimensions |

### Rules

- **Relative coords.** `(0,0)` = element top-left. The runtime owns absolute
  positioning, transforms, z-index, and overlap repair.
- **Auto-clip.** Drawing outside `0..ctx.width / 0..ctx.height` is clipped
  (drawn to an offscreen buffer, then blitted — same as `<list>` today).
- **Color args** are CSS color strings (`'red'`, `'#0f0'`, `'rgb(...)'`)
  resolved to RGB565 at transpile time via the existing callback color resolver.
  A missing color uses a default (`fg`).
- **Every-frame redraw.** To animate, mutate state in `setInterval`/signals;
  the callback re-reads it next frame.
- **Interaction.** `screen.spark.onClick(...)` works unchanged. Hit-test is the
  full CSS box (rectangular).

## Data flow

```
Authoring:     <canvas id="spark">  +  ui.drawCanvas(screen.spark, (ctx) => {...})
HTML parser:   tag "canvas" → kind "canvas"; width/height attrs → canvasW/canvasH
Lowering:      cppKind("canvas") → NODE_CANVAS; node row emitted like NODE_FILL
Resolver:      method==="drawCanvas" → resolveDrawCanvasCall
                 • resolveNodeIndex (like onClick)
                 • lower arrow body via ctx-aware lowering
                 • record DrawCanvasSpec { nodeIndex, callbackBody }
Emit:          void __ui_canvas_draw_N(CuttlefishCanvas16*) { <callbackBody> }
               __ui_canvas_bindings[] = { {node, fn}, ... }
Runtime:       UINodeKind += NODE_CANVAS; struct UICanvasBinding
               ui_tick: dirty+visible canvas node → cache+clear canvas →
                 set as draw target → call fn() → restore target → blit at box
```

## Why this design

- **`NODE_LIST` is the blueprint.** It already allocates a `CuttlefishCanvas16`,
  casts it to `CuttlefishDisplayTarget*`, draws into it, and blits it clipped to
  its box. `NODE_CANVAS` is the same mechanism — the only difference is that the
  user supplies the draw calls via a lowered callback instead of the runtime's
  list-renderer.
- **`ctx` is a compile-time fiction.** At the C++ level the callback draws into
  the node's canvas set as the active `__ui_gfx` target, so `ctx.line(...)`
  lowers to the same `ui_display_draw_line(...)` wrapper every other draw path
  uses. No runtime `ctx` object, no vtable, one draw-target model.
- **Dirty/overlap.** A canvas node is dirty every frame (always-redraw), so the
  existing dirty traversal repaints it and `ui_mark_overlapping_higher_layers_dirty`
  repairs higher-z neighbors it changed under — no new dirty logic.

## Layers (implementation)

1. **`packages/cuttlefish/src/ui/html-parser.ts`** + **`model.ts`** — tag
   `canvas` → kind `canvas`; parse `width`/`height` attrs into `canvasW`/`canvasH`.
   Add `canvas` to `SUPPORTED_TAGS`.
2. **`packages/cuttlefish/src/ui/model.ts`** — `UINodeModel.kind` gains
   `"canvas"`; carry `canvasW`/`canvasH`.
3. **`packages/cuttlefish/src/ir/transformers/ui-lowering.ts`** —
   `cppKind("canvas")` → `NODE_CANVAS`. Add `canvasW`/`canvasH` fields to the
   `UINode` struct (dedicated `uint16_t` fields — clarity over the 4-byte cost;
   `rangeMin/rangeMax` reuse is rejected to avoid overloading unrelated fields).
4. **`packages/ui/src/types.ts`** — add `CanvasElement` type (like
   `ProgressElement`: has `.value`, `onClick/onHold/onRelease`).
5. **`packages/ui/src/index.ts`** — `ui.drawCanvas(node, callback)` declaration;
   add to `ui`.
6. **Resolver + ctx lowering** (`ui-call-resolver.ts`, new shared rewrite module)
   — `resolveDrawCanvasCall`; ctx method→shim rewrite table; color resolution.
7. **Emit** (`ui-emitter.ts`) — emit `__ui_canvas_draw_N` functions +
   `__ui_canvas_bindings[]` table + count.
8. **Runtime** (`runtime-header.ts`) — `NODE_CANVAS` kind, `UICanvasBinding`
   struct, the `case NODE_CANVAS` draw path (cache+clear+set-target+call+restore+blit).
9. **Preview** (`build-program.ts`, `host-ui-runtime.ts`, shared rewrite module)
   — scan `ui.drawCanvas` calls; `drawCanvasNode` sibling of `drawListNode`;
   shared `ctx` rewrite so device and preview stay identical.

## The `ctx` lowering rule

For each statement in the callback body, if it is a `ctx.method(args)` call, map
it to the matching `ui_display_*` shim call:

```
ctx.fillRect(x, y, w, h, 'red')          → ui_display_fill_rect(x, y, w, h, 0xf800)
ctx.line(0, 30, ctx.width, 30, 'limegreen')
                                          → ui_display_draw_line(0, 30, __ui_canvas_w, 30, 0x07e0)
ctx.text(4, 12, `${temp}°`, 'white')
                                          → ui_display_set_cursor(4, 12);
                                            ui_display_set_text_color_solid(0xffff);
                                            ui_display_print("${temp}°");
```

Argument handling:
1. **Numeric expressions** → `expressionToIR` (so `temp + 1`, `i * step`, signal
   reads all work).
2. **Color strings** → RGB565 hex via the existing color resolver (same as the
   callback color-literal path).
3. **`ctx.width` / `ctx.height`** → `__ui_canvas_w` / `__ui_canvas_h` locals set
   by the emitted wrapper from the node's buffer dims.
4. **String args (for `text`)** → C++ string literals; template-string
   interpolation (`${temp}`) via the existing interpolation path.

Unknown `ctx` method → diagnostic `ui-canvas-method`; statement skipped (expected
— the surface is deliberately the shim only).

Each `DrawCanvasSpec` becomes a `void __ui_canvas_draw_N(CuttlefishCanvas16* __c)`
wrapper: it sets `__ui_gfx = (CuttlefishDisplayTarget*)__c` and the
`__ui_canvas_w/h` locals, then runs the lowered body, so the body uses the same
`ui_display_*` wrappers as everything else.

## Runtime draw path

```cpp
case NODE_CANVAS: {
  void (*drawFn)(CuttlefishCanvas16*) = nullptr;
  for (uint8_t b = 0; b < __ui_canvas_binding_count; b++)
    if (__ui_canvas_bindings[b].node == i) { drawFn = __ui_canvas_bindings[b].fn; break; }
  if (!drawFn) break;
  int16_t cw = __ui_nodes[i].canvasW;
  int16_t ch = __ui_nodes[i].canvasH;
  // Cache a canvas sized to the buffer (reused across frames, like __ui_list_canvas).
  static CuttlefishCanvas16* __ui_node_canvas = nullptr;
  ... allocate/resize on change ...
  display_canvasFillScreen(__ui_node_canvas, __ui_nodes[i].clearColor);
  CuttlefishDisplayTarget* prev = ui_display_get_target();
  ui_display_set_target((CuttlefishDisplayTarget*)__ui_node_canvas);
  drawFn(__ui_node_canvas);
  ui_display_set_target(prev);
  ui_draw_canvas_rect(__ui_node_canvas, __ui_nodes[i].box.x, drawY, cw, ch);
  break;
}
```

- **Clear before draw.** Every frame starts from `clearColor` so a gauge redraws
  cleanly without the callback erasing trails. A callback may call
  `ctx.fillScreen('black')` to override.
- **Target save/restore.** The callback draws into the canvas; a buggy callback
  cannot corrupt the display target. Matches `ui_seed_paint_canvas_for_node`.
- **Buffer ≠ layout size.** Canvas is `canvasW×canvasH`; blitted at the CSS box
  origin, clipped to the box. **v1 blits 1:1 (no scaling)** — if the buffer is
  larger than the box it is clipped; if smaller, the excess box area is not
  filled by the blit (the user should size the buffer to match the CSS box, or
  accept the clipping). The `<img>` sampler machinery (true scale-to-fit) is
  deferred.
- **Canvas cache.** A single static `__ui_node_canvas` resized on demand — same
  pattern as `__ui_list_canvas`. **Known limitation:** two differently-sized
  canvas nodes coexisting will thrash the cache (resize every frame). v1 accepts
  this to match the list precedent; a per-node cache is a documented follow-up
  if multiple canvases are common.

## Preview

- **Snapshot** (`build-program.ts`): scan `ui.drawCanvas` calls → record
  `CanvasBindingSpec { nodeId, nodeIndex, drawBody }` (callback source text,
  preserved like `listBindings.itemExpression`).
- **Host runtime** (`host-ui-runtime.ts`): parse `canvas` kind; add
  `drawCanvasNode(node, drawY)` sibling of `drawListNode` (acquire sub-canvas,
  swap gfx target, run lowered body, restore, blit clipped to box); add
  `case "canvas":` to the draw switch.
- **Shared `ctx` rewrite.** One module — `rewriteCanvasCalls(body, backend)` —
  maps `ctx.X(...)` to the right target call for both backends: C++ emits
  `ui_display_fill_rect(...)`, preview calls `sub.fillRect(...)`. Same method
  table, same color resolution → device and preview behavior identical by
  construction.
- **Preview control flow.** Runs the same lowered, flat statement sequence the
  device does (signal reads, color resolution, primitive calls). Loops/`if` in
  the callback are not supported — same constraint as today's `bindList` item
  expressions. Documented.

## Out of scope (YAGNI)

- Scaling canvas buffer to a differently-sized CSS box (v1 blits 1:1, clipped).
- HTML-canvas-2D-style methods (`beginPath`/`moveTo`/`lineTo`/`stroke`/`fill`,
  `measureText`, `save`/`restore`, gradients, transforms, compositing).
- Custom-shape (non-rectangular) hit-testing.
- Per-node canvas cache (v1 uses one shared cached canvas).
- Loops/`if` inside the draw callback (flat statement sequence only).
- demo-ui user code.

## Testing

- **Parser/lowering:** `<canvas>` → kind `canvas`; `cppKind` → `NODE_CANVAS`;
  width/height → canvasW/canvasH on the node row.
- **Resolver + ctx lowering:** `ui.drawCanvas(node, cb)` → `DrawCanvasSpec`;
  each `ctx.method(...)` rewrites to the right `ui_display_*` call; colors
  resolve to RGB565; `ctx.width/height` → `__ui_canvas_w/h`; unknown method →
  diagnostic.
- **Runtime-header:** `NODE_CANVAS` in the enum; `UICanvasBinding` struct
  declared; `case NODE_CANVAS` present with the cache+clear+set-target+blit.
- **E2E transpile:** a `<canvas>` + `ui.drawCanvas` program emits the binding
  table + a `__ui_canvas_draw_N` function containing `ui_display_*` calls.
- **Preview:** tapping/dirty on a canvas node runs the draw body and blits.
