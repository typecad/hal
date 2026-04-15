// ---------------------------------------------------------------------------
// Typecode → Arduino C++ translation map
//
// Converts structured typecode ir call nodes to the correct Arduino C++
// built-in expressions.  All translations are centralised here so that
// the rest of the emitter stays regex-free.
// ---------------------------------------------------------------------------

import type { ExpressionIR, TypecodeReceiverKind, BoardConstants, TargetProfile } from '@typecode/core/shared';
import { inferKindByName } from '@typecode/core/shared';

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

/**
 * Pull a named field out of an `{ kind: "object" }` ExpressionIR.
 * Returns undefined if the field is not present.
 */
function getObjectField(
  expr: ExpressionIR,
  fieldName: string,
): ExpressionIR | undefined {
  if (expr.kind !== 'object') return undefined;
  return expr.fields.find(f => f.name === fieldName)?.value;
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
 * Translate a typecode method call to an Arduino C++ expression string.
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
  receiverKind: TypecodeReceiverKind,
  method: string,
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
  boardConstants?: BoardConstants,
  interruptMode?: "FALLING" | "RISING" | "CHANGE",
): string | undefined {
  const pin = pinArg(receiver, boardConstants);
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');
  const allArgs = () => args.map(renderArg).join(', ');

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
    case 'serial': {
      // Determine Serial instance based on receiver
      // UART0 -> Serial, UART1 -> Serial1, UART2 -> Serial2
      // Serial -> Serial, Serial1 -> Serial1, Serial2 -> Serial2
      let serialInstance: string;
      if (receiver.startsWith('UART')) {
        const uartNum = receiver.slice(4);
        serialInstance = uartNum === '0' ? 'Serial' : `Serial${uartNum}`;
      } else if (receiver.startsWith('Serial')) {
        serialInstance = receiver;
      } else {
        serialInstance = 'Serial';
      }
      
      switch (method) {
        case 'initialize': {
          // Extract baudRate from the config object if passed
          const configArg = args[0];
          if (configArg) {
            const baudField = getObjectField(configArg, 'baudRate');
            if (baudField) return `${serialInstance}.begin(${renderArg(baudField)})`;
            return `${serialInstance}.begin(${renderArg(configArg)})`;
          }
          return `${serialInstance}.begin(9600)`;
        }
        case 'begin': {
          // UART0.begin(baud) -> Serial.begin(baud) — primary method
          if (args.length > 0) {
            return `${serialInstance}.begin(${a(0)})`;
          }
          return `${serialInstance}.begin(9600)`;
        }
        case 'end':              return `${serialInstance}.end()`;
        case 'print':            return `${serialInstance}.print(${allArgs()})`;
        case 'println':          return `${serialInstance}.println(${allArgs()})`;
        case 'printf':           return `${serialInstance}.printf(${allArgs()})`;
        case 'write':            return `${serialInstance}.write(${allArgs()})`;
        case 'read':             return `${serialInstance}.read()`;
        case 'available':        return `${serialInstance}.available()`;
        case 'availableForWrite':return `${serialInstance}.availableForWrite()`;
        case 'flush':            return `${serialInstance}.flush()`;
        case 'peek':             return `${serialInstance}.peek()`;
        case 'writeString':      return `${serialInstance}.print(${a(0)})`;
        case 'writeLine':        return `${serialInstance}.println(${a(0)})`;
        case 'readString':       return `${serialInstance}.readString()`;
        case 'readLine':         return `${serialInstance}.readStringUntil('\\n')`;
        case 'clearRxBuffer':    return `while (${serialInstance}.available()) ${serialInstance}.read()`;
        case 'isConnected':      return `(bool)${serialInstance}`;
        case 'setBaudRate':      return `${serialInstance}.begin(${a(0)})`;
        // Ownership (opt-in, single-threaded Arduino = no-op with comment)
        case 'take':             return `/* ${receiver}.take() */`;
        case 'release':          return `/* ${receiver}.release() */`;
      }
      break;
    }

    // ------------------------------------------------------------------
    // I2C bus (II2CBus) — I2C0 → Wire, I2C1 → Wire1, etc.
    // ------------------------------------------------------------------
    case 'i2c': {
      // Determine Wire instance based on receiver (I2C0 -> Wire, I2C1 -> Wire1)
      const wireInstance = receiver === 'I2C0' ? 'Wire' : `Wire${receiver.slice(3)}`;
      switch (method) {
        // Initialization
        case 'begin': {
          // I2C0.begin() -> Wire.begin() (master), I2C0.begin(address) -> Wire.begin(address) (slave)
          if (args.length > 0) {
            return `${wireInstance}.begin(${a(0)})`;
          }
          return `${wireInstance}.begin()`;
        }
        // Transactional write API
        case 'beginTransmission': return `${wireInstance}.beginTransmission(${a(0)})`;
        case 'write':             return `${wireInstance}.write(${a(0)})`;
        case 'endTransmission':   return `${wireInstance}.endTransmission(${args.length > 0 ? a(0) : 'true'})`;
        // Read API
        case 'requestFrom':       return `${wireInstance}.requestFrom(${a(0)}, ${a(1)}${args.length > 2 ? ', ' + a(2) : ''})`;
        case 'available':         return `${wireInstance}.available()`;
        case 'read':              return `${wireInstance}.read()`;
        // Clock control
        case 'setClock':          return `${wireInstance}.setClock(${a(0)})`;
        // Slave callbacks
        case 'onReceive':         return `${wireInstance}.onReceive(${a(0)})`;
        case 'onRequest':         return `${wireInstance}.onRequest(${a(0)})`;
        // Cleanup
        case 'disable':           return `${wireInstance}.end()`;
        case 'end':               return `${wireInstance}.end()`;
        // Ownership (opt-in, single-threaded Arduino = no-op with comment)
        case 'take':              return `/* ${receiver}.take() */`;
        case 'release':           return `/* ${receiver}.release() */`;
        // Device accessor convenience methods (II2CDeviceAccessor)
        // I2C0.device(addr).writeByte(register, value) → Wire.beginTransmission(addr); Wire.write(reg); Wire.write(val); Wire.endTransmission()
        case 'device.writeByte': {
          const addr = a(0);
          const register = a(1);
          const value = a(2);
          return `${wireInstance}.beginTransmission(${addr}); ${wireInstance}.write(${register}); ${wireInstance}.write(${value}); ${wireInstance}.endTransmission()`;
        }
        case 'device.writeBytes': {
          const addr = a(0);
          const register = a(1);
          const data = a(2);
          return `${wireInstance}.beginTransmission(${addr}); ${wireInstance}.write(${register}); ${wireInstance}.write(${data}); ${wireInstance}.endTransmission()`;
        }
        case 'device.readByte': {
          const addr = a(0);
          const register = a(1);
          return `${wireInstance}.beginTransmission(${addr}); ${wireInstance}.write(${register}); ${wireInstance}.endTransmission(false); ${wireInstance}.requestFrom(${addr}, 1); ${wireInstance}.read()`;
        }
        case 'device.readBytes': {
          const addr = a(0);
          const register = a(1);
          const count = a(2);
          return `${wireInstance}.beginTransmission(${addr}); ${wireInstance}.write(${register}); ${wireInstance}.endTransmission(false); ${wireInstance}.requestFrom(${addr}, ${count})`;
        }
        case 'device': {
          // I2C0.device(addr) — returns accessor, no direct C++ equivalent
          return `/* ${receiver}.device(${a(0)}) */`;
        }
      }
      break;
    }

    // ------------------------------------------------------------------
    // SPI bus (ISPIBus) — SPI0 → SPI
    // ------------------------------------------------------------------
    case 'spi': {
      // Determine SPI instance based on receiver (SPI0 -> SPI, SPI1 -> SPI1)
      const spiInstance = receiver === 'SPI0' ? 'SPI' : `SPI${receiver.slice(3)}`;
      switch (method) {
        case 'initialize':      return `${spiInstance}.begin()`;
        case 'begin':           return `${spiInstance}.begin()`;
        case 'end':             return `${spiInstance}.end()`;
        case 'transfer':        return `${spiInstance}.transfer(${a(0)})`;
        case 'write':           return `${spiInstance}.transfer(${a(0)})`;  // transfer ignoring return
        case 'write16':         return `${spiInstance}.transfer16(${a(0)})`;
        case 'read':            return `${spiInstance}.transfer(0xFF)`;     // read by sending dummy
        case 'setFrequency':    return `${spiInstance}.setClockDivider(${a(0)})`;
        case 'setMode':         return `${spiInstance}.setDataMode(${a(0)})`;
        case 'setBitOrder':     return `${spiInstance}.setBitOrder(${a(0)})`;
        case 'beginTransaction': {
          // Extract settings from SPISettings object
          const configArg = args[0];
          if (configArg && configArg.kind === 'object') {
            const freqField = getObjectField(configArg, 'frequency');
            const modeField = getObjectField(configArg, 'mode');
            const bitOrderField = getObjectField(configArg, 'bitOrder');
            const freq = freqField ? renderArg(freqField) : '1000000';
            const mode = modeField ? renderArg(modeField) : '0';
            const bitOrder = bitOrderField ? renderArg(bitOrderField) : 'MSBFIRST';
            return `${spiInstance}.beginTransaction(SPISettings(${freq}, ${bitOrder}, ${mode}))`;
          }
          return `${spiInstance}.beginTransaction(SPISettings())`;
        }
        case 'endTransaction':  return `${spiInstance}.endTransaction()`;
        // Ownership (opt-in, single-threaded Arduino = no-op with comment)
        case 'take':            return `/* ${receiver}.take() */`;
        case 'release':         return `/* ${receiver}.release() */`;
      }
      break;
    }
  }

  return undefined; // No translation — caller uses fallback rendering
}

