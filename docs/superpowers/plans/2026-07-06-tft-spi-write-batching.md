# TFT SPI-write batching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce tearing/flicker on SPI TFT per-frame updates by batching all per-node draws into a single `display_startWrite()`/`display_endWrite()` SPI transaction, reusing the existing deferred-refresh scaffolding (currently e-ink-only).

**Architecture:** The runtime header already has a three-function refresh scaffolding (`ui_refresh_begin_frame` / `ui_refresh_add_rect` / `ui_refresh_flush`) that compiles to no-op stubs on TFT. Add a third compile-time branch — `UI_BATCH_SPI_WRITES` — that turns `begin_frame`/`flush` into `display_startWrite()`/`display_endWrite()`. Adafruit's reference-counted `startWrite`/`endWrite` makes the existing scroll-canvas composite (which also calls those) a nested no-op, so the entire frame shares one CS-asserted SPI burst. The emitter defines `UI_BATCH_SPI_WRITES` for immediate-refresh, non-backing-store targets.

**Tech Stack:** TypeScript (cuttlefish emitter), C++ (Arduino runtime header, Adafruit_SPITFT), ESP32-S3 + ST7796S, vitest.

**Spec:** `docs/superpowers/specs/2026-07-06-tft-spi-write-batching-design.md`

**Repository conventions (from `AGENTS.md`):**
- Build `@typecad/cuttlefish` before any test/compile that imports package exports: `npm run build --workspace @typecad/cuttlefish`.
- Tests in `tests/packages/cuttlefish/*.test.ts`. Run a single file with `npx vitest run tests/packages/cuttlefish/<name>.test.ts`.
- Conventional Commits. Each task commits independently.

---

## File Structure

| File | Responsibility | Touched by |
|---|---|---|
| `packages/cuttlefish/src/ui/runtime-header.ts` | Three-branch refresh dispatch (line 370–418); revert the framebuffer mark-all-dirty block (line ~4210) | Tasks 1, 4 |
| `packages/cuttlefish/src/emit/emitters/ui-emitter.ts` | Emit `#define UI_BATCH_SPI_WRITES 1` for immediate, non-backing-store targets | Task 3 |
| `tests/packages/cuttlefish/runtime-header.test.ts` | TDD tests for the new branch + the existing-unchanged branches | Tasks 1, 2 |

---

## Task 1: Three-branch refresh dispatch with UI_BATCH_SPI_WRITES

Replace the two-branch `#ifndef UI_REQUIRES_BACKING_STORE` refresh dispatch with a three-branch dispatch that adds the TFT batching path. TDD: write the test for the new branch first, watch it fail, then implement.

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts` (lines 370–418)
- Test: `tests/packages/cuttlefish/runtime-header.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

In `tests/packages/cuttlefish/runtime-header.test.ts`, find the existing framebuffer test ("keeps full-screen framebuffer rendering opt-in", around line 147). Add this new test immediately after it:

```typescript
  it("emits a UI_BATCH_SPI_WRITES branch that wraps the frame in startWrite/endWrite", () => {
    // TFT batching path: when UI_BATCH_SPI_WRITES is defined (and neither
    // UI_REQUIRES_BACKING_STORE nor the no-op default applies), begin_frame
    // opens the SPI transaction and flush closes it. add_rect is a no-op
    // (TFT has no partial-refresh concept; the per-node draws already target
    // the right pixels).
    expect(header).toMatch(/#elif\s+defined\(UI_BATCH_SPI_WRITES\)[\s\S]*?ui_refresh_begin_frame\(\)\s*\{\s*display_startWrite\(\);\s*\}/);
    expect(header).toMatch(/#elif\s+defined\(UI_BATCH_SPI_WRITES\)[\s\S]*?ui_refresh_flush\(\)\s*\{\s*display_endWrite\(\);\s*\}/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/runtime-header.test.ts -t "UI_BATCH_SPI_WRITES branch"`
