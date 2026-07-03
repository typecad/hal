import { describe, it, expect } from "vitest";
import { NativeStrategy } from "../../../packages/framework-native/src/strategy";

describe("NativeStrategy SDL wiring", () => {
  const s = new NativeStrategy();
  it("supports the sdl display driver", () => {
    expect(s.supportedDisplayDrivers().has("sdl")).toBe(true);
  });
  it("still supports native-preview", () => {
    expect(s.supportedDisplayDrivers().has("native-preview")).toBe(true);
  });
});
