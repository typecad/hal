// ---------------------------------------------------------------------------
// Zephyr worker-offload backing (system workqueue + counting semaphore)
//
// Supplies the spawn/signal/poll primitives that the shared worker_runtime
// polyfill calls into, for Zephyr targets. This is the Zephyr-native analog of
// the ESP32 FreeRTOS backing (framework-esp32/src/lowering/worker-backing.ts):
//
//   ESP32 (FreeRTOS)            Zephyr
//   ─────────────────────────   ─────────────────────────────────────────
//   xTaskCreate + vTaskDelete   k_work_submit to the system workqueue
//   xTaskNotifyGive (barrier)   k_sem_give (kernel barrier)
//   ulTaskNotifyTake(0)         k_sem_take(K_NO_WAIT)
//
// The worker runs on the system workqueue thread (a real kernel thread, not an
// ISR), so it can execute a full function. Completion is signalled via a per-
// slot counting semaphore given from workqueue thread context (k_sem_give is
// safe from thread context — NOT k_sem_give from an ISR; workqueue handlers run
// in thread context). k_sem provides the memory barrier the contract requires.
//
// IMPORTANT: the system workqueue has a fixed stack (CONFIG_SYSTEM_WORKQUEUE_
// STACK_SIZE). The scaffold bumps it because heavy workers (TLS, sensor fusion)
// overflow the default ~2 KB. Pin a large worker to a private workqueue if it
// exceeds the system queue's stack.
// ---------------------------------------------------------------------------

import type { WorkerBacking } from "@typecad/cuttlefish/api/shared";

export interface ZephyrWorkerBackingOptions {
  /** Initial count of each per-slot semaphore. Default 0 (empty). */
  initialSemCount?: number;
}

/**
 * Build the Zephyr (k_work + k_sem) worker backing.
 *
 * Per slot: a `struct k_work _work_<i>` and a `struct k_sem _done_sem_<i>`.
 * submit resets the semaphore and submits the work to the system workqueue;
 * the work handler runs the trampoline; the trampoline signals completion via
 * k_sem_give; done polls via k_sem_take(K_NO_WAIT).
 */
export function buildZephyrWorkerBacking(
  _options: ZephyrWorkerBackingOptions = {},
): WorkerBacking {
  return {
    requiredIncludes: ['<zephyr/kernel.h>', '<zephyr/work/work.h>'],

    declarations: [
      `// Zephyr worker backing: per-slot work item + completion semaphore.`,
      `// Declared inside the typecad_worker namespace alongside the slots.`,
    ],

    slotDeclarations: (handleId, trampolineName) => {
      // Per-slot completion semaphore (given from workqueue thread context).
      // Declared before the trampoline so the trampoline's signalDoneExpr can
      // reference it. The trampoline itself is forward-declared by the shared
      // runtime above this block.
      return [
        `// Per-slot completion semaphore.`,
        `K_SEM_DEFINE(_done_sem_${handleId}, 0, 1);`,
        ``,
        `// Per-slot work item + handler. The handler forwards to the shared-`,
        `// runtime trampoline (which runs the submitted fn + signals the sem).`,
        `static void ${trampolineName}_work_handler(struct k_work* work) {`,
        `  (void)work;`,
        `  ${trampolineName}(nullptr);`,
        `}`,
        `K_WORK_DEFINE(_work_${handleId}, ${trampolineName}_work_handler);`,
      ];
    },

    spawnLines: (handleId, trampolineName, _waiterExpr) => {
      // The waiter field is unused on Zephyr (the semaphore IS the signal).
      // Reset the completion semaphore, then submit the work item to the
      // system workqueue. The work handler (bound via K_WORK_DEFINE above)
      // runs the shared-runtime trampoline.
      return [
        `(void)0; // waiter unused: k_sem is the signal`,
        `k_sem_reset(&_done_sem_${handleId});`,
        `(void)k_work_submit(&_work_${handleId});   // ${trampolineName} on sys workqueue`,
      ];
    },

    signalDoneExpr: (handleId) =>
      // Given from workqueue thread context (k_sem_give is thread-safe here).
      // k_sem provides the kernel memory barrier making the worker's outputs
      // visible to the consumer once k_sem_take succeeds.
      `k_sem_give(&_done_sem_${handleId})`,

    isDoneExpr: (handleId) =>
      // Non-blocking take; its barrier makes the worker's outputs safe to read.
      // The shared runtime fast-paths on the volatile done flag first.
      `(k_sem_take(&_done_sem_${handleId}, K_NO_WAIT) == 0)`,
  };
}
