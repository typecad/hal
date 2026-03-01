"use strict";
// ---------------------------------------------------------------------------
// Typecode → Arduino C++ translation map
//
// Converts structured typecode IR call nodes to the correct Arduino C++
// built-in expressions.  All translations are centralised here so that
// the rest of the emitter stays regex-free.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractPropertyChain = extractPropertyChain;
exports.renderBoardDefinitionAccess = renderBoardDefinitionAccess;
exports.renderArduinoBuiltin = renderArduinoBuiltin;
exports.tryRenderTypecodeCallStatement = tryRenderTypecodeCallStatement;
const typecode_symbols_1 = require("../ir/typecode-symbols");
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
function pinArg(receiver, boardConstants) {
    if (receiver === 'LED') {
        // Look up the board's LED pin name (e.g. "D2") and convert to a raw number.
        const ledPinName = boardConstants?.get('pins.led');
        if (typeof ledPinName === 'string' && /^D(\d+)$/.test(ledPinName)) {
            return ledPinName.slice(1); // "D2" → "2"
        }
        return 'LED_BUILTIN';
    }
    if (/^D\d+$/.test(receiver))
        return receiver.slice(1);
    return receiver;
}
/**
 * Pull a named field out of an `{ kind: "object" }` ExpressionIR.
 * Returns undefined if the field is not present.
 */
