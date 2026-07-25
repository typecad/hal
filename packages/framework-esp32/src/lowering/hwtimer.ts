import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

/**
 * Native ESP-IDF general-purpose timer (GPTimer) runtime shim. Wraps
 * driver/gptimer.h to provide setFrequency / onOverflow / start / stop per
 * timer instance. Up to TIMER_GROUP_MAX groups × units; this shim lazily
 * allocates a gptimer_handle_t per instance index on first use.
 *
 * Forced include (driver/gptimer.h) is gated on usesHwtimer in strategy.ts.
 */

export function hwtimerInitLines(): string[] {
  return [
    `// CUTTLEFISH_HWTIMER_BEGIN`,
    `#include "driver/gptimer.h"`,
    `#include <string.h>`,
    `// Per-instance handles + overflow callbacks. GPTIMER_MAX Timers (4 on most`,
    `// ESP32 variants) is a safe upper bound; instances beyond that no-op.`,
    `#define __TC_HWTIMER_MAX 4`,
    `static gptimer_handle_t __tc_hwtimer_handle[__TC_HWTIMER_MAX] = {0};`,
    `static void (*__tc_hwtimer_cb[__TC_HWTIMER_MAX])(void) = {0};`,
    ``,
    `static bool __tc_hwtimer_isr(gptimer_handle_t timer, const gptimer_alarm_event_data_t* edata, void* user_ctx) {`,
    `    (void)timer; (void)edata;`,
    `    int idx = (int)(intptr_t)user_ctx;`,
    `    if (idx >= 0 && idx < __TC_HWTIMER_MAX && __tc_hwtimer_cb[idx]) __tc_hwtimer_cb[idx]();`,
    `    return false;`,
    `}`,
    ``,
    `static inline void __tc_hwtimer_set_frequency(int idx, uint32_t hz) {`,
    `    if (idx < 0 || idx >= __TC_HWTIMER_MAX) return;`,
    `    if (!__tc_hwtimer_handle[idx]) {`,
    `        gptimer_config_t cfg = {};`,
    `        cfg.clk_src = GPTIMER_CLK_SRC_DEFAULT;`,
    `        cfg.direction = GPTIMER_COUNT_UP;`,
    `        // resolution_hz == hz → one tick per period; alarm every 1 count.`,
    `        cfg.resolution_hz = hz;`,
    `        gptimer_new_timer(&cfg, &__tc_hwtimer_handle[idx]);`,
    `        gptimer_event_callbacks_t cbs = { .on_alarm = __tc_hwtimer_isr };`,
    `        gptimer_register_event_callbacks(__tc_hwtimer_handle[idx], &cbs, (void*)(intptr_t)idx);`,
    `    }`,
    `    gptimer_alarm_config_t alarm = {};`,
    `    alarm.reload_count = 0;`,
    `    alarm.alarm_count = 1;`,
    `    alarm.flags.auto_reload_on_alarm = true;`,
    `    gptimer_set_alarm_action(__tc_hwtimer_handle[idx], &alarm);`,
    `}`,
    ``,
    `static inline void __tc_hwtimer_on_overflow(int idx, void (*cb)(void)) {`,
    `    if (idx >= 0 && idx < __TC_HWTIMER_MAX) __tc_hwtimer_cb[idx] = cb;`,
    `}`,
    ``,
    `static inline void __tc_hwtimer_start(int idx) {`,
    `    if (idx >= 0 && idx < __TC_HWTIMER_MAX && __tc_hwtimer_handle[idx])`,
    `        gptimer_start(__tc_hwtimer_handle[idx]);`,
    `}`,
    ``,
    `static inline void __tc_hwtimer_stop(int idx) {`,
    `    if (idx >= 0 && idx < __TC_HWTIMER_MAX && __tc_hwtimer_handle[idx])`,
    `        gptimer_stop(__tc_hwtimer_handle[idx]);`,
    `}`,
    `// CUTTLEFISH_HWTIMER_END`,
    ``,
  ];
}

/** Resolve a HAL hwtimer.* op to ESP-IDF C++. */
export function lowerHwtimer(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'hwtimer.set_frequency': return { code: `__tc_hwtimer_set_frequency(${o.instance}, ${o.hz});` };
    case 'hwtimer.on_overflow':   return { code: `__tc_hwtimer_on_overflow(${o.instance}, ${o.handler});` };
    case 'hwtimer.start':         return { code: `__tc_hwtimer_start(${o.instance});` };
    case 'hwtimer.stop':          return { code: `__tc_hwtimer_stop(${o.instance});` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
