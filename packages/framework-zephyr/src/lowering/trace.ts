// ---------------------------------------------------------------------------
// Trace heartbeat — the runtime-stats sampler behind `typecad-hal trace`
//
// Emits a self-starting sampler into the ENTRY translation unit only (the
// block compiles under CUTTLEFISH_ENTRY_TU, which the emitter defines once
// per program — a copy in a split-file TU would register the SYS_INIT hook
// twice and double every heartbeat). A k_work_delayable on the system work
// queue samples, every intervalMs:
//
//   - per-thread execution cycles   (CONFIG_THREAD_RUNTIME_STATS)
//   - per-thread stack unused/size  (CONFIG_INIT_STACKS / THREAD_STACK_INFO)
//   - the system-wide cycle counter  (k_thread_runtime_stats_all_get — the
//     CPU-time denominator; per-thread CPU% is computed HOST-side as
//     delta_thread_exec / delta_sys_exec, so no cycle/Hz units leak onto
//     the wire and idle shows up as its own thread)
//
// and prints `[TR:` lines on the console (printf → STDOUT_CONSOLE, the same
// channel the test-runner protocol uses). Sampling, not event tracing: the
// device cost is O(live threads) arithmetic per interval — no context-switch
// hook, no ring buffer, no per-frame work — so the probe effect on the
// measured system is one short work-queue visit per interval.
//
// Heap usage is deliberately NOT sampled: engine-emitted C++ is no-malloc by
// construction (AUTOSAR rule set), so a heap series would be a constant line.
//
// The whole block also gates on CONFIG_THREAD_MONITOR + CONFIG_THREAD_RUNTIME
// _STATS: the scaffold enables both when zephyr.trace.enabled is set, but a
// user override in zephyr.kconfig compiles the sampler out instead of
// failing the link (k_thread_foreach lives in kernel/thread_monitor.c and
// only builds under THREAD_MONITOR).
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

/**
 * Resolve a HAL trace.* op to Zephyr C++. The device helpers
 * (__tc_trace_mark / __tc_trace_event) are emitted unconditionally by
 * shimLines — they are two printf calls, and a Trace.mark() call site must
 * never fail to link because tracing was disabled (the lines simply have no
 * capture listening).
 */
export function lowerTrace(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as { operation: string; name?: string; value?: string | number };

  switch (op.operation) {
    case 'trace.mark':
      return { code: `__tc_trace_mark(${o.name ?? '""'});` };
    case 'trace.event':
      // The value may be a runtime expression (variable, ternary) — the
      // plugin resolved it as text; interpolate inside static_cast so any
      // numeric C++ expression is valid here.
      return { code: `__tc_trace_event(${o.name ?? '""'}, static_cast<double>(${o.value ?? 0}));` };
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}

/** Default heartbeat interval (ms) when zephyr.trace.intervalMs is absent. */
export const TRACE_HB_DEFAULT_INTERVAL_MS = 1000;

/** Clamp for zephyr.trace.intervalMs — faster than 50 ms floods the console
 *  and skews the measured CPU load; slower than a minute adds nothing. */
export function clampTraceIntervalMs(intervalMs: number | undefined): number {
  if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs)) {
    return TRACE_HB_DEFAULT_INTERVAL_MS;
  }
  return Math.min(60_000, Math.max(50, Math.round(intervalMs)));
}

/**
 * UI frame-time trace block — emitted UNCONDITIONALLY for UI-mounted
 * programs (the call site the emitter stamps after ui_tick must never fail
 * to link), but every body compiles away unless the heartbeat block defined
 * CUTTLEFISH_TRACE_UI (zephyr.trace enabled). Wall-time stats only: frame
 * count / total / max ms per heartbeat interval — the per-phase breakdown
 * inside ui_tick stays a ui-engine change for a later stage.
 */
