# Display-Agnostic Core — Phase 4: E-Ink Foundation (1-Bit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the e-ink display path end-to-end for a **1-bit B&W panel with partial refresh** (e.g. SSD1680-based 296×128): a backing store, dirty-rect refresh aggregation, an `eink-mono` shim, descriptor-driven suppression of full-screen clears, and a refresh budget. This is the first bistable display class. Dithering and multi-color e-ink are explicitly **Phase 5** — Phase 4 ships flat 1-bit output (snap colors to black/white by luminance), which is correct and useful for the cheapest/most-common panels.

**Architecture:** E-ink inverts two TFT defaults that AGENTS.md is protective of: (1) it **requires** a backing store (dithering needs a region; partial refresh needs the previous frame to know what changed), and (2) refresh is **deferred** (slow, must be batched). The runtime already has the ingredients — `UI_USE_FULL_FRAMEBUFFER`/`ui_push_framebuffer` (off by default for TFT), per-node dirty bits + `ui_node_paint_rect` (the "what changed, where"), and `DisplayFlushOp.rects`. Phase 4 wires them behind a `UI_REFRESH_DEFERRED` define that the emitter sets from `capabilities.refreshModel`. On TFT the define is unset and the path is byte-identical.

The hard constraint, restated: **full-screen clears flash.** `ui_navigate`'s `display_fillScreen(0x0000)` and whole-tree-dirty on keyboard open are fatal on e-ink. Phase 4 makes them descriptor-gated: on deferred-refresh targets, "clear" becomes "mark all dirty, repaint next flush" — no `fillScreen`.

