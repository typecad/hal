// ---------------------------------------------------------------------------
// @typehal/mcu-esp32 — Hardware peripheral descriptions
// ---------------------------------------------------------------------------

import type {
  PeripheralInstance,
  ADCDefinition,
  PWMDefinition,
  TimerDefinition,
} from '@typehal/schema';
import {
  I2CBus,
  SPIBus,
  SerialPort,
  i2cName,
  spiName,
  serialName,
  createHALInstances,
} from '@typehal/hal';

// ---------------------------------------------------------------------------
// Peripheral definitions
// ---------------------------------------------------------------------------

export const I2C_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { sda: 'GPIO21', scl: 'GPIO22' } },
  { instance: 1, defaultPins: { sda: 'GPIO21', scl: 'GPIO22' }, alternatePins: { sda: ['GPIO4', 'GPIO13', 'GPIO14', 'GPIO25', 'GPIO26', 'GPIO27', 'GPIO32', 'GPIO33'], scl: ['GPIO4', 'GPIO13', 'GPIO14', 'GPIO25', 'GPIO26', 'GPIO27', 'GPIO32', 'GPIO33'] } },
] as const;

export const SPI_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { mosi: 'GPIO13', miso: 'GPIO12', sck: 'GPIO14', cs: 'GPIO15' } },  // HSPI
  { instance: 1, defaultPins: { mosi: 'GPIO23', miso: 'GPIO19', sck: 'GPIO18', cs: 'GPIO5' } },   // VSPI
] as const;

export const UART_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { tx: 'GPIO1', rx: 'GPIO3' } },
  { instance: 2, defaultPins: { tx: 'GPIO17', rx: 'GPIO16' } },
] as const;

export const ADC_INSTANCES: readonly ADCDefinition[] = [
  { instance: 0, channels: 8, resolution: 12, referenceVoltage: 3.3, maxValue: 4095,
    referenceVoltages: { DEFAULT: 3.3, INTERNAL: 1.1 } },   // ADC1 — usable with WiFi active
  { instance: 1, channels: 10, resolution: 12, referenceVoltage: 3.3, maxValue: 4095,
    referenceVoltages: { DEFAULT: 3.3, INTERNAL: 1.1 } },  // ADC2 — NOT usable with WiFi active
] as const;

export const DAC_INSTANCES = [
  { instance: 0, resolution: 8, pins: ['GPIO25', 'GPIO26'] },
];

export const PWM_CAPABILITIES: PWMDefinition = {
  channels: 16,
  resolution: 20,
  maxFrequency: 40_000_000,
} as const;

export const TOUCH_CAPABILITIES = {
  channels: 10,
  pins: ['GPIO4', 'GPIO0', 'GPIO2', 'GPIO15', 'GPIO13', 'GPIO12', 'GPIO14', 'GPIO27', 'GPIO33', 'GPIO32'],
};

export const TIMER_INSTANCES: readonly TimerDefinition[] = [
  { instance: 0, type: 'general', bits: 64, features: ['interrupt'] },
  { instance: 1, type: 'general', bits: 64, features: ['interrupt'] },
  { instance: 2, type: 'general', bits: 64, features: ['interrupt'] },
  { instance: 3, type: 'general', bits: 64, features: ['interrupt'] },
] as const;

export const DMA_INSTANCES = [
  { instance: 0, channels: 8 },
  { instance: 1, channels: 8 },
] as const;

export const WIFI_CAPABILITIES = { type: 'wifi', supportsStation: true, supportsAp: true } as const;
export const BLUETOOTH_CAPABILITIES = { type: 'dual', version: '5.0' } as const;

// ---------------------------------------------------------------------------
// Aggregate MCU peripheral description
// ---------------------------------------------------------------------------

export const MCU_PERIPHERALS = {
  i2c: [...I2C_INSTANCES],
  spi: [...SPI_INSTANCES],
  uart: [...UART_INSTANCES],
  adc: [...ADC_INSTANCES],
  dac: [...DAC_INSTANCES],
  pwm: PWM_CAPABILITIES,
  touch: TOUCH_CAPABILITIES,
  timers: [...TIMER_INSTANCES],
  dma: [...DMA_INSTANCES],
  wifi: WIFI_CAPABILITIES,
  bluetooth: BLUETOOTH_CAPABILITIES,
} as const;

// ---------------------------------------------------------------------------
// HAL object instances — auto-generated from peripheral definitions
// ---------------------------------------------------------------------------

/** I2C bus instances */
export const [I2C0, I2C1] = createHALInstances(I2C_INSTANCES, i => new I2CBus(i2cName(i)));

/** SPI bus instances */
export const [SPI0, SPI1] = createHALInstances(SPI_INSTANCES, i => new SPIBus(spiName(i)));

/** UART/Serial instances */
export const [UART0, , UART2] = createHALInstances(UART_INSTANCES, i => new SerialPort(serialName(i)));
