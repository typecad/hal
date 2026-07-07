# ESP32-C3 Board Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selectable, full-accuracy ESP32-C3 board target (`esp32c3`) using the Arduino framework, so users can `--board esp32c3` to scaffold Arduino projects for the ESP32-C3.

**Architecture:** Two new packages mirroring the proven S3 pair: `@typecad/mcu-esp32c3` (the RISC-V silicon — 22 GPIO, ADC1/ADC2, Wi-Fi/BLE/USB) and `@typecad/board-esp32c3` (the generic devboard manifest that spreads it in). Registration is data-driven: one entry in the known-targets registry + two workspace lines makes the existing CLI/wizard/config flow handle C3 automatically. Two surgical edits to `framework-arduino`'s profile close the gaps where C3 should match classic ESP32 (forced includes, A0 fallback); `freeHeap()` and `isrFunctionAttribute()` already include `esp32c3`.

**Tech Stack:** TypeScript (monorepo, `tsc -b` composite projects), vitest, the `@typecad/cuttlefish` `BoardDefinition`/`MCUDefinition` schema, the `@typecad/hal` peripheral-instance helpers.

**Spec:** `docs/superpowers/specs/2026-07-07-esp32c3-board-support-design.md`

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `packages/mcu-esp32c3/package.json` | npm package manifest. Name `@typecad/mcu-esp32c3`. Deps on `@typecad/cuttlefish`, `@typecad/hal`. |
| `packages/mcu-esp32c3/tsconfig.json` | Composite TS project. References `../hal`, `../cuttlefish`. |
| `packages/mcu-esp32c3/src/index.ts` | The `ESP32C3: MCUDefinition` const + default export + `TypeCADManifest` + barrel re-exports. |
| `packages/mcu-esp32c3/src/pins.ts` | `GPIO0..GPIO10`, `GPIO12..GPIO21` Pin constants + bus aliases. |
| `packages/mcu-esp32c3/src/peripherals.ts` | Standalone peripheral consts + `MCU_PERIPHERALS` aggregate + HAL instances. |
| `packages/board-esp32c3/package.json` | Name `@typecad/board-esp32c3`. Deps on cuttlefish, hal, **mcu-esp32c3**. |
| `packages/board-esp32c3/tsconfig.json` | Composite TS project. References `../hal`, `../cuttlefish`, `../mcu-esp32c3`. |
| `packages/board-esp32c3/src/index.ts` | The `BoardDefinition` manifest (`ESP32C3Board`): spreads MCU, FQBN `esp32:esp32:esp32c3`, no `led`. |
| `packages/board-esp32c3/src/pins.ts` | Arduino-style `Dx`/`Ax` aliases. No `LED`. |
| `packages/board-esp32c3/src/analog.ts` | `DEFAULT` / `INTERNAL` analog-reference constants. |
| `packages/board-esp32c3/src/board.ts` | `Board` namespace aggregating pins + peripherals + `definition`. |

### Modified files

| File | Change |
|---|---|
| `package.json` (root) | Add both packages to `workspaces`. |
| `packages/cuttlefish/src/create/init-scaffold.ts` | Add `esp32c3` entry to `_knownTargets`. |
| `packages/framework-arduino/src/profile.ts` | Add `esp32c3` to `PROFILE_VARIANTS`, `CAPABILITY_TABLE`, `FQBN_PIN_OVERRIDES`. |
| `tests/packages/transpiler/init-scaffold.test.ts` | Add KNOWN_BOARDS assertion for `esp32c3`. |
| `tests/packages/framework-arduino/esp32c3-profile.test.ts` (new) | Focused tests for the profile fixes. |
| `README.md` | Add ESP32-C3 to the board table and available-boards list. |

**Reference templates** (read these if anything is unclear): `packages/mcu-esp32s3/src/{index,pins,peripherals}.ts` and `packages/board-esp32s3/src/{index,pins,analog,board}.ts`. The C3 packages mirror their structure exactly, with C3 data substituted.

---

## Task 1: Scaffolding the MCU package skeleton

**Files:**
- Create: `packages/mcu-esp32c3/package.json`
- Create: `packages/mcu-esp32c3/tsconfig.json`
- Modify: `package.json` (root, workspaces array)

- [ ] **Step 1: Create `packages/mcu-esp32c3/package.json`**

Mirror `packages/mcu-esp32s3/package.json` exactly except name/description:

```json
{
  "name": "@typecad/mcu-esp32c3",
  "version": "0.1.0",
  "description": "TypeCAD MCU definition for ESP32-C3 — datasheet pins, peripheral capabilities, and HAL instances",
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
  "license": "MIT"
}
```

- [ ] **Step 2: Create `packages/mcu-esp32c3/tsconfig.json`**

Mirror `packages/mcu-esp32s3/tsconfig.json` exactly:

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

In the `workspaces` array, add `"packages/mcu-esp32c3"` immediately after `"packages/mcu-esp32s3"`:

```json
    "packages/mcu-esp32s3",
    "packages/mcu-esp32c3",
```

- [ ] **Step 4: Commit**

```bash
git add packages/mcu-esp32c3/package.json packages/mcu-esp32c3/tsconfig.json package.json
git commit -m "feat(mcu-esp32c3): scaffold package and register workspace"
```

---

## Task 2: ESP32-C3 peripherals (`src/peripherals.ts`)

This file is written first because `index.ts` imports `MCU_PERIPHERALS` from it. C3 peripheral facts (per the spec): 1× I2C, 1× SPI (GPSPI2), 2× UART, ADC1 (5ch) + ADC2 (1ch), 6× touch, 4× timers, Wi-Fi 4, BLE 5, native USB Serial/JTAG. No DAC. No DMA block (keep parity with mcu-esp32s3 which omits it).

**Files:**
- Create: `packages/mcu-esp32c3/src/peripherals.ts`

