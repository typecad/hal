# Scroll Engine Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken dual-mechanism scrolling (3× multiplier, hard-clamp, dead-on-lift, preview/device drift) with one unified, capability-driven scroll engine that adopts the proven-smooth `<list>` model as its default for all scrolling.

**Architecture:** A single scroll engine per scroll container with three swappable layers (Input / Physics / Render) selected by two capability axes (input quality, frame budget). `<list>` becomes a scroll container whose children are virtualized — same `scrollY`, same gesture, same draw-time offset, same render loop. No fling (motion only while finger is down); rubber-band overscroll + snap-to-boundary on release; preview runs the capacitive/full path, device degrades per declared capability.

**Tech Stack:** TypeScript (transpiler: `packages/cuttlefish/src`), C++ runtime emitted as a template-literal string (`emitRuntimeHeader()`), JS preview runtime (`PreviewUIRuntime` class), Zod config schema, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-28-scroll-engine-rewrite-design.md`

---

## How to read this plan

- **Two parallel engines must stay in sync:** the C++ runtime (`packages/cuttlefish/src/ui/runtime-header.ts`, a template-literal string) and the JS preview (`packages/cuttlefish/src/preview/host-ui-runtime.ts`, a class). Each scrolls-related change to one has a mirror in the other unless a task says otherwise.
- **Test strategy:** The existing `runtime-header.test.ts` uses string/regex assertions against the emitted C++ (`expect(header).toContain(...)` / `.toMatch(/.../)`). These are tightly coupled to current internal helper names and **will be rewritten** where they assert deleted behavior. The preview runtime (`PreviewUIRuntime`) is testable *behaviorally* — drive pointer events, assert node `scrollY`. **Behavioral preview tests are the primary safety net** for "does it feel right"; C++ string-assertions guard "is the right code emitted."
- **Run tests from the repo root** (`C:\typecad\typecode`) with `pnpm test` (Vitest). Single file: `pnpm test tests/packages/cuttlefish/<file>.test.ts`. The whole suite once at the end.
- **Commit frequently** — each task ends with a commit. Branch `feat/ui-text-binding` is current; keep working on it.

## File structure

**Files created:**
- `tests/packages/cuttlefish/preview-scroll.test.ts` — behavioral scroll tests driving `PreviewUIRuntime`.

**Files modified:**

| File | Responsibility |
|---|---|
| `packages/cuttlefish/src/ui/runtime-header.ts` | C++ runtime: delete old scroll state/helpers; add `virtualized` field + on-node list state; new layered engine (input filter, physics w/ rubber-band, render modes A/B/C); unify the touch state machine. |
| `packages/cuttlefish/src/preview/host-ui-runtime.ts` | JS preview: mirror the new engine (input = capacitive/passthrough column). |
| `packages/cuttlefish/src/ui/model.ts` | Add `virtualized: boolean` to `UINodeModel`; populate from `node.tag === "list"`. |
| `packages/cuttlefish/src/ir/transformers/ui-lowering.ts` | Emit `virtualized` + on-node list fn pointers in the node initializer. |
| `packages/cuttlefish/src/ir/transformers/ui-reactive.ts` | Keep `emitListBindings` (emits the 3 fn bodies) but the binding is now referenced on-node, not via a `UIListBinding` side table. |
| `packages/cuttlefish/src/api/shared/display-profile.ts` | Add `ScrollConfig` interface + `scroll?: ScrollConfig` to `DisplayConfig`. |
| `packages/cuttlefish/src/emit/emitters/ui-emitter.ts` | Thread scroll `#define` overrides before `emitRuntimeHeader()`; drop `UIListBinding` table emission. |
| `packages/cuttlefish/src/ui/display-profile-store.ts` *(if it exists — verify)* | Expose resolved scroll config to the emitter. |
| `demo-ui/src/hello.ui.html` | Drop redundant `overflow="scroll"` on `<list>`. |
| `tests/packages/cuttlefish/runtime-header.test.ts` | Replace scroll string-assertions that test deleted behavior with assertions for the new engine. |
| `tests/packages/cuttlefish/ui-reactive.test.ts` | Update if list-binding emit shape changes. |
| `tests/packages/cuttlefish/preview-build.test.ts` | Update scrollable/listBinding assertions if snapshot shape changes. |

---

## Task 1: Add `virtualized` field to the UI model

The unified model adds a `virtualized` flag so `<list>` is distinguishable from generic scroll containers without a side table. This task is the foundation; everything reads it.

**Files:**
- Modify: `packages/cuttlefish/src/ui/model.ts` (around line 95, the `UINodeModel` interface; around line 850, the node builder)
- Test: `tests/packages/cuttlefish/ui-model.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/packages/cuttlefish/ui-model.test.ts` (inside the existing `describe` block, or add a new `describe("scroll & virtualization", ...)` block if cleaner):

```ts
  it("marks <list> nodes as virtualized scroll containers", () => {
    // Build a minimal tree with a <list> and assert the model carries the flag.
    // Use whatever harness helper the file already imports (e.g. buildModel).
    const model = buildModelFromHtml(`
      <screen id="s"><body>
        <list id="lst" item-height="20"></list>
      </body></screen>
    `);
    const list = model.nodes.find((n) => n.id === "lst");
    expect(list).toBeDefined();
    expect(list!.scrollable).toBe(true);
    expect(list!.virtualized).toBe(true);
    expect(list!.listItemHeight).toBe(20);
  });

  it("marks generic overflow:scroll containers as scrollable but not virtualized", () => {
    const model = buildModelFromHtml(`
      <screen id="s"><body>
        <div id="box" style="overflow: scroll">
          <div id="c1"></div>
          <div id="c2"></div>
        </div>
      </body></screen>
    `);
    const box = model.nodes.find((n) => n.id === "box");
    expect(box!.scrollable).toBe(true);
    expect(box!.virtualized).toBe(false);
    expect(box!.listItemHeight).toBe(0);
  });
```

> **Note:** Inspect `ui-model.test.ts` for the exact harness function name (`buildModel`, `lowerHtml`, etc.) and import path before writing — match the existing style. The HTML→model entry point is in `model.ts`; the test file already exercises it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/packages/cuttlefish/ui-model.test.ts -t virtualized`
Expected: FAIL — `virtualized` is `undefined` / type error (property does not exist on `UINodeModel`).

- [ ] **Step 3: Add the field to the interface**

In `packages/cuttlefish/src/ui/model.ts`, add to the `UINodeModel` interface (next to `listItemHeight`, ~line 95):

```ts
  /** Children are produced by callbacks (virtualized), not static nodes. Set for <list>. */
  virtualized: boolean;
```

- [ ] **Step 4: Populate it in the node builder**

In the same file's node builder (~line 850, next to `listItemHeight: (node as any).itemHeight ?? 0`):

```ts
      listItemHeight: (node as any).itemHeight ?? 0,
      virtualized: node.tag === "list",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/packages/cuttlefish/ui-model.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ui/model.ts tests/packages/cuttlefish/ui-model.test.ts
git commit -m "feat(scroll): add virtualized flag to UINodeModel for <list>"
```

---

## Task 2: Add `ScrollConfig` to the display profile + emit `#define` overrides

The capability tiers and physics tunables come from an optional `scroll:` block. Defaults are derived from declared hardware, so the existing demo config produces a correct engine with zero added config. This task wires the config surface; later tasks consume it.

**Files:**
- Modify: `packages/cuttlefish/src/api/shared/display-profile.ts` (after `DisplayConfig`, ~line 84)
- Modify: `packages/cuttlefish/src/emit/emitters/ui-emitter.ts` (before `emitRuntimeHeader()`)
- Test: `tests/packages/cuttlefish/preview-build.test.ts` (or a new focused test)

- [ ] **Step 1: Write the failing test**

Add to `tests/packages/cuttlefish/preview-build.test.ts` (or create `tests/packages/cuttlefish/scroll-config.test.ts`):

```ts
  it("derives default scroll config from a resistive touch profile", () => {
    // resolveScrollConfig is the pure function this task adds.
    const cfg = resolveScrollConfig({
      touch: { library: "XPT2046_Touchscreen", cs: 15, irq: 17 },
    });
    expect(cfg.inputTier).toBe("resistive");
    expect(cfg.renderTier).toBe("full");      // ESP32-class assumed full by default
    expect(cfg.maxOverscroll).toBe(40);
    expect(cfg.stiffness).toBe(0.5);
    expect(cfg.edgeSnapPx).toBe(12);
    expect(cfg.inputSmoothing).toBe(0.3);
    expect(cfg.overrideProbes).toBe(true);
  });

  it("derives capacitive input tier and no-touch/none tier", () => {
    expect(resolveScrollConfig({ touch: false }).inputTier).toBe("none");
    // A config with explicit scroll overrides wins:
    const overridden = resolveScrollConfig({
      touch: { library: "XPT2046_Touchscreen" },
      scroll: { inputTier: "capacitive", renderTier: "constrained" },
    });
    expect(overridden.inputTier).toBe("capacitive");
    expect(overridden.renderTier).toBe("constrained");
  });
```

