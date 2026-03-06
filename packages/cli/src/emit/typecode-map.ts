// ---------------------------------------------------------------------------
// Typecode → Arduino C++ translation map
//
// Converts structured typecode IR call nodes to the correct Arduino C++
// built-in expressions.  All translations are centralised here so that
// the rest of the emitter stays regex-free.
// ---------------------------------------------------------------------------

import { ExpressionIR } from '../ir/model';
import { TypecodeReceiverKind, inferKindByName } from '../ir/typecode-symbols';
import { BoardConstants } from '../ir/board-resolver';
import { TargetProfile } from '../types';

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
    // Analog input (IAnalogInput) — A0-A5, SDA, SCL
    // ------------------------------------------------------------------
    case 'analog-input':
      switch (method) {
        case 'read':          return `analogRead(${pin})`;
        case 'readVoltage':   return `(analogRead(${pin}) * 5.0 / 1023.0)`;
        case 'getResolution': return `10`;
        case 'setReference':  return `analogReference(${a(0)})`;
        case 'getMode':       return `0`;
        case 'setMode':       return `pinMode(${pin}, ${a(0)})`;
        case 'asInput':       return `pinMode(${pin}, INPUT)`;
        case 'asOutput':      return `pinMode(${pin}, OUTPUT)`;
      }
      break;

    // ------------------------------------------------------------------
    // Digital I/O (IDigitalPin) — D0-D13 (non-PWM)
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
        // Tone API - available on all digital output pins
        case 'tone':           return `tone(${pin}, ${a(0)})`;
        case 'toneFor':        return `tone(${pin}, ${a(0)}, ${a(1)})`;  // tone with duration
        case 'noTone':         return `noTone(${pin})`;
        case 'attachInterrupt':
          // Fluent interrupt API: D2.on.falling(callback) -> attachInterrupt with mode
          if (interruptMode) {
            const handler = a(0);
            return `attachInterrupt(digitalPinToInterrupt(${pin}), ${handler}, ${interruptMode})`;
          }
          return undefined;
      }
      // Handle config.output.initial(value) -> pinMode(OUTPUT); digitalWrite(value)
      if (method === 'initial' && args.length >= 1) {
        return `pinMode(${pin}, OUTPUT); digitalWrite(${pin}, ${a(0)})`;
      }
      // Handle config.input.pullup() -> pinMode(INPUT_PULLUP)
      if (method === 'pullup') {
        return `pinMode(${pin}, INPUT_PULLUP)`;
      }
      // Handle config.input.pulldown() -> pinMode(INPUT) (no pulldown on AVR)
      if (method === 'pulldown') {
        return `pinMode(${pin}, INPUT)`;
      }
      // Handle config.input.float() -> pinMode(INPUT)
      if (method === 'float') {
        return `pinMode(${pin}, INPUT)`;
      }
      break;

    // ------------------------------------------------------------------
    // PWM pin (IPWMPin extends IDigitalPin) — D3, D5, D6, D9, D10, D11
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
        // New fluent API methods
        case 'pwm':            return `analogWrite(${pin}, (int)((${a(0)}) * 255 / 100))`;  // percent to 8-bit
        case 'tone':           return `tone(${pin}, ${a(0)})`;
        case 'toneFor':        return `tone(${pin}, ${a(0)}, ${a(1)})`;  // tone with duration
        case 'stop':           return `noTone(${pin})`;
      }
      // Handle config.output.initial(value) -> pinMode(OUTPUT); digitalWrite(value)
      if (method === 'initial' && args.length >= 1) {
        return `pinMode(${pin}, OUTPUT); digitalWrite(${pin}, ${a(0)})`;
      }
      // Handle config.input.pullup() -> pinMode(INPUT_PULLUP)
      if (method === 'pullup') {
        return `pinMode(${pin}, INPUT_PULLUP)`;
      }
      // Handle config.input.pulldown() -> pinMode(INPUT) (no pulldown on AVR)
      if (method === 'pulldown') {
        return `pinMode(${pin}, INPUT)`;
      }
      // Handle config.input.float() -> pinMode(INPUT)
      if (method === 'float') {
        return `pinMode(${pin}, INPUT)`;
      }
      // Handle config.pwm.initial(percent) -> pinMode(OUTPUT); analogWrite(resolved)
      if (method === 'pwmInitial') {
        return `pinMode(${pin}, OUTPUT); analogWrite(${pin}, (int)((${a(0)}) * 255 / 100))`;
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
        case 'deinitialize':     return `${serialInstance}.end()`;
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
          // begin() for master, begin(address) for slave
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
        case 'end':               return `${wireInstance}.end()`;
      }
      break;
    }

    // ------------------------------------------------------------------
    // SPI bus (ISPIBus) — SPI0 → SPI
    // ------------------------------------------------------------------
    case 'spi':
      switch (method) {
        case 'initialize':   return `SPI.begin()`;
        case 'deinitialize': return `SPI.end()`;
        case 'transfer':     return `SPI_transfer(${a(0)})`;
        case 'write':        return `SPI_write(${a(0)})`;
        case 'read':         return `SPI_read(${a(0)})`;
        case 'setFrequency': return `SPI.setClockDivider(${a(0)})`;
        case 'setMode':      return `SPI.setDataMode(${a(0)})`;
        case 'setBitOrder':  return `SPI.setBitOrder(${a(0)})`;
      }
      break;
  }

  return undefined; // No translation — caller uses fallback rendering
}

