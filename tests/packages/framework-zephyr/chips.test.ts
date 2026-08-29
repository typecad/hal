import { describe, it, expect } from 'vitest';
import {
  chipForTarget,
  chipForSoc,
  ESP32_DEVKITC,
  ESP32S3_DEVKITC,
  XIAO_BLE,
  SOC_CHIPS,
} from '../../../packages/framework-zephyr/src/chips/index';
import { controllerNodelabelForPin, controllerRawPinForPin, emitGpioDevDispatcher } from '../../../packages/framework-zephyr/src/chips/controllers';
import { resolveChipFromBoard } from '../../../packages/framework-zephyr/src/chips/resolve';
import { generateBoard } from '../../../packages/framework-zephyr/src/boardgen';
import type { BoardConstants } from '../../../packages/cuttlefish/src/api/shared/board-resolver';
function generatedConstants(target: string): BoardConstants {
  const g = generateBoard(target);
  return new Map(Object.entries(JSON.parse(g.boardJson).constants)) as BoardConstants;
}


describe('chipForTarget — ESP32 (plain) resolution', () => {
  it("returns ESP32_DEVKITC for 'esp32_devkitc'", () => {
    expect(chipForTarget('esp32_devkitc')).toBe(SOC_CHIPS['esp32']);
  });

  it("strips the /esp32/procpu qualifier (Zephyr 4.x board/soc/cpurev form)", () => {
    // The consolidated soc registry wins over the legacy 3-entry registry —
    // same silicon, richer data (superset of ESP32_DEVKITC).
    expect(chipForTarget('esp32_devkitc/esp32/procpu')).toBe(SOC_CHIPS['esp32']);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(chipForTarget('  ESP32_DevKitC  ')).toBe(SOC_CHIPS['esp32']);
  });

  it("still resolves esp32s3_devkitc (regression — didn't break S3)", () => {
    expect(chipForTarget('esp32s3_devkitc')).toBe(SOC_CHIPS['esp32s3']);
    expect(chipForTarget('esp32s3_devkitc/esp32s3/procpu')).toBe(SOC_CHIPS['esp32s3']);
  });
});

describe('ESP32S3_DEVKITC descriptor — USB + LEDC PWM matrix', () => {
  it('declares native USB CDC over the board DTS zephyr_udc0 alias (usb_otg/DWC2)', () => {
    expect(ESP32S3_DEVKITC.usb?.controller).toBe('zephyr_udc0');
    expect(ESP32S3_DEVKITC.usb?.cdcInstances).toBe(1);
  });

  it('declares the LEDC matrix: 8 channels, routable to the listed pads', () => {
    const m = ESP32S3_DEVKITC.pwm?.matrix;
    expect(m?.controller).toBe('ledc0');
    expect(m?.channelCount).toBe(8);
    // Excluded pads: GPIO0 (boot strap / BOOT button), GPIO19/20 (USB D±),
    // GPIO26–32 (SPI flash/PSRAM), GPIO33–37 (octal PSRAM), GPIO43/44
    // (uart0 console).
    for (const excluded of [0, 19, 20, 26, 32, 33, 37, 43, 44]) {
      expect(m?.pins).not.toContain(excluded);
    }
    for (const ok of [1, 18, 21, 38, 48]) {
      expect(m?.pins).toContain(ok);
    }
  });

  it('carries the same USB + matrix through the soc registry', () => {
    const resolved = chipForSoc('esp32s3')!;
    expect(resolved.usb?.controller).toBe('zephyr_udc0');
    expect(resolved.usb?.cdcInstances).toBe(1);
    expect(resolved.pwm?.matrix?.controller).toBe('ledc0');
    expect(resolved.pwm?.matrix?.channelCount).toBe(8);
    expect(resolved.pwm?.matrix?.pins).toEqual(ESP32S3_DEVKITC.pwm?.matrix?.pins);
  });
});

