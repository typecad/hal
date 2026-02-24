# Bus Interfaces

## Overview

Bus interfaces provide standardized APIs for communication peripherals (I2C, SPI, UART). These interfaces enable writing architecture-agnostic drivers that work across any supported hardware platform.

---

## Interface Design Principles

1. **Promise-based async API** - All bus operations return Promises for non-blocking behavior
2. **Buffer-oriented** - Data transfer uses `Uint8Array` for binary safety
3. **Error propagation** - Bus errors surface as exceptions with context
4. **Resource management** - Interfaces handle peripheral lifecycle

---

## Source: bus/i2c.ts

```typescript
// src/@typecode/core/bus/i2c.ts

/**
 * I2C Address type (7-bit or 10-bit)
 */
type I2CAddress = number;

/**
 * I2C Clock Speed presets
 */
enum I2CSpeed {
  /** 100 kHz - Standard Mode */
  STANDARD = 100000,
  /** 400 kHz - Fast Mode */
  FAST = 400000,
  /** 1 MHz - Fast Mode Plus */
  FAST_PLUS = 1000000,
  /** 3.4 MHz - High Speed Mode */
  HIGH_SPEED = 3400000
}

/**
 * I2C Bus Configuration
 */
interface I2CConfig {
  /** Clock speed in Hz */
  speed: I2CSpeed | number;
  
  /** SDA pin (architecture-specific) */
  sda?: number;
  
  /** SCL pin (architecture-specific) */
  scl?: number;
  
  /** Enable internal pull-ups (if available) */
  pullUp?: boolean;
  
  /** Timeout in milliseconds */
  timeout?: number;
  
  /** Bus number (for multi-bus architectures) */
  bus?: number;
}

/**
 * I2C Error types
 */
class I2CError extends Error {
  constructor(
    message: string,
    public address: I2CAddress,
    public bus: number
  ) {
    super(message);
    this.name = 'I2CError';
  }
}

class I2CNackError extends I2CError {
  constructor(address: I2CAddress, bus: number) {
    super(`NACK received from address 0x${address.toString(16)}`, address, bus);
    this.name = 'I2CNackError';
  }
}

class I2CTimeoutError extends I2CError {
  constructor(address: I2CAddress, bus: number) {
    super(`Timeout communicating with address 0x${address.toString(16)}`, address, bus);
    this.name = 'I2CTimeoutError';
  }
}

class I2CArbitrationLostError extends I2CError {
  constructor(bus: number) {
    super(`Arbitration lost on bus ${bus}`, 0, bus);
    this.name = 'I2CArbitrationLostError';
  }
}

/**
 * I2C Bus Interface
 * Abstracts I2C communication across architectures
 */
interface II2CBus {
  /** Bus number identifier */
  readonly busNumber: number;
  
  /** Current clock speed */
  readonly speed: number;
  
  /** Whether the bus is initialized */
  readonly isInitialized: boolean;
  
  /**
   * Initialize the I2C bus
   * Must be called before any transactions
   */
  initialize(config: I2CConfig): Promise<void>;
  
  /**
   * Deinitialize the bus and release resources
   */
  deinitialize(): void;
  
  /**
   * Scan the bus for devices
   * Returns array of addresses that responded
   */
  scan(): Promise<I2CAddress[]>;
  
  /**
   * Check if a device is present at address
   */
  ping(address: I2CAddress): Promise<boolean>;
  
  /**
   * Write data to a device
   * @param address - 7-bit device address
   * @param data - Data to write
   */
  write(address: I2CAddress, data: Uint8Array): Promise<void>;
  
  /**
   * Read data from a device
   * @param address - 7-bit device address
   * @param length - Number of bytes to read
   * @returns Received data
   */
  read(address: I2CAddress, length: number): Promise<Uint8Array>;
  
  /**
   * Write then read (combined transaction)
   * Common pattern for register-based devices
   * @param address - 7-bit device address
   * @param writeData - Data to write (typically register address)
   * @param readLength - Number of bytes to read
   */
  writeThenRead(
    address: I2CAddress,
    writeData: Uint8Array,
    readLength: number
  ): Promise<Uint8Array>;
  
  /**
   * Read from a specific register
   * Convenience method for register-based devices
   * @param address - 7-bit device address
   * @param register - Register address
   * @param buffer - Buffer to fill with read data
   */
  readRegister(
    address: I2CAddress,
    register: number,
    buffer: Uint8Array
  ): Promise<number>;
  
  /**
   * Write to a specific register
   * @param address - 7-bit device address
   * @param register - Register address
   * @param data - Data to write
   */
  writeRegister(
    address: I2CAddress,
    register: number,
    data: Uint8Array
  ): Promise<void>;
  
  /**
   * Read a single byte from a register
   */
  readByte(address: I2CAddress, register: number): Promise<number>;
  
  /**
   * Write a single byte to a register
   */
  writeByte(address: I2CAddress, register: number, value: number): Promise<void>;
  
  /**
   * Read a 16-bit word from a register
   * @param littleEndian - If true, LSB first (default: false)
   */
  readWord(
    address: I2CAddress,
    register: number,
    littleEndian?: boolean
  ): Promise<number>;
  
  /**
   * Write a 16-bit word to a register
   */
  writeWord(
    address: I2CAddress,
    register: number,
    value: number,
    littleEndian?: boolean
  ): Promise<void>;
  
  /**
   * Set bus clock speed
   */
  setSpeed(speed: I2CSpeed | number): void;
  
  /**
   * Get current speed setting
   */
  getSpeed(): number;
}

/**
 * I2C Device abstraction
 * Provides a simplified interface for a specific I2C device
 */
interface II2CDevice {
  /** Device address */
  readonly address: I2CAddress;
  
  /** Connected bus */
  readonly bus: II2CBus;
  
  /**
   * Read from register
   */
  read(register: number, length: number): Promise<Uint8Array>;
  
  /**
   * Write to register
   */
  write(register: number, data: Uint8Array): Promise<void>;
  
  /**
   * Read single byte
   */
  readByte(register: number): Promise<number>;
  
  /**
   * Write single byte
   */
  writeByte(register: number, value: number): Promise<void>;
  
  /**
   * Update bits in a register (read-modify-write)
   * @param register - Register address
   * @param mask - Bits to modify
   * @param value - New bit values (shifted to correct position)
   */
  updateBits(register: number, mask: number, value: number): Promise<void>;
}

/**
 * Factory for creating I2C devices
 */
function createI2CDevice(bus: II2CBus, address: I2CAddress): II2CDevice {
  return {
    address: address,
    bus: bus,
    
    async read(register: number, length: number): Promise<Uint8Array> {
      const buffer = new Uint8Array(length);
      await bus.readRegister(address, register, buffer);
      return buffer;
    },
    
    async write(register: number, data: Uint8Array): Promise<void> {
      const combined = new Uint8Array(1 + data.length);
      combined[0] = register;
      combined.set(data, 1);
      await bus.write(address, combined);
    },
    
    async readByte(register: number): Promise<number> {
      return bus.readByte(address, register);
    },
    
    async writeByte(register: number, value: number): Promise<void> {
      await bus.writeByte(address, register, value);
    },
    
    async updateBits(register: number, mask: number, value: number): Promise<void> {
      const current = await bus.readByte(address, register);
      const updated = (current & ~mask) | (value & mask);
      await bus.writeByte(address, register, updated);
    }
  };
}
```

