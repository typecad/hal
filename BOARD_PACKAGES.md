# Adding New Board Packages

Board packages are npm packages under `packages/` that describe a specific hardware board: its pins, peripherals, memory, build configuration, and convenience exports. The transpiler uses them to resolve Arduino built-ins and emit correct C++ for the target hardware.

## Existing boards

| Package | FQBN | Architecture |
|---|---|---|
| `@typecode/board-arduino-uno` | `arduino:avr:uno` | `avr` |
| `@typecode/board-arduino-nano33iot` | `arduino:samd:nano_33_iot` | `samd` |
| `@typecode/board-esp32-devkit` | `esp32:esp32:esp32doit-devkit-v1` | `esp32` |

To use an existing board in a project, set `board` and `fqbn` in `typecode.config.ts` and import from `@typecode`. See [§15](#15-use-from-a-sketch) for the full usage flow.

This guide walks through creating a **new** board package, using the three existing boards as reference.

---

## 1. Package Structure

Every board package follows the same layout:

```
packages/board-<name>/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts        ← BoardDefinition manifest + barrel re-exports
    ├── pins.ts         ← Typed pin constants
    ├── peripherals.ts  ← I2C, SPI, Serial stub instances
    ├── timing.ts       ← delay / millis / micros declarations
    ├── analog.ts       ← Board-specific analog helpers / enums
    ├── interrupts.ts   ← attachInterrupt / noInterrupts declarations
    └── board.ts        ← Board namespace facade (IBoard, Board object)
```

---

## 2. Create the Package Directory

Choose a name that follows the convention `board-<vendor>-<model>` and create the directory:

```
packages/board-rp2040-pico/
```

---

## 3. `package.json`

```json
{
  "name": "@typecode/board-rp2040-pico",
  "version": "0.1.0",
  "description": "TypeCode Raspberry Pi Pico board definition",
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
    "@typecode/core": "^0.1.0"
  },
  "license": "MIT",
  "publishConfig": {
    "access": "public"
  }
}
```

---

## 4. `tsconfig.json`

Copy this verbatim — every board package uses the same compiler settings:

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2021",
    "module": "CommonJS",
    "moduleResolution": "Node",
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
  "include": ["src/**/*.ts"]
}
```

---

## 5. `src/pins.ts`

Exports one typed constant per physical pin. Each export carries the narrowest `@typecode/core` interface combination that accurately reflects the pin's hardware capabilities.

### Factory stub pattern

Declare private factory functions that return `number` — this is important because the transpiler maps the return type to `int` in C++. Use `as unknown as <InterfaceType>` at each export site to layer on the type information without affecting code generation.

```typescript
import type { IDigitalPin, IPWMPin, IAnalogInput, IInterruptPin } from '@typecode/core';

// Internal stubs — return `number` so the transpiler emits `int` in C++.
function createDigitalPin(pin: number, _gpio: number): number { return pin; }
function createPWMPin(pin: number, _gpio: number): number { return pin; }
function createAnalogPWMPin(pin: number, _gpio: number): number { return pin; }
function createAnalogInputPin(pin: number, _gpio: number): number { return pin; }
```

### Pin exports

Use the correct interface intersection for each pin's actual capabilities:

| Hardware capability          | Interface(s) to intersect                         |
|------------------------------|---------------------------------------------------|
| Digital I/O only             | `IDigitalPin`                                     |
| Digital + hardware interrupt | `IDigitalPin & IInterruptPin`                     |
| Digital + PWM                | `IPWMPin`                                         |
| Digital + PWM + interrupt    | `IPWMPin & IInterruptPin`                         |
| Analog input only            | `IAnalogInput`                                    |
| Analog + PWM + interrupt     | `IAnalogInput & IPWMPin & IInterruptPin`          |

```typescript
/** GPIO 0 — UART0 TX. */
export const D0 = createDigitalPin(0, 0) as unknown as IDigitalPin & IInterruptPin;

/** GPIO 2 — PWM + analog. */
export const D2 = createAnalogPWMPin(2, 2) as unknown as IAnalogInput & IPWMPin & IInterruptPin;

