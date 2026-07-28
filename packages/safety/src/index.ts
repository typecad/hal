// Public API surface for @typecad/safety.
//
// This file's runtime exports are COMPILE-TIME CONSTRUCTS ONLY. The safety
// engine (engine-index.ts) intercepts safe.read / safe.pinMode calls during
// transpilation and lowers them to safety.read_safe / safety.pin_mode HAL ops.
// Importing `safe` from a plain Node process (not under cuttlefish) throws at
// runtime — the same model @typecad/ui uses for its ui.mount/signal/bind.

/** Stub thrown if `safe` is used outside a cuttlefish transpile context. */
class CompileTimeOnly extends Error {
  constructor() {
    super("@typecad/safety: `safe` is a compile-time construct. It is lowered by the cuttlefish transpiler and has no runtime implementation.");
  }
}

/** Placeholder — replaced in Task 8 with the real typed surface. */
export const safe = {
  read(_pin: number): never { throw new CompileTimeOnly(); },
  pinMode(_pin: number, _mode: number): never { throw new CompileTimeOnly(); },
};