---

## Source: bus/spi.ts

```typescript
// src/@typecode/core/bus/spi.ts

/**
 * SPI Clock Polarity (CPOL)
 */
enum SPIClockPolarity {
  /** Clock idle low */
  LOW = 0,
  /** Clock idle high */
  HIGH = 1
}

/**
 * SPI Clock Phase (CPHA)
 */
enum SPIClockPhase {
  /** Sample on leading edge */
  LEADING = 0,
  /** Sample on trailing edge */
  TRAILING = 1
}

/**
 * SPI Bit Order
 */
enum SPIBitOrder {
  /** Most significant bit first */
  MSB = 0,
  /** Least significant bit first */
  LSB = 1
}

/**
 * SPI Mode (combines CPOL and CPHA)
 */
enum SPIMode {
  /** Mode 0: CPOL=0, CPHA=0 */
  MODE_0 = 0,
  /** Mode 1: CPOL=0, CPHA=1 */
  MODE_1 = 1,
  /** Mode 2: CPOL=1, CPHA=0 */
  MODE_2 = 2,
  /** Mode 3: CPOL=1, CPHA=1 */
  MODE_3 = 3
}

/**
 * SPI Bus Configuration
 */
interface SPIConfig {
  /** Clock frequency in Hz */
  frequency: number;
  
  /** SPI Mode */
  mode?: SPIMode;
  
  /** Clock polarity (if not using mode) */
  cpol?: SPIClockPolarity;
  
  /** Clock phase (if not using mode) */
  cpha?: SPIClockPhase;
  
  /** Bit order */
  bitOrder?: SPIBitOrder;
  
  /** Data frame size in bits (8 or 16) */
  dataBits?: 8 | 16;
  
  /** Chip Select pin (optional, for hardware CS) */
  csPin?: number;
  
  /** SCK pin */
  sckPin?: number;
  
  /** MOSI pin (Master Out Slave In) */
  mosiPin?: number;
  
  /** MISO pin (Master In Slave Out) */
  misoPin?: number;
  
  /** Bus number (for multi-bus architectures) */
  bus?: number;
}

/**
 * SPI Transfer Options (per-transfer)
 */
interface SPITransferOptions {
  /** Chip Select pin for this transfer */
  csPin?: number;
  
  /** Override frequency for this transfer */
  frequency?: number;
  
  /** CS active before transfer (microseconds) */
  csSetupTime?: number;
  
  /** CS hold after transfer (microseconds) */
  csHoldTime?: number;
  
  /** Keep CS active after transfer (for continued transfers) */
  keepCsActive?: boolean;
}

/**
 * SPI Error types
 */
class SPIError extends Error {
  constructor(message: string, public bus: number) {
    super(message);
    this.name = 'SPIError';
  }
}

class SPITimeoutError extends SPIError {
  constructor(bus: number) {
    super(`SPI transfer timeout on bus ${bus}`, bus);
    this.name = 'SPITimeoutError';
  }
}

/**
 * SPI Bus Interface
 * Full-duplex serial communication
 */
interface ISPIBus {
  /** Bus number identifier */
  readonly busNumber: number;
  
  /** Current clock frequency */
  readonly frequency: number;
  
  /** Current SPI mode */
  readonly mode: SPIMode;
  
  /** Whether the bus is initialized */
  readonly isInitialized: boolean;
  
  /**
   * Initialize the SPI bus
   */
  initialize(config: SPIConfig): Promise<void>;
  
  /**
   * Deinitialize and release resources
   */
  deinitialize(): void;
  
  /**
   * Full-duplex transfer
   * Simultaneously send and receive data
   * @param txData - Data to transmit
   * @param options - Transfer options
   * @returns Received data
   */
  transfer(
    txData: Uint8Array,
    options?: SPITransferOptions
  ): Promise<Uint8Array>;
  
  /**
   * Write-only transfer
   * @param data - Data to write
   * @param options - Transfer options
   */
  write(data: Uint8Array, options?: SPITransferOptions): Promise<void>;
  
  /**
   * Read-only transfer
   * Sends dummy bytes (0xFF) while reading
   * @param length - Number of bytes to read
   * @param options - Transfer options
   */
  read(length: number, options?: SPITransferOptions): Promise<Uint8Array>;
  
  /**
   * Write to a register
   * @param csPin - Chip select pin
   * @param register - Register address
   * @param data - Data to write
   */
  writeRegister(
    csPin: number,
    register: number,
    data: Uint8Array
  ): Promise<void>;
  
  /**
   * Read from a register
   * @param csPin - Chip select pin
   * @param register - Register address
   * @param length - Number of bytes to read
   */
  readRegister(
    csPin: number,
    register: number,
    length: number
  ): Promise<Uint8Array>;
  
  /**
   * Set clock frequency
   */
  setFrequency(hz: number): void;
  
  /**
   * Set SPI mode
   */
  setMode(mode: SPIMode): void;
  
  /**
   * Set bit order
   */
  setBitOrder(order: SPIBitOrder): void;
}

/**
 * SPI Device abstraction
 * Represents a specific device on the SPI bus
 */
interface ISPIDevice {
  /** Chip Select pin for this device */
  readonly csPin: number;
  
  /** Connected bus */
  readonly bus: ISPIBus;
  
  /**
   * Full-duplex transfer
   */
  transfer(txData: Uint8Array): Promise<Uint8Array>;
  
  /**
   * Write data
   */
  write(data: Uint8Array): Promise<void>;
  
  /**
   * Read data
   */
  read(length: number): Promise<Uint8Array>;
  
  /**
   * Read from register
   */
  readRegister(register: number, length: number): Promise<Uint8Array>;
  
  /**
   * Write to register
   */
  writeRegister(register: number, data: Uint8Array): Promise<void>;
  
  /**
   * Read single byte from register
   */
  readByte(register: number): Promise<number>;
  
  /**
   * Write single byte to register
   */
  writeByte(register: number, value: number): Promise<void>;
}

/**
 * Factory for creating SPI devices
 */
function createSPIDevice(bus: ISPIBus, csPin: number): ISPIDevice {
  return {
    csPin: csPin,
    bus: bus,
    
    async transfer(txData: Uint8Array): Promise<Uint8Array> {
      return bus.transfer(txData, { csPin: csPin });
    },
    
    async write(data: Uint8Array): Promise<void> {
      await bus.write(data, { csPin: csPin });
    },
    
    async read(length: number): Promise<Uint8Array> {
      return bus.read(length, { csPin: csPin });
    },
    
    async readRegister(register: number, length: number): Promise<Uint8Array> {
      return bus.readRegister(csPin, register, length);
    },
    
    async writeRegister(register: number, data: Uint8Array): Promise<void> {
      await bus.writeRegister(csPin, register, data);
    },
    
    async readByte(register: number): Promise<number> {
      const data = await bus.readRegister(csPin, register, 1);
      return data[0];
    },
    
    async writeByte(register: number, value: number): Promise<void> {
      await bus.writeRegister(csPin, register, new Uint8Array([value]));
    }
  };
}
```