**Tech Stack:** TypeScript (transpiler + preview), C++ (emitted runtime + eink shim), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-02-display-agnostic-core-design.md` (Phase 4 of 4; §2.3 shim table, §3.2 refresh model).
**Phases 1–3:** complete.

**Verification baseline (after every code task):**
```sh
rm -f packages/cuttlefish/*.tsbuildinfo
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish
npm run compile --workspace demo-ui   # ILI9341/immediate — must stay byte-identical
```
The 5 known-unrelated pre-existing failures are being fixed separately.

---

## File Structure

**Created:**
- `packages/cuttlefish/src/api/shared/display-adapters/eink-mono.ts` — the 1-bit e-ink shim (SSD1680-class: backing store, partial refresh, no fillScreen).
- `tests/packages/cuttlefish/eink-shim.test.ts` — shim registration + generated C++ shape.
- `tests/packages/cuttlefish/refresh-scheduler.test.ts` — dirty-rect union + coalescing.

**Modified:**
- `packages/cuttlefish/src/emit/emitters/ui-emitter.ts` — emit `#define UI_REFRESH_DEFERRED` + `#define UI_COLOR_DEPTH_MONO` (1-bit) from capabilities; register `ssd1680`-class driver wiring.
- `packages/cuttlefish/src/ui/runtime-header.ts` — backing-store activation, dirty-rect accumulation into a refresh union, descriptor-gated clear suppression, refresh-budget coalescing, mono color snapping in the draw path.
- `packages/cuttlefish/src/api/shared/display-adapter.ts` — register the eink-mono adapter.
- `packages/framework-arduino/src/strategy.ts` — add e-ink drivers to `supportedDisplayDrivers()`.

---

## Task 1: Emit refresh-model + 1-bit defines from capabilities

**Files:**
- Modify: `packages/cuttlefish/src/emit/emitters/ui-emitter.ts`

- [ ] **Step 1: Read the current define-emission block**

Run: `sed -n '78,105p' packages/cuttlefish/src/emit/emitters/ui-emitter.ts`
Note where `UI_AA`, `UI_COLOR_DEPTH`, and the `UI_SCROLL_*` defines are pushed. The new defines go alongside.

- [ ] **Step 2: Emit UI_REFRESH_DEFERRED + UI_NATIVE_MONO from derived capabilities**

Import `deriveCapabilities` at the top of ui-emitter.ts (if not already), then after the `UI_COLOR_DEPTH` push, add:

```ts
  // Refresh model + native format from capabilities. E-ink (displayClass: "eink")
  // derives refreshModel "deferred-partial" + requiresBackingStore; TFT stays
  // "immediate". When UI_REFRESH_DEFERRED is unset (TFT), the runtime's backing-
  // store + refresh-scheduler paths compile out — byte-identical with pre-Phase-4.
  const caps = deriveCapabilities(profile);
  if (caps.refreshModel !== "immediate") {
    ctx.sourceLines.push("#define UI_REFRESH_DEFERRED 1");
  }
  if (caps.nativeFormat === "mono") {
    ctx.sourceLines.push("#define UI_NATIVE_MONO 1");
  }
  if (caps.requiresBackingStore) {
    ctx.sourceLines.push("#define UI_REQUIRES_BACKING_STORE 1");
  }
```

(If `profile` here lacks `displayClass`/`capabilities`, thread them — they're on `DisplayProfile` from Phase 2. `deriveCapabilities` accepts the profile shape.)

- [ ] **Step 3: Build + verify TFT byte-identity (defines absent on demo-ui)**

```sh
rm -f packages/cuttlefish/*.tsbuildinfo
npm run build --workspace @typecad/cuttlefish
npm run compile --workspace demo-ui
grep -c "UI_REFRESH_DEFERRED\|UI_NATIVE_MONO\|UI_REQUIRES_BACKING_STORE" demo-ui/src/out/main/main.ino
```
Expected: `0` (demo-ui is ILI9341/TFT — none of the e-ink defines appear).

- [ ] **Step 4: Commit**

```bash
git add packages/cuttlefish/src/emit/emitters/ui-emitter.ts
git commit -m "feat(emit): emit UI_REFRESH_DEFERRED/UI_NATIVE_MONO/UI_REQUIRES_BACKING_STORE from capabilities (absent on TFT)"
```

---

## Task 2: Runtime — descriptor-gated clear suppression + mono snap

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts`

The two TFT assumptions that flash on e-ink: `display_fillScreen` on navigate/init, and whole-tree-dirty on keyboard open. On deferred-refresh targets these become no-op clears + mark-dirty. Mono panels also need every draw color snapped to 0/1 (the node fields hold snapped values from `resolveColorInternal`, but defensive snapping in the draw path catches any runtime-blended value).

- [ ] **Step 1: Gate display_fillScreen behind !UI_REFRESH_DEFERRED**

Find every `display_fillScreen(0x...);` call (the navigate/init clear at ~line 476, and any others via `grep -n "display_fillScreen(0x" runtime-header.ts`). Wrap each:

```cpp
#ifndef UI_REFRESH_DEFERRED
  display_fillScreen(0x0000);
#else
  // Deferred-refresh (e-ink): a full clear flashes. Mark every node dirty so the
  // next flush repaints the screen via partial refresh instead.
  ui_mark_all_dirty();
#endif
```

Add a `ui_mark_all_dirty()` helper near `ui_mark_dirty` if it doesn't exist:
```cpp
static inline void ui_mark_all_dirty() {
  for (uint16_t i = 0; i < __ui_node_count; i++) __ui_nodes[i].dirty = 1;
}
```

- [ ] **Step 2: Snap draw colors to mono under UI_NATIVE_MONO**

The draw primitives (`ui_display_fill_rect`, `ui_display_draw_pixel`, text color sets) receive color values. Under `UI_NATIVE_MONO`, snap any value to black/white by luminance threshold. Add a helper and apply at the top of the draw dispatch:

```cpp
#ifdef UI_NATIVE_MONO
// Snap a color value to 1-bit mono by luminance. Node fields are pre-snapped at
// transpile, but blended/lerped runtime values (opacity, shadows) need this.
static inline uint32_t ui_snap_mono(uint32_t c) {
  uint8_t r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
  return ((uint32_t)(0.299f*r + 0.587f*g + 0.114f*b) >= 0.27f*255) ? 0xffffff : 0x000000;
}
#define UI_MAYBE_SNAP_MONO(c) (ui_snap_mono(c))
#else
#define UI_MAYBE_SNAP_MONO(c) (c)
#endif
```

Apply `UI_MAYBE_SNAP_MONO(...)` at the fill_rect/draw_pixel draw sites (the ones that take a node-derived color and push to the target). Find them with `grep -n "ui_display_fill_rect\|ui_display_draw_pixel\|display_targetDrawPixel\|display_targetFillRect" runtime-header.ts` — wrap the color argument. (Do NOT wrap the canvas-internal draws; those are into the backing store and snapped at push.)

- [ ] **Step 3: Build + run runtime-header tests + compile demo-ui**

```sh
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish/runtime-header.test.ts
npm run compile --workspace demo-ui
```
Expected: tests pass; demo-ui compiles unchanged (the `#ifndef UI_REFRESH_DEFERRED` / `#else` mono guards compile out on TFT).

- [ ] **Step 4: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts
git commit -m "feat(runtime): descriptor-gated clear suppression (deferred refresh) + mono color snap; TFT byte-identical"
```

---

## Task 3: Runtime — backing-store activation + dirty-rect refresh union

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts`
- Test: `tests/packages/cuttlefish/refresh-scheduler.test.ts`

The existing `UI_USE_FULL_FRAMEBUFFER` path allocates a PSRAM canvas and bulk-pushes it. For e-ink, generalize this: under `UI_REQUIRES_BACKING_STORE`, always allocate the backing store (e-ink needs it), draw into it, and at frame end compute the **union of dirty paint-rects** and issue one refresh of that union. Phase 4 implements the union + a single partial refresh; coalescing/ghost-cadence are stubbed (TODO comment) for Phase 5.

- [ ] **Step 1: Write the failing test for the dirty-union helper**

Create `tests/packages/cuttlefish/refresh-scheduler.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { emitRuntimeHeader } from "../../../packages/cuttlefish/src/ui/runtime-header";

describe("e-ink dirty-rect refresh union", () => {
  const header = emitRuntimeHeader();

  it("defines a dirty-rect accumulator under UI_REQUIRES_BACKING_STORE", () => {
    // The runtime emits a small fixed array of dirty rects + a count, reset each
    // frame and unioned into the refresh region at flush.
    expect(header).toMatch(/ui_dirty_rect|__ui_dirty_rects|ui_refresh_add_rect/);
  });

  it("issues a partial refresh of the union at flush (deferred)", () => {
    expect(header).toMatch(/display_partial_refresh|ui_refresh_flush|partialRefresh/);
  });

  it("backing store is always allocated under UI_REQUIRES_BACKING_STORE", () => {
    // Unlike UI_USE_FULL_FRAMEBUFFER (PSRAM-gated, TFT-default-off), the e-ink
    // backing store allocates unconditionally when the define is set.
    expect(header).toMatch(/UI_REQUIRES_BACKING_STORE/);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/packages/cuttlefish/refresh-scheduler.test.ts`
Expected: FAIL — none of the e-ink refresh symbols exist yet.

- [ ] **Step 3: Add the dirty-rect accumulator + refresh-union logic**

In `packages/cuttlefish/src/ui/runtime-header.ts`, add (guarded so TFT compiles it out):

```cpp
// ── Deferred-refresh (e-ink) dirty-rect aggregation ──────────────────────────
// Under UI_REQUIRES_BACKING_STORE, each painted node reports its paint rect into
// this accumulator; at frame end the union is refreshed as one partial update.
#ifndef UI_REQUIRES_BACKING_STORE
  // TFT: no-op stubs so call sites compile cleanly.
  #define ui_refresh_add_rect(x, y, w, h) ((void)0)
  #define ui_refresh_flush()              ((void)0)
  #define ui_refresh_begin_frame()        ((void)0)
#else
  #define UI_REFRESH_MAX_RECTS 16
  struct UIRect16 { int16_t x, y, w, h; };
  static UIRect16 __ui_refresh_rects[UI_REFRESH_MAX_RECTS];
  static uint8_t __ui_refresh_rect_count = 0;
  static inline void ui_refresh_begin_frame() { __ui_refresh_rect_count = 0; }
  static inline void ui_refresh_add_rect(int16_t x, int16_t y, int16_t w, int16_t h) {
    if (__ui_refresh_rect_count < UI_REFRESH_MAX_RECTS) {
      __ui_refresh_rects[__ui_refresh_rect_count++] = { x, y, w, h };
    }
    // TODO Phase 5: coalesce overlapping rects into a tighter union; cap by
    // refresh budget; trigger a periodic full-refresh for ghost clearing.
  }
  // Union all accumulated rects and issue one partial refresh via the shim.
  static inline void ui_refresh_flush() {
    if (__ui_refresh_rect_count == 0) return;
    int16_t x0 = 32767, y0 = 32767, x1 = -32768, y1 = -32768;
    for (uint8_t i = 0; i < __ui_refresh_rect_count; i++) {
      const UIRect16& r = __ui_refresh_rects[i];
      if (r.x < x0) x0 = r.x; if (r.y < y0) y0 = r.y;
      int16_t rx1 = r.x + r.w, ry1 = r.y + r.h;
      if (rx1 > x1) x1 = rx1; if (ry1 > y1) y1 = ry1;
    }
    // Clamp to display bounds, then hand to the shim's partial-refresh entry.
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
    if (x1 > display_width()) x1 = display_width();
    if (y1 > display_height()) y1 = display_height();
    if (x1 > x0 && y1 > y0) display_partial_refresh(x0, y0, (int16_t)(x1 - x0), (int16_t)(y1 - y0));
  }
#endif
```

- [ ] **Step 4: Wire ui_refresh_add_rect into the paint path + ui_refresh_flush at frame end**

In the per-node draw dispatch (where each dirty node's paint rect is computed — find with `grep -n "ui_node_paint_rect\|ui_subtree_current_paint_rect" runtime-header.ts`), call `ui_refresh_add_rect(...)` after drawing each dirty node (guarded — it's a no-op macro on TFT). At the end of `ui_tick`'s draw pass (the flush point), call `ui_refresh_flush()`.

- [ ] **Step 5: Build + run + commit**

```sh
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish/refresh-scheduler.test.ts tests/packages/cuttlefish/runtime-header.test.ts
git add packages/cuttlefish/src/ui/runtime-header.ts tests/packages/cuttlefish/refresh-scheduler.test.ts
git commit -m "feat(runtime): e-ink dirty-rect refresh union + backing-store-gated refresh scheduler (TFT compiles out)"
```

---

## Task 4: Register the eink-mono shim (SSD1680-class)

**Files:**
- Create: `packages/cuttlefish/src/api/shared/display-adapters/eink-mono.ts`
- Modify: `packages/cuttlefish/src/api/shared/display-adapter.ts`
- Modify: `packages/framework-arduino/src/strategy.ts`
- Test: `tests/packages/cuttlefish/eink-shim.test.ts`

The shim provides the deferred-refresh `display_*` entry points the runtime now calls: `display_partial_refresh(x,y,w,h)`, a 1-bit backing store, and no `display_fillScreen` flash on init.

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/eink-shim.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateDisplayAdapter } from "../../../packages/cuttlefish/src/api/shared/display-adapter";
import type { ResolvedDisplay } from "../../../packages/cuttlefish/src/ui/display-profile-store";

describe("eink-mono (SSD1680-class) adapter", () => {
  const profile = {
    driver: "ssd1680", width: 296, height: 128, rotation: 1,
    colorFormat: "mono", displayClass: "eink",
    _mountCs: 5, _mountDc: 21, _mountRst: 22, _mountBus: "SPI",
  } as ResolvedDisplay;

  it("is registered for driver 'ssd1680'", () => {
    expect(() => generateDisplayAdapter(profile)).not.toThrow();
  });

  it("emits a partial-refresh entry point", () => {
    const gen = generateDisplayAdapter(profile);
    expect(gen.functions).toMatch(/display_partial_refresh\(/);
  });

  it("init does NOT call fillScreen (no flash)", () => {
    const gen = generateDisplayAdapter(profile);
    expect(gen.functions).not.toMatch(/fillScreen/);
  });

  it("targets an e-ink library (EPD/EPaper)", () => {
    const gen = generateDisplayAdapter(profile);
    expect(gen.includes).toMatch(/EPD|EPaper|epaper|GxEPD/i);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/packages/cuttlefish/eink-shim.test.ts`
Expected: FAIL — `ssd1680` not registered.

- [ ] **Step 3: Create the eink-mono adapter**

Create `packages/cuttlefish/src/api/shared/display-adapters/eink-mono.ts`. Targets the Adafruit EPD library (or GxEPD) `Adafruit_SSD168x`-class. The shim owns a 1-bit backing store and exposes `display_partial_refresh`:

```ts
import type { DisplayAdapterGenerator } from "../display-adapter.js";

export const einkMonoAdapter: DisplayAdapterGenerator = (display) => {
  const cs = display._mountCs;
  const dc = display._mountDc;
  const rst = display._mountRst;
  const bus = display._mountBus;
  const rotation = display.rotation ?? 0;
  const w = display.width;
  const h = display.height;

  return {
    includes: [
      "#include <Adafruit_GFX.h>",
      "#include <Adafruit_EPD.h>",
    ].join("\n"),
    declaration: `Adafruit_SSD168x __tc_display(${w}, ${h}, ${dc}, ${rst}, ${cs}, -1 /* busy */);`,
    functions: [
      "// --- Display adapter: eink-mono (SSD1680-class, 1-bit, deferred refresh) ---",
      "static inline void display_init() {",
      "  __tc_display.begin();",
      `  __tc_display.setRotation(${rotation});`,
      "  // No fillScreen here — e-ink flashes on full clear. The runtime marks all",
      "  // nodes dirty and the first flush repaints via partial refresh.",
      "}",
      "",
      "static inline CuttlefishDisplayTarget* display_defaultTarget() { return &__tc_display; }",
      "static inline int16_t display_width() { return __tc_display.width(); }",
      "static inline int16_t display_height() { return __tc_display.height(); }",
      "static inline void display_startWrite() {}",
      "static inline void display_endWrite() {}",
      "static inline void display_setAddrWindow(int16_t x, int16_t y, int16_t w, int16_t h) { (void)x; (void)y; (void)w; (void)h; }",
      // 1-bit draw: GFX draws into the EPD's built-in buffer; partial refresh
      // pushes just the dirty region.
      "static inline void display_partial_refresh(int16_t x, int16_t y, int16_t w, int16_t h) {",
      "  __tc_display.refreshPartial(x, y, (uint16_t)w, (uint16_t)h);  // TODO Phase 5: verify EPD partial-refresh API for the target lib",
      "}",
      "static inline void display_fillScreen(uint32_t color) { __tc_display.fillScreen(color ? EPD_WHITE : EPD_BLACK); }",
    ].join("\n"),
  };
};
```

