// ---------------------------------------------------------------------------
// @typecad/mcu-esp32c3 — Hardware peripheral descriptions
//
// ESP32-C3 peripherals: 1× I2C, 1× SPI (GPSPI2), 2× UART, 2× ADC (12-bit),
// 6× capacitive-touch, 4× general-purpose timers, Wi-Fi 4, BLE 5 (long range),
// native USB Serial/JTAG (CDC). No DAC.
// ---------------------------------------------------------------------------

import type {
  PeripheralInstance,
  ADCDefinition,
  PWMDefinition,
  TimerDefinition,
} from '@typecad/cuttlefish/api/schema';
import {
  I2CBus,
  SPIBus,
  SerialPort,
  i2cName,
  spiName,
  serialName,
  createHALInstances,
} from '@typecad/hal';

// ---------------------------------------------------------------------------
// Peripheral definitions
// ---------------------------------------------------------------------------

export const I2C_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { sda: 'GPIO8', scl: 'GPIO9' } },
] as const;

export const SPI_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { mosi: 'GPIO6', miso: 'GPIO5', sck: 'GPIO4', cs: 'GPIO7' } },  // GPSPI2
] as const;

export const UART_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { tx: 'GPIO21', rx: 'GPIO20' } },
  { instance: 1, defaultPins: { tx: 'GPIO21', rx: 'GPIO20' } },
] as const;

export const ADC_INSTANCES: readonly ADCDefinition[] = [
  { instance: 0, channels: 5, resolution: 12, referenceVoltage: 3.3, maxValue: 4095,
    referenceVoltages: { DEFAULT: 3.3, INTERNAL: 1.1 } },  // ADC1 — usable with Wi-Fi active
  { instance: 1, channels: 1, resolution: 12, referenceVoltage: 3.3, maxValue: 4095,
    referenceVoltages: { DEFAULT: 3.3, INTERNAL: 1.1 } },  // ADC2 — NOT usable with Wi-Fi active
] as const;

export const PWM_CAPABILITIES: PWMDefinition = {
  channels: 6,
  resolution: 14,
  maxFrequency: 40_000_000,
} as const;

export const TOUCH_CAPABILITIES = {
  channels: 6,
  pins: ['GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5'],
};

export const TIMER_INSTANCES: readonly TimerDefinition[] = [
  { instance: 0, type: 'general', bits: 64, features: ['interrupt'] },
  { instance: 1, type: 'general', bits: 64, features: ['interrupt'] },
  { instance: 2, type: 'general', bits: 64, features: ['interrupt'] },
  { instance: 3, type: 'general', bits: 64, features: ['interrupt'] },
] as const;

export const WIFI_CAPABILITIES = { type: 'wifi', supportsStation: true, supportsAp: true } as const;
export const BLUETOOTH_CAPABILITIES = { type: 'ble', version: '5.0' } as const;
export const USB_CAPABILITIES = { type: 'otg', vid: '0x303A', pid: '0x0001' } as const;

// ---------------------------------------------------------------------------
// Aggregate MCU peripheral description
// ---------------------------------------------------------------------------

export const MCU_PERIPHERALS = {
  i2c: [...I2C_INSTANCES],
  spi: [...SPI_INSTANCES],
  uart: [...UART_INSTANCES],
  adc: [...ADC_INSTANCES],
  pwm: PWM_CAPABILITIES,
  touch: TOUCH_CAPABILITIES,
  timers: [...TIMER_INSTANCES],
  wifi: WIFI_CAPABILITIES,
  bluetooth: BLUETOOTH_CAPABILITIES,
  usb: USB_CAPABILITIES,
} as const;

// ---------------------------------------------------------------------------
// HAL object instances — auto-generated from peripheral definitions
// ---------------------------------------------------------------------------

/** I2C bus instances */
export const [I2C0] = createHALInstances(I2C_INSTANCES, i => new I2CBus(i2cName(i)));

/** SPI bus instances */
export const [SPI0] = createHALInstances(SPI_INSTANCES, i => new SPIBus(spiName(i)));

/** UART/Serial instances */
export const [UART0, UART1] = createHALInstances(UART_INSTANCES, i => new SerialPort(serialName(i)));
