// ---------------------------------------------------------------------------
// zephyr-tokens.generated.ts — the thin-HAL token name sets
//
// GENERATED FILE — do not edit by hand. Regenerate against the pinned
// workspace with:
//
//   node scripts/gen-zephyr-hal-tokens.mjs <zephyr-base>
//
// Derived from Zephyr 4.4.2: enum adc_gain / enum adc_reference
// (include/zephyr/drivers/adc.h), the GPIO config flags (drivers/gpio.h +
// dt-bindings/gpio/gpio.h), and the GPIO_INT_* interrupt configurations
// (drivers/gpio.h). 21 gains, 7 references,
// 9 flags, 6 interrupt configs.
//
// The class statics stay hand-declared for editor typing; the token-sync
// test asserts they match these sets. The lowerings build their
// token→macro maps from these lists — names only; values never cross to C++.
// ---------------------------------------------------------------------------

/** enum adc_gain suffixes — ADC.GAIN_<name> ↔ ADC_GAIN_<name>. */
export const ZEPHYR_ADC_GAINS: readonly string[] = [
  '1_6',
  '1_5',
  '1_4',
  '2_7',
  '1_3',
  '2_5',
  '1_2',
  '2_3',
  '4_5',
  '1',
  '2',
  '3',
  '4',
  '6',
  '8',
  '12',
  '16',
  '24',
  '32',
  '64',
  '128',
];

/** enum adc_reference suffixes — ADC.REF_<name> ↔ ADC_REF_<name>. */
export const ZEPHYR_ADC_REFERENCES: readonly string[] = [
  'VDD_1',
  'VDD_1_2',
  'VDD_1_3',
  'VDD_1_4',
  'INTERNAL',
  'EXTERNAL0',
  'EXTERNAL1',
];

/** GPIO config flag names — GPIO.<name> ↔ GPIO_<name>. */
export const ZEPHYR_GPIO_FLAGS: readonly string[] = [
  'INPUT',
  'OUTPUT',
  'OUTPUT_INIT_LOW',
  'OUTPUT_INIT_HIGH',
  'PULL_UP',
  'PULL_DOWN',
  'OPEN_DRAIN',
  'OPEN_SOURCE',
  'DISCONNECTED',
];

/** GPIO interrupt configuration names — GPIO.INT_<name> ↔ GPIO_INT_<name>. */
export const ZEPHYR_GPIO_INTS: readonly string[] = [
  'INT_DISABLE',
  'INT_EDGE_RISING',
  'INT_EDGE_FALLING',
  'INT_EDGE_BOTH',
  'INT_LEVEL_LOW',
  'INT_LEVEL_HIGH',
];