**Note:** the exact EPD partial-refresh method (`refreshPartial` vs `partialUpdate` vs `drawPixel`+`display()`) depends on the library (Adafruit_EPD vs GxEPD). Flag as a verification step — the adapter shape is correct; the method name is library-specific.

- [ ] **Step 4: Register the adapter + driver**

In `packages/cuttlefish/src/api/shared/display-adapter.ts`, alongside the ST7796S registration:
```ts
import { einkMonoAdapter } from "./display-adapters/eink-mono.js";
registerDisplayAdapter("ssd1680", einkMonoAdapter);
```

In `packages/framework-arduino/src/strategy.ts`:
```ts
  supportedDisplayDrivers(): ReadonlySet<string> {
    return new Set(["ili9341", "st7796", "ssd1680"]);
  }
```

- [ ] **Step 5: Run + commit**

```sh
npm run build --workspace @typecad/cuttlefish
npm run build --workspace @typecad/framework-arduino
npx vitest run tests/packages/cuttlefish/eink-shim.test.ts
git add packages/cuttlefish/src/api/shared/display-adapters/eink-mono.ts packages/cuttlefish/src/api/shared/display-adapter.ts packages/framework-arduino/src/strategy.ts tests/packages/cuttlefish/eink-shim.test.ts
git commit -m "feat(adapter): register eink-mono shim (SSD1680-class, 1-bit, partial refresh, no init flash)"
```