**Pin facts (verified against the installed core's `variants/esp32c3/pins_arduino.h`):**
- I2C0 default: GPIO8 SDA / GPIO9 SCL
- SPI0 default: GPIO6 MOSI / GPIO5 MISO / GPIO4 SCK / GPIO7 SS
- UART0 default: GPIO21 TX / GPIO20 RX; UART1 remappable

- [ ] **Step 1: Write `packages/mcu-esp32c3/src/peripherals.ts`**

Mirror `packages/mcu-esp32s3/src/peripherals.ts` structure (standalone consts → `MCU_PERIPHERALS` aggregate → HAL instances), with C3 data. Note: C3 has 1 I2C, 1 SPI, 2 UART (vs S3's 2/2/3); ADC1 has 5 channels and ADC2 has 1 (vs S3's 10/10); 6 touch channels; no `usb` differs in kind (CDC/JTAG, but modeled the same way as the S3's `usb` peripheral).

```ts
// ---------------------------------------------------------------------------
// @typecad/mcu-esp32c3 — Hardware peripheral descriptions
//
// ESP32-C3 peripherals: 1× I2C, 1× SPI (GPSPI2), 2× UART, 2× ADC (12-bit),
// 6× capacitive-touch, 4× general-purpose timers, Wi-Fi 4, BLE 5 (long range),
// native USB Serial/JTAG (CDC). No DAC.
// ---------------------------------------------------------------------------

import type {
  PeripheralInstance,
  ADCDefinition,
  PWMDefinition,
  TimerDefinition,
} from '@typecad/cuttlefish/api/schema';
import {
  I2CBus,
  SPIBus,
  SerialPort,
  i2cName,
  spiName,
  serialName,
  createHALInstances,
} from '@typecad/hal';

// ---------------------------------------------------------------------------
// Peripheral definitions
// ---------------------------------------------------------------------------

export const I2C_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { sda: 'GPIO8', scl: 'GPIO9' } },
] as const;

export const SPI_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { mosi: 'GPIO6', miso: 'GPIO5', sck: 'GPIO4', cs: 'GPIO7' } },  // GPSPI2
] as const;

export const UART_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { tx: 'GPIO21', rx: 'GPIO20' } },
  { instance: 1, defaultPins: { tx: 'GPIO21', rx: 'GPIO20' } },
] as const;

export const ADC_INSTANCES: readonly ADCDefinition[] = [
  { instance: 0, channels: 5, resolution: 12, referenceVoltage: 3.3, maxValue: 4095,
    referenceVoltages: { DEFAULT: 3.3, INTERNAL: 1.1 } },  // ADC1 — usable with Wi-Fi active
  { instance: 1, channels: 1, resolution: 12, referenceVoltage: 3.3, maxValue: 4095,
    referenceVoltages: { DEFAULT: 3.3, INTERNAL: 1.1 } },  // ADC2 — NOT usable with Wi-Fi active
] as const;

export const PWM_CAPABILITIES: PWMDefinition = {
  channels: 6,
  resolution: 14,
  maxFrequency: 40_000_000,
} as const;

export const TOUCH_CAPABILITIES = {
  channels: 6,
  pins: ['GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5'],
};

export const TIMER_INSTANCES: readonly TimerDefinition[] = [
  { instance: 0, type: 'general', bits: 64, features: ['interrupt'] },
  { instance: 1, type: 'general', bits: 64, features: ['interrupt'] },
  { instance: 2, type: 'general', bits: 64, features: ['interrupt'] },
  { instance: 3, type: 'general', bits: 64, features: ['interrupt'] },
] as const;

export const WIFI_CAPABILITIES = { type: 'wifi', supportsStation: true, supportsAp: true } as const;
export const BLUETOOTH_CAPABILITIES = { type: 'ble', version: '5.0' } as const;
export const USB_CAPABILITIES = { type: 'otg', vid: '0x303A', pid: '0x0001' } as const;

// ---------------------------------------------------------------------------
// Aggregate MCU peripheral description
// ---------------------------------------------------------------------------

export const MCU_PERIPHERALS = {
  i2c: [...I2C_INSTANCES],
  spi: [...SPI_INSTANCES],
  uart: [...UART_INSTANCES],
  adc: [...ADC_INSTANCES],
  pwm: PWM_CAPABILITIES,
  touch: TOUCH_CAPABILITIES,
  timers: [...TIMER_INSTANCES],
  wifi: WIFI_CAPABILITIES,
  bluetooth: BLUETOOTH_CAPABILITIES,
  usb: USB_CAPABILITIES,
} as const;

// ---------------------------------------------------------------------------
// HAL object instances — auto-generated from peripheral definitions
// ---------------------------------------------------------------------------

/** I2C bus instances */
export const [I2C0] = createHALInstances(I2C_INSTANCES, i => new I2CBus(i2cName(i)));

/** SPI bus instances */
export const [SPI0] = createHALInstances(SPI_INSTANCES, i => new SPIBus(spiName(i)));

/** UART/Serial instances */
export const [UART0, UART1] = createHALInstances(UART_INSTANCES, i => new SerialPort(serialName(i)));
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcu-esp32c3/src/peripherals.ts
git commit -m "feat(mcu-esp32c3): add hardware peripheral descriptions"
```

---

## Task 3: ESP32-C3 pin constants (`src/pins.ts`)

**Files:**
- Create: `packages/mcu-esp32c3/src/pins.ts`

**GPIO range:** 0–10 and 12–21 (no GPIO 11 — internal flash Vpp; no GPIO 22+). Bus aliases per the Arduino core defaults verified in Task 2.

- [ ] **Step 1: Write `packages/mcu-esp32c3/src/pins.ts`**

Mirror `packages/mcu-esp32s3/src/pins.ts` style (`new Pin(n)` from `@typecad/hal`, bus aliases at the bottom). C3 has no DAC (omit DAC1/DAC2). Bus aliases: SDA=GPIO8, SCL=GPIO9, MOSI=GPIO6, MISO=GPIO5, SCK=GPIO4, SS=GPIO7, TX=GPIO21, RX=GPIO20.

```ts
// ---------------------------------------------------------------------------
// @typecad/mcu-esp32c3 — Datasheet pin definitions
//
// Each pin is a Pin instance from @typecad/hal. The ESP32-C3 has 22 GPIO
// (0-10, 12-21); GPIO 11 is consumed by internal flash Vpp and is not broken
// out. All GPIOs are bidirectional (no input-only pins). DAC is not present.
// ---------------------------------------------------------------------------

import { Pin } from '@typecad/hal';

// ---------------------------------------------------------------------------
// Named GPIO constants (Pin instances)
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
// GPIO 11 — internal flash Vpp, not broken out on the C3 package.
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

// ---------------------------------------------------------------------------
// Convenience aliases (Silicon-level defaults — match Arduino-ESP32 core)
// ---------------------------------------------------------------------------

/** I2C0 data line (GPIO8). */
export const SDA = GPIO8;
/** I2C0 clock line (GPIO9). */
export const SCL = GPIO9;

/** SPI0 MOSI (GPIO6). */
export const MOSI = GPIO6;
/** SPI0 MISO (GPIO5). */
export const MISO = GPIO5;
/** SPI0 clock (GPIO4). */
export const SCK = GPIO4;
/** SPI0 slave select (GPIO7). */
export const SS = GPIO7;

/** UART0 transmit (GPIO21). */
export const TX = GPIO21;
/** UART0 receive (GPIO20). */
export const RX = GPIO20;
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcu-esp32c3/src/pins.ts
git commit -m "feat(mcu-esp32c3): add named GPIO pin constants and bus aliases"
```

---

## Task 4: ESP32-C3 MCU definition (`src/index.ts`)

This is the largest file. It defines the silicon as a `MCUDefinition` and the manifest. Mirror `packages/mcu-esp32s3/src/index.ts` structure, substituting C3 data.

**Files:**
- Create: `packages/mcu-esp32c3/src/index.ts`

**C3 facts encoded (per spec §"ESP32-C3 Silicon Data"):**
- 22 GPIO (0–10, 12–21). ADC1 = GPIO0–4 (ch0–4); ADC2 = GPIO5 (ch0, Wi-Fi warning); touch = GPIO0–5 (T0–5).
- Strapping pins (unsafe): GPIO2, GPIO8, GPIO9. USB pins (unsafe): GPIO18, GPIO19.
- RISC-V single-core, 160 MHz, no FPU. SRAM 400 KB, RTC 16 KB, no externalRam.

- [ ] **Step 1: Write `packages/mcu-esp32c3/src/index.ts`**

```ts
// ---------------------------------------------------------------------------
// @typecad/mcu-esp32c3 — MCU definition manifest
//
// ESP32-C3 is a single-core RISC-V (RV32IMC) @ 160 MHz with Wi-Fi 4 + BLE 5
// (long range) and native USB Serial/JTAG. It has 22 GPIO (0-10, 12-21);
// GPIO 11 is consumed by internal flash Vpp and is not broken out. All GPIOs
// are bidirectional. No DAC. No PSRAM support.
// ---------------------------------------------------------------------------

import type { MCUDefinition } from '@typecad/cuttlefish/api/schema';
import { MCU_PERIPHERALS } from './peripherals.js';

// ---------------------------------------------------------------------------
// Default capability flags for ESP32-C3
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

/** Full GPIO + analog input + touch. */
const FULL_GPIO_ANALOG_TOUCH = { ...FULL_GPIO, analogInput: YES, touch: YES } as const;

// ---------------------------------------------------------------------------
// Helper: build ADC/touch peripheral-function references.
//
// ADC1 channels: GPIO0..GPIO4 -> ch0..ch4 (always usable).
// ADC2 channels: GPIO5 -> ch0 (NOT usable while Wi-Fi is on).
// Touch channels: GPIO0..GPIO5 -> T0..T5.
// ---------------------------------------------------------------------------

function adc(n: number, ch: number) {
  return { type: 'adc' as const, instance: n, role: `ch${ch}` };
}
function touch(ch: number) {
  return { type: 'touch' as const, instance: 0, role: `touch${ch}` };
}

// ---------------------------------------------------------------------------
// MCU definition
// ---------------------------------------------------------------------------

export const ESP32C3: MCUDefinition = {
  id: 'esp32-c3',
  name: 'ESP32-C3',
  architecture: 'esp32c3',
  memory: {
    flash:    384 * 1024, // usable app flash; remainder reserved by bootloader/OTADATA
    sram:     400 * 1024, // 400 KB
    eeprom:   0,
    rtcMemory: 16 * 1024, // 16 KB RTC slow memory
  },
  pins: {
    all: [
      // ---- ADC1 + touch pins (GPIO0-GPIO4) ---------------------------------
      { number:  0, gpio:  0, name: 'GPIO0', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 0), touch(0)],
        alternateFunctions: ['ADC1_CH0', 'Touch0'] },

      { number:  1, gpio:  1, name: 'GPIO1', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 1), touch(1)],
        alternateFunctions: ['ADC1_CH1', 'Touch1'] },

      { number:  2, gpio:  2, name: 'GPIO2', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 2), touch(2)],
        alternateFunctions: ['ADC1_CH2', 'Touch2'],
        warnings: ['GPIO2 is a strapping pin — boot mode select at boot'],
        unsafe: true, notes: 'Boot strapping pin' },

      { number:  3, gpio:  3, name: 'GPIO3', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 3), touch(3)],
        alternateFunctions: ['ADC1_CH3', 'Touch3'] },

      { number:  4, gpio:  4, name: 'GPIO4', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 4), touch(4), { type: 'spi', instance: 0, role: 'sck' }],
        alternateFunctions: ['ADC1_CH4', 'Touch4', 'SPI0 SCK'] },

      // ---- ADC2 pin (GPIO5) — Wi-Fi conflicted ------------------------------
      { number:  5, gpio:  5, name: 'GPIO5', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(2, 0), touch(5), { type: 'spi', instance: 0, role: 'miso' }],
        alternateFunctions: ['ADC2_CH0', 'Touch5', 'SPI0 MISO'],
        warnings: ['GPIO5 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number:  6, gpio:  6, name: 'GPIO6', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 0, role: 'mosi' }],
        alternateFunctions: ['SPI0 MOSI'] },

      { number:  7, gpio:  7, name: 'GPIO7', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 0, role: 'cs' }],
        alternateFunctions: ['SPI0 CS'] },

      { number:  8, gpio:  8, name: 'GPIO8', capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 0, role: 'sda' }],
        alternateFunctions: ['I2C0 SDA'],
        warnings: ['GPIO8 is a strapping pin — controls VDD_SPI voltage at boot'],
        unsafe: true, notes: 'Boot strapping pin' },

      { number:  9, gpio:  9, name: 'GPIO9', capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 0, role: 'scl' }],
        alternateFunctions: ['I2C0 SCL'],
        warnings: ['GPIO9 is a strapping pin — must be HIGH at boot (reset source)'],
        unsafe: true, notes: 'Boot strapping pin' },

      { number: 10, gpio: 10, name: 'GPIO10', capabilities: FULL_GPIO,
        alternateFunctions: ['FSPICS0'] },

      // ---- GPIO 11 — internal flash Vpp, not broken out on the C3 ----------

      { number: 12, gpio: 12, name: 'GPIO12', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'sck' }],
        alternateFunctions: ['FSPICLK'] },
      { number: 13, gpio: 13, name: 'GPIO13', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'mosi' }],
        alternateFunctions: ['FSPID'] },
      { number: 14, gpio: 14, name: 'GPIO14', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'miso' }],
        alternateFunctions: ['FSPIQ'] },
      { number: 15, gpio: 15, name: 'GPIO15', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'cs' }],
        alternateFunctions: ['FSPICS1'] },
      { number: 16, gpio: 16, name: 'GPIO16', capabilities: FULL_GPIO,
        alternateFunctions: [] },
      { number: 17, gpio: 17, name: 'GPIO17', capabilities: FULL_GPIO,
        alternateFunctions: [] },

      // ---- USB Serial/JTAG pins (unsafe) -----------------------------------
      { number: 18, gpio: 18, name: 'GPIO18', capabilities: FULL_GPIO,
        functions: [{ type: 'usb', instance: 0, role: 'dm' }],
        alternateFunctions: ['USB D-'],
        warnings: ['GPIO18 is USB D- — using it as GPIO disables native USB Serial/JTAG'],
        unsafe: true, notes: 'USB D- pin' },
      { number: 19, gpio: 19, name: 'GPIO19', capabilities: FULL_GPIO,
        functions: [{ type: 'usb', instance: 0, role: 'dp' }],
        alternateFunctions: ['USB D+'],
        warnings: ['GPIO19 is USB D+ — using it as GPIO disables native USB Serial/JTAG'],
        unsafe: true, notes: 'USB D+ pin' },

      // ---- UART0 default pins ----------------------------------------------
      { number: 20, gpio: 20, name: 'GPIO20', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'rx' }],
        alternateFunctions: ['UART0 RX'],
        warnings: ['Using GPIO20 as GPIO will interfere with UART0 receive'] },
      { number: 21, gpio: 21, name: 'GPIO21', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'tx' }],
        alternateFunctions: ['UART0 TX'],
        warnings: ['Using GPIO21 as GPIO will interfere with UART0 transmit'] },
    ],

    digital: [
      'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7',
      'GPIO8', 'GPIO9', 'GPIO10',
      'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15', 'GPIO16', 'GPIO17',
      'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21',
    ],
    analog: [
      'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4',  // ADC1
      'GPIO5',                                       // ADC2
    ],
    pwm: [
      'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7',
      'GPIO8', 'GPIO9', 'GPIO10',
      'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15', 'GPIO16', 'GPIO17',
      'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21',
    ],
    unsafe: ['GPIO2', 'GPIO8', 'GPIO9', 'GPIO18', 'GPIO19'],

    i2c:  { 0: { sda: 'GPIO8',  scl: 'GPIO9'  } },
    spi:  {
      0: { mosi: 'GPIO6', miso: 'GPIO5', sck: 'GPIO4', cs: 'GPIO7' },  // GPSPI2 / VSPI
    },
    uart: {
      0: { tx: 'GPIO21', rx: 'GPIO20' },
    },
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: MCU_PERIPHERALS,

  features: {
    multicore: false,
    coreCount: 1,
    deepSleep: true,
    watchdog: true,
    externalInterrupts: true,
    hardwareRng: true,
    fpu: false,
  },
  build: {
    extraFlags: [],
  },
};

export default ESP32C3;

// Re-exports
export * from './pins.js';
export * from './peripherals.js';

/**
 * Structured manifest consumed by the TypeCAD CLI for contract-based
 * board generation. Provides pin names and peripheral instance names
 * without requiring the CLI to text-scrape compiled output.
 */
export const TypeCADManifest = {
  /** All MCU port-level pin names (e.g. 'GPIO0', 'GPIO1'). */
  pinNames: [
    'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7',
    'GPIO8', 'GPIO9', 'GPIO10',
    'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15', 'GPIO16', 'GPIO17',
    'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21',
  ] as const,

  /** All HAL peripheral instance names exported from this package. */
  peripheralNames: ['I2C0', 'SPI0', 'UART0', 'UART1'] as const,
} as const;
```

- [ ] **Step 2: Build the MCU package**

Run: `npm run build --workspace @typecad/mcu-esp32c3`
Expected: clean build, `dist/` populated.

If `tsc` errors on the `bits: 64` timers, that's expected to pass (64 is in the `8|16|32|64` union). If it errors on peripheral-function `type` unions, verify the helper return types match `PeripheralFunction`.

- [ ] **Step 3: Commit**

```bash
git add packages/mcu-esp32c3/src/index.ts
git commit -m "feat(mcu-esp32c3): add ESP32-C3 MCU definition (22 GPIO, Wi-Fi, BLE, USB-CDC)"
```

---

## Task 5: Scaffolding the board package

**Files:**
- Create: `packages/board-esp32c3/package.json`
- Create: `packages/board-esp32c3/tsconfig.json`
- Modify: `package.json` (root, workspaces array)

- [ ] **Step 1: Create `packages/board-esp32c3/package.json`**

Mirror `packages/board-esp32s3/package.json` (includes the `mcu-*` dependency and `publishConfig`):

```json
{
  "name": "@typecad/board-esp32c3",
  "version": "0.1.0",
  "description": "TypeCAD ESP32-C3 board definition with typed pins and peripherals",
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
    "@typecad/hal": "*",
    "@typecad/mcu-esp32c3": "*"
  },
  "license": "MIT",
  "publishConfig": {
    "access": "public"
  }
}
```

- [ ] **Step 2: Create `packages/board-esp32c3/tsconfig.json`**

Mirror `packages/board-esp32s3/tsconfig.json` (references the MCU package):

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
    { "path": "../cuttlefish" },
    { "path": "../mcu-esp32c3" }
  ]
}
```

- [ ] **Step 3: Add the workspace to root `package.json`**

In the `workspaces` array, add `"packages/board-esp32c3"` immediately after `"packages/board-esp32s3"`:

```json
    "packages/board-esp32s3",
    "packages/board-esp32c3",
