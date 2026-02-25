# ESP32 DevKit V1 TypeCode SDK — Usage Guide

The `@typecode/board-esp32-devkit` package provides a fully-typed TypeScript
SDK for the DOIT ESP32 DevKit V1 (Espressif ESP32, dual-core Xtensa LX6, 240 MHz).
Every pin, peripheral, and timing function carries type information so that
TypeScript catches hardware mistakes **at compile time**, before you flash anything.

---

## Quick Start

```typescript
// typecode.config.ts
import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  target: 'esp32',
  board: '@typecode/board-esp32-devkit',
  fqbn: 'esp32:esp32:esp32doit-devkit-v1',
  output: { framework: 'arduino', optimize: 'speed' },
};
export default config;
```

Transpile, compile, upload, and monitor in one command:

```bash
node dist/cli.js sketch.ts \
  --compile --upload --monitor \
  --fqbn esp32:esp32:esp32doit-devkit-v1 \
  --port COM4 --baud 115200
```

---

## Importing

### Style 1 — Individual imports (tree-shakeable)

```typescript
import { D2, A0 }         from '@typecode/board-esp32-devkit/pins';
import { Serial, I2C0 }   from '@typecode/board-esp32-devkit/peripherals';
import { delay, millis }  from '@typecode/board-esp32-devkit/timing';
```

### Style 2 — Unified `Board` namespace

```typescript
import { Board } from '@typecode/board-esp32-devkit';

Board.LED.high();
Board.Serial.println("Hello ESP32");
Board.delay(500);
```

### Style 3 — Barrel import

```typescript
import {
  D2, A0, LED, Serial, Serial2, I2C0, SPI0,
  delay, millis, Board,
} from '@typecode/board-esp32-devkit';
```

---

## Pin Map

### Digital + PWM pins (output-capable)

All output-capable GPIOs on the ESP32 support PWM via the LEDC peripheral
and can trigger edge/level interrupts.

| Export | GPIO | Aliases    | Notes |
|--------|------|------------|-------|
| `D0`   | 0    |            | ADC2_CH1 · TOUCH1 · **boot-strapping** |
| `D1`   | 1    | `TX`, `TX0`| UART0 TX (USB-UART) |
| `D2`   | 2    | `LED`      | ADC2_CH2 · TOUCH2 · on-board LED |
| `D3`   | 3    | `RX`, `RX0`| UART0 RX (USB-UART) |
| `D4`   | 4    |            | ADC2_CH0 · TOUCH0 |
| `D5`   | 5    | `SS`       | VSPI CS · **boot-strapping** |
| `D12`  | 12   |            | ADC2_CH5 · TOUCH5 · HSPI MISO · **boot-strapping** |
| `D13`  | 13   |            | ADC2_CH4 · TOUCH4 · HSPI MOSI |
| `D14`  | 14   |            | ADC2_CH6 · TOUCH6 · HSPI SCK |
| `D15`  | 15   |            | ADC2_CH3 · TOUCH3 · HSPI CS · **boot-strapping** |
| `D16`  | 16   | `RX2`      | UART2 RX default |
| `D17`  | 17   | `TX2`      | UART2 TX default |
| `D18`  | 18   | `SCK`      | VSPI clock |
| `D19`  | 19   | `MISO`     | VSPI MISO |
| `D21`  | 21   | `SDA`      | I2C data (Wire default) |
| `D22`  | 22   | `SCL`      | I2C clock (Wire default) |
| `D23`  | 23   | `MOSI`     | VSPI MOSI |
| `D25`  | 25   | `DAC1`     | ADC2_CH8 · DAC channel 1 |
| `D26`  | 26   | `DAC2`     | ADC2_CH9 · DAC channel 2 |
| `D27`  | 27   |            | ADC2_CH7 · TOUCH7 |
| `D32`  | 32   | `A4`       | ADC1_CH4 · TOUCH9 · WiFi-safe |
| `D33`  | 33   | `A5`       | ADC1_CH5 · TOUCH8 · WiFi-safe |

> **ADC2 warning** — Pins with ADC2 capability (D0, D2, D4, D12–D15, D25–D27)
> cannot be sampled while the WiFi stack is active.  Use ADC1 pins for analog
> reads in WiFi sketches.

### Input-only analog pins (ADC1 · WiFi-safe)

These GPIOs (34–39) are input-only — no digital output, no PWM, no internal
pull-up/down resistors.

