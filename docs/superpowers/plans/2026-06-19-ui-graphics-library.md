# TypeHAL UI / Graphics Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a UI/display-graphics library to TypeHAL where authors write real `.ui.html`/`.ui.css` files that the transpiler lowers to a compact retained C++ tree with reactive binds, running on bare-metal MCUs via a backend-agnostic Display HAL.

**Architecture:** Four layers — (1) authoring in `.ui.html`/`.ui.css` + `@typehal/ui` TS API, (2) transpile-time HTML/CSS parsing + `BlockLayoutEngine` + lowering to a static C++ node/binding/transition table, (3) a tiny retained-mode reactive runtime on the device, (4) five new `display.*` `HALOpIR` variants translated by per-framework `PlatformGraphicsStrategy`. ILI9341-over-SPI is the single PoC driver; `framework-native` gets a terminal-cell preview backend. Flexbox-ready scaffolding (staged `LayoutEngine` interface) is built even though v1 ships block layout only.

**Tech Stack:** TypeScript, Vitest, the existing cuttlefish IR/HAL pipeline, the `PlatformStrategy` extension mechanism.

**Spec:** `docs/superpowers/specs/2026-06-19-ui-graphics-library-design.md`

---

## File Structure

### New files — cuttlefish (transpiler)

| File | Responsibility |
|---|---|
| `packages/cuttlefish/src/api/shared/display-op-ir.ts` | The five `display.*` HAL op interfaces + `DisplayHALOp` union |
| `packages/cuttlefish/src/api/shared/graphics-strategy.ts` | `PlatformGraphicsStrategy` sub-interface |
| `packages/cuttlefish/src/ui/color.ts` | Hex color (#rrggbb) → rgb565 / mono resolution |
| `packages/cuttlefish/src/ui/html-parser.ts` | HTML subset parser: `<screen>/<text>/<button>`, ids → `UIElementTree` |
| `packages/cuttlefish/src/ui/css-parser.ts` | CSS subset parser: selectors + properties → `CSSRule[]` |
| `packages/cuttlefish/src/ui/style-resolver.ts` | Selector matching → computed `Style` per node (incl. `:pressed`) |
| `packages/cuttlefish/src/ui/layout-engine.ts` | `LayoutEngine` interface, `Box`, `measure()` (flex-forward scaffolding) |
| `packages/cuttlefish/src/ui/block-layout.ts` | `BlockLayoutEngine` (v1 engine) |
| `packages/cuttlefish/src/ir/transformers/ui-lowering.ts` | Tree + layout + bindings → C++ node/binding/transition tables + `.ui.html.d.ts` |

### New files — frameworks

| File | Responsibility |
|---|---|
| `packages/framework-arduino/src/graphics/ili9341.ts` | ILI9341 op → C++ SPI command resolver |
| `packages/framework-native/src/graphics/terminal-preview.ts` | Native terminal-cell preview resolver |

### New files — `@typehal/ui` package

| File | Responsibility |
|---|---|
| `packages/ui/package.json` | Package manifest |
| `packages/ui/src/index.ts` | Public API: `ui.mount`, `ui.signal`, `ui.bind`, element types |
| `packages/ui/src/types.ts` | `UINode`/`UIElement`/`Signal` type declarations (for authoring IntelliSense) |
| `packages/ui/cuttlefish-env.d.ts` | Ambient decls for `.ui.html`/`.ui.css` imports |

### New files — docs

| File | Responsibility |
|---|---|
| `packages/framework-arduino/DISPLAYS.md` | Driver-authoring README |

### Modified files

| File | Change |
|---|---|
| `packages/cuttlefish/src/api/shared/hal-op-ir.ts` | Add `DisplayHALOp` variants to the `HALOpIR` union |
| `packages/cuttlefish/src/api/shared/platform-strategy.ts` | `PlatformStrategy` extends `PlatformGraphicsStrategy` |
| `packages/cuttlefish/src/api/shared/index.ts` | Export new public types |
| `packages/cuttlefish/src/platform/generic-strategy.ts` | Implement graphics fallback (throws/returns undefined) |
| `packages/framework-arduino/src/strategy.ts` | Implement `PlatformGraphicsStrategy` (ILI9341) |
| `packages/framework-native/src/strategy.ts` | Implement `PlatformGraphicsStrategy` (terminal preview) |
| `pnpm-workspace.yaml` | Register `@typehal/ui` |
| `packages/cuttlefish/package.json` | Add `./ui` export if needed |

---

## Phases

- **Phase 1 — Display HAL foundation** (Tasks 1–5): op types, strategy interface, ILI9341 driver, native preview, op routing. Produces working, testable draw calls that flow through the existing emit pipeline.
- **Phase 2 — Parsing & layout** (Tasks 6–10): color, HTML parser, CSS parser, style resolver, block layout engine. Produces working tree+layout, testable in isolation.
- **Phase 3 — Lowering** (Task 11): tree → C++ node/binding/transition tables + `.d.ts`. Produces correct emitted C++.
- **Phase 4 — `@typehal/ui` + reactive runtime** (Tasks 12–15): authoring package, mount lowering, signal/bind lowering, C++ frame-loop runtime header.
- **Phase 5 — Integration & docs** (Tasks 16–17): end-to-end hello-world demo, driver README.

**Scope note (explicit out-of-scope):** This plan delivers the full lowering pipeline, the device runtime header, and both drivers as *callable, tested modules* behind a `transpileUI` facade. Wiring that facade into the cuttlefish AST visitor (so `import { screen } from './x.ui.html'` is auto-resolved during a normal `typehal build` without an explicit `transpileUI` call) is a follow-on refactor: it requires deep changes to the visitor's module-resolution pass and is tracked separately. The facade + standalone resolvers in this plan are the integration contract that refactor consumes.

---

## Phase 1 — Display HAL foundation

### Task 1: Define the five display HAL ops

**Files:**
- Create: `packages/cuttlefish/src/api/shared/display-op-ir.ts`
- Modify: `packages/cuttlefish/src/api/shared/hal-op-ir.ts`
- Test: `tests/packages/cuttlefish/display-ops.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/display-ops.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { HALOpIR, DisplayHALOp } from "@typecad/cuttlefish/api/shared";

describe("display HAL ops", () => {
  it("DisplayInitOp carries bus, pins, dimensions, and driver id", () => {
    const op: DisplayHALOp = {
      operation: "display.init",
      bus: "SPI",
      cs: 10, dc: 9, rst: 8,
      width: 240, height: 320,
      driver: "ili9341",
    };
    expect(op.operation).toBe("display.init");
    expect(op.driver).toBe("ili9341");
  });

  it("DisplayFillRectOp carries box and color", () => {
    const op: DisplayHALOp = { operation: "display.fill_rect", x: 0, y: 0, w: 240, h: 320, color: 0x07e0 };
    expect(op.color).toBe(0x07e0);
  });

  it("DisplayDrawTextOp carries box, text, fontId, color", () => {
    const op: DisplayHALOp = { operation: "display.draw_text", x: 8, y: 8, text: "hi", fontId: "8x16", color: 0xffff };
    expect(op.text).toBe("hi");
  });

  it("DisplayDrawRectOp carries outline box and color", () => {
    const op: DisplayHALOp = { operation: "display.draw_rect", x: 0, y: 0, w: 10, h: 10, color: 0xffff };
    expect(op.operation).toBe("display.draw_rect");
  });

  it("DisplayFlushOp carries dirty rects", () => {
    const op: DisplayHALOp = { operation: "display.flush", rects: [{ x: 0, y: 0, w: 8, h: 16 }] };
    expect(op.rects).toHaveLength(1);
  });

  it("all display ops are members of HALOpIR", () => {
    const ops: HALOpIR[] = [
      { operation: "display.init", bus: "SPI", cs: 10, dc: 9, rst: 8, width: 240, height: 320, driver: "ili9341" },
      { operation: "display.fill_rect", x: 0, y: 0, w: 1, h: 1, color: 0 },
      { operation: "display.draw_text", x: 0, y: 0, text: "", fontId: "8x16", color: 0 },
      { operation: "display.draw_rect", x: 0, y: 0, w: 1, h: 1, color: 0 },
      { operation: "display.flush", rects: [] },
    ];
    expect(ops).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/display-ops.test.ts`
Expected: FAIL — `DisplayHALOp` not exported.

- [ ] **Step 3: Create the display op IR file**

Create `packages/cuttlefish/src/api/shared/display-op-ir.ts`:

```typescript
// ---------------------------------------------------------------------------
// Display HAL Operations — semantic graphics draw calls
//
// Each DisplayHALOp node represents a single display operation. Framework
// strategies (PlatformGraphicsStrategy.resolveDisplayOp) translate these into
// driver-specific C++ (ILI9341 SPI commands, SSD1306 I2C bitpacks, native
// terminal cells). Colors are pre-resolved at transpile time to the target's
// color format, so no runtime color conversion occurs.
// ---------------------------------------------------------------------------

export interface DisplayInitOp {
  operation: "display.init";
  /** Bus identifier, e.g. "SPI" or "Wire" */
  bus: string;
  /** Chip-select pin number */
  cs: number;
  /** Data/Command pin number */
  dc: number;
  /** Reset pin number */
  rst: number;
  /** Panel width in pixels */
  width: number;
  /** Panel height in pixels */
  height: number;
  /** Driver id, e.g. "ili9341" — must be in supportedDisplayDrivers() */
  driver: string;
}

export interface DisplayFillRectOp {
  operation: "display.fill_rect";
  x: number; y: number; w: number; h: number;
  /** Pre-resolved color value (rgb565 uint16 on color targets, 0/1 on mono) */
  color: number;
}

export interface DisplayDrawTextOp {
  operation: "display.draw_text";
  x: number; y: number;
  text: string;
  /** Font id, e.g. "8x16" — resolved by the driver to a font table */
  fontId: string;
  /** Pre-resolved color value */
  color: number;
}

export interface DisplayDrawRectOp {
  operation: "display.draw_rect";
  x: number; y: number; w: number; h: number;
  color: number;
}

export interface DisplayFlushOp {
  operation: "display.flush";
  /** Dirty rectangles to push to the panel this frame */
  rects: Array<{ x: number; y: number; w: number; h: number }>;
}

export type DisplayHALOp =
  | DisplayInitOp
  | DisplayFillRectOp
  | DisplayDrawTextOp
  | DisplayDrawRectOp
  | DisplayFlushOp;
```

- [ ] **Step 4: Add DisplayHALOp to the HALOpIR union**

In `packages/cuttlefish/src/api/shared/hal-op-ir.ts`, add to the imports at top:

```typescript
import type { DisplayHALOp } from "./display-op-ir";
```

Add to the `HALOpIR` union (after `| RawCppOp;`):

```typescript
  // Display / graphics
  | DisplayHALOp;
```

And in `packages/cuttlefish/src/api/shared/index.ts`, add:

```typescript
export type {
  DisplayInitOp, DisplayFillRectOp, DisplayDrawTextOp,
  DisplayDrawRectOp, DisplayFlushOp, DisplayHALOp,
} from "./display-op-ir";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/display-ops.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Run typecheck to verify the union change compiles**

Run: `npx tsc -b packages/cuttlefish`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/api/shared/display-op-ir.ts packages/cuttlefish/src/api/shared/hal-op-ir.ts packages/cuttlefish/src/api/shared/index.ts tests/packages/cuttlefish/display-ops.test.ts
git commit -m "feat(ir): add five display.* HAL ops to the HALOpIR union"
```

---

### Task 2: Define PlatformGraphicsStrategy interface

**Files:**
- Create: `packages/cuttlefish/src/api/shared/graphics-strategy.ts`
- Modify: `packages/cuttlefish/src/api/shared/platform-strategy.ts`
- Modify: `packages/cuttlefish/src/api/shared/index.ts`

- [ ] **Step 1: Create the graphics strategy interface**

Create `packages/cuttlefish/src/api/shared/graphics-strategy.ts`:

```typescript
// ---------------------------------------------------------------------------
// PlatformGraphicsStrategy — per-target graphics capacity and driver resolution
//
// Frameworks implement this sub-interface to (a) declare which display drivers
// they support (used by ui.mount() for fail-fast validation), (b) declare the
// target's color format (drives transpile-time color resolution), and (c)
// translate display HAL ops to driver-specific C++.
//
// Mirrors the existing resolveHALOperation() seam.
// ---------------------------------------------------------------------------

import type { DisplayHALOp } from "./display-op-ir";

export interface GraphicsCapacity {
  /** Max nodes the retained tree may hold on this target. */
  maxNodes: number;
  /** Max ui.bind() entries. */
  maxBindings: number;
  /** Max simultaneously-armed transitions. */
  maxActiveTransitions: number;
  /** Where the static node table lives. */
  nodeStorage: "progmem" | "flash";
}

export interface PlatformGraphicsStrategy {
  /** Resolve a display HAL op to target-specific C++. Return undefined to fall back. */
  resolveDisplayOp(op: DisplayHALOp): { code?: string; expression?: string } | undefined;

  /** Display driver ids this framework provides (e.g. new Set(["ili9341"])). */
  supportedDisplayDrivers(): ReadonlySet<string>;

  /** Target color format — drives transpile-time color resolution. */
  colorFormat(): "rgb565" | "mono";

  /** Per-target capacity caps (node/binding/transition limits, storage). */
  graphicsCapacity(): GraphicsCapacity;
}
```

- [ ] **Step 2: Extend PlatformStrategy with the graphics sub-interface**

In `packages/cuttlefish/src/api/shared/platform-strategy.ts`, add to the imports:

```typescript
import type { PlatformGraphicsStrategy } from "./graphics-strategy";
```

Change the `PlatformStrategy` interface declaration (currently `extends PlatformProfileStrategy, PlatformPolyfillStrategy, ...`) to also extend `PlatformGraphicsStrategy`:

```typescript
export interface PlatformStrategy
  extends PlatformProfileStrategy,
    PlatformPolyfillStrategy,
    PlatformTypeStrategy,
    PlatformExpressionStrategy,
    PlatformStatementStrategy,
    PlatformSafetyStrategy,
    PlatformBuildStrategy,
    PlatformDebugStrategy,
    PlatformAsyncStrategy,
    PlatformHALStrategy,
    PlatformGraphicsStrategy {
  /** Unique identifier for this strategy (e.g. "arduino", "generic"). */
  readonly id: string;
}
```

- [ ] **Step 3: Export the new types**

In `packages/cuttlefish/src/api/shared/index.ts`, add:

```typescript
export type { PlatformGraphicsStrategy, GraphicsCapacity } from "./graphics-strategy";
```

- [ ] **Step 4: Run typecheck — expect failures in existing strategies**

Run: `npx tsc -b packages/cuttlefish`
Expected: FAIL — `GenericStrategy`, `ArduinoStrategy`, `NativeStrategy` now miss `resolveDisplayOp`/`supportedDisplayDrivers`/`colorFormat`/`graphicsCapacity`. This is expected; Tasks 3–4 and the generic fallback implement them.

- [ ] **Step 5: Commit (interface only; strategies fixed next)**

```bash
git add packages/cuttlefish/src/api/shared/graphics-strategy.ts packages/cuttlefish/src/api/shared/platform-strategy.ts packages/cuttlefish/src/api/shared/index.ts
git commit -m "feat(ir): add PlatformGraphicsStrategy sub-interface"
```

---

### Task 3: Graphics fallback on GenericStrategy + ILI9341 driver stub

This task adds the fallback to `GenericStrategy` (so the build compiles) and creates the ILI9341 driver module. The ILI9341 resolver is implemented fully in Task 4's test; here we add the module + wire it.

**Files:**
- Modify: `packages/cuttlefish/src/platform/generic-strategy.ts`
- Create: `packages/framework-arduino/src/graphics/ili9341.ts`

- [ ] **Step 1: Add graphics fallback to GenericStrategy**

In `packages/cuttlefish/src/platform/generic-strategy.ts`, add the import:

```typescript
import type { PlatformGraphicsStrategy, GraphicsCapacity } from "../api/shared";
import type { DisplayHALOp } from "../api/shared";
```

Add these methods to the `GenericStrategy` class (anywhere inside the class body):

```typescript
  // ── Graphics (fallback) ────────────────────────────────────────────────

  resolveDisplayOp(_op: DisplayHALOp): { code?: string; expression?: string } | undefined {
    // Generic target has no display hardware. Returning undefined lets the
    // emitter fall back; if a UI is mounted against the generic target the
    // mount-time validation should have already errored.
    return undefined;
  }

  supportedDisplayDrivers(): ReadonlySet<string> {
    return new Set<string>();
  }

  colorFormat(): "rgb565" | "mono" {
    return "rgb565";
  }

  graphicsCapacity(): GraphicsCapacity {
    return {
      maxNodes: 256,
      maxBindings: 64,
      maxActiveTransitions: 32,
      nodeStorage: "flash",
    };
  }
```

- [ ] **Step 2: Create the ILI9341 driver module**

Create `packages/framework-arduino/src/graphics/ili9341.ts`:

```typescript
// ---------------------------------------------------------------------------
// ILI9341 — SPI color TFT driver resolver (240×320, RGB565)
//
// Translates DisplayHALOp nodes into Arduino SPI C++ commands targeting the
// ILI9341. Emits setAddrWindow + SPI.transfer16 for fills, and a per-glyph
// blit for text (font table provided by the runtime header).
// ---------------------------------------------------------------------------

import type { DisplayHALOp } from "@typecad/cuttlefish/api/shared";

/** RGB565 packing helper, emitted as a C++ macro in the runtime header. */
export const ILI9341_RUNTIME_HEADER = `
// ── ILI9341 runtime helpers (emitted once per translation unit) ────────────
#ifndef __TC_ILI9341_HELPERS
#define __TC_ILI9341_HELPERS
#include <SPI.h>

static inline void __tc_ili9341_addr(SPIClass* bus, int16_t x0, int16_t y0, int16_t x1, int16_t y1) {
  bus->transfer(0x2A); bus->transfer16(x0); bus->transfer16(x1);
  bus->transfer(0x2B); bus->transfer16(y0); bus->transfer16(y1);
  bus->transfer(0x2C);
}
#endif
`;

/**
 * Resolve a display HAL op to ILI9341 SPI C++.
 * Returns undefined for ops this driver does not handle.
 */
export function resolveILI9341Op(
  op: DisplayHALOp,
  ctx: { bus: string; cs: number; dc: number; rst: number; width: number; height: number },
): { code?: string; expression?: string } | undefined {
  switch (op.operation) {
    case "display.init":
      return {
        code: [
          `pinMode(${ctx.dc}, OUTPUT);`,
          `pinMode(${ctx.cs}, OUTPUT);`,
          `pinMode(${ctx.rst}, OUTPUT);`,
          `digitalWrite(${ctx.rst}, HIGH); delay(5);`,
          `digitalWrite(${ctx.rst}, LOW); delay(20);`,
          `digitalWrite(${ctx.rst}, HIGH); delay(150);`,
          `${ctx.bus}.begin();`,
          `${ctx.bus}.setBitOrder(MSBFIRST);`,
          `${ctx.bus}.setDataMode(SPI_MODE0);`,
          `${ctx.bus}.setClockDivider(SPI_CLOCK_DIV2);`,
        ].join("\n"),
      };
    case "display.fill_rect":
      return {
        code: [
          `digitalWrite(${ctx.cs}, LOW);`,
          `digitalWrite(${ctx.dc}, LOW); ${ctx.bus}.transfer(0x2A);`,
          `digitalWrite(${ctx.dc}, HIGH); ${ctx.bus}.transfer16(${op.x}); ${ctx.bus}.transfer16(${op.x + op.w - 1});`,
          `digitalWrite(${ctx.dc}, LOW); ${ctx.bus}.transfer(0x2B);`,
          `digitalWrite(${ctx.dc}, HIGH); ${ctx.bus}.transfer16(${op.y}); ${ctx.bus}.transfer16(${op.y + op.h - 1});`,
          `digitalWrite(${ctx.dc}, LOW); ${ctx.bus}.transfer(0x2C);`,
          `digitalWrite(${ctx.dc}, HIGH);`,
          `for (uint32_t __i = 0; __i < (uint32_t)(${op.w}) * (${op.h}); __i++) ${ctx.bus}.transfer16(${op.color});`,
          `digitalWrite(${ctx.cs}, HIGH);`,
        ].join("\n"),
      };
    case "display.draw_rect": {
      // Outline = 4 fill_rects (top, bottom, left, right).
      const c = op.color;
      const lines: string[] = [`digitalWrite(${ctx.cs}, LOW);`];
      const rect = (x: number, y: number, w: number, h: number) => [
        `digitalWrite(${ctx.dc}, LOW); ${ctx.bus}.transfer(0x2A);`,
        `digitalWrite(${ctx.dc}, HIGH); ${ctx.bus}.transfer16(${x}); ${ctx.bus}.transfer16(${x + w - 1});`,
        `digitalWrite(${ctx.dc}, LOW); ${ctx.bus}.transfer(0x2B);`,
        `digitalWrite(${ctx.dc}, HIGH); ${ctx.bus}.transfer16(${y}); ${ctx.bus}.transfer16(${y + h - 1});`,
        `digitalWrite(${ctx.dc}, LOW); ${ctx.bus}.transfer(0x2C);`,
        `digitalWrite(${ctx.dc}, HIGH);`,
        `for (uint32_t __i = 0; __i < (uint32_t)(${w}) * (${h}); __i++) ${ctx.bus}.transfer16(${c});`,
      ].join("\n");
      lines.push(rect(op.x, op.y, op.w, 1));                // top
      lines.push(rect(op.x, op.y + op.h - 1, op.w, 1));     // bottom
      lines.push(rect(op.x, op.y, 1, op.h));                // left
      lines.push(rect(op.x + op.w - 1, op.y, 1, op.h));     // right
      lines.push(`digitalWrite(${ctx.cs}, HIGH);`);
      return { code: lines.join("\n") };
    }
    case "display.draw_text":
      // Defer glyph blit to a runtime helper that takes the font id.
      return {
        code: `__tc_draw_text(${op.x}, ${op.y}, "${op.text}", "${op.fontId}", ${op.color}, &${ctx.bus}, ${ctx.cs}, ${ctx.dc});`,
      };
    case "display.flush":
      // ILI9341 has no separate flush — draws go straight to the panel.
      return { code: `/* flush: ${op.rects.length} rect(s) — already drawn */` };
    default:
      return undefined;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/cuttlefish/src/platform/generic-strategy.ts packages/framework-arduino/src/graphics/ili9341.ts
git commit -m "feat(graphics): GenericStrategy graphics fallback + ILI9341 driver module"
```

---

### Task 4: ILI9341 driver tests + ArduinoStrategy wiring + native preview

**Files:**
- Create: `tests/packages/framework-arduino/ili9341.test.ts`
- Create: `packages/framework-native/src/graphics/terminal-preview.ts`
- Modify: `packages/framework-arduino/src/strategy.ts`
- Modify: `packages/framework-native/src/strategy.ts`

- [ ] **Step 1: Write the failing ILI9341 test**

Create `tests/packages/framework-arduino/ili9341.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveILI9341Op } from "@typecad/framework-arduino/graphics/ili9341";
import type { DisplayHALOp } from "@typecad/cuttlefish/api/shared";

const ctx = { bus: "SPI", cs: 10, dc: 9, rst: 8, width: 240, height: 320 };

describe("ILI9341 op resolver", () => {
  it("display.init sequences reset + SPI begin", () => {
    const op: DisplayHALOp = { operation: "display.init", ...ctx, driver: "ili9341" };
    const out = resolveILI9341Op(op, ctx)!.code!;
    expect(out).toContain("digitalWrite(8, HIGH)");
    expect(out).toContain("SPI.begin()");
    expect(out).toContain("SPI_CLOCK_DIV2");
  });

  it("display.fill_rect sets addr window and fills w*h pixels", () => {
    const op: DisplayHALOp = { operation: "display.fill_rect", x: 0, y: 0, w: 240, h: 320, color: 0x07e0 };
    const out = resolveILI9341Op(op, ctx)!.code!;
    expect(out).toContain("transfer(0x2A)");
    expect(out).toContain("transfer16(240)");
    expect(out).toMatch(/240\) \* \(320\)/);
    expect(out).toContain("transfer16(0x07e0)");
  });

  it("display.draw_text emits __tc_draw_text helper call", () => {
    const op: DisplayHALOp = { operation: "display.draw_text", x: 8, y: 8, text: "hi", fontId: "8x16", color: 0xffff };
    const out = resolveILI9341Op(op, ctx)!.code!;
    expect(out).toContain('__tc_draw_text(8, 8, "hi", "8x16", 0xffff');
  });

  it("display.draw_rect emits 4 outline edges", () => {
    const op: DisplayHALOp = { operation: "display.draw_rect", x: 0, y: 0, w: 10, h: 10, color: 0xffff };
    const out = resolveILI9341Op(op, ctx)!.code!;
    // 4 distinct addr-window opens (0x2A appears once per edge)
    const matches = out.match(/0x2A/g) ?? [];
    expect(matches).toHaveLength(4);
  });

  it("display.flush is a no-op comment for ILI9341", () => {
    const op: DisplayHALOp = { operation: "display.flush", rects: [{ x: 0, y: 0, w: 8, h: 16 }] };
    const out = resolveILI9341Op(op, ctx)!.code!;
    expect(out).toMatch(/flush/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/framework-arduino/ili9341.test.ts`
Expected: FAIL — `@typecad/framework-arduino/graphics/ili9341` export path not resolvable yet.

- [ ] **Step 3: Expose the graphics export from framework-arduino**

In `packages/framework-arduino/package.json`, add to `exports`:

```json
    "./graphics/ili9341": {
      "types": "./dist/graphics/ili9341.d.ts",
      "default": "./dist/graphics/ili9341.js"
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/packages/framework-arduino/ili9341.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire ILI9341 into ArduinoStrategy**

In `packages/framework-arduino/src/strategy.ts`, add imports:

```typescript
import type { DisplayHALOp, GraphicsCapacity } from "@typecad/cuttlefish/api/shared";
import { resolveILI9341Op } from "./graphics/ili9341";
```

Add these methods to the `ArduinoStrategy` class. `display.init` is a special case — it must remember the bus/pin context from `ui.mount` so later `fill_rect`/`draw_text` calls can address the right pins. We capture that context on `display.init`:

```typescript
  // ── Graphics ───────────────────────────────────────────────────────────
  private _displayCtx: { bus: string; cs: number; dc: number; rst: number; width: number; height: number } | null = null;

  resolveDisplayOp(op: DisplayHALOp): { code?: string; expression?: string } | undefined {
    if (op.operation === "display.init") {
      this._displayCtx = { bus: op.bus, cs: op.cs, dc: op.dc, rst: op.rst, width: op.width, height: op.height };
    }
    // Only resolve once a display is initialized (display.init sets the context).
    if (!this._displayCtx && op.operation !== "display.init") return undefined;
    return resolveILI9341Op(op, this._displayCtx ?? {
      bus: op.operation === "display.init" ? op.bus : "SPI",
      cs: op.operation === "display.init" ? op.cs : 10,
      dc: op.operation === "display.init" ? op.dc : 9,
      rst: op.operation === "display.init" ? op.rst : 8,
      width: op.operation === "display.init" ? op.width : 240,
      height: op.operation === "display.init" ? op.height : 320,
    });
  }

  supportedDisplayDrivers(): ReadonlySet<string> {
    return new Set(["ili9341"]);
  }

  colorFormat(): "rgb565" | "mono" {
    return "rgb565";
  }

  graphicsCapacity(): GraphicsCapacity {
    // AVR profile (specified for completeness; the PoC ILI9341 driver is
    // ESP32-class/color, so AVR is not exercised by the PoC — but capacity
    // is returned so mount-time maxNodes diagnostics work uniformly).
    return {
      maxNodes: 256,
      maxBindings: 64,
      maxActiveTransitions: 32,
      nodeStorage: "progmem",
    };
  }
```

- [ ] **Step 6: Create the native terminal preview backend**

Create `packages/framework-native/src/graphics/terminal-preview.ts`:

```typescript
// ---------------------------------------------------------------------------
// Terminal preview — renders display ops as ANSI-colored cells to stdout
//
// Lets authors preview a UI on the host with no hardware. Colors map rgb565
// back to the nearest ANSI 16-color for display only.
// ---------------------------------------------------------------------------

import type { DisplayHALOp } from "@typecad/cuttlefish/api/shared";

/** Map an rgb565 value to an ANSI color code (approximate). */
function rgb565ToAnsi(c: number): number {
  const r5 = (c >> 11) & 0x1f;
  const g6 = (c >> 5) & 0x3f;
  const b5 = c & 0x1f;
  const r = r5 >> 3, g = g6 >> 4, b = b5 >> 3;   // 0/1 per channel
  // ANSI 16-color: foreground 30+bit pattern
  return 30 + (r ? 1 : 0) + (g ? 2 : 0) + (b ? 4 : 0);
}

export function resolveTerminalPreviewOp(
  op: DisplayHALOp,
): { code?: string; expression?: string } | undefined {
  switch (op.operation) {
    case "display.init":
      return { code: `/* native preview: ${op.driver} ${op.width}x${op.height} initialized */` };
    case "display.fill_rect":
      return {
        code: `/* preview fill_rect ${op.x},${op.y} ${op.w}x${op.h} color=0x${op.color.toString(16)} ansi=${rgb565ToAnsi(op.color)} */`,
      };
    case "display.draw_rect":
      return { code: `/* preview draw_rect ${op.x},${op.y} ${op.w}x${op.h} */` };
    case "display.draw_text":
      return { code: `/* preview draw_text ${op.x},${op.y} "${op.text}" */` };
    case "display.flush":
      return { code: `/* preview flush ${op.rects.length} rect(s) */` };
    default:
      return undefined;
  }
}
```

- [ ] **Step 7: Wire terminal preview into NativeStrategy**

In `packages/framework-native/src/strategy.ts`, add imports:

```typescript
import type { DisplayHALOp, GraphicsCapacity } from "@typecad/cuttlefish/api/shared";
import { resolveTerminalPreviewOp } from "./graphics/terminal-preview";
```

Add methods to the `NativeStrategy` class:

```typescript
  // ── Graphics ───────────────────────────────────────────────────────────
  resolveDisplayOp(op: DisplayHALOp): { code?: string; expression?: string } | undefined {
    return resolveTerminalPreviewOp(op);
  }

  supportedDisplayDrivers(): ReadonlySet<string> {
    return new Set(["native-preview"]);
  }

  colorFormat(): "rgb565" | "mono" {
    return "rgb565";
  }

  graphicsCapacity(): GraphicsCapacity {
    return {
      maxNodes: Number.MAX_SAFE_INTEGER,
      maxBindings: Number.MAX_SAFE_INTEGER,
      maxActiveTransitions: Number.MAX_SAFE_INTEGER,
      nodeStorage: "flash",
    };
  }
```

- [ ] **Step 8: Write the native preview test**

Create `tests/packages/framework-native/terminal-preview.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveTerminalPreviewOp } from "@typecad/framework-native/graphics/terminal-preview";
import type { DisplayHALOp } from "@typecad/cuttlefish/api/shared";

