// ---------------------------------------------------------------------------
// @typehal/debug — Debug Module
//
// Provides breakpoint-based debugging for TypeHAL embedded projects.
// ---------------------------------------------------------------------------

export { loadBreakpoints, getBreakpointsForFile, TYPEHAL_DIR, BREAKPOINTS_FILE } from './breakpoint-loader';
export { preprocess } from './preprocessor';
export type { BreakpointMap, CapturedVariable } from './types';