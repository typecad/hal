# Memory Decorators

## Overview

Memory decorators provide compile-time annotations that control how the transpiler places variables, classes, and data in memory. This is critical for embedded systems where memory is limited and different memory regions have different characteristics (speed, persistence, size).

---

## Memory Regions by Architecture

| Region | AVR | ESP32 | RP2040 |
|--------|-----|-------|--------|
| **Flash/Program** | 32KB (PROGMEM) | 4MB+ (SPIFFS/LittleFS) | 2MB (XIP) |
| **SRAM** | 2KB | 520KB | 264KB |
| **EEPROM** | 1KB | Emulated | Flash sector |
| **RTC Memory** | N/A | 16KB | Scratch |

---

## Source: memory/decorators.ts

```typescript
// src/@typecode/core/memory/decorators.ts

/**
 * Memory placement decorator
 * Base type for all memory decorators
 */
interface MemoryDecorator {
  /** Target memory region */
  region: MemoryRegion;
  
  /** Additional options */
  options?: MemoryOptions;
}

/**
 * Memory region enumeration
 */
enum MemoryRegion {
  /** Default SRAM placement */
  SRAM = 'sram',
  /** Flash/Program memory (read-only) */
  FLASH = 'flash',
  /** EEPROM/non-volatile storage */
  EEPROM = 'eeprom',
  /** RTC memory (ESP32 only, persists through sleep) */
  RTC = 'rtc',
  /** DMA-capable memory region */
  DMA = 'dma',
  /** External SPIRAM (ESP32-S3, etc.) */
  EXTERNAL = 'external'
}

/**
 * Memory placement options
 */
interface MemoryOptions {
  /** Alignment requirement in bytes */
  alignment?: number;
  
  /** Section name (for custom linker sections) */
  section?: string;
  
  /** Retain even if unused */
  retain?: boolean;
  
  /** Initialize to zero */
  zeroInit?: boolean;
  
  /** Prevent caching */
  noCache?: boolean;
}

/**
 * @Static - Place in static memory (global/static lifetime)
 * 
 * Transpiles to:
 * - AVR: Global/static variable
 * - ESP32: .bss or .data section
 * - RP2040: .bss or .data section
 */
function Static(): ClassDecorator & PropertyDecorator {
  return function(target: any, propertyKey?: string | symbol): any {
    // Transpiler annotation - no runtime effect
    Reflect.defineMetadata('typecode:memory', {
      region: MemoryRegion.SRAM,
      static: true
    }, target, propertyKey!);
    
    return target;
  };
}

/**
 * @ProgramMemory - Place constant data in flash memory
 * Essential for AVR to preserve limited SRAM
 * 
 * Transpiles to:
 * - AVR: PROGMEM attribute + pgm_read_*() access
 * - ESP32: const flash placement (automatic)
 * - RP2040: Flash XIP region (automatic)
 */
function ProgramMemory(): PropertyDecorator & ClassDecorator {
  return function(target: any, propertyKey?: string | symbol): any {
    Reflect.defineMetadata('typecode:memory', {
      region: MemoryRegion.FLASH,
      readonly: true
    }, target, propertyKey!);
    
    return target;
  };
}

/**
 * @Packed - Remove padding between struct members
 * Useful for wire protocols and compact storage
 * 
 * Transpiles to:
 * - C++: #pragma pack(1) or __attribute__((packed))
 */
function Packed(): ClassDecorator {
  return function<T extends {new(...args:any[]):{}}>(constructor: T): T {
    Reflect.defineMetadata('typecode:packed', true, constructor);
    return constructor;
  };
}

/**
 * @Volatile - Mark as hardware-accessed memory
 * Prevents compiler optimizations
 * 
 * Transpiles to:
 * - C++: volatile keyword
 */
function Volatile(): PropertyDecorator {
  return function(target: any, propertyKey: string | symbol): void {
    Reflect.defineMetadata('typecode:volatile', true, target, propertyKey);
  };
}

/**
 * @Aligned - Specify memory alignment
 * Required for DMA, SIMD, and certain hardware operations
 * 
 * Transpiles to:
 * - GCC: __attribute__((aligned(n)))
 * - ARM: __attribute__((aligned(n)))
 */
function Aligned(bytes: number): PropertyDecorator & ClassDecorator {
  return function(target: any, propertyKey?: string | symbol): any {
    Reflect.defineMetadata('typecode:aligned', bytes, target, propertyKey!);
    return target;
  };
}

/**
 * @DmaBuffer - Place in DMA-capable memory
 * Ensures memory is accessible by DMA controllers
 * 
 * Transpiles to:
 * - ESP32: DMA_ATTR or IRAM_ATTR
 * - RP2040: __not_in_flash (RAM-based)
 */
function DmaBuffer(size?: number): PropertyDecorator {
  return function(target: any, propertyKey: string | symbol): void {
    Reflect.defineMetadata('typecode:memory', {
      region: MemoryRegion.DMA,
      size: size,
      alignment: 32  // Cache line alignment
    }, target, propertyKey);
  };
}

/**
 * @RtcMemory - Place in RTC memory (ESP32 only)
 * Persists through deep sleep and reset
 * 
 * Transpiles to:
 * - ESP32: RTC_DATA_ATTR
 * - Others: Error or ignored
 */
function RtcMemory(): PropertyDecorator {
  return function(target: any, propertyKey: string | symbol): void {
    Reflect.defineMetadata('typecode:memory', {
      region: MemoryRegion.RTC
    }, target, propertyKey);
  };
}

/**
 * @EEPROM - Mark for EEPROM storage
 * Requires explicit read/write operations
 * 
 * Transpiles to:
 * - AVR: EEPROM library
 * - ESP32: Preferences or EEPROM emulation
 * - RP2040: Flash sector with wear leveling
 */
function EEPROM(address: number, size: number): PropertyDecorator {
  return function(target: any, propertyKey: string | symbol): void {
    Reflect.defineMetadata('typecode:eeprom', {
      address: address,
      size: size
    }, target, propertyKey);
  };
}

/**
 * @External - Place in external memory (PSRAM/SPIRAM)
 * For large buffers on boards with external RAM
 * 
 * Transpiles to:
 * - ESP32-S3: PSRAM allocation
 * - Others: Error or heap allocation
 */
function External(): PropertyDecorator {
  return function(target: any, propertyKey: string | symbol): void {
    Reflect.defineMetadata('typecode:memory', {
      region: MemoryRegion.EXTERNAL
    }, target, propertyKey);
  };
}

/**
 * @NoInit - Skip initialization
 * Variable retains value across resets (if memory not cleared)
 * 
 * Transpiles to:
 * - GCC: __attribute__((section(".noinit")))
 */
function NoInit(): PropertyDecorator {
  return function(target: any, propertyKey: string | symbol): void {
    Reflect.defineMetadata('typecode:noinit', true, target, propertyKey);
  };
}

/**
 * @Retain - Keep symbol even if unused
 * Prevents linker from removing "unused" code
 * 
 * Transpiles to:
 * - GCC: __attribute__((used))
 */
function Retain(): ClassDecorator & PropertyDecorator {
  return function(target: any, propertyKey?: string | symbol): any {
    Reflect.defineMetadata('typecode:retain', true, target, propertyKey!);
    return target;
  };
}
```

