import { describe, it, expect } from 'vitest';
import { TEST_CHIP } from '../helpers/test-chip';
import { blackpillRev19 } from '../helpers/blackpill-rev19';
import { lowerAdc, adcChannelForPin, adcInitLines, adcControllerForPin } from '../../../../packages/framework-zephyr/src/lowering/adc';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';
import { generateBoard, nrfSaadcAinPads } from '../../../../packages/framework-zephyr/src/boardgen';
import { transpile, expectCppContains } from '../../../setup';
import type { ZephyrChipDescriptor } from '../../../../packages/framework-zephyr/src/chips/types';

// SoC-aware ADC chip (the Black Pill shape): the STM32 driver requires
// exactly ADC_GAIN_1 + ADC_REF_INTERNAL with vref = VDDA (3300 mV).
const STM32_ADC: ZephyrChipDescriptor = {
  id: 'blackpill_f411ce/stm32f411xe', soc: 'stm32f411', gpioController: 'gpioa',
  gpio: { dtSpecs: [] },
  adc: {
    nodeLabel: 'adc1', resolution: 12, vrefMv: 3300,
    gain: 'ADC_GAIN_1', reference: 'ADC_REF_INTERNAL',
    channels: [{ pin: 0, channel: 0, pinctrl: 'adc1_in0_pa0' }],
  },
};

// All ten bonded ADC1 channels (the real Black Pill descriptor shape).
const STM32_ADC_ALL: ZephyrChipDescriptor = {
  id: 'blackpill_f411ce/stm32f411xe', soc: 'stm32f411', gpioController: 'gpioa',
  gpio: { dtSpecs: [] },
  adc: {
    nodeLabel: 'adc1', resolution: 12, vrefMv: 3300,
    gain: 'ADC_GAIN_1', reference: 'ADC_REF_INTERNAL',
    channels: [
      { pin: 0, channel: 0, pinctrl: 'adc1_in0_pa0' },
      { pin: 1, channel: 1, pinctrl: 'adc1_in1_pa1' },
      { pin: 2, channel: 2, pinctrl: 'adc1_in2_pa2' },
      { pin: 3, channel: 3, pinctrl: 'adc1_in3_pa3' },
      { pin: 4, channel: 4, pinctrl: 'adc1_in4_pa4' },
      { pin: 5, channel: 5, pinctrl: 'adc1_in5_pa5' },
      { pin: 6, channel: 6, pinctrl: 'adc1_in6_pa6' },
      { pin: 7, channel: 7, pinctrl: 'adc1_in7_pa7' },
      { pin: 16, channel: 8, pinctrl: 'adc1_in8_pb0' },
      { pin: 17, channel: 9, pinctrl: 'adc1_in9_pb1' },
    ],
  },
};

describe('adc channel resolution', () => {
  it('XIAO D0 (pin 2) → SAADC channel 0', () => {
    expect(adcChannelForPin(TEST_CHIP, 2)).toBe(0);
  });
  it('XIAO D1 (pin 3) → SAADC channel 1', () => {
    expect(adcChannelForPin(TEST_CHIP, 3)).toBe(1);
  });
  it('unmapped pin → -1 (drives the profileDiagnostic + link-error guard)', () => {
    expect(adcChannelForPin(TEST_CHIP, 99)).toBe(-1);
  });
});

describe('adc init block', () => {
  it('emits CUTTLEFISH_ADC markers + the SAADC device + per-channel setup', () => {
    const lines = adcInitLines(TEST_CHIP).join('|');
    expect(lines).toContain('// CUTTLEFISH_ADC_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_ADC_END');
    expect(lines).toContain('DEVICE_DT_GET(DT_NODELABEL(adc))');
    expect(lines).toContain('adc_channel_setup');
    expect(lines).toContain('__tc_adc0_setup');
    // resolution + vref defines
    expect(lines).toContain('#define __TC_ADC_RESOLUTION 12');
    expect(lines).toContain('#define __TC_ADC_VREF_MV 3000');
  });
});

