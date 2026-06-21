// ---------------------------------------------------------------------------
// @typecad/debug — Debug Module
//
// Provides breakpoint-based debugging for TypeCAD embedded projects.
// ---------------------------------------------------------------------------

export { loadBreakpoints, getBreakpointsForFile, CUTTLEFISH_DIR, BREAKPOINTS_FILE } from './breakpoint-loader.js';
export { preprocess } from './preprocessor.js';
export type { BreakpointMap, CapturedVariable } from './types.js';