// ---------------------------------------------------------------------------
// Fluent Num API handler
// ---------------------------------------------------------------------------

/**
 * Render fluent Num API calls to Arduino C++.
 * 
 * Direct functions:
 * - Num.map(value, fromLow, fromHigh, toLow, toHigh) -> map(value, fromLow, fromHigh, toLow, toHigh)
 * - Num.constrain(value, low, high) -> constrain(value, low, high)
 * - Num.abs(value) -> abs(value)
 * - Num.min(a, b) -> min(a, b)
 * - Num.max(a, b) -> max(a, b)
 * - Num.clamp(value, low, high) -> constrain(value, low, high)
 * - Num.inRange(value, low, high) -> ((value) >= (low) && (value) <= (high))
 * - Num.toPercent(value, fromLow, fromHigh) -> map(value, fromLow, fromHigh, 0, 100)
 * - Num.toByte(value, fromLow, fromHigh) -> map(value, fromLow, fromHigh, 0, 255)
 * 
 * Fluent chains:
 * - Num.map(value).from(fL, fH).to(tL, tH) -> map(value, fL, fH, tL, tH)
 * - Num.map(value).from(fL, fH).toPercent() -> map(value, fL, fH, 0, 100)
 * - Num.map(value).from(fL, fH).toByte() -> map(value, fL, fH, 0, 255)
 * - Num.constrain(value).between(low, high) -> constrain(value, low, high)
 */
