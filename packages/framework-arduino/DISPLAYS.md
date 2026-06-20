# Adding a Display Driver

How to add a new display driver (e.g. SSD1306, ST7789) to TypeHAL's graphics
layer. The ILI9341 driver in `src/graphics/ili9341.ts` is the reference
implementation — read it alongside this guide.

## How it fits together

```
.ui.html/.ui.css  →  transpile-time lowering  →  DisplayHALOp nodes
                                                        ↓
                          framework strategy.resolveDisplayOp(op)
                                                        ↓
                              your driver: op → C++ for the panel
```

The transpiler lowers every draw to one of five **`DisplayHALOp`** nodes (see
`@typecad/cuttlefish/api/shared`). Your driver translates each op to the
panel-specific C++. Colors are already resolved to your declared color format
at transpile time, so you receive a ready-to-write color value.

## The five ops

| Op | Fields | What your driver does |
|---|---|---|
| `display.init` | `bus, cs, dc, rst, width, height, driver` | Reset sequence + bus init |
| `display.fill_rect` | `x, y, w, h, color` | Set address window, push `w*h` color pixels |
| `display.draw_text` | `x, y, text, fontId, color` | Blit glyphs from the font table |
| `display.draw_rect` | `x, y, w, h, color` | Draw a 1px outline (or 4 fill_rects) |
| `display.flush` | `rects[]` | Push dirty rects; no-op if your panel is immediate |

Colors arrive pre-resolved to your `colorFormat()`: a uint16 for `rgb565`
targets, or `0`/`1` for `mono` targets. You never convert colors at runtime.

## Step-by-step: adding a driver

### 1. Create the resolver module

Create `src/graphics/<driver>.ts` (e.g. `ssd1306.ts`). Export a resolver with
this signature:

```typescript
import type { DisplayHALOp } from "@typecad/cuttlefish/api/shared";

export interface SSD1306Context {
  bus: string; cs: number; dc: number; rst: number; width: number; height: number;
}

export function resolveSSD1306Op(
  op: DisplayHALOp,
  ctx: SSD1306Context,
): { code?: string; expression?: string } | undefined {
  switch (op.operation) {
    case "display.init":   /* reset + Wire.begin() */      return { code: "..." };
    case "display.fill_rect": /* page-byte writes */        return { code: "..." };
    case "display.draw_text": /* glyph blit to page buffer */ return { code: "..." };
    case "display.draw_rect": /* 1px outline */             return { code: "..." };
    case "display.flush":   /* push page buffer over I2C */ return { code: "..." };
    default: return undefined;
  }
}
```

### 2. Expose the export

In `package.json`, add to `exports`:

```json
"./graphics/ssd1306": {
  "types": "./dist/graphics/ssd1306.d.ts",
  "default": "./dist/graphics/ssd1306.js"
}
```

### 3. Wire into the framework strategy

In `src/strategy.ts`, extend `resolveDisplayOp` to dispatch on the driver id
and declare support. Capture the bus/pin context from `display.init` so later
ops address the right pins:

```typescript
import { resolveSSD1306Op } from "./graphics/ssd1306";

// In ArduinoStrategy:
private _displayCtx: ILI9341Context | SSD1306Context | null = null;
private _activeDriver: string | null = null;

resolveDisplayOp(op: DisplayHALOp) {
  if (op.operation === "display.init") {
    this._displayCtx = { bus: op.bus, cs: op.cs, dc: op.dc, rst: op.rst,
                         width: op.width, height: op.height };
    this._activeDriver = op.driver;
  }
  if (!this._displayCtx) return undefined;
  if (this._activeDriver === "ssd1306") return resolveSSD1306Op(op, this._displayCtx);
  if (this._activeDriver === "ili9341") return resolveILI9341Op(op, this._displayCtx);
  return undefined;
}

supportedDisplayDrivers() {
  return new Set(["ili9341", "ssd1306"]);
}
```

### 4. Declare the color format

Mono panels (SSD1306) declare `mono`; color panels declare `rgb565`. This drives
transpile-time color resolution — your driver receives `0`/`1` for mono or a
uint16 for color:

```typescript
colorFormat() {
  return "mono";   // SSD1306
}
```

### 5. Test the resolver

Mirror `tests/packages/framework-arduino/ili9341.test.ts`:

```typescript
import { resolveSSD1306Op } from "@typecad/framework-arduino/graphics/ssd1306";

it("fill_rect writes page bytes over I2C", () => {
  const out = resolveSSD1306Op(/* fill_rect op */, ctx)!.code!;
  expect(out).toContain("Wire.write");
});
```

## Mount-time validation

`ui.mount({ display: 'ssd1306' })` is validated against
`supportedDisplayDrivers()` **at transpile time**. An unsupported driver
errors in the editor — same fail-fast philosophy as the pin-conflict checks.
No runtime crashes on the board.

## Reference: ILI9341 vs SSD1306

| | ILI9341 (implemented) | SSD1306 (example fast-follow) |
|---|---|---|
| Bus | SPI | I2C |
| Color | rgb565 (uint16) | mono (1-bit) |
| Flush | no-op (immediate) | page write |
| Addressing | column/row window | page/column |
| RAM budget | framebufferless (draws go straight to panel) | framebufferless (dirty pages) |

## Per-target capacity

`graphicsCapacity()` returns the retained-tree limits for the architecture
(`maxNodes`, `maxBindings`, `maxActiveTransitions`, `nodeStorage`). If an
author's `.ui.html` tree exceeds `maxNodes` for the active target, the
transpiler emits a build-time diagnostic — not a runtime crash.