---

## Source: bus/uart.ts

```typescript
// src/@typecode/core/bus/uart.ts

/**
 * UART Parity modes
 */
enum UARTParity {
  /** No parity bit */
  NONE = 0,
  /** Even parity */
  EVEN = 1,
  /** Odd parity */
  ODD = 2
}

/**
 * UART Stop bits
 */
enum UARTStopBits {
  /** 1 stop bit */
  ONE = 1,
  /** 1.5 stop bits */
  ONE_POINT_FIVE = 1.5,
  /** 2 stop bits */
  TWO = 2
}

/**
 * UART Flow control modes
 */
enum UARTFlowControl {
  /** No flow control */
  NONE = 0,
  /** Hardware flow control (RTS/CTS) */
  HARDWARE = 1,
  /** Software flow control (XON/XOFF) */
  SOFTWARE = 2
}

/**
 * UART Configuration
 */
interface UARTConfig {
  /** Baud rate */
  baudRate: number;
  
  /** Data bits (5-9) */
  dataBits?: 5 | 6 | 7 | 8 | 9;
  
  /** Parity mode */
  parity?: UARTParity;
  
  /** Stop bits */
  stopBits?: UARTStopBits;
  
  /** Flow control mode */
  flowControl?: UARTFlowControl;
  
  /** TX pin */
  txPin?: number;
  
  /** RX pin */
  rxPin?: number;
  
  /** RTS pin (for hardware flow control) */
  rtsPin?: number;
  
  /** CTS pin (for hardware flow control) */
  ctsPin?: number;
  
  /** RX buffer size in bytes */
  rxBufferSize?: number;
  
  /** TX buffer size in bytes */
  txBufferSize?: number;
  
  /** UART number (for multi-UART architectures) */
  uart?: number;
  
  /** Enable inverted signal (for RS485) */
  inverted?: boolean;
}

/**
 * UART Status
 */
interface UARTStatus {
  /** Bytes available to read */
  available: number;
  
  /** Write buffer space available */
  writeAvailable: number;
  
  /** Overrun error flag */
  overrunError: boolean;
  
  /** Parity error flag */
  parityError: boolean;
  
  /** Framing error flag */
  framingError: boolean;
  
  /** Break condition detected */
  breakDetected: boolean;
}

/**
 * UART Error types
 */
class UARTError extends Error {
  constructor(message: string, public uart: number) {
    super(message);
    this.name = 'UARTError';
  }
}

class UARTBufferOverflowError extends UARTError {
  constructor(uart: number) {
    super(`UART ${uart} buffer overflow`, uart);
    this.name = 'UARTBufferOverflowError';
  }
}

/**
 * UART/Serial Interface
 * Asynchronous serial communication
 */
interface IUART {
  /** UART number identifier */
  readonly uartNumber: number;
  
  /** Current baud rate */
  readonly baudRate: number;
  
  /** Whether the UART is initialized */
  readonly isInitialized: boolean;
  
  /**
   * Initialize the UART
   */
  initialize(config: UARTConfig): Promise<void>;
  
  /**
   * Deinitialize and release resources
   */
  deinitialize(): void;
  
  /**
   * Write data to the UART
   * @param data - Data to transmit
   */
  write(data: Uint8Array): Promise<void>;
  
  /**
   * Write a string (convenience method)
   */
  writeString(text: string): Promise<void>;
  
  /**
   * Write a line (with newline)
   */
  writeLine(text: string): Promise<void>;
  
  /**
   * Read available data
   * @param length - Maximum bytes to read (default: all available)
   */
  read(length?: number): Promise<Uint8Array>;
  
  /**
   * Read a string
   */
  readString(length?: number): Promise<string>;
  
  /**
   * Read a line (until newline)
   * @param timeout - Timeout in milliseconds
   */
  readLine(timeout?: number): Promise<string>;
  
  /**
   * Read until a specific byte
   * @param delimiter - Delimiter byte
   * @param timeout - Timeout in milliseconds
   */
  readUntil(delimiter: number, timeout?: number): Promise<Uint8Array>;
  
  /**
   * Peek at the next byte without consuming it
   */
  peek(): number;
  
  /**
   * Get number of bytes available to read
   */
  available(): number;
  
  /**
   * Check if write buffer has space
   */
  availableForWrite(): number;
  
  /**
   * Wait for all data to be transmitted
   */
  flush(): Promise<void>;
  
  /**
   * Clear receive buffer
   */
  clearRxBuffer(): void;
  
  /**
   * Clear transmit buffer
   */
  clearTxBuffer(): void;
  
  /**
   * Get status flags
   */
  getStatus(): UARTStatus;
  
  /**
   * Clear error flags
   */
  clearErrors(): void;
  
  /**
   * Set baud rate
   */
  setBaudRate(baud: number): void;
  
  /**
   * Set callback for data received event
   */
  onReceive(callback: (data: Uint8Array) => void): void;
  
  /**
   * Set callback for transmit complete event
   */
  onTransmitComplete(callback: () => void): void;
  
  /**
   * Set callback for error event
   */
  onError(callback: (error: UARTError) => void): void;
}

/**
 * Serial Port (alias for UART, common naming)
 * Used for USB Serial / Debug Serial
 */
interface ISerialPort extends IUART {
  /**
   * Print formatted output
   */
  print(...args: unknown[]): void;
  
  /**
   * Print line with newline
   */
  println(...args: unknown[]): void;
  
  /**
   * Print formatted string
   * @param format - Printf-style format string
   * @param args - Format arguments
   */
  printf(format: string, ...args: unknown[]): void;
  
  /**
   * Check if serial connection is established
   * (useful for USB serial)
   */
  isConnected(): boolean;
  
  /**
   * Wait for serial connection
   * (useful for USB serial on boards that reset on connect)
   */
  waitForConnection(timeout?: number): Promise<boolean>;
}

/**
 * Debug Serial singleton interface
 */
interface IDebugSerial extends ISerialPort {
  /**
   * Log debug message
   */
  debug(message: string): void;
  
  /**
   * Log info message
   */
  info(message: string): void;
  
  /**
   * Log warning message
   */
  warn(message: string): void;
  
  /**
   * Log error message
   */
  error(message: string): void;
  
  /**
   * Log with timestamp
   */
  logWithTimestamp(level: string, message: string): void;
  
  /**
   * Enable/disable debug output
   */
  setEnabled(enabled: boolean): void;
  
  /**
   * Set log level
   */
  setLevel(level: 'debug' | 'info' | 'warn' | 'error'): void;
}
```

