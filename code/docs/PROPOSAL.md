# typeCode: Detailed Implementation Proposal

## The Type-Safe, Architecture-Agnostic Firmware Framework

**typeCode** is a transpiler-based framework and SDK that enables developers to write embedded firmware in TypeScript. It generates optimized C++ for Arduino, ESP32, and RP2040 architectures, enforcing hardware constraints at compile-time and unifying the fragmented embedded ecosystem under a single, modern toolchain.

---

## Document Index

This proposal is organized into the following documents:

### Core Documentation

| Document | Description |
|----------|-------------|
| **[00-overview.md](./00-overview.md)** | Architecture overview, module structure, and design principles |
| **[01-pin-types.md](./01-pin-types.md)** | Pin type hierarchy, capabilities, and compile-time validation |
| **[02-bus-interfaces.md](./02-bus-interfaces.md)** | I2C, SPI, UART interfaces with architecture-specific implementations |
| **[03-concurrency.md](./03-concurrency.md)** | Scheduler, tasks, locks, and multi-core abstractions |
| **[04-memory-decorators.md](./04-memory-decorators.md)** | Memory placement control with @ProgramMemory, @Packed, @DmaBuffer, etc. |
| **[05-board-definitions.md](./05-board-definitions.md)** | Board manifest format with Arduino Uno, ESP32, and RP2040 examples |

---

## Quick Reference

### Package Structure

```
@typecode/
├── core/                 # Abstract interfaces and base types
│   ├── pin/             # Pin types and capabilities
│   ├── bus/             # I2C, SPI, UART interfaces
│   ├── concurrency/     # Scheduler, Task, Lock primitives
│   └── memory/          # Decorators and buffer types
│
├── arch-avr/            # Arduino AVR implementation
├── arch-esp32/          # ESP32/FreeRTOS implementation
├── arch-rp2040/         # RP2040/Pico SDK implementation
│
├── board-arduino-uno/   # Arduino Uno board package
├── board-esp32-devkit/  # ESP32 DevKit board package
└── board-pico/          # Raspberry Pi Pico board package
```

### Core Type Hierarchy

```
IPin (base)
├── IDigitalPin
│   ├── IInputPin
│   └── IOutputPin
├── IAnalogInput
├── IPWMPin
└── IInterruptPin
```

### Key Features by Architecture

| Feature | AVR | ESP32 | RP2040 |
|---------|-----|-------|--------|
| **Digital I/O** | ✓ | ✓ | ✓ |
| **Analog Input** | 10-bit | 12-bit | 12-bit |
| **PWM** | 8-bit, 6 pins | 16-bit, 16 ch | 16-bit, all GPIO |
| **I2C** | 1 bus | 2 buses | 2 buses |
| **SPI** | 1 bus | 2 buses | 2 buses |
| **UART** | 1 | 3 | 2 |
| **Multi-core** | ✗ | 2 cores | 2 cores |
| **RTOS** | Cooperative | FreeRTOS | Cooperative |
| **WiFi** | ✗ | ✓ | ✗ |
| **Bluetooth** | ✗ | ✓ | ✗ |
| **USB** | ✗ | Device | Device |

---

## Example: Complete typeCode Project

### Project Configuration

```typescript
// typecode.config.ts
import { defineConfig } from '@typecode/cli';

export default defineConfig({
  // Target board
  board: '@typecode/board-esp32-devkit',
  
  // Entry point
  entry: 'src/main.ts',
  
  // Output directory
  output: 'dist',
  
  // Build options
  build: {
    optimize: true,
    sourceMap: true,
    memoryReport: true
  },
  
  // Transpiler options
  transpile: {
    // Generate Arduino-compatible output
    arduino: true,
    // Include debug symbols
    debug: process.env.NODE_ENV !== 'production'
  }
});
```

### Main Application

```typescript
// src/main.ts
import { Board } from '@typecode/board-esp32-devkit';
import { Task, Scheduler, Lock } from '@typecode/core';
import { ProgramMemory, RtcMemory } from '@typecode/core';

// Lookup table in flash memory (saves RAM)
@ProgramMemory()
const LOG_TABLE: number[] = [
  /* 256 values */
];

// Persistent data across deep sleep
@RtcMemory()
let bootCount: number = 0;

// Shared sensor data protected by mutex
interface SensorData {
  temperature: number;
  humidity: number;
  timestamp: number;
}

const sensorData: SensorData = { temperature: 0, humidity: 0, timestamp: 0 };
const dataLock = Lock.createMutex('sensor_data');

// I2C Sensor driver (architecture-agnostic)
class BME280Driver {
  constructor(private bus: II2CBus) {}
  
  async read(): Promise<{ temp: number; humidity: number }> {
    const tempData = await this.bus.readThenRead(0x77, new Uint8Array([0xFA]), 3);
    const humData = await this.bus.readThenRead(0x77, new Uint8Array([0xFD]), 2);
    
    return {
      temp: this.parseTemp(tempData),
      humidity: this.parseHumidity(humData)
    };
  }
  
  private parseTemp(data: Uint8Array): number {
    const raw = (data[0] << 12) | (data[1] << 4) | (data[2] >> 4);
    return raw / 5120.0;
  }
  
  private parseHumidity(data: Uint8Array): number {
    const raw = (data[0] << 8) | data[1];
    return raw / 1024.0;
  }
}

// Initialize hardware
const sensor = new BME280Driver(Board.I2C0);

// Sensor reading task (runs on Core 1)
Task.create({
  name: 'sensor_reader',
  run: async function readSensorTask() {
    while (true) {
      const reading = await sensor.read();
      
      await dataLock.withLock(async () => {
        sensorData.temperature = reading.temp;
        sensorData.humidity = reading.humidity;
        sensorData.timestamp = Scheduler.getMillis();
      });
      
      await Task.sleep(5000);  // Read every 5 seconds
    }
  },
  stackSize: 4096
}, { core: 1 });

// LED indicator task (runs on Core 0)
Task.createPeriodic('led_blink', function blinkTask() {
  Board.LED.toggle();
}, 1000);

// Main entry point
async function setup() {
  console.log(`Boot #${++bootCount}`);
  
  // Initialize I2C
  await Board.I2C0.initialize({
    speed: 100000,
    sda: 21,
    scl: 22
  });
  
  // Start scheduler
  Scheduler.start();
}