describe('per-use ADC channel gating (unused functions must not be emitted)', () => {
  it('emits setup functions only for the channels the program reads', () => {
    // Only PA1 (channel 1) read: the other nine descriptor channels' static
    // setup functions would trip -Wunused-function in the single TU.
    const used = new Set<number>([1]);
    const lines = adcInitLines(STM32_ADC_ALL, used).join('\n');
    expect(lines).toContain('__tc_adc1_setup');
    expect(lines).not.toContain('__tc_adc0_setup');
    expect(lines).not.toContain('__tc_adc9_setup');
  });

  it('emits every descriptor channel when no usage set is given (probe path)', () => {
    const lines = adcInitLines(STM32_ADC_ALL).join('\n');
    expect(lines).toContain('__tc_adc0_setup');
    expect(lines).toContain('__tc_adc9_setup');
  });
});

describe('SoC-aware ADC channel setup (descriptor-driven gain/reference)', () => {
  it('uses the descriptor gain/reference (STM32: ADC_GAIN_1 + ADC_REF_INTERNAL)', () => {
    const lines = adcInitLines(STM32_ADC).join('\n');
    expect(lines).toContain('.gain = ADC_GAIN_1,');
    expect(lines).toContain('.reference = ADC_REF_INTERNAL,');
    expect(lines).toContain('DEVICE_DT_GET(DT_NODELABEL(adc1))');
  });


  it("defaults to the nRF SAADC scheme when the descriptor omits gain/reference (XIAO regression)", () => {
    const lines = adcInitLines(TEST_CHIP).join('\n');
    expect(lines).toContain('.gain = ADC_GAIN_1_4,');
    const out = lowerAdc({ operation: 'adc.read_mv', pin: 2, gain: '', reference: '' } as any, TEST_CHIP);
    expect(out.expression).toContain('adc_raw_to_millivolts(3000, ADC_GAIN_1_4, 12');
  });
});

describe('ADC read nested in another HAL call (blackpill demo regression)', () => {
  // `sense.readMillivolts()` inside a `USB0.writeLine(...)` template is
  // inlined into the write's emit text — the adc.* op never becomes an IR
  // node, so the program analysis can only see it via the lowering's
  // resolved-op record, and the lowering needs the chip resolved at IR-build
  // time (before the emitter's prepareChip). Missing either half emitted C++
  // that referenced adc.h / __tc_adc_dev that were never declared, with
  // channel_id = -1 (the BIT(-1) negative-shift warning) and the nRF default
  // gain the STM32 driver rejects.
  it('emits adc.h, the adc1 device handle, and the real channel/gain/vref', () => {
    const { boardTs, boardConstants } = blackpillRev19();
    const result = transpile(
      [
        "import { ADC } from '@typecad/hal';",
        "import { USB0, PA0 } from '@typecad/board';",
        'const sense = new ADC(PA0);',
        'USB0.open();',
        'USB0.writeLine(`adc: ${sense.readMillivolts()}`);',
        '',
      ].join('\n'),
      {
        strategy: new ZephyrStrategy(),
        boardConstants,
        boardTs,
        platformContext: { frameworkData: { target: 'blackpill_f411ce' } } as never,
      },
    );
    const errs = (result.diagnostics ?? []).filter((d) => d.severity === 'error');
    expect(errs.map((d) => d.message)).toEqual([]);
    expectCppContains(result, [
      '#include <zephyr/drivers/adc.h>',
      '__tc_adc_dev = DEVICE_DT_GET(DT_NODELABEL(adc1))',
      // PA0 → ADC1_IN0, not the -1 default.
      '.channel_id = 0,',
      '.channels = BIT(0)',
      // The STM32 pair from the board manifest — the driver rejects 1/4.
      '.gain = ADC_GAIN_1,',
      'adc_raw_to_millivolts(3300, ADC_GAIN_1, 12',
    ]);
  });
});

// Multi-controller shape (the ESP32-S3 descriptor after the every-unit
// harvest): adc0 pads implicit-primary, adc1 pads carry their controller.
// Channel indices COLLIDE across controllers (both units have channel 0).
const ESP32S3_TWO_UNITS: ZephyrChipDescriptor = {
  id: 'esp32s3_devkitc/esp32s3/procpu', soc: 'esp32s3', gpioController: 'gpio0',
  gpio: { dtSpecs: [] },
  adc: {
    nodeLabel: 'adc0', resolution: 12, vrefMv: 1100,
    channels: [
      { pin: 1, channel: 0 },
      { pin: 2, channel: 1 },
      { pin: 11, channel: 0, controller: 'adc1' },
      { pin: 12, channel: 1, controller: 'adc1' },
    ],
  },
};

