// ---------------------------------------------------------------------------
// @typecode/debug — Debug Module
//
// Provides breakpoint-based debugging for TypeCode embedded projects.
// ---------------------------------------------------------------------------

export { loadBreakpoints, getBreakpointsForFile, findTypecodeDir, TYPECODE_DIR, BREAKPOINTS_FILE } from './breakpoint-loader';
export { preprocess, type PreprocessOptions } from './preprocessor';
export type { BreakpointMap, BreakpointLocation, CapturedVariable } from './types';