---

## Architecture-Specific Implementations

### Arduino AVR I2C (Wire)

```typescript
// src/@typecode/arch-avr/i2c.ts

import { II2CBus, I2CConfig, I2CAddress, I2CError } from '@typecode/core';

/**
 * AVR I2C Implementation using Wire library
 * Transpiles to: Wire.begin(), Wire.beginTransmission(), etc.
 */
class AVRI2CBus implements II2CBus {
  readonly busNumber: number = 0;
  readonly speed: number = 100000;
  readonly isInitialized: boolean = false;
  
  private _timeout: number = 1000;
  
  async initialize(config: I2CConfig): Promise<void> {
    // Transpiles to: Wire.begin()
    // If speed is specified: Wire.setClock(config.speed)
    (this as any).isInitialized = true;
  }
  
  deinitialize(): void {
    // AVR Wire has no end() - do nothing
    (this as any).isInitialized = false;
  }
  
  async scan(): Promise<I2CAddress[]> {
    const devices: I2CAddress[] = [];
    for (let addr = 1; addr < 127; addr++) {
      if (await this.ping(addr)) {
        devices.push(addr);
      }
    }
    return devices;
  }
  
  async ping(address: I2CAddress): Promise<boolean> {
    // Transpiles to:
    // Wire.beginTransmission(address);
    // return Wire.endTransmission() == 0;
    return false;
  }
  
  async write(address: I2CAddress, data: Uint8Array): Promise<void> {
    // Transpiles to:
    // Wire.beginTransmission(address);
    // Wire.write(data, data.length);
    // Wire.endTransmission();
  }
  
  async read(address: I2CAddress, length: number): Promise<Uint8Array> {
    const buffer = new Uint8Array(length);
    // Transpiles to:
    // Wire.requestFrom(address, length);
    // for (int i = 0; i < length && Wire.available(); i++) {
    //   buffer[i] = Wire.read();
    // }
    return buffer;
  }
  
  async writeThenRead(
    address: I2CAddress,
    writeData: Uint8Array,
    readLength: number
  ): Promise<Uint8Array> {
    await this.write(address, writeData);
    return this.read(address, readLength);
  }
  
  async readRegister(
    address: I2CAddress,
    register: number,
    buffer: Uint8Array
  ): Promise<number> {
    const data = await this.writeThenRead(address, new Uint8Array([register]), buffer.length);
    buffer.set(data);
    return buffer.length;
  }
  
  async writeRegister(
    address: I2CAddress,
    register: number,
    data: Uint8Array
  ): Promise<void> {
    const combined = new Uint8Array(1 + data.length);
    combined[0] = register;
    combined.set(data, 1);
    await this.write(address, combined);
  }
  
  async readByte(address: I2CAddress, register: number): Promise<number> {
    const data = await this.writeThenRead(address, new Uint8Array([register]), 1);
    return data[0];
  }
  
  async writeByte(address: I2CAddress, register: number, value: number): Promise<void> {
    await this.write(address, new Uint8Array([register, value]));
  }
  
  async readWord(
    address: I2CAddress,
    register: number,
    littleEndian?: boolean
  ): Promise<number> {
    const data = await this.writeThenRead(address, new Uint8Array([register]), 2);
    if (littleEndian) {
      return data[0] | (data[1] << 8);
    }
    return (data[0] << 8) | data[1];
  }
  
  async writeWord(
    address: I2CAddress,
    register: number,
    value: number,
    littleEndian?: boolean
  ): Promise<void> {
    const data = new Uint8Array(3);
    data[0] = register;
    if (littleEndian) {
      data[1] = value & 0xFF;
      data[2] = (value >> 8) & 0xFF;
    } else {
      data[1] = (value >> 8) & 0xFF;
      data[2] = value & 0xFF;
    }
    await this.write(address, data);
  }
  
  setSpeed(speed: number): void {
    // Transpiles to: Wire.setClock(speed);
    (this as any).speed = speed;
  }
  
  getSpeed(): number {
    return this.speed;
  }
}
```

