// ---------------------------------------------------------------------------
// @typecad/mcu-esp32c6 — Hardware peripheral descriptions
//
// ESP32-C6 peripherals: 1× I2C, 1× SPI, 2× UART, 2× ADC (12-bit),
// 4× general-purpose timers, Wi-Fi 6 (802.11ax), BLE 5.3, USB Serial/JTAG +
// USB-OTG. No DAC. No touch (the C6's touch peripheral is non-standard and
// not exposed by the Arduino core).
// ---------------------------------------------------------------------------

import type {
  PeripheralInstance, ADCDefinition, PWMDefinition, TimerDefinition,
} from '@typecad/cuttlefish/api/schema';
import {
  I2CBus, SPIBus, SerialPort, i2cName, spiName, serialName, createHALInstances,
} from '@typecad/hal';

export const I2C_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { sda: 'GPIO23', scl: 'GPIO22' } },
] as const;

export const SPI_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { mosi: 'GPIO19', miso: 'GPIO20', sck: 'GPIO21', cs: 'GPIO18' } },
] as const;

export const UART_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { tx: 'GPIO16', rx: 'GPIO17' } },
  { instance: 1, defaultPins: { tx: 'GPIO16', rx: 'GPIO17' } },
] as const;

export const ADC_INSTANCES: readonly ADCDefinition[] = [
  { instance: 0, channels: 7, resolution: 12, referenceVoltage: 3.3, maxValue: 4095,
    referenceVoltages: { DEFAULT: 3.3, INTERNAL: 1.1 } },  // ADC1 — usable with Wi-Fi active
  { instance: 1, channels: 1, resolution: 12, referenceVoltage: 3.3, maxValue: 4095,
    referenceVoltages: { DEFAULT: 3.3, INTERNAL: 1.1 } },  // ADC2 — NOT usable with Wi-Fi active
] as const;

export const PWM_CAPABILITIES: PWMDefinition = {
  channels: 6, resolution: 14, maxFrequency: 40_000_000,
} as const;

// No TOUCH_CAPABILITIES — the C6's touch peripheral is non-standard and not
// exposed by the Arduino core.

export const TIMER_INSTANCES: readonly TimerDefinition[] = [
  { instance: 0, type: 'general', bits: 64, features: ['interrupt'] },
  { instance: 1, type: 'general', bits: 64, features: ['interrupt'] },
  { instance: 2, type: 'general', bits: 64, features: ['interrupt'] },
  { instance: 3, type: 'general', bits: 64, features: ['interrupt'] },
] as const;

export const WIFI_CAPABILITIES = { type: 'wifi6', supportsStation: true, supportsAp: true } as const;
export const BLUETOOTH_CAPABILITIES = { type: 'ble', version: '5.3' } as const;
export const USB_CAPABILITIES = { type: 'otg', vid: '0x303A', pid: '0x0001' } as const;

export const MCU_PERIPHERALS = {
  i2c: [...I2C_INSTANCES],
  spi: [...SPI_INSTANCES],
  uart: [...UART_INSTANCES],
  adc: [...ADC_INSTANCES],
  pwm: PWM_CAPABILITIES,
  timers: [...TIMER_INSTANCES],
  wifi: WIFI_CAPABILITIES,
  bluetooth: BLUETOOTH_CAPABILITIES,
  usb: USB_CAPABILITIES,
} as const;

export const [I2C0] = createHALInstances(I2C_INSTANCES, i => new I2CBus(i2cName(i)));
export const [SPI0] = createHALInstances(SPI_INSTANCES, i => new SPIBus(spiName(i)));
export const [UART0, UART1] = createHALInstances(UART_INSTANCES, i => new SerialPort(serialName(i)));
