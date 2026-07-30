// ---------------------------------------------------------------------------
// Zephyr worker-offload lowering
//
// Delegates the shared worker.* op contract to the cross-framework helper
// lowerWorkerOp (worker-runtime.ts). The per-framework primitives are supplied
// by the Zephyr worker backing (worker-backing.ts: k_work + k_sem), emitted via
// the worker_runtime polyfill when the program uses worker.* ops. See the
// Zephyr strategy's worker backing wiring + generateNativePolyfills.
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { lowerWorkerOp } from '@typecad/cuttlefish/api/shared';

/** Resolve a HAL worker.* op to C++ against the shared __tc_worker contract. */
export function lowerWorker(op: HALOpIR): { code?: string; expression?: string } | undefined {
  return lowerWorkerOp(op);
}
