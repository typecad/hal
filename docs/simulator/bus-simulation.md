# Bus Simulation

The simulator provides three bus peripherals that implement the same direct API as real hardware. Tests inject data into RX buffers, register mock devices, and inspect operation logs.

## SimSerialPort

Implements `ISerialPort` with RX/TX buffers for testing UART communication.

### Production API (same as hardware)

**Initialization:**

```typescript
uart.begin(9600);
```

**Write operations:**

| Method | Description |
|--------|-------------|
| `write(data)` | Write a number, `Uint8Array`, or string |
| `print(...args)` | Print values to TX buffer |
| `println(...args)` | Print values + newline to TX buffer |
| `printf(format, ...args)` | Printf-style format (`%d`, `%s`, `%f`) |
| `flush()` | Flush TX buffer |

**Read operations:**

| Method | Description |
|--------|-------------|
| `read()` | Read single byte (returns -1 if empty) |
| `peek()` | Peek at next byte without consuming |
| `readLine()` | Read a line from RX buffer |
| `readBytes(count)` | Read exact byte count |
| `readString()` | Read all available as string |
| `available()` | Bytes available in RX buffer |

**Status:**

| Method | Description |
|--------|-------------|
| `getStatus()` | Detailed status info |
| `clearErrors()` | Clear error flags |

### Simulation Helpers

| Method | Description |
|--------|-------------|
| `injectRx(data)` | Inject bytes into RX buffer (string, `number[]`, or `Uint8Array`) |
| `flushTx()` | Get TX buffer contents and clear it |
| `reset()` | Clear all buffers and state |

### Example: Testing Serial Output

```typescript
import { createSimBoard } from '@typecode/simulator';

const board = createSimBoard({ boardType: 'arduino-uno' });
const uart = board.serial(0);

// Initialize
uart.begin(9600);

// Sketch code writes data
uart.println('Temperature: 25.3');
uart.print('OK');

// Verify TX output
const txData = uart.flushTx();
const txString = new TextDecoder().decode(new Uint8Array(txData));
expect(txString).toBe('Temperature: 25.3\r\nOK');
```

### Example: Testing Serial Input

```typescript
const uart = board.serial(0);
uart.begin(9600);

// Inject data that sketch will read
uart.injectRx('HELLO\n');

// Sketch reads a line
const line = uart.readLine();
expect(line).toBe('HELLO');

// Inject binary data
uart.injectRx([0x01, 0x02, 0x03, 0x04]);

// Sketch reads exact byte count
const bytes = uart.readBytes(4);
expect(bytes).toEqual(new Uint8Array([0x01, 0x02, 0x03, 0x04]));
```

### Example: RX Callback

```typescript
const uart = board.serial(0);

let receivedCount = 0;
uart.onReceive = (available) => {
  receivedCount = available;
};

// Injecting data triggers the callback
uart.injectRx('data');
expect(receivedCount).toBe(4);
```

---

## SimI2CBus

Implements `II2CBus` with a mock device registry. Tests register `ISimI2CDevice` objects that respond to register reads and writes.

### Mock Device Interface

```typescript
interface ISimI2CDevice {
  read(register: number, count: number): number[];
  write(register: number, data: number[]): void;
}
```

### Production API (same as hardware)

**Initialization:**

```typescript
i2c.begin();           // Master mode
i2c.begin(0x40);       // Slave mode with address
i2c.setClock(400000);  // Set clock speed (400 kHz fast mode)
```

**Device operations (via `device()` accessor):**

```typescript
// Get device accessor
const dev = i2c.device(0x76);

// Read operations
dev.readByte(0xFA);           // Read single byte from register
dev.readBytes(0xFA, 4);       // Read 4 bytes from register

// Write operations
dev.writeByte(0x10, 0xFF);    // Write single byte to register
dev.writeBytes(0x10, [0x01, 0x02]); // Write multiple bytes to register
```

### Simulation Helpers

| Method | Description |
|--------|-------------|
| `attachDevice(address, device)` | Register a mock device at the given address |
| `detachDevice(address)` | Remove a mock device |
| `getLog()` | Get all operations as `I2COperationLog[]` |
| `clearLog()` | Clear the operation log |
| `reset()` | Remove all devices, clear log, reset state |

### I2COperationLog

```typescript
interface I2COperationLog {
  operation: 'read' | 'write';
  address: I2CAddress;
  register: number;
  data?: number[];
  timestamp: number;
}
```

### Example: BME280 Sensor Mock

