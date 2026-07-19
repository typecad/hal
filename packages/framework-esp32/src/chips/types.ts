/** Pure-data descriptor for an ESP32 variant. No behavior — lowering code
 *  in src/lowering/*.ts reads getActiveChip() to resolve pins, controllers,
 *  and capability tables. Mirrors framework-avr's AVRChipDescriptor pattern. */
export interface Esp32ChipDescriptor {
  id: 'esp32' | 'esp32s3' | 'esp32c3' | 'esp32c6';
  architecture: 'xtensa' | 'risc-v';

  gpio: {
    count: number;
    /** Pins that cannot be configured as output (classic ESP32: 34-39). */
    inputOnly: number[];
    /** Strapping pins — boot-mode critical; touch with care. */
    strapping: number[];
    /** RTC-capable pins — route through rtc_gpio_* for deep-sleep wakeup. */
    rtcOnly: number[];
  };

  i2c: {
    controllers: {
      host: 'I2C_NUM_0' | 'I2C_NUM_1';
      defaultSda: number;
      defaultScl: number;
    }[];
  };

  spi: {
    controllers: {
      host: 'SPI1_HOST' | 'SPI2_HOST' | 'SPI3_HOST';
      defaultMosi: number;
      defaultMiso: number;
      defaultSclk: number;
    }[];
  };

  uart: {
    controllers: {
      num: 'UART_NUM_0' | 'UART_NUM_1' | 'UART_NUM_2';
      defaultTx: number;
      defaultRx: number;
      defaultBaud: number;
    }[];
  };

  adc: {
    units: {
      unit: 'ADC_UNIT_1' | 'ADC_UNIT_2';
      /** Map of GPIO -> ADC channel name (only populated for ADC-capable pins). */
      channelForPin: Record<number, string>;
    }[];
  };

  /** DAC channel map (classic ESP32 only). Absent / empty when chip.lacks includes 'dac'. */
  dac?: {
    channelForPin: Record<number, string>;
  };

  /** Capabilities absent on this variant — drives profileDiagnostics errors. */
  lacks: ('dac' | 'ledc-high-speed')[];

  ledc: {
    timerBits: number;
    lowSpeedChannels: number;
    highSpeedChannels: number;
  };

  cpu: {
    defaultFreqMhz: number;
    minFreqMhz: number;
    maxFreqMhz: number;
  };
}