| Export | GPIO | Aliases | ADC channel |
|--------|------|---------|-------------|
| `A0`   | 36   | `VP`    | ADC1_CH0    |
| `A1`   | 39   | `VN`    | ADC1_CH3    |
| `A2`   | 34   |         | ADC1_CH6    |
| `A3`   | 35   |         | ADC1_CH7    |

---

## Peripherals

### I2C — `I2C0` (Wire)

Default pins: **GPIO 21 (SDA)** / **GPIO 22 (SCL)**.

```typescript
import { I2C0 } from '@typecode/board-esp32-devkit';
import { I2CSpeed } from '@typecode/core';

I2C0.initialize({ speed: I2CSpeed.FAST });

const devices = I2C0.scan();               // returns list of found addresses
I2C0.writeByte(0x3C, 0x00, 0xAE);          // display off (SSD1306)
const temp = I2C0.readByte(0x48, 0x00);    // read temperature register
```

### SPI — `SPI0` (VSPI)

Default pins: **GPIO 23 (MOSI)**, **GPIO 19 (MISO)**, **GPIO 18 (SCK)**,
**GPIO 5 (CS)**.

```typescript
import { SPI0 } from '@typecode/board-esp32-devkit';

SPI0.initialize({ frequency: 8_000_000 });
SPI0.write(new Uint8Array([0x01, 0x02, 0x03]));
const response = SPI0.transfer(new Uint8Array([0xFF]));
```

### Serial — `Serial` (UART0, USB) and `Serial2` (UART2)

```typescript
import { Serial, Serial2 } from '@typecode/board-esp32-devkit';

Serial.initialize({ baudRate: 115200 });
Serial.println("Hello from ESP32!");

// Use Serial2 for external peripherals (GPIO17=TX, GPIO16=RX)
Serial2.initialize({ baudRate: 9600 });
Serial2.writeLine("AT");
const reply = Serial2.readLine(1000);
```

---

## Analog

The ESP32 uses attenuation rather than a reference voltage selector:

```typescript
import { AnalogAttenuation, analogSetAttenuation } from '@typecode/board-esp32-devkit';
import { A0, D32 } from '@typecode/board-esp32-devkit';

// Use full 3.3 V range (default)
analogSetAttenuation(AnalogAttenuation.DB_11);

const raw = A0.read();          // 12-bit ADC value (0–4095)
const wifiSafe = D32.read();    // ADC1 — works while WiFi is active
```

True analog output via DAC:

```typescript
import { dacWrite, D25 } from '@typecode/board-esp32-devkit';

dacWrite(D25.gpio, 128);   // ~1.65 V on GPIO 25 (DAC1)
```

---

## PWM (LEDC)

Any output-capable GPIO can be used as a PWM output via `analogWrite()`:

```typescript
import { D2 } from '@typecode/board-esp32-devkit';

// Fade the LED on GPIO 2
for (let duty = 0; duty <= 255; duty++) {
  D2.analogWrite(duty);
  delay(10);
}
```

---

## Interrupts

Every GPIO (including input-only 34–39) can trigger interrupts:

```typescript
import { D4, attachInterrupt, detachInterrupt } from '@typecode/board-esp32-devkit';
import { InterruptMode } from '@typecode/core';

attachInterrupt(D4.gpio, () => {
  // Keep ISRs short — runs in IRAM on ESP32
}, InterruptMode.RISING);
```

---

## Boot-strapping pins

The ESP32 uses several GPIOs as boot-strapping pins that affect the boot mode
and flash voltage.  Avoid driving them with external circuitry during reset:

| GPIO | Default state  | Risk if driven LOW at boot |
|------|----------------|----------------------------|
| 0    | Pull HIGH      | Enters download mode       |
| 2    | –              | Might prevent booting      |
| 5    | Pull HIGH      | Sets SDIO slave timing     |
| 12   | Pull LOW       | Selects 1.8 V flash (!)    |
| 15   | Pull HIGH      | Silences boot messages     |

---

## Board metadata

```typescript
import Esp32DevKit from '@typecode/board-esp32-devkit';

console.log(Esp32DevKit.name);          // "ESP32 DevKit V1"
console.log(Esp32DevKit.mcu);           // "ESP32"
console.log(Esp32DevKit.clockSpeed);    // 240000000
console.log(Esp32DevKit.memory.flash);  // 4194304
console.log(Esp32DevKit.features.wifi); // true
```
