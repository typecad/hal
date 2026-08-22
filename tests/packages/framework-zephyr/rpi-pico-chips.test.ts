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

  it("wires i2c0 / spi0 / uart0 (the board default-enabled controllers)", () => {
    expect(rp2040Chip!.i2c?.controllers).toEqual([{ nodeLabel: 'i2c0' }]);
    expect(rp2040Chip!.spi?.controllers).toEqual([{ nodeLabel: 'spi0' }]);
    expect(rp2040Chip!.uart?.controllers).toEqual([{ nodeLabel: 'uart0' }]);
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

  it('wires i2c0 / spi0 / uart0 and the same ADC channel map as the Pico', () => {
    expect(rp2350Chip!.i2c?.controllers).toEqual([{ nodeLabel: 'i2c0' }]);
    expect(rp2350Chip!.spi?.controllers).toEqual([{ nodeLabel: 'spi0' }]);
    expect(rp2350Chip!.uart?.controllers).toEqual([{ nodeLabel: 'uart0' }]);
    expect(rp2350Chip!.adc).toEqual(rp2040Chip!.adc);
    expect(rp2350Chip!.wdt).toEqual({ nodeLabel: 'wdt0' });
    expect(rp2350Chip!.pwm?.specs ?? []).toEqual([]);
  });
});
