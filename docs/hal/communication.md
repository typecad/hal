# Communication Buses

TypeHAL provides a unified, object-oriented approach to peripheral communication. Buses like **UART**, **I2C**, and **SPI** are treated as first-class resources that transition from "Uninitialized" to "Initialized" states, preventing usage errors (like calling `.read()` before `.begin()`) at compile time.

---

## UART (Serial)

UART is most commonly used for serial communication with a computer or between two microcontrollers. TypeHAL's `ISerialPort` interface provides familiar print methods alongside powerful buffer management and asynchronous waiting.

### Basic Usage
Initialize a serial port with a baud rate to unlock its full API.

```typescript
import { UART0, delay } from '@typehal';

// Initialize UART0 at 115200 baud
const serial = UART0.begin(115200);

serial.println("TypeHAL Serial Initialized");

while (true) {
  serial.printf("Millis: %d\n", millis());
  delay(1000);
}
```

### Reading Data
TypeHAL provides several ways to read incoming data, from single bytes to entire lines.

```typescript
if (serial.available() > 0) {
  // Read a single byte
  const data = serial.read();
  
  // Or read an entire line as a string
  const line = serial.readLine();
  
  serial.printf("Received: %s\n", line);
}
```

### Async Connections
For USB-CDC serial ports (common on modern boards), you can wait for a host computer to connect before proceeding.

```typescript
// Wait for terminal to be opened on the PC
await serial.waitForConnection();
serial.println("Hello, PC! Connection established.");
```

---

## I2C (Inter-Integrated Circuit)

I2C is used for communicating with sensors, displays, and port expanders over two wires (SDA/SCL). TypeHAL automates address management and register access.

### Accessing a Device
Instead of manually sending start/stop bits and handling ACK/NACK for every byte, you define a device accessor.

```typescript
import { I2C0 } from '@typehal';

const bus = I2C0.begin();
const sensor = bus.device(0x76); // Typical address for a BME280 sensor

// Read a single byte from a specific register
const chipId = sensor.readByte(0xD0);

// Write a configuration byte to a register
sensor.writeByte(0xF4, 0x27);
```

### Bus Configuration & Recovery
You can adjust the clock speed or attempt to recover a "stuck" bus (where a slave device is incorrectly holding the data line LOW).

```typescript
bus.setClock(400000); // 400kHz Fast Mode
bus.recover();        // Attempt to unstick SDA/SCL lines via clock toggling
```

---

## SPI (Serial Peripheral Interface)

SPI is a high-speed bus used for displays, SD cards, and high-performance sensors. TypeHAL manages the **Chip Select (CS)** line automatically for you.

### Automatic CS Management
When using `.device(csPin)`, TypeHAL automatically asserts (LOW) and deasserts (HIGH) the chip-select pin for every operation, ensuring the slave is active only during data transfer.

```typescript
import { SPI0, D10 } from '@typehal';

const bus = SPI0.begin();
const display = bus.device(D10); // Use D10 as Chip Select

// Transfer data (Full Duplex: sends 0x42 and returns what was received)
const response = display.transfer(0x42);

// Direct register operations
display.writeRegister(0x01, 0xFF);
```

### Transactions
For performance and safety, you can group multiple operations into a transaction with specific hardware settings.

```typescript
bus.beginTransaction({
  frequency: 10000000, // 10MHz
  mode: 0,
  bitOrder: 'MSB'
});

display.write(0xAA);
display.write(0xBB);

bus.endTransaction(); // Returns settings to default
```

---

## API Reference

### UART / Serial Handle
| Method | Description |
| :--- | :--- |
| `print(args)` | Sends data without a trailing newline. |
| `println(args)` | Sends data with a trailing newline. |
| `printf(fmt, args)` | Formatted output (C-style formatting). |
| `read()` | Reads one byte from the buffer (-1 if empty). |
| `readLine()` | Reads until a `\n` or `\r\n` is encountered. |
| `available()` | Returns the number of bytes waiting to be read. |

### I2C Accessor
| Method | Description |
| :--- | :--- |
| `readByte(reg)` | Reads one byte from a register. |
| `readBytes(reg, n)` | Reads `n` bytes into a `Uint8Array`. |
| `writeByte(reg, val)`| Writes one byte to a register. |
| `writeBytes(reg, data)`| Writes a buffer of bytes to a register. |

### SPI Device Handle
| Method | Description |
| :--- | :--- |
| `transfer(data)` | Simultaneous read/write (full duplex). |
| `write(data)` | Sends data and ignores the return signal. |
| `readRegister(reg, n)`| Reads `n` bytes starting from a specific register address. |

---

## Advanced Feature: Bus Ownership
In multi-threaded environments (like ESP32), you can use `.take()` and `.release()` to ensure exclusive access to a shared bus. This prevents a high-priority task from interrupting a sensor reading transaction on another task.

```typescript
// Wait for exclusive access to I2C0
const bus = I2C0.take(); 

if (bus) {
  // Bus is now locked for this task
  bus.device(0x42).readByte(0x00);
  bus.release(); // Unlock the bus for other tasks
}
```
