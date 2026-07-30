import { describe, it, expect } from "vitest";
import {
  generateCoopScheduler,
  buildCoopSchedInjection,
  type CoopWorkUnit,
} from "../../../packages/cuttlefish/src/api/shared/coop-scheduler";
import { transpile, type TranspileResult } from "../../setup";
import { ArduinoStrategy } from "../../../packages/framework-arduino/src/strategy";
import type { AsyncRuntimeConfig, PlatformStrategy } from "../../../packages/cuttlefish/src/api/shared/platform-strategy";

// ---------------------------------------------------------------------------
// Phase 0 — no-STL cooperative scheduler (priority + time-budget)
//
// These tests cover (a) the shape of the generated CoopSched C++ runtime and
// (b) that the function emitter routes the driver's per-frame pumps through
// CoopSched when a strategy opts in, and emits the legacy flat sequence
// otherwise (zero regression).
// ---------------------------------------------------------------------------

describe("generateCoopScheduler — emitted C++ runtime shape", () => {
  it("emits the no-STL namespace with a fixed-size slot table (no std::function/vector)", () => {
    const cpp = generateCoopScheduler({ capacity: 4, priorities: 2 });
    expect(cpp).toContain("namespace typecad_coop");
    expect(cpp).toContain("using WorkFn = void (*)(void*);");
    // Fixed slot table, not a std::vector.
    expect(cpp).toMatch(/WorkUnit _slots\[4\]/);
    expect(cpp).not.toContain("std::function");
    expect(cpp).not.toContain("std::vector");
  });

  it("uses fixed-width integer types (int8_t/int32_t/uint32_t), not bare int", () => {
    const cpp = generateCoopScheduler({ capacity: 8, priorities: 2 });
    expect(cpp).toContain("int8_t priority");
    expect(cpp).toContain("int32_t total");
    expect(cpp).toContain("uint32_t _start");
    // Bare `int` declarations should not appear in the scheduler body.
    expect(cpp).not.toMatch(/^\s*int\s+(total|_count|level|i)\b/m);
  });

  it("marks the scheduler class final (AUTOSAR leaf-class rule)", () => {
    const cpp = generateCoopScheduler({ capacity: 8, priorities: 2 });
    expect(cpp).toMatch(/class\s+CoopSched\s+final/);
    expect(cpp).toMatch(/struct\s+WorkUnit\s+final/);
  });

  it("emits the priority-descending dispatch loop from highest level to 0", () => {
    const cpp = generateCoopScheduler({ capacity: 8, priorities: 3 });
    // level starts at priorities-1 (2) and decrements to 0.
    expect(cpp).toMatch(/level = static_cast<int8_t>\(2\)/);
    expect(cpp).toMatch(/--level/);
  });

  it("omits the time-budget break when enableTimeBudget is false", () => {
    const cpp = generateCoopScheduler({ capacity: 8, priorities: 2, enableTimeBudget: false });
    // The budget break is gated; when off, the start time is only voided.
    expect(cpp).toContain("(void)_start;");
    expect(cpp).not.toContain(">= static_cast<uint32_t>");
  });

  it("emits the time-budget break using the provided currentTimeExpr and budget", () => {
    const cpp = generateCoopScheduler({
      capacity: 8,
      priorities: 2,
      enableTimeBudget: true,
      timeBudgetMs: 10,
      currentTimeExpr: "k_uptime_get_32()",
    });
    expect(cpp).toContain("k_uptime_get_32()");
    expect(cpp).toMatch(/k_uptime_get_32\(\) - _start\) >= static_cast<uint32_t>\(10\)/);
    expect(cpp).toContain("break;");
  });

  it("snapshots the unit count at run() entry so units registered mid-dispatch run next frame", () => {
    const cpp = generateCoopScheduler({ capacity: 8, priorities: 2 });
    // The total is captured once before the dispatch loops, mirroring the
    // microtask pump's anti-recursion semantics.
    expect(cpp).toMatch(/const int32_t total = _count;/);
  });

  it("exposes a global CoopSched_run() alias so loop() emit resolves", () => {
    const cpp = generateCoopScheduler({ capacity: 8, priorities: 2 });
    expect(cpp).toContain("inline void CoopSched_run()");
  });
});

