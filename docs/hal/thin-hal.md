# The Thin HAL

The thin HAL is TypeCAD's Zephyr-first surface: one class per peripheral, Zephyr's own verbs, construction facts instead of runtime configuration. Every method lowers to **one Zephyr call** (or one inlinable sequence) with no semantic translation — no duty scaling, no mode strings, no APIs Zephyr can't honor. The names are Zephyr's verbatim under a namespace dot, so any Zephyr doc greps straight into your code.

Every class follows the same shape:

- **Construction carries the facts.** Pin, flags, period, gain, baud, stack size — the constructor's arguments become devicetree nodes, Kconfig, or state blocks. There is no `begin()`, no `setClock()`, nothing to order.
- **Tokens are Zephyr's enums.** `GPIO.OUTPUT | GPIO.PULL_UP` ↔ `GPIO_OUTPUT | GPIO_PULL_UP`, `ADC.GAIN_1_4` ↔ `ADC_GAIN_1_4`, `CHAN.AMBIENT_TEMP` ↔ `SENSOR_CHAN_AMBIENT_TEMP`. The token name sets are generated from the pinned Zephyr tree's headers (`scripts/gen-zephyr-hal-tokens.mjs`) and re-validated at build time — a misspelled token is an editor-visible member error, and an unknown combination is a build error naming the valid spellings.
- **Units are Zephyr's.** Nanoseconds for PWM time, Hz for construction clocks, millivolts, raw ADC counts, Zephyr priority numbers. No 0–255, no 0–1023.

```typescript
import { GPIO, PWM, ADC, Time, Thread, LED, ANY_PIN } from '@typecad/hal';

const led = new GPIO(LED, GPIO.OUTPUT);            // gpio_pin_configure_dt + set/toggle
const dimmer = new PWM(ANY_PIN, { periodNs: 20_000_000 }); // 50 Hz from construction
const sense = new ADC(ANY_PIN);             // channel setup = construction

const worker = new Thread(0, { stackKb: 4 });
worker.start((): void => {
  while (true) {
    dimmer.setDuty(sense.read() / 4095);          // one pwm_set_pulse_dt
    led.toggle();
    Time.sleep(100);                              // k_msleep
  }
});
```

Per-family docs: [Networking](./networking.md) (WiFi / Request / Mqtt), [Persistence](./persistence.md) (File / Store), [Async](./async.md) (the cooperative tier), [Sensors](./sensors.md), plus [Communication](./communication.md) (buses and consoles), [GPIO](./gpio.md), [Analog & PWM](./analog-pwm.md), [Events](./events.md), [Ownership](./ownership.md), and the small stateless surfaces in [Utilities](./utilities.md) (shift / random / math).

## Time

`Time` is the timing surface (the Arduino-named `delay`/`millis` went with the Arduino framework):

- `Time.sleep(ms)` → `k_msleep` — yielding sleep; in the generated single-threaded main this blocks the caller, `delay()`'s semantics JS-spelled. Inside an `async function`, `await Time.sleep(ms)` becomes cooperative: the async state machine arms a deadline and yields (timers and other tasks run) until it passes — the same machinery `await delay()` rides.
- `Time.now()` → `k_uptime_get()` as a double — milliseconds since boot, monotonic, no uint32 wrap (`Date.now()`-shaped).
- `Time.nowUs()` → uptime-derived microseconds (`k_uptime_get() * 1000`) on every board — the uniform, monotonic expression; resolution is the uptime tick (for sub-ms determinism use `Counter`).
- `Time.busyWaitUs(us)` → `k_busy_wait` — the honest name for a spin with no schedule point.

## GPIO

`new GPIO(pin, flags)` — flags are Zephyr's config names under `GPIO.`: `INPUT`, `OUTPUT`, `OUTPUT_INIT_LOW/HIGH` (the initial level configured atomically — no configure-then-write glitch window), `PULL_UP`, `PULL_DOWN`, `OPEN_DRAIN`, `OPEN_SOURCE`, `DISCONNECTED`. The configure applies once per pin, ahead of first use.

- `set(v)` / `get()` / `toggle()` → `gpio_pin_set_dt` / `get_dt` / `toggle_dt`. **Logical levels**: a pin with a board devicetree alias (LED, BUTTON) honors its `GPIO_ACTIVE_LOW` flag, so `set(true)` means "on" and an unpressed active-low button reads `false`. Pins without an alias take the raw-controller path (physical polarity).
- `onInterrupt(GPIO.INT_EDGE_FALLING, fn)` → `gpio_pin_interrupt_configure_dt` + the callback chain, with INT tokens covering the level modes the legacy strings couldn't express. `offInterrupt()` detaches.

## PWM

