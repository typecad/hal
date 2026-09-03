// ---------------------------------------------------------------------------
// as-built.test.ts — the third fact source: routes harvested from a build's
// resolved zephyr.dts (label grammar only — immune to vendor macro churn),
// merged per-pin over the catalog harvest with the build winning.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { parseZephyrDts, parseAsBuiltJson, asBuiltJson } from '../../../packages/framework-zephyr/src/as-built';
import { generateBoard } from '../../../packages/framework-zephyr/src/boardgen';

// A trimmed excerpt shaped like the real artifact (dtc output: labels
// inline, node names repeated, provenance comments, expanded pinmux).
const ZEPHYR_DTS = [
  '/dts-v1/;',
  '/ {',
  'soc {',
  'pin-controller@40020000 {',
  'adc1_in0_pa0: adc1_in0_pa0 {',
  'pinmux = < 0x10 >;',
  '};',
  'adc1_in1_pa1: adc1_in1_pa1 {',
  'pinmux = < 0x11 >;',
  '};',
  'adc1_inn1_pa1: adc1_inn1_pa1 {', // differential negative — excluded
  'pinmux = < 0x11 >;',
  '};',
  'tim4_ch1_pb6: tim4_ch1_pb6 {',
  'pinmux = < 0x402 >;',
  '};',
  'tim4_ch1n_pb7: tim4_ch1n_pb7 {', // complementary — excluded
  'pinmux = < 0x403 >;',
  '};',
  'dac1_out1_pa4: dac1_out1_pa4 {',
  'pinmux = < 0x20 >;',
  '};',
  '};',
  'iomuxc@401f8000 {',
  'iomuxc_gpio_ad_b0_12_gpio1_io12: gpio_ad_b0_12_gpio1_io12 {',
  'pinmux = < 0x401f80ec 5 0x0 0 0x401f82dc >;',
  '};',
  'iomuxc_gpio_ad_b0_12_adc1_in1: gpio_ad_b0_12_adc1_in1 {',
  'pinmux = < 0x401f80ec 5 0x0 0 0x401f82dc >;',
  '};',
  'iomuxc_gpio_ad_b0_00_flexpwm2_pwma3: gpio_ad_b0_00_flexpwm2_pwma3 {',
  'pinmux = < 0x401f80d8 5 0x0 0 0x401f82d0 >;',
  '};',
  '};',
  '};',
  '};',
  '};',
  '',
].join('\n');

describe('parseZephyrDts (label grammar)', () => {
  it('harvests STM32-style adc/pwm/dac routes; differential and complementary excluded', () => {
    const f = parseZephyrDts(ZEPHYR_DTS);
    expect(f.adc.filter((r) => !r.pinctrl.startsWith('iomuxc_')).map((r) => `${r.source}:${r.channel}:${r.port}${r.bit}`)).toEqual([
      'adc1:0:A0', 'adc1:1:A1',
    ]);
    expect(f.pwm.map((r) => `${r.source}:${r.channel}:${r.port}${r.bit}`)).toEqual(['tim4:1:B6']);
    expect(f.dac.map((r) => `${r.source}:${r.channel}:${r.port}${r.bit}`)).toEqual(['dac1:1:A4']);
    expect(f.adc.some((r) => r.pinctrl.includes('inn'))).toBe(false);
    expect(f.pwm.some((r) => r.pinctrl.includes('ch1n'))).toBe(false);
  });

  it('harvests i.MX routes through the in-band gpio join', () => {
    const f = parseZephyrDts(ZEPHYR_DTS);
    const imxAdc = f.adc.find((r) => r.pinctrl.startsWith('iomuxc_'));
    expect(imxAdc).toMatchObject({ source: 'adc1', channel: 1, port: '1', bit: 12 });
    // flexpwm2_pwma3 → controller flexpwm2_pwm3, channel A=0. (No gpio1_io00
    // join in the fixture → the pwma3 route drops — join-or-nothing.)
    expect(f.pwm.find((r) => r.pinctrl.includes('flexpwm'))).toBeUndefined();
  });

  it('round-trips through asBuiltJson/parseAsBuiltJson with validation', () => {
    const f = parseZephyrDts(ZEPHYR_DTS);
    const json = asBuiltJson('b/soc', f);
    const parsed = parseAsBuiltJson(json);
    expect(parsed.board).toBe('b/soc');
    expect(parsed.routes.adcPins).toHaveLength(3); // 2 STM32 + 1 imx
    expect(() => parseAsBuiltJson('{')).toThrow(/as-built\.json is not valid JSON/);
    expect(() => parseAsBuiltJson('{"version":2}')).toThrow(/version 1/);
  });
});