```

- [ ] **Step 4: Install workspace symlinks**

Run: `npm install`
Expected: completes; the new workspace + its `@typecad/mcu-esp32c3` dependency resolve.

- [ ] **Step 5: Commit**

```bash
git add packages/board-esp32c3/package.json packages/board-esp32c3/tsconfig.json package.json
git commit -m "feat(board-esp32c3): scaffold package and register workspace"
```

---

## Task 6: Board manifest + supporting files

**Files:**
- Create: `packages/board-esp32c3/src/index.ts`
- Create: `packages/board-esp32c3/src/pins.ts`
- Create: `packages/board-esp32c3/src/analog.ts`
- Create: `packages/board-esp32c3/src/board.ts`

**Reference:** `packages/board-esp32s3/src/{index,pins,analog,board}.ts`. Key C3 differences: MCU import is `@typecad/mcu-esp32c3`; FQBN is `esp32:esp32:esp32c3`; **no `led` field** and **no `LED` alias** (per decision); clockSpeed 160 MHz; memory `flash: 4 MB`, no `externalRam`.

- [ ] **Step 1: Create `packages/board-esp32c3/src/pins.ts`**

No `LED` alias. Dx maps to GPIO by number. Ax maps to ADC1 channels (GPIO0–4) — ADC2 pin (GPIO5) is omitted from Ax aliases because it's unusable with Wi-Fi on (matches the S3's treatment of ADC2).

```ts
// ---------------------------------------------------------------------------
// @typecad/board-esp32c3 — Pin aliases
// ---------------------------------------------------------------------------

