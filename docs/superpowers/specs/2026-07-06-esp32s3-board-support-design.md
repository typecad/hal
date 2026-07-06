# ESP32-S3 Board Support (Arduino Framework)

**Date:** 2026-07-06
**Status:** Design — pending implementation
**Scope:** Add a new board target (`esp32s3`) for the ESP32-S3 MCU, using the Arduino framework.

## Motivation

The repository already recognizes `esp32s3` as a valid `ArchitectureIdentifier`
and a few framework code paths already anticipate it (the `freeHeap()` check in
`framework-arduino/src/strategy.ts:234` and the heap-analysis gate in
`cuttlefish/src/ir/heap-analysis.ts:74` both list `esp32s3`). But there is no
board package, no MCU definition, and no entry in the known-targets registry,
so a user cannot actually target the ESP32-S3 today.

The ESP32-S3 is the natural next target after the classic ESP32 DevKit:
dual-core Xtensa LX7 @ 240 MHz, Wi-Fi 4 + BLE 5, **native USB-OTG** (a major
differentiator from the classic ESP32), 45 GPIOs, capacitive touch, and an
expanded pad layout. It shares the Arduino-ESP32 core with the classic ESP32,
so the FQBN pattern (`esp32:esp32s3:esp32s3`) and most framework handling carry
over directly — with a few surgical gaps to close.

## Goals

- A user can select `esp32s3` via the CLI wizard / `--board esp32s3` and scaffold
  a working Arduino project targeting the ESP32-S3.
- The board definition is **full and accurate**: all 45 GPIOs with correct
  capabilities, ADC/DAC/touch channel mappings, strapping-pin and USB/flash
  warnings, native USB / Wi-Fi / BLE peripherals, and correct memory specs.
- Framework-arduino treats `esp32s3` identically to classic `esp32` for the
  codegen paths that depend on architecture (forced includes, A0 fallback,
  ISR `IRAM_ATTR` attribute).

## Non-Goals

- No separate `@typecad/mcu-esp32s3` package. Per the agreed design, the MCU
  definition lives inside `board-esp32s3` (single package). A future refactor
  can extract it if a second S3 board is added.
- No PSRAM/partition-table/board-options tooling beyond what the existing
  `--board` + `frameworkData.buildTarget` flow already supports. Flash/PSRAM
  size selection happens via FQBN menu options (e.g.
  `esp32:esp32s3:esp32s3:FlashSize=16M,PSRAM=opi`), which already pass through
  untouched.
- No PlatformIO or IDE-template generation work; the existing
  data-driven `handleCreate` flow handles S3 once it is in the registry.
- No modeling of the S3's AI/vector-instruction accelerator.

## Architecture Decision: Single Board Package

The established repo pattern is a two-layer split (`mcu-*` + `board-*`).
This design deliberately deviates for the S3: the `MCUDefinition` is authored
**inside** `packages/board-esp32s3/src/mcu.ts` and referenced locally.

**Rationale:** there is currently only one S3 board target. Creating a separate
MCU package adds a workspace entry, a package, a tsconfig, and an inter-package
import for no reuse benefit. The `BoardDefinition` schema requires an
`mcu: MCUDefinition` field regardless, so the data shape is identical — only
the source location differs. If a second S3 board (e.g. a named vendor board)
is added later, `mcu.ts` can be lifted into its own package at that point with
a pure move.

This is a reversible, low-risk deviation.

## Package Layout

New package: `packages/board-esp32s3/`, mirroring `board-esp32-devkit`'s file
shape but with the MCU inlined.

| File | Purpose |
|---|---|
| `package.json` | Name `@typecad/board-esp32s3`; deps on `@typecad/cuttlefish` and `@typecad/hal`. **No** `@typecad/mcu-*` dep. |
| `tsconfig.json` | `composite: true`; references `../hal` and `../cuttlefish`. |
| `src/mcu.ts` | Exports `ESP32S3: MCUDefinition` — the silicon (new file vs. devkit, which imports its MCU). |
| `src/index.ts` | The `BoardDefinition` manifest (`ESP32S3Board`): spreads `...ESP32S3.pins/peripherals`, sets FQBN, board aliases, re-exports. |
| `src/pins.ts` | Arduino-style `D0`/`A0`/`LED` aliases → GPIO constants. |
| `src/analog.ts` | `DEFAULT` / `INTERNAL` analog-reference constants. |
| `src/board.ts` | `Board` namespace aggregating pins/peripherals + `definition`. |

### `src/mcu.ts` — the silicon

`architecture: 'esp32s3'`. The "full & accurate" detail:

