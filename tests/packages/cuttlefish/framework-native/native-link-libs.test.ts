// ---------------------------------------------------------------------------
// resolveLinkLibraries — SDL2 auto-link resolution (cross-platform)
//
// The native toolchain auto-provides SDL2 link libraries when the `sdl`
// display driver is active, because the AST config loader cannot evaluate
// process.platform conditionals (a static `libraries` array can't satisfy both
// Windows and Linux). These tests pin the per-platform set and the
// user-library merge/dedup behavior.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { resolveLinkLibraries } from "../../../../packages/cuttlefish/src/frameworks/native/native-compile";

describe("resolveLinkLibraries", () => {
  const isWin = process.platform === "win32";

  it("provides the SDL2 set when the sdl display driver is active", () => {
    const libs = resolveLinkLibraries({ driver: "sdl" }, []);
    if (isWin) {
      // mingw32 (WinMain CRT glue) → SDL2main (SDL_main) → SDL2 (core).
      expect(libs).toEqual(["mingw32", "SDL2main", "SDL2"]);
    } else {
      expect(libs).toEqual(["SDL2"]);
    }
  });

  it("provides no libraries when the display driver is not sdl", () => {
    expect(resolveLinkLibraries({ driver: "st7789" }, [])).toEqual([]);
    expect(resolveLinkLibraries(undefined, [])).toEqual([]);
  });

  it("appends user-supplied libraries after the SDL set, deduped", () => {
    // SDL2 is already in the auto-set → not duplicated; curl appended last.
    const libs = resolveLinkLibraries({ driver: "sdl" }, ["curl", "SDL2"]);
    if (isWin) {
      expect(libs).toEqual(["mingw32", "SDL2main", "SDL2", "curl"]);
    } else {
      expect(libs).toEqual(["SDL2", "curl"]);
    }
  });

  it("passes user libraries through when no display driver is set", () => {
    expect(resolveLinkLibraries(undefined, ["curl", "json"])).toEqual(["curl", "json"]);
  });
});
