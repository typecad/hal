// ---------------------------------------------------------------------------
// power-offfor.test.ts — timed soft-off (Power.offFor): the harvested
// RTC wake-timer fact gates a real arming call, boards without it get the
// DAC-discipline comment, and the resolver path splices runtime delays.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { lowerPower } from '../../../../packages/framework-zephyr/src/lowering/power';

import { transpile, expectCppContains } from '../../../setup';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';
import { generateBoard } from '../../../../packages/framework-zephyr/src/boardgen';
import type { BoardConstants } from '../../../../packages/cuttlefish/src/api/shared/board-resolver';

const WITH_TIMER = { powerWakeTimer: true } as any;
const WITHOUT = {} as any;

describe('power.off_for lowering', () => {
  it('arms the RTC timer in µs then enters soft-off (wake-timer fact)', () => {
    const out = lowerPower({ operation: 'power.off_for', ms: '60000' } as any, WITH_TIMER);
    expect(out.code).toContain('esp_sleep_enable_timer_wakeup(static_cast<uint64_t>(60000) * 1000ULL)');
    expect(out.code).toContain('sys_poweroff();');
  });

  it('runtime delay expressions splice through (computed intervals)', () => {
    const out = lowerPower({ operation: 'power.off_for', ms: 'intervalMs' } as any, WITH_TIMER);
    expect(out.code).toContain('static_cast<uint64_t>(intervalMs) * 1000ULL');
  });

  it('boards without the fact lower to the honest comment (DAC discipline)', () => {
    const out = lowerPower({ operation: 'power.off_for', ms: '60000' } as any, WITHOUT);
    expect(out.code).toContain('no RTC wake timer');
    expect(out.code).not.toContain('esp_sleep');
  });
});

describe('power.off_for end-to-end (esp32s3 target)', () => {
  it('offFor flows through the resolver into the armed poweroff', () => {
    // The fixture catalog lacks the wake-timer fact — inject it the way
    // the thin-classes tests inject the LEDC matrix (same discipline).
    const constants: BoardConstants = new Map(Object.entries(JSON.parse(generateBoard('esp32s3_devkitc/esp32s3/procpu').boardJson).constants));
    constants.set('zephyr.power.wakeTimer', true);
    const result = transpile(`
      import { Power } from '@typecad/hal';

      Power.offFor(60_000);
    `, {
      strategy: new ZephyrStrategy(),
      target: 'zephyr',
      boardConstants: constants,
      platformContext: { frameworkData: { target: 'esp32s3_devkitc' } } as any,
    });

    expectCppContains(result, [
      'esp_sleep_enable_timer_wakeup(static_cast<uint64_t>(60000) * 1000ULL)',
      'sys_poweroff();',
    ]);
  });
});
