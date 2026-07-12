# @typecad/mcu-atmega328p

MCU definition package for the **ATmega328P** microcontroller. Provides datasheet-level pin definitions, hardware peripheral descriptions, and framework pin mappings used by the TypeCAD transpiler and board packages.

---

## Purpose

MCU packages (`@typecad/mcu-*`) are the **hardware abstraction layer between the chip and the framework**. They answer three fundamental questions:

1. **What pins exist on this chip?** — Exports typed `Pin` objects using canonical port names from the MCU datasheet (e.g. `PD0`, `PB5`, `PC0`).
2. **What peripherals are built into the silicon?** — Describes the hardware peripherals the MCU provides: how many I2C/SPI/UART controllers, ADC channels, timers, PWM capabilities, etc.
3. **How do port names map to framework pin numbers?** — Provides lookup tables so the transpiler can resolve `Pin.fromPort('PB5')` → Arduino pin `13`.

MCU packages are **framework-agnostic**. They don't know about Arduino, PlatformIO, or any specific board — they only know the chip itself. Board packages (e.g. `@typecad/board-arduino-uno`) import from MCU packages and add board-specific aliases, wiring, and metadata.

### Package Layering

```
┌─────────────────────────────────────────────────┐
│  User sketch                                     │
│  import { D13, LED, UART0 } from '@typecad/...' │
└──────────────────────┬──────────────────────────┘
                       │ imports from
┌──────────────────────▼──────────────────────────┐
│  Board package  (board-arduino-uno)              │
│  • Arduino pin aliases (D0–D13, A0–A5)          │
│  • Convenience aliases (LED, SDA, SCL, TX, RX)  │
│  • Peripheral instances (I2C0, SPI0, UART0)     │
│  • BoardDefinition (board-level metadata)        │
│  • Timing, interrupt, and utility functions       │
└──────────────────────┬──────────────────────────┘
                       │ imports pins + peripherals from
┌──────────────────────▼──────────────────────────┐
│  MCU package  (mcu-atmega328p)  ◄── THIS PACKAGE│
│  • Datasheet pin definitions (PD0–PD7, etc.)    │
│  • Hardware peripheral descriptions (I2C, SPI,  │
│    UART, ADC, timers, PWM)                       │
│  • Framework pin mappings (ARDUINO_PIN_MAP)      │
└──────────────────────┬──────────────────────────┘
                       │ depends on
┌──────────────────────▼──────────────────────────┐
│  Core / HAL / Schema                             │
│  Pin, Pin.fromPort(), type definitions           │
└─────────────────────────────────────────────────┘
```

---

## What's Inside

### `src/pins.ts` — Datasheet Pin Definitions

Exports one `Pin` constant per GPIO port on the ATmega328P, using [`Pin.fromPort()`](../hal/src/gpio.ts:201) with the canonical port name from the datasheet:

```typescript
import { Pin } from '@typecad/hal';

export const PD0 = Pin.fromPort('PD0');  // Port D, bit 0
export const PD1 = Pin.fromPort('PD1');  // Port D, bit 1
// ...
export const PB5 = Pin.fromPort('PB5');  // Port B, bit 5
export const PC0 = Pin.fromPort('PC0');  // Port C, bit 0
// ...
```

**Why `Pin.fromPort()` instead of `new Pin(number)`?**

- `Pin.fromPort('PB5')` stores the port name as the canonical identity. The transpiler resolves it to the correct framework pin number at compile time using the pin mapping.
- `new Pin(13)` hardcodes a framework-specific pin number, which breaks if the same chip is used with a different framework or board variant.
- Port names are universal — `PB5` means the same physical pin on every ATmega328P board, whether it's an Arduino Uno, a Pro Mini, or a bare DIP-28 on a breadboard.

### `src/arduino-map.ts` — Arduino Pin Mapping

Maps MCU port names to Arduino framework pin numbers:

```typescript
export const ARDUINO_PIN_MAP: Readonly<Record<string, number>> = {
  PD0: 0,  PD1: 1,  PD2: 2,  PD3: 3,
  PD4: 4,  PD5: 5,  PD6: 6,  PD7: 7,
  PB0: 8,  PB1: 9,  PB2: 10, PB3: 11,
  PB4: 12, PB5: 13,
  PC0: 14, PC1: 15, PC2: 16, PC3: 17,
  PC4: 18, PC5: 19,
};

export const ARDUINO_ANALOG_OFFSET = 14;

export const ARDUINO_PIN_REVERSE: Readonly<Record<number, string>> = { ... };
```

This mapping is **per-chip**, not per-board. An ATtiny85 has `A2 = PB4` while the ATmega328P has `A2 = PC2`. That's why it lives in the MCU package, not in the framework or board package.

### `src/index.ts` — Barrel Export

Re-exports everything from `pins.ts` and `arduino-map.ts`.

---

## Hardware Peripherals

The ATmega328P has a fixed set of hardware peripherals baked into the silicon. These are properties of the **chip**, not the board — every ATmega328P has exactly the same peripheral count regardless of what board it's soldered to.

### ATmega328P Peripheral Summary

| Peripheral | Count | Details |
|---|---|---|
| **UART** | 1 | USART0 — full-duplex serial, TX/RX on PD1/PD0 |
| **I2C** (TWI) | 1 | Two-Wire Interface — SDA on PC4, SCL on PC5 |
| **SPI** | 1 | MOSI on PB3, MISO on PB4, SCK on PB5, SS on PB2 |
| **ADC** | 1 | 10-bit, 6 channels on PC0–PC5 (plus temperature + VBG) |
| **Timers** | 3 | Timer0 (8-bit, system), Timer1 (16-bit), Timer2 (8-bit) |
| **PWM** | 6 channels | From Timer0 (OC0A/OC0B), Timer1 (OC1A/OC1B), Timer2 (OC2A/OC2B) |
| **External Interrupts** | 2 | INT0 on PD2, INT1 on PD3 |
| **Watchdog** | 1 | Independent watchdog timer |

### Peripheral-to-Pin Mapping

The MCU datasheet defines which pins are hardwired to each peripheral. This mapping is fixed by the silicon:

```
UART0:  TX = PD1,  RX = PD0
I2C0:   SDA = PC4, SCL = PC5
SPI0:   MOSI = PB3, MISO = PB4, SCK = PB5, SS = PB2
ADC0:   CH0 = PC0, CH1 = PC1, CH2 = PC2, CH3 = PC3, CH4 = PC4, CH5 = PC5
PWM:    OC0A = PD6, OC0B = PD5 (Timer0)
        OC1A = PB1, OC1B = PB2 (Timer1)
        OC2A = PB3, OC2B = PD3 (Timer2)
EXTI:   INT0 = PD2, INT1 = PD3
```

Board packages consume this information when building their [`BoardDefinition`](../board-arduino-uno/src/index.ts:46) manifest. The board definition adds board-level concerns (which peripheral aliases to use, which pins are exposed as headers, memory specs, build flags) on top of the MCU's hardware facts.

### Why Peripherals Belong in MCU Packages

The number of I2C controllers, UART ports, and ADC channels is determined by the silicon die:

- **Same chip, different boards** — An ATmega328P on an Arduino Uno, Pro Mini, or bare breadboard all have exactly 1 UART, 1 I2C, 1 SPI, and 3 timers. Duplicating this in every board package is redundant and error-prone.
- **Transpiler validation** — The transpiler uses peripheral counts to detect bus conflicts (e.g., two I2C devices on the same bus) and pin-capability mismatches (e.g., calling `pwm()` on a non-PWM pin). These checks are chip-level, not board-level.
- **Peripheral instances** — When user code creates `new I2CBus(i2cName(0))`, the instance number `0` refers to the MCU's I2C0 peripheral. The MCU package defines how many instances exist.