/** ADC input, input-only. */
export const A0 = createAnalogInputPin(26, 26) as unknown as IAnalogInput;
```

### Convenience aliases

Always export the standard aliases. Never export an alias that is also an Arduino framework macro name as a bare `const` (e.g. `HIGH`, `LOW`, `INPUT`). The standard safe aliases are:

```typescript
export const LED  = /* the pin constant for the on-board LED */;
export const SDA  = /* I2C data pin */;
export const SCL  = /* I2C clock pin */;
export const MOSI = /* SPI MOSI pin */;
export const MISO = /* SPI MISO pin */;
export const SCK  = /* SPI clock pin */;
export const SS   = /* SPI chip-select pin */;
export const TX   = /* UART0 TX pin */;
export const RX   = /* UART0 RX pin */;
```

> **Important — forward-reference rule.** If `LED` is an alias for a pin that is already exported (e.g. `LED = D13`), the alias is fine. If the LED pin is unique (not exported under another name), create it with a direct factory call rather than pointing to another constant. This prevents the transpiler from inserting a `const int LED = D13` declaration before `D13` is defined in the merged `.ino` file.
>
> ✅ `export const LED = D13;` — safe, D13 is already defined above  
> ✅ `export const LED = createDigitalPin(13, 13) as unknown as IDigitalPin;` — always safe  
> ❌ `export const LED = D2;` where D2 is defined later in the same file

---

## 6. `src/peripherals.ts`

Exports stub object literals for each hardware peripheral bus. These objects carry full TypeScript type information at design time; the transpiler replaces method calls with the appropriate Arduino library calls at code-generation time.

```typescript
import type { II2CBus, I2CConfig, I2CAddress } from '@typecode/core';
import { I2CSpeed } from '@typecode/core';
import type { ISPIBus, SPIConfig, SPITransferOptions } from '@typecode/core';
import { SPIMode, SPIBitOrder } from '@typecode/core';
import type { ISerialPort, UARTConfig } from '@typecode/core';

// I2C bus 0
export const I2C0: II2CBus = {
  busNumber: 0,
  speed: I2CSpeed.STANDARD,
  isInitialized: false,

  initialize(_config?: I2CConfig) {},
  deinitialize() {},

  scan(): I2CAddress[] { return []; },
  ping(_address: I2CAddress): boolean { return false; },

  write(_address: I2CAddress, _data: Uint8Array) {},
  read(_address: I2CAddress, _length: number): Uint8Array { return new Uint8Array(0); },
  writeThenRead(_address: I2CAddress, _writeData: Uint8Array, _readLength: number): Uint8Array { return new Uint8Array(0); },
  readRegister(_address: I2CAddress, _register: number, _buffer: Uint8Array): number { return 0; },
  writeRegister(_address: I2CAddress, _register: number, _data: Uint8Array) {},
  readByte(_address: I2CAddress, _register: number): number { return 0; },
  writeByte(_address: I2CAddress, _register: number, _value: number) {},
  readWord(_address: I2CAddress, _register: number, _littleEndian?: boolean): number { return 0; },
  writeWord(_address: I2CAddress, _register: number, _value: number, _littleEndian?: boolean) {},
  setSpeed(_speed: I2CSpeed | number) {},
  getSpeed(): I2CSpeed | number { return I2CSpeed.STANDARD; },
} as II2CBus;

// SPI bus 0
export const SPI0: ISPIBus = {
  busNumber: 0,
  frequency: 4_000_000,
  mode: SPIMode.MODE_0,
  isInitialized: false,

  initialize(_config?: SPIConfig) {},
  deinitialize() {},
  transfer(_txData: Uint8Array, _options?: SPITransferOptions): Uint8Array { return new Uint8Array(0); },
  write(_data: Uint8Array, _options?: SPITransferOptions) {},
  read(_length: number, _options?: SPITransferOptions): Uint8Array { return new Uint8Array(0); },
  writeRegister(_csPin: number, _register: number, _data: Uint8Array) {},
  readRegister(_csPin: number, _register: number, _length: number): Uint8Array { return new Uint8Array(0); },
  setFrequency(_hz: number) {},
  setMode(_mode: SPIMode) {},
  setBitOrder(_order: SPIBitOrder) {},
} as ISPIBus;

