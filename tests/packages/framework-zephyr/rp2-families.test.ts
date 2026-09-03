// ---------------------------------------------------------------------------
// rp2-families.test.ts — the RP2 header-matrix family end to end: the walker
// harvest (ADC_CH/PWM_* pinmux macros, pinned in catalog-walker.test.ts), the
// boardgen manifest (channels + specs + the gain pair adc_rpi_pico.c
// requires), the lowering, and the overlay's macro-pinctrl synthesis (the
// RP2 ADC and PWM drivers both apply pinctrl — the overlay builds the pad
// groups from the macro tokens and splices the SoC's pinctrl header).
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { generateOverlay } from '../../../packages/framework-zephyr/src/dt-config/overlay';
import { generateBoard } from '../../../packages/framework-zephyr/src/boardgen';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';
import { transpile } from '../../setup';
import type { ZephyrChipDescriptor } from '../../../packages/framework-zephyr/src/chips/types';

/** The rpi_pico fixture board's constants amended with the rev-23 RP2 facts
 *  (the checked-in fixture catalog predates the header harvest). */
function rp2040Rev23(): { boardTs: string; boardConstants: Map<string, string | number | boolean> } {
  const g = generateBoard('rpi_pico/rp2040');
  const consts: Record<string, string | number | boolean> = { ...JSON.parse(g.boardJson).constants };
  consts['zephyr.adc.nodeLabel'] = 'adc';
  consts['zephyr.adc.resolution'] = 12;
  consts['zephyr.adc.vrefMv'] = 3300;
  consts['zephyr.adc.gain'] = 'ADC_GAIN_1';
  consts['zephyr.adc.reference'] = 'ADC_REF_VDD_1';
  const channels: [number, number, string][] = [
    [26, 0, 'ADC_CH0_P26'],
    [27, 1, 'ADC_CH1_P27'],
    [28, 2, 'ADC_CH2_P28'],
    [29, 3, 'ADC_CH3_P29'],
  ];
  channels.forEach(([pin, channel, pinctrl], i) => {
    consts[`zephyr.adc.channels.${i}.pin`] = pin;
    consts[`zephyr.adc.channels.${i}.channel`] = channel;
    consts[`zephyr.adc.channels.${i}.pinctrl`] = pinctrl;
  });
  const specs: [number, number, string][] = [
    [14, 14, 'PWM_7A_P14'],
    [15, 15, 'PWM_7B_P15'],
  ];
  const base = Object.keys(consts).filter((k) => k.startsWith('zephyr.pwm.specs.')).length;
  specs.forEach(([pin, channel, pinctrl], i) => {
    consts[`zephyr.pwm.specs.${base + i}.pin`] = pin;
    consts[`zephyr.pwm.specs.${base + i}.controller`] = 'pwm';
    consts[`zephyr.pwm.specs.${base + i}.channel`] = channel;
    consts[`zephyr.pwm.specs.${base + i}.pinctrl`] = pinctrl;
  });
  return { boardTs: g.boardTs, boardConstants: new Map(Object.entries(consts)) };
}

const RP2_CHIP: ZephyrChipDescriptor = {
  id: 'rp_board/rp2040', soc: 'rp2040', gpioController: 'gpio0',
  gpio: { dtSpecs: [] },
  adc: {
    nodeLabel: 'adc', resolution: 12, vrefMv: 3300,
    gain: 'ADC_GAIN_1', reference: 'ADC_REF_VDD_1',
    channels: [
      { pin: 26, channel: 0, pinctrl: 'ADC_CH0_P26' },
      { pin: 27, channel: 1, pinctrl: 'ADC_CH1_P27' },
    ],
  },
  pwm: {
    specs: [
      { pin: 14, controller: 'pwm', channel: 14, pinctrl: 'PWM_7A_P14' },
      { pin: 15, controller: 'pwm', channel: 15, pinctrl: 'PWM_7B_P15' },
    ],
  },
};

const NRF_CHIP: ZephyrChipDescriptor = {
  id: 'xiao_ble/nrf52840', soc: 'nrf52840', gpioController: 'gpio0',
  gpio: { dtSpecs: [] },
  pwm: {
    matrix: { controller: 'pwm0', channelCount: 4, pins: [2, 3, 4, 5, 28, 29, 30, 31, 32, 33, 40, 41] },
    specs: [],
  },
};

