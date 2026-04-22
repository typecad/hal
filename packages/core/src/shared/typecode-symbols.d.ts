/**
 * Which category of typecode object a symbol belongs to.
 * Used by the emitter to select the correct Arduino built-in.
 */
export type TypecodeReceiverKind = 'analog-input' | 'digital' | 'interrupt' | 'pwm' | 'serial' | 'i2c' | 'spi' | 'pulse' | 'shift' | 'random' | 'num' | 'unknown';
/**
 * Infer the typecode receiver kind for a given symbol name.
 * Returns `'unknown'` for anything that is not a recognised typecode symbol.
 */
export declare function inferKindByName(name: string): TypecodeReceiverKind;
//# sourceMappingURL=typecode-symbols.d.ts.map