describe('multi-controller ADC (channel indices collide across controllers)', () => {
  it('resolves the channel by (controller, pin), not channel number alone', () => {
    // Pin 11 is adc1 channel 0; a naive channel-number lookup would return
    // adc0's channel and read the wrong pad.
    expect(adcChannelForPin(ESP32S3_TWO_UNITS, 11)).toBe(0);
    expect(adcControllerForPin(ESP32S3_TWO_UNITS, 11)).toBe('adc1');
    expect(adcControllerForPin(ESP32S3_TWO_UNITS, 1)).toBe('adc0');
  });

  it('init lines emit a device handle per used controller and collision-safe setup symbols', () => {
    const lines = adcInitLines(ESP32S3_TWO_UNITS, new Set([11])).join('\n');
    expect(lines).toContain('static const struct device* __tc_adc_dev = DEVICE_DT_GET(DT_NODELABEL(adc0));');
    expect(lines).toContain('static const struct device* __tc_adc_adc1_dev = DEVICE_DT_GET(DT_NODELABEL(adc1));');
    // adc1 channel 0 must not reuse adc0 channel 0's __tc_adc0_setup symbol.
    expect(lines).toContain('__tc_adc_adc1_0_setup');
    expect(lines).not.toContain('__tc_adc0_setup');
  });

  it('single-controller output is unchanged: no extra handle, no labeled symbols', () => {
    const lines = adcInitLines(STM32_ADC_ALL, new Set([1])).join('\n');
    expect(lines).not.toContain('__tc_adc_adc1_dev');
    expect(lines).not.toMatch(/__tc_adc_\w+_\d+_setup/);
  });

  it('read ops address the owning controller device handle', () => {
    const primary = lowerAdc(
      { operation: 'adc.read_raw', pin: 1 } as never,
      ESP32S3_TWO_UNITS,
    );
    expect(primary.expression).toContain('adc_channel_setup(__tc_adc_dev,');
    const second = lowerAdc(
      { operation: 'adc.read_raw', pin: 11 } as never,
      ESP32S3_TWO_UNITS,
    );
    expect(second.expression).toContain('adc_channel_setup(__tc_adc_adc1_dev,');
    expect(second.expression).toContain('adc_read(__tc_adc_adc1_dev, &__s);');
  });
});

// ── nRF52 SAADC synthesis ────────────────────────────────────────────────────
//
// Nordic silicon has no per-pad ADC devicetree (the AIN index IS the channel;
// the XIAO's board DTS carries no ADC node at all), so nRF boards synthesize
// their channels from the family's silicon-fixed AIN pad map — without it,
// every ADC read on an nRF target emitted channel_id = -1.

describe('nRF52 SAADC synthesized channels (xiao_ble regression)', () => {
  it('the generated manifest carries all eight AIN channels with the SAADC vref scheme', () => {
    const g = generateBoard('xiao_ble/nrf52840');
    const c: Record<string, string | number | boolean> = JSON.parse(g.boardJson).constants;
    expect(c['zephyr.adc.nodeLabel']).toBe('adc');
    expect(c['zephyr.adc.vrefMv']).toBe(3000);
    // AIN0-7 = P0.02-P0.05, P0.28-P0.31 (DK io-channel-map verified).
    const expectChannels: [number, number][] = [[2, 0], [3, 1], [4, 2], [5, 3], [28, 4], [29, 5], [30, 6], [31, 7]];
    for (const [pin, channel] of expectChannels) {
      expect(c[`zephyr.adc.channels.${channel}.pin`]).toBe(pin);
      expect(c[`zephyr.adc.channels.${channel}.channel`]).toBe(channel);
    }
    // The narrowed gateway: the board module now re-exports ADC.
    expect(g.boardTs).toContain("export { ADC } from '@typecad/hal'");
  });

  it('transpiles an ADC read on the XIAO against the synthesized channel map', () => {
    const g = generateBoard('xiao_ble/nrf52840');
    const result = transpile(
      [
        "import { ADC } from '@typecad/hal';",
        "import { P0_02 } from '@typecad/board';",
        'const sense = new ADC(P0_02);',
        'const v = sense.read();',
        'if (v > 0) { sense.readMillivolts(); }',
        '',
      ].join('\n'),
      {
        strategy: new ZephyrStrategy(),
        boardConstants: new Map(Object.entries(JSON.parse(g.boardJson).constants)) as never,
        boardTs: g.boardTs,
        platformContext: { frameworkData: { target: 'xiao_ble' } } as never,
      },
    );
    const errs = (result.diagnostics ?? []).filter((d) => d.severity === 'error');
    expect(errs.map((d) => d.message)).toEqual([]);
    expectCppContains(result, [
      '#include <zephyr/drivers/adc.h>',
      '__tc_adc_dev = DEVICE_DT_GET(DT_NODELABEL(adc))',
      // P0_02 = AIN0 → channel 0, not -1.
      '.channel_id = 0,',
      '.channels = BIT(0)',
      // The SAADC default pair (gain 1/4, internal ref, 3000 mV scheme).
      '.gain = ADC_GAIN_1_4,',
      'adc_raw_to_millivolts(3000, ADC_GAIN_1_4, 12',
    ]);
  });
});