### ESP32 I2C (ESP-IDF)

```typescript
// src/@typecode/arch-esp32/i2c.ts

import { II2CBus, I2CConfig, I2CAddress, I2CError, I2CSpeed } from '@typecode/core';

/**
 * ESP32 I2C Implementation using ESP-IDF i2c driver
 * Transpiles to: i2c_driver_install(), i2c_master_cmd_begin()
 */
class ESP32I2CBus implements II2CBus {
  readonly busNumber: number;
  readonly speed: number = 100000;
  readonly isInitialized: boolean = false;
  
  private _sda: number = 21;  // Default ESP32 I2C SDA
  private _scl: number = 22;  // Default ESP32 I2C SCL
  private _timeout: number = 1000;
  
  constructor(busNumber: number) {
    this.busNumber = busNumber;
  }
  
  async initialize(config: I2CConfig): Promise<void> {
    if (config.sda !== undefined) this._sda = config.sda;
    if (config.scl !== undefined) this._scl = config.scl;
    
    // Transpiles to:
    // i2c_config_t conf = {};
    // conf.mode = I2C_MODE_MASTER;
    // conf.sda_io_num = this._sda;
    // conf.scl_io_num = this._scl;
    // conf.sda_pullup_en = config.pullUp ? GPIO_PULLUP_ENABLE : GPIO_PULLUP_DISABLE;
    // conf.scl_pullup_en = config.pullUp ? GPIO_PULLUP_ENABLE : GPIO_PULLUP_DISABLE;
    // conf.master.clk_speed = config.speed;
    // i2c_param_config(this.busNumber, &conf);
    // i2c_driver_install(this.busNumber, I2C_MODE_MASTER, 0, 0, 0);
    
    (this as any).speed = config.speed;
    (this as any).isInitialized = true;
  }
  
  deinitialize(): void {
    // Transpiles to: i2c_driver_delete(this.busNumber);
    (this as any).isInitialized = false;
  }
  
  async scan(): Promise<I2CAddress[]> {
    const devices: I2CAddress[] = [];
    for (let addr = 1; addr < 127; addr++) {
      if (await this.ping(addr)) {
        devices.push(addr);
      }
    }
    return devices;
  }
  
  async ping(address: I2CAddress): Promise<boolean> {
    // Transpiles to:
    // i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    // i2c_master_start(cmd);
    // i2c_master_write_byte(cmd, (address << 1) | I2C_MASTER_WRITE, true);
    // i2c_master_stop(cmd);
    // esp_err_t ret = i2c_master_cmd_begin(this.busNumber, cmd, pdMS_TO_TICKS(1000));
    // i2c_cmd_link_delete(cmd);
    // return ret == ESP_OK;
    return false;
  }
  
  async write(address: I2CAddress, data: Uint8Array): Promise<void> {
    // Transpiles to i2c command sequence with write
  }
  
  async read(address: I2CAddress, length: number): Promise<Uint8Array> {
    const buffer = new Uint8Array(length);
    // Transpiles to i2c command sequence with read
    return buffer;
  }
  
  async writeThenRead(
    address: I2CAddress,
    writeData: Uint8Array,
    readLength: number
  ): Promise<Uint8Array> {
    // Transpiles to combined write-then-read command sequence
    return new Uint8Array(readLength);
  }
  
  async readRegister(
    address: I2CAddress,
    register: number,
    buffer: Uint8Array
  ): Promise<number> {
    const data = await this.writeThenRead(address, new Uint8Array([register]), buffer.length);
    buffer.set(data);
    return buffer.length;
  }
  
  async writeRegister(
    address: I2CAddress,
    register: number,
    data: Uint8Array
  ): Promise<void> {
    const combined = new Uint8Array(1 + data.length);
    combined[0] = register;
    combined.set(data, 1);
    await this.write(address, combined);
  }
  
  async readByte(address: I2CAddress, register: number): Promise<number> {
    const data = await this.writeThenRead(address, new Uint8Array([register]), 1);
    return data[0];
  }
  
  async writeByte(address: I2CAddress, register: number, value: number): Promise<void> {
    await this.write(address, new Uint8Array([register, value]));
  }
  
  async readWord(
    address: I2CAddress,
    register: number,
    littleEndian?: boolean
  ): Promise<number> {
    const data = await this.writeThenRead(address, new Uint8Array([register]), 2);
    if (littleEndian) {
      return data[0] | (data[1] << 8);
    }
    return (data[0] << 8) | data[1];
  }
  
  async writeWord(
    address: I2CAddress,
    register: number,
    value: number,
    littleEndian?: boolean
  ): Promise<void> {
    const data = new Uint8Array(3);
    data[0] = register;
    if (littleEndian) {
      data[1] = value & 0xFF;
      data[2] = (value >> 8) & 0xFF;
    } else {
      data[1] = (value >> 8) & 0xFF;
      data[2] = value & 0xFF;
    }
    await this.write(address, data);
  }
  
  setSpeed(speed: number): void {
    (this as any).speed = speed;
    // Transpiles to: i2c_param_config() with new speed
  }
  
  getSpeed(): number {
    return this.speed;
  }
}

// Export instances for I2C0 and I2C1
const I2C0 = new ESP32I2CBus(0);
const I2C1 = new ESP32I2CBus(1);
```

