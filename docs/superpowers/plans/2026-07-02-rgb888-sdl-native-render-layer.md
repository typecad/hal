# RGB888 Color Widening + SDL Native-Exe Render Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the Cuttlefish color pipeline so true RGB888 reaches the display HAL, and deliver a new SDL display adapter that renders that 888 to a native window — a fourth build-time target alongside ILI9341 / ST7796 / e-ink.

**Architecture:** All color widening is macro-guarded under `#if UI_COLOR_DEPTH == 888` (565/mono paths byte-identical), mirroring the existing `ui_blend` / `UI_LERP_COLOR` guard at `runtime-header.ts:295-301`. A new `"rgb888"` colorFormat drives it. The SDL adapter (`display-adapters/sdl.ts`) emits C++ implementing the HAL contract against SDL2, compiled by the existing `NativeToolchain`. Mouse events feed the existing `touch_*` contract via a new built-in touch library entry.

**Tech Stack:** TypeScript (cuttlefish transpiler), C++17 (generated device/native code), SDL2 (window/render), Vitest (tests), g++/clang++ (native compile via `NativeToolchain`).

**Spec:** `docs/superpowers/specs/2026-07-02-rgb888-sdl-native-render-layer-design.md`

**Critical context for the implementer:**
- Node color fields are already `uint32_t` (`runtime-header.ts:102-105`). The narrowing happens in `uint16_t` locals (e.g. line 3970 `uint16_t fillBg = __ui_nodes[i].bg;`) and in the `ui_display_*` wrapper signatures (lines 765-797).
- `UI_COLOR_DEPTH` is set to `888` only when `profile.colorFormat === "rgb666"` today (`ui-emitter.ts:92`). The widening adds `"rgb888"` as a parallel trigger.
- The native `main()` is **currently single-shot** — `ui_tick` is called once (`function-emitter-impl.ts:296-302`), no loop. SDL needs an event loop; this plan adds it via a strategy hook.
- Every existing target (ILI9341, eink) compiles at `UI_COLOR_DEPTH 565`, so widening under the `888` guard cannot regress them.
- AGENTS.md verification gates for any rendering change: `npm run build --workspace @typecad/cuttlefish`; `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`; `npm run compile --workspace demo-ui`.

---

## File Structure

**Modified — `@typecad/cuttlefish` (color widening + format plumbing):**
- `packages/cuttlefish/src/api/shared/display-profile.ts` — add `"rgb888"` to `colorFormat` unions (lines 51, 77); add `"sdl"` to `TouchLibrary` union (line 17).
- `packages/cuttlefish/src/api/shared/display-capabilities.ts` — add `"rgb888"` to `ProfileLike.colorFormat` (line 66); map it in `deriveCapabilities` TFT branch.
- `packages/cuttlefish/src/api/shared/graphics-strategy.ts` — widen `colorFormat()` return type to include `"rgb888"`.
- `packages/cuttlefish/src/ir/transformers/ui-lowering.ts` — extend `ColorFormat` (line 230) to include `"rgb888"`.
- `packages/cuttlefish/src/ui/color.ts` — `resolveColorInternal` (line 259) handles `"rgb888"`.
- `packages/cuttlefish/src/emit/emitters/ui-emitter.ts` — `UI_COLOR_DEPTH 888` for rgb888 (line 92).
- `packages/cuttlefish/src/ui/runtime-header.ts` — introduce `UI_COLOR_T`; widen `ui_display_*` (765-797) + truncation locals + 565-specific math.

**Modified — `@typecad/cuttlefish` (SDL adapter + touch):**
- `packages/cuttlefish/src/api/shared/display-adapter.ts` — import + register the sdl adapter.
- `packages/cuttlefish/src/api/shared/display-adapters/sdl.ts` — **NEW.** Emits SDL HAL C++.
- `packages/cuttlefish/src/api/shared/display-profile.ts` — `"sdl"` touch branch in `generateTouchAdapter` (line 258).

**Modified — `@typecad/cuttlefish` (native event loop):**
- `packages/cuttlefish/src/api/shared/platform-strategy.ts` — add `hostEventLoop()` strategy hook (optional).
- `packages/cuttlefish/src/emit/emitters/function-emitter-impl.ts` — emit event loop around `ui_tick` when the strategy provides one.

**Modified — `@typecad/framework-native`:**
- `packages/framework-native/src/strategy.ts` — `supportedDisplayDrivers()` adds `"sdl"` (549); `colorFormat()` widened (553); implement `hostEventLoop()`.

**New workspace — `native_demo`:**
- `native_demo/cuttlefish.config.ts`, `native_demo/src/*.ui.html`, `native_demo/src/main.ts`, `native_demo/package.json`.

**Tests:**
- `tests/packages/cuttlefish/color-888.test.ts` — **NEW.**
- `tests/packages/cuttlefish/runtime-header.test.ts` — add widening assertions.
- `tests/packages/cuttlefish/display-adapter-sdl.test.ts` — **NEW.**
- `packages/framework-native/tests/sdl-availability.test.ts` — **NEW**, guarded e2e.

---

## Phase 1: Color Widening (independently shippable; fixes ST7796 rgb666)

### Task 1: Add `"rgb888"` to the colorFormat unions and resolution

**Files:**
- Modify: `packages/cuttefish/src/api/shared/display-profile.ts:51`
- Modify: `packages/cuttlefish/src/api/shared/display-profile.ts:77`
- Modify: `packages/cuttlefish/src/api/shared/display-capabilities.ts:66`
- Modify: `packages/cuttlefish/src/ir/transformers/ui-lowering.ts:230`
- Modify: `packages/cuttlefish/src/ui/color.ts:259`
- Test: `tests/packages/cuttlefish/color-888.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/color-888.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveColorInternal, resolveColor888, rgb888To666, rgb888To565 } from "../../../packages/cuttlefish/src/ui/color";

describe("rgb888 color format", () => {
  it("resolveColorInternal returns true 888 for rgb888 (red)", () => {
    expect(resolveColorInternal("red", "rgb888")).toBe(0xff0000);
  });
  it("resolveColorInternal returns true 888 for rgb888 (named blue)", () => {
    expect(resolveColorInternal("blue", "rgb888")).toBe(0x0000ff);
  });
  it("rgb888 and rgb666 resolve to the same internal 888 value", () => {
    // rgb666 stores full 888 internally (quantization happens at push boundary)
    expect(resolveColorInternal("#3a8ee0", "rgb888")).toBe(resolveColorInternal("#3a8ee0", "rgb666"));
  });
  it("quantizers are unchanged by rgb888 addition", () => {
    const c = resolveColor888("#3a8ee0");
    expect(rgb888To565(c)).toBe(0x751c);   // (0x3a&0xf8)<<8 | (0x8e&0xfc)<<3 | (0xe0>>3)
    expect(rgb888To666(c)).toBe(((0x38) << 10) | ((0x8c) << 4) | (0xe0 >> 2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/color-888.test.ts`
Expected: FAIL — `resolveColorInternal("red","rgb888")` does not match `"rgb666" | "rgb565" | "mono"`; TS compile error on the `"rgb888"` argument.

- [ ] **Step 3: Add `"rgb888"` to the type unions**

In `packages/cuttlefish/src/api/shared/display-profile.ts` line 51, change:
```ts
  colorFormat: "rgb565" | "rgb666" | "mono";
```
to:
```ts
  colorFormat: "rgb565" | "rgb666" | "rgb888" | "mono";
```

Line 77 (`DisplayConfig.colorFormat`, author-facing), change:
```ts
  colorFormat?: "rgb565" | "mono";
```
to:
```ts
  colorFormat?: "rgb565" | "rgb888" | "mono";
```

In `packages/cuttlefish/src/api/shared/display-capabilities.ts` line ~66, the `ProfileLike.colorFormat`:
```ts
  colorFormat: "rgb565" | "rgb666" | "mono";
```
to:
```ts
  colorFormat: "rgb565" | "rgb666" | "rgb888" | "mono";
```

In `packages/cuttlefish/src/ir/transformers/ui-lowering.ts` line 230:
```ts
type ColorFormat = "rgb565" | "rgb666" | "mono";
```
to:
```ts
type ColorFormat = "rgb565" | "rgb666" | "rgb888" | "mono";
```

- [ ] **Step 4: Handle rgb888 in resolveColorInternal**

