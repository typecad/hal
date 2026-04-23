// ---------------------------------------------------------------------------
// @typecode/framework-arduino — I2C Handler
//
// Renders TypeCode I2C / Wire peripheral calls to Arduino C++.
// Handles: I2C0 → Wire, I2C1 → Wire1, etc.
// ---------------------------------------------------------------------------

import type { ExpressionIR } from '@typecode/core/shared';

// ---------------------------------------------------------------------------
// Instance resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the Arduino Wire instance name from a TypeCode receiver.
 * I2C0 → Wire, I2C1 → Wire1, I2C2 → Wire2, etc.
 */
export function resolveWireInstance(receiver: string): string {
  return receiver === 'I2C0' ? 'Wire' : `Wire${receiver.slice(3)}`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Render an I2C (Wire) peripheral call to Arduino C++.
 * Returns the C++ expression string, or undefined if the method is unknown.
 */
export function renderI2CCall(
  receiver: string,
  method: string,
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
): string | undefined {
  const instance = resolveWireInstance(receiver);
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');

  switch (method) {
    // Initialization
    case 'begin':
      if (args.length > 0) return `${instance}.begin(${a(0)})`;
      return `${instance}.begin()`;
    // Transactional write API
    case 'beginTransmission': return `${instance}.beginTransmission(${a(0)})`;
    case 'write':             return `${instance}.write(${a(0)})`;
    case 'endTransmission':   return `${instance}.endTransmission(${args.length > 0 ? a(0) : 'true'})`;
    // Read API
    case 'requestFrom':       return `${instance}.requestFrom(${a(0)}, ${a(1)}${args.length > 2 ? ', ' + a(2) : ''})`;
    case 'available':         return `${instance}.available()`;
    case 'read':              return `${instance}.read()`;
    // Clock control
    case 'setClock':          return `${instance}.setClock(${a(0)})`;
    // Slave callbacks
    case 'onReceive':         return `${instance}.onReceive(${a(0)})`;
    case 'onRequest':         return `${instance}.onRequest(${a(0)})`;
    // Cleanup
    case 'disable':           return `${instance}.end()`;
    case 'end':               return `${instance}.end()`;
    // Ownership (opt-in, single-threaded Arduino = no-op with comment)
    case 'take':              return `/* ${receiver}.take() */`;
    case 'release':           return `/* ${receiver}.release() */`;

    // Device accessor convenience methods (II2CDeviceAccessor)
    case 'device.writeByte': {
      const addr = a(0);
      const register = a(1);
      const value = a(2);
      return `${instance}.beginTransmission(${addr}); ${instance}.write(${register}); ${instance}.write(${value}); ${instance}.endTransmission()`;
    }
    case 'device.writeBytes': {
      const addr = a(0);
      const register = a(1);
      const dataArg = args[2];
      // Expand array literal into individual Wire.write() calls
      if (dataArg && dataArg.kind === 'array') {
        const elementWrites = dataArg.elements
          .map(e => `${instance}.write(${renderArg(e)})`)
          .join('; ');
        return `${instance}.beginTransmission(${addr}); ${instance}.write(${register}); ${elementWrites}; ${instance}.endTransmission()`;
      }
      // Variable reference — use Wire.write(data, sizeof(data))
      const data = a(2);
      return `${instance}.beginTransmission(${addr}); ${instance}.write(${register}); ${instance}.write(${data}, sizeof(${data})); ${instance}.endTransmission()`;
    }
    case 'device.readByte': {
      const addr = a(0);
      const register = a(1);
      return `${instance}.beginTransmission(${addr}); ${instance}.write(${register}); ${instance}.endTransmission(false); ${instance}.requestFrom(${addr}, 1); ${instance}.read()`;
    }
    case 'device.readBytes': {
      const addr = a(0);
      const register = a(1);
      const count = a(2);
      return `${instance}.beginTransmission(${addr}); ${instance}.write(${register}); ${instance}.endTransmission(false); ${instance}.requestFrom(${addr}, ${count})`;
    }
    case 'device':
      // I2C0.device(addr) — returns accessor, no direct C++ equivalent
      return `/* ${receiver}.device(${a(0)}) */`;
    default:
      return undefined;
  }
}