// Serial (UART 0)
function makeSerialPort(uartNum: number): number { return uartNum; }

export const Serial = makeSerialPort(0) as unknown as ISerialPort;
```

**`makeSerialPort` must return `number`**, not `ISerialPort`. The `as unknown as ISerialPort` cast at the export site provides type information without affecting generated code.

If the board has a second UART, add `Serial2 = makeSerialPort(2) as unknown as ISerialPort;`.

---

## 7. `src/timing.ts`

All Arduino targets share the same timing built-ins. Copy this file unchanged:

```typescript
export declare function delay(ms: number): void;
export declare function millis(): number;
export declare function micros(): number;
export declare function delayMicroseconds(us: number): void;
export declare function map(value: number, fromLow: number, fromHigh: number, toLow: number, toHigh: number): number;
export declare function constrain(value: number, low: number, high: number): number;
```

---

## 8. `src/analog.ts`

Expose any board-specific analog configuration — typically an enum for ADC reference voltage or attenuation, and a `declare function` for setting it.

**AVR boards** (Uno, Nano, Mega) use a reference voltage model:

```typescript
export enum AnalogReference {
  DEFAULT  = 1,
  INTERNAL = 3,
  EXTERNAL = 0,   // Note: EXTERNAL is an Arduino macro; this is safe because it
                  // is inside an enum class, which the emitter prefixes with _.
}
export declare function analogReference(ref: AnalogReference): void;
```

**ESP32 boards** use an attenuation model:

```typescript
export enum AnalogAttenuation {
  DB_0   = 0,
  DB_2_5 = 1,
  DB_6   = 2,
  DB_11  = 3,
}
export declare function analogSetAttenuation(attenuation: AnalogAttenuation): void;
export declare function dacWrite(pin: number, value: number): void;
```

> **Enum value overflow on AVR.** The AVR `int` is 16-bit. Any enum whose members have values greater than 32767 or less than −32768 will produce a compiler error on `arduino:avr:*` targets. The transpiler automatically emits `enum class Foo : long { … }` for such enums, but only use large values when they are genuinely needed (e.g. `I2CSpeed` values like 100000 are correct — they map to Hz).

---

## 9. `src/interrupts.ts`

```typescript
import type { InterruptHandler, InterruptMode } from '@typecode/core';

export declare function noInterrupts(): void;
export declare function interrupts(): void;
export declare function attachInterrupt(pin: number, handler: InterruptHandler, mode: InterruptMode): void;
export declare function detachInterrupt(pin: number): void;
```

---

## 10. `src/index.ts` — Board Definition Manifest

This is the largest file. It has two sections:

### 10.1 Capability shorthands

Define a small set of `const` objects representing common pin capability combinations. This keeps the `pins.all` array readable:

```typescript
const NO = false as const;
const YES = true  as const;

const DIGITAL = {
  digitalInput: YES, digitalOutput: YES,
  analogInput: NO,   analogOutput: NO,
  pwm: NO,           interrupt: NO,
  pullUp: YES,       pullDown: NO,
  touch: NO,         openDrain: NO,
} as const;

const DIGITAL_PWM     = { ...DIGITAL, pwm: YES } as const;
const DIGITAL_INT     = { ...DIGITAL, interrupt: YES } as const;
const DIGITAL_PWM_INT = { ...DIGITAL, pwm: YES, interrupt: YES } as const;
const ANALOG_IN       = { ...DIGITAL, analogInput: YES } as const;
```

### 10.2 `BoardDefinition` object

> **Before you set `architecture:`** — check that the string you intend to use is already a member of `ArchitectureIdentifier` in `packages/core/src/board/types.ts`. The type is a union literal; if your architecture is not listed, TypeScript will reject the `BoardDefinition` assignment and the board package will fail to build. See [§12.3](#123-register-a-new-architecture-identifier-if-needed) for how to add a new value.
>
> Current values: `'avr'` | `'esp32'` | `'esp32s2'` | `'esp32s3'` | `'esp32c3'` | `'rp2040'` | `'samd'` | `'stm32'` | `'nrf52'`

```typescript
import type { BoardDefinition } from '@typecode/core';