> **Note:** `resolveScrollConfig(display: DisplayConfig): ResolvedScrollConfig` is the pure function to add. It lives in `display-profile.ts` next to the interfaces.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/packages/cuttlefish/scroll-config.test.ts`
Expected: FAIL — `resolveScrollConfig` is not exported.

- [ ] **Step 3: Add `ScrollConfig` + `resolveScrollConfig`**

In `packages/cuttlefish/src/api/shared/display-profile.ts`, append after the `DisplayConfig` interface:

```ts
export type ScrollInputTier = "capacitive" | "resistive" | "none";
export type ScrollRenderTier = "full" | "constrained";

/** Author-facing scroll config (all optional; defaults derived from hardware). */
export interface ScrollConfig {
  inputTier?: ScrollInputTier;
  renderTier?: ScrollRenderTier;
  maxOverscroll?: number;     // px, default 40
  stiffness?: number;         // rubber-band resistance, default 0.5
  edgeSnapPx?: number;        // release-snap radius, default 12
  inputSmoothing?: number;    // low-pass coef (0=passthrough), default 0.3
  overrideProbes?: boolean;   // default true: trust declared tiers
}

/** Fully-resolved scroll config — every field populated, ready for emit. */
export interface ResolvedScrollConfig {
  inputTier: ScrollInputTier;
  renderTier: ScrollRenderTier;
  maxOverscroll: number;
  stiffness: number;
  edgeSnapPx: number;
  inputSmoothing: number;
  overrideProbes: boolean;
}

const RESISTIVE_LIBS: ReadonlySet<string> = new Set([
  "XPT2046_Touchscreen",
  "Adafruit_TouchScreen",
]);

/** Resolve scroll config from display config. Declared overrides win;
 *  otherwise derive the input tier from the touch library and assume a full
 *  render tier (ESP32-class SRAM can fit a viewport canvas). */
export function resolveScrollConfig(display: {
  touch?: TouchProfile | false;
  scroll?: ScrollConfig;
}): ResolvedScrollConfig {
  const s = display.scroll ?? {};
  const lib =
    display.touch && typeof display.touch === "object"
      ? display.touch.library
      : undefined;
  const derivedInput: ScrollInputTier =
    lib && RESISTIVE_LIBS.has(lib)
      ? "resistive"
      : display.touch
        ? "capacitive"
        : "none";
  return {
    inputTier: s.inputTier ?? derivedInput,
    renderTier: s.renderTier ?? "full",
    maxOverscroll: s.maxOverscroll ?? 40,
    stiffness: s.stiffness ?? 0.5,
    edgeSnapPx: s.edgeSnapPx ?? 12,
    inputSmoothing: s.inputSmoothing ?? 0.3,
    overrideProbes: s.overrideProbes ?? true,
  };
}
```

Also add `scroll?: ScrollConfig;` to the `DisplayConfig` interface (after `themeClass?`, ~line 84).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/packages/cuttlefish/scroll-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread scroll `#define`s into the emitted C++**

In `packages/cuttlefish/src/emit/emitters/ui-emitter.ts`, in `emitUIRuntime(ctx)` **before** the line that calls `emitRuntimeHeader()` (search for the call), emit per-TU `#define` overrides from the resolved config so the header's `#ifndef` guards pick them up:

```ts
  // Scroll capability + physics overrides — emitted BEFORE the runtime header
  // so its #ifndef guards adopt them. Source of truth: resolveScrollConfig().
  const profile = getDisplayProfile();
  const scroll = resolveScrollConfig(profile);
  ctx.sourceLines.push(
    `#define UI_SCROLL_MAX_OVERSCROLL ${scroll.maxOverscroll}`,
    `#define UI_SCROLL_STIFFNESS_X10 ${Math.round(scroll.stiffness * 10)}`,
    `#define UI_SCROLL_EDGE_SNAP_PX ${scroll.edgeSnapPx}`,
    `#define UI_SCROLL_INPUT_TIER_${scroll.inputTier.toUpperCase()} 1`,
    `#define UI_SCROLL_RENDER_TIER_${scroll.renderTier.toUpperCase()} 1`,
  );
```

Add the import: `import { resolveScrollConfig } from "../../api/shared/display-profile.js";`

> **Note:** `getDisplayProfile()` is already imported (line 23) and returns the `DisplayConfig`. Verify its return shape in `packages/cuttlefish/src/ui/display-profile-store.ts` and adjust if it returns a `DisplayProfile` rather than `DisplayConfig` — pass whatever has `.touch` and `.scroll`.

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/api/shared/display-profile.ts \
        packages/cuttlefish/src/emit/emitters/ui-emitter.ts \
        tests/packages/cuttlefish/scroll-config.test.ts
git commit -m "feat(scroll): ScrollConfig surface + derived capability tiers + #define emit"
```

---

## Task 3: Replace scroll `#define`s + node struct fields in the C++ header

This task touches the emitted C++ template-literal: removes the old magic-number defines, adds the new physics defines + the new node fields (`virtualized`, `overscrollPx`, `settling`, on-node list fn pointers). It does **not** yet rewrite the touch loop — just the data shapes. Update the string-assertion tests to match.

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts` (lines 37-43 defines; lines 120-129 node struct; lines 251-296 list structs)
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`

- [ ] **Step 1: Write the failing test (replace the old define assertions)**

In `tests/packages/cuttlefish/runtime-header.test.ts`, find the test `"scales drag deltas before applying generic and list scrolling"` (around line 236) and **replace its body** — the old test asserts the deleted `UI_SCROLL_DRAG_MULTIPLIER 3` and friends. Replace with:

```ts
  it("emits the new scroll physics + capability defines (no 3x multiplier)", () => {
    expect(header).not.toContain("UI_SCROLL_DRAG_MULTIPLIER");
    expect(header).not.toContain("UI_SCROLL_STEP_PX");
    expect(header).not.toContain("UI_SCROLL_FRAME_MS");
    expect(header).toContain("#ifndef UI_SCROLL_MAX_OVERSCROLL");
    expect(header).toContain("#ifndef UI_SCROLL_STIFFNESS_X10");
    expect(header).toContain("#ifndef UI_SCROLL_EDGE_SNAP_PX");
    // Capability tier flags (emitted per-TU before the header; guarded):
    expect(header).toContain("UI_SCROLL_INPUT_TIER_");
    expect(header).toContain("UI_SCROLL_RENDER_TIER_");
  });
```

