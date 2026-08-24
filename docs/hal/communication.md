# Communication Buses

TypeCAD provides a unified, object-oriented approach to peripheral communication. Buses like **UART**, **I2C**, and **SPI** are treated as first-class resources that transition from "Uninitialized" to "Initialized" states, preventing usage errors (like calling `.read()` before `.begin()`) at compile time.

---

## UART (Serial)

UART is most commonly used for serial communication with a computer or between two microcontrollers. TypeCAD's `ISerialPort` interface provides familiar print methods alongside powerful buffer management and asynchronous waiting.

### Basic Usage
Initialize a serial port with a baud rate to unlock its full API.

```typescript
import { UART0, delay } from '@typecad/board';

// Initialize UART0 at 115200 baud
const serial = UART0.begin(115200);

serial.println("TypeCAD Serial Initialized");

while (true) {
  serial.printf("Millis: %d\n", millis());
  delay(1000);
}
```

### Reading Data
TypeCAD provides several ways to read incoming data, from single bytes to entire lines.

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

## USB CDC Serial (`USB0`)

On boards with a USB device port (WeAct Black Pill STM32F411, Seeed XIAO nRF52840), TypeCAD exposes the connector as a dedicated serial port: `USB0`. It appears on the host as a regular COM/tty device and shares the `ISerialPort` print API with `UART0`, plus one addition — `connected()`, which reports whether the host has actually opened the port. Output written before that is silently dropped by most hosts, so gate early writes on it.

`USB0` is board-gated: the board package must declare the USB capability, otherwise `usb.*` calls fail at build time with a diagnostic naming the missing board data.

### Basic Usage

```typescript
import { USB0 } from '@typecad/board';
import { delay } from '@typecad/hal';

// The baud value is a line-coding hint only — CDC has no wire speed.
USB0.begin(115200);

while (true) {
  if (USB0.connected()) {           // DTR asserted — host opened the port
    USB0.println("hello over USB");
  }
  delay(1000);
}
```

`USB0` and `UART0` are independent ports (on the Black Pill: USB-C connector vs. PA9/PA10), and `console.log` continues to route to the board's configured console — the three streams never interfere.

### Routing `console.log` to USB

`console.log` lowers to `printk` and follows the board's devicetree console node — often a UART on pins you may not have wired. The build prints where it goes (`console.log -> printk -> usart1 on PA9 (TX) / PA10 (RX) on this board`). To send it out the USB connector instead, set `output: 'usb'` in the config's `console` section:

```typescript
// cuttlefish.config.ts
export default defineConfig({
  // ...
  console: {
    output: 'usb',   // console.log → the USB CDC port (boards with USB)
    port: 'COM4',    // monitor port (unchanged role)
  },
});
```

The overlay rebinds the console onto the CDC port and forces the USB symbols on — the program itself needs no `USB0.begin()` call for `console.log` to work.

---

## I2C (Inter-Integrated Circuit)

I2C is used for communicating with sensors, displays, and port expanders over two wires (SDA/SCL). TypeCAD automates address management and register access.

### Accessing a Device
Instead of manually sending start/stop bits and handling ACK/NACK for every byte, you define a device accessor.

```typescript
import { I2C0 } from '@typecad/board';

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

SPI is a high-speed bus used for displays, SD cards, and high-performance sensors. TypeCAD manages the **Chip Select (CS)** line automatically for you.

### Automatic CS Management
When using `.device(csPin)`, TypeCAD automatically asserts (LOW) and deasserts (HIGH) the chip-select pin for every operation, ensuring the slave is active only during data transfer.

```typescript
import { SPI0, D10 } from '@typecad/board';

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