export const MyBoard: BoardDefinition = {
  id: 'rp2040-pico',
  name: 'Raspberry Pi Pico',
  vendor: 'Raspberry Pi',
  description: 'RP2040 dual-core Cortex-M0+, 133 MHz',
  architecture: 'rp2040',
  mcu: 'RP2040',
  clockSpeed: 133_000_000,

  memory: {
    flash:  2_097_152, // 2 MB
    sram:     270_336, // 264 KB
    eeprom:         0,
  },

  pins: {
    all: [
      { number: 0,  gpio: 0,  name: 'D0',  aliases: ['TX'],  capabilities: DIGITAL_INT,
        functions: [{ type: 'uart', instance: 0, role: 'tx' }] },
      { number: 1,  gpio: 1,  name: 'D1',  aliases: ['RX'],  capabilities: DIGITAL_INT,
        functions: [{ type: 'uart', instance: 0, role: 'rx' }] },
      // … all other pins …
      { number: 25, gpio: 25, name: 'D25', aliases: ['LED'], capabilities: DIGITAL,
        onboardLed: true },
      { number: 26, gpio: 26, name: 'A0', capabilities: ANALOG_IN,
        functions: [{ type: 'adc', instance: 0, role: 'ch0' }] },
    ],

    // Lists of pin names grouped by capability — used by tooling and docs.
    digital: ['D0', 'D1', /* … */],
    analog:  ['A0', 'A1', 'A2'],
    pwm:     ['D0', 'D1', /* … */],

    // Default peripheral pin assignments (names must match entries in `all`).
    i2c:  { 0: { sda: 'D4', scl: 'D5' } },
    spi:  { 0: { mosi: 'D19', miso: 'D16', sck: 'D18', cs: 'D17' } },
    uart: { 0: { tx: 'D0', rx: 'D1' } },

    led: 'D25',   // name of the on-board LED pin
  },

  peripherals: {
    i2c:  [{ instance: 0, defaultPins: { sda: 'D4', scl: 'D5' } }],
    spi:  [{ instance: 0, defaultPins: { mosi: 'D19', miso: 'D16', sck: 'D18', cs: 'D17' } }],
    uart: [{ instance: 0, defaultPins: { tx: 'D0', rx: 'D1' } }],
    adc:  [{ instance: 0, channels: 3, resolution: 12, referenceVoltage: 3.3 }],
    pwm:  { channels: 16, resolution: 16, maxFrequency: 62_500_000 },
  },

  features: {
    multicore: true,
    coreCount: 2,
    deepSleep: true,
    watchdog: true,
    externalInterrupts: true,
    hardwareRng: true,
    fpu: false,
  },

  build: {
    platformio: 'pico',
    arduino: 'rp2040:rp2040:rpipico',   // arduino-cli FQBN
    extraFlags: [],
    defines: {
      F_CPU:   '133000000UL',
      ARDUINO: '10819',
    },
  },
};

export default MyBoard;
```

### 10.3 Barrel re-exports

At the bottom of `index.ts`, re-export everything users might import from the package in one place:

```typescript
// Pins
export { D0, D1, /* … */, A0, A1, A2, LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX } from './pins';

// Peripherals
export { I2C0, SPI0, Serial } from './peripherals';

// Utilities
export { delay, millis, micros, delayMicroseconds, map, constrain } from './timing';
export { AnalogReference, analogReference } from './analog';
export { noInterrupts, interrupts, attachInterrupt, detachInterrupt } from './interrupts';

