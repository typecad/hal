# `@typecad/hal`

Hardware abstraction layer for [TypeCAD](https://cuttlefish.typecad.net) —
GPIO, timing, threads, PWM/ADC/DAC, I2C/SPI/UART/USB, persistent storage,
sensors, and WiFi/HTTP/MQTT/BLE, written as regular TypeScript.

`@typecad/hal` is what firmware code imports to talk to hardware. You write
normal TypeScript (`led.toggle()`, `bus.writeReg(...)`, `Time.sleep(250)`);
the transpiler (`@typecad/cuttlefish`) resolves each HAL call against the
active board's facts and emits the equivalent C++ at build time. There are
no runtime fallbacks — if the HAL doesn't lower it, it doesn't appear in the
firmware.

## Install

HAL projects are scaffolded by cuttlefish, which wires the framework,
board target, and the Zephyr SDK for you:

```bash
npx @typecad/cuttlefish create my-firmware
cd my-firmware && npx cuttlefish build --compile
```

A project imports hardware from **`@typecad/board`** — the module cuttlefish
generates per project from the Zephyr board catalog. That module is the
narrowed gateway: it re-exports a hardware class only when this board's
facts support it, so importing unavailable hardware fails at module
resolution (editor and transpile), not at a deep diagnostic. `@typecad/hal`
is the implementation package.

## What's included

Every class is thin and Zephyr-shaped: construction carries the facts, and
each method maps onto the kernel/driver API verbatim — no Arduino
vocabulary, no transaction dance.

| Area | Exports |
| --- | --- |
| **Digital I/O** | `Pin` (identity), `GPIO` (configure/read/write/toggle, `onInterrupt`/`offInterrupt`), `shiftOut`/`shiftIn` |
| **Timing** | `Time` (`sleep`/`now`/`nowUs`/`busyWaitUs`) |
| **Concurrency** | `Thread` (kernel threads), `Async` (cooperative await), `Counter` (hardware timers) |
| **PWM** | `PWM` (`setPulse`/`setDuty`/`setPeriod`; ns-true verbs) |
| **Analog in** | `ADC` (`read`/`readMillivolts`, gain/reference tokens; every ADC controller the SoC declares) |
| **Analog out** | `DAC` (`write`) |
| **I2C** | `I2CTarget` (register verbs; also the Sensor fact-carrier), `I2CBus` (controller selector: `I2C0.device(0x44)` returns a ready target) |
| **SPI** | `SPITarget` (transceive/register verbs), `SPIBus` (controller selector: `SPI0.device(PA4)` returns a ready target) |
| **UART** | `UART` (writeLine/read ring) — the board exports ready-to-use instances (`UART0.writeLine(...)`) |
| **USB** | `USBConsole` (CDC console: open/write/read/linked) |
| **Storage** | `Store` (persistent typed keys), `File` (littlefs text files) |
| **Watchdog** | `Watchdog` |
| **Sensors** | `Sensor` + the generated `SENSOR`/`CHAN` catalog |
| **Networking** | `WiFi`, `Request` (HTTP), `Mqtt`, `BLE` (GATT peripheral) |
| **Math / Random** | `abs`/`min`/`max`/`Num`, `Random` (`seed`/`upTo`/`between`/`int`) |
| **Registers** | `@register`/`@bits` (memory-mapped struct decorators) |
| **Zephyr tokens** | `ZEPHYR_ADC_GAINS`, `ZEPHYR_ADC_REFERENCES`, `ZEPHYR_GPIO_FLAGS`, `ZEPHYR_GPIO_INTS` (generated from the pinned tree's headers) |

Periodic and deferred work is a `Thread` (or a `Counter` for hardware
timers) — there are no JS-named timers (`setInterval`/`setTimeout`) on
embedded targets.

## Compile-time directives

Directives look like ordinary TypeScript but are intercepted by the
transpiler:

- **`rawCpp(text)`** — appends a line of C++ to the output (with field/parameter substitution).
- **`rawCppExpr(text)`** — the same, in expression position.
- **`include(header)`** — adds a deduplicated `#include` to the output.
- **`board(path)`** — resolves a board-fact constant inside a template.

`callback(fn)` registers a function value so it can be passed to APIs that
take handlers (interrupts, threads, bus events). See
[`HAL-GUIDE.md`](./HAL-GUIDE.md) for how HAL features are built.

## Example

```ts
import { LED } from '@typecad/board';
import { GPIO, Time, Thread } from '@typecad/hal';

const led = new GPIO(LED, GPIO.OUTPUT);

// A kernel thread blinks concurrently with main.
const blinker = new Thread(0, { stackKb: 2 });
blinker.start((): void => {
  while (true) {
    led.toggle();
    Time.sleep(250);
  }
});
blinker.join();
```

Bus singletons from `@typecad/board` are directly usable — the board
exports functional instances (no strings, no construction, and unavailable
buses are simply not exported):

```ts
import { UART0 } from '@typecad/board';

UART0.writeLine('hello');         // usart1, default 115200
```

Explicit construction remains for non-default facts, and takes the board
instance or the name; targets and sensors carry the bus instance and the
7-bit address / chip-select from construction:

```ts
import { I2C0, SENSOR, CHAN } from '@typecad/board';

// device() hands back the FUNCTIONAL target — verbs callable immediately,
// and the same object is the Sensor fact-carrier.
const dev = I2C0.device(0x44);
dev.writeReg(0x30, 0xA2);   // i2c_reg_write_byte

const sht3x = new Sensor(SENSOR.sensirion_sht3xd, I2C0.device(0x44));
sht3x.fetch();
const temp = sht3x.get(CHAN.AMBIENT_TEMP);

// Explicit construction is equivalent: new I2CTarget(I2C0, 0x44).
```

## Hardware tests

The [`tests/`](./tests/) directory is the HAL hardware suite — the on-metal
proof that the HAL works. It runs via
[`@typecad/expect`](../expect/README.md) (`describe()` / `.it()` /
`.expect()` / `done()`) over the board's console, and one shared suite
covers every board:

- **`tests/common/`** — board-agnostic groups, one file per subsystem:
  timing, math, random, shift, interrupts, UART, I2C, ADC, WDT, Store,
  File, async, constants, Counter.
- **`tests/board/`** — board-level groups (GPIO, PWM, SPI, LED). These
  import **role names** from the `@typecad/test-pins` virtual module
  (`GPIO_OUT`, `PWM_PIN`, `ADC_PIN`, `I2C_BUS`, …); each board's
  `boards/<name>/test-pins.json` declares which pins fill each role, and the
  runner substitutes them before transpiling. A file whose required roles
  (declared with `// @typecad-requires-roles …`) are absent skips cleanly —
  coverage differences are data, never per-board test copies.
- **`tests/network/`** — on-hardware HTTP/MQTT/BLE suites against a local
  host server (see [`tests/network/README.md`](./tests/network/README.md)).
- **`tests/wired/`** — opt-in loopback tier (jumper `gpioOut` → `gpioIn`);
  not part of the default runs.

Each board has a config in [`boards/`](./boards/) (currently the WeAct
Black Pill STM32F411 and the ESP32-S3 DevKitC). Run a suite:

```bash
npm run test:hw --workspace @typecad/hal            # Black Pill (ST-Link + console UART)
npm run test:hw:esp32s3 --workspace @typecad/hal    # DevKitC (esptool + CH34x console)
```

The `[TC:...]` test protocol rides the board's console (its devicetree
`zephyr,console` node). Port resolution: `--port` / `CUTTLEFISH_PORT` wins,
then `test.port` in the board's config, then USB-identity discovery
(`test-pins.json` carries `usb: { vid, pid }` — e.g. the DevKitC's CH34x
bridge `1A86:55D3`), and the port re-resolves after every flash
re-enumeration. A program that also constructs `USB0` composes a CDC device
enumerating at the shared Zephyr-test identity `2FE3:0001`.

### Board parity and documented hardware limits

Every board runs every group its silicon supports. Gaps are hard hardware
limits expressed as role skips: the ESP32-S3 DevKitC declares no I2C
controller and no `led0` node (and its UART0 is the protocol channel), so
those groups skip there by role. Everything else — GPIO, PWM, ADC (both
SARADC units), SPI, timing, math, random, shift, interrupts, WDT, Store,
File, async, constants, Counter — runs on both boards.

`Sensor` and `DAC` have a full pipeline (catalog → devicetree
synthesis → Zephyr driver API) but no sensor or DAC-capable board on the
current rig, so they are compile-verified only until one is attached. The
network tier needs the host server (`npm run test:http`) and credentials in
`tests/network/secrets.ts`.

## Ecosystem

- [`@typecad/cuttlefish`](../../README.md) — the transpiler that resolves HAL calls to C++.
- [`@typecad/framework-zephyr`](../framework-zephyr/README.md) — the Zephyr lowering, board catalog, and toolchain.
- [`@typecad/expect`](../expect/README.md) — the on-hardware test framework.
- [`@typecad/ui`](../ui/README.md) — HTML/CSS-driven display graphics.

## License

MIT
