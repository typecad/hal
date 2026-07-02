# Display-Agnostic Core — Design Spec

**Status:** Spec (pending user approval)
**Date:** 2026-07-02
**Research:** `docs/superpowers/research/2026-07-02-eink-display-support-research.md`
**Goal:** A display-agnostic core with shims supporting a large set of displays
(RGB565 / RGB666 / RGB888 TFT; 1-bit, grayscale, and multi-color e-ink).

## 1. Problem

The rendering core assumes a fast RGB565 TFT. Color is `uint16_t` throughout
(~80 struct fields in `runtime-header.ts`, image data `const uint16_t*`,
`ui_blend565`, `lerp_color`, gradients, AA), resolved once at transpile to 565
(`color.ts:177 toRGB565`, bits dropped irreversibly). Refresh is immediate-mode
with routine full-screen clears (`ui_navigate` → `display_fillScreen(0x0000)`
at `runtime-header.ts:440`). There is no partial-refresh or refresh-scheduling
concept; the per-node dirty bits and paint-rects are drawn immediately, never
batched.

Two consequences block the goal:
- **E-ink** needs fewer colors + slow/deferred refresh + (for good output) a
  backing store for dithering. Solvable as a boundary reduction *if* internal
  color were rich enough.
- **RGB666 / RGB888 panels** (e.g. ST7796S in native 666) need *more* color
  than `uint16_t` retains. Unsolvable at a boundary — the bits are gone before
  the device sees them.

A display-agnostic core requires the internal representation to be a **superset**
of every target. That decides the central move: **widen internal color to
RGB888 (`uint32_t`); every shim quantizes down.**

## 2. Architecture — three layers

### 2.1 Core (display-agnostic)

Owns layout, node tree, style resolution, dirty tracking, and paint operations,
all in **RGB888**. It emits *operations* + dirty regions and stops assuming a
display class:

- No routine `display_fillScreen` clears. "Clear screen" becomes a capability-
  gated operation: TFT shims may clear; e-ink shims translate it to "mark all
  dirty" and let the next frame repaint.
- No "a draw is immediately visible" assumption. The draw pass paints into the
  shim's target (which may be a backing store) and reports dirty rects; the
  shim decides realization.
- Animations, scroll physics, and feature enablement (AA, gradients, opacity)
  are driven by the capability descriptor, not hardcoded.

The existing dirty/paint-rect machinery (`ui_mark_dirty`, `ui_node_paint_rect`,
`ui_subtree_current_paint_rect`) already computes *what* changed and *where*.
The core change is routing that into a per-frame dirty union reported to the
shim rather than drawing straight to the panel.

### 2.2 Capability descriptor

Every shim declares its capabilities. This generalizes the existing partial
descriptors: `ScrollConfig` tiers (`display-profile.ts:101-138`), the
`antialias` flag (`display-profile.ts:57`), and `colorFormat`
(`display-profile.ts:49`).

```ts
type NativeFormat = "rgb888" | "rgb666" | "rgb565" | "mono" | "palette";
type RefreshModel = "immediate" | "deferred-partial" | "deferred-full";
type PartialRefreshScope = "none" | "mono-only" | "full";

interface DisplayCapabilities {
  nativeFormat: NativeFormat;
  /** For palette displays (e-ink multi-color): the ink set. */
  palette?: string[];
  refreshModel: RefreshModel;
  partialRefresh: PartialRefreshScope;
  /** Latency (ms) of a full refresh; used by the refresh scheduler. */
  fullRefreshMs?: number;
  /** Max sustained partial refreshes/sec. */
  maxPartialFps?: number;
  /** Shim requires a backing store (e-ink, any dithered target). */
  requiresBackingStore: boolean;
  /** Feature flags the shim can honor. False ⇒ core snaps/disables. */
  features: {
    antialias: boolean;
    gradients: boolean;
    opacityBlend: boolean;
    smoothScroll: boolean;
    animation: boolean;
  };
}
```

The descriptor is the single source of truth that the core, the transpile-time
color resolver, the CSS `@media` evaluator, and the preview all read. It lives
on `DisplayProfile` (extended) and is surfaced to `PlatformGraphicsStrategy`.

### 2.3 Shim (per display class)

Owns the native framebuffer, format conversion, and refresh strategy. Receives
paint operations + dirty regions; decides how to realize them.

