# Board Definitions

## Overview

Board definitions are JSON/TypeScript manifests that describe a specific hardware board's capabilities, pin mappings, and available peripherals. They serve as the "Hardware Manifest" that enables compile-time validation of firmware code against actual hardware constraints.

---

## Board Definition Structure

```typescript
// src/@typecode/core/board/types.ts

/**
 * Board definition manifest
 */
interface BoardDefinition {
  /** Board identifier (e.g., "arduino-uno", "esp32-devkit-v1") */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Board vendor */
  vendor: string;
  
  /** Board description */
  description?: string;
  
  /** Target architecture */
  architecture: ArchitectureIdentifier;
  
  /** MCU/FPGA part number */
  mcu: string;
  
  /** Clock speed in Hz */
  clockSpeed: number;
  
  /** Memory specifications */
  memory: MemorySpec;
  
  /** Pin definitions */
  pins: PinDefinitions;
  
  /** Built-in peripherals */
  peripherals: PeripheralDefinitions;
  
  /** Supported features */
  features: FeatureFlags;
  
  /** Build configuration */
  build: BuildConfig;
  
  /** Related boards (variants) */
  variants?: string[];
}

/**
 * Architecture identifier
 */
type ArchitectureIdentifier = 
  | 'avr'
  | 'esp32'
  | 'esp32s2'
  | 'esp32s3'
  | 'esp32c3'
  | 'rp2040'
  | 'stm32'
  | 'nrf52';

/**
 * Memory specifications
 */
interface MemorySpec {
  /** Flash/Program memory in bytes */
  flash: number;
  
  /** SRAM in bytes */
  sram: number;
  
  /** EEPROM in bytes (0 if none) */
  eeprom: number;
  
  /** External RAM (PSRAM) in bytes, if available */
  externalRam?: number;
  
  /** RTC memory in bytes, if available */
  rtcMemory?: number;
}

/**
 * Pin definition for a single pin
 */
interface PinDefinition {
  /** Pin number on package */
  number: number;
  
  /** GPIO number (may differ from physical pin) */
  gpio?: number;
  
  /** Pin name (e.g., "D13", "A0", "SDA") */
  name: string;
  
  /** Alternate names */
  aliases?: string[];
  
  /** Pin capabilities */
  capabilities: PinCapabilityFlags;
  
  /** Associated peripheral functions */
  functions?: PeripheralFunction[];
  
  /** Is this pin connected to onboard LED? */
  onboardLed?: boolean;
  
  /** Is this pin connected to onboard button? */
  onboardButton?: boolean;
  
  /** Notes/warnings about this pin */
  notes?: string;
}

/**
 * Pin capability flags
 */
interface PinCapabilityFlags {
  digitalInput: boolean;
  digitalOutput: boolean;
  analogInput: boolean;
  analogOutput: boolean;  // DAC
  pwm: boolean;
  interrupt: boolean;
  pullUp: boolean;
  pullDown: boolean;
  touch: boolean;
  openDrain: boolean;
}

/**
 * Peripheral function mapping
 */
interface PeripheralFunction {
  /** Peripheral type */
  type: 'i2c' | 'spi' | 'uart' | 'adc' | 'dac' | 'pwm' | 'touch' | 'usb';
  
  /** Peripheral instance number */
  instance: number;
  
  /** Function role (e.g., "sda", "scl", "mosi", "miso") */
  role: string;
}

/**
 * Pin definitions for the board
 */
interface PinDefinitions {
  /** All pins */
  all: PinDefinition[];
  
  /** Digital pins */
  digital: string[];
  
  /** Analog input pins */
  analog: string[];
  
  /** PWM-capable pins */
  pwm: string[];
  
  /** I2C pins by bus */
  i2c: Record<number, { sda: string; scl: string }>;
  
  /** SPI pins by bus */
  spi: Record<number, { mosi: string; miso: string; sck: string; cs?: string }>;
  
  /** UART pins by bus */
  uart: Record<number, { tx: string; rx: string; rts?: string; cts?: string }>;
  
  /** Special pins */
  led?: string;
  button?: string;
}

/**
 * Built-in peripheral definitions
 */
interface PeripheralDefinitions {
  /** I2C controllers */
  i2c: PeripheralInstance[];
  
  /** SPI controllers */
  spi: PeripheralInstance[];
  
  /** UART controllers */
  uart: PeripheralInstance[];
  
  /** ADC controllers */
  adc: ADCDefinition[];
  
  /** DAC channels */
  dac?: DACDefinition[];
  
  /** PWM channels */
  pwm: PWMDefinition;
  
  /** USB */
  usb?: USBDefinition;
  
  /** WiFi */
  wifi?: WiFiDefinition;
  
  /** Bluetooth */
  bluetooth?: BluetoothDefinition;
  
  /** Touch sensors */
  touch?: TouchDefinition;
}

/**
 * Generic peripheral instance
 */
interface PeripheralInstance {
  /** Instance number */
  instance: number;
  
  /** Default pins */
  defaultPins: Record<string, string>;
  
  /** Alternate pin mappings */
  alternatePins?: Record<string, string[]>;
}

/**
 * ADC definition
 */
interface ADCDefinition {
  instance: number;
  channels: number;
  resolution: number;  // bits
  referenceVoltage: number;
}

/**
 * DAC definition
 */
interface DACDefinition {
  instance: number;
  resolution: number;  // bits
  pins: string[];
}

/**
 * PWM definition
 */
interface PWMDefinition {
  channels: number;
  resolution: number;  // bits
  maxFrequency: number;
}

/**
 * USB definition
 */
interface USBDefinition {
  type: 'device' | 'host' | 'otg';
  vid: string;
  pid: string;
}

/**
 * WiFi definition
 */
interface WiFiDefinition {
  type: 'wifi' | 'wifi6';
  supportsStation: boolean;
  supportsAp: boolean;
}

/**
 * Bluetooth definition
 */
interface BluetoothDefinition {
  type: 'classic' | 'ble' | 'dual';
  version: string;
}

/**
 * Touch definition
 */
interface TouchDefinition {
  channels: number;
  pins: string[];
}

/**
 * Feature flags
 */
interface FeatureFlags {
  /** Multi-core support */
  multicore: boolean;
  coreCount: number;
  
  /** Deep sleep */
  deepSleep: boolean;
  
  /** Watchdog */
  watchdog: boolean;
  
  /** External interrupts */
  externalInterrupts: boolean;
  
  /** Hardware random number generator */
  hardwareRng: boolean;
  
  /** Floating point unit */
  fpu: boolean;
}

/**
 * Build configuration
 */
interface BuildConfig {
  /** PlatformIO board ID */
  platformio?: string;
  
  /** Arduino board ID */
  arduino?: string;
  
  /** ESP-IDF target */
  espidf?: string;
  
  /** Pico SDK board */
  picoSdk?: string;
  
  /** Linker script */
  linkerScript?: string;
  
  /** Extra compiler flags */
  extraFlags?: string[];
  
  /** Define macros */
  defines?: Record<string, string>;
}
```

