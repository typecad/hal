// ---------------------------------------------------------------------------
// Zephyr display op resolver — maps DisplayHALOp → GFX runtime calls
//
// resolveZephyrDisplayOp is a pure function of (op, state): the strategy holds
// a DisplayState (mirrors Arduino's _displayCtx) and passes it in. On
// display.init the state is seeded with the active profile; subsequent ops
// lower to the helpers in gfx.ts.
//
// Validator probes call fill_rect/draw_text/draw_rect/flush WITHOUT a prior
// init, so when state is uninitialized we seed the DEFAULT profile and lower
// anyway (the probe only checks code/expression is non-undefined).
// ---------------------------------------------------------------------------

import type { DisplayHALOp } from '@typecad/cuttlefish/api/shared';
import { DEFAULT_ZEPHYR_DISPLAY_PROFILE, type ZephyrDisplayProfile } from './profiles.js';

// Re-export the UI display/touch adapters + profile registry so the strategy
// and consumers can reach them from the package barrel.
export { zephyrUiDisplayAdapter, zephyrDisplayAdapterGenerator } from './ui-adapter.js';
export { zephyrTouchAdapter } from './touch-adapter.js';
export { ZEPHYR_DISPLAY_PROFILES, DEFAULT_ZEPHYR_DISPLAY_PROFILE, BUILT_IN_PROFILES } from './profiles.js';
export type { ZephyrDisplayProfile } from './profiles.js';

export interface DisplayState {
  initialized: boolean;
  profile: ZephyrDisplayProfile;
}

/** Fresh display state (used by the strategy per-build). */
export function newDisplayState(): DisplayState {
  return { initialized: false, profile: DEFAULT_ZEPHYR_DISPLAY_PROFILE };
}

/**
 * Resolve a display.* op. Returns { code } for statement ops, undefined when
 * the op is not recognized.
 */
export function resolveZephyrDisplayOp(
  op: DisplayHALOp,
  state: DisplayState,
): { code?: string; expression?: string } | undefined {
  const o = op as any;

  // display.init seeds the state. The probe payload for init has no profile
  // fields, so use the default profile.
  if (op.operation === 'display.init') {
    state.initialized = true;
    return { code: 'display_init();' };
  }

  // For non-init ops: if not initialized (validator probe path), seed the
  // default so the op still lowers.
  if (!state.initialized) {
    state.initialized = true;
    state.profile = DEFAULT_ZEPHYR_DISPLAY_PROFILE;
  }

  switch (op.operation) {
    case 'display.fill_rect':
      return { code: `display_fill_rect(${o.x}, ${o.y}, ${o.w}, ${o.h}, ${o.color});` };
    case 'display.draw_rect':
      return { code: `display_draw_rect(${o.x}, ${o.y}, ${o.w}, ${o.h}, ${o.color});` };
    case 'display.draw_text':
      return { code: `display_draw_text(${o.x}, ${o.y}, "${o.text}", ${o.color});` };
    case 'display.flush':
      return { code: 'display_flush();' };
    default:
      return undefined;
  }
}
