import type { RuntimePolyfillIR } from "@typecad/cuttlefish/api";
import { modeTablePolyfill } from "./mode-table.js";
import { voterPolyfill } from "./vote.js";
import { safeVariablePolyfill } from "./safe-variable.js";

/** All safety runtime polyfills, in dependency order (mode table before voter,
 *  safe variable is standalone). Returned by the safety hook's
 *  buildPolyfills(); called from buildEmitterContext so each polyfill
 *  participates in usage-based tree-shaking via filterPolyfillHelpers. */
export function buildSafetyPolyfills(): RuntimePolyfillIR[] {
  return [modeTablePolyfill(), voterPolyfill(), safeVariablePolyfill()];
}
