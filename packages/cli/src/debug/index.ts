// ---------------------------------------------------------------------------
// @typehal/debug — Debug Module
//
// Provides breakpoint-based debugging for TypeHAL embedded projects.
// ---------------------------------------------------------------------------

export { loadBreakpoints, getBreakpointsForFile, findTypehalDir, TYPEHAL_DIR, BREAKPOINTS_FILE } from './breakpoint-loader';
export { preprocess, type PreprocessOptions } from './preprocessor';
export type { BreakpointMap, BreakpointLocation, CapturedVariable } from './types';