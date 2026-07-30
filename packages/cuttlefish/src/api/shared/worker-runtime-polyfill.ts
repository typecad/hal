import type { ProgramIR } from "../index.js";
import type { RuntimePolyfillIR } from "./index.js";
import { generateWorkerRuntime } from "./worker-runtime.js";
import type { PlatformStrategy } from "./platform-strategy.js";
import type { WorkerBacking } from "./worker-runtime.js";

/**
 * Build a RuntimePolyfillIR for the worker-offload runtime, when the framework
 * supplies worker backing via its PlatformAsyncStrategy hooks
 * (workerSpawnLines / workerSignalDoneExpr / workerIsDoneExpr).
 *
 * The polyfill carries only the slot table + __tc_worker_submit/done contract
 * with the per-framework primitives injected from the strategy hooks. STL-free
 * so it links on minimal-libc targets (Zephyr). Returns null if the strategy
 * supplies no backing (worker offload unsupported there) — in which case
 * worker.* ops resolve to unsupported.
 *
 * Callers gate this on the program actually using worker.* ops
 * (ProgramAnalysisResult.usesWorker); the producer does not re-scan.
 */
export function buildWorkerRuntimePolyfill(
  _program: ProgramIR,
  strategy: PlatformStrategy,
  backing: WorkerBacking,
  options: { poolSize?: number; stackSize?: number } = {},
): RuntimePolyfillIR | null {
  // The backing is authoritative: it is constructed by the framework from its
  // own hooks. If a framework supplies no backing (worker offload unsupported),
  // it should not call this producer.
  const runtime = generateWorkerRuntime(backing, options);
  if (!runtime) return null;

  return {
    kind: "polyfill",
    id: "worker_runtime",
    domain: "embedded",
    requiredIncludes: backing.requiredIncludes,
    forwardDeclarations: backing.declarations ?? [],
    helperStructs: [runtime],
    helperFunctions: [],
    shimMacros: [],
    dependencies: [],
  };
}