Currently, the peripheral definitions are strictly separated from board-level concerns. The MCU package exports a structured peripheral description that board packages import and extend.

```typescript
// src/peripherals.ts in an MCU package
export const UART_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { tx: 'PD1', rx: 'PD0' } },
];
// ... (I2C, SPI, ADC, etc.)

export const MCU_PERIPHERALS = {
  uart: [...UART_INSTANCES],
  i2c:  [...I2C_INSTANCES],
  spi:  [...SPI_INSTANCES],
  // ...
} as const;
```

Board packages then reference the MCU's peripheral data rather than duplicating it:

```typescript
// In a board package
import { MCU_PERIPHERALS } from '@typecad/mcu-atmega328p';

export const ArduinoUno: BoardDefinition = {
  // ...
  peripherals: {
    ...MCU_PERIPHERALS,
    aliases: { UART0: 'Serial', I2C0: 'Wire', SPI0: 'SPI' }, // board-specific
    // board-specific overrides (e.g., reference voltages) go here
  },
};
```

### Auto-Generated HAL Instances

MCU packages also export the concrete HAL instances (`UART0`, `I2C0`, etc.) corresponding to their physical peripherals. To minimize boilerplate and prevent mismatches, these are auto-generated from the peripheral definition arrays using `createHALInstances` from `@typecad/hal`:

```typescript
import { createHALInstances, SerialPort, serialName } from '@typecad/hal';

/** UART/Serial instances */
export const [UART0] = createHALInstances(UART_INSTANCES, i => new SerialPort(serialName(i)));
```

Because `createHALInstances` returns a mapped array, you simply destructure exactly the instances you've defined in the array. This single line dynamically creates the correct HAL objects and ensures `UART0` is strongly typed and statically exported.


---

## How Board Packages Use This

The [`@typecad/board-arduino-uno`](../board-arduino-uno/src/pins.ts) package demonstrates the pattern:

```typescript
// Re-export datasheet pins from the MCU package
export {
  PD0, PD1, PD2, PD3, PD4, PD5, PD6, PD7,
  PB0, PB1, PB2, PB3, PB4, PB5,
  PC0, PC1, PC2, PC3, PC4, PC5,
} from '@typecad/mcu-atmega328p';

// Import for local aliasing
import { PD0, PB5, PC4, PC5, /* ... */ } from '@typecad/mcu-atmega328p';

// Board-specific aliases
export const D13 = PB5;   // Arduino digital pin 13
export const A0  = PC0;   // Arduino analog pin A0
export const LED = PB5;   // On-board LED
export const SDA = PC4;   // I2C data
export const SCL = PC5;   // I2C clock
```

The board package also provides the [`BoardDefinition`](../board-arduino-uno/src/index.ts:46) manifest with pin capabilities, peripheral assignments, memory specs, and build configuration.

---

## Creating a New `mcu-*` Package

Follow these steps to create an MCU package for a new microcontroller.

### 1. Scaffold the Package

```
packages/mcu-<chip>/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── pins.ts
    ├── peripherals.ts   ← hardware peripheral descriptions
    └── arduino-map.ts   (or other framework mappings)
```

### 2. `package.json`

```json
{
  "name": "@typecad/mcu-<chip>",
  "version": "0.1.0",
  "description": "TypeCAD MCU definition for <ChipName>",
  "type": "commonjs",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
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

### 3. `tsconfig.json`

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2021",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "references": [
    { "path": "../cuttlefish" },
    { "path": "../hal" }
  ]
}
```

### 4. `src/pins.ts` — Define Pins from the Datasheet

Open the MCU datasheet and find the GPIO port table. Create one `Pin.fromPort()` export per GPIO pin:

```typescript
import { Pin } from '@typecad/hal';

// Port A — 8-bit bidirectional I/O port
export const PA0 = Pin.fromPort('PA0');
export const PA1 = Pin.fromPort('PA1');
// ... up to PA7

// Port B — 8-bit bidirectional I/O port
export const PB0 = Pin.fromPort('PB0');
// ...

// Port C — etc.
```

