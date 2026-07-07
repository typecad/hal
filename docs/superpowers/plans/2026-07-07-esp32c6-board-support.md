# ESP32-C6 Board Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selectable, full-accuracy ESP32-C6 board target (`esp32c6`) using the Arduino framework — the first ESP32 with Wi-Fi 6.

**Architecture:** Two new packages mirroring the C3 pair: `@typecad/mcu-esp32c6` (RISC-V silicon — 30 GPIO, Wi-Fi 6, BLE 5.3, USB-OTG) and `@typecad/board-esp32c6` (generic devboard). Unlike the C3, `esp32c6` is not anticipated anywhere in the framework, so this plan also adds it to the `ArchitectureIdentifier` union (both copies) and to every ESP32-family code path (`freeHeap`, `isrFunctionAttribute`, `heap-analysis`, profile).

**Tech Stack:** TypeScript (monorepo, `tsc -b` composite projects), vitest, the `@typecad/cuttlefish` schema, `@typecad/hal` helpers.

**Spec:** `docs/superpowers/specs/2026-07-07-esp32c6-board-support-design.md`

**Reference template:** `packages/mcu-esp32c3/src/{index,pins,peripherals}.ts` and `packages/board-esp32c3/src/{index,pins,analog,board}.ts`. The C6 packages mirror their structure with C6 data substituted.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `packages/mcu-esp32c6/package.json` | npm manifest. Deps: `@typecad/cuttlefish`, `@typecad/hal`. |
| `packages/mcu-esp32c6/tsconfig.json` | Composite TS project. References `../hal`, `../cuttlefish`. |
| `packages/mcu-esp32c6/src/index.ts` | `ESP32C6: MCUDefinition` + manifest + re-exports. |
| `packages/mcu-esp32c6/src/pins.ts` | `GPIO0..GPIO30` Pin constants + bus aliases. |
| `packages/mcu-esp32c6/src/peripherals.ts` | Standalone peripheral consts + `MCU_PERIPHERALS` + HAL instances. |
| `packages/board-esp32c6/package.json` | Deps: cuttlefish, hal, **mcu-esp32c6**. |
| `packages/board-esp32c6/tsconfig.json` | References `../hal`, `../cuttlefish`, `../mcu-esp32c6`. |
| `packages/board-esp32c6/src/index.ts` | `BoardDefinition`: FQBN `esp32:esp32:esp32c6`, no `led`. |
| `packages/board-esp32c6/src/pins.ts` | `Dx`/`Ax` aliases. No `LED`. |
| `packages/board-esp32c6/src/analog.ts` | `DEFAULT` / `INTERNAL`. |
| `packages/board-esp32c6/src/board.ts` | `Board` namespace. |

### Modified files

| File | Change |
|---|---|
| `package.json` (root) | Add both packages to `workspaces`. |
| `packages/cuttlefish/src/api/board-types.ts:9` | Add `'esp32c6'` to `ArchitectureIdentifier`. |
| `packages/hal/src/core/board-types.ts` | Same addition (duplicate union). |
| `packages/framework-arduino/src/strategy.ts:234` | `freeHeap`: add `\|\| arch === 'esp32c6'`. |
| `packages/framework-arduino/src/strategy.ts:1004` | `isrFunctionAttribute`: add `\|\| arch === 'esp32c6'`. |
| `packages/cuttlefish/src/ir/heap-analysis.ts:74` | add `\|\| arch === 'esp32c6'`. |
| `packages/framework-arduino/src/profile.ts` | PROFILE_VARIANTS + CAPABILITY_TABLE + FQBN_PIN_OVERRIDES. |
| `packages/cuttlefish/src/create/init-scaffold.ts` | Add `esp32c6` to `_knownTargets`. |
| `tests/packages/transpiler/init-scaffold.test.ts` | KNOWN_BOARDS test. |
| `tests/packages/framework-arduino/esp32c6-profile.test.ts` (new) | Profile tests. |
| `README.md` | Board table + available-boards list. |

---

## Task 1: Scaffold the MCU package

**Files:**
- Create: `packages/mcu-esp32c6/package.json`, `packages/mcu-esp32c6/tsconfig.json`
- Modify: `package.json` (root workspaces)

- [ ] **Step 1: Create `packages/mcu-esp32c6/package.json`**