// ---------------------------------------------------------------------------
// Fluent I2C API handler
// ---------------------------------------------------------------------------

/**
 * Render fluent I2C API calls to Arduino C++.
 * 
 * Patterns:
 * - I2C0.config.sda(pin).scl(pin).speed(hz).begin()
 * - I2C0.device(addr).write(data).to(register)
 * - I2C0.device(addr).read(count).from(register)
 */
function renderFluentI2C(
  parts: string[],
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
  boardConstants?: BoardConstants,
): string | undefined {
  const busName = parts[0];  // I2C0, I2C1, etc.
  const wireInstance = busName === 'I2C0' ? 'Wire' : `Wire${busName.slice(3)}`;
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');

  // I2C0.config.sda / I2C0.config.scl / I2C0.config.speed / I2C0.config.begin
  if (parts[1] === 'config') {
    const configMethod = parts[2];
    switch (configMethod) {
      case 'sda':
      case 'scl':
        // Pin config - no-op on Arduino Uno (fixed pins), but store for other boards
        return `/* ${wireInstance}.${configMethod}(${a(0)}) */`;
      case 'speed':
        return `/* ${wireInstance}.setClock(${a(0)}) */`;
      case 'begin':
        return `${wireInstance}.begin()`;
    }
    return undefined;
  }

  // I2C0.device(addr).read(count).from(register)
  // I2C0.device(addr).write(data).to(register)
  if (parts[1] === 'device') {
    // This is handled by tracking the chain - the full chain needs to be processed
    // For now, return undefined to let the general handler deal with it
    return undefined;
  }

  return undefined;
}

/**
 * Render fluent I2C device operations that span multiple call sites.
 * Called when the full chain pattern is detected.
 * 
 * For reads: I2C0.device(addr).read(count).from(register)
 * For writes: I2C0.device(addr).write(data).to(register)
 */
function renderFluentI2CDevice(
  busName: string,
  address: string,
  operation: 'read' | 'write',
  countOrData: string,
  register: string,
  typeConversion?: string,
): string {
  const wireInstance = busName === 'I2C0' ? 'Wire' : `Wire${busName.slice(3)}`;
  
  if (operation === 'read') {
    // Generate read sequence with result struct
    const count = countOrData;
    if (typeConversion) {
      // With type conversion (asUint16, etc.)
      const bytes = parseInt(count) || 2;
      if (bytes === 1) {
        return `({ uint8_t _i2c_val; ${wireInstance}.beginTransmission(${address}); ${wireInstance}.write(${register}); ${wireInstance}.endTransmission(); ${wireInstance}.requestFrom(${address}, 1); _i2c_val = ${wireInstance}.read(); _i2c_val; })`;
      } else if (bytes === 2) {
        const shift = typeConversion === "'le'" ? '0' : '8';
        return `({ uint8_t _buf[2]; ${wireInstance}.beginTransmission(${address}); ${wireInstance}.write(${register}); ${wireInstance}.endTransmission(); ${wireInstance}.requestFrom(${address}, 2); for(int i=0;i<2;i++) _buf[i] = ${wireInstance}.read(); (${typeConversion} === 'le' ? (_buf[0] | (_buf[1] << 8)) : ((_buf[0] << 8) | _buf[1])); })`;
      } else if (bytes === 4) {
        return `({ uint8_t _buf[4]; ${wireInstance}.beginTransmission(${address}); ${wireInstance}.write(${register}); ${wireInstance}.endTransmission(); ${wireInstance}.requestFrom(${address}, 4); for(int i=0;i<4;i++) _buf[i] = ${wireInstance}.read(); (${typeConversion} === 'le' ? (_buf[0] | (_buf[1]<<8) | (_buf[2]<<16) | (_buf[3]<<24)) : ((_buf[0]<<24) | (_buf[1]<<16) | (_buf[2]<<8) | _buf[3])); })`;
      }
    }
    // Raw bytes read
    return `({ ${wireInstance}.beginTransmission(${address}); ${wireInstance}.write(${register}); ${wireInstance}.endTransmission(); ${wireInstance}.requestFrom(${address}, ${count}); })`;
  } else {
    // Write operation
    return `({ ${wireInstance}.beginTransmission(${address}); ${wireInstance}.write(${register}); ${wireInstance}.write(${countOrData}); ${wireInstance}.endTransmission(); })`;
  }
}

