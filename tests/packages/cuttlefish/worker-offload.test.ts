import { describe, it, expect } from "vitest";
import { generateWorkerRuntime, lowerWorkerOp } from "../../../packages/cuttlefish/src/api/shared/worker-runtime";
import { buildZephyrWorkerBacking } from "../../../packages/framework-zephyr/src/lowering/worker-backing";

// ---------------------------------------------------------------------------
// Phase 1 — generalized worker offload
//
// These tests cover (a) the shared worker_runtime C++ shape, (b) the Zephyr
// backing primitives (k_sem + k_work), and (c) the worker.* op lowering.
// ---------------------------------------------------------------------------

describe("generateWorkerRuntime — shared C++ shape", () => {
  const cpp = generateWorkerRuntime(buildZephyrWorkerBacking(), { poolSize: 2 });

  it("emits the no-STL namespace with a fixed-size slot table", () => {
    expect(cpp).toContain("namespace typecad_worker");
    expect(cpp).toContain("using WorkerFn = void (*)(void*);");
    // Fixed per-slot instances, not a std::vector.
    expect(cpp).toContain("static WorkerSlot __slot_0;");
    expect(cpp).toContain("static WorkerSlot __slot_1;");
    expect(cpp).not.toContain("std::vector");
    expect(cpp).not.toContain("std::function");
  });

  it("emits per-slot trampolines, submit, done, and global dispatch", () => {
    expect(cpp).toContain("static void __tc_worker_fn_0(void* arg)");
    expect(cpp).toContain("__tc_worker_submit_0(WorkerFn fn, void* arg)");
    expect(cpp).toContain("__tc_worker_done_0(void)");
    // Global dispatch by handle id.
    expect(cpp).toContain("inline void __tc_worker_submit(int32_t handle");
    expect(cpp).toContain("inline bool __tc_worker_done(int32_t handle)");
    expect(cpp).toMatch(/case 0: typecad_worker::__tc_worker_submit_0/);
  });

  it("marks the slot struct final (AUTOSAR leaf-class rule)", () => {
    expect(cpp).toMatch(/struct WorkerSlot final/);
  });

  it("uses fixed-width types (int32_t handle) in the dispatch, not bare int", () => {
    // The runtime's dispatch signature uses int32_t; the op lowering applies
    // static_cast<int32_t> at the call site (covered in lowerWorkerOp tests).
    expect(cpp).toMatch(/int32_t handle/);
    expect(cpp).not.toMatch(/\bint\s+handle\b/);
  });

  it("returns null when no backing is supplied (unsupported framework)", () => {
    expect(generateWorkerRuntime(null)).toBeNull();
  });
});

describe("Zephyr backing — k_work + k_sem", () => {
  const cpp = generateWorkerRuntime(buildZephyrWorkerBacking(), { poolSize: 1 })!;

  it("defines a per-slot work item bound to the trampoline handler (K_WORK_DEFINE)", () => {
    expect(cpp).toContain("K_WORK_DEFINE(_work_0, __tc_worker_fn_0_work_handler)");
    expect(cpp).toContain("__tc_worker_fn_0_work_handler(struct k_work* work)");
  });

  it("the work handler forwards to the shared-runtime trampoline", () => {
    expect(cpp).toMatch(/__tc_worker_fn_0\(nullptr\)/);
  });

  it("defines a per-slot completion semaphore (K_SEM_DEFINE)", () => {
    expect(cpp).toContain("K_SEM_DEFINE(_done_sem_0, 0, 1)");
  });

  it("submits via k_work_submit and resets the sem first", () => {
    expect(cpp).toContain("k_sem_reset(&_done_sem_0)");
    expect(cpp).toContain("k_work_submit(&_work_0)");
  });

  it("signals completion via k_sem_give (kernel memory barrier)", () => {
    expect(cpp).toContain("k_sem_give(&_done_sem_0)");
  });

  it("polls completion via k_sem_take(K_NO_WAIT)", () => {
    expect(cpp).toContain("k_sem_take(&_done_sem_0, K_NO_WAIT)");
  });
});

describe("lowerWorkerOp — worker.* op lowering", () => {
  it("lowers worker.submit to a handle-indexed submit call", () => {
    const result = lowerWorkerOp({ operation: "worker.submit", handleId: 2, fnRef: "myCompute", argRef: "&ctx" } as any);
    expect(result).toEqual({ code: "__tc_worker_submit(static_cast<int32_t>(2), myCompute, &ctx);" });
  });

  it("lowers worker.submit with no arg to nullptr", () => {
    const result = lowerWorkerOp({ operation: "worker.submit", handleId: 0, fnRef: "fn" } as any);
    expect(result).toEqual({ code: "__tc_worker_submit(static_cast<int32_t>(0), fn, nullptr);" });
  });

  it("lowers worker.done to a poll expression", () => {
    const result = lowerWorkerOp({ operation: "worker.done", handleId: 1 } as any);
    expect(result).toEqual({ expression: "__tc_worker_done(static_cast<int32_t>(1))" });
  });

  it("returns undefined for non-worker ops", () => {
    expect(lowerWorkerOp({ operation: "gpio.write" } as any)).toBeUndefined();
  });
});
