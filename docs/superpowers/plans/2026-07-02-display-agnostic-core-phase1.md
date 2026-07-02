# Display-Agnostic Core — Phase 1: RGB888 Storage Widen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the cuttlefish color *storage* from RGB565 (`uint16_t`) to RGB888 (`uint32_t`) across the runtime header, preview framebuffer, and color API — **without changing rendered output by a single pixel** — so Phase 2 can route emit through RGB888 + per-shim quantization.

**Architecture:** The defining constraint is byte-identity: Phase 1 produces output identical to today. This is only possible if Phase 1 widens **storage types only** and leaves all blend/lerp math in 565. Verified by counterexample: blending in 888 then quantizing differs from quantizing-then-blending-in-565 (e.g. R-channel of value 36 blended with 0 at 50% gives 565-R=16 in 888-blend but 565-R=2 in 565-blend). So Phase 1:
- Adds `resolveColor888` + quantizers (`rgb888To565/666/mono/nearest`) as pure functions.
- Rebases `resolveColor(input, format)` on `resolveColor888` so all existing call sites produce identical 565/mono output.
- Widens the C++ `UINode` color fields `uint16_t`→`uint32_t` and the preview `Uint16Array`→`Uint32Array`. A 565 value stored in a wider field is bit-identical.
- **Keeps** `ui_blend565`/`lerp_color` (565 math) — the field widening is safe because 565 math on a 565 value held in a `uint32_t` produces the same result as in a `uint16_t` (the high 16 bits are zero).
- Adds the 888 blend/lerp functions **alongside** (not replacing), unused until Phase 2.
- The preview framebuffer stores 888 but the 565 blend math is preserved; `toRgbaBytes("rgb565")` reconstructs the device-identical 565-quantized output.

Phase 2 will switch emit to `resolveColor888` for RGB888 targets, switch blend call sites to 888, and update affected test expectations to the new (correctly-blended) values.

**Tech Stack:** TypeScript (transpiler), C++ (emitted runtime header), Vitest (tests).

**Spec:** `docs/superpowers/specs/2026-07-02-display-agnostic-core-design.md` (Phase 1 of 4).
**Research:** `docs/superpowers/research/2026-07-02-eink-display-support-research.md`.

**Verification baseline (run after every task that touches code):**
```sh
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish
npm run compile --workspace demo-ui
```

---

## File Structure

**Modified:**
- `packages/cuttlefish/src/ui/color.ts` — add `resolveColor888` + quantizers + `pack888`/`unpack888`; `resolveColor` becomes a wrapper preserving 565/mono behavior.
- `packages/cuttlefish/src/ui/runtime-header.ts` — widen `uint16_t` color fields → `uint32_t`; add `ui_blend888` + `lerp_color_888` alongside (unused in Phase 1); keep `ui_blend565`/`lerp_color` (565) for TFT byte-identity.
- `packages/cuttlefish/src/preview/host-gfx.ts` — framebuffer `Uint16Array`→`Uint32Array`; add `blendRgb888`; keep `blendRgb565`; `toRgbaBytes(format?)` quantizes through the requested format.
- `packages/cuttlefish/src/preview/host-ui-runtime.ts` — `resolveRuntimeColor` resolves to 888 storage; convert hardcoded 565 literals to their 888 equivalents so the framebuffer holds true 888 (while blend math stays 565 — see Task 4 note).
- `packages/cuttlefish/src/api/shared/graphics-strategy.ts`, `platform/generic-strategy.ts` — `colorFormat()` return type widened (Phase 2 readiness; values unchanged).

**Created (tests):**
- `tests/packages/cuttlefish/color-888.test.ts` — quantizer + 888 resolution tests.

**Modified (tests):**
- `tests/packages/cuttlefish/color.test.ts` — quantizer + `resolveColor888` assertions.
- `tests/packages/cuttlefish/runtime-header.test.ts` — field-widen + dual-blend byte-identity guard.
- `tests/packages/cuttlefish/preview-gfx.test.ts` — 888 storage + format-aware `toRgbaBytes` guard.

**Unchanged in Phase 1 (deliberately):**
- `packages/cuttlefish/src/ui/model.ts`, `keyframes.ts`, and all `ir/transformers/*` call sites. They still call `resolveColor(input, colorFormat)` and produce 565 device literals. No change needed because `resolveColor` preserves its behavior (Task 2).

---

## Task 1: Add RGB888 quantizers (pure functions, TDD)

**Files:**
- Modify: `packages/cuttlefish/src/ui/color.ts:177-189`
- Test: `tests/packages/cuttlefish/color.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/packages/cuttlefish/color.test.ts`, before the final `});`:

