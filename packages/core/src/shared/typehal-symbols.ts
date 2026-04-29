// ---------------------------------------------------------------------------
// TypeHAL SDK symbol kind inference
//
// Maps known TypeHAL symbol names to their receiver kind.
// Board and framework packages register their symbols via
// `registerSymbolKinds()` at import time.
// ---------------------------------------------------------------------------

/**
 * Which category of typehal object a symbol belongs to.
 * Used by the emitter to select the correct platform built-in.
 */
export type TypehalReceiverKind =
  | 'analog-input'
  | 'digital'
  | 'interrupt'
  | 'pwm'
  | 'serial'
  | 'i2c'
  | 'spi'
  | 'pulse'
  | 'shift'
  | 'random'
  | 'num'
  | 'eeprom'
  | 'timing'
  | 'wdt'
  | 'preferences'
  | 'unknown';

// Mutable registry populated by board/framework packages at import time.
const _symbolKinds: Record<string, TypehalReceiverKind> = {};

/**
 * Register symbol-to-kind mappings from a board or framework package.
 * Call this at module initialization time (top-level in the package entry point).
 * Later registrations overwrite earlier ones for the same symbol name.
 */
export function registerSymbolKinds(kinds: Record<string, TypehalReceiverKind>): void {
  Object.assign(_symbolKinds, kinds);
}

/**
 * Return all pin names (e.g. "A0", "D3") that have the given receiver kind.
 * Used by validators to suggest alternative pins in error messages.
 */
export function pinsWithKind(kind: TypehalReceiverKind): string[] {
  return Object.entries(_symbolKinds)
    .filter(([_, k]) => k === kind)
    .filter(([name]) => /^[DA]\d+$/.test(name))
    .sort()
    .map(([name]) => name);
}

/**
 * Infer the TypeHAL receiver kind for a given symbol name.
 * Returns `'unknown'` for anything that is not a recognised symbol.
 */
export function inferKindByName(name: string): TypehalReceiverKind {
  // Pattern match peripheral instances (I2C0, I2C1, etc.)
  if (/^I2C\d+$/.test(name)) return 'i2c';
  if (/^SPI\d+$/.test(name)) return 'spi';
  if (/^UART\d+$/.test(name)) return 'serial';
  if (/^Serial\d*$/.test(name)) return 'serial';

  // Fall back to registered mappings for pins and other symbols
  return _symbolKinds[name] ?? 'unknown';
}
