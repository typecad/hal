// ---------------------------------------------------------------------------
// @typecad/mcu-nrf52840 — Hardware peripheral descriptions
//
// MVP scope: only GPIO is lowered by @typecad/framework-zephyr today. The
// peripheral instance data below records the nRF52840's I2C/SPI/UART/ADC
// instances (silicon-level facts) so board packages and future framework
// coverage have the data available, but the framework manifest declares these
// categories unsupported until their lowering is implemented.
// ---------------------------------------------------------------------------

import type {
  PeripheralInstance,
  ADCDefinition,
  TimerDefinition,
} from '@typecad/cuttlefish/api/schema';

// ---------------------------------------------------------------------------
// Peripheral instances
// ---------------------------------------------------------------------------

export const I2C_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { sda: 'P0.24', scl: 'P0.25' } },
] as const;

export const SPI_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { mosi: 'P0.13', miso: 'P0.14', sck: 'P0.15' } },
] as const;

export const UART_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { tx: 'P0.06', rx: 'P1.02' } },
] as const;

export const ADC_INSTANCES: readonly ADCDefinition[] = [
  { instance: 0, channels: 8, resolution: 12, referenceVoltage: 3.0, maxValue: 4095,
    referenceVoltages: { DEFAULT: 3.0, INTERNAL: 0.6 } },
] as const;

export const TIMER_INSTANCES: readonly TimerDefinition[] = [
  { instance: 0, type: 'general', features: ['pwm', 'capture', 'compare', 'interrupt'], bits: 32 },
  { instance: 1, type: 'general', features: ['pwm', 'capture', 'compare', 'interrupt'], bits: 32 },
  { instance: 2, type: 'general', features: ['pwm', 'capture', 'compare', 'interrupt'], bits: 32 },
  { instance: 3, type: 'general', features: ['pwm', 'capture', 'compare', 'interrupt'], bits: 32 },
] as const;