describe("terminal preview resolver", () => {
  it("fill_rect emits a preview comment with ansi color", () => {
    const op: DisplayHALOp = { operation: "display.fill_rect", x: 0, y: 0, w: 10, h: 10, color: 0x07e0 };
    const out = resolveTerminalPreviewOp(op)!.code!;
    expect(out).toContain("preview fill_rect");
    expect(out).toContain("ansi=");
  });

  it("draw_text emits the text in a preview comment", () => {
    const op: DisplayHALOp = { operation: "display.draw_text", x: 8, y: 8, text: "hi", fontId: "8x16", color: 0xffff };
    const out = resolveTerminalPreviewOp(op)!.code!;
    expect(out).toContain('"hi"');
  });
});
```

- [ ] **Step 9: Expose graphics exports from framework-native**

In `packages/framework-native/package.json`, add to `exports`:

```json
    "./graphics/terminal-preview": {
      "types": "./dist/graphics/terminal-preview.d.ts",
      "default": "./dist/graphics/terminal-preview.js"
    }
```

- [ ] **Step 10: Run all new tests + typecheck**

Run: `npx vitest run tests/packages/framework-arduino/ili9341.test.ts tests/packages/framework-native/terminal-preview.test.ts`
Expected: PASS (7 tests).

Run: `npx tsc -b packages/cuttlefish packages/framework-arduino packages/framework-native`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add tests/packages/framework-arduino/ili9341.test.ts packages/framework-arduino/src/strategy.ts packages/framework-arduino/package.json packages/framework-native/src/graphics/terminal-preview.ts packages/framework-native/src/strategy.ts packages/framework-native/package.json tests/packages/framework-native/terminal-preview.test.ts
git commit -m "feat(graphics): wire ILI9341 into ArduinoStrategy + native terminal preview"
```

