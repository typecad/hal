/**
 * Which category of typehal object a symbol belongs to.
 * Used by the emitter to select the correct Arduino built-in.
 */
export type TypehalReceiverKind = 'analog-input' | 'digital' | 'interrupt' | 'pwm' | 'serial' | 'i2c' | 'spi' | 'pulse' | 'shift' | 'random' | 'num' | 'unknown';
/**
 * Infer the typehal receiver kind for a given symbol name.
 * Returns `'unknown'` for anything that is not a recognised typehal symbol.
 */
export declare function inferKindByName(name: string): TypehalReceiverKind;
//# sourceMappingURL=typehal-symbols.d.ts.map