```json
{
  "name": "@typecad/mcu-esp32c6",
  "version": "0.1.0",
  "description": "TypeCAD MCU definition for ESP32-C6 — datasheet pins, peripheral capabilities, and HAL instances",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": { "build": "tsc" },
  "dependencies": {
    "@typecad/cuttlefish": "*",
    "@typecad/hal": "*"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Create `packages/mcu-esp32c6/tsconfig.json`**

Identical to `packages/mcu-esp32c3/tsconfig.json`:

```json
{
  "compilerOptions": {
    "composite": true, "target": "ES2021", "module": "Node16", "moduleResolution": "Node16",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true, "declaration": true, "declarationMap": true,
    "sourceMap": true, "rootDir": "src", "outDir": "dist",
    "experimentalDecorators": true, "emitDecoratorMetadata": true
  },
  "include": ["src/**/*.ts"],
  "references": [{ "path": "../hal" }, { "path": "../cuttlefish" }]
}
```

- [ ] **Step 3: Add to root `package.json` workspaces**

Add `"packages/mcu-esp32c6"` after `"packages/mcu-esp32c3"`.

- [ ] **Step 4: Commit**

```bash
git add packages/mcu-esp32c6/package.json packages/mcu-esp32c6/tsconfig.json package.json
git commit -m "feat(mcu-esp32c6): scaffold package and register workspace"
```

---

## Task 2: MCU peripherals (`src/peripherals.ts`)

**Files:** Create `packages/mcu-esp32c6/src/peripherals.ts`

C6 peripherals: 1× I2C, 1× SPI, 2× UART, ADC1 (7ch) + ADC2 (1ch), Wi-Fi 6, BLE 5.3, USB-OTG. **No touch** — the C6's touch peripheral is non-standard and not reliably exposed by the Arduino core (unlike the C3/S3 which have well-defined touch). Bus defaults verified against `variants/esp32c6/pins_arduino.h`: I2C GPIO23/22, SPI MOSI19/MISO20/SCK21/SS18, UART0 TX16/RX17.

- [ ] **Step 1: Write `packages/mcu-esp32c6/src/peripherals.ts`**

```ts
// ---------------------------------------------------------------------------
// @typecad/mcu-esp32c6 — Hardware peripheral descriptions
//
// ESP32-C6 peripherals: 1× I2C, 1× SPI, 2× UART, 2× ADC (12-bit),
// 4× general-purpose timers, Wi-Fi 6 (802.11ax), BLE 5.3, USB Serial/JTAG +
// USB-OTG. No DAC. No touch (the C6's touch peripheral is non-standard and
// not exposed by the Arduino core).
// ---------------------------------------------------------------------------

import type {
  PeripheralInstance, ADCDefinition, PWMDefinition, TimerDefinition,
} from '@typecad/cuttlefish/api/schema';
import {
  I2CBus, SPIBus, SerialPort, i2cName, spiName, serialName, createHALInstances,
} from '@typecad/hal';

export const I2C_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { sda: 'GPIO23', scl: 'GPIO22' } },
] as const;

export const SPI_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { mosi: 'GPIO19', miso: 'GPIO20', sck: 'GPIO21', cs: 'GPIO18' } },
] as const;

export const UART_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { tx: 'GPIO16', rx: 'GPIO17' } },
  { instance: 1, defaultPins: { tx: 'GPIO16', rx: 'GPIO17' } },
] as const;

export const ADC_INSTANCES: readonly ADCDefinition[] = [
  { instance: 0, channels: 7, resolution: 12, referenceVoltage: 3.3, maxValue: 4095,
    referenceVoltages: { DEFAULT: 3.3, INTERNAL: 1.1 } },  // ADC1 — usable with Wi-Fi active
  { instance: 1, channels: 1, resolution: 12, referenceVoltage: 3.3, maxValue: 4095,
    referenceVoltages: { DEFAULT: 3.3, INTERNAL: 1.1 } },  // ADC2 — NOT usable with Wi-Fi active
] as const;

export const PWM_CAPABILITIES: PWMDefinition = {
  channels: 6, resolution: 14, maxFrequency: 40_000_000,
} as const;

// No TOUCH_CAPABILITIES — the C6's touch peripheral is non-standard and not
// exposed by the Arduino core.

export const TIMER_INSTANCES: readonly TimerDefinition[] = [
  { instance: 0, type: 'general', bits: 64, features: ['interrupt'] },
  { instance: 1, type: 'general', bits: 64, features: ['interrupt'] },
  { instance: 2, type: 'general', bits: 64, features: ['interrupt'] },
  { instance: 3, type: 'general', bits: 64, features: ['interrupt'] },
] as const;

export const WIFI_CAPABILITIES = { type: 'wifi6', supportsStation: true, supportsAp: true } as const;
export const BLUETOOTH_CAPABILITIES = { type: 'ble', version: '5.3' } as const;
export const USB_CAPABILITIES = { type: 'otg', vid: '0x303A', pid: '0x0001' } as const;

export const MCU_PERIPHERALS = {
  i2c: [...I2C_INSTANCES],
  spi: [...SPI_INSTANCES],
  uart: [...UART_INSTANCES],
  adc: [...ADC_INSTANCES],
  pwm: PWM_CAPABILITIES,
  timers: [...TIMER_INSTANCES],
  wifi: WIFI_CAPABILITIES,
  bluetooth: BLUETOOTH_CAPABILITIES,
  usb: USB_CAPABILITIES,
} as const;

export const [I2C0] = createHALInstances(I2C_INSTANCES, i => new I2CBus(i2cName(i)));
export const [SPI0] = createHALInstances(SPI_INSTANCES, i => new SPIBus(spiName(i)));
export const [UART0, UART1] = createHALInstances(UART_INSTANCES, i => new SerialPort(serialName(i)));
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcu-esp32c6/src/peripherals.ts
git commit -m "feat(mcu-esp32c6): add hardware peripheral descriptions"
```

---

## Task 3: MCU pin constants (`src/pins.ts`)

**Files:** Create `packages/mcu-esp32c6/src/pins.ts`

GPIO 0–7, 8–14, 15–30 (30 GPIO). Bus aliases per the Arduino core defaults.

- [ ] **Step 1: Write `packages/mcu-esp32c6/src/pins.ts`**

```ts
// ---------------------------------------------------------------------------
// @typecad/mcu-esp32c6 — Datasheet pin definitions
//
// Each pin is a Pin instance from @typecad/hal. The ESP32-C6 has 30 GPIO
// (0-7, 8-14, 15-30). All GPIOs are bidirectional. No DAC. No PSRAM.
// ---------------------------------------------------------------------------

