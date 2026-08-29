import type { RuntimePolyfillIR } from "../../api/index.js";
import { modeTablePolyfill } from "./mode-table.js";
import { voterPolyfill } from "./vote.js";
import { safeVariablePolyfill } from "./safe-variable.js";
import { safeIntPolyfill } from "./safe-int.js";
import { writeVerifyPolyfill } from "./write-verify.js";

/** All safety runtime polyfills, in dependency order (mode table before voter
 *  and write-verify, safe variable and safe int are standalone). Returned by
 *  the safety hook's buildPolyfills(); called from buildEmitterContext so each
 *  polyfill participates in usage-based tree-shaking via filterPolyfillHelpers. */
export function buildSafetyPolyfills(): RuntimePolyfillIR[] {
  return [modeTablePolyfill(), voterPolyfill(), writeVerifyPolyfill(), safeVariablePolyfill(), safeIntPolyfill()];
}