// Board namespace
export { Board } from './board';
export type { IBoard, DigitalPins, AnalogPins } from './board';
```

---

## 11. `src/board.ts` — Board Namespace Facade

`board.ts` bundles every pin and peripheral under a single `Board` object so users can do `import { Board } from '@typecode/board-rp2040-pico'` and access everything through one namespace.

```typescript
import type { IDigitalPin, IPWMPin, IAnalogInput, IInterruptPin,
              II2CBus, ISPIBus, ISerialPort, BoardDefinition } from '@typecode/core';
import { D0, D1, /* … */, A0, LED, SDA, SCL } from './pins';
import { I2C0, SPI0, Serial } from './peripherals';
import { delay, millis, micros, delayMicroseconds } from './timing';
import { MyBoard } from './index';

export interface DigitalPins {
  D0: IDigitalPin & IInterruptPin;
  // … one entry per pin …
}

export interface AnalogPins {
  A0: IAnalogInput;
  // …
}

export interface IBoard {
  readonly definition: BoardDefinition;
  readonly D0: IDigitalPin & IInterruptPin;
  // … one readonly field per pin …
  readonly LED: IDigitalPin;
  readonly I2C0: II2CBus;
  readonly SPI0: ISPIBus;
  readonly Serial: ISerialPort;
  delay(ms: number): void;
  millis(): number;
  micros(): number;
}

export const Board: IBoard = {
  definition: MyBoard,
  D0, /* … */,
  LED,
  I2C0, SPI0, Serial,
  delay, millis, micros,
};
```

---

## 12. Register the Package in the Workspace

### 12.1 `package.json` workspaces

Add the new package to the root `package.json`:

```json
{
  "workspaces": [
    "packages/core",
    "packages/board-arduino-uno",
    "packages/board-esp32-devkit",
    "packages/board-rp2040-pico",   ← add this
    "packages/cli"
  ]
}
```

Run `npm install` from the workspace root to create the symlink under `node_modules/@typecode/`.

### 12.2 `packages/cli/src/ir/typecode-symbols.ts`

The transpiler uses this file to decide *how* to emit a use of a named pin constant. Add an entry for every pin and alias exported by the new board:

```typescript
const STATIC_KINDS: Readonly<Record<string, TypecodeReceiverKind>> = {
  // … existing entries …

  // ---- Raspberry Pi Pico pins -------------------------------------------
  D2:  'digital',
  D3:  'digital',
  // … all digital-only pins …

  D4:  'pwm',          // PWM-capable
  // … all PWM pins …

  A0:  'analog-input',
  A1:  'analog-input',
  A2:  'analog-input',
};
```

The valid receiver kinds are:

| Kind           | When to use                                  |
|----------------|----------------------------------------------|
| `digital`      | `IDigitalPin` — digitalWrite / digitalRead   |
| `pwm`          | `IPWMPin` — analogWrite (PWM) + digitalRead  |
| `analog-input` | `IAnalogInput` — analogRead                  |
| `serial`       | `ISerialPort` — Serial.print etc.            |
| `i2c`          | `II2CBus` — Wire library calls               |
| `spi`          | `ISPIBus` — SPI library calls                |

> **Existing entries override new ones.** If your board reuses a pin name already in the map (e.g. `D0`, `A0`) you do not need to add it again — the map is board-agnostic by design.

### 12.3 Register a new architecture identifier (if needed)

The `architecture` field on `BoardDefinition` is constrained to the `ArchitectureIdentifier` union type defined in `packages/core/src/board/types.ts`. If you are targeting an architecture family that is not yet in that union (e.g. adding the first `samd` board), you must extend the union **before** building the board package, otherwise the TypeScript compiler will reject `architecture: 'samd'` with a type error.

1. Open `packages/core/src/board/types.ts` and add the new literal to the union:

```typescript
// Before
export type ArchitectureIdentifier =
  | 'avr'
  | 'esp32'
  // …
  | 'nrf52';

// After
export type ArchitectureIdentifier =
  | 'avr'
  | 'esp32'
  // …
  | 'samd'   // ← add the new architecture
  | 'nrf52';