export function uiFrameTraceLines(): string[] {
  return [
    '// CUTTLEFISH_TRACE_UI_BEGIN',
    '#if defined(CUTTLEFISH_TRACE_UI)',
    'static uint32_t __tc_trace_ui_frames = 0U;',
    'static uint32_t __tc_trace_ui_total_ms = 0U;',
    'static uint32_t __tc_trace_ui_max_ms = 0U;',
    'static uint64_t __tc_trace_ui_phase[5];',
    '#endif',
    'static inline void __tc_trace_ui_frame(uint32_t frame_delta_ms) {',
    '#if defined(CUTTLEFISH_TRACE_UI)',
    '    __tc_trace_ui_frames += 1U;',
    '    __tc_trace_ui_total_ms += frame_delta_ms;',
    '    if (frame_delta_ms > __tc_trace_ui_max_ms) { __tc_trace_ui_max_ms = frame_delta_ms; }',
    '#else',
    '    (void)frame_delta_ms;',
    '#endif',
    '}',
    // Called from the seams the ui-engine's emitTick interleaves between its
    // five phase slices (bindings / transitions / draw / scroll / flush).
    // Cycles are accumulated raw; the report converts to µs once per
    // heartbeat via sys_clock_hw_cycles_per_sec().
    'static inline void __tc_trace_ui_phase_add(uint8_t idx, uint64_t cycles) {',
    '#if defined(CUTTLEFISH_TRACE_UI)',
    '    if (idx < 5U) { __tc_trace_ui_phase[idx] += cycles; }',
    '#else',
    '    (void)idx; (void)cycles;',
    '#endif',
    '}',
    'static inline void __tc_trace_ui_report(uint32_t seq) {',
    '#if defined(CUTTLEFISH_TRACE_UI)',
    '    if (__tc_trace_ui_frames > 0U) {',
    '        const uint32_t avg_x10 = (__tc_trace_ui_total_ms * 10U) / __tc_trace_ui_frames;',
    '        printf("[TR:UI:%u:%u:%u:%u\\n", static_cast<unsigned int>(seq),',
    '               static_cast<unsigned int>(__tc_trace_ui_frames),',
    '               static_cast<unsigned int>(avg_x10),',
    '               static_cast<unsigned int>(__tc_trace_ui_max_ms));',
    '        printf("[TR:UP:%u:%llu:%llu:%llu:%llu:%llu\\n", static_cast<unsigned int>(seq),',
    '               static_cast<unsigned long long>((__tc_trace_ui_phase[0] * 1000000ULL) / sys_clock_hw_cycles_per_sec()),',
    '               static_cast<unsigned long long>((__tc_trace_ui_phase[1] * 1000000ULL) / sys_clock_hw_cycles_per_sec()),',
    '               static_cast<unsigned long long>((__tc_trace_ui_phase[2] * 1000000ULL) / sys_clock_hw_cycles_per_sec()),',
    '               static_cast<unsigned long long>((__tc_trace_ui_phase[3] * 1000000ULL) / sys_clock_hw_cycles_per_sec()),',
    '               static_cast<unsigned long long>((__tc_trace_ui_phase[4] * 1000000ULL) / sys_clock_hw_cycles_per_sec()));',
    '    }',
    '#else',
    '    (void)seq;',
    '#endif',
    '}',
    'static inline void __tc_trace_ui_reset(void) {',
    '#if defined(CUTTLEFISH_TRACE_UI)',
    '    __tc_trace_ui_frames = 0U;',
    '    __tc_trace_ui_total_ms = 0U;',
    '    __tc_trace_ui_max_ms = 0U;',
    '    for (uint8_t i = 0U; i < 5U; i++) { __tc_trace_ui_phase[i] = 0ULL; }',
    '#endif',
    '}',
    '// CUTTLEFISH_TRACE_UI_END',
  ];
}

/**
 * The heartbeat shim lines (definitions + SYS_INIT self-start). Emitted by
 * shimLines when the platform context carries zephyr.trace.enabled.
 * `withUi` adds the [TR:UI: frame-stats line (UI-mounted programs).
 */
