// ---------------------------------------------------------------------------
// C++ reactive runtime header — the driver code that walks the node/binding/
// transition tables each frame.
//
// This is emitted once per translation unit (guarded) so the static tables
// produced by the lowering transformer have something to drive them. It
// implements the three-phase frame from spec §7:
//   1. Advance transitions (lerp toward target)
//   2. Draw traversal (dirty nodes only)
//   3. Flush dirty rects
//
// Plus the press/release entry points that node.onPress(pin) lowers to.
//
// The C++ source is split into contiguous slice modules under
// ./runtime-header/, concatenated here in source order. Each slice is a
// verbatim range of the original template literal; the assembled output is
// byte-identical to the pre-split single-file version (guarded by
// tests/packages/cuttlefish/runtime-header-byte-identity.test.ts).
// ---------------------------------------------------------------------------

import { emitTypesDefines } from "./runtime-header/types-defines.js";
import { emitStructs } from "./runtime-header/structs.js";
import { emitColorMonoRefresh } from "./runtime-header/color-mono-refresh.js";
import { emitStateBindingsNav } from "./runtime-header/state-bindings-nav.js";
import { emitForwardDecls } from "./runtime-header/forward-decls.js";
import { emitCanvasHelpers } from "./runtime-header/canvas-helpers.js";
import { emitDisplayShim } from "./runtime-header/display-shim.js";
import { emitScrollPhysics } from "./runtime-header/scroll-physics.js";
import { emitImageDrawing } from "./runtime-header/image-drawing.js";
import { emitCanvasScrollbar } from "./runtime-header/canvas-scrollbar.js";
import { emitDirtyScrollMutators } from "./runtime-header/dirty-scroll-mutators.js";
import { emitPaintOrderCoords } from "./runtime-header/paint-order-coords.js";
import { emitPaintRectsRepair } from "./runtime-header/paint-rects-repair.js";
import { emitInitPressInput } from "./runtime-header/init-press-input.js";
import { emitTouchKeyboardFwd } from "./runtime-header/touch-keyboard-fwd.js";
import { emitBlendBodies } from "./runtime-header/blend-bodies.js";
import { emitTextRendering } from "./runtime-header/text-rendering.js";
import { emitNodeDecoration } from "./runtime-header/node-decoration.js";
import { emitTickMotionHelpers } from "./runtime-header/tick-motion-helpers.js";
import { emitTick } from "./runtime-header/tick.js";
import { emitAntialiasing } from "./runtime-header/antialiasing.js";
import { emitKeyboard } from "./runtime-header/keyboard.js";
import { emitGuardClose } from "./runtime-header/guard-close.js";

export function emitRuntimeHeader(): string {
  return [
    emitTypesDefines(),
    emitStructs(),
    emitColorMonoRefresh(),
    emitStateBindingsNav(),
    emitForwardDecls(),
    emitCanvasHelpers(),
    emitDisplayShim(),
    emitScrollPhysics(),
    emitImageDrawing(),
    emitCanvasScrollbar(),
    emitDirtyScrollMutators(),
    emitPaintOrderCoords(),
    emitPaintRectsRepair(),
    emitInitPressInput(),
    emitTouchKeyboardFwd(),
    emitBlendBodies(),
    emitTextRendering(),
    emitNodeDecoration(),
    emitTickMotionHelpers(),
    emitTick(),
    emitAntialiasing(),
    emitKeyboard(),
    emitGuardClose(),
  ].join("");
}
