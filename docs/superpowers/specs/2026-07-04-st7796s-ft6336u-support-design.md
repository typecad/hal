# ST7796S Display + FT6336U Touch Support

**Date:** 2026-07-04
**Status:** Approved (pre-implementation)
**Working directory:** `demo-st/`

## Goal

Add first-class support for the **ST7796S 320×480 SPI TFT** and the **FT6336U I2C
capacitive touch controller** to the cuttlefish UI package, following the same
adapter pattern already used for the ILI9341 + XPT2046 stack. The `demo-st/`
project (a copy of `demo-ui/`) becomes the working/test project, configured for
the user's actual hardware.

## Context

The cuttlefish transpiler lowers TypeScript + HTML/CSS UI descriptions to Arduino
C++. Display and touch hardware are abstracted behind "adapter" code generators
that emit zero-cost static-inline C++ shims. The runtime header never names a
specific display class — it calls `display_*` and `touch_*` adapter functions.

**What already exists:**

- A display adapter registry at `packages/cuttlefish/src/api/shared/display-adapter.ts`
  with the pattern `registerDisplayAdapter(driver, generator)`.
- A touch adapter codegen at `packages/cuttlefish/src/api/shared/display-profile.ts`
  via `generateTouchAdapter(touch)` with branches per `TouchLibrary`.
- A built-in profile registry at `packages/framework-arduino/src/displays/ili9341-spi.ts`
  exporting `BUILT_IN_PROFILES: Record<string, DisplayProfile>`.
- A **partially-scaffolded** `st7796` driver adapter at
  `packages/cuttlefish/src/api/shared/display-adapters/st7796.ts`, registered
  but **broken** (wrong class name, wrong init API, missing shim family).

**What's missing:**

- A working ST7796S adapter matching the actual `Adafruit_ST7796S` library API.
- FT6336U touch support in the `TouchLibrary` enum and `generateTouchAdapter()`.
- A `st7796-spi` built-in profile.
- A `TouchProfile.i2cAddress` field (FT6336U is I2C).
- A capacitive-aware `ui_poll_touch()` branch (FT6336U has no z/pressure).

## Decisions

### D1. Color depth: RGB565 only, for now

The user asked for "maximum color depth the library and hardware can support."
Investigation of the vendored `Adafruit_ST7796S` library shows its panel init
sequence **hardcodes RGB565**:

```cpp
ST77XX_COLMOD, 1, // Color Mode - 16 bit
0x55,             // ST77xx COLMOD: 0x55 = 16-bit/pixel (RGB565)
```

The base class `Adafruit_SPITFT` only exposes `writePixels(uint16_t*, len)` and
`writeColor(uint16_t, len)` — both 565-native. There is no `init()` parameter
to select 666/888, and the existing `st7796.ts` adapter's 18-bit pack loop
(calling `SPI.writeBytes`) was never runnable against this library as-is (its
own comment says "should be verified before flashing").

**Decision:** Default to RGB565. The transpiler will throw a clear error if
`colorFormat: "rgb666"` is requested with the `st7796` driver, explaining the
Adafruit library must be patched. A tracked follow-up will add true 18-bit
support (vendor a patched fork or write a thin wrapper).

The "wide range of color" the ST7796S panel offers over the ILI9341 is realized
through the larger 320×480 surface and better viewing angles — both fully usable
in 565.

### D2. Pin wiring (from user)

Display (SPI):
- `cs: 5`, `dc: 17`, `rst: 16`
- `mosi: 23`, `sck: 18`, `miso: 19` (ESP32 default VSPI)
- No backlight pin (`bl` omitted — display is always-on)
- `spiFrequency: 80000000`

Touch (I2C + reset):
- `sda: 21`, `scl: 22` (ESP32 default Wire — these no longer conflict because
  display DC moved off 21)
- `i2cAddress: 0x38` (FT6336U default)
- `resetPin: 4` — the user's board requires a hardware-reset sequence before
  `begin()`:
  ```cpp
  pinMode(4, OUTPUT); digitalWrite(4, LOW); delay(10);
  digitalWrite(4, HIGH); delay(500);
  ```
- `irq: 14` — preserved in config for future IRQ mode; v1 uses polling inside
  `ui_tick` (consistent with how XPT2046 is polled today).

### D3. Touch coordinate semantics