---

## Task 5: Preview parity — e-ink simulation (no-flash, mono snap)

**Files:**
- Modify: `packages/cuttlefish/src/preview/host-ui-runtime.ts`

The preview must match the device for e-ink: snap colors to mono, and (at minimum) not simulate the flash. Full refresh-latency/ghosting simulation is Phase 5 polish; Phase 4 makes the preview produce correct mono output for an e-ink profile so authors see what the panel shows.

- [ ] **Step 1: Snap preview draw colors to mono when colorFormat is mono**

In `packages/cuttlefish/src/preview/host-ui-runtime.ts`, the draw dispatch reads `this.snapshot.program.colorFormat`. When it's `"mono"`, snap each fill/text color to black/white by luminance before drawing. Add a helper:

```ts
private snapMono(c: number): number {
  if (this.snapshot.program.colorFormat !== "mono") return c;
  const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) >= 0.27 * 255 ? 0xffffff : 0x000000;
}
```

Apply `this.snapMono(...)` to the fill/text color arguments at the draw sites (mirror where `UI_MAYBE_SNAP_MONO` applies in the runtime). Preview already disables AA for mono (Phase 2).

- [ ] **Step 2: Add a mono preview parity test**

Add to `tests/packages/cuttlefish/preview-gfx.test.ts` (or a new `preview-mono.test.ts`) a test that builds a minimal mono snapshot and asserts a colored node renders as snapped black/white in the framebuffer. Use the minimal-snapshot builder pattern.