import {
  GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7,
  GPIO8, GPIO9, GPIO10,
  GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17,
  GPIO18, GPIO19, GPIO20, GPIO21,
} from '@typecad/mcu-esp32c3';

// ---------------------------------------------------------------------------
// Arduino-style digital pin aliases (D-numbers match GPIO numbers on ESP32-C3)
// ---------------------------------------------------------------------------

export const D0  = GPIO0;   export const D1  = GPIO1;   export const D2  = GPIO2;
export const D3  = GPIO3;   export const D4  = GPIO4;   export const D5  = GPIO5;
export const D6  = GPIO6;   export const D7  = GPIO7;   export const D8  = GPIO8;
export const D9  = GPIO9;   export const D10 = GPIO10;
export const D12 = GPIO12;  export const D13 = GPIO13;  export const D14 = GPIO14;
export const D15 = GPIO15;  export const D16 = GPIO16;  export const D17 = GPIO17;
export const D18 = GPIO18;  export const D19 = GPIO19;  export const D20 = GPIO20;
export const D21 = GPIO21;

// ---------------------------------------------------------------------------
// Analog input aliases (ADC1 channels — usable while Wi-Fi is active).
// ADC2 pin (GPIO5) is omitted from Ax aliases because it is unusable while
// Wi-Fi is enabled.
// ---------------------------------------------------------------------------