**Guidelines:**

- **Use datasheet port names** (`PD0`, `PB5`, `PC0`) — these are the canonical identifiers.
- **Include ALL GPIO pins** on the chip, even if some are shared with crystal oscillators or reset pins. Add a comment noting any restrictions (e.g. `// PB6/PB7 are crystal oscillator on Uno, not GPIO`).
- **Do NOT include power, ground, or purely analog-only pins** that have no GPIO capability.
- **Do NOT create board-specific aliases** (like `LED` or `D13`) — those belong in board packages.

### 5. `src/peripherals.ts` — Describe Hardware Peripherals

Open the datasheet's peripheral overview chapter. Document every hardware peripheral built into the silicon using definition arrays, and auto-generate the concrete HAL instances:

```typescript
import { PeripheralInstance } from '@typecad/cuttlefish/api/schema';
import { createHALInstances, SerialPort, serialName } from '@typecad/hal';

export const UART_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, pins: { tx: 'PA0', rx: 'PA1' } },
  { instance: 1, pins: { tx: 'PA2', rx: 'PA3' } },
] as const;

// ... define I2C, SPI, etc.

/**
 * Hardware peripherals on the <ChipName>.
 * Source: <ChipName> datasheet, Section X — Peripheral Description
 */
export const MCU_PERIPHERALS = {
  uart: [...UART_INSTANCES],
  // ...
} as const;

// Auto-generate HAL objects
export const [UART0, UART1] = createHALInstances(UART_INSTANCES, i => new SerialPort(serialName(i)));
```

**What to include:**

