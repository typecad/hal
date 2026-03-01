/**
 * Flat map from dot-path key to scalar constant value.
 *
 * Examples (for Arduino Uno):
 *   "id"           → "arduino-uno"
 *   "mcu"          → "ATmega328P"
 *   "clockSpeed"   → 16000000
 *   "memory.flash" → 32768
 *   "memory.sram"  → 2048
 *   "memory.eeprom"→ 1024
 */
export type BoardConstants = Map<string, string | number | boolean>;
/**
 * Parse a TypeScript board-definition source file and return a flat map of
 * all compile-time constant scalar values exported as a `BoardDefinition`.
 *
 * Properties whose values are arrays, spread elements, or other non-literal
 * expressions are silently skipped (no partial constant maps for board pins
 * etc. are needed by the emitter).
 *
 * @param defFilePath  Absolute path to the board definition `index.ts`.
 */
export declare function resolveBoardConstants(defFilePath: string): BoardConstants;
//# sourceMappingURL=board-resolver.d.ts.map