---

## Usage Examples

### PROGMEM for Lookup Tables (AVR)

**TypeScript:**
```typescript
import { ProgramMemory, Aligned } from '@typecode/core';

@ProgramMemory()
const SINE_TABLE: number[] = [
  128, 131, 134, 137, 140, 143, 146, 149,
  152, 155, 158, 162, 165, 167, 170, 173,
  // ... 256 values total
];

// Transpiler knows to use pgm_read_byte() for AVR
function getSine(index: number): number {
  return SINE_TABLE[index];  // Transpiled to: pgm_read_byte(&SINE_TABLE[index])
}
```

**Transpiled C++ (AVR):**
```cpp
#include <avr/pgmspace.h>

const PROGMEM uint8_t SINE_TABLE[] = {
  128, 131, 134, 137, 140, 143, 146, 149,
  152, 155, 158, 162, 165, 167, 170, 173,
  // ...
};

uint8_t getSine(uint8_t index) {
  return pgm_read_byte(&SINE_TABLE[index]);
}
```

### Packed Struct for Protocol

**TypeScript:**
```typescript
import { Packed, Static, ProgramMemory } from '@typecode/core';

@Packed()
@Static()
class SensorPacket {
  header: number;      // 1 byte
  temperature: number; // 2 bytes
  humidity: number;    // 2 bytes
  checksum: number;    // 1 byte
  // Total: 6 bytes (no padding)
}

// Array of packets in program memory
@ProgramMemory()
const PACKETS: SensorPacket[] = [
  { header: 0xAA, temperature: 2500, humidity: 6000, checksum: 0x55 },
  // ...
];
```

**Transpiled C++:**
```cpp
#include <stdint.h>

#pragma pack(push, 1)
typedef struct {
  uint8_t header;
  int16_t temperature;
  int16_t humidity;
  uint8_t checksum;
} SensorPacket;
#pragma pack(pop)

const PROGMEM SensorPacket PACKETS[] = {
  {0xAA, 2500, 6000, 0x55},
  // ...
};
```

### DMA Buffer for SPI Display

