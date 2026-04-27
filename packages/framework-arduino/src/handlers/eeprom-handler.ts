// ---------------------------------------------------------------------------
// EEPROM namespace handler — maps TypeCode EEPROM.* calls to Arduino C++
//
// Maps the TypeCode EEPROM namespace to the Arduino EEPROM library.
// The library provides byte-level read/write with built-in CRC support.
// Requires: #include <EEPROM.h>  (auto-included by the framework when used)
// ---------------------------------------------------------------------------

import type { ExpressionIR } from '@typecode/core/shared';

/**
 * Render EEPROM namespace calls to Arduino C++.
 *
 * - EEPROM.read(addr)            → EEPROM.read(addr)
 * - EEPROM.write(addr, value)    → EEPROM.write(addr, value)
 * - EEPROM.update(addr, value)   → EEPROM.update(addr, value)
 * - EEPROM.length()              → EEPROM.length()
 * - EEPROM.get(addr, varRef)     → EEPROM.get(addr, varRef)
 * - EEPROM.put(addr, value)      → EEPROM.put(addr, value)
 */
export function renderEEPROMCall(
  method: string,
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
): string | undefined {
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');

  switch (method) {
    case 'read':
      return `EEPROM.read(${a(0)})`;
    case 'write':
      return `EEPROM.write(${a(0)}, ${a(1)})`;
    case 'update':
      // update() only writes if the stored value differs — saves write cycles
      return `EEPROM.update(${a(0)}, ${a(1)})`;
    case 'length':
      return `EEPROM.length()`;
    case 'get':
      return `EEPROM.get(${a(0)}, ${a(1)})`;
    case 'put':
      return `EEPROM.put(${a(0)}, ${a(1)})`;
    default:
      return undefined;
  }
}
