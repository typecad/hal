// Board-package Zephyr chip data for the Raspberry Pi Pico (RP2040) and
// Pico 2 (RP2350) — the resolveChipFromBoard() path. These boards ship their
// ZephyrChipDescriptor via the board package's `zephyr` field (flattened into
// board constants), NOT via framework-zephyr's hardcoded chip registry, so
// this test exercises the real flattener against the real board sources.
//
// Descriptor facts verified against Zephyr 4.3:
//   boards/raspberrypi/rpi_pico/rpi_pico-common.dtsi
//   boards/raspberrypi/rpi_pico2/rpi_pico2.dtsi
//   boards/raspberrypi/common/rpi_pico-led.dtsi (led0 = GP25, active-high)
//   boards/raspberrypi/common/rpi_pico-pinctrl-common.dtsi
//   dts/bindings/adc/raspberrypi,pico-adc.yaml (vref-mv default 3300)
//   drivers/usb/udc/udc_rpi_pico.c (next-stack UDC driver for both SoCs)

import { describe, it, expect } from 'vitest';
import { resolveBoardConstants } from '../../../packages/cuttlefish/src/ir/board-resolver';
import { resolveChipFromBoard } from '../../../packages/framework-zephyr/src/chips/resolve';

const rp2040Chip = resolveChipFromBoard(
  resolveBoardConstants('boards/board-rp2040/src/index.ts'),
);
const rp2350Chip = resolveChipFromBoard(
  resolveBoardConstants('boards/board-rp2350/src/index.ts'),
);

describe('board-rp2040 → ZephyrChipDescriptor', () => {
  it('resolves (the board package carries a zephyr build target + chip data)', () => {
    expect(rp2040Chip).not.toBeNull();
  });

  it("targets 'rpi_pico' for west build -b", () => {
    expect(rp2040Chip!.id).toBe('rpi_pico');
  });

  it('uses the single gpio0 controller (no controller split)', () => {
    expect(rp2040Chip!.gpioController).toBe('gpio0');
    expect(rp2040Chip!.gpioControllers ?? []).toEqual([]);
  });

  it('exposes the onboard LED on GP25 via the led0 DT alias', () => {
    expect(rp2040Chip!.gpio.dtSpecs).toContainEqual({ pin: 25, dtSpec: 'led0' });
  });

  it('declares no interrupt pins (mainline rpi_pico has no gpio-keys/sw0 alias)', () => {
    expect(rp2040Chip!.gpio.interruptPins ?? []).toEqual([]);
  });

  it("wires i2c0 + i2c1 / spi0 / uart0 (the board-pinned controllers — i2c1's GP6/GP7 pinctrl group ships in the board DT, the overlay enables it)", () => {
    expect(rp2040Chip!.i2c?.controllers).toEqual([{ nodeLabel: 'i2c0' }, { nodeLabel: 'i2c1' }]);
    expect(rp2040Chip!.spi?.controllers).toEqual([{ nodeLabel: 'spi0' }]);
    expect(rp2040Chip!.uart?.controllers).toEqual([{ nodeLabel: 'uart0' }]);
  });

  it('declares the USB device (zephyr_udc0 is status okay in rpi_pico-common.dtsi)', () => {
    expect(rp2040Chip!.usb).toEqual({ controller: 'zephyr_udc0', cdcInstances: 1 });
  });

  it('describes the console destination for the build note', () => {
    expect(rp2040Chip!.consoleDescription).toBe('uart0 on GP0 (TX) / GP1 (RX)');
  });

  it('declares named probe methods (uf2 bootloader, SWD probes — from board.cmake)', () => {
    const ids = (rp2040Chip!.probeMethods ?? []).map((m) => m.id);
    expect(ids).toEqual(['uf2', 'openocd', 'jlink']);
    const uf2 = rp2040Chip!.probeMethods!.find((m) => m.id === 'uf2')!;
    expect(uf2.runner).toBe('uf2');
    expect(uf2.debug).toBe(false);
    const jlink = rp2040Chip!.probeMethods!.find((m) => m.id === 'jlink')!;
    expect(jlink.debugDevice).toBe('RP2040_M0_0');
  });

  it('maps ADC channels GP26–GP29 → 0–3 at 12-bit / 3300 mV', () => {
    expect(rp2040Chip!.adc).toEqual({
      nodeLabel: 'adc',
      resolution: 12,
      vrefMv: 3300,
      channels: [
        { pin: 26, channel: 0 },
        { pin: 27, channel: 1 },
        { pin: 28, channel: 2 },
        { pin: 29, channel: 3 },
      ],
    });
  });

  it('exposes the wdt0 watchdog node', () => {
    expect(rp2040Chip!.wdt).toEqual({ nodeLabel: 'wdt0' });
  });

  it('declares no PWM specs (pwm_leds is disabled in mainline rpi_pico DTS)', () => {
    expect(rp2040Chip!.pwm?.specs ?? []).toEqual([]);
  });
});