**TypeScript:**
```typescript
import { DmaBuffer, Aligned } from '@typecode/core';

class DisplayDriver {
  // 16KB DMA buffer, 32-byte aligned for cache efficiency
  @DmaBuffer(16384)
  @Aligned(32)
  private frameBuffer: Uint8Array;
  
  constructor() {
    this.frameBuffer = new Uint8Array(16384);
  }
  
  async flush(): Promise<void> {
    // DMA transfer automatically uses this buffer
    await this.spi.write(this.frameBuffer);
  }
}
```

**Transpiled C++ (ESP32):**
```cpp
#include <esp_heap_caps.h>
#include <driver/spi_master.h>

class DisplayDriver {
private:
  DMA_ATTR uint8_t frameBuffer[16384] __attribute__((aligned(32)));
  
public:
  DisplayDriver() {
    // Buffer is already in DMA-capable memory
  }
  
  void flush() {
    // DMA transfer can use this buffer directly
    spi_transaction_t trans = {};
    trans.tx_buffer = this->frameBuffer;
    spi_device_transmit(spi_handle, &trans);
  }
};
```

### RTC Memory for Deep Sleep (ESP32)

**TypeScript:**
```typescript
import { RtcMemory } from '@typecode/core';

class DeepSleepManager {
  @RtcMemory()
  private bootCount: number;
  
  @RtcMemory()
  private lastSensorReading: number;
  
  constructor() {
    // First boot - initialize
    if (this.bootCount === 0 || this.bootCount === undefined) {
      this.bootCount = 1;
      this.lastSensorReading = 0;
    }
  }
  
  async run(): Promise<void> {
    console.log(`Boot #${this.bootCount}`);
    this.bootCount++;
    
    const reading = await readSensor();
    this.lastSensorReading = reading;
    
    // Sleep for 60 seconds
    deepSleep(60000);
  }
}
```

**Transpiled C++ (ESP32):**
```cpp
#include <esp_sleep.h>

RTC_DATA_ATTR int bootCount = 0;
RTC_DATA_ATTR int lastSensorReading = 0;

class DeepSleepManager {
public:
  DeepSleepManager() {
    if (bootCount == 0) {
      bootCount = 1;
      lastSensorReading = 0;
    }
  }
  
  void run() {
    Serial.printf("Boot #%d\n", bootCount);
    bootCount++;
    
    int reading = readSensor();
    lastSensorReading = reading;
    
    esp_sleep_enable_timer_wakeup(60 * 1000000ULL);
    esp_deep_sleep_start();
  }
};
```

### EEPROM Configuration Storage

**TypeScript:**
```typescript
import { EEPROM } from '@typecode/core';

class Configuration {
  @EEPROM(0, 1)
  magic: number;
  
  @EEPROM(1, 1)
  brightness: number;
  
  @EEPROM(2, 4)
  sampleRate: number;
  
  @EEPROM(6, 32)
  deviceName: string;
  
  load(): void {
    this.magic = EEPROM.read(0);
    this.brightness = EEPROM.read(1);
    this.sampleRate = EEPROM.readU32(2);
    this.deviceName = EEPROM.readString(6, 32);
  }
  
  save(): void {
    EEPROM.write(0, this.magic);
    EEPROM.write(1, this.brightness);
    EEPROM.writeU32(2, this.sampleRate);
    EEPROM.writeString(6, this.deviceName);
    EEPROM.commit();
  }
}
```

**Transpiled C++ (AVR):**
```cpp
#include <EEPROM.h>

class Configuration {
public:
  uint8_t magic;
  uint8_t brightness;
  uint32_t sampleRate;
  String deviceName;
  
  void load() {
    magic = EEPROM.read(0);
    brightness = EEPROM.read(1);
    EEPROM.get(2, sampleRate);
    
    char nameBuf[33];
    for (int i = 0; i < 32; i++) {
      nameBuf[i] = EEPROM.read(6 + i);
    }
    nameBuf[32] = '\0';
    deviceName = String(nameBuf);
  }
  
  void save() {
    EEPROM.write(0, magic);
    EEPROM.write(1, brightness);
    EEPROM.put(2, sampleRate);
    
    for (int i = 0; i < 32; i++) {
      EEPROM.write(6 + i, deviceName[i]);
    }
  }
};
```

### Volatile for Hardware Register Access

**TypeScript:**
```typescript
import { Volatile, Aligned, Static } from '@typecode/core';

@Static()
@Aligned(4)
class HardwareRegisters {
  @Volatile()
  control: number;
  
  @Volatile()
  status: number;
  
  @Volatile()
  data: number;
  
  @Volatile()
  interruptFlags: number;
  
  waitReady(): void {
    while ((this.status & 0x01) === 0) {
      // Wait for ready bit
    }
  }
  
  writeData(value: number): void {
    this.waitReady();
    this.data = value;
    this.control |= 0x80;  // Trigger write
  }
}