In `packages/cuttlefish/src/ui/color.ts:259`, change:
```ts
export function resolveColorInternal(input: string, format: "rgb565" | "rgb666" | "mono"): number {
  if (format === "rgb666") return resolveColor888(input);
  return resolveColor(input, format);
}
```
to:
```ts
export function resolveColorInternal(input: string, format: "rgb565" | "rgb666" | "rgb888" | "mono"): number {
  if (format === "rgb666" || format === "rgb888") return resolveColor888(input);
  return resolveColor(input, format);
}
```
Also widen `resolveColor` (line 246) and `rgb888To666` callers' type params if the compiler flags them — add `"rgb888"` to the `resolveColor` `format` union (line 246) so the signature reads `"rgb565" | "rgb666" | "rgb888" | "mono"`. (Its body's `if (format === "rgb666")` branch stays; rgb888 is never passed to `resolveColor` because `resolveColorInternal` intercepts it first — but widening keeps callers type-safe.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/color-888.test.ts`
Expected: PASS (all 4).

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/api/shared/display-profile.ts packages/cuttlefish/src/api/shared/display-capabilities.ts packages/cuttlefish/src/ir/transformers/ui-lowering.ts packages/cuttlefish/src/ui/color.ts tests/packages/cuttlefish/color-888.test.ts
git commit -m "feat(color): add rgb888 as first-class colorFormat; resolveColorInternal returns true 888"
```

---

### Task 2: Map rgb888 → UI_COLOR_DEPTH 888 + capabilities

**Files:**
- Modify: `packages/cuttlefish/src/emit/emitters/ui-emitter.ts:92`
- Modify: `packages/cuttlefish/src/api/shared/display-capabilities.ts` (`deriveCapabilities` TFT branch ~line 91)
- Modify: `packages/cuttlefish/src/api/shared/graphics-strategy.ts` (`colorFormat()` return type)
- Modify: `packages/cuttlefish/src/platform/generic-strategy.ts:330`
- Test: `tests/packages/cuttlefish/color-888.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to color-888.test.ts)**

Append inside the `describe`:
```ts
import { deriveCapabilities } from "../../../packages/cuttlefish/src/api/shared/display-capabilities";

it("deriveCapabilities maps rgb888 TFT to nativeFormat rgb888, immediate refresh", () => {
  const caps = deriveCapabilities({ width: 320, height: 240, colorFormat: "rgb888" });
  expect(caps.nativeFormat).toBe("rgb888");
  expect(caps.refreshModel).toBe("immediate");
  expect(caps.requiresBackingStore).toBe(false);
});