describe("buildCoopSchedInjection — work-unit registration lines", () => {
  const units: CoopWorkUnit[] = [
    { name: "task_0", body: "fooTask.run();", priority: 1 },
    { name: "microtasks", body: "cuttlefish_pump_microtasks();", priority: 1 },
    { name: "timers", body: "__tc_timer_runtime.run();", priority: 0 },
  ];

  it("emits one file-scope static trampoline per unit (no captures)", () => {
    const { trampolines } = buildCoopSchedInjection(units);
    expect(trampolines).toHaveLength(3);
    expect(trampolines[0]).toContain("static void __tc_coop_task_0(void*");
    expect(trampolines[0]).toContain("fooTask.run();");
    expect(trampolines[1]).toContain("cuttlefish_pump_microtasks();");
    expect(trampolines[2]).toContain("__tc_timer_runtime.run();");
    // No std::function / captures.
    expect(trampolines.join("\n")).not.toContain("std::function");
  });

  it("emits idempotent registration guarded by isRegistered(), then a single dispatch", () => {
    const { injection } = buildCoopSchedInjection(units);
    const block = injection.join("\n");
    // Registration is guarded so the same loop() body is safe every frame.
    expect(block).toContain("if (!typecad_coop::CoopSched::instance().isRegistered())");
    expect(block).toContain("markRegistered()");
    // Each unit is registered with its priority and trampoline.
    expect(block).toContain("registerUnit(static_cast<int8_t>(1), __tc_coop_task_0, nullptr)");
    expect(block).toContain("registerUnit(static_cast<int8_t>(0), __tc_coop_timers, nullptr)");
    // Exactly one dispatch call per frame.
    expect(block).toContain("CoopSched_run();");
    const dispatchCount = (block.match(/CoopSched_run\(\)/g) || []).length;
    expect(dispatchCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Integration: the function emitter routes the driver's pumps through CoopSched
// when the active strategy opts in, and emits the legacy flat sequence when not.
// ---------------------------------------------------------------------------

/**
 * Wrap the real ArduinoStrategy so getAsyncRuntimeConfig() opts into CoopSched,
 * while delegating every other member to the real strategy. This mirrors how a
 * framework would adopt the scheduler and lets us assert on the emitted loop().
 */
function coopEnabledArduinoStrategy(opts: {
  priority?: boolean;
  timeBudget?: boolean;
}): PlatformStrategy {
  const base = new ArduinoStrategy();
  const overriddenConfig: AsyncRuntimeConfig = {
    ...base.getAsyncRuntimeConfig(),
    enablePriority: opts.priority ?? true,
    enableTimeBudget: opts.timeBudget ?? false,
    timeBudgetMs: 5,
    schedulerPriorities: 2,
  };
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "getAsyncRuntimeConfig") {
        return () => overriddenConfig;
      }
      // @ts-expect-error — forward everything else to the base strategy.
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as PlatformStrategy;
}

function loopBody(result: TranspileResult): string {
  // Extract the void loop() {...} body from the emitted source.
  const match = result.cpp.match(/void\s+loop\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  return match ? match[1] : "";
}

describe("function emitter — CoopSched routing", () => {
  it("emits the legacy flat pump sequence when CoopSched is NOT opted in (zero regression)", () => {
    // Default Arduino strategy: no enablePriority/enableTimeBudget.
    const result = transpile(
      `
      async function poll(): Promise<void> {
        await Promise.resolve();
      }
      export function setup(): void {}
      export function loop(): void {
        poll();
      }
      `,
      { target: "arduino" },
    );
    const body = loopBody(result);
    // Legacy sequence: per-task .run() + microtask pump, NOT CoopSched.
    expect(body).toContain("cuttlefish_pump_microtasks();");
    expect(body).not.toContain("CoopSched_run()");
    expect(body).not.toContain("typecad_coop::CoopSched");
  });

  it("routes the driver's pumps through CoopSched when enablePriority is true", () => {
    const result = transpile(
      `
      async function poll(): Promise<void> {
        await Promise.resolve();
      }
      export function setup(): void {}
      export function loop(): void {
        poll();
      }
      `,
      { target: "arduino", strategy: coopEnabledArduinoStrategy({ priority: true }) },
    );
    // The scheduler runtime polyfill is emitted.
    expect(result.cpp).toContain("namespace typecad_coop");
    expect(result.cpp).toContain("CoopSched_run()");
    // Trampolines for the per-frame pumps are present.
    expect(result.cpp).toContain("__tc_coop_microtasks");
    // The legacy flat pump is replaced by the guarded registration + dispatch.
    const body = loopBody(result);
    expect(body).toContain("isRegistered()");
    expect(body).toContain("CoopSched_run()");
  });

  it("emits the time-budget break with millis() when enableTimeBudget is true", () => {
    const result = transpile(
      `
      async function poll(): Promise<void> {
        await Promise.resolve();
      }
      export function setup(): void {}
      export function loop(): void {
        poll();
      }
      `,
      { target: "arduino", strategy: coopEnabledArduinoStrategy({ timeBudget: true }) },
    );
    // The budget break uses the Arduino currentTimeMillis (millis()).
    expect(result.cpp).toMatch(/millis\(\) - _start\) >= static_cast<uint32_t>/);
    expect(result.cpp).toContain("break;");
  });
});
