import { describe, it, expect } from "vitest";
import { routeHALOp } from "@typecad/cuttlefish/emit/route-hal-op";
import type { PlatformStrategy, DisplayHALOp, HALOpIR } from "@typecad/cuttlefish/api/shared";

function makeStrategy(calledDisplay: boolean[]): Pick<PlatformStrategy, "resolveHALOperation" | "resolveDisplayOp"> {
  return {
    resolveHALOperation: () => ({ code: "/* generic */" }),
    resolveDisplayOp: () => { calledDisplay[0] = true; return { code: "/* display */" }; },
  };
}

describe("display op routing", () => {
  it("routes display.* ops to resolveDisplayOp", () => {
    const called: boolean[] = [false];
    const strat = makeStrategy(called);
    const op: DisplayHALOp = { operation: "display.fill_rect", x: 0, y: 0, w: 1, h: 1, color: 0 };
    const out = routeHALOp(op as HALOpIR, strat);
    expect(called[0]).toBe(true);
    expect(out?.code).toBe("/* display */");
  });

  it("routes non-display ops to resolveHALOperation", () => {
    const called: boolean[] = [false];
    const strat = makeStrategy(called);
    const op = { operation: "gpio.write", pin: 13, value: 1 as const };
    const out = routeHALOp(op as HALOpIR, strat);
    expect(called[0]).toBe(false);
    expect(out?.code).toBe("/* generic */");
  });
});
