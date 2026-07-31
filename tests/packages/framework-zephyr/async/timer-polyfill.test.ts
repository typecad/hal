import { describe, it, expect } from 'vitest';
import { buildTimerPolyfill } from '../../../../packages/framework-zephyr/src/async/timer-polyfill';
import type { RuntimePolyfillIR } from '@typecad/cuttlefish/api/shared';

describe('timer polyfill builder', () => {
  it('returns an IR with id timer_methods, domain embedded, no includes', () => {
    const ir = buildTimerPolyfill(4);
    expect(ir.kind).toBe('polyfill');
    expect(ir.id).toBe('timer_methods');
    expect(ir.domain).toBe('embedded');
    expect(ir.requiredIncludes).toEqual([]);
  });

  it('emits a fixed pool of __tc_TimerSlot (k_timer + k_work) sized to maxTimers', () => {
    const ir = buildTimerPolyfill(4) as RuntimePolyfillIR & { maxTimers: number };
    const struct = (ir.helperStructs[0] ?? '').toString();
    // A single slot array; each slot holds a k_timer + k_work + callback + active.
    expect(struct).toContain('struct __tc_TimerSlot');
    expect(struct).toContain('static struct __tc_TimerSlot __tc_timer_slots[4]');
    expect(struct).toContain('struct k_timer');
    expect(struct).toContain('struct k_work');
  });

  it('clamps maxTimers to [1, 16]', () => {
    expect(buildTimerPolyfill(0)).toMatchObject({ maxTimers: 1 });
    expect(buildTimerPolyfill(99)).toMatchObject({ maxTimers: 16 });
  });

  it('exposes __tc_setInterval / __tc_setTimeout / __tc_clearInterval / __tc_clearTimeout helpers', () => {
    const ir = buildTimerPolyfill(2);
    const fns = ir.helperFunctions.join('\n');
    expect(fns).toContain('int32_t __tc_setInterval(void (*cb)(), int32_t ms)');
    expect(fns).toContain('int32_t __tc_setTimeout(void (*cb)(), int32_t ms)');
    expect(fns).toContain('void __tc_clearInterval(int32_t id)');
    expect(fns).toContain('void __tc_clearTimeout(int32_t id)');
  });

  it('expiry fn submits work; work handler runs the callback on the system workqueue', () => {
    const struct = buildTimerPolyfill(2).helperStructs[0] ?? '';
    expect(struct).toContain('k_timer_start');          // start path
    expect(struct).toMatch(/k_work_submit\(&__tc_timer_slots\[/); // ISR→workqueue
    expect(struct).toContain('k_timer_stop');           // clear path (in __tc_timer_clear)
  });

  it('uses K_MSEC for duration and a repeat-vs-forever period for interval vs timeout', () => {
    // The start logic lives in __tc_timer_add (in helperStructs): duration is
    // always K_MSEC(ms); the period is a runtime ternary — K_MSEC(ms) when
    // repeating (setInterval), K_FOREVER when one-shot (setTimeout).
    const struct = buildTimerPolyfill(2).helperStructs[0] ?? '';
    expect(struct).toContain('K_MSEC(ms), repeat ? K_MSEC(ms) : K_FOREVER');
    expect(struct).toContain('bool repeat');  // the add() param driving it
  });
});