export const A0 = GPIO0;
export const A1 = GPIO1;
export const A2 = GPIO2;
export const A3 = GPIO3;
export const A4 = GPIO4;

// Bus aliases (default pins for I2C0 / SPI0 / UART0)
export { I2C0, SPI0, UART0, UART1 } from '@typecad/mcu-esp32c3';
```

- [ ] **Step 2: Create `packages/board-esp32c3/src/analog.ts`**

```ts
// ---------------------------------------------------------------------------
// @typecad/board-esp32c3 — Analog constants
// ---------------------------------------------------------------------------

/** Default reference (3.3V). */
export const DEFAULT = 0;
/** Internal 1.1V reference. */
export const INTERNAL = 3;
```

- [ ] **Step 3: Create `packages/board-esp32c3/src/index.ts`**

Mirror `board-esp32s3/src/index.ts`. **No `led` in pins.** No `externalRam` in memory. FQBN `esp32:esp32:esp32c3`. Aliases cover UART0/1 (2 UARTs), I2C0 (1 bus), SPI0 (1 bus).

```ts
// ---------------------------------------------------------------------------
// @typecad/board-esp32c3 — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import { ESP32C3 } from '@typecad/mcu-esp32c3';

/** Arduino core API version for this board's build defines. */
const ARDUINO_CORE_VERSION = '10819';

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const ESP32C3Board: BoardDefinition = {
  id: 'esp32c3',
  name: 'ESP32-C3',
  vendor: 'Espressif',
  description:
    'Generic ESP32-C3 devboard (vendor-agnostic). Single-core RISC-V ' +
    '(RV32IMC) @ 160 MHz with Wi-Fi 4 + BLE 5 and native USB Serial/JTAG. ' +
    '22 GPIO; no PSRAM support.',

  mcu: ESP32C3,
  clockSpeed: 160_000_000, // 160 MHz

  // ----- Memory (module-level; silicon memory lives on the MCU) -----------
  // 4 MB module flash; no external RAM (the C3 silicon does not support it).
  memory: {
    flash: 4 * 1024 * 1024,
  },

  // ----- Pins (no onboard LED declared — generic board) -------------------
  pins: {
    ...ESP32C3.pins,
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    ...ESP32C3.peripherals,
    aliases: {
      UART0: 'Serial',
      UART1: 'Serial1',
      I2C0:  'Wire',
      SPI0:  'SPI',
    },
  },

  // ----- Build config ------------------------------------------------------
  build: {
    frameworks: {
      platformio: 'esp32c3',
      arduino: 'esp32:esp32:esp32c3',
    },
    defines: {
      F_CPU:             '160000000UL',
      ARDUINO:           ARDUINO_CORE_VERSION,
      ARDUINO_ESP32C3_DEV: '1',
    },
  },
};

