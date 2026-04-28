# Board Definition Builder API

The Board Definition Builder provides a fluent, type-safe API for creating board support packages. This eliminates the need to manually construct complex board definition objects and provides compile-time validation.

## Overview

The builder pattern guides you through defining a board package step-by-step:

```typescript
import { BoardDefinitionBuilder, validateBoardDefinition } from '@typehal/core';

const board = BoardDefinitionBuilder.create('arduino-uno')
  .displayName('Arduino Uno')
  .vendor('Arduino')
  .architecture('avr')
  .withMCU('ATmega328P', 16_000_000)
  .withMemory({ flash: 32_768, sram: 2_048, eeprom: 1_024 })
  .addDigitalPins(0, 13)
  .addAnalogPins(14, 19, { prefix: 'A' })
  .addPWMPins([3, 5, 6, 9, 10, 11])
  .addInterruptPins([2, 3])
  .setLedPin(13)
  .addI2C(0, { sda: 'A4', scl: 'A5' })
  .addSPI(0, { mosi: 'D11', miso: 'D12', sck: 'D13', cs: 'D10' })
  .addUART(0, { tx: 'D1', rx: 'D0' })
  .withFQBN('arduino:avr:uno')
  .build();

// Validate the definition
const errors = validateBoardDefinition(board);
if (errors.length > 0) {
  console.error('Board definition errors:', errors);
}
```

## Builder Methods

### Board Identity

| Method | Description | Required |
|--------|-------------|----------|
| `create(id)` | Create a new builder with a unique board ID | Yes |
| `displayName(name)` | Set the human-readable board name | Recommended |
| `vendor(name)` | Set the board manufacturer | Recommended |
| `architecture(arch)` | Set the CPU architecture (`avr`, `esp32`, `rp2040`, etc.) | Yes |

### MCU Configuration

| Method | Description | Required |
|--------|-------------|----------|
| `withMCU(partNumber, clockHz)` | Set the MCU part number and clock speed in Hz | Yes |
| `withMemory(config)` | Set flash, SRAM, and EEPROM sizes in bytes | Yes |

### Pin Definitions

| Method | Description |
|--------|-------------|
| `addDigitalPins(start, end, options?)` | Add a range of digital-only pins |
| `addAnalogPins(start, end, options?)` | Add a range of analog-capable pins |
| `addPWMPins(pinNumbers[])` | Mark specific pins as PWM-capable |
| `addInterruptPins(pinNumbers[])` | Mark specific pins as interrupt-capable |
| `setLedPin(pin)` | Designate the on-board LED pin |
| `addPin(number, builder)` | Add a single pin with full customization |

### Peripheral Configuration

| Method | Description |
|--------|-------------|
| `addI2C(instance, pins)` | Add an I2C bus with SDA/SCL pins |
| `addSPI(instance, pins)` | Add an SPI bus with MOSI/MISO/SCK/CS pins |
| `addUART(instance, pins)` | Add a UART port with TX/RX pins |
| `withADC(instance, channels, resolution, refVoltage)` | Configure ADC peripheral |
| `withPeripherals(builder)` | Configure all peripherals using a callback |

### Build Configuration

| Method | Description |
|--------|-------------|
| `withFQBN(fqbn)` | Set the Arduino CLI Fully Qualified Board Name |
| `addExtraFlags(flags[])` | Add extra compiler flags |
| `addDefines(record)` | Add preprocessor defines |
| `withFeatures(flags)` | Set feature flags (multicore, FPU, etc.) |

### Finalization

| Method | Description |
|--------|-------------|
| `build()` | Build and return the `BoardDefinition` object |

## Advanced Pin Configuration

For pins that need custom capabilities or multiple functions:

```typescript
const board = BoardDefinitionBuilder.create('custom-board')
  .addPin(0, (pin) => pin
    .name('D0')
    .gpio(0)
    .capabilities((caps) => caps
      .digital()
      .interrupt()
      .pullUp()
    )
    .uart(0, 'rx')
    .alias('RX')
  )
  .addPin(13, (pin) => pin
    .name('D13')
    .capabilities((caps) => caps
      .digital()
      .pwm()
    )
    .spi(0, 'sck')
    .asLed()
  )
  .build();
```

### Pin Capability Builder

| Method | Description |
|--------|-------------|
| `digital()` | Enable digital input and output |
| `digitalInput()` | Enable digital input only |
| `digitalOutput()` | Enable digital output only |
| `analog(resolution?)` | Enable analog input |
| `analogOutput()` | Enable analog output (DAC) |
| `pwm()` | Enable PWM output |
| `interrupt()` | Enable external interrupts |
| `pullUp()` | Enable internal pull-up resistor |
| `pullDown()` | Enable internal pull-down resistor |
| `touch()` | Enable touch sensing |
| `openDrain()` | Enable open-drain output |
| `unsafe()` | Mark pin as unsafe (generates warnings when used) |

#### Unsafe Pins

Some pins have special behaviors that make them "unsafe" for general use. For example:
- **Boot strapping pins** - Pins that affect boot behavior when held high/low
- **UART TX/RX pins** - Using these will interfere with serial communication
- **JTAG/Debug pins** - Reserved for debugging purposes

Marking a pin as `unsafe()` generates a transpiler warning when the pin is used, alerting developers to potential issues while still allowing the code to compile.