FT6336U's `scan()` returns panel-pixel coordinates directly (12-bit masked to
the active area, ~0..320 on X and ~0..480 on Y), unlike XPT2046 which returns
raw ADC counts needing calibration. Therefore:

- The demo config sets `calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 }`
  so the existing `map()` math produces identity in rotation 0.
- The rotation-aware `invertX/invertY/isLandscape` logic in `ui-emitter.ts` is
  reused unchanged — it operates on the post-map coordinate frame.
- `minPressure` is irrelevant for capacitive input and is omitted.

## Architecture

No new abstractions. The change extends three existing extension points:

```
cuttlefish.config.ts (display.profile: 'st7796-spi', touch.library: 'FT6336U')
        ↓
framework-arduino/displays/st7796-spi.ts        ← NEW built-in profile
        ↓ registered in
framework-arduino/displays/ili9341-spi.ts        ← BUILT_IN_PROFILES map grows
        ↓ resolved by
display-profile.ts:resolveDisplayProfile()       ← widen TouchLibrary + TouchProfile fields
        ↓ codegen
display-adapters/st7796.ts                       ← REWRITE for Adafruit_ST7796S + full shim parity
display-profile.ts:generateTouchAdapter()         ← NEW FT6336U branch
ui-emitter.ts:emitUIRuntime()                     ← NEW capacitive poll branch (no z-pressure)
```

## Components

### C1. ST7796S display adapter — full rewrite

**File:** `packages/cuttlefish/src/api/shared/display-adapters/st7796.ts`

Replace the broken implementation with one matching `Adafruit_ST7796S`:

- **Includes:** `<Adafruit_ST7796S.h>` (not `Adafruit_ST7796.h`).
- **Declaration:** `Adafruit_ST7796S __tc_display = Adafruit_ST7796S(${cs}, ${dc}, ${rst});`
- **`display_init()`:**
  ```cpp
  __tc_display.init(320, 480, 0, 0, ST7796S_RGB);
  ${spiFreq ? `__tc_display.initSPI(${spiFreq});` : ""}
  __tc_display.setRotation(${rotation});
  __tc_display.fillScreen(0x0000);
  ```
  Note: `init()` (not `begin()`) is what sends the panel init sequence on this
  library — calling `begin()` alone would skip the panel init array entirely
  and yield a blank/garbled panel. SPI frequency handling is non-obvious:
  `Adafruit_ST77xx::begin(uint32_t freq)` is **protected**, so it cannot be
  called from outside the class. Meanwhile, `init()` internally calls
  `commonInit(NULL)` → `begin()` (no-arg) → `initSPI(SPI_DEFAULT_FREQ)`,
  which clobbers any previously-set SPI frequency to the 8 MHz default. To
  honor `spiFrequency` (the demo configures 80 MHz), call the public
  `Adafruit_SPITFT::initSPI(${spiFreq})` **after** `init()`. `initSPI` is what
  `begin()` itself delegates to internally, so this is the documented way to
  (re-)establish the SPI bus at a chosen frequency. The official Adafruit
  `ST7796S_demo.ino` sketch omits frequency management entirely (accepts the
  default) — our explicit `initSPI(freq)` post-`init()` is a deliberate, safe
  optimization. Verified by `arduino-cli compile` for `esp32:esp32:esp32`.
- **`display_writePixels(uint16_t* pixels, uint32_t count)`**: delegate to
  `__tc_display.writePixels(pixels, count)` (565 path, byte-identical with ILI9341).
- **565 enforcement:** if `display.colorFormat === "rgb666"`, throw a clear
  error explaining the Adafruit library hardcodes 565 and pointing to the
  follow-up issue. Do not emit the unrunnable 18-bit pack loop.
- **Full shim parity with ILI9341** (mirror the inline set from
  `display-adapter.ts` lines 78-166):
  - Core: `display_fillScreen(UI_COLOR_T)`, `display_defaultTarget`,
    `display_width/height`, `display_startWrite/endWrite`,
    `display_setAddrWindow`, `display_writePixels`.
  - Canvas: `display_createCanvas`, `display_createCanvasPsram`,
    `display_deleteCanvas`, `display_canvasWidth/Height/Buffer/GetPixel`,
    `display_canvasFillScreen`, `display_canvasFillRect`.
  - Target draw ops: `display_targetDrawPixel`, `display_targetWidth/Height`,
    `display_targetDrawRGBBitmap`, `display_targetFillRect`,
    `display_targetDrawFastHLine`, `display_targetDrawFastVLine`,
    `display_targetFillRoundRect`, `display_targetDrawRect`,
    `display_targetDrawRoundRect`, `display_targetDrawLine`,
    `display_targetFillCircle`, `display_targetDrawCircle`,
    `display_targetSetCursor`, `display_targetSetTextColor`,
    `display_targetSetTextColorBg`, `display_targetSetTextSize`,
    `display_targetSetTextWrap`, `display_targetPrint`.

  Without the canvas + target ops, the demo's `antialias: true` and
  `ui.drawCanvas` bindings would fail to compile.

