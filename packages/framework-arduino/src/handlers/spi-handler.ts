// ---------------------------------------------------------------------------
// @typecode/framework-arduino — SPI Handler
//
// Renders TypeCode SPI peripheral calls to Arduino C++.
// Handles: SPI0 → SPI, SPI1 → SPI1, etc.
// ---------------------------------------------------------------------------

import type { ExpressionIR, BoardConstants } from '@typecode/core/shared';
import { getObjectField, pinLikeArgValue } from './handler-utils';

// ---------------------------------------------------------------------------
// Instance resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the Arduino SPI instance name from a TypeCode receiver.
 * SPI0 → SPI, SPI1 → SPI1, etc.
 */
export function resolveSPIInstance(receiver: string): string {
  return receiver === 'SPI0' ? 'SPI' : `SPI${receiver.slice(3)}`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Render an SPI peripheral call to Arduino C++.
 * Returns the C++ expression string, or undefined if the method is unknown.
 */
export function renderSPICall(
  receiver: string,
  method: string,
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
  boardConstants?: BoardConstants,
): string | undefined {
  const instance = resolveSPIInstance(receiver);
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');

  switch (method) {
    case 'initialize':      return `${instance}.begin()`;
    case 'begin':           return `${instance}.begin()`;
    case 'end':             return `${instance}.end()`;
    case 'transfer':        return `${instance}.transfer(${a(0)})`;
    case 'write':           return `${instance}.transfer(${a(0)})`;  // transfer ignoring return
    case 'write16':         return `${instance}.transfer16(${a(0)})`;
    case 'read':            return `${instance}.transfer(0xFF)`;      // read by sending dummy
    case 'setFrequency':    return `${instance}.beginTransaction(SPISettings(${a(0)}, MSBFIRST, SPI_MODE0))`;
    case 'setMode':         return `${instance}.setDataMode(${a(0)})`;
    case 'setBitOrder': {
      const order = a(0) === '"lsb"' ? 'LSBFIRST' : 'MSBFIRST';
      return `${instance}.setBitOrder(${order})`;
    }
    case 'transferBuffer':
    case 'writeBuffer':     return `${instance}.transfer(${a(0)}, ${a(1)})`;  // bulk transfer (modifies buffer in place)
    case 'beginTransaction': {
      const configArg = args[0];
      if (configArg && configArg.kind === 'object') {
        const freqField = getObjectField(configArg, 'frequency');
        const modeField = getObjectField(configArg, 'mode');
        const bitOrderField = getObjectField(configArg, 'bitOrder');
        const freq = freqField ? renderArg(freqField) : '1000000';
        const mode = modeField ? renderArg(modeField) : '0';
        const bitOrder = bitOrderField ? renderArg(bitOrderField) : 'MSBFIRST';
        return `${instance}.beginTransaction(SPISettings(${freq}, ${bitOrder}, ${mode}))`;
      }
      return `${instance}.beginTransaction(SPISettings())`;
    }
    case 'endTransaction':  return `${instance}.endTransaction()`;
    case 'device.transfer': {
      const cs = pinLikeArgValue(a(0), boardConstants);
      const value = a(1);
      return `({ digitalWrite(${cs}, LOW); uint8_t __typecode_spi_result = ${instance}.transfer(${value}); digitalWrite(${cs}, HIGH); __typecode_spi_result; })`;
    }
    case 'device.write': {
      const cs = pinLikeArgValue(a(0), boardConstants);
      const value = a(1);
      return `({ digitalWrite(${cs}, LOW); ${instance}.transfer(${value}); digitalWrite(${cs}, HIGH); 0; })`;
    }
    // Ownership (opt-in, single-threaded Arduino = no-op with comment)
    case 'take':            return `/* ${receiver}.take() */`;
    case 'release':         return `/* ${receiver}.release() */`;
    default:                return undefined;
  }
}
