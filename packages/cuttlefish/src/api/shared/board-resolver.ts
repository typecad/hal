// ---------------------------------------------------------------------------
// Board constant types
//
// Types for compile-time constant extraction from board definitions.
// The implementation lives in the CLI (ir/board-resolver.ts) and reads the
// project-local generated board.json manifest.
// ---------------------------------------------------------------------------

/**
 * Flat map from dot-path key to scalar constant value.
 *
 * Examples (from a generated board.json manifest):
 *   "name"         → "XIAO BLE"
 *   "pins.led"     → 13
 *   "pins.analogOffset" → 14
 */
export type BoardConstants = Map<string, string | number | boolean>;