Expected: FAIL — the regex finds no `#elif defined(UI_BATCH_SPI_WRITES)` branch.

- [ ] **Step 3: Replace the two-branch dispatch with the three-branch dispatch**

In `packages/cuttlefish/src/ui/runtime-header.ts`, replace lines 375–418 (the entire `#ifndef UI_REQUIRES_BACKING_STORE` ... `#endif` block) with:

```c
#if defined(UI_REQUIRES_BACKING_STORE)
  // e-ink / deferred-partial: dirty-rect accumulator. Each painted node reports
  // its paint rect; at frame end the union is refreshed as one partial update
  // via display_partial_refresh.
  #define UI_REFRESH_MAX_RECTS 16
  struct UIRect16 { int16_t x, y, w, h; };
  static UIRect16 __ui_refresh_rects[UI_REFRESH_MAX_RECTS];
  static uint8_t __ui_refresh_rect_n = 0;
  static inline void ui_refresh_begin_frame() { __ui_refresh_rect_n = 0; }
  static inline void ui_refresh_add_rect(int16_t x, int16_t y, int16_t w, int16_t h) {
    if (w <= 0 || h <= 0) return;
    if (__ui_refresh_rect_n < UI_REFRESH_MAX_RECTS) {
      __ui_refresh_rects[__ui_refresh_rect_n].x = x;
      __ui_refresh_rects[__ui_refresh_rect_n].y = y;
      __ui_refresh_rects[__ui_refresh_rect_n].w = w;
      __ui_refresh_rects[__ui_refresh_rect_n].h = h;
      __ui_refresh_rect_n++;
    }
    // TODO Phase 5: coalesce overlapping rects into a tighter union; cap by
    // refresh budget; trigger a periodic full refresh for ghost clearing.
  }
  // Union all accumulated rects and issue one partial refresh of the bounding
  // region via the shim's display_partial_refresh entry point.
  static inline void ui_refresh_flush() {
    if (__ui_refresh_rect_n == 0) return;
    int16_t x0 = 32767, y0 = 32767, x1 = -32768, y1 = -32768;
    for (uint8_t i = 0; i < __ui_refresh_rect_n; i++) {
      const UIRect16& r = __ui_refresh_rects[i];
      if (r.x < x0) x0 = r.x;
      if (r.y < y0) y0 = r.y;
      int16_t rx1 = (int16_t)(r.x + r.w), ry1 = (int16_t)(r.y + r.h);
      if (rx1 > x1) x1 = rx1;
      if (ry1 > y1) y1 = ry1;
    }
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > display_width()) x1 = display_width();
    if (y1 > display_height()) y1 = display_height();
    if (x1 > x0 && y1 > y0) {
      display_partial_refresh(x0, y0, (int16_t)(x1 - x0), (int16_t)(y1 - y0));
    }
  }
#elif defined(UI_BATCH_SPI_WRITES)
  // TFT immediate-refresh: wrap the frame's draws in ONE SPI transaction so all
  // per-node fillRect/text/canvas-composite writes share a single CS-asserted
  // burst. Adafruit_SPITFT's startWrite/endWrite are reference-counted, so the
  // scroll-canvas composite (which also calls them) becomes a nested no-op for
  // transaction lifecycle — the actual SPI close happens once at frame end.
  // add_rect is a no-op here: TFT has no partial-refresh concept; the per-node
  // draws already target the right pixels.
  static inline void ui_refresh_begin_frame() { display_startWrite(); }
  static inline void ui_refresh_add_rect(int16_t x, int16_t y, int16_t w, int16_t h) { (void)x; (void)y; (void)w; (void)h; }
  static inline void ui_refresh_flush() { display_endWrite(); }
#else
  // No batching (e.g. SDL native host render): true no-ops.
  #define ui_refresh_begin_frame()  ((void)0)
  #define ui_refresh_add_rect(x, y, w, h) ((void)0)
  #define ui_refresh_flush()        ((void)0)
#endif
```

