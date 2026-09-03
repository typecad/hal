// ---------------------------------------------------------------------------
// soc-pin-inventory.test.ts — the "every pin + capability" guarantees P1/P3
// add to the pipeline, exercised at the boardgen boundary:
//
//   P3 — GPIO controller inventory: a board whose DTS names only one port
//   sweeps EVERY port the SoC dtsi declares (the full pin inventory), with
//   ngpios refining letter-port widths.
//
//   P1 — silicon ADC routes (header/pinconfig pinctrl tokens) map to per-pin
//   `analogInput` capability flags and `zephyr.adc.channels` specs, exactly
//   like the STM32 pinctrl harvest.
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { buildModule } from '../../../packages/framework-zephyr/src/boardgen';
import type { BoardDataEntry } from '../../../packages/cuttlefish/src/board-catalog/types';

function record(overrides: Partial<BoardDataEntry>): BoardDataEntry {
  return {
    identifier: 'port_board/acme_soc',
    name: 'Port Board',
    vendor: 'testvendor',
    dts: 'port_board.dts',
    ...overrides,
  };
}

describe('P3 — full GPIO controller inventory sweep', () => {
  it('sweeps every SoC port, not just the wired one', () => {
    const g = buildModule(record({
      gpioControllers: [
        { nodelabel: 'gpioa' },
        { nodelabel: 'gpiob', ngpios: 32 },
        { nodelabel: 'gpioc' },
      ],
      led: { dtSpec: 'led0', controller: 'gpioa', pin: 1, flags: [] },
    }));
    const j = JSON.parse(g.boardJson);
    const names = j.pinNames as string[];
    // Full ranges: gpioa 16 (PA0–PA15), gpiob 32 (PB0–PB31, ngpios), gpioc 16.
    expect(names).toContain('PA0');
    expect(names).toContain('PA15');
    expect(names).toContain('PB0');
    expect(names).toContain('PB31');
    expect(names).toContain('PC0');
    expect(names).toContain('PC15');
    expect(names).toHaveLength(64);
    // gpiob is 32 wide → gpioc's base shifts past 32 (16 + 32 = 48).
    expect(j.constants[`pins.all.${names.indexOf('PC0')}.number`]).toBe(48);
  });

  it('ngpios-less ports fall back to the family width heuristic', () => {
    const g = buildModule(record({
      gpioControllers: [{ nodelabel: 'gpioa' }, { nodelabel: 'gpiob' }],
    }));
    const names = JSON.parse(g.boardJson).pinNames as string[];
    expect(names).toHaveLength(32); // both 16-wide
    expect(names).toContain('PA15');
    expect(names).toContain('PB15');
    expect(names).not.toContain('PB16');
  });
});

describe('P1 — pinconfig ADC routes at the boardgen boundary', () => {
  it('maps harvested ADC routes to capability flags + channel specs', () => {
    const g = buildModule(record({
      identifier: 'gd_board/gd32f405vg',
      gpioControllers: [{ nodelabel: 'gpioa' }, { nodelabel: 'gpioc' }],
      analogDevices: ['adc0', 'adc1', 'adc2'],
      adcPins: [
        { source: 'adc0', channel: 0, port: 'A', bit: 0, pinctrl: 'ADC012_IN0_PA0' },
        { source: 'adc0', channel: 4, port: 'A', bit: 4, pinctrl: 'ADC01_IN4_PA4' },
        { source: 'adc0', channel: 10, port: 'C', bit: 0, pinctrl: 'ADC012_IN10_PC0' },
      ],
    }));
    const j = JSON.parse(g.boardJson);
    // The ADC class is exported (channels exist) and the channel specs carry
    // the synthesized pinmux tokens for the overlay.
    expect(g.boardTs).toContain("export { ADC } from '@typecad/hal'");
    expect(j.constants['zephyr.adc.nodeLabel']).toBe('adc0');
    expect(j.constants['zephyr.adc.channels.0.pin']).toBe(0); // PA0
    expect(j.constants['zephyr.adc.channels.0.channel']).toBe(0);
    expect(j.constants['zephyr.adc.channels.0.pinctrl']).toBe('ADC012_IN0_PA0');
    // Per-pin analogInput capability flags are honest.
    const names = j.pinNames as string[];
    const pa0 = names.indexOf('PA0');
    expect(j.constants[`pins.all.${pa0}.capabilities.analogInput`]).toBe(true);
    const pa15 = names.indexOf('PA15');
    expect(j.constants[`pins.all.${pa15}.capabilities.analogInput`]).toBe(false);
  });
});
