// ---------------------------------------------------------------------------
// @typehal/framework-arduino — Serial Handler
//
// Renders TypeHAL Serial / UART peripheral calls to Arduino C++.
// Handles: UART0 → Serial, UART1 → Serial1, etc.
// ---------------------------------------------------------------------------

import type { ExpressionIR } from '@typehal/core/shared';
import { getObjectField } from './handler-utils';

// ---------------------------------------------------------------------------
// Instance resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the Arduino Serial instance name from a TypeHAL receiver.
 * UART0 → Serial, UART1 → Serial1, Serial → Serial, etc.
 */
export function resolveSerialInstance(receiver: string): string {
  if (receiver.startsWith('UART')) {
    const uartNum = receiver.slice(4);
    return uartNum === '0' ? 'Serial' : `Serial${uartNum}`;
  }
  if (receiver.startsWith('Serial')) {
    return receiver;
  }
  return 'Serial';
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Render a Serial (UART) peripheral call to Arduino C++.
 * Returns the C++ expression string, or undefined if the method is unknown.
 */
export function renderSerialCall(
  receiver: string,
  method: string,
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
): string | undefined {
  const instance = resolveSerialInstance(receiver);
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');
  const allArgs = () => args.map(renderArg).join(', ');

  switch (method) {
    case 'initialize': {
      const configArg = args[0];
      if (configArg) {
        const baudField = getObjectField(configArg, 'baudRate');
        const parityField = getObjectField(configArg, 'parity');
        const stopBitsField = getObjectField(configArg, 'stopBits');
        const wordLengthField = getObjectField(configArg, 'wordLength');
        const baud = baudField ? renderArg(baudField) : '9600';

        // If any framing fields are present, build a SERIAL_xNy config constant
        if (parityField || stopBitsField || wordLengthField) {
          const parityRaw = parityField ? renderArg(parityField) : '';
          const stopBitsRaw = stopBitsField ? renderArg(stopBitsField) : '';
          const wordLengthRaw = wordLengthField ? renderArg(wordLengthField) : '';

          const parityChar = parityRaw.includes('even') ? 'E' : parityRaw.includes('odd') ? 'O' : 'N';
          const stopChar = stopBitsRaw.trim() === '2' ? '2' : '1';
          const bits = /^[5-9]$/.test(wordLengthRaw.trim()) ? wordLengthRaw.trim() : '8';
          return `${instance}.begin(${baud}, SERIAL_${bits}${parityChar}${stopChar})`;
        }

        if (baudField) return `${instance}.begin(${baud})`;
        return `${instance}.begin(${renderArg(configArg)})`;
      }
      return `${instance}.begin(9600)`;
    }
    case 'begin':
      if (args.length > 0) return `${instance}.begin(${a(0)})`;
      return `${instance}.begin(9600)`;
    case 'end':              return `${instance}.end()`;
    case 'print':            return `${instance}.print(${allArgs()})`;
    case 'println':          return `${instance}.println(${allArgs()})`;
    case 'printf':           return `${instance}.printf(${allArgs()})`;
    case 'write':            return `${instance}.write(${allArgs()})`;
    case 'read':             return `${instance}.read()`;
    case 'available':        return `${instance}.available()`;
    case 'availableForWrite':return `${instance}.availableForWrite()`;
    case 'flush':            return `${instance}.flush()`;
    case 'peek':             return `${instance}.peek()`;
    case 'writeString':      return `${instance}.print(${a(0)})`;
    case 'writeLine':        return `${instance}.println(${a(0)})`;
    case 'readString':       return `${instance}.readString()`;
    case 'readLine':         return `${instance}.readStringUntil('\\n')`;
    case 'clearRxBuffer':    return `while (${instance}.available()) ${instance}.read()`;
    case 'isConnected':      return `(bool)${instance}`;
    case 'setBaudRate':      return `${instance}.begin(${a(0)})`;
    // Ownership (opt-in, single-threaded Arduino = no-op with comment)
    case 'take':             return `/* ${receiver}.take() */`;
    case 'release':          return `/* ${receiver}.release() */`;
    default:                 return undefined;
  }
}
