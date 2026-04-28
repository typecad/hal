// ---------------------------------------------------------------------------
// Typehal → Arduino C++ translation map
//
// Converts structured typehal ir call nodes to the correct Arduino C++
// built-in expressions.  All translations are centralised here so that
// the rest of the emitter stays regex-free.
// ---------------------------------------------------------------------------

import type { ExpressionIR, TypehalReceiverKind, BoardConstants, TargetProfile } from '@typehal/core/shared';
import { inferKindByName } from '@typehal/core/shared';
import { renderNumNamespace } from './handlers/num-handler';
import { renderPulseCall } from './handlers/pulse-handler';
import { renderShiftCall } from './handlers/shift-handler';
import { renderRandomCall } from './handlers/random-handler';
import { renderSerialCall } from './handlers/serial-handler';
import { renderI2CCall } from './handlers/i2c-handler';
import { renderSPICall } from './handlers/spi-handler';
import { renderEEPROMCall } from './handlers/eeprom-handler';
import { renderPreferencesCall } from './handlers/preferences-handler';
import { renderWDTCall } from './handlers/wdt-handler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip the `D` prefix from digital pin names so they resolve to plain
 * integers that the Arduino framework understands (D13 → 13).
 * A0–A5 are kept as-is because Arduino defines them as macros.
 * LED resolves to the board's LED pin number (from board constants) when
 * available, otherwise falls back to `LED_BUILTIN`.
 */
function pinArg(receiver: string, boardConstants?: BoardConstants): string {
  if (receiver === 'LED') {
    // Look up the board's LED pin name (e.g. "D2") and convert to a raw number.
    const ledPinName = boardConstants?.get('pins.led');
    if (typeof ledPinName === 'string' && /^D(\d+)$/.test(ledPinName)) {
      return ledPinName.slice(1); // "D2" → "2"
    }
    return 'LED_BUILTIN';
  }
  if (/^D\d+$/.test(receiver)) return receiver.slice(1);
  return receiver;
}



// ---------------------------------------------------------------------------
// Property chain helpers
// ---------------------------------------------------------------------------

/**
 * Walk a `property-access` IR chain upward and return the parts as a string
 * array, or `undefined` if the chain contains non-identifier/non-property
 * nodes.
 *
 * Example: `Board.definition.memory.flash`
 * → `['Board', 'definition', 'memory', 'flash']`
 */
export function extractPropertyChain(expr: ExpressionIR): string[] | undefined {
  if (expr.kind === 'identifier') return [expr.value];
  if (expr.kind === 'property-access') {
    const base = extractPropertyChain(expr.object);
    if (base) return [...base, expr.property];
  }
  return undefined;
}

/**
 * If `chain` is a `Board.definition.*` (or `Pins.definition.*`) path,
 * return the inline C++ literal for that path sourced from the compiled
 * board-definition file constants.
 *
 * Returns `undefined` when no translation is available (e.g. no board
 * constants were resolved, or the path does not exist in the manifest).
 */
export function renderBoardDefinitionAccess(
  chain: string[],
  target: TargetProfile,
  boardConstants?: BoardConstants,
): string | undefined {
  if (target !== 'arduino') return undefined;
  if (chain.length < 3) return undefined;
  if (chain[0] !== 'Board' && chain[0] !== 'Pins') return undefined;
  if (chain[1] !== 'definition') return undefined;
  if (!boardConstants) return undefined;

  const dotPath = chain.slice(2).join('.');
  const value = boardConstants.get(dotPath);
  if (value === undefined) return undefined;
  return typeof value === 'string' ? `"${value}"` : `${value}`;
}

// ---------------------------------------------------------------------------
// Core translation
// ---------------------------------------------------------------------------

/**
 * Translate a typehal method call to an Arduino C++ expression string.
 *
 * @param receiver     Symbol name, e.g. "A0", "D13", "Serial", "I2C0"
 * @param receiverKind Category inferred from the symbol name
 * @param method       Method name called on the receiver
 * @param args         Already-structured ExpressionIR argument list
 * @param renderArg    Callback that renders a single ExpressionIR to a C++ string
 * @returns            The complete C++ expression, or `undefined` if this
 *                     method has no special translation (pass through as-is)
 */
