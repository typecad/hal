// E-ink UI adapter (Stage 4) — the refresh-model proof. Same 1bpp format as
// mono (the parameterized mono adapter: vtiled MONO01 backing store, always-
// complemented MONO10 pushes — the ssd16xx/uc81xx families accept nothing
// else); the NEW axis is the refresh model: the runtime's UI_REFRESH_DEFERRED
// accumulator flushes on change, the adapter rate-limits pushes to the panel's
// flash-cycle economics (TC_EINK_MIN_REFRESH_MS), and the panel sleeps between
// flashes (the driver blocks through BUSY inside display_write).
import type { ZephyrDisplayProfile } from "./profiles.js";
import { zephyrMonoDisplayAdapter } from "./ui-adapter-mono.js";

export function zephyrEinkDisplayAdapter(profile: ZephyrDisplayProfile) {
  return zephyrMonoDisplayAdapter(profile, { eink: true });
}
