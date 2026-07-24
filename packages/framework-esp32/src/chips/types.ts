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
    /** Deep-sleep pin-wakeup API family this chip uses.
     *  Xtensa (ESP32, S3) support ext0/ext1 on RTC GPIO; RISC-V (C3, C6) use the
     *  esp_sleep_enable_gpio_wakeup variant. Drives the power.deep_sleep_pin lowering. */
    wakeupApi: 'ext0_ext1' | 'gpio_wakeup';
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
  lacks: ('dac' | 'rmt')[];

  /** RMT channel budget per variant. Classic ESP32 channels are bidirectional
   *  (8 total); modeled here as separate TX/RX caps since the pin-based
   *  allocator counts each direction independently. Absent when lacks includes
   *  'rmt' (none of the four current variants lack it, but the path exists). */
  rmt?: {
    txChannels: number;
    rxChannels: number;
  };

  ledc: {
    timerBits: number;
    lowSpeedChannels: number;
  };

  cpu: {
    defaultFreqMhz: number;
    minFreqMhz: number;
    maxFreqMhz: number;
  };
}
