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
//# sourceMappingURL=board-resolver.d.ts.map