Also update the section header comment above the block (line 370–374) to reflect the three branches:

```c
// ── Per-frame refresh dispatch ──────────────────────────────────────────────
// Three mutually-exclusive compile-time paths, in priority order:
//   1. UI_REQUIRES_BACKING_STORE (e-ink): dirty-rect accumulator + partial refresh.
//   2. UI_BATCH_SPI_WRITES (TFT immediate): one startWrite/endWrite per frame.
//   3. default (SDL native host): no-ops.
// Exactly one branch ever compiles — the emitter's guards ensure the first two
// are never both defined (UI_REQUIRES_BACKING_STORE ⟹ requiresBackingStore,
// UI_BATCH_SPI_WRITES ⟹ immediate && !requiresBackingStore).
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/runtime-header.test.ts -t "UI_BATCH_SPI_WRITES branch"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/typecad/typecode && git add packages/cuttlefish/src/ui/runtime-header.ts tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(cuttlefish): three-branch refresh dispatch + UI_BATCH_SPI_WRITES

Add a TFT batching branch to the existing refresh scaffolding: when
UI_BATCH_SPI_WRITES is defined, begin_frame opens an SPI transaction
(display_startWrite) and flush closes it (display_endWrite), so all
per-node draws in the frame share one CS-asserted burst. Adafruit's
reference-counted startWrite/endWrite makes the scroll-canvas composite
a nested no-op.

Replaces the two-branch #ifndef UI_REQUIRES_BACKING_STORE dispatch with
a three-branch #if/#elif/#else. The e-ink and default branches are
byte-identical to before."
```

---

## Task 2: Regression test — e-ink and default branches unchanged

Guard against accidentally altering the e-ink accumulator or the default no-op stubs while reorganizing the dispatch.

**Files:**
- Test: `tests/packages/cuttlefish/runtime-header.test.ts` (extend)

- [ ] **Step 1: Add the regression tests**

In `tests/packages/cuttlefish/runtime-header.test.ts`, immediately after the test added in Task 1, add:

```typescript
  it("e-ink UI_REQUIRES_BACKING_STORE branch is unchanged (rect accumulator + partial refresh)", () => {
    // The e-ink branch must still define the rect accumulator, the add_rect
    // recording, and the union+display_partial_refresh flush — byte-identical
    // to before the three-branch reorganization.
    expect(header).toMatch(/#if\s+defined\(UI_REQUIRES_BACKING_STORE\)[\s\S]*?UI_REFRESH_MAX_RECTS\s+16/);
    expect(header).toMatch(/ui_refresh_begin_frame\(\)\s*\{\s*__ui_refresh_rect_n\s*=\s*0;\s*\}/);
    expect(header).toMatch(/display_partial_refresh\(x0,\s*y0/);
  });

  it("default branch (no flags) keeps the no-op stubs", () => {
    // When neither UI_REQUIRES_BACKING_STORE nor UI_BATCH_SPI_WRITES is defined,
    // all three must be no-op macros (the SDL native host path).
    expect(header).toMatch(/#else[\s\S]*?#define\s+ui_refresh_begin_frame\(\)\s+\(\(void\)0\)/);
    expect(header).toMatch(/#define\s+ui_refresh_flush\(\)\s+\(\(void\)0\)/);
  });
```

- [ ] **Step 2: Run the tests — they should already pass (Task 1 preserved the branches)**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/runtime-header.test.ts -t "e-ink UI_REQUIRES_BACKING_STORE branch|default branch"`
Expected: PASS (both). If either fails, Task 1 altered the existing branches — fix the regression before continuing.

- [ ] **Step 3: Run the full runtime-header suite for regressions**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: PASS (all tests, including the 119 pre-existing + the new ones).

- [ ] **Step 4: Commit**

```bash
cd C:/typecad/typecode && git add tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "test(cuttlefish): guard e-ink + default refresh branches