- [ ] **Step 3: Build + run + commit**

```sh
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish/preview-gfx.test.ts
git add packages/cuttlefish/src/preview/host-ui-runtime.ts tests/packages/cuttlefish/preview-gfx.test.ts
git commit -m "feat(preview): snap draw colors to mono for e-ink profiles (parity with runtime UI_NATIVE_MONO)"
```

---

## Task 6: Phase 4 verification & sign-off

- [ ] **Step 1: Clean build (all libraries) + full suite**

```sh
rm -f packages/cuttlefish/*.tsbuildinfo packages/framework-arduino/*.tsbuildinfo
npm run build --workspace @typecad/cuttlefish
npm run build --workspace @typecad/framework-arduino
npx vitest run tests/packages/cuttlefish
```
Expected: 625 baseline + new Phase 4 tests pass; only the 5 known-unrelated failures.

- [ ] **Step 2: ILI9341/immediate byte-identity**

```sh
npm run compile --workspace demo-ui
grep -c "UI_REFRESH_DEFERRED\|UI_NATIVE_MONO\|UI_REQUIRES_BACKING_STORE" demo-ui/src/out/main/main.ino
```
Expected: exit 0; grep returns `0` (all e-ink guards compile out on TFT).

- [ ] **Step 3: Mark Phase 4 complete + note Phase 5 scope**

