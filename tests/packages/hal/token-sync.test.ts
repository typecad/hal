// ---------------------------------------------------------------------------
// Token-sync — the hand-declared class statics must equal the GENERATED
// Zephyr token sets (scripts/gen-zephyr-hal-tokens.mjs, parsed from the
// pinned tree's headers). A Zephyr revision that adds or renames a token
// fails here until the class statics are updated — the drift guard that
// keeps editor completion and build validation telling the same truth.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { ADC } from '../../../packages/hal/src/adc-pin';
import { GPIO } from '../../../packages/hal/src/gpio-pin';
import {
  ZEPHYR_ADC_GAINS,
  ZEPHYR_ADC_REFERENCES,
  ZEPHYR_GPIO_FLAGS,
  ZEPHYR_GPIO_INTS,
} from '../../../packages/hal/src/zephyr-tokens.generated';

const staticNames = (cls: object, prefix: string): string[] =>
  Object.getOwnPropertyNames(cls)
    .filter((k) => k !== 'length' && k.startsWith(prefix) && typeof (cls as any)[k] === 'number')
    .map((k) => k.slice(prefix.length))
    .sort();

describe('thin-HAL token sync (statics ↔ generated Zephyr sets)', () => {
  it('ADC gain tokens equal enum adc_gain', () => {
    expect(staticNames(ADC, 'GAIN_')).toEqual([...ZEPHYR_ADC_GAINS].sort());
  });

  it('ADC reference tokens equal enum adc_reference', () => {
    expect(staticNames(ADC, 'REF_')).toEqual([...ZEPHYR_ADC_REFERENCES].sort());
  });

  it('GPIO config-flag tokens equal the header flag set', () => {
    expect(staticNames(GPIO, '').filter((k) => !k.startsWith('INT_')))
      .toEqual([...ZEPHYR_GPIO_FLAGS].sort());
  });

  it('GPIO interrupt tokens equal the header INT set', () => {
    expect(staticNames(GPIO, 'INT_').map((k) => `INT_${k}`)).toEqual([...ZEPHYR_GPIO_INTS].sort());
  });
});
