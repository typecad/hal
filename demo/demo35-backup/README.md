# Debounced button + mode state — cuttlefish demo #35 (Arduino AVR)

The classic embedded input pattern: read a momentary pushbutton, debounce it in
software with a time gate, detect the press EDGE (one event per physical press,
not per polling loop), and advance a state machine. Each press cycles a mode
counter (0→1→2→3→0…); the on-board LED reflects the mode's low bit and the new
mode is printed to Serial.

This is the **first demo to exercise digital INPUT + a timing-based debounce
state machine**. Where demo #34 read an analog value and demo #33 did pure
computation, this one reads a digital pin with `inputPullUp` (an unpressed
button reads HIGH via the internal pull-up; a press pulls it LOW), stores that
reading in a variable across loop iterations, and uses `Timing.millis()` as a
monotonic clock for the debounce window.

Transpiled to C++ by cuttlefish (`@typecad/framework-arduino`), compiled for
`arduino:avr:uno`, uploaded, and verified live on a connected Uno.

## Running

```bash
npm run lint      # ESLint with the cuttlefish transpiler-rules plugin
npm run compile   # transpile TS -> C++ (.ino) and compile with avr-gcc
npm run upload    # compile + upload to the Uno on COM7 + open serial monitor
```

- **`npm run compile` exits 0** on the first attempt — **no transpilation
  errors**. `avr-gcc` emits no errors and no warnings. Memory usage on an
  ATmega328P (Arduino Uno):

  ```
  Flash: 4.3 KB / 31.5 KB (14%)
  RAM:   226 B / 2.0 KB (11%)
  Heap:  1.8 KB available
  ```

- **`npm run upload`** flashes the Uno and streams the serial monitor at 9600
  baud. Captured live output at boot (the sketch then waits for a physical
  button press on D2 to advance the mode):

  ```
  --- debounced button demo ---
  mode=0 led=off
  ```

  On each press of the D2 button, it prints the next mode and toggles the LED
  to the mode's low bit:

  ```
  mode=1 led=on
  mode=2 led=off
  mode=3 led=on
  mode=0 led=off
  ...
  ```

## Hardware

Wire a momentary pushbutton between **D2** and **GND**. With the internal
pull-up enabled (`D2.inputPullUp()`), the pin reads HIGH when the button is
open and LOW when pressed — no external resistor needed. The on-board LED
(D13) toggles with the mode's low bit so state changes are visible without the
serial monitor.

## Why the program is shaped the way it is

The HAL lowering and the AVR target shape the structure:

- **Pins come from `@typecad/board-arduino-uno`.** `D2.inputPullUp()` lowers to
  `pinMode(2, INPUT_PULLUP)` and returns an `InputPin` alias (`btn`);
  `LED.asOutput()` lowers to `pinMode(13, OUTPUT)`. `btn.read()` lowers to
  `digitalRead(2)`; `led.high()`/`led.low()` lower to `digitalWrite(13, ...)`.
  No class is emitted for the pins.
- **`btn.read()` is stored in a variable and reused.** This is a value-bearing
  HAL op (`gpioRead` → `digitalRead`). It works correctly because of demo #34
  Finding B's fix — the read is captured into a real `auto raw = digitalRead(2)`
  and `raw` is referenced at every use site (it does not collapse to the pin
  number `2`). So this demo directly re-tests that fix for the digital path.
- **`Timing.millis()` lowers to `millis()`** — the monotonic millisecond clock
  used for the debounce window. A reading must be stable for `DEBOUNCE_MS`
  (20 ms) before it is accepted as a real edge.
- **Owned state is module-level scalars**, not a `new`'d class. AVR has no heap
  manager, so `new` is rejected by `heap-allocation-avr` (demo #34 Finding A).
  The debounce state (last accepted level, last change time, mode counter,
  previous level) is a handful of module-level scalars — the AVR-correct shape.
- **Edge detection** compares the current debounced level against the previous
  poll's level (`prevLevel`); a press is the HIGH→LOW transition. This fires
  exactly once per physical press regardless of how long the button is held or
  how fast the loop polls — the point of debounce + edge-detect.

## Transpilation issues found by Demo #35

**None.** This demo compiled clean on the first attempt and ran correctly on
hardware. It served as a **regression check** for the demo #34 fixes rather
than surfacing new bugs:

- The **stored digital read** (`const raw = btn.read()`) exercised demo #34
  Finding B's fix on the `gpioRead`/`digitalRead` path (the earlier demo used
  `adcRead`/`analogRead`). It captures correctly.
- The **`btn`/`led` pin aliases referenced from the `debounce`/`report`
  helpers** exercised demo #34 Finding C's order-independent resolution. The
  helpers are declared before the `const btn = D2.inputPullUp()` aliases yet
  inline correctly.
- The **inline ternary in `report`** (`'led=' + (mode % 2 === 1 ? 'on ' : 'off')`)
  exercised demo #34 Finding D's fix. It compiles without the invalid `.c_str()`.

So the demo #34 fix work is confirmed end-to-end on a second, independent
program — the natural-form debounce sketch Just Works with no workarounds.

## What this demo intentionally does NOT cover

To keep the program focused, demo #35 does **not** exercise:

- **Interrupt-driven button input** (`D2.onFalling(callback)`) — the ISR
  extraction path has `.skip`'d tests (a separate gap); this demo uses polling
  instead, which is the simpler and fully-supported approach.
- PWM output, `Map`/`Set`, `extends`/`super`, `try`/`catch`, async — out of
  scope for a digital-input demo. Each is its own future demo.

The previous iteration (#34, blink + ADC) is preserved in `demo34-backup/`.