function renderFluentNum(
  parts: string[],
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
): string | undefined {
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');

  // Num.map(value, fromLow, fromHigh, toLow, toHigh) - direct call (5 args)
  // Note: This is handled as Num_map in tryRenderTypecodeCallStatement for callable interface
  
  // Num.map(value).from(fL, fH).to(tL, tH) - fluent chain
  if (parts[1] === 'map') {
    if (parts.length === 2) {
      // Num.map(value) - starting a chain, returns a chain object
      // The transpiler should track the chain state
      return `/* Num.map(${a(0)}) chain */`;
    }
    if (parts.length === 3) {
      const mapMethod = parts[2];
      if (mapMethod === 'from') {
        // Num.map(value).from(fL, fH) - store from range
        return `/* Num.map chain: from(${a(0)}, ${a(1)}) */`;
      }
    }
    if (parts.length === 4) {
      // Num.map(value).from(fL, fH).to(tL, tH)
      if (parts[2] === 'from' && parts[3] === 'to') {
        // Full chain - we need the original value and all ranges
        // This requires tracking through the chain - handled in tryRenderTypecodeCallStatement
        return undefined;
      }
      if (parts[2] === 'from' && parts[3] === 'toPercent') {
        return undefined;
      }
      if (parts[2] === 'from' && parts[3] === 'toByte') {
        return undefined;
      }
      if (parts[2] === 'from' && parts[3] === 'constrain') {
        // Chain into constrain
        return undefined;
      }
    }
  }

  // Num.constrain(value).between(low, high) - fluent chain
  if (parts[1] === 'constrain') {
    if (parts.length === 2) {
      // Num.constrain(value) - starting a chain
      return `/* Num.constrain(${a(0)}) chain */`;
    }
    if (parts.length === 3 && parts[2] === 'between') {
      // Num.constrain(value).between(low, high)
      // This requires tracking - handled in tryRenderTypecodeCallStatement
      return undefined;
    }
  }

  return undefined;
}