In `docs/superpowers/specs/2026-07-02-display-agnostic-core-design.md`, update the Phase 4 line noting 1-bit foundation is complete and dither/multi-color/ghost-sim are Phase 5. Commit:
```bash
git add docs/superpowers/specs/2026-07-02-display-agnostic-core-design.md
git commit -m "docs(spec): mark Phase 4 complete — e-ink 1-bit foundation (dither/multi-color deferred to Phase 5)"
```

---

## Self-Review

**1. Spec coverage (Phase 4 of spec §6 + §2.3 + §3.2):**
- §3.2 descriptor-gated clear suppression → Task 2.
- §3.2 refresh scheduler (dirty union + partial refresh) → Task 3.
- §2.3 `eink-mono` shim → Task 4.
- §3.2 backing-store activation → Task 3 (under `UI_REQUIRES_BACKING_STORE`).
- §3.5 preview parity → Task 5.
- ILI9341/immediate byte-identity → Task 2/3 guards compile out; Task 6 Step 2 verifies.

**2. Scope decision (deliberate):** Phase 4 = 1-bit foundation. Dithering (ordered/error-diffusion for apparent grays), multi-color e-ink (BWR/7-color palette + semantic roles), ghost-clearing cadence, and refresh-latency preview simulation are **Phase 5**. This ships real 1-bit hardware support fastest (the cheapest/most-common panels) and the descriptor+scheduler infrastructure is in place to extend. The research doc's "Approach C staged into A."

**3. Phase 1 lesson honored:** Mono snapping happens consistently in both runtime (`UI_MAYBE_SNAP_MONO`) and preview (`snapMono`), and the snap is the *only* color operation for 1-bit (no blending artifacts — black/white is the full space). No depth/blend-math coupling issue for 1-bit.

**4. Risk notes (honest unknowns flagged, not hidden):**
- EPD partial-refresh API name is library-specific (Task 4 Step 3 — flagged TODO).
- Dirty-rect coalescing/ghost-cadence are stubbed (Task 3 Step 3 — flagged TODO Phase 5).
- The backing-store allocation strategy (PSRAM vs SRAM) for e-ink needs a target-board decision; Phase 4 reuses the PSRAM canvas path guarded by `UI_REQUIRES_BACKING_STORE`.

**5. Byte-identity guarantee:** every e-ink addition is behind `#ifdef UI_REFRESH_DEFERRED` / `UI_NATIVE_MONO` / `UI_REQUIRES_BACKING_STORE`, all absent on TFT. The macros compile to no-op stubs on TFT. Task 6 Step 2 verifies via grep.
