# RGB888 Color Widening + SDL Native-Exe Render Layer — Design Spec

**Date:** 2026-07-02
**Status:** Draft (pending user review)
**Approach:** Widen the shared color pipeline so true RGB888 reaches the display
HAL, delivered through a new SDL display adapter that renders to a native window.
SDL is a fourth build-time display target alongside ILI9341 / ST7796 / e-ink; it
never touches the TFT/SPI path.

---

## 1. Intent

The Cuttlefish color pipeline currently narrows color to 16 bits before every
draw call. Node color fields are `uint32_t` and, for rgb666 profiles, hold full
RGB888 values (`color.ts:259 resolveColorInternal`), but the runtime truncates
them to `uint16_t` in local variables before calling the HAL draw functions
(e.g. `runtime-header.ts:3970` `uint16_t fillBg = __ui_nodes[i].bg;`). As a
result the per-node draw path only ever sees 565, even on 888-capable targets.
(The bulk `display_writePixels(uint32_t*, …)` blit path in the ST7796 adapter is
the one exception and carries true 888; it is not the path the UI runtime uses.)

The purpose of this work is to **widen the pipeline so true RGB888 flows
end-to-end**, and to deliver a new **SDL display adapter** that consumes that
888 and renders to a native window. SDL proves the widening works and provides a
desktop target that runs the real C++ `ui_tick` reactive runtime — the same code
path as the ESP32 build, with SDL as the sink instead of SPI.

This slots directly into the seam the original design reserved:
`docs/superpowers/specs/2026-06-19-ui-graphics-library-design.md:395-397`
("A higher-fidelity SDL backend is a later option, not v1.") and complements
`docs/superpowers/specs/2026-07-02-display-agnostic-core-design.md`.

## 2. Confirmed decisions

These were resolved during brainstorming and are load-bearing for the design:

1. **Run real device code natively.** SDL is a *compiled device-side backend*
   (Seam B): the actual C++ reactive runtime (`ui_tick`, node/transition tables)
   runs against an SDL-backed display adapter, compiled to a standalone `.exe` /
   `.out`. It is not a host-side JS reimplementation (that already exists as the
   browser preview). The payoff is exercising the device code path on desktop.
2. **Widen the HAL (Approach 1).** Make `display_target*` / `display_canvas*`
   and the shared `ui_display_*` wrappers take `uint32_t color` under
   `#if UI_COLOR_DEPTH == 888` (and `uint16_t` otherwise), mirroring the existing
   `ui_blend` / `UI_LERP_COLOR` guard at `runtime-header.ts:295-301`. This is
   the only approach that actually widens the pipeline; the 565/mono paths
   compile byte-identical. Rejected: a parallel 888 intrinsics set (doubles the
   HAL surface, doesn't fix ST7796) and 565-on-888 upscaling (does not achieve
   the stated purpose).
3. **Adapter + framework-native driver packaging.** Register an `sdl` display
   adapter (`registerDisplayAdapter("sdl", …)`) emitting C++ HAL against SDL2,
   plus an `sdl` driver in `framework-native`'s `supportedDisplayDrivers()` with
   `libraries: ['SDL2']`. Compiled via the existing `NativeToolchain`
   (`g++` / `clang++`, `native-compile.ts`). Mouse events feed the existing
   touch contract.
4. **True RGB888 as a first-class format.** Introduce `"rgb888"` as a new
   `colorFormat` value (alongside `rgb565 | rgb666 | mono`). SDL selects it.
   `resolveColorInternal` already returns full 888 for the rgb666 case; rgb888
   is a one-line parallel. This keeps SDL semantically honest (24-bit channels)
   rather than mislabeling it as rgb666 (6-bit channels).

## 3. Architecture — where SDL sits

```
                    ┌─────────────────────────────────────────────┐
  .ui.html + CSS ──▶│  cuttlefish transpile (lowerUIToModel)       │
                    │  resolveColorInternal(format) → node.bg/fg   │  uint32 888 for rgb888
                    └────────────────────┬────────────────────────┘
                                         │  static node tables + runtime header
                    ┌────────────────────▼────────────────────────┐
                    │  runtime-header.ts  (SHARED — widened)       │
                    │  ui_display_* wrappers: uint32 under         │
                    │  #if UI_COLOR_DEPTH==888                     │
                    └────────────────────┬────────────────────────┘
                                         │  display_target* / display_canvas*  (HAL contract)
              ┌──────────┬───────────────┴───────────────┬───────────────┐
              ▼          ▼                               ▼               ▼
         ILI9341 (565)  ST7796 (565 / 666)           eink (mono)      SDL (888)  ← NEW
         uint16_t HAL   widened uint32 @ 666         uint16_t HAL     uint32_t HAL
         Adafruit_GFX   Adafruit_GFX                 Adafruit_GFX     SDL_Renderer
         Arduino exe    Arduino exe                  Arduino exe      native exe (framework-native)
```