// ── nRF SAADC family tables (nrf5340 / nrf91xx) ──────────────────────────────
//
// Every entry is [channel, P0 pad], verified against the in-tree DK
// io-channel-map comments; SoCs/entries without an agreeing in-tree source
// stay out of the table (the pad is then honestly non-analog).

describe('nrfSaadcAinPads family tables', () => {
  it('nrf52832/nrf52840: all eight AINs (nrf52840dk, nrf52dk)', () => {
    const expected: [number, number][] = [[0, 2], [1, 3], [2, 4], [3, 5], [4, 28], [5, 29], [6, 30], [7, 31]];
    expect(nrfSaadcAinPads('nrf52840', 'xiao_ble/nrf52840')).toEqual(expected);
    expect(nrfSaadcAinPads('nrf52832', 'nrf52dk/nrf52832')).toEqual(expected);
  });

  it('nrf5340: AIN0-5 only — AIN6/AIN7 have no agreeing in-tree source', () => {
    expect(nrfSaadcAinPads('nrf5340', 'nrf5340dk/nrf5340/cpuapp'))
      .toEqual([[0, 4], [1, 5], [2, 6], [3, 7], [4, 25], [5, 26]]);
    // The ns (non-secure) app-core variant keeps the SAADC.
    expect(nrfSaadcAinPads('nrf5340', 'nrf5340dk/nrf5340/cpuapp/ns')).toBeDefined();
  });

  it('nrf5340 netcore declares no SAADC — no synthesis there', () => {
    expect(nrfSaadcAinPads('nrf5340', 'nrf5340dk/nrf5340/cpunet')).toBeUndefined();
    expect(nrfSaadcAinPads('nrf5340', 'nrf5340dk/nrf5340/cpunet/ns')).toBeUndefined();
  });

  it('nrf9160/nrf9161/nrf9151: AIN1-6 (three DKs agree); AIN0/AIN7 omitted', () => {
    const expected: [number, number][] = [[1, 14], [2, 15], [3, 16], [4, 17], [5, 18], [6, 19]];
    expect(nrfSaadcAinPads('nrf9160', 'actinius_icarus/nrf9160')).toEqual(expected);
    expect(nrfSaadcAinPads('nrf9161', 'nrf9161dk/nrf9161')).toEqual(expected);
    expect(nrfSaadcAinPads('nrf9151', 'nrf9151dk/nrf9151')).toEqual(expected);
  });

  it('SoCs without verified maps stay out (nRF54L VND SAADC, unverified nRF52 variants)', () => {
    expect(nrfSaadcAinPads('nrf54l15', 'nrf54l15dk/nrf54l15/cpuapp')).toBeUndefined();
    expect(nrfSaadcAinPads('nrf52811', 'nrf52840dk/nrf52811')).toBeUndefined();
    expect(nrfSaadcAinPads('nrf52833', 'nrf52833dk/nrf52833')).toBeUndefined();
    expect(nrfSaadcAinPads('stm32f411xe', 'blackpill_f411ce/stm32f411xe')).toBeUndefined();
  });
});