| Shim class | Examples | Native | Refresh | Buffering |
|---|---|---|---|---|
| `tft-immediate-565` | ILI9341, ST7735, ST7796S(565) | rgb565 | immediate | direct |
| `tft-immediate-666` | ST7796S(666) | rgb666 | immediate | direct |
| `tft-immediate-888` | future high-color | rgb888 | immediate | direct |
| `eink-mono` | BW panels, SSD1306-class | mono | deferred-partial | backing store + dither |
| `eink-palette` | BWR, BWY, 7-color ACeP | palette | deferred-full | backing store + multi-ink dither |

The `tft-immediate-565` shim **reproduces today's exact behavior** (888→565
quantization at the boundary, immediate push). This is the regression-control
guarantee: widening the core must not change 565-TFT output, verified by the
existing test suite.

## 3. Component changes

### 3.1 Color representation — RGB565 → RGB888

**`packages/cuttlefish/src/ui/color.ts`**
- Rename/replace the transpile-time resolver. `resolveColor(input, format)`
  becomes `resolveColor888(input): number` (always 8-8-8 packed in `uint32_t`).
  `parseColor` is unchanged.
- Add boundary quantizers (pure, tested): `rgb888To565`, `rgb888To666`,
  `rgb888ToMono`, `rgb888ToNearest(palette)`. `toRGB565`/`toMono` become thin
  wrappers over `rgb888To565(rgb888To...)`.
- The device-side color format is chosen by the descriptor's `nativeFormat`;
  the transpiler quantizes once at emit time using the matching quantizer, so
  **no runtime color conversion occurs for flat fills** on immediate shims
  (preserving the current design invariant documented in `display-op-ir.ts:7`
  for the TFT path). Dithered shims (e-ink) are the deliberate exception: the
  dither pass is inherently spatial/per-pixel and cannot run at transpile, so
  it executes at push time on the backing store. The invariant is restated as
  "no runtime color conversion on immediate shims; deferred shims convert at
  the push boundary only."

**`packages/cuttlefish/src/api/shared/graphics-strategy.ts`**
- Widen `colorFormat(): "rgb565" | "mono"` (line 33) to return the full
  `DisplayCapabilities` (or a `nativeFormat` + accessors). `GenericStrategy`
  default updated.

**`packages/cuttlefish/src/ui/runtime-header.ts`** (emitted C++)
- Color fields: `uint16_t bg/fg/borderColor/gradientColor1/2/shadowColor[*]/
  textShadowColor/clearColor` → `uint32_t` (RGB888). Keyframe stops likewise.
- `UIImage { const uint16_t* data; }` → `const uint8_t* data` in a fixed
  packed-RGB888 layout (3 bytes/px, R-G-B). Storage format is canonical 888
  regardless of shim; quantization to the panel's native format happens at the
  push boundary (immediate shims) or in the dither pass (deferred shims).
  Image asset lowering (`ui-registry.ts`, canvas/image lowering transformers)
  is updated to emit 888. (A per-target *storage* format to save ROM on
  constrained boards is explicitly out of scope — §8.)
- `ui_blend565` (line 2441) → `ui_blend888(fg, bg, opacity)` operating on
  8-bit channels. `lerp_color` (line 239) likewise. Same integer-math shape,
  wider channels.
- Gradients (`ui_draw_gradient_fill`, line 3077): blend in 888; the shim
  quantizes the bands at push.
- AA subsystem (`UI_AA`, line 4470): coverage-blend in 888. The `UI_AA` define
  remains profile-gated; e-ink descriptor sets `features.antialias = false`.

### 3.2 Refresh model — core emits dirty union; shim realizes

**`packages/cuttlefish/src/ui/runtime-header.ts`**
- The draw pass computes a per-frame dirty union (already has the inputs:
  `ui_node_paint_rect`, `ui_subtree_current_paint_rect`). It reports this union
  to the shim via the existing `display.flush` op (`DisplayFlushOp`,
  `display-op-ir.ts:54`), whose `rects` field already exists.
- `ui_navigate`'s `display_fillScreen(0x0000)` (line 440) and whole-tree-dirty
  on keyboard open/close become **capability-gated**: TFT shims clear; e-ink
  shims mark all dirty and rely on the next flush to repaint via partial
  refresh (or a deliberate full refresh the author requests).
- A **refresh scheduler** is introduced behind the `display_*` boundary for
  deferred shims only: accumulates dirty rects across a frame, picks partial
  vs full refresh per region, enforces `maxPartialFps` / coalesces rapid
  updates, and periodically triggers a ghost-clearing full refresh. TFT shims
  bypass the scheduler entirely (immediate path unchanged).