SDL is a **fourth display adapter**, selected at build time. It reuses the real
C++ reactive runtime — same device code path, different sink. It does not touch
the TFT/SPI path (ILI9341 / ST7796) at all.

## 4. The color widening (core fix) — `@typecad/cuttlefish`

This is the load-bearing change. Everything is macro-guarded under
`#if UI_COLOR_DEPTH == 888`, exactly matching the existing guard at
`runtime-header.ts:295-301`. The 565 and mono paths compile byte-identical.

### 4.1 New `"rgb888"` format — first-class, parallel to rgb666

- `packages/cuttlefish/src/api/shared/display-profile.ts:51` — add `"rgb888"` to
  the `colorFormat` union.
- `packages/cuttlefish/src/api/shared/display-capabilities.ts:66` — add
  `"rgb888"` to the `colorFormat` type; `NativeFormat` already lists it (line 11)
  but no code path produces it yet.
- `packages/cuttlefish/src/ir/transformers/ui-lowering.ts:230` — extend
  `ColorFormat` to include `"rgb888"`.
- `packages/cuttlefish/src/ui/color.ts:259` `resolveColorInternal` —
  `if (format === "rgb666" || format === "rgb888") return resolveColor888(input);`
- `packages/cuttlefish/src/emit/emitters/ui-emitter.ts:92` —
  `profile.colorFormat === "rgb666" || profile.colorFormat === "rgb888"` →
  `#define UI_COLOR_DEPTH 888`.
- `packages/cuttlefish/src/api/shared/graphics-strategy.ts` and
  `packages/cuttlefish/src/platform/generic-strategy.ts:330` — widen the
  `colorFormat()` return type to include `"rgb888"`.

### 4.2 Widen the shared runtime wrappers — `runtime-header.ts:765-795`

Each `ui_display_*` color parameter changes from `uint16_t color` to a
depth-guarded type. Introduce a single type alias alongside the depth switch:

```c
#if UI_COLOR_DEPTH == 888
  #define UI_COLOR_T uint32_t
#else
  #define UI_COLOR_T uint16_t
#endif
```

Then `ui_display_draw_pixel`, `ui_display_fill_rect`,
`ui_display_draw_fast_hline`, `ui_display_draw_fast_vline`,
`ui_display_fill_round_rect`, `ui_display_draw_rect`, `ui_display_draw_round_rect`,
`ui_display_draw_line`, `ui_display_fill_circle`, `ui_display_draw_circle`
(lines 765-796) take `UI_COLOR_T color`.

### 4.3 Widen the truncation locals so 888 is not dropped before the HAL

Sites identified by grep, each `uint16_t` → `UI_COLOR_T`:
`fillBg` (1995, 3970), `bColor` (1735, 1864, 1923, 2041, 3966, 3996),
`shadowCol` (3256), `c1` / `c2` (3221-3222). These are the points where a
`uint32_t` node field is read into a local that is later passed to the HAL;
widening the locals preserves all 24 bits.

### 4.4 Make 565-specific math depth-aware

- `0x7BEF` dim mask at lines 1330, 4259, 4531 — under 888, dimming is channel-
  wise on 8-bit components, e.g. `((c >> 1) & 0x7F7F7F)` (halves each channel
  with no cross-channel bleed).
- `0xffff` equality guards (antialias guard at 1469) — under 888 use
  `0xffffff`.
- `UI_MAYBE_SNAP_MONO565(c)` (line 324) is already a no-op on color targets;
  add a symmetrical `UI_MAYBE_SNAP_MONO888` for clarity, also a no-op on color.

### 4.5 Why this is safe

The `UI_COLOR_DEPTH == 888` guard is OFF for every existing target: ILI9341 is
565, eink is mono (the runtime still compiles with `UI_COLOR_DEPTH 565` and snaps
to mono via `UI_MAYBE_SNAP_MONO565`). The only target compiled at 888 today is
ST7796-in-rgb666-mode, whose per-node path is currently lossy — so widening
strictly improves it and cannot regress a working target. New unit tests pin
both depths (see §8).

## 5. The SDL display adapter — new file `display-adapters/sdl.ts`

Registered as `registerDisplayAdapter("sdl", sdlAdapter)` in `display-adapter.ts`
(following the registry pattern at lines 29-49). Emits C++ implementing the HAL
contract — the same surface as the ILI9341 adapter at `display-adapter.ts:70-158`
— against SDL2.

### 5.1 Target type

