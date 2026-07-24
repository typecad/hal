import type { Esp32ChipDescriptor } from './types.js';

// Pin numbers from the ESP32-C3 datasheet. Verify against current Espressif
// docs before production use — these are v1 best-effort values.
export const ESP32C3: Esp32ChipDescriptor = {
  id: 'esp32c3',
  architecture: 'risc-v',
  gpio: {
    count: 22,
    inputOnly: [],
    strapping: [2, 8, 9],
    rtcOnly: [0, 1, 2, 3, 4, 5],
    wakeupApi: 'gpio_wakeup',
  },
  i2c: {
    controllers: [
      { host: 'I2C_NUM_0', defaultSda: 8, defaultScl: 9 },
    ],
  },
  spi: {
    controllers: [
      { host: 'SPI2_HOST', defaultMosi: 7, defaultMiso: 2, defaultSclk: 6 },
    ],
  },
  uart: {
    controllers: [
      { num: 'UART_NUM_0', defaultTx: 21, defaultRx: 20, defaultBaud: 115200 },
      { num: 'UART_NUM_1', defaultTx: 10, defaultRx: 9,  defaultBaud: 115200 },
    ],
  },
  adc: {
    units: [
      { unit: 'ADC_UNIT_1', channelForPin: { 0: 'ADC1_CH0', 1: 'ADC1_CH1', 2: 'ADC1_CH2', 3: 'ADC1_CH3', 4: 'ADC1_CH4' } },
      { unit: 'ADC_UNIT_2', channelForPin: { 5: 'ADC2_CH0' } },
    ],
  },
  lacks: ['dac'],
  rmt: { txChannels: 2, rxChannels: 2 },
  ledc: { timerBits: 14, lowSpeedChannels: 6 },
  cpu: { defaultFreqMhz: 160, minFreqMhz: 80, maxFreqMhz: 160 },
};