```

2. Rebuild the core package so the updated `.d.ts` is emitted:

```bash
cd packages/core
npx tsc -b
```

3. **Then** proceed to build the board package. Because the workspace symlink already points `@typecode/core` at the local `packages/core/dist`, the board package will pick up the updated type automatically.

> **Do not skip the core rebuild.** The board package's `tsconfig.json` references the compiled `dist/` output, not the source. If you edit the source without rebuilding, the old `.d.ts` will still be used and the type error will persist.

---

## 13. ARM and new-API platform pitfalls

Several Arduino targets include header files that pre-declare names which can silently collide with identifiers emitted by the transpiler. The emitter guards against all known collisions, but understanding them helps when debugging unexpected C++ compile errors on ARM-based or new-API boards.

### 13.1 `PinMode` / `InterruptMode` redefinition (new Arduino API targets)

Boards that use the new Arduino API (`arduino:samd`, `arduino:mbed_rp2040`, `arduino:mbed_nano`, `arduino:nrf52`, and most non-AVR community cores) include `api/Common.h`, which declares `PinMode` and `PinStatus` as C-style `enum` typedefs. The transpiler also emits an `enum class PinMode` from `@typecode/core`. Redefining a C typedef as an `enum class` produces:

```
error: using typedef-name 'PinMode' after 'enum'
```

**How it is handled:** The emitter wraps the `PinMode` and `InterruptMode` enum class definitions in a preprocessor guard:

```cpp
#if !defined(ARDUINO_API_VERSION)
enum class PinMode { … };
#endif // !defined(ARDUINO_API_VERSION)
```

`ARDUINO_API_VERSION` is defined by `api/ArduinoAPI.h` on all new-API cores; classic AVR cores do not define it, so those boards still receive the full enum. No action is needed when authoring a board package — the guard is emitted automatically.

**Affected architectures:** `samd`, `nrf52`, `rp2040` (mbed variant), and any core that ships `api/Common.h`.

### 13.2 CMSIS hardware-register macros (ARM Cortex-M targets)

ARM device-support packages (CMSIS) define hardware peripheral base-addresses as object-like macros named after the peripheral — for example in `samd21g18a.h`:

```c
#define RTC    ((Rtc      *)0x40001400UL)
#define USB    ((Usb      *)0x41005000UL)
#define ADC    ((Adc      *)0x42004000UL)
#define DAC    ((Dac      *)0x42004800UL)
#define WDT    ((Wdt      *)0x40001000UL)
```

If any `enum` member in your TypeScript code (or in `@typecode/core`) uses one of these names, the preprocessor expands it into a hardware-register pointer expression inside the enum body, causing a cascade of parse errors:

```
error: expected identifier before '(' token
error: expected '}' before '(' token
```

**How it is handled:** The emitter treats these names as reserved on Arduino targets and prefixes them with `_` in emitted enum members (the same mechanism used for `INPUT`, `OUTPUT`, `EXTERNAL`, etc.). For example, `MemoryRegion.RTC` is emitted as `MemoryRegion::_RTC` in the generated C++.

**What to watch for when adding new enum types:** If you add a new TypeScript `enum` to a board package or to `@typecode/core` whose members include names that match CMSIS peripheral macros on your target device, the C++ compiler will produce the errors above. Check the device's CMSIS header (e.g. `samd21g18a.h`, `stm32f4xx.h`) for macro names that overlap with your enum members, and report them so the emitter's reserved-name list can be updated.

> **Quick check before adding enum members on ARM targets:** run `grep -i '#define <MEMBER_NAME>' /path/to/cmsis/device.h`. If there is a match, that member name will need to be added to the emitter's `arduinoReservedNames` set in `packages/cli/src/emit/cpp-emitter.ts`.

---

## 14. Build the Package

```bash
# From the workspace root — builds all packages in dependency order
npm run build

# Or build just the new board package
cd packages/board-rp2040-pico
npx tsc -b
```

---

## 15. Use from a Sketch

### 15.1 Create `typecode.config.ts`

Place a `typecode.config.ts` file in the same directory as your sketch (or any parent directory — the transpiler walks upward to find it):

```typescript
import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  target: 'rp2040',
  board:  '@typecode/board-rp2040-pico',
  fqbn:   'rp2040:rp2040:rpipico',
  output: { framework: 'arduino', optimize: 'size', outDir: './out' },
};