`#define CuttlefishDisplayTarget SdlGfxTarget` — a small C++ class owning an
`SDL_Window*`, `SDL_Renderer*`, `SDL_Texture*`, and a `uint32_t*` RGBA8888
framebuffer of size `width × height`. This is modeled directly on
`HostAdafruitGFX` (`packages/cuttlefish/src/preview/host-gfx.ts:61`), which is
already a framebuffer-backed reimplementation of the Adafruit GFX surface. The
C++ SDL target is the native twin of that TypeScript class; the methods map
almost one-to-one (the repo's preview renderer is effectively a reference SDL
backend in TS).

`#define CuttlefishCanvas16 SdlGfxCanvas` — an offscreen `uint32_t` buffer of
the same shape, so canvas-composited scroll paths work unchanged.

### 5.2 Color handling

Every draw function receives `uint32_t color` (888, packed `R<<16 | G<<8 | B`)
and writes `0xFF000000u | color` into the framebuffer (opaque alpha). A dirty
flag triggers `SDL_UpdateTexture` + `SDL_RenderPresent` at flush. **No
565→888 expansion is needed — color is already true 888.** This is the payoff
of the §4 widening.

### 5.3 Full HAL surface to implement

Panel-level: `display_init()`, `display_fillScreen(uint32_t)`,
`display_defaultTarget()`, `display_width()`, `display_height()`,
`display_writePixels(uint32_t*, uint32_t)`.

Canvas: `display_createCanvas(w,h)`, `display_deleteCanvas`,
`display_canvasWidth/Height`, `display_canvasBuffer` (returns `uint32_t*`),
`display_canvasGetPixel`, `display_canvasFillScreen`, `display_canvasFillRect`.

Target-polymorphic draw (panel and canvas share `CuttlefishDisplayTarget*`):
`display_targetDrawPixel`, `display_targetWidth/Height`,
`display_targetDrawRGBBitmap`, `display_targetFillRect`,
`display_targetDrawFastHLine/VLine`, `display_targetFillRoundRect/DrawRect/DrawRoundRect`,
`display_targetDrawLine`, `display_targetFillCircle/DrawCircle`,
`display_targetSetCursor`, `display_targetSetTextColor/SetTextColorBg`,
`display_targetSetTextSize/SetTextWrap/Print`.

All color-typed functions take `uint32_t color` (the widened contract).

### 5.4 Text rendering

The antialiased asset-font path needs no SDL-specific work — it draws through
`ui_display_draw_pixel` (`runtime-header.ts` `ui_draw_asset_text`, L2865-2915),
which the SDL target implements. The bitmap-font fallback (`fontFace == 0`) calls
`target->print()`; the SDL `SdlGfxTarget::print()` rasterizes the same 5×8 table
`HostAdafruitGFX.drawChar` uses (`host-gfx.ts:524-552`), scaled by `textSize`.

### 5.5 Initialization / teardown / event loop

`display_init()` opens the window at the configured `width × height`, allocates
renderer/texture/framebuffer. The `main()` function (emitted by framework-native)
runs the loop: pump SDL events, advance `ui_tick(deltaMs)`, present. `SDL_Quit`
runs on exit. Includes: `#include <SDL2/SDL.h>`. Declaration:
`SdlGfxTarget __tc_display(W, H);`.

## 6. framework-native wiring — `packages/framework-native`

- **`strategy.ts:549`** `supportedDisplayDrivers()` → add `"sdl"` alongside
  `"native-preview"`.
- **Color-format sourcing.** The authoritative `colorFormat` used for lowering
  flows through the resolved display profile (it is what `lowerUIToModel` reads
  at `model.ts:845`), not from `strategy.colorFormat()` (which is capability-
  level and takes no arguments today). The SDL driver declares `"rgb888"` as its
  profile `colorFormat` so the §4.1 resolution + `UI_COLOR_DEPTH 888` emission
  applies. `strategy.colorFormat()` (`strategy.ts:553`) and the
  `PlatformGraphicsStrategy` return type are widened to include `"rgb888"` so the
  strategy layer does not reject it; it remains advisory. The exact wiring point
  (profile vs strategy) is confirmed during implementation planning.
- **`NativeCompileConfig`** already accepts `libraries` and `includePaths`
  (`native-config.ts:26-41`) and the toolchain already builds `-l` flags last for
  GCC ordering (`native-compile.ts:126-127`). SDL demos set
  `libraries: ['SDL2']`. On Windows/MSYS2 the include path is
  `C:\msys64\ucrt64\include\SDL2` and the link set is `-lmingw32 -lSDL2main
  -lSDL2`; the toolchain's MSYS2 compiler probing at `native-compile.ts:29-34`
  already handles compiler discovery. SDL2 is a documented host prerequisite
  (same posture as the existing g++/clang++ prerequisite).