describe('generateBoard as-built merge', () => {
  it('escape: as-built routes light up a harvest-less fixture board', () => {
    // Fixture blackpill (gpioa/gpioc letter controllers) predates the
    // pinctrl harvest — zero adc/pwm routes. The snapshot supplies them.
    const plain = generateBoard('blackpill_f411ce/stm32f411xe');
    const plainC = JSON.parse(plain.boardJson).constants;
    const plainAdc = Object.keys(plainC).filter((k) => /^zephyr\.adc\.channels\.\d+\.pin$/.test(k)).length;
    expect(plainAdc).toBe(0);

    const g = generateBoard('blackpill_f411ce/stm32f411xe', {
      asBuiltJson: asBuiltJson('blackpill_f411ce/stm32f411xe', parseZephyrDts(ZEPHYR_DTS)),
    });
    const c = JSON.parse(g.boardJson).constants;
    expect(c['zephyr.adc.channels.0.pin']).toBe(0); // PA0 → gpioa minPin + 0
    expect(c['zephyr.adc.channels.0.channel']).toBe(0);
    expect(c['zephyr.adc.channels.0.pinctrl']).toBe('adc1_in0_pa0');
    expect(Object.keys(c).some((k) => /^zephyr\.pwm\.specs\.\d+\.pinctrl$/.test(k) && c[k] === 'tim4_ch1_pb6')).toBe(true);
    expect(g.boardTs).toContain("export { ADC } from '@typecad/hal'");
    // Fingerprint moves with the applied snapshot (staleness regen).
    expect(JSON.parse(g.boardJson).source.fingerprint)
      .not.toBe(JSON.parse(plain.boardJson).source.fingerprint);
  });

  it('stability: same snapshot twice is identical; a foreign snapshot is ignored', () => {
    const snap = asBuiltJson('blackpill_f411ce/stm32f411xe', parseZephyrDts(ZEPHYR_DTS));
    const a = generateBoard('blackpill_f411ce/stm32f411xe', { asBuiltJson: snap });
    const b = generateBoard('blackpill_f411ce/stm32f411xe', { asBuiltJson: snap });
    expect(a.boardJson).toBe(b.boardJson);
    expect(a.warnings).toBeUndefined(); // harvest-less board — nothing to disagree with
    const foreign = generateBoard('blackpill_f411ce/stm32f411xe', {
      asBuiltJson: asBuiltJson('other/board', parseZephyrDts(ZEPHYR_DTS)),
    });
    expect(JSON.parse(foreign.boardJson).source.fingerprint)
      .toBe(JSON.parse(generateBoard('blackpill_f411ce/stm32f411xe').boardJson).source.fingerprint);
  });

  it('user facts still outrank the as-built snapshot on the same pin', () => {
    const userWins = generateBoard('blackpill_f411ce/stm32f411xe', {
      asBuiltJson: asBuiltJson('blackpill_f411ce/stm32f411xe', parseZephyrDts(ZEPHYR_DTS)),
      factsJson: JSON.stringify({
        boards: { 'blackpill_f411ce/stm32f411xe': { adc: { channels: [{ pin: 0, channel: 7 }] } } },
      }),
    });
    const c = JSON.parse(userWins.boardJson).constants as Record<string, unknown>;
    // The user's channel 7 for pin 0, wherever the splice landed the entry.
    const pin0Key = Object.keys(c).find((k) => /^zephyr\.adc\.channels\.\d+\.pin$/.test(k) && c[k] === 0);
    expect(pin0Key).toBeDefined();
    expect(c[pin0Key!.replace('.pin', '.channel')]).toBe(7); // user's 7, not the build's 0
    expect(userWins.warnings?.some((w) => /user channel 7 shadows/.test(w))).toBe(true);
  });
});