import { Pin } from '@typecad/hal';

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
export const GPIO22 = new Pin(22);
export const GPIO23 = new Pin(23);
export const GPIO24 = new Pin(24);
export const GPIO25 = new Pin(25);
export const GPIO26 = new Pin(26);
export const GPIO27 = new Pin(27);
export const GPIO28 = new Pin(28);
export const GPIO29 = new Pin(29);
export const GPIO30 = new Pin(30);

// ---------------------------------------------------------------------------
// Convenience aliases (Silicon-level defaults — match Arduino-ESP32 core)
// ---------------------------------------------------------------------------

/** I2C0 data line (GPIO23). */
export const SDA = GPIO23;
/** I2C0 clock line (GPIO22). */
export const SCL = GPIO22;

/** SPI0 MOSI (GPIO19). */
export const MOSI = GPIO19;
/** SPI0 MISO (GPIO20). */
export const MISO = GPIO20;
/** SPI0 clock (GPIO21). */
export const SCK = GPIO21;
/** SPI0 slave select (GPIO18). */
export const SS = GPIO18;

/** UART0 transmit (GPIO16). */
export const TX = GPIO16;
/** UART0 receive (GPIO17). */
export const RX = GPIO17;
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcu-esp32c6/src/pins.ts
git commit -m "feat(mcu-esp32c6): add named GPIO pin constants and bus aliases"
```

---

## Task 4: MCU definition (`src/index.ts`)

**Files:** Create `packages/mcu-esp32c6/src/index.ts`

C6 facts: 30 GPIO, ADC1 GPIO0–6 (7ch), ADC2 GPIO7 (1ch, Wi-Fi warning), strapping GPIO9/GPIO13, USB D- GPIO26 / D+ GPIO27, flash pins GPIO28–30. No touch (C6 touch is non-standard, omitted). Single-core RISC-V, 160 MHz, no FPU. SRAM 512 KB, no externalRam.

- [ ] **Step 1: Write `packages/mcu-esp32c6/src/index.ts`**

```ts
// ---------------------------------------------------------------------------
// @typecad/mcu-esp32c6 — MCU definition manifest
//
// ESP32-C6 is a single-core RISC-V (RV32IMAC) @ 160 MHz with Wi-Fi 6
// (802.11ax) + BLE 5.3 and native USB Serial/JTAG + USB-OTG. It has 30 GPIO
// (0-7, 8-14, 15-30). All GPIOs are bidirectional. No DAC. No PSRAM.
// ---------------------------------------------------------------------------

import type { MCUDefinition } from '@typecad/cuttlefish/api/schema';
import { MCU_PERIPHERALS } from './peripherals.js';

const NO  = false as const;
const YES = true  as const;

const FULL_GPIO = {
  digitalInput: YES, digitalOutput: YES,
  analogInput: NO,   analogOutput: NO,
  pwm: YES,          interrupt: YES,
  pullUp: YES,       pullDown: YES,
  touch: NO,         openDrain: NO,
} as const;

const FULL_GPIO_ANALOG = { ...FULL_GPIO, analogInput: YES } as const;
// No FULL_GPIO_ANALOG_TOUCH — the C6 has no exposed touch peripheral.

function adc(n: number, ch: number) {
  return { type: 'adc' as const, instance: n, role: `ch${ch}` };
}