**GPIOs (45):** GPIO 0–21 and GPIO 26–48. Notably **GPIO 22–25 and GPIO 32–37 do
not exist on the S3** — the S3 has a different/expanded pad layout from the
classic ESP32, and this is the most common porting gotcha. All S3 GPIOs are
bidirectional (unlike classic ESP32's input-only 34–39).

**`unsafe` set + warnings** (consumed by pin-safety validation):
- Strapping pins: GPIO0, GPIO3, GPIO45, GPIO46.
- USB pins: GPIO19 (D-) / GPIO20 (D+) — using them disables native USB.
- SPI flash / PSRAM pins: GPIO26–GPIO32 — tied to flash on most WROOM modules.

**ADC (two units, 12-bit, 0–3.3 V):**
- ADC1 = GPIO1–GPIO10 (10 channels) — always available.
- ADC2 = GPIO11–GPIO20 (10 channels) — **unusable while Wi-Fi is enabled**
  (noted via warning; this is an S3/ESP32 family constraint).

**DAC:** none on the S3 (removed vs. classic ESP32 — deliberately **omitted**,
not copied from `mcu-esp32`).

**Touch:** 14 channels on GPIO1–GPIO14 (capacitive).

**Buses:**
- I2C: 2 buses. Default I2C0: GPIO8 SDA / GPIO9 SCL; I2C1 remappable.
- SPI: 2. FSPI default GPIO11(MOSI)/GPIO13(MISO)/GPIO12(SCK); GPSI remappable.
- UART: 3. UART0 default GPIO43(TX)/GPIO44(RX).

**Memory (silicon-intrinsic, `mcu.memory`):**
`flash: 384*1024` (usable app flash; rest reserved), `sram: 512*1024`,
`rtcMemory: 16*1024`.

**Features (`FeatureFlags`):** `multicore: true`, `coreCount: 2`,
`deepSleep: true`, `watchdog: true`, `externalInterrupts: true`,
`hardwareRng: true`, `fpu: true`.

**Peripherals:**
- `wifi: { type: 'wifi', supportsStation: true, supportsAp: true }`
- `bluetooth: { type: 'ble', version: '5.0' }`
- `usb: { type: 'otg', vid: '0x303A', pid: '0x0001' }` (native USB-OTG —
  key S3 differentiator; `0x303A` is Espressif's assigned USB VID, used as the
  default for S3 CDC/DFU)
- Timers: 4 × general-purpose 52-bit + RTC + watchdog timers.

### `src/index.ts` — the board manifest

`ESP32S3Board: BoardDefinition`:
- `id: 'esp32s3'`, `name: 'ESP32-S3'`, `vendor: 'Espressif'`.
- `description` notes this is a vendor-agnostic entry for the generic ESP32-S3
  and that flash/PSRAM are module-dependent (see Memory below).
- `mcu: ESP32S3` (local import from `./mcu.js`).
- `clockSpeed: 240_000_000`.
- `pins: { ...ESP32S3.pins, led: 'GPIO48' }` — GPIO48 is the conventional
  onboard LED on S3 dev modules (DevKitC-1 addressable RGB).
- `peripherals: { ...ESP32S3.peripherals, aliases: { UART0:'Serial', UART1:'Serial1', UART2:'Serial2', I2C0:'Wire', I2C1:'Wire1', SPI0:'SPI', SPI1:'SPI1' } }`.
- `build.frameworks`: `{ platformio: 'esp32s3', arduino: 'esp32:esp32s3:esp32s3' }`.
- `build.defines`: `{ F_CPU: '240000000UL', ARDUINO: '10819', ARDUINO_ESP32S3_DEV: '1' }`.

The Arduino FQBN `esp32:esp32s3:esp32s3` (vendor:arch:board) is what makes
`framework-arduino` derive `architecture = 'esp32s3'` from the FQBN's middle
segment — getting this right is what activates all S3-gated code paths.

Re-exports follow the devkit pattern: HAL primitives from `@typecad/hal`, the
`pins` / `PeripheralPins` discovery objects, and barrel re-exports of
`./pins.js`, `./analog.js`, `./board.js`.

### Memory: configurable details

Per the agreed "reasonable default with configurable details" approach, memory
is split across the two layers:

- **Silicon (`mcu.memory`):** the chip's intrinsic values (above).
- **Board (`board.memory` override):** the **module** defaults —
  `externalRam: 2*1024*1024` (2 MB octal PSRAM, as on N8R2-class modules) and
  board-level `flash: 8*1024*1024` (8 MB module flash).

The `description` field documents how to override for other module variants via
the FQBN menu options, e.g.
`esp32:esp32s3:esp32s3:FlashSize=16M,PSRAM=opi`. This keeps the data model
honest (silicon vs. module) while giving a working default out of the box.

## Framework-Arduino Fixes (3 surgical gaps)

These are spots where S3 should behave like classic ESP32 but currently falls
through to a default:

1. **`packages/framework-arduino/src/profile.ts` — `PROFILE_VARIANTS` (line 50)**
   Add `{ architecture: "esp32s3", forcedIncludes: ["<Arduino.h>"] }`. Also add
   a matching `CAPABILITY_TABLE` (line 62) entry mirroring the `esp32` row, with
   `fallbackPins.A0 = 1` (ADC1 starts at GPIO1 on the S3).

2. **`packages/framework-arduino/src/profile.ts` — `FQBN_PIN_OVERRIDES` (line 96)**
   Add `{ fqbnIncludes: "esp32:esp32s3:", pins: { A0: 1 } }` so the A0 fallback
   resolves correctly for S3 FQBNs.

3. **`packages/framework-arduino/src/strategy.ts` — `isrFunctionAttribute()` (line 1003)**
   Currently `this._cachedArch === 'esp32'`. Broaden to the Xtensa ESP32 family
   set `{esp32, esp32s2, esp32s3, esp32c3}` — matching how `freeHeap()`
   (strategy.ts:234) already does it. The S3 (Xtensa LX7) needs `IRAM_ATTR` on
   ISRs for the same cache-busy reason as classic ESP32.

## Registration & Tests

### Root `package.json` workspaces

Add `"packages/board-esp32s3"` to the `workspaces` array.

### Known-targets registry

`packages/cuttlefish/src/create/init-scaffold.ts` `_knownTargets` (line 30) — add:

```ts
{
  id: 'esp32s3',
  displayName: 'ESP32-S3',
  isNative: false,
  architecture: 'esp32s3',
  boardPackage: '@typecad/board-esp32s3',
  frameworkPackage: '@typecad/framework-arduino',
  framework: 'arduino',
  buildTarget: 'esp32:esp32s3:esp32s3',
  mcu: 'ESP32-S3',
},
```

No edit is needed to `cli.ts`, `init-wizard.ts`, `config-schema.ts`,
`board-resolver.ts`, or either `board-types.ts` — all are data-driven from the
registry, already include `esp32s3` as a valid architecture, or use free-form
strings. (Verified during exploration.)

### Tests

- **`tests/packages/transpiler/init-scaffold.test.ts`** — mirror the existing
  `KNOWN_BOARDS` test (lines 203–210): assert the `esp32s3` target exists with
  `architecture: 'esp32s3'` and `buildTarget: 'esp32:esp32s3:esp32s3'`.
- **New focused tests for the framework-arduino fixes** — assert:
  - profile `resolveVariant` / capability resolution returns the `esp32s3` row,
    not the default profile;
  - A0 fallback resolves to `1` for an S3 FQBN;
  - `isrFunctionAttribute()` returns `'IRAM_ATTR '` for `esp32s3`.

No board-package-internal unit tests — current board packages have none, and the
convention is to validate boards at the transpiler/init-scaffold level.

## Documentation

- **`README.md`** — add an ESP32-S3 row to the board table (~line 84) and to the
  available-boards list (~line 333).
- **`SUPPORT_MATRIX.md`** — add an ESP32-S3 row.

## Verification Plan

Per AGENTS.md where it applies, plus package-specific checks:

1. `npm run build --workspace @typecad/board-esp32s3` — new package compiles.
2. `npm run build --workspace @typecad/cuttlefish` — refresh dist so tests don't
   hit stale files (AGENTS.md requirement for tests importing package exports).
3. `npm run build --workspace @typecad/framework-arduino` — refresh dist for the
   three fixes.
4. `npx vitest run tests/packages/transpiler/init-scaffold.test.ts` — the
   registry assertion passes and existing board assertions still pass.
5. `npx vitest run` the new framework-arduino focused tests — all pass.

## Risks & Open Points

- **ESP32-S3 pad layout differs from classic ESP32.** The most common porting
  mistake is assuming GPIO22–25 or GPIO32–37 exist. The MCU definition models
  the real S3 layout (0–21, 26–48), and any code targeting S3 that uses a
  nonexistent pin will surface a pin-safety warning — which is the desired
  behavior.
- **ADC2 ↔ Wi-Fi conflict** is documented via a warning but not enforced at
  compile time (the conflict is runtime/conditional). This matches how the
  classic ESP32 board handles the same constraint.
- **No `mcu-esp32s3` package** is a deliberate deviation from the two-layer
  pattern. It is documented in the Architecture Decision section above and is
  reversible.
- **Onboard LED (GPIO48)** is a convention, not a guarantee, for a
  "generic" board. GPIO48 is the safe default for S3 dev modules; the pin is
  also a normal GPIO if no LED is populated.
