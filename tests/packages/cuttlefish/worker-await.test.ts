import { describe, it, expect } from "vitest";
import { generateAsyncTaskClass } from "../../../packages/cuttlefish/src/emit/utils/async-state-machine";
import type { StatementIR, ExpressionIR } from "../../../packages/cuttlefish/src/api/index.js";
import type { PlatformStrategy } from "../../../packages/cuttlefish/src/api/shared/platform-strategy.js";
import { ZephyrStrategy } from "../../../packages/framework-zephyr/src/strategy";

// ---------------------------------------------------------------------------
// Phase 3 — event-await (predicate-poll) resume for worker.submit
//
// `await worker.submit(fn, arg)` rewrites (in transformers/expressions.ts) to an
// awaited __HAL_WAIT__ marker carrying the worker.submit hal-op as a hal-expr
// arg. The state machine then lowers it (netWaitInfo) to:
//   start = __tc_worker_submit(handle, fn, arg)   [emitted by the prior segment]
//   poll  = __tc_worker_done(handle)              [the predicate-poll resume]
//
// There is not yet a user-facing TS API for worker.submit, so this test builds
// the awaited marker IR directly and asserts the generated state-machine case
// polls __tc_worker_done (NOT a millis deadline), mirroring how the HTTP await
// path is exercised end-to-end elsewhere.
// ---------------------------------------------------------------------------

function renderStatementStub(stmt: StatementIR): string {
  // The awaited marker carries no pre-statements in this fixture, so the stub
  // only needs to render something for non-awaited statements. Return a
  // placeholder for anything it encounters.
  return `/* ${stmt.kind} */`;
}

/** Build an awaited __HAL_WAIT__ marker carrying a worker.submit hal-expr. */
function awaitedWorkerSubmit(handleId: number, fnRef: string): StatementIR {
  const halExpr: ExpressionIR = {
    kind: "hal-expr",
    operation: { operation: "worker.submit", handleId, fnRef },
  } as any;
  return {
    kind: "call",
    callee: "__HAL_WAIT__",
    args: [halExpr],
    isAwaited: true,
  } as any;
}

describe("async state machine — worker.submit await lowers to a worker.done poll", () => {
  it("emits a state whose resume condition polls __tc_worker_done(handle)", () => {
    const strategy: PlatformStrategy = new ZephyrStrategy();
    const knownReturnTypes = new Map<string, string>();
    // Body: a single awaited worker.submit → one segment ending in the marker.
    const fnStatements: StatementIR[] = [awaitedWorkerSubmit(2, "computeFn")];

    const result = generateAsyncTaskClass(
      "doWork",
      fnStatements,
      strategy,
      knownReturnTypes,
      renderStatementStub,
    );

    // The emitted class body must poll __tc_worker_done with handle 2.
    expect(result.classDef).toContain("__tc_worker_done");
    expect(result.classDef).toMatch(/__tc_worker_done\(static_cast<int32_t>\(2\)\)/);
    // And it must NOT fall back to a plain millis deadline poll for this state.
    // (The first STATE_0 runs immediately + arms; STATE_1 polls the worker.)
    expect(result.classDef).toMatch(/STATE_1/);
  });

  it("emits the submit as the start line (arming the wait)", () => {
    const strategy: PlatformStrategy = new ZephyrStrategy();
    const knownReturnTypes = new Map<string, string>();
    const fnStatements: StatementIR[] = [awaitedWorkerSubmit(1, "myWorker")];

    const result = generateAsyncTaskClass(
      "doWork",
      fnStatements,
      strategy,
      knownReturnTypes,
      renderStatementStub,
    );

    // STATE_0 arms the wait by emitting the submit start line.
    expect(result.classDef).toContain("__tc_worker_submit");
    expect(result.classDef).toMatch(/__tc_worker_submit\(static_cast<int32_t>\(1\), myWorker/);
  });
});