---

## Example: Arduino Uno Board Definition

```typescript
// src/@typecode/board-arduino-uno/index.ts

import { BoardDefinition } from '@typecode/core';

const ArduinoUno: BoardDefinition = {
  id: 'arduino-uno',
  name: 'Arduino Uno',
  vendor: 'Arduino',
  description: 'Arduino Uno Rev3 - ATmega328P',
  architecture: 'avr',
  mcu: 'ATmega328P',
  clockSpeed: 16000000,  // 16 MHz
  
  memory: {
    flash: 32768,    // 32 KB
    sram: 2048,      // 2 KB
    eeprom: 1024,    // 1 KB
  },
  
  pins: {
    all: [
      // Digital pins
      { number: 0, gpio: 0, name: 'D0', aliases: ['RX'], capabilities: { digitalInput: true, digitalOutput: true, interrupt: true, pullUp: true } },
      { number: 1, gpio: 1, name: 'D1', aliases: ['TX'], capabilities: { digitalInput: true, digitalOutput: true, interrupt: true, pullUp: true } },
      { number: 2, gpio: 2, name: 'D2', capabilities: { digitalInput: true, digitalOutput: true, interrupt: true, pullUp: true } },
      { number: 3, gpio: 3, name: 'D3', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, interrupt: true, pullUp: true } },
      { number: 4, gpio: 4, name: 'D4', capabilities: { digitalInput: true, digitalOutput: true, pullUp: true } },
      { number: 5, gpio: 5, name: 'D5', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true } },
      { number: 6, gpio: 6, name: 'D6', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true } },
      { number: 7, gpio: 7, name: 'D7', capabilities: { digitalInput: true, digitalOutput: true, pullUp: true } },
      { number: 8, gpio: 8, name: 'D8', capabilities: { digitalInput: true, digitalOutput: true, pullUp: true } },
      { number: 9, gpio: 9, name: 'D9', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true } },
      { number: 10, gpio: 10, name: 'D10', aliases: ['SS'], capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true } },
      { number: 11, gpio: 11, name: 'D11', aliases: ['MOSI'], capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true } },
      { number: 12, gpio: 12, name: 'D12', aliases: ['MISO'], capabilities: { digitalInput: true, digitalOutput: true, pullUp: true } },
      { number: 13, gpio: 13, name: 'D13', aliases: ['SCK', 'LED'], capabilities: { digitalInput: true, digitalOutput: true, pullUp: true }, onboardLed: true },
      
      // Analog pins
      { number: 14, gpio: 14, name: 'A0', capabilities: { digitalInput: true, digitalOutput: true, analogInput: true, pullUp: true } },
      { number: 15, gpio: 15, name: 'A1', capabilities: { digitalInput: true, digitalOutput: true, analogInput: true, pullUp: true } },
      { number: 16, gpio: 16, name: 'A2', capabilities: { digitalInput: true, digitalOutput: true, analogInput: true, pullUp: true } },
      { number: 17, gpio: 17, name: 'A3', capabilities: { digitalInput: true, digitalOutput: true, analogInput: true, pullUp: true } },
      { number: 18, gpio: 18, name: 'A4', aliases: ['SDA'], capabilities: { digitalInput: true, digitalOutput: true, analogInput: true, pullUp: true } },
      { number: 19, gpio: 19, name: 'A5', aliases: ['SCL'], capabilities: { digitalInput: true, digitalOutput: true, analogInput: true, pullUp: true } },
    ],
    
    digital: ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13'],
    analog: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'],
    pwm: ['D3', 'D5', 'D6', 'D9', 'D10', 'D11'],
    
    i2c: {
      0: { sda: 'A4', scl: 'A5' }
    },
    
    spi: {
      0: { mosi: 'D11', miso: 'D12', sck: 'D13', cs: 'D10' }
    },
    
    uart: {
      0: { tx: 'D1', rx: 'D0' }
    },
    
    led: 'D13'
  },
  
  peripherals: {
    i2c: [{ instance: 0, defaultPins: { sda: 'A4', scl: 'A5' } }],
    spi: [{ instance: 0, defaultPins: { mosi: 'D11', miso: 'D12', sck: 'D13', cs: 'D10' } }],
    uart: [{ instance: 0, defaultPins: { tx: 'D1', rx: 'D0' } }],
    adc: [{ instance: 0, channels: 6, resolution: 10, referenceVoltage: 5.0 }],
    pwm: { channels: 6, resolution: 8, maxFrequency: 62500 }
  },
  
  features: {
    multicore: false,
    coreCount: 1,
    deepSleep: false,
    watchdog: true,
    externalInterrupts: true,
    hardwareRng: false,
    fpu: false
  },
  
  build: {
    platformio: 'uno',
    arduino: 'arduino:avr:uno',
    extraFlags: ['-mmcu=atmega328p'],
    defines: {
      'F_CPU': '16000000UL',
      'ARDUINO': '10819',
      'ARDUINO_AVR_UNO': '1'
    }
  }
};

export default ArduinoUno;
```

