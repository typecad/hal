import { describe, it, expect } from 'vitest';
import { ESP32, ESP32S3, ESP32C3, ESP32C6 } from '../../../packages/framework-esp32/src/chips/index';

describe('chip descriptor data integrity', () => {
  describe('ESP32 (classic)', () => {
    it('has xtensa architecture', () => {
      expect(ESP32.architecture).toBe('xtensa');
    });
    it('has input-only pins 34-39', () => {
      expect(ESP32.gpio.inputOnly).toEqual(expect.arrayContaining([34, 35, 36, 39]));
    });
    it('has 2 I2C controllers', () => {
      expect(ESP32.i2c.controllers).toHaveLength(2);
    });
    it('does not lack DAC', () => {
      expect(ESP32.lacks).not.toContain('dac');
    });
  });

  describe('ESP32-S3', () => {
    it('has xtensa architecture', () => {
      expect(ESP32S3.architecture).toBe('xtensa');
    });
    it('has no input-only pins', () => {
      expect(ESP32S3.gpio.inputOnly).toEqual([]);
    });
    it('has low-speed LEDC channels', () => {
      expect(ESP32S3.ledc.lowSpeedChannels).toBeGreaterThan(0);
    });
    it('lacks DAC', () => {
      expect(ESP32S3.lacks).toContain('dac');
    });
  });

  describe('ESP32-C3', () => {
    it('has risc-v architecture', () => {
      expect(ESP32C3.architecture).toBe('risc-v');
    });
    it('lacks DAC', () => {
      expect(ESP32C3.lacks).toContain('dac');
    });
    it('has a single I2C controller', () => {
      expect(ESP32C3.i2c.controllers).toHaveLength(1);
    });
  });

  describe('ESP32-C6', () => {
    it('has risc-v architecture', () => {
      expect(ESP32C6.architecture).toBe('risc-v');
    });
    it('lacks DAC', () => {
      expect(ESP32C6.lacks).toContain('dac');
    });
  });

  // deep-sleep pin wakeup API family: Xtensa (ESP32/S3) use ext0/ext1 on RTC
  // GPIO; RISC-V (C3/C6) use the esp_sleep_enable_gpio_wakeup variant. The
  // descriptor carries which family each chip uses so the lowering can branch.
  describe('deep-sleep wakeup API family', () => {
    it('ESP32 (classic) uses ext0/ext1', () => {
      expect(ESP32.gpio.wakeupApi).toBe('ext0_ext1');
    });
    it('ESP32-S3 uses ext0/ext1', () => {
      expect(ESP32S3.gpio.wakeupApi).toBe('ext0_ext1');
    });
    it('ESP32-C3 uses gpio_wakeup', () => {
      expect(ESP32C3.gpio.wakeupApi).toBe('gpio_wakeup');
    });
    it('ESP32-C6 uses gpio_wakeup', () => {
      expect(ESP32C6.gpio.wakeupApi).toBe('gpio_wakeup');
    });
  });
});