export const ESP32C6: MCUDefinition = {
  id: 'esp32-c6',
  name: 'ESP32-C6',
  architecture: 'esp32c6',
  memory: {
    flash:    384 * 1024,
    sram:     512 * 1024,
    eeprom:   0,
    rtcMemory: 16 * 1024,
  },
  pins: {
    all: [
      // ---- ADC1 pins (GPIO0-GPIO6) — no touch on the C6 --------------------
      { number:  0, gpio:  0, name: 'GPIO0', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(1, 0)], alternateFunctions: ['ADC1_CH0'] },
      { number:  1, gpio:  1, name: 'GPIO1', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(1, 1)], alternateFunctions: ['ADC1_CH1'] },
      { number:  2, gpio:  2, name: 'GPIO2', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(1, 2)], alternateFunctions: ['ADC1_CH2'] },
      { number:  3, gpio:  3, name: 'GPIO3', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(1, 3)], alternateFunctions: ['ADC1_CH3'] },
      { number:  4, gpio:  4, name: 'GPIO4', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(1, 4)], alternateFunctions: ['ADC1_CH4'] },
      { number:  5, gpio:  5, name: 'GPIO5', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(1, 5)], alternateFunctions: ['ADC1_CH5'] },
      { number:  6, gpio:  6, name: 'GPIO6', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(1, 6)], alternateFunctions: ['ADC1_CH6'] },

      // ---- ADC2 pin (GPIO7) — Wi-Fi conflicted ------------------------------
      { number:  7, gpio:  7, name: 'GPIO7', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(2, 0)],
        alternateFunctions: ['ADC2_CH0'],
        warnings: ['GPIO7 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number:  8, gpio:  8, name: 'GPIO8', capabilities: FULL_GPIO,
        alternateFunctions: [] },

      // ---- Strapping pins (unsafe) -----------------------------------------
      { number:  9, gpio:  9, name: 'GPIO9', capabilities: FULL_GPIO,
        alternateFunctions: [],
        warnings: ['GPIO9 is a strapping pin — boot mode select at boot'],
        unsafe: true, notes: 'Boot strapping pin' },

      { number: 10, gpio: 10, name: 'GPIO10', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 11, gpio: 11, name: 'GPIO11', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 12, gpio: 12, name: 'GPIO12', capabilities: FULL_GPIO, alternateFunctions: [] },

      { number: 13, gpio: 13, name: 'GPIO13', capabilities: FULL_GPIO,
        alternateFunctions: [],
        warnings: ['GPIO13 is a strapping pin — controls VDD_SPI voltage at boot'],
        unsafe: true, notes: 'Boot strapping pin' },

      { number: 14, gpio: 14, name: 'GPIO14', capabilities: FULL_GPIO, alternateFunctions: [] },

      // ---- GPIO 15-25 — general purpose ------------------------------------
      { number: 15, gpio: 15, name: 'GPIO15', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'tx' }],
        alternateFunctions: ['UART0 TX'],
        warnings: ['Using GPIO15 as GPIO will interfere with UART0 transmit'] },
      { number: 16, gpio: 16, name: 'GPIO16', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'rx' }],
        alternateFunctions: ['UART0 RX'],
        warnings: ['Using GPIO16 as GPIO will interfere with UART0 receive'] },
      { number: 17, gpio: 17, name: 'GPIO17', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 18, gpio: 18, name: 'GPIO18', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 0, role: 'cs' }],
        alternateFunctions: ['SPI0 CS'] },
      { number: 19, gpio: 19, name: 'GPIO19', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 0, role: 'mosi' }],
        alternateFunctions: ['SPI0 MOSI'] },
      { number: 20, gpio: 20, name: 'GPIO20', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 0, role: 'miso' }],
        alternateFunctions: ['SPI0 MISO'] },
      { number: 21, gpio: 21, name: 'GPIO21', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 0, role: 'sck' }],
        alternateFunctions: ['SPI0 SCK'] },
      { number: 22, gpio: 22, name: 'GPIO22', capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 0, role: 'scl' }],
        alternateFunctions: ['I2C0 SCL'] },
      { number: 23, gpio: 23, name: 'GPIO23', capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 0, role: 'sda' }],
        alternateFunctions: ['I2C0 SDA'] },
      { number: 24, gpio: 24, name: 'GPIO24', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 25, gpio: 25, name: 'GPIO25', capabilities: FULL_GPIO, alternateFunctions: [] },

      // ---- USB Serial/JTAG + USB-OTG pins (unsafe) -------------------------
      { number: 26, gpio: 26, name: 'GPIO26', capabilities: FULL_GPIO,
        functions: [{ type: 'usb', instance: 0, role: 'dm' }],
        alternateFunctions: ['USB D-'],
        warnings: ['GPIO26 is USB D- — using it as GPIO disables native USB'],
        unsafe: true, notes: 'USB D- pin' },
      { number: 27, gpio: 27, name: 'GPIO27', capabilities: FULL_GPIO,
        functions: [{ type: 'usb', instance: 0, role: 'dp' }],
        alternateFunctions: ['USB D+'],
        warnings: ['GPIO27 is USB D+ — using it as GPIO disables native USB'],
        unsafe: true, notes: 'USB D+ pin' },

      // ---- SPI flash / PSRAM pins (unsafe) ---------------------------------
      { number: 28, gpio: 28, name: 'GPIO28', capabilities: FULL_GPIO,
        alternateFunctions: ['SPICS0'],
        warnings: ['GPIO28 is connected to SPI flash — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },
      { number: 29, gpio: 29, name: 'GPIO29', capabilities: FULL_GPIO,
        alternateFunctions: ['SPICLK'],
        warnings: ['GPIO29 is connected to SPI flash — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },
      { number: 30, gpio: 30, name: 'GPIO30', capabilities: FULL_GPIO,
        alternateFunctions: ['SPIQ'],
        warnings: ['GPIO30 is connected to SPI flash — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },
    ],

    digital: [
      'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7',
      'GPIO8', 'GPIO9', 'GPIO10', 'GPIO11', 'GPIO12', 'GPIO13', 'GPIO14',
      'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21',
      'GPIO22', 'GPIO23', 'GPIO24', 'GPIO25', 'GPIO26', 'GPIO27', 'GPIO28',
      'GPIO29', 'GPIO30',
    ],
    analog: [
      'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6',  // ADC1
      'GPIO7',                                                         // ADC2
    ],
    pwm: [
      'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7',
      'GPIO8', 'GPIO9', 'GPIO10', 'GPIO11', 'GPIO12', 'GPIO13', 'GPIO14',
      'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21',
      'GPIO22', 'GPIO23', 'GPIO24', 'GPIO25',
    ],
    unsafe: ['GPIO9', 'GPIO13', 'GPIO26', 'GPIO27', 'GPIO28', 'GPIO29', 'GPIO30'],

    i2c:  { 0: { sda: 'GPIO23', scl: 'GPIO22' } },
    spi:  { 0: { mosi: 'GPIO19', miso: 'GPIO20', sck: 'GPIO21', cs: 'GPIO18' } },
    uart: { 0: { tx: 'GPIO16', rx: 'GPIO17' } },
  },

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
  build: { extraFlags: [] },
};

export default ESP32C6;

export * from './pins.js';
export * from './peripherals.js';

/**
 * Structured manifest consumed by the TypeCAD CLI for contract-based
 * board generation. Provides pin names and peripheral instance names
 * without requiring the CLI to text-scrape compiled output.
 */
export const TypeCADManifest = {
  pinNames: [
    'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7',
    'GPIO8', 'GPIO9', 'GPIO10', 'GPIO11', 'GPIO12', 'GPIO13', 'GPIO14',
    'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21',
    'GPIO22', 'GPIO23', 'GPIO24', 'GPIO25', 'GPIO26', 'GPIO27', 'GPIO28',
    'GPIO29', 'GPIO30',
  ] as const,
  peripheralNames: ['I2C0', 'SPI0', 'UART0', 'UART1'] as const,
} as const;
```

- [ ] **Step 2: Build the MCU package**

Run: `npm run build --workspace @typecad/mcu-esp32c6`
Expected: clean build, `dist/` populated. If `tsc` errors, verify the `wifi6` literal is accepted by `WiFiDefinition` (it is — schema confirmed) and that `bits: 64` is in the union.

- [ ] **Step 3: Commit**

```bash
git add packages/mcu-esp32c6/src/index.ts
git commit -m "feat(mcu-esp32c6): add ESP32-C6 MCU definition (30 GPIO, Wi-Fi 6, BLE 5.3)"
```

---

## Task 5: Scaffold the board package

**Files:**
- Create: `packages/board-esp32c6/package.json`, `packages/board-esp32c6/tsconfig.json`
- Modify: `package.json` (root workspaces)

- [ ] **Step 1: Create `packages/board-esp32c6/package.json`**

Mirror `packages/board-esp32c3/package.json`:

```json
{
  "name": "@typecad/board-esp32c6",
  "version": "0.1.0",
  "description": "TypeCAD ESP32-C6 board definition with typed pins and peripherals",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": { "build": "tsc" },
  "dependencies": {
    "@typecad/cuttlefish": "*",
    "@typecad/hal": "*",
    "@typecad/mcu-esp32c6": "*"
  },
  "license": "MIT",
  "publishConfig": { "access": "public" }
}
```

- [ ] **Step 2: Create `packages/board-esp32c6/tsconfig.json`**

Identical to `packages/board-esp32c3/tsconfig.json` (references the C6 MCU package):

```json
{
  "compilerOptions": {
    "composite": true, "target": "ES2021", "module": "Node16", "moduleResolution": "Node16",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true, "declaration": true, "declarationMap": true,
    "sourceMap": true, "rootDir": "src", "outDir": "dist",
    "experimentalDecorators": true, "emitDecoratorMetadata": true
  },
  "include": ["src/**/*.ts"],
  "references": [
    { "path": "../hal" }, { "path": "../cuttlefish" }, { "path": "../mcu-esp32c6" }
  ]
}
```

- [ ] **Step 3: Add `"packages/board-esp32c6"` to root `package.json` workspaces** (after `board-esp32c3`).

- [ ] **Step 4: Install + commit**

```bash
npm install
git add packages/board-esp32c6/package.json packages/board-esp32c6/tsconfig.json package.json
git commit -m "feat(board-esp32c6): scaffold package and register workspace"
```

---

## Task 6: Board manifest + supporting files

**Files:**
- Create: `packages/board-esp32c6/src/index.ts`, `pins.ts`, `analog.ts`, `board.ts`

No `led`, no `externalRam`, FQBN `esp32:esp32:esp32c6`. Dx matches GPIO by number; Ax maps to ADC1 (GPIO0–6).

- [ ] **Step 1: Create `packages/board-esp32c6/src/pins.ts`**

```ts
// ---------------------------------------------------------------------------
// @typecad/board-esp32c6 — Pin aliases
// ---------------------------------------------------------------------------

import {
  GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7,
  GPIO8, GPIO9, GPIO10, GPIO11, GPIO12, GPIO13, GPIO14,
  GPIO15, GPIO16, GPIO17, GPIO18, GPIO19, GPIO20, GPIO21,
  GPIO22, GPIO23, GPIO24, GPIO25, GPIO26, GPIO27, GPIO28, GPIO29, GPIO30,
} from '@typecad/mcu-esp32c6';

export const D0  = GPIO0;   export const D1  = GPIO1;   export const D2  = GPIO2;
export const D3  = GPIO3;   export const D4  = GPIO4;   export const D5  = GPIO5;
export const D6  = GPIO6;   export const D7  = GPIO7;   export const D8  = GPIO8;
export const D9  = GPIO9;   export const D10 = GPIO10;  export const D11 = GPIO11;
export const D12 = GPIO12;  export const D13 = GPIO13;  export const D14 = GPIO14;
export const D15 = GPIO15;  export const D16 = GPIO16;  export const D17 = GPIO17;
export const D18 = GPIO18;  export const D19 = GPIO19;  export const D20 = GPIO20;
export const D21 = GPIO21;  export const D22 = GPIO22;  export const D23 = GPIO23;
export const D24 = GPIO24;  export const D25 = GPIO25;  export const D26 = GPIO26;
export const D27 = GPIO27;

// Analog input aliases (ADC1 channels — usable while Wi-Fi is active).
export const A0 = GPIO0;
export const A1 = GPIO1;
export const A2 = GPIO2;
export const A3 = GPIO3;
export const A4 = GPIO4;
export const A5 = GPIO5;
export const A6 = GPIO6;

// Bus aliases (default pins for I2C0 / SPI0 / UART0)
export { I2C0, SPI0, UART0, UART1 } from '@typecad/mcu-esp32c6';
```

- [ ] **Step 2: Create `packages/board-esp32c6/src/analog.ts`**

```ts
// ---------------------------------------------------------------------------
// @typecad/board-esp32c6 — Analog constants
// ---------------------------------------------------------------------------

/** Default reference (3.3V). */
export const DEFAULT = 0;
/** Internal 1.1V reference. */
export const INTERNAL = 3;
```

- [ ] **Step 3: Create `packages/board-esp32c6/src/index.ts`**

```ts
// ---------------------------------------------------------------------------
// @typecad/board-esp32c6 — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import { ESP32C6 } from '@typecad/mcu-esp32c6';

const ARDUINO_CORE_VERSION = '10819';

export const ESP32C6Board: BoardDefinition = {
  id: 'esp32c6',
  name: 'ESP32-C6',
  vendor: 'Espressif',
  description:
    'Generic ESP32-C6 devboard (vendor-agnostic). Single-core RISC-V ' +
    '(RV32IMAC) @ 160 MHz with Wi-Fi 6 (802.11ax) + BLE 5.3 and native USB ' +
    'Serial/JTAG + USB-OTG. 30 GPIO; no PSRAM support.',

  mcu: ESP32C6,
  clockSpeed: 160_000_000,

  memory: {
    flash: 4 * 1024 * 1024,
  },

  pins: {
    ...ESP32C6.pins,
  },

  peripherals: {
    ...ESP32C6.peripherals,
    aliases: {
      UART0: 'Serial',
      UART1: 'Serial1',
      I2C0:  'Wire',
      SPI0:  'SPI',
    },
  },

  build: {
    frameworks: {
      platformio: 'esp32c6',
      arduino: 'esp32:esp32:esp32c6',
    },
    defines: {
      F_CPU:             '160000000UL',
      ARDUINO:           ARDUINO_CORE_VERSION,
      ARDUINO_ESP32C6_DEV: '1',
    },
  },
};

export default ESP32C6Board;

export * from '@typecad/mcu-esp32c6';

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

import {
  GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7,
  GPIO8, GPIO9, GPIO10, GPIO11, GPIO12, GPIO13, GPIO14,
  GPIO15, GPIO16, GPIO17, GPIO18, GPIO19, GPIO20, GPIO21,
  GPIO22, GPIO23, GPIO24, GPIO25, GPIO26, GPIO27,
} from '@typecad/mcu-esp32c6';

export const pins = {
  pwm: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
        GPIO10, GPIO11, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18,
        GPIO19, GPIO20, GPIO21, GPIO22, GPIO23, GPIO24, GPIO25, GPIO26, GPIO27] as const,
  analog: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6] as const,
  interrupt: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
              GPIO10, GPIO11, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18,
              GPIO19, GPIO20, GPIO21, GPIO22, GPIO23, GPIO24, GPIO25, GPIO26, GPIO27] as const,
  digital: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
            GPIO10, GPIO11, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18,
            GPIO19, GPIO20, GPIO21, GPIO22, GPIO23, GPIO24, GPIO25, GPIO26, GPIO27] as const,
} as const;

