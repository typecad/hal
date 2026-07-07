# ESP32-C3 Generic Devboard Support (Arduino Framework)

**Date:** 2026-07-07
**Status:** Design — pending implementation
**Scope:** Add a new board target (`esp32c3`) for the ESP32-C3 MCU, using the Arduino framework, via separate `@typecad/mcu-esp32c3` and `@typecad/board-esp32c3` packages.

## Motivation

The repository already recognizes `esp32c3` as a valid `ArchitectureIdentifier`
(`packages/cuttlefish/src/api/board-types.ts:10`) and the framework already
anticipates it in the `freeHeap()` check (`framework-arduino/src/strategy.ts:234`),
the `isrFunctionAttribute()` check (`strategy.ts:1004`), and the heap-analysis
gate (`cuttlefish/src/ir/heap-analysis.ts:74`). But there is no MCU package, no
board package, and no entry in the known-targets registry, so the ESP32-C3 is
not actually targetable today.

The ESP32-C3 fills a different niche from the ESP32-S3 and is not a clone of it:

- **RISC-V (RV32IMC), not Xtensa.** Single core @ 160 MHz, no FPU.
- **22 GPIO (0–10, 12–21)** — smaller package than the S3's 45. GPIO 11 is
  consumed by internal flash Vpp; there are no GPIO 22+.
- **No PSRAM support at all.** The C3 silicon has no external RAM interface
  (unlike the S3). There is no `PSRAM=` FQBN option, no `externalRam` in the
  memory spec, no `BOARD_HAS_PSRAM` code path. This is simpler than the S3.
- **Wi-Fi 4 + BLE 5 (long range)**, no Classic Bluetooth. Native USB Serial/JTAG
  (CDC) on GPIO18/GPIO19 — low-speed, not the S3's high-speed USB-OTG.
- **ADC1 (GPIO0–4) + ADC2 (GPIO5)** — ADC2 is Wi-Fi-conflicted.

## Goals

- A user can select `esp32c3` via the CLI wizard / `--board esp32c3` and scaffold
  a working Arduino project targeting the ESP32-C3.
- The board definition is **full and accurate**: all 22 GPIOs with correct
  capabilities, ADC1/ADC2 mapping with the Wi-Fi-conflict warning, touch
  channels, strapping/USB/flash-pin warnings, Wi-Fi/BLE/USB peripherals, and
  correct RISC-V/single-core memory specs.
- Framework-arduino treats `esp32c3` consistently with the rest of the ESP32
  family for the codegen paths that depend on architecture (forced includes,
  A0 fallback). The ISR `IRAM_ATTR` and `freeHeap()` paths already include it.

## Non-Goals

- **No PSRAM anything.** The C3 silicon does not support external RAM; there is
  nothing to model, flag, or wire.
- **No display/UI wiring** and no retargeting of any demo. Those are separate
  tasks; this spec only registers the board.
- **No Classic Bluetooth** (the C3 has none) and no modeling of the C3's
  dedicated AES/SHA/RSA hardware accelerator block.

## Architecture Decision: Separate MCU + Board Packages

Per the approved design and the lesson learned on the S3, this is a **two-layer
split**: `@typecad/mcu-esp32c3` describes the silicon and
`@typecad/board-esp32c3` describes the generic devboard. The board imports and
spreads the MCU.

**Why not a single inlined package (again):** the cuttlefish board resolver's
constant-merging step (`resolveAndMergeMCUConstants`, `board-resolver.ts:114`)
keys off an `import ... from '@typecad/mcu-*'` specifier inside the board's
`index.ts`. A relative `./mcu.js` import does not match, so the resolver
silently skips pin-data folding and pin-safety validation ends up with an empty
`unsafe` set. The separate-package shape is what makes the accurate pin data
actually reachable. This is the proven-correct pattern, now shared by the Uno,
classic ESP32, and S3.

## Package Layout

Two new packages, mirroring the S3 pair.

### `packages/mcu-esp32c3/`

| File | Purpose |
|---|---|
| `package.json` | Name `@typecad/mcu-esp32c3`; deps on `@typecad/cuttlefish`, `@typecad/hal`. Mirrors `mcu-esp32s3/package.json`. |
| `tsconfig.json` | `composite: true`; references `../hal`, `../cuttlefish`. Mirrors `mcu-esp32s3/tsconfig.json`. |
| `src/index.ts` | The `ESP32C3: MCUDefinition` const + default export + `TypeCADManifest` + barrel re-exports. |
| `src/pins.ts` | `GPIO0..GPIO10`, `GPIO12..GPIO21` Pin constants + bus aliases. |
| `src/peripherals.ts` | Standalone peripheral consts + `MCU_PERIPHERALS` aggregate + HAL instances. |

