# zephyr-nano-33-iot

SAMD21 peripheral showcase on an **Arduino Nano 33 IoT** (Microchip
SAMD21G18A, Cortex-M0+ @ 48 MHz) using `@typecad/framework-zephyr` — the
first Microchip SAM Zephyr target. An analog LED dimmer: reads A0
(PA2 / ADC AIN0) and mirrors the voltage onto the onboard LED's brightness
(PA17 — TCC2/WO1 PWM via the board's `pwm-led0` DT alias), alternating every
~2 s with a breathing mode (the board has no user button), with periodic
USB CDC reports over the micro-USB connector.

## What it exercises

| Peripheral | Pin | How it lowers |
|---|---|---|
| Onboard LED | PA17 | `led0` DT spec (active-high) — and the same pin's PWM through the board-shipped `pwm-led0` alias (`PWM_DT_SPEC_GET(DT_ALIAS(pwm_led0))`, 20 ms period) |
| ADC | PA2 (A0) | `adc` node, sam0 channel setup (`ADC_GAIN_1` + `ADC_REF_VDD_1_2`, vref = VDDANA/2 = 1650 mV — the only combination the Zephyr sam0 driver accepts on this SoC; reads saturate above ~1.65 V, so keep the input at or under half-scale, e.g. a pot's wiper) |
| USB CDC | PA24/PA25 | `zephyr_udc0` → one `cdc_acm_uart0` instance composed by the overlay generator; `USB0.begin()` + `printf` reports |

WiFi/BLE (the onboard NINA-W102) and the watchdog are **unsupported** on
this target — see the board package for the full capability notes.

```ts
import { LED, A0, USB0 } from '@typecad/board';
import { delay } from '@typecad/hal';

const led = LED.asOutput(false);
const sense = A0.asInput();

function loop(): void {
  const mv = sense.readVoltage();          // → adc_raw_to_millivolts(1650, ADC_GAIN_1, 12, …)
  led.pwm(mv / 7);                         // → pwm_set_pulse_dt(pwm-led0 spec, …)
  delay(20);
}
```

## Getting started

```sh
npm install
npm run build          # transpile → out/src/main.cpp
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
| `2FE3:0003` | Cuttlefish firmware running (touch-capable, our CDC PID) |

Override the serial port with `--port` (the config's `COM8` default is
bring-up specific). After the first cuttlefish flash the board enumerates
as `2FE3:0003`; set `test.usb: { vid: '2FE3', pid: '0003' }` in
cuttlefish.config.ts to let identity matching track the COM number across
re-enumerations.

## Layout

- `src/main.ts` — the firmware (transpiled to C++ by cuttlefish)
- `sim/` — simulator tests (pure logic, runs in Node)
- `tests/` — hardware tests (flashed and run on the board)
- `out/` — generated C++/Zephyr project (do not edit)