export const PeripheralPins = {
  I2C0: { SDA: 'GPIO23', SCL: 'GPIO22' } as const,
  SPI0: { MOSI: 'GPIO19', MISO: 'GPIO20', SCK: 'GPIO21', CS: 'GPIO18' } as const,
  UART0: { TX: 'GPIO16', RX: 'GPIO17' } as const,
  UART1: { TX: 'remappable', RX: 'remappable' } as const,
} as const;

export * from './pins.js';
export * from './analog.js';
export { Board } from './board.js';
```

- [ ] **Step 4: Create `packages/board-esp32c6/src/board.ts`**

```ts
// ---------------------------------------------------------------------------
// @typecad/board-esp32c6 — Board namespace
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';

import {
  D2, D3, D4, D5, D6, D7, D8, D9, D10,
  D12, D13, D14, D15, D16, D17, D18, D19, D20, D21,
  D22, D23, D24, D25, D26, D27,
  A0, A1, A2, A3, A4, A5, A6,
} from './pins.js';

import { I2C0, SPI0, UART0, UART1 } from '@typecad/mcu-esp32c6';
import { ESP32C6Board } from './index.js';

export const Board = {
  definition: ESP32C6Board,

  D2, D3, D4, D5, D6, D7, D8, D9, D10,
  D12, D13, D14, D15, D16, D17, D18, D19, D20, D21,
  D22, D23, D24, D25, D26, D27,

  A0, A1, A2, A3, A4, A5, A6,

  I2C0, SPI0, UART0, UART1,

  digital: { D2, D3, D4, D5, D6, D7, D8, D9, D10, D12, D13, D14, D15, D16, D17, D18, D19, D20, D21, D22, D23, D24, D25, D26, D27 },
  analog:  { A0, A1, A2, A3, A4, A5, A6 },
};

