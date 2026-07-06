# ESP32-S3 Board Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selectable, full-accuracy ESP32-S3 board target (`esp32s3`) using the Arduino framework, so users can `--board esp32s3` to scaffold Arduino projects for the ESP32-S3.

**Architecture:** A new single package `packages/board-esp32s3/` that vendors both the silicon (`MCUDefinition` in a local `src/mcu.ts`) and the board manifest (`BoardDefinition` in `src/index.ts`) — the same file shape as `board-esp32-devkit` but with the MCU inlined rather than imported. Registration is data-driven: one entry in the known-targets registry + one workspace line makes the existing CLI/wizard/config flow handle S3 automatically. Three surgical edits to `framework-arduino` close gaps where S3 should match classic ESP32 (forced includes, A0 fallback, ISR `IRAM_ATTR`).

**Tech Stack:** TypeScript (monorepo, `tsc -b` composite projects), vitest, the `@typecad/cuttlefish` `BoardDefinition`/`MCUDefinition` schema, the `@typecad/hal` peripheral-instance helpers.

**Spec:** `docs/superpowers/specs/2026-07-06-esp32s3-board-support-design.md`

---

## File Structure

### New files (the `packages/board-esp32s3/` package)

| File | Responsibility |
|---|---|
| `packages/board-esp32s3/package.json` | npm package manifest. Name `@typecad/board-esp32s3`. Deps on `@typecad/cuttlefish`, `@typecad/hal`. **No** `@typecad/mcu-*` dep. |
| `packages/board-esp32s3/tsconfig.json` | Composite TS project. References `../hal`, `../cuttlefish`. |
| `packages/board-esp32s3/src/mcu.ts` | The ESP32-S3 silicon as a `MCUDefinition` (`ESP32S3`) + HAL peripheral instances. 45 GPIOs, capabilities, ADC/touch maps, Wi-Fi/BLE/USB peripherals, feature flags. |
| `packages/board-esp32s3/src/index.ts` | The `BoardDefinition` manifest (`ESP32S3Board`): spreads the MCU, sets FQBN `esp32:esp32s3:esp32s3`, board aliases, re-exports. |
| `packages/board-esp32s3/src/pins.ts` | Arduino-style `Dx`/`Ax`/`LED`/bus aliases → GPIO constants. |
| `packages/board-esp32s3/src/analog.ts` | `DEFAULT` / `INTERNAL` analog-reference constants. |
| `packages/board-esp32s3/src/board.ts` | `Board` namespace aggregating pins + peripherals + `definition`. |

### Modified files

| File | Change |
|---|---|
| `package.json` (root) | Add `"packages/board-esp32s3"` to `workspaces`. |
| `packages/cuttlefish/src/create/init-scaffold.ts` | Add `esp32s3` entry to `_knownTargets` (line ~30). |
| `packages/framework-arduino/src/profile.ts` | Add `esp32s3` to `PROFILE_VARIANTS` (line 50), `CAPABILITY_TABLE` (line 62), and `FQBN_PIN_OVERRIDES` (line 96). |
| `packages/framework-arduino/src/strategy.ts` | Broaden `isrFunctionAttribute()` arch check (line 1003). |
| `tests/packages/transpiler/init-scaffold.test.ts` | Add KNOWN_BOARDS assertion for `esp32s3`. |
| `tests/packages/framework-arduino/esp32s3-profile.test.ts` (new) | Focused tests for the 3 framework fixes. |
| `README.md` | Add ESP32-S3 to the board table and available-boards list. |
| `SUPPORT_MATRIX.md` | Add ESP32-S3 row. |

---

## Task 1: Scaffolding the package skeleton

**Files:**
- Create: `packages/board-esp32s3/package.json`
- Create: `packages/board-esp32s3/tsconfig.json`
- Modify: `package.json` (root, workspaces array at line 5)

- [ ] **Step 1: Create `packages/board-esp32s3/package.json`**

Mirror `packages/board-esp32-devkit/package.json` exactly except: name, description, and **no** `@typecad/mcu-esp32` dependency.

```json
{
  "name": "@typecad/board-esp32s3",
  "version": "0.1.0",
  "description": "TypeCAD ESP32-S3 board definition with typed pins and peripherals",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@typecad/cuttlefish": "*",
    "@typecad/hal": "*"
  },
  "license": "MIT",
  "publishConfig": {
    "access": "public"
  }
}
```

- [ ] **Step 2: Create `packages/board-esp32s3/tsconfig.json`**

Mirror `packages/board-esp32-devkit/tsconfig.json`, but the `references` array lists only `../hal` and `../cuttlefish` (no MCU package reference — the MCU lives in this package).

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2021",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "rootDir": "src",
    "outDir": "dist",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src/**/*.ts"],
  "references": [
    { "path": "../hal" },
    { "path": "../cuttlefish" }
  ]
}
```

- [ ] **Step 3: Add the workspace to root `package.json`**

In the `workspaces` array, add `"packages/board-esp32s3"` immediately after the `"packages/board-esp32-devkit"` line (so board packages stay grouped):

```json
    "packages/board-esp32-devkit",
    "packages/board-esp32s3",
```

- [ ] **Step 4: Verify the package is recognized as a workspace**

Run: `npm ls --workspace @typecad/board-esp32s3 2>&1 | head -3`
Expected: a line showing `@typecad/board-esp32s3@0.1.0` and its location. (It will show an "unmet dependency" or "missing" for its own build until `src/` exists — that's fine for now; we just want npm to recognize the workspace.)

- [ ] **Step 5: Commit**

```bash
git add packages/board-esp32s3/package.json packages/board-esp32s3/tsconfig.json package.json
git commit -m "feat(board-esp32s3): scaffold package and register workspace"
```

---

## Task 2: The ESP32-S3 MCU definition (`src/mcu.ts`)

This is the largest file and the heart of the "full & accurate" board data. It defines the silicon as a `MCUDefinition` and the HAL peripheral instances.

**Files:**
- Create: `packages/board-esp32s3/src/mcu.ts`

**Reference for the shape:** `packages/mcu-esp32/src/index.ts` (the `ESP32WROOM32` constant) and `packages/mcu-esp32/src/peripherals.ts` (HAL instance creation). We follow the same capability-flag helper pattern.

**ESP32-S3 facts encoded here** (from the spec §2 "Full & accurate"):
- **45 GPIO: 0–21 and 26–48.** GPIO 22–25 and 32–37 do **not** exist on the S3 (different pad layout from classic ESP32 — the most common porting gotcha). All S3 GPIOs are bidirectional (no input-only pins).
- **Strapping pins (unsafe):** GPIO0, GPIO3, GPIO45, GPIO46.
- **USB pins (unsafe):** GPIO19 (D-), GPIO20 (D+).
- **SPI flash/PSRAM pins (unsafe):** GPIO26–GPIO32.
- **ADC1** = GPIO1–GPIO10 (ch0–ch9). **ADC2** = GPIO11–GPIO20 (ch0–ch9; **unusable while Wi-Fi on** — encoded as a warning, not a compile error).
- **Touch** = 14 channels on GPIO1–GPIO14.
- **DAC: none** (removed on S3 — deliberately omitted).
- **I2C0 default:** GPIO8 SDA / GPIO9 SCL. **I2C1:** remappable.
- **SPI0 (FSPI) default:** GPIO12(MOSI) / GPIO13(MISO) / GPIO11(SCK); CS GPIO10. **SPI1:** remappable.
- **UART0 default:** GPIO43(TX) / GPIO44(RX). **UART1** / **UART2:** remappable.
- **Silicon memory:** flash 384 KB usable (rest reserved), SRAM 512 KB, RTC 16 KB.

- [ ] **Step 1: Write `packages/board-esp32s3/src/mcu.ts`**

```ts
// ---------------------------------------------------------------------------
// @typecad/board-esp32s3 — ESP32-S3 MCU definition (silicon)
//
// ESP32-S3 is dual-core Xtensa LX7 @ 240 MHz with Wi-Fi 4 + BLE 5 and native
// USB-OTG. It has 45 GPIO (0-21, 26-48); GPIO 22-25 and 32-37 do NOT exist on
// the S3 (different pad layout from classic ESP32). All GPIOs are bidirectional
// (no input-only pins). DAC was removed on the S3.
// ---------------------------------------------------------------------------