**`packages/cuttlefish/src/api/shared/display-op-ir.ts`**
- Extend `DisplayHALOp` with the refresh primitives deferred shims need:
  `display.begin_refresh` / `display.partial_refresh(rects)` /
  `display.full_refresh()`. The immediate shim maps all of these to the
  existing `startWrite`/`setAddrWindow`/`writePixels`/`endWrite` push.
- `DisplayInitOp` gains the descriptor fields so generated C++ can specialize.

### 3.3 Shim registry & drivers

**`packages/cuttlefish/src/api/shared/display-adapter.ts`**
- `registerDisplayAdapter` entries gain a `capabilities: DisplayCapabilities`
  field and a `shimClass` discriminator. ILI9341 becomes a `tft-immediate-565`
  instance.
- Add `ST7796S` driver registration in two modes (565 and 666), each mapping
  to the appropriate shim. Pin/bus config as for ILI9341.
- Add e-ink driver registrations (e.g. SSD1680 / UC8151D for BWR panels) under
  `eink-mono` / `eink-palette` shims.

**`packages/cuttlefish/src/api/shared/display-profile.ts`**
- Extend `DisplayProfile` with `displayClass?: "tft" | "eink"` and carry the
  `DisplayCapabilities` (or fields sufficient to derive them). `colorFormat`
  is retained for back-compat and derived from `nativeFormat`.

### 3.4 CSS targeting — `@media (e-ink)` etc.

**`packages/cuttlefish/src/ui/css-parser.ts`**
- Extend `evalMediaCondition` (line 163) beyond width/height to recognize
  media features that read the descriptor:
  `(e-ink)`, `(update: slow)`, `(update: fast)`, `(monochrome)`,
  `(monochrome: N)`, `(color-gamut: srgb | p3)`, and format-specific
  `(native-format: rgb666)`. Each evaluates against the resolved profile at
  transpile time, consistent with the existing "one build = one display"
  model.
- Authors write e-ink-specific rules in the same stylesheet:
  ```css
  .card { background: #1a73e8; box-shadow: 0 2px 8px black; }
  @media (e-ink) {
    .card { background: white; border: 2px solid black; box-shadow: none; }
    .danger { color: red; }  /* semantic accent on BWR */
  }
  ```
- The existing theme-class mechanism (`.eink { --x: ... }` + `themeClass`) is
  retained as a manual escape hatch and remains unchanged.

### 3.5 Preview / runtime parity

**`packages/cuttlefish/src/preview/host-ui-runtime.ts`** and
**`host-gfx.ts`**
- `resolveRuntimeColor` (line 99) stops forcing `"rgb565"`; it resolves to 888
  and quantizes per the active descriptor's `nativeFormat`.
- The preview instantiates the same shim as the target and **simulates that
  display class**: reduced palette + dithering for e-ink; refresh-latency /
  "flashing" state animation for deferred shims; RGB666 quantization for the
  ST7796S(666). This is required, not optional — AGENTS.md mandates preview/
  runtime agreement on layout, text metrics, clipping, paint order, and now
  color/refresh.
- `HostAdafruitGFX.buffer` (`host-gfx.ts:51`) widens to `Uint32Array` (888);
  `toRgbaBytes` quantizes through the active shim for preview fidelity.

### 3.6 Scroll & animation tiers

- `ScrollConfig` (`display-profile.ts:108`) gains e-ink-aware tier values.
  Deferred-full shims (multi-color e-ink) use **paged/instant scroll** (jump N
  rows, one refresh); deferred-partial shims (1-bit) may allow paged scroll;
  immediate shims keep today's smooth physics. The preview consults the
  descriptor's tier rather than hardcoding capacitive+full.
- Animations/transitions snap to endpoints when `features.animation === false`
  (all deferred-full e-ink). `lerp_color`/keyframes respect this via the
  descriptor; the snap is descriptor-driven, not a special-case.

## 4. Data flow

```
CSS ──parseColor──▶ RGB888 literal
                    │
        @media (e-ink) ──descriptor──▶ variant rules kept/dropped
                    │
                    ▼
        resolveColor888 ──quantize per nativeFormat──▶ device-side constant
                    │
                    ▼
        Core (RGB888): layout → dirty nodes → paint ops + dirty union
                    │
                    ▼
        Shim: realize per refreshModel
          ├─ immediate: quantize 888→native, push rects now (TFT)
          └─ deferred: backing store, dither to palette/levels,
                       refresh scheduler → partial/full (e-ink)
                    │
                    ▼
        display.flush(dirty rects)
```

## 5. Testing strategy

Per AGENTS.md, focused runtime-header and preview tests accompany each
behavioral change; the package is built before tests import dist.

