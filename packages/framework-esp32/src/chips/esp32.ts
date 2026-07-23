import type { Esp32ChipDescriptor } from './types.js';

// Pin numbers from the ESP32 datasheet. ADC channel mapping per the ESP32
// Technical Reference Manual. Verify against current Espressif docs before
// production use — these are v1 best-effort values.
export const ESP32: Esp32ChipDescriptor = {
  id: 'esp32',
  architecture: 'xtensa',
  gpio: {
    count: 34,
    inputOnly: [34, 35, 36, 39],
    strapping: [0, 2, 5, 12, 15],
    rtcOnly: [32, 33, 34, 35, 36, 37, 38, 39],
    wakeupApi: 'ext0_ext1',
  },
  i2c: {
    controllers: [
      { host: 'I2C_NUM_0', defaultSda: 21, defaultScl: 22 },
      { host: 'I2C_NUM_1', defaultSda: 18, defaultScl: 19 },
    ],
  },
  spi: {
    controllers: [
      { host: 'SPI2_HOST', defaultMosi: 23, defaultMiso: 19, defaultSclk: 18 },
      { host: 'SPI3_HOST', defaultMosi: 13, defaultMiso: 12, defaultSclk: 14 },
    ],
  },
  uart: {
    controllers: [
      { num: 'UART_NUM_0', defaultTx: 1,  defaultRx: 3,  defaultBaud: 115200 },
      { num: 'UART_NUM_1', defaultTx: 10, defaultRx: 9,  defaultBaud: 115200 },
      { num: 'UART_NUM_2', defaultTx: 17, defaultRx: 16, defaultBaud: 115200 },
    ],
  },
  adc: {
    units: [
      { unit: 'ADC_UNIT_1', channelForPin: { 32: 'ADC1_CH4', 33: 'ADC1_CH5', 34: 'ADC1_CH6', 35: 'ADC1_CH7', 36: 'ADC1_CH0', 37: 'ADC1_CH1', 38: 'ADC1_CH2', 39: 'ADC1_CH3' } },
      { unit: 'ADC_UNIT_2', channelForPin: { 0: 'ADC2_CH1', 2: 'ADC2_CH2', 4: 'ADC2_CH0', 12: 'ADC2_CH5', 13: 'ADC2_CH4', 14: 'ADC2_CH6', 15: 'ADC2_CH3', 25: 'ADC2_CH8', 26: 'ADC2_CH9' } },
    ],
  },
  dac: { channelForPin: { 25: 'DAC_CHAN_0', 26: 'DAC_CHAN_1' } },
  lacks: [],
  ledc: { timerBits: 14, lowSpeedChannels: 8 },
  cpu: { defaultFreqMhz: 240, minFreqMhz: 80, maxFreqMhz: 240 },
};