Regression tests asserting the UI_REQUIRES_BACKING_STORE rect-accumulator
branch and the default no-op-stub branch are byte-identical after the
three-branch reorganization."
```

---

## Task 3: Emit UI_BATCH_SPI_WRITES for immediate, non-backing-store targets

Wire the new flag into the emitter so TFT panels (ST7796S, ILI9341, etc.) get batching by default. E-ink (deferred-partial + backing store) and SDL native (no batching) are unaffected.

**Files:**
- Modify: `packages/cuttlefish/src/emit/emitters/ui-emitter.ts` (around line 278)
- Test: `tests/packages/cuttlefish/runtime-header.test.ts` (extend — assert the emitter's responsibility indirectly via the header, since the emitter is covered by capability-derivation tests elsewhere)

- [ ] **Step 1: Write a failing test for the emission**

In `tests/packages/cuttlefish/runtime-header.test.ts`, add:

```typescript
  it("emitter defines UI_BATCH_SPI_WRITES for immediate, non-backing-store targets", () => {
    // The emitter (ui-emitter.ts) must emit #define UI_BATCH_SPI_WRITES 1 for
    // TFT/immediate-refresh targets that don't require a backing store. The
    // header's refresh-dispatch test (Task 1) covers the branch consuming it;
    // this test covers the emission itself by checking the runtime header
    // carries the define in its capability-forwarding block.
    //
    // The default emitRuntimeHeader() profile is ili9341-spi (immediate, no
    // backing store), so the define must appear in the unmodified header.
    expect(header).toMatch(/#define\s+UI_BATCH_SPI_WRITES\s+1/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/runtime-header.test.ts -t "UI_BATCH_SPI_WRITES for immediate"`
Expected: FAIL — the define is not yet emitted.

- [ ] **Step 3: Add the emission**

In `packages/cuttlefish/src/emit/emitters/ui-emitter.ts`, find the capability-forwarding block (around line 272–280):

```typescript
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

Add immediately after the `requiresBackingStore` block:

```typescript
  // TFT immediate-refresh batching: wrap the frame's draws in one SPI
  // transaction (startWrite/endWrite) so per-node writes don't tear. Gated on
  // immediate && !requiresBackingStore so e-ink (deferred-partial + backing
  // store) keeps its partial-refresh path and SDL native (immediate but no SPI)
  // stays on the no-op default. Mutually exclusive with UI_REQUIRES_BACKING_STORE
  // by construction — the emitter never defines both.
  if (caps.refreshModel === "immediate" && !caps.requiresBackingStore) {
    ctx.sourceLines.push("#define UI_BATCH_SPI_WRITES 1");
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/runtime-header.test.ts -t "UI_BATCH_SPI_WRITES for immediate"`
Expected: PASS.

- [ ] **Step 5: Run the full runtime-header suite + capability/emitter tests**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/runtime-header.test.ts tests/packages/cuttlefish/display-capabilities.test.ts`
Expected: PASS (all). If a capability test asserts the exact set of emitted defines, update its expectation to include `UI_BATCH_SPI_WRITES` for the immediate path — that's the intended new behavior, not a regression.

- [ ] **Step 6: Commit**

```bash
cd C:/typecad/typecode && git add packages/cuttlefish/src/emit/emitters/ui-emitter.ts tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(cuttlefish): emit UI_BATCH_SPI_WRITES for TFT immediate-refresh

Enable per-frame SPI-write batching on TFT panels (ST7796S, ILI9341, etc.)
by emitting #define UI_BATCH_SPI_WRITES 1 when refreshModel is 'immediate'
and the target doesn't require a backing store. E-ink and SDL native are
unaffected (they take the existing partial-refresh / no-op branches)."
```

---

## Task 4: Revert the framebuffer mark-all-dirty block

The framebuffer mark-all-dirty block (added during the framebuffer investigation) was a workaround for the framebuffer's "repaint everything" model. With batching as the recommended tearing fix and the framebuffer documented as scroll-incompatible (out of scope per the spec), revert it so the framebuffer code path returns to its pre-investigation state — the dirty-node draw loop stays the single source of truth for what gets drawn.

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts` (lines ~4192–4216)

- [ ] **Step 1: Read the current framebuffer block**

Run: `cd C:/typecad/typecode && sed -n '4192,4220p' packages/cuttlefish/src/ui/runtime-header.ts`

Confirm the block looks like:
```c
  if (__ui_fb) {
    // Seed the framebuffer with the active screen's background ...
    uint16_t fbBg = 0x0000;
    for (uint16_t s = 0; s < __ui_node_count; s++) { ... }
    display_canvasFillScreen(__ui_fb, fbBg);
    // The framebuffer is re-seeded ... Mark all visible nodes dirty ...
    for (uint16_t f = 0; f < __ui_node_count; f++) {
      if (__ui_nodes[f].screenId == __ui_active_screen &&
          ui_is_effectively_visible(f)) {
        __ui_nodes[f].dirty = 1;
      }
    }
  }
```

- [ ] **Step 2: Remove the mark-all-dirty loop**

In `packages/cuttlefish/src/ui/runtime-header.ts`, find the block above and remove the mark-all-dirty loop + its comment, keeping only the framebuffer seed-fill. The block should become:

```c
  if (__ui_fb) {
    // Seed the framebuffer with the active screen's background so cleared/
    // transparent regions resolve correctly, then draw dirty nodes on top.
    uint16_t fbBg = 0x0000;
    for (uint16_t s = 0; s < __ui_node_count; s++) {
      if (__ui_nodes[s].screenId == __ui_active_screen && __ui_nodes[s].kind == NODE_FILL) {
        fbBg = __ui_nodes[s].hasBg ? __ui_nodes[s].bg : __ui_nodes[s].clearColor;
        break;
      }
    }
    display_canvasFillScreen(__ui_fb, fbBg);
  }
```

(Only the mark-all-dirty `for` loop and its preceding comment are removed. The seed-fill `for` loop above it stays.)

- [ ] **Step 3: Update the framebuffer-mode test to match the revert**

The Task 1 test from the *previous* (framebuffer) plan asserted the mark-all-dirty block exists. That test ("framebuffer mode repaints every visible node, not only dirty ones") now needs updating since the block is intentionally reverted. Find it in `tests/packages/cuttlefish/runtime-header.test.ts` and replace its body with:

```typescript
  it("framebuffer mode seeds the canvas background (mark-all-dirty reverted)", () => {
    // The framebuffer mark-all-dirty block was a workaround for the
    // framebuffer's 'repaint everything' model that broke the dirty-gated
    // scroll-canvas composite. It is reverted: the framebuffer seeds the
    // background and draws only dirty nodes (the same model as direct-draw).
    // The framebuffer + scroll composition is tracked as a separate effort;
    // SPI-write batching (UI_BATCH_SPI_WRITES) is the recommended tearing fix.
    const fbBlock = header.match(/if\s*\(__ui_fb\)\s*\{[\s\S]*?display_canvasFillScreen\(__ui_fb, fbBg\);[\s\S]*?\}/)?.[0] ?? "";
    expect(fbBlock).not.toBe("");
    // The mark-all-dirty loop must NOT be present.
    expect(fbBlock).not.toMatch(/for\s*\(\s*uint16_t\s+f\s*=\s*0[\s\S]*?__ui_nodes\[f\]\.dirty\s*=\s*1/);
  });
```

- [ ] **Step 4: Run the runtime-header suite**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: PASS (all). The updated test confirms the revert; the rest are unaffected.

- [ ] **Step 5: Commit**

```bash
cd C:/typecad/typecode && git add packages/cuttlefish/src/ui/runtime-header.ts tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "revert(cuttlefish): remove framebuffer mark-all-dirty workaround

The mark-all-dirty block forced every visible node dirty each framebuffer
frame. It was a workaround for the framebuffer's 'repaint everything'
model, but it broke the dirty-gated scroll-canvas composite (the third
bug in the framebuffer+scroll investigation). Revert it: the framebuffer
returns to drawing only dirty nodes over its background seed.

The framebuffer + scroll composition is tracked as a separate future
effort. SPI-write batching (UI_BATCH_SPI_WRITES) is the recommended
tearing fix and composes with scroll naturally."
```

---

## Task 5: Build, compile, and verify demo-st end-to-end

Confirm the whole change builds clean, the demo-st scroll showcase still compiles, and the new flag appears in the generated `.ino`.

**Files:** none modified.

- [ ] **Step 1: Build cuttlefish**

Run: `cd C:/typecad/typecode && npm run build --workspace @typecad/cuttlefish`
Expected: clean `tsc` compile, no errors.

- [ ] **Step 2: Confirm UI_BATCH_SPI_WRITES is in the generated ino**

Run: `cd C:/typecad/typecode/demo-st && npm run compile 2>&1 | tail -5`
Expected: clean compile. Then:

Run: `cd C:/typecad/typecode && grep "UI_BATCH_SPI_WRITES" demo-st/src/out/showcase/showcase.ino`
Expected: a line `#define UI_BATCH_SPI_WRITES 1`.

- [ ] **Step 3: Confirm the dispatch landed in the ino correctly**

Run: `cd C:/typecad/typecode && grep -A1 "elif defined(UI_BATCH_SPI_WRITES)" demo-st/src/out/showcase/showcase.ino`
Expected: the branch is present, with `display_startWrite()` in `begin_frame` and `display_endWrite()` in `flush`.

- [ ] **Step 4: Confirm UI_REQUIRES_BACKING_STORE is NOT defined for TFT**

Run: `cd C:/typecad/typecode && grep -c "define UI_REQUIRES_BACKING_STORE 1" demo-st/src/out/showcase/showcase.ino`
Expected: `0` (TFT is immediate, no backing store — only `UI_BATCH_SPI_WRITES` should be defined).

- [ ] **Step 5: Confirm the framebuffer define is OFF in demo-st config**

Run: `cd C:/typecad/typecode && grep "UI_USE_FULL_FRAMEBUFFER" demo-st/cuttlefish.config.ts`
Expected: `defines: { UI_USE_FULL_FRAMEBUFFER: '0' },` (already reverted in a prior step; if it shows `'1'`, change it back to `'0'` — the framebuffer is out of scope).

No commit — this is verification only.

---

## Final verification

After all tasks land:

- [ ] **Run the full cuttlefish test suite**

Run: `cd C:/typecad/typecode && npm run build --workspace @typecad/cuttlefish && npx vitest run tests/packages/cuttlefish/`
Expected: all green. Pre-existing failures unrelated to this plan (the `native-demo-sdl-emit` ones from the interleaved render-parity work) may persist — they're not caused by this change. Any NEW failure must be resolved.

- [ ] **Recap the commit history**

Run: `cd C:/typecad/typecode && git log --oneline -6`
Expected: 4 new commits (one per task) atop the spec commit.

- [ ] **Hand off to hardware verification (you flash)**

The agent's work ends here. Flash demo-st (scroll showcase) on the S3+PSRAM and confirm:
1. Scrolling still smooth (no regression — the dirty/scroll model is untouched).
2. Reduced tearing/flicker on binding/press updates (the batching's purpose).
3. No flashing (the framebuffer's per-frame full repaint is gone).

If any of these fail on hardware, report which and the agent will investigate.

Done. Tearing on TFT updates is reduced via per-frame SPI batching, the scroll path is untouched, and the framebuffer is left as documented scroll-incompatible.