// Transpiler generates:
// void setup() { ... }
// void loop() { scheduler_run(); }
```

### Transpiled Output (ESP32)

```cpp
// main.cpp
#include <Arduino.h>
#include <Wire.h>
#include <esp_sleep.h>

// RTC memory
RTC_DATA_ATTR int bootCount = 0;

// Mutex
SemaphoreHandle_t dataMutex;

// Sensor data structure
typedef struct {
  float temperature;
  float humidity;
  uint32_t timestamp;
} SensorData;

SensorData sensorData;

// Log table in flash
const uint8_t LOG_TABLE[] PROGMEM = { /* ... */ };

// BME280 driver
class BME280Driver {
private:
  TwoWire* wire;
  
public:
  BME280Driver(TwoWire* bus) : wire(bus) {}
  
  void read(float* temp, float* humidity) {
    wire->beginTransmission(0x77);
    wire->write(0xFA);
    wire->endTransmission();
    
    wire->requestFrom(0x77, 3);
    uint8_t tempData[3];
    for (int i = 0; i < 3; i++) {
      tempData[i] = wire->read();
    }
    
    // Parse temperature...
    *temp = parseTemp(tempData);
    
    // Read humidity similarly...
  }
};

BME280Driver sensor(&Wire);

// Sensor task (Core 1)
void sensorTask(void* parameter) {
  while (true) {
    float temp, hum;
    sensor.read(&temp, &hum);
    
    if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
      sensorData.temperature = temp;
      sensorData.humidity = hum;
      sensorData.timestamp = millis();
      xSemaphoreGive(dataMutex);
    }
    
    vTaskDelay(pdMS_TO_TICKS(5000));
  }
}

// LED blink timer
void blinkTimer() {
  digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
}

void setup() {
  Serial.begin(115200);
  Serial.printf("Boot #%d\n", ++bootCount);
  
  // Create mutex
  dataMutex = xSemaphoreCreateMutex();
  
  // Initialize I2C
  Wire.begin(21, 22, 100000);
  
  // Create sensor task on Core 1
  xTaskCreatePinnedToCore(
    sensorTask,
    "sensor_reader",
    4096 / 4,
    NULL,
    2,
    NULL,
    1
  );
  
  // LED as output
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  blinkTimer();
  vTaskDelay(pdMS_TO_TICKS(1000));
  
  // Print sensor data
  if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
    Serial.printf("Temp: %.1f°C, Humidity: %.1f%%\n",
                  sensorData.temperature,
                  sensorData.humidity);
    xSemaphoreGive(dataMutex);
  }
}
```

---

## Key Benefits Demonstrated

### 1. Hardware as Types
The `Board` object exports typed pins. If you try to call `analogWrite()` on `Board.A0` (an `IAnalogInput`), TypeScript rejects it at compile time.

### 2. Architecture-Agnostic Drivers
The `BME280Driver` accepts any `II2CBus` - it works identically on ESP32, RP2040, or Arduino Uno without modification.

### 3. Automatic Memory Optimization
The `@ProgramMemory` decorator moves the lookup table to flash, saving precious RAM on constrained devices.

### 4. Multi-Core Made Simple
`Task.create({ core: 1 })` automatically generates the correct FreeRTOS call for ESP32 dual-core execution.

### 5. Persistent State
`@RtcMemory` ensures `bootCount` survives deep sleep on ESP32 without manual NVS handling.

---

## Implementation Roadmap

### Phase 1: Core SDK
- [ ] Pin type system with full capability validation
- [ ] I2C, SPI, UART interfaces
- [ ] Basic scheduler for cooperative multitasking
- [ ] Memory decorators

### Phase 2: Architecture Shims
- [ ] AVR (Arduino Uno) implementation
- [ ] ESP32 (FreeRTOS) implementation
- [ ] RP2040 (Pico SDK) implementation

### Phase 3: Board Packages
- [ ] Arduino Uno board definition
- [ ] ESP32 DevKit board definition
- [ ] Raspberry Pi Pico board definition

### Phase 4: Transpiler
- [ ] TypeScript AST parser
- [ ] C++ code generator
- [ ] PlatformIO integration
- [ ] Arduino IDE compatibility

### Phase 5: Tooling
- [ ] VS Code extension
- [ ] Type checking and linting
- [ ] Memory usage analyzer
- [ ] Hardware simulation mode

---

## Contact & Resources

- **Documentation:** [typecode.net](https://typecode.net)
- **GitHub:** [github.com/typecad/typecode](https://github.com/typecad/typecode)
- **typeCAD Integration:** [typecad.net](https://typecad.net)