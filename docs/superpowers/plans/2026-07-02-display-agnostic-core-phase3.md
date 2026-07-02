# Display-Agnostic Core — Phase 3: RGB666 Shim + ST7796S Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ST7796S display in two modes — **565** (trivial, byte-identical) and **666** (the first target that needs true RGB888 values + 888 blend math) — and wire the descriptor so the active mode drives emit-time color quantization and runtime blend-math selection. The existing ILI9341/565 path stays byte-identical.

**Architecture:** Phase 3 is the first phase that switches **values** (not just storage) to 888, but only on 666 targets. Per the Phase 1 lesson (888 operands in 565 math give wrong results — proven by counterexample), the value depth and blend math must switch *together*, driven by the descriptor. So:
- The `ColorFormat` plumbing widens from `"rgb565" | "mono"` to include `"rgb666"`.
- `resolveColor(input, "rgb666")` resolves to `rgb888To666(resolveColor888(input))`.
- When `colorFormat === "rgb666"`, model.ts emits 888 values into the (already-uint32) node fields, the runtime switches blend call sites from `ui_blend565`/`lerp_color` to `ui_blend888`/`lerp_color_888`, and the preview resolves 888 + blends 888.
- A new `st7796` adapter is registered (565 mode reuses today's `uint16_t` push; 666 mode pushes 666-packed pixels).
- The ILI9341 path is untouched: `colorFormat === "rgb565"` keeps 565 values + 565 blend math, byte-identical.

**Tech Stack:** TypeScript (transpiler + preview), C++ (emitted runtime + adapter), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-02-display-agnostic-core-design.md` (Phase 3 of 4; §2.3 shim table, §3.1 color, §3.3 adapter).
**Phases 1–2:** complete.

**Verification baseline (after every code task):**
```sh
rm -f packages/cuttlefish/*.tsbuildinfo
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish
npm run compile --workspace demo-ui   # ILI9341/565 — must stay byte-identical
```
The 5 known-unrelated pre-existing failures are being fixed separately; do not treat them as regressions.

---

## File Structure

**Created:**
- `packages/cuttlefish/src/api/shared/display-adapters/st7796.ts` — the ST7796S adapter (565 + 666 modes).
- `tests/packages/cuttlefish/color-666.test.ts` — `resolveColor` rgb666 path.
- `tests/packages/cuttlefish/st7796-adapter.test.ts` — adapter registration + generated C++ shape.

**Modified:**
- `packages/cuttlefish/src/ui/color.ts` — `resolveColor` accepts `"rgb666"`; routes via `rgb888To666(resolveColor888(input))`.
- `packages/cuttlefish/src/ui/model.ts`, `ui-lowering.ts` — `ColorFormat` widens to `"rgb565" | "rgb666" | "mono"`; for `rgb666`, emit 888 values into node fields.
- `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts`, `canvas-lowering.ts`, `ui-callback-lowering.ts` — color-literal resolution routes through `resolveColor888` when `colorFormat === "rgb666"` (emit 888, not 565).
- `packages/cuttlefish/src/api/shared/graphics-strategy.ts`, `platform/generic-strategy.ts`, `framework-arduino/src/strategy.ts`, `framework-native/src/strategy.ts` — `colorFormat()` return type widens to `"rgb565" | "rgb666" | "mono"`.
- `packages/cuttlefish/src/ui/runtime-header.ts` — for `rgb666` builds, swap `ui_blend565`→`ui_blend888` and `lerp_color`→`lerp_color_888` at the call sites (the 888 variants exist from Phase 1, currently unused). The selection is compile-time via a `#define UI_COLOR_DEPTH` the emitter sets from `colorFormat`.
- `packages/cuttlefish/src/api/shared/display-adapter.ts` — import + register the ST7796S adapter.
- `packages/framework-arduino/src/strategy.ts` — add `"st7796"` to `supportedDisplayDrivers()`.

---

## Task 1: Widen `ColorFormat` + `resolveColor` to admit rgb666 (TDD)

**Files:**
- Modify: `packages/cuttlefish/src/ui/color.ts`
- Modify: `packages/cuttlefish/src/ui/model.ts` (`ColorFormat` alias, line 229)
- Modify: `packages/cuttlefish/src/ir/transformers/ui-lowering.ts` (`ColorFormat` alias, line 43)
- Test: `tests/packages/cuttlefish/color-666.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/color-666.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveColor, resolveColor888, rgb888To666 } from "../../../packages/cuttlefish/src/ui/color";

describe("resolveColor rgb666 path", () => {
  it("resolveColor(..., 'rgb666') quantizes 888 → 666", () => {
    expect(resolveColor("#ffffff", "rgb666")).toBe(0x3ffff);
    expect(resolveColor("#000000", "rgb666")).toBe(0x00000);
    expect(resolveColor("#ff0000", "rgb666")).toBe(0x3f000);
    expect(resolveColor("#00ff00", "rgb666")).toBe(0x00fc0);
    expect(resolveColor("#0000ff", "rgb666")).toBe(0x0003f);
  });

  it("resolveColor(..., 'rgb666') === rgb888To666(resolveColor888(...))", () => {
    expect(resolveColor("#1a73e8", "rgb666")).toBe(rgb888To666(resolveColor888("#1a73e8")));
  });

  it("565 path unchanged (byte-identity guard)", () => {
    expect(resolveColor("#ff0000", "rgb565")).toBe(0xf800);
    // Exact 565 value for #1a73e8 (verified: node -e).
    expect(resolveColor("#1a73e8", "rgb565")).toBe(0x1b9d);
  });

  it("mono path unchanged", () => {
    expect(resolveColor("#ffffff", "mono")).toBe(1);
    expect(resolveColor("#000000", "mono")).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/packages/cuttlefish/color-666.test.ts`
Expected: FAIL — `resolveColor(..., "rgb666")` is a type error (`"rgb666"` not in the format union).

- [ ] **Step 3: Widen resolveColor's format param + the ColorFormat aliases**

In `packages/cuttlefish/src/ui/color.ts`, widen `resolveColor`:

```ts
export function resolveColor(input: string, format: "rgb565" | "rgb666" | "mono"): number {
  const c = resolveColor888(input);
  if (format === "rgb565") return rgb888To565(c);
  if (format === "rgb666") return rgb888To666(c);
  return rgb888ToMono(c);
}
```

In `packages/cuttlefish/src/ui/model.ts` line 229 and `packages/cuttlefish/src/ir/transformers/ui-lowering.ts` line 43, widen each local alias:

```ts
type ColorFormat = "rgb565" | "rgb666" | "mono";
```

- [ ] **Step 4: Fix the byte-identity guard assertion**

The Step-1 test's 565 assertion for `#1a73e8` is a placeholder. Compute the real value and replace:

Run: `node -e "const r=0x1a,g=0x73,b=0xe8; console.log('0x'+((((r&0xf8)<<8)|((g&0xfc)<<3)|(b>>3)).toString(16)))"`
→ use that hex value (e.g. `0xad55`) in the assertion. Replace the placeholder line with:
```ts
expect(resolveColor("#1a73e8", "rgb565")).toBe(0xad55); // replace with computed value
```

- [ ] **Step 5: Run to confirm pass**

Run: `npx vitest run tests/packages/cuttlefish/color-666.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 6: Build + commit**

```sh
npm run build --workspace @typecad/cuttlefish
git add packages/cuttlefish/src/ui/color.ts packages/cuttlefish/src/ui/model.ts packages/cuttlefish/src/ir/transformers/ui-lowering.ts tests/packages/cuttlefish/color-666.test.ts
git commit -m "feat(color): widen ColorFormat to admit rgb666; resolveColor routes 888→666"
```

---

## Task 2: Emit 888 values + select 888 blend math for rgb666 targets

This is the delicate task. For `colorFormat === "rgb666"`, node color literals must emit as 888 (so the 666 quantization happens at the push boundary, preserving precision through blends), and the runtime blend/lerp call sites must switch to the 888 variants. For `"rgb565"` everything stays as today (byte-identical).

**Files:**
- Modify: `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts` (line 584-588 color-literal resolution)
- Modify: `packages/cuttlefish/src/ir/transformers/ui-callback-lowering.ts` (line 125-133)
- Modify: `packages/cuttlefish/src/ir/transformers/canvas-lowering.ts` (line 54)
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts` (blend/lerp call-site selection via `UI_COLOR_DEPTH`)

- [ ] **Step 1: Add a color-value-resolution helper that picks 888 vs 565 by format**

In `packages/cuttlefish/src/ui/color.ts`, add a helper that returns the **internal representation** value (888 for rgb666, 565 for rgb565, 0/1 for mono). This is what gets emitted into node fields:

```ts
/**
 * Resolve a CSS color to the INTERNAL representation value stored in node
 * fields. For rgb666 targets this is RGB888 (666 quantization happens at the
 * push boundary so blends keep full precision); for rgb565 it is RGB565
 * (byte-identical with pre-Phase-3 behavior); for mono it is 0/1.
 */
export function resolveColorInternal(input: string, format: "rgb565" | "rgb666" | "mono"): number {
  if (format === "rgb666") return resolveColor888(input);
  return resolveColor(input, format);
}
```

- [ ] **Step 2: Route the color-literal emitters through resolveColorInternal**

In `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts` lines 584-588, the color-literal regex replacement currently calls `resolveColor(color, "rgb565")`. It needs the active `colorFormat`. Check the surrounding function for a `colorFormat` parameter; if absent, thread it from `strategy.colorFormat()` at the call site (line 350 already reads it). Replace `resolveColor(color, "rgb565")` with `resolveColorInternal(color, colorFormat)`.

Do the same in `ui-callback-lowering.ts` (line ~129) and `canvas-lowering.ts` (line 54), threading `colorFormat` where needed. For each, the change is: `resolveColor(x, "rgb565")` → `resolveColorInternal(x, colorFormat)`.

- [ ] **Step 3: Make runtime blend/lerp call sites format-driven**

In `packages/cuttlefish/src/ui/runtime-header.ts`, the emitter must select the blend/lerp variant by color depth. Add a compile-time switch the emitter sets, then guard each call site:

The runtime header is a template string emitted by `emitRuntimeHeader()`. Check whether `emitRuntimeHeader` takes a colorFormat/display parameter; if not, thread one through (read the function signature first). Then:

3a. Near the top of the emitted header, emit a depth define (the emitter writes this based on `colorFormat`):
```cpp
// Set by the emitter from the display profile's colorFormat. Drives blend/lerp
// selection: 565 for TFT byte-identity, 888 for rgb666+ targets.
#define UI_COLOR_DEPTH 565   // or 888
```

3b. At each `ui_blend565(...)` call site, wrap with a depth macro. Define a unified macro near `ui_blend888`:
```cpp
#if UI_COLOR_DEPTH == 888
  #define ui_blend(fg, bg, op) ui_blend888((fg), (bg), (op))
  #define UI_LERP_COLOR(a, b, k) lerp_color_888((a), (b), (k))
#else
  #define ui_blend(fg, bg, op) ui_blend565((fg), (bg), (op))
  #define UI_LERP_COLOR(a, b, k) lerp_color((a), (b), (k))
#endif
```

3c. Replace each `ui_blend565(` call site with `ui_blend(` and each `lerp_color(` with `UI_LERP_COLOR(`. (Find them with `grep -n "ui_blend565\|lerp_color(" runtime-header.ts` — note `lerp_color_888` and `lerp_color` both match `lerp_color(`, so exclude `_888`.)

**Critical:** the macro operands must match the active value depth. On 565, node fields hold 565 values and `ui_blend565` is correct. On 666, node fields hold 888 values (Task 2 Step 2) and `ui_blend888` is correct. The two switch together — this is the Phase 1 lesson applied.

- [ ] **Step 4: Build + run full suite (565 path must stay green)**

Run:
```sh
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish
npm run compile --workspace demo-ui
```
Expected: 617/622 pass (same 5 pre-existing failures); demo-ui (ILI9341/565) compiles byte-identical. The 666 path is wired but no test exercises it yet.

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/ui/color.ts packages/cuttlefish/src/ui/runtime-header.ts packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts packages/cuttlefish/src/ir/transformers/ui-callback-lowering.ts packages/cuttlefish/src/ir/transformers/canvas-lowering.ts
git commit -m "feat(runtime): rgb666 emits 888 values + selects ui_blend888/lerp_color_888 via UI_COLOR_DEPTH; 565 path byte-identical"
```

---

## Task 3: Register the ST7796S adapter (565 + 666 modes)

**Files:**
- Create: `packages/cuttlefish/src/api/shared/display-adapters/st7796.ts`
- Modify: `packages/cuttlefish/src/api/shared/display-adapter.ts`
- Modify: `packages/framework-arduino/src/strategy.ts` (line 1305)
- Test: `tests/packages/cuttlefish/st7796-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/st7796-adapter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveDisplayAdapter } from "../../../packages/cuttlefish/src/api/shared/display-adapter";

describe("ST7796S adapter", () => {
  const profile565 = { _mountCs: 5, _mountDc: 21, _mountRst: 22, rotation: 1, colorFormat: "rgb565" as const, spiFrequency: 40000000, width: 320, height: 480 };
  const profile666 = { ...profile565, colorFormat: "rgb666" as const };

  it("is registered for driver 'st7796'", () => {
    expect(resolveDisplayAdapter("st7796", profile565 as any)).toBeTruthy();
  });

  it("565 mode emits a uint16_t writePixels push (byte-identical with ILI9341)", () => {
    const gen = resolveDisplayAdapter("st7796", profile565 as any)!;
    expect(gen.functions).toMatch(/display_writePixels\(uint16_t\* pixels/);
    expect(gen.includes).toMatch(/Adafruit_ST7796/);
  });

  it("666 mode emits an 18-bit push path", () => {
    const gen = resolveDisplayAdapter("st7796", profile666 as any)!;
    // 666 mode packs to 18-bit / 3-byte pixels for the ST7796S 18-bit bus.
    expect(gen.functions).toMatch(/rgb666|18-bit|writePixels/);
  });
});
```

(If `resolveDisplayAdapter` is not the exported lookup name, check `display-adapter.ts` exports and adjust — read the file first.)

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/packages/cuttlefish/st7796-adapter.test.ts`
Expected: FAIL — `st7796` not registered.

- [ ] **Step 3: Create the ST7796S adapter**

Create `packages/cuttlefish/src/api/shared/display-adapters/st7796.ts`. The ST7796S uses `Adafruit_ST7796` (or the TFT_eSPI ST7796 path). For 565 mode, mirror the ILI9341 adapter but with ST7796 includes/decl. For 666 mode, the push packs 888→666 into 3 bytes/pixel. The adapter reads `display.colorFormat` to pick the mode:

```ts
import type { DisplayAdapterGenerator } from "../display-adapter.js";

export const st7796Adapter: DisplayAdapterGenerator = (display) => {
  const cs = display._mountCs;
  const dc = display._mountDc;
  const rst = display._mountRst;
  const rotation = display.rotation ?? 1;
  const spiFreq = display.spiFrequency;
  const is666 = display.colorFormat === "rgb666";

  const includes = is666
    ? [`#define CuttlefishDisplayTarget Adafruit_GFX`, `#define CuttlefishCanvas16 GFXcanvas16`, `#include <Adafruit_GFX.h>`, `#include <Adafruit_ST7796.h>`]
    : [`#define CuttlefishDisplayTarget Adafruit_GFX`, `#define CuttlefishCanvas16 GFXcanvas16`, `#include <Adafruit_GFX.h>`, `#include <Adafruit_ST7796.h>`];

  // Push: 565 mode reuses the standard uint16_t writePixels. 666 mode packs
  // each 888-stored pixel to 18-bit (3 bytes) for the ST7796S's 18-bit bus.
  const writePixels = is666
    ? [
        `static inline void display_writePixels(uint32_t* pixels, uint32_t count) {`,
        `  // Pack RGB888 → 18-bit (6-6-6) → 3 bytes/pixel for the ST7796S bus.`,
        `  uint8_t buf[3 * 32];  // batch of 32 px`,
        `  for (uint32_t base = 0; base < count; base += 32) {`,
        `    uint32_t n = (count - base < 32) ? (count - base) : 32;`,
        `    for (uint32_t i = 0; i < n; i++) {`,
        `      uint32_t c = pixels[base + i];`,
        `      buf[i * 3]     = (c >> 16) & 0xfc;   // R6`,
        `      buf[i * 3 + 1] = (c >> 8) & 0xfc;   // G6`,
        `      buf[i * 3 + 2] = c & 0xfc;          // B6`,
        `    }`,
        `    __tc_display.writeColorBytes(buf, n * 3);  // or SPI.writeBytes`,
        `  }`,
        `}`,
      ].join("\n")
    : [
        `static inline void display_writePixels(uint16_t* pixels, uint32_t count) {`,
        `  __tc_display.writePixels(pixels, count);`,
        `}`,
      ].join("\n");

  return {
    includes: includes.join("\n"),
    declaration: `Adafruit_ST7796 __tc_display = Adafruit_ST7796(${cs}, ${dc}, ${rst});`,
    functions: [
      `// --- Display adapter: ST7796S (${is666 ? "RGB666" : "RGB565"}) ---`,
      `static inline void display_init() {`,
      spiFreq ? `  __tc_display.begin(${spiFreq});` : `  __tc_display.begin();`,
      `  __tc_display.setRotation(${rotation});`,
      `  __tc_display.fillScreen(0x000000);`,
      `}`,
      `static inline void display_fillScreen(uint32_t color) { __tc_display.fillScreen(color); }`,
      `static inline CuttlefishDisplayTarget* display_defaultTarget() { return &__tc_display; }`,
      `static inline int16_t display_width() { return __tc_display.width(); }`,
      `static inline int16_t display_height() { return __tc_display.height(); }`,
      `static inline void display_startWrite() { __tc_display.startWrite(); }`,
      `static inline void display_endWrite() { __tc_display.endWrite(); }`,
      `static inline void display_setAddrWindow(int16_t x, int16_t y, int16_t w, int16_t h) { __tc_display.setAddrWindow(x, y, w, h); }`,
      writePixels,
    ].join("\n"),
  };
};
```

**Note:** the exact ST7796S library API (`Adafruit_ST7796` vs TFT_eSPI's `ST7796` class, `writeColorBytes` vs `SPI.writeBytes`) must be verified against the target library before this is merged. The 666 push path is illustrative; the precise bus-packing API depends on the chosen library. Flag this as a verification step.

- [ ] **Step 4: Register the adapter + widen the driver set**

In `packages/cuttlefish/src/api/shared/display-adapter.ts`, import and register:
```ts
import { st7796Adapter } from "./display-adapters/st7796.js";
registerDisplayAdapter("st7796", st7796Adapter);
```

In `packages/framework-arduino/src/strategy.ts` line 1305:
```ts
  supportedDisplayDrivers(): ReadonlySet<string> {
    return new Set(["ili9341", "st7796"]);
  }
```

- [ ] **Step 5: Run + commit**

```sh
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish/st7796-adapter.test.ts
git add packages/cuttlefish/src/api/shared/display-adapters/st7796.ts packages/cuttlefish/src/api/shared/display-adapter.ts packages/framework-arduino/src/strategy.ts tests/packages/cuttlefish/st7796-adapter.test.ts
git commit -m "feat(adapter): register ST7796S in 565 + 666 modes; add to supportedDisplayDrivers"
```

---

## Task 4: Preview parity for rgb666 (888 values + 888 blend)

**Files:**
- Modify: `packages/cuttlefish/src/preview/host-ui-runtime.ts` (`resolveRuntimeColor`, line 99)
- Modify: `packages/cuttlefish/src/preview/host-ui-runtime.ts` (blend call sites)

The preview must match the device: for rgb666 it resolves 888 values and blends via `blendRgb888`; for rgb565 it stays as today. The active format comes from `this.snapshot.program.colorFormat` (already threaded).

- [ ] **Step 1: Make resolveRuntimeColor format-aware**

In `packages/cuttlefish/src/preview/host-ui-runtime.ts`, `resolveRuntimeColor` currently always returns 565. Make it consult the snapshot's colorFormat:

```ts
function resolveRuntimeColor(this: HostUiRuntime, value: unknown): number {
  const fmt = this.snapshot.program.colorFormat;
  if (typeof value === "number") return value & (fmt === "rgb666" ? 0xffffff : 0xffff);
  if (typeof value === "string") {
    if (fmt === "rgb666") return resolveColor888(value) & 0xffffff;
    return resolveColor(value, "rgb565") & 0xffff;
  }
  return 0;
}
```

(If `resolveRuntimeColor` is a free function without `this`, pass the format in or read from a module-level current-format. Check the current shape first.)

- [ ] **Step 2: Select blend function by format**

At each `blendRgb565(...)` call site in `host-ui-runtime.ts` (opacity, shadows, gradients — find with `grep -n "blendRgb565" host-ui-runtime.ts`), gate on the format:

```ts
const blend = this.snapshot.program.colorFormat === "rgb666" ? blendRgb888 : blendRgb565;
// ... use blend(fg, bg, op) instead of blendRgb565(fg, bg, op)
```

The AA text path in `host-gfx.ts` (`drawAntialiasedText`, line ~482) also calls `blendRgb565`. For rgb666 it should use `blendRgb888`. Thread the format into `drawAntialiasedText` or read it from a runtime accessor. (Phase 1 left this path in 565; Phase 3 makes it format-aware.)

- [ ] **Step 3: Add a preview parity test**

Add to `tests/packages/cuttlefish/preview-gfx.test.ts` a test that constructs a tiny rgb666 snapshot and asserts the framebuffer holds 888 values and a blended pixel matches `blendRgb888` (not `blendRgb565`). Use the minimal-snapshot builder pattern from `host-rich-text.test.ts`.

- [ ] **Step 4: Build + run + commit**

```sh
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish/preview-gfx.test.ts tests/packages/cuttlefish/host-rich-text.test.ts
git add packages/cuttlefish/src/preview/host-ui-runtime.ts packages/cuttlefish/src/preview/host-gfx.ts tests/packages/cuttlefish/preview-gfx.test.ts
git commit -m "feat(preview): rgb666 resolves 888 + blends via blendRgb888; 565 path unchanged"
```

---

## Task 5: Phase 3 verification & sign-off

- [ ] **Step 1: Clean build + full suite**

```sh
rm -f packages/cuttlefish/*.tsbuildinfo
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish
```
Expected: 617 baseline + new Phase 3 tests pass; only the 5 known-unrelated failures.

- [ ] **Step 2: ILI9341/565 byte-identity (demo-ui)**

```sh
npm run compile --workspace demo-ui
```
Expected: exit 0, output byte-identical (demo-ui profile is ILI9341/565 — the rgb666 path is inert).

- [ ] **Step 3: Mark Phase 3 complete in spec + commit**

In `docs/superpowers/specs/2026-07-02-display-agnostic-core-design.md`, update the Phase 3 line. Commit:
```bash
git add docs/superpowers/specs/2026-07-02-display-agnostic-core-design.md
git commit -m "docs(spec): mark Phase 3 complete — RGB666 shim + ST7796S"
```

---

## Self-Review

**1. Spec coverage (Phase 3 of spec §6 + §2.3 + §3.1 + §3.3):**
- §3.1 rgb666 quantization → Task 1.
- §3.1 888 values + 888 blend math on rgb666 → Task 2 (the Phase 1 lesson applied: switch together).
- §3.3 ST7796S adapter registration (565 + 666) → Task 3.
- §3.5 preview parity → Task 4.
- ILI9341/565 byte-identity → Task 2 Step 4 + Task 5 Step 2.

**2. Phase 1 lesson explicitly applied:** Task 2 switches values (888) and blend math (ui_blend888) *together*, driven by `UI_COLOR_DEPTH`. The 565 path keeps 565 values + 565 math. This is exactly what the Phase 1 counterexample proved necessary.

**3. Placeholder scan:** the ST7796S library API (`Adafruit_ST7796`, `writeColorBytes`) is flagged for verification against the real library — this is an honest unknown, not a hidden TBD. All other steps have complete code.

**4. Type consistency:** `ColorFormat = "rgb565" | "rgb666" | "mono"` matches across color.ts, model.ts, ui-lowering.ts. `resolveColorInternal`, `UI_COLOR_DEPTH`, `ui_blend`/`UI_LERP_COLOR` macros consistent across tasks.

**5. Risk note:** Task 2's runtime-header macro refactor touches many blend call sites. If the macro approach proves fragile (operand type mismatches between 565 and 888), the fallback is to emit two variants of the runtime header and select at emit time. The macro approach is preferred for code-size; the fallback is acceptable.