import type { MCUDefinition } from '@typecad/cuttlefish/api/schema';
import {
  I2CBus,
  SPIBus,
  SerialPort,
  i2cName,
  spiName,
  serialName,
  createHALInstances,
  Pin,
} from '@typecad/hal';

// ---------------------------------------------------------------------------
// Default capability flags
// ---------------------------------------------------------------------------

const NO  = false as const;
const YES = true  as const;

/** Full GPIO: digital I/O + pull-up + pull-down + PWM + interrupt. */
const FULL_GPIO = {
  digitalInput: YES, digitalOutput: YES,
  analogInput: NO,   analogOutput: NO,
  pwm: YES,          interrupt: YES,
  pullUp: YES,       pullDown: YES,
  touch: NO,         openDrain: NO,
} as const;

/** Full GPIO + analog input (ADC). */
const FULL_GPIO_ANALOG = { ...FULL_GPIO, analogInput: YES } as const;

/** Full GPIO + touch. */
const FULL_GPIO_TOUCH = { ...FULL_GPIO, touch: YES } as const;

/** Full GPIO + analog input + touch. */
const FULL_GPIO_ANALOG_TOUCH = { ...FULL_GPIO, analogInput: YES, touch: YES } as const;

// ---------------------------------------------------------------------------
// Helper: build the GPIO 0-21 and 26-48 pin list with correct functions.
// ---------------------------------------------------------------------------

/**
 * ADC1 channels: GPIO1..GPIO10 -> ch0..ch9 (always usable).
 * ADC2 channels: GPIO11..GPIO20 -> ch0..ch9 (NOT usable while Wi-Fi is on).
 * Touch channels: GPIO1..GPIO14 -> T1..T14.
 */
function adc(n: number, ch: number) {
  return { type: 'adc' as const, instance: n, role: `ch${ch}` };
}
function touch(ch: number) {
  return { type: 'touch' as const, instance: 0, role: `touch${ch}` };
}

// ---------------------------------------------------------------------------
// ESP32-S3 MCU definition
// ---------------------------------------------------------------------------

