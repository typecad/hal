# Communication Buses & Consoles

The buses are thin per-target classes: one UART port, one I2C address, one SPI chip-select — construction carries the configuration (baud, buffer sizes, bus speed, SPI mode), and every verb maps 1:1 onto Zephyr's driver calls. No `begin()`/`endTransaction()` dance, no Wire vocabulary, no mode strings.

For attaching sensors to these buses, see [Sensors](./sensors.md) — one generic class covers every Zephyr sensor driver from a generated part catalog.

---

## UART — `UART`

Construction names the controller and carries the baud (applied once, guarded, on first use) and the RX ring size (the receive interrupt drains into it):

```typescript
import { UART } from '@typecad/hal';

const gps = new UART('UART0', { baud: 9600, rxBufferBytes: 128 });

gps.write("$PMTK220,1000*2F\r\n");   // uart_poll_out per byte — no newline appended
gps.writeLine("hello");               // …with a newline

if (gps.available() > 0) {            // bytes waiting in the ring
  const b = gps.read();               // pop the oldest byte (-1 when empty)
  const peeked = gps.peek();          // look without consuming
}
```

TX is poll-based (`uart_poll_out` — synchronous, fine for writes); RX is interrupt-backed into the construction-sized ring, armed on the first receive call. `read()`/`peek()` return **bytes or −1** — there is no line API; frame in your program.

## USB CDC Serial — `USBConsole`

On boards with a USB device connector, `USBConsole` is the CDC port. It appears on the host as a regular COM/tty device. The one CDC-specific fact: **output written before the host opens the port is silently dropped** — gate early writes on `linked()` (DTR asserted) or block once in `waitLinked()`:

```typescript
import { USBConsole } from '@typecad/hal';

const usb = new USBConsole('USB0');
if (!usb.linked()) {
  usb.waitLinked(3000);               // bounded poll in the shim — no user busy loop
}
usb.writeLine('hello, host');
const b = usb.read();                 // one byte, or -1
```

`USB0` is board-gated: the board must declare a USB device controller, otherwise `usb.*` ops fail at build time with a diagnostic naming the missing board data.

---

## I2C — `I2CTarget`

One address on a bus, Zephyr's register verbs verbatim:

```typescript
import { I2CTarget } from '@typecad/hal';

const sensor = new I2CTarget('I2C0', 0x44, { hz: 400000 });

sensor.writeReg(0xF4, 0x27);                          // i2c_reg_write_byte
const id = sensor.readReg(0xD0);                      // i2c_reg_read_byte
sensor.updateReg(0xF5, 0x0F, 0x02);                   // i2c_reg_update_byte — native
                                                      // read-modify-write, no read-back race
sensor.write([0x2C, 0x06]);                           // i2c_write (raw bytes)
```

- The bus name is the board's controller instance (`'I2C0'`, `'I2C1'` — the bus instance exports work too).
- The address is the **7-bit** form (`0x44`) — no left-shifted 8-bit forms.
- `hz` applies once (`i2c_configure`, guarded); 100k/400k/1M map to Zephyr's `I2C_SPEED_*` tiers.

For managed sensor drivers over I2C, prefer `Sensor` with the carrier form — `new Sensor(SENSOR.sensirion_sht3xd, I2C1.device(0x44))` — which generates the devicetree node and typed channels ([Sensors](./sensors.md)). `I2CTarget` is for register-level access to parts the catalog doesn't cover.

## SPI — `SPITarget`

One chip-select on a bus, against a statically generated `spi_dt_spec` (the overlay emits the CS pin, frequency, and mode bits as devicetree):

```typescript
import { SPITarget } from '@typecad/hal';

const display = new SPITarget('SPI0', 10, { hz: 10000000, mode: 0 });

const rx = new Uint8Array(4);
display.transceive([0x42, 0x00, 0x00, 0x00], rx);     // full duplex (spi_transceive_dt)
display.write([0xAA, 0xBB]);                          // spi_write_dt
const id = display.readReg(0x00);                     // one-byte register read via an
                                                      // internal transceive buffer
```

CS asserts and deasserts around every operation — there is no transaction API because Zephyr's `spi_dt_spec` already binds the configuration per device. Multiple `SPITarget`s on one bus with different CS pins is the normal shape.

---

## Bus conflicts are caught at build time

Two peripherals claiming the same pins (an `I2CTarget` on SCL and a `GPIO` output on the same pad, say) fail the build with the conflict named — see [Ownership](./ownership.md) for the resource-safety model, including the optional exclusive-claim markers for shared-bus programs.

---

## API Reference

### UART

| Member | Returns | Description |
| :--- | :--- | :--- |
| `new UART(port, opts?)` | `UART` | `baud` (default 115200), `rxBufferBytes` (default 64). |
| `write(v)` / `writeLine(v)` | `void` | Poll TX (`v` is text, a number, or a boolean); `writeLine` appends `\n`. |
| `available()` | `number` | Bytes waiting in the RX ring (arms the RX IRQ on first use). |
| `read()` | `number` | Pop the oldest byte; −1 when empty. |
| `peek()` | `number` | Oldest byte without consuming; −1 when empty. |

### USBConsole

| Member | Returns | Description |
| :--- | :--- | :--- |
| `new USBConsole(port?)` | `USBConsole` | Defaults to `'USB0'`; board must declare USB. |
| `write(v)` / `writeLine(v)` | `void` | Typed writes (`v` is text, a number, or a boolean). |
| `linked()` | `boolean` | Host has the port open (DTR). |
| `waitLinked(timeoutMs?)` | `boolean` | Block until linked (0 = forever). |
| `read()` / `available()` | `number` | One byte (−1 when none) / ready count. |

### I2CTarget

| Member | Returns | Description |
| :--- | :--- | :--- |
| `new I2CTarget(bus, address, opts?)` | `I2CTarget` | 7-bit address; `hz` applies once. |
| `writeReg(reg, value)` | `void` | `i2c_reg_write_byte`. |
| `readReg(reg)` | `number` | `i2c_reg_read_byte`. |
| `updateReg(reg, mask, value)` | `void` | Native read-modify-write (`i2c_reg_update_byte`). |
| `write(bytes)` | `void` | Raw `i2c_write`. |

### SPITarget

| Member | Returns | Description |
| :--- | :--- | :--- |
| `new SPITarget(bus, cs, opts?)` | `SPITarget` | `hz`, `mode` (0–3) become the DT spec. |
| `transceive(tx, rx?)` | `void` | Full-duplex `spi_transceive_dt`. |
| `write(tx)` | `void` | `spi_write_dt`. |
| `readReg(reg)` | `number` | One-byte register read (internal buffer). |
