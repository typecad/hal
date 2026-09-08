// ---------------------------------------------------------------------------
// @typecad/hal/sim — Result factory helpers
// ---------------------------------------------------------------------------

/**
 * Result of a byte read operation (used internally by bus simulators).
 */
export interface IByteReadResult {
  ok: boolean;
  status: number;
  bytes: Uint8Array;
  bytesRead: number;
  timedOut: boolean;
  asUint8(): number;
  asInt8(): number;
  asUint16(endian: 'be' | 'le'): number;
  asInt16(endian: 'be' | 'le'): number;
  asUint32(endian: 'be' | 'le'): number;
  asInt32(endian: 'be' | 'le'): number;
  asString(): string;
  asStringTrim(): string;
  asInt(): number;
  asFloat(): number;
  unwrap(): Uint8Array;
  unwrapOr(defaultValue: Uint8Array): Uint8Array;
}

/**
 * Result of a write operation (used internally by bus simulators).
 */
export interface IWriteResult {
  ok: boolean;
  status: number;
  bytesWritten: number;
  unwrap(): number;
  unwrapOr(defaultValue: number): number;
}

/**
 * Create an IByteReadResult with the given bytes.
 */
export function createByteReadResult(
  bytes: Uint8Array,
  ok: boolean = true,
  status: number = 0,
  timedOut: boolean = false,
): IByteReadResult {
  return {
    ok,
    status,
    bytes,
    bytesRead: bytes.length,
    timedOut,
    asUint8(): number { return bytes[0] ?? 0; },
    asInt8(): number { const v = bytes[0] ?? 0; return v > 127 ? v - 256 : v; },
    asUint16(endian: 'be' | 'le'): number {
      if (bytes.length < 2) return 0;
      return endian === 'be'
        ? ((bytes[0]! << 8) | bytes[1]!) >>> 0
        : ((bytes[1]! << 8) | bytes[0]!) >>> 0;
    },
    asInt16(endian: 'be' | 'le'): number {
      const v = this.asUint16(endian);
      return v > 32767 ? v - 65536 : v;
    },
    asUint32(endian: 'be' | 'le'): number {
      if (bytes.length < 4) return 0;
      return endian === 'be'
        ? ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0
        : ((bytes[3]! << 24) | (bytes[2]! << 16) | (bytes[1]! << 8) | bytes[0]!) >>> 0;
    },
    asInt32(endian: 'be' | 'le'): number {
      const v = this.asUint32(endian);
      return v > 2147483647 ? v - 4294967296 : v;
    },
    asString(): string { return new TextDecoder().decode(bytes); },
    asStringTrim(): string { return this.asString().trim(); },
    asInt(): number { return parseInt(this.asString(), 10) || 0; },
    asFloat(): number { return parseFloat(this.asString()) || 0; },
    unwrap(): Uint8Array { return bytes; },
    unwrapOr(defaultValue: Uint8Array): Uint8Array { return ok ? bytes : defaultValue; },
  };
}

/**
 * Create an IWriteResult with the given bytesWritten count.
 */
export function createWriteResult(
  bytesWritten: number,
  ok: boolean = true,
  status: number = 0,
): IWriteResult {
  return {
    ok,
    status,
    bytesWritten,
    unwrap(): number { return bytesWritten; },
    unwrapOr(defaultValue: number): number { return ok ? bytesWritten : defaultValue; },
  };
}