export default Board;
```

- [ ] **Step 5: Build + commit**

```bash
npm run build --workspace @typecad/board-esp32c6
git add packages/board-esp32c6/src/
git commit -m "feat(board-esp32c6): add board manifest, pins, analog, and Board namespace"
```

---

## Task 7: Add `esp32c6` to the ArchitectureIdentifier unions

**Files:**
- Modify: `packages/cuttlefish/src/api/board-types.ts:9`
- Modify: `packages/hal/src/core/board-types.ts`

The union is duplicated in both packages; both must stay in sync. Add `'esp32c6'` after `'esp32c3'` in each.

- [ ] **Step 1: Edit `packages/cuttlefish/src/api/board-types.ts`**

Change:
```ts
  | 'esp32c3'
  | 'rp2040'
```
to:
```ts
  | 'esp32c3'
  | 'esp32c6'
  | 'rp2040'
```

- [ ] **Step 2: Edit `packages/hal/src/core/board-types.ts`** — identical change.

- [ ] **Step 3: Rebuild cuttlefish + hal**

```bash
npm run build --workspace @typecad/cuttlefish
npm run build --workspace @typecad/hal
```

- [ ] **Step 4: Commit**

```bash
git add packages/cuttlefish/src/api/board-types.ts packages/hal/src/core/board-types.ts
git commit -m "feat: add 'esp32c6' to ArchitectureIdentifier (cuttlefish + hal)"
```

---

## Task 8: Add `esp32c6` to the ESP32-family framework checks

Three one-line additions to existing checks.

**Files:**
- Modify: `packages/framework-arduino/src/strategy.ts:234` (freeHeap)
- Modify: `packages/framework-arduino/src/strategy.ts:1004` (isrFunctionAttribute)
- Modify: `packages/cuttlefish/src/ir/heap-analysis.ts:74`

- [ ] **Step 1: `strategy.ts` freeHeap check (line 234)**

Change:
```ts
    if (arch === 'esp32' || arch === 'esp32s2' || arch === 'esp32s3' || arch === 'esp32c3') {
```
to:
```ts
    if (arch === 'esp32' || arch === 'esp32s2' || arch === 'esp32s3' || arch === 'esp32c3' || arch === 'esp32c6') {
```

- [ ] **Step 2: `strategy.ts` isrFunctionAttribute check (line 1004)**

Change:
```ts
    return (arch === 'esp32' || arch === 'esp32s2' || arch === 'esp32s3' || arch === 'esp32c3')
```
to:
```ts
    return (arch === 'esp32' || arch === 'esp32s2' || arch === 'esp32s3' || arch === 'esp32c3' || arch === 'esp32c6')
```

- [ ] **Step 3: `heap-analysis.ts` check (line 74)**

Change:
```ts
  if (arch === "esp32" || arch === "esp32s3" || arch === "esp32c3" || arch === "xtensa" || arch === "riscv32") {
```
to:
```ts
  if (arch === "esp32" || arch === "esp32s3" || arch === "esp32c3" || arch === "esp32c6" || arch === "xtensa" || arch === "riscv32") {
```

- [ ] **Step 4: Rebuild + commit**

```bash
npm run build --workspace @typecad/framework-arduino
npm run build --workspace @typecad/cuttlefish
git add packages/framework-arduino/src/strategy.ts packages/cuttlefish/src/ir/heap-analysis.ts
git commit -m "feat: add esp32c6 to freeHeap, isrFunctionAttribute, and heap-analysis checks"
```

---

## Task 9: Framework-arduino profile fix

**Files:** Modify `packages/framework-arduino/src/profile.ts` (3 additions)

- [ ] **Step 1: PROFILE_VARIANTS** — add after `esp32c3`:

```ts
  { architecture: "esp32c6", forcedIncludes: ["<Arduino.h>"] },
```

- [ ] **Step 2: CAPABILITY_TABLE** — add after `esp32c3` row. `fallbackPins.A0 = 0` (ADC1 starts at GPIO0):

```ts
  {
    architecture: "esp32c6",
    builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "analogReference", "delay", "millis", "micros", "setInterval", "setTimeout", "clearInterval", "clearTimeout"]),
    builtinGlobals: new Set(["A0", "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
    fallbackPins: { A0: 0 },
  },
```

- [ ] **Step 3: FQBN_PIN_OVERRIDES** — add after `esp32:esp32c3:`:

```ts
  { fqbnIncludes: "esp32:esp32c6:", pins: { A0: 0 } },
```

- [ ] **Step 4: Rebuild + commit**

```bash
npm run build --workspace @typecad/framework-arduino
git add packages/framework-arduino/src/profile.ts
git commit -m "feat(framework-arduino): add esp32c6 profile variant, capability row, FQBN A0 override"
```

---

## Task 10: Register in known-targets registry + KNOWN_BOARDS test

**Files:**
- Modify: `packages/cuttlefish/src/create/init-scaffold.ts`
- Modify: `tests/packages/transpiler/init-scaffold.test.ts`

- [ ] **Step 1: Add `esp32c6` to `_knownTargets`** (after `esp32c3`):

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

- [ ] **Step 2: Add the KNOWN_BOARDS test** (after the `esp32c3` test):

```ts
    it("contains esp32c6", () => {
      const c6 = KNOWN_BOARDS.find(b => b.id === 'esp32c6');
      expect(c6).toBeDefined();
      expect(c6!.architecture).toBe('esp32c6');
      expect(c6!.buildTarget).toBe('esp32:esp32:esp32c6');
    });
```

- [ ] **Step 3: Rebuild cuttlefish + run test**

```bash
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/transpiler/init-scaffold.test.ts
```
Expected: PASS, including the new `contains esp32c6` test.

- [ ] **Step 4: Commit**

```bash
git add packages/cuttlefish/src/create/init-scaffold.ts tests/packages/transpiler/init-scaffold.test.ts
git commit -m "feat(cuttlefish): register esp32c6 in known-targets registry + test"
```

---

## Task 11: Focused profile tests

**Files:** Create `tests/packages/framework-arduino/esp32c6-profile.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// ---------------------------------------------------------------------------
// Tests for ESP32-C6 framework-arduino support
// (profile variant, capabilities, and IRAM_ATTR ISR attribute)
//
// NOTE on the FQBN: the ESP32-C6's Arduino FQBN is esp32:esp32:esp32c6 — the
// ESP32 Arduino core collapses the family into esp32:esp32, with the chip
// variant in the BOARD id. _cachedArch derives from FQBN segment [1]
// (platform) → 'esp32', so the C6 inherits the esp32 profile/IRAM behavior.
// Correct: the C6 is RISC-V but the IRAM_ATTR requirement is an ESP32-family
// silicon fact.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { ArduinoStrategy } from "../../../packages/framework-arduino/src";
import { resolveArduinoProfile } from "../../../packages/framework-arduino/src/profile";
import type { ProgramIR, PlatformContext } from "@typecad/cuttlefish/api/shared";

const C6_CTX = { frameworkData: { buildTarget: "esp32:esp32:esp32c6" } } as PlatformContext;
const EMPTY_PROGRAM = { topLevelStatements: [], functions: [] } as any as ProgramIR;

describe("ESP32-C6 framework-arduino support", () => {
  describe("profile resolution", () => {
    it("forces <Arduino.h> include for the C6 FQBN", () => {
      const result = resolveArduinoProfile(EMPTY_PROGRAM, C6_CTX);
      expect(result.forcedIncludes).toContain("<Arduino.h>");
      expect(result.diagnostics.filter(d => d.code === "TypeCAD_ARDUINO_FUNC_UNKNOWN")).toEqual([]);
    });

    it("does not emit an A0 shim for the C6 FQBN (A0 is a known builtin global)", () => {
      const program = {
        topLevelStatements: [
          { kind: "assign", target: "x", value: { kind: "identifier", value: "A0" } },
        ],
        functions: [],
      } as any as ProgramIR;

      const result = resolveArduinoProfile(program, C6_CTX);
      expect(result.shimLines.filter(l => l.startsWith("#define A0"))).toEqual([]);
      expect(result.diagnostics.find(d => d.code === "TypeCAD_ARDUINO_SHIM_A0")).toBeUndefined();
    });
  });

  describe("ArduinoStrategy isrFunctionAttribute", () => {
    it("returns IRAM_ATTR for the C6 FQBN after profile resolution", () => {
      const strategy = new ArduinoStrategy();
      strategy.forcedIncludes(EMPTY_PROGRAM, C6_CTX);
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

Run: `npx vitest run tests/packages/framework-arduino/esp32c6-profile.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/packages/framework-arduino/esp32c6-profile.test.ts
git commit -m "test(framework-arduino): esp32c6 profile + IRAM_ATTR coverage"
```

---

## Task 12: Documentation

**Files:** Modify `README.md`

- [ ] **Step 1: Add the ESP32-C6 row** to the board table (after C3):

```
| ESP32-C6 | `@typecad/board-esp32c6` | ESP32-C6 (RISC-V, Wi-Fi 6) |
```

- [ ] **Step 2: Add `esp32c6`** to the available-boards list.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document ESP32-C6 board support"
```

---

## Task 13: Full verification

- [ ] **Step 1: Build all packages**

Run: `npm run build --workspaces`
Expected: all clean.

- [ ] **Step 2: Run the affected suites**

Run: `npx vitest run tests/packages/transpiler/init-scaffold.test.ts tests/packages/framework-arduino/esp32c6-profile.test.ts`
Expected: PASS.

- [ ] **Step 3: Regression**

Run: `npx vitest run tests/packages/framework-arduino/ tests/packages/transpiler/`
Expected: PASS — no regressions.

- [ ] **Step 4: End-to-end FQBN link check**

```bash
cd /tmp && rm -rf c6-direct && mkdir c6-direct && cd c6-direct
cat > c6-direct.ino <<'EOF'
#include <Arduino.h>
void setup() { Serial.begin(115200); }
void loop() {}
EOF
arduino-cli compile --fqbn "esp32:esp32:esp32c6" . 2>&1 | tail -4
```
Expected: `Sketch uses ... bytes` — the FQBN links against the installed `esp32:esp32` core.