### RP2040 I2C (Pico SDK)

```typescript
// src/@typecode/arch-rp2040/i2c.ts

import { II2CBus, I2CConfig, I2CAddress, I2CError } from '@typecode/core';

/**
 * RP2040 I2C Implementation using Pico SDK
 * Transpiles to: i2c_init(), i2c_read_blocking(), i2c_write_blocking()
 */
class RP2040I2CBus implements II2CBus {
  readonly busNumber: number;
  readonly speed: number = 100000;
  readonly isInitialized: boolean = false;
  
  private _sda: number;
  private _scl: number;
  private _instance: number;  // i2c0 or i2c1
  
  constructor(busNumber: number) {
    this.busNumber = busNumber;
    this._instance = busNumber === 0 ? 0 : 1;
    // Default pins for Pico
    this._sda = busNumber === 0 ? 4 : 6;
    this._scl = busNumber === 0 ? 5 : 7;
  }
  
  async initialize(config: I2CConfig): Promise<void> {
    if (config.sda !== undefined) this._sda = config.sda;
    if (config.scl !== undefined) this._scl = config.scl;
    
    // Transpiles to:
    // i2c_inst_t* i2c = this._instance == 0 ? i2c0 : i2c1;
    // i2c_init(i2c, config.speed);
    // gpio_set_function(this._sda, GPIO_FUNC_I2C);
    // gpio_set_function(this._scl, GPIO_FUNC_I2C);
    // gpio_pull_up(this._sda);
    // gpio_pull_up(this._scl);
    
    (this as any).speed = config.speed;
    (this as any).isInitialized = true;
  }
  
  deinitialize(): void {
    // Transpiles to: i2c_deinit(i2c_inst)
    (this as any).isInitialized = false;
  }
  
  async scan(): Promise<I2CAddress[]> {
    const devices: I2CAddress[] = [];
    for (let addr = 1; addr < 127; addr++) {
      if (await this.ping(addr)) {
        devices.push(addr);
      }
    }
    return devices;
  }
  
  async ping(address: I2CAddress): Promise<boolean> {
    // Transpiles to:
    // uint8_t dummy;
    // int ret = i2c_read_blocking(i2c_inst, address, &dummy, 1, false);
    // return ret >= 0;
    return false;
  }
  
  async write(address: I2CAddress, data: Uint8Array): Promise<void> {
    // Transpiles to: i2c_write_blocking(i2c_inst, address, data, data.length, false);
  }
  
  async read(address: I2CAddress, length: number): Promise<Uint8Array> {
    const buffer = new Uint8Array(length);
    // Transpiles to: i2c_read_blocking(i2c_inst, address, buffer, length, false);
    return buffer;
  }
  
  async writeThenRead(
    address: I2CAddress,
    writeData: Uint8Array,
    readLength: number
  ): Promise<Uint8Array> {
    await this.write(address, writeData);
    return this.read(address, readLength);
  }
  
  async readRegister(
    address: I2CAddress,
    register: number,
    buffer: Uint8Array
  ): Promise<number> {
    const data = await this.writeThenRead(address, new Uint8Array([register]), buffer.length);
    buffer.set(data);
    return buffer.length;
  }
  
  async writeRegister(
    address: I2CAddress,
    register: number,
    data: Uint8Array
  ): Promise<void> {
    const combined = new Uint8Array(1 + data.length);
    combined[0] = register;
    combined.set(data, 1);
    await this.write(address, combined);
  }
  
  async readByte(address: I2CAddress, register: number): Promise<number> {
    const data = await this.writeThenRead(address, new Uint8Array([register]), 1);
    return data[0];
  }
  
  async writeByte(address: I2CAddress, register: number, value: number): Promise<void> {
    await this.write(address, new Uint8Array([register, value]));
  }
  
  async readWord(
    address: I2CAddress,
    register: number,
    littleEndian?: boolean
  ): Promise<number> {
    const data = await this.writeThenRead(address, new Uint8Array([register]), 2);
    if (littleEndian) {
      return data[0] | (data[1] << 8);
    }
    return (data[0] << 8) | data[1];
  }
  
  async writeWord(
    address: I2CAddress,
    register: number,
    value: number,
    littleEndian?: boolean
  ): Promise<void> {
    const data = new Uint8Array(3);
    data[0] = register;
    if (littleEndian) {
      data[1] = value & 0xFF;
      data[2] = (value >> 8) & 0xFF;
    } else {
      data[1] = (value >> 8) & 0xFF;
      data[2] = value & 0xFF;
    }
    await this.write(address, data);
  }
  
  setSpeed(speed: number): void {
    (this as any).speed = speed;
    // Transpiles to: i2c_set_baudrate(i2c_inst, speed);
  }
  
  getSpeed(): number {
    return this.speed;
  }
}

// Export instances for i2c0 and i2c1
const I2C0 = new RP2040I2CBus(0);
const I2C1 = new RP2040I2CBus(1);
```