export default config;
```

`board` must be the full npm package name of the board package.  `fqbn` is required and is passed to `arduino-cli` during `--compile`.

### 15.2 Import from `@typecode`

In sketch files use the virtual `@typecode` specifier instead of the concrete board package name. The transpiler resolves it to the `board` value from `typecode.config.ts`:

```typescript
import { Board, LED, delay } from '@typecode';

function setup() {
  Board.LED.asOutput();
}

function loop() {
  LED.high();
  delay(500);
  LED.low();
  delay(500);
}
```

This decouples the sketch source from the specific board package name — switching boards only requires updating `typecode.config.ts`.

### 15.3 Transpile, compile, and upload

```bash
# Transpile only
npx typecode sketch.ts

# Transpile + compile (fqbn read from typecode.config.ts)
npx typecode sketch.ts --compile

# Transpile + compile + upload
npx typecode sketch.ts --compile --upload --port COM4

# Full chain with serial monitor
npx typecode sketch.ts --compile --upload --monitor --port COM4 --baud 115200
```

The `--fqbn` flag is only needed when there is no `typecode.config.ts` (legacy or one-off usage):

```bash
npx typecode sketch.ts --compile --fqbn rp2040:rp2040:rpipico
```

### 15.4 Editor type checking

On the first run, the transpiler generates `typecode-env.d.ts` next to `typecode.config.ts`:

```typescript
// typecode-env.d.ts — auto-generated by the typecode transpiler. Do not edit.
declare module '@typecode' {
  export * from '@typecode/board-rp2040-pico';
}
```

TypeScript's language server discovers this file automatically, so `import { Board, delay } from '@typecode'` resolves without errors and IntelliSense is fully board-aware. The file is regenerated on every transpiler run, keeping it in sync whenever `board` changes in the config.

Commit both `typecode.config.ts` and `typecode-env.d.ts` to source control.

---

## 16. Checklist

**Core (do first if architecture is new)**
- [ ] `architecture:` value exists in `ArchitectureIdentifier` in `packages/core/src/board/types.ts`; if not, add it and run `npx tsc -b` in `packages/core` before anything else

**Package files**
- [ ] `packages/board-<name>/package.json` with `@typecode/core` dependency
- [ ] `packages/board-<name>/tsconfig.json` (composite, outDir dist)
- [ ] `src/pins.ts` — factory stubs return `number`, exports use `as unknown as`
- [ ] `src/pins.ts` — `LED` alias uses direct factory call if not a duplicate of another export
- [ ] `src/peripherals.ts` — `makeSerialPort` returns `number`, not `ISerialPort`
- [ ] `src/timing.ts` — `declare function` stubs only
- [ ] `src/analog.ts` — board-specific ADC enum + declare function
- [ ] `src/interrupts.ts` — interrupt declare functions
- [ ] `src/board.ts` — `IBoard` interface + `Board` object
- [ ] `src/index.ts` — `BoardDefinition` with all sections + barrel re-exports

**Workspace registration**
- [ ] Root `package.json` `workspaces` array updated
- [ ] `npm install` run from workspace root
- [ ] `packages/cli/src/ir/typecode-symbols.ts` updated with new pin names (only needed for pin names not already in the map)

**ARM / new-API boards (samd, nrf52, rp2040-mbed, stm32)**
- [ ] If adding new enum members, verify member names do not collide with CMSIS hardware-register macros in the target device header (see §13.2)
- [ ] No action needed for `PinMode`/`InterruptMode` — the emitter guards these automatically (see §13.1)

**Build and verify**
- [ ] Package builds cleanly (`npx tsc -b`)
- [ ] `typecode.config.ts` created with `board: '@typecode/board-<name>'` and `fqbn`
- [ ] Run `npx typecode sketch.ts` once to generate `typecode-env.d.ts` (satisfies editor type checking for `import ... from '@typecode'`)
- [ ] Test sketch compiles for the target FQBN (`npx typecode sketch.ts --compile`)
