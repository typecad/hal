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
/** The trampoline matching counter_top_callback_t: (dev, user_data). */
function trampVar(instance: number): string {
  return `__tc_hw_tramp_${instance}`;
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
      `static void (*${cbVar(i)})(void) = NULL;`,
      `static void ${trampVar(i)}(const struct device* dev, void* user_data) {`,
      `    (void)dev; (void)user_data;`,
      `    if (${cbVar(i)}) { ${cbVar(i)}(); }`,
      `}`,
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
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}

export function lowerCounter(
  op: HALOpIR,
  chip: ZephyrChipDescriptor,
): { code?: string; expression?: string } {
  const o = op as any;
  const controllers = chip.hwtimer?.controllers ?? [];

  if (controllers.length === 0) {
    return { code: `/* ${op.operation}: no counter device on ${chip.id} */` };
  }

  const instance = typeof o.instance === 'number' ? o.instance : parseInt(String(o.instance), 10);
  if (isNaN(instance) || instance < 0 || instance >= controllers.length) {
    return { code: `/* counter instance ${o.instance}: out of range on ${chip.id} (${controllers.length} declared) */` };
  }

  switch (op.operation) {
    case 'counter.on_alarm':
      return { code: `${cbVar(instance)} = (${o.handler});` };
    case 'counter.start': {
      // Apply the construction hz as the top value, arm the alarm callback,
      // start. hz rides the op, so no ordering constraint exists. The API
      // is counter_set_top_value(dev, const counter_top_cfg*) with a
      // (dev, user_data) callback — the trampoline in hwtimerInitLines
      // adapts the user's void() handler.
      return {
        code: [
          `{`,
          `  ${hzVar(instance)} = ${o.hz};`,
          `  uint32_t __f = counter_get_frequency(${devVar(instance)});`,
          `  uint32_t __top = __f ? (__f / ${hzVar(instance)}) : 0U;`,
          `  if (__top > 0U) {`,
          `    struct counter_top_cfg __cfg = { .ticks = __top, .callback = ${trampVar(instance)}, .user_data = NULL, .flags = 0U };`,
          `    (void)counter_set_top_value(${devVar(instance)}, &__cfg);`,
          `  }`,
          `  (void)counter_start(${devVar(instance)});`,
          `}`,
        ].join(' '),
      };
    }
    case 'counter.stop':
      return { code: `(void)counter_stop(${devVar(instance)});` };
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
