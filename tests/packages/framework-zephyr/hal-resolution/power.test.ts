// ---------------------------------------------------------------------------
// power.test.ts — the explicit power-state surface (hal/power.ts): the
// harvested cpu-power-states facts reach the manifest, the Power gate rides
// them, and Power.off() lowers to sys_poweroff() end to end.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { lowerPower } from '../../../../packages/framework-zephyr/src/lowering/power';
import { buildModule } from '../../../../packages/framework-zephyr/src/boardgen';

import { transpile, expectCppContains } from '../../../setup';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';
import { generateBoard } from '../../../../packages/framework-zephyr/src/boardgen';
import type { BoardConstants } from '../../../../packages/cuttlefish/src/api/shared/board-resolver';

describe('power lowering', () => {
  it('off lowers to the kernel poweroff call', () => {
    const out = lowerPower({ operation: 'power.off' } as any);
    expect(out.code).toBe('sys_poweroff();');
  });
});

describe('power facts (hand-built entries, the pin-docs convention)', () => {
  // ESP32 shape: standby (policy-entered) + soft-off (explicit-only).
  const espEntry: any = {
    identifier: 'testkit/esp32s3', name: 'Test Kit', vendor: 'typecad', dts: '',
    powerStates: [
      { name: 'standby', minResidencyUs: 1000, exitLatencyUs: 50, enabled: true },
      { name: 'soft-off', enabled: false },
    ],
  };
  it('states reach the manifest with their timing and enabled flags', () => {
    const g = buildModule(espEntry);
    const j = JSON.parse(g.boardJson);
    expect(j.constants['zephyr.power.states.0.name']).toBe('standby');
    expect(j.constants['zephyr.power.states.0.minResidencyUs']).toBe(1000);
    expect(j.constants['zephyr.power.states.0.enabled']).toBe(true);
    expect(j.constants['zephyr.power.states.1.name']).toBe('soft-off');
    // Deep sleep is explicit-entry only — the idle policy may not take it.
    expect(j.constants['zephyr.power.states.1.enabled']).toBe(false);
    expect(j.constants['zephyr.power.softOff']).toBe(true);
    expect(g.boardTs).toContain('export { Power }');
  });

  // STM32F4 shape: one policy state, no declared soft-off level.
  const stmEntry: any = {
    identifier: 'testpill/stm32f411xe', name: 'Test Pill', vendor: 'typecad', dts: '',
    powerStates: [{ name: 'suspend-to-idle', minResidencyUs: 400, exitLatencyUs: 300, enabled: true }],
  };
  it('a suspend-to-idle-only board exports Power with softOff false', () => {
    const g = buildModule(stmEntry);
    const j = JSON.parse(g.boardJson);
    expect(j.constants['zephyr.power.states.0.name']).toBe('suspend-to-idle');
    expect(j.constants['zephyr.power.softOff']).toBe(false);
    // The gate rides ANY declared state — sys_poweroff works regardless of
    // whether the DT enumerates a soft-off level.
    expect(g.boardTs).toContain('export { Power }');
  });

  it('a SoC with no declared states exports nothing', () => {
    const bare: any = { identifier: 'bare/none', name: 'Bare', vendor: 'typecad', dts: '' };
    expect(buildModule(bare).boardTs).not.toContain('export { Power }');
  });
});

describe('power end-to-end (esp32s3 target)', () => {
  it('Power.off() flows through the resolver to sys_poweroff', () => {
    const constants: BoardConstants = new Map(Object.entries(JSON.parse(generateBoard('esp32s3_devkitc/esp32s3/procpu').boardJson).constants));
    const result = transpile(`
      import { Power, Time, UART0 } from '@typecad/hal';

      UART0.writeLine('going under');
      Time.sleep(100);
      Power.off();
    `, {
      strategy: new ZephyrStrategy(),
      target: 'zephyr',
      boardConstants: constants,
      platformContext: { frameworkData: { target: 'esp32s3_devkitc' } } as any,
    });

    expectCppContains(result, [
      'sys_poweroff();',
    ]);
  });
});
