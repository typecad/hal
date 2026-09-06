# zephyr-nano-33-iot

SAMD21 peripheral showcase on an **Arduino Nano 33 IoT** (Microchip
SAMD21G18A, Cortex-M0+ @ 48 MHz) using `@typecad/framework-zephyr` — the
first Microchip SAM Zephyr target. An onboard-LED mood light: the LED
(PA17 — TCC2/WO1 PWM via the board's `pwm-led0` DT alias, exposed
pre-constructed as `PWMLED`) alternates every ~2 s between a steady
half-brightness dimmer and a breathing mode (the board has no user button),
with periodic USB CDC reports over the micro-USB connector.

## What it exercises

| Peripheral | Pin | How it lowers |
|---|---|---|
| Onboard LED | PA17 | The board-shipped `pwm-led0` alias, pre-constructed in the board module as `PWMLED` (`PWM_DT_SPEC_GET(DT_ALIAS(pwm_led0))`); `setDuty` is a 0.0–1.0 fraction |
| USB CDC | PA24/PA25 | `zephyr_udc0` → one `cdc_acm_uart0` instance composed by the overlay generator; `USB0.open()` + `linked()`-gated `writeLine` reports |

WiFi/BLE (the onboard NINA-W102) and the watchdog are **unsupported** on
this target — see the generated board module (`.cuttlefish/board.ts`) for
the full capability notes.

```ts
import { PWMLED, USB0 } from '@typecad/board';
import { Time } from '@typecad/hal';

USB0.open();

while (true) {
  PWMLED.setDuty(0.5);        // → PWM_DT_SPEC_GET(DT_ALIAS(pwm_led0))
  USB0.writeLine('mode: dimmer');
  Time.sleep(20);
}
```

## Getting started

```sh
npm install
npm run build          # transpile → src/out/src/src.cpp
npm run compile        # + west build for arduino_nano_33_iot/samd21g18a
npm run upload         # + west flash (BOSSA USB bootloader — double-tap
                       #   reset first; no probe needed)
npm run monitor        # + serial monitor on the USB CDC port
npm run simulate       # fast logic tier — vitest, no hardware
npm run test:hw        # flash + run tests/ on the board (@typecad/expect)
```

Flashing uses the board's named probe methods: `bossac` (default here —
built-in USB bootloader, no debug), or `openocd`/`jlink` on the SWD pads on
the board underside for debugging (`--probe openocd`).

**Bootloader entry (bossac only):** normally automatic — cuttlefish's CDC
firmware implements Arduino-style 1200-baud touch-to-reset, and the bossac
upload path performs the touch (open the console port at 1200 baud → the
firmware reboots into the BOSSA bootloader → bossac flashes it). The
double-tap reset button is only needed if the board is running non-cuttlefish
firmware that doesn't implement the touch, or if the touch times out. The
board's USB identity tells you what state it is in:

| USB VID:PID | Meaning |
|---|---|
| `2341:8057` | Arduino factory sketch running (implements the touch itself) |
| `2341:0057` | BOSSA bootloader — ready to flash |
| `2FE3:0001` | Cuttlefish firmware running (touch-capable, default CDC PID) |

Override the serial port with `--port` (the config's `COM8` default is
bring-up specific). After the first cuttlefish flash the board enumerates
at the Zephyr-test default `2FE3:0001` (shared by every Zephyr CDC board);
set `test.usb: { vid: '2FE3', pid: '0001' }` in cuttlefish.config.ts to let
identity matching track the COM number across re-enumerations.

## Layout

- `src/main.ts` — the firmware (transpiled to C++ by cuttlefish)
- `sim/` — simulator tests (pure logic, runs in Node)
- `tests/` — hardware tests (flashed and run on the board)
- `src/out/` — generated C++/Zephyr project (do not edit)
