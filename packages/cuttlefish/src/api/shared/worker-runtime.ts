// ---------------------------------------------------------------------------
// Shared worker-offload runtime C++ code generator
//
// Generates the generic worker pool + the __tc_worker_submit / __tc_worker_done
// contract that generalizes the one-off ESP32 HTTP offload pattern
// (framework-esp32/src/lowering/http.ts: the __tc_http_send_task /
// __tc_http_send_start / __tc_http_done trio). The pool and contract live here;
// the per-framework spawn/signal/poll PRIMITIVES are injected via the strategy
// hooks workerSpawnLines / workerSignalDoneExpr / workerIsDoneExpr.
//
// Design (the safety property, per the approved plan):
//  - The worker runtime is request-in / poll-out: the worker function receives
//    its inputs by value and exposes outputs only through the opaque handle.
//  - No mutex/semaphore is added to the IR. The worker-isolation analyzer
//    (worker-analysis.ts) makes shared mutable state a transpile-time error.
//  - STL-free: fixed-size static slot table, function-pointer + void*. Links
//    on minimal-libc targets (Zephyr).
//
// The memory-barrier contract is load-bearing on dual-core targets: the signal
// primitive (workerSignalDoneExpr) MUST issue a full barrier so the consumer
// observes the worker's preceding output writes once it observes completion.
// ESP32 xTaskNotifyGive and Zephyr k_sem_give both satisfy this; bare volatile
// does NOT across cores.
// ---------------------------------------------------------------------------

export interface WorkerRuntimeOptions {
  /** Number of fixed worker slots in the pool. Default 4. */
  poolSize?: number;
  /** Per-slot worker stack size in bytes (ESP32). Default 8192. */
  stackSize?: number;
}

/**
 * Per-framework backing primitives injected into the shared contract.
 * Undefined fields mean "unsupported" and the runtime is not emitted.
 */
export interface WorkerBacking {
  /**
   * Statements that spawn the worker trampoline for slot `handleId`.
   *
   * `trampolineName` is the C++ symbol of the per-slot worker function the
   * shared runtime generated (it reads fn/arg from the slot, runs them, then
   * signals completion). `waiterExpr` is the C++ lvalue the backing should set
   * to the current waiter handle before spawning (the shared runtime reads it
   * via signalDoneExpr/isDoneExpr).
   *
   * The shared runtime has already stored the submitted fn/arg into the slot
   * and cleared `done` before this runs; the backing need only record the
   * waiter and spawn `trampolineName`.
   */
  spawnLines: (handleId: number, trampolineName: string, waiterExpr: string) => string[];
  /** Expression the worker calls after finishing + writing outputs (barrier). */
  signalDoneExpr: (handleId: number) => string;
  /** Boolean expression polled by __tc_worker_done (observes the barrier). */
  isDoneExpr: (handleId: number) => string;
  /** C++ headers required by the primitives (e.g. '<freertos/FreeRTOS.h>'). */
  requiredIncludes: string[];
  /** Any backing declarations (e.g. semaphore objects) emitted before the pool. */
  declarations?: string[];
  /**
   * Per-slot backing declarations emitted inside the namespace, one call per
   * slot, before the submit/done functions. Used by backings that need a named
   * per-slot object bound to the trampoline at definition time — e.g. Zephyr's
   * `K_WORK_DEFINE(_work_<i>, __tc_worker_fn_<i>)` + a per-slot semaphore.
   * `trampolineName` is the per-slot worker symbol the shared runtime emitted.
   */
  slotDeclarations?: (handleId: number, trampolineName: string) => string[];
}

/**
 * Generate the worker-offload runtime C++ for a framework that supplies a
 * backing. Returns null if `backing` is null (unsupported on this framework).
 *
 * The emitted code defines, for each slot i in [0, poolSize):
 *   - a worker trampoline __tc_worker_fn_i(void* arg) that runs the recorded
 *     fn and then signals completion via signalDoneExpr,
 *   - __tc_worker_submit(i, fn, arg) — records the waiter, clears done, spawns,
 *   - __tc_worker_done(i) — poll predicate.
 *
 * AUTOSAR C++14: fixed-width types, static_cast, final structs, no STL, no heap.
 */
export function generateWorkerRuntime(
  backing: WorkerBacking | null,
  options: WorkerRuntimeOptions = {},
): string | null {
  if (!backing) return null;
  const poolSize = options.poolSize ?? 4;
  const stackSize = options.stackSize ?? 8192;

  const lines: string[] = [];
  lines.push(`// ── Worker offload runtime (generalized request-in / poll-out) ──────────────`);
  lines.push(`// Slot table + __tc_worker_submit/done contract. Per-framework primitives`);
  lines.push(`// (spawn/signal/poll) are injected by the framework strategy. STL-free so`);
  lines.push(`// this links on minimal-libc targets. See worker-runtime.ts.`);
  lines.push(`namespace typecad_worker {`);
  lines.push(`  using WorkerFn = void (*)(void*);`);
  lines.push(``);
  lines.push(`  struct WorkerSlot final {`);
  lines.push(`    volatile bool done;`);
  lines.push(`    void* waiter;        // framework-specific waiter handle (opaque)`);
  lines.push(`    WorkerFn fn;`);
  lines.push(`    void* arg;`);
  lines.push(`  };`);
  lines.push(``);
  // Per-slot static instances.
  for (let i = 0; i < poolSize; i++) {
    lines.push(`  static WorkerSlot __slot_${i};`);
  }
  lines.push(``);

  // Forward-declare the per-slot trampolines so backings that need to bind a
  // named handler to one (e.g. Zephyr K_WORK_DEFINE(_work_i, handler_i)) can
  // reference it before the trampoline definition appears below.
  for (let i = 0; i < poolSize; i++) {
    lines.push(`  static void __tc_worker_fn_${i}(void* arg);`);
  }
  lines.push(``);

  // Per-slot backing declarations (e.g. Zephyr K_SEM_DEFINE + K_WORK_DEFINE +
  // a work handler that forwards to the trampoline). Emitted BEFORE the
  // trampoline definitions so the trampoline bodies can reference per-slot
  // objects declared here (e.g. the completion semaphore used by the signal
  // expression). Backings must only forward-declare, not define, the
  // trampoline itself.
  if (backing.slotDeclarations) {
    for (let i = 0; i < poolSize; i++) {
      const trampolineName = `__tc_worker_fn_${i}`;
      for (const d of backing.slotDeclarations(i, trampolineName)) {
        lines.push(`  ${d}`);
      }
    }
    lines.push(``);
  }

  // Per-slot worker trampolines: run fn(arg), then signal completion.
  for (let i = 0; i < poolSize; i++) {
    const signal = backing.signalDoneExpr(i);
    lines.push(`  // Worker trampoline for slot ${i}.`);
    lines.push(`  static void __tc_worker_fn_${i}(void* arg) {`);
    lines.push(`    // The shared runtime recorded fn/waiter before spawn; run it.`);
    lines.push(`    if (__slot_${i}.fn != nullptr) { __slot_${i}.fn(arg); }`);
    lines.push(`    __slot_${i}.done = true;`);
    lines.push(`    ${signal};   // barrier: makes the fn's output writes visible`);
    lines.push(`  }`);
    lines.push(``);
  }

  // submit / done per slot.
  for (let i = 0; i < poolSize; i++) {
    const trampolineName = `__tc_worker_fn_${i}`;
    const spawn = backing.spawnLines(i, trampolineName, `__slot_${i}.waiter`);
    lines.push(`  static inline void __tc_worker_submit_${i}(WorkerFn fn, void* arg) {`);
    lines.push(`    __slot_${i}.done = false;`);
    lines.push(`    __slot_${i}.fn = fn;`);
    lines.push(`    __slot_${i}.arg = arg;`);
    lines.push(`    // waiter is set by the framework spawn primitive below.`);
    for (const s of spawn) lines.push(`    ${s}`);
    lines.push(`  }`);
    lines.push(``);
    const poll = backing.isDoneExpr(i);
    lines.push(`  static inline bool __tc_worker_done_${i}(void) {`);
    lines.push(`    if (__slot_${i}.done) { return true; }   // fast path`);
    lines.push(`    if (${poll}) { __slot_${i}.done = true; return true; }`);
    lines.push(`    return false;`);
    lines.push(`  }`);
    lines.push(``);
  }

  lines.push(`}  // namespace typecad_worker`);
  lines.push(``);
  // Global dispatch aliases so HAL emit (worker.submit / worker.done) resolves.
  lines.push(`// Global dispatch: select the per-slot submit/done by handle id.`);
  lines.push(`inline void __tc_worker_submit(int32_t handle, typecad_worker::WorkerFn fn, void* arg) {`);
  lines.push(`  switch (handle) {`);
  for (let i = 0; i < poolSize; i++) {
    lines.push(`    case ${i}: typecad_worker::__tc_worker_submit_${i}(fn, arg); return;`);
  }
  lines.push(`    default: break;   // out-of-range handle: no-op`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push(`inline bool __tc_worker_done(int32_t handle) {`);
  lines.push(`  switch (handle) {`);
  for (let i = 0; i < poolSize; i++) {
    lines.push(`    case ${i}: return typecad_worker::__tc_worker_done_${i}();`);
  }
  lines.push(`    default: return true;   // out-of-range handle: treat as already done`);
  lines.push(`  }`);
  lines.push(`}`);

  return lines.join("\n");
}

/**
 * Resolve a HAL worker.* op to C++ against the shared contract.
 * Returns undefined for ops the caller did not lower (unsupported).
 *
 * Note: the worker function itself (fnRef) and its argument (argRef) come from
 * the IR as flat-scalar strings (per the hal-op-ir flat-fields contract). The
 * lowering emits a straight call into __tc_worker_submit / __tc_worker_done.
 */
export function lowerWorkerOp(
  op: { operation: string },
): { code?: string; expression?: string } | undefined {
  const o = op as any;
  switch (op.operation) {
    case 'worker.submit': {
      const handle = Number(o.handleId);
      const fn = String(o.fnRef);
      const arg = o.argRef != null ? String(o.argRef) : 'nullptr';
      return { code: `__tc_worker_submit(static_cast<int32_t>(${handle}), ${fn}, ${arg});` };
    }
    case 'worker.done': {
      const handle = Number(o.handleId);
      return { expression: `__tc_worker_done(static_cast<int32_t>(${handle}))` };
    }
    default:
      return undefined;
  }
}
