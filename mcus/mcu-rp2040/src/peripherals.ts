// ---------------------------------------------------------------------------
// @typecad/mcu-rp2040 — Hardware peripheral descriptions
// Dual-core Cortex-M0+ @ 133 MHz. 2× I2C, 2× SPI (PrimeCell), 2× UART,
// 1× ADC (4ch, 12-bit), 8× PWM slices, 4× timers. No wireless. No DAC.
// ---------------------------------------------------------------------------

import type {
  PeripheralInstance, ADCDefinition, PWMDefinition, TimerDefinition,
} from '@typecad/cuttlefish/api/schema';
import {
  I2CBus, SPIBus, SerialPort, i2cName, spiName, serialName, createHALInstances,
} from '@typecad/hal';

export const I2C_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { sda: 'GP4', scl: 'GP5' } },
  { instance: 1, defaultPins: { sda: 'GP4', scl: 'GP5' } },
] as const;

export const SPI_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { mosi: 'GP19', miso: 'GP16', sck: 'GP18', cs: 'GP17' } },
  { instance: 1, defaultPins: { mosi: 'GP19', miso: 'GP16', sck: 'GP18', cs: 'GP17' } },
] as const;

export const UART_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { tx: 'GP0', rx: 'GP1' } },
  { instance: 1, defaultPins: { tx: 'GP0', rx: 'GP1' } },
] as const;

export const ADC_INSTANCES: readonly ADCDefinition[] = [
  { instance: 0, channels: 4, resolution: 12, referenceVoltage: 3.3, maxValue: 4095,
    referenceVoltages: { DEFAULT: 3.3 } },
] as const;

export const PWM_CAPABILITIES: PWMDefinition = {
  channels: 8, resolution: 16, maxFrequency: 62_500_000,
} as const;

export const TIMER_INSTANCES: readonly TimerDefinition[] = [
  { instance: 0, type: 'general', bits: 64, features: ['interrupt'] },
  { instance: 1, type: 'general', bits: 64, features: ['interrupt'] },
  { instance: 2, type: 'general', bits: 64, features: ['interrupt'] },
  { instance: 3, type: 'general', bits: 64, features: ['interrupt'] },
] as const;

export const MCU_PERIPHERALS = {
  i2c: [...I2C_INSTANCES],
  spi: [...SPI_INSTANCES],
  uart: [...UART_INSTANCES],
  adc: [...ADC_INSTANCES],
  pwm: PWM_CAPABILITIES,
  timers: [...TIMER_INSTANCES],
} as const;

export const [I2C0, I2C1] = createHALInstances(I2C_INSTANCES, i => new I2CBus(i2cName(i)));
export const [SPI0, SPI1] = createHALInstances(SPI_INSTANCES, i => new SPIBus(spiName(i)));
export const [UART0, UART1] = createHALInstances(UART_INSTANCES, i => new SerialPort(serialName(i)));