- **Instance count** — How many of each peripheral the silicon provides (e.g., ESP32 has 3 I2C, 4 SPI, 3 UART; ATmega328P has 1 of each). Update the destructuring arrays to match exactly the available instances.
- **Pin assignments** — Which MCU port pins are hardwired to each peripheral function. These are fixed by the silicon and cannot be changed.
- **Capabilities** — Resolution (ADC/DAC bits), timer widths, max frequencies, etc.
- **Alternate pin functions** — If the chip supports pin muxing (like ESP32's GPIO matrix), document the default and alternate pin assignments.


**What NOT to include:**

- **Board-specific aliases** — `UART0 → 'Serial'` is an Arduino convention, not a chip property.
- **Reference voltages** — These depend on the board's power supply (5V vs 3.3V), not the silicon.
- **Framework-specific names** — `Wire`, `SPI`, `Serial` are Arduino names; other frameworks use different names.

### 6. `src/arduino-map.ts` — Add Framework Pin Mappings (if applicable)

If the chip is used with the Arduino framework, provide the port-name-to-Arduino-pin-number mapping:

```typescript
/**
 * Arduino pin number for each MCU port name.
 * Source: Arduino <variant>/pins_arduino.h
 */
export const ARDUINO_PIN_MAP: Readonly<Record<string, number>> = {
  PA0: 0,  PA1: 1,  // ...
};

/** Offset where analog pin numbering starts. */
export const ARDUINO_ANALOG_OFFSET = 14;

/** Reverse map: Arduino pin number → MCU port name. */
export const ARDUINO_PIN_REVERSE: Readonly<Record<number, string>> = {};
for (const [port, num] of Object.entries(ARDUINO_PIN_MAP)) {
  (ARDUINO_PIN_REVERSE as Record<number, string>)[num] = port;
}
```

**Source this from the actual Arduino core variant header** (e.g. `variants/standard/pins_arduino.h` for ATmega328P). Do not guess — wrong mappings cause silent hardware bugs.

If the chip supports multiple Arduino board variants with different pin mappings, export the most common one as `ARDUINO_PIN_MAP` and add additional named maps as needed (e.g., `ARDUINO_PIN_MAP_PRO_MINI`).

### 7. `src/index.ts` — Barrel Export

```typescript
export * from './pins';
export * from './peripherals';
export * from './arduino-map';
```

### 8. Add to Workspace

In the monorepo root `pnpm-workspace.yaml`, the package is automatically included if it's under `packages/`. Make sure to:

1. Run `pnpm install` from the workspace root to link the new package.
2. Reference it from any board package that uses this MCU:
   ```json
   // packages/board-<board>/package.json
   {
     "dependencies": {
       "@typecad/mcu-<chip>": "*"
     }
   }
   ```

---

## When to Create an MCU Package vs. a Board Package

| Scenario | Create |
|---|---|
| New microcontroller chip (e.g. ATtiny85, STM32F103) | `mcu-*` package |
| New board using an existing chip (e.g. Arduino Nano with ATmega328P) | `board-*` package only — reuse the `mcu-atmega328p` package |
| New board with a new chip | Both — `mcu-*` for the chip, `board-*` for the board |
| Chip used with a non-Arduino framework | Add framework mapping to existing `mcu-*` package |

### Key Principles

- **One MCU package per chip family.** The ATmega328P has one package shared by Arduino Uno, Pro Mini, Nano, and any custom board.
- **Pin names are datasheet port names.** `PD0` means the same thing on every ATmega328P board. Board-specific names like `RX` or `D0` go in the board package.
- **Peripheral counts are silicon facts.** The number of UART/I2C/SPI controllers is determined by the chip die, not the board. Document them once in the MCU package.
- **Framework mappings are per-chip, not per-board.** The Arduino pin mapping for ATmega328P is the same whether it's on an Uno or a Pro Mini. Only the board package changes (different aliases, different peripheral wiring).
- **MCU packages have no runtime code.** Everything is resolved at transpile time. The `Pin.fromPort()` calls exist only for the type system and transpiler — they produce no C++ output.

---

## ATmega328P Pin Reference

| Port | DIP-28 Pin | Arduino Pin | Peripheral Functions | Notes |
|------|-----------|-------------|---------------------|-------|
| PC6  | 1         | —           | RESET               | Reset pin (usually not GPIO) |
| PD0  | 2         | D0 / RX     | UART0 RX            | INT0 (external interrupt) |
| PD1  | 3         | D1 / TX     | UART0 TX            | INT1 (external interrupt) |
| PD2  | 4         | D2          | INT0                | External interrupt 0 |
| PD3  | 5         | D3~         | INT1, OC2B          | PWM (Timer2) |
| PD4  | 6         | D4          | —                   | — |
| VCC  | 7, 20     | —           | —                   | Power |
| GND  | 8, 22     | —           | —                   | Ground |
| PB6  | 9         | —           | TOSC1               | Crystal oscillator |
| PB7  | 10        | —           | TOSC2               | Crystal oscillator |
| PD5  | 11        | D5~         | OC0B                | PWM (Timer0) |
| PD6  | 12        | D6~         | OC0A                | PWM (Timer0) |
| PD7  | 13        | D7          | —                   | — |
| PB0  | 14        | D8          | —                   | — |
| PB1  | 15        | D9~         | OC1A                | PWM (Timer1) |
| PB2  | 16        | D10~        | OC1B, SPI SS        | PWM (Timer1) |
| PB3  | 17        | D11~        | OC2A, SPI MOSI      | PWM (Timer2) |
| PB4  | 18        | D12         | SPI MISO            | — |
| PB5  | 19        | D13         | SPI SCK             | On-board LED |
| AVCC | 21        | —           | —                   | Analog power supply |
| PC0  | 23        | A0 / D14    | ADC ch0             | — |
| PC1  | 24        | A1 / D15    | ADC ch1             | — |
| PC2  | 25        | A2 / D16    | ADC ch2             | — |
| PC3  | 26        | A3 / D17    | ADC ch3             | — |
| PC4  | 27        | A4 / SDA    | ADC ch4, I2C SDA    | — |
| PC5  | 28        | A5 / SCL    | ADC ch5, I2C SCL    | — |

---

## License

MIT