```typescript
import { createSimBoard } from '@typecode/simulator';
import type { ISimI2CDevice } from '@typecode/simulator';

const board = createSimBoard({ boardType: 'arduino-uno' });
const i2c = board.i2c(0);

// Create a mock BME280 sensor
const bme280: ISimI2CDevice = {
  read(register: number, count: number): number[] {
    // Register 0xFA = temperature MSB
    if (register === 0xFA) return [0x80, 0x00]; // Example raw temp
    return new Array(count).fill(0);
  },
  write(register: number, data: number[]): void {
    // Handle configuration writes
  },
};

i2c.attachDevice(0x76, bme280);
i2c.begin();

// Sketch code reads temperature
const data = i2c.device(0x76).readBytes(0xFA, 2);
expect(data[0]).toBe(0x80);
expect(data[1]).toBe(0x00);

// Verify operation was logged
const log = i2c.getLog();
expect(log).toHaveLength(1);
expect(log[0]).toEqual({
  operation: 'read',
  address: 0x76,
  register: 0xFA,
  data: [0x80, 0x00],
  timestamp: expect.any(Number),
});
```

### Example: Missing Device Read

```typescript
// No device at address 0x40 — returns empty array
const data = i2c.device(0x40).readBytes(0x00, 2);
expect(data).toHaveLength(0);
```

---

## SimSPIBus

Implements `ISPIBus` with a mock device registry keyed by chip-select pin.

### Mock Device Interface

```typescript
interface ISimSPIDevice {
  transfer(mosiData: number[]): number[];        // Required
  write?(register: number, data: number[]): void; // Optional
  readRegister?(register: number, count: number): number[]; // Optional
}
```

If `write()` is not provided, the bus falls back to `transfer()`. If `readRegister()` is not provided, it falls back to `transfer()` with dummy bytes.

### Production API (same as hardware)

**Initialization:**

```typescript
spi.begin();
spi.setFrequency(4_000_000);
spi.setMode(0);
spi.setBitOrder('msb');
```

**Device operations (via `device()` accessor):**

```typescript
const dev = spi.device(csPin);

// Full-duplex transfer
const response = dev.transfer(0x55);           // Single byte
const rxData = dev.transfer(new Uint8Array([0x80, 0x00])); // Multi-byte

// Write to register
dev.write(0x10, [0x01, 0x02]);

// Read from register
const data = dev.readRegister(0x20, 4);

// Convenience methods
dev.writeRegister(0x10, new Uint8Array([0x01])); // Same as write()
dev.write16(0x1234);                             // Write 16-bit value
```

### Simulation Helpers

| Method | Description |
|--------|-------------|
| `attachDevice(csPin, device)` | Register a mock device for a CS pin |
| `detachDevice(csPin)` | Remove a mock device |
| `getLog()` | Get all operations as `SPIOperationLog[]` |
| `clearLog()` | Clear the operation log |
| `reset()` | Remove all devices, clear log, reset state |

### SPIOperationLog

```typescript
interface SPIOperationLog {
  operation: 'read' | 'write' | 'transfer';
  register?: number;
  count?: number;
  data?: number[];
  response?: number[];  // Only for transfer operations
  timestamp: number;
}
```

### Example: SPI Sensor Mock

```typescript
import { createSimBoard } from '@typecode/simulator';
import type { ISimSPIDevice } from '@typecode/simulator';

const board = createSimBoard({ boardType: 'arduino-uno' });
const spi = board.spi(0);
const csPin = board.digital(10);

// Create a mock SPI accelerometer
const accelerometer: ISimSPIDevice = {
  transfer(mosiData: number[]): number[] {
    // Echo back with some modification
    return mosiData.map(b => b ^ 0xFF);
  },
  write(register: number, data: number[]): void {
    // Handle register writes
  },
  readRegister(register: number, count: number): number[] {
    // Register 0x0F = WHO_AM_I
    if (register === 0x0F) return [0x33]; // Example device ID
    return new Array(count).fill(0);
  },
};

spi.attachDevice(csPin, accelerometer);
spi.begin();

// Sketch code reads device ID
const data = spi.device(csPin).readRegister(0x0F, 1);
expect(data[0]).toBe(0x33);

// Full-duplex transfer
const rxData = spi.device(csPin).transfer(new Uint8Array([0xAA, 0x55]));
expect(Array.from(rxData)).toEqual([0x55, 0xAA]); // XOR 0xFF
```

### Example: Transfer-Only Device

For simple SPI devices that only need `transfer()`:

```typescript
const shiftRegister: ISimSPIDevice = {
  transfer(mosiData: number[]): number[] {
    // Shift register doesn't return meaningful data
    return new Array(mosiData.length).fill(0);
  },
};

spi.attachDevice(csPin, shiftRegister);

// Write falls back to transfer()
spi.device(csPin).write(0x00, [0xAB]); // Calls transfer([0x00, 0xAB])
```