export function traceHeartbeatLines(intervalMs: number, withUi: boolean): string[] {
  const ms = clampTraceIntervalMs(intervalMs);
  return [
    '// CUTTLEFISH_TRACE_BEGIN',
    '#if defined(CUTTLEFISH_ENTRY_TU) && defined(CONFIG_THREAD_MONITOR) && defined(CONFIG_THREAD_RUNTIME_STATS)',
    `#define __TC_TRACE_HB_MS ${ms}U`,
    'static uint32_t __tc_trace_seq = 0U;',
    // One [TR:TH:<seq>:<name>:<exec>:<unused>:<size>] line per live thread.
    // Stack fields print -1 when the platform cannot inspect that thread
    // (ARC-style NO_UNUSED_STACK_INSPECTION faults) — the host reads the
    // sentinel as "unknown", not zero.
    'static void __tc_trace_thread_line(const struct k_thread* cthread, void* user_data) {',
    '    (void)user_data;',
    '    // The foreach callback hands out a const thread; the stats/name',
    '    // syscalls take k_tid_t (non-const) — the same const_cast Zephyr\'s',
    '    // own thread_analyzer performs at this exact boundary.',
    '    struct k_thread* thread = const_cast<struct k_thread*>(cthread);',
    '    const uint32_t seq = __tc_trace_seq;',
    '    k_thread_runtime_stats_t stats;',
    '    uint64_t exec = 0U;',
    '    if (k_thread_runtime_stats_get(thread, &stats) == 0) {',
    '        exec = stats.execution_cycles;',
    '    }',
    '    size_t unused = 0U;',
    '    const bool stack_ok = k_thread_stack_space_get(thread, &unused) == 0;',
    '#ifdef CONFIG_THREAD_STACK_INFO',
    '    const size_t size = thread->stack_info.size;',
    '#else',
    '    const size_t size = 0U;',
    '#endif',
    '    char name[24];',
    '    const char* thread_name = k_thread_name_get(thread);',
    '    uint32_t n = 0U;',
    '    if (thread_name != nullptr) {',
    '        for (; thread_name[n] != \'\\0\' && n < (sizeof(name) - 1U); n++) {',
    '            const char c = thread_name[n];',
    '            const bool plain = (c >= \'a\' && c <= \'z\') || (c >= \'A\' && c <= \'Z\')',
    '                || (c >= \'0\' && c <= \'9\') || c == \'_\' || c == \'-\' || c == \'.\';',
    '            name[n] = plain ? c : \'_\';',
    '        }',
    '    }',
    '    name[n] = \'\\0\';',
    '    if (n == 0U) { name[0] = \'u\'; name[1] = \'n\'; name[2] = \'\\0\'; }',
    '    printf("[TR:TH:%u:%s:%llu:%lld:%u\\n",',
    '           static_cast<unsigned int>(seq), name,',
    '           static_cast<unsigned long long>(exec),',
    '           stack_ok ? static_cast<long long>(unused) : -1LL,',
    '           static_cast<unsigned int>(size));',
    '}',
    'static void __tc_trace_hb_work(struct k_work* work);',
    'static K_WORK_DELAYABLE_DEFINE(__tc_trace_hb_dwork, __tc_trace_hb_work);',
    'static void __tc_trace_hb_work(struct k_work* work) {',
    '    (void)work;',
    '    k_thread_runtime_stats_t all;',
    '    uint64_t sys_exec = 0U;',
    '    if (k_thread_runtime_stats_all_get(&all) == 0) {',
    '        sys_exec = all.execution_cycles;',
    '    }',
    '    __tc_trace_seq += 1U;',
    '    printf("[TR:HB:%u:%u:%llu\\n",',
    '           static_cast<unsigned int>(__tc_trace_seq),',
    '           static_cast<unsigned int>(k_uptime_get_32()),',
    '           static_cast<unsigned long long>(sys_exec));',
    ...(withUi
      ? [
        '    __tc_trace_ui_report(__tc_trace_seq);',
        '    __tc_trace_ui_reset();',
      ]
      : []),
    '    k_thread_foreach(__tc_trace_thread_line, nullptr);',
    '    k_work_reschedule(&__tc_trace_hb_dwork, K_MSEC(__TC_TRACE_HB_MS));',
    '}',
    'static int __tc_trace_hb_boot(void) {',
    `    printf("[TR:CFG:1:${ms}]\\n");`,
    '    k_work_schedule(&__tc_trace_hb_dwork, K_MSEC(__TC_TRACE_HB_MS));',
    '    return 0;',
    '}',
    'SYS_INIT(__tc_trace_hb_boot, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY);',
    '#endif // CUTTLEFISH_ENTRY_TU && THREAD_MONITOR && THREAD_RUNTIME_STATS',
    '// CUTTLEFISH_TRACE_END',
  ];
}
