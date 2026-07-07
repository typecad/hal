# ESP32-C6 Generic Devboard Support (Arduino Framework)

**Date:** 2026-07-07
**Status:** Design — pending implementation
**Scope:** Add a new board target (`esp32c6`) for the ESP32-C6 MCU, via separate `@typecad/mcu-esp32c6` and `@typecad/board-esp32c6` packages.

## Motivation

The ESP32-C6 is the first ESP32 to ship Wi-Fi 6 (802.11ax) and is a
single-core RISC-V (RV32IMAC) part with a low-power LP coprocessor. Unlike
the S3 and C3 (which were partially anticipated by the framework), the C6 is
**not referenced anywhere** in the framework today — it needs to be added to
the `ArchitectureIdentifier` union and to every ESP32-family code path, not
just the profile.

Key C6 differentiators the design respects:

- **RISC-V RV32IMAC HP core @ 160 MHz**, single-core. No FPU (`IMAC` lacks
  the F extension). The LP core is omitted from the programming model (it
  can't run Arduino code) — per decision, `multicore: false`, `coreCount: 1`.
- **Wi-Fi 6 (802.11ax)** — first ESP32 with it. Modeled as
  `type: 'wifi6'` (the schema supports this value). BLE 5.3.
- **30 GPIO (0–7, 8–14, 15–30)** — pin-richer than the C3's 22.
- **ADC1 with 7 channels (GPIO0–6)**, ADC2 with 1 channel (GPIO7,
  Wi-Fi-conflicted, modeled with warning — consistent with C3/S3).
- **Native USB Serial/JTAG AND USB-OTG** (the C6 has both — unlike the C3,
  which has only CDC/JTAG).
- **No PSRAM support** — the C6 silicon has no external RAM interface.

## Goals

- A user can select `esp32c6` via the CLI / `--board esp32c6` and scaffold a
  working Arduino project targeting the ESP32-C6.
- The board definition is **full and accurate**: all 30 GPIOs with correct
  capabilities, ADC1/ADC2 mapping with the Wi-Fi-conflict warning, strapping
  and USB-pin warnings, Wi-Fi 6 / BLE 5.3 / USB-OTG peripherals, and correct
  RISC-V/single-core memory specs.
- Framework-arduino treats `esp32c6` consistently with the rest of the ESP32
  family for *every* architecture-keyed code path (not just the profile).

## Non-Goals

- **No PSRAM anything.** The C6 silicon does not support external RAM.
- **No display/UI wiring**, no demo retarget.
- **No LP-core programming model.** The LP core exists on the silicon but is
  not modeled as a programmable core (per decision).
- **No Classic Bluetooth** (the C6 has none).

## Architecture Decision: Separate MCU + Board Packages

Two-layer split, identical to the S3 and C3: `@typecad/mcu-esp32c6` describes
the silicon; `@typecad/board-esp32c6` describes the generic devboard. The
board imports and spreads the MCU. This is the proven-correct shape (the
board resolver's constant-merging keys off `@typecad/mcu-*` imports).

## Package Layout

Two new packages mirroring the C3 pair.

### `packages/mcu-esp32c6/`

| File | Purpose |
|---|---|
| `package.json` | Name `@typecad/mcu-esp32c6`; deps on `@typecad/cuttlefish`, `@typecad/hal`. |
| `tsconfig.json` | `composite: true`; references `../hal`, `../cuttlefish`. |
| `src/index.ts` | The `ESP32C6: MCUDefinition` const + default export + `TypeCADManifest` + barrel re-exports. |
| `src/pins.ts` | `GPIO0..GPIO30` Pin constants + bus aliases. |
| `src/peripherals.ts` | Standalone peripheral consts + `MCU_PERIPHERALS` aggregate + HAL instances. |

### `packages/board-esp32c6/`

| File | Purpose |
|---|---|
| `package.json` | Name `@typecad/board-esp32c6`; deps cuttlefish, hal, **mcu-esp32c6**. |
| `tsconfig.json` | References `../hal`, `../cuttlefish`, `../mcu-esp32c6`. |
| `src/index.ts` | The `BoardDefinition` manifest (`ESP32C6Board`): spreads MCU, FQBN `esp32:esp32:esp32c6`, no `led`. |
| `src/pins.ts` | Arduino-style `Dx`/`Ax` aliases. No `LED`. |
| `src/analog.ts` | `DEFAULT` / `INTERNAL` analog-reference constants. |
| `src/board.ts` | `Board` namespace aggregating pins + peripherals + `definition`. |

## ESP32-C6 Silicon Data (`mcu-esp32c6/src/index.ts`)

`architecture: 'esp32c6'`. The "full & accurate" detail. Pin defaults verified
against `variants/esp32c6/pins_arduino.h` in the installed Arduino-ESP32 core:

### GPIOs (30)

GPIO 0–7, 8–14, 15–30. All bidirectional (no input-only pins — same property
as the C3/S3). GPIO 27–30 are tied to internal SPI flash/PSRAM on most C6
modules and are flagged unsafe if broken out.

### `unsafe` set + warnings

- **Strapping pins:** GPIO9 (boot mode), GPIO13 (strapping).
- **USB pins:** GPIO26 (D-), GPIO27 (D+) — using them as GPIO disables native
  USB.
- **SPI flash pins:** GPIO28–30 (internal flash; flagged unsafe, documented).

### ADC (ADC1 + ADC2 with warning)

Two units, 12-bit, 0–3.3 V:

- **ADC1** = GPIO0–GPIO6 (ch0–ch6, 7 channels) — always usable.
- **ADC2** = GPIO7 (ch0, 1 channel) — NOT usable while Wi-Fi is on. Modeled
  with a warning, mirroring C3/S3.

### DAC

None (omitted, same as C3/S3).

### Buses — Arduino-ESP32 core defaults (verified)

From `variants/esp32c6/pins_arduino.h`:

- **I2C** (1 bus): GPIO23 SDA / GPIO22 SCL; remappable.
- **SPI** (1 bus — GPSPI): GPIO19 MOSI / GPIO20 MISO / GPIO21 SCK / GPIO18 SS;
  remappable.
- **UART** (2): UART0 GPIO16 TX / GPIO17 RX; UART1 remappable.

### Memory (silicon-intrinsic, `mcu.memory`)

`flash: 384 * 1024` (usable app flash), `sram: 512 * 1024` (512 KB),
`eeprom: 0`, `rtcMemory: 16 * 1024`. **No `externalRam`** — the C6 silicon
does not support external RAM.

### Features (`FeatureFlags`)

`multicore: false`, `coreCount: 1`, `deepSleep: true`, `watchdog: true`,
`externalInterrupts: true`, `hardwareRng: true`, `fpu: false`.

### Peripherals

- `wifi: { type: 'wifi6', supportsStation: true, supportsAp: true }` (Wi-Fi 6)
- `bluetooth: { type: 'ble', version: '5.3' }`
- `usb: { type: 'otg', vid: '0x303A', pid: '0x0001' }` (USB Serial/JTAG + OTG)
- Timers: 4 × general-purpose, declared as `bits: 64` (schema accommodation —
  same as C3/S3).

## Board Manifest (`board-esp32c6/src/index.ts`)

`ESP32C6Board: BoardDefinition`:

- `id: 'esp32c6'`, `name: 'ESP32-C6'`, `vendor: 'Espressif'`.
- `mcu: ESP32C6`, `clockSpeed: 160_000_000` (160 MHz).
- **`memory` override:** `flash: 4 * 1024 * 1024` (4 MB module flash). **No
  `externalRam`** — C6 silicon doesn't support it.
- `pins: { ...ESP32C6.pins }` — **no `led` field** (generic board, per the
  precedent set on C3).
- `peripherals.aliases`: `{ UART0:'Serial', UART1:'Serial1', I2C0:'Wire', SPI0:'SPI' }`.
- `build.frameworks`: `{ platformio: 'esp32c6', arduino: 'esp32:esp32:esp32c6' }`.
- `build.defines`: `{ F_CPU: '160000000UL', ARDUINO: '10819', ARDUINO_ESP32C6_DEV: '1' }`.

The FQBN `esp32:esp32:esp32c6` (vendor `esp32`, platform `esp32`, board
`esp32c6` — the "ESP32C6 Dev Module") is correct: the ESP32 Arduino core
collapses the family into the `esp32:esp32` platform and encodes the chip
variant in the board id. Same collapsed-platform shape as S3/C3. The framework
derives `_cachedArch` from the FQBN platform segment → `'esp32'`, so the C6
inherits the `esp32` profile/IRAM behavior (correct: the C6 needs the same ISR
handling, and it's RISC-V but the IRAM_ATTR requirement is an ESP32-family
silicon fact, not ISA-specific).

## Framework Fixes — the FULL set (C6 is not anticipated anywhere)

Unlike the C3 (which was already in `board-types`, `freeHeap`,
`isrFunctionAttribute`, and `heap-analysis`), the C6 needs to be added to
**every** ESP32-family code path. This is the most framework work of the three
boards added in this session.

| Framework path | Already includes `esp32c6`? | Action |
|---|---|---|
| `ArchitectureIdentifier` (cuttlefish + hal) | ❌ no | add `'esp32c6'` to both unions |
| `freeHeap()` (`strategy.ts:234`) | ❌ no | add `\|\| arch === 'esp32c6'` |
| `isrFunctionAttribute()` (`strategy.ts:1004`) | ❌ no | add `\|\| arch === 'esp32c6'` |
| `heap-analysis.ts:74` | ❌ no | add `\|\| arch === 'esp32c6'` |
| `profile.ts` PROFILE_VARIANTS / CAPABILITY_TABLE / FQBN_PIN_OVERRIDES | ❌ no | add |

The edits:

1. **`packages/cuttlefish/src/api/board-types.ts:9`** — add `| 'esp32c6'` to
   the `ArchitectureIdentifier` union (after `esp32c3`).
2. **`packages/hal/src/core/board-types.ts`** — same addition (the union is
   duplicated in both packages; both must stay in sync).
3. **`packages/framework-arduino/src/strategy.ts:234`** (`freeHeap`) — add
   `|| arch === 'esp32c6'` to the existing
   `arch === 'esp32' || 'esp32s2' || 'esp32s3' || 'esp32c3'` check.
4. **`packages/framework-arduino/src/strategy.ts:1004`** (`isrFunctionAttribute`)
   — same addition.
5. **`packages/cuttlefish/src/ir/heap-analysis.ts:74`** — same addition.
6. **`packages/framework-arduino/src/profile.ts`** — PROFILE_VARIANTS:
   `{ architecture: "esp32c6", forcedIncludes: ["<Arduino.h>"] }`.
   CAPABILITY_TABLE: `esp32c6` row, `fallbackPins.A0 = 0` (ADC1 starts at
   GPIO0). FQBN_PIN_OVERRIDES: `{ fqbnIncludes: "esp32:esp32c6:", pins: { A0: 0 } }`.

## Registration & Tests

### Root `package.json` workspaces

Add `"packages/mcu-esp32c6"` and `"packages/board-esp32c6"`.

### Known-targets registry

`packages/cuttlefish/src/create/init-scaffold.ts` `_knownTargets` — add:

```ts
{
  id: 'esp32c6',
  displayName: 'ESP32-C6',
  isNative: false,
  architecture: 'esp32c6',
  boardPackage: '@typecad/board-esp32c6',
  frameworkPackage: '@typecad/framework-arduino',
  framework: 'arduino',
  buildTarget: 'esp32:esp32:esp32c6',
  mcu: 'esp32c6',
},
```

Note `mcu: 'esp32c6'` (lowercase arch id) — avoids the scaffolder bug hit on
the S3.

### Tests

- **`tests/packages/transpiler/init-scaffold.test.ts`** — KNOWN_BOARDS test for
  `esp32c6`: assert architecture `'esp32c6'` and buildTarget
  `'esp32:esp32:esp32c6'`.
- **New `tests/packages/framework-arduino/esp32c6-profile.test.ts`** — mirror
  `esp32c3-profile.test.ts`: forced includes, A0 suppression, IRAM_ATTR
  behavior with the C6 FQBN.

## Documentation

- **`README.md`** — add ESP32-C6 to the board table and the available-boards
  list.

## Verification Plan

1. `npm run build --workspace @typecad/mcu-esp32c6` — compiles.
2. `npm run build --workspace @typecad/board-esp32c6` — compiles.
3. `npm run build --workspace @typecad/cuttlefish` and `--workspace @typecad/framework-arduino`
   — refresh dist (AGENTS.md) after the union/checks/profile edits.
4. `npx vitest run tests/packages/transpiler/init-scaffold.test.ts tests/packages/framework-arduino/esp32c6-profile.test.ts`
   — new tests pass.
5. Regression: `npx vitest run tests/packages/framework-arduino/ tests/packages/transpiler/`
   — no regressions.
6. End-to-end: direct `arduino-cli compile --fqbn "esp32:esp32:esp32c6"` on a
   trivial sketch confirms the FQBN links against the installed core.

## Risks & Open Points

- **`esp32c6` is genuinely new to the framework.** This requires more edits
  than the C3 (5 framework spots vs 1 profile file). Each is a one-line
  addition to an existing ESP32-family check — low risk, but more surface area.
- **The duplicated `ArchitectureIdentifier` union** (cuttlefish + hal) must be
  edited in both places. The unions are currently identical; adding `esp32c6`
  to one and not the other would silently re-diverge them.
- **No PSRAM** is a silicon fact (same as the C3).
- **No `led`** declared, per the precedent set on C3 (generic board).
- **Wi-Fi 6 (`type: 'wifi6'`)** is the first use of that schema value — verify
  the schema accepts it (it should, per the S3 exploration; confirm during
  implementation).
- **`bits: 64` on timers** is the same schema accommodation as C3/S3.