// ---------------------------------------------------------------------------
// Fluent Serial/UART API handler
// ---------------------------------------------------------------------------

/**
 * Render fluent Serial/UART API calls to Arduino C++.
 * 
 * Patterns:
 * - Serial.config.baudRate(115200).begin()
 * - Serial.write.line("text") -> Serial.println("text")
 * - Serial.write.ln("text") -> Serial.println("text")
 * - Serial.write.string("text") -> Serial.print("text")
 * - Serial.write.char('A') -> Serial.write('A')
 * - Serial.write.bytes([1,2,3]) -> Serial.write(...)
 * - Serial.write.format("fmt", args) -> Serial.printf("fmt", args)
 * - Serial.write.formatln("fmt", args) -> Serial.printf("fmt\n", args)
 * - Serial.write.byte(0xFF) -> Serial.write(0xFF)
 * - Serial.write.uint16(val, 'be') -> Serial.write(...)
 * - Serial.read.line(timeout) -> Serial.readStringUntil('\n')
 * - Serial.read.until(delim, timeout) -> Serial.readStringUntil(delim)
 * - Serial.read.untilEnter(timeout) -> Serial.readStringUntil('\n')
 * - Serial.read.untilSpace(timeout) -> Serial.readStringUntil(' ')
 * - Serial.read.untilTab(timeout) -> Serial.readStringUntil('\t')
 * - Serial.read.bytes(count, timeout) -> Serial.readBytes(count)
 * - Serial.read.all() -> Serial.readString()
 * - Serial.read.byte() -> Serial.read()
 * - Serial.read.char() -> (char)Serial.read()
 */