/**
 * Render Num namespace calls to Arduino C++.
 * Handles both direct function calls and fluent chains.
 */
function renderNumCall(
  method: string,
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
): string | undefined {
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');
  const allArgs = () => args.map(renderArg).join(', ');

  switch (method) {
    // Direct functions
    case 'abs':
      return `abs(${a(0)})`;
    case 'min':
      return `min(${a(0)}, ${a(1)})`;
    case 'max':
      return `max(${a(0)}, ${a(1)})`;
    case 'constrain':
    case 'clamp':
      return `constrain(${a(0)}, ${a(1)}, ${a(2)})`;
    case 'inRange':
      return `((${a(0)}) >= (${a(1)}) && (${a(0)}) <= (${a(2)}))`;
    case 'toPercent':
      return `map(${a(0)}, ${a(1)}, ${a(2)}, 0, 100)`;
    case 'toByte':
      return `map(${a(0)}, ${a(1)}, ${a(2)}, 0, 255)`;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Pulse API handler
// ---------------------------------------------------------------------------

/**
 * Render Pulse namespace calls to Arduino C++.
 * 
 * Direct functions:
 * - Pulse.in(pin, value, timeout?) -> pulseIn(pin, value, timeout)
 * - Pulse.long(pin, value, timeout?) -> pulseInLong(pin, value, timeout)
 * 
 * Fluent chains:
 * - Pulse.on(pin).high() -> pulseIn(pin, HIGH)
 * - Pulse.on(pin).low() -> pulseIn(pin, LOW)
 * - Pulse.on(pin).timeout(us).high() -> pulseIn(pin, HIGH, us)
 * - Pulse.on(pin).timeout(us).long() -> pulseInLong(pin, value, us)
 */
function renderPulseCall(
  parts: string[],
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
  boardConstants?: BoardConstants,
): string | undefined {
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');
  
  // Helper to convert pin argument (D2 -> 2, A0 -> A0)
  const pinArgRaw = (rawPin: string): string => {
    if (/^D\d+$/.test(rawPin)) return rawPin.slice(1);
    return rawPin;
  };

  if (parts.length === 2) {
    const method = parts[1];
    switch (method) {
      case 'in':
        // Pulse.in(pin, value, timeout?) -> pulseIn(pin, value, timeout)
        // Convert boolean value: true -> HIGH, false -> LOW
        const valueArg1 = a(1);
        const pulseValue1 = valueArg1 === 'true' ? 'HIGH' : valueArg1 === 'false' ? 'LOW' : valueArg1;
        if (args.length > 2) {
          return `pulseIn(${pinArgRaw(a(0))}, ${pulseValue1}, ${a(2)})`;
        }
        return `pulseIn(${pinArgRaw(a(0))}, ${pulseValue1})`;
      case 'long':
        // Pulse.long(pin, value, timeout?) -> pulseInLong(pin, value, timeout)
        const valueArg2 = a(1);
        const pulseValue2 = valueArg2 === 'true' ? 'HIGH' : valueArg2 === 'false' ? 'LOW' : valueArg2;
        if (args.length > 2) {
          return `pulseInLong(${pinArgRaw(a(0))}, ${pulseValue2}, ${a(2)})`;
        }
        return `pulseInLong(${pinArgRaw(a(0))}, ${pulseValue2})`;
    }
  }

  if (parts.length === 3 && parts[1] === 'on') {
    // Pulse.on(pin).high() / Pulse.on(pin).low()
    const pin = pinArgRaw(a(0));
    const pulseMethod = parts[2];
    switch (pulseMethod) {
      case 'high':
        return `pulseIn(${pin}, HIGH)`;
      case 'low':
        return `pulseIn(${pin}, LOW)`;
    }
  }
  
  if (parts.length === 4 && parts[1] === 'on') {
    // Pulse.on.D2.high() / Pulse.on.D2.low() - fluent chain with pin in parts[2]
    const pin = pinArgRaw(parts[2]);
    const pulseMethod = parts[3];
    switch (pulseMethod) {
      case 'high':
        return `pulseIn(${pin}, HIGH)`;
      case 'low':
        return `pulseIn(${pin}, LOW)`;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Shift API handler
// ---------------------------------------------------------------------------

/**
 * Render Shift namespace calls to Arduino C++.
 * 
 * Direct functions:
 * - Shift.in(dataPin, clockPin, bitOrder) -> shiftIn(dataPin, clockPin, bitOrder)
 * - Shift.out(dataPin, clockPin, bitOrder, value) -> shiftOut(dataPin, clockPin, bitOrder, value)
 * 
 * Fluent chains:
 * - Shift.read(dataPin).clock(clockPin).msbFirst() -> shiftIn(dataPin, clockPin, MSBFIRST)
 * - Shift.read(dataPin).clock(clockPin).lsbFirst() -> shiftIn(dataPin, clockPin, LSBFIRST)
 * - Shift.write(dataPin, value).clock(clockPin).msbFirst() -> shiftOut(dataPin, clockPin, MSBFIRST, value)
 * - Shift.write(dataPin, value).clock(clockPin).lsbFirst() -> shiftOut(dataPin, clockPin, LSBFIRST, value)
 */
function renderShiftCall(
  parts: string[],
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
  boardConstants?: BoardConstants,
): string | undefined {
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');
  
  // Helper to convert pin argument (D2 -> 2, A0 -> A0)
  const pinArgRaw = (rawPin: string): string => {
    if (/^D\d+$/.test(rawPin)) return rawPin.slice(1);
    return rawPin;
  };

  if (parts.length === 2) {
    const method = parts[1];
    switch (method) {
      case 'in':
        // Shift.in(dataPin, clockPin, bitOrder) -> shiftIn(...)
        return `shiftIn(${pinArgRaw(a(0))}, ${pinArgRaw(a(1))}, ${a(2)})`;
      case 'out':
        // Shift.out(dataPin, clockPin, bitOrder, value) -> shiftOut(...)
        return `shiftOut(${pinArgRaw(a(0))}, ${pinArgRaw(a(1))}, ${a(2)}, ${a(3)})`;
    }
  }

  if (parts.length === 4 && parts[1] === 'read') {
    // Shift.read(dataPin).clock(clockPin).msbFirst/lsbFirst()
    const dataPin = pinArgRaw(a(0));
    const clockPin = pinArgRaw(a(1));
    const bitOrder = parts[3] === 'lsbFirst' ? 'LSBFIRST' : 'MSBFIRST';
    return `shiftIn(${dataPin}, ${clockPin}, ${bitOrder})`;
  }

  if (parts.length === 4 && parts[1] === 'write') {
    // Shift.write(dataPin, value).clock(clockPin).msbFirst/lsbFirst()
    const dataPin = pinArgRaw(a(0));
    const value = a(1);
    const clockPin = pinArgRaw(a(2));
    const bitOrder = parts[3] === 'lsbFirst' ? 'LSBFIRST' : 'MSBFIRST';
    return `shiftOut(${dataPin}, ${clockPin}, ${bitOrder}, ${value})`;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Random API handler
// ---------------------------------------------------------------------------

/**
 * Render Random namespace calls to Arduino C++.
 * 
 * Direct functions:
 * - Random.seed(value) -> randomSeed(value)
 * - Random.next(max) -> random(max)
 * - Random.next(min, max) -> random(min, max)
 * 
 * Fluent:
 * - Random.seedWith(value) -> randomSeed(value)
 * - Random.between(min, max) -> random(min, max)
 * - Random.upTo(max) -> random(max)
 * - Random.int() -> random()
 */
function renderRandomCall(
  parts: string[],
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
): string | undefined {
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');

  if (parts.length === 2) {
    const method = parts[1];
    switch (method) {
      case 'seed':
        // Random.seed(value) -> randomSeed(value)
        return `randomSeed(${a(0)})`;
      case 'seedWith':
        // Random.seedWith(value) -> randomSeed(value)
        return `randomSeed(${a(0)})`;
      case 'next':
        // Random.next(max) or Random.next(min, max) -> random(...)
        if (args.length > 1) {
          return `random(${a(0)}, ${a(1)})`;
        }
        return `random(${a(0)})`;
      case 'between':
        // Random.between(min, max) -> random(min, max)
        return `random(${a(0)}, ${a(1)})`;
      case 'upTo':
        // Random.upTo(max) -> random(max)
        return `random(${a(0)})`;
      case 'int':
        // Random.int() -> random() (full range)
        return `random()`;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Statement-level entry point
// ---------------------------------------------------------------------------

/**
 * Try to translate a statement-level typecode callee string (e.g. "D13.high",
 * "Serial.println", "Board.A0.read") to its Arduino C++ equivalent.
 *
 * Returns the complete rendered C++ expression string (without a trailing
 * semicolon), or `undefined` if the callee is not a typecode call.
 */
export function tryRenderTypecodeCallStatement(
  callee: string,
  args: ReadonlyArray<ExpressionIR>,
  target: TargetProfile,
  renderArg: (e: ExpressionIR) => string,
  boardConstants?: BoardConstants,
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
    // Num namespace - math utilities
    // Direct calls: Num.abs(x), Num.min(a, b), Num.max(a, b), Num.constrain(v, lo, hi), etc.
    // Fluent chains: Num.map(v).from(lo, hi).to(lo, hi), Num.constrain(v).between(lo, hi)
    
    if (parts.length === 2) {
      // Direct function call: Num.abs(value), Num.min(a, b), etc.
      return renderNumCall(parts[1], args, renderArg);
    }
    
    if (parts.length === 3) {
      // Num.map(value) - start of chain (returns chain object, no direct output)
      if (parts[1] === 'map' && parts[2] !== 'from' && parts[2] !== 'to') {
        // This is Num.map as a direct call with 5 args (callable interface)
        // Num.map(value, fromLow, fromHigh, toLow, toHigh)
        if (args.length === 5) {
          const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');
          return `map(${a(0)}, ${a(1)}, ${a(2)}, ${a(3)}, ${a(4)})`;
        }
      }
      // Handle other direct calls
      return renderNumCall(parts[1], args, renderArg);
    }
    
    if (parts.length === 4) {
      // Fluent chain patterns
      const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');
      
      // Num.map(value).from(fL, fH).to(tL, tH)
      if (parts[1] === 'map' && parts[2] === 'from' && parts[3] === 'to') {
        // Note: For fluent chains, we need to track state across calls
        // For now, we handle the terminal call with all accumulated args
        // args[0] = toLow, args[1] = toHigh (from is stored in chain)
        // This simplified version expects the chain to be resolved at compile time
        return `/* Num.map chain - requires chain tracking */`;
      }
      
      // Num.map(value).from(fL, fH).toPercent()
      if (parts[1] === 'map' && parts[2] === 'from' && parts[3] === 'toPercent') {
        return `/* Num.map().toPercent() chain */`;
      }
      
      // Num.map(value).from(fL, fH).toByte()
      if (parts[1] === 'map' && parts[2] === 'from' && parts[3] === 'toByte') {
        return `/* Num.map().toByte() chain */`;
      }
      
      // Num.constrain(value).between(low, high)
      if (parts[1] === 'constrain' && parts[2] === 'between') {
        // args[0] = low, args[1] = high (value is stored in chain)
        return `/* Num.constrain().between() chain */`;
      }
    }
    
    return renderFluentNum(parts, args, renderArg);
  }

  if (parts.length === 2) {
    // Direct pin method: e.g. "D13.high", "D2.pullup", "D2.onFalling"
    let receiver: string;
    let method: string;
    [receiver, method] = parts as [string, string];

    // Handle direct pin configuration methods
    if (method === 'pullup') {
      const kind = inferKindByName(receiver);
      if (kind === 'unknown') return undefined;
      const pin = pinArg(receiver, boardConstants);
      return `pinMode(${pin}, INPUT_PULLUP)`;
    }
    if (method === 'pulldown') {
      const kind = inferKindByName(receiver);
      if (kind === 'unknown') return undefined;
      const pin = pinArg(receiver, boardConstants);
      return `pinMode(${pin}, INPUT_PULLDOWN)`;
    }
    if (method === 'float') {
      const kind = inferKindByName(receiver);
      if (kind === 'unknown') return undefined;
      const pin = pinArg(receiver, boardConstants);
      return `pinMode(${pin}, INPUT)`;
    }

    // Handle flat interrupt API
    if (method === 'onFalling' || method === 'onRising' || method === 'onChange' || method === 'onLow' || method === 'onHigh') {
      const kind = inferKindByName(receiver);
      if (kind !== 'digital' && kind !== 'pwm' && kind !== 'interrupt') return undefined;
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
      if (kind !== 'digital' && kind !== 'pwm' && kind !== 'interrupt') return undefined;
      const pin = pinArg(receiver, boardConstants);
      return `detachInterrupt(digitalPinToInterrupt(${pin}))`;
    }

    // Fall through to general pin method handling
    const kind = inferKindByName(receiver);
    if (kind === 'unknown') return undefined;
    return renderArduinoBuiltin(receiver, kind, method, args, renderArg, boardConstants);
  } else if (parts.length === 3 && (parts[0] === 'Board' || parts[0] === 'Pins')) {
    // e.g. "Board.A0.read"  "Pins.D13.high"
    [, receiver, method] = parts as [string, string, string];
    const kind = inferKindByName(receiver);
    if (kind === 'unknown') return undefined;
    return renderArduinoBuiltin(receiver, kind, method, args, renderArg, boardConstants);
  } else if (parts.length === 3) {
    // Handle D3.input.pulldown() / D3.input.pullup() / D3.input() patterns
    [receiver, method] = [parts[0], parts.slice(1).join('.')];
    const kind = inferKindByName(receiver);
    if (kind === 'unknown') return undefined;
    return renderArduinoBuiltin(receiver, kind, method, args, renderArg, boardConstants);
  } else if (parts[0] === 'Num') {
    // Num namespace - math utilities
    // Direct calls: Num.abs(x), Num.min(a, b), Num.max(a, b), Num.constrain(v, lo, hi), etc.
    // Fluent chains: Num.map(v).from(lo, hi).to(lo, hi), Num.constrain(v).between(lo, hi)
    
    if (parts.length === 2) {
      // Direct function call: Num.abs(value), Num.min(a, b), etc.
      return renderNumCall(parts[1], args, renderArg);
    }
    
    if (parts.length === 3) {
      // Num.map(value) - start of chain (returns chain object, no direct output)
      if (parts[1] === 'map' && parts[2] !== 'from' && parts[2] !== 'to') {
        // This is Num.map as a direct call with 5 args (callable interface)
        // Num.map(value, fromLow, fromHigh, toLow, toHigh)
        if (args.length === 5) {
          const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');
          return `map(${a(0)}, ${a(1)}, ${a(2)}, ${a(3)}, ${a(4)})`;
        }
      }
      // Handle other direct calls
      return renderNumCall(parts[1], args, renderArg);
    }
    
    if (parts.length === 4) {
      // Fluent chain patterns
      const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');
      
      // Num.map(value).from(fL, fH).to(tL, tH)
      if (parts[1] === 'map' && parts[2] === 'from' && parts[3] === 'to') {
        // Note: For fluent chains, we need to track state across calls
        // For now, we handle the terminal call with all accumulated args
        // args[0] = toLow, args[1] = toHigh (from is stored in chain)
        // This simplified version expects the chain to be resolved at compile time
        return `/* Num.map chain - requires chain tracking */`;
      }
      
      // Num.map(value).from(fL, fH).toPercent()
      if (parts[1] === 'map' && parts[2] === 'from' && parts[3] === 'toPercent') {
        return `/* Num.map().toPercent() chain */`;
      }
      
      // Num.map(value).from(fL, fH).toByte()
      if (parts[1] === 'map' && parts[2] === 'from' && parts[3] === 'toByte') {
        return `/* Num.map().toByte() chain */`;
      }
      
      // Num.constrain(value).between(low, high)
      if (parts[1] === 'constrain' && parts[2] === 'between') {
        // args[0] = low, args[1] = high (value is stored in chain)
        return `/* Num.constrain().between() chain */`;
      }
    }
    
    return renderFluentNum(parts, args, renderArg);
  } else if (parts[0] === 'Pulse') {
    // Pulse namespace - pulse measurement utilities
    return renderPulseCall(parts, args, renderArg, boardConstants);
  } else if (parts[0] === 'Shift') {
    // Shift namespace - shift register utilities
    return renderShiftCall(parts, args, renderArg, boardConstants);
  } else if (parts[0] === 'Random') {
    // Random namespace - random number utilities
    return renderRandomCall(parts, args, renderArg);
  } else {
    return undefined;
  }

  const kind = inferKindByName(receiver);
  if (kind === 'unknown') return undefined;

  return renderArduinoBuiltin(receiver, kind, method, args, renderArg, boardConstants);
}