export function renderArduinoBuiltin(
  receiver: string,
  receiverKind: TypehalReceiverKind,
  method: string,
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
  boardConstants?: BoardConstants,
  interruptMode?: "FALLING" | "RISING" | "CHANGE",
): string | undefined {
  const pin = pinArg(receiver, boardConstants);
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');

  switch (receiverKind) {
    // ------------------------------------------------------------------
    // Analog input (AnalogPin) — A0-A5, SDA, SCL
    // ------------------------------------------------------------------
    case 'analog-input':
      switch (method) {
        case 'read':          return `analogRead(${pin})`;  // backward compat
        case 'readAnalog':    return `analogRead(${pin})`;
        case 'readVoltage':   return `(analogRead(${pin}) * 5.0 / 1023.0)`;
        case 'getResolution': return `10`;
        case 'setReference':  return `analogReference(${a(0)})`;
        case 'getMode':       return `0`;
        case 'setMode':       return `pinMode(${pin}, ${a(0)})`;
        case 'inputPullUp':   return `pinMode(${pin}, INPUT_PULLUP)`;
        case 'inputPullDown': return `pinMode(${pin}, INPUT_PULLDOWN)`;
        // Fluent mode converters
        case 'asInput':         return `/* analog pin ${receiver} is always input */`;
        case 'asInputPullUp':   return `pinMode(${pin}, INPUT_PULLUP)`;
      }
      break;

    // ------------------------------------------------------------------
    // Digital I/O (BasePin) — D0-D13 (non-PWM)
    // ------------------------------------------------------------------
    case 'digital':
    case 'interrupt':  // Interrupt-capable pins also support digital operations
      switch (method) {
        case 'read':           return `digitalRead(${pin})`;
        case 'high':           return `digitalWrite(${pin}, HIGH)`;
        case 'low':            return `digitalWrite(${pin}, LOW)`;
        case 'toggle':         return `digitalWrite(${pin}, !digitalRead(${pin}))`;
        case 'write':          return `digitalWrite(${pin}, ${a(0)})`;
        case 'pulse':          return `digitalWrite(${pin}, HIGH); delay(${a(0)}); digitalWrite(${pin}, LOW)`;
        case 'isHigh':         return `(digitalRead(${pin}) == HIGH)`;
        case 'isLow':          return `(digitalRead(${pin}) == LOW)`;
        case 'getMode':        return `0`;
        case 'setMode':        return `pinMode(${pin}, ${a(0)})`;
        case 'inputPullUp':    return `pinMode(${pin}, INPUT_PULLUP)`;
        case 'inputPullDown':  return `pinMode(${pin}, INPUT_PULLDOWN)`;
        // Fluent mode converters
        case 'asOutput':
          if (args.length > 0) {
            return `pinMode(${pin}, OUTPUT); digitalWrite(${pin}, ${a(0)})`;
          }
          return `pinMode(${pin}, OUTPUT)`;
        case 'asInput':          return `pinMode(${pin}, INPUT)`;
        case 'asInputPullUp':    return `pinMode(${pin}, INPUT_PULLUP)`;
        // Tone API - available on all digital output pins
        case 'tone':           return `tone(${pin}, ${a(0)})`;
        case 'toneFor':        return `tone(${pin}, ${a(0)}, ${a(1)})`;  // tone with duration
        case 'noTone':         return `noTone(${pin})`;
        case 'attachInterrupt':
          // Direct interrupt API: D2.onFalling(callback) -> attachInterrupt with mode
          if (interruptMode) {
            const handler = a(0);
            return `attachInterrupt(digitalPinToInterrupt(${pin}), ${handler}, ${interruptMode})`;
          }
          return undefined;
      }
      break;

    // ------------------------------------------------------------------
    // PWM pin (PWMPin) — D3, D5, D6, D9, D10, D11
    // ------------------------------------------------------------------
    case 'pwm':
      switch (method) {
        case 'read':           return `digitalRead(${pin})`;
        case 'high':           return `digitalWrite(${pin}, HIGH)`;
        case 'low':            return `digitalWrite(${pin}, LOW)`;
        case 'toggle':         return `digitalWrite(${pin}, !digitalRead(${pin}))`;
        case 'write':          return `analogWrite(${pin}, ${a(0)})`;
        case 'setDutyCycle':   return `analogWrite(${pin}, ${a(0)})`;
        case 'setFrequency':   return `/* setFrequency() not available on AVR */`;
        case 'getFrequency':   return `0`;
        case 'getResolution':  return `8`;
        case 'attach':         return `/* attach() no-op on AVR */`;
        case 'detach':         return `/* detach() no-op on AVR */`;
        case 'pulse':          return `digitalWrite(${pin}, HIGH); delay(${a(0)}); digitalWrite(${pin}, LOW)`;
        case 'isHigh':         return `(digitalRead(${pin}) == HIGH)`;
        case 'isLow':          return `(digitalRead(${pin}) == LOW)`;
        case 'getMode':        return `0`;
        case 'setMode':        return `pinMode(${pin}, ${a(0)})`;
        case 'inputPullUp':     return `pinMode(${pin}, INPUT_PULLUP)`;
        case 'inputPullDown':   return `pinMode(${pin}, INPUT_PULLDOWN)`;
        // Fluent mode converters
        case 'asOutput':
          if (args.length > 0) {
            return `pinMode(${pin}, OUTPUT); digitalWrite(${pin}, ${a(0)})`;
          }
          return `pinMode(${pin}, OUTPUT)`;
        case 'asInput':           return `pinMode(${pin}, INPUT)`;
        case 'asInputPullUp':     return `pinMode(${pin}, INPUT_PULLUP)`;
        // PWM configuration
        case 'pwm':
          if (args.length > 0) {
            const arg0 = args[0];
            // Optimize: pre-compute percent→byte for numeric literals
            if (arg0 && typeof arg0 === 'object' && arg0.kind === 'number' && typeof (arg0 as any).value === 'number') {
              const percent = (arg0 as any).value as number;
              const byteVal = Math.round(percent * 255 / 100);
              return `pinMode(${pin}, OUTPUT); analogWrite(${pin}, ${byteVal})`;
            }
            return `pinMode(${pin}, OUTPUT); analogWrite(${pin}, (int)((${a(0)}) * 255 / 100))`;
          }
          return `pinMode(${pin}, OUTPUT)`;
        case 'tone':           return `tone(${pin}, ${a(0)})`;
        case 'toneFor':        return `tone(${pin}, ${a(0)}, ${a(1)})`;  // tone with duration
        case 'stop':           return `noTone(${pin})`;
      }
      break;

    // ------------------------------------------------------------------
    // Serial port (ISerialPort) — UART0 → Serial, UART1 → Serial1, etc.
    // ------------------------------------------------------------------
    case 'serial':
      return renderSerialCall(receiver, method, args, renderArg);

    // ------------------------------------------------------------------
    // I2C bus (II2CBus) — I2C0 → Wire, I2C1 → Wire1, etc.
    // ------------------------------------------------------------------
    case 'i2c':
      return renderI2CCall(receiver, method, args, renderArg);

    // ------------------------------------------------------------------
    // SPI bus (ISPIBus) — SPI0 → SPI
    // ------------------------------------------------------------------
    case 'spi':
      return renderSPICall(receiver, method, args, renderArg, boardConstants);
  }

  return undefined; // No translation — caller uses fallback rendering
}

// ---------------------------------------------------------------------------
// Statement-level entry point
// ---------------------------------------------------------------------------

/**
 * Try to translate a statement-level typehal callee string (e.g. "D13.high",
 * "Serial.println", "Board.A0.read") to its Arduino C++ equivalent.
 *
 * Returns the complete rendered C++ expression string (without a trailing
 * semicolon), or `undefined` if the callee is not a typehal call.
 */
export function tryRenderTypehalCallStatement(
  callee: string,
  args: ReadonlyArray<ExpressionIR>,
  target: TargetProfile,
  renderArg: (e: ExpressionIR) => string,
  boardConstants?: BoardConstants,
  architecture?: string,
): string | undefined {
  // Guard removed — caller (ArduinoStrategy) is responsible for gating on target.

  // Parse the callee string into parts separated by "."
  const parts = callee.split('.');
  let receiver: string;
  let method: string;

  // ---- Handle utility namespaces FIRST (before length-based logic) ----
  // These have their own handlers and shouldn't fall through to renderArduinoBuiltin
  if (parts[0] === 'Pulse') {
    return renderPulseCall(parts, args, renderArg, boardConstants);
  }
  if (parts[0] === 'Shift') {
    return renderShiftCall(parts, args, renderArg, boardConstants);
  }
  if (parts[0] === 'Random') {
    return renderRandomCall(parts, args, renderArg);
  }
  if (parts[0] === 'Num') {
    return renderNumNamespace(parts, args, renderArg);
  }

  if (parts[0] === 'EEPROM') {
    return renderEEPROMCall(parts.slice(1).join('.'), args, renderArg);
  }

  if (parts[0] === 'Preferences') {
    return renderPreferencesCall(parts.slice(1).join('.'), args, renderArg);
  }

  if (parts[0] === 'Timing') {
    const method = parts[1];
    const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '0');
    switch (method) {
      case 'millis':            return 'millis()';
      case 'micros':            return 'micros()';
      case 'delay':             return `delay(${a(0)})`;
      case 'delayMicroseconds': return `delayMicroseconds(${a(0)})`;
      default: return undefined;
    }
  }

  if (parts[0] === 'WDT') {
    return renderWDTCall(parts.slice(1).join('.'), args, renderArg, architecture);
  }

  if (parts.length === 2) {
    // Direct pin method: e.g. "D13.high", "D2.pullup", "D2.onFalling"
    let receiver: string;
    let method: string;
    [receiver, method] = parts as [string, string];

    // Handle direct pin configuration methods
    if (method === 'pullup') {
      const pin = pinArg(receiver, boardConstants);
      return `pinMode(${pin}, INPUT_PULLUP)`;
    }
    if (method === 'pulldown') {
      const pin = pinArg(receiver, boardConstants);
      return `pinMode(${pin}, INPUT_PULLDOWN)`;
    }
    if (method === 'float') {
      const pin = pinArg(receiver, boardConstants);
      return `pinMode(${pin}, INPUT)`;
    }

    if (method === 'asInput' || method === 'asInputPullUp' || method === 'asOutput') {
      const kind = inferKindByName(receiver) === 'unknown' ? 'digital' : inferKindByName(receiver);
      return renderArduinoBuiltin(receiver, kind, method, args, renderArg, boardConstants);
    }

    // Handle flat interrupt API
    if (method === 'onFalling' || method === 'onRising' || method === 'onChange' || method === 'onLow' || method === 'onHigh') {
      const kind = inferKindByName(receiver);
      if (kind !== 'digital' && kind !== 'pwm' && kind !== 'interrupt' && kind !== 'unknown') return undefined;
      const pin = pinArg(receiver, boardConstants);
      const handler = args[0] ? renderArg(args[0]) : '';
      const modeMap: Record<string, string> = {
        onRising: 'RISING',
        onFalling: 'FALLING',
        onChange: 'CHANGE',
        onLow: 'LOW',
        onHigh: 'HIGH',
      };
      const mode = modeMap[method] ?? 'CHANGE';
      return `attachInterrupt(digitalPinToInterrupt(${pin}), ${handler}, ${mode})`;
    }

    if (method === 'offRising' || method === 'offFalling' || method === 'offChange' || method === 'offAll') {
      const kind = inferKindByName(receiver);
      if (kind !== 'digital' && kind !== 'pwm' && kind !== 'interrupt' && kind !== 'unknown') return undefined;
      const pin = pinArg(receiver, boardConstants);
      return `detachInterrupt(digitalPinToInterrupt(${pin}))`;
    }

    // Fall through to general pin method handling only for recognised Typehal symbols
    const kind = inferKindByName(receiver);
    if (kind === 'unknown') return undefined;
    return renderArduinoBuiltin(receiver, kind, method, args, renderArg, boardConstants);
  }

  if (parts.length === 3 && (parts[0] === 'Board' || parts[0] === 'Pins')) {
    // e.g. "Board.A0.read"  "Pins.D13.high"
    const [, receiver, method] = parts as [string, string, string];
    const kind = inferKindByName(receiver);
    if (kind === 'unknown') return undefined;
    return renderArduinoBuiltin(receiver, kind, method, args, renderArg, boardConstants);
  }

  if (parts.length === 3) {
    // Handle D3.input.pulldown() / D3.input.pullup() / D3.input() patterns
    const receiver = parts[0];
    const method = parts.slice(1).join('.');
    const kind = inferKindByName(receiver);
    if (kind === 'unknown') return undefined;
    return renderArduinoBuiltin(receiver, kind, method, args, renderArg, boardConstants);
  }

  return undefined;
}