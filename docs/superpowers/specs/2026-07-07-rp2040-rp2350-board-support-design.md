# RP2040 + RP2350 Board Support (Arduino Framework)

**Date:** 2026-07-07
**Status:** Design — pending implementation
**Scope:** Add two new board targets (`rp2040` for the Raspberry Pi Pico, `rp2350` for the Pico 2) via separate MCU + board package pairs.

## Motivation

The RP2040 and RP2350 are the first non-ESP32, non-AVR boards in the system.
They're ARM Cortex-M MCUs from Raspberry Pi with no wireless, no PSRAM, and a
different Arduino core (earlephilhower's `arduino-pico`). The framework already
fully anticipates `rp2040`; `rp2350` is new.

## Goals

- `rp2040` and `rp2350` are selectable via `--board rp2040` / `--board rp2350`.
- Full and accurate silicon: all GPIOs with capabilities, ADC channels, bus
  defaults, strapping/flash-pin warnings.
- Framework-arduino treats both consistently: forced includes, A0 fallback,
  capability map. Neither needs `IRAM_ATTR` or `freeHeap()` (Cortex-M, not
  Xtensa — no cache-busy ISR constraint).

## Non-Goals

- No wireless (Wi-Fi/BLE) or USB-OTG modeling — these chips have neither.
- No PSRAM.
- No Arduino-core FQBN compile verification — the earlephilhower core isn't
  installed locally. Pin data comes from the well-established core docs.

## Silicon Data

### RP2040 (Raspberry Pi Pico)

- **Dual-core ARM Cortex-M0+ @ 133 MHz.** No FPU (M0+ lacks the extension).
- **30 GPIO (GP0–GP29).** GP0–GP22 are general-purpose; GP23–GP25 and GP29 are
  not pinned out on the Pico (used for internal SPI flash / PSRAM / LED). The
  `pins.all` array covers GP0–GP29; GP23–25/29 are flagged unsafe.
- **ADC:** 4 channels on GP26–GP29 (12-bit via the RP2040's ADC, 0–3.3 V).
  GP26–29 are the only analog-capable pins.
- **No DAC, no touch.**
- **Buses (Arduino core defaults):** I2C0 GP4 SDA / GP5 SCL; SPI0 GP3 MOSI /
  GP0 MISO (wait — let me verify the earlephilhower defaults — SPI0: GP19 MOSI
  / GP16 MISO / GP18 SCK / GP17 CS per the Pico datasheet); UART0 GP0 TX /
  GP1 RX.
- **Memory:** 264 KB SRAM (6 KB SRAM1 scratch + 264 KB SRAM0), 2 MB external
  QSPI flash (Pico module). `flash: 2097152`, `sram: 270336`.
- **Features:** `multicore: true`, `coreCount: 2`, `deepSleep: true`,
  `watchdog: true`, `externalInterrupts: true`, `hardwareRng: true`,
  `fpu: false`.

**Bus defaults (from the RP2040 datasheet + Pico pinout; verify against
earlephilhower core's `variant/rpipico/pins_arduino.h` once installed):**
- **I2C0:** GP4 SDA / GP5 SCL (Arduino `Wire`)
- **SPI0:** GP19 MOSI / GP16 MISO / GP18 SCK / GP17 CS (Arduino `SPI`)
- **UART0:** GP0 TX / GP1 RX (Arduino `Serial1`)

### RP2350 (Raspberry Pi Pico 2)

- **Dual-core ARM Cortex-M33 @ 150 MHz.** FPU present (M33 has FPv5-SP).
- **48 GPIO (GP0–GP47).** Pin-richer than the RP2040.
- **ADC:** 8 channels (GP26–GP33 on the RP2350 — expanded from the RP2040's 4).
- **No DAC, no touch, no wireless.**
- **Memory:** 520 KB SRAM, 4 MB external QSPI flash (Pico 2 module).
  `flash: 4194304`, `sram: 532480`.
- **Features:** `multicore: true`, `coreCount: 2`, `deepSleep: true`,
  `watchdog: true`, `externalInterrupts: true`, `hardwareRng: true`,
  `fpu: true`.

**Bus defaults (from the RP2350 datasheet + Pico 2 pinout):**
- **I2C0:** GP4 SDA / GP5 SCL (same as RP2040)
- **SPI0:** GP19 MOSI / GP16 MISO / GP18 SCK / GP17 CS (same as RP2040)
- **UART0:** GP0 TX / GP1 RX (same as RP2040)

## Framework Status + Edits

### RP2040: zero framework edits

`rp2040` is already fully anticipated:
- `ArchitectureIdentifier` (cuttlefish `board-types.ts` + hal `types.ts`)
- `PROFILE_VARIANTS` (`profile.ts:57`)
- `CAPABILITY_TABLE` (`profile.ts:103`)
- `FQBN_PIN_OVERRIDES` (`profile.ts:126`: `rp2040:rp2040:` → A0=26)
- Strategy capability map (`strategy.ts:1234`)

### RP2350: 5 framework edits

1. **`ArchitectureIdentifier`** (cuttlefish `board-types.ts:5-15` + hal `types.ts:118-129`):
   Add `| 'rp2350'` after `'rp2040'` in both copies.
2. **`PROFILE_VARIANTS`** (`profile.ts:57`):
   Add `{ architecture: "rp2350", forcedIncludes: ["<Arduino.h>"] }`.
3. **`CAPABILITY_TABLE`** (`profile.ts:103`):
   Add `rp2350` row mirroring `rp2040`; `fallbackPins.A0 = 26` (ADC starts at
   GP26, same as RP2040).
4. **`FQBN_PIN_OVERRIDES`** (`profile.ts:126`):
   Add `{ fqbnIncludes: "rp2350:rp2350:", pins: { A0: 26 } }`.
5. **Strategy capability map** (`strategy.ts:1234`):
   Add an `rp2350` block mirroring `rp2040` (`hasVector: true`, `hasString:
   true`, `hasIostream: true`, `hasExceptions: true`, `hasRTTI: true`,
   `recommendedArrayImpl: "std_vector"`, `recommendedStringImpl: "std_string"`).

**NOT added to `freeHeap()` / `isrFunctionAttribute()` / `heap-analysis`** —
those are ESP32-family checks for Xtensa cache-busy ISR constraints. RP2350 is
Cortex-M and does not use `IRAM_ATTR`. Adding it would be wrong.

## Package Layout

Four new packages, mirroring the ESP32 pattern.

### `packages/mcu-rp2040/`

| File | Purpose |
|---|---|
| `package.json` | `@typecad/mcu-rp2040`; deps cuttlefish + hal |
| `tsconfig.json` | References hal + cuttlefish |
| `src/index.ts` | `RP2040: MCUDefinition` + manifest |
| `src/pins.ts` | `GP0..GP29` Pin constants + bus aliases (SDA/SCL/MOSI/...) |
| `src/peripherals.ts` | I2C/SPI/UART/ADC instances + HAL instances |

### `packages/board-rp2040/`

| File | Purpose |
|---|---|
| `package.json` | `@typecad/board-rp2040`; deps cuttlefish + hal + mcu-rp2040 |
| `tsconfig.json` | References hal + cuttlefish + mcu-rp2040 |
| `src/index.ts` | `BoardDefinition`: FQBN `rp2040:rp2040:rpipico`, no `led` |
| `src/pins.ts` | `Dx`/`Ax` aliases |
| `src/analog.ts` | `DEFAULT` / `INTERNAL` |
| `src/board.ts` | `Board` namespace |

### `packages/mcu-rp2350/` and `packages/board-rp2350/`

Identical structure with RP2350 data. FQBN `rp2350:rp2350:rpipico2`.

## Registration, Tests, Docs

- Root `package.json` workspaces: add all 4 packages.
- `init-scaffold.ts` `_knownTargets`: add `rp2040` and `rp2350` entries.
- Tests: KNOWN_BOARDS assertions for both; profile tests for both (assert
  `<Arduino.h>` include + A0 suppression + that `isrFunctionAttribute()` returns
  `''` — unlike ESP32, RP2040/RP2350 don't use IRAM_ATTR).
- `README.md`: two board table rows + available-boards list entries.

## Pin Naming Convention

The RP2040/RP2350 use `GP<n>` (not `GPIO<n>`) as the pin name prefix, matching
the Raspberry Pi convention and the earlephilhower core's `pins_arduino.h`
(`pinGP0`, etc.). The generated Pin constants are `GP0 = new Pin(0)` etc.

## Verification Plan

1. `npm run build --workspaces` — all 4 new packages compile.
2. `npx vitest run tests/packages/transpiler/init-scaffold.test.ts` — KNOWN_BOARDS
   assertions pass.
3. `npx vitest run tests/packages/framework-arduino/` — profile tests pass.
4. Regression: `npx vitest run tests/packages/framework-arduino/ tests/packages/transpiler/`
   — no regressions.
5. **No `arduino-cli compile` verification** — the earlephilhower RP2040/RP2350
   core isn't installed locally. Pin data is sourced from the well-established
   datasheet + core docs.

## Risks & Open Points

- **Bus defaults** are sourced from the RP2040 datasheet + Pico pinout, not
  verified against the earlephilhower core's installed `pins_arduino.h` (since
  the core isn't installed). The defaults are well-documented and stable —
  I2C0=GP4/5, SPI0=GP19/16/18/17, UART0=GP0/1 — but the implementer should
  verify once the core is installed.
- **GP23–GP25 and GP29** are not pinned out on the Pico but DO exist on the
  RP2040 silicon (connected to internal flash/PSRAM/LED). Modeled as `unsafe`
  with warnings (same approach as the ESP32 flash pins).
- **No IRAM_ATTR** — the profile tests for RP2040/RP2350 assert
  `isrFunctionAttribute() === ''`, not `'IRAM_ATTR '`. This is correct for
  Cortex-M.
- **The RP2350 is new silicon** (released August 2024). Its pin data is
  well-documented in the official datasheet but less battle-tested than the
  RP2040's. Any discrepancies will surface as pin-safety warnings at compile
  time.
- **No `led`** on either board (generic shape, per the established convention).
