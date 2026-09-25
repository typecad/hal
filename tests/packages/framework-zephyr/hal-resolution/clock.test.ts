// ---------------------------------------------------------------------------
// clock.test.ts — the wall-clock surface (hal/clock.ts): the epoch↔civil
// conversion helpers in the shim, both lowerings, the overlay's rtc-counter
// shim synthesis, and the end-to-end resolver path.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { lowerClock, clockInitLines } from '../../../../packages/framework-zephyr/src/lowering/clock';
import { generateOverlay } from '../../../../packages/framework-zephyr/src/dt-config/overlay';
import { ESP32S3_DEVKITC } from '../helpers/test-chip';

import { transpile, expectCppContains } from '../../../setup';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';
import { generateBoard } from '../../../../packages/framework-zephyr/src/boardgen';
import type { BoardConstants } from '../../../../packages/cuttlefish/src/api/shared/board-resolver';

describe('clock shim helpers', () => {
  it('the shim block carries the device handle and both conversion helpers', () => {
    const lines = clockInitLines({ set: true, now: true });
    expect(lines.join('\n')).toContain('static const struct device* __tc_rtc = DEVICE_DT_GET(DT_ALIAS(rtc));');
    expect(lines.join('\n')).toContain('__tc_days_from_civil');
    expect(lines.join('\n')).toContain('__tc_civil_from_days');
  });

  it('helpers gate on verb usage — a now()-only program carries no set() helper', () => {
    const nowOnly = clockInitLines({ set: false, now: true }).join('\n');
    expect(nowOnly).toContain('__tc_days_from_civil');
    expect(nowOnly).not.toContain('__tc_civil_from_days');
    const setOnly = clockInitLines({ set: true, now: false }).join('\n');
    expect(setOnly).not.toContain('__tc_days_from_civil');
    expect(setOnly).toContain('__tc_civil_from_days');
  });
});

describe('clock lowering', () => {
  it('set converts epoch to broken-down time and writes the RTC', () => {
    const out = lowerClock({ operation: 'clock.set', epoch: '1710000000' } as any);
    expect(out.code).toContain('int64_t __tc_ep = static_cast<int64_t>(1710000000)');
    expect(out.code).toContain('__tc_civil_from_days(__tc_ep / 86400');
    expect(out.code).toContain('__tc_tm.tm_year = __tc_y - 1900');
    expect(out.code).toContain('__tc_tm.tm_sec = static_cast<int32_t>(__tc_sod % 60)');
    expect(out.code).toContain('(void)rtc_set_time(__tc_rtc, &__tc_tm);');
  });

  it('now is a fused statement-expression over rtc_get_time', () => {
    const out = lowerClock({ operation: 'clock.now' } as any);
    expect(out.expression).toMatch(/\(\{ struct rtc_time __tc_tm/);
    expect(out.expression).toContain('rtc_get_time(__tc_rtc, &__tc_tm) == 0');
    expect(out.expression).toContain('__tc_days_from_civil(__tc_tm.tm_year + 1900');
    expect(out.expression).toMatch(/__tc_epoch; \}\)$/);
  });

  it('runtime epoch expressions splice through (build-host stamp)', () => {
    const out = lowerClock({ operation: 'clock.set', epoch: 'BUILD_EPOCH' } as any);
    expect(out.code).toContain('static_cast<int64_t>(BUILD_EPOCH)');
  });
});

describe('clock overlay shim', () => {
  it('synthesizes the rtc-counter child on a self-form counter (blackpill rtc)', () => {
    const overlay = generateOverlay(ESP32S3_DEVKITC, {
      usesClock: true,
      clockShimCounter: { label: 'rtc' },
    } as any, undefined);
    expect(overlay).toContain('&rtc {');
    expect(overlay).toContain('tc_rtc: tc-rtc {');
    expect(overlay).toContain('compatible = "zephyr,rtc-counter";');
    expect(overlay).toContain('rtc = &tc_rtc;');
  });

  it('nests inside the counter child for child-form counters (esp32)', () => {
    // The shim driver's DT_INST_PARENT must resolve to the counter DEVICE —
    // nesting inside the counter child, not beside it under the timer.
    const overlay = generateOverlay(ESP32S3_DEVKITC, {
      usesClock: true,
      clockShimCounter: { label: 'tc_counter0', parent: 'timer1' },
    } as any, undefined);
    expect(overlay).toContain('&timer1 {');
    expect(overlay).toMatch(/tc_counter0: counter \{[^}]*tc_rtc: tc-rtc/s);
  });
});

describe('clock end-to-end (esp32s3 target)', () => {
  it('Clock.set/now flow through the resolver', () => {
    const constants: BoardConstants = new Map(Object.entries(JSON.parse(generateBoard('esp32s3_devkitc/esp32s3/procpu').boardJson).constants));
    const result = transpile(`
      import { Clock } from '@typecad/hal';

      Clock.set(1710000000);
      const t = Clock.now();
    `, {
      strategy: new ZephyrStrategy(),
      target: 'zephyr',
      boardConstants: constants,
      platformContext: { frameworkData: { target: 'esp32s3_devkitc' } } as any,
    });

    expectCppContains(result, [
      'static const struct device* __tc_rtc = DEVICE_DT_GET(DT_ALIAS(rtc));',
      'static_cast<int64_t>(1710000000)',
      '(void)rtc_set_time(__tc_rtc, &__tc_tm);',
      'rtc_get_time(__tc_rtc, &__tc_tm)',
    ]);
  });
});
