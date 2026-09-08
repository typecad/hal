# Sensors

TypeCAD ships a generic sensor interface that covers every Zephyr sensor driver through one class — no per-part package, no devicetree text, and no Kconfig edits. Part identity comes from a generated catalog derived from Zephyr's own binding files, so any Zephyr sample or binding doc greps straight into your code.

---

## Quick Start

Construct a sensor from a part token and a bus device, then `fetch()` a sample and `get()` channels from it:

```typescript
import { I2C0, SPI0, ANY_PIN, Sensor, SENSOR, CHAN } from '@typecad/hal';

// SHT3X temp/humidity breakout at I2C address 0x44
const sht3x = new Sensor(SENSOR.sensirion_sht3xd, I2C0.device(0x44));

// BME280 wired to SPI with a chip-select pin
const bme = new Sensor(SENSOR.bosch_bme280, SPI0.device(ANY_PIN));

while (true) {
  sht3x.fetch();                                   // sensor_sample_fetch
  const temp = sht3x.get(CHAN.AMBIENT_TEMP);       // sensor_channel_get
  const rh = sht3x.get(CHAN.HUMIDITY);

  bme.fetch();
  const pressure = bme.get(CHAN.PRESS);

  UART0.writeLine(`${temp} C, ${rh} %RH, ${pressure} hPa`);
}
```

`fetch()` then `get()` mirrors Zephyr's own split: one fetch takes a measurement, and every `get()` reads a channel from that same sample.

## Part Tokens

`SENSOR.<name>` enumerates every part in the catalog — hover any token for its description, buses, and address hints. The name is the Zephyr compatible string with `,` and `-` replaced by `_`, so `compatible = "sensirion,sht3xd"` in any binding or board file maps directly to `SENSOR.sensirion_sht3xd`. The catalog is generated from the pinned Zephyr revision (`scripts/gen-zephyr-sensor-parts.mjs`); 215 parts ship today, covering both I2C and SPI attachments.

## Channels

`CHAN` mirrors Zephyr's `enum sensor_channel` minus the `SENSOR_CHAN_` prefix, verbatim: a driver doc that says `SENSOR_CHAN_AMBIENT_TEMP` means `CHAN.AMBIENT_TEMP`. You rarely need to type the prefix — inside `get(...)`, typing a channel name offers `CHAN` as the top completion, and accepting it opens the member picker.

Channel access is narrowed per part: `new Sensor(SENSOR.sensirion_sht3xd, ...)` has type `Sensor<'sensirion_sht3xd'>`, and its `get()` accepts only `CHAN.AMBIENT_TEMP | CHAN.HUMIDITY`. Asking a part for a channel its driver doesn't serve is a compile error in the editor and a build error naming the driver's full channel list. Parts whose drivers have no scanned channel table fall back to accepting any channel name.

## What the Build Does

Everything between your code and Zephyr's driver is generated:

- **Devicetree**: each constructed sensor becomes a child node in the board overlay — `compatible`, `reg` (the I2C address, or the chip-select's index in `cs-gpios` for SPI parts) — derived from the same catalog. The node itself is the driver's enable switch: Zephyr's sensor Kconfigs default on when their compatible is present, so no `CONFIG_<DRIVER>` is ever needed.
- **Kconfig**: one usage-gated symbol, `CONFIG_SENSOR=y`. Printing floats through `printf('%f', ...)` automatically turns on Zephyr's cbprintf float support.
- **C++**: one device handle per sensor (`DEVICE_DT_GET` on the generated node), lowered to `sensor_sample_fetch` / `sensor_channel_get` with Zephyr's `sensor_value` converted to a JS `number`.
- **Bus state**: a sensor claims its bus controller even if you never touch `I2C0`/`SPI0` directly, so the controller's pins get muxed correctly. Pin conflicts between used peripherals are caught at build time.

## Limitations

- SPI parts default to a 1 MHz bus speed; override with the constructor options (`{ spiHz, mode, alert }`). The bus-device argument is typed per part (`SensorBusOf`), so an SPI-only part rejects `I2C1.device(...)` at the editor.
- A display panel and SPI sensors sharing one controller get a merged `cs-gpios` (panel CS first, sensor CS pins after — reg indexes stay stable).
- Parts whose binding declares `alert-gpios` accept an `alert` pin option, emitted as `alert-gpios` on the DT node.
- Only I2C and SPI attachments are supported; parts binding on other buses are rejected with an error naming the part's actual buses.
- The catalog carries a `kconfig` exceptions field (empty today — every in-tree sensor driver is DT-default-on); when a future scan finds an exception, scaffold emits it automatically.