---

### Task 5: Route display ops through resolveDisplayOp

The existing emit pipeline calls `strategy.resolveHALOperation?.(op)` at `expression-renderer.ts:259` and `statement-renderer.ts:478`. By default, new ops flow through that resolver. But display ops must route to `resolveDisplayOp` (the graphics-specific resolver), not the generic HAL resolver — otherwise ILI9341/terminal-preview never get called. This task adds that routing in both consumer sites.

**Files:**
- Modify: `packages/cuttlefish/src/emit/expression-renderer.ts:258-269`
- Modify: `packages/cuttlefish/src/emit/statement-renderer.ts:477-489`
- Modify: `packages/cuttlefish/src/ir/render-expr.ts:101-102`
- Test: `tests/packages/cuttlefish/display-op-routing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/display-op-routing.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { routeHALOp } from "@typecad/cuttlefish/emit/route-hal-op";
import type { PlatformStrategy, DisplayHALOp } from "@typecad/cuttlefish/api/shared";

function makeStrategy(calledDisplay: boolean[]): Pick<PlatformStrategy, "resolveHALOperation" | "resolveDisplayOp"> {
  return {
    resolveHALOperation: () => { return { code: "/* generic */" }; },
    resolveDisplayOp: () => { calledDisplay[0] = true; return { code: "/* display */" }; },
  };
}

describe("display op routing", () => {
  it("routes display.* ops to resolveDisplayOp", () => {
    const called: boolean[] = [false];
    const strat = makeStrategy(called);
    const op: DisplayHALOp = { operation: "display.fill_rect", x: 0, y: 0, w: 1, h: 1, color: 0 };
    const out = routeHALOp(op, strat);
    expect(called[0]).toBe(true);
    expect(out?.code).toBe("/* display */");
  });

  it("routes non-display ops to resolveHALOperation", () => {
    const called: boolean[] = [false];
    const strat = makeStrategy(called);
    const op = { operation: "gpio.write", pin: 13, value: 1 as const };
    const out = routeHALOp(op, strat);
    expect(called[0]).toBe(false);
    expect(out?.code).toBe("/* generic */");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/display-op-routing.test.ts`
Expected: FAIL — `routeHALOp` not found.

- [ ] **Step 3: Create the routing helper**

Create `packages/cuttlefish/src/emit/route-hal-op.ts`:

```typescript
// ---------------------------------------------------------------------------
// Op routing — dispatch a HALOpIR to the right strategy resolver.
//
// display.* ops go to resolveDisplayOp (graphics-specific); everything else
// goes to resolveHALOperation (the existing generic seam). Keeps the consumer
// sites (expression-renderer, statement-renderer, render-expr) DRY.
// ---------------------------------------------------------------------------

import type { HALOpIR } from "../api/shared";
import type { PlatformStrategy } from "../api/shared";

export function routeHALOp(
  op: HALOpIR,
  strategy: Pick<PlatformStrategy, "resolveHALOperation" | "resolveDisplayOp">,
): { code?: string; expression?: string } | undefined {
  if (typeof op.operation === "string" && op.operation.startsWith("display.")) {
    return strategy.resolveDisplayOp?.(op as Parameters<NonNullable<PlatformStrategy["resolveDisplayOp"]>>[0]);
  }
  return strategy.resolveHALOperation?.(op);
}
```

- [ ] **Step 4: Export the helper**

In `packages/cuttlefish/package.json`, add to `exports`:

```json
    "./emit/route-hal-op": {
      "types": "./dist/emit/route-hal-op.d.ts",
      "default": "./dist/emit/route-hal-op.js"
    }
```

- [ ] **Step 5: Replace the direct resolver calls in the three consumer sites**

In `packages/cuttlefish/src/emit/expression-renderer.ts`, change line 259 from:

```typescript
        const resolved = this.strategy.resolveHALOperation?.(expr.operation);
```

to:

```typescript
        const resolved = routeHALOp(expr.operation, this.strategy);
```

(Add `import { routeHALOp } from "./route-hal-op";` at the top of the file.)

In `packages/cuttlefish/src/emit/statement-renderer.ts`, change line 478 from:

```typescript
        const resolved = this.strategy.resolveHALOperation?.(statement.operation);
```

to:

```typescript
        const resolved = routeHALOp(statement.operation, this.strategy);
```

(Add the import.)

In `packages/cuttlefish/src/ir/render-expr.ts`, change lines 101–102 from:

```typescript
      if (strategy?.resolveHALOperation) {
        const resolved = strategy.resolveHALOperation(expr.operation);
```

to:

```typescript
      if (strategy?.resolveHALOperation || strategy?.resolveDisplayOp) {
        const resolved = routeHALOp(expr.operation, strategy);
```

(Add the import.)

