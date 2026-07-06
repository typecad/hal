// ---------------------------------------------------------------------------
// @typecad/mcu-esp32s3 — Hardware peripheral descriptions
//
// ESP32-S3 peripherals: 2× I2C, 2× SPI (FSPI/GPSI), 3× UART, 2× ADC (12-bit),
// 8× LEDC PWM, 14× capacitive-touch, 4× general-purpose timers, Wi-Fi 4,
// BLE 5, native USB-OTG. No DAC (removed on the S3).
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
  { instance: 0, defaultPins: { sda: 'GPIO8',  scl: 'GPIO9' } },
  { instance: 1, defaultPins: { sda: 'GPIO8',  scl: 'GPIO9' } },
] as const;

export const SPI_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { mosi: 'GPIO12', miso: 'GPIO13', sck: 'GPIO11', cs: 'GPIO10' } },  // FSPI
  { instance: 1, defaultPins: { mosi: 'GPIO12', miso: 'GPIO13', sck: 'GPIO11', cs: 'GPIO10' } },  // GPSI, remappable
] as const;

export const UART_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { tx: 'GPIO43', rx: 'GPIO44' } },
  { instance: 1, defaultPins: { tx: 'GPIO43', rx: 'GPIO44' } },
  { instance: 2, defaultPins: { tx: 'GPIO43', rx: 'GPIO44' } },
] as const;

export const ADC_INSTANCES: readonly ADCDefinition[] = [
  { instance: 0, channels: 10, resolution: 12, referenceVoltage: 3.3, maxValue: 4095,
    referenceVoltages: { DEFAULT: 3.3, INTERNAL: 1.1 } },  // ADC1 — usable with Wi-Fi active
  { instance: 1, channels: 10, resolution: 12, referenceVoltage: 3.3, maxValue: 4095,
    referenceVoltages: { DEFAULT: 3.3, INTERNAL: 1.1 } },  // ADC2 — NOT usable with Wi-Fi active
] as const;

export const PWM_CAPABILITIES: PWMDefinition = {
  channels: 8,
  resolution: 20,
  maxFrequency: 40_000_000,
} as const;

export const TOUCH_CAPABILITIES = {
  channels: 14,
  pins: ['GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7',
         'GPIO8', 'GPIO9', 'GPIO10', 'GPIO11', 'GPIO12', 'GPIO13', 'GPIO14'],
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
export const [I2C0, I2C1] = createHALInstances(I2C_INSTANCES, i => new I2CBus(i2cName(i)));

/** SPI bus instances */
export const [SPI0, SPI1] = createHALInstances(SPI_INSTANCES, i => new SPIBus(spiName(i)));

/** UART/Serial instances */
export const [UART0, UART1, UART2] = createHALInstances(UART_INSTANCES, i => new SerialPort(serialName(i)));