- **Color quantizers** (`color.ts`): unit tests for 888→565/666/mono/nearest,
  round-trip sanity, known-value fixtures.
- **888 widening parity**: snapshot/diff tests asserting 565-TFT output is
  byte-identical before/after the widen (the `tft-immediate-565` shim
  reproduces today's behavior). Extends `tests/packages/cuttlefish/preview-gfx.test.ts`
  and `runtime-header.test.ts`.
- **Descriptor-driven behavior**: tests that a descriptor with
  `features.antialias=false` disables AA, `refreshModel=deferred-full` routes
  to the scheduler, `nativeFormat=rgb666` quantizes to 666.
- **`@media` features**: `css-parser` tests for `(e-ink)`, `(update: slow)`,
  `(monochrome)`, `(color-gamut)` selection against profiles.
- **Refresh scheduler** (deferred shims): tests for dirty-rect union,
  partial-vs-full selection, coalescing, ghost-clear cadence. New file
  `tests/packages/cuttlefish/refresh-scheduler.test.ts`.
- **Preview parity**: preview produces the same quantized output as the
  runtime for each descriptor (mono palette, rgb666). Extends
  `host-ui-runtime`/`host-gfx` tests.
- **Regression**: full `npm run build --workspace @typecad/cuttlefish` +
  existing cuttlefish test suite + `npm run compile --workspace demo-ui`
  remain green; generated `src/out/main/main.ino` diff is limited to the
  expected color-type/refresh-op changes.

## 6. Scope & phasing

The spec is the full architecture. Implementation is phased to keep the TFT
path stable at each step:

- **Phase 1 — Core widen (no behavior change).** ✅ COMPLETE (commits
  `9746724`..`f456a9e`). RGB888 quantizers + `resolveColor888` in `color.ts`;
  C++ color fields widened `uint16_t`→`uint32_t` (UINode, UIRichRun,
  UIKeyframeStop, UIKeyStyle, UIBinding) with `ui_blend888`/`lerp_color_888`
  added alongside; preview framebuffer widened `Uint16Array`→`Uint32Array`
  with `blendRgb888`/`rgb888To565`/`rgb565To888` added alongside. **Storage
  widened only — values and all blend math stay 565**, so TFT output is
  byte-identical (proven: 888 operands in 565 math give wrong results, so
  values must stay 565 until Phase 2 routes them through `resolveColor888`
  together). Verified: AGENTS.md suite green (build, 93/93 runtime-header
  tests, demo-ui compiles), 607/612 cuttlefish tests pass (5 failures are
  pre-existing/unrelated). Byte-identity guards in `runtime-header.test.ts`.
- **Phase 2 — Descriptor + CSS.** `DisplayCapabilities`, `@media (e-ink)` /
  `(update)` / `(monochrome)`, descriptor-driven feature flags. TFT path still
  unchanged in output.
- **Phase 3 — RGB666 shim + ST7796S.** `tft-immediate-666`, ST7796S driver
  registrations (565 and 666), preview quantization. First new display class.
- **Phase 4 — E-ink.** Backing store, dither (1-bit then multi-ink), refresh
  scheduler, `eink-mono` / `eink-palette` shims, deferred refresh ops,
  preview e-ink simulation. Staged: 1-bit partial first, multi-color full
  after.

Each phase is independently shippable and verifiable.

## 7. Risks & mitigations

- **TFT regression.** Mitigation: `tft-immediate-565` is defined to reproduce
  current output; byte-identity tests guard it; AGENTS.md verification suite
  is the safety net.
- **No per-frame allocation (AGENTS.md).** Backing stores and dither buffers
  are persistent (reuse the `__ui_*_canvas` pattern), dirty regions culled
  before expensive loops (AGENTS.md "clip before doing expensive work").
- **`uint32_t` ROM/RAM cost.** Node table and image assets grow (~2× color
  field size). Acceptable on ESP32-class targets; flagged for
  `GraphicsCapacity` if a constrained target needs 565 storage (a future
  storage-format option, out of scope here).
- **Scope creep.** Phased plan; semantic roles (intent→ink) and per-target
  storage formats are explicitly out of scope for this spec.

## 8. Out of scope

- Semantic role→ink indirection (follow-on; the palette + `@media` mechanism
  covers the immediate need).
- Per-target node/image *storage* format (e.g. storing 565 in ROM on
  constrained targets while computing in 888). Future capacity option.
- MIPI / parallel-bus driver implementations beyond registration.
- Touch handling changes (unchanged; touch adapters are display-independent).
