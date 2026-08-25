// Board-package Zephyr chip data for the ESP32-C3 / ESP32-C6 — the
// resolveChipFromBoard() path. These boards ship their ZephyrChipDescriptor
// via the board package's `zephyr` field (flattened into board constants),
// NOT via framework-zephyr's hardcoded chip registry, so this test exercises
// the real flattener against the real board sources.
//
// Descriptor facts verified against Zephyr 4.3 (4.3.99):
//   boards/espressif/esp32c3_devkitm/esp32c3_devkitm.dts
//   boards/espressif/esp32c6_devkitc/esp32c6_devkitc_hpcore.dts
//   dts/riscv/espressif/esp32c3/esp32c3_common.dtsi (gpio0 ngpios = 26)
//   dts/riscv/espressif/esp32c6/esp32c6_common.dtsi (gpio0 ngpios = 30)
//   boards/espressif/esp32c6_devkitc/board.yml + Kconfig.esp32c6_devkitc
//     (hpcore/lpcore cpucluster variants → qualified target required)
//   drivers/wifi/esp32/Kconfig.esp32 (WIFI_ESP32 is family-wide,
//     depends on DT_HAS_ESPRESSIF_ESP32_WIFI_ENABLED; both boards enable &wifi)

import { describe, it, expect } from 'vitest';
import { resolveBoardConstants } from '../../../packages/cuttlefish/src/ir/board-resolver';
import { resolveChipFromBoard } from '../../../packages/framework-zephyr/src/chips/resolve';

const esp32c3Chip = resolveChipFromBoard(
  resolveBoardConstants('boards/board-esp32c3/src/index.ts'),
);
const esp32c6Chip = resolveChipFromBoard(
  resolveBoardConstants('boards/board-esp32c6/src/index.ts'),
);

describe('board-esp32c3 → ZephyrChipDescriptor', () => {
  it('resolves (the board package carries a zephyr build target + chip data)', () => {
    expect(esp32c3Chip).not.toBeNull();
  });

  it("targets the qualified 'esp32c3_devkitm/esp32c3' for west build -b", () => {
    expect(esp32c3Chip!.id).toBe('esp32c3_devkitm/esp32c3');
  });

  it('uses the single gpio0 controller (no controller split)', () => {
    expect(esp32c3Chip!.gpioController).toBe('gpio0');
    expect(esp32c3Chip!.gpioControllers ?? []).toEqual([]);
  });

  it('exposes the BOOT button on GPIO9 via the sw0 DT alias (no led0 — onboard RGB is a WS2812)', () => {
    expect(esp32c3Chip!.gpio.dtSpecs).toEqual([{ pin: 9, dtSpec: 'sw0' }]);
  });

  it('declares the BOOT button as the interrupt pin', () => {
    expect(esp32c3Chip!.gpio.interruptPins).toEqual([{ pin: 9, dtSpec: 'sw0' }]);
  });

  it('wires i2c0 / spi2 / uart0 (the board default-enabled controllers)', () => {
    expect(esp32c3Chip!.i2c?.controllers).toEqual([{ nodeLabel: 'i2c0' }]);
    expect(esp32c3Chip!.spi?.controllers).toEqual([{ nodeLabel: 'spi2' }]);
    expect(esp32c3Chip!.uart?.controllers).toEqual([{ nodeLabel: 'uart0' }]);
  });

  it('declares the 2.4GHz radio (board DTS enables &wifi)', () => {
    expect(esp32c3Chip!.wifi).toEqual({ supported: true });
  });

  it('declares no PWM specs (no PWM-capable node is pinned) and maps ADC1 channels', () => {
    expect(esp32c3Chip!.pwm?.specs ?? []).toEqual([]);
    // ADC1_CH0–CH4 = GPIO0–GPIO4 (A0 = GPIO0 is CH0).
    expect(esp32c3Chip!.adc?.nodeLabel).toBe('adc0');
    expect(esp32c3Chip!.adc?.channels).toEqual([
      { pin: 0, channel: 0 },
      { pin: 1, channel: 1 },
      { pin: 2, channel: 2 },
      { pin: 3, channel: 3 },
      { pin: 4, channel: 4 },
    ]);
  });
});

describe('board-esp32c6 → ZephyrChipDescriptor', () => {
  it('resolves (the board package carries a zephyr build target + chip data)', () => {
    expect(esp32c6Chip).not.toBeNull();
  });

  it("targets the qualified 'esp32c6_devkitc/esp32c6/hpcore' (bare id rejected — lpcore variant exists)", () => {
    expect(esp32c6Chip!.id).toBe('esp32c6_devkitc/esp32c6/hpcore');
  });

  it('uses the single gpio0 controller (no controller split)', () => {
    expect(esp32c6Chip!.gpioController).toBe('gpio0');
    expect(esp32c6Chip!.gpioControllers ?? []).toEqual([]);
  });

  it('mirrors the C3 GPIO shape: BOOT button on GPIO9 via sw0, no led0', () => {
    expect(esp32c6Chip!.gpio.dtSpecs).toEqual([{ pin: 9, dtSpec: 'sw0' }]);
    expect(esp32c6Chip!.gpio.interruptPins).toEqual([{ pin: 9, dtSpec: 'sw0' }]);
  });

  it('wires i2c0 / spi2 / uart0 (the board default-enabled controllers)', () => {
    expect(esp32c6Chip!.i2c?.controllers).toEqual([{ nodeLabel: 'i2c0' }]);
    expect(esp32c6Chip!.spi?.controllers).toEqual([{ nodeLabel: 'spi2' }]);
    expect(esp32c6Chip!.uart?.controllers).toEqual([{ nodeLabel: 'uart0' }]);
  });

  it('declares the radio (board DTS enables &wifi + &ieee802154)', () => {
    expect(esp32c6Chip!.wifi).toEqual({ supported: true });
  });

  it('declares no PWM specs (no PWM-capable node is pinned) and maps ADC1 channels', () => {
    expect(esp32c6Chip!.pwm?.specs ?? []).toEqual([]);
    // ADC1_CH0–CH6 = GPIO0–GPIO6 (A0 = GPIO0 is CH0).
    expect(esp32c6Chip!.adc?.nodeLabel).toBe('adc0');
    expect(esp32c6Chip!.adc?.channels).toHaveLength(7);
    expect(esp32c6Chip!.adc?.channels[0]).toEqual({ pin: 0, channel: 0 });
  });
});