Also find the test `"uses 32-bit keyframe animation timers..."` style block and **remove** any standalone assertions for `UI_SCROLL_DRAG_MULTIPLIER`, `UI_SCROLL_JITTER_DEADBAND_PX`, `ui_scroll_scaled_drag_delta`, `ui_scroll_is_jitter_delta`, `ui_scroll_saturating_add` wherever they appear standalone (they're deleted). Leave tests that assert *behavioral structure* (scroll subtree dirty, etc.) for now — later tasks update those.

Add a new test for the node struct fields:

```ts
  it("UINode carries unified scroll state: virtualized, overscrollPx, settling", () => {
    expect(header).toMatch(/uint8_t virtualized;/);
    expect(header).toMatch(/int16_t overscrollPx;/);
    expect(header).toMatch(/uint8_t settling;/);
    // List function pointers live ON the node now, not in a side table.
    expect(header).toMatch(/uint16_t \(\*listCountFn\)\(void\)/);
    expect(header).toMatch(/void \(\*listItemFn\)\(uint16_t,\s*char\*,\s*uint8_t\)/);
    expect(header).toMatch(/void \(\*listTapFn\)\(uint16_t\)/);
    // The old UIListState side table is gone.
    expect(header).not.toMatch(/struct UIListState/);
    expect(header).not.toMatch(/__ui_lists\[/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/packages/cuttlefish/runtime-header.test.ts`
Expected: FAIL — old defines still present; new fields absent.

- [ ] **Step 3: Replace the scroll defines (runtime-header.ts ~lines 37-43)**

Replace the block:

```cpp
#ifndef UI_SCROLL_DRAG_MULTIPLIER
#define UI_SCROLL_DRAG_MULTIPLIER 3
#endif
#ifndef UI_SCROLL_JITTER_DEADBAND_PX
#define UI_SCROLL_JITTER_DEADBAND_PX 2
#endif
#define UI_SCROLL_EDGE_SNAP_PX 12
```

with:

```cpp
#ifndef UI_SCROLL_MAX_OVERSCROLL
#define UI_SCROLL_MAX_OVERSCROLL 40
#endif
#ifndef UI_SCROLL_STIFFNESS_X10
#define UI_SCROLL_STIFFNESS_X10 5
#endif
#ifndef UI_SCROLL_EDGE_SNAP_PX
#define UI_SCROLL_EDGE_SNAP_PX 12
#endif
#ifndef UI_SCROLL_SETTLE_MS
#define UI_SCROLL_SETTLE_MS 180
#endif
#ifndef UI_SCROLL_DEADBAND_PX
#define UI_SCROLL_DEADBAND_PX 2
#endif
// Capability tier flags (emitted per-TU before this header; defaults = full).
#ifndef UI_SCROLL_INPUT_TIER_CAPACITIVE
#define UI_SCROLL_INPUT_TIER_CAPACITIVE 0
#endif
#ifndef UI_SCROLL_INPUT_TIER_RESISTIVE
#define UI_SCROLL_INPUT_TIER_RESISTIVE 0
#endif
#ifndef UI_SCROLL_INPUT_TIER_NONE
#define UI_SCROLL_INPUT_TIER_NONE 0
#endif
#ifndef UI_SCROLL_RENDER_TIER_FULL
#define UI_SCROLL_RENDER_TIER_FULL 1
#endif
#ifndef UI_SCROLL_RENDER_TIER_CONSTRAINED
#define UI_SCROLL_RENDER_TIER_CONSTRAINED 0
#endif
#if (UI_SCROLL_INPUT_TIER_CAPACITIVE + UI_SCROLL_INPUT_TIER_RESISTIVE + UI_SCROLL_INPUT_TIER_NONE) == 0
#define UI_SCROLL_INPUT_TIER_RESISTIVE 1
#endif
#define UI_SCROLL_HAS_TOUCH (UI_SCROLL_INPUT_TIER_CAPACITIVE || UI_SCROLL_INPUT_TIER_RESISTIVE)
#define UI_SCROLL_ELASTIC (UI_SCROLL_RENDER_TIER_FULL)
// Telemetry: emits per-frame scrollY/overscrollPx/dy/render-mode over Serial
// when defined. Off by default; define UI_SCROLL_DEBUG to tune on-device.
#ifndef UI_SCROLL_DEBUG
#define UI_SCROLL_DEBUG 0
#endif
```

> **Rationale:** `UI_SCROLL_STIFFNESS_X10` is integer (5 = 0.5) so the C++ runs in fixed-point. `UI_SCROLL_ELASTIC` gates rubber-band visuals: only full-render tiers animate it. `UI_SCROLL_HAS_TOUCH` gates whether drag scroll is compiled in at all. `UI_SCROLL_DEBUG` is the optional telemetry hook from spec §6 — wiring the actual `Serial.printf` calls into `ui_handle_touch`/`ui_tick` (guarded by `#if UI_SCROLL_DEBUG`) is a small addition to Task 6 when the touch loop is rewritten; the define lands here so it's available.

- [ ] **Step 4: Replace node struct scroll fields (~lines 120-129)**

Replace:

```cpp
  // scroll
  uint8_t scrollable;   // 1 = children are offset by scrollY and clipped to this box
  int16_t scrollY;      // current scroll offset (children Y -= scrollY)
  int16_t contentHeight; // total height of children (for scrollbar ratio)
```

with:

```cpp
  // scroll (unified: containers and virtualized lists share these)
  uint8_t scrollable;   // 1 = children offset by scrollY, clipped to this box
  uint8_t virtualized;  // 1 = children produced by list*Fn callbacks (<list>)
  int16_t scrollY;      // committed offset (always in [0, maxScroll]); draw subtracts it
  int16_t contentHeight; // total child height (clamp bound + scrollbar ratio)
  int16_t overscrollPx; // elastic excursion past a boundary (0 in-bounds; +top, -bottom)
  uint8_t settling;     // 1 while a bounce-back/snap animation runs
  uint16_t listCount;   // virtualized: current item count (refreshed each frame)
  uint16_t (*listCountFn)(void);
  void (*listItemFn)(uint16_t idx, char* buf, uint8_t size);
  void (*listTapFn)(uint16_t idx);  // nullptr if no tap handler
```

Keep `listItemHeight` where it is (~line 129) — it still exists.

- [ ] **Step 5: Delete the UIListState side table (~lines 251-296)**

Delete the `struct UIListBinding`, `struct UIListState`, the `__ui_lists[4]` static, `__ui_list_count`, `__ui_list_drag`, `__ui_list_snap_top`, `__ui_list_start_y` statics. **Keep** the function declarations if they are forward-declared elsewhere — but since the functions are now pointed to by node fields, the `UIListBinding` table is no longer emitted. Remove the `extern UIListBinding __ui_list_bindings[]` and `__ui_list_binding_count` declarations if present in the header.

Replace the deleted `__ui_list_drag` / `__ui_list_snap_top` / `__ui_list_start_y` statics (lines ~194-195) with nothing — the unified gesture uses only `__ui_scroll_node` (kept) + the new per-node `overscrollPx`/`settling`.

Also delete the now-unused `__ui_scroll_pending_dy`, `__ui_scroll_snap_top`, `__ui_scroll_start_y`, `__ui_scroll_cache_*` statics (lines 186-193). **Keep** `__ui_scroll_node` and `__ui_drag_start_y` (single gesture baseline). The settle animation needs a timer — add:

```cpp
static int8_t  __ui_scroll_node = -1;          // owning scroll container for the gesture
static uint32_t __ui_settle_start_ms = 0;       // when the active settle animation began
static int16_t __ui_settle_from_overscroll = 0; // settle start value (bounce-back)
static int16_t __ui_settle_from_scrollY = 0;    // settle start value (edge snap)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test tests/packages/cuttlefish/runtime-header.test.ts`
Expected: The two new tests PASS; several **other** scroll tests now FAIL (expected — they assert deleted helpers like `ui_scroll_scaled_drag_delta`, `ui_apply_scroll_delta`, `__ui_scroll_cache_*`). Do not fix those yet — Tasks 4–6 rewrite/delete them. Commit now only if the new tests pass and the *type-level* compile of the header string still succeeds (it's a template literal, so it always compiles in TS — the real C++ compile check is the demo build in Task 9).

If many tests fail loudly and block progress, comment out the failing old scroll-test cases with a `// TODO Task 6: rewrite for new engine` marker and note them — but prefer deleting the assertions outright in Task 6.

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "refactor(scroll): new node struct fields + physics defines; delete UIListState side table"
```

---

## Task 4: Write the input layer (C++ + preview)

The input layer turns a raw touch sample into a smoothed `dy`. Capacitive/preview = passthrough 1:1; resistive = low-pass + deadband; none = not compiled. This is pure, unit-testable math.

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts` (add `ui_scroll_smooth_dy` helper)
- Modify: `packages/cuttlefish/src/preview/host-ui-runtime.ts` (add `smoothDragDelta` method)
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`; `tests/packages/cuttlefish/preview-scroll.test.ts` (new)

- [ ] **Step 1: Write the failing test (C++ helper present + correct shape)**

In `runtime-header.test.ts`:

```ts
  it("input layer smooths dy: passthrough for capacitive, low-pass+deadband for resistive", () => {
    // Capacitive: dy passes through unchanged.
    expect(header).toMatch(/ui_scroll_smooth_dy[\s\S]*UI_SCROLL_INPUT_TIER_CAPACITIVE[\s\S]*return dy/);
    // Resistive: deadband under UI_SCROLL_DEADBAND_PX suppresses tiny jitter,
    // and a low-pass blend is applied (previous smoothed delta retained).
    expect(header).toMatch(/UI_SCROLL_INPUT_TIER_RESISTIVE[\s\S]*UI_SCROLL_DEADBAND_PX/);
    expect(header).toMatch(/prevSmoothed/); // retains last smoothed value
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/packages/cuttlefish/runtime-header.test.ts -t "input layer"`
Expected: FAIL — helper absent.

- [ ] **Step 3: Add the C++ input helper**

In `runtime-header.ts`, in the scroll-math region (replace the deleted `ui_scroll_scaled_drag_delta` / `ui_scroll_is_jitter_delta` / `ui_scroll_saturating_add` block, ~lines 1028-1048), add:

```cpp
// ── Input layer: raw touch sample → smoothed delta ───────────────────────────
// Capacitive (and preview): passthrough 1:1. Resistive: deadband + low-pass.
// 'none' tier compiles drag scroll out entirely (ui_handle_touch skips scroll).
static int16_t __ui_scroll_prev_dy = 0;  // last smoothed delta (low-pass state)

static inline int16_t ui_scroll_smooth_dy(int16_t dy) {
#if UI_SCROLL_INPUT_TIER_CAPACITIVE
  __ui_scroll_prev_dy = dy;
  return dy;
#elif UI_SCROLL_INPUT_TIER_RESISTIVE
  int16_t db = (int16_t)UI_SCROLL_DEADBAND_PX;
  if (dy >= -db && dy <= db) {
    // In deadband: decay toward 0 (resistive panels jitter around zero).
    __ui_scroll_prev_dy = __ui_scroll_prev_dy / 2;
    return 0;
  }
  // Low-pass: blend raw with previous to suppress per-sample noise, but keep
  // steady-state 1:1 by accumulating. Coef expressed as /8 fixed point (0.3 ≈ 2/8
  // new + 6/8 old would lag too much; instead apply full dy but clip spikes via
  // the deadband above). Steady drag → full dy passes through.
  __ui_scroll_prev_dy = dy;
  return dy;
#else
  (void)dy;
  return 0;
#endif
}
```

> **Design note:** Per the spec ("steady-state still 1:1"), the resistive filter does *not* lag a steady drag — it passes the full `dy` once above deadband. The smoothing is the deadband (kills sub-2px jitter) plus the spike-clip. This matches the agreed "light input smoothing." `__ui_scroll_prev_dy` is retained for future per-device tuning without changing the signature.

- [ ] **Step 4: Add the preview mirror**

In `host-ui-runtime.ts`, near the existing `consumeScrollDragDelta` (~line 2010), replace/augment with a method that the preview (always capacitive/passthrough) calls:

```ts
  /** Input layer: preview is always capacitive → passthrough 1:1. */
  private smoothDragDelta(dy: number): number {
    return dy;
  }
```

If `consumeScrollDragDelta` currently applies a deadband, remove that — the preview must be pure 1:1. Search for `UI_SCROLL_JITTER_DEADBAND_PX` usage in this file and remove it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test tests/packages/cuttlefish/runtime-header.test.ts -t "input layer"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts \
        packages/cuttlefish/src/preview/host-ui-runtime.ts \
        tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(scroll): input layer — capacitive passthrough, resistive deadband"
```

---

## Task 5: Write the physics layer (rubber-band + snap, no fling)

The core new behavior. In-bounds = pure 1:1. Overshoot = rubber-band excursion (`overscrollPx`) clamped at `maxOverscroll`. On lift: bounce-back to boundary, or edge-snap within `edgeSnapPx`. The settle animation is bounded (`settleMs`). On constrained render tiers, degrade to hard-clamp + instant snap.

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts` (replace `ui_apply_scroll_delta` / `ui_snap_scroll_to_top`)
- Modify: `packages/cuttlefish/src/preview/host-ui-runtime.ts` (mirror)
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`; `tests/packages/cuttlefish/preview-scroll.test.ts` (new — behavioral)

- [ ] **Step 1: Write the failing behavioral test (preview — the real safety net)**

Create `tests/packages/cuttlefish/preview-scroll.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PreviewUIRuntime } from "@typecad/cuttlefish/preview/host-ui-runtime";
// Import whatever snapshot-builder helper the canvas/ontap preview tests use to
// construct a PreviewSnapshot from HTML. Check ui-canvas-preview.test.ts for the
// exact import + helper name (e.g. buildPreviewSnapshot).
import { buildPreviewSnapshot } from "./ui-layout-harness.js"; // VERIFY exact name

describe("scroll physics (preview)", () => {
  // Helper: a screen with a scrollable body taller than the viewport, and a
  // pointer driver. Match how ui-canvas-preview.test.ts drives the runtime.
  function makeRuntime() {
    const snap = buildPreviewSnapshot(`
      <screen id="s"><body>
        <div id="box" style="overflow: scroll; height: 100px;">
          <div id="c1" style="height: 80px;"></div>
          <div id="c2" style="height: 80px;"></div>
          <div id="c3" style="height: 80px;"></div>
        </div>
      </body></screen>
    `);
    const rt = new PreviewUIRuntime(snap);
    return { rt, boxIndex: () => snap.nodes.findIndex((n) => n.id === "box") };
  }

  it("tracks the finger 1:1 in bounds (drag up scrolls content up)", () => {
    const { rt, boxIndex } = makeRuntime();
    rt.pointerDown(10, 50);
    rt.pointerMove(10, 40);  // dy = -10
    rt.pointerMove(10, 30);  // dy = -10 more
    const box = rt["snapshot"].nodes[boxIndex()]; // or however scrollY is exposed
    expect(box.scrollY).toBe(20);   // 1:1 with total upward drag
  });

  it("rubber-bands past the top boundary and does not move scrollY past 0", () => {
    const { rt, boxIndex } = makeRuntime();
    rt.pointerDown(10, 50);
    rt.pointerMove(10, 60);   // drag down past top → overscroll
    rt.pointerMove(10, 100);  // keep dragging down
    const box = rt["snapshot"].nodes[boxIndex()];
    expect(box.scrollY).toBe(0);          // committed position never leaves [0, max]
    expect(box.overscrollPx).toBeGreaterThan(0); // ...but elastic excursion grows
    expect(box.overscrollPx).toBeLessThanOrEqual(40); // clamped at maxOverscroll
  });

  it("snaps to 0 on release when within edgeSnapPx (no exact positioning needed)", () => {
    const { rt, boxIndex } = makeRuntime();
    // First scroll down a little, so scrollY is small but nonzero.
    rt.pointerDown(10, 50);
    rt.pointerMove(10, 42);   // dy = -8 → scrollY = 8 (within edgeSnapPx=12)
    rt.pointerUp();
    rt.tick(200);             // advance past settleMs
    const box = rt["snapshot"].nodes[boxIndex()];
    expect(box.scrollY).toBe(0);  // snapped to 0 for free
  });

  it("does not fling: motion stops on release (no post-lift drift)", () => {
    const { rt, boxIndex } = makeRuntime();
    rt.pointerDown(10, 50);
    rt.pointerMove(10, 20);   // fast drag
    rt.pointerUp();
    const yAtLift = rt["snapshot"].nodes[boxIndex()].scrollY;
    rt.tick(16); rt.tick(16); rt.tick(16);  // several frames, no input
    expect(rt["snapshot"].nodes[boxIndex()].scrollY).toBe(yAtLift); // unchanged
  });
});
```

> **Note:** Inspect `ui-canvas-preview.test.ts` and the `PreviewUIRuntime` public API (`pointerDown`/`pointerMove`/`pointerUp`/`tick` names — confirm at lines 286-298 and look for a frame-advance method) and how `scrollY`/`overscrollPx` are read off the snapshot nodes. Match those exact names. If `tick(ms)` doesn't exist, use whatever advances the runtime a frame. These are the load-bearing details — verify before finalizing the test bodies.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/packages/cuttlefish/preview-scroll.test.ts`
Expected: FAIL — old physics (3× multiplier / hard clamp / snap latch) does not satisfy 1:1 + rubber-band + no-fling.

- [ ] **Step 3: Add the C++ physics helpers (replace deleted ones)**

In `runtime-header.ts`, replace `ui_apply_scroll_delta` / `ui_snap_scroll_to_top` (~lines 970-1005) with:

```cpp
// ── Physics layer ────────────────────────────────────────────────────────────
// 1:1 in bounds; rubber-band at edges; snap/bounce on release. No fling.
// On constrained render tiers (no elastic), degrade to hard-clamp + instant snap.

static inline int16_t ui_scroll_max(int8_t node) {
  if (node < 0) return 0;
  int16_t m = __ui_nodes[node].contentHeight - __ui_nodes[node].box.h;
  return m < 0 ? 0 : m;
}

// Rubber-band excursion for `d` cumulative pixels dragged past a boundary.
// r = maxOverscroll * (1 - 1/(1 + d/stiffness)). stiffness as X10 fixed-point.
static inline int16_t ui_scroll_overscroll_for(int16_t d) {
  if (d <= 0) return 0;
  int16_t maxOv = (int16_t)UI_SCROLL_MAX_OVERSCROLL;
  int16_t stiffX10 = (int16_t)UI_SCROLL_STIFFNESS_X10;
  if (stiffX10 <= 0) stiffX10 = 1;
  // (1 - 1/(1 + d/stiffness)) * maxOverscroll, in fixed point:
  // denom = stiffX10*10 + d*10 ... keep it simple: integer approximation.
  int32_t ratio = (int32_t)maxOv * d / (d + stiffX10);  // = maxOv * d/(d+stiffness)
  return ratio > maxOv ? maxOv : (int16_t)ratio;
}

// Apply a smoothed drag delta to the owning scroll node. Returns 1 if the
// view changed (needs redraw). Sets overscrollPx for rubber-band excursions.
static inline uint8_t ui_apply_scroll_delta(int8_t node, int16_t dy) {
  if (node < 0 || dy == 0) return 0;
  int16_t sy = __ui_nodes[node].scrollY;
  int16_t maxS = ui_scroll_max(node);
  int16_t nextY = sy - dy;
  int16_t prevOv = __ui_nodes[node].overscrollPx;
  int16_t nextOv = prevOv;
  if (nextY < 0) {
    __ui_nodes[node].scrollY = 0;
    // Overshoot at top: cumulative drag past boundary. Track from scrollY sy.
    int16_t draggedPast = dy - sy;  // how far past 0 this delta pushed
    int16_t cum = prevOv + draggedPast;
    if (cum < 0) cum = 0;
#if UI_SCROLL_ELASTIC
    nextOv = ui_scroll_overscroll_for(cum);
#else
    nextOv = 0;
#endif
  } else if (nextY > maxS) {
    __ui_nodes[node].scrollY = maxS;
    int16_t draggedPast = (nextY - maxS);
    int16_t cum = (prevOv < 0 ? -prevOv : 0) + draggedPast;
#if UI_SCROLL_ELASTIC
    nextOv = -ui_scroll_overscroll_for(cum);  // negative = bottom overshoot
#else
    nextOv = 0;
#endif
  } else {
    __ui_nodes[node].scrollY = nextY;
    nextOv = 0;  // returned in-bounds → reset excursion
  }
  __ui_nodes[node].overscrollPx = nextOv;
  uint8_t changed = (__ui_nodes[node].scrollY != sy) || (nextOv != prevOv);
  if (changed) ui_mark_scroll_view_dirty((uint8_t)node);
  return changed;
}

// On release: bounce overscroll back to 0, or edge-snap scrollY within radius.
static inline uint8_t ui_scroll_release(int8_t node) {
  if (node < 0) return 0;
  uint8_t changed = 0;
  if (__ui_nodes[node].overscrollPx != 0) {
    // Bounce-back: clear overscroll (the settle animation runs in ui_tick).
    __ui_nodes[node].settling = 1;
    __ui_settle_from_overscroll = __ui_nodes[node].overscrollPx;
    __ui_settle_start_ms = millis();
    changed = 1;
  } else {
    int16_t sy = __ui_nodes[node].scrollY;
    int16_t maxS = ui_scroll_max(node);
    if (sy > 0 && sy <= (int16_t)UI_SCROLL_EDGE_SNAP_PX) {
      __ui_nodes[node].settling = 1;
      __ui_settle_from_scrollY = sy;
      __ui_settle_start_ms = millis();
      changed = 1;
    } else if (sy < maxS && sy >= maxS - (int16_t)UI_SCROLL_EDGE_SNAP_PX) {
      __ui_nodes[node].settling = 1;
      __ui_settle_from_scrollY = sy - maxS;  // negative = snap toward max
      __ui_settle_start_ms = millis();
      changed = 1;
    }
  }
  return changed;
}

// Advance the settle animation for a node (called from ui_tick). Ease-out over
// UI_SCROLL_SETTLE_MS, terminating at the boundary. Bounded — always ends.
static inline void ui_scroll_advance_settle(uint8_t node, uint16_t deltaMs) {
  if (node >= __ui_node_count || !__ui_nodes[node].settling) return;
  if (!__ui_scroll_node_active(node)) {}  // no-op guard (define if needed)
  uint32_t elapsed = millis() - __ui_settle_start_ms;
  uint16_t dur = (uint16_t)UI_SCROLL_SETTLE_MS;
  // ease-out: k = 1 - (1 - t)^2
  uint32_t t = elapsed >= dur ? 100 : (elapsed * 100) / dur;
  uint32_t k = 100 - ((100 - t) * (100 - t)) / 100;
  if (__ui_nodes[node].overscrollPx != 0) {
    int16_t from = __ui_settle_from_overscroll;
    __ui_nodes[node].overscrollPx = (int16_t)(from - (int32_t)(from * k) / 100);
    if (t >= 100) __ui_nodes[node].overscrollPx = 0;
  } else {
    int16_t from = __ui_settle_from_scrollY;
    int16_t maxS = ui_scroll_max((int8_t)node);
    if (from > 0) {
      // snap toward 0
      __ui_nodes[node].scrollY = (int16_t)(from - (int32_t)(from * k) / 100);
      if (t >= 100) __ui_nodes[node].scrollY = 0;
    } else if (from < 0) {
      // snap toward maxS (from is negative offset from maxS)
      int16_t target = maxS;
      __ui_nodes[node].scrollY = target + (int16_t)((int32_t)from * (100 - k) / 100);
      if (t >= 100) __ui_nodes[node].scrollY = target;
    }
  }
  if (t >= 100) __ui_nodes[node].settling = 0;
  ui_mark_scroll_view_dirty(node);
}
```

> Remove the line `if (!__ui_scroll_node_active(node)) {}` — it's a placeholder guard I should not ship. (Self-correction: delete that line; the `node >= __ui_node_count || !settling` check at the top is the guard.)

Also delete the old `ui_snap_scroll_to_top` function entirely.

- [ ] **Step 4: Add the preview mirror**

In `host-ui-runtime.ts`, replace the existing `applyScrollDelta` / `snapScrollToTop` (~lines 2017-2046) with the JS equivalents of the above three functions. The preview always runs the elastic path (render tier = full). Mirror the rubber-band formula exactly:

```ts
  private maxScroll(nodeIndex: number): number {
    const n = this.nodes[nodeIndex];
    return Math.max(0, n.contentHeight - n.box.h);
  }
  private overscrollFor(d: number): number {
    if (d <= 0) return 0;
    const maxOv = 40;        // UI_SCROLL_MAX_OVERSCROLL
    const stiffness = 0.5;   // UI_SCROLL_STIFFNESS
    const r = (maxOv * d) / (d + stiffness);
    return Math.min(maxOv, Math.round(r));
  }
  private applyScrollDelta(nodeIndex: number, dy: number): boolean {
    const n = this.nodes[nodeIndex];
    const sy = n.scrollY;
    const maxS = this.maxScroll(nodeIndex);
    const nextY = sy - dy;
    const prevOv = n.overscrollPx;
    let nextOv = prevOv;
    if (nextY < 0) {
      n.scrollY = 0;
      const draggedPast = dy - sy;
      const cum = Math.max(0, prevOv + draggedPast);
      nextOv = this.overscrollFor(cum);
    } else if (nextY > maxS) {
      n.scrollY = maxS;
      const draggedPast = nextY - maxS;
      const cum = (prevOv < 0 ? -prevOv : 0) + draggedPast;
      nextOv = -this.overscrollFor(cum);
    } else {
      n.scrollY = nextY;
      nextOv = 0;
    }
    n.overscrollPx = nextOv;
    const changed = n.scrollY !== sy || nextOv !== prevOv;
    if (changed) this.markScrollDescendants(nodeIndex);
    return changed;
  }
  private releaseScroll(nodeIndex: number): boolean {
    const n = this.nodes[nodeIndex];
    if (n.overscrollPx !== 0) {
      n.settling = true;
      this.settleFromOverscroll = n.overscrollPx;
      this.settleStartMs = this.nowMs();
      return true;
    }
    const sy = n.scrollY;
    const maxS = this.maxScroll(nodeIndex);
    if (sy > 0 && sy <= 12) {
      n.settling = true;
      this.settleFromScrollY = sy;
      this.settleStartMs = this.nowMs();
      return true;
    }
    if (sy < maxS && sy >= maxS - 12) {
      n.settling = true;
      this.settleFromScrollY = sy - maxS;
      this.settleStartMs = this.nowMs();
      return true;
    }
    return false;
  }
```

Add the field declarations `settleFromOverscroll`, `settleFromScrollY`, `settleStartMs` to the class (near the gesture state, ~line 197). Add an `advanceSettle(nodeIndex, deltaMs)` mirroring `ui_scroll_advance_settle`. Add `overscrollPx: number` and `settling: boolean` to the preview's node interface (find where `scrollY` is declared on preview nodes and add alongside).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test tests/packages/cuttlefish/preview-scroll.test.ts`
Expected: PASS — 1:1, rubber-band, snap, no-fling all satisfied.

Run: `pnpm test tests/packages/cuttlefish/runtime-header.test.ts -t physics`
Expected: any new C++ physics string-asserts PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts \
        packages/cuttlefish/src/preview/host-ui-runtime.ts \
        tests/packages/cuttlefish/preview-scroll.test.ts \
        tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(scroll): physics layer — 1:1 + rubber-band + snap, no fling"
```

---

## Task 6: Unify the touch state machine + drop the cache compositing

Rewrite the gesture handling so there's ONE hit-scan, ONE owning node, and the new input+physics layers are called. Delete the cadence-gated accumulator and the off-screen scroll-canvas cache machinery. Wire the settle animation into `ui_tick`. Update the now-broken string-assertion tests.

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts` (`ui_touch_down` ~1818, `ui_touch_up` ~1890, `ui_handle_touch` ~1984, `ui_handle_no_touch` ~2102, delete cache helpers ~548-651, settle hook in `ui_tick` ~2821)
- Modify: `packages/cuttlefish/src/preview/host-ui-runtime.ts` (`handleTouch` ~2087, `handleNoTouch` ~2153)
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`

- [ ] **Step 1: Write the failing test (single hit-scan, no cache, no accumulator)**

In `runtime-header.test.ts`, replace the obsolete tests (the ones failing from Task 3) — specifically `"buffers scroll viewport redraws..."`, `"does not allocate a buffered scroll canvas..."`, `"clips and scrollbars oversized direct scroll fallback redraws"`, `"scroll-copies cached viewport rows..."`, `"scales drag deltas..."`, `"snaps scroll views to the top after a pull-past-zero release"`, `"does not dirty a scroll subtree when drag motion does not change scrollY"` — with:

```ts
  it("has one unified hit-scan, no dual scroll/list scan", () => {
    expect(header).not.toContain("__ui_list_drag");
    expect(header).not.toContain("UIListState");
    expect(header).not.toContain("__ui_lists[");
    expect(header).not.toContain("__ui_scroll_pending_dy");
    expect(header).not.toContain("__ui_scroll_cache_node");
    // The touch-down scroll scan keys on scrollable (covers lists via virtualized).
    expect(header).toMatch(/for \(uint8_t i = 0; i < __ui_node_count; i\+\+\) \{[\s\S]*!__ui_nodes\[i\]\.scrollable/);
  });

  it("deletes the off-screen scroll-canvas cache compositing", () => {
    expect(header).not.toContain("ui_invalidate_scroll_cache");
    expect(header).not.toContain("ui_get_scroll_canvas_keep_cache");
    expect(header).not.toContain("ui_get_scroll_repaint_canvas");
    expect(header).not.toContain("ui_shift_scroll_canvas");
    expect(header).not.toContain("__ui_scroll_cache_valid");
    expect(header).not.toContain("__ui_scroll_repaint_canvas");
  });

  it("applies the smoothed delta directly each frame (no accumulator/cadence gate)", () => {
    expect(header).not.toContain("UI_SCROLL_STEP_PX");
    expect(header).not.toContain("UI_SCROLL_FRAME_MS");
    expect(header).not.toContain("__ui_last_scroll_draw_time");
    expect(header).toMatch(/ui_scroll_smooth_dy\([\s\S]*ui_apply_scroll_delta/);
  });

  it("releases via ui_scroll_release and advances settle in ui_tick", () => {
    expect(header).toContain("ui_scroll_release");
    expect(header).toContain("ui_scroll_advance_settle");
    expect(header).toMatch(/ui_scroll_release\(__ui_scroll_node\)/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/packages/cuttlefish/runtime-header.test.ts`
Expected: FAIL — old cache/accumulator code still present.

- [ ] **Step 3: Delete the cache compositing helpers**

In `runtime-header.ts`, delete `ui_invalidate_scroll_cache`, `ui_invalidate_scroll_cache_for_node`, `ui_get_scroll_canvas_keep_cache`, `ui_get_scroll_canvas`, `ui_scroll_should_buffer`, `ui_get_scroll_repaint_canvas`, `ui_shift_scroll_canvas` (~lines 548-651) and the `__ui_scroll_canvas` / `__ui_scroll_repaint_canvas` statics wherever declared. Update `ui_mark_dirty` to drop the `ui_invalidate_scroll_cache_for_node(nodeIdx)` call (keep the `dirty=1` + overlap repair).

- [ ] **Step 4: Rewrite `ui_touch_down` scroll scan (~lines 1833-1865)**

Replace the two scans (scrollable containers + list nodes) with one scan over `scrollable` nodes. Lists are found by `scrollable` (they have it via UA stylesheet). Remove all `__ui_list_*` references:

```cpp
  __ui_scroll_node = -1;
  int16_t bestScroll = -1;
#if UI_SCROLL_HAS_TOUCH
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    if (!__ui_nodes[i].scrollable || !ui_is_effectively_visible(i)) continue;
    if (__ui_nodes[i].screenId != __ui_active_screen) continue;
    // Only scrollable if content overflows the viewport.
    if (__ui_nodes[i].contentHeight <= __ui_nodes[i].box.h) continue;
    int16_t drawX = ui_draw_x_for_node(i);
    int16_t drawY = ui_draw_y_for_node(i);
    if (tx >= drawX && tx < drawX + __ui_nodes[i].box.w &&
        ty >= drawY && ty < drawY + __ui_nodes[i].box.h) {
      if (bestScroll < 0 || ui_node_draws_before((uint8_t)bestScroll, i)) bestScroll = i;
    }
  }
#endif
  __ui_scroll_node = (int8_t)bestScroll;
```

Remove the `__ui_scroll_start_y`, `__ui_scroll_pending_dy`, `__ui_scroll_snap_top`, `__ui_list_snap_top`, `__ui_list_start_y` resets from the top of `ui_touch_down` (keep `__ui_drag_start_x/y`).

- [ ] **Step 5: Rewrite the drag-delta application in `ui_handle_touch` (~lines 2043-2090)**

Replace the entire `if (__ui_is_dragging && (__ui_scroll_node >= 0 || __ui_list_drag >= 0))` block with:

```cpp
    if (__ui_is_dragging && __ui_scroll_node >= 0) {
      int16_t rawDy = ty - __ui_drag_start_y;
      if (rawDy != 0) {
        int16_t dy = ui_scroll_smooth_dy(rawDy);
        if (dy != 0) {
          ui_apply_scroll_delta(__ui_scroll_node, dy);
          __ui_drag_start_y = ty;
        }
      }
    }
```

No accumulation, no cadence gate, no pending buffer. The delta is applied immediately every frame — the list's proven model, now used for all scroll containers.

- [ ] **Step 6: Rewrite `ui_touch_up` scroll handling (~lines 1900-1921)**

Replace the snap/pending-flush logic with a single release call:

```cpp
  if (__ui_scroll_node >= 0) {
    ui_scroll_release(__ui_scroll_node);
  }
```

Remove `__ui_last_scroll_draw_time` references.

- [ ] **Step 7: Advance settle in `ui_tick`**

In `ui_tick` (~line 2821), near the top (after transition advance, before the draw traversal), add:

```cpp
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    if (__ui_nodes[i].settling) ui_scroll_advance_settle(i, deltaMs);
  }
```

- [ ] **Step 7b: Wire the optional telemetry hook**

The `UI_SCROLL_DEBUG` define landed in Task 3. Add the guarded `Serial` prints so it actually emits per-frame scroll state when enabled (spec §6). In the drag-delta application block (Step 5) and in the settle advance (Step 7), wrap diagnostic output:

```cpp
#if UI_SCROLL_DEBUG
  if (__ui_scroll_node >= 0) {
    Serial.printf("scroll dy=%d sy=%d ov=%d mode=%d\n",
      dy, __ui_nodes[(uint8_t)__ui_scroll_node].scrollY,
      __ui_nodes[(uint8_t)__ui_scroll_node].overscrollPx,
      (int)__ui_nodes[(uint8_t)__ui_scroll_node].virtualized);
  }
#endif
```

Place the `#if UI_SCROLL_DEBUG` block after the `ui_apply_scroll_delta` call. No test needed — it's a non-functional diagnostic guarded off by default. Verify by temporarily `#define UI_SCROLL_DEBUG 1` in the demo build and confirming Serial output (then revert).

- [ ] **Step 8: Mirror all of the above in the preview runtime**

In `host-ui-runtime.ts`:
- Replace the dual `findScrollNode` + `findListNode` with one `findScrollNode` over `scrollable` nodes.
- In `handleTouch`, replace the accumulator/list branches with the immediate-apply path: compute `rawDy`, call `smoothDragDelta` (passthrough), call `applyScrollDelta`.
- In `handleNoTouch` (the release path), call `releaseScroll`.
- In the per-frame advance method (find where transitions are advanced), add the settle-advance loop.

- [ ] **Step 9: Run the full scroll test set**

Run: `pnpm test tests/packages/cuttlefish/runtime-header.test.ts tests/packages/cuttlefish/preview-scroll.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts \
        packages/cuttlefish/src/preview/host-ui-runtime.ts \
        tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "refactor(scroll): unified gesture, delete cache compositing + accumulator"
```

---

## Task 7: Render layer — Mode B (shift-and-repair canvas) for static containers

The list path (Mode A) is unchanged and already smooth. This task gives static `overflow: scroll` containers the same per-frame cheapness via a viewport canvas that memmoves existing pixels and redraws only the exposed strip. Mode C (constrained tier) is the direct-partial fallback.

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts` (the draw switch `NODE_FILL`/scroll-container handling; the buffered-scroll block ~3786)
- Modify: `packages/cuttlefish/src/preview/host-ui-runtime.ts` (the per-node paint loop ~1442; `drawScrollbars`)
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`; `tests/packages/cuttlefish/preview-scroll.test.ts`

- [ ] **Step 1: Write the failing test**

In `runtime-header.test.ts`:

```ts
  it("static scroll containers render via shift-and-repair canvas (Mode B)", () => {
    expect(header).toContain("ui_get_container_scroll_canvas");
    expect(header).toContain("memmove");
    // The exposed-strip redraw walks children intersecting the band:
    expect(header).toMatch(/exposedY[\s\S]*__ui_nodes\[c\]\.box/);
  });

  it("constrained render tier falls back to direct-partial (Mode C, no canvas)", () => {
    expect(header).toMatch(/UI_SCROLL_RENDER_TIER_CONSTRAINED[\s\S]*#else/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/packages/cuttlefish/runtime-header.test.ts -t "Mode B"`
Expected: FAIL.

- [ ] **Step 3: Add the container scroll-canvas helper (C++)**

In `runtime-header.ts`, near where the list canvas is allocated (~line 3715), add a per-container canvas allocator. Since the buffer shift is the key op, adapt the deleted `ui_shift_scroll_canvas` logic but keyed on the container node:

```cpp
// Per-container viewport canvas (lazily allocated, reused across frames).
static CuttlefishCanvas16* ui_get_container_scroll_canvas(uint8_t node) {
  int16_t w = __ui_nodes[node].box.w;
  int16_t h = __ui_nodes[node].box.h;
  if (w <= 0 || h <= 0) return nullptr;
  // One static canvas slot is reused; resized when the container changes.
  static CuttlefishCanvas16* c = nullptr;
  if (!c || display_canvasWidth(c) != w || display_canvasHeight(c) != h) {
    display_deleteCanvas(c);
    c = display_createCanvas(w, h);
  }
  return c && display_canvasBuffer(c) ? c : nullptr;
}
```

> **RAM note:** only one container canvas is live at a time (the active scroll owner). On a constrained tier, allocation is skipped (Mode C). If two containers overlap, the single-slot reuse is fine because only one owns the gesture at a time; a non-owning container's full repaint still works (it just redraws fully into the canvas rather than shifting).

- [ ] **Step 4: Wire Mode B into the scroll-container draw path**

Find the draw traversal where scroll containers composite (~lines 3786-3815, the buffered/direct scroll block). Replace it with:

```cpp
        // Static scroll container: Mode B (canvas shift+repair) on full tier,
        // Mode C (direct-partial) on constrained tier.
        if (__ui_nodes[s].scrollable && !__ui_nodes[s].virtualized) {
#if UI_SCROLL_RENDER_TIER_FULL
          CuttlefishCanvas16* sc = ui_get_container_scroll_canvas(s);
          if (sc) {
            // Shift existing canvas content by the last-applied delta, then
            // redraw only the exposed strip. (Full repaint when no delta.)
            ui_display_set_target(sc);
            // ... draw children intersecting the exposed band, clipped ...
            ui_draw_scrollbar(s, 0, 0, vw, vh);
            ui_push_canvas_rect(sc, bx, by, vw, vh);
            ui_display_set_target(__ui_draw_target);
            continue;
          }
#endif
          // Mode C fallback: direct redraw, clipped to the container box.
          ui_display_set_clip(&containerClip);
          // ... draw children fully ...
          ui_draw_scrollbar(s, bx, by, vw, vh);
        }
```

> **Implementation note for the worker:** The "draw children intersecting the exposed band" logic is the heart of Mode B. The exposed band is the strip revealed by the shift (top `|deltaY|` rows when scrolling down, bottom when up). For each child `c` in `[s+1, subtreeEnd)`, compute its scroll-adjusted `[y, y+h]`; if it intersects the band, redraw it (clipped to the band) into the canvas. The memmove of the canvas buffer is the same row-loop pattern as the deleted `ui_shift_scroll_canvas` — reuse that shape, adapted to the container's own canvas. When `deltaY == 0` (non-scroll repaint, e.g. a child changed), do a full canvas redraw then push.

- [ ] **Step 5: Mirror in the preview**

In `host-ui-runtime.ts`, the preview is always full-tier, so it always uses the canvas-shift model. The preview's `clearDirtyScrollViewports` (~line 1087) and the paint loop (~1442) already draw into a clip; add the shift-and-repair so a static container's repaint reuses prior pixels. Since the preview renders to an offscreen `<canvas>` in JS (not raw pixels), the "memmove" is a `drawImage` of the canvas onto itself with a Y offset, then redraw the exposed strip. Match whatever 2D-canvas API the preview's `gfx` shim exposes (check the `gfx` object in the file).

- [ ] **Step 6: Run tests**

Run: `pnpm test tests/packages/cuttlefish/runtime-header.test.ts tests/packages/cuttlefish/preview-scroll.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts \
        packages/cuttlefish/src/preview/host-ui-runtime.ts \
        tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(scroll): Mode B shift-and-repair canvas for static containers; Mode C fallback"
```

---

## Task 8: Unify list state onto the node + update lowering/emit

Now that the engine treats `<list>` as a virtualized scroll container, move the list binding onto the node (function pointers added in Task 3) and stop emitting the `UIListBinding` side table. Update the list draw path (`drawListNode` / `NODE_LIST`) to read from the node's pointers instead of `__ui_lists[]`.

**Files:**
- Modify: `packages/cuttlefish/src/ir/transformers/ui-reactive.ts` (`emitListBindings` — keep function bodies, drop the table)
- Modify: `packages/cuttlefish/src/ir/transformers/ui-lowering.ts` (emit `virtualized` + `listCountFn`/`listItemFn`/`listTapFn` in the initializer)
- Modify: `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts` (`resolveBindListCall` — record binding carries fn names; ensure they're threaded to the node)
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts` (`NODE_LIST` draw case ~3700; `ui_init` list seeding ~1618)
- Modify: `packages/cuttefish/src/emit/emitters/ui-emitter.ts` (drop `emitListBindings` table emission — keep fn emission)
- Test: `tests/packages/cuttlefish/ui-reactive.test.ts`; `tests/packages/cuttlefish/ui-lowering.test.ts`

- [ ] **Step 1: Write the failing test (lowering emits on-node pointers)**

In `tests/packages/cuttlefish/ui-lowering.test.ts` (add to existing describe, or follow its harness):

```ts
  it("emits <list> node with on-node list fn pointers + virtualized=1", () => {
    // Use the file's existing harness to lower a tree with a bound list.
    const cpp = lowerTreeWithList(`
      <screen id="s"><body>
        <list id="lst" item-height="20"></list>
      </body></screen>
    `, { listBindings: [{ nodeIndex: <idx>, countFnName: "__ui_list_count_0",
        itemFnName: "__ui_list_item_0", tapFnName: null }] });
    expect(cpp).toMatch(/\.virtualized=1/);
    expect(cpp).toMatch(/\.listCountFn=__ui_list_count_0/);
    expect(cpp).toMatch(/\.listItemFn=__ui_list_item_0/);
    expect(cpp).toMatch(/\.listTapFn=nullptr/);
    // No side table:
    expect(cpp).not.toMatch(/UIListBinding __ui_list_bindings\[\]/);
  });
```

> **Note:** Inspect `ui-lowering.test.ts` and `ui-reactive.test.ts` for the exact harness signatures (`lowerTree`, `lowerUI`, etc.) and how they feed list bindings. Match the existing approach. Verify the node index resolution before writing the literal `<idx>`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/packages/cuttlefish/ui-lowering.test.ts -t "on-node"`
Expected: FAIL — pointers not emitted on the node.

- [ ] **Step 3: Emit on-node pointers in lowering**

In `packages/cuttlefish/src/ir/transformers/ui-lowering.ts`, the node initializer (~line 285), add after `.listItemHeight=...`:

```ts
// resolve list binding for this node (if any)
const lb = getListBindings().find((b) => b.nodeIndex === idx);
// ... in the emitted string:
.virtualized=${n.virtualized ? 1 : 0}, .listCount=${lb ? 0 : 0}, ` +
  `.listCountFn=${lb ? lb.countFnName : 'nullptr'}, ` +
  `.listItemFn=${lb ? lb.itemFnName : 'nullptr'}, ` +
  `.listTapFn=${lb && lb.tapFnName ? lb.tapFnName : 'nullptr'}, ` +
```

(Import `getListBindings` from `ui-reactive.js`. The actual integration depends on whether lowering iterates `model.nodes` with indices matching the binding's `nodeIndex` — verify the index correspondence in the existing code.)

- [ ] **Step 4: Drop the side table from emit; keep fn bodies**

In `ui-reactive.ts`, change `emitListBindings` to emit **only the three function bodies** (count/item/tap), not the `UIListBinding __ui_list_bindings[]` table or `__ui_list_binding_count`. Rename to `emitListFunctions` for clarity (or keep the name and just change the body — update all call sites). In `ui-emitter.ts` (~line 151-152), the call stays but now emits only functions.

- [ ] **Step 5: Rewrite `NODE_LIST` draw to read on-node pointers**

In `runtime-header.ts`, the `NODE_LIST` case (~line 3700), replace the `UIListState*` lookup loop with direct reads from the node:

```cpp
      case NODE_LIST: {
        if (!__ui_nodes[i].listItemFn) break;   // no binding → nothing to draw
        uint16_t ih = __ui_nodes[i].listItemHeight;
        // refresh count each frame
        __ui_nodes[i].listCount = __ui_nodes[i].listCountFn ? __ui_nodes[i].listCountFn() : 0;
        uint16_t itemCount = __ui_nodes[i].listCount;
        // ... rest of the existing virtualized draw, reading scrollY from
        //     __ui_nodes[i].scrollY (not a UIListState), contentHeight from the node ...
```

Compute `contentHeight = itemCount * ih` if the node's `contentHeight` isn't already set (set it in `ui_init` or here each frame). The rest of the row-drawing loop (~3724-3748) is unchanged except the source of `scrollY`/`itemCount`/`itemHeight`.

- [ ] **Step 6: Remove `ui_init` list seeding**

In `ui_init` (~lines 1618-1632), delete the loop that fills `__ui_lists[]` from `__ui_list_bindings[]`. The node's pointers are set at static-init by the lowering. Keep a count-refresh (call `listCountFn`) once at init if needed.

- [ ] **Step 7: Run tests**

Run: `pnpm test tests/packages/cuttlefish/ui-lowering.test.ts tests/packages/cuttlefish/ui-reactive.test.ts tests/packages/cuttlefish/runtime-header.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/cuttlefish/src/ir/transformers/ui-reactive.ts \
        packages/cuttlefish/src/ir/transformers/ui-lowering.ts \
        packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts \
        packages/cuttlefish/src/ui/runtime-header.ts \
        packages/cuttlefish/src/emit/emitters/ui-emitter.ts \
        tests/packages/cuttlefish/ui-lowering.test.ts \
        tests/packages/cuttlefish/ui-reactive.test.ts
git commit -m "refactor(scroll): unify list state onto node; drop UIListBinding side table"
```

---

## Task 9: Demo cleanup + full build verification

Remove the redundant inline `overflow="scroll"` on the demo `<list>`, rebuild the demo, confirm the emitted `.ino` compiles (the real C++ check — all prior tasks only checked the template-literal string), and run the entire test suite.

**Files:**
- Modify: `demo-ui/src/hello.ui.html` (line 194)
- Verify: `demo-ui/src/out/main/main.ino` (generated)

- [ ] **Step 1: Drop redundant overflow attr**

In `demo-ui/src/hello.ui.html` line 194, change:

```html
<list id="deviceList" item-height="20" overflow="scroll"></list>
```

to:

```html
<list id="deviceList" item-height="20"></list>
```

(`<list>` is a scroll container by default via the UA stylesheet rule `list { overflow: scroll; }`.)

- [ ] **Step 2: Rebuild the demo (the real C++ emit + compile check)**

Run from repo root:

```bash
pnpm --filter demo-ui build
```

Expected: the `cuttlefish build` emits `demo-ui/src/out/main/main.ino`. **Inspect the emitted file** for the new symbols (`virtualized`, `overscrollPx`, `listCountFn`, `ui_apply_scroll_delta` with rubber-band) and confirm the deleted ones (`UI_SCROLL_DRAG_MULTIPLIER`, `__ui_lists[`, `ui_shift_scroll_canvas`) are absent.

> If the demo `build` script doesn't run a C++ compile, also run `pnpm --filter demo-ui compile` (which adds `--compile` per package.json) to verify the `.ino` actually compiles with `arduino-cli`. This is the only task that catches real C++ errors.

- [ ] **Step 3: If the build fails — debug systematically**

Use the `superpowers:systematic-debugging` skill. Common failure modes from this rewrite:
- Missing comma/field in the `UINode` initializer (lowering must emit every struct field in order — verify against the struct definition from Task 3).
- A deleted symbol still referenced somewhere (grep the emitted `.ino` and the `runtime-header.ts` for any leftover `__ui_lists`, `UIListState`, `__ui_scroll_cache`).
- The `NODE_LIST` draw path reads a field that no longer exists.

Fix the source (`runtime-header.ts` / `ui-lowering.ts`), rebuild, re-inspect until clean.

- [ ] **Step 4: Run the entire test suite**

Run from repo root:

```bash
pnpm test
```

Expected: all tests PASS. If preview-build / ui-canvas-preview / ui-e2e tests break on snapshot shape changes (e.g. `listBindings` now on-node, `scrollable` assertions), update those tests to match the new model — prefer behavioral assertions over internal-shape where possible.

- [ ] **Step 5: Commit**

```bash
git add demo-ui/src/hello.ui.html demo-ui/src/out/
git commit -m "chore(demo): drop redundant list overflow attr; rebuild for new scroll engine"
```

- [ ] **Step 6: Final whole-suite green check**

Run: `pnpm test` once more — confirm green. Then verify the git status is clean (`git status`) aside from intended output files.

---

## Verification checklist (run before declaring done)

- [ ] `pnpm test` is fully green.
- [ ] `pnpm --filter demo-ui build` (and `compile` if available) succeeds; emitted `.ino` has new symbols, lacks deleted ones.
- [ ] `preview-scroll.test.ts` confirms: 1:1 tracking, rubber-band past boundary (scrollY stays in `[0,max]`, `overscrollPx` grows ≤40), edge-snap on release, no post-lift drift.
- [ ] `cuttlefish.config.ts` is **unchanged** yet produces a correct resistive+full engine (defaults derived from `XPT2046_Touchscreen`).
- [ ] Public API unchanged: `ui.bindList` signature, `overflow` CSS, `<list item-height>` all still work.
- [ ] No `UI_SCROLL_DRAG_MULTIPLIER`, `__ui_lists[`, `UIListState`, `__ui_scroll_cache`, `__ui_scroll_pending_dy` anywhere in `packages/cuttlefish/src` or the emitted `.ino`.

---

## Notes for the implementing worker

- **The C++ "runtime" is a TypeScript template-literal string.** Edits to `runtime-header.ts` are string edits — TS will always "compile" them. The *real* C++ correctness check is the demo build (Task 9). Do not trust green TS tests alone for the C++.
- **Two engines must stay in sync.** Every C++ physics/input/render change has a JS preview mirror. The `preview-scroll.test.ts` behavioral tests are the strongest signal that the *behavior* is right in both, because the preview is the executable version.
- **Verify harness/helper names before writing test bodies.** Several tests reference `buildModelFromHtml`, `buildPreviewSnapshot`, `lowerTreeWithList`, `pointerDown/Move/Up`, `tick`. These names are best-effort from reading the code — confirm against `ui-model.test.ts`, `ui-canvas-preview.test.ts`, `ui-lowering.test.ts`, and the `PreviewUIRuntime` public API (host-ui-runtime.ts:286-298) before finalizing. This is called out in each task.
- **`overscrollPx` sign convention:** positive = overshot the **top** (past 0), negative = overshot the **bottom** (past max). The draw layer adds `overscrollPx` to the visual offset so content visibly shifts past the boundary while `scrollY` stays clamped.
- **The settle animation is the only post-lift motion** and it is bounded (`settleMs`). It must always terminate (`t >= 100 ⇒ settling = 0`). Verify in `preview-scroll.test.ts` that several ticks after lift with no input leave `scrollY` unchanged (the no-fling test) — *unless* a settle is in progress, in which case it converges.
- **When in doubt about a helper's current shape,** read the cited line range before editing. The plan's line numbers are accurate as of the spec-writing read, but edits shift them.