---

## Example: ESP32 DevKit V1 Board Definition

```typescript
// src/@typecode/board-esp32-devkit/index.ts

import { BoardDefinition } from '@typecode/core';

const ESP32DevKitV1: BoardDefinition = {
  id: 'esp32-devkit-v1',
  name: 'ESP32 DevKit V1',
  vendor: 'Espressif',
  description: 'ESP32 Development Board - DOIT version',
  architecture: 'esp32',
  mcu: 'ESP32-WROOM-32',
  clockSpeed: 240000000,  // 240 MHz
  
  memory: {
    flash: 4194304,     // 4 MB
    sram: 532480,       // 520 KB
    eeprom: 0,          // Emulated in flash
    externalRam: 0,
    rtcMemory: 16384,   // 16 KB
  },
  
  pins: {
    all: [
      // Note: GPIO 6-11 connected to internal flash (DO NOT USE)
      { number: 0, gpio: 0, name: 'D0', capabilities: { digitalInput: true, digitalOutput: true, touch: true, pullUp: true, pullDown: true }, notes: 'Boot strap - pull low to enter bootloader' },
      { number: 1, gpio: 1, name: 'D1', aliases: ['TX0'], capabilities: { digitalInput: true, digitalOutput: true }, notes: 'TX0 - debug output at boot' },
      { number: 2, gpio: 2, name: 'D2', aliases: ['LED'], capabilities: { digitalInput: true, digitalOutput: true, touch: true, pullUp: true, pullDown: true }, onboardLed: true, notes: 'Boot strap - connected to onboard LED' },
      { number: 3, gpio: 3, name: 'D3', aliases: ['RX0'], capabilities: { digitalInput: true, digitalOutput: true, pullUp: true, pullDown: true }, notes: 'RX0' },
      { number: 4, gpio: 4, name: 'D4', capabilities: { digitalInput: true, digitalOutput: true, touch: true, pullUp: true, pullDown: true } },
      { number: 5, gpio: 5, name: 'D5', capabilities: { digitalInput: true, digitalOutput: true, pullUp: true, pullDown: true }, notes: 'Boot strap' },
      // GPIO 6-11 skipped (connected to SPI flash)
      { number: 12, gpio: 12, name: 'D12', capabilities: { digitalInput: true, digitalOutput: true, touch: true, pullUp: true, pullDown: true }, notes: 'Boot strap - sets flash voltage' },
      { number: 13, gpio: 13, name: 'D13', capabilities: { digitalInput: true, digitalOutput: true, touch: true, pullUp: true, pullDown: true } },
      { number: 14, gpio: 14, name: 'D14', capabilities: { digitalInput: true, digitalOutput: true, touch: true, pullUp: true, pullDown: true } },
      { number: 15, gpio: 15, name: 'D15', capabilities: { digitalInput: true, digitalOutput: true, touch: true, pullUp: true, pullDown: true }, notes: 'Boot strap' },
      { number: 16, gpio: 16, name: 'D16', capabilities: { digitalInput: true, digitalOutput: true, pullUp: true, pullDown: true } },
      { number: 17, gpio: 17, name: 'D17', capabilities: { digitalInput: true, digitalOutput: true, pullUp: true, pullDown: true } },
      { number: 18, gpio: 18, name: 'D18', capabilities: { digitalInput: true, digitalOutput: true, pullUp: true, pullDown: true } },
      { number: 19, gpio: 19, name: 'D19', capabilities: { digitalInput: true, digitalOutput: true, pullUp: true, pullDown: true } },
      { number: 21, gpio: 21, name: 'D21', aliases: ['SDA'], capabilities: { digitalInput: true, digitalOutput: true, pullUp: true, pullDown: true } },
      { number: 22, gpio: 22, name: 'D22', aliases: ['SCL'], capabilities: { digitalInput: true, digitalOutput: true, pullUp: true, pullDown: true } },
      { number: 23, gpio: 23, name: 'D23', capabilities: { digitalInput: true, digitalOutput: true, pullUp: true, pullDown: true } },
      { number: 25, gpio: 25, name: 'D25', aliases: ['DAC1'], capabilities: { digitalInput: true, digitalOutput: true, analogOutput: true, pullUp: true, pullDown: true } },
      { number: 26, gpio: 26, name: 'D26', aliases: ['DAC2'], capabilities: { digitalInput: true, digitalOutput: true, analogOutput: true, pullUp: true, pullDown: true } },
      { number: 27, gpio: 27, name: 'D27', capabilities: { digitalInput: true, digitalOutput: true, touch: true, pullUp: true, pullDown: true } },
      { number: 32, gpio: 32, name: 'D32', capabilities: { digitalInput: true, digitalOutput: true, touch: true, pullUp: true, pullDown: true } },
      { number: 33, gpio: 33, name: 'D33', capabilities: { digitalInput: true, digitalOutput: true, touch: true, pullUp: true, pullDown: true } },
      { number: 34, gpio: 34, name: 'D34', capabilities: { digitalInput: true }, notes: 'Input only, no pull-up/down' },
      { number: 35, gpio: 35, name: 'D35', capabilities: { digitalInput: true }, notes: 'Input only, no pull-up/down' },
      { number: 36, gpio: 36, name: 'D36', capabilities: { digitalInput: true }, notes: 'Input only, no pull-up/down' },
      { number: 39, gpio: 39, name: 'D39', capabilities: { digitalInput: true }, notes: 'Input only, no pull-up/down' },
    ],
    
    digital: ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D12', 'D13', 'D14', 'D15', 'D16', 'D17', 'D18', 'D19', 'D21', 'D22', 'D23', 'D25', 'D26', 'D27', 'D32', 'D33'],
    analog: ['D34', 'D35', 'D36', 'D39'],
    pwm: ['D0', 'D2', 'D4', 'D5', 'D12', 'D13', 'D14', 'D15', 'D16', 'D17', 'D18', 'D19', 'D21', 'D22', 'D23', 'D25', 'D26', 'D27', 'D32', 'D33'],
    
    i2c: {
      0: { sda: 'D21', scl: 'D22' }
    },
    
    spi: {
      0: { mosi: 'D23', miso: 'D19', sck: 'D18', cs: 'D5' }
    },
    
    uart: {
      0: { tx: 'D1', rx: 'D3' },
      1: { tx: 'D4', rx: 'D13' },
      2: { tx: 'D17', rx: 'D16' }
    },
    
    led: 'D2'
  },
  
  peripherals: {
    i2c: [
      { instance: 0, defaultPins: { sda: 'D21', scl: 'D22' } },
      { instance: 1, defaultPins: { sda: 'D14', scl: 'D13' }, alternatePins: { sda: ['D4', 'D16', 'D27', 'D32'], scl: ['D5', 'D17', 'D33'] } }
    ],
    spi: [
      { instance: 0, defaultPins: { mosi: 'D23', miso: 'D19', sck: 'D18', cs: 'D5' } },
      { instance: 1, defaultPins: { mosi: 'D13', miso: 'D12', sck: 'D14', cs: 'D15' } }
    ],
    uart: [
      { instance: 0, defaultPins: { tx: 'D1', rx: 'D3' } },
      { instance: 1, defaultPins: { tx: 'D4', rx: 'D13' } },
      { instance: 2, defaultPins: { tx: 'D17', rx: 'D16' } }
    ],
    adc: [
      { instance: 0, channels: 8, resolution: 12, referenceVoltage: 3.3 },
      { instance: 1, channels: 10, resolution: 12, referenceVoltage: 3.3 }
    ],
    dac: [
      { instance: 0, resolution: 8, pins: ['D25'] },
      { instance: 1, resolution: 8, pins: ['D26'] }
    ],
    pwm: { channels: 16, resolution: 16, maxFrequency: 40000000 },
    usb: { type: 'device', vid: '0x303A', pid: '0x0001' },
    wifi: { type: 'wifi', supportsStation: true, supportsAp: true },
    bluetooth: { type: 'dual', version: '4.2' },
    touch: { channels: 10, pins: ['D0', 'D2', 'D4', 'D12', 'D13', 'D14', 'D15', 'D27', 'D32', 'D33'] }
  },
  
  features: {
    multicore: true,
    coreCount: 2,
    deepSleep: true,
    watchdog: true,
    externalInterrupts: true,
    hardwareRng: true,
    fpu: true
  },
  
  build: {
    platformio: 'esp32dev',
    arduino: 'esp32:esp32:esp32',
    espidf: 'esp32',
    extraFlags: [],
    defines: {
      'ESP32': '1',
      'ARDUINO': '10819'
    }
  }
};

export default ESP32DevKitV1;
```

