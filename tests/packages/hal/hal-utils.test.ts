import { describe, it, expect } from "vitest";
import { createHALInstances } from "@typecad/hal";

describe("@typecad/hal ESM exports resolve under Node's native loader", () => {
  // Regression: register.ts declared register/bits as `export declare function`
  // (no runtime body), so tsc emitted register.js as `export {};` — while
  // index.js still did `export { register, bits } from './register.js'`. Under
  // Node's native ESM loader (e.g. a scaffolded project importing
  // @typecad/simulator → @typecad/hal), re-exporting bindings that the source
  // module doesn't actually export throws SyntaxError before any code runs.
  // vitest's transform tolerated it, so only a dynamic import() of the built
  // dist surfaces the real failure. register/bits now carry inert runtime stubs.
  it("dynamically importing @typecad/hal does not throw", async () => {
    const mod = await import("@typecad/hal");
    expect(typeof mod.register).toBe("function");
    expect(typeof mod.bits).toBe("function");
  });
});

describe("createHALInstances", () => {
  it("inflates a sparse array indexed by instance number", () => {
    const instances = [
      { instance: 0 },
      { instance: 2 },
    ];
    const result = createHALInstances(instances, (i) => `bus${i}`);

    // Instance 0 → index 0, instance 2 → index 2 (sparse: index 1 is a hole).
    expect(result[0]).toBe("bus0");
    expect(result[1]).toBeUndefined();
    expect(result[2]).toBe("bus2");
  });

  it("produces a contiguous array for sequential instances", () => {
    const instances = [
      { instance: 0 },
      { instance: 1 },
      { instance: 2 },
    ];
    const result = createHALInstances(instances, (i) => i * 10);

    expect(result).toEqual([0, 10, 20]);
  });

  it("handles a single instance", () => {
    const result = createHALInstances([{ instance: 0 }], () => "only");
    expect(result).toEqual(["only"]);
  });

  it("passes the instance number to the factory", () => {
    const instances = [{ instance: 5 }];
    const result = createHALInstances(instances, (i) => i);
    expect(result[5]).toBe(5);
    expect(result.length).toBe(6);
  });

  it("supports destructuring for sparse arrays (the real-world usage)", () => {
    // Mirrors: export const [UART0, , UART2] = createHALInstances(...)
    const instances = [
      { instance: 0 },
      { instance: 2 },
    ];
    const [UART0, , UART2] = createHALInstances(instances, (i) => `Serial${i}`);

    expect(UART0).toBe("Serial0");
    expect(UART2).toBe("Serial2");
  });
});