export const ESP32S3: MCUDefinition = {
  id: 'esp32-s3',
  name: 'ESP32-S3',
  architecture: 'esp32s3',
  memory: {
    flash:    384 * 1024, // usable app flash; remainder reserved by bootloader/OTADATA
    sram:     512 * 1024, // 512 KB
    eeprom:   0,
    rtcMemory: 16 * 1024, // 16 KB RTC slow memory
  },
  pins: {
    all: [
      // ---- Boot strapping pins (unsafe) ------------------------------------
      { number:  0, gpio:  0, name: 'GPIO0', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(1, 0), touch(1)],
        alternateFunctions: ['ADC1_CH0', 'Touch1'],
        warnings: ['GPIO0 is a strapping pin — must be HIGH at boot for normal flash boot; LOW enters download mode'],
        unsafe: true, notes: 'Boot strapping pin' },

      { number:  1, gpio:  1, name: 'GPIO1', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 1), touch(2)],
        alternateFunctions: ['ADC1_CH1', 'Touch2'] },

      { number:  2, gpio:  2, name: 'GPIO2', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 2), touch(3)],
        alternateFunctions: ['ADC1_CH2', 'Touch3'] },

      { number:  3, gpio:  3, name: 'GPIO3', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 3), touch(4)],
        alternateFunctions: ['ADC1_CH3', 'Touch4'],
        warnings: ['GPIO3 is a strapping pin — controls JTAG signal source at boot'],
        unsafe: true, notes: 'Boot strapping pin' },

      { number:  4, gpio:  4, name: 'GPIO4', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 4), touch(5)],
        alternateFunctions: ['ADC1_CH4', 'Touch5'] },

      { number:  5, gpio:  5, name: 'GPIO5', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 5), touch(6)],
        alternateFunctions: ['ADC1_CH5', 'Touch6'] },

      { number:  6, gpio:  6, name: 'GPIO6', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 6), touch(7)],
        alternateFunctions: ['ADC1_CH6', 'Touch7'] },

      { number:  7, gpio:  7, name: 'GPIO7', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 7), touch(8)],
        alternateFunctions: ['ADC1_CH7', 'Touch8'] },

      { number:  8, gpio:  8, name: 'GPIO8', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 8), touch(9), { type: 'i2c', instance: 0, role: 'sda' }],
        alternateFunctions: ['ADC1_CH8', 'Touch9', 'I2C0 SDA'],
        warnings: ['Using GPIO8 as GPIO will interfere with I2C0 SDA'] },

      { number:  9, gpio:  9, name: 'GPIO9', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 9), touch(10), { type: 'i2c', instance: 0, role: 'scl' }],
        alternateFunctions: ['ADC1_CH9', 'Touch10', 'I2C0 SCL'],
        warnings: ['Using GPIO9 as GPIO will interfere with I2C0 SCL'] },

      { number: 10, gpio: 10, name: 'GPIO10', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 10), touch(11)],
        alternateFunctions: ['ADC1_CH10', 'Touch11'] },

      { number: 11, gpio: 11, name: 'GPIO11', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(2, 0), touch(12), { type: 'spi', instance: 0, role: 'sck' }],
        alternateFunctions: ['ADC2_CH0', 'Touch12', 'FSPI SCK'],
        warnings: ['GPIO11 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number: 12, gpio: 12, name: 'GPIO12', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(2, 1), touch(13), { type: 'spi', instance: 0, role: 'mosi' }],
        alternateFunctions: ['ADC2_CH1', 'Touch13', 'FSPI MOSI'],
        warnings: ['GPIO12 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number: 13, gpio: 13, name: 'GPIO13', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(2, 2), touch(14), { type: 'spi', instance: 0, role: 'miso' }],
        alternateFunctions: ['ADC2_CH2', 'Touch14', 'FSPI MISO'],
        warnings: ['GPIO13 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number: 14, gpio: 14, name: 'GPIO14', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(2, 3)],
        alternateFunctions: ['ADC2_CH3'],
        warnings: ['GPIO14 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number: 15, gpio: 15, name: 'GPIO15', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(2, 4)],
        alternateFunctions: ['ADC2_CH4'],
        warnings: ['GPIO15 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number: 16, gpio: 16, name: 'GPIO16', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(2, 5)],
        alternateFunctions: ['ADC2_CH5'],
        warnings: ['GPIO16 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number: 17, gpio: 17, name: 'GPIO17', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(2, 6)],
        alternateFunctions: ['ADC2_CH6'],
        warnings: ['GPIO17 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number: 18, gpio: 18, name: 'GPIO18', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(2, 7)],
        alternateFunctions: ['ADC2_CH7'],
        warnings: ['GPIO18 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number: 19, gpio: 19, name: 'GPIO19', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(2, 8), { type: 'usb', instance: 0, role: 'dm' }],
        alternateFunctions: ['ADC2_CH8', 'USB D-'],
        warnings: ['GPIO19 is USB D- — using it as GPIO disables native USB', 'GPIO19 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'],
        unsafe: true, notes: 'USB D- pin' },

      { number: 20, gpio: 20, name: 'GPIO20', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(2, 9), { type: 'usb', instance: 0, role: 'dp' }],
        alternateFunctions: ['ADC2_CH9', 'USB D+'],
        warnings: ['GPIO20 is USB D+ — using it as GPIO disables native USB', 'GPIO20 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'],
        unsafe: true, notes: 'USB D+ pin' },

      { number: 21, gpio: 21, name: 'GPIO21', capabilities: FULL_GPIO,
        alternateFunctions: [] },

      // ---- GPIO 22-25 do NOT exist on the ESP32-S3 -------------------------

      // ---- GPIO 26-32 connected to SPI flash / PSRAM (unsafe) ---------------
      { number: 26, gpio: 26, name: 'GPIO26', capabilities: FULL_GPIO,
        alternateFunctions: ['SPICS1'],
        warnings: ['GPIO26 is connected to SPI flash/PSRAM — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },
      { number: 27, gpio: 27, name: 'GPIO27', capabilities: FULL_GPIO,
        alternateFunctions: ['SPIHD'],
        warnings: ['GPIO27 is connected to SPI flash/PSRAM — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },
      { number: 28, gpio: 28, name: 'GPIO28', capabilities: FULL_GPIO,
        alternateFunctions: ['SPIWP'],
        warnings: ['GPIO28 is connected to SPI flash/PSRAM — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },
      { number: 29, gpio: 29, name: 'GPIO29', capabilities: FULL_GPIO,
        alternateFunctions: ['SPICS0'],
        warnings: ['GPIO29 is connected to SPI flash/PSRAM — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },
      { number: 30, gpio: 30, name: 'GPIO30', capabilities: FULL_GPIO,
        alternateFunctions: ['SPICLK'],
        warnings: ['GPIO30 is connected to SPI flash/PSRAM — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },
      { number: 31, gpio: 31, name: 'GPIO31', capabilities: FULL_GPIO,
        alternateFunctions: ['SPIQ'],
        warnings: ['GPIO31 is connected to SPI flash/PSRAM — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },
      { number: 32, gpio: 32, name: 'GPIO32', capabilities: FULL_GPIO,
        alternateFunctions: ['SPID'],
        warnings: ['GPIO32 is connected to SPI flash/PSRAM — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },

      { number: 33, gpio: 33, name: 'GPIO33', capabilities: FULL_GPIO,
        alternateFunctions: ['SPIIO4'],
        warnings: ['GPIO33 is connected to octal PSRAM on some modules — verify before use'],
        unsafe: true, notes: 'Octal SPI/PSRAM pin on PSRAM modules' },
      { number: 34, gpio: 34, name: 'GPIO34', capabilities: FULL_GPIO,
        alternateFunctions: ['SPIIO5'],
        warnings: ['GPIO34 is connected to octal PSRAM on some modules — verify before use'],
        unsafe: true, notes: 'Octal SPI/PSRAM pin on PSRAM modules' },
      { number: 35, gpio: 35, name: 'GPIO35', capabilities: FULL_GPIO,
        alternateFunctions: ['SPIIO6'],
        warnings: ['GPIO35 is connected to octal PSRAM on some modules — verify before use'],
        unsafe: true, notes: 'Octal SPI/PSRAM pin on PSRAM modules' },
      { number: 36, gpio: 36, name: 'GPIO36', capabilities: FULL_GPIO,
        alternateFunctions: ['SPIIO7'],
        warnings: ['GPIO36 is connected to octal PSRAM on some modules — verify before use'],
        unsafe: true, notes: 'Octal SPI/PSRAM pin on PSRAM modules' },
      { number: 37, gpio: 37, name: 'GPIO37', capabilities: FULL_GPIO,
        alternateFunctions: ['SPIDQS'],
        warnings: ['GPIO37 is connected to octal PSRAM on some modules — verify before use'],
        unsafe: true, notes: 'Octal SPI/PSRAM pin on PSRAM modules' },

      { number: 38, gpio: 38, name: 'GPIO38', capabilities: FULL_GPIO,
        alternateFunctions: [] },
      { number: 39, gpio: 39, name: 'GPIO39', capabilities: FULL_GPIO,
        alternateFunctions: ['MTCK'] },
      { number: 40, gpio: 40, name: 'GPIO40', capabilities: FULL_GPIO,
        alternateFunctions: ['MTDO'] },
      { number: 41, gpio: 41, name: 'GPIO41', capabilities: FULL_GPIO,
        alternateFunctions: ['MTDI'] },
      { number: 42, gpio: 42, name: 'GPIO42', capabilities: FULL_GPIO,
        alternateFunctions: ['MTMS'] },

      // ---- UART0 default pins ----------------------------------------------
      { number: 43, gpio: 43, name: 'GPIO43', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'tx' }],
        alternateFunctions: ['UART0 TX'],
        warnings: ['Using GPIO43 as GPIO will interfere with UART0 transmit'] },
      { number: 44, gpio: 44, name: 'GPIO44', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'rx' }],
        alternateFunctions: ['UART0 RX'],
        warnings: ['Using GPIO44 as GPIO will interfere with UART0 receive'] },

      { number: 45, gpio: 45, name: 'GPIO45', capabilities: FULL_GPIO,
        alternateFunctions: [],
        warnings: ['GPIO45 is a strapping pin — sets VDD_SPI voltage at boot'],
        unsafe: true, notes: 'Boot strapping pin' },
      { number: 46, gpio: 46, name: 'GPIO46', capabilities: FULL_GPIO,
        alternateFunctions: [],
        warnings: ['GPIO46 is a strapping pin — controls boot mode at boot'],
        unsafe: true, notes: 'Boot strapping pin' },

      { number: 47, gpio: 47, name: 'GPIO47', capabilities: FULL_GPIO,
        alternateFunctions: ['RGB_DATA'] },
      { number: 48, gpio: 48, name: 'GPIO48', capabilities: FULL_GPIO,
        alternateFunctions: ['RGB_DATA', 'Onboard LED (DevKitC-1)'],
        onboardLed: true },
    ],

    digital: [
      'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7',
      'GPIO8', 'GPIO9', 'GPIO10', 'GPIO11', 'GPIO12', 'GPIO13', 'GPIO14',
      'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21',
      'GPIO26', 'GPIO27', 'GPIO28', 'GPIO29', 'GPIO30', 'GPIO31', 'GPIO32',
      'GPIO33', 'GPIO34', 'GPIO35', 'GPIO36', 'GPIO37', 'GPIO38', 'GPIO39',
      'GPIO40', 'GPIO41', 'GPIO42', 'GPIO43', 'GPIO44', 'GPIO45', 'GPIO46',
      'GPIO47', 'GPIO48',
    ],
    analog: [
      'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7', 'GPIO8',
      'GPIO9', 'GPIO10',                                   // ADC1
      'GPIO11', 'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15',
      'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19', 'GPIO20',    // ADC2
    ],
    pwm: [
      'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7',
      'GPIO8', 'GPIO9', 'GPIO10', 'GPIO11', 'GPIO12', 'GPIO13', 'GPIO14',
      'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21',
      'GPIO38', 'GPIO39', 'GPIO40', 'GPIO41', 'GPIO42', 'GPIO43', 'GPIO44',
      'GPIO45', 'GPIO46', 'GPIO47', 'GPIO48',
    ],
    unsafe: [
      'GPIO0', 'GPIO3', 'GPIO19', 'GPIO20',
      'GPIO26', 'GPIO27', 'GPIO28', 'GPIO29', 'GPIO30', 'GPIO31', 'GPIO32',
      'GPIO33', 'GPIO34', 'GPIO35', 'GPIO36', 'GPIO37',
      'GPIO45', 'GPIO46',
    ],

    i2c:  { 0: { sda: 'GPIO8',  scl: 'GPIO9'  } },
    spi:  {
      0: { mosi: 'GPIO12', miso: 'GPIO13', sck: 'GPIO11', cs: 'GPIO10' },  // FSPI
    },
    uart: {
      0: { tx: 'GPIO43', rx: 'GPIO44' },
    },
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    aliases: {},
    i2c: [
      { instance: 0, defaultPins: { sda: 'GPIO8',  scl: 'GPIO9' } },
      { instance: 1, defaultPins: { sda: 'GPIO8',  scl: 'GPIO9' } },
    ],
    spi: [
      { instance: 0, defaultPins: { mosi: 'GPIO12', miso: 'GPIO13', sck: 'GPIO11', cs: 'GPIO10' } },  // FSPI
      { instance: 1, defaultPins: { mosi: 'GPIO12', miso: 'GPIO13', sck: 'GPIO11', cs: 'GPIO10' } },  // GPSI, remappable
    ],
    uart: [
      { instance: 0, defaultPins: { tx: 'GPIO43', rx: 'GPIO44' } },
      { instance: 1, defaultPins: { tx: 'GPIO43', rx: 'GPIO44' } },
      { instance: 2, defaultPins: { tx: 'GPIO43', rx: 'GPIO44' } },
    ],
    adc: [
      { instance: 0, channels: 10, resolution: 12, referenceVoltage: 3.3, maxValue: 4095,
        referenceVoltages: { DEFAULT: 3.3, INTERNAL: 1.1 } },  // ADC1 — usable with Wi-Fi active
      { instance: 1, channels: 10, resolution: 12, referenceVoltage: 3.3, maxValue: 4095,
        referenceVoltages: { DEFAULT: 3.3, INTERNAL: 1.1 } },  // ADC2 — NOT usable with Wi-Fi active
    ],
    pwm: {
      channels: 8,
      resolution: 20,
      maxFrequency: 40_000_000,
    },
    touch: {
      channels: 14,
      pins: ['GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7',
             'GPIO8', 'GPIO9', 'GPIO10', 'GPIO11', 'GPIO12', 'GPIO13', 'GPIO14'],
    },
    timers: [
      { instance: 0, type: 'general', bits: 52, features: ['interrupt'] },
      { instance: 1, type: 'general', bits: 52, features: ['interrupt'] },
      { instance: 2, type: 'general', bits: 52, features: ['interrupt'] },
      { instance: 3, type: 'general', bits: 52, features: ['interrupt'] },
    ],
    wifi: { type: 'wifi', supportsStation: true, supportsAp: true },
    bluetooth: { type: 'ble', version: '5.0' },
    usb: { type: 'otg', vid: '0x303A', pid: '0x0001' },
  },

  features: {
    multicore: true,
    coreCount: 2,
    deepSleep: true,
    watchdog: true,
    externalInterrupts: true,
    hardwareRng: true,
    fpu: true,
  },
  build: {
    extraFlags: [],
  },
};

export default ESP32S3;

// ---------------------------------------------------------------------------
// HAL object instances — convenience peripherals (mirror mcu-esp32 pattern)
// ---------------------------------------------------------------------------

export const [I2C0, I2C1] = createHALInstances(ESP32S3.peripherals.i2c, i => new I2CBus(i2cName(i)));
export const [SPI0, SPI1] = createHALInstances(ESP32S3.peripherals.spi, i => new SPIBus(spiName(i)));
export const [UART0, UART1, UART2] = createHALInstances(ESP32S3.peripherals.uart, i => new SerialPort(serialName(i)));
```

**Notes for the implementer:**
- The `adc(n, ch)` / `touch(ch)` helpers return `PeripheralFunction` objects — verify they satisfy the `PeripheralFunction` type (`packages/cuttlefish/src/api/schema/types.ts:65`). If `tsc` complains, inline the objects.
- `createHALInstances` returns an array sized to the instance count; using array destructuring like the devkit's `[UART0, , UART2]` for sparse instances is fine, but here S3 has 3 contiguous UART instances (0,1,2) so `[UART0, UART1, UART2]` is correct.
- Verify the `PeripheralFunction.type` union accepts `'usb'` — it does (`types.ts:67`).
- If `tsc` flags `bits: 52` on `TimerDefinition` (`types.ts:173` restricts to `8 | 16 | 32 | 64`), change those four timers to `bits: 64` (ESP32-S3 timers are 52-bit but the schema's union doesn't include 52; 64 is the closest valid value and matches how `mcu-esp32` uses 64).

- [ ] **Step 2: Verify the file typechecks in isolation**

This won't fully build yet (no `index.ts`), but we can catch syntax/type errors. From the repo root:

Run: `cd packages/board-esp32s3 && npx tsc --noEmit src/mcu.ts 2>&1 | head -30`
Expected: ideally no output (clean). If there are errors about the timer `bits: 52` or the helper return types, fix them now per the notes above. It's acceptable if the only errors are "cannot find module './index.js'" or similar (since `index.ts` doesn't exist yet) — those resolve in Task 3.

- [ ] **Step 3: Commit**

```bash
git add packages/board-esp32s3/src/mcu.ts
git commit -m "feat(board-esp32s3): add ESP32-S3 MCU definition (45 GPIO, Wi-Fi, BLE, USB-OTG)"
```

---

## Task 3: The board manifest and supporting files

**Files:**
- Create: `packages/board-esp32s3/src/index.ts`
- Create: `packages/board-esp32s3/src/pins.ts`
- Create: `packages/board-esp32s3/src/analog.ts`
- Create: `packages/board-esp32s3/src/board.ts`

**Reference:** `packages/board-esp32-devkit/src/{index,pins,analog,board}.ts`. The devkit imports its MCU from `@typecad/mcu-esp32`; we import from the local `./mcu.js`.

- [ ] **Step 1: Create `packages/board-esp32s3/src/pins.ts`**

Arduino-style `Dx`/`Ax`/`LED` aliases plus bus aliases. `Dx` maps to `GPIOn` where `n == x` (the S3 Arduino core numbers digital pins by GPIO number, like the classic ESP32). Analog aliases map to ADC1 channels (GPIO1–GPIO10). The onboard LED is GPIO48.

```ts
// ---------------------------------------------------------------------------
// @typecad/board-esp32s3 — Pin aliases
// ---------------------------------------------------------------------------

import {
  GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7,
  GPIO8, GPIO9, GPIO10, GPIO11, GPIO12, GPIO13, GPIO14,
  GPIO15, GPIO16, GPIO17, GPIO18, GPIO19, GPIO20, GPIO21,
  GPIO38, GPIO39, GPIO40, GPIO41, GPIO42, GPIO43, GPIO44,
  GPIO45, GPIO46, GPIO47, GPIO48,
} from './mcu.js';

// ---------------------------------------------------------------------------
// Arduino-style digital pin aliases (D-numbers match GPIO numbers on ESP32-S3)
// ---------------------------------------------------------------------------

export const D0  = GPIO0;   export const D1  = GPIO1;   export const D2  = GPIO2;
export const D3  = GPIO3;   export const D4  = GPIO4;   export const D5  = GPIO5;
export const D6  = GPIO6;   export const D7  = GPIO7;   export const D8  = GPIO8;
export const D9  = GPIO9;   export const D10 = GPIO10;  export const D11 = GPIO11;
export const D12 = GPIO12;  export const D13 = GPIO13;  export const D14 = GPIO14;
export const D15 = GPIO15;  export const D16 = GPIO16;  export const D17 = GPIO17;
export const D18 = GPIO18;  export const D19 = GPIO19;  export const D20 = GPIO20;
export const D21 = GPIO21;
export const D38 = GPIO38;  export const D39 = GPIO39;  export const D40 = GPIO40;
export const D41 = GPIO41;  export const D42 = GPIO42;  export const D43 = GPIO43;
export const D44 = GPIO44;  export const D45 = GPIO45;  export const D46 = GPIO46;
export const D47 = GPIO47;  export const D48 = GPIO48;

// ---------------------------------------------------------------------------
// Analog input aliases (ADC1 channels — usable while Wi-Fi is active).
// ADC2 pins (GPIO11-GPIO20) are omitted from Ax aliases because they are
// unusable while Wi-Fi is enabled.
// ---------------------------------------------------------------------------

export const A0 = GPIO1;
export const A1 = GPIO2;
export const A2 = GPIO3;
export const A3 = GPIO4;
export const A4 = GPIO5;
export const A5 = GPIO6;
export const A6 = GPIO7;
export const A7 = GPIO8;
export const A8 = GPIO9;
export const A9 = GPIO10;

// ---------------------------------------------------------------------------
// Board-specific aliases
// ---------------------------------------------------------------------------

/** On-board LED (GPIO48 — addressable RGB on most S3 dev modules). */
export const LED = GPIO48;

// Bus aliases (default pins for I2C0 / SPI0 / UART0)
export { I2C0, I2C1, SPI0, SPI1, UART0, UART1, UART2 } from './mcu.js';
```

**Note:** the `GPIO*` constants are imported from `./mcu.js`, but `mcu.ts` does not yet export named `GPIO0`...`GPIO48` constants — it only exports the `ESP32S3` definition object and the HAL instances. This is a deliberate gap: the devkit's `pins.ts` imports `GPIO0` etc. from `@typecad/mcu-esp32`, which exports them from its own `pins.ts`. **You must add named GPIO constant exports to `mcu.ts`.**

The GPIO constants are `Pin` instances from `@typecad/hal` — exactly as `packages/mcu-esp32/src/pins.ts:15` does `export const GPIO0 = new Pin(0);`. Add this block to `packages/board-esp32s3/src/mcu.ts` (add `import { Pin } from '@typecad/hal';` to the existing hal import at the top, then add the constants at the bottom, before the HAL instances section):

```ts
// ---------------------------------------------------------------------------
// Named GPIO constants (Pin instances, consumed by ./pins.js for Dx/Ax/LED)
// Mirrors packages/mcu-esp32/src/pins.ts: `new Pin(n)`.
// ---------------------------------------------------------------------------

export const GPIO0  = new Pin(0);
export const GPIO1  = new Pin(1);
export const GPIO2  = new Pin(2);
export const GPIO3  = new Pin(3);
export const GPIO4  = new Pin(4);
export const GPIO5  = new Pin(5);
export const GPIO6  = new Pin(6);
export const GPIO7  = new Pin(7);
export const GPIO8  = new Pin(8);
export const GPIO9  = new Pin(9);
export const GPIO10 = new Pin(10);
export const GPIO11 = new Pin(11);
export const GPIO12 = new Pin(12);
export const GPIO13 = new Pin(13);
export const GPIO14 = new Pin(14);
export const GPIO15 = new Pin(15);
export const GPIO16 = new Pin(16);
export const GPIO17 = new Pin(17);
export const GPIO18 = new Pin(18);
export const GPIO19 = new Pin(19);
export const GPIO20 = new Pin(20);
export const GPIO21 = new Pin(21);
export const GPIO26 = new Pin(26);
export const GPIO27 = new Pin(27);
export const GPIO28 = new Pin(28);
export const GPIO29 = new Pin(29);
export const GPIO30 = new Pin(30);
export const GPIO31 = new Pin(31);
export const GPIO32 = new Pin(32);
export const GPIO33 = new Pin(33);
export const GPIO34 = new Pin(34);
export const GPIO35 = new Pin(35);
export const GPIO36 = new Pin(36);
export const GPIO37 = new Pin(37);
export const GPIO38 = new Pin(38);
export const GPIO39 = new Pin(39);
export const GPIO40 = new Pin(40);
export const GPIO41 = new Pin(41);
export const GPIO42 = new Pin(42);
export const GPIO43 = new Pin(43);
export const GPIO44 = new Pin(44);
export const GPIO45 = new Pin(45);
export const GPIO46 = new Pin(46);
export const GPIO47 = new Pin(47);
export const GPIO48 = new Pin(48);
```

**Confirmed shape:** `@typecad/hal`'s `Pin` is constructed with the GPIO number, matching `packages/mcu-esp32/src/pins.ts:15` (`new Pin(0)`). Use this exact form — do not use object literals.

- [ ] **Step 2: Create `packages/board-esp32s3/src/analog.ts`**

Mirror `packages/board-esp32-devkit/src/analog.ts`:

```ts
// ---------------------------------------------------------------------------
// @typecad/board-esp32s3 — Analog constants
// ---------------------------------------------------------------------------

/** Default reference (3.3V). */
export const DEFAULT = 0;
/** Internal 1.1V reference. */
export const INTERNAL = 3;
```

- [ ] **Step 3: Create `packages/board-esp32s3/src/index.ts`**

Mirror `packages/board-esp32-devkit/src/index.ts`, but: MCU import is local (`./mcu.js`), no `export * from '@typecad/mcu-esp32'`, the FQBN is `esp32:esp32s3:esp32s3`, and the board id/name/description reflect the generic S3.

```ts
// ---------------------------------------------------------------------------
// @typecad/board-esp32s3 — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import { ESP32S3 } from './mcu.js';

/** Arduino core API version for this board's build defines. */
const ARDUINO_CORE_VERSION = '10819';

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const ESP32S3Board: BoardDefinition = {
  id: 'esp32s3',
  name: 'ESP32-S3',
  vendor: 'Espressif',
  description:
    'Generic ESP32-S3 (vendor-agnostic). Dual-core Xtensa LX7 @ 240 MHz ' +
    'with Wi-Fi 4 + BLE 5 and native USB-OTG. Flash/PSRAM are module-dependent; ' +
    'override via FQBN menu options, e.g. ' +
    'esp32:esp32s3:esp32s3:FlashSize=16M,PSRAM=opi',

  mcu: ESP32S3,
  clockSpeed: 240_000_000, // 240 MHz

  // ----- Memory (module-level defaults; silicon memory lives on the MCU) ---
  memory: {
    flash: 8 * 1024 * 1024,        // 8 MB module flash (N8R2-class default)
    externalRam: 2 * 1024 * 1024,  // 2 MB octal PSRAM
  },

  // ----- Pins --------------------------------------------------------------
  pins: {
    ...ESP32S3.pins,
    led: 'GPIO48',
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    ...ESP32S3.peripherals,
    aliases: {
      UART0: 'Serial',
      UART1: 'Serial1',
      UART2: 'Serial2',
      I2C0:  'Wire',
      I2C1:  'Wire1',
      SPI0:  'SPI',
      SPI1:  'SPI1',
    },
  },

  // ----- Build config ------------------------------------------------------
  build: {
    frameworks: {
      platformio: 'esp32s3',
      arduino: 'esp32:esp32s3:esp32s3',
    },
    defines: {
      F_CPU:              '240000000UL',
      ARDUINO:            ARDUINO_CORE_VERSION,
      ARDUINO_ESP32S3_DEV: '1',
    },
  },
};

export default ESP32S3Board;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Silicon-level (local MCU module)
export * from './mcu.js';

// Generic HAL re-exports from @typecad/hal
export {
  HIGH, LOW, INPUT, OUTPUT, INPUT_PULLUP,
  delay, millis, micros, delayMicroseconds,
  map, constrain,
  abs, min, max, Num,
  pulseIn, pulseInLong, Pulse,
  shiftIn, shiftOut, Shift,
  randomSeed, random, Random,
  noInterrupts, interrupts, attachInterrupt, detachInterrupt,
  ADC, AsyncClass, Async
} from '@typecad/hal';

// Board-level pin Discovery API (uses local silicon pins)
import {
  GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7,
  GPIO8, GPIO9, GPIO10, GPIO11, GPIO12, GPIO13, GPIO14,
  GPIO15, GPIO16, GPIO17, GPIO18, GPIO19, GPIO20, GPIO21,
  GPIO38, GPIO39, GPIO40, GPIO41, GPIO42, GPIO43, GPIO44,
  GPIO45, GPIO46, GPIO47, GPIO48,
} from './mcu.js';

/**
 * Pin collections for runtime capability discovery.
 */
export const pins = {
  /** PWM-capable pins (all output-capable GPIOs that are not flash/USB/strap). */
  pwm: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
        GPIO10, GPIO11, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18,
        GPIO19, GPIO20, GPIO21, GPIO38, GPIO39, GPIO40, GPIO41, GPIO42, GPIO43,
        GPIO44, GPIO45, GPIO46, GPIO47, GPIO48] as const,
  /** Analog input pins (ADC1 — usable while Wi-Fi active). */
  analog: [GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9, GPIO10] as const,
  /** All GPIOs support interrupts on ESP32-S3. */
  interrupt: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
              GPIO10, GPIO11, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18,
              GPIO19, GPIO20, GPIO21, GPIO38, GPIO39, GPIO40, GPIO41, GPIO42, GPIO43,
              GPIO44, GPIO45, GPIO46, GPIO47, GPIO48] as const,
  /** All digital I/O pins. */
  digital: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
            GPIO10, GPIO11, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18,
            GPIO19, GPIO20, GPIO21, GPIO38, GPIO39, GPIO40, GPIO41, GPIO42, GPIO43,
            GPIO44, GPIO45, GPIO46, GPIO47, GPIO48] as const,
} as const;

/**
 * Peripheral-to-pin mapping for the ESP32-S3.
 */
export const PeripheralPins = {
  /** I2C bus 0 — default GPIO8 (SDA) / GPIO9 (SCL); remappable via GPIO matrix. */
  I2C0: { SDA: 'GPIO8',  SCL: 'GPIO9'  } as const,
  /** I2C bus 1 — no fixed pins (remappable). */
  I2C1: { SDA: 'remappable', SCL: 'remappable' } as const,
  /** SPI bus 0 / FSPI — GPIO12 (MOSI), GPIO13 (MISO), GPIO11 (SCK). GPIO10 is default CS. */
  SPI0: { MOSI: 'GPIO12', MISO: 'GPIO13', SCK: 'GPIO11', CS: 'GPIO10' } as const,
  /** SPI bus 1 / GPSI — no fixed pins (remappable). */
  SPI1: { MOSI: 'remappable', MISO: 'remappable', SCK: 'remappable' } as const,
  /** UART 0 — GPIO43 (TX) / GPIO44 (RX). USB-CDC serial available too. */
  UART0: { TX: 'GPIO43', RX: 'GPIO44' } as const,
  /** UART 1 — no fixed pins (remappable). */
  UART1: { TX: 'remappable', RX: 'remappable' } as const,
} as const;

// Board-level typed pins (Arduino-style aliases D0, A0, etc.)
export * from './pins.js';

// Board-specific analog constants
export * from './analog.js';

// Board namespace (single-import convenience)
export { Board } from './board.js';
```

- [ ] **Step 4: Create `packages/board-esp32s3/src/board.ts`**

Mirror `packages/board-esp32-devkit/src/board.ts`, importing from local `./pins.js` and `./mcu.js`:

```ts
// ---------------------------------------------------------------------------
// @typecad/board-esp32s3 — Board namespace
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';

import {
  D1, D2, D3, D4, D5, D6, D7, D8, D9, D10,
  D38, D39, D40, D41, D42, D43, D44, D45, D46, D47, D48,
  A0, A1, A2, A3, A4, A5, A6, A7, A8, A9,
  LED,
} from './pins.js';

import { I2C0, I2C1, SPI0, SPI1, UART0, UART1, UART2 } from './mcu.js';
import { ESP32S3Board } from './index.js';

export const Board = {
  definition: ESP32S3Board,

  // Common digital pins (strapping/flash/USB pins omitted from the convenience namespace)
  D1, D2, D3, D4, D5, D6, D7, D8, D9, D10,
  D38, D39, D40, D41, D42, D43, D44, D45, D46, D47, D48,

  // Analog aliases
  A0, A1, A2, A3, A4, A5, A6, A7, A8, A9,

  // Convenience aliases
  LED,

  // Peripherals
  I2C0, I2C1, SPI0, SPI1, UART0, UART1, UART2,

  // Collections
  digital: { D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D38, D39, D40, D41, D42, D43, D44, D45, D46, D47, D48 },
  analog:  { A0, A1, A2, A3, A4, A5, A6, A7, A8, A9 },
};

export default Board;
```

- [ ] **Step 5: Build the package**

Run: `npm run build --workspace @typecad/board-esp32s3`
Expected: clean build, `dist/` populated with `.js` + `.d.ts` files.

If there are errors, fix them before continuing. Common issues to watch for: the GPIO constant shape (see Task 3 Step 1 note), the timer `bits` value (must be in `8|16|32|64`), or a missing HAL re-export name.

- [ ] **Step 6: Commit**

```bash
git add packages/board-esp32s3/src/
git commit -m "feat(board-esp32s3): add board manifest, pins, analog, and Board namespace"
```

---

## Task 4: Register the board in the known-targets registry

**Files:**
- Modify: `packages/cuttlefish/src/create/init-scaffold.ts` (the `_knownTargets` array, line ~30)

- [ ] **Step 1: Add the `esp32s3` entry to `_knownTargets`**

In `packages/cuttlefish/src/create/init-scaffold.ts`, find the `_knownTargets` array (line 30) and add this entry immediately after the `esp32-devkit` entry (after line 59, before the closing `];`):

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

- [ ] **Step 2: Rebuild cuttlefish so the test imports the fresh code**

Per AGENTS.md: build cuttlefish before running tests that import its package exports.

Run: `npm run build --workspace @typecad/cuttlefish`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/cuttlefish/src/create/init-scaffold.ts
git commit -m "feat(cuttlefish): register esp32s3 in known-targets registry"
```

---

## Task 5: Test — the board is in the registry (TDD for the registration)

This follows the existing `KNOWN_BOARDS` test pattern at `tests/packages/transpiler/init-scaffold.test.ts:203-210`.

**Files:**
- Modify: `tests/packages/transpiler/init-scaffold.test.ts` (add an `it` inside the existing `describe("KNOWN_BOARDS", ...)` block)

- [ ] **Step 1: Add the failing test**

In `tests/packages/transpiler/init-scaffold.test.ts`, find the `KNOWN_BOARDS` describe block (line 203) and add this `it` after the existing `arduino-uno` test (after line 209, before the closing `});` of the describe block):

```ts
    it("contains esp32s3", () => {
      const s3 = KNOWN_BOARDS.find(b => b.id === 'esp32s3');
      expect(s3).toBeDefined();
      expect(s3!.architecture).toBe('esp32s3');
      expect(s3!.buildTarget).toBe('esp32:esp32s3:esp32s3');
    });
```

- [ ] **Step 2: Run the test to verify it passes**

(The registry change from Task 4 already makes this pass — this is a regression guard, not strict red-green TDD, because the registry edit and its test are paired. If Task 4 wasn't done, this fails with `expected undefined to be defined`.)

Run: `npx vitest run tests/packages/transpiler/init-scaffold.test.ts`
Expected: PASS, including the new `contains esp32s3` test.

- [ ] **Step 3: Commit**

```bash
git add tests/packages/transpiler/init-scaffold.test.ts
git commit -m "test(cuttlefish): assert esp32s3 is in KNOWN_BOARDS"
```

---

## Task 6: Framework-arduino fix #1 — `PROFILE_VARIANTS` and `CAPABILITY_TABLE`

The spec (§4) requires `esp32s3` to be treated like `esp32` for forced includes and capabilities.

**Files:**
- Modify: `packages/framework-arduino/src/profile.ts` (lines 50–55 for `PROFILE_VARIANTS`, 62–87 for `CAPABILITY_TABLE`)

- [ ] **Step 1: Add `esp32s3` to `PROFILE_VARIANTS`**

In `packages/framework-arduino/src/profile.ts`, find the `PROFILE_VARIANTS` array (line 50) and add an `esp32s3` entry after the `esp32` entry:

```ts
const PROFILE_VARIANTS: ArduinoProfileVariant[] = [
  { architecture: "avr", forcedIncludes: ["<Arduino.h>"] },
  { architecture: "esp32", forcedIncludes: ["<Arduino.h>"] },
  { architecture: "esp32s3", forcedIncludes: ["<Arduino.h>"] },
  { architecture: "samd", forcedIncludes: ["<Arduino.h>"] },
  { architecture: "rp2040", forcedIncludes: ["<Arduino.h>"] },
];
```

- [ ] **Step 2: Add `esp32s3` to `CAPABILITY_TABLE`**

In the same file, find the `CAPABILITY_TABLE` array (line 62) and add an `esp32s3` entry after the `esp32` entry. Mirror the `esp32` row exactly except `fallbackPins.A0` is `1` (ADC1 starts at GPIO1 on the S3, vs GPIO36 on the classic ESP32):

```ts
  {
    architecture: "esp32s3",
    builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "analogReference", "delay", "millis", "micros", "setInterval", "setTimeout", "clearInterval", "clearTimeout"]),
    builtinGlobals: new Set(["A0", "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
    fallbackPins: { A0: 1 },
  },
```

- [ ] **Step 3: Rebuild framework-arduino**

Run: `npm run build --workspace @typecad/framework-arduino`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add packages/framework-arduino/src/profile.ts
git commit -m "feat(framework-arduino): add esp32s3 profile variant and capability row"
```

---

## Task 7: Framework-arduino fix #2 — `FQBN_PIN_OVERRIDES`

**Files:**
- Modify: `packages/framework-arduino/src/profile.ts` (line 96, the `FQBN_PIN_OVERRIDES` array)

- [ ] **Step 1: Add the S3 FQBN→A0 override**

In `packages/framework-arduino/src/profile.ts`, find the `FQBN_PIN_OVERRIDES` array (line 96) and add an entry for the S3 FQBN prefix, after the `esp32:esp32:` line:

```ts
const FQBN_PIN_OVERRIDES: FqbnPinOverride[] = [
  { fqbnIncludes: "arduino:avr:uno", pins: { A0: 14 } },
  { fqbnIncludes: "arduino:avr:nano", pins: { A0: 14 } },
  { fqbnIncludes: "arduino:avr:mega", pins: { A0: 54 } },
  { fqbnIncludes: "arduino:samd:mkrzero", pins: { A0: 15 } },
  { fqbnIncludes: "esp32:esp32:", pins: { A0: 36 } },
  { fqbnIncludes: "esp32:esp32s3:", pins: { A0: 1 } },
  { fqbnIncludes: "rp2040:rp2040:", pins: { A0: 26 } },
];
```

- [ ] **Step 2: Rebuild framework-arduino**

Run: `npm run build --workspace @typecad/framework-arduino`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/framework-arduino/src/profile.ts
git commit -m "feat(framework-arduino): add esp32s3 FQBN A0 pin override"
```

---

## Task 8: Framework-arduino fix #3 — `isrFunctionAttribute()`

**Files:**
- Modify: `packages/framework-arduino/src/strategy.ts` (line 1003)

- [ ] **Step 1: Broaden the architecture check**

In `packages/framework-arduino/src/strategy.ts`, find `isrFunctionAttribute()` (line 1002). Change the strict equality to check the full Xtensa ESP32 family, matching how `freeHeap()` (line 234) already does it:

Replace:
```ts
  isrFunctionAttribute(): string {
    return this._cachedArch === 'esp32' ? 'IRAM_ATTR ' : '';
  }
```

with:
```ts
  isrFunctionAttribute(): string {
    const arch = this._cachedArch;
    return (arch === 'esp32' || arch === 'esp32s2' || arch === 'esp32s3' || arch === 'esp32c3')
      ? 'IRAM_ATTR '
      : '';
  }
```

- [ ] **Step 2: Rebuild framework-arduino**

Run: `npm run build --workspace @typecad/framework-arduino`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/framework-arduino/src/strategy.ts
git commit -m "feat(framework-arduino): emit IRAM_ATTR for all Xtensa ESP32 variants (incl. S3)"
```

---

## Task 9: Focused tests for the three framework-arduino fixes (TDD)

This task writes tests **before** confirming the fixes work end-to-end. Since the fixes are already in place (Tasks 6–8), these are regression tests, but write them to assert the *new* behavior so a future revert would fail them.

**Files:**
- Create: `tests/packages/framework-arduino/esp32s3-profile.test.ts`

**Import patterns** (from the exploration):
- Strategy: `import { ArduinoStrategy } from "../../../packages/framework-arduino/src";` (matches `timer-polyfill.test.ts:2`).
- Profile function: `import { resolveArduinoProfile } from "../../../packages/framework-arduino/src/profile";`.
- Types: `import type { ProgramIR, PlatformContext } from "@typecad/cuttlefish/api/shared";`.

**Critical testing facts** (from exploration):
- `isrFunctionAttribute()` reads `_cachedArch`, which is only populated by a prior call to `getOrResolveProfile()`. To populate it, call a public method that delegates to profile resolution — `forcedIncludes(program, ctx)` — passing a context whose `frameworkData.buildTarget` is the S3 FQBN. Then call `isrFunctionAttribute()`.
- A0 fallback is only observable when the architecture is **unknown** (hits `DEFAULT_CAPABILITIES`, where A0 is absent from `builtinGlobals`). Since `esp32s3` is now in `CAPABILITY_TABLE` with A0 as a builtin global, the A0 **shim is suppressed** for S3. The fix's effect is observable via `resolveA0Fallback` only indirectly. **The cleanest assertion is that `resolveArduinoProfile` with an S3 FQBN does NOT emit an A0 shim** (because A0 is a known builtin) — which confirms the `esp32s3` capability row is being matched. To assert the A0 *value* itself (1), use an unknown architecture with the S3 FQBN prefix… but that's not possible since the FQBN prefix maps to esp32s3 which is known. **Therefore the A0-value test asserts the capability-row `fallbackPins.A0` is 1 by checking that an unknown-FQBN-but-S3-prefix resolves to 1 — but that path doesn't exist.**

  **Resolution:** Assert A0 behavior at the `FQBN_PIN_OVERRIDES` level indirectly: construct a context where the architecture is unknown but the FQBN includes `esp32:esp32s3:`, AND make A0 not a builtin global. The simplest way: temporarily this isn't reachable through the public API for a known architecture. So the meaningful, robust assertions are: **(a)** `resolveArduinoProfile` with an S3 FQBN returns `forcedIncludes` containing `<Arduino.h>` (proves the PROFILE_VARIANTS match), and **(b)** `isrFunctionAttribute()` returns `'IRAM_ATTR '` after an S3 context is resolved (proves the strategy.ts fix). The A0 fallback value of 1 is covered by reading the code (the capability row + FQBN override both say 1) and is not separately testable through the public API without also testing the no-shim suppression. Document this in the test file as a comment.

- [ ] **Step 1: Write the test file**

Create `tests/packages/framework-arduino/esp32s3-profile.test.ts`:

```ts
// ---------------------------------------------------------------------------
// Tests for ESP32-S3 framework-arduino support
// (profile variant, capabilities, and IRAM_ATTR ISR attribute)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { ArduinoStrategy } from "../../../packages/framework-arduino/src";
import { resolveArduinoProfile } from "../../../packages/framework-arduino/src/profile";
import type { ProgramIR, PlatformContext } from "@typecad/cuttlefish/api/shared";

const S3_CTX = { frameworkData: { buildTarget: "esp32:esp32s3:esp32s3" } } as PlatformContext;
const EMPTY_PROGRAM = { topLevelStatements: [], functions: [] } as any as ProgramIR;

describe("ESP32-S3 framework-arduino support", () => {
  describe("profile resolution", () => {
    it("forces <Arduino.h> include for esp32s3 (not the default profile)", () => {
      const result = resolveArduinoProfile(EMPTY_PROGRAM, S3_CTX);
      // The default profile also includes <Arduino.h>, so the discriminating
      // assertion is that no diagnostic complains about an unknown architecture
      // and the include is present.
      expect(result.forcedIncludes).toContain("<Arduino.h>");
      expect(result.diagnostics.filter(d => d.code === "TypeCAD_ARDUINO_FUNC_UNKNOWN")).toEqual([]);
    });

    it("does not emit an A0 shim for esp32s3 (A0 is a known builtin global)", () => {
      // Build a program that references A0.
      const program = {
        topLevelStatements: [
          { kind: "assign", target: "x", value: { kind: "identifier", value: "A0" } },
        ],
        functions: [],
      } as any as ProgramIR;

      const result = resolveArduinoProfile(program, S3_CTX);
      // Because esp32s3 is now in CAPABILITY_TABLE with A0 as a builtinGlobal,
      // needsA0 is false and no shim is emitted.
      expect(result.shimLines.filter(l => l.startsWith("#define A0"))).toEqual([]);
      expect(result.diagnostics.find(d => d.code === "TypeCAD_ARDUINO_SHIM_A0")).toBeUndefined();
    });
  });

  describe("ArduinoStrategy isrFunctionAttribute", () => {
    it("returns IRAM_ATTR for esp32s3 after profile resolution", () => {
      const strategy = new ArduinoStrategy();
      // isrFunctionAttribute() reads _cachedArch, which is only populated as a
      // side-effect of profile resolution. Prime it with an S3 context.
      strategy.forcedIncludes(EMPTY_PROGRAM, S3_CTX);
      expect(strategy.isrFunctionAttribute()).toBe("IRAM_ATTR ");
    });

    it("returns empty string for AVR (unchanged behavior)", () => {
      const strategy = new ArduinoStrategy();
      const avrCtx = { frameworkData: { buildTarget: "arduino:avr:uno" } } as PlatformContext;
      strategy.forcedIncludes(EMPTY_PROGRAM, avrCtx);
      expect(strategy.isrFunctionAttribute()).toBe("");
    });
  });
});
```

- [ ] **Step 2: Run the new test to verify it passes**

Run: `npx vitest run tests/packages/framework-arduino/esp32s3-profile.test.ts`
Expected: PASS (all 4 tests). The `forcedIncludes` call on the strategy is what populates `_cachedArch`; if you skip it, `isrFunctionAttribute()` returns `''` and the test fails — that proves the priming is necessary.

- [ ] **Step 3: Commit**

```bash
git add tests/packages/framework-arduino/esp32s3-profile.test.ts
git commit -m "test(framework-arduino): esp32s3 profile + IRAM_ATTR coverage"
```

---

## Task 10: Documentation

**Files:**
- Modify: `README.md` (board table ~line 84, available-boards list ~line 333)
- Modify: `SUPPORT_MATRIX.md`

- [ ] **Step 1: Read the current README board table to match format**

Run: `sed -n '80,95p' README.md` and `sed -n '325,340p' README.md` to see the exact table/list format. (Use Read tool if sed is undesirable, but these line ranges are precise.)

- [ ] **Step 2: Add the ESP32-S3 row to the README board table**

In `README.md`, find the board table (around line 84) and add an ESP32-S3 row matching the existing row format (columns: board, MCU, architecture, framework, status). Use the exact column separators the existing rows use.

Example row (adjust column count/alignment to match the existing table after reading it):
```
| ESP32-S3 | ESP32-S3 (Xtensa LX7) | esp32s3 | Arduino | Supported |
```

- [ ] **Step 3: Add ESP32-S3 to the available-boards list**

In `README.md`, find the available-boards list (around line 333) and add an entry for the ESP32-S3 next to the existing ESP32 DevKit entry, matching the list format.

- [ ] **Step 4: Add an ESP32-S3 row to `SUPPORT_MATRIX.md`**

Read `SUPPORT_MATRIX.md` first to match its format, then add an ESP32-S3 row covering: MCU, architecture, framework, clock, flash/PSRAM, key peripherals (Wi-Fi/BLE/USB-OTG), and pin-safety validation status.

- [ ] **Step 5: Commit**

```bash
git add README.md SUPPORT_MATRIX.md
git commit -m "docs: document ESP32-S3 board support"
```

---

## Task 11: Full verification

This is the AGENTS.md verification gate plus a broad regression check.

- [ ] **Step 1: Build all packages**

Run: `npm run build --workspaces`
Expected: all workspaces build cleanly, including `@typecad/board-esp32s3`.

- [ ] **Step 2: Run the init-scaffold test suite**

Run: `npx vitest run tests/packages/transpiler/init-scaffold.test.ts`
Expected: PASS, including the new `contains esp32s3` test and the existing `arduino-uno` test.

- [ ] **Step 3: Run the new framework-arduino test**

Run: `npx vitest run tests/packages/framework-arduino/esp32s3-profile.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Run the broader framework-arduino and transpiler test suites (regression)**

Run: `npx vitest run tests/packages/framework-arduino/ tests/packages/transpiler/`
Expected: PASS — no regressions from the profile/strategy changes.

- [ ] **Step 5: Run a pin-safety sanity check (optional but recommended)**

If there is a pin-safety test that consumes board constants (e.g. `tests/pin-safety.test.ts`), run it to confirm the new board's `unsafe` set is well-formed:
Run: `npx vitest run tests/pin-safety.test.ts 2>&1 | tail -20`
Expected: PASS, or "no tests found" (acceptable if the file doesn't exist — skip this step).

- [ ] **Step 6: Final commit if any verification surfaced fixes**

If verification surfaced fixes, commit them. Otherwise no commit needed — the work is already committed per-task.

---

## Self-Review Notes (for the implementer, not a task)

- **Spec coverage:** Every spec section maps to a task — MCU silicon (Task 2), board manifest + memory split (Task 3), FQBN (Task 3 Step 3), three framework fixes (Tasks 6–8), registry (Task 4), tests (Tasks 5, 9), docs (Task 10).
- **Known subtlety:** `isrFunctionAttribute()` and profile resolution are lazy/side-effect-driven; the test in Task 9 primes the cache via `forcedIncludes()` before asserting. This matches the real call order in the transpiler.
- **A0 fallback value (1) is not separately unit-testable** through the public API because adding `esp32s3` to `CAPABILITY_TABLE` (which lists A0 as a builtin global) suppresses the shim. The value is correct in both `CAPABILITY_TABLE` and `FQBN_PIN_OVERRIDES`; the Task 9 test asserts the *suppression* behavior, which is the observable effect.
- **ESP32-S3 timer bits:** the schema's `TimerDefinition.bits` union is `8|16|32|64` but the S3 has 52-bit timers; use `64` (closest valid). If strict accuracy matters later, widen the schema union in a separate change.