---

## Example: Raspberry Pi Pico Board Definition

```typescript
// src/@typecode/board-pico/index.ts

import { BoardDefinition } from '@typecode/core';

const RaspberryPiPico: BoardDefinition = {
  id: 'raspberry-pi-pico',
  name: 'Raspberry Pi Pico',
  vendor: 'Raspberry Pi',
  description: 'Raspberry Pi Pico - RP2040',
  architecture: 'rp2040',
  mcu: 'RP2040',
  clockSpeed: 133000000,  // 133 MHz (overclockable to 250 MHz)
  
  memory: {
    flash: 2097152,     // 2 MB
    sram: 264192,       // 264 KB
    eeprom: 0,          // Use flash sector
  },
  
  pins: {
    all: [
      { number: 0, gpio: 0, name: 'GP0', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 1, gpio: 1, name: 'GP1', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 2, gpio: 2, name: 'GP2', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 3, gpio: 3, name: 'GP3', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 4, gpio: 4, name: 'GP4', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 5, gpio: 5, name: 'GP5', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 6, gpio: 6, name: 'GP6', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 7, gpio: 7, name: 'GP7', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 8, gpio: 8, name: 'GP8', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 9, gpio: 9, name: 'GP9', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 10, gpio: 10, name: 'GP10', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 11, gpio: 11, name: 'GP11', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 12, gpio: 12, name: 'GP12', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 13, gpio: 13, name: 'GP13', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 14, gpio: 14, name: 'GP14', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 15, gpio: 15, name: 'GP15', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 16, gpio: 16, name: 'GP16', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 17, gpio: 17, name: 'GP17', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 18, gpio: 18, name: 'GP18', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 19, gpio: 19, name: 'GP19', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 20, gpio: 20, name: 'GP20', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 21, gpio: 21, name: 'GP21', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 22, gpio: 22, name: 'GP22', capabilities: { digitalInput: true, digitalOutput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 23, gpio: 23, name: 'GP23', capabilities: { digitalInput: true, digitalOutput: true, pullUp: true, pullDown: true }, notes: 'Not available on all boards' },
      { number: 24, gpio: 24, name: 'GP24', capabilities: { digitalInput: true, digitalOutput: true, pullUp: true, pullDown: true }, notes: 'Not available on all boards' },
      { number: 25, gpio: 25, name: 'GP25', aliases: ['LED'], capabilities: { digitalInput: true, digitalOutput: true, pullUp: true, pullDown: true }, onboardLed: true },
      // ADC pins
      { number: 26, gpio: 26, name: 'GP26', aliases: ['ADC0'], capabilities: { digitalInput: true, digitalOutput: true, analogInput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 27, gpio: 27, name: 'GP27', aliases: ['ADC1'], capabilities: { digitalInput: true, digitalOutput: true, analogInput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 28, gpio: 28, name: 'GP28', aliases: ['ADC2'], capabilities: { digitalInput: true, digitalOutput: true, analogInput: true, pwm: true, pullUp: true, pullDown: true } },
      { number: 29, gpio: 29, name: 'GP29', aliases: ['ADC3'], capabilities: { analogInput: true }, notes: 'ADC3 for internal temperature sensor' },
    ],
    
    digital: ['GP0', 'GP1', 'GP2', 'GP3', 'GP4', 'GP5', 'GP6', 'GP7', 'GP8', 'GP9', 'GP10', 'GP11', 'GP12', 'GP13', 'GP14', 'GP15', 'GP16', 'GP17', 'GP18', 'GP19', 'GP20', 'GP21', 'GP22'],
    analog: ['GP26', 'GP27', 'GP28', 'GP29'],
    pwm: ['GP0', 'GP1', 'GP2', 'GP3', 'GP4', 'GP5', 'GP6', 'GP7', 'GP8', 'GP9', 'GP10', 'GP11', 'GP12', 'GP13', 'GP14', 'GP15', 'GP16', 'GP17', 'GP18', 'GP19', 'GP20', 'GP21', 'GP22', 'GP26', 'GP27', 'GP28'],
    
    i2c: {
      0: { sda: 'GP4', scl: 'GP5' },
      1: { sda: 'GP6', scl: 'GP7' }
    },
    
    spi: {
      0: { mosi: 'GP3', miso: 'GP0', sck: 'GP2', cs: 'GP1' },
      1: { mosi: 'GP11', miso: 'GP8', sck: 'GP10', cs: 'GP9' }
    },
    
    uart: {
      0: { tx: 'GP0', rx: 'GP1' },
      1: { tx: 'GP8', rx: 'GP9' }
    },
    
    led: 'GP25'
  },
  
  peripherals: {
    i2c: [
      { instance: 0, defaultPins: { sda: 'GP4', scl: 'GP5' }, alternatePins: { sda: ['GP0', 'GP8', 'GP12', 'GP16', 'GP20'], scl: ['GP1', 'GP9', 'GP13', 'GP17', 'GP21'] } },
      { instance: 1, defaultPins: { sda: 'GP6', scl: 'GP7' }, alternatePins: { sda: ['GP2', 'GP10', 'GP14', 'GP18', 'GP22'], scl: ['GP3', 'GP11', 'GP15', 'GP19', 'GP23'] } }
    ],
    spi: [
      { instance: 0, defaultPins: { mosi: 'GP3', miso: 'GP0', sck: 'GP2', cs: 'GP1' } },
      { instance: 1, defaultPins: { mosi: 'GP11', miso: 'GP8', sck: 'GP10', cs: 'GP9' } }
    ],
    uart: [
      { instance: 0, defaultPins: { tx: 'GP0', rx: 'GP1' } },
      { instance: 1, defaultPins: { tx: 'GP8', rx: 'GP9' } }
    ],
    adc: [{ instance: 0, channels: 4, resolution: 12, referenceVoltage: 3.3 }],
    pwm: { channels: 16, resolution: 16, maxFrequency: 125000000 },
    usb: { type: 'device', vid: '0x2E8A', pid: '0x000A' }
  },
  
  features: {
    multicore: true,
    coreCount: 2,
    deepSleep: false,  // DORMANT mode available
    watchdog: true,
    externalInterrupts: true,
    hardwareRng: true,
    fpu: false  // Cortex-M0+ has no FPU
  },
  
  build: {
    platformio: 'pico',
    arduino: 'rp2040:rp2040:rpipico',
    picoSdk: 'pico',
    extraFlags: [],
    defines: {
      'PICO': '1'
    }
  }
};

export default RaspberryPiPico;
```