// Memory-mapped at specific address
const UART_REGS = new HardwareRegisters(0x40000000);
```

**Transpiled C++:**
```cpp
#include <stdint.h>

typedef struct __attribute__((aligned(4))) {
  volatile uint32_t control;
  volatile uint32_t status;
  volatile uint32_t data;
  volatile uint32_t interruptFlags;
} HardwareRegisters;

HardwareRegisters* const UART_REGS = (HardwareRegisters*)0x40000000;

void waitReady() {
  while ((UART_REGS->status & 0x01) == 0) {
    // Wait for ready bit
  }
}

void writeData(uint32_t value) {
  waitReady();
  UART_REGS->data = value;
  UART_REGS->control |= 0x80;
}
```

---

## Memory Analysis at Compile Time

The transpiler analyzes memory usage and reports:

```typescript
// typecode.config.ts
export default {
  target: 'avr',
  memory: {
    reportUsage: true,
    warnThreshold: 0.8  // Warn at 80% SRAM usage
  }
};
```

**Transpiler Output:**
```
Memory Analysis:
┌─────────────────────────────────────────────────────────────┐
│ Region    │ Used     │ Total    │ Usage  │ Status          │
├─────────────────────────────────────────────────────────────┤
│ SRAM      │ 1,542 B  │ 2,048 B  │ 75.3%  │ ⚠️ Warning      │
│ Flash     │ 18,432 B │ 32,768 B │ 56.2%  │ ✓ OK           │
│ EEPROM    │ 64 B     │ 1,024 B  │ 6.3%   │ ✓ OK           │
└─────────────────────────────────────────────────────────────┘

Recommendations:
- Consider using @ProgramMemory() for SINE_TABLE (512 B saved)
- Reduce UART_RX_BUFFER from 256 to 128 (128 B saved)
```

---

## Buffer Types

```typescript
// src/@typecode/core/memory/buffer.ts

/**
 * Fixed-size buffer (stack allocation)
 * Preferred over dynamic arrays for embedded
 */
@Packed()
class FixedBuffer<T> {
  private data: T[];
  readonly length: number;
  
  constructor(length: number) {
    this.length = length;
    this.data = new Array<T>(length);
  }
  
  get(index: number): T {
    return this.data[index];
  }
  
  set(index: number, value: T): void {
    this.data[index] = value;
  }
  
  fill(value: T): void {
    this.data.fill(value);
  }
  
  copyFrom(source: T[], offset?: number): void {
    for (let i = 0; i < Math.min(source.length, this.length - (offset ?? 0)); i++) {
      this.data[(offset ?? 0) + i] = source[i];
    }
  }
}

/**
 * Circular buffer for streaming data
 */
@Static()
class CircularBuffer {
  private buffer: Uint8Array;
  private head: number = 0;
  private tail: number = 0;
  private count: number = 0;
  
  constructor(size: number) {
    this.buffer = new Uint8Array(size);
  }
  
  write(data: Uint8Array): number {
    let written = 0;
    for (const byte of data) {
      if (this.count === this.buffer.length) break;
      this.buffer[this.head] = byte;
      this.head = (this.head + 1) % this.buffer.length;
      this.count++;
      written++;
    }
    return written;
  }
  
  read(length: number): Uint8Array {
    const result = new Uint8Array(Math.min(length, this.count));
    for (let i = 0; i < result.length; i++) {
      result[i] = this.buffer[this.tail];
      this.tail = (this.tail + 1) % this.buffer.length;
      this.count--;
    }
    return result;
  }
  
  get available(): number {
    return this.count;
  }
  
  get free(): number {
    return this.buffer.length - this.count;
  }
  
  peek(): number | undefined {
    if (this.count === 0) return undefined;
    return this.buffer[this.tail];
  }
  
  clear(): void {
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }
}

/**
 * Pool allocator for fixed-size objects
 * Avoids heap fragmentation
 */
class ObjectPool {
  private pool: any[];
  private available: number[];
  
  constructor(private factory: () => any, size: number) {
    this.pool = new Array(size);
    this.available = new Array(size);
    
    for (let i = 0; i < size; i++) {
      this.pool[i] = factory();
      this.available[i] = i;
    }
  }
  
  acquire(): any | null {
    if (this.available.length === 0) return null;
    const index = this.available.pop()!;
    return this.pool[index];
  }
  
  release(obj: any): void {
    const index = this.pool.indexOf(obj);
    if (index >= 0 && !this.available.includes(index)) {
      this.available.push(index);
    }
  }
}
```

---

## Next Steps

- **[05-board-definitions.md](./05-board-definitions.md)** - Board manifest format
- **[06-arch-impl-guide.md](./06-arch-impl-guide.md)** - Creating new architecture shims