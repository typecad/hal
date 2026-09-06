# zephyr-blackpill

STM32 peripheral showcase on a **WeAct Studio Black Pill V2.0**
(STM32F411CEU6) using `@typecad/framework-zephyr` — the first STM32
Zephyr target. The demo reads the ADC channel on PA0 (ADC1_IN1) and
reports the reading in millivolts over the USB CDC console (`USB0`)
once a second.

## What it exercises

| Peripheral | Pin | How it lowers |
|---|---|---|
| ADC channel | PA0 | `ADC` (`ADC1_IN1`) — `read()` raw counts, `readMillivolts()` scaled |
| USB CDC console | — | `USBConsole` (`USB0`) — board-gated: the board must declare a USB device controller |

```ts
import { USB0, Time, LED, PA0, ADC } from '@typecad/board';

const adc = new ADC(PA0)
USB0.open();

while (true) {
  USB0.writeLine(`adc: ${adc.readMillivolts()}`)

  Time.sleep(1000);
}
```

## Pipeline

```
TypeScript  →  cuttlefish build  →  generated C++  →  west build  →  west flash
```

Transpile only (no Zephyr SDK needed):

```sh
npm run build      # → src/out/src/src.cpp + src.h (+ CMakeLists.txt, prj.conf, overlay)
```

Compile + flash (requires the prerequisites below):

```sh
npm run compile    # → west build -b blackpill_f411ce/stm32f411xe
npm run upload     # → compile, then west flash via the selected probe
```

## Flashing the Black Pill

Two supported paths, selected by the `zephyr` section in `cuttlefish.config.ts`:

**ST-Link (SWD) — the demo's default.** The config sets
`zephyr: { probe: 'stlink' }` — `stlink` is one of the board's named probe
methods, and it serves BOTH flashing and debugging, resolving to the openocd
runner plus the args the method needs (the `reset_config none` quirk for
unwired SRST lives in the board's generated data, not here). openocd ships with the
Zephyr SDK (the framework puts it on the spawned west's PATH automatically),
so wiring SWDIO/SWCLK/GND/3V3 to an ST-Link and running `npm run upload`
just works — no BOOT0 dance, and the target is reset to run after flashing.

**USB DFU (no probe).** The STM32F411 ships with a DFU bootloader in ROM:
hold **BOOT0**, tap **NRST**, release, and the board enumerates as a DFU
device. Remove the `zephyr` section (the board's default probe is dfu) — or
override one-off with `npx cuttlefish build --compile --upload --probe dfu`
— and run `npm run upload`. On Windows a one-time
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