---

## Generated Board Exports

Each board package exports typed pin objects:

```typescript
// src/@typecode/board-arduino-uno/pins.ts

import { IDigitalPin, IPWMPin, IAnalogInput, createDigitalPin, createPWMPin, createAnalogPin } from '@typecode/core';

// Digital-only pins
export const D0: IDigitalPin = createDigitalPin(0, 0);
export const D1: IDigitalPin = createDigitalPin(1, 1);
export const D2: IDigitalPin = createDigitalPin(2, 2);

// PWM-capable pins (typed as PWMPin, allows analogWrite)
export const D3: IPWMPin = createPWMPin(3, 3);
export const D5: IPWMPin = createPWMPin(5, 5);
export const D6: IPWMPin = createPWMPin(6, 6);
export const D9: IPWMPin = createPWMPin(9, 9);
export const D10: IPWMPin = createPWMPin(10, 10);
export const D11: IPWMPin = createPWMPin(11, 11);

// Digital-only (no PWM)
export const D4: IDigitalPin = createDigitalPin(4, 4);
export const D7: IDigitalPin = createDigitalPin(7, 7);
export const D8: IDigitalPin = createDigitalPin(8, 8);
export const D12: IDigitalPin = createDigitalPin(12, 12);
export const D13: IDigitalPin = createDigitalPin(13, 13);  // LED

// Analog input pins
export const A0: IAnalogInput = createAnalogPin(14, 14);
export const A1: IAnalogInput = createAnalogPin(15, 15);
export const A2: IAnalogInput = createAnalogPin(16, 16);
export const A3: IAnalogInput = createAnalogPin(17, 17);
export const A4: IAnalogInput = createAnalogPin(18, 18);  // SDA
export const A5: IAnalogInput = createAnalogPin(19, 19);  // SCL

// Convenience aliases
export const LED = D13;
export const SDA = A4;
export const SCL = A5;
export const MOSI = D11;
export const MISO = D12;
export const SCK = D13;
export const SS = D10;
export const TX = D1;
export const RX = D0;
```

---

## Board Usage

```typescript
import { Board } from '@typecode/board-arduino-uno';

// Access pins through Board namespace
Board.LED.asOutput();
Board.D3.write(128);  // PWM - TypeScript knows D3 supports analogWrite

// This would cause a TypeScript error:
// Board.A0.write(128);  // Error: A0 is IAnalogInput, no write method

// Access peripherals
const wire = Board.I2C0;
const spi = Board.SPI0;
const serial = Board.Serial;
```

---

## Next Steps

- **[06-arch-impl-guide.md](./06-arch-impl-guide.md)** - Creating new architecture shims