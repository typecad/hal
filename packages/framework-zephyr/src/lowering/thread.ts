// ---------------------------------------------------------------------------
// Thread lowering — Zephyr kernel threads (k_thread_create / k_thread_join)
//
// One state block per thread identity slot the program STARTS: a static
// K_THREAD_STACK_DEFINE (sized by the construction stackKb), the k_thread
// struct, and an entry trampoline bridging Zephyr's (void*, void*, void*)
// entry signature to the no-argument registered callback. start() creates
// and schedules (K_NO_WAIT); join() blocks (K_FOREVER).
//
// No devicetree, no Kconfig — kernel.h (always included) is the whole
// dependency. State emission is keyed on thread.start ops only, so a
// join-only program emits nothing (and its join guards on the same slot).
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

/** Per-instance symbol stem. */
function stem(instance: number): string {
  return `__tc_thrd${instance}`;
}

/**
 * Emit the per-thread state. Called from shimLines for each distinct thread
 * the program starts.
 */
export function threadStateLines(instance: number, stackBytes: number): string[] {
  const p = stem(instance);
  return [
    '// CUTTLEFISH_THREAD_BEGIN',
    `K_THREAD_STACK_DEFINE(${p}_stack, ${stackBytes});`,
    `static struct k_thread ${p}_thread;`,
    `static void (*${p}_fn)(void) = NULL;`,
    `static void ${p}_tramp(void* a, void* b, void* c) { (void)a; (void)b; (void)c; if (${p}_fn) { ${p}_fn(); } }`,
    '// CUTTLEFISH_THREAD_END',
  ];
}

/**
 * Resolve a HAL thread.* op to Zephyr C++.
 * Returns `{ code }` for statement ops.
 */
export function lowerThread(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  const instance = typeof o.instance === 'number' ? o.instance : 0;
  const p = stem(instance);

  switch (op.operation) {
    case 'thread.start': {
      // Store the entry, create + schedule immediately. The stack size comes
      // from the state block (the construction fact), via K_THREAD_STACK_SIZEOF.
      return {
        code: `${p}_fn = (${o.handler}); (void)k_thread_create(&${p}_thread, ${p}_stack, K_THREAD_STACK_SIZEOF(${p}_stack), ${p}_tramp, NULL, NULL, NULL, ${o.priority ?? 5}, 0, K_NO_WAIT);`,
      };
    }
    case 'thread.join':
      return { code: `(void)k_thread_join(&${p}_thread, K_FOREVER);` };
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