```ts
  it("converts rgb888 to rgb565", () => {
    expect(rgb888To565(0xff0000)).toBe(0xf800);
    expect(rgb888To565(0x00ff00)).toBe(0x07e0);
    expect(rgb888To565(0x0000ff)).toBe(0x001f);
    expect(rgb888To565(0xffffff)).toBe(0xffff);
    expect(rgb888To565(0x000000)).toBe(0x0000);
  });

  it("rgb888To565 matches toRGB565 channel math", () => {
    // 0x1a73e8 = Google blue; verify against direct channel truncation
    expect(rgb888To565(0x1a73e8))
      .toBe(toRGB565((0x1a73e8 >> 16) & 0xff, (0x1a73e8 >> 8) & 0xff, 0x1a73e8 & 0xff));
  });

  it("converts rgb888 to rgb666 (6 bits per channel)", () => {
    expect(rgb888To666(0xffffff)).toBe(0x3ffff);
    expect(rgb888To666(0x000000)).toBe(0x00000);
    expect(rgb888To666(0xff0000)).toBe(0x3f000);
    expect(rgb888To666(0x00ff00)).toBe(0x00fc0);
    expect(rgb888To666(0x0000ff)).toBe(0x0003f);
  });

  it("converts rgb888 to mono via luminance threshold", () => {
    expect(rgb888ToMono(0x000000)).toBe(0);
    expect(rgb888ToMono(0xffffff)).toBe(1);
    expect(rgb888ToMono(0x404040)).toBe(0);
    expect(rgb888ToMono(0xdddddd)).toBe(1);
  });

  it("rgb888ToMono matches toMono for equivalent RGB", () => {
    for (const c of [0x000000, 0xffffff, 0x808080, 0x1a73e8, 0xff0000]) {
      expect(rgb888ToMono(c))
        .toBe(toMono((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff));
    }
  });

  it("packs rgb888 from channels", () => {
    expect(pack888(255, 0, 0)).toBe(0xff0000);
    expect(pack888(0, 255, 0)).toBe(0x00ff00);
    expect(pack888(0, 0, 255)).toBe(0x0000ff);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/packages/cuttlefish/color.test.ts`
Expected: FAIL — `rgb888To565`, `rgb888To666`, `rgb888ToMono`, `pack888` not exported.

- [ ] **Step 3: Add the quantizer implementations**

In `packages/cuttlefish/src/ui/color.ts`, add after the existing `toMono` (before `resolveColor`):

```ts
/** Pack 8-bit channels into a uint32 RGB888 value (R<<16 | G<<8 | B). */
export function pack888(r: number, g: number, b: number): number {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

/** Unpack a uint32 RGB888 value into 8-bit channels. */
export function unpack888(c: number): { r: number; g: number; b: number } {
  return { r: (c >> 16) & 0xff, g: (c >> 8) & 0xff, b: c & 0xff };
}

/** Quantize RGB888 → RGB565 (uint16). Channel math identical to toRGB565. */
export function rgb888To565(c: number): number {
  const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

/** Quantize RGB888 → RGB666 (uint18 packed in lower 18 bits). */
export function rgb888To666(c: number): number {
  const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
  return ((r & 0xfc) << 10) | ((g & 0xfc) << 4) | (b >> 2);
}

/** Quantize RGB888 → 1-bit mono via luminance threshold (matches toMono). */
export function rgb888ToMono(c: number): 0 | 1 {
  const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
  return toMono(r, g, b);
}

/**
 * Snap RGB888 to the nearest ink in a palette. Palette entries are RGB888 values.
 * Used by e-ink palette shims (Phase 4); included so the quantizer set is complete.
 */
export function rgb888ToNearest(c: number, palette888: number[]): number {
  const r1 = (c >> 16) & 0xff, g1 = (c >> 8) & 0xff, b1 = c & 0xff;
  let best = palette888[0];
  let bestD = Infinity;
  for (const ink of palette888) {
    const dr = (ink >> 16) & 0xff, dg = (ink >> 8) & 0xff, db = ink & 0xff;
    const dr2 = r1 - dr, dg2 = g1 - dg, db2 = b1 - db;
    const d = dr2 * dr2 + dg2 * dg2 + db2 * db2;
    if (d < bestD) { bestD = d; best = ink; }
  }
  return best;
}
```

- [ ] **Step 4: Update the test imports**

In `tests/packages/cuttlefish/color.test.ts`, change the import line (line 2) to:

