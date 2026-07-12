// ---------------------------------------------------------------------------
// Engine entry point for @typecad/ui.
//
// Cuttlefish dynamically imports this module when UI usage is detected:
//   const ui = await import("@typecad/ui/engine");
//   setUIHook(ui.registerTranspilerUI());
//
// The registerTranspilerUI() function returns an object implementing the
// TranspilerUIHook interface defined in @typecad/cuttlefish. This is the
// single contract between the two packages — cuttlefish never imports any
// other module from @typecad/ui at runtime.
//
// Phase 4 status: the TranspilerUIHook type contract is established and the
// package metadata (exports map, peer dep) is in place. The real
// registerTranspilerUI() implementation arrives in Phase 5 when the engine
// modules move from cuttlefish/src/ui/ to packages/ui/src/ui-engine/.
// Until then, cuttlefish uses its internal eager bridge directly.
// ---------------------------------------------------------------------------

import type { TranspilerUIHook } from "@typecad/cuttlefish/ui-hook";

export type { TranspilerUIHook };