- **Event loop / `main()` emission:** framework-native already emits `main()`
  (`requiresLoopFunction()` is false, `entrypointFunctionName()` is `'main'`,
  `strategy.ts:86-91`). Extend the SDL path so `main()` calls `SDL_Init`,
  runs a `while (running)` loop that polls SDL events (mouse → touch shim,
  quit → exit), computes `deltaMs`, calls `ui_tick(deltaMs)`, and calls
  `SDL_Quit` on exit.

## 7. Touch — SDL mouse → existing touch contract

The runtime's `ui_poll_touch` (emitted by `ui-emitter.ts:149-166`) calls
`touch_isTouched()` and `touch_readRaw(int16_t* x, int16_t* y, int16_t* z)`. A
new SDL touch adapter — generated alongside the display adapter, following
`generateTouchAdapter()` in `display-profile.ts:258-319` — implements these from
SDL mouse state:

- `touch_isTouched()` → `(SDL_GetMouseState(&x, &y) & SDL_BUTTON_LMASK) != 0`.
- `touch_readRaw(x, y, z)` → `*x = mouseX; *y = mouseY; *z = 200;` (a constant
  `> minPressure` default of 10).
- Coordinates are already screen-space, so `ui_poll_touch`'s calibration
  `map()` must be bypassed for the `sdl` driver: emit an identity calibration
  profile (`xMin=0, xMax=width`, same for y) so raw == screen.

This makes scrolling, drag, sliders, and taps work via mouse with zero runtime
changes.

## 8. Demo — populate `native_demo`

The `native_demo` workspace exists but is currently empty. Port a focused subset
of the showcase (`demo-ui/src/showcase.ui.html`) into `native_demo` with a
`cuttlefish.config.ts`:

```ts
framework: '@typecad/framework-native',
display: { driver: 'sdl', width: 320, height: 240 },
native: { libraries: ['SDL2'], cxxStandard: 'c++20' },
```

A screen or two exercising: fills, gradients, text (both font paths), scroll,
and a touch-driven slider/list. This is the end-to-end proof that 888 + SDL +
touch work. `npm run compile --workspace native_demo` produces a runnable exe.

## 9. Testing & verification

Following existing patterns:

- **`tests/packages/cuttlefish/runtime-header.test.ts`** — add assertions that
  the widened wrappers emit `uint32_t` / `UI_COLOR_T` under the 888 guard and
  `uint16_t` under 565, and that the dim/mask math is depth-aware. (String/regex
  assertions on emitted C++ — exactly the existing pattern at lines 7-43.)
- **New `color-888.test.ts`** — `resolveColorInternal("…", "rgb888")` returns
  true 888; the existing `rgb888To666` / `rgb888To565` quantizers are unchanged.
- **New `display-adapter-sdl.test.ts`** — `generateDisplayAdapter({driver:
  "sdl", …})` produces SDL includes, `SdlGfxTarget`, `uint32_t color` HAL
  signatures, and `SDL_Init` inside `display_init()`.
- **framework-native test runner** (`packages/framework-native/tests/runner/
  native-pipeline.ts`) — an end-to-end test that transpiles a tiny SDL program,
  compiles with `g++ -lSDL2`, and asserts it launches. This is guarded behind
  SDL being present (`test.skip` otherwise), so CI without SDL still passes —
  matching how the repo treats optional toolchains.
- **Verification gates (AGENTS.md):** `npm run build --workspace
  @typecad/cuttlefish`; `npx vitest run
  tests/packages/cuttlefish/runtime-header.test.ts`; `npm run compile
  --workspace demo-ui` (confirms the 565 path stays byte-identical and still
  compiles).

## 10. Phasing (single spec, staged implementation)

1. **Color widening** (§4) + tests — ship/merge first; independently valuable
   (fixes ST7796 rgb666 lossiness and is required by SDL).
2. **SDL adapter** (§5) + registration + unit test (`display-adapter-sdl.test.ts`).
3. **framework-native wiring** (§6) + touch shim (§7).
4. **`native_demo`** (§8) + end-to-end test (§9).

The widening — the actual purpose of this session — is cleanly separable and
testable on its own; SDL is its proving ground.

## 11. Open questions / out of scope (v1)

- GPU acceleration (SDL2's renderer is used in its default mode, not GL/Vulkan).
- A Node→SDL bridge driving the existing browser-preview framebuffer to an SDL
  window (Seam A). Not needed: the compiled-exe path exercises the device code.
- e-ink palette / dither refinements (Phase 5 work, tracked separately).
- Static vs dynamic SDL linking is left to `NativeCompileConfig.staticLink`
  (default true on Windows).