`new PWM(pin, { periodNs })` — **the period is a construction fact** (Zephyr's model: the period lives with the channel). The first use applies it (`pwm_set_dt` with an idle pulse), then:

- `setPulse(ns)` → `pwm_set_pulse_dt`, verbatim.
- `setDuty(0.0–1.0)` — sugar lowering to exactly one `pwm_set_pulse_dt` against the known period. No 0–255 anywhere.
- `setPeriod(ns)` → `pwm_set_dt`; Zephyr 4.4 has no period-only setter, so the pulse resets to idle — follow with `setPulse`/`setDuty`.

On matrix-routed chips (ESP32 LEDC) any listed pad works; channels are assigned at build time over the pins the program actually drives.

## ADC

`new ADC(pin, { gain?, reference? })` — construction **is** the channel setup (exactly `struct adc_channel_cfg`'s fields; tokens from `enum adc_gain`/`enum adc_reference`). Omitted options fall back to the chip descriptor's pair — the values the platform's driver validates against.

- `read()` → raw counts at the chip's resolution.
- `readMillivolts()` → `adc_raw_to_millivolts`.

There is deliberately no `setReference()` — Zephyr applies it at channel-setup time; the surface doesn't promise runtime switching. A pin with no ADC channel is a `zephyr-adc-pin-unavailable` diagnostic naming the valid pins.

## DAC, Watchdog, Counter

- `new DAC(pin, { resolution? })` → lazy `dac_channel_setup` + `write(rawCode)` → `dac_write_value`. Raw codes — the channel's resolution decides the range.
- `new Watchdog(timeoutMs)` → `enable()` arms (`wdt_install_timeout` + `wdt_setup`, reset-CPU-core), `feed()` keeps it alive. Milliseconds from construction; no WDTO presets, no string parsing.
- `new Counter(instance, { hz })` → Zephyr's counter driver: `onAlarm(fn)`, `start()` (applies hz as the top value — no ordering constraint), `stop()`.

## I2CTarget / SPITarget / UART

The buses speak Zephyr's device model — an address or chip-select peer, not a Wire transaction:

```typescript
import { I2CTarget, SPITarget, UART, ANY_PIN } from '@typecad/hal';

const sht = new I2CTarget('I2C0', 0x44, { hz: 400_000 });
sht.writeReg(0x30, 0xA2);              // i2c_reg_write_byte
const id = sht.readReg(0x32);          // i2c_reg_read_byte
sht.updateReg(0x30, 0x0F, 0x02);       // i2c_reg_update_byte — atomic RMW, no read-back race
sht.write([0x2C, 0x06]);               // i2c_write (raw bytes)

const flash = new SPITarget('SPI0', ANY_PIN, { hz: 10_000_000, mode: 0 });
const buf = new Uint8Array(4);
flash.transceive([0x9F], buf);         // spi_transceive_dt — hardware CS, fills YOUR buffer
flash.write([0x06]);                   // spi_write_dt

const gps = new UART('UART0', { baud: 9600 });
gps.write('$PMTK220,1000*1F\n');       // uart_poll_out
const c = gps.read();                  // pop the oldest byte from the RX ring, or -1 when empty
```

- `SPITarget` construction emits a devicetree child node (merged `cs-gpios`, `spi-max-frequency`, mode bits) — **hardware chip select**; the verbs address a static `spi_dt_spec`.
- `UART` TX is poll-based (`uart_poll_out`); **RX is interrupt-backed** — the first receive call arms the driver's IRQ callback, which drains the FIFO into a construction-sized ring (`rxBufferBytes`, default 64; bytes arriving with a full ring are dropped — no unbounded buffering). On that ring: `available()` counts waiting bytes, `peek()` looks at the oldest without consuming, and `read()` pops it (−1 when empty). The construction fact sizes the shim's static buffer.

## Thread

`new Thread(index, { stackKb?, priority? })` — a real kernel thread. `start(fn)` → `k_thread_create(…, K_NO_WAIT)` through a per-slot entry trampoline (the closure registers like any callback); `join()` → `k_thread_join(…, K_FOREVER)`. The stack is sized by the construction `stackKb` (default 2 kB); priority defaults to 5 (Zephyr's scale — negative would be cooperative). `join()` without a prior `start()` on the index is a build error naming the slot.

## Sensor

`new Sensor(SENSOR.sensirion_sht3xd, I2C1.device(0x44))` — see [Sensors](./sensors.md). The generic catalog (215 parts, generated from Zephyr's bindings) predates the thin HAL and set the pattern every class above follows.

## What the build does

Construction facts never become runtime state: they become devicetree nodes (sensors, SPI targets, PWM channels), usage-gated Kconfig, per-instance state blocks (device handles, stacks, `spi_dt_spec`s), or guarded one-time runtime calls (`i2c_configure`, `uart_configure`) — whichever is the honest Zephyr shape for that peripheral. Pin conflicts between peripherals are caught at build time, and peripheral-pin validity (analog-capable, PWM-capable, DAC channels) surfaces as diagnostics naming the valid pins on your board.

## What is deliberately not here

- `LEDStrip` — the current Zephyr ws2812 bindings require per-SoC timing symbols the binding docs call hardware-specific; it ships when a verified per-board timing table exists.
- `Temperature` — folds into `Sensor` (a DT-bound die-temp part) when the catalog grows a no-bus case.
- The Arduino-named surface (`OutputPin`, `Wire`-shaped buses, `delay`…) is gone — the Arduino framework target was removed outright.