### `packages/board-esp32c3/`

| File | Purpose |
|---|---|
| `package.json` | Name `@typecad/board-esp32c3`; deps `@typecad/cuttlefish`, `@typecad/hal`, `@typecad/mcu-esp32c3`. |
| `tsconfig.json` | `composite: true`; references `../hal`, `../cuttlefish`, `../mcu-esp32c3`. |
| `src/index.ts` | The `BoardDefinition` manifest (`ESP32C3Board`): spreads the MCU, sets FQBN `esp32:esp32:esp32c3`, board aliases. **No `led` field** (per decision). |
| `src/pins.ts` | Arduino-style `Dx`/`Ax` aliases → GPIO constants. **No `LED` alias.** |
| `src/analog.ts` | `DEFAULT` / `INTERNAL` analog-reference constants. |
| `src/board.ts` | `Board` namespace aggregating pins + peripherals + `definition`. |

## ESP32-C3 Silicon Data (`mcu-esp32c3/src/index.ts`)

`architecture: 'esp32c3'`. The "full & accurate" detail:

### GPIOs (22)

GPIO 0–10 and GPIO 12–21. **GPIO 11 is absent** (consumed by internal flash
Vpp on the C3 package). There are no GPIO 22+ (the C3 is a smaller package than
the S3's 45-GPIO footprint). All C3 GPIOs are bidirectional — there are no
input-only pins (same property as the S3).

### `unsafe` set + warnings (consumed by pin-safety validation)

- **Strapping pins:** GPIO2 (boot mode), GPIO8 (boot mode / VDD_SPI voltage),
  GPIO9 (reset — must be HIGH at boot).
- **USB pins:** GPIO18 (D-), GPIO19 (D+) — using them as GPIO disables the
  native USB Serial/JTAG.
- **SPI flash / PSRAM pins:** GPIO26–32 (the C3's internal flash uses the
  SPICS0/SPICLK/SPIQ/SPID/SPIHD/SPIWP naming; these are not broken out on
  modules and must not be used as GPIO).

  **Note:** the C3's broken-out GPIO range is 0–21, so GPIO26–32 are not in the
  `pins.all` array at all — the flash pins are simply omitted from the user-
  facing pinout, which is itself the safest representation. The `unsafe` set
  therefore covers only the broken-out strapping + USB pins (GPIO2, GPIO8,
  GPIO9, GPIO18, GPIO19). The internal flash pins are documented in this spec
  for completeness but do not appear in `pins.all`.

### ADC (per approved decision: ADC1 + ADC2 with warning)

Two units, 12-bit, 0–3.3 V:

- **ADC1** = GPIO0–GPIO4 (ch0–ch4) — always usable.
- **ADC2** = GPIO5 (ch0) — **NOT usable while Wi-Fi is enabled**, and the C3
  has Wi-Fi enabled in essentially all practical use. Modeled with a warning
  string on GPIO5, mirroring how `mcu-esp32` and `mcu-esp32s3` handle ADC2.

### DAC

None on the C3 (deliberately omitted, same as the S3).

### Touch

6 channels on GPIO0–GPIO5 (the C3's reduced capacitive-touch controller).

### Buses — Arduino-ESP32 core defaults (per decision)

The C3 datasheet's hardware-default FSPI pins (GPIO6/7/8/9) collide with the
I2C default (GPIO8/9), so the Arduino-ESP32 core ships different `SPI.begin()`
defaults for the C3. This board uses the **Arduino core's effective defaults**
(verified from `variants/esp32c3/pins_arduino.h`) so `SPI.begin()` /
`Wire.begin()` / `Serial` work out of the box:

- **I2C** (1 bus): default GPIO8 SDA / GPIO9 SCL; remappable via the GPIO
  matrix.
- **SPI** (1 bus — GPSPI2): default GPIO6 MOSI / GPIO5 MISO / GPIO4 SCK / GPIO7
  SS (per `pins_arduino.h`: `MOSI=6, MISO=5, SCK=4, SS=7`); remappable.
- **UART** (2): UART0 default GPIO21 TX / GPIO20 RX (per `pins_arduino.h`:
  `TX=21, RX=20`); UART1 remappable.
- **Analog aliases** map to ADC1: `A0=0, A1=1, A2=2, A3=3, A4=4` and
  `A5=5` (the ADC2/Wi-Fi-conflicted pin). These match the core's `A0..A5`
  defines.

### Memory (silicon-intrinsic, `mcu.memory`)

`flash: 384 * 1024` (usable app flash; remainder reserved by bootloader),
`sram: 400 * 1024` (400 KB), `eeprom: 0`, `rtcMemory: 16 * 1024`. **No
`externalRam`** — the C3 silicon does not support external RAM.

### Features (`FeatureFlags`)

`multicore: false`, `coreCount: 1`, `deepSleep: true`, `watchdog: true`,
`externalInterrupts: true`, `hardwareRng: true`, `fpu: false`.

### Peripherals

- `wifi: { type: 'wifi', supportsStation: true, supportsAp: true }`
- `bluetooth: { type: 'ble', version: '5.0' }` (BLE 5 long-range)
- `usb: { type: 'otg', vid: '0x303A', pid: '0x0001' }` (Espressif VID; native
  USB Serial/JTAG CDC on GPIO18/GPIO19)
- Timers: 4 × general-purpose 52-bit; declared as `bits: 64` (the schema's
  `TimerDefinition.bits` union is `8|16|32|64` and does not include 52 — same
  accommodation as the S3).

## Board Manifest (`board-esp32c3/src/index.ts`)

`ESP32C3Board: BoardDefinition`:

- `id: 'esp32c3'`, `name: 'ESP32-C3'`, `vendor: 'Espressif'`.
- `description`: notes this is a vendor-agnostic generic ESP32-C3 devboard.
- `mcu: ESP32C3` (imported from `@typecad/mcu-esp32c3`).
- `clockSpeed: 160_000_000` (160 MHz).
- **`memory` override (module-level):** `flash: 4 * 1024 * 1024` (4 MB module
  flash). **No `externalRam`** — the C3 does not support it, so there is no
  configurable-PSRAM story (contrast the S3, which declared 2 MB octal PSRAM).
- `pins: { ...ESP32C3.pins }` — **no `led` field** (per decision: ignore the
  LED). The board does not declare an onboard LED pin.
- `peripherals: { ...ESP32C3.peripherals, aliases: { UART0:'Serial', UART1:'Serial1', I2C0:'Wire', SPI0:'SPI' } }`.
- `build.frameworks`: `{ platformio: 'esp32c3', arduino: 'esp32:esp32:esp32c3' }`.
- `build.defines`: `{ F_CPU: '160000000UL', ARDUINO: '10819', ARDUINO_ESP32C3_DEV: '1' }`.

The FQBN `esp32:esp32:esp32c3` (vendor `esp32`, platform `esp32`, board
`esp32c3` — the "ESP32C3 Dev Module") is correct: the ESP32 Arduino core
collapses the whole family into the `esp32:esp32` platform and encodes the chip
variant in the **board** id, not a separate platform segment. This is the same
collapsed-platform shape as the S3's `esp32:esp32:esp32s3`, which we verified
the hard way. Getting the FQBN right is what activates the framework's C3-aware
code paths (which derive architecture from the FQBN's platform segment — for the
C3 this yields `'esp32'`, and C3 inherits the `esp32` profile/IRAM behavior,
which is correct since both need the same ISR/heap handling).

## Framework-Arduino Fixes (2 surgical gaps)

The C3 needs fewer fixes than the S3 did, because `esp32c3` is already included
in two of the three framework checks:

| Framework path | Already includes `esp32c3`? | Action |
|---|---|---|
| `freeHeap()` (`strategy.ts:234`) | ✅ yes | none |
| `isrFunctionAttribute()` (`strategy.ts:1004`) | ✅ yes | none |
| `profile.ts` PROFILE_VARIANTS / CAPABILITY_TABLE / FQBN_PIN_OVERRIDES | ❌ no | add |

The two fixes:

1. **`packages/framework-arduino/src/profile.ts` — `PROFILE_VARIANTS` (line 50)**
   Add `{ architecture: "esp32c3", forcedIncludes: ["<Arduino.h>"] }`.

2. **`packages/framework-arduino/src/profile.ts` — `CAPABILITY_TABLE` (line 62)
   and `FQBN_PIN_OVERRIDES` (line 96)**
   Add an `esp32c3` capability row mirroring the `esp32` row, with
   `fallbackPins.A0 = 0` (ADC1 starts at GPIO0 on the C3, vs GPIO1 on the S3
   and GPIO36 on the classic ESP32). Add
   `{ fqbnIncludes: "esp32:esp32c3:", pins: { A0: 0 } }` to
   `FQBN_PIN_OVERRIDES`.

## Registration & Tests

### Root `package.json` workspaces

Add `"packages/mcu-esp32c3"` and `"packages/board-esp32c3"`.

### Known-targets registry

`packages/cuttlefish/src/create/init-scaffold.ts` `_knownTargets` — add:

```ts
{
  id: 'esp32c3',
  displayName: 'ESP32-C3',
  isNative: false,
  architecture: 'esp32c3',
  boardPackage: '@typecad/board-esp32c3',
  frameworkPackage: '@typecad/framework-arduino',
  framework: 'arduino',
  buildTarget: 'esp32:esp32:esp32c3',
  mcu: 'esp32c3',
},
```

Note `mcu: 'esp32c3'` (not `'ESP32-C3'`). The init-templates scaffolder wraps a
non-`@`-prefixed `mcu` value as `@typecad/mcu-${mcu}`, so this produces
`@typecad/mcu-esp32c3`. This is the bug we hit and fixed on the S3 — using the
lowercase architecture id (not the display name) is what avoids generating the
broken `@typecad/mcu-ESP32-C3`.

No edit is needed to `cli.ts`, `init-wizard.ts`, `config-schema.ts`,
`board-resolver.ts`, `strategy.ts` (`freeHeap`/`isrFunctionAttribute`), or
either `board-types.ts` — all are data-driven, already include `esp32c3`, or
use free-form strings.

### Tests

- **`tests/packages/transpiler/init-scaffold.test.ts`** — mirror the existing
  `KNOWN_BOARDS` test for `esp32s3`: assert the `esp32c3` target exists with
  `architecture: 'esp32c3'` and `buildTarget: 'esp32:esp32:esp32c3'`.
- **New `tests/packages/framework-arduino/esp32c3-profile.test.ts`** — mirror
  `esp32s3-profile.test.ts`: assert the C3 FQBN resolves to `<Arduino.h>` in
  forced includes, suppresses the A0 shim, and that `isrFunctionAttribute()`
  returns `'IRAM_ATTR '` after profile resolution. (Same lazy-cache priming
  pattern: call `forcedIncludes()` first, then read `isrFunctionAttribute()`.)

No board-package-internal unit tests — current board packages have none, and the
convention is to validate boards at the transpiler/init-scaffold level.

## Documentation

- **`README.md`** — add an ESP32-C3 row to the board table (~line 84) and to
  the available-boards list (~line 333).

## Verification Plan

1. `npm run build --workspace @typecad/mcu-esp32c3` — new package compiles.
2. `npm run build --workspace @typecad/board-esp32c3` — new package compiles.
3. `npm run build --workspace @typecad/cuttlefish` — refresh dist (AGENTS.md).
4. `npm run build --workspace @typecad/framework-arduino` — refresh dist for the
   profile fixes.
5. `npx vitest run tests/packages/transpiler/init-scaffold.test.ts` — the
   registry assertion passes and existing board assertions still pass.
6. `npx vitest run tests/packages/framework-arduino/esp32c3-profile.test.ts` —
   new profile tests pass.
7. Regression: `npx vitest run tests/packages/framework-arduino/ tests/packages/transpiler/`
   — no regressions from the profile changes.
8. Optional end-to-end: scaffold a throwaway C3 project and run
   `cuttlefish build --compile` to confirm the `esp32:esp32:esp32c3` FQBN links
   against the installed `esp32:esp32` core.

## Risks & Open Points

- **GPIO 11 absence.** The C3 package uses GPIO11 for internal flash Vpp; it is
  simply omitted from `pins.all` (the safest representation). Any code targeting
  a nonexistent pin will surface a pin-safety warning.
- **ADC2 ↔ Wi-Fi conflict** is documented via a warning but not enforced at
  compile time (the conflict is runtime/conditional). This matches how the
  classic ESP32 and S3 boards handle the same constraint.
- **No PSRAM** is a silicon fact, not a scope limitation — there is nothing to
  model or flag. This is simpler than the S3.
- **No onboard LED** declared, per the approved decision. The `pins.led` field
  is omitted; sketches that drive an LED must reference a GPIO directly. (Note:
  the Arduino-ESP32 C3 variant *does* define `PIN_RGB_LED 8` and `LED_BUILTIN`,
  but per the decision this board package leaves `led` unset — a generic C3
  board has no guaranteed LED, and GPIO8 is also a strapping pin.)
- **`bits: 64` on timers** is a schema accommodation (the C3's timers are
  52-bit but the `TimerDefinition.bits` union does not include 52). Same as the
  S3.