```typescript
const board = BoardDefinitionBuilder.create('arduino-uno')
  .addPin(0, (pin) => pin
    .name('D0')
    .gpio(0)
    .capabilities((caps) => caps.digital().interrupt())
    .uart(0, 'rx')
    .unsafe()  // UART RX - using interferes with serial communication
  )
  .addPin(1, (pin) => pin
    .name('D1')
    .gpio(1)
    .capabilities((caps) => caps.digital().interrupt())
    .uart(0, 'tx')
    .unsafe()  // UART TX - using interferes with serial communication
  )
  .build();
```

When a user writes code that uses an unsafe pin:

```typescript
import { D0, HIGH } from '@typehal/board-arduino-uno';
D0.asOutput();
D0.write(HIGH);
```

The transpiler generates a warning:

```
warning: Pin 'D0' is marked as unsafe. Use with caution - this pin may have
special boot behavior or conflict with system functions.
```

### Pin Function Methods

| Method | Description |
|--------|-------------|
| `i2c(instance, role)` | Add I2C function (`sda` or `scl`) |
| `spi(instance, role)` | Add SPI function (`mosi`, `miso`, `sck`, or `cs`) |
| `uart(instance, role)` | Add UART function (`tx` or `rx`) |

## Validation

The `validateBoardDefinition()` function checks for common issues:

```typescript
const errors = validateBoardDefinition(board);

// Possible errors:
// - "Board ID is required"
// - "Duplicate pin number: 13"
// - "Duplicate pin name: D13"
// - "LED pin 'D13' not found in pin definitions"
// - "I2C0 SDA pin 'A4' not found"
```

### Validation Checks

- Required fields (ID, name, MCU, clock speed)
- Memory configuration (positive values)
- Pin definitions (at least one pin)
- Duplicate pin numbers and names
- LED pin exists in pin list
- Peripheral pins exist in pin definitions

## Complete Example: ESP32 DevKit

```typescript
import { BoardDefinitionBuilder, validateBoardDefinition } from '@typehal/core';

const esp32Devkit = BoardDefinitionBuilder.create('esp32-devkit-v1')
  .displayName('ESP32 DevKit V1')
  .vendor('Espressif')
  .architecture('esp32')
  .withMCU('ESP32-WROOM-32', 240_000_000)
  .withMemory({ 
    flash: 4_194_304,     // 4MB
    sram: 520_192,        // 520KB
    eeprom: 0,
    externalRam: 4_194_304, // 4MB PSRAM (optional)
  })
  .withFeatures({
    multicore: true,
    coreCount: 2,
    deepSleep: true,
    watchdog: true,
    externalInterrupts: true,
    hardwareRng: true,
    fpu: true,
  })
  // GPIO pins
  .addDigitalPins(0, 39)
  // ADC1 channels (GPIO 32-39)
  .addAnalogPins(32, 39, { prefix: 'VP', adcChannels: 0 })
  // PWM on most pins
  .addPWMPins([0, 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33])
  // Interrupts on all GPIOs
  .addInterruptPins([0, 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39])
  // Built-in LED
  .setLedPin(2)
  // I2C
  .addI2C(0, { sda: 'D21', scl: 'D22' })
  .addI2C(1, { sda: 'D25', scl: 'D26' })
  // SPI
  .addSPI(0, { mosi: 'D23', miso: 'D19', sck: 'D18', cs: 'D5' })
  // UART
  .addUART(0, { tx: 'D1', rx: 'D3' })  // USB Serial
  .addUART(1, { tx: 'D16', rx: 'D17' })
  .addUART(2, { tx: 'D4', rx: 'D25' })
  // ADC
  .withADC(0, 8, 12, 3.3)  // ADC1: 8 channels, 12-bit, 3.3V reference
  .withADC(1, 10, 12, 3.3) // ADC2: 10 channels, 12-bit, 3.3V reference
  // Arduino CLI
  .withFQBN('esp32:esp32:esp32')
  .addExtraFlags(['-DBOARD_HAS_PSRAM'])
  .build();

const errors = validateBoardDefinition(esp32Devkit);
if (errors.length > 0) {
  throw new Error(`Invalid board definition: ${errors.join(', ')}`);
}

export default esp32Devkit;
```

## Type Safety with Branded Types

The builder uses branded types to prevent common errors:

```typescript
import { pinNumber, gpioNumber } from '@typehal/core';

// PinNumber and GPIO are distinct types
const physicalPin = pinNumber(13);  // Physical pin on package
const gpio = gpioNumber(13);        // Internal GPIO index

// These cannot be accidentally mixed:
// pin.gpio(physicalPin);  // Error: wrong type
pin.gpio(gpio);           // OK
```

## Integration with Board Packages

Use the builder in your board package's `board.ts`:

```typescript
// packages/board-myboard/src/board.ts
import { BoardDefinitionBuilder, validateBoardDefinition } from '@typehal/core';

export const board = BoardDefinitionBuilder.create('myboard')
  // ... configuration
  .build();

// Validate at load time
const errors = validateBoardDefinition(board);
if (errors.length > 0) {
  throw new Error(`Invalid board: ${errors.join(', ')}`);
}

export default board;
```

## See Also

- [Board Package Guide](./development-guide.md) - Creating board packages
- [Board Usage Guide](./usage-guide.md) - Using board packages
- [Architecture Overview](../architecture/README.md) - Architecture packages