describe('ESP32_DEVKITC descriptor — GPIO controller split', () => {
  it('splits GPIO across gpio0 (0–31) and gpio1 (32–39), matching the SoC DT', () => {
    // The plain ESP32's highest GPIO is 39 (not 48 like the S3). gpio1 has
    // ngpios=8 per dts/xtensa/espressif/esp32/esp32_common.dtsi.
    expect(ESP32_DEVKITC.gpioControllers).toEqual([
      { nodelabel: 'gpio0', minPin: 0, maxPin: 31 },
      { nodelabel: 'gpio1', minPin: 32, maxPin: 39 },
    ]);
  });

  it('routes pins to the owning controller (compile-time + runtime paths)', () => {
    expect(controllerNodelabelForPin(ESP32_DEVKITC, 0)).toBe('gpio0');
    expect(controllerNodelabelForPin(ESP32_DEVKITC, 31)).toBe('gpio0');
    expect(controllerNodelabelForPin(ESP32_DEVKITC, 32)).toBe('gpio1');
    expect(controllerNodelabelForPin(ESP32_DEVKITC, 39)).toBe('gpio1');
  });

  it('falls back to gpio0 for out-of-range pins', () => {
    // Out-of-range (e.g. the manifest probe's synthetic pin 0 path, or a pin
    // beyond 39) falls through to gpioController.
    expect(controllerNodelabelForPin(ESP32_DEVKITC, 40)).toBe('gpio0');
    expect(ESP32_DEVKITC.gpioController).toBe('gpio0');
  });

  it('exposes the BOOT button (GPIO0) via the sw0 alias for DT-spec GPIO', () => {
    expect(ESP32_DEVKITC.gpio.dtSpecs).toContainEqual({ pin: 0, dtSpec: 'sw0' });
    expect(ESP32_DEVKITC.gpio.interruptPins).toContainEqual({ pin: 0, dtSpec: 'sw0' });
  });
});

describe('ESP32_DEVKITC descriptor — WiFi', () => {
  it('marks WiFi supported (the board enables &wifi; WIFI_ESP32 !SMP dep is met)', () => {
    expect(ESP32_DEVKITC.wifi?.supported).toBe(true);
  });
});

describe('raw-pin offset (port-relative indices for gpio_pin_*_raw)', () => {
  it('subtracts the owning controller minPin (ESP32 gpio1: pin 33 -> raw 1)', () => {
    expect(controllerRawPinForPin(ESP32_DEVKITC, 5)).toBe(5);
    expect(controllerRawPinForPin(ESP32_DEVKITC, 33)).toBe(1);
    expect(controllerRawPinForPin(ESP32_DEVKITC, 39)).toBe(7);
  });

  it('subtracts the owning controller minPin (XIAO gpio1: P1.11 pin 43 -> raw 11)', () => {
    expect(controllerRawPinForPin(XIAO_BLE, 17)).toBe(17);   // P0.17 -> gpio0 17
    expect(controllerRawPinForPin(XIAO_BLE, 34)).toBe(2);    // P1.02 -> gpio1 2
    expect(controllerRawPinForPin(XIAO_BLE, 43)).toBe(11);   // P1.11 -> gpio1 11
    expect(controllerRawPinForPin(XIAO_BLE, 44)).toBe(12);   // P1.12 -> gpio1 12
  });

  it('is identity on single-controller SoCs (no gpioControllers declared)', () => {
    const single: Parameters<typeof controllerRawPinForPin>[0] = {
      id: 'synthetic', soc: 'x', gpioController: 'gpio0', gpio: { dtSpecs: [] },
    };
    expect(controllerRawPinForPin(single, 17)).toBe(17);
  });

  it('emits a __tc_gpio_pin runtime offset dispatcher alongside __tc_gpio_dev', () => {
    const lines = emitGpioDevDispatcher(ESP32_DEVKITC).join('\n');
    expect(lines).toContain('__tc_gpio_dev');
    expect(lines).toContain('__tc_gpio_pin');
    expect(lines).toContain('return (gpio_pin_t)(pin - 32);');
    // The XIAO declares its two-controller split too (gpio0/gpio1): the
    // dispatcher carries both branches. The old single-controller form let
    // gpio0+global work only via NRF_GPIO_PIN_MAP(0, 43)=43 — the right pin,
    // but it trips the port_pin_mask __ASSERT on assert-enabled builds.
    const xiao = emitGpioDevDispatcher(XIAO_BLE).join('\n');
    expect(xiao).toContain('DT_NODELABEL(gpio1)');
    expect(xiao).toContain('return (gpio_pin_t)(pin - 32);');
    // Single-controller chips: identity dispatcher plus identity pin mapper.
    const single: Parameters<typeof emitGpioDevDispatcher>[0] = {
      id: 'synthetic', soc: 'x', gpioController: 'gpio0', gpio: { dtSpecs: [] },
    };
    const collapsed = emitGpioDevDispatcher(single).join('\n');
    expect(collapsed).toContain('return (gpio_pin_t)pin;');
    expect(collapsed).not.toContain('pin - ');
  });
});