function renderFluentSerial(
  parts: string[],
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
): string | undefined {
  // Convert UART0 -> Serial, UART1 -> Serial1, etc.
  // Or keep Serial, Serial1, Serial2 as-is
  let serialInstance: string;
  if (parts[0].startsWith('UART')) {
    const uartNum = parts[0].slice(4);
    serialInstance = uartNum === '0' ? 'Serial' : `Serial${uartNum}`;
  } else {
    serialInstance = parts[0];
  }
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');

  // Serial.config.baudRate / Serial.config.dataBits / Serial.config.parity / Serial.config.begin
  if (parts[1] === 'config') {
    const configMethod = parts[2];
    switch (configMethod) {
      case 'baudRate':
      case 'dataBits':
      case 'parity':
      case 'stopBits':
      case 'flowControl':
      case 'tx':
      case 'rx':
      case 'rts':
      case 'cts':
      case 'rxBufferSize':
      case 'txBufferSize':
      case 'inverted':
      case 'defaultTimeout':
        // These are configuration methods that are chained - return comment
        return `/* ${serialInstance}.config.${configMethod}(${a(0)}) */`;
      case 'begin':
        // Config begin without arguments uses stored config - for now default to 9600
        return `${serialInstance}.begin(9600)`;
    }
    return undefined;
  }

  // Serial.write.line("text") -> Serial.println("text")
  // Serial.write.format("fmt", args) -> Serial.printf("fmt", args)
  if (parts[1] === 'write') {
    const writeMethod = parts[2];
    switch (writeMethod) {
      case 'line':
        // write.line(text) -> println with CRLF
        return `${serialInstance}.println(${a(0)})`;
      case 'ln':
        // write.ln(text) -> println (LF only, but Arduino println does CRLF)
        return `${serialInstance}.println(${a(0)})`;
      case 'string':
        // write.string(text) -> print (no newline)
        return `${serialInstance}.print(${a(0)})`;
      case 'char':
        // write.char('A') or write.char(65) -> write
        return `${serialInstance}.write(${a(0)})`;
      case 'byte':
        // write.byte(0xFF) -> write
        return `${serialInstance}.write(${a(0)})`;
      case 'bytes':
        // write.bytes([1,2,3]) -> write
        return `${serialInstance}.write(${a(0)})`;
      case 'format':
        // write.format("fmt", args) -> printf (no newline)
        return `${serialInstance}.printf(${a(0)})`;
      case 'formatln':
        // write.formatln("fmt", args) -> printf with \n
        const fmtArg = a(0);
        // Add \n to the format string if it's a string literal
        if (fmtArg.startsWith('"') && fmtArg.endsWith('"')) {
          return `${serialInstance}.printf(${fmtArg.slice(0, -1)}\\n")`;
        }
        return `${serialInstance}.printf(${fmtArg})`;
      case 'uint16':
      case 'int16':
      case 'uint32':
      case 'int32':
        // Multi-byte writes - need to write individual bytes
        // For now, just write the low byte
        // TODO: Proper multi-byte write implementation
        return `${serialInstance}.write(${a(0)})`;
    }
    return undefined;
  }

  // Serial.read.line(timeout) -> readStringUntil('\n')
  // Serial.read.until(delim, timeout) -> readStringUntil(delim)
  if (parts[1] === 'read') {
    const readMethod = parts[2];
    switch (readMethod) {
      case 'line':
        // read.line(timeout) -> readStringUntil('\n')
        return `${serialInstance}.readStringUntil('\\n')`;
      case 'until':
        // read.until(delim, timeout) -> readStringUntil(delim)
        const delim = a(0);
        // Handle character delimiter
        if (delim.startsWith("'") && delim.endsWith("'")) {
          // Character literal - convert to char
          return `${serialInstance}.readStringUntil(${delim})`;
        } else if (delim.startsWith('"') && delim.endsWith('"')) {
          // String literal - take first char
          return `${serialInstance}.readStringUntil(${delim}.charAt(0))`;
        }
        return `${serialInstance}.readStringUntil(${delim})`;
      case 'untilEnter':
        // read.untilEnter(timeout) -> readStringUntil('\n')
        return `${serialInstance}.readStringUntil('\\n')`;
      case 'untilSpace':
        // read.untilSpace(timeout) -> readStringUntil(' ')
        return `${serialInstance}.readStringUntil(' ')`;
      case 'untilTab':
        // read.untilTab(timeout) -> readStringUntil('\t')
        return `${serialInstance}.readStringUntil('\\t')`;
      case 'bytes':
        // read.bytes(count, timeout) -> readBytes(count)
        return `${serialInstance}.readBytes(${a(0)})`;
      case 'all':
        // read.all() -> readString()
        return `${serialInstance}.readString()`;
      case 'byte':
        // read.byte() -> read()
        return `${serialInstance}.read()`;
      case 'char':
        // read.char() -> (char)read()
        return `(char)${serialInstance}.read()`;
    }
    return undefined;
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

  if (parts.length === 2) {
    // e.g. "D13.high"  "Serial.println"
    [receiver, method] = parts as [string, string];
  } else if (parts.length === 3 && (parts[0] === 'Board' || parts[0] === 'Pins')) {
    // e.g. "Board.A0.read"  "Pins.D13.high"
    [, receiver, method] = parts as [string, string, string];
  } else if (parts.length === 4 && parts[1] === 'config' && parts[2] === 'output') {
    // e.g. "D2.config.output.initial" -> pinMode(OUTPUT); digitalWrite(value)
    const [pinName, , , method] = parts as [string, string, string, string];
    const kind = inferKindByName(pinName);
    if (kind === 'unknown') return undefined;
    const pin = pinArg(pinName, boardConstants);
    if (method === 'initial' && args.length >= 1) {
      return `pinMode(${pin}, OUTPUT); digitalWrite(${pin}, ${renderArg(args[0])})`;
    }
    return undefined;
  } else if (parts.length === 4 && parts[1] === 'config' && parts[2] === 'input') {
    // e.g. "D2.config.input.pullup" -> pinMode(INPUT_PULLUP)
    const [pinName, , , method] = parts as [string, string, string, string];
    const kind = inferKindByName(pinName);
    if (kind === 'unknown') return undefined;
    const pin = pinArg(pinName, boardConstants);
    if (method === 'pullup') {
      return `pinMode(${pin}, INPUT_PULLUP)`;
    }
    if (method === 'pulldown') {
      return `pinMode(${pin}, INPUT)`;  // no pulldown on AVR
    }
    if (method === 'float') {
      return `pinMode(${pin}, INPUT)`;
    }
    return undefined;
  } else if (parts.length === 4 && parts[1] === 'config' && parts[2] === 'pwm') {
    // e.g. "D3.config.pwm.initial" -> pinMode(OUTPUT); analogWrite(resolved)
    const [pinName, , , method] = parts as [string, string, string, string];
    const kind = inferKindByName(pinName);
    if (kind !== 'pwm') return undefined;
    const pin = pinArg(pinName, boardConstants);
    if (method === 'initial' && args.length >= 1) {
      // Convert percent (0-100) to 8-bit (0-255)
      return `pinMode(${pin}, OUTPUT); analogWrite(${pin}, (int)((${renderArg(args[0])}) * 255 / 100))`;
    }
    return undefined;
  } else if (parts.length === 3 && parts[1] === 'config' && parts[2] === 'analog') {
    // e.g. "A1.config.analog" -> pinMode(INPUT)
    const [pinName] = parts as [string, string, string];
    const kind = inferKindByName(pinName);
    if (kind !== 'analog-input') return undefined;
    const pin = pinArg(pinName, boardConstants);
    return `pinMode(${pin}, INPUT)`;
  } else if (parts.length === 3 && parts[1] === 'on') {
    // e.g. "D2.on.falling"  "D3.on.rising"  "D2.on.change"
    // Fluent interrupt API: D2.on.falling(() => ...) -> attachInterrupt(..., FALLING)
    const [pinName, , interruptMode] = parts as [string, string, string];
    const kind = inferKindByName(pinName);
    if (kind !== 'digital' && kind !== 'pwm' && kind !== 'interrupt') return undefined;
    
    const pin = pinArg(pinName, boardConstants);
    const handler = args[0] ? renderArg(args[0]) : '';
    // Map the fluent method name to Arduino interrupt mode
    const modeMap: Record<string, string> = {
      rising: 'RISING',
      falling: 'FALLING',
      change: 'CHANGE',
      low: 'LOW',
      high: 'HIGH',
    };
    const mode = modeMap[interruptMode] ?? 'CHANGE';
    return `attachInterrupt(digitalPinToInterrupt(${pin}), ${handler}, ${mode})`;
  } else if (parts.length === 3 && parts[1] === 'off') {
    // e.g. "D2.off.falling"  "D2.off.all"
    const [pinName, , interruptMode] = parts as [string, string, string];
    const kind = inferKindByName(pinName);
    if (kind !== 'digital' && kind !== 'pwm') return undefined;
    
    const pin = pinArg(pinName, boardConstants);
    if (interruptMode === 'all') {
      return `detachInterrupt(digitalPinToInterrupt(${pin}))`;
    }
    // For specific mode removal, we still use detachInterrupt (AVR doesn't support per-mode removal)
    return `detachInterrupt(digitalPinToInterrupt(${pin}))`;
  } else if (parts.length >= 3 && parts[0].startsWith('I2C')) {
    // Fluent I2C API
    // e.g. "I2C0.config.sda"  "I2C0.config.speed"  "I2C0.config.begin"
    // e.g. "I2C0.device.read.from"  "I2C0.device.write.to"
    return renderFluentI2C(parts, args, renderArg, boardConstants);
  } else if (parts.length >= 3 && (parts[0] === 'Serial' || parts[0].startsWith('Serial') || parts[0].startsWith('UART'))) {
    // Fluent Serial/UART API
    // e.g. "Serial.config.baudRate"  "Serial.config.begin"
    // e.g. "Serial.write.line"  "Serial.write.format"  "Serial.read.line"  "Serial.read.until"
    // Also handles UART0, UART1, UART2 which map to Serial, Serial1, Serial2
    return renderFluentSerial(parts, args, renderArg);
  } else {
    return undefined;
  }

  const kind = inferKindByName(receiver);
  if (kind === 'unknown') return undefined;

  return renderArduinoBuiltin(receiver, kind, method, args, renderArg, boardConstants);
}