function getObjectField(expr, fieldName) {
    if (expr.kind !== 'object')
        return undefined;
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
function extractPropertyChain(expr) {
    if (expr.kind === 'identifier')
        return [expr.value];
    if (expr.kind === 'property-access') {
        const base = extractPropertyChain(expr.object);
        if (base)
            return [...base, expr.property];
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
function renderBoardDefinitionAccess(chain, target, boardConstants) {
    if (target !== 'arduino')
        return undefined;
    if (chain.length < 3)
        return undefined;
    if (chain[0] !== 'Board' && chain[0] !== 'Pins')
        return undefined;
    if (chain[1] !== 'definition')
        return undefined;
    if (!boardConstants)
        return undefined;
    const dotPath = chain.slice(2).join('.');
    const value = boardConstants.get(dotPath);
    if (value === undefined)
        return undefined;
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
function renderArduinoBuiltin(receiver, receiverKind, method, args, renderArg, boardConstants) {
    const pin = pinArg(receiver, boardConstants);
    const a = (i) => (args[i] !== undefined ? renderArg(args[i]) : '');
    const allArgs = () => args.map(renderArg).join(', ');
    switch (receiverKind) {
        // ------------------------------------------------------------------
        // Analog input (IAnalogInput) — A0-A5, SDA, SCL
        // ------------------------------------------------------------------
        case 'analog-input':
            switch (method) {
                case 'read': return `analogRead(${pin})`;
                case 'readVoltage': return `(analogRead(${pin}) * 5.0 / 1023.0)`;
                case 'getResolution': return `10`;
                case 'setReference': return `analogReference(${a(0)})`;
                case 'getMode': return `0`;
                case 'setMode': return `pinMode(${pin}, ${a(0)})`;
                case 'asInput': return `pinMode(${pin}, INPUT)`;
                case 'asOutput': return `pinMode(${pin}, OUTPUT)`;
            }
            break;
        // ------------------------------------------------------------------
        // Digital I/O (IDigitalPin) — D0-D13 (non-PWM)
        // ------------------------------------------------------------------
        case 'digital':
            switch (method) {
                case 'read': return `digitalRead(${pin})`;
                case 'high': return `digitalWrite(${pin}, HIGH)`;
                case 'low': return `digitalWrite(${pin}, LOW)`;
                case 'toggle': return `digitalWrite(${pin}, !digitalRead(${pin}))`;
                case 'write': return `digitalWrite(${pin}, ${a(0)})`;
                case 'pulse': return `digitalWrite(${pin}, HIGH); delay(${a(0)}); digitalWrite(${pin}, LOW)`;
                case 'asOutput': return `pinMode(${pin}, OUTPUT)`;
                case 'asInput': return `pinMode(${pin}, INPUT)`;
                case 'asInputPullUp': return `pinMode(${pin}, INPUT_PULLUP)`;
                case 'asInputPullDown': return `pinMode(${pin}, INPUT)`; // no pull-down on AVR
                case 'isHigh': return `(digitalRead(${pin}) == HIGH)`;
                case 'isLow': return `(digitalRead(${pin}) == LOW)`;
                case 'getMode': return `0`;
                case 'setMode': return `pinMode(${pin}, ${a(0)})`;
                case 'attachInterrupt':
                    return `attachInterrupt(digitalPinToInterrupt(${pin}), ${a(0)}, ${args.length > 1 ? a(1) : 'CHANGE'})`;
                case 'detachInterrupt':
                    return `detachInterrupt(digitalPinToInterrupt(${pin}))`;
            }
            break;
        // ------------------------------------------------------------------
        // PWM pin (IPWMPin extends IDigitalPin) — D3, D5, D6, D9, D10, D11
        // ------------------------------------------------------------------
        case 'pwm':
            switch (method) {
                case 'read': return `digitalRead(${pin})`;
                case 'high': return `digitalWrite(${pin}, HIGH)`;
                case 'low': return `digitalWrite(${pin}, LOW)`;
                case 'toggle': return `digitalWrite(${pin}, !digitalRead(${pin}))`;
                case 'write': return `analogWrite(${pin}, ${a(0)})`;
                case 'setDutyCycle': return `analogWrite(${pin}, ${a(0)})`;
                case 'setFrequency': return `/* setFrequency() not available on AVR */`;
                case 'getFrequency': return `0`;
                case 'getResolution': return `8`;
                case 'attach': return `/* attach() no-op on AVR */`;
                case 'detach': return `/* detach() no-op on AVR */`;
                case 'pulse': return `digitalWrite(${pin}, HIGH); delay(${a(0)}); digitalWrite(${pin}, LOW)`;
                case 'asOutput': return `pinMode(${pin}, OUTPUT)`;
                case 'asInput': return `pinMode(${pin}, INPUT)`;
                case 'asInputPullUp': return `pinMode(${pin}, INPUT_PULLUP)`;
                case 'asInputPullDown': return `pinMode(${pin}, INPUT)`;
                case 'isHigh': return `(digitalRead(${pin}) == HIGH)`;
                case 'isLow': return `(digitalRead(${pin}) == LOW)`;
                case 'getMode': return `0`;
                case 'setMode': return `pinMode(${pin}, ${a(0)})`;
                case 'attachInterrupt':
                    return `attachInterrupt(digitalPinToInterrupt(${pin}), ${a(0)}, ${args.length > 1 ? a(1) : 'CHANGE'})`;
                case 'detachInterrupt':
                    return `detachInterrupt(digitalPinToInterrupt(${pin}))`;
            }
            break;
        // ------------------------------------------------------------------
        // Serial port (ISerialPort) — Serial
        // ------------------------------------------------------------------
        case 'serial':
            switch (method) {
                case 'initialize': {
                    // Extract baudRate from the config object if passed
                    const configArg = args[0];
                    if (configArg) {
                        const baudField = getObjectField(configArg, 'baudRate');
                        if (baudField)
                            return `Serial.begin(${renderArg(baudField)})`;
                        return `Serial.begin(${renderArg(configArg)})`;
                    }
                    return `Serial.begin(9600)`;
                }
                case 'deinitialize': return `Serial.end()`;
                case 'print': return `Serial.print(${allArgs()})`;
                case 'println': return `Serial.println(${allArgs()})`;
                case 'printf': return `Serial.printf(${allArgs()})`;
                case 'write': return `Serial.write(${allArgs()})`;
                case 'read': return `Serial.read()`;
                case 'available': return `Serial.available()`;
                case 'availableForWrite': return `Serial.availableForWrite()`;
                case 'flush': return `Serial.flush()`;
                case 'peek': return `Serial.peek()`;
                case 'writeString': return `Serial.print(${a(0)})`;
                case 'writeLine': return `Serial.println(${a(0)})`;
                case 'readString': return `Serial.readString()`;
                case 'readLine': return `Serial.readStringUntil('\\n')`;
                case 'clearRxBuffer': return `while (Serial.available()) Serial.read()`;
                case 'isConnected': return `(bool)Serial`;
                case 'setBaudRate': return `Serial.begin(${a(0)})`;
            }
            break;
        // ------------------------------------------------------------------
        // I2C bus (II2CBus) — I2C0 → Wire
        // ------------------------------------------------------------------
        case 'i2c':
            switch (method) {
                case 'initialize': return `Wire.begin()`;
                case 'deinitialize': return `Wire.end()`;
                case 'setSpeed': return `Wire.setClock(${a(0)})`;
                case 'getSpeed': return `Wire.getClock()`;
                case 'ping': return `Wire_ping(${a(0)})`;
                case 'scan': return `Wire_scan()`;
                case 'write': return `Wire.write(${a(0)})`;
                case 'read': return `Wire.read()`;
                case 'readByte': return `Wire_readByte(${a(0)}, ${a(1)})`;
                case 'writeByte': return `Wire_writeByte(${a(0)}, ${a(1)}, ${a(2)})`;
                case 'readWord': return `Wire_readWord(${a(0)}, ${a(1)})`;
                case 'writeWord': return `Wire_writeWord(${a(0)}, ${a(1)}, ${a(2)})`;
                case 'readRegister': return `Wire_readRegister(${allArgs()})`;
                case 'writeRegister': return `Wire_writeRegister(${allArgs()})`;
            }
            break;
        // ------------------------------------------------------------------
        // SPI bus (ISPIBus) — SPI0 → SPI
        // ------------------------------------------------------------------
        case 'spi':
            switch (method) {
                case 'initialize': return `SPI.begin()`;
                case 'deinitialize': return `SPI.end()`;
                case 'transfer': return `SPI_transfer(${a(0)})`;
                case 'write': return `SPI_write(${a(0)})`;
                case 'read': return `SPI_read(${a(0)})`;
                case 'setFrequency': return `SPI.setClockDivider(${a(0)})`;
                case 'setMode': return `SPI.setDataMode(${a(0)})`;
                case 'setBitOrder': return `SPI.setBitOrder(${a(0)})`;
            }
            break;
    }
    return undefined; // No translation — caller uses fallback rendering
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
function tryRenderTypecodeCallStatement(callee, args, target, renderArg, boardConstants) {
    // Guard removed — caller (ArduinoStrategy) is responsible for gating on target.
    // Parse the callee string into parts separated by "."
    const parts = callee.split('.');
    let receiver;
    let method;
    if (parts.length === 2) {
        // e.g. "D13.high"  "Serial.println"
        [receiver, method] = parts;
    }
    else if (parts.length === 3 && (parts[0] === 'Board' || parts[0] === 'Pins')) {
        // e.g. "Board.A0.read"  "Pins.D13.high"
        [, receiver, method] = parts;
    }
    else {
        return undefined;
    }
    const kind = (0, typecode_symbols_1.inferKindByName)(receiver);
    if (kind === 'unknown')
        return undefined;
    return renderArduinoBuiltin(receiver, kind, method, args, renderArg, boardConstants);
}
//# sourceMappingURL=typecode-map.js.map