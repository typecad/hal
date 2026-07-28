import type { RuntimePolyfillIR } from "@typecad/cuttlefish/api";
import { modeTablePolyfill } from "./mode-table.js";
import { voterPolyfill } from "./vote.js";

/** All safety runtime polyfills, in dependency order (mode table before voter).
 *  Returned by the safety hook's buildPolyfills(); called from
 *  buildEmitterContext so each polyfill participates in usage-based
 *  tree-shaking via filterPolyfillHelpers. */
export function buildSafetyPolyfills(): RuntimePolyfillIR[] {
  return [modeTablePolyfill(), voterPolyfill()];
}
