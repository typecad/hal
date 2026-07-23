import type { Esp32ChipDescriptor } from './types.js';

// Pin numbers from the ESP32-S3 datasheet. Verify against current Espressif
// docs before production use — these are v1 best-effort values.
export const ESP32S3: Esp32ChipDescriptor = {
  id: 'esp32s3',
  architecture: 'xtensa',
  gpio: {
    count: 49,
    inputOnly: [],
    strapping: [0, 3, 45, 46],
    rtcOnly: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 26, 27, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48],
    wakeupApi: 'ext0_ext1',
  },
  i2c: {
    controllers: [
      { host: 'I2C_NUM_0', defaultSda: 8,  defaultScl: 9 },
      { host: 'I2C_NUM_1', defaultSda: 18, defaultScl: 17 },
    ],
  },
  spi: {
    controllers: [
      { host: 'SPI2_HOST', defaultMosi: 11, defaultMiso: 13, defaultSclk: 12 },
      { host: 'SPI3_HOST', defaultMosi: 14, defaultMiso: 16, defaultSclk: 15 },
    ],
  },
  uart: {
    controllers: [
      { num: 'UART_NUM_0', defaultTx: 43, defaultRx: 44, defaultBaud: 115200 },
      { num: 'UART_NUM_1', defaultTx: 15, defaultRx: 16, defaultBaud: 115200 },
    ],
  },
  adc: {
    units: [
      { unit: 'ADC_UNIT_1', channelForPin: { 1: 'ADC1_CH0', 2: 'ADC1_CH1', 3: 'ADC1_CH2', 4: 'ADC1_CH3', 5: 'ADC1_CH4', 6: 'ADC1_CH5', 7: 'ADC1_CH6', 8: 'ADC1_CH7', 9: 'ADC1_CH8', 10: 'ADC1_CH9' } },
      { unit: 'ADC_UNIT_2', channelForPin: { 11: 'ADC2_CH0', 12: 'ADC2_CH1', 13: 'ADC2_CH2', 14: 'ADC2_CH3', 15: 'ADC2_CH4', 16: 'ADC2_CH5', 17: 'ADC2_CH6', 18: 'ADC2_CH7', 19: 'ADC2_CH8', 20: 'ADC2_CH9' } },
    ],
  },
  // ESP32-S3 has no DAC peripheral (unlike classic ESP32 / S2).
  lacks: ['dac'],
  ledc: { timerBits: 14, lowSpeedChannels: 8 },
  cpu: { defaultFreqMhz: 240, minFreqMhz: 80, maxFreqMhz: 240 },
};
