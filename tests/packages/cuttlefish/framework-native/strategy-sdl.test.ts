import { describe, it, expect } from "vitest";
import { NativeStrategy } from "../../../../packages/cuttlefish/src/frameworks/native/strategy";

describe("NativeStrategy SDL wiring", () => {
  const s = new NativeStrategy();
  it("supports the sdl display driver", () => {
    expect(s.supportedDisplayDrivers().has("sdl")).toBe(true);
  });
  // native-preview was advertised but never registered as a display adapter
  // (display-adapter.ts only registers st7796/ssd1680/ssd1309/sdl/ili9341),
  // so a `driver: 'native-preview'` config passed mount validation and then
  // crashed the transpile with "No display adapter registered". It's a
  // terminal-stub concept, not a real renderer — drop it from the advertised
  // set so mount validation rejects it up front with the standard error.
  it("does NOT advertise native-preview (no adapter is registered for it)", () => {
    expect(s.supportedDisplayDrivers().has("native-preview")).toBe(false);
  });
  it("advertises exactly the sdl driver", () => {
    expect([...s.supportedDisplayDrivers()].sort()).toEqual(["sdl"]);
  });
});