describe('board-rp2350 → ZephyrChipDescriptor', () => {
  it('resolves (the board package carries a zephyr build target + chip data)', () => {
    expect(rp2350Chip).not.toBeNull();
  });

  it("targets the qualified 'rpi_pico2/rp2350a/m33' (hazard3/m33 have no default)", () => {    expect(rp2350Chip!.id).toBe('rpi_pico2/rp2350a/m33');
  });

  it('mirrors the Pico pinout: single gpio0, led0 on GP25, no sw0', () => {
    expect(rp2350Chip!.gpioController).toBe('gpio0');
    expect(rp2350Chip!.gpio.dtSpecs).toContainEqual({ pin: 25, dtSpec: 'led0' });
    expect(rp2350Chip!.gpio.interruptPins ?? []).toEqual([]);
  });

  it('wires i2c0 + i2c1 / spi0 / uart0, USB, console, and probes (mirrors the Pico)', () => {
    expect(rp2350Chip!.i2c?.controllers).toEqual([{ nodeLabel: 'i2c0' }, { nodeLabel: 'i2c1' }]);
    expect(rp2350Chip!.spi?.controllers).toEqual([{ nodeLabel: 'spi0' }]);
    expect(rp2350Chip!.uart?.controllers).toEqual([{ nodeLabel: 'uart0' }]);
    expect(rp2350Chip!.usb).toEqual({ controller: 'zephyr_udc0', cdcInstances: 1 });
    expect(rp2350Chip!.consoleDescription).toBe('uart0 on GP0 (TX) / GP1 (RX)');
    expect((rp2350Chip!.probeMethods ?? []).map((m) => m.id)).toEqual(['uf2', 'openocd', 'jlink']);
    expect(rp2350Chip!.probeMethods!.find((m) => m.id === 'jlink')!.debugDevice).toBe('RP2350_M33_0');
  });

  it('maps the same ADC channels as the Pico and the wdt0 node', () => {
    expect(rp2350Chip!.adc).toEqual(rp2040Chip!.adc);
    expect(rp2350Chip!.wdt).toEqual({ nodeLabel: 'wdt0' });
    expect(rp2350Chip!.pwm?.specs ?? []).toEqual([]);
  });
});

describe('RP board/MCU constants → pin capability data (analogRead regression)', () => {
  // The board-constants flattener is a static AST walker: it drops `functions`
  // entries written as helper calls (functions: [adc(0, 0)]) and the shorthand
  // `capabilities` object. The MCU packages must keep inline object literals
  // so the pin-capability validator finds the ADC channels — otherwise every
  // readAnalog() fails with "no pins support analog input".
  const rp2040Constants = resolveBoardConstants('mcus/mcu-rp2040/src/index.ts');
  const rp2350Constants = resolveBoardConstants('mcus/mcu-rp2350/src/index.ts');

  it('mcu-rp2040 GP26–GP29 carry flattenable adc function entries', () => {
    for (const pin of [26, 27, 28, 29]) {
      expect(rp2040Constants.get(`pins.all.${pin}.functions.0.type`), `GP${pin}`).toBe('adc');
    }
  });

  it('mcu-rp2350 GP26–GP29 carry flattenable adc function entries', () => {
    for (const pin of [26, 27, 28, 29]) {
      expect(rp2350Constants.get(`pins.all.${pin}.functions.0.type`), `GP${pin}`).toBe('adc');
    }
  });

  it('both MCUs flatten through the board constants merge (pins.all.26 reaches the board)', () => {
    const board2040 = resolveBoardConstants('boards/board-rp2040/src/index.ts');
    expect(board2040.get('pins.all.26.functions.0.type')).toBe('adc');
  });
});
