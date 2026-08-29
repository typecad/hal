# zephyr-blackpill

STM32 peripheral showcase on a **WeAct Studio Black Pill V2.0**
(STM32F411CEU6) using `@typecad/framework-zephyr` — the first STM32
Zephyr target. An analog light-dimmer: reads PA1 (ADC1_IN1) and mirrors the
voltage onto PB6 (TIM4_CH1 PWM), the onboard LED (PC13) heartbeats, and the
KEY button (PA0) flips between dimmer and breathing modes.

## What it exercises

| Peripheral | Pin | How it lowers |
|---|---|---|
| Onboard LED | PC13 | `led0` DT spec — `GPIO_ACTIVE_LOW` honored by `gpio_pin_set_dt` |
| KEY button | PA0 | `sw0` DT spec (gpio-keys, active-low + pull-up) |
| PWM | PB6 | Synthesized spec: the overlay generator creates a `pwm-leds` consumer + `tc-pwm22` alias for TIM4_CH1 (20 ms period) |
| ADC | PA1 | `adc1` node, STM32 channel setup (`ADC_GAIN_1` + `ADC_REF_INTERNAL`, vref = VDDA 3300 mV); the overlay muxes exactly the read channels' pads to analog via pinctrl |

```ts
import { LED, BUTTON, A1, PB6 } from '@typecad/board';
import { GPIO, ADCChannel, PWM, Time } from '@typecad/hal';

const led = new GPIO(LED, GPIO.OUTPUT);
const sense = new ADCChannel(A1);
const dimmer = new PWM(PB6, { periodNs: 20_000_000 });

function loop(): void {
  const mv = sense.readMillivolts();       // → adc_raw_to_millivolts(3300, ADC_GAIN_1, 12, …)
  dimmer.setDuty(mv / 3300);               // → pwm_set_pulse_dt(&__tc_pwm_tc_pwm22, …)
  led.toggle();
  Time.sleep(20);
}
```

## Pipeline

```
TypeScript  →  cuttlefish build  →  out/src/main.cpp  →  west build  →  west flash
```

Transpile only (no Zephyr SDK needed):

```sh
npm run build      # → out/src/main.cpp + main.h
```

Compile + flash (requires the prerequisites below):

```sh
npm run compile    # → west build -b blackpill_f411ce/stm32f411xe
npm run flash      # → west flash (dfu-util)
```

## Flashing the Black Pill

Two supported paths, selected by the `zephyr` section in `cuttlefish.config.ts`:

**ST-Link (SWD) — the demo's default.** The config sets
`zephyr: { runner: 'openocd', runnerArgs: ['--cmd-pre-init=reset_config none'] }`.
openocd ships with the Zephyr SDK (the framework puts it on the spawned
west's PATH automatically), so wiring SWDIO/SWCLK/GND/3V3 to an ST-Link and
running `npm run upload` just works — no BOOT0 dance, and the target is
reset to run after flashing. The `reset_config none` matters: most ST-Link
setups don't wire the SRST line to the Black Pill's RST pad, and without it
openocd's default `reset init` times out waiting for the target to halt
(SYSRESETREQ-based reset works without the line).

**USB DFU (no probe).** The STM32F411 ships with a DFU bootloader in ROM:
hold **BOOT0**, tap **NRST**, release, and the board enumerates as a DFU
device. Remove the `zephyr` section (the board default runner is dfu-util,
which the typeCAD Zephyr installer provides inside the env on Windows) and
run `npm run upload`. On Windows a one-time
[Zadig](https://zadig.akeo.ie/) driver install may be needed for the DFU
device.

Note: SWD flashing is also the debugging path — `west debug` / the
framework's debug tooling use the same ST-Link via openocd+GDB.

## Prerequisites

The transpile step runs anywhere. Compile/flash require a Zephyr toolchain,
but **you do not need to activate the Python venv manually** — the framework
discovers `west` automatically ($ZEPHYR_BASE sibling venv, well-known
workspace layouts, or system Python). You will need:

1. A **Zephyr SDK** (e.g. `~/zephyr-sdk-0.17.4`, arm-zephyr-eabi toolchain).
2. A **Zephyr workspace** with `west` in its `.venv` (e.g. `~/zephyrproject`).
3. A **Black Pill V2.0** (genuine WeAct — some clones ship a wrong D+ pull-up
   resistor, R10, which makes USB flaky).

The toolchain scaffolds `CMakeLists.txt`, `prj.conf`, and the devicetree
overlay automatically at compile time (idempotent), then invokes
`west build -b blackpill_f411ce/stm32f411xe`.
