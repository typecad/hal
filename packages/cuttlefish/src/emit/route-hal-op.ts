// ---------------------------------------------------------------------------
// Op routing — dispatch a HALOpIR to the right strategy resolver.
//
// display.* ops go to resolveDisplayOp (graphics-specific); everything else
// goes to resolveHALOperation (the existing generic seam). Keeps the consumer
// sites (expression-renderer, statement-renderer, render-expr) DRY.
// ---------------------------------------------------------------------------

import type { HALOpIR, PlatformStrategy } from "../api/shared";

export function routeHALOp(
  op: HALOpIR,
  strategy: Pick<PlatformStrategy, "resolveHALOperation" | "resolveDisplayOp">,
): { code?: string; expression?: string } | undefined {
  if (typeof op.operation === "string" && op.operation.startsWith("display.")) {
    return strategy.resolveDisplayOp?.(op as Extract<HALOpIR, { operation: `display.${string}` }>);
  }
  return strategy.resolveHALOperation?.(op);
}
