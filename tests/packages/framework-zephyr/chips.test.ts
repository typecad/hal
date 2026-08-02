import { describe, it, expect } from 'vitest';
import {
  chipForTarget,
  ESP32_DEVKITC,
  ESP32S3_DEVKITC,
} from '../../../packages/framework-zephyr/src/chips/index';
import { controllerNodelabelForPin } from '../../../packages/framework-zephyr/src/chips/controllers';

describe('chipForTarget — ESP32 (plain) resolution', () => {
  it("returns ESP32_DEVKITC for 'esp32_devkitc'", () => {
    expect(chipForTarget('esp32_devkitc')).toBe(ESP32_DEVKITC);
  });

  it("strips the /esp32/procpu qualifier (Zephyr 4.x board/soc/cpurev form)", () => {
    expect(chipForTarget('esp32_devkitc/esp32/procpu')).toBe(ESP32_DEVKITC);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(chipForTarget('  ESP32_DevKitC  ')).toBe(ESP32_DEVKITC);
  });

  it("still resolves esp32s3_devkitc (regression — didn't break S3)", () => {
    expect(chipForTarget('esp32s3_devkitc')).toBe(ESP32S3_DEVKITC);
    expect(chipForTarget('esp32s3_devkitc/esp32s3/procpu')).toBe(ESP32S3_DEVKITC);
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