- **`UI_COLOR_T` macro discipline:** draw-shim signatures use `UI_COLOR_T`
  (defined by `ui-emitter.ts`'s color-depth preamble) and cast to `uint16_t`
  at the call boundary, exactly as ILI9341 does. This keeps the adapter
  forward-compatible if a future 888 path is added.

### C2. FT6336U touch adapter — net-new

**File:** `packages/cuttlefish/src/api/shared/display-profile.ts`

Schema changes:

- `TouchLibrary` type widened to include `"FT6336U"`.
- `TouchProfile` interface gains two optional fields:
  - `i2cAddress?: number` — defaults to `0x38` in the codegen branch.
  - `resetPin?: number` — when present, `touch_init()` emits the user's
    required hardware-reset sequence before `begin()`.

New branch in `generateTouchAdapter()` emits:

```cpp
#include <Wire.h>
#include <RAK14014_FT6336U.h>
FT6336U __tc_touch(${i2cAddress});
static inline void touch_init() {
  ${resetPin ? hardware-reset sequence : ""}
  __tc_touch.begin(Wire, ${i2cAddress});
}
static inline bool touch_isTouched() {
  return __tc_touch.read_td_status() > 0;
}
static inline void touch_readRaw(int16_t* x, int16_t* y, int16_t* z) {
  FT6336U_TouchPointType __tp = __tc_touch.scan();
  if (x) *x = (int16_t)__tp.tp[0].x;
  if (y) *y = (int16_t)__tp.tp[0].y;
  if (z) *z = (__tp.touch_count > 0) ? 255 : 0;
}
```

The `Wire.h` include is added unconditionally for FT6336U (the library itself
includes `Wire.h`, but adding it explicitly keeps the include block
self-describing and matches how `<SPI.h>` is added for SPI drivers in
`ui-emitter.ts`).

### C3. Capacitive touch poll branch

**File:** `packages/cuttlefish/src/emit/emitters/ui-emitter.ts`

Currently `emitUIRuntime()` emits one `ui_poll_touch()` body that gates on
`__rawZ >= ${minPressure}` (lines 154-200). FT6336U has no real z-pressure.

Add a `CAPACITIVE_LIBS` set (`FT6336U`, and `sdl` already handles its own
branch) at the top of the touch-poll section. When the active library is in
that set, emit a poll body without the `minPressure` gate:

```cpp
void ui_poll_touch() {
  if (touch_isTouched()) {
    int16_t __rawX = 0, __rawY = 0, __rawZ = 0;
    touch_readRaw(&__rawX, &__rawY, &__rawZ);
    int16_t __tx = ${mapX};
    int16_t __ty = ${mapY};
    ui_handle_touch(__tx, __ty);
  } else {
    ui_handle_no_touch();
  }
}
```

The `mapX/mapY` derivation (rotation-aware, lines 159-178) is reused
unchanged. The XPT2046/STMPE610/resistive path keeps its `minPressure` gate.

### C4. Built-in ST7796S profile

**File:** `packages/framework-arduino/src/displays/st7796-spi.ts` (new)

```ts
import type { DisplayProfile } from "@typecad/cuttlefish/api/shared";

export const ST7796_SPI: DisplayProfile = {
  driver: "st7796",
  width: 320,
  height: 480,
  colorFormat: "rgb565",
  rotation: 1,                       // landscape → 480×320
  spiPins: { mosi: 23, sck: 18, miso: 19 },
};
```

**File:** `packages/framework-arduino/src/displays/ili9341-spi.ts`

Add the import and register in `BUILT_IN_PROFILES`:

```ts
import { ST7796_SPI } from "./st7796-spi.js";

export const BUILT_IN_PROFILES: Record<string, DisplayProfile> = {
  "ili9341-spi": ILI9341_SPI,
  "st7796-spi": ST7796_SPI,
  "ssd1309-i2c": SSD1309_I2C,
};
```

### C5. demo-st config

**File:** `demo-st/cuttlefish.config.ts`

Replace the `display` block:

```ts
display: {
  profile: 'st7796-spi',
  cs: 5,
  dc: 17,
  rst: 16,
  spiFrequency: 80000000,
  antialias: true,
  themeCss: 'C:/typecad/typecode/demo-ui/src/showcase.neobrutalism.css',
  themeClass: 'dark',
  touch: {
    library: 'FT6336U',
    i2cAddress: 0x38,
    resetPin: 4,
    irq: 14,
    calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
  },
},
```

Also fix `demo-st/package.json` `"name": "demo-ui"` → `"demo-st"` (currently
mismatched with the directory, harmless but confusing).

## Data Flow

```
Author writes cuttlefish.config.ts (display.profile='st7796-spi', touch.library='FT6336U')
  ↓
transpile.ts loads BUILT_IN_PROFILES (now includes st7796-spi)
  ↓
resolveDisplayProfile() → DisplayProfile { driver:'st7796', 320×480, touch:{library:'FT6336U', i2cAddress:0x38, resetPin:4} }
  ↓
setDisplayProfile() stores it; ui-emitter reads via getDisplayProfile()
  ↓
emitUIRuntime():
  1. generateDisplayAdapter(profile) → st7796.ts returns {includes, declaration, functions}
     - includes:    #include <Adafruit_ST7796S.h>   (+ GFX, CuttlefishDisplayTarget defines)
     - declaration: Adafruit_ST7796S __tc_display(...)
     - functions:   display_init() calls init(320,480,0,0,ST7796S_RGB) + setRotation
                    + full canvas/target shim family
  2. generateTouchAdapter(touch) → FT6336U branch
     - includes:    #include <Wire.h>, <RAK14014_FT6336U.h>
     - declaration: FT6336U __tc_touch(0x38)
     - functions:   touch_init() emits reset sequence + begin()
                    touch_isTouched() → read_td_status() > 0
                    touch_readRaw() → scan() → tp[0].{x,y}
  3. ui_poll_touch() body — capacitive branch, no minPressure gate
  4. emitRuntimeHeader() — unchanged (driver-agnostic)
  ↓
Generated main.ino / showcase.ino:
  - includes + __tc_display + display_* shims
  - includes + __tc_touch + touch_* shims
  - ui_poll_touch() calling touch_* (capacitive path)
  - setup() runs ui_init() → display_init() + touch_init()
  - loop() runs ui_tick() → ui_poll_touch()
```

## Error Handling

- **Unknown display profile:** `resolveDisplayProfile()` already throws listing
  available profiles — the new `st7796-spi` will appear in that list.
- **`st7796` driver with `rgb666`:** the rewritten adapter throws at codegen
  time: `"RGB666 is not supported by the Adafruit_ST7796S library (it hardcodes
  565 in its init sequence). Use rgb565, or patch/replace the library. See
  follow-up issue #TBD."`
- **Unknown touch library:** the existing throw in `generateTouchAdapter()`
  lists valid options — `FT6336U` will appear there.
- **FT6336U `begin()` failure:** the library's `begin()` returns `false` if
  `read_device_type() != 0x02`. v1 ignores the return value (matches how the
  existing XPT2046/STMPE610 branches ignore wiring errors). A follow-up could
  `Serial.printf` a warning; not in scope.

## Testing

Per `AGENTS.md`, runtime-header + display-adapter changes get focused tests.

**New test files:**

1. `tests/packages/cuttlefish/display-adapter-st7796.test.ts`
   - Builds the cuttlefish package, then calls `generateDisplayAdapter()` with a
     mock `ResolvedDisplay` (`driver:'st7796', colorFormat:'rgb565', rotation:1`,
     `_mountCs:5, _mountDc:17, _mountRst:16`).
   - Asserts generated C++ contains:
     - `Adafruit_ST7796S` (class) and `<Adafruit_ST7796S.h>` (include).
     - `__tc_display.init(320, 480, 0, 0, ST7796S_RGB)`.
     - The full `display_target*` shim set (DrawPixel, FillRect, FillCircle,
       DrawLine, SetCursor, SetTextColor, SetTextSize, Print, …).
     - The canvas shim set (`display_createCanvas`, `display_canvasFillScreen`,
       `display_canvasFillRect`, …).
   - Asserts that requesting `colorFormat:'rgb666'` throws with a message
     mentioning the Adafruit library / 565.

2. `tests/packages/cuttlefish/touch-adapter-ft6336u.test.ts`
   - Calls `generateTouchAdapter()` with `{library:'FT6336U', i2cAddress:0x38,
     resetPin:4, calibration:{...}}`.
   - Asserts generated C++ contains:
     - `<RAK14014_FT6336U.h>`, `<Wire.h>`.
     - `FT6336U __tc_touch(0x38)`.
     - `pinMode(4, OUTPUT)`, `digitalWrite(4, LOW)`, `delay(10)`,
       `digitalWrite(4, HIGH)`, `delay(500)` (the reset sequence).
     - `__tc_touch.begin(Wire, 0x38)`.
     - `__tc_touch.read_td_status() > 0`.
     - `__tc_touch.scan()` and `__tp.tp[0].x` / `__tp.tp[0].y`.
   - Asserts that when `resetPin` is absent, the reset sequence is **not**
     emitted (other boards without that wiring aren't affected).

3. Extend `tests/packages/cuttlefish/runtime-header.test.ts` (or a sibling) to
   cover the capacitive poll branch:
   - Build with a mock profile whose `touch.library === 'FT6336U'`.
   - Assert the emitted `ui_poll_touch()` body does **not** contain
     `__rawZ >= ` (no minPressure gate).
   - Build with `touch.library === 'XPT2046_Touchscreen'` and assert the
     minPressure gate **is** present (regression guard for the resistive path).

**Manual / integration verification (per AGENTS.md "Verification"):**

```sh
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish/runtime-header.test.ts
npx vitest run tests/packages/cuttlefish/display-adapter-st7796.test.ts
npx vitest run tests/packages/cuttlefish/touch-adapter-ft6336u.test.ts
npm run compile --workspace demo-ui      # ILI9341 regression — must still build
npm run build --workspace demo-st        # the new ST7796S + FT6336U target
```

The final end-to-end proof is flashing `demo-st` to the user's ESP32 + ST7796S +
FT6336U board; that is the user's call to make and outside what the test suite
can verify here.

## Scope Excluded (Follow-up)

Tracked as a separate piece of work after this lands:

1. **True RGB666 / 18-bit rendering.** Requires either vendoring a patched
   `Adafruit_ST7796S` fork (init `0x55`→`0x66`, COLMOD override) or writing a
   thin ST7796S driver wrapper that exposes an 18-bit `writePixels` path. The
   existing 18-bit pack math in the current `st7796.ts` is preserved as a
   reference in git history.
2. **IRQ-driven touch.** `irq: 14` is preserved in the config; switching from
   poll-in-`ui_tick` to `attachInterrupt` is a runtime-header change.
3. **Multi-touch.** FT6336U supports 2 simultaneous points; the runtime touch
   state machine is single-point today.

## Risks

- **SPI frequency on ST7796S at 80 MHz:** the ILI9341 demo runs at 80 MHz
  successfully on the same ESP32 wiring. The ST7796S panel is spec'd for the
  same range. If signal integrity issues appear on the longer traces of the
  320×480 board, the user can drop `spiFrequency` in config — no code change.
- **`init()` vs `begin()`/`initSPI()` ordering:** the rewritten adapter calls
  `init()` for panel setup, then the public `initSPI(${spiFreq})` to override
  the SPI frequency that `init()`'s internal `commonInit→begin()` clobbered to
  the 8 MHz default. `Adafruit_ST77xx::begin(uint32_t)` is protected, so the
  public `Adafruit_SPITFT::initSPI` is the correct API. This matches the
  working `examples/ST7796S_demo/ST7796S_demo.ino` reference sketch (which omits
  the frequency override and accepts the default), with our deliberate
  optimization layered on top. See C1 for the full rationale.
- **FT6336U `scan()` coordinate orientation:** the panel-pixel coords from
  `scan()` may already be rotation-aware in hardware (the FT6336U's own
  firmware handles rotation). If on-device testing shows mirrored/rotated
  touch, the `calibration` block and rotation flags in config can correct it
  without code changes — that's what they exist for.
