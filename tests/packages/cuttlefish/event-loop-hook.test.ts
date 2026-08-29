import { describe, it, expect } from "vitest";
import { NativeStrategy } from "../../../packages/cuttlefish/src/frameworks/native/strategy";

describe("native hostEventLoop hook", () => {
  it("returns loop scaffolding that pumps events and ticks repeatedly", () => {
    const s = new NativeStrategy();
    const loop = (s as any).hostEventLoop?.();
    expect(loop).toBeTruthy();
    expect(loop.flagName).toBe("sdl_running");
    expect(loop.continueCondition).toBe("sdl_running");
    expect(loop.preIteration).toContain("SDL_PollEvent");
    expect(loop.postIteration).toContain("display_present");
  });
});