describe('RP2 overlay synthesis (macro pinctrl)', () => {
  it('ADC: synthesizes the pad group from the macros and splices the pinctrl header', () => {
    const overlay = generateOverlay(RP2_CHIP, { usesAdc: true, adcReadPins: [26] }, undefined);
    expect(overlay).toContain('#include <zephyr/dt-bindings/pinctrl/rpi-pico-rp2040-pinctrl.h>');
    expect(overlay).toContain('tc_adc_default: tc-adc-default');
    expect(overlay).toContain('pinmux = <ADC_CH0_P26>;');
    expect(overlay).toContain('&adc {');
    expect(overlay).toContain('pinctrl-0 = <&tc_adc_default>;');
    // The STM32 node-reference form must NOT appear for macro channels.
    expect(overlay).not.toContain('pinctrl-0 = <&ADC_CH0_P26>;');
  });

  it('PWM: one group with the used slices, the &pwm enable, and the alias', () => {
    const overlay = generateOverlay(RP2_CHIP, { usesPwm: true, pwmUsedPins: [15] }, undefined);
    expect(overlay).toContain('#include <zephyr/dt-bindings/pinctrl/rpi-pico-rp2040-pinctrl.h>');
    expect(overlay).toContain('tc_pwm_default: tc-pwm-default');
    expect(overlay).toContain('pinmux = <PWM_7B_P15>;');
    expect(overlay).toContain('&pwm {');
    expect(overlay).toContain('pinctrl-0 = <&tc_pwm_default>;');
    expect(overlay).toContain('tc-pwm15 = &tc_pwm_15;');
    expect(overlay).toContain('pwms = <&pwm 15 20000000 PWM_POLARITY_NORMAL>;');
  });

  it('STM32 node-label pinctrl keeps the reference form (no macro regression)', () => {
    const chip: ZephyrChipDescriptor = {
      ...RP2_CHIP, soc: 'stm32f411xe',
      adc: { nodeLabel: 'adc1', resolution: 12, vrefMv: 3300, channels: [{ pin: 0, channel: 0, pinctrl: 'adc1_in0_pa0' }] },
      pwm: undefined,
    };
    const overlay = generateOverlay(chip, { usesAdc: true, adcReadPins: [0] }, undefined);
    expect(overlay).toContain('pinctrl-0 = <&adc1_in0_pa0>;');
    expect(overlay).not.toContain('tc_adc_default');
  });
});

describe('nRF PWM matrix (psel routing)', () => {
  it('assigns channels in pin order through NRF_PSEL and enables the peripheral', () => {
    // Pin 6 (P0.06) and pin 40 (P1.08 — nRF global layout: P1 base 32).
    const overlay = generateOverlay(
      { ...NRF_CHIP, pwm: { matrix: { controller: 'pwm0', channelCount: 4, pins: [6, 40] }, specs: [] } },
      { usesPwm: true, pwmUsedPins: [6, 40] },
      undefined,
    );
    expect(overlay).toContain('#include <zephyr/dt-bindings/pinctrl/nrf-pinctrl.h>');
    expect(overlay).toContain('tc_pwm0_default: tc-pwm0-default');
    expect(overlay).toContain('psel = <NRF_PSEL(PWM_OUT0, 0, 6)>, <NRF_PSEL(PWM_OUT1, 1, 8)>;');
    expect(overlay).toContain('&pwm0 {');
    expect(overlay).toContain('pinctrl-0 = <&tc_pwm0_default>;');
    // The LEDC channel-children shape must not appear on nRF.
    expect(overlay).not.toContain('channel0@0');
    // The shared tail: alias + pwm-leds consumer against &pwm0 channel 1.
    expect(overlay).toContain('tc-pwm40 = &tc_pwm_40;');
    expect(overlay).toContain('pwms = <&pwm0 1 20000000 PWM_POLARITY_NORMAL>;');
  });

  it('over-driving the matrix is an explicit error naming the ceiling', () => {
    expect(() =>
      generateOverlay(
        { ...NRF_CHIP, pwm: { matrix: { controller: 'pwm0', channelCount: 4, pins: [2, 3, 4, 5, 28] }, specs: [] } },
        { usesPwm: true, pwmUsedPins: [2, 3, 4, 5, 28] },
        undefined,
      ),
    ).toThrow(/5 PWM pins but .* pwm0 exposes only 4 channels/);
  });
});

describe('RP2 end-to-end (manifest constants → lowering)', () => {
  it('transpiles an ADC read on GP26 against the header-matrix channels', () => {
    const { boardTs, boardConstants } = rp2040Rev23();
    const result = transpile(
      [
        "import { ADC } from '@typecad/hal';",
        "import { GP26 } from '@typecad/board';",
        'const sense = new ADC(GP26);',
        'const v = sense.read();',
        'if (v > 0) { sense.readMillivolts(); }',
        '',
      ].join('\n'),
      {
        strategy: new ZephyrStrategy(),
        boardConstants: boardConstants as never,
        boardTs,
        platformContext: { frameworkData: { buildTarget: 'rp_board' } } as never,
      },
    );
    const errs = (result.diagnostics ?? []).filter((d) => d.severity === 'error');
    expect(errs.map((d) => d.message)).toEqual([]);
    expect(result.cpp).toContain('__tc_adc_dev = DEVICE_DT_GET(DT_NODELABEL(adc))');
    expect(result.cpp).toContain('.channel_id = 0,');
    expect(result.cpp).toContain('.channels = BIT(0)');
    // adc_rpi_pico.c rejects every gain but 1.
    expect(result.cpp).toContain('.gain = ADC_GAIN_1,');
    expect(result.cpp).toContain('adc_raw_to_millivolts(3300, ADC_GAIN_1, 12');
    expect(result.cpp).toContain('#include <zephyr/drivers/adc.h>');
  });
});