---

## Example: Architecture-Agnostic I2C Driver

```typescript
// drivers/bme280.ts
// This driver works on ANY architecture that implements II2CBus

import { II2CBus, createI2CDevice } from '@typecode/core';

class BME280 {
  private device: II2CDevice;
  
  // Calibration data
  private digT1: number = 0;
  private digT2: number = 0;
  private digT3: number = 0;
  private digP1: number = 0;
  private digP2: number = 0;
  private digP3: number = 0;
  private digP4: number = 0;
  private digP5: number = 0;
  private digP6: number = 0;
  private digP7: number = 0;
  private digP8: number = 0;
  private digP9: number = 0;
  private digH1: number = 0;
  private digH2: number = 0;
  private digH3: number = 0;
  private digH4: number = 0;
  private digH5: number = 0;
  private digH6: number = 0;
  
  constructor(bus: II2CBus, address: number) {
    this.device = createI2CDevice(bus, address);
  }
  
  async initialize(): Promise<void> {
    // Read calibration data
    await this.readCalibration();
    
    // Configure sensor
    await this.device.writeByte(0xF4, 0x27);  // Normal mode, oversampling x1
    await this.device.writeByte(0xF5, 0xA0);  // Standby 1000ms, filter off
  }
  
  private async readCalibration(): Promise<void> {
    this.digT1 = await this.device.readWord(0x88, true);
    this.digT2 = await this.readSignedWord(0x8A, true);
    this.digT3 = await this.readSignedWord(0x8C, true);
    
    this.digP1 = await this.device.readWord(0x8E, true);
    this.digP2 = await this.readSignedWord(0x90, true);
    this.digP3 = await this.readSignedWord(0x92, true);
    this.digP4 = await this.readSignedWord(0x94, true);
    this.digP5 = await this.readSignedWord(0x96, true);
    this.digP6 = await this.readSignedWord(0x98, true);
    this.digP7 = await this.readSignedWord(0x9A, true);
    this.digP8 = await this.readSignedWord(0x9C, true);
    this.digP9 = await this.readSignedWord(0x9E, true);
    
    this.digH1 = await this.device.readByte(0xA1);
    this.digH2 = await this.readSignedWord(0xE1, true);
    this.digH3 = await this.device.readByte(0xE3);
    
    const e4 = await this.device.readByte(0xE4);
    const e5 = await this.device.readByte(0xE5);
    const e6 = await this.device.readByte(0xE6);
    const e7 = await this.device.readByte(0xE7);
    
    this.digH4 = (e4 << 4) | (e5 & 0x0F);
    this.digH5 = (e6 << 4) | (e5 >> 4);
    this.digH6 = this.signByte(e7);
  }
  
  private async readSignedWord(register: number, littleEndian: boolean): Promise<number> {
    const value = await this.device.readWord(register, littleEndian);
    return value > 32767 ? value - 65536 : value;
  }
  
  private signByte(value: number): number {
    return value > 127 ? value - 256 : value;
  }
  
  async readTemperature(): Promise<number> {
    const data = await this.device.read(0xFA, 3);
    const rawTemp = (data[0] << 12) | (data[1] << 4) | (data[2] >> 4);
    
    // Apply compensation formula
    const var1 = (rawTemp / 16384.0 - this.digT1 / 1024.0) * this.digT2;
    const var2 = ((rawTemp / 131072.0 - this.digT1 / 8192.0) * 
                  (rawTemp / 131072.0 - this.digT1 / 8192.0)) * this.digT3;
    const t_fine = var1 + var2;
    
    return t_fine / 5120.0;
  }
  
  async readPressure(): Promise<number> {
    const data = await this.device.read(0xF7, 3);
    const rawPress = (data[0] << 12) | (data[1] << 4) | (data[2] >> 4);
    
    // Apply compensation (simplified)
    return rawPress / 256.0;
  }
  
  async readHumidity(): Promise<number> {
    const data = await this.device.read(0xFD, 2);
    const rawHum = (data[0] << 8) | data[1];
    
    return rawHum / 1024.0;
  }
}

export { BME280 };
```

### Usage on Different Architectures

```typescript
// main-esp32.ts
import { I2C0 } from '@typecode/arch-esp32';
import { BME280 } from './drivers/bme280';

const sensor = new BME280(I2C0, 0x77);
await sensor.initialize();
const temp = await sensor.readTemperature();

// main-pico.ts  
import { I2C0 } from '@typecode/arch-rp2040';
import { BME280 } from './drivers/bme280';

const sensor = new BME280(I2C0, 0x77);
await sensor.initialize();
const temp = await sensor.readTemperature();
```

---

## Next Steps

- **[03-concurrency.md](./03-concurrency.md)** - Scheduler and task management
- **[04-memory-decorators.md](./04-memory-decorators.md)** - Memory placement control