// ---------------------------------------------------------------------------
// Hardware-timer lowering — Zephyr counter API
//
// HAL `hwtimer.*` (instance → frequency/overflow/start/stop) maps onto Zephyr's
// counter driver (<zephyr/drivers/counter.h>). A chip declares the counter
// devices it exposes (e.g. nRF RTC1 — RTC0 is kernel-owned) via
// `hwtimer.controllers[instance].nodeLabel`.
//
// Frequency model: a Zephyr counter has a fixed clock; the HAL
// set_frequency(hz) is realized as a top value of counter_freq/hz with an alarm
// callback (the on_overflow handler). start() arms both the top value and the
// callback so the call order (setFrequency → onOverflow → start, or any
// permutation) is handled uniformly.
//
// Targets without a free counter omit `hwtimer`; usage lowers to a comment and
// profileDiagnostics flags it. The JS setInterval/setTimeout polyfill
// (k_timer) is a separate surface and is unaffected.
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import type { ZephyrChipDescriptor } from '../chips/types.js';

/** Per-instance emitted symbol stems. */
function devVar(instance: number): string {
  return `__tc_hw_dev_${instance}`;
}
function hzVar(instance: number): string {
  return `__tc_hw_hz_${instance}`;
}
function cbVar(instance: number): string {
  return `__tc_hw_cb_${instance}`;
}

/**
 * Emit the per-instance counter device handles + frequency/callback state.
 * Called from shimLines when the program uses hardware timers.
 */
export function hwtimerInitLines(chip: ZephyrChipDescriptor): string[] {
  const controllers = chip.hwtimer?.controllers ?? [];
  if (controllers.length === 0) return [];
  const lines: string[] = ['// CUTTLEFISH_HWTIMER_BEGIN'];
  controllers.forEach((c, i) => {
    lines.push(
      `static const struct device* ${devVar(i)} = DEVICE_DT_GET(DT_NODELABEL(${c.nodeLabel}));`,
      `static uint32_t ${hzVar(i)} = 1;`,
      `static counter_top_callback_t ${cbVar(i)} = NULL;`,
    );
  });
  lines.push('// CUTTLEFISH_HWTIMER_END');
  return lines;
}

/**
 * Resolve a HAL hwtimer.* op to Zephyr C++.
 * Returns `{ code }` for statement ops.
 */
export function lowerHwtimer(
  op: HALOpIR,
  chip: ZephyrChipDescriptor,
): { code?: string; expression?: string } {
  const o = op as any;
  const controllers = chip.hwtimer?.controllers ?? [];

  // No counter on this target. Comment + (in profileDiagnostics) a clear error.
  if (controllers.length === 0) {
    return { code: `/* hwtimer instance ${o.instance}: no counter device on ${chip.id} */` };
  }

  const instance = typeof o.instance === 'number' ? o.instance : parseInt(String(o.instance), 10);
  if (isNaN(instance) || instance < 0 || instance >= controllers.length) {
    return { code: `/* hwtimer instance ${o.instance}: out of range on ${chip.id} */` };
  }

  switch (op.operation) {
    case 'hwtimer.set_frequency':
      return { code: `${hzVar(instance)} = ${o.hz};` };
    case 'hwtimer.on_overflow':
      return { code: `${cbVar(instance)} = (${o.handler});` };
    case 'hwtimer.start':
      // Arm the top value (counter_freq / desired_hz) + the overflow callback,
      // then start the counter. Doing both here handles any call order — the
      // HAL typical sequence (setFrequency → onOverflow → start) and permutations.
      return {
        code: [
          `{`,
          `  uint32_t __f = counter_get_frequency(${devVar(instance)});`,
          `  uint32_t __top = __f ? (__f / ${hzVar(instance)}) : 0U;`,
          `  if (__top > 0U) { (void)counter_set_top_value(${devVar(instance)}, __top, ${cbVar(instance)}, NULL); }`,
          `  (void)counter_start(${devVar(instance)});`,
          `}`,
        ].join(' '),
      };
    case 'hwtimer.stop':
      return { code: `(void)counter_stop(${devVar(instance)});` };
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
