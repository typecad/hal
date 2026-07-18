import { describe, it, expect } from 'vitest';
import { Esp32Strategy } from '../../../packages/framework-esp32/src/strategy';

const strategy = new Esp32Strategy();
const fakeProgram = {} as any;

describe('Esp32Strategy forcedIncludes', () => {
  it('drops Arduino.h and emits core IDF headers by default', () => {
    const inc = strategy.forcedIncludes(fakeProgram, undefined as any);
    expect(inc).not.toContain('<Arduino.h>');
    expect(inc).toContain('<stdio.h>');
    expect(inc).toContain('"freertos/FreeRTOS.h"');
    expect(inc).toContain('"esp_log.h"');
    expect(inc).toContain('"esp_system.h"');
    expect(inc).toContain('"esp_timer.h"');
  });

  it('includes driver/gpio.h when usesGPIO is true', () => {
    const ctx = { analysis: { usesGPIO: true }, frameworkData: { target: 'esp32' } } as any;
    expect(strategy.forcedIncludes(fakeProgram, ctx)).toContain('"driver/gpio.h"');
  });

  it('omits driver/gpio.h when usesGPIO is false', () => {
    const ctx = { analysis: { usesGPIO: false }, frameworkData: { target: 'esp32' } } as any;
    expect(strategy.forcedIncludes(fakeProgram, ctx)).not.toContain('"driver/gpio.h"');
  });

  it('includes driver/i2c_master.h only when usesI2C', () => {
    const ctx = { analysis: { usesI2C: true }, frameworkData: { target: 'esp32' } } as any;
    expect(strategy.forcedIncludes(fakeProgram, ctx)).toContain('"driver/i2c_master.h"');
    const ctxNo = { analysis: { usesI2C: false }, frameworkData: { target: 'esp32' } } as any;
    expect(strategy.forcedIncludes(fakeProgram, ctxNo)).not.toContain('"driver/i2c_master.h"');
  });

  it('includes all peripheral headers when all usage flags are true', () => {
    const ctx = {
      analysis: { usesGPIO: true, usesI2C: true, usesSPI: true, usesUART: true,
                  usesPWM: true, usesADC: true, usesDAC: true, usesPower: true,
                  usesWdt: true, usesInterrupts: true },
      frameworkData: { target: 'esp32' },
    } as any;
    const inc = strategy.forcedIncludes(fakeProgram, ctx);
    expect(inc).toContain('"driver/spi_master.h"');
    expect(inc).toContain('"driver/uart.h"');
    expect(inc).toContain('"driver/ledc.h"');
    expect(inc).toContain('"driver/dac.h"');
    expect(inc).toContain('"esp_sleep.h"');
    expect(inc).toContain('"esp_task_wdt.h"');
    expect(inc).toContain('"esp_intr_alloc.h"');
  });
});

describe('Esp32Strategy filterRequiredIncludes', () => {
  it('strips Arduino umbrella headers', () => {
    const filtered = strategy.filterRequiredIncludes!(['<Arduino.h>', '<Wire.h>', '<SPI.h>', '<stdio.h>']);
    expect(filtered).toEqual(['<stdio.h>']);
  });
  it('preserves unrelated headers', () => {
    const filtered = strategy.filterRequiredIncludes!(['<vector>', '"driver/gpio.h"']);
    expect(filtered).toEqual(['<vector>', '"driver/gpio.h"']);
  });
  it('strips EEPROM, Preferences, HardwareSerial', () => {
    const filtered = strategy.filterRequiredIncludes!(['<EEPROM.h>', '<Preferences.h>', '<HardwareSerial.h>', '<string.h>']);
    expect(filtered).toEqual(['<string.h>']);
  });
});
