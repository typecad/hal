import type { Esp32ChipDescriptor } from './types.js';

// Pin numbers from the ESP32-C6 datasheet. Verify against current Espressif
// docs before production use — these are v1 best-effort values.
export const ESP32C6: Esp32ChipDescriptor = {
  id: 'esp32c6',
  architecture: 'risc-v',
  gpio: {
    count: 30,
    inputOnly: [],
    strapping: [2, 9, 12, 13, 22, 23],
    rtcOnly: [0, 1, 2, 3, 4, 5, 6, 7],
  },
  i2c: {
    controllers: [
      { host: 'I2C_NUM_0', defaultSda: 6, defaultScl: 7 },
    ],
  },
  spi: {
    controllers: [
      { host: 'SPI2_HOST', defaultMosi: 22, defaultMiso: 23, defaultSclk: 21 },
    ],
  },
  uart: {
    controllers: [
      { num: 'UART_NUM_0', defaultTx: 16, defaultRx: 17, defaultBaud: 115200 },
    ],
  },
  adc: {
    units: [
      { unit: 'ADC_UNIT_1', channelForPin: { 0: 'ADC1_CH0', 1: 'ADC1_CH1', 2: 'ADC1_CH2', 3: 'ADC1_CH3', 4: 'ADC1_CH4', 5: 'ADC1_CH5', 6: 'ADC1_CH6' } },
    ],
  },
  lacks: ['dac', 'ledc-high-speed'],
  ledc: { timerBits: 20, lowSpeedChannels: 6, highSpeedChannels: 0 },
  cpu: { defaultFreqMhz: 160, minFreqMhz: 80, maxFreqMhz: 160 },
};