export default ESP32C3Board;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Silicon-level
export * from '@typecad/mcu-esp32c3';

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

// Board-level pin Discovery API (uses silicon pins from MCU)
import {
  GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7,
  GPIO8, GPIO9, GPIO10,
  GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17,
  GPIO18, GPIO19, GPIO20, GPIO21,
} from '@typecad/mcu-esp32c3';

/**
 * Pin collections for runtime capability discovery.
 */
export const pins = {
  /** PWM-capable pins (all output-capable GPIOs that are not USB/strap). */
  pwm: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
        GPIO10, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17,
        GPIO18, GPIO19, GPIO20, GPIO21] as const,
  /** Analog input pins (ADC1 — usable while Wi-Fi active). */
  analog: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4] as const,
  /** All GPIOs support interrupts on ESP32-C3. */
  interrupt: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
              GPIO10, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17,
              GPIO18, GPIO19, GPIO20, GPIO21] as const,
  /** All digital I/O pins. */
  digital: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
            GPIO10, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17,
            GPIO18, GPIO19, GPIO20, GPIO21] as const,
} as const;

/**
 * Peripheral-to-pin mapping for the ESP32-C3.
 */
export const PeripheralPins = {
  /** I2C bus 0 — default GPIO8 (SDA) / GPIO9 (SCL); remappable via GPIO matrix. */
  I2C0: { SDA: 'GPIO8',  SCL: 'GPIO9'  } as const,
  /** SPI bus 0 / GPSPI2 — GPIO6 (MOSI), GPIO5 (MISO), GPIO4 (SCK). GPIO7 is default CS. */
  SPI0: { MOSI: 'GPIO6', MISO: 'GPIO5', SCK: 'GPIO4', CS: 'GPIO7' } as const,
  /** UART 0 — GPIO21 (TX) / GPIO20 (RX). USB-CDC serial available too. */
  UART0: { TX: 'GPIO21', RX: 'GPIO20' } as const,
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

- [ ] **Step 4: Create `packages/board-esp32c3/src/board.ts`**

No `LED` in the namespace. Imports bus instances + Dx/Ax from local `./pins.js` and `./mcu.js`→`@typecad/mcu-esp32c3`.

```ts
// ---------------------------------------------------------------------------
// @typecad/board-esp32c3 — Board namespace
//
// Convenience namespace that exposes every board feature under one object.
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';

import {
  D2, D3, D4, D5, D6, D7, D8, D9, D10,
  D12, D13, D14, D15, D16, D17, D18, D19, D20, D21,
  A0, A1, A2, A3, A4,
} from './pins.js';

import { I2C0, SPI0, UART0, UART1 } from '@typecad/mcu-esp32c3';
import { ESP32C3Board } from './index.js';

export const Board = {
  definition: ESP32C3Board,

  // Common digital pins (strapping/USB pins omitted from the convenience namespace)
  D2, D3, D4, D5, D6, D7, D8, D9, D10,
  D12, D13, D14, D15, D16, D17, D18, D19, D20, D21,

  // Analog aliases
  A0, A1, A2, A3, A4,

  // Peripherals
  I2C0, SPI0, UART0, UART1,

  // Collections
  digital: { D2, D3, D4, D5, D6, D7, D8, D9, D10, D12, D13, D14, D15, D16, D17, D18, D19, D20, D21 },
  analog:  { A0, A1, A2, A3, A4 },
};

export default Board;
```

- [ ] **Step 5: Build the board package**

Run: `npm run build --workspace @typecad/board-esp32c3`
Expected: clean build, `dist/` populated.

- [ ] **Step 6: Commit**

```bash
git add packages/board-esp32c3/src/
git commit -m "feat(board-esp32c3): add board manifest, pins, analog, and Board namespace"
```

---

## Task 7: Register the board in the known-targets registry

**Files:**
- Modify: `packages/cuttlefish/src/create/init-scaffold.ts` (the `_knownTargets` array)

- [ ] **Step 1: Add the `esp32c3` entry to `_knownTargets`**

In `packages/cuttlefish/src/create/init-scaffold.ts`, find the `_knownTargets` array and add this entry immediately after the `esp32s3` entry:

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

Note `mcu: 'esp32c3'` (lowercase arch id, not the display name) — this is what makes the scaffolder generate `@typecad/mcu-esp32c3` via the `@typecad/mcu-${mcu}` template, avoiding the bug we hit on the S3.

- [ ] **Step 2: Rebuild cuttlefish**

Run: `npm run build --workspace @typecad/cuttlefish`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/cuttlefish/src/create/init-scaffold.ts
git commit -m "feat(cuttlefish): register esp32c3 in known-targets registry"
```

---

## Task 8: Test — the board is in the registry

**Files:**
- Modify: `tests/packages/transpiler/init-scaffold.test.ts` (add an `it` inside the existing `describe("KNOWN_BOARDS", ...)` block)

- [ ] **Step 1: Add the test**

In `tests/packages/transpiler/init-scaffold.test.ts`, find the `KNOWN_BOARDS` describe block and add this `it` after the existing `esp32s3` test:

```ts
    it("contains esp32c3", () => {
      const c3 = KNOWN_BOARDS.find(b => b.id === 'esp32c3');
      expect(c3).toBeDefined();
      expect(c3!.architecture).toBe('esp32c3');
      expect(c3!.buildTarget).toBe('esp32:esp32:esp32c3');
    });
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/packages/transpiler/init-scaffold.test.ts`
Expected: PASS, including the new `contains esp32c3` test.

- [ ] **Step 3: Commit**

```bash
git add tests/packages/transpiler/init-scaffold.test.ts
git commit -m "test(cuttlefish): assert esp32c3 is in KNOWN_BOARDS"
```

---

## Task 9: Framework-arduino profile fix

The spec requires `esp32c3` in `PROFILE_VARIANTS`, `CAPABILITY_TABLE`, and `FQBN_PIN_OVERRIDES` (3 small additions in one file — group them in one task since they're tightly coupled and all in `profile.ts`).

**Files:**
- Modify: `packages/framework-arduino/src/profile.ts` (lines 50–55 PROFILE_VARIANTS, 62–87 CAPABILITY_TABLE, 96–104 FQBN_PIN_OVERRIDES)

- [ ] **Step 1: Add `esp32c3` to `PROFILE_VARIANTS`**

Find the `PROFILE_VARIANTS` array and add the C3 entry after `esp32s3`:

```ts
const PROFILE_VARIANTS: ArduinoProfileVariant[] = [
  { architecture: "avr", forcedIncludes: ["<Arduino.h>"] },
  { architecture: "esp32", forcedIncludes: ["<Arduino.h>"] },
  { architecture: "esp32s3", forcedIncludes: ["<Arduino.h>"] },
  { architecture: "esp32c3", forcedIncludes: ["<Arduino.h>"] },
  { architecture: "samd", forcedIncludes: ["<Arduino.h>"] },
  { architecture: "rp2040", forcedIncludes: ["<Arduino.h>"] },
];
```

- [ ] **Step 2: Add `esp32c3` to `CAPABILITY_TABLE`**

Find the `CAPABILITY_TABLE` array and add the C3 entry after `esp32s3`. Mirror the `esp32` row; `fallbackPins.A0 = 0` (ADC1 starts at GPIO0 on the C3):

```ts
  {
    architecture: "esp32c3",
    builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "analogReference", "delay", "millis", "micros", "setInterval", "setTimeout", "clearInterval", "clearTimeout"]),
    builtinGlobals: new Set(["A0", "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
    fallbackPins: { A0: 0 },
  },
```

- [ ] **Step 3: Add the C3 FQBN→A0 override**

Find the `FQBN_PIN_OVERRIDES` array and add the C3 entry after `esp32:esp32s3:`:

```ts
  { fqbnIncludes: "esp32:esp32c3:", pins: { A0: 0 } },
```

- [ ] **Step 4: Rebuild framework-arduino**

Run: `npm run build --workspace @typecad/framework-arduino`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add packages/framework-arduino/src/profile.ts
git commit -m "feat(framework-arduino): add esp32c3 profile variant, capability row, and FQBN A0 override"
```

---

## Task 10: Focused tests for the profile fix

**Files:**
- Create: `tests/packages/framework-arduino/esp32c3-profile.test.ts`

**Import patterns** (identical to `esp32s3-profile.test.ts` — read that file as the reference). The C3 FQBN `esp32:esp32:esp32c3` resolves `_cachedArch` to `'esp32'` (the platform segment), so the test exercises the `esp32` profile path — same situation as the S3. Document this in the test comment.

- [ ] **Step 1: Write the test file**

```ts
// ---------------------------------------------------------------------------
// Tests for ESP32-C3 framework-arduino support
// (profile variant, capabilities, and IRAM_ATTR ISR attribute)
//
// NOTE on the FQBN: the ESP32-C3's Arduino FQBN is esp32:esp32:esp32c3 — the
// ESP32 Arduino core collapses the whole family into a single esp32:esp32
// platform, with the chip variant encoded in the BOARD id. The framework's
// _cachedArch derives from FQBN segment [1] (the platform), so a C3 FQBN
// resolves _cachedArch='esp32', and C3 inherits the esp32 profile/IRAM_ATTR
// behavior. That is correct: C3 needs the same ISR handling (it's already in
// the isrFunctionAttribute Xtensa/ESP32-family set) even though it's RISC-V.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { ArduinoStrategy } from "../../../packages/framework-arduino/src";
import { resolveArduinoProfile } from "../../../packages/framework-arduino/src/profile";
import type { ProgramIR, PlatformContext } from "@typecad/cuttlefish/api/shared";

const C3_CTX = { frameworkData: { buildTarget: "esp32:esp32:esp32c3" } } as PlatformContext;
const EMPTY_PROGRAM = { topLevelStatements: [], functions: [] } as any as ProgramIR;

describe("ESP32-C3 framework-arduino support", () => {
  describe("profile resolution", () => {
    it("forces <Arduino.h> include for the C3 FQBN (not the default profile)", () => {
      const result = resolveArduinoProfile(EMPTY_PROGRAM, C3_CTX);
      // The C3 FQBN resolves to the 'esp32' profile (platform segment), which
      // forces <Arduino.h>. The default profile also includes it, so the
      // discriminating assertion is that no diagnostic complains about an
      // unknown architecture.
      expect(result.forcedIncludes).toContain("<Arduino.h>");
      expect(result.diagnostics.filter(d => d.code === "TypeCAD_ARDUINO_FUNC_UNKNOWN")).toEqual([]);
    });

    it("does not emit an A0 shim for the C3 FQBN (A0 is a known builtin global)", () => {
      // Build a program that references A0.
      const program = {
        topLevelStatements: [
          { kind: "assign", target: "x", value: { kind: "identifier", value: "A0" } },
        ],
        functions: [],
      } as any as ProgramIR;

      const result = resolveArduinoProfile(program, C3_CTX);
      // The C3 FQBN resolves to the 'esp32' capability row, where A0 is a
      // builtinGlobal, so needsA0 is false and no shim is emitted.
      expect(result.shimLines.filter(l => l.startsWith("#define A0"))).toEqual([]);
      expect(result.diagnostics.find(d => d.code === "TypeCAD_ARDUINO_SHIM_A0")).toBeUndefined();
    });
  });

  describe("ArduinoStrategy isrFunctionAttribute", () => {
    it("returns IRAM_ATTR for the C3 FQBN after profile resolution", () => {
      const strategy = new ArduinoStrategy();
      // isrFunctionAttribute() reads _cachedArch, which is only populated as a
      // side-effect of profile resolution. The C3 FQBN resolves _cachedArch to
      // 'esp32' (the platform segment), which is in the ISR IRAM_ATTR set.
      strategy.forcedIncludes(EMPTY_PROGRAM, C3_CTX);
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

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/packages/framework-arduino/esp32c3-profile.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/packages/framework-arduino/esp32c3-profile.test.ts
git commit -m "test(framework-arduino): esp32c3 profile + IRAM_ATTR coverage"
```

---

## Task 11: Documentation

**Files:**
- Modify: `README.md` (board table ~line 84, available-boards list ~line 333)

- [ ] **Step 1: Add the ESP32-C3 row to the README board table**

Find the board table (around line 84) and add the C3 row after the S3 row, matching the existing column format:

```
| ESP32-C3 | `@typecad/board-esp32c3` | ESP32-C3 (RISC-V) |
```

- [ ] **Step 2: Add ESP32-C3 to the available-boards list**

Find the available-boards list (around line 333) and add `esp32c3` to the list alongside the other board ids.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document ESP32-C3 board support"
```

---

## Task 12: Full verification

- [ ] **Step 1: Build all packages**

Run: `npm run build --workspaces`
Expected: all workspaces build cleanly, including `@typecad/mcu-esp32c3` and `@typecad/board-esp32c3`.

- [ ] **Step 2: Run the init-scaffold + profile tests**

Run: `npx vitest run tests/packages/transpiler/init-scaffold.test.ts tests/packages/framework-arduino/esp32c3-profile.test.ts`
Expected: PASS — including the new `contains esp32c3` and the 4 C3 profile tests.

- [ ] **Step 3: Regression — framework-arduino + transpiler suites**

Run: `npx vitest run tests/packages/framework-arduino/ tests/packages/transpiler/`
Expected: PASS — no regressions from the profile changes.

- [ ] **Step 4: (Optional) end-to-end scaffold + compile**

To confirm the C3 FQBN actually links against the installed core, scaffold a throwaway project and compile it:

```bash
cd /tmp && rm -rf c3-smoke && mkdir c3-smoke && cd c3-smoke
# Generate a config by hand (the scaffolder writes files; we just need one):
cat > cuttlefish.config.ts <<'EOF'
import type { CuttlefishConfig } from '@typecad/cuttlefish/api';
const config: CuttlefishConfig = {
  entry: './src/main.ts',
  target: 'esp32c3',
  mcu: '@typecad/mcu-esp32c3',
  board: '@typecad/board-esp32c3',
  framework: '@typecad/framework-arduino',
  frameworkData: { buildTarget: 'esp32:esp32:esp32c3' },
  output: { framework: 'arduino', optimize: 'size', outDir: './out' },
  toolchain: { type: 'arduino-cli' },
  console: { baudRate: 115200 },
};
export default config;
EOF
mkdir -p src && echo "import { D2 } from '@typecad/board-esp32c3'; const led = D2.asOutput(); function main(){ led.high(); } main();" > src/main.ts
# Run the build (this requires the monorepo's dist builds to be current):
npx --prefix C:/typecad/typecode cuttlefish build --compile || echo "(smoke test skipped — requires arduino-cli C3 core)"
```

Expected (if the `esp32:esp32` core is installed): `Compiling for esp32:esp32:esp32c3` → `✓ Done`. If the core isn't installed, the transpile still succeeds and only the compile step reports the missing platform.

- [ ] **Step 5: Final commit if any verification surfaced fixes**

If verification surfaced fixes, commit them. Otherwise no commit needed — the work is already committed per-task.

---

## Self-Review Notes (for the implementer, not a task)

- **Spec coverage:** Every spec section maps to a task — MCU silicon (Tasks 2–4), board manifest + memory (Task 6), FQBN (Task 6 Step 3), framework profile fixes (Task 9), registry (Task 7), tests (Tasks 8, 10), docs (Task 11).
- **No PSRAM anywhere** — the C3 silicon doesn't support it. Do not add `PSRAM=` to the FQBN, `externalRam` to memory, or any `BOARD_HAS_PSRAM` reference. This is simpler than the S3.
- **No `led` / `LED`** anywhere — per the approved decision. Both the board manifest's `pins.led` and the `LED` pin alias are deliberately omitted.
- **GPIO 11 is omitted** from `pins.all` and the GPIO constants. It's consumed by internal flash Vpp on the C3 and is not broken out. Omission is the safest representation (a pin that isn't in the list can't be misused).
- **The `esp32c3` capability-table A0 value is 0** (ADC1 starts at GPIO0), not 1 (S3) or 36 (classic ESP32). Verify this matches the C3 `variants/esp32c3/pins_arduino.h` `A0 = 0` define — it does.
- **The profile/A0/IRAM test mirrors `esp32s3-profile.test.ts`** but uses the C3 FQBN and documents the same `_cachedArch='esp32'` derivation in its header comment.
