// ---------------------------------------------------------------------------
// Timer methods polyfill — Zephyr k_timer + k_work (heap-free)
//
// setInterval / setTimeout / clearInterval / clearTimeout backed by a fixed
// pool of k_timer + k_work pairs. The timer's expiry function (ISR context)
// submits a k_work item to the system workqueue; the work handler runs the
// user callback in thread context. This split keeps the ISR cheap and lets the
// callback run on a real thread (so it can do real work — but must not block,
// since the system workqueue is shared).
//
// EMIT BOUNDARY: emitted bytes land in user firmware. Covered by the TypeCAD
// Runtime Exception (RUNTIME_EXCEPTION.md at the repo root).
// ---------------------------------------------------------------------------

import type { RuntimePolyfillIR } from '@typecad/cuttlefish/api/shared';

const MIN_TIMERS = 1;
const MAX_TIMERS_CAP = 16;

export interface TimerPolyfillIR extends RuntimePolyfillIR {
  /** The clamped pool size the C++ was generated with. */
  maxTimers: number;
}

/**
 * Build the timer_methods polyfill IR. `requestedTimers` is sized from
 * ctx.analysis.timerCallCount; it is clamped to [1, 16].
 */
export function buildTimerPolyfill(requestedTimers: number): TimerPolyfillIR {
  const maxTimers = Math.min(MAX_TIMERS_CAP, Math.max(MIN_TIMERS, requestedTimers));

  const helperStructs = [`
// cuttlefish timer runtime — k_timer + k_work pool (heap-free).
struct __tc_TimerSlot {
    struct k_timer timer;
    struct k_work work;
    void (*callback)(void);
    bool active;
};

static struct __tc_TimerSlot __tc_timer_slots[${maxTimers}];

static void __tc_timer_work_handler(struct k_work* w) {
    // Runs on the system workqueue thread (NOT ISR). Find the owning slot by
    // address and invoke the callback. Must not block.
    for (int32_t i = 0; i < ${maxTimers}; i++) {
        if (&__tc_timer_slots[i].work == w) {
            if (__tc_timer_slots[i].callback != nullptr) { __tc_timer_slots[i].callback(); }
            return;
        }
    }
}

static void __tc_timer_expiry_fn(struct k_timer* t) {
    // ISR context: submit the work item, do NOT run the callback here.
    for (int32_t i = 0; i < ${maxTimers}; i++) {
        if (&__tc_timer_slots[i].timer == t) {
            (void)k_work_submit(&__tc_timer_slots[i].work);
            return;
        }
    }
}

static int32_t __tc_timer_add(void (*cb)(void), int32_t ms, bool repeat) {
    for (int32_t i = 0; i < ${maxTimers}; i++) {
        if (!__tc_timer_slots[i].active) {
            __tc_timer_slots[i].callback = cb;
            __tc_timer_slots[i].active = true;
            k_timer_init(&__tc_timer_slots[i].timer, __tc_timer_expiry_fn, nullptr);
            k_work_init(&__tc_timer_slots[i].work, __tc_timer_work_handler);
            k_timer_start(&__tc_timer_slots[i].timer, K_MSEC(ms), repeat ? K_MSEC(ms) : K_FOREVER);
            return i + 1;  // 1-based id
        }
    }
    return 0;  // pool full
}

static void __tc_timer_clear(int32_t id) {
    if (id > 0 && id <= ${maxTimers}) {
        int32_t i = id - 1;
        k_timer_stop(&__tc_timer_slots[i].timer);
        __tc_timer_slots[i].active = false;
        __tc_timer_slots[i].callback = nullptr;
    }
}
`];

  const helperFunctions = [`
int32_t __tc_setInterval(void (*cb)(), int32_t ms) { return __tc_timer_add(cb, ms, true); }
int32_t __tc_setTimeout(void (*cb)(), int32_t ms) { return __tc_timer_add(cb, ms, false); }
void __tc_clearInterval(int32_t id) { __tc_timer_clear(id); }
void __tc_clearTimeout(int32_t id) { __tc_timer_clear(id); }
`];

  return {
    kind: 'polyfill',
    id: 'timer_methods',
    domain: 'embedded',
    requiredIncludes: [],
    forwardDeclarations: [],
    helperStructs,
    helperFunctions,
    shimMacros: [],
    dependencies: [],
    maxTimers,
  };
}
