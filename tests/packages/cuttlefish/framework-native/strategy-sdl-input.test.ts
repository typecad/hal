import { describe, it, expect } from "vitest";
import { NativeStrategy } from "../../../../packages/cuttlefish/src/frameworks/native/strategy";

// Tier A SDL input: route real desktop input through the runtime's existing
// hooks so the SDL build feels like a native app instead of an embedded
// display glued to a window. All three features live in the hostEventLoop
// preIteration SDL event pump (emitted into the same .cpp as the runtime
// header, so it can call ui_kb_* / ui_apply_scroll_delta / __ui_* globals).

describe("NativeStrategy SDL input wiring (Tier A)", () => {
  const s = new NativeStrategy();
  const loop = s.hostEventLoop();
  const pre = loop.preIteration;

  it("still pumps SDL_QUIT to end the loop", () => {
    expect(pre).toContain("SDL_QUIT");
    expect(loop.continueCondition).toBe("sdl_running");
  });

  // ── Feature 1: real keyboard text input ──────────────────────────────────
  describe("keyboard text input (SDL_TEXTINPUT → ui_kb_*)", () => {
    it("routes SDL_TEXTINPUT into ui_kb_insert while the on-screen keyboard is visible", () => {
      expect(pre).toContain("SDL_TEXTINPUT");
      expect(pre).toContain("ui_kb_insert");
      expect(pre).toContain("__ui_kb_visible");
    });
    it("maps backspace to ui_kb_delete", () => {
      expect(pre).toContain("SDLK_BACKSPACE");
      expect(pre).toContain("ui_kb_delete");
    });
    it("maps enter/escape to ui_kb_close", () => {
      expect(pre).toContain("SDLK_RETURN");
      expect(pre).toContain("ui_kb_close");
    });
    it("starts/stops SDL text input to track keyboard visibility (for IME support)", () => {
      expect(pre).toContain("SDL_StartTextInput");
      expect(pre).toContain("SDL_StopTextInput");
    });
  });

  // ── Feature 2: mouse-wheel scrolling ─────────────────────────────────────
  describe("mouse-wheel scrolling (SDL_MOUSEWHEEL → ui_apply_scroll_delta)", () => {
    it("handles SDL_MOUSEWHEEL events", () => {
      expect(pre).toContain("SDL_MOUSEWHEEL");
    });
    it("applies the wheel delta without inverting (SDL delivers the system-preferred direction)", () => {
      expect(pre).toContain("ui_apply_scroll_delta");
      // ui_apply_scroll_delta computes nextY = sy - dy, so a NEGATIVE dy (wheel
      // down, event.wheel.y == -1) increases scrollY → scrolls toward bottom,
      // matching the desktop expectation. SDL_MOUSEWHEEL already reflects the
      // OS's natural-scroll preference, so pass event.wheel.y through directly
      // — NO negation. (The earlier `-__e.wheel.y` inverted the direction.)
      expect(pre).toMatch(/__e\.wheel\.y\s*\*\s*40/);
      expect(pre).not.toMatch(/-\s*__e\.wheel\.y\s*\*/);
    });
    it("finds the scroll owner via ui_scroll_node_at (same scan as the touch path)", () => {
      // The fragile hit-test + ancestor-walk approach misses when the cursor is
      // over a non-child node; ui_scroll_node_at scans scrollable containers
      // directly, mirroring the touch path's scroll-scan.
      expect(pre).toContain("ui_scroll_node_at");
    });
    it("queries the live mouse position at wheel-event time and scales to framebuffer space (fullscreen fix)", () => {
      // __sdl_mouse_x/y only update on SDL_MOUSEMOTION/BUTTONDOWN. If the user
      // stops moving the mouse and just spins the wheel, those go stale and the
      // hit-test hits the wrong node (or none), so scrolling stops. The wheel
      // handler must query SDL_GetMouseState directly for the current position.
      expect(pre).toMatch(/SDL_MOUSEWHEEL[\s\S]*SDL_GetMouseState/);
      // In fullscreen the window is larger than the framebuffer, so the raw
      // window-space coords must scale to framebuffer space before hit-testing
      // (same scaling as touch_readRaw) or the wheel only hits the top-left.
      expect(pre).toMatch(/SDL_GetWindowSize/);
    });
  });

  // ── Feature 3: event-driven mouse (replaces polled SDL_GetMouseState) ─────
  describe("event-driven mouse (SDL_MOUSEBUTTON*/MOTION → __sdl_mouse_* state)", () => {
    it("handles SDL_MOUSEBUTTONDOWN / MOTION / BUTTONUP", () => {
      expect(pre).toContain("SDL_MOUSEBUTTONDOWN");
      expect(pre).toContain("SDL_MOUSEMOTION");
      expect(pre).toContain("SDL_MOUSEBUTTONUP");
    });
    it("writes to file-scope __sdl_mouse_* state that the touch shim reads", () => {
      expect(pre).toContain("__sdl_mouse_down");
      expect(pre).toContain("__sdl_mouse_x");
      expect(pre).toContain("__sdl_mouse_y");
    });
  });
});