```ts
import { parseColor, toRGB565, toMono, resolveColor, rgb888To565, rgb888To666, rgb888ToMono, pack888 } from "@typecad/cuttlefish/ui/color";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/packages/cuttlefish/color.test.ts`
Expected: PASS (all assertions, including the parity assertions that `rgb888To565(0x1a73e8)` matches `toRGB565` channel math).

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ui/color.ts tests/packages/cuttlefish/color.test.ts
git commit -m "feat(color): add RGB888 quantizers (565/666/mono/nearest) + pack/unpack"
```

---

## Task 2: Introduce `resolveColor888` and rebase `resolveColor` on it

**Files:**
- Modify: `packages/cuttlefish/src/ui/color.ts:186-189`
- Test: `tests/packages/cuttlefish/color.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/color.test.ts`:

```ts
  it("resolveColor888 always returns packed RGB888", () => {
    expect(resolveColor888("#ff0000")).toBe(0xff0000);
    expect(resolveColor888("red")).toBe(0xff0000);
    expect(resolveColor888("rgb(0,255,0)")).toBe(0x00ff00);
    expect(resolveColor888("#1a73e8")).toBe(0x1a73e8);
    expect(resolveColor888("white")).toBe(0xffffff);
    expect(resolveColor888("transparent")).toBe(0x000000);
  });

  it("resolveColor is now resolveColor888 + quantize (unchanged 565/mono output)", () => {
    expect(resolveColor("#ff0000", "rgb565")).toBe(0xf800);
    expect(resolveColor("#00ff00", "rgb565")).toBe(0x07e0);
    expect(resolveColor("#0000ff", "rgb565")).toBe(0x001f);
    expect(resolveColor("#1a73e8", "rgb565")).toBe(rgb888To565(0x1a73e8));
    expect(resolveColor("#ffffff", "mono")).toBe(1);
    expect(resolveColor("#000000", "mono")).toBe(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/color.test.ts`
Expected: FAIL — `resolveColor888` not exported.

- [ ] **Step 3: Rebase resolveColor on resolveColor888**

In `packages/cuttlefish/src/ui/color.ts`, replace the `resolveColor` function (lines 186-189):

```ts
export function resolveColor(input: string, format: "rgb565" | "mono"): number {
  const { r, g, b } = parseColor(input);
  return format === "rgb565" ? toRGB565(r, g, b) : toMono(r, g, b);
}
```

with:

```ts
/**
 * Resolve any CSS color string to packed RGB888 (uint32, R<<16 | G<<8 | B).
 * Canonical color resolution for the display-agnostic core. Alpha is ignored
 * (no blending), matching parseColor semantics.
 */
export function resolveColor888(input: string): number {
  const { r, g, b } = parseColor(input);
  return pack888(r, g, b);
}

/**
 * Resolve a CSS color string and quantize to a target format. Backwards-
 * compatible wrapper over resolveColor888 + quantizer. Existing call sites
 * keep their behavior (565/mono output unchanged).
 */
export function resolveColor(input: string, format: "rgb565" | "mono"): number {
  const c = resolveColor888(input);
  return format === "rgb565" ? rgb888To565(c) : rgb888ToMono(c);
}
```

Update the test import line to include `resolveColor888`:

```ts
import { parseColor, toRGB565, toMono, resolveColor, resolveColor888, rgb888To565, rgb888To666, rgb888ToMono, pack888 } from "@typecad/cuttlefish/ui/color";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/packages/cuttlefish/color.test.ts`
Expected: PASS — including the unchanged-565-output assertions (first byte-identity guard).

- [ ] **Step 5: Build and run the full cuttlefish test suite**

Run:
```sh
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish
```
Expected: PASS — no call-site changes, so all existing tests remain green. This confirms `resolveColor`'s observable behavior is unchanged across every consumer (model.ts, keyframes.ts, all transformers, preview).

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ui/color.ts tests/packages/cuttlefish/color.test.ts
git commit -m "feat(color): add resolveColor888; rebase resolveColor as 888+quantize (no behavior change)"
```

---

## Task 3: Widen the emitted C++ runtime color *fields* (storage only)

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts` — struct fields + add 888 blend/lerp alongside (no call-site switch)

**Why storage-only:** A 565 value stored in a `uint32_t` field is bit-identical to the same value in a `uint16_t` field (the high 16 bits are zero). 565 blend math (`ui_blend565`/`lerp_color`) operating on a 565 value held in a wider field produces identical results. This is what makes Phase 1 byte-identity possible. Phase 2 will switch emit to 888 values and switch the blend call sites; Phase 1 does neither.

- [ ] **Step 1: Widen UINode color fields**

In `packages/cuttlefish/src/ui/runtime-header.ts`, change these struct field declarations (find exact lines; numbers approximate from the exploration):
- `uint16_t bg;` → `uint32_t bg;`
- `uint16_t fg;` → `uint32_t fg;`
- `uint16_t borderColor;` → `uint32_t borderColor;`
- `uint16_t gradientColor1;` → `uint32_t gradientColor1;`
- `uint16_t gradientColor2;` → `uint32_t gradientColor2;`
- `uint16_t shadowColor[4];` → `uint32_t shadowColor[4];`
- `uint16_t textShadowColor;` → `uint32_t textShadowColor;`
- `uint16_t clearColor;` → `uint32_t clearColor;`
- `UIKeyframeStop.bg/fg` → `uint32_t`.
- `UIBinding`'s color fn pointer return (line ~234): `uint16_t (*fn)(void);` → `uint32_t (*fn)(void);`

Leave `UIImage { const uint16_t* data; }` **unchanged in Phase 1**. Image data format is a larger change (3 bytes/px packing, asset lowering); it is scoped to Phase 3 in the spec. The `const uint16_t*` is image pixel data, not a node color field, and is consumed by a separate path.

- [ ] **Step 2: Add the 888 blend/lerp functions alongside (not replacing)**

Add these new functions near `lerp_color` (line ~238) and `ui_blend565` (line ~2441). Do **not** remove or modify the existing 565 versions:

```cpp
// RGB888 lerp — for transitions on RGB888/RGB666 targets (Phase 2+). Unused
// in Phase 1; the 565 lerp_color above remains the active path for TFT targets.
static inline uint32_t lerp_color_888(uint32_t a, uint32_t b, uint8_t k100) {
  if (k100 >= 100) return b;
  uint8_t ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  uint8_t br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  int16_t r = ar + (int16_t)(((int16_t)br - (int16_t)ar) * k100 / 100);
  int16_t g = ag + (int16_t)(((int16_t)bg - (int16_t)ag) * k100 / 100);
  int16_t bl = ab + (int16_t)(((int16_t)bb - (int16_t)ab) * k100 / 100);
  return ((uint32_t)(r & 0xff) << 16) | ((uint32_t)(g & 0xff) << 8) | (uint32_t)(bl & 0xff);
}

// Blend two RGB888 colors by opacity (0-100). Unused in Phase 1; Phase 2 routes
// blend call sites here for RGB888/RGB666 targets. The 565 ui_blend565 above
// remains active for TFT byte-identity.
static inline uint32_t ui_blend888(uint32_t fg, uint32_t bg, uint8_t opacity) {
  if (opacity >= 100) return fg;
  if (opacity == 0) return bg;
  uint8_t fr = (fg >> 16) & 0xff, fg8 = (fg >> 8) & 0xff, fb = fg & 0xff;
  uint8_t br = (bg >> 16) & 0xff, bg8 = (bg >> 8) & 0xff, bb = bg & 0xff;
  uint8_t r = (fr * opacity + br * (100 - opacity)) / 100;
  uint8_t g = (fg8 * opacity + bg8 * (100 - opacity)) / 100;
  uint8_t b = (fb * opacity + bb * (100 - opacity)) / 100;
  return ((uint32_t)r << 16) | ((uint32_t)g << 8) | b;
}
```

- [ ] **Step 3: Do NOT touch any 565 call site, literal, or sentinel**

Verify nothing else changed in the file:
- `ui_blend565` calls (opacity, shadows, gradients, AA) — **unchanged**.
- `display_fillScreen(0x0000)`, `ui_display_set_text_color(0xFFFF, 0x0000)`, `0x8410` placeholder — **unchanged** (these are 565 values stored in now-wider fields; still correct).
- `UI_NO_PARENT 0xFFFF` — **unchanged** (a node-index sentinel, not a color).

Run: `git diff packages/cuttlefish/src/ui/runtime-header.ts | grep "^[+-]" | grep -v "uint32_t\|uint16_t\|lerp_color_888\|ui_blend888\|RGB888\|Phase 2"`
Expected: no output (only field-type widenings and the new function additions appear).

- [ ] **Step 4: Build (model.ts emit still produces 565 literals — fine in uint32_t fields)**

Run:
```sh
npm run build --workspace @typecad/cuttlefish
```
Expected: builds clean. (Do not run the full test suite yet — the preview-side Task 4 should land first if preview tests assert internal buffer types. If build passes, proceed.)

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts
git commit -m "feat(runtime): widen UINode color fields uint16->uint32 (888-ready); add 888 blend/lerp alongside; keep 565 math for TFT byte-identity"
```

---

## Task 4: Widen the preview framebuffer to RGB888 storage

**Files:**
- Modify: `packages/cuttlefish/src/preview/host-gfx.ts:9-33, 36, 51, 90-96, 129, 136, 355-358, 384-465, 512-523`
- Test: `tests/packages/cuttlefish/preview-gfx.test.ts`

**Phase 1 boundary:** The preview framebuffer stores 888, but blend math stays **565** (Task 4 keeps `blendRgb565` as the active blend; `blendRgb888` is added alongside, unused in Phase 1). The `0x7bef`-mask dimming idiom stays 565. `toRgbaBytes("rgb565")` quantizes through `rgb888To565` so the canvas shows the device-identical 565 output. This preserves preview/runtime byte-identity.

- [ ] **Step 1: Write failing tests for 888 storage + format-aware output**

Append to `tests/packages/cuttlefish/preview-gfx.test.ts`:

```ts
import { HostAdafruitGFX } from "@typecad/cuttlefish/preview/host-gfx";

describe("HostAdafruitGFX RGB888 storage (Phase 1)", () => {
  it("stores colors as packed RGB888 in the buffer", () => {
    const gfx = new HostAdafruitGFX(4, 1);
    gfx.drawPixel(0, 0, 0xff0000);
    gfx.drawPixel(1, 0, 0x00ff00);
    gfx.drawPixel(2, 0, 0xffffff);
    expect(gfx.buffer[0]).toBe(0xff0000);
    expect(gfx.buffer[1]).toBe(0x00ff00);
    expect(gfx.buffer[2]).toBe(0xffffff);
  });

  it("toRgbaBytes('rgb565') quantizes 888->565->888 (device-identical)", () => {
    const gfx = new HostAdafruitGFX(1, 1);
    gfx.drawPixel(0, 0, 0xff0000); // 888 red -> 565 0xf800 -> expanded 888
    const rgba = gfx.toRgbaBytes("rgb565");
    // 565 0xf800 expands: R = (0x1f<<3)|(0x1f>>2) = 248, G=0, B=0
    expect(rgba[0]).toBe(248);
    expect(rgba[1]).toBe(0);
    expect(rgba[2]).toBe(0);
    expect(rgba[3]).toBe(255);
  });

  it("toRgbaBytes() default returns full 888", () => {
    const gfx = new HostAdafruitGFX(1, 1);
    gfx.drawPixel(0, 0, 0x1a73e8);
    const rgba = gfx.toRgbaBytes();
    expect(rgba[0]).toBe(0x1a);
    expect(rgba[1]).toBe(0x73);
    expect(rgba[2]).toBe(0xe8);
  });

  it("blendRgb565 still present and correct (Phase 1 keeps 565 blend math)", () => {
    const { blendRgb565 } = require("@typecad/cuttlefish/preview/host-gfx");
    // 50% blend of red(0xf800) toward black(0x0000) in 565
    const result = blendRgb565(0xf800, 0x0000, 50);
    // R5: 0x1f*50/100 = 15 (0x0f) -> 0x7800
    expect(result).toBe(0x7800);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/packages/cuttlefish/preview-gfx.test.ts`
Expected: FAIL — buffer is `Uint16Array` (so `0xff0000` truncates to `0x0000`); `toRgbaBytes` takes no format arg.

- [ ] **Step 3: Add `rgb888To565` + `rgb565To888` helpers to host-gfx**

In `packages/cuttlefish/src/preview/host-gfx.ts`, after the existing `rgb565ToRgb888` (lines 9-18), add:

```ts
/** Quantize a packed RGB888 value to RGB565 (uint16). */
export function rgb888To565(color: number): number {
  const r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

/** Reconstruct a packed RGB888 value from a 565 value (lossy). */
export function rgb565To888(color: number): number {
  const { r, g, b } = rgb565ToRgb888(color);
  return (r << 16) | (g << 8) | b;
}
```

- [ ] **Step 4: Add `blendRgb888` alongside `blendRgb565` (do NOT remove blendRgb565)**

Add after the existing `blendRgb565` (lines 20-33):

```ts
/** Blend two RGB888 colors by opacity (0-100). Added for Phase 2; unused in Phase 1. */
export function blendRgb888(fg: number, bg: number, opacity: number): number {
  if (opacity >= 100) return fg & 0xffffff;
  if (opacity <= 0) return bg & 0xffffff;
  const fr = (fg >> 16) & 0xff, fg8 = (fg >> 8) & 0xff, fb = fg & 0xff;
  const br = (bg >> 16) & 0xff, bg8 = (bg >> 8) & 0xff, bb = bg & 0xff;
  const r = Math.trunc((fr * opacity + br * (100 - opacity)) / 100);
  const g = Math.trunc((fg8 * opacity + bg8 * (100 - opacity)) / 100);
  const b = Math.trunc((fb * opacity + bb * (100 - opacity)) / 100);
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}
```

Leave `blendRgb565` exactly as-is. Phase 1 keeps it as the active blend path.

- [ ] **Step 5: Widen the buffer type and color masks**

In `packages/cuttlefish/src/preview/host-gfx.ts`:
- `readonly buffer: Uint16Array;` (line 36) → `readonly buffer: Uint32Array;`
- `this.buffer = new Uint16Array(width * height);` (line 51) → `this.buffer = new Uint32Array(width * height);`
- `this.buffer[y * this.width + x] = color & 0xffff;` (line 95) → `& 0xffffff`
- `const c = color & 0xffff;` (line 129) → `& 0xffffff`
- `this.buffer.fill(color & 0xffff);` (line 136) → `& 0xffffff`
- `this.textColor = color & 0xffff;` (line 356) and `bg & 0xffff` (line 357) → `& 0xffffff`
- In `drawAntialiasedText`, the local `fg = color & 0xffff` / `background = bg & 0xffff` (lines ~419-421) → `& 0xffffff`. The `src.buffer[yy * w + xx] === fg` comparison (lines 431, 452) and the `blendRgb565(fg, background, coverage)` call (line 456) stay as 565 blend math — the operands are 888 values, but in Phase 1 the blend call is **kept as `blendRgb565`** because the preview must stay byte-identical with the runtime's 565 blend. (This means the preview blends in 565 even though the buffer holds 888 — correct for Phase 1, since both sides blend in 565.)

- [ ] **Step 6: Update `toRgbaBytes` to take an optional format**

Replace `toRgbaBytes` (lines 512-523):

```ts
toRgbaBytes(format?: "rgb565" | "rgb666" | "rgb888"): Uint8ClampedArray {
  const out = new Uint8ClampedArray(this.buffer.length * 4);
  for (let i = 0; i < this.buffer.length; i++) {
    let r: number, g: number, b: number;
    if (format === "rgb565") {
      // Active TFT shim: quantize 888->565->888 to match device output.
      ({ r, g, b } = rgb565ToRgb888(rgb888To565(this.buffer[i])));
    } else {
      // rgb888 (default) or rgb666 (Phase 3): full 888.
      r = (this.buffer[i] >> 16) & 0xff;
      g = (this.buffer[i] >> 8) & 0xff;
      b = this.buffer[i] & 0xff;
    }
    const p = i * 4;
    out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = 255;
  }
  return out;
}
```

- [ ] **Step 7: Run the new tests to verify they pass**

Run: `npx vitest run tests/packages/cuttlefish/preview-gfx.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the broader preview suite to catch caller breakage**

Run: `npx vitest run tests/packages/cuttlefish/host-rich-text.test.ts tests/packages/cuttlefish/preview-cross-screen.test.ts tests/packages/cuttlefish/preview-scroll.test.ts`
Expected: PASS. (The blend math is unchanged; only storage widened. If a test asserts internal `buffer` values directly, it may need updating to 888 — but rendered output via `toRgbaBytes("rgb565")` is identical.)

- [ ] **Step 9: Commit**

```bash
git add packages/cuttlefish/src/preview/host-gfx.ts tests/packages/cuttlefish/preview-gfx.test.ts
git commit -m "feat(preview): widen host-gfx framebuffer to RGB888 storage; add blendRgb888 + format-aware toRgbaBytes; keep 565 blend for byte-identity"
```

---

## Task 5: Preview runtime color resolution — NO CHANGE in Phase 1

**Files:** none.

**Phase 1 boundary (revised during execution):** `resolveRuntimeColor` keeps
returning 565 values, and the framebuffer stores 565 values in the widened
`Uint32Array`. This is a deliberate departure from the original Task 5 draft,
which proposed making preview values "true 888."

**Why the change:** Making preview values true 888 while keeping device values
565 breaks every blend site. Proven by counterexample during Task 4 execution:
blending 888 operands with 565 math gives wrong results (e.g. 888 R-channel 36
blended with 0 at 50% → 565 R=16 under 888-blend, but the device's 565 path
gives R=2). Phase 1's invariant is byte-identity, which requires values to
stay 565 everywhere (preview and runtime). True-888 values + 888 blend math
land together in Phase 2, when the descriptor routes emit through
`resolveColor888` and both sides switch consistently.

The current `resolveRuntimeColor` (returns `resolveColor(value, "rgb565") &
0xffff`) and all hardcoded 565 literals + the `0x7bef` dimming idiom are left
untouched. The `& 0xffff` mask is harmless on 565 values stored in a
`Uint32Array`.

**Verification:** `tests/packages/cuttlefish/host-rich-text.test.ts`,
`preview-cross-screen.test.ts`, `preview-scroll.test.ts`,
`host-render-clipping.test.ts` (20 tests) all pass with no change, confirming
the 565 values store correctly in the widened buffer.

- [ ] **Step 1: Update the import and resolveRuntimeColor**

In `packages/cuttlefish/src/preview/host-ui-runtime.ts`:

1a. Change line 1:
```ts
import { resolveColor } from "../ui/color.js";
```
to:
```ts
import { resolveColor888 } from "../ui/color.js";
```

1b. Replace `resolveRuntimeColor` (lines 99-103):
```ts
private resolveRuntimeColor(value: number | string): number {
  if (typeof value === "number") return value & 0xffff;
  if (typeof value === "string") return resolveColor(value, "rgb565") & 0xffff;
  return 0xffff;
}
```
with:
```ts
/**
 * Resolve a color to packed RGB888 for the framebuffer. The host buffer stores
 * 888 regardless of target format; quantization happens in toRgbaBytes(format)
 * at the canvas-push boundary, matching the device's boundary-quantize model.
 */
private resolveRuntimeColor(value: number | string): number {
  if (typeof value === "number") return value & 0xffffff;
  if (typeof value === "string") return resolveColor888(value) & 0xffffff;
  return 0xffffff;
}
```

- [ ] **Step 2: Convert hardcoded 565 color literals to 888**

Compute the 888 equivalents once. Add a small const block near the existing defaults (after line 39), importing `rgb565To888` from `host-gfx.ts`:

```ts
import { blendRgb565, rgb565To888 } from "./host-gfx.js"; // add rgb565To888 to existing import
// Phase 1: 888 equivalents of the prior 565 defaults (computed via rgb565To888).
const DEFAULT_KEY_BG_888 = rgb565To888(0x4208);   // dark key background
const KEY_FG_888 = rgb565To888(0xffff);           // white
const KEY_BG_888 = rgb565To888(0x0000);           // black
const KEY_SHIFT_888 = rgb565To888(0xbdf7);        // shift highlight
```

Then replace each literal occurrence:
- Line 36 `DEFAULT_KEY_BG = 0x4208` → use `DEFAULT_KEY_BG_888`
- Lines 37-39 `0xffff`/`0x0000` (keyboard fg/bg/border) → `KEY_FG_888`/`KEY_BG_888`
- Lines 268, 461 `0xffff`/`0x0000` (standalone literals used as colors) → `0xffffff`/`0x000000`
- Line 2791 `0xbdf7` (shift highlight) → `KEY_SHIFT_888`

Run `grep -n "0x4208\|0xbdf7" packages/cuttlefish/src/preview/host-ui-runtime.ts` to confirm zero remaining occurrences.

- [ ] **Step 3: Convert the 565 dimming idiom to its 888 equivalent**

The idiom `(x >> 1) & 0x7bef` halves each 565 channel. The 888 equivalent (halve each 8-bit channel) is `(x >> 1) & 0x7f7f7f`. Replace each occurrence (lines ~1300, 2033, 2192, 2239):

```ts
// before: (fgCol >> 1) & 0x7bef
// after:  (fgCol >> 1) & 0x7f7f7f
```

Run `grep -n "0x7bef" packages/cuttlefish/src/preview/host-ui-runtime.ts` to confirm zero remaining occurrences.

- [ ] **Step 4: Update the line-2063 color-literal resolver**

Change line 2063:
```ts
try { return resolveColor(c.replace(/^['"]|['"]$/g, ""), "rgb565"); } catch { return 0xffff; }
```
to:
```ts
try { return resolveColor888(c.replace(/^['"]|['"]$/g, "")) & 0xffffff; } catch { return 0xffffff; }
```

- [ ] **Step 5: Do NOT switch blendRgb565 call sites**

Verify: `grep -n "blendRgb565" packages/cuttlefish/src/preview/host-ui-runtime.ts` — these calls **stay**. The operands are now 888 values; the 565 blend math runs on them. This is byte-identical to the runtime's 565 blend on 565-stored values *only if* the runtime also stores 888 and blends in 565 — which it does (Task 3 kept `ui_blend565`). Preview/runtime parity is preserved.

- [ ] **Step 6: Run the preview runtime tests**

Run:
```sh
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish/host-rich-text.test.ts tests/packages/cuttlefish/preview-cross-screen.test.ts tests/packages/cuttlefish/preview-scroll.test.ts tests/packages/cuttlefish/host-render-clipping.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/preview/host-ui-runtime.ts
git commit -m "feat(preview): resolve runtime colors as RGB888; convert 565 literals + dimming idiom to 888; keep 565 blend math"
```

---

## Task 6: Widen `colorFormat()` return type for Phase 2 readiness

**Files:**
- Modify: `packages/cuttlefish/src/api/shared/graphics-strategy.ts:33`
- Modify: `packages/cuttlefish/src/platform/generic-strategy.ts:330`

- [ ] **Step 1: Widen the type (no value change)**

In `packages/cuttlefish/src/api/shared/graphics-strategy.ts`, change:
```ts
  /** Target color format — drives transpile-time color resolution. */
  colorFormat(): "rgb565" | "mono";
```
to:
```ts
  /** Target color format. Phase 1: 565/mono active. Phase 2+: rgb666/rgb888/palette. */
  colorFormat(): "rgb888" | "rgb666" | "rgb565" | "mono";
```

In `packages/cuttlefish/src/platform/generic-strategy.ts`, the `colorFormat()` body (line 330) returns `"rgb565"` — leave the value unchanged. The type widening is forward-compatible; existing callers pass `"rgb565"` or `"mono"` and continue to type-check.

- [ ] **Step 2: Build and run the full suite**

Run:
```sh
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/cuttlefish/src/api/shared/graphics-strategy.ts packages/cuttlefish/src/platform/generic-strategy.ts
git commit -m "feat(api): widen colorFormat() return type to include rgb888/rgb666 (Phase 2 ready, no value change)"
```

---

## Task 7: Byte-identity regression guard

**Files:**
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`

- [ ] **Step 1: Write the regression test**

Add to `tests/packages/cuttlefish/runtime-header.test.ts` (inside an existing `describe` or a new one):

```ts
describe("Phase 1 color storage widen (byte-identity)", () => {
  const header = emitRuntimeHeader();

  it("UINode color fields are uint32_t (888-ready)", () => {
    expect(header).toMatch(/uint32_t bg;/);
    expect(header).toMatch(/uint32_t fg;/);
    expect(header).toMatch(/uint32_t borderColor;/);
    expect(header).toMatch(/uint32_t clearColor;/);
    expect(header).toMatch(/uint32_t gradientColor1;/);
    expect(header).toMatch(/uint32_t gradientColor2;/);
  });

  it("keeps ui_blend565 active for the TFT path (565 math in wider field)", () => {
    expect(header).toMatch(/uint16_t ui_blend565/);
    // 565 blend call sites still present (not switched to 888)
    expect(header).toMatch(/ui_blend565\(/);
  });

  it("adds ui_blend888 + lerp_color_888 alongside (unused in Phase 1)", () => {
    expect(header).toMatch(/uint32_t ui_blend888/);
    expect(header).toMatch(/lerp_color_888/);
  });

  it("565 literals and sentinels unchanged", () => {
    expect(header).toMatch(/UI_NO_PARENT\s+0xFFFF/);
    expect(header).toMatch(/display_fillScreen\(0x0000\)/);
  });
});
```

If `emitRuntimeHeader` is not the exported name, adjust to match the actual export (check the top of the test file or `grep -n "export" packages/cuttlefish/src/ui/runtime-header.ts | head`).

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "test(runtime): Phase 1 color storage widen byte-identity guard"
```

---

## Task 8: Phase 1 verification & sign-off

- [ ] **Step 1: Clean build**

Run:
```sh
npm run build --workspace @typecad/cuttlefish
```
Expected: builds clean, no type errors.

- [ ] **Step 2: Full cuttlefish test suite**

Run:
```sh
npx vitest run tests/packages/cuttlefish
```
Expected: all PASS.

- [ ] **Step 3: demo-ui compiles and color literals are unchanged**

Run:
```sh
npm run compile --workspace demo-ui
git diff demo-ui/src/out/main/main.ino | grep "^[+-]" | grep -vE "uint16_t|uint32_t" | head -20
```
Expected: **no output** (or only `uint16_t`→`uint32_t` field declarations differ). No `0x....` color literal should change value. If any literal value changed, Phase 1 has a regression — investigate before sign-off. (Note: the generated `main.ino` is on the `feat/inline-text-flow` branch's working tree; `git diff` compares against the last commit. If the diff is noisy from prior unmerged work, compare against the `git stash`'d pre-Phase-1 version instead.)

- [ ] **Step 4: Run the AGENTS.md verification suite**

Run:
```sh
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish/runtime-header.test.ts
npm run compile --workspace demo-ui
```
Expected: all PASS (AGENTS.md mandates this exact suite for rendering changes).

- [ ] **Step 5: Mark Phase 1 complete in the spec**

In `docs/superpowers/specs/2026-07-02-display-agnostic-core-design.md`, §6, update Phase 1's line to note completion with the commit SHA range. Commit:

```bash
git add docs/superpowers/specs/2026-07-02-display-agnostic-core-design.md
git commit -m "docs(spec): mark Phase 1 (RGB888 storage widen, byte-identical) complete"
```

---

## Self-Review

**1. Spec coverage (Phase 1 of spec §6):**
- §3.1 color quantizers + `resolveColor888` → Tasks 1, 2. ✓
- §3.1 runtime-header field widen → Task 3. ✓ (storage-only, per the counterexample finding)
- §3.5 preview framebuffer widen → Tasks 4, 5. ✓
- §3.1/§3.3 `colorFormat()` type widen → Task 6. ✓
- Byte-identity guarantee (spec §6 "no behavior change") → guarded by Tasks 2, 7, 8. ✓
- Phases 2-4 explicitly out of scope for this plan. ✓

**2. Placeholder scan:** Every code step has complete code; every command has expected output. No TBD/TODO. ✓

**3. Type/name consistency:** `resolveColor888`, `rgb888To565/666/mono/nearest`, `pack888`, `unpack888`, `blendRgb888`, `rgb565To888`, `ui_blend888`, `lerp_color_888` — names match across all tasks. ✓

**4. Key design correction applied:** The initial draft proposed switching blend math to 888 in Phase 1. Verified by counterexample (`node -e` showed 888-blend→quantize gives 565-R=16 while quantize→565-blend gives 565-R=2 for the same inputs) that this would break byte-identity. **Phase 1 is now storage-only widening**; 888 blend math is added but unused, deferred to Phase 2 where the descriptor routes per-shim and test expectations update. This preserves the spec's "Phase 1 = no behavior change" guarantee and is a smaller, safer change.

**5. Parity (AGENTS.md):** Preview and runtime both widen storage to 888 and both keep 565 blend math in Phase 1, so they remain byte-identical to each other and to today's output.