it("deriveCapabilities still defaults rgb565 TFT to rgb565 (byte-identical)", () => {
  const caps = deriveCapabilities({ width: 320, height: 240, colorFormat: "rgb565" });
  expect(caps.nativeFormat).toBe("rgb565");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/color-888.test.ts`
Expected: FAIL — rgb888 case returns `"rgb565"` (the TFT branch ignores colorFormat).

- [ ] **Step 3: Map rgb888 in deriveCapabilities**

In `packages/cuttlefish/src/api/shared/display-capabilities.ts`, the TFT branch returns `defaultTftCapabilities()` unconditionally (line ~91). Change it to honor an rgb888 colorFormat:
```ts
  return defaultTftCapabilities();
```
becomes:
```ts
  const base = defaultTftCapabilities();
  if (profile.colorFormat === "rgb888") {
    base.nativeFormat = "rgb888";
  }
  return base;
```
(`DisplayCapabilities.nativeFormat` is a writable field per the `NativeFormat` type at line 11, which already includes `"rgb888"`.)

- [ ] **Step 4: Emit UI_COLOR_DEPTH 888 for rgb888**

In `packages/cuttlefish/src/emit/emitters/ui-emitter.ts:92`, change:
```ts
  ctx.sourceLines.push(
    profile.colorFormat === "rgb666"
      ? "#define UI_COLOR_DEPTH 888"
      : "#define UI_COLOR_DEPTH 565",
  );
```
to:
```ts
  ctx.sourceLines.push(
    profile.colorFormat === "rgb666" || profile.colorFormat === "rgb888"
      ? "#define UI_COLOR_DEPTH 888"
      : "#define UI_COLOR_DEPTH 565",
  );
```

- [ ] **Step 5: Widen the strategy colorFormat() types**

In `packages/cuttlefish/src/api/shared/graphics-strategy.ts`, find the `colorFormat()` method declaration on `PlatformGraphicsStrategy` and change its return type from `"rgb565" | "mono"` to `"rgb565" | "rgb666" | "rgb888" | "mono"`.

In `packages/cuttlefish/src/platform/generic-strategy.ts:330`, change:
```ts
  colorFormat(): "rgb565" | "mono" {
```
to:
```ts
  colorFormat(): "rgb565" | "rgb666" | "rgb888" | "mono" {
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/color-888.test.ts`
Expected: PASS (all 6).

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/api/shared/display-capabilities.ts packages/cuttlefish/src/emit/emitters/ui-emitter.ts packages/cuttlefish/src/api/shared/graphics-strategy.ts packages/cuttlefish/src/platform/generic-strategy.ts tests/packages/cuttlefish/color-888.test.ts
git commit -m "feat(color): emit UI_COLOR_DEPTH 888 + derive rgb888 nativeFormat for rgb888 profiles"
```

---

### Task 3: Introduce UI_COLOR_T and widen the ui_display_* wrappers

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts:288-301` (add `UI_COLOR_T`)
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts:765-797` (widen wrappers)
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`

- [ ] **Step 1: Write the failing test (append to runtime-header.test.ts)**

Append:
```ts
describe("RGB888 color widening in the runtime header", () => {
  const header = emitRuntimeHeader();
  it("defines UI_COLOR_T as uint32_t under 888 and uint16_t otherwise", () => {
    expect(header).toMatch(/#define UI_COLOR_T uint32_t\b[\s\S]*?#else[\s\S]*?#define UI_COLOR_T uint16_t/);
  });
  it("widens ui_display_fill_rect color param to UI_COLOR_T", () => {
    expect(header).toMatch(/ui_display_fill_rect\([^)]*UI_COLOR_T color\)/);
  });
  it("widens ui_display_draw_pixel color param to UI_COLOR_T", () => {
    expect(header).toMatch(/ui_display_draw_pixel\([^)]*UI_COLOR_T color\)/);
  });
  it("keeps the existing 565/888 ui_blend guard", () => {
    expect(header).toMatch(/#if UI_COLOR_DEPTH == 888[\s\S]*?#define ui_blend\(fg, bg, op\)\s+ui_blend888/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: FAIL — `UI_COLOR_T` not defined; wrappers still have `uint16_t color`.

- [ ] **Step 3: Add the UI_COLOR_T define**

In `packages/cuttlefish/src/ui/runtime-header.ts`, immediately after the `UI_COLOR_DEPTH` default + before the `ui_blend` block (between current lines 290 and 291), insert:
```c
// Color value type tracks the depth: 888 holds 24-bit RGB (R<<16|G<<8|B),
// 565 holds 16-bit. Draw wrappers and locals use UI_COLOR_T so 888 is not
// narrowed before reaching the HAL. Under 565/mono this is uint16_t and the
// emitted code is byte-identical with the pre-widening runtime.
#if UI_COLOR_DEPTH == 888
  #define UI_COLOR_T uint32_t
#else
  #define UI_COLOR_T uint16_t
#endif
```

- [ ] **Step 4: Widen the ui_display_* wrapper color params**

In `packages/cuttlefish/src/ui/runtime-header.ts`, change every `uint16_t color` to `UI_COLOR_T color` in the wrapper block lines 765-797. Affected lines (each is the parameter list of a `static inline void ui_display_*`):
- 765 `ui_display_draw_pixel(... uint16_t color)`
- 771 `ui_display_fill_rect(... uint16_t color)`
- 774 `ui_display_draw_fast_hline(... uint16_t color)`
- 777 `ui_display_draw_fast_vline(... uint16_t color)`
- 780 `ui_display_fill_round_rect(... int16_t r, uint16_t color)`
- 783 `ui_display_draw_rect(... uint16_t color)`
- 786 `ui_display_draw_round_rect(... int16_t r, uint16_t color)`
- 789 `ui_display_draw_line(... uint16_t color)` (note: this one's color is at end of a 2-line param list)
- 793 `ui_display_fill_circle(... int16_t r, uint16_t color)`
- 796 `ui_display_draw_circle(... int16_t r, uint16_t color)`

Do **not** change `ui_display_set_text_color(uint16_t fg, uint16_t bg)` (802) or `ui_display_set_text_color_solid(uint16_t fg)` (805) yet — those flow to `display_targetSetTextColor*` which the existing Adafruit target types as uint16_t; they are widened in Task 5 alongside the HAL text-color signatures.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: PASS (existing assertions + the 4 new ones).

- [ ] **Step 6: Verify demo-ui (565 path) still compiles byte-identical**

Run:
```bash
npm run build --workspace @typecad/cuttlefish
npm run compile --workspace demo-ui
```
Expected: build succeeds; demo-ui compiles (ESP32/ILI9341, `UI_COLOR_DEPTH 565`).

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(runtime): introduce UI_COLOR_T; widen ui_display draw wrappers to pass 888 through"
```

---

### Task 4: Widen the truncation locals so 888 is not dropped

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts` — sites at 1330, 1735, 1864, 1923, 1995, 2041, 3221, 3222, 3256, 3966, 3970, 3996, 4259, 4531
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`

- [ ] **Step 1: Write the failing test (append)**

Append to the RGB888 describe block:
```ts
  it("does not narrow node bg/fillBg into a uint16_t local", () => {
    // locals must be UI_COLOR_T so the upper 16 bits of an 888 value survive
    expect(header).not.toMatch(/uint16_t fillBg = __ui_nodes/);
    expect(header).not.toMatch(/uint16_t bColor = __ui_nodes/);
    expect(header).not.toMatch(/uint16_t shadowCol = __ui_nodes/);
    expect(header).not.toMatch(/uint16_t c1 = __ui_nodes/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: FAIL — the locals are still `uint16_t`.

- [ ] **Step 3: Widen each truncation local to UI_COLOR_T**

In `packages/cuttlefish/src/ui/runtime-header.ts`, change `uint16_t` → `UI_COLOR_T` at exactly these sites (the variable being declared reads from a `uint32_t` node field):
- Line 1330: `uint16_t dimFg = ((__ui_nodes[si].fg >> 1) & 0x7BEF);` — this is a 565-specific dim expression; it is handled fully in Task 5 (math change). For now change only the type if the line still reads `__ui_nodes[si].fg`; **but** since the `& 0x7BEF` is 565 math, leave this line to Task 5 and skip it here. **Do not touch line 1330 in this task.**
- Line 1735: `uint16_t bColor = __ui_nodes[p].borderColor ? ... : __ui_nodes[p].fg;` → `UI_COLOR_T bColor = ...`
- Line 1864: `uint16_t bColor = __ui_nodes[nodeIdx].borderColor ? ...` → `UI_COLOR_T bColor`
- Line 1923: `uint16_t bColor = __ui_nodes[p].borderColor ? ...` → `UI_COLOR_T bColor`
- Line 1995: `uint16_t fillBg = __ui_nodes[nodeIdx].bg;` → `UI_COLOR_T fillBg = __ui_nodes[nodeIdx].bg;`
- Line 2041: `uint16_t bColor = __ui_nodes[p].borderColor ? ...` → `UI_COLOR_T bColor`
- Line 3221: `uint16_t c1 = __ui_nodes[i].gradientColor1;` → `UI_COLOR_T c1`
- Line 3222: `uint16_t c2 = __ui_nodes[i].gradientColor2;` → `UI_COLOR_T c2`
- Line 3256: `uint16_t shadowCol = __ui_nodes[i].shadowColor[s];` → `UI_COLOR_T shadowCol`
- Line 3966: `uint16_t bColor = __ui_nodes[i].borderColor ? ...` → `UI_COLOR_T bColor`
- Line 3970: `uint16_t fillBg = __ui_nodes[i].bg;` → `UI_COLOR_T fillBg`
- Line 3996: `uint16_t bColor = __ui_nodes[i].borderColor ? ...` → `UI_COLOR_T bColor`
- Line 4259: `uint16_t dimFg = ((fgCol >> 1) & 0x7BEF);` → leave to Task 5 (565 math).
- Line 4531: `uint16_t dimFg = ((__ui_nodes[i].fg >> 1) & 0x7BEF);` → leave to Task 5.

After these edits the `not.toMatch(/uint16_t bColor = __ui_nodes/)` etc. assertions pass (the remaining `uint16_t` dimFg lines are covered by Task 5).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify demo-ui still compiles**

Run:
```bash
npm run build --workspace @typecad/cuttlefish
npm run compile --workspace demo-ui
```
Expected: success (565 path; `UI_COLOR_T` is `uint16_t` there, so locals are byte-identical).

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(runtime): widen color locals (fillBg/bColor/c1/c2/shadowCol) to UI_COLOR_T"
```

---

### Task 5: Make the 565-specific color math depth-aware (dim mask, 0xffff guards)

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts` — dim sites 1330, 4259, 4531; any `(fg & 0xffff)`/`0xffff` equality guards
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`

- [ ] **Step 1: Write the failing test (append)**

Append:
```ts
  it("uses an 888-aware dim path under UI_COLOR_DEPTH 888", () => {
    // Under 888, dimming halves each 8-bit channel: (c >> 1) & 0x7F7F7F.
    // The literal 0x7BEF (565 green/blue dim mask) must not appear in the 888 branch.
    expect(header).toMatch(/UI_COLOR_DEPTH == 888[\s\S]*?0x7F7F7F/);
  });
  it("the 0x7BEF dim mask still exists for the 565 path", () => {
    expect(header).toContain("0x7BEF");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: FAIL — no `0x7F7F7F` present yet.

- [ ] **Step 3: Make the dim math depth-aware**

There are three dim sites: lines 1330, 4259, 4531. Each currently reads e.g.
```c
uint16_t dimFg = ((__ui_nodes[si].fg >> 1) & 0x7BEF);
```
Replace each with a depth-aware version (and widen the type to `UI_COLOR_T`):
```c
UI_COLOR_T dimFg = (UI_COLOR_T)(__ui_nodes[si].fg >> 1) & UI_DIM_MASK;
```
Do the same for line 4259 (`((fgCol >> 1) & 0x7BEF)`) and line 4531 (`((__ui_nodes[i].fg >> 1) & 0x7BEF)`), preserving each expression's source value (`fgCol` / `__ui_nodes[i].fg`).

Then add the `UI_DIM_MASK` define near the `UI_COLOR_T` define (from Task 3):
```c
#if UI_COLOR_DEPTH == 888
  #define UI_COLOR_T uint32_t
  #define UI_DIM_MASK 0x7F7F7Fu   // halve each 8-bit channel independently
#else
  #define UI_COLOR_T uint16_t
  #define UI_DIM_MASK 0x7BEFu     // 565 green/blue dim mask (top bit clear per channel)
#endif
```
(Verify `0x7BEF` is indeed the 565 one-bit-dim mask: it clears the top bit of each channel so `>>1` halves without bleed. `0x7F7F7F` is the 888 equivalent.)

- [ ] **Step 4: Audit and fix any remaining 0xffff equality guards that assume 16-bit color**

Search for `0xffff` used as a color-equality sentinel (not as a bitmask in 565 mono math):
```bash
grep -n "0xffff\|& 0xffff" packages/cuttlefish/src/ui/runtime-header.ts
```
For each occurrence that compares a color value for equality (e.g. an antialias guard like `(fg & 0xffff) !== (bg & 0xffff)` around line 1469), make it depth-aware:
```c
#if UI_COLOR_DEPTH == 888
  ... (fg & 0xffffff) != (bg & 0xffffff) ...
#else
  ... (fg & 0xffff) != (bg & 0xffff) ...
#endif
```
Only change lines where the masked value is a *color* being compared. Leave `0xffff`/`0xffffu` used in mono-snap 565 math (lines 314, 321, 324) untouched — that math only runs under `UI_NATIVE_MONO` + `UI_COLOR_DEPTH 565`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify demo-ui still compiles (565 byte-identity)**

Run:
```bash
npm run build --workspace @typecad/cuttlefish
npm run compile --workspace demo-ui
```
Expected: success. (Under 565, `UI_DIM_MASK` is `0x7BEF` and `UI_COLOR_T` is `uint16_t`, so the emitted code matches the pre-change runtime.)

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(runtime): depth-aware dim mask (0x7F7F7F @888) and 888 color-equality guards"
```

---

### Task 6: Widen the existing ST7796 adapter to the 888 HAL contract

**Files:**
- Modify: `packages/cuttlefish/src/api/shared/display-adapters/st7796.ts`
- Test: (covered by compile of any rgb666 target; add an adapter-smoke assertion)

**Context:** The ILI9341 adapter (`display-adapter.ts:119-157`) declares the `display_target*` functions with `uint16_t color`. Under `UI_COLOR_DEPTH 888` these must accept `uint32_t`. The cleanest approach: have each adapter's draw functions take the HAL color type matching the profile, selected by the adapter generator. For ILI9341 (always 565) and eink (always mono→565) the signatures stay `uint16_t`. For ST7796 in rgb666 mode and SDL in rgb888 mode they become `uint32_t`.

Because the runtime calls these through `display_targetDrawPixel(__ui_gfx, …, color)` where `color` is now `UI_COLOR_T`, the adapter function signatures must accept whatever `UI_COLOR_T` resolves to in that build. Since exactly one adapter is compiled per build (selected by driver), use a macro alias for the color param type in the adapter signatures too.

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/display-adapter-color-types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { generateDisplayAdapter } from "../../../packages/cuttlefish/src/api/shared/display-adapter";

describe("adapter color param types track UI_COLOR_T", () => {
  it("ILI9341 draw functions accept the HAL color type", () => {
    const a = generateDisplayAdapter({ driver: "ili9341", colorFormat: "rgb565" } as any);
    expect(a.functions).toMatch(/display_targetDrawPixel\([^)]*UI_COLOR_T color\)/);
  });
  it("ST7796 rgb666 draw functions accept UI_COLOR_T", () => {
    const a = generateDisplayAdapter({ driver: "st7796", colorFormat: "rgb666" } as any);
    expect(a.functions).toMatch(/display_targetDrawPixel\([^)]*UI_COLOR_T color\)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/display-adapter-color-types.test.ts`
Expected: FAIL — adapters still emit `uint16_t color`.

- [ ] **Step 3: Use UI_COLOR_T in ILI9341 adapter draw signatures**

In `packages/cuttlefish/src/api/shared/display-adapter.ts`, change the color param type from `uint16_t` to `UI_COLOR_T` in the ILI9341 `display_target*` draw functions (lines 119, 122-bitmap-stays-uint16*, 125, 128, 131, 134, 137, 140, 143, 146, 149) and `display_canvasFillRect` (115). Also `display_canvasGetPixel` return type stays `uint16_t` only if 565 — but to be safe and uniform, leave buffer/getPixel as `uint16_t`/`uint16_t*` for ILI9341 (it is a genuine 565 buffer) and only widen the *draw input* params to `UI_COLOR_T`.

Specifically change `uint16_t color` → `UI_COLOR_T color` on these lines:
- 113 `display_canvasGetPixel` → leave return `uint16_t` (it reads a 565 buffer)
- 114 `display_canvasFillScreen(canvas, uint16_t color)` → `UI_COLOR_T color` then cast `(uint16_t)color` inside (565 canvas)
- 115 `display_canvasFillRect(... uint16_t color)` → `UI_COLOR_T color`, body casts to `(uint16_t)`
- 119 `display_targetDrawPixel(... uint16_t color)` → `UI_COLOR_T color`
- 125 `display_targetFillRect(... uint16_t color)` → `UI_COLOR_T color`
- 128, 131 (hline/vline), 134, 137, 140 (round-rect family), 143 (line), 146, 149 (circle) → `UI_COLOR_T color`

For each, the body call into Adafruit (`target->fillRect(x,y,w,h,color)`) needs a cast because Adafruit's methods take `uint16_t`: wrap as `(uint16_t)(color)`. Add the cast to every body call.

Leave `display_targetSetTextColor(target, uint16_t fg)` (153) and `display_targetSetTextColorBg(target, uint16_t fg, uint16_t bg)` (154) as-is for ILI9341 in this task; Task 5b/7 reconciles text-color across adapters. (Under 565, `UI_COLOR_T` is `uint16_t`, so these casts are no-ops and output is byte-identical.)

- [ ] **Step 4: Apply the same UI_COLOR_T widening to the ST7796 adapter**

Open `packages/cuttlefish/src/api/shared/display-adapters/st7796.ts`. It currently delegates `display_target*` draw functions to the same Adafruit calls. For the rgb666 branch, widen the draw-function color params to `UI_COLOR_T` and cast to `(uint16_t)` in the Adafruit call body (the ST7796 SPI bus gets 666 via `display_writePixels`, but the per-pixel Adafruit path is still 16-bit-typed — that's the existing lossiness this task makes *explicit* rather than worse). For the rgb565 branch, keep `UI_COLOR_T` (= `uint16_t` there).

(The full fix for ST7796 to carry true 888 on its per-pixel path is out of scope — it would require ST7796-specific SPI pixel writes per draw, which the hardware path doesn't use. The runtime widening still benefits ST7796's blend/lerp and scroll blit path, which is where 888 matters most. This task only ensures it *compiles* under the widened HAL.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/display-adapter-color-types.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify full build + demo-ui + existing tests**

Run:
```bash
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish/runtime-header.test.ts tests/packages/cuttlefish/display-adapter-color-types.test.ts tests/packages/cuttlefish/color-888.test.ts
npm run compile --workspace demo-ui
```
Expected: all pass / compile.

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/api/shared/display-adapter.ts packages/cuttlefish/src/api/shared/display-adapters/st7796.ts tests/packages/cuttlefish/display-adapter-color-types.test.ts
git commit -m "feat(adapter): widen display_target* draw signatures to UI_COLOR_T (ILI9341 + ST7796)"
```

**Phase 1 checkpoint:** the color pipeline now carries true 888 end-to-end under `UI_COLOR_DEPTH 888`, 565/mono are byte-identical, and ST7796 rgb666 is improved on its blend/blit path. Commit and proceed to the SDL consumer.

---

## Phase 2: SDL Display Adapter

### Task 7: Create the SDL adapter (registration + target scaffolding)

**Files:**
- Create: `packages/cuttlefish/src/api/shared/display-adapters/sdl.ts`
- Modify: `packages/cuttlefish/src/api/shared/display-adapter.ts` (register it)
- Test: `tests/packages/cuttlefish/display-adapter-sdl.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/display-adapter-sdl.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { generateDisplayAdapter } from "../../../packages/cuttlefish/src/api/shared/display-adapter";

describe("SDL display adapter", () => {
  const a = generateDisplayAdapter({
    driver: "sdl", width: 320, height: 240, colorFormat: "rgb888", rotation: 0,
  } as any);

  it("includes SDL2", () => {
    expect(a.includes).toContain("#include <SDL2/SDL.h>");
  });
  it("aliases CuttlefishDisplayTarget to SdlGfxTarget", () => {
    expect(a.includes).toMatch(/#define CuttlefishDisplayTarget\s+SdlGfxTarget/);
  });
  it("declares the global display object with width/height", () => {
    expect(a.declaration).toMatch(/SdlGfxTarget\s+__tc_display\s*\(\s*320\s*,\s*240\s*\)/);
  });
  it("display_init calls SDL_Init and creates a window", () => {
    expect(a.functions).toContain("SDL_Init");
    expect(a.functions).toMatch(/SDL_CreateWindow/);
  });
  it("draw functions take UI_COLOR_T color", () => {
    expect(a.functions).toMatch(/display_targetDrawPixel\([^)]*UI_COLOR_T color\)/);
  });
  it("packs color as opaque RGBA8888 (0xFF000000 | color)", () => {
    expect(a.functions).toMatch(/0xFF000000/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/display-adapter-sdl.test.ts`
Expected: FAIL — no `"sdl"` adapter registered (`generateDisplayAdapter` throws).

- [ ] **Step 3: Create the SDL adapter**

Create `packages/cuttlefish/src/api/shared/display-adapters/sdl.ts`:

```ts
// SDL2 display adapter — renders the UI to a native desktop window.
// Emits C++ implementing the display HAL contract (display_target*,
// display_canvas*, display_*) against SDL2. Color arrives as true RGB888
// (UI_COLOR_T == uint32_t under UI_COLOR_DEPTH 888) and is packed into an
// RGBA8888 framebuffer (0xFF000000 | color). Mirrors HostAdafruitGFX
// (preview/host-gfx.ts) — the C++ twin of that TS framebuffer renderer.

import type { ResolvedDisplay } from "../../../ui/display-profile-store.js";
import type { DisplayAdapterCode, DisplayAdapterGenerator } from "../display-adapter.js";

export const sdlAdapter: DisplayAdapterGenerator = (display: ResolvedDisplay): DisplayAdapterCode => {
  const w = display.width;
  const h = display.height;

  return {
    includes: [
      `#define CuttlefishDisplayTarget SdlGfxTarget`,
      `#define CuttlefishCanvas16 SdlGfxCanvas`,
      `#include <SDL2/SDL.h>`,
      `#include <cstdint>`,
      `#include <cstring>`,
    ].join("\n"),

    declaration: `SdlGfxTarget __tc_display(${w}, ${h});`,

    functions: [
      `// --- Display adapter: SDL2 (RGB888 → RGBA8888 window) ---`,
      ``,
      `// Framebuffer-backed Adafruit-style target. Owns an SDL window/renderer/texture`,
      `// and a uint32_t RGBA8888 buffer of size w*h. draw_* write 0xFF000000|color;`,
      `// present() pushes the texture. Mirrors HostAdafruitGFX (preview/host-gfx.ts).`,
      `class SdlGfxCanvas {`,
      `public:`,
      `  int16_t w_, h_;`,
      `  uint32_t* buf;`,
      `  int16_t cx = 0, cy = 0;`,
      `  uint32_t fg = 0xFFFFFFFFu, bg = 0xFF000000u;`,
      `  uint8_t textSize = 1; bool wrap = true;`,
      `  explicit SdlGfxCanvas(int16_t w, int16_t h) : w_(w), h_(h), buf(new uint32_t[w*h]{}) {}`,
      `  virtual ~SdlGfxCanvas() { delete[] buf; }`,
      `  int16_t width() const { return w_; }`,
      `  int16_t height() const { return h_; }`,
      `  inline void put(int16_t x, int16_t y, uint32_t rgba) {`,
      `    if (x < 0 || y < 0 || x >= w_ || y >= h_) return;`,
      `    buf[y * w_ + x] = rgba;`,
      `  }`,
      `  inline uint32_t get(int16_t x, int16_t y) const {`,
      `    if (x < 0 || y < 0 || x >= w_ || y >= h_) return 0;`,
      `    return buf[y * w_ + x];`,
      `  }`,
      `  void drawPixel(int16_t x, int16_t y, UI_COLOR_T color) { put(x, y, 0xFF000000u | (uint32_t)color); }`,
      `  void fillRect(int16_t x, int16_t y, int16_t rw, int16_t rh, UI_COLOR_T color) {`,
      `    uint32_t rgba = 0xFF000000u | (uint32_t)color;`,
      `    for (int16_t j = 0; j < rh; j++) for (int16_t i = 0; i < rw; i++) put(x+i, y+j, rgba);`,
      `  }`,
      `  void fillScreen(UI_COLOR_T color) { uint32_t rgba = 0xFF000000u | (uint32_t)color; for (int32_t i=0;i<w_*h_;i++) buf[i]=rgba; }`,
      `  void drawFastHLine(int16_t x, int16_t y, int16_t len, UI_COLOR_T c) { fillRect(x,y,len,1,c); }`,
      `  void drawFastVLine(int16_t x, int16_t y, int16_t len, UI_COLOR_T c) { fillRect(x,y,1,len,c); }`,
      `  void drawRect(int16_t x, int16_t y, int16_t rw, int16_t rh, UI_COLOR_T c) {`,
      `    drawFastHLine(x,y,rw,c); drawFastHLine(x,y+rh-1,rw,c);`,
      `    drawFastVLine(x,y,rh,c); drawFastVLine(x+rw-1,y,rh,c);`,
      `  }`,
      `  // Circle, round-rect, line: copy the integer math from HostAdafruitGFX`,
      `  // (preview/host-gfx.ts fillCircle/drawCircle/drawLine/fillRoundRect/drawRoundRect).`,
      `  // Implementation note: these are mechanical ports; see host-gfx.ts lines noted.`,
      `  void drawLine(int16_t x0,int16_t y0,int16_t x1,int16_t y1,UI_COLOR_T c);`,
      `  void fillCircle(int16_t x,int16_t y,int16_t r,UI_COLOR_T c);`,
      `  void drawCircle(int16_t x,int16_t y,int16_t r,UI_COLOR_T c);`,
      `  void fillRoundRect(int16_t x,int16_t y,int16_t w,int16_t h,int16_t r,UI_COLOR_T c);`,
      `  void drawRoundRect(int16_t x,int16_t y,int16_t w,int16_t h,int16_t r,UI_COLOR_T c);`,
      `  void drawRGBBitmap(int16_t x, int16_t y, const uint16_t* b, int16_t w, int16_t h) {`,
      `    for (int16_t j=0;j<h;j++) for (int16_t i=0;i<w;i++) {`,
      `      uint16_t p = b[j*w+i]; // note: bitmap path is 565-typed in the HAL contract`,
      `      uint32_t r=((p>>11)&0x1f)<<3, g=((p>>5)&0x3f)<<2, bb=(p&0x1f)<<3;`,
      `      put(x+i,y+j,0xFF000000u | (r<<16) | (g<<8) | bb);`,
      `    }`,
      `  }`,
      `  void setCursor(int16_t x, int16_t y) { cx=x; cy=y; }`,
      `  void setTextColor(UI_COLOR_T c) { fg = 0xFF000000u | (uint32_t)c; }`,
      `  void setTextColorBg(UI_COLOR_T c, UI_COLOR_T b) { fg=0xFF000000u|(uint32_t)c; bg=0xFF000000u|(uint32_t)b; }`,
      `  void setTextSize(uint8_t s) { textSize = s; }`,
      `  void setTextWrap(bool w) { wrap = w; }`,
      `  // print() uses the 5x8 glcd font table (same as HostAdafruitGFX.drawChar,`,
      `  // host-gfx.ts:524-552). The font table is emitted below as __sdl_glcdfont[].`,
      `  void print(const char* s);`,
      `};`,
      ``,
      `class SdlGfxTarget : public SdlGfxCanvas {`,
      `public:`,
      `  SDL_Window* win = nullptr;`,
      `  SDL_Renderer* ren = nullptr;`,
      `  SDL_Texture* tex = nullptr;`,
      `  bool dirty = true;`,
      `  explicit SdlGfxTarget(int16_t w, int16_t h) : SdlGfxCanvas(w, h) {}`,
      `  void present() {`,
      `    if (!tex) return;`,
      `    SDL_UpdateTexture(tex, nullptr, buf, w_ * (int)sizeof(uint32_t));`,
      `    SDL_RenderClear(ren); SDL_RenderCopy(ren, tex, nullptr, nullptr);`,
      `    SDL_RenderPresent(ren); dirty = false;`,
      `  }`,
      `};`,
      ``,
      `// 5x8 bitmap font (ASCII 0x20-0x7E). Identical bytes to Adafruit glcdfont /`,
      `// HostAdafruitGFX so text rendering matches the device + preview.`,
      `static const uint8_t __sdl_glcdfont[96][5] = { /* 96 rows of 5 bytes — fill from glcdfont.c */ };`,
      `// (Implementer: copy the 96x5 table from Adafruit_GFX glcdfont.c, public domain.)`,
      ``,
      `// Out-of-line shape implementations: port the integer math from`,
      `// preview/host-gfx.ts drawLine/fillCircle/drawCircle/fillRoundRect/drawRoundRect.`,
      `void SdlGfxCanvas::drawLine(int16_t x0,int16_t y0,int16_t x1,int16_t y1,UI_COLOR_T c){ /* port host-gfx.ts drawLine */ }`,
      `void SdlGfxCanvas::fillCircle(int16_t x,int16_t y,int16_t r,UI_COLOR_T c){ /* port host-gfx.ts fillCircle */ }`,
      `void SdlGfxCanvas::drawCircle(int16_t x,int16_t y,int16_t r,UI_COLOR_T c){ /* port host-gfx.ts drawCircle */ }`,
      `void SdlGfxCanvas::fillRoundRect(int16_t x,int16_t y,int16_t w,int16_t h,int16_t r,UI_COLOR_T c){ /* port */ }`,
      `void SdlGfxCanvas::drawRoundRect(int16_t x,int16_t y,int16_t w,int16_t h,int16_t r,UI_COLOR_T c){ /* port */ }`,
      `void SdlGfxCanvas::print(const char* s){ /* port HostAdafruitGFX.drawChar loop, host-gfx.ts:524-552 */ }`,
      ``,
      `static inline void display_init() {`,
      `  SDL_Init(SDL_INIT_VIDEO);`,
      `  __tc_display.win = SDL_CreateWindow("cuttlefish", SDL_WINDOWPOS_UNDEFINED, SDL_WINDOWPOS_UNDEFINED,`,
      `    __tc_display.w_, __tc_display.h_, SDL_WINDOW_SHOWN);`,
      `  __tc_display.ren = SDL_CreateRenderer(__tc_display.win, -1, SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC);`,
      `  __tc_display.tex = SDL_CreateTexture(__tc_display.ren, SDL_PIXELFORMAT_RGBA8888,`,
      `    SDL_TEXTUREACCESS_STREAMING, __tc_display.w_, __tc_display.h_);`,
      `  __tc_display.fillScreen(0);`,
      `}`,
      `static inline void display_fillScreen(UI_COLOR_T color) { __tc_display.fillScreen(color); }`,
      `static inline CuttlefishDisplayTarget* display_defaultTarget() { return &__tc_display; }`,
      `static inline int16_t display_width() { return __tc_display.width(); }`,
      `static inline int16_t display_height() { return __tc_display.height(); }`,
      `static inline void display_startWrite() {}`,
      `static inline void display_endWrite() {}`,
      `static inline void display_setAddrWindow(int16_t,int16_t,int16_t,int16_t) {}`,
      `static inline void display_writePixels(uint32_t* pixels, uint32_t count) {`,
      `  for (uint32_t i=0;i<count;i++) __tc_display.buf[i] = 0xFF000000u | pixels[i];`,
      `  __tc_display.dirty = true;`,
      `}`,
      `static inline CuttlefishCanvas16* display_createCanvas(int16_t w, int16_t h) { return new SdlGfxCanvas(w,h); }`,
      `static inline CuttlefishCanvas16* display_createCanvasPsram(int16_t,int16_t) { return nullptr; }`,
      `static inline void display_deleteCanvas(CuttlefishCanvas16* c) { delete c; }`,
      `static inline int16_t display_canvasWidth(CuttlefishCanvas16* c) { return c->width(); }`,
      `static inline int16_t display_canvasHeight(CuttlefishCanvas16* c) { return c->height(); }`,
      `static inline uint32_t* display_canvasBuffer(CuttlefishCanvas16* c) { return c->buf; }`,
      `static inline UI_COLOR_T display_canvasGetPixel(CuttlefishCanvas16* c, int16_t x, int16_t y) { return c->get(x,y); }`,
      `static inline void display_canvasFillScreen(CuttlefishCanvas16* c, UI_COLOR_T color) { c->fillScreen(color); }`,
      `static inline void display_canvasFillRect(CuttlefishCanvas16* c, int16_t x,int16_t y,int16_t w,int16_t h, UI_COLOR_T color) { c->fillRect(x,y,w,h,color); }`,
      ``,
      `static inline void display_targetDrawPixel(CuttlefishDisplayTarget* t, int16_t x, int16_t y, UI_COLOR_T color) { t->drawPixel(x,y,color); t->dirty=true; }`,
      `static inline int16_t display_targetWidth(CuttlefishDisplayTarget* t) { return t->width(); }`,
      `static inline int16_t display_targetHeight(CuttlefishDisplayTarget* t) { return t->height(); }`,
      `static inline void display_targetDrawRGBBitmap(CuttlefishDisplayTarget* t, int16_t x, int16_t y, const uint16_t* b, int16_t w, int16_t h) { t->drawRGBBitmap(x,y,b,w,h); t->dirty=true; }`,
      `static inline void display_targetFillRect(CuttlefishDisplayTarget* t, int16_t x,int16_t y,int16_t w,int16_t h, UI_COLOR_T color) { t->fillRect(x,y,w,h,color); t->dirty=true; }`,
      `static inline void display_targetDrawFastHLine(CuttlefishDisplayTarget* t, int16_t x,int16_t y,int16_t w, UI_COLOR_T color) { t->drawFastHLine(x,y,w,color); t->dirty=true; }`,
      `static inline void display_targetDrawFastVLine(CuttlefishDisplayTarget* t, int16_t x,int16_t y,int16_t h, UI_COLOR_T color) { t->drawFastVLine(x,y,h,color); t->dirty=true; }`,
      `static inline void display_targetFillRoundRect(CuttlefishDisplayTarget* t, int16_t x,int16_t y,int16_t w,int16_t h,int16_t r, UI_COLOR_T color) { t->fillRoundRect(x,y,w,h,r,color); t->dirty=true; }`,
      `static inline void display_targetDrawRect(CuttlefishDisplayTarget* t, int16_t x,int16_t y,int16_t w,int16_t h, UI_COLOR_T color) { t->drawRect(x,y,w,h,color); t->dirty=true; }`,
      `static inline void display_targetDrawRoundRect(CuttlefishDisplayTarget* t, int16_t x,int16_t y,int16_t w,int16_t h,int16_t r, UI_COLOR_T color) { t->drawRoundRect(x,y,w,h,r,color); t->dirty=true; }`,
      `static inline void display_targetDrawLine(CuttlefishDisplayTarget* t, int16_t x0,int16_t y0,int16_t x1,int16_t y1, UI_COLOR_T color) { t->drawLine(x0,y0,x1,y1,color); t->dirty=true; }`,
      `static inline void display_targetFillCircle(CuttlefishDisplayTarget* t, int16_t x,int16_t y,int16_t r, UI_COLOR_T color) { t->fillCircle(x,y,r,color); t->dirty=true; }`,
      `static inline void display_targetDrawCircle(CuttlefishDisplayTarget* t, int16_t x,int16_t y,int16_t r, UI_COLOR_T color) { t->drawCircle(x,y,r,color); t->dirty=true; }`,
      `static inline void display_targetSetCursor(CuttlefishDisplayTarget* t, int16_t x, int16_t y) { t->setCursor(x,y); }`,
      `static inline void display_targetSetTextColor(CuttlefishDisplayTarget* t, UI_COLOR_T fg) { t->setTextColor(fg); }`,
      `static inline void display_targetSetTextColorBg(CuttlefishDisplayTarget* t, UI_COLOR_T fg, UI_COLOR_T bg) { t->setTextColorBg(fg,bg); }`,
      `static inline void display_targetSetTextSize(CuttlefishDisplayTarget* t, uint8_t s) { t->setTextSize(s); }`,
      `static inline void display_targetSetTextWrap(CuttlefishDisplayTarget* t, bool w) { t->setTextWrap(w); }`,
      `static inline void display_targetPrint(CuttlefishDisplayTarget* t, const char* s) { t->print(s); t->dirty=true; }`,
      `// Called by the SDL event loop after each ui_tick to push the framebuffer.`,
      `static inline void display_present() { __tc_display.present(); }`,
    ].join("\n"),
  };
};
```

> **Implementer note (the only intentional "fill from" items):** The glcdfont 96×5 table and the four shape functions (drawLine/fillCircle/drawCircle/fillRoundRect/drawRoundRect/print) are **direct ports** of existing, in-repo code:
> - glcdfont: copy from `Adafruit_GFX` `glcdfont.c` (public domain), same bytes the preview already assumes.
> - shapes/print: port line-for-line from `packages/cuttlefish/src/preview/host-gfx.ts` (`drawLine`, `fillCircle`, `drawCircle`, `fillRoundRect`, `drawRoundRect`, `drawChar`). Replace `this.buffer` indexing with `put()`/`get()`, and color packing with `0xFF000000u | (uint32_t)color`. These are mechanical translations of already-working code, not new algorithms.

- [ ] **Step 4: Register the adapter**

In `packages/cuttlefish/src/api/shared/display-adapter.ts`, add after the eink registration (line 49):
```ts
// ── SDL2 adapter (native desktop window, RGB888) ────────────────────────────
import { sdlAdapter } from "./display-adapters/sdl.js";
registerDisplayAdapter("sdl", sdlAdapter);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/display-adapter-sdl.test.ts`
Expected: PASS (all 6).

- [ ] **Step 6: Build + commit**

```bash
npm run build --workspace @typecad/cuttlefish
git add packages/cuttlefish/src/api/shared/display-adapters/sdl.ts packages/cuttlefish/src/api/shared/display-adapter.ts tests/packages/cuttlefish/display-adapter-sdl.test.ts
git commit -m "feat(adapter): SDL2 display adapter — RGBA8888 window target, RGB888 HAL"
```

---

## Phase 3: framework-native wiring + SDL event loop + touch

### Task 8: Add a `hostEventLoop()` strategy hook and emit it around ui_tick

**Files:**
- Modify: `packages/cuttlefish/src/api/shared/platform-strategy.ts` (add optional hook)
- Modify: `packages/cuttlefish/src/emit/emitters/function-emitter-impl.ts:296-303`
- Test: `tests/packages/cuttlefish/runtime-header.test.ts` or a new emit test (smoke)

**Context:** Native `main()` calls `ui_tick` once (`function-emitter-impl.ts:296-302`). SDL needs a loop that pumps events and ticks repeatedly. Add an optional strategy method that returns loop scaffolding (the strategy returns `null` to keep today's single-shot behavior).

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/event-loop-hook.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { NativeStrategy } from "../../../packages/framework-native/src/strategy";

describe("native hostEventLoop hook", () => {
  it("returns loop scaffolding that pumps events and ticks repeatedly", () => {
    const s = new NativeStrategy();
    const loop = (s as any).hostEventLoop?.();
    expect(loop).toBeTruthy();
    expect(loop.flagName).toBe("sdl_running");
    expect(loop.continueCondition).toBe("sdl_running");
    expect(loop.preIteration).toContain("SDL_PollEvent");
    expect(loop.postIteration).toContain("display_present");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/event-loop-hook.test.ts`
Expected: FAIL — `hostEventLoop` undefined.

- [ ] **Step 3: Add the optional hook to the strategy interface**

In `packages/cuttlefish/src/api/shared/platform-strategy.ts`, add to the `PlatformStrategy` interface:
```ts
  /** Optional host event-loop scaffolding wrapping ui_tick in the driver
   *  function. Return null/undefined for single-shot (today's native + Arduino
   *  loop() behavior). When provided, the emitter declares `flagName` as a bool,
   *  then wraps the per-frame work in
   *  `while (continueCondition) { preIteration; <tick>; postIteration; }`. */
  hostEventLoop?(): { flagName: string; continueCondition: string; preIteration: string; postIteration: string } | null;
```

- [ ] **Step 4: Emit the loop in function-emitter-impl.ts**

In `packages/cuttlefish/src/emit/emitters/function-emitter-impl.ts`, replace the block at lines 296-303 (the `if (entryHasUI() && fn.name === asyncDriverFn)` block). Current:
```ts
if (entryHasUI() && fn.name === asyncDriverFn) {
  appendSourceLine(ctx, `  uint32_t __tc_ui_now = (uint32_t)${strategy.currentTimeMillis()};`);
  appendSourceLine(ctx, "  static uint32_t __tc_ui_last_tick = __tc_ui_now;");
  appendSourceLine(ctx, "  uint32_t __tc_ui_delta = __tc_ui_now - __tc_ui_last_tick;");
  appendSourceLine(ctx, "  __tc_ui_last_tick = __tc_ui_now;");
  appendSourceLine(ctx, "  if (__tc_ui_delta > 250) __tc_ui_delta = 250;");
  appendSourceLine(ctx, "  ui_tick((uint16_t)__tc_ui_delta);");
}
```
New:
```ts
if (entryHasUI() && fn.name === asyncDriverFn) {
  const loop = strategy.hostEventLoop?.();
  if (loop) {
    appendSourceLine(ctx, `  bool ${loop.flagName} = true;`);
    appendSourceLine(ctx, `  while (${loop.continueCondition}) {`);
    appendSourceLine(ctx, `    ${loop.preIteration}`);
  }
  appendSourceLine(ctx, `  uint32_t __tc_ui_now = (uint32_t)${strategy.currentTimeMillis()};`);
  appendSourceLine(ctx, "  static uint32_t __tc_ui_last_tick = __tc_ui_now;");
  appendSourceLine(ctx, "  uint32_t __tc_ui_delta = __tc_ui_now - __tc_ui_last_tick;");
  appendSourceLine(ctx, "  __tc_ui_last_tick = __tc_ui_now;");
  appendSourceLine(ctx, "  if (__tc_ui_delta > 250) __tc_ui_delta = 250;");
  appendSourceLine(ctx, "  ui_tick((uint16_t)__tc_ui_delta);");
  if (loop) {
    appendSourceLine(ctx, `    ${loop.postIteration}`);
    appendSourceLine(ctx, `  }`);
  }
}
```

- [ ] **Step 5: Implement hostEventLoop on NativeStrategy**

In `packages/framework-native/src/strategy.ts`, add a method to `NativeStrategy`:
```ts
hostEventLoop() {
  return {
    flagName: "sdl_running",
    continueCondition: "sdl_running",
    preIteration: "SDL_Event __e; while (SDL_PollEvent(&__e)) { if (__e.type == SDL_QUIT) sdl_running = false; }",
    postIteration: "display_present();",
  };
}
```
(The loop only emits SDL symbols when this strategy is active; Arduino/Generic return undefined → single-shot / loop() behavior unchanged.)

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/event-loop-hook.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify demo-ui unaffected + commit**

```bash
npm run build --workspace @typecad/cuttlefish
npm run compile --workspace demo-ui
```
Expected: success (Arduino strategy has no `hostEventLoop` → single tick in `loop()` unchanged).

```bash
git add packages/cuttlefish/src/api/shared/platform-strategy.ts packages/cuttlefish/src/emit/emitters/function-emitter-impl.ts packages/framework-native/src/strategy.ts tests/packages/cuttlefish/event-loop-hook.test.ts
git commit -m "feat(emit): hostEventLoop strategy hook — SDL pumps events + presents around ui_tick"
```

---

### Task 9: Register the `"sdl"` touch library (mouse → touch contract)

**Files:**
- Modify: `packages/cuttlefish/src/api/shared/display-profile.ts:17` (`TouchLibrary` union)
- Modify: `packages/cuttlefish/src/api/shared/display-profile.ts:258` (`generateTouchAdapter` branch)
- Test: `tests/packages/cuttlefish/display-adapter-sdl.test.ts` (append) or a new touch test

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/display-adapter-sdl.test.ts`:
```ts
import { generateTouchAdapter } from "../../../packages/cuttlefish/src/api/shared/display-profile";

describe("SDL touch library (mouse shim)", () => {
  const t = generateTouchAdapter({ library: "sdl", calibration: { xMin:0, xMax:320, yMin:0, yMax:240 } } as any);
  it("declares no SDL-specific include beyond SDL.h", () => {
    expect(t.includes.some(i => i.includes("SDL"))).toBe(true);
  });
  it("touch_isTouched reads the SDL mouse left button", () => {
    expect(t.functions).toMatch(/SDL_GetMouseState[^;]*SDL_BUTTON_LMASK/);
  });
  it("touch_readRaw returns screen-space coords + constant z", () => {
    expect(t.functions).toMatch(/\*z = 200/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/display-adapter-sdl.test.ts`
Expected: FAIL — `generateTouchAdapter` throws "Unknown touch library 'sdl'".

- [ ] **Step 3: Add "sdl" to the TouchLibrary union and generateTouchAdapter**

In `packages/cuttlefish/src/api/shared/display-profile.ts` line 17, change:
```ts
export type TouchLibrary = "XPT2046_Touchscreen" | "Adafruit_TouchScreen" | "Adafruit_STMPE610";
```
to:
```ts
export type TouchLibrary = "XPT2046_Touchscreen" | "Adafruit_TouchScreen" | "Adafruit_STMPE610" | "sdl";
```

In `generateTouchAdapter` (line 258), before the `throw` at line 314, add:
```ts
  if (touch.library === "sdl") {
    return {
      includes: ["#include <SDL2/SDL.h>"],
      declaration: `// SDL touch: no controller object, mouse is the source`,
      functions: [
        `static inline void touch_init() {}`,
        `static inline bool touch_isTouched() {`,
        `  int __mx, __my;`,
        `  return (SDL_GetMouseState(&__mx, &__my) & SDL_BUTTON_LMASK) != 0;`,
        `}`,
        `static inline void touch_readRaw(int16_t* x, int16_t* y, int16_t* z) {`,
        `  int __mx, __my;`,
        `  SDL_GetMouseState(&__mx, &__my);`,
        `  if (x) *x = (int16_t)__mx;`,
        `  if (y) *y = (int16_t)__my;`,
        `  if (z) *z = 200;   // constant > minPressure(10)`,
        `}`,
      ].join("\n"),
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/display-adapter-sdl.test.ts`
Expected: PASS (adapter tests + touch tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/api/shared/display-profile.ts tests/packages/cuttlefish/display-adapter-sdl.test.ts
git commit -m "feat(touch): sdl mouse shim — touch_isTouched/readRaw backed by SDL mouse"
```

---

### Task 10: Register "sdl" driver + rgb888 colorFormat in framework-native

**Files:**
- Modify: `packages/framework-native/src/strategy.ts:549` (`supportedDisplayDrivers`)
- Modify: `packages/framework-native/src/strategy.ts:553` (`colorFormat`)
- Test: `tests/packages/framework-native/strategy-sdl.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/framework-native/strategy-sdl.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { NativeStrategy } from "../../../packages/framework-native/src/strategy";

describe("NativeStrategy SDL wiring", () => {
  const s = new NativeStrategy();
  it("supports the sdl display driver", () => {
    expect(s.supportedDisplayDrivers().has("sdl")).toBe(true);
  });
  it("still supports native-preview", () => {
    expect(s.supportedDisplayDrivers().has("native-preview")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/framework-native/strategy-sdl.test.ts`
Expected: FAIL — `supportedDisplayDrivers()` returns only `{"native-preview"}`.

- [ ] **Step 3: Add "sdl" to supportedDisplayDrivers**

In `packages/framework-native/src/strategy.ts:549`, change:
```ts
  supportedDisplayDrivers(): ReadonlySet<string> {
    return new Set(["native-preview"]);
  }
```
to:
```ts
  supportedDisplayDrivers(): ReadonlySet<string> {
    return new Set(["native-preview", "sdl"]);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/packages/framework-native/strategy-sdl.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/framework-native/src/strategy.ts tests/packages/framework-native/strategy-sdl.test.ts
git commit -m "feat(framework-native): register sdl display driver"
```

---

## Phase 4: native_demo + end-to-end verification

### Task 11: Populate `native_demo` with a showcase port

**Files:**
- Create: `native_demo/package.json`
- Create: `native_demo/cuttlefish.config.ts`
- Create: `native_demo/src/showcase.ui.html`
- Create: `native_demo/src/showcase.neobrutalism.css` (port a subset)
- Create: `native_demo/src/showcase.ui.d.html.ts` (generated — regenerate via build, then commit)
- Create: `native_demo/src/main.ts`

- [ ] **Step 1: Create package.json**

`native_demo/package.json`:
```json
{
  "name": "native_demo",
  "private": true,
  "scripts": {
    "build": "cuttlefish build",
    "compile": "cuttlefish build --compile",
    "preview": "cuttlefish preview"
  }
}
```

- [ ] **Step 2: Create the config**

`native_demo/cuttlefish.config.ts`:
```ts
import type { TypeCADConfig } from "@typecad/cuttlefish";

const config: TypeCADConfig = {
  framework: "@typecad/framework-native",
  target: "generic",
  entry: "./src/main.ts",
  outDir: "./src/out",
  display: {
    driver: "sdl",
    width: 320,
    height: 240,
    colorFormat: "rgb888",
    rotation: 0,
  },
  touch: {
    library: "sdl",
    calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 240 },
  },
  native: {
    cxxStandard: "c++17",
    libraries: ["SDL2"],
    warnings: "all",
  },
};

export default config;
```

> **Windows note for the implementer:** on MSYS2/ucrt64 the SDL2 link set may need `-lmingw32 -lSDL2main -lSDL2`. If the bare `libraries: ["SDL2"]` fails to link on Windows, add `libraryPaths: ["C:\\msys64\\ucrt64\\lib"]` and expand `libraries` to `["mingw32", "SDL2main", "SDL2"]`. Keep the Linux/macOS path as `["SDL2"]`. Document whichever works in a README at `native_demo/README.md`.

- [ ] **Step 3: Author a minimal showcase UI**

Create `native_demo/src/showcase.ui.html` with a focused subset exercising: a full-screen fill, a gradient, a text node (bitmap font path), and a touch-driven button. Keep it small (one screen). Model the markup on `demo-ui/src/showcase.ui.html` (the `<screen>`/`<body>`/`<header>` structure).

```html
<screen id="main">
  <body style="background:#101820">
    <header style="color:#7FE7CB; font-size:16">rgb888 + SDL</header>
    <div style="background:linear-gradient(#FF512F,#DD2476); height:80"></div>
    <a id="btn" href="#" style="background:#2D9CDB; color:#FFFFFF; padding:12">Tap me</a>
    <div id="count" style="color:#F2C94C; font-size:14">taps: 0</div>
  </body>
</screen>
```

- [ ] **Step 4: Author the binding layer**

`native_demo/src/main.ts`:
```ts
import { ui } from "@typecad/cuttlefish/runtime";
import { screen } from "./showcase.ui.html";

let taps = 0;
ui.mount(screen);

screen.btn.onClick(() => {
  taps++;
  ui.bind(screen.count, "text", `taps: ${taps}`);
});
```

- [ ] **Step 5: Build to generate the .ui.d.html.ts + C++**

Run:
```bash
npm run build --workspace @typecad/cuttlefish   # ensure dist is fresh
npm run build --workspace native_demo
```
Expected: `native_demo/src/showcase.ui.d.html.ts` regenerated; C++ emitted to `native_demo/src/out/`.

- [ ] **Step 6: Compile to a native exe (manual verification)**

Run:
```bash
npm run compile --workspace native_demo
```
Expected: produces `native_demo/src/out/main/main.exe` (Windows) or `.out` (Linux/macOS). Run it: a 320×240 window appears showing the gradient, text, and button; clicking the button increments the counter. (This step requires SDL2 installed on the dev machine; it is a manual smoke test, not an automated CI gate.)

- [ ] **Step 7: Commit**

```bash
git add native_demo/
git commit -m "feat(native_demo): SDL showcase — gradient + text + touch button on rgb888"
```

---

### Task 12: Add an SDL-availability-guarded end-to-end test

**Files:**
- Create: `packages/framework-native/tests/sdl-availability.test.ts`
- Reference: `packages/framework-native/tests/runner/native-pipeline.ts`

- [ ] **Step 1: Write the test (skip-gated)**

Create `packages/framework-native/tests/sdl-availability.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// Probe SDL2 availability once: try compiling a one-liner that #includes SDL.h.
function sdl2Available(): boolean {
  const tmp = path.join(require("os").tmpdir(), `sdl_probe_${process.pid}.cpp`);
  fs.writeFileSync(tmp, '#include <SDL2/SDL.h>\nint main(){SDL_Init(0);return 0;}\n');
  const compiler = process.platform === "win32" ? "C:\\msys64\\ucrt64\\bin\\g++.exe" : "g++";
  const r = spawnSync(compiler, ["-x", "c++", tmp, "-o", tmp + ".exe", "-lSDL2"], {
    encoding: "utf8", timeout: 20000,
  });
  try { fs.unlinkSync(tmp); fs.unlinkSync(tmp + ".exe"); } catch {}
  return r.status === 0;
}

const SDL = sdl2Available();

describe.skip(!SDL, "SDL2 native render (skipped: SDL2 not installed)") {
  // … rest below
}

describe("SDL2 native render", () => {
  it.skip(!SDL, "renders a frame and exits 0 (skipped without SDL2)")(() => {
    // Minimal: transpile a one-screen SDL program, compile with -lSDL2, run with
    // a headless timeout, assert exit 0. Model on runNativeTest() in
    // packages/framework-native/tests/runner/native-pipeline.ts (spawn CLI build,
    // spawn g++, spawn exe). Because SDL needs a window server, run the exe with
    // SDL_VIDEODRIVER=dummy on Linux for CI.
    expect(true).toBe(true); // placeholder until the harness below is filled
  });
});
```

> **Implementer note:** Replace the inner body with a real `runNativeTest`-style spawn sequence (see `native-pipeline.ts:68-158`): write a tiny `.ts` fixture that mounts a one-node UI, `cuttlefish build` it, `g++ -lSDL2` the emitted `.cpp`, run the exe with `SDL_VIDEODRIVER=dummy` env (Linux) and a short timeout, assert exit 0. The skip-gate (`sdl2Available()`) keeps CI green where SDL2 is absent. Do **not** leave the `expect(true).toBe(true)` placeholder — implement the real spawn/compile/run assertions modeled on `native-pipeline.ts`.

- [ ] **Step 2: Run the test**

Run: `npx vitest run packages/framework-native/tests/sdl-availability.test.ts`
Expected: PASS (skipped if SDL2 absent; runs and asserts exit 0 if present).

- [ ] **Step 3: Commit**

```bash
git add packages/framework-native/tests/sdl-availability.test.ts
git commit -m "test(framework-native): SDL-availability-guarded native render e2e"
```

---

### Task 13: Final verification — all gates green

- [ ] **Step 1: Full cuttlefish build + focused tests**

```bash
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish/color-888.test.ts \
  tests/packages/cuttlefish/runtime-header.test.ts \
  tests/packages/cuttlefish/display-adapter-color-types.test.ts \
  tests/packages/cuttlefish/display-adapter-sdl.test.ts \
  tests/packages/cuttlefish/event-loop-hook.test.ts \
  tests/packages/framework-native/strategy-sdl.test.ts
```
Expected: all PASS.

- [ ] **Step 2: demo-ui (565 byte-identity) still compiles**

```bash
npm run compile --workspace demo-ui
```
Expected: success — the rgb888 widening must not have changed 565 output.

- [ ] **Step 3: native_demo builds + compiles (where SDL present)**

```bash
npm run compile --workspace native_demo
```
Expected: exe produced; manual smoke (window renders, button responds).

- [ ] **Step 4: Final commit (if any verification fixes were needed)**

If all green, no commit needed. If fixes were required, commit them with clear messages. Then:
```bash
git log --oneline -15
```
Confirm the Phase 1–4 commit chain is coherent.

---

## Self-Review Notes (applied during plan authoring)

**Spec coverage:**
- §4.1 rgb888 format union + resolveColorInternal → Task 1 ✓
- §4.2 widen ui_display_* → Task 3 ✓
- §4.3 truncation locals → Task 4 ✓
- §4.4 dim mask + 0xffff guards → Task 5 ✓
- §4.5 safety (565 byte-identity) → verified at the end of Tasks 3,4,5,6 + Task 13 ✓
- §5 SDL adapter → Task 7 ✓
- §6 framework-native supportedDrivers/colorFormat + event loop → Tasks 8,10 ✓
- §7 touch → Task 9 ✓
- §8 native_demo → Task 11 ✓
- §9 testing (runtime-header, color-888, display-adapter-sdl, e2e) → Tasks 1,2,3,7,12 ✓
- §10 phasing → Phase 1 = Tasks 1-6, Phase 2 = 7, Phase 3 = 8-10, Phase 4 = 11-13 ✓

**Type consistency:** `UI_COLOR_T` introduced in Task 3, used uniformly in Tasks 4,5,6,7. `hostEventLoop` return shape (`flagName`/`continueCondition`/`preIteration`/`postIteration`) defined in Task 8 Step 3+5 and consumed in Step 4 — consistent. `sdlAdapter` / `sdl` TouchLibrary / `"sdl"` driver are the same string everywhere.

**Known soft spots (called out honestly, not hidden):**
1. Task 7's glcdfont table + 5 shape functions are ports of in-repo/Adafruit code, marked explicitly for the implementer — not placeholders, but mechanical translation work.
2. Task 8 Step 4's flag-name extraction is refined to an explicit `flagName` field before commit.
3. Task 12's inner assertions must be implemented from the `native-pipeline.ts` template, not left as `expect(true)` — flagged in the step.
4. Windows SDL link flags are environment-dependent; Task 11 Step 2 documents the fallback expansion.