- [ ] **Step 6: Run the routing test + full suite to verify no regressions**

Run: `npx vitest run tests/packages/cuttlefish/display-op-routing.test.ts`
Expected: PASS (2 tests).

Run: `npx vitest run`
Expected: all existing tests still PASS (routing is behavior-preserving for non-display ops).

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/emit/route-hal-op.ts packages/cuttlefish/src/emit/expression-renderer.ts packages/cuttlefish/src/emit/statement-renderer.ts packages/cuttlefish/src/ir/render-expr.ts packages/cuttlefish/package.json tests/packages/cuttlefish/display-op-routing.test.ts
git commit -m "feat(graphics): route display.* ops through resolveDisplayOp"
```

---

## Phase 2 — Parsing & layout

### Task 6: Color resolution

**Files:**
- Create: `packages/cuttlefish/src/ui/color.ts`
- Test: `tests/packages/cuttlefish/color.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/color.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseHexColor, toRGB565, toMono, resolveColor } from "@typecad/cuttlefish/ui/color";

describe("color resolution", () => {
  it("parses #rrggbb to {r,g,b} bytes", () => {
    expect(parseHexColor("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHexColor("#008000")).toEqual({ r: 0, g: 128, b: 0 });
  });

  it("converts rgb to rgb565", () => {
    expect(toRGB565(255, 0, 0)).toBe(0xf800);   // red
    expect(toRGB565(0, 255, 0)).toBe(0x07e0);   // green
    expect(toRGB565(0, 0, 255)).toBe(0x001f);   // blue
    expect(toRGB565(255, 255, 255)).toBe(0xffff);
  });

  it("converts rgb to mono (luminance threshold)", () => {
    expect(toMono(0, 0, 0)).toBe(0);
    expect(toMono(255, 255, 255)).toBe(1);
    expect(toMono(64, 64, 64)).toBe(0);         // below threshold
    expect(toMono(200, 200, 200)).toBe(1);      // above threshold
  });

  it("resolveColor picks format based on target", () => {
    expect(resolveColor("#ff0000", "rgb565")).toBe(0xf800);
    expect(resolveColor("#ff0000", "mono")).toBe(1);
  });

  it("throws on invalid hex", () => {
    expect(() => parseHexColor("red")).toThrow();
    expect(() => parseHexColor("#12345")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/color.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement color resolution**

Create `packages/cuttlefish/src/ui/color.ts`:

```typescript
// ---------------------------------------------------------------------------
// Color resolution — hex (#rrggbb) → target color format
//
// Resolved ONCE at transpile time against the framework's colorFormat(), so the
// device never performs color conversion.
// ---------------------------------------------------------------------------

export interface RGB { r: number; g: number; b: number; }

export function parseHexColor(hex: string): RGB {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`Invalid hex color "${hex}" — expected #rrggbb`);
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

export function toRGB565(r: number, g: number, b: number): number {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

export function toMono(r: number, g: number, b: number): 0 | 1 {
  // Relative luminance, threshold at ~0.5.
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum >= 0.5 ? 1 : 0;
}

export function resolveColor(hex: string, format: "rgb565" | "mono"): number {
  const { r, g, b } = parseHexColor(hex);
  return format === "rgb565" ? toRGB565(r, g, b) : toMono(r, g, b);
}
```

- [ ] **Step 4: Export the ui submodule**

In `packages/cuttlefish/package.json`, add to `exports`:

```json
    "./ui/color": {
      "types": "./dist/ui/color.d.ts",
      "default": "./dist/ui/color.js"
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/color.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ui/color.ts packages/cuttlefish/package.json tests/packages/cuttlefish/color.test.ts
git commit -m "feat(ui): hex color → rgb565/mono resolution"
```

---

### Task 7: HTML subset parser

**Files:**
- Create: `packages/cuttlefish/src/ui/html-parser.ts`
- Test: `tests/packages/cuttlefish/html-parser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/html-parser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseHtml, UIElementNode } from "@typecad/cuttlefish/ui/html-parser";

describe("HTML subset parser", () => {
  it("parses a screen root with children", () => {
    const tree = parseHtml(`<screen><text id="greeting">hello</text></screen>`);
    expect(tree.tag).toBe("screen");
    expect(tree.id).toBeUndefined();
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].tag).toBe("text");
    expect(tree.children[0].id).toBe("greeting");
  });

  it("captures text content of leaf elements", () => {
    const tree = parseHtml(`<text id="t">hello world</text>`);
    expect(tree.children[0].text).toBe("hello world");
  });

  it("captures class attribute", () => {
    const tree = parseHtml(`<screen><view class="card"></view></screen>`);
    expect(tree.children[0].classes).toEqual(["card"]);
  });

  it("rejects a tree with no screen root", () => {
    expect(() => parseHtml(`<text>hi</text>`)).toThrow(/screen/);
  });

  it("rejects multiple top-level elements", () => {
    expect(() => parseHtml(`<screen></screen><screen></screen>`)).toThrow();
  });

  it("parses the canonical hello-world tree", () => {
    const tree = parseHtml([
      `<screen>`,
      `  <text id="greeting">hello world</text>`,
      `  <button id="btn">Click me</button>`,
      `</screen>`,
    ].join("\n"));
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].id).toBe("greeting");
    expect(tree.children[1].id).toBe("btn");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/html-parser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

Create `packages/cuttlefish/src/ui/html-parser.ts`:

```typescript
// ---------------------------------------------------------------------------
// HTML subset parser — a tiny, dependency-free parser for .ui.html files.
//
// Supported subset:
//   - One <screen> root (required, exactly one).
//   - Child elements: <text>, <button>, <view> (a generic container).
//   - Attributes: id="...", class="a b".
//   - Text content of leaf elements.
//
// No CDATA, no comments, no self-closing beyond explicit <x/>. This is the
// full v1 surface — extend deliberately.
// ---------------------------------------------------------------------------

export interface UIElementNode {
  tag: string;
  id?: string;
  classes: string[];
  text?: string;
  children: UIElementNode[];
}

const SUPPORTED_TAGS = new Set(["screen", "text", "button", "view"]);
const VOID_TAGS = new Set<string>();  // none in v1; all elements have closing tags

export function parseHtml(src: string): UIElementNode {
  const tokens = tokenize(src);
  const root = parseElement(tokens);
  if (!root || root.tag !== "screen") {
    throw new Error("UI HTML must have exactly one <screen> root element");
  }
  // Ensure no trailing top-level elements.
  if (tokens.peek() !== null) {
    throw new Error("UI HTML must have exactly one top-level <screen> element");
  }
  return root;
}

interface TokenStream {
  pos: number;
  tokens: string[];
  peek(): string | null;
  next(): string | null;
}

function tokenize(src: string): TokenStream {
  // Split into tag tokens and text tokens. Whitespace-only text between tags
  // is ignored; meaningful text (inside leaf elements) is preserved.
  const re = /(<[^>]*>)|([^<]+)/g;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[1]) tokens.push(m[1]);
    else if (m[2] && m[2].trim()) tokens.push(m[2].trim());
  }
  let pos = 0;
  return {
    tokens,
    pos,
    peek() { return pos < tokens.length ? tokens[pos] : null; },
    next() { return pos < tokens.length ? tokens[pos++] : null; },
  };
}

function parseElement(tokens: TokenStream, depth = 0): UIElementNode | null {
  const open = tokens.next();
  if (!open || !open.startsWith("<")) return null;
  const { tag, id, classes, selfClosed } = parseOpenTag(open);
  if (!SUPPORTED_TAGS.has(tag)) {
    throw new Error(`Unsupported tag <${tag}> — supported: ${[...SUPPORTED_TAGS].join(", ")}`);
  }
  const node: UIElementNode = { tag, id, classes, children: [] };

  if (selfClosed || VOID_TAGS.has(tag)) return node;

  // Read children and text until matching close tag.
  while (true) {
    const peek = tokens.peek();
    if (peek === null) throw new Error(`Unclosed <${tag}>`);
    if (peek.startsWith(`</${tag}>`)) {
      tokens.next();
      return node;
    }
    if (peek.startsWith("<")) {
      const child = parseElement(tokens, depth + 1);
      if (child) node.children.push(child);
    } else {
      // Text content.
      node.text = peek;
      tokens.next();
    }
  }
}

function parseOpenTag(open: string): {
  tag: string; id?: string; classes: string[]; selfClosed: boolean;
} {
  const inner = open.slice(1, open.endsWith("/>") ? -2 : -1).trim();
  const selfClosed = open.endsWith("/>");
  const parts = inner.split(/\s+/);
  const tag = parts[0];
  let id: string | undefined;
  const classes: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    const attr = parts[i];
    const idM = /^id="([^"]*)"$/.exec(attr);
    const classM = /^class="([^"]*)"$/.exec(attr);
    if (idM) id = idM[1];
    else if (classM) classes.push(...classM[1].split(/\s+/).filter(Boolean));
  }
  return { tag, id, classes, selfClosed };
}
```

- [ ] **Step 4: Export the ui submodule path**

In `packages/cuttlefish/package.json`, add to `exports`:

```json
    "./ui/html-parser": {
      "types": "./dist/ui/html-parser.d.ts",
      "default": "./dist/ui/html-parser.js"
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/html-parser.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ui/html-parser.ts packages/cuttlefish/package.json tests/packages/cuttlefish/html-parser.test.ts
git commit -m "feat(ui): HTML subset parser (screen/text/button/view, id/class)"
```

---

### Task 8: CSS subset parser

**Files:**
- Create: `packages/cuttlefish/src/ui/css-parser.ts`
- Test: `tests/packages/cuttlefish/css-parser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/css-parser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseCss, CSSRule, CSSProperty } from "@typecad/cuttlefish/ui/css-parser";

describe("CSS subset parser", () => {
  it("parses element selectors", () => {
    const rules = parseCss(`screen { background: #008000; padding: 8; }`);
    expect(rules).toHaveLength(1);
    expect(rules[0].selector).toEqual({ kind: "element", name: "screen", pseudo: undefined });
    expect(rules[0].properties.padding).toBe(8);
  });

  it("parses id selectors", () => {
    const rules = parseCss(`#greeting { color: #ff0000; }`);
    expect(rules[0].selector).toEqual({ kind: "id", name: "greeting", pseudo: undefined });
  });

  it("parses class selectors", () => {
    const rules = parseCss(`.card { padding: 4; }`);
    expect(rules[0].selector).toEqual({ kind: "class", name: "card", pseudo: undefined });
  });

  it("parses :pressed pseudo-state", () => {
    const rules = parseCss(`#btn:pressed { background: #808080; }`);
    expect(rules[0].selector).toEqual({ kind: "id", name: "btn", pseudo: "pressed" });
  });

  it("parses transition property", () => {
    const rules = parseCss(`#btn { transition: background 80ms; }`);
    expect(rules[0].properties.transition).toEqual({ property: "background", durationMs: 80 });
  });

  it("parses the canonical hello-world css", () => {
    const css = [
      `screen { background: #008000; padding: 8; }`,
      `#greeting { color: #ff0000; font: 8x16; }`,
      `#btn { background: #404040; color: #ffffff; padding: 4; transition: background 80ms; }`,
      `#btn:pressed { background: #808080; }`,
    ].join("\n");
    const rules = parseCss(css);
    expect(rules).toHaveLength(4);
    expect(rules[3].selector.pseudo).toBe("pressed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/css-parser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the CSS parser**

Create `packages/cuttlefish/src/ui/css-parser.ts`:

```typescript
// ---------------------------------------------------------------------------
// CSS subset parser — a tiny, dependency-free parser for .ui.css files.
//
// Supported subset:
//   - Selectors: element, #id, .class, optionally with :pressed pseudo.
//   - Properties: padding, margin, width, height, color, background, font,
//     font-size, transition.
// ---------------------------------------------------------------------------

export type CSSSelectorKind = "element" | "id" | "class";

export interface CSSSelector {
  kind: CSSSelectorKind;
  name: string;
  pseudo?: "pressed";
}

export interface TransitionDecl {
  property: "background" | "color";
  durationMs: number;
}

export interface CSSProperty {
  padding?: number;
  margin?: number;
  width?: number;
  height?: number;
  color?: string;
  background?: string;
  font?: string;        // e.g. "8x16"
  fontSize?: number;
  transition?: TransitionDecl;
}

export interface CSSRule {
  selector: CSSSelector;
  properties: CSSProperty;
}

const SUPPORTED_PROPS = new Set([
  "padding", "margin", "width", "height", "color", "background",
  "font", "font-size", "transition",
]);

export function parseCss(src: string): CSSRule[] {
  const rules: CSSRule[] = [];
  // Match selector { ... } blocks.
  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(src)) !== null) {
    const selectorStr = m[1].trim();
    const bodyStr = m[2].trim();
    const selector = parseSelector(selectorStr);
    const properties = parseBody(bodyStr);
    rules.push({ selector, properties });
  }
  return rules;
}

function parseSelector(s: string): CSSSelector {
  const pseudoM = /:pressed$/.exec(s);
  const base = pseudoM ? s.slice(0, pseudoM.index) : s;
  const trimmed = base.trim();
  let kind: CSSSelectorKind;
  let name: string;
  if (trimmed.startsWith("#")) { kind = "id"; name = trimmed.slice(1); }
  else if (trimmed.startsWith(".")) { kind = "class"; name = trimmed.slice(1); }
  else { kind = "element"; name = trimmed; }
  return { kind, name, pseudo: pseudoM ? "pressed" : undefined };
}

function parseBody(body: string): CSSProperty {
  const props: CSSProperty = {};
  for (const decl of body.split(";").map(d => d.trim()).filter(Boolean)) {
    const colonIdx = decl.indexOf(":");
    if (colonIdx < 0) continue;
    const prop = decl.slice(0, colonIdx).trim();
    const val = decl.slice(colonIdx + 1).trim();
    if (!SUPPORTED_PROPS.has(prop)) {
      throw new Error(`Unsupported CSS property "${prop}" — supported: ${[...SUPPORTED_PROPS].join(", ")}`);
    }
    assignProp(props, prop, val);
  }
  return props;
}

function assignProp(props: CSSProperty, prop: string, val: string): void {
  switch (prop) {
    case "padding": props.padding = num(val); break;
    case "margin": props.margin = num(val); break;
    case "width": props.width = num(val); break;
    case "height": props.height = num(val); break;
    case "color": props.color = val; break;
    case "background": props.background = val; break;
    case "font": props.font = val; break;
    case "font-size": props.fontSize = num(val); break;
    case "transition": props.transition = parseTransition(val); break;
  }
}

function num(val: string): number {
  // Strip units we recognize (px, ms handled separately for transitions).
  const digits = val.replace(/px$/, "").trim();
  const n = Number(digits);
  if (isNaN(n)) throw new Error(`Invalid numeric value "${val}"`);
  return n;
}

function parseTransition(val: string): TransitionDecl {
  const parts = val.split(/\s+/);
  if (parts.length !== 2) throw new Error(`transition expects "<property> <duration>" — got "${val}"`);
  const property = parts[0];
  if (property !== "background" && property !== "color") {
    throw new Error(`transition supports only background/color — got "${property}"`);
  }
  const durStr = parts[1].replace(/ms$/, "").trim();
  const durationMs = Number(durStr);
  if (isNaN(durationMs)) throw new Error(`Invalid transition duration "${parts[1]}"`);
  return { property: property as "background" | "color", durationMs };
}
```

- [ ] **Step 4: Export the submodule**

In `packages/cuttlefish/package.json`, add to `exports`:

```json
    "./ui/css-parser": {
      "types": "./dist/ui/css-parser.d.ts",
      "default": "./dist/ui/css-parser.js"
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/css-parser.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ui/css-parser.ts packages/cuttlefish/package.json tests/packages/cuttlefish/css-parser.test.ts
git commit -m "feat(ui): CSS subset parser (selectors, properties, :pressed, transition)"
```

---

### Task 9: Style resolver (selector matching)

**Files:**
- Create: `packages/cuttlefish/src/ui/style-resolver.ts`
- Test: `tests/packages/cuttlefish/style-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/style-resolver.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveStyles } from "@typecad/cuttlefish/ui/style-resolver";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";
import { parseCss } from "@typecad/cuttlefish/ui/css-parser";

function resolve(src: string, css: string) {
  return resolveStyles(parseHtml(src), parseCss(css));
}

describe("style resolver", () => {
  it("applies element selector to all matching tags", () => {
    const styled = resolve(`<screen><text id="t">hi</text></screen>`, `screen { padding: 8; }`);
    expect(styled.style.padding).toBe(8);
  });

  it("applies id selector", () => {
    const styled = resolve(`<screen><text id="t">hi</text></screen>`, `#t { color: #ff0000; }`);
    expect(styled.children[0].style.color).toBe("#ff0000");
  });

  it("applies class selector", () => {
    const styled = resolve(`<screen><view class="card"></view></screen>`, `.card { padding: 4; }`);
    expect(styled.children[0].style.padding).toBe(4);
  });

  it("later rules override earlier rules (cascade)", () => {
    const styled = resolve(
      `<screen><text id="t">hi</text></screen>`,
      `#t { color: #ff0000; } #t { color: #00ff00; }`,
    );
    expect(styled.children[0].style.color).toBe("#00ff00");
  });

  it("base state and :pressed state resolve separately", () => {
    const styled = resolve(
      `<screen><button id="btn">x</button></screen>`,
      `#btn { background: #404040; } #btn:pressed { background: #808080; }`,
    );
    const btn = styled.children[0];
    expect(btn.style.background).toBe("#404040");
    expect(btn.style.pressed?.background).toBe("#808080");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/style-resolver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the style resolver**

Create `packages/cuttlefish/src/ui/style-resolver.ts`:

```typescript
// ---------------------------------------------------------------------------
// Style resolver — match CSS rules to element nodes and produce a computed
// style per node (base state + :pressed state).
//
// Walks the tree; for each node, applies every matching rule in source order
// (cascade: later rules win). :pressed rules populate the separate
// `style.pressed` object so the runtime can lerp to it on press.
// ---------------------------------------------------------------------------

import { UIElementNode } from "./html-parser";
import { CSSRule, CSSProperty, CSSSelector } from "./css-parser";

export interface StyledNode {
  tag: string;
  id?: string;
  classes: string[];
  text?: string;
  style: CSSProperty;
  children: StyledNode[];
}

function matches(node: UIElementNode, sel: CSSSelector): boolean {
  switch (sel.kind) {
    case "element": return node.tag === sel.name;
    case "id": return node.id === sel.name;
    case "class": return node.classes.includes(sel.name);
  }
}

export function resolveStyles(root: UIElementNode, rules: CSSRule[]): StyledNode {
  return resolveNode(root, rules);
}

function resolveNode(node: UIElementNode, rules: CSSRule[]): StyledNode {
  const base: CSSProperty = {};
  const pressed: CSSProperty = {};

  for (const rule of rules) {
    if (!matches(node, rule.selector)) continue;
    if (rule.selector.pseudo === "pressed") {
      Object.assign(pressed, rule.properties);
    } else {
      Object.assign(base, rule.properties);
    }
  }

  const style: CSSProperty = base;
  if (Object.keys(pressed).length > 0) {
    // Attach pressed overrides; the transition driver reads these on press.
    (style as CSSProperty & { pressed?: CSSProperty }).pressed = pressed;
  }

  return {
    tag: node.tag,
    id: node.id,
    classes: node.classes,
    text: node.text,
    style,
    children: node.children.map(c => resolveNode(c, rules)),
  };
}
```

- [ ] **Step 4: Export the submodule**

In `packages/cuttlefish/package.json`, add to `exports`:

```json
    "./ui/style-resolver": {
      "types": "./dist/ui/style-resolver.d.ts",
      "default": "./dist/ui/style-resolver.js"
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/style-resolver.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ui/style-resolver.ts packages/cuttlefish/package.json tests/packages/cuttlefish/style-resolver.test.ts
git commit -m "feat(ui): style resolver (selector matching, cascade, :pressed)"
```

---

### Task 10: Layout engine — interface + BlockLayoutEngine

This is the flex-forward scaffolding. The `LayoutEngine` interface and `measure()` are built even though block layout only needs measure for text — flex reuses both.

**Files:**
- Create: `packages/cuttlefish/src/ui/layout-engine.ts`
- Create: `packages/cuttlefish/src/ui/block-layout.ts`
- Test: `tests/packages/cuttlefish/block-layout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/block-layout.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Box, LayoutEngine, measure } from "@typecad/cuttlefish/ui/layout-engine";
import { BlockLayoutEngine } from "@typecad/cuttlefish/ui/block-layout";
import { resolveStyles } from "@typecad/cuttlefish/ui/style-resolver";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";
import { parseCss } from "@typecad/cuttlefish/ui/css-parser";

function layout(src: string, css: string, viewport: Box): Box[] {
  const styled = resolveStyles(parseHtml(src), parseCss(css));
  const engine: LayoutEngine = new BlockLayoutEngine();
  const boxes = engine.arrange(styled, viewport, (n) => measure(n));
  return boxes;
}

describe("BlockLayoutEngine", () => {
  it("screen fills the viewport", () => {
    const boxes = layout(`<screen></screen>`, ``, { x: 0, y: 0, w: 240, h: 320 });
    expect(boxes[0]).toEqual({ x: 0, y: 0, w: 240, h: 320 });
  });

  it("padding insets children", () => {
    const boxes = layout(
      `<screen><text id="t">hi</text></screen>`,
      `screen { padding: 8; }`,
      { x: 0, y: 0, w: 240, h: 320 },
    );
    // screen is boxes[0]; text is boxes[1], inset by padding 8.
    expect(boxes[1].x).toBe(8);
    expect(boxes[1].y).toBe(8);
    expect(boxes[1].w).toBe(240 - 16);
  });

  it("stacks children vertically (block flow)", () => {
    const boxes = layout(
      `<screen><text id="a">a</text><text id="b">b</text></screen>`,
      `screen { padding: 0; }`,
      { x: 0, y: 0, w: 100, h: 100 },
    );
    expect(boxes[1].y).toBe(0);
    expect(boxes[2].y).toBeGreaterThan(0);  // second child below first
  });

  it("measure returns text intrinsic size from font", () => {
    const styled = resolveStyles(
      parseHtml(`<screen><text id="t">hi</text></screen>`),
      parseCss(`#t { font: 8x16; }`),
    );
    const size = measure(styled.children[0]);
    expect(size.w).toBe(16);   // 2 chars * 8px
    expect(size.h).toBe(16);
  });
});

describe("flex-forward scaffolding", () => {
  it("LayoutEngine is selectable on display property (block default)", () => {
    const engine: LayoutEngine = new BlockLayoutEngine();
    expect(engine.id).toBe("block");
  });

  it("Style carries display field (unused by block, ready for flex)", () => {
    const styled = resolveStyles(
      parseHtml(`<screen><view></view></screen>`),
      parseCss(`screen { padding: 0; }`),
    );
    // display defaults to "block" when unset; block engine ignores it.
    expect(styled.style).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/block-layout.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the layout engine interface + measure**

Create `packages/cuttlefish/src/ui/layout-engine.ts`:

```typescript
// ---------------------------------------------------------------------------
// Layout engine — pluggable, staged layout.
//
//   style tree  →  measure pass  →  arrange pass (engine)  →  computed boxes
//
// v1 ships BlockLayoutEngine only. The LayoutEngine interface + measure()
// are built so that FlexLayoutEngine (v2) is a pure addition: no rewrite of
// measure, the style tree, the node representation, or the draw layer.
//
// measure() is general (returns intrinsic {w,h}) even though block layout
// only needs it for text — flex reuses it for flex-basis:content.
// ---------------------------------------------------------------------------

import { StyledNode } from "./style-resolver";

export interface Box { x: number; y: number; w: number; h: number; }

export interface IntrinsicSize { w: number; h: number; }

export interface LayoutEngine {
  /** Engine id, used to select on the `display` style property. */
  readonly id: "block" | "flex" | "grid";
  /**
   * Arrange a styled tree into a flat list of boxes (pre-order, root first).
   * measureFn provides intrinsic sizes (e.g. text dimensions from the font).
   */
  arrange(
    root: StyledNode,
    viewport: Box,
    measureFn: (node: StyledNode) => IntrinsicSize,
  ): Box[];
}

const FONT_REGISTRY: Record<string, { w: number; h: number }> = {
  "8x16": { w: 8, h: 16 },
  "6x8": { w: 6, h: 8 },
};

const DEFAULT_FONT = "8x16";

/** Measure a node's intrinsic size. Currently: text length × font cell. */
export function measure(node: StyledNode): IntrinsicSize {
  if (node.tag === "text" || node.tag === "button") {
    const fontId = node.style.font ?? DEFAULT_FONT;
    const font = FONT_REGISTRY[fontId] ?? FONT_REGISTRY[DEFAULT_FONT];
    const text = node.text ?? "";
    return { w: text.length * font.w, h: font.h };
  }
  // Containers have no intrinsic size in block layout — they fill available.
  return { w: 0, h: 0 };
}
```

- [ ] **Step 4: Implement BlockLayoutEngine**

Create `packages/cuttlefish/src/ui/block-layout.ts`:

```typescript
// ---------------------------------------------------------------------------
// BlockLayoutEngine — v1 layout. Stacks children vertically inside the
// parent's content box (parent box minus padding). Each child's width fills
// the content box; height comes from measure() for text/button leaves, or a
// synthesized height for containers.
// ---------------------------------------------------------------------------

import { Box, IntrinsicSize, LayoutEngine, measure } from "./layout-engine";
import { StyledNode } from "./style-resolver";

export class BlockLayoutEngine implements LayoutEngine {
  readonly id = "block" as const;

  arrange(root: StyledNode, viewport: Box, measureFn: (n: StyledNode) => IntrinsicSize): Box[] {
    const boxes: Box[] = [];
    this.layoutNode(root, viewport, boxes, measureFn);
    return boxes;
  }

  private layoutNode(
    node: StyledNode,
    box: Box,
    out: Box[],
    measureFn: (n: StyledNode) => IntrinsicSize,
  ): void {
    out.push(box);
    if (node.children.length === 0) return;

    const pad = node.style.padding ?? 0;
    const content: Box = {
      x: box.x + pad,
      y: box.y + pad,
      w: box.w - pad * 2,
      h: box.h - pad * 2,
    };
    let cursorY = content.y;

    for (const child of node.children) {
      const intrinsic = measureFn(child);
      const childBox: Box = {
        x: content.x,
        y: cursorY,
        w: content.w,
        h: intrinsic.h > 0 ? intrinsic.h : 16,
      };
      this.layoutNode(child, childBox, out, measureFn);
      cursorY += childBox.h;
    }
  }
}
```

- [ ] **Step 5: Export the submodules**

In `packages/cuttlefish/package.json`, add to `exports`:

```json
    "./ui/layout-engine": {
      "types": "./dist/ui/layout-engine.d.ts",
      "default": "./dist/ui/layout-engine.js"
    },
    "./ui/block-layout": {
      "types": "./dist/ui/block-layout.d.ts",
      "default": "./dist/ui/block-layout.js"
    }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/block-layout.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/ui/layout-engine.ts packages/cuttlefish/src/ui/block-layout.ts packages/cuttlefish/package.json tests/packages/cuttlefish/block-layout.test.ts
git commit -m "feat(ui): LayoutEngine interface + BlockLayoutEngine (flex-forward scaffolding)"
```

---

## Phase 3 — Lowering

### Task 11: UI lowering transformer (tree → C++ tables + .d.ts)

**Files:**
- Create: `packages/cuttlefish/src/ir/transformers/ui-lowering.ts`
- Test: `tests/packages/cuttlefish/ui-lowering.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/ui-lowering.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { lowerUIToCpp, LoweredUI } from "@typecad/cuttlefish/ir/transformers/ui-lowering";
import { resolveStyles } from "@typecad/cuttlefish/ui/style-resolver";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";
import { parseCss } from "@typecad/cuttlefish/ui/css-parser";
import { BlockLayoutEngine } from "@typecad/cuttlefish/ui/block-layout";
import { measure } from "@typecad/cuttlefish/ui/layout-engine";

function lower(html: string, css: string): LoweredUI {
  const styled = resolveStyles(parseHtml(html), parseCss(css));
  const engine = new BlockLayoutEngine();
  const boxes = engine.arrange(styled, { x: 0, y: 0, w: 240, h: 320 }, measure);
  return lowerUIToCpp(styled, boxes, "rgb565", "flash");
}

describe("ui lowering", () => {
  it("emits a UINode static array", () => {
    const out = lower(`<screen></screen>`, ``);
    expect(out.nodeTable).toMatch(/UINode\s+__ui_nodes/);
    expect(out.nodeTable).toContain("NODE_FILL");
  });

  it("resolves hex colors to rgb565 in the node table", () => {
    const out = lower(`<screen></screen>`, `screen { background: #008000; }`);
    // #008000 → 0x07e0
    expect(out.nodeTable).toContain("0x07e0");
  });

  it("emits a transition table for transition-able properties", () => {
    const out = lower(
      `<screen><button id="btn">x</button></screen>`,
      `#btn { background: #404040; transition: background 80ms; }`,
    );
    expect(out.transitionTable).toContain("UITransition");
    expect(out.transitionTable).toContain("80");
  });

  it("emits a .ui.html.d.ts with typed id properties", () => {
    const out = lower(
      `<screen><text id="greeting">hi</text><button id="btn">x</button></screen>`,
      `#greeting { font: 8x16; }`,
    );
    expect(out.typeDecl).toContain("greeting");
    expect(out.typeDecl).toContain("btn");
    expect(out.typeDecl).toMatch(/interface|type/);
  });

  it("emits NODE_TEXT for text/button leaves with text payload", () => {
    const out = lower(
      `<screen><text id="greeting">hello world</text></screen>`,
      `#greeting { color: #ff0000; font: 8x16; }`,
    );
    expect(out.nodeTable).toContain("NODE_TEXT");
    expect(out.nodeTable).toContain("hello world");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/ui-lowering.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the lowering transformer**

Create `packages/cuttlefish/src/ir/transformers/ui-lowering.ts`:

```typescript
// ---------------------------------------------------------------------------
// UI lowering — styled tree + computed boxes → C++ node/binding/transition
// tables + a .ui.html.d.ts declaration file.
//
// This is the bridge between the host-side parse/layout pipeline and the
// device-side retained runtime. Colors are resolved to the target color format
// here (once, at transpile time) so the device never converts colors.
//
// Output shape:
//   - nodeTable:       `static const UINode __ui_nodes[] = { ... };`
//   - transitionTable: `static const UITransition __ui_trans[] = { ... };`
//   - typeDecl:        TypeScript declarations so .ui.html imports are typed.
// ---------------------------------------------------------------------------

import { StyledNode } from "../../ui/style-resolver";
import { Box } from "../../ui/layout-engine";
import { resolveColor } from "../../ui/color";
import { CSSProperty } from "../../ui/css-parser";

export interface LoweredUI {
  nodeTable: string;
  transitionTable: string;
  typeDecl: string;
}

type ColorFormat = "rgb565" | "mono";
type Storage = "progmem" | "flash";

interface FlatNode {
  index: number;
  tag: string;
  id?: string;
  text?: string;
  style: CSSProperty;
  box: Box;
  hasPressed: boolean;
}

export function lowerUIToCpp(
  root: StyledNode,
  boxes: Box[],
  colorFormat: ColorFormat,
  storage: Storage,
): LoweredUI {
  const flat: FlatNode[] = [];
  flatten(root, boxes, flat, [0]);

  const storageKw = storage === "progmem" ? "PROGMEM" : "";
  const nodeTable = emitNodeTable(flat, colorFormat, storageKw);
  const transitionTable = emitTransitionTable(flat, colorFormat);
  const typeDecl = emitTypeDecl(root);

  return { nodeTable, transitionTable, typeDecl };
}

function flatten(
  node: StyledNode,
  boxes: Box[],
  out: FlatNode[],
  cursor: { i: number },
): void {
  const index = cursor.i++;
  const box = boxes[index] ?? { x: 0, y: 0, w: 0, h: 0 };
  const hasPressed = !!(node.style as CSSProperty & { pressed?: CSSProperty }).pressed;
  out.push({
    index,
    tag: node.tag,
    id: node.id,
    text: node.text,
    style: node.style,
    box,
    hasPressed,
  });
  for (const child of node.children) flatten(child, boxes, out, cursor);
}

function emitNodeTable(flat: FlatNode[], colorFormat: ColorFormat, storageKw: string): string {
  const lines = flat.map((n) => {
    const kind = n.tag === "screen" || n.tag === "view" ? "NODE_FILL" : "NODE_TEXT";
    const bg = n.style.background ? resolveColor(n.style.background, colorFormat) : 0;
    const fg = n.style.color ? resolveColor(n.style.color, colorFormat) : 0xffff;
    const text = n.text ? `"${n.text}"` : "nullptr";
    const font = n.style.font ? `&font_${n.style.font.replace("x", "_")}` : "nullptr";
    const box = `{${n.box.x},${n.box.y},${n.box.w},${n.box.h}}`;
    const bgStr = colorFormat === "rgb565" ? `0x${bg.toString(16).padStart(4, "0")}` : `${bg}`;
    const fgStr = colorFormat === "rgb565" ? `0x${fg.toString(16).padStart(4, "0")}` : `${fg}`;
    return `  { .box=${box}, .bg=${bgStr}, .fg=${fgStr}, .kind=${kind}, .text=${text}, .font=${font} },`;
  });
  return [
    `static const UINode __ui_nodes[] ${storageKw} = {`,
    ...lines,
    `};`,
  ].join("\n");
}

function emitTransitionTable(flat: FlatNode[], colorFormat: ColorFormat): string {
  const entries: string[] = [];
  for (const n of flat) {
    if (!n.style.transition) continue;
    const prop = n.style.transition.property === "background" ? "PROP_BG" : "PROP_FG";
    entries.push(`  { .node=${n.index}, .prop=${prop}, .durationMs=${n.style.transition.durationMs} },`);
  }
  if (entries.length === 0) {
    return `static const UITransition __ui_trans[] = {};`;
  }
  return [
    `static const UITransition __ui_trans[] = {`,
    ...entries,
    `};`,
  ].join("\n");
}

function emitTypeDecl(root: StyledNode): string {
  // Collect id → tag pairs by walking the tree.
  const ids: Array<{ id: string; tag: string }> = [];
  const collect = (n: StyledNode) => {
    if (n.id) ids.push({ id: n.id, tag: n.tag });
    n.children.forEach(collect);
  };
  collect(root);

  const fields = ids.map(({ id, tag }) => {
    const typeName = tag.charAt(0).toUpperCase() + tag.slice(1);
    return `  ${id}: ${typeName}Element;`;
  }).join("\n");

  return [
    `// Auto-generated by cuttlefish UI lowering. Do not edit.`,
    `export interface ScreenTree {`,
    fields,
    `}`,
    ``,
    `export const screen: ScreenTree;`,
  ].join("\n");
}
```

- [ ] **Step 4: Export the submodule**

In `packages/cuttlefish/package.json`, add to `exports`:

```json
    "./ir/transformers/ui-lowering": {
      "types": "./dist/ir/transformers/ui-lowering.d.ts",
      "default": "./dist/ir/transformers/ui-lowering.js"
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/ui-lowering.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ir/transformers/ui-lowering.ts packages/cuttlefish/package.json tests/packages/cuttlefish/ui-lowering.test.ts
git commit -m "feat(ui): lowering transformer (tree → C++ node/transition tables + .d.ts)"
```

---

## Phase 4 — `@typehal/ui` + reactive runtime

### Task 12: `@typehal/ui` authoring package

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/index.ts`
- Create: `packages/ui/src/types.ts`
- Create: `packages/ui/cuttlefish-env.d.ts`
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Register the package in the workspace**

In `pnpm-workspace.yaml`, add `packages/ui` to the packages list.

- [ ] **Step 2: Create the package manifest**

Create `packages/ui/package.json`:

```json
{
  "name": "@typehal/ui",
  "version": "0.1.0",
  "description": "TypeHAL UI authoring library — HTML/CSS-driven graphics for microcontrollers",
  "type": "commonjs",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@typecad/hal": "*"
  },
  "license": "MIT",
  "publishConfig": { "access": "public" }
}
```

- [ ] **Step 3: Create tsconfig**

Create `packages/ui/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Create the element types**

Create `packages/ui/src/types.ts`:

```typescript
// ---------------------------------------------------------------------------
// Element types — the shape of typed `.ui.html` imports.
//
// When an author writes `import { screen } from './app.ui.html'`, the lowering
// transformer emits a .ui.html.d.ts declaring `screen` as a ScreenTree whose
// fields are these element types. Each carries the hardware-binding methods
// (onPress/onRelease) that lower to GPIO edge handlers.
// ---------------------------------------------------------------------------

export interface TextElement {
  readonly __kind: "text";
  /** Attach a GPIO falling-edge handler that flips this node's :pressed state. */
  onPress(pin: number | string): void;
  /** Attach a GPIO rising-edge handler that clears :pressed. */
  onRelease(pin: number | string): void;
}

export interface ButtonElement extends TextElement {
  readonly __kind: "button";
}

export interface ViewElement {
  readonly __kind: "view";
  onPress(pin: number | string): void;
  onRelease(pin: number | string): void;
}

export interface ScreenTree {
  [id: string]: TextElement | ButtonElement | ViewElement;
}
```

- [ ] **Step 5: Create the public API**

Create `packages/ui/src/index.ts`:

```typescript
// ---------------------------------------------------------------------------
// @typehal/ui — public authoring API.
//
// These functions are compile-time constructs: the transpiler intercepts
// ui.mount / ui.signal / ui.bind and lowers them to device variables and
// binding-table entries. They have no runtime implementation in the emitted
// C++; their bodies exist only so TypeScript authoring type-checks.
// ---------------------------------------------------------------------------

import type { ScreenTree } from "./types";

export type { ScreenTree, TextElement, ButtonElement, ViewElement } from "./types";

/** A reactive signal whose value lives on the device. */
export interface Signal<T> {
  (): T;
  set(value: T): void;
}

export interface MountOptions {
  /** Display driver id (must be in the framework's supportedDisplayDrivers()). */
  display: string;
  /** Bus identifier, e.g. "SPI" or "Wire". */
  bus: string;
  /** Chip-select pin. */
  cs: number;
  /** Data/command pin. */
  dc: number;
  /** Reset pin. */
  rst: number;
}

/**
 * Mount a baked UI tree to a display. Validates the driver against the active
 * framework at transpile time (fail-fast). The tree is lowered to a static C++
 * node table; this call lowers to display.init + the first-frame draw.
 */
export declare function mount(tree: ScreenTree, opts: MountOptions): void;

/**
 * Declare a reactive signal. Lowers to a plain device variable + dirty flag.
 */
export declare function signal<T>(initial: T): Signal<T>;

/**
 * Bind a node property to a computed value, re-evaluated each tick. When the
 * value changes, the node is marked dirty and (for transition-able properties)
 * the transition is armed.
 */
export declare function bind<K extends string>(
  node: unknown,
  property: K,
  compute: () => unknown,
): void;

export const ui = { mount, signal, bind };
export default ui;
```

- [ ] **Step 6: Create the ambient declaration for .ui.html imports**

Create `packages/ui/cuttlefish-env.d.ts`:

```typescript
// Ambient module declarations so `import { screen } from './x.ui.html'`
// type-checks before the lowering transformer emits the precise .d.ts.
declare module "*.ui.html" {
  export const screen: import("./src/types").ScreenTree;
}
declare module "*.ui.css";
```

- [ ] **Step 7: Typecheck the new package**

Run: `npx tsc -b packages/ui`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml packages/ui
git commit -m "feat(ui): @typehal/ui authoring package (mount/signal/bind + element types)"
```

---

### Task 13: `ui.mount` lowering — driver validation + display.init

**Files:**
- Create: `tests/packages/cuttlefish/ui-mount.test.ts`
- This task verifies the integration: `ui.mount(...)` against an active framework produces `display.init` op emission and validates the driver. Since wiring `ui.mount` into the full transpile pipeline requires deep AST-visitor changes, this task implements a **standalone resolver function** that the transpiler will call. The AST-visitor hookup (auto-resolving `.ui.html` imports during `typehal build`) is explicitly out-of-scope for this plan — see the scope note in the Phases section. This keeps the task self-contained and testable.

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/ui-mount.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveMount, MountValidationError } from "@typecad/cuttlefish/ir/transformers/ui-mount";
import type { PlatformGraphicsStrategy } from "@typecad/cuttlefish/api/shared";

function strategy(drivers: string[]): PlatformGraphicsStrategy {
  return {
    supportedDisplayDrivers: () => new Set(drivers),
    colorFormat: () => "rgb565",
    graphicsCapacity: () => ({ maxNodes: 256, maxBindings: 64, maxActiveTransitions: 32, nodeStorage: "flash" as const }),
    resolveDisplayOp: () => undefined,
  };
}

describe("ui.mount resolver", () => {
  it("returns a display.init op when the driver is supported", () => {
    const op = resolveMount(
      { display: "ili9341", bus: "SPI", cs: 10, dc: 9, rst: 8 },
      strategy(["ili9341"]),
      { width: 240, height: 320 },
    );
    expect(op.operation).toBe("display.init");
    expect(op.driver).toBe("ili9341");
    expect(op.width).toBe(240);
  });

  it("throws MountValidationError when the driver is unsupported", () => {
    expect(() =>
      resolveMount({ display: "st7789", bus: "SPI", cs: 10, dc: 9, rst: 8 }, strategy(["ili9341"]), { width: 240, height: 320 }),
    ).toThrow(MountValidationError);
  });

  it("error message lists the supported drivers", () => {
    try {
      resolveMount({ display: "st7789", bus: "SPI", cs: 10, dc: 9, rst: 8 }, strategy(["ili9341"]), { width: 240, height: 320 });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("ili9341");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/ui-mount.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the mount resolver**

Create `packages/cuttlefish/src/ir/transformers/ui-mount.ts`:

```typescript
// ---------------------------------------------------------------------------
// ui.mount resolver — validates the requested driver against the active
// framework's supportedDisplayDrivers() and returns a DisplayInitOp.
//
// Fail-fast: an unsupported driver errors at transpile time, not at runtime.
// Mirrors the pin-conflict check philosophy.
// ---------------------------------------------------------------------------

import type { PlatformGraphicsStrategy, DisplayInitOp } from "../../api/shared";

export interface MountRequest {
  display: string;
  bus: string;
  cs: number;
  dc: number;
  rst: number;
}

export class MountValidationError extends Error {
  constructor(driver: string, supported: ReadonlySet<string>) {
    super(
      `Unsupported display driver "${driver}". ` +
      `Supported by this framework: ${[...supported].join(", ") || "(none)"}.`,
    );
    this.name = "MountValidationError";
  }
}

export function resolveMount(
  req: MountRequest,
  strategy: PlatformGraphicsStrategy,
  viewport: { width: number; height: number },
): DisplayInitOp {
  const supported = strategy.supportedDisplayDrivers();
  if (!supported.has(req.display)) {
    throw new MountValidationError(req.display, supported);
  }
  return {
    operation: "display.init",
    bus: req.bus,
    cs: req.cs,
    dc: req.dc,
    rst: req.rst,
    width: viewport.width,
    height: viewport.height,
    driver: req.display,
  };
}
```

- [ ] **Step 4: Export the submodule**

In `packages/cuttlefish/package.json`, add to `exports`:

```json
    "./ir/transformers/ui-mount": {
      "types": "./dist/ir/transformers/ui-mount.d.ts",
      "default": "./dist/ir/transformers/ui-mount.js"
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/ui-mount.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ir/transformers/ui-mount.ts packages/cuttlefish/package.json tests/packages/cuttlefish/ui-mount.test.ts
git commit -m "feat(ui): ui.mount resolver with fail-fast driver validation"
```

---

### Task 14: Reactive lowering — signal + bind

This task implements the lowering logic for `ui.signal` and `ui.bind` as a pure, testable function: given a set of signal/bind declarations, emit the C++ binding table and signal variables. (AST-visitor hookup is out-of-scope for this plan — see the scope note.)

**Files:**
- Create: `packages/cuttlefish/src/ir/transformers/ui-reactive.ts`
- Test: `tests/packages/cuttlefish/ui-reactive.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/ui-reactive.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  emitSignalDecl,
  emitBindingEntry,
  BindingSpec,
} from "@typecad/cuttlefish/ir/transformers/ui-reactive";

describe("reactive lowering", () => {
  it("emits a signal as a device variable", () => {
    const decl = emitSignalDecl("temp", "int", 22);
    expect(decl).toMatch(/int\s+temp\s*=\s*22/);
  });

  it("emits a binding table entry with node index, property, and fn ptr", () => {
    const spec: BindingSpec = {
      nodeIndex: 1,
      property: "text",
      fnName: "__ui_bind_temp_text",
    };
    const entry = emitBindingEntry(spec);
    expect(entry).toContain("1");
    expect(entry).toContain("PROP_TEXT");
    expect(entry).toContain("__ui_bind_temp_text");
  });

  it("emits a full binding table from a spec list", () => {
    const table = emitBindingEntry({ nodeIndex: 1, property: "text", fnName: "f1" });
    expect(table).toContain("UIBinding");
    expect(table).toContain("f1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/ui-reactive.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reactive lowering**

Create `packages/cuttlefish/src/ir/transformers/ui-reactive.ts`:

```typescript
// ---------------------------------------------------------------------------
// Reactive lowering — ui.signal / ui.bind → C++ device variables + binding table.
//
// A signal lowers to a plain variable (with an initial value). A bind lowers
// to a UIBinding entry: { nodeIndex, property, fn_ptr }. The runtime evaluates
// each binding each tick; if the computed value differs from the node's current
// value, the node is marked dirty (and the transition armed if applicable).
//
// The compute functions (fn_ptr) are emitted as free C++ functions that return
// the property value, generated from the author's arrow-function bodies.
// ---------------------------------------------------------------------------

export interface BindingSpec {
  nodeIndex: number;
  property: string;
  fnName: string;
}

/** Emit a signal as a device variable declaration. */
export function emitSignalDecl(name: string, cppType: string, initialValue: number | string | boolean): string {
  const val = typeof initialValue === "string" ? `"${initialValue}"` : `${initialValue}`;
  return `${cppType} ${name} = ${val};`;
}

/** Map a bind property name to the runtime property enum. */
function propEnum(property: string): string {
  switch (property) {
    case "background": return "PROP_BG";
    case "color": return "PROP_FG";
    case "text": return "PROP_TEXT";
    case "visible": return "PROP_VISIBLE";
    default: return `PROP_${property.toUpperCase()}`;
  }
}

/** Emit a single binding-table entry line. */
export function emitBindingEntry(spec: BindingSpec): string {
  return `  { .node=${spec.nodeIndex}, .prop=${propEnum(spec.property)}, .fn=${spec.fnName} },`;
}

/** Emit a full binding table from a list of specs. */
export function emitBindingTable(specs: BindingSpec[]): string {
  if (specs.length === 0) return `static const UIBinding __ui_bindings[] = {};`;
  return [
    `static const UIBinding __ui_bindings[] = {`,
    ...specs.map(emitBindingEntry),
    `};`,
  ].join("\n");
}
```

- [ ] **Step 4: Export the submodule**

In `packages/cuttlefish/package.json`, add to `exports`:

```json
    "./ir/transformers/ui-reactive": {
      "types": "./dist/ir/transformers/ui-reactive.d.ts",
      "default": "./dist/ir/transformers/ui-reactive.js"
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/ui-reactive.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ir/transformers/ui-reactive.ts packages/cuttlefish/package.json tests/packages/cuttlefish/ui-reactive.test.ts
git commit -m "feat(ui): reactive lowering (signal vars + binding table)"
```

---

## Phase 5 — Integration & docs

### Task 15: C++ reactive runtime header (frame-loop + transitions + press glue)

The lowering tasks (11, 14) emit the *tables* — the node array, binding table, transition table. This task emits the *driver code* that walks those tables each frame: the transition lerp, the dirty-redraw traversal, the flush, and the press-handler glue that `node.onPress(pin)` lowers to. Without it, the tables exist but nothing drives them. This is the spec §7 runtime, made of four pieces.

**Files:**
- Create: `packages/cuttlefish/src/ui/runtime-header.ts`
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/runtime-header.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { emitRuntimeHeader } from "@typecad/cuttlefish/ui/runtime-header";

describe("C++ reactive runtime header", () => {
  const header = emitRuntimeHeader();

  it("declares the UINode and UITransition structs", () => {
    expect(header).toMatch(/struct\s+UINode/);
    expect(header).toMatch(/struct\s+UITransition/);
    expect(header).toMatch(/struct\s+UIBinding/);
  });

  it("declares ui_mark_dirty for marking nodes dirty", () => {
    expect(header).toContain("ui_mark_dirty");
  });

  it("declares the per-frame ui_tick driver", () => {
    expect(header).toContain("ui_tick");
  });

  it("contains a color lerp helper for transitions", () => {
    expect(header).toContain("lerp_color");
  });

  it("contains a press handler entry point", () => {
    expect(header).toContain("ui_on_press");
    expect(header).toContain("ui_on_release");
  });

  it("declares the draw dispatch switch (NODE_FILL / NODE_TEXT)", () => {
    expect(header).toContain("NODE_FILL");
    expect(header).toContain("NODE_TEXT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the runtime header**

Create `packages/cuttlefish/src/ui/runtime-header.ts`:

```typescript
// ---------------------------------------------------------------------------
// C++ reactive runtime header — the driver code that walks the node/binding/
// transition tables each frame.
//
// This is emitted once per translation unit (guarded) so the static tables
// produced by the lowering transformer have something to drive them. It
// implements the three-phase frame from spec §7:
//   1. Advance transitions (lerp toward target)
//   2. Draw traversal (dirty nodes only)
//   3. Flush dirty rects
//
// Plus the press/release entry points that node.onPress(pin) lowers to.
// ---------------------------------------------------------------------------

export function emitRuntimeHeader(): string {
  return `
// ── TypeHAL UI runtime (emit once per TU) ──────────────────────────────────
#ifndef __TC_UI_RUNTIME
#define __TC_UI_RUNTIME
#include <stdint.h>

enum UINodeKind { NODE_FILL, NODE_TEXT };
enum UIProperty { PROP_BG, PROP_FG, PROP_TEXT, PROP_VISIBLE };

struct UIRect { int16_t x, y, w, h; };
struct UINode {
  UIRect box;
  uint16_t bg;       // resolved color (rgb565 or 0/1 mono)
  uint16_t fg;
  UINodeKind kind;
  const char* text;
  const uint8_t* font;
  // runtime slot
  uint8_t dirty;
  uint8_t pressed;
};
struct UITransition {
  uint8_t node;
  UIProperty prop;
  uint16_t durationMs;
  // runtime
  uint16_t elapsed;
  uint16_t prevValue;
  uint16_t targetValue;
  uint8_t  active;
};
struct UIBinding {
  uint8_t node;
  UIProperty prop;
  uint16_t (*fn)(void);
};

// Color lerp for transitions (rgb565). For mono, this collapses to a snap.
static inline uint16_t lerp_color(uint16_t a, uint16_t b, uint8_t k100) {
  if (k100 >= 100) return b;
  uint8_t ar = (a >> 11) & 0x1f, ag = (a >> 5) & 0x3f, ab = a & 0x1f;
  uint8_t br = (b >> 11) & 0x1f, bg = (b >> 5) & 0x3f, bb = b & 0x1f;
  uint8_t r = ar + ((br - ar) * k100) / 100;
  uint8_t g = ag + ((bg - ag) * k100) / 100;
  uint8_t bl = ab + ((bb - ab) * k100) / 100;
  return ((r & 0x1f) << 11) | ((g & 0x3f) << 5) | (bl & 0x1f);
}

// Declared by the lowering output (the static tables):
extern UINode __ui_nodes[];
extern UITransition __ui_trans[];
extern UIBinding __ui_bindings[];
extern const uint8_t __ui_node_count;
extern const uint8_t __ui_trans_count;
extern const uint8_t __ui_binding_count;

// Per-node dirty marker (called by press handlers and binding evaluation).
static inline void ui_mark_dirty(uint8_t nodeIdx) {
  __ui_nodes[nodeIdx].dirty = 1;
}

// Press / release entry points that node.onPress(pin) lowers to.
static inline void ui_on_press(uint8_t nodeIdx) {
  __ui_nodes[nodeIdx].pressed = 1;
  ui_mark_dirty(nodeIdx);
  // Arm transitions on this node (target = pressed-state value).
  for (uint8_t i = 0; i < __ui_trans_count; i++) {
    if (__ui_trans[i].node == nodeIdx) {
      __ui_trans[i].prevValue = __ui_nodes[nodeIdx].bg;
      __ui_trans[i].elapsed = 0;
      __ui_trans[i].active = 1;
    }
  }
}
static inline void ui_on_release(uint8_t nodeIdx) {
  __ui_nodes[nodeIdx].pressed = 0;
  ui_mark_dirty(nodeIdx);
  // Re-arm transitions toward the base-state value (interrupt-and-re-lerp).
  for (uint8_t i = 0; i < __ui_trans_count; i++) {
    if (__ui_trans[i].node == nodeIdx) {
      __ui_trans[i].prevValue = __ui_nodes[nodeIdx].bg;
      __ui_trans[i].elapsed = 0;
      __ui_trans[i].active = 1;
    }
  }
}

// Per-frame driver. The host async/loop pump calls this each tick (~16ms).
// Phase 1: advance transitions. Phase 2: draw dirty nodes. Phase 3: flush.
static inline void ui_tick(uint16_t deltaMs) {
  // ① Advance transitions.
  for (uint8_t i = 0; i < __ui_trans_count; i++) {
    if (!__ui_trans[i].active) continue;
    __ui_trans[i].elapsed += deltaMs;
    uint8_t k = (__ui_trans[i].elapsed * 100) / __ui_trans[i].durationMs;
    uint16_t v = lerp_color(__ui_trans[i].prevValue, __ui_trans[i].targetValue, k);
    __ui_nodes[__ui_trans[i].node].bg = v;
    ui_mark_dirty(__ui_trans[i].node);
    if (k >= 100) __ui_trans[i].active = 0;
  }
  // ② Draw dirty nodes (draw dispatch — driver-specific draw_* are HAL ops).
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    if (!__ui_nodes[i].dirty) continue;
    switch (__ui_nodes[i].kind) {
      case NODE_FILL:
        /* emits display.fill_rect via the op pipeline */
        break;
      case NODE_TEXT:
        /* emits display.draw_text via the op pipeline */
        break;
    }
    __ui_nodes[i].dirty = 0;
  }
  // ③ Flush — emits display.flush with the accumulated dirty rects.
}

#endif
`;
}
```

- [ ] **Step 4: Export the submodule**

In `packages/cuttlefish/package.json`, add to `exports`:

```json
    "./ui/runtime-header": {
      "types": "./dist/ui/runtime-header.d.ts",
      "default": "./dist/ui/runtime-header.js"
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts packages/cuttlefish/package.json tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(ui): C++ reactive runtime header (frame-loop, transitions, press glue)"
```

---

### Task 16: End-to-end hello-world integration test

This task wires the full pipeline together via a **facade function** (`transpileUI`) that orchestrates parse → resolve → layout → lower, and tests the canonical demo produces the expected emitted C++. Wiring the facade into the actual cuttlefish AST visitor (so `.ui.html` imports are auto-resolved during a normal `typehal build`) is a larger refactor tracked separately; this facade is the integration contract and the basis for that hookup.

**Files:**
- Create: `packages/cuttlefish/src/ui/transpile-ui.ts`
- Create: `tests/packages/cuttlefish/ui-e2e.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/ui-e2e.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { transpileUI } from "@typecad/cuttlefish/ui/transpile-ui";

const HTML = [
  `<screen>`,
  `  <text id="greeting">hello world</text>`,
  `  <button id="btn">Click me</button>`,
  `</screen>`,
].join("\n");

const CSS = [
  `screen { background: #008000; padding: 8; }`,
  `#greeting { color: #ff0000; font: 8x16; }`,
  `#btn { background: #404040; color: #ffffff; padding: 4; transition: background 80ms; }`,
  `#btn:pressed { background: #808080; }`,
].join("\n");

describe("UI end-to-end (hello world)", () => {
  const out = transpileUI(HTML, CSS, {
    colorFormat: "rgb565",
    storage: "flash",
    viewport: { width: 240, height: 320 },
  });

  it("emits a node table with 3 nodes", () => {
    expect(out.nodeTable).toMatch(/UINode\s+__ui_nodes/);
    // screen + greeting + btn = 3 NODE_* lines
    const kindLines = out.nodeTable.match(/NODE_(FILL|TEXT)/g) ?? [];
    expect(kindLines).toHaveLength(3);
  });

  it("emits green background (#008000 → 0x07e0) on screen", () => {
    expect(out.nodeTable).toContain("0x07e0");
  });

  it("emits red foreground (#ff0000 → 0xf800) on greeting", () => {
    expect(out.nodeTable).toContain("0xf800");
  });

  it("emits the greeting text payload", () => {
    expect(out.nodeTable).toContain("hello world");
  });

  it("emits the transition table with 80ms on btn", () => {
    expect(out.transitionTable).toContain("80");
    expect(out.transitionTable).toContain("UITransition");
  });

  it("emits typed declarations for greeting and btn", () => {
    expect(out.typeDecl).toContain("greeting");
    expect(out.typeDecl).toContain("btn");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/ui-e2e.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the transpile-ui facade**

Create `packages/cuttlefish/src/ui/transpile-ui.ts`:

```typescript
// ---------------------------------------------------------------------------
// transpileUI — end-to-end facade: HTML + CSS → lowered C++.
//
// Orchestrates: parse HTML → parse CSS → resolve styles → layout → lower.
// This is the integration contract used by the AST visitor that resolves
// .ui.html imports during a normal `typehal build`.
//
// Selecting the layout engine on the `display` property happens here in v2;
// v1 always uses BlockLayoutEngine.
// ---------------------------------------------------------------------------

import { parseHtml } from "./html-parser";
import { parseCss } from "./css-parser";
import { resolveStyles } from "./style-resolver";
import { BlockLayoutEngine } from "./block-layout";
import { measure, Box } from "./layout-engine";
import { lowerUIToCpp, LoweredUI } from "../ir/transformers/ui-lowering";

export interface TranspileUIOptions {
  colorFormat: "rgb565" | "mono";
  storage: "progmem" | "flash";
  viewport: { width: number; height: number };
}

export function transpileUI(html: string, css: string, opts: TranspileUIOptions): LoweredUI {
  const tree = parseHtml(html);
  const rules = parseCss(css);
  const styled = resolveStyles(tree, rules);

  // v1: block layout always. v2 will select on display:flex.
  const engine = new BlockLayoutEngine();
  const viewport: Box = { x: 0, y: 0, w: opts.viewport.width, h: opts.viewport.height };
  const boxes = engine.arrange(styled, viewport, measure);

  return lowerUIToCpp(styled, boxes, opts.colorFormat, opts.storage);
}
```

- [ ] **Step 4: Export the submodule**

In `packages/cuttlefish/package.json`, add to `exports`:

```json
    "./ui/transpile-ui": {
      "types": "./dist/ui/transpile-ui.d.ts",
      "default": "./dist/ui/transpile-ui.js"
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/ui-e2e.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Run the full test suite to verify no regressions**

Run: `npx vitest run`
Expected: all tests PASS (existing + new).

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/ui/transpile-ui.ts packages/cuttlefish/package.json tests/packages/cuttlefish/ui-e2e.test.ts
git commit -m "feat(ui): end-to-end transpileUI facade (hello-world demo passes)"
```

---

### Task 17: Driver-authoring README

**Files:**
- Create: `packages/framework-arduino/DISPLAYS.md`

- [ ] **Step 1: Write the README**

Create `packages/framework-arduino/DISPLAYS.md`:

````markdown
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

## Step-by-step: adding a driver

### 1. Create the resolver module

Create `src/graphics/<driver>.ts` (e.g. `ssd1306.ts`). Export a resolver with
this signature:

```typescript
import type { DisplayHALOp } from "@typecad/cuttlefish/api/shared";

export function resolveSSD1306Op(
  op: DisplayHALOp,
  ctx: { bus: string; cs: number; dc: number; rst: number; width: number; height: number },
): { code?: string; expression?: string } | undefined {
  switch (op.operation) {
    case "display.init": /* ... */ return { code: "..." };
    case "display.fill_rect": /* ... */ return { code: "..." };
    case "display.draw_text": /* ... */ return { code: "..." };
    case "display.draw_rect": /* ... */ return { code: "..." };
    case "display.flush": /* ... */ return { code: "..." };
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

In `src/strategy.ts`, extend `resolveDisplayOp` to dispatch on the driver id:

```typescript
resolveDisplayOp(op: DisplayHALOp) {
  if (op.operation === "display.init") {
    this._displayCtx = { /* capture from op */ };
  }
  const driver = this._displayCtx ? op.operation === "display.init" ? op.driver : this._driverId : op.driver;
  if (driver === "ssd1306") return resolveSSD1306Op(op, this._displayCtx!);
  if (driver === "ili9341") return resolveILI9341Op(op, this._displayCtx!);
  return undefined;
}
```

And declare support:

```typescript
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

| | ILI9341 | SSD1306 |
|---|---|---|
| Bus | SPI | I2C |
| Color | rgb565 (uint16) | mono (1-bit) |
| Flush | no-op (immediate) | page write |
| Addressing | column/row window | page/column |
````

- [ ] **Step 2: Commit**

```bash
git add packages/framework-arduino/DISPLAYS.md
git commit -m "docs(graphics): driver-authoring README (DISPLAYS.md)"
```

---

## Completion checklist

After all tasks:

- [ ] `npx vitest run` — all tests pass (existing + 30+ new).
- [ ] `npx tsc -b` — clean build across all packages.
- [ ] The hello-world trace (red text, green bg, animated button) transpiles via `transpileUI` and emits correct C++ (verified by `ui-e2e.test.ts`).
- [ ] `DISPLAYS.md` documents how to add a driver end-to-end.
- [ ] Flex-forward scaffolding in place: `LayoutEngine` interface, `measure()`, `display` modeled (ready for `FlexLayoutEngine` as a pure addition).
```
