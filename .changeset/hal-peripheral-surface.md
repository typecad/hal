---
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
'@typecad/hal': minor
---

The peripheral surface round — nine new hardware classes, one import

Everything below hangs off the single `@typecad/hal` import and the
generated board module, and each class re-exports only where this board's
facts support it (GATED_EXPORTS — the narrowed-gateway rule):

- **Servo** — hobby RC servo output on a PWM channel: a calibrated 50 Hz
  wrapper over the thin PWM class. Construction opts carry the servo's
  calibrated pulse range (`minUs`/`maxUs`, defaults 1000/2000) and optional
  travel (`maxAngle`, default 180); `writeAngle` maps the angle onto that
  range in the LOWERED C++ (runtime arithmetic against a runtime angle — it
  cannot fold at transpile time), and every write clamps to the calibrated
  range so a stray value cannot command a damaging pulse width. `idle()`
  stops driving the pulse — most servos stop actively holding position
  without pulses.
- **Strip** — addressable RGB LED strip (WS2812/SK6812) over one of the
  board's wired SPI buses: Zephyr's ws2812-spi driver synthesizes the
  waveform on the bus's MOSI line, so whatever pads the board's devicetree
  routes that SPI to are the pads the strip can use. `count` is a
  construction fact (the pixel buffer is sized at build time);
  set/fill/clear edit the buffer only and `show()` flushes it — one wire
  transaction per show, the Arduino-Neopixel discipline.
- **Keyboard / Mouse** — USB HID devices over the Zephyr "next" USB stack
  (`zephyr,hid-device`). One HID interface per program (Keyboard OR Mouse,
  a v1 ceiling). `begin()` registers the boot report descriptor and starts
  the device stack; the verbs maintain the boot report in the lowered C++
  (an 8-byte keyboard report — modifier byte + 6 key slots; a 4-byte mouse
  one — buttons + relative x/y/wheel) and each verb submits one input
  report. Key and button arguments are `KEY.*`/`MOUSE.*` tokens mapped
  name-for-name onto Zephyr's HID_KEY_* / button macros.
- **Matrix** — GPIO key-matrix scanning over the Zephyr input subsystem
  (gpio-kbd-matrix): the driver scans the row/column grid and reports each
  key event as ABS_X (column) + ABS_Y (row) + BTN_TOUCH (press state); the
  lowered shim decodes that triple and trampolines into the user callback
  as (row, col, pressed). Idle mode is interrupt-on-row — no CPU while
  idle.
- **Clock** — wall-clock time over the board's RTC device: boards with a
  hardware calendar RTC alias it (Zephyr's `rtc` convention), and every
  board with a free counter can carry one via the `zephyr,rtc-counter`
  shim the generated overlay synthesizes (a CHILD of the counter node —
  the counter driver, and the Counter class with it, keep the parent), so
  Clock exports wherever a free counter exists. v1 semantics: set/now
  within a power session; only hardware-calendar nodes retain time across
  power loss.
- **CAN** — the thin Zephyr-shaped CAN bus: one controller per board (the
  harvested `can@` node — ESP32 TWAI, STM32 bxCAN, NXP FlexCAN…),
  addressed by its devicetree nodelabel. `begin()` applies mode + bitrate
  + start in the order the classic controller requires (it must stop for
  mode/bitrate changes); `send()` builds one can_frame and submits it;
  `onReceive()` installs an accept-all filter whose callback carries the
  frame as scalars. LOOPBACK is the zero-hardware bench mode —
  `begin({ loopback: true })` and every sent frame loops back to your own
  filter: no transceiver, no wiring.
- **I2S** — the thin Zephyr-shaped audio stream (the harvested `i2s@`
  node): the verbs own their setup (the PWM first-use discipline) — the
  first `write()` configures + starts TX, the first `read()` RX, so a
  write-only program (tone to an amplifier) never touches the RX engine.
  Samples are 16-bit; one block per call (blockFrames stereo frames,
  zero-padded on short writes). The one-jumper hardware loopback is the
  bench test.
- **I2CResponder** — this board AS an I2C target (slave mode): the mirror
  of I2CTarget, where the board talks to a device at an address — here the
  board ANSWERS at one. Zephyr's i2c_target API verbatim in shape:
  registration behind a once-guard, a controller write landing in the
  receive ring (the UART discipline: `available()`/`read()` poll it,
  `onReceive(len)` announces at the transaction's STOP), and a controller
  read draining the response buffer the user fills with `write()`
  (`onRequest` fires as the read begins — the Wire onRequest semantic).
  Callbacks fire in the driver's interrupt context — the ISR discipline.
- **Power** — explicit power-state entry: the CPU node's declared
  power-states are the facts (harvested into `zephyr.power.states.*`);
  light states belong to the idle POLICY, while the deepest state
  ("soft-off") is explicit-entry only — per Zephyr's own devicetree
  comment — and that is exactly this class's surface. `offFor(ms)` is the
  timed wake (the battery pattern: read sensors, publish, offFor(60_000),
  repeat).
- **1-Wire sensors** — the DS18B20 through the existing Sensor class:
  construction is a data-line Pin (bit-banged w1-gpio master, synthesized
  in the overlay) plus the resolution opt; fetch/get are the same shape as
  every bus sensor.
- **Simulator** — `@typecad/hal/sim` gains the i2c-responder bus sim.
- **Engine** — every verb is a structured hal-op IR node (`pwm.servo_*`,
  `strip.*`, `hid.kb_*`/`hid.mouse_*`, `clock.*`, `can.*`, `power.*`,
  `matrix.on_key`, `i2c.resp_*`) with Zephyr lowerings, hal-resolution
  tests for each class, and hardware tests in the hal suite (servo, strip,
  HID keyboard/mouse, matrix, onewire on the rig; clock, can, i2s common).
