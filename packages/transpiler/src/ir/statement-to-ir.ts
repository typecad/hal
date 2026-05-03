import ts from "typescript";
import { Diagnostic, SourceSpan } from "../types";
import { ClassIR, ClassFieldIR, ClassMethodIR, ClassGetterIR, ClassSetterIR, CppType, ExpressionIR, ParameterIR, StatementIR } from "./model";
import { extractNodeComments, makeDiagnostic, makeSourceSpan } from "./ast-node-utils";
import { isCompileTimeOnlyCallName, isCompileTimeOnlyClassName } from "./compile-time-only";
import { CppTypeHint, inferExprCppType, resolveDeclarationType, typeNodeToCppType, extractOwnershipKindFromTypeNode, resolveAliasedTypeNode } from "./type-resolution";
import { escapeCppKeyword } from "../utils/strings";
import { PointerTracker, TYPED_ARRAY_ELEMENT_MAP, registerFieldMap, hoistedNestedFunctions, hoistedNestedClasses, hoistedNestedEnums, hoistedNestedInterfaces, hoistedNestedTypeAliases, nestedFunctionAliases, nestedClassAliases, activeCArrayVars, activeArrayLiteralVars, activeStringVars, mutableArrayVars, arrayLiteralSizes, filteredArrayLengthVars, activeLocalTypes, resetFunctionScopeState, topLevelClassNames, topLevelClasses, requiredIncludes } from "./build-ir-state";
import { calleeToText, renderExprAsText } from "./render-expr";
import { expressionToIR } from "./expression-to-ir";
import { enumDeclarationToIR, interfaceDeclarationToIR, typeAliasDeclarationToIR } from "./declaration-builders";

// ---------------------------------------------------------------------------
// Pin inline evaluator — zero-cost abstraction
//
// When the transpiler encounters Pin method calls (e.g., led.asOutput(HIGH)),
// it evaluates them at compile time and emits the raw Arduino C++ inline,
// erasing the Pin class entirely from the output.
// ---------------------------------------------------------------------------

/** Tracks variable → pin expression (e.g., "led" → "LED_BUILTIN") */
export const pinInstances = new Map<string, string>();

/** Counter for unique printf buffer names */
let printfCounter = 0;

/** Tracks variable → bus name for I2CBus (e.g., "I2C0" → "Wire") */
export const i2cInstances = new Map<string, string>();

/** Tracks variable → port name for SerialPort (e.g., "UART0" → "Serial") */
export const serialInstances = new Map<string, string>();

/** Tracks variable → bus name for SPIBus (e.g., "SPI0" → "SPI") */
export const spiInstances = new Map<string, string>();

/** Tracks variable → name for EEPROMClass (e.g., "EEPROM" → "EEPROM") */
export const eepromInstances = new Map<string, string>();

/** Tracks variable → name for WDTClass (e.g., "WDT" → "WDT") */
export const wdtInstances = new Map<string, string>();

/** Tracks HAL namespace imports (e.g., "Pulse" → "Pulse", "Shift" → "Shift", "Random" → "Random") */
export const halNamespaces = new Map<string, string>();

/** Pin method → inline C++ template */
function inlinePinMethod(
  pinExpr: string,
  method: string,
  args: ExpressionIR[],
): { emitLines: string[]; returnValue?: string } | null {
  // Helper to render an argument as text for C++ interpolation
  const argText = (idx: number): string => {
    const a = args[idx];
    if (!a) return "";
    return renderExprAsText(a);
  };

  switch (method) {
    case "asOutput":
      return {
        emitLines: [
          `pinMode(${pinExpr}, OUTPUT);`,
          `digitalWrite(${pinExpr}, ${argText(0) || "LOW"});`,
        ],
        returnValue: pinExpr,
      };
    case "asInput":
      return { emitLines: [`pinMode(${pinExpr}, INPUT);`], returnValue: pinExpr };
    case "asInputPullUp":
      return { emitLines: [`pinMode(${pinExpr}, INPUT_PULLUP);`], returnValue: pinExpr };
    case "high":
      return { emitLines: [`digitalWrite(${pinExpr}, HIGH);`] };
    case "low":
      return { emitLines: [`digitalWrite(${pinExpr}, LOW);`] };
    case "toggle":
      return { emitLines: [`digitalWrite(${pinExpr}, digitalRead(${pinExpr}) == LOW ? HIGH : LOW);`] };
    case "write":
      return { emitLines: [`digitalWrite(${pinExpr}, ${argText(0)});`] };
    case "read":
      return { emitLines: [], returnValue: `digitalRead(${pinExpr})` };
    case "pulse":
      return {
        emitLines: [
          `digitalWrite(${pinExpr}, HIGH);`,
          `delayMicroseconds(${argText(0)});`,
          `digitalWrite(${pinExpr}, LOW);`,
        ],
      };
    case "tone":
      return { emitLines: [`tone(${pinExpr}, ${argText(0)});`] };
    case "toneFor":
      return { emitLines: [`tone(${pinExpr}, ${argText(0)}, ${argText(1)});`] };
    case "noTone":
      return { emitLines: [`noTone(${pinExpr});`] };
    case "pwm": {
      // If arg is a numeric literal ≤ 100, treat as percentage and pre-compute
      const rawVal = argText(0);
      const numVal = parseInt(rawVal, 10);
      if (!isNaN(numVal) && numVal >= 0 && numVal <= 100 && rawVal === String(numVal)) {
        const pwmVal = Math.round((numVal * 255) / 100);
        return {
          emitLines: [
            `pinMode(${pinExpr}, OUTPUT);`,
            `analogWrite(${pinExpr}, ${pwmVal});`,
          ],
        };
      }
      return {
        emitLines: [
          `pinMode(${pinExpr}, OUTPUT);`,
          `analogWrite(${pinExpr}, ${rawVal || "0"});`,
        ],
      };
    }
    case "output":
      return {
        emitLines: [
          `pinMode(${pinExpr}, OUTPUT);`,
          ...(args.length > 0 ? [`digitalWrite(${pinExpr}, ${argText(0)});`] : []),
        ],
        returnValue: pinExpr,
      };
    case "inputPullUp":
      return { emitLines: [`pinMode(${pinExpr}, INPUT_PULLUP);`], returnValue: pinExpr };
    case "inputPullDown":
      // Not supported on AVR — fall through, let normal transpilation emit the call
      // so diagnostics can catch it later
      return null;
    case "onFalling":
      return { emitLines: [`attachInterrupt(digitalPinToInterrupt(${pinExpr}), /* callback:${argText(0)} */, FALLING);`] };
    case "onRising":
      return { emitLines: [`attachInterrupt(digitalPinToInterrupt(${pinExpr}), /* callback:${argText(0)} */, RISING);`] };
    case "onChange":
      return { emitLines: [`attachInterrupt(digitalPinToInterrupt(${pinExpr}), /* callback:${argText(0)} */, CHANGE);`] };
    case "offAll":
      return { emitLines: [`detachInterrupt(digitalPinToInterrupt(${pinExpr}));`] };
    default:
      return null;
  }
}

/**
 * Check if a CallExpression is a `new Pin(...)` constructor.
 * Returns the pin argument text if so, or null.
 */
function extractPinCtorArg(node: ts.Expression): string | null {
  if (!ts.isNewExpression(node)) return null;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "Pin") return null;
  if (!node.arguments || node.arguments.length === 0) return null;
  const arg = node.arguments[0];
  if (ts.isIdentifier(arg)) return arg.text;
  if (ts.isNumericLiteral(arg)) return arg.text;
  if (ts.isPropertyAccessExpression(arg)) {
    // e.g., LED_BUILTIN — render the full expression
    return arg.getText ? arg.getText() : "";
  }
  return null;
}

/**
 * Resolve a method call receiver to a pin expression.
 * Handles: `new Pin(x).method()`, `pinVar.method()`, `expr.method()`
 * Returns { pinExpr, isChainedCtor } or null.
 */
function resolvePinReceiver(
  receiver: ts.Expression,
): { pinExpr: string; isChainedCtor: boolean } | null {
  // Case 1: `new Pin(x).method()` — method called on constructor result
  const ctorArg = extractPinCtorArg(receiver);
  if (ctorArg !== null) {
    return { pinExpr: ctorArg, isChainedCtor: true };
  }

  // Case 2: `pinVar.method()` — method called on tracked variable or bare name
  if (ts.isIdentifier(receiver)) {
    const tracked = pinInstances.get(receiver.text);
    if (tracked !== undefined) {
      return { pinExpr: tracked, isChainedCtor: false };
    }
    // Bare name fallback: D2→"2", D10→"10", A0→"14", LED→"13"
    const dMatch = receiver.text.match(/^D(\d+)$/);
    if (dMatch) return { pinExpr: dMatch[1], isChainedCtor: false };
    const aMatch = receiver.text.match(/^A(\d+)$/);
    if (aMatch) return { pinExpr: String(14 + parseInt(aMatch[1])), isChainedCtor: false };
    const pinAliases: Record<string, string> = {
      LED: '13', SDA: '18', SCL: '19', MOSI: '11', MISO: '12', SCK: '13', SS: '10', TX: '1', RX: '0',
    };
    if (pinAliases[receiver.text]) return { pinExpr: pinAliases[receiver.text], isChainedCtor: false };
  }

  return null;
}

// ---------------------------------------------------------------------------
// I2CBus inline evaluator — zero-cost abstraction for I2C
// ---------------------------------------------------------------------------

/** I2CBus method → inline C++ template */
function inlineI2CMethod(
  busName: string,
  method: string,
  args: ExpressionIR[],
): { emitLines: string[]; returnValue?: string } | null {
  const argText = (idx: number): string => {
    const a = args[idx];
    if (!a) return "";
    return renderExprAsText(a);
  };

  switch (method) {
    case "begin":
      requiredIncludes.add("<Wire.h>");
      if (args.length > 0) {
        // Slave mode: I2C0.begin(address)
        return { emitLines: [`${busName}.begin(${argText(0)});`] };
      }
      return { emitLines: [`${busName}.begin();`] };
    case "beginSlave":
      return { emitLines: [`${busName}.begin(${argText(0)});`] };
    case "end":
      return { emitLines: [`${busName}.end();`] };
    case "setClock":
      return { emitLines: [`${busName}.setClock(${argText(0)});`] };
    case "beginTransmission":
      return { emitLines: [`${busName}.beginTransmission(${argText(0)});`] };
    case "write":
      return { emitLines: [`${busName}.write(${argText(0)});`] };
    case "endTransmission":
      if (args.length > 0) {
        return { emitLines: [], returnValue: `${busName}.endTransmission(${argText(0)})` };
      }
      return { emitLines: [], returnValue: `${busName}.endTransmission()` };
    case "requestFrom":
      if (args.length >= 3) {
        return { emitLines: [], returnValue: `${busName}.requestFrom(${argText(0)}, ${argText(1)}, ${argText(2)})` };
      }
      return { emitLines: [], returnValue: `${busName}.requestFrom(${argText(0)}, ${argText(1)})` };
    case "available":
      return { emitLines: [], returnValue: `${busName}.available()` };
    case "read":
      return { emitLines: [], returnValue: `${busName}.read()` };
    case "writeByte":
      return {
        emitLines: [
          `${busName}.beginTransmission(${argText(0)});`,
          `${busName}.write(${argText(1)});`,
          `${busName}.write(${argText(2)});`,
          `${busName}.endTransmission();`,
        ],
      };
    default:
      return null;
  }
}

/**
 * Check if a CallExpression is a `new I2CBus("Wire")` constructor.
 * Returns the bus name string literal value if so, or null.
 */
function extractI2CCtorArg(node: ts.Expression): string | null {
  if (!ts.isNewExpression(node)) return null;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "I2CBus") return null;
  if (!node.arguments || node.arguments.length === 0) return null;
  const arg = node.arguments[0];
  if (ts.isStringLiteral(arg)) return arg.text;
  return null;
}

/**
 * Resolve an I2C method call receiver to a bus name.
 * Returns the bus name (e.g., "Wire") or null.
 */
function resolveI2CReceiver(receiver: ts.Expression): string | null {
  // Case 1: `new I2CBus("Wire").method()`
  const ctorArg = extractI2CCtorArg(receiver);
  if (ctorArg !== null) return ctorArg;

  // Case 2: tracked variable
  if (ts.isIdentifier(receiver)) {
    const tracked = i2cInstances.get(receiver.text);
    if (tracked) return tracked;
    // Bare name fallback: I2C0→Wire, I2C1→Wire1
    const i2cMatch = receiver.text.match(/^I2C(\d+)$/);
    if (i2cMatch) return i2cMatch[1] === '0' ? 'Wire' : `Wire${i2cMatch[1]}`;
  }

  return null;
}

/**
 * Detect `<bus>.device(addr).method(args)` pattern from a CallExpression.
 * Returns { busName, addressExpr, method } or null.
 * Arg IRs are computed by the caller.
 */
function resolveI2CDeviceCall(
  call: ts.CallExpression,
): { busName: string; addressExpr: string; method: string } | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const method = call.expression.name.text;
  const deviceCall = call.expression.expression;

  // deviceCall should be `<bus>.device(addr)` — a CallExpression
  if (!ts.isCallExpression(deviceCall)) return null;
  if (!ts.isPropertyAccessExpression(deviceCall.expression)) return null;
  if (deviceCall.expression.name.text !== "device") return null;

  const busReceiver = deviceCall.expression.expression;
  const busName = resolveI2CReceiver(busReceiver);
  if (!busName) return null;

  // Extract address from .device(addr) arguments
  if (!deviceCall.arguments || deviceCall.arguments.length === 0) return null;
  const addrArg = deviceCall.arguments[0];
  if (ts.isNumericLiteral(addrArg)) {
    return { busName, addressExpr: parseInt(addrArg.text).toString(), method };
  }
  return { busName, addressExpr: addrArg.getText(), method };
}

/** I2C Device Accessor method → inline C++ template */
function inlineI2CDeviceMethod(
  busName: string,
  addressExpr: string,
  method: string,
  args: ExpressionIR[],
): { emitLines: string[]; returnValue?: string; varType?: string } | null {
  const argText = (idx: number): string => {
    const a = args[idx];
    if (!a) return "";
    return renderExprAsText(a);
  };

  switch (method) {
    case "writeByte":
      return {
        emitLines: [
          `${busName}.beginTransmission(${addressExpr});`,
          `${busName}.write(${argText(0)});`,
          `${busName}.write(${argText(1)});`,
          `${busName}.endTransmission();`,
        ],
      };
    case "readByte":
      return {
        emitLines: [
          `${busName}.beginTransmission(${addressExpr});`,
          `${busName}.write(${argText(0)});`,
          `${busName}.endTransmission(false);`,
          `${busName}.requestFrom(${addressExpr}, 1);`,
        ],
        returnValue: `${busName}.read()`,
      };
    case "writeBytes": {
      const dataArg = args[1];
      if (dataArg && dataArg.kind === "array" && "elements" in dataArg) {
        const lines = [
          `${busName}.beginTransmission(${addressExpr});`,
          `${busName}.write(${argText(0)});`,
        ];
        for (const elem of (dataArg as { kind: "array"; elements: ExpressionIR[] }).elements) {
          lines.push(`${busName}.write(${renderExprAsText(elem)});`);
        }
        lines.push(`${busName}.endTransmission();`);
        return { emitLines: lines };
      }
      return {
        emitLines: [
          `${busName}.beginTransmission(${addressExpr});`,
          `${busName}.write(${argText(0)});`,
          `${busName}.write(${argText(1)}, sizeof(${argText(1)}));`,
          `${busName}.endTransmission();`,
        ],
      };
    }
    case "readBytes":
      return {
        emitLines: [
          `${busName}.beginTransmission(${addressExpr});`,
          `${busName}.write(${argText(0)});`,
          `${busName}.endTransmission(false);`,
          `${busName}.requestFrom(${addressExpr}, ${argText(1)});`,
        ],
        varType: "uint8_t[]",
      };
    default:
      return null;
  }
}

/** Detect `<bus>.device(cs).method()` SPI device accessor pattern */
function resolveSPIDeviceCall(
  call: ts.CallExpression,
): { busName: string; csExpr: string; method: string } | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const method = call.expression.name.text;
  const deviceCall = call.expression.expression;

  // deviceCall should be `<bus>.device(cs)` — a CallExpression
  if (!ts.isCallExpression(deviceCall)) return null;
  if (!ts.isPropertyAccessExpression(deviceCall.expression)) return null;
  if (deviceCall.expression.name.text !== "device") return null;

  const busReceiver = deviceCall.expression.expression;
  const busName = resolveSPIReceiver(busReceiver);
  if (!busName) return null;

  // Extract chip-select from .device(cs) arguments — must resolve to a pin
  if (!deviceCall.arguments || deviceCall.arguments.length === 0) return null;
  const csArg = deviceCall.arguments[0];
  if (ts.isIdentifier(csArg)) {
    const resolved = resolvePinReceiver(csArg);
    if (resolved) return { busName, csExpr: resolved.pinExpr, method };
  }
  return null;
}

/** Extract array elements from an ExpressionIR if it represents a literal array or new Uint8Array([...]). */
function extractArrayElements(arg: ExpressionIR): ExpressionIR[] | null {
  if (!arg) return null;
  if (arg.kind === "array" && "elements" in arg) {
    return (arg as { kind: "array"; elements: ExpressionIR[] }).elements;
  }
  return null;
}

/** SPI Device method → inline C++ template */
function inlineSPIDeviceMethod(
  busName: string,
  csExpr: string,
  method: string,
  args: ExpressionIR[],
): { emitLines: string[]; returnValue?: string } | null {
  const argText = (idx: number): string => {
    const a = args[idx];
    if (!a) return "";
    return renderExprAsText(a);
  };

  switch (method) {
    case "transfer": {
      const dataArg = args[0];
      // Array/Uint8Array argument → expand to individual transfers
      const elements = extractArrayElements(dataArg);
      if (elements) {
        const lines = [`digitalWrite(${csExpr}, LOW);`];
        for (const elem of elements) {
          lines.push(`${busName}.transfer(${renderExprAsText(elem)});`);
        }
        lines.push(`digitalWrite(${csExpr}, HIGH);`);
        return { emitLines: lines };
      }
      return {
        emitLines: [
          `digitalWrite(${csExpr}, LOW);`,
          `${busName}.transfer(${argText(0)});`,
          `digitalWrite(${csExpr}, HIGH);`,
        ],
        returnValue: `${busName}.transfer(${argText(0)})`,
      };
    }
    case "write": {
      const dataArg = args[0];
      const elements = extractArrayElements(dataArg);
      if (elements) {
        const lines = [`digitalWrite(${csExpr}, LOW);`];
        for (const elem of elements) {
          lines.push(`${busName}.transfer(${renderExprAsText(elem)});`);
        }
        lines.push(`digitalWrite(${csExpr}, HIGH);`);
        return { emitLines: lines };
      }
      return {
        emitLines: [
          `digitalWrite(${csExpr}, LOW);`,
          `${busName}.transfer(${argText(0)});`,
          `digitalWrite(${csExpr}, HIGH);`,
        ],
      };
    }
    default:
      return null;
  }
}

/** SerialPort method → inline C++ template */
function inlineSerialMethod(
  portName: string,
  method: string,
  args: ExpressionIR[],
): { emitLines: string[]; returnValue?: string } | null {
  const argText = (idx: number): string => {
    const a = args[idx];
    if (!a) return "";
    return renderExprAsText(a);
  };
  const allArgs = (): string => args.map(a => renderExprAsText(a)).join(", ");

  switch (method) {
    case "begin":
      return { emitLines: [`${portName}.begin(${argText(0) || "9600"});`] };
    case "end":
      return { emitLines: [`${portName}.end();`] };
    case "print":
      return { emitLines: [`${portName}.print(${allArgs()});`] };
    case "println":
      return { emitLines: [`${portName}.println(${allArgs()});`] };
    case "write":
      return { emitLines: [`${portName}.write(${allArgs()});`] };
    case "flush":
      return { emitLines: [`${portName}.flush();`] };
    case "available":
      return { emitLines: [], returnValue: `${portName}.available()` };
    case "read":
      return { emitLines: [], returnValue: `${portName}.read()` };
    case "peek":
      return { emitLines: [], returnValue: `${portName}.peek()` };
    case "printf": {
      // snprintf lowering: Serial.printf("fmt", args) → char buf[16]; snprintf(buf, sizeof(buf), "fmt", args); Serial.print(buf);
      if (args.length === 0) return null;
      const fmtText = argText(0);
      const restArgs = args.slice(1).map(a => renderExprAsText(a)).join(", ");
      const bufName = `__typehal_printf_${++printfCounter}`;
      return {
        emitLines: [
          `char ${bufName}[16];`,
          `snprintf(${bufName}, sizeof(${bufName}), ${fmtText}${restArgs ? ", " + restArgs : ""});`,
          `${portName}.print(${bufName});`,
        ],
      };
    }
    default:
      return null;
  }
}

/**
 * Check if a CallExpression is a `new SerialPort("Serial")` constructor.
 * Returns the port name string literal value if so, or null.
 */
function extractSerialCtorArg(node: ts.Expression): string | null {
  if (!ts.isNewExpression(node)) return null;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "SerialPort") return null;
  if (!node.arguments || node.arguments.length === 0) return null;
  const arg = node.arguments[0];
  if (ts.isStringLiteral(arg)) return arg.text;
  return null;
}

/**
 * Resolve a SerialPort method call receiver to a port name.
 * Returns the port name (e.g., "Serial") or null.
 */
function resolveSerialReceiver(receiver: ts.Expression): string | null {
  // Case 1: `new SerialPort("Serial").method()`
  const ctorArg = extractSerialCtorArg(receiver);
  if (ctorArg !== null) return ctorArg;

  // Case 2: tracked variable
  if (ts.isIdentifier(receiver)) {
    const tracked = serialInstances.get(receiver.text);
    if (tracked) return tracked;
    // Bare name fallback: UART0→Serial, UART1→Serial1, etc.
    const uartMatch = receiver.text.match(/^UART(\d+)$/);
    if (uartMatch) return uartMatch[1] === '0' ? 'Serial' : `Serial${uartMatch[1]}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// SPIBus inline evaluator — zero-cost abstraction for SPI
// ---------------------------------------------------------------------------

/** SPIBus method → inline C++ template */
function inlineSPIMethod(
  busName: string,
  method: string,
  args: ExpressionIR[],
): { emitLines: string[]; returnValue?: string } | null {
  const argText = (idx: number): string => {
    const a = args[idx];
    if (!a) return "";
    return renderExprAsText(a);
  };

  switch (method) {
    case "begin":
      requiredIncludes.add("<SPI.h>");
      return { emitLines: [`${busName}.begin();`] };
    case "end":
      return { emitLines: [`${busName}.end();`] };
    case "transfer":
      return { emitLines: [], returnValue: `${busName}.transfer(${argText(0)})` };
    case "setFrequency":
      return { emitLines: [`${busName}.beginTransaction(SPISettings(${argText(0)}, MSBFIRST, SPI_MODE0));`] };
    case "beginTransaction":
      // beginTransaction(SPISettings(...)) — pass through the arg as-is
      return { emitLines: [`${busName}.beginTransaction(${argText(0)});`] };
    case "endTransaction":
      return { emitLines: [`${busName}.endTransaction();`] };
    case "setMode":
      return { emitLines: [`${busName}.setDataMode(${argText(0)});`] };
    case "setBitOrder":
      // SPIBitOrder.MSB → MSBFIRST (render the expression; the test accepts several forms)
      return { emitLines: [`${busName}.setBitOrder(${argText(0)});`] };
    case "write":
      // write() is transfer() ignoring return
      return { emitLines: [`${busName}.transfer(${argText(0)});`] };
    case "write16":
      return { emitLines: [`${busName}.transfer16(${argText(0)});`] };
    default:
      return null;
  }
}

/**
 * Check if a CallExpression is a `new SPIBus("SPI")` constructor.
 * Returns the bus name string literal value if so, or null.
 */
function extractSPICtorArg(node: ts.Expression): string | null {
  if (!ts.isNewExpression(node)) return null;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "SPIBus") return null;
  if (!node.arguments || node.arguments.length === 0) return null;
  const arg = node.arguments[0];
  if (ts.isStringLiteral(arg)) return arg.text;
  return null;
}

/**
 * Resolve an SPI method call receiver to a bus name.
 * Returns the bus name (e.g., "SPI") or null.
 */
function resolveSPIReceiver(receiver: ts.Expression): string | null {
  // Case 1: `new SPIBus("SPI").method()`
  const ctorArg = extractSPICtorArg(receiver);
  if (ctorArg !== null) return ctorArg;

  // Case 2: tracked variable
  if (ts.isIdentifier(receiver)) {
    const tracked = spiInstances.get(receiver.text);
    if (tracked) return tracked;
    // Bare name fallback: SPI0→SPI, SPI1→SPI1
    const spiMatch = receiver.text.match(/^SPI(\d+)$/);
    if (spiMatch) return spiMatch[1] === '0' ? 'SPI' : `SPI${spiMatch[1]}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// EEPROMClass inline evaluator — zero-cost abstraction for EEPROM
// ---------------------------------------------------------------------------

function inlineEEPROMMethod(
  name: string,
  method: string,
  args: ExpressionIR[],
): { emitLines: string[]; returnValue?: string } | null {
  const argText = (idx: number): string => {
    const a = args[idx];
    if (!a) return "";
    return renderExprAsText(a);
  };

  switch (method) {
    case "write":
      return { emitLines: [`${name}.write(${argText(0)}, ${argText(1)});`] };
    case "update":
      return { emitLines: [`${name}.update(${argText(0)}, ${argText(1)});`] };
    case "put":
      return { emitLines: [`${name}.put(${argText(0)}, ${argText(1)});`] };
    case "read":
      return { emitLines: [], returnValue: `${name}.read(${argText(0)})` };
    case "length":
      return { emitLines: [], returnValue: `${name}.length()` };
    default:
      return null;
  }
}

function extractEEPROMCtorArg(node: ts.Expression): string | null {
  if (!ts.isNewExpression(node)) return null;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "EEPROMClass") return null;
  if (!node.arguments || node.arguments.length === 0) return null;
  const arg = node.arguments[0];
  if (ts.isStringLiteral(arg)) return arg.text;
  return null;
}

function resolveEEPROMReceiver(receiver: ts.Expression): string | null {
  const ctorArg = extractEEPROMCtorArg(receiver);
  if (ctorArg !== null) return ctorArg;
  if (ts.isIdentifier(receiver)) {
    return eepromInstances.get(receiver.text) ?? (receiver.text === "EEPROM" ? "EEPROM" : null);
  }
  return null;
}

// ---------------------------------------------------------------------------
// WDTClass inline evaluator — zero-cost abstraction for WDT
// ---------------------------------------------------------------------------

function inlineWDTMethod(
  name: string,
  method: string,
  args: ExpressionIR[],
): { emitLines: string[]; returnValue?: string } | null {
  const argText = (idx: number): string => {
    const a = args[idx];
    if (!a) return "";
    return renderExprAsText(a);
  };

  // WDT emits wdt_* functions directly (not name.method())
  // Map timeout strings to WDTO constants
  const wdtTimeoutMap: Record<string, string> = {
    "15ms": "WDTO_15MS",
    "30ms": "WDTO_30MS",
    "60ms": "WDTO_60MS",
    "120ms": "WDTO_120MS",
    "250ms": "WDTO_250MS",
    "500ms": "WDTO_500MS",
    "1s": "WDTO_1S",
    "2s": "WDTO_2S",
    "4s": "WDTO_4S",
    "8s": "WDTO_8S",
  };

  switch (method) {
    case "enable": {
      const timeoutStr = argText(0).replace(/^"|"$/g, ''); // strip quotes
      const wdtoConst = wdtTimeoutMap[timeoutStr] || "WDTO_2S";
      return { emitLines: [`wdt_enable(${wdtoConst});`] };
    }
    case "reset":
      return { emitLines: [`wdt_reset();`] };
    case "disable":
      return { emitLines: [`wdt_disable();`] };
    default:
      return null;
  }
}

function extractWDTCtorArg(node: ts.Expression): string | null {
  if (!ts.isNewExpression(node)) return null;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "WDTClass") return null;
  // WDTClass has no constructor args, but we need to detect it
  return "WDT";
}

function resolveWDTReceiver(receiver: ts.Expression): string | null {
  const ctorArg = extractWDTCtorArg(receiver);
  if (ctorArg !== null) return ctorArg;
  if (ts.isIdentifier(receiver)) {
    return wdtInstances.get(receiver.text) ?? (receiver.text === "WDT" ? "WDT" : null);
  }
  return null;
}

// ---------------------------------------------------------------------------
// HAL namespace inline evaluators (Pulse, Shift, Random)
// ---------------------------------------------------------------------------

function inlineHALNamespaceMethod(
  namespace: string,
  method: string,
  args: ExpressionIR[],
): { emitLines: string[]; returnValue?: string } | null {
  const argText = (idx: number): string => {
    const a = args[idx];
    if (!a) return "";
    return renderExprAsText(a);
  };

  // Resolve pin argument: if it's a tracked pin, use the pin number
  const resolvePinArg = (idx: number): string => {
    const text = argText(idx);
    const resolved = pinInstances.get(text);
    return resolved ?? text;
  };

  // Resolve boolean argument: true→HIGH, false→LOW
  const resolveBoolArg = (idx: number): string => {
    const text = argText(idx);
    if (text === "true") return "HIGH";
    if (text === "false") return "LOW";
    return text;
  };

  switch (namespace) {
    case "Pulse": {
      switch (method) {
        case "in": {
          const pin = resolvePinArg(0);
          const level = resolveBoolArg(1);
          const timeout = argText(2);
          const call = timeout
            ? `pulseIn(${pin}, ${level}, ${timeout})`
            : `pulseIn(${pin}, ${level})`;
          return { emitLines: [], returnValue: call };
        }
        case "long":
        case "long_": {
          const pin = resolvePinArg(0);
          const level = resolveBoolArg(1);
          const timeout = argText(2);
          const call = timeout
            ? `pulseInLong(${pin}, ${level}, ${timeout})`
            : `pulseInLong(${pin}, ${level})`;
          return { emitLines: [], returnValue: call };
        }
        default:
          return null;
      }
    }
    case "Shift": {
      switch (method) {
        case "in": {
          const dataPin = resolvePinArg(0);
          const clockPin = resolvePinArg(1);
          const bitOrder = argText(2);
          return { emitLines: [], returnValue: `shiftIn(${dataPin}, ${clockPin}, ${bitOrder})` };
        }
        case "out": {
          const dataPin = resolvePinArg(0);
          const clockPin = resolvePinArg(1);
          const bitOrder = argText(2);
          const value = argText(3);
          return { emitLines: [`shiftOut(${dataPin}, ${clockPin}, ${bitOrder}, ${value});`] };
        }
        default:
          return null;
      }
    }
    case "Random": {
      switch (method) {
        case "seed":
          return { emitLines: [`randomSeed(${argText(0)});`] };
        case "number": {
          const min = argText(0);
          const max = argText(1);
          if (max) {
            return { emitLines: [], returnValue: `random(${min}, ${max})` };
          }
          return { emitLines: [], returnValue: `random(${min})` };
        }
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Generic HAL inline evaluator dispatcher
// ---------------------------------------------------------------------------

/**
 * Try to resolve a HAL method call and return both emitLines and returnValue.
 * Used by variableStatementToIR to produce correct initializers for variables
 * like `const count = I2C0.requestFrom(0x76, 4)`.
 */
function resolveHALCallForVarInit(
  call: ts.CallExpression,
  sourceText: string,
  diagnostics: Diagnostic[],
  pointerVars: PointerTracker,
): { emitLines: string[]; returnValue?: string; halName?: string } | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;

  const method = call.expression.name.text;
  const receiver = call.expression.expression;
  const argIRs = call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars));

  const tryResolve = (
    resolveFn: () => string | null,
    inlineFn: (name: string, m: string, a: ExpressionIR[]) => { emitLines: string[]; returnValue?: string } | null,
  ): { emitLines: string[]; returnValue?: string; halName?: string } | null => {
    const name = resolveFn();
    if (!name) return null;
    const inlined = inlineFn(name, method, argIRs);
    if (!inlined) return null;
    return { emitLines: inlined.emitLines, returnValue: inlined.returnValue, halName: name };
  };

  // Try Pin
  const pinResult = tryResolve(
    () => { const r = resolvePinReceiver(receiver); return r ? r.pinExpr : null; },
    (n, m, a) => inlinePinMethod(n, m, a),
  );
  if (pinResult) return pinResult;

  // Try I2CBus
  const i2cResult = tryResolve(
    () => resolveI2CReceiver(receiver),
    (n, m, a) => inlineI2CMethod(n, m, a),
  );
  if (i2cResult) return i2cResult;

  // Try I2C Device Accessor (<bus>.device(addr).method())
  const deviceCall = resolveI2CDeviceCall(call);
  if (deviceCall) {
    const inlined = inlineI2CDeviceMethod(deviceCall.busName, deviceCall.addressExpr, deviceCall.method, argIRs);
    if (inlined) {
      return { emitLines: inlined.emitLines, returnValue: inlined.returnValue, halName: deviceCall.busName };
    }
  }

  // Try SerialPort
  const serialResult = tryResolve(
    () => resolveSerialReceiver(receiver),
    (n, m, a) => inlineSerialMethod(n, m, a),
  );
  if (serialResult) return serialResult;

  // Try SPIBus
  const spiResult = tryResolve(
    () => resolveSPIReceiver(receiver),
    (n, m, a) => inlineSPIMethod(n, m, a),
  );
  if (spiResult) return spiResult;

  // Try SPI Device Accessor (<bus>.device(cs).method())
  const spiDeviceCall = resolveSPIDeviceCall(call);
  if (spiDeviceCall) {
    const inlined = inlineSPIDeviceMethod(spiDeviceCall.busName, spiDeviceCall.csExpr, spiDeviceCall.method, argIRs);
    if (inlined) {
      return { emitLines: inlined.emitLines, returnValue: inlined.returnValue, halName: spiDeviceCall.busName };
    }
  }

  // Try EEPROMClass
  const eepromResult = tryResolve(
    () => resolveEEPROMReceiver(receiver),
    (n, m, a) => inlineEEPROMMethod(n, m, a),
  );
  if (eepromResult) return eepromResult;

  // Try WDTClass
  const wdtResult = tryResolve(
    () => resolveWDTReceiver(receiver),
    (n, m, a) => inlineWDTMethod(n, m, a),
  );
  if (wdtResult) return wdtResult;

  return null;
}

/**
 * Try to inline a HAL method call (Pin, I2CBus, SerialPort, SPIBus, EEPROMClass, WDTClass).
 * Returns emit IR statements if inlined, or null if not a HAL call.
 */
function tryInlineHALMethod(
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  pointerVars: PointerTracker,
): StatementIR | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;

  const method = call.expression.name.text;
  const receiver = call.expression.expression;
  const argIRs = call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars));

  const tryInline = (
    resolveFn: () => string | null,
    inlineFn: (name: string, m: string, a: ExpressionIR[]) => { emitLines: string[]; returnValue?: string } | null,
  ): StatementIR | null => {
    const name = resolveFn();
    if (!name) return null;
    const inlined = inlineFn(name, method, argIRs);
    if (!inlined) return null;
    if (inlined.emitLines.length > 0) return emitLinesToIR(inlined.emitLines, call, fileName, sourceText);
    // Methods with only returnValue (e.g., available(), read()) — emit as standalone expression statement
    if (inlined.returnValue) {
      return emitLinesToIR([`${inlined.returnValue};`], call, fileName, sourceText);
    }
    return null;
  };

  // Try Pin ISR methods (need structured call IR with callback, not __EMIT__)
  if (method === "onFalling" || method === "onRising" || method === "onChange") {
    const pinResolved = resolvePinReceiver(receiver);
    if (pinResolved) {
      const mode = method === "onFalling" ? "FALLING" : method === "onRising" ? "RISING" : "CHANGE";
      const callbackArg = argIRs[0];
      if (callbackArg && callbackArg.kind === "callback") {
        return {
          kind: "call",
          sourceSpan: makeSourceSpan(call, fileName, sourceText),
          callee: "attachInterrupt",
          args: [
            { kind: "raw", value: `digitalPinToInterrupt(${pinResolved.pinExpr})` } as ExpressionIR,
            { ...callbackArg, isInterruptHandler: true } as ExpressionIR,
            { kind: "raw", value: mode } as ExpressionIR,
          ],
        };
      }
    }
  }

  // Try Pin
  const pinResult = tryInline(
    () => { const r = resolvePinReceiver(receiver); return r ? r.pinExpr : null; },
    (n, m, a) => inlinePinMethod(n, m, a),
  );
  if (pinResult) return pinResult;

  // Try I2CBus
  const i2cResult = tryInline(
    () => resolveI2CReceiver(receiver),
    (n, m, a) => inlineI2CMethod(n, m, a),
  );
  if (i2cResult) return i2cResult;

  // Try I2C Device Accessor (<bus>.device(addr).method())
  const deviceCall = resolveI2CDeviceCall(call);
  if (deviceCall) {
    const inlined = inlineI2CDeviceMethod(deviceCall.busName, deviceCall.addressExpr, deviceCall.method, argIRs);
    if (inlined) {
      if (inlined.emitLines.length > 0) return emitLinesToIR(inlined.emitLines, call, fileName, sourceText);
      if (inlined.returnValue) return emitLinesToIR([`${inlined.returnValue};`], call, fileName, sourceText);
    }
  }

  // Try SerialPort — but handle print/println with string_concat specially
  // to enable snprintf lowering in the emitter
  const serialName = resolveSerialReceiver(receiver);
  if (serialName) {
    const hasStringConcat = argIRs.some(a => a.kind === "string_concat" || a.kind === "template_string");
    if ((method === "print" || method === "println") && hasStringConcat) {
      // Emit as a regular call with serial alias, preserving string_concat IR
      // The emitter's snprintf detection will handle the string_concat arg
      const comments = extractNodeComments(call.parent && ts.isExpressionStatement(call.parent) ? call.parent as ts.ExpressionStatement : call as any, sourceText);
      return {
        kind: "call",
        sourceSpan: makeSourceSpan(call, fileName, sourceText),
        leadingComments: [],
        trailingComments: [],
        callee: `${serialName}.${method}`,
        args: argIRs,
      };
    }
    const inlined = inlineSerialMethod(serialName, method, argIRs);
    if (inlined) {
      if (inlined.emitLines.length > 0) return emitLinesToIR(inlined.emitLines, call, fileName, sourceText);
      if (inlined.returnValue) return emitLinesToIR([`${inlined.returnValue};`], call, fileName, sourceText);
    }
  }

  // Try SPIBus
  const spiResult = tryInline(
    () => resolveSPIReceiver(receiver),
    (n, m, a) => inlineSPIMethod(n, m, a),
  );
  if (spiResult) return spiResult;

  // Try SPI Device Accessor (<bus>.device(cs).method())
  const spiDeviceCall = resolveSPIDeviceCall(call);
  if (spiDeviceCall) {
    const inlined = inlineSPIDeviceMethod(spiDeviceCall.busName, spiDeviceCall.csExpr, spiDeviceCall.method, argIRs);
    if (inlined) {
      if (inlined.emitLines.length > 0) return emitLinesToIR(inlined.emitLines, call, fileName, sourceText);
      if (inlined.returnValue) return emitLinesToIR([`${inlined.returnValue};`], call, fileName, sourceText);
    }
  }

  // Try EEPROMClass
  const eepromResult = tryInline(
    () => resolveEEPROMReceiver(receiver),
    (n, m, a) => inlineEEPROMMethod(n, m, a),
  );
  if (eepromResult) return eepromResult;

  // Try WDTClass
  const wdtResult = tryInline(
    () => resolveWDTReceiver(receiver),
    (n, m, a) => inlineWDTMethod(n, m, a),
  );
  if (wdtResult) return wdtResult;

  // Try HAL namespace (Pulse, Shift, Random)
  if (ts.isIdentifier(receiver)) {
    const nsType = halNamespaces.get(receiver.text);
    if (nsType) {
      const inlined = inlineHALNamespaceMethod(nsType, method, argIRs);
      if (inlined) {
        if (inlined.emitLines.length > 0) return emitLinesToIR(inlined.emitLines, call, fileName, sourceText);
        if (inlined.returnValue) return emitLinesToIR([`${inlined.returnValue};`], call, fileName, sourceText);
      }
    }
  }

  return null;
}

/**
 * Try to inline a HAL expression call for use inside expression contexts
 * (e.g., variable initializers, template literals).
 * Returns a raw string ExpressionIR if inlined, or null if not a HAL call.
 * Side effects (emitLines) are accumulated and returned separately.
 */
export function tryInlineHALExpression(
  call: ts.CallExpression,
  sourceText: string,
  diagnostics: Diagnostic[],
  pointerVars: PointerTracker,
): { ir: ExpressionIR; sideEffects: string[] } | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;

  const method = call.expression.name.text;
  const receiver = call.expression.expression;
  const argIRs = call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars));

  // Helper to try inline and extract returnValue
  const tryExpr = (
    resolveFn: () => string | null,
    inlineFn: (name: string, m: string, a: ExpressionIR[]) => { emitLines: string[]; returnValue?: string } | null,
  ): { ir: ExpressionIR; sideEffects: string[] } | null => {
    const name = resolveFn();
    if (!name) return null;
    const inlined = inlineFn(name, method, argIRs);
    if (!inlined) return null;
    if (inlined.returnValue) {
      return { ir: { kind: "raw", value: inlined.returnValue }, sideEffects: inlined.emitLines };
    }
    if (inlined.emitLines.length > 0) {
      return { ir: { kind: "raw", value: "0" }, sideEffects: inlined.emitLines };
    }
    return null;
  };

  // Try Pin
  const pinResult = tryExpr(
    () => { const r = resolvePinReceiver(receiver); return r ? r.pinExpr : null; },
    (n, m, a) => inlinePinMethod(n, m, a),
  );
  if (pinResult) return pinResult;

  // Try I2CBus
  const i2cResult = tryExpr(
    () => resolveI2CReceiver(receiver),
    (n, m, a) => inlineI2CMethod(n, m, a),
  );
  if (i2cResult) return i2cResult;

  // Try I2C Device Accessor
  const deviceCall = resolveI2CDeviceCall(call);
  if (deviceCall) {
    const inlined = inlineI2CDeviceMethod(deviceCall.busName, deviceCall.addressExpr, deviceCall.method, argIRs);
    if (inlined) {
      if (inlined.returnValue) {
        return { ir: { kind: "raw", value: inlined.returnValue }, sideEffects: inlined.emitLines };
      }
      if (inlined.emitLines.length > 0) {
        return { ir: { kind: "raw", value: "0" }, sideEffects: inlined.emitLines };
      }
    }
  }

  // Try SerialPort
  const serialResult = tryExpr(
    () => resolveSerialReceiver(receiver),
    (n, m, a) => inlineSerialMethod(n, m, a),
  );
  if (serialResult) return serialResult;

  // Try SPIBus
  const spiResult = tryExpr(
    () => resolveSPIReceiver(receiver),
    (n, m, a) => inlineSPIMethod(n, m, a),
  );
  if (spiResult) return spiResult;

  // Try SPI Device Accessor
  const spiDeviceCall = resolveSPIDeviceCall(call);
  if (spiDeviceCall) {
    const inlined = inlineSPIDeviceMethod(spiDeviceCall.busName, spiDeviceCall.csExpr, spiDeviceCall.method, argIRs);
    if (inlined) {
      if (inlined.returnValue) {
        return { ir: { kind: "raw", value: inlined.returnValue }, sideEffects: inlined.emitLines };
      }
      if (inlined.emitLines.length > 0) {
        return { ir: { kind: "raw", value: "0" }, sideEffects: inlined.emitLines };
      }
    }
  }

  // Try EEPROMClass
  const eepromResult = tryExpr(
    () => resolveEEPROMReceiver(receiver),
    (n, m, a) => inlineEEPROMMethod(n, m, a),
  );
  if (eepromResult) return eepromResult;

  // Try WDTClass — WDT methods are void (side effects only), not typically used in expressions

  // Try HAL namespace (Pulse, Shift, Random)
  if (ts.isIdentifier(receiver)) {
    const nsType = halNamespaces.get(receiver.text);
    if (nsType) {
      const inlined = inlineHALNamespaceMethod(nsType, method, argIRs);
      if (inlined) {
        if (inlined.returnValue) {
          return { ir: { kind: "raw", value: inlined.returnValue }, sideEffects: inlined.emitLines };
        }
      }
    }
  }

  return null;
}

/** Convert emit lines to a StatementIR (single emit or block of emits). */
function emitLinesToIR(
  lines: string[],
  node: ts.Node,
  fileName: string,
  sourceText: string,
): StatementIR | null {
  if (lines.length === 0) return null;
  const emitStmts: StatementIR[] = lines.map(line => ({
    kind: "call" as const,
    sourceSpan: makeSourceSpan(node, fileName, sourceText),
    callee: "__EMIT__",
    args: [{ kind: "string" as const, value: line }],
  }));
  return emitStmts.length === 1
    ? emitStmts[0]
    : { kind: "block" as const, body: emitStmts, sourceSpan: makeSourceSpan(node, fileName, sourceText) };
}

function callToStatement(
  statementNode: ts.ExpressionStatement,
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  pointerVars: PointerTracker = new Map(),
): StatementIR {
  const comments = extractNodeComments(statementNode, sourceText);

  // ---- HAL inline evaluator (highest priority: Pin, I2CBus, SerialPort) ---
  const inlined = tryInlineHALMethod(call, fileName, sourceText, diagnostics, pointerVars);
  if (inlined) return inlined;


  // ── emit() — compile-time C++ injection ─────────────────────────────────
  if (ts.isIdentifier(call.expression) && call.expression.text === "emit") {
    return {
      kind: "call",
      sourceSpan: makeSourceSpan(call, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      callee: "__EMIT__",
      args: call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
    };
  }

  // ── include() — compile-time C++ header registration ─────────────────────
  if (ts.isIdentifier(call.expression) && call.expression.text === "include") {
    const firstArg = call.arguments[0];
    if (firstArg && ts.isStringLiteral(firstArg)) {
      requiredIncludes.add(firstArg.text);
    }
    // Emit nothing in C++ — return empty block
    return {
      kind: "block",
      sourceSpan: makeSourceSpan(call, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      body: [],
    };
  }

  // ── Array method translation: push → push_back, pop → pop_back ──────────
  if (ts.isPropertyAccessExpression(call.expression)) {
    const methodName = call.expression.name.text;
    const objExpr = call.expression.expression;
    if (ts.isIdentifier(objExpr) && mutableArrayVars.has(objExpr.text)) {
      if (methodName === "push") {
        return {
          kind: "call",
          sourceSpan: makeSourceSpan(call, fileName, sourceText),
          leadingComments: comments.leadingComments,
          trailingComments: comments.trailingComments,
          callee: `${objExpr.text}.push_back`,
          args: call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
        };
      }
      if (methodName === "pop") {
        return {
          kind: "call",
          sourceSpan: makeSourceSpan(call, fileName, sourceText),
          leadingComments: comments.leadingComments,
          trailingComments: comments.trailingComments,
          callee: `${objExpr.text}.pop_back`,
          args: [],
        };
      }
    }
  }

  // Format callee, using -> for pointer variables
  let calleeText: string;
  if (ts.isPropertyAccessExpression(call.expression)) {
    const objExpr = call.expression.expression;
    const methodName = escapeCppKeyword(call.expression.name.text);
    if (ts.isIdentifier(objExpr) && pointerVars.has(objExpr.text)) {
      calleeText = `${objExpr.text}->${methodName}`;
    } else if (ts.isCallExpression(objExpr) && ts.isPropertyAccessExpression(objExpr.expression)) {
      // Chained method call: obj.method1().method2()
      const innerReceiver = objExpr.expression.expression;
      const innerMethodName = objExpr.expression.name.text;
      const innerCallText = renderExprAsText(expressionToIR(objExpr, sourceText, diagnostics, pointerVars));
      let accessor = ".";
      if (ts.isIdentifier(innerReceiver) && pointerVars.has(innerReceiver.text)) {
        let className = pointerVars.get(innerReceiver.text);
        if (className) className = nestedClassAliases.get(className) ?? className;
        const cls = className ? hoistedNestedClasses.find(c => c.name === className) : undefined;
        const method = cls?.methods.find(m => m.name === innerMethodName);
        if (method && (method.returnType as string).endsWith("*")) {
          accessor = "->";
        }
      } else if (ts.isIdentifier(innerReceiver) && topLevelClassNames.has(innerReceiver.text)) {
        // Static method call on a top-level or cross-module class returning an instance
        const cls = topLevelClasses.get(innerReceiver.text);
        if (!cls) {
          // Cross-module class: factory methods typically return class instances (pointers)
          accessor = "->";
        } else {
          const chainMethod = cls.methods.find(m => m.name === innerMethodName);
          if (chainMethod && ((chainMethod.returnType as string).endsWith("*") || (chainMethod.returnType as string) === innerReceiver.text)) {
            accessor = "->";
          }
        }
      }
      calleeText = `${innerCallText}${accessor}${methodName}`;
    } else {
      calleeText = calleeToText(call.expression);
    }
  } else {
    calleeText = calleeToText(call.expression);
  }
  
  return {
    kind: "call",
    sourceSpan: makeSourceSpan(call, fileName, sourceText),
    leadingComments: comments.leadingComments,
    trailingComments: comments.trailingComments,
    callee: calleeText,
    args: call.arguments.map((arg) => expressionToIR(arg, sourceText, diagnostics, pointerVars)),
  };
}

function assignmentOperatorToString(kind: ts.SyntaxKind): Extract<StatementIR, { kind: "assign" }>['operator'] | undefined {
  switch (kind) {
    case ts.SyntaxKind.EqualsToken:
      return "=";
    case ts.SyntaxKind.PlusEqualsToken:
      return "+=";
    case ts.SyntaxKind.MinusEqualsToken:
      return "-=";
    case ts.SyntaxKind.AsteriskEqualsToken:
      return "*=";
    case ts.SyntaxKind.SlashEqualsToken:
      return "/=";
    case ts.SyntaxKind.PercentEqualsToken:
      return "%=";
    case ts.SyntaxKind.AmpersandEqualsToken:
      return "&=";
    case ts.SyntaxKind.BarEqualsToken:
      return "|=";
    case ts.SyntaxKind.CaretEqualsToken:
      return "^=";
    case ts.SyntaxKind.LessThanLessThanEqualsToken:
      return "<<=";
    case ts.SyntaxKind.GreaterThanGreaterThanEqualsToken:
      return ">>=";
    default:
      return undefined;
  }
}

function updateLocalTypeFromAssignment(
  target: string,
  operator: Extract<StatementIR, { kind: "assign" }>['operator'],
  valueType: CppTypeHint,
  localVariableTypes: Map<string, CppTypeHint>,
): void {
  const currentType = localVariableTypes.get(target) ?? "auto";

  if (operator === "=") {
    localVariableTypes.set(target, valueType);
    return;
  }

  if (valueType === "float" || currentType === "float") {
    localVariableTypes.set(target, "float");
    return;
  }

  if (valueType === "int" || currentType === "int" || valueType === "bool" || currentType === "bool") {
    localVariableTypes.set(target, "int");
    return;
  }

  localVariableTypes.set(target, currentType);
}

function extractForInKeys(expr: ts.Expression): string[] | undefined {
  if (ts.isObjectLiteralExpression(expr)) {
    return expr.properties
      .filter(ts.isPropertyAssignment)
      .map(p => (ts.isIdentifier(p.name) ? p.name.text : p.name.getText()));
  }
  if (ts.isIdentifier(expr)) {
    const varName = expr.text;
    let parent: ts.Node | undefined = expr.parent;
    while (parent && !ts.isBlock(parent) && !ts.isSourceFile(parent)) {
      parent = parent.parent;
    }
    if (parent && (ts.isBlock(parent) || ts.isSourceFile(parent))) {
      for (const stmt of parent.statements) {
        if (ts.isVariableStatement(stmt)) {
          for (const decl of stmt.declarationList.declarations) {
            if (ts.isIdentifier(decl.name) && decl.name.text === varName && decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
              return decl.initializer.properties
                .filter(ts.isPropertyAssignment)
                .map(p => (ts.isIdentifier(p.name) ? p.name.text : p.name.getText()));
            }
          }
        }
      }
    }
  }
  return undefined;
}

function forInitializerToIR(
  declarationList: ts.VariableDeclarationList,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
): StatementIR | undefined {
  const storage: "var" | "let" | "const" =
    declarationList.flags & ts.NodeFlags.Const
      ? "const"
      : declarationList.flags & ts.NodeFlags.Let
        ? "let"
        : "var";

  const declaration = declarationList.declarations[0];
  if (!declaration || !ts.isIdentifier(declaration.name)) {
    return undefined;
  }

  const declarationType = resolveDeclarationType(
    declaration.type,
    declaration.initializer,
    functionReturnTypes,
    localVariableTypes,
    undefined,
    sourceText,
  );

  localVariableTypes.set(declaration.name.text, declarationType.resolvedType);

  // Resolve type through nested class aliases for hoisted class names.
  let resolvedType: string = declarationType.resolvedType === "void" ? "auto" : declarationType.resolvedType;
  const isPointer = resolvedType.endsWith("*");
  const baseType = isPointer ? resolvedType.slice(0, -1) : resolvedType;
  if (nestedClassAliases.has(baseType)) {
    resolvedType = nestedClassAliases.get(baseType)! + (isPointer ? "*" : "");
  }

  return {
    kind: "var_decl",
    sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
    name: declaration.name.text,
    storage,
    cppType: resolvedType as CppType,
    initializer: declaration.initializer
      ? expressionToIR(declaration.initializer, sourceText, diagnostics)
      : undefined,
  };
}

function incrementorToIR(
  expr: ts.Expression,
  sourceText: string,
  diagnostics: Diagnostic[],
  localVariableTypes: Map<string, CppTypeHint>,
): StatementIR | undefined {
  if (ts.isPostfixUnaryExpression(expr) && ts.isIdentifier(expr.operand)) {
    if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
      return {
        kind: "update",
        sourceSpan: makeSourceSpan(expr, "", sourceText),
        target: expr.operand.text,
        operator: expr.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--",
        prefix: false,
      };
    }
  }

  if (ts.isPrefixUnaryExpression(expr) && ts.isIdentifier(expr.operand)) {
    if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
      return {
        kind: "update",
        sourceSpan: makeSourceSpan(expr, "", sourceText),
        target: expr.operand.text,
        operator: expr.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--",
        prefix: true,
      };
    }
  }

  if (ts.isBinaryExpression(expr) && ts.isIdentifier(expr.left)) {
    const operator = assignmentOperatorToString(expr.operatorToken.kind);
    if (operator) {
      const valueType = inferExprCppType(expr.right, new Map(), localVariableTypes, sourceText);
      updateLocalTypeFromAssignment(expr.left.text, operator, valueType, localVariableTypes);
      return {
        kind: "assign",
        sourceSpan: makeSourceSpan(expr, "", sourceText),
        target: expr.left.text,
        operator,
        value: expressionToIR(expr.right, sourceText, diagnostics),
      };
    }
  }

  return undefined;
}

export function expressionStatementToIR(
  statement: ts.ExpressionStatement,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  pointerVars: PointerTracker = new Map(),
): StatementIR | undefined {
  const expr = statement.expression;

  if (ts.isCallExpression(expr)) {
    return callToStatement(statement, expr, fileName, sourceText, diagnostics, pointerVars);
  }

  if (ts.isAwaitExpression(expr) && ts.isCallExpression(expr.expression)) {
    const callStmt = callToStatement(statement, expr.expression, fileName, sourceText, diagnostics, pointerVars);
    if (callStmt && callStmt.kind === "call") {
      return { ...callStmt, isAwaited: true };
    }
    return callStmt;
  }

  // â”€â”€ Register bit-field write â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Handle: RegName.fieldName = value
  // Emits:  *RegName = (*RegName & ~mask) | ((value & fieldMask) << lo)
  if (ts.isBinaryExpression(expr) && ts.isPropertyAccessExpression(expr.left) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const objExpr = expr.left.expression;
    const fieldName = expr.left.name.text;
    if (ts.isIdentifier(objExpr)) {
      const regName = objExpr.text;
      const fieldMap = registerFieldMap.get(regName);
      if (fieldMap) {
        const field = fieldMap.get(fieldName);
        if (field) {
          const fieldMask = ((1 << field.width) - 1) >>> 0;
          const fieldMaskUL = fieldMask + 'UL';
          const shiftMask = (fieldMask << field.lo) >>> 0;
          const shiftMaskUL = shiftMask + 'UL';
          const valueIR = expressionToIR(expr.right, sourceText, diagnostics);
          const valueText = renderExprAsText(valueIR);
          const comments = extractNodeComments(statement, sourceText);
          // Generate: *REG = (*REG & ~clearMask) | ((value & fieldMask) << lo)
          const cppExpr = `*${regName} = (*${regName} & ~${shiftMaskUL}) | ((${valueText} & ${fieldMaskUL}) << ${field.lo})`;
          return {
            kind: "assign",
            sourceSpan: makeSourceSpan(statement, fileName, sourceText),
            leadingComments: comments.leadingComments,
            trailingComments: comments.trailingComments,
            target: `*${regName}`,
            operator: "=",
            value: { kind: "raw", value: `(*${regName} & ~${shiftMaskUL}) | ((${valueText} & ${fieldMaskUL}) << ${field.lo})` },
          };
        }
      }
    }
    // Fall through to normal handling if not a register field
  }

  // Handle this.field = value, obj.field = value, and compound assignments (+=, -=, etc.)
  if (ts.isBinaryExpression(expr) && ts.isPropertyAccessExpression(expr.left)) {
    const operator = assignmentOperatorToString(expr.operatorToken.kind);
    if (operator) {
      const targetIR = expressionToIR(expr.left, sourceText, diagnostics, pointerVars);
      const targetText = renderExprAsText(targetIR);

      const comments = extractNodeComments(statement, sourceText);
      return {
        kind: "assign",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: targetText,
        operator,
        value: expressionToIR(expr.right, sourceText, diagnostics),
      };
    }
  }

  // Handle arr[index] = value and compound assignments (arr[i] += 5, etc.)
  if (ts.isBinaryExpression(expr) && ts.isElementAccessExpression(expr.left)) {
    const operator = assignmentOperatorToString(expr.operatorToken.kind);
    if (operator) {
      const targetIR = expressionToIR(expr.left, sourceText, diagnostics, pointerVars);
      const targetText = renderExprAsText(targetIR);
      const comments = extractNodeComments(statement, sourceText);
      return {
        kind: "assign",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: targetText,
        operator,
        value: expressionToIR(expr.right, sourceText, diagnostics),
      };
    }
  }

  if (ts.isBinaryExpression(expr) && ts.isIdentifier(expr.left)) {
    // Handle ||= operator: x ||= val → x = (x == TYPEHAL_UNDEFINED) ? val : x;
    if (expr.operatorToken.kind === ts.SyntaxKind.BarBarEqualsToken) {
      const comments = extractNodeComments(statement, sourceText);
      const varName = expr.left.text;
      const valIR = expressionToIR(expr.right, sourceText, diagnostics);
      return {
        kind: "assign",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: varName,
        operator: "=",
        value: {
          kind: "ternary",
          condition: {
            kind: "binary",
            operator: "==",
            left: { kind: "identifier", value: varName },
            right: { kind: "identifier", value: "TYPEHAL_UNDEFINED" },
          },
          whenTrue: valIR,
          whenFalse: { kind: "identifier", value: varName },
        },
      };
    }
    // Handle &&= operator: x &&= val → if (x) x = val;
    if (expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken) {
      const comments = extractNodeComments(statement, sourceText);
      return {
        kind: "if",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        condition: { kind: "identifier", value: expr.left.text },
        thenBranch: [{
          kind: "assign",
          sourceSpan: makeSourceSpan(statement, fileName, sourceText),
          target: expr.left.text,
          operator: "=",
          value: expressionToIR(expr.right, sourceText, diagnostics),
        }],
      };
    }
    const operator = assignmentOperatorToString(expr.operatorToken.kind);
    if (!operator) {
      return undefined;
    }

    const valueType = inferExprCppType(expr.right, functionReturnTypes, localVariableTypes, sourceText);
    updateLocalTypeFromAssignment(expr.left.text, operator, valueType, localVariableTypes);
    const comments = extractNodeComments(statement, sourceText);

    return {
      kind: "assign",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      target: expr.left.text,
      operator,
      value: expressionToIR(expr.right, sourceText, diagnostics),
    };
  }

  if (ts.isPrefixUnaryExpression(expr) && ts.isIdentifier(expr.operand)) {
    if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
      const comments = extractNodeComments(statement, sourceText);
      return {
        kind: "update",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: expr.operand.text,
        operator: expr.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--",
        prefix: true,
      };
    }
  }

  if (ts.isPostfixUnaryExpression(expr) && ts.isIdentifier(expr.operand)) {
    if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
      const comments = extractNodeComments(statement, sourceText);
      return {
        kind: "update",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: expr.operand.text,
        operator: expr.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--",
        prefix: false,
      };
    }
  }

  return undefined;
}

export function lowerStatement(
  statement: ts.Statement,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  functionNameForDiagnostics: string,
  typeAliases?: Map<string, ts.TypeNode>,
  pointerVars: PointerTracker = new Map(),
): StatementIR[] | undefined {
  if (ts.isExpressionStatement(statement)) {
    // Handle arr.forEach(arrowFn) as a standalone statement → inline loop
    if (ts.isCallExpression(statement.expression) &&
        ts.isPropertyAccessExpression(statement.expression.expression) &&
        statement.expression.expression.name.text === "forEach" &&
        ts.isIdentifier(statement.expression.expression.expression)) {
      const srcName = statement.expression.expression.expression.text;
      const srcSize = arrayLiteralSizes.get(srcName);
      const arrowFn = statement.expression.arguments[0];
      if (srcSize !== undefined && arrowFn && (ts.isArrowFunction(arrowFn) || ts.isFunctionExpression(arrowFn))) {
        const param = arrowFn.parameters[0];
        const paramName = param && ts.isIdentifier(param.name) ? param.name.text : "__x";
        const span = makeSourceSpan(statement, fileName, sourceText);
        const comments = extractNodeComments(statement, sourceText);
        if (!ts.isBlock(arrowFn.body)) {
          // Expression body
          const bodyIR = expressionToIR(arrowFn.body, sourceText, diagnostics);
          return [{
            kind: "for",
            sourceSpan: span,
            leadingComments: comments.leadingComments,
            trailingComments: comments.trailingComments,
            initializer: { kind: "var_decl", sourceSpan: span, name: "__tc_i", storage: "let", cppType: "int", initializer: { kind: "number", value: 0 } },
            condition: { kind: "binary", left: { kind: "identifier", value: "__tc_i" }, operator: "<", right: { kind: "number", value: srcSize } },
            increment: { kind: "update", sourceSpan: span, target: "__tc_i", operator: "++", prefix: false },
            body: [
              { kind: "var_decl", sourceSpan: span, name: paramName, storage: "const", cppType: "auto",
                initializer: { kind: "raw", value: `${srcName}[__tc_i]` } },
              { kind: "var_decl", sourceSpan: span, name: "__tc_result", storage: "let", cppType: "auto", initializer: bodyIR },
            ],
          }];
        } else {
          // Block body — lower statements and prepend param decl
          const blockStatements = lowerStatementList(
            arrowFn.body.statements, fileName, sourceText, diagnostics,
            functionReturnTypes, localVariableTypes, functionNameForDiagnostics, typeAliases,
          );
          return [{
            kind: "for",
            sourceSpan: span,
            leadingComments: comments.leadingComments,
            trailingComments: comments.trailingComments,
            initializer: { kind: "var_decl", sourceSpan: span, name: "__tc_i", storage: "let", cppType: "int", initializer: { kind: "number", value: 0 } },
            condition: { kind: "binary", left: { kind: "identifier", value: "__tc_i" }, operator: "<", right: { kind: "number", value: srcSize } },
            increment: { kind: "update", sourceSpan: span, target: "__tc_i", operator: "++", prefix: false },
            body: [
              { kind: "var_decl", sourceSpan: span, name: paramName, storage: "const", cppType: "auto",
                initializer: { kind: "raw", value: `${srcName}[__tc_i]` } },
              ...blockStatements,
            ],
          }];
        }
      }
    }

    // Check for compile-time-only calls first (e.g., registerPlatformStrategy())
    // These are registration calls that don't need C++ emission
    if (ts.isCallExpression(statement.expression)) {
      const call = statement.expression;
      if (ts.isIdentifier(call.expression)) {
        const calleeName = call.expression.text;
        if (isCompileTimeOnlyCallName(calleeName)) {
          return []; // Skip silently - no C++ emission needed
        }
      }
      // Also check for method calls like "something.register()" that are compile-time only
      if (ts.isPropertyAccessExpression(call.expression)) {
        const method = call.expression.name.text;
        if (isCompileTimeOnlyCallName(method)) {
          return [];
        }
      }
    }
    
    // Check for new expressions that are compile-time only (e.g., new NativeStrategy())
    if (ts.isNewExpression(statement.expression)) {
      // New expressions at top level in board packages are typically compile-time only
      // Check if it's a known strategy type
      if (ts.isIdentifier(statement.expression.expression)) {
        const className = statement.expression.expression.text;
        if (isCompileTimeOnlyClassName(className)) {
          return []; // Skip silently
        }
      }
    }

    const loweredExpression = expressionStatementToIR(
      statement,
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      pointerVars,
    );
    return loweredExpression ? [loweredExpression] : undefined;
  }

  if (ts.isVariableStatement(statement)) {
    return variableStatementToIR(
      statement,
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      typeAliases,
      pointerVars,
    );
  }

  if (ts.isReturnStatement(statement) && !statement.expression) {
    const comments = extractNodeComments(statement, sourceText);
    return [{
      kind: "return",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
    }];
  }

  if (ts.isReturnStatement(statement) && statement.expression) {
    const comments = extractNodeComments(statement, sourceText);
    return [{
      kind: "return",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      value: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
    }];
  }

  if (ts.isWhileStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const bodyStatements = lowerStatementList(
      ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
    );

    return [{
      kind: "while",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      condition: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
      body: bodyStatements,
    }];
  }

  if (ts.isIfStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const thenStatements = lowerStatementList(
      ts.isBlock(statement.thenStatement) ? statement.thenStatement.statements : [statement.thenStatement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
    );

    let elseBranch: StatementIR[] | undefined;
    if (statement.elseStatement) {
      elseBranch = lowerStatementList(
        ts.isBlock(statement.elseStatement) ? statement.elseStatement.statements : [statement.elseStatement],
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        localVariableTypes,
        functionNameForDiagnostics,
      );
    }

    return [{
      kind: "if",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      condition: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
      thenBranch: thenStatements,
      elseBranch,
    }];
  }

  if (ts.isForStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);

    let initializer: StatementIR | undefined;
    if (statement.initializer) {
      if (ts.isVariableDeclarationList(statement.initializer)) {
        initializer = forInitializerToIR(
          statement.initializer,
          fileName,
          sourceText,
          diagnostics,
          functionReturnTypes,
          localVariableTypes,
        );
      } else if (ts.isExpressionStatement(statement.initializer)) {
        const loweredExpr = expressionStatementToIR(
          statement.initializer,
          fileName,
          sourceText,
          diagnostics,
          functionReturnTypes,
          localVariableTypes,
          pointerVars,
        );
        initializer = loweredExpr;
      }
    }

    const condition = statement.condition
      ? expressionToIR(statement.condition, sourceText, diagnostics, pointerVars)
      : undefined;

    let increment: StatementIR | undefined;
    if (statement.incrementor) {
      increment = incrementorToIR(statement.incrementor, sourceText, diagnostics, localVariableTypes);
    }

    const bodyStatements = lowerStatementList(
      ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
    );

    return [{
      kind: "for",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      initializer,
      condition,
      increment,
      body: bodyStatements,
    }];
  }

  if (ts.isForOfStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);

    let variable: StatementIR | undefined;
    if (ts.isVariableDeclarationList(statement.initializer)) {
      variable = forInitializerToIR(
        statement.initializer,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        localVariableTypes,
      );
    }

    const bodyStatements = lowerStatementList(
      ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
    );

    return [{
      kind: "for_of",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      variable: variable!,
      iterable: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
      body: bodyStatements,
    }];
  }

  // Handle for...in loops (iterates over object keys)
  if (ts.isForInStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);

    let variable: StatementIR | undefined;
    if (ts.isVariableDeclarationList(statement.initializer)) {
      variable = forInitializerToIR(
        statement.initializer,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        localVariableTypes,
      );
    }

    const bodyStatements = lowerStatementList(
      ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
    );

    const keys = extractForInKeys(statement.expression);

    return [{
      kind: "for_in",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      variable: variable!,
      object: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
      keys,
      body: bodyStatements,
    }];
  }

  if (ts.isBreakStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    return [{
      kind: "break",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
    }];
  }

  if (ts.isContinueStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    return [{
      kind: "continue",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
    }];
  }

  // Handle do...while loops
  if (ts.isDoStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const bodyStatements = lowerStatementList(
      ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
    );

    return [{
      kind: "do_while",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      condition: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
      body: bodyStatements,
    }];
  }

  // Handle switch statements
  if (ts.isSwitchStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const cases: Array<{ kind: "case"; sourceSpan: SourceSpan; leadingComments?: string[]; trailingComments?: string[]; value?: ExpressionIR; body: StatementIR[] }> = [];

    for (const clause of statement.caseBlock.clauses) {
      const caseComments = extractNodeComments(clause, sourceText);
      
      if (ts.isDefaultClause(clause)) {
        cases.push({
          kind: "case",
          sourceSpan: makeSourceSpan(clause, fileName, sourceText),
          leadingComments: caseComments.leadingComments,
          trailingComments: caseComments.trailingComments,
          value: undefined,  // default case has no value
          body: lowerStatementList(
            clause.statements,
            fileName,
            sourceText,
            diagnostics,
            functionReturnTypes,
            localVariableTypes,
            functionNameForDiagnostics,
          ),
        });
      } else if (ts.isCaseClause(clause)) {
        cases.push({
          kind: "case",
          sourceSpan: makeSourceSpan(clause, fileName, sourceText),
          leadingComments: caseComments.leadingComments,
          trailingComments: caseComments.trailingComments,
          value: expressionToIR(clause.expression, sourceText, diagnostics, pointerVars),
          body: lowerStatementList(
            clause.statements,
            fileName,
            sourceText,
            diagnostics,
            functionReturnTypes,
            localVariableTypes,
            functionNameForDiagnostics,
          ),
        });
      }
    }

    return [{
      kind: "switch",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      expression: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
      cases,
    }];
  }

  // Handle try/catch/finally statements
  if (ts.isTryStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const tryBlock = lowerStatementList(
      statement.tryBlock.statements,
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
    );

    let catchParam: string | undefined;
    let catchBlock: StatementIR[] | undefined;
    
    if (statement.catchClause) {
      if (statement.catchClause.variableDeclaration && ts.isIdentifier(statement.catchClause.variableDeclaration.name)) {
        catchParam = statement.catchClause.variableDeclaration.name.text;
      }
      catchBlock = lowerStatementList(
        statement.catchClause.block.statements,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        localVariableTypes,
        functionNameForDiagnostics,
      );
    }

    // Handle finally block
    let finallyBlock: StatementIR[] | undefined;
    if (statement.finallyBlock) {
      finallyBlock = lowerStatementList(
        statement.finallyBlock.statements,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        localVariableTypes,
        functionNameForDiagnostics,
      );
    }

    return [{
      kind: "try",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      tryBlock,
      catchParam,
      catchBlock,
      finallyBlock,
    }];
  }

  // Handle throw statements
  if (ts.isThrowStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    return [{
      kind: "throw",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      value: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
    }];
  }

  // Handle empty statements (just semicolons) - skip them silently
  if (ts.isEmptyStatement(statement)) {
    return [];
  }

  // Handle side-effect call statements at top level (e.g., registerPlatformStrategy())
  // These are compile-time registration calls that don't need C++ emission
  if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
    const call = statement.expression;
    // Check for known compile-time-only function calls
    if (ts.isIdentifier(call.expression)) {
      const calleeName = call.expression.text;
      const compileTimeOnlyCalls = new Set([
        'registerPlatformStrategy',
        'registerPolyfill',
        'registerBoard',
        'defineBoardManifest',
      ]);
      if (compileTimeOnlyCalls.has(calleeName)) {
        return []; // Skip silently - no C++ emission needed
      }
    }
    // For other top-level calls, try to lower them normally
    const lowered = expressionStatementToIR(
      statement,
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      pointerVars,
    );
    if (lowered) {
      return [lowered];
    }
  }

  // Handle labeled statements (e.g., label: for (...))
  if (ts.isLabeledStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const label = statement.label.text;
    const bodyStatements = lowerStatementList(
      ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
      typeAliases,
    );
    
    return [{
      kind: "labeled",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      label,
      body: bodyStatements,
    }];
  }

  // Handle standalone block statements
  if (ts.isBlock(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const bodyStatements = lowerStatementList(
      statement.statements,
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
      typeAliases,
    );
    
    return [{
      kind: "block",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      body: bodyStatements,
    }];
  }

  // Local interface declarations are type-only; no runtime IR needed
  if (ts.isInterfaceDeclaration(statement)) {
    return [];
  }

  // Local type alias declarations are type-only; no runtime IR needed
  if (ts.isTypeAliasDeclaration(statement)) {
    return [];
  }

  diagnostics.push(
    makeDiagnostic(
      sourceText,
      statement.pos,
      `Unsupported statement in function '${functionNameForDiagnostics}'.`,
      "warning",
      "TS2CPP_UNSUPPORTED_STMT",
    ),
  );
  return undefined;
}

/**
 * Hoist a nested function declaration to file scope.
 * Creates a mangled name (parent__inner) and registers it in the alias map
 * so that call sites within the parent function get rewritten.
 */
function hoistNestedFunction(
  statement: ts.FunctionDeclaration,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  parentFunctionName: string,
  typeAliases?: Map<string, ts.TypeNode>,
): void {
  const originalName = statement.name!.text;
  const safeParentName = parentFunctionName.replace(/\./g, "_");
  const mangledName = `${safeParentName}__${originalName}`;

  // Resolve return type from annotation, or default to auto
  const returnType = statement.type
    ? typeNodeToCppType(statement.type, typeAliases)
    : "auto";

  // Detect if the return type is a readonly mapped type (e.g. ReadonlyGuarded<T>)
  // so the emitter can add `const` to the C++ return type.
  const isReadonlyReturnType = statement.type
    ? isReadonlyMappedType(statement.type, typeAliases)
    : false;

  // Register the nested function's return type so that inferExprCppType
  // can resolve call expressions to this function later in the same scope.
  // For template functions, callers should use auto (concrete type depends
  // on template argument deduction which only the C++ compiler can do).
  const hasTypeParams = !!(statement.typeParameters && statement.typeParameters.length > 0);
  functionReturnTypes.set(originalName, (hasTypeParams ? "auto" : returnType) as CppTypeHint);
  functionReturnTypes.set(mangledName, returnType as CppTypeHint);

  const localVariableTypes = new Map<string, CppTypeHint>();
  const parameters: ParameterIR[] = [];

  for (const parameter of statement.parameters) {
    if (ts.isIdentifier(parameter.name)) {
      const parameterType = typeNodeToCppType(parameter.type, typeAliases);
      localVariableTypes.set(parameter.name.text, parameterType);
      const paramOwnershipKind = extractOwnershipKindFromTypeNode(parameter.type, typeAliases);
      parameters.push({
        name: parameter.name.text,
        cppType: (parameterType === "void" ? "auto" : parameterType) as Exclude<CppTypeHint, "void">,
        defaultValue: parameter.initializer
          ? expressionToIR(parameter.initializer, sourceText, diagnostics)
          : undefined,
        isRest: false,
        ...(paramOwnershipKind ? { ownershipKind: paramOwnershipKind } : {}),
      });
    }
  }

  // Lower the body â€” recursive call to lowerStatementList handles deeper nesting
  const bodyStatements = lowerStatementList(
    statement.body?.statements ?? [],
    fileName,
    sourceText,
    diagnostics,
    functionReturnTypes,
    localVariableTypes,
    mangledName,
    typeAliases,
  );

  const typeParams = statement.typeParameters
    ? statement.typeParameters.map(tp => tp.name.text)
    : undefined;

  // Capture generic type constraints as C++ static_assert expressions
  const constraints = new Map<string, string>();
  if (statement.typeParameters) {
    for (const tp of statement.typeParameters) {
      if (tp.constraint) {
        const cppConstraint = typeConstraintToCppAssert(tp.name.text, tp.constraint);
        if (cppConstraint) {
          constraints.set(tp.name.text, cppConstraint);
        }
      }
    }
  }

  hoistedNestedFunctions.push({
    originalName: mangledName,
    isAsync: false,
    returnType: returnType as any,
    sourceSpan: makeSourceSpan(statement, fileName, sourceText),
    ...extractNodeComments(statement, sourceText),
    parameters,
    statements: bodyStatements,
    ...(typeParams && typeParams.length > 0 ? { typeParameters: typeParams } : {}),
    ...(constraints.size > 0 ? { typeParameterConstraints: constraints } : {}),
    ...(isReadonlyReturnType ? { isReadonlyReturnType: true } : {}),
  });
}

/** Convert a TS type constraint to a C++ static_assert expression. */
function typeConstraintToCppAssert(paramName: string, constraint: ts.TypeNode): string | undefined {
  // Handle union types: string | number → std::is_same_v<T, std::string> || std::is_arithmetic_v<T>
  if (ts.isUnionTypeNode(constraint)) {
    const parts = constraint.types
      .map(t => singleConstraintToCpp(paramName, t))
      .filter((s): s is string => !!s);
    return parts.length > 0 ? parts.join(" || ") : undefined;
  }
  return singleConstraintToCpp(paramName, constraint);
}

function singleConstraintToCpp(paramName: string, constraint: ts.TypeNode): string | undefined {
  if (constraint.kind === ts.SyntaxKind.StringKeyword) {
    return `std::is_same_v<${paramName}, std::string>`;
  }
  if (constraint.kind === ts.SyntaxKind.NumberKeyword) {
    return `std::is_arithmetic_v<${paramName}>`;
  }
  if (constraint.kind === ts.SyntaxKind.BooleanKeyword) {
    return `std::is_same_v<${paramName}, bool>`;
  }
  return undefined;
}

/** Check if a type node resolves through a mapped type with readonly modifier. */
function isReadonlyMappedType(node: ts.TypeNode, typeAliases?: Map<string, ts.TypeNode>): boolean {
  if (!typeAliases) return false;

  // Resolve through type aliases
  const resolvedNode = resolveAliasedTypeNode(node, typeAliases) ?? node;

  if (ts.isMappedTypeNode(resolvedNode)) {
    // Check if the mapped type has a readonly modifier
    const modifier = (resolvedNode as any).readonlyToken;
    if (modifier) return true;
    // Also check the modifier property (TS uses different representations)
    if ((resolvedNode as any).modifier) return true;
  }

  // If the original node is a type reference, resolve the alias and check
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const aliasNode = typeAliases.get(node.typeName.text);
    if (aliasNode && ts.isMappedTypeNode(aliasNode)) {
      const modifier = (aliasNode as any).readonlyToken;
      if (modifier) return true;
      if ((aliasNode as any).modifier) return true;
    }
  }

  return false;
}

function hoistNestedClass(
  node: ts.ClassDeclaration,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  functionNameForDiagnostics: string,
  typeAliases?: Map<string, ts.TypeNode>,
): void {
  if (!node.name) return;
  const originalClassName = node.name.text;
  const safeParentName = functionNameForDiagnostics.replace(/\./g, "_");
  const className = safeParentName ? `${safeParentName}__${originalClassName}` : originalClassName;

  const rawExtendsClass = node.heritageClauses
    ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
    ?.types[0]
    ?.expression
    ?.getText();

  // Resolve extends name through nested class aliases (abstract parent may also be hoisted).
  const extendsClass = rawExtendsClass
    ? (nestedClassAliases.get(rawExtendsClass) ?? rawExtendsClass)
    : undefined;

  const isAbstract = node.modifiers?.some(m => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;
  const classComments = extractNodeComments(node, sourceText);
  const fields: ClassFieldIR[] = [];
  const methods: ClassMethodIR[] = [];
  const getters: ClassGetterIR[] = [];
  const setters: ClassSetterIR[] = [];
  let ctor: { parameters: ParameterIR[]; statements: StatementIR[] } | undefined;

  for (const member of node.members) {
    if (ts.isConstructorDeclaration(member)) {
      const ctorParams: ParameterIR[] = [];
      const ctorLocalTypes = new Map<string, CppTypeHint>();
      for (const param of member.parameters) {
        if (ts.isIdentifier(param.name)) {
          const paramType = typeNodeToCppType(param.type, typeAliases);
          ctorLocalTypes.set(param.name.text, paramType);
          const paramOwnershipKind = extractOwnershipKindFromTypeNode(param.type, typeAliases);
          ctorParams.push({
            name: param.name.text,
            cppType: (paramType === "void" ? "auto" : paramType) as Exclude<CppTypeHint, "void">,
            defaultValue: param.initializer
              ? expressionToIR(param.initializer, sourceText, diagnostics)
              : undefined,
            isRest: false,
            ...(paramOwnershipKind ? { ownershipKind: paramOwnershipKind } : {}),
          });

          // TypeScript parameter property shorthand: constructor(public x: number)
          const hasVisibility = param.modifiers?.some(m =>
            m.kind === ts.SyntaxKind.PublicKeyword ||
            m.kind === ts.SyntaxKind.PrivateKeyword ||
            m.kind === ts.SyntaxKind.ProtectedKeyword
          );
          if (hasVisibility) {
            const visibility: "public" | "private" | "protected" = param.modifiers!.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)
              ? "private"
              : param.modifiers!.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)
                ? "protected"
                : "public";
            fields.push({
              name: param.name.text,
              cppType: (paramType === "void" ? "auto" : paramType) as CppType,
              visibility,
              initializer: param.initializer
                ? expressionToIR(param.initializer, sourceText, diagnostics)
                : undefined,
            });
          }
        }
      }
      const ctorBody = member.body
        ? lowerStatementList(
            member.body.statements, fileName, sourceText, diagnostics,
            functionReturnTypes, ctorLocalTypes, `${className}.constructor`, typeAliases,
          )
        : [];
      ctor = { parameters: ctorParams, statements: ctorBody };
      continue;
    }

    if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const visibility: "public" | "private" | "protected" = member.modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)
        ? "private"
        : member.modifiers?.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)
          ? "protected"
          : "public";
      const fieldType = typeNodeToCppType(member.type, typeAliases);
      fields.push({
        name: member.name.text,
        cppType: (fieldType === "void" ? "auto" : fieldType) as CppType,
        visibility,
        initializer: member.initializer
          ? expressionToIR(member.initializer, sourceText, diagnostics)
          : undefined,
      });
      continue;
    }

    if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const visibility: "public" | "private" | "protected" = member.modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)
        ? "private"
        : member.modifiers?.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)
          ? "protected"
          : "public";
      const isStatic = member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
      const isMethodAbstract = member.modifiers?.some(m => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;

      const methodParams: ParameterIR[] = [];
      const methodLocalTypes = new Map<string, CppTypeHint>();
      for (const param of member.parameters) {
        if (ts.isIdentifier(param.name)) {
          const paramType = typeNodeToCppType(param.type, typeAliases);
          methodLocalTypes.set(param.name.text, paramType);
          const paramOwnershipKind = extractOwnershipKindFromTypeNode(param.type, typeAliases);
          methodParams.push({
            name: param.name.text,
            cppType: (paramType === "void" ? "auto" : paramType) as Exclude<CppTypeHint, "void">,
            defaultValue: param.initializer
              ? expressionToIR(param.initializer, sourceText, diagnostics)
              : undefined,
            isRest: false,
            ...(paramOwnershipKind ? { ownershipKind: paramOwnershipKind } : {}),
          });
        }
      }

      const methodBody = member.body
        ? lowerStatementList(
            member.body.statements, fileName, sourceText, diagnostics,
            functionReturnTypes, methodLocalTypes, `${className}.${member.name.text}`, typeAliases,
          )
        : [];
      const methodReturnType = typeNodeToCppType(member.type, typeAliases);
      const typeText = member.type ? sourceText.substring(member.type.pos, member.type.end).trim() : "";
      const returnsSelf = member.type?.kind === ts.SyntaxKind.ThisType
        || typeText === originalClassName
        || typeText === className
        || methodReturnType === originalClassName
        || methodReturnType === className;
      // Resolve return type through nested class aliases
      const resolvedReturnType = nestedClassAliases.get(methodReturnType) ?? methodReturnType;

      methods.push({
        name: member.name.text,
        returnType: (
          returnsSelf
            ? `${className}*`
            : (resolvedReturnType === "void" ? "void" : resolvedReturnType)
        ) as CppType,
        parameters: methodParams,
        statements: methodBody,
        visibility,
        isStatic,
        isAbstract: isMethodAbstract,
      });
      continue;
    }

    // Handle get accessors in nested classes
    if (ts.isGetAccessorDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const visibility: "public" | "private" | "protected" = member.modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)
        ? "private"
        : member.modifiers?.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)
          ? "protected"
          : "public";
      const isStatic = member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
      const returnType = typeNodeToCppType(member.type, typeAliases);
      const body = member.body
        ? lowerStatementList(
            member.body.statements, fileName, sourceText, diagnostics,
            functionReturnTypes, new Map<string, CppTypeHint>(),
            `${className}.${member.name.text}`, typeAliases,
          )
        : [];
      getters.push({
        name: member.name.text,
        returnType: (returnType === "void" ? "auto" : returnType) as CppType,
        statements: body,
        visibility,
        isStatic,
      });
      continue;
    }

    // Handle set accessors in nested classes
    if (ts.isSetAccessorDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const visibility: "public" | "private" | "protected" = member.modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)
        ? "private"
        : member.modifiers?.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)
          ? "protected"
          : "public";
      const isStatic = member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
      const param = member.parameters[0];
      const paramType = param && ts.isIdentifier(param.name)
        ? typeNodeToCppType(param.type, typeAliases)
        : "auto";
      const body = member.body
        ? lowerStatementList(
            member.body.statements, fileName, sourceText, diagnostics,
            functionReturnTypes, new Map<string, CppTypeHint>(),
            `${className}.${member.name.text}`, typeAliases,
          )
        : [];
      setters.push({
        name: member.name.text,
        parameter: {
          name: param && ts.isIdentifier(param.name) ? param.name.text : "value",
          cppType: (paramType === "void" ? "auto" : paramType) as CppType,
          isRest: false,
        },
        statements: body,
        visibility,
        isStatic,
      });
      continue;
    }
  }

  hoistedNestedClasses.push({
    name: className,
    extendsClass,
    isAbstract,
    sourceSpan: makeSourceSpan(node, fileName, sourceText),
    leadingComments: classComments.leadingComments,
    trailingComments: classComments.trailingComments,
    fields,
    methods,
    constructor: ctor,
    getters,
    setters,
  });

  if (safeParentName) {
    nestedClassAliases.set(originalClassName, className);
  }
}

// ---------------------------------------------------------------------------
// Array method pre-scan
// ---------------------------------------------------------------------------

// Methods that require StaticArray promotion (not all are mutating — indexOf is read-only
// but needs StaticArray since C arrays don't have an indexOf method).
const ARRAY_METHODS_REQUIRING_STATIC_ARRAY = new Set(["push", "pop", "indexOf"]);

function prescanArrayUsage(statement: ts.Statement): void {
  if (ts.isVariableStatement(statement)) {
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer) {
        if (ts.isArrayLiteralExpression(decl.initializer)) {
          arrayLiteralSizes.set(decl.name.text, decl.initializer.elements.length);
        }
        prescanExprForArrayMethods(decl.initializer);
      }
    }
  } else if (ts.isExpressionStatement(statement)) {
    prescanExprForArrayMethods(statement.expression);
  } else if (ts.isReturnStatement(statement) && statement.expression) {
    prescanExprForArrayMethods(statement.expression);
  } else if (ts.isIfStatement(statement)) {
    prescanArrayUsageBlock(statement.thenStatement);
    if (statement.elseStatement) prescanArrayUsageBlock(statement.elseStatement);
  } else if (ts.isForStatement(statement) || ts.isWhileStatement(statement) || ts.isDoStatement(statement)) {
    prescanArrayUsageBlock(statement.statement);
  } else if (ts.isForOfStatement(statement) || ts.isForInStatement(statement)) {
    prescanArrayUsageBlock(statement.statement);
  } else if (ts.isBlock(statement)) {
    for (const s of statement.statements) prescanArrayUsage(s);
  }
}

function prescanArrayUsageBlock(stmt: ts.Statement): void {
  if (ts.isBlock(stmt)) {
    for (const s of stmt.statements) prescanArrayUsage(s);
  } else {
    prescanArrayUsage(stmt);
  }
}

function prescanExprForArrayMethods(expr: ts.Expression): void {
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
    const methodName = expr.expression.name.text;
    if (ARRAY_METHODS_REQUIRING_STATIC_ARRAY.has(methodName) && ts.isIdentifier(expr.expression.expression)) {
      const varName = expr.expression.expression.text;
      if (arrayLiteralSizes.has(varName)) {
        mutableArrayVars.add(varName);
      }
    }
  }
}

function buildInlineForLoop(
  span: any,
  srcSize: number,
  srcName: string,
  paramName: string,
  bodyExpr: ts.Expression,
  sourceText: string,
  diagnostics: Diagnostic[],
  assignTarget: string,
  _isFilter: boolean,
): StatementIR {
  const bodyIR = expressionToIR(bodyExpr, sourceText, diagnostics);
  return {
    kind: "for",
    sourceSpan: span,
    initializer: { kind: "var_decl", sourceSpan: span, name: "__tc_i", storage: "let", cppType: "int", initializer: { kind: "number", value: 0 } },
    condition: { kind: "binary", left: { kind: "identifier", value: "__tc_i" }, operator: "<", right: { kind: "number", value: srcSize } },
    increment: { kind: "update", sourceSpan: span, target: "__tc_i", operator: "++", prefix: false },
    body: [
      { kind: "var_decl", sourceSpan: span, name: paramName, storage: "const", cppType: "auto",
        initializer: { kind: "raw", value: `${srcName}[__tc_i]` } },
      { kind: "assign", sourceSpan: span, target: assignTarget, operator: "=", value: bodyIR },
    ],
  };
}

export function lowerStatementList(
  statements: ts.NodeArray<ts.Statement> | ts.Statement[],
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  functionNameForDiagnostics: string,
  typeAliases?: Map<string, ts.TypeNode>,
): StatementIR[] {
  const lowered: StatementIR[] = [];
  const nestedNames: string[] = [];
  const nestedClassNames: string[] = [];

  // Phase 1: Pre-scan for nested function declarations â€” register aliases only.
  // This ensures sibling functions can reference each other.
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const originalName = statement.name.text;
      const safeParentName = functionNameForDiagnostics.replace(/\./g, "_");
      const mangledName = `${safeParentName}__${originalName}`;
      nestedFunctionAliases.set(originalName, mangledName);
      nestedNames.push(originalName);
    }
    if (ts.isClassDeclaration(statement) && statement.name) {
      const originalName = statement.name.text;
      const safeParentName = functionNameForDiagnostics.replace(/\./g, "_");
      if (safeParentName) {
        const mangledName = `${safeParentName}__${originalName}`;
        nestedClassAliases.set(originalName, mangledName);
        nestedClassNames.push(originalName);
      }
    }
  }

  // Phase 1.5: Collect local type aliases into the shared map so that
  // nested function return types can resolve generic mapped types etc.
  if (typeAliases) {
    for (const statement of statements) {
      if (ts.isTypeAliasDeclaration(statement)) {
        typeAliases.set(statement.name.text, statement.type);
      }
    }
  }

  // Phase 2: Hoist nested functions (process their bodies).
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      hoistNestedFunction(
        statement,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        functionNameForDiagnostics,
        typeAliases,
      );
    }
  }

  // Phase 2.5: Hoist nested class declarations.
  for (const statement of statements) {
    if (ts.isClassDeclaration(statement) && statement.name) {
      hoistNestedClass(
        statement,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        functionNameForDiagnostics,
        typeAliases,
      );
    }
  }

  // Phase 2.6: Hoist nested enum declarations.
  for (const statement of statements) {
    if (ts.isEnumDeclaration(statement)) {
      const enumIR = enumDeclarationToIR(statement, fileName, sourceText);
      if (enumIR && !hoistedNestedEnums.some(e => e.name === enumIR.name)) {
        hoistedNestedEnums.push(enumIR);
      }
    }
  }

  // Phase 2.6b: Hoist local interface and type alias declarations.
  // These are type-only but needed for C++ struct generation when used as return types.
  const scopeName = functionNameForDiagnostics
    ? `${functionNameForDiagnostics.replace(/\./g, "_")}__types`
    : undefined;
  for (const statement of statements) {
    if (ts.isInterfaceDeclaration(statement) && statement.name) {
      const ifaceIR = interfaceDeclarationToIR(statement, fileName, sourceText, typeAliases ?? new Map());
      if (ifaceIR && !hoistedNestedInterfaces.some(i => i.name === ifaceIR.name)) {
        if (scopeName) ifaceIR.parentScope = scopeName;
        hoistedNestedInterfaces.push(ifaceIR);
      }
    }
    if (ts.isTypeAliasDeclaration(statement)) {
      const aliasIR = typeAliasDeclarationToIR(statement, fileName, sourceText, typeAliases ?? new Map());
      if (aliasIR && !hoistedNestedTypeAliases.some(a => a.name === aliasIR.name)) {
        hoistedNestedTypeAliases.push(aliasIR);
      }
    }
  }

  // Collect pointer variables from this scope (vars initialized with 'new')
  const scopePointerVars = new Map<string, string>();
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer && ts.isNewExpression(decl.initializer)) {
          const ctorText = decl.initializer.expression && ts.isIdentifier(decl.initializer.expression)
            ? decl.initializer.expression.text : "";
          if (!TYPED_ARRAY_ELEMENT_MAP[ctorText]) {
            scopePointerVars.set(decl.name.text, ctorText);
          }
        }
      }
    }
  }

  // Phase 2.7: Pre-scan for array methods requiring StaticArray promotion.
  // Clear function-scoped state so variables from previous functions don't leak.
  resetFunctionScopeState();
  for (const statement of statements) {
    prescanArrayUsage(statement);
  }

  // Phase 3: Process remaining (non-function, non-class) statements.
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement)) {
      continue; // Already hoisted
    }
    if (ts.isClassDeclaration(statement)) {
      continue; // Already hoisted
    }
    if (ts.isEnumDeclaration(statement)) {
      continue; // Already hoisted
    }
    const result = lowerStatement(
      statement,
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
      typeAliases,
      scopePointerVars,
    );
    if (result) {
      lowered.push(...result);
    }
  }

  // Phase 4: Clean up aliases so they don't leak to sibling scopes.
  for (const name of nestedNames) {
    nestedFunctionAliases.delete(name);
  }
  for (const name of nestedClassNames) {
    nestedClassAliases.delete(name);
  }

  return lowered;
}

export function variableStatementToIR(
  statement: ts.VariableStatement,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  typeAliases?: Map<string, ts.TypeNode>,
  pointerVars: PointerTracker = new Map(),
): StatementIR[] {
  const statementComments = extractNodeComments(statement, sourceText);
  const storage: "var" | "let" | "const" =
    statement.declarationList.flags & ts.NodeFlags.Const
      ? "const"
      : statement.declarationList.flags & ts.NodeFlags.Let
        ? "let"
        : "var";

  const lowered: StatementIR[] = [];
  let commentsAssigned = false;
  for (const declaration of statement.declarationList.declarations) {
    // Handle object destructuring: const { a, b } = obj;
    if (ts.isObjectBindingPattern(declaration.name)) {
      if (!declaration.initializer) {
        diagnostics.push(
          makeDiagnostic(
            sourceText,
            declaration.pos,
            "Destructured declaration without initializer is unsupported.",
            "warning",
            "TS2CPP_UNSUPPORTED_DECL",
          ),
        );
        continue;
      }
      
      const objExpr = expressionToIR(declaration.initializer, sourceText, diagnostics);
      const objText = renderExprAsText(objExpr);
      
      for (let i = 0; i < declaration.name.elements.length; i++) {
        const element = declaration.name.elements[i];
        // Skip omitted expressions (holes in array binding pattern)
        if (!ts.isBindingElement(element)) {
          continue;
        }
        if (ts.isObjectBindingPattern(element.name)) {
          // Nested object destructuring: const { data: { status } } = meta;
          const nestedPropName = element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : undefined;
          if (nestedPropName) {
            const nestedObjText = `${objText}.${nestedPropName}`;
            for (const nestedElement of element.name.elements) {
              if (!ts.isBindingElement(nestedElement) || !ts.isIdentifier(nestedElement.name)) continue;
              const nestedVarName = nestedElement.name.text;
              let nPropName = nestedVarName;
              if (nestedElement.propertyName && ts.isIdentifier(nestedElement.propertyName)) {
                nPropName = nestedElement.propertyName.text;
              }
              const propAccess: ExpressionIR = { kind: "raw", value: `${nestedObjText}.${nPropName}` };
              const initializer = nestedElement.initializer
                ? { kind: "raw" as const, value: `typehal_nullish(${renderExprAsText(propAccess)}, ${renderExprAsText(expressionToIR(nestedElement.initializer, sourceText, diagnostics))})` }
                : propAccess;
              lowered.push({
                kind: "var_decl",
                sourceSpan: makeSourceSpan(nestedElement, fileName, sourceText),
                leadingComments: [],
                trailingComments: [],
                name: nestedVarName,
                storage,
                cppType: "auto",
                initializer,
              });
              localVariableTypes.set(nestedVarName, "auto");
              commentsAssigned = true;
            }
          }
          continue;
        }
        if (!ts.isIdentifier(element.name)) {
          continue;
        }

        const varName = element.name.text;
        // Get the property name (could be renamed via propertyName)
        let propName: string;
        if (element.propertyName && ts.isIdentifier(element.propertyName)) {
          propName = element.propertyName.text;
        } else {
          propName = varName;
        }

        // Create individual variable declaration for each destructured property
        const propAccess: ExpressionIR = { kind: "raw", value: `${objText}.${propName}` };
        const initializer = element.initializer
          ? {
              kind: "raw" as const,
              value: `typehal_nullish(${renderExprAsText(propAccess)}, ${renderExprAsText(expressionToIR(element.initializer, sourceText, diagnostics))})`,
            }
          : propAccess;

        lowered.push({
          kind: "var_decl",
          sourceSpan: makeSourceSpan(element, fileName, sourceText),
          leadingComments: i === 0 && !commentsAssigned ? statementComments.leadingComments : [],
          trailingComments: [],
          name: varName,
          storage,
          cppType: "auto",
          initializer,
        });

        localVariableTypes.set(varName, "auto");
        commentsAssigned = true;
      }
      continue;
    }
    
    // Handle array destructuring: const [a, b] = arr;
    if (ts.isArrayBindingPattern(declaration.name)) {
      if (!declaration.initializer) {
        diagnostics.push(
          makeDiagnostic(
            sourceText,
            declaration.pos,
            "Destructured declaration without initializer is unsupported.",
            "warning",
            "TS2CPP_UNSUPPORTED_DECL",
          ),
        );
        continue;
      }

      const arrExpr = expressionToIR(declaration.initializer, sourceText, diagnostics);
      const arrText = renderExprAsText(arrExpr);
      const isArrayLiteral = arrExpr.kind === "array";
      const arrElements = isArrayLiteral ? (arrExpr as { kind: "array"; elementType: string; elements: ExpressionIR[] }).elements : null;
      const arrElementType = isArrayLiteral ? (arrExpr as { kind: "array"; elementType: string; elements: ExpressionIR[] }).elementType : "auto";

      for (let i = 0; i < declaration.name.elements.length; i++) {
        const element = declaration.name.elements[i];
        // Skip omitted expressions (holes in array binding pattern)
        if (!ts.isBindingElement(element)) {
          continue;
        }

        // Handle rest element: const [a, ...rest] = arr;
        if (element.dotDotDotToken && ts.isIdentifier(element.name)) {
          const varName = element.name.text;
          if (isArrayLiteral && arrElements) {
            const remaining = arrElements.slice(i);
            lowered.push({
              kind: "var_decl",
              sourceSpan: makeSourceSpan(element, fileName, sourceText),
              leadingComments: [],
              trailingComments: [],
              name: varName,
              storage,
              cppType: "auto",
              initializer: { kind: "array", elementType: arrElementType, elements: remaining },
            });
            localVariableTypes.set(varName, "auto");
            activeCArrayVars.add(varName);
            commentsAssigned = true;
          }
          continue;
        }

        if (!ts.isIdentifier(element.name)) {
          continue;
        }

        const varName = element.name.text;

        // For array literals, use elements directly; otherwise index into the expression
        let initializer: ExpressionIR;
        if (isArrayLiteral && arrElements) {
          initializer = arrElements[i];
        } else {
          initializer = { kind: "raw", value: `${arrText}[${i}]` };
        }

        if (element.initializer) {
          initializer = {
            kind: "raw" as const,
            value: `typehal_nullish(${renderExprAsText(initializer)}, ${renderExprAsText(expressionToIR(element.initializer, sourceText, diagnostics))})`,
          };
        }

        lowered.push({
          kind: "var_decl",
          sourceSpan: makeSourceSpan(element, fileName, sourceText),
          leadingComments: i === 0 && !commentsAssigned ? statementComments.leadingComments : [],
          trailingComments: [],
          name: varName,
          storage,
          cppType: "auto",
          initializer,
        });

        localVariableTypes.set(varName, "auto");
        commentsAssigned = true;
      }
      continue;
    }
    
    if (!ts.isIdentifier(declaration.name)) {
      diagnostics.push(
        makeDiagnostic(
          sourceText,
          declaration.pos,
          "Destructured declarations are currently unsupported.",
          "warning",
          "TS2CPP_UNSUPPORTED_DECL",
        ),
      );
      continue;
    }

    // ── HAL inline evaluator for variable declarations ──────────────────────
    // Detect: const led = new Pin(LED_BUILTIN).asOutput(HIGH)
    // Or:     const p = new Pin(7)
    // Or:     const I2C0 = new I2CBus("Wire")
    // Or:     const UART0 = new SerialPort("Serial")
    // Inlines the emit() content and tracks the expression for subsequent calls.
    if (declaration.initializer && ts.isIdentifier(declaration.name)) {
      const varName = declaration.name.text;
      let pinExpr: string | null = null;
      let inlineStmts: StatementIR[] = [];
      let methodChained = false;

      if (ts.isNewExpression(declaration.initializer) && ts.isIdentifier(declaration.initializer.expression)) {
        const className = declaration.initializer.expression.text;
        const ctorArg = declaration.initializer.arguments?.[0];

        if (className === "Pin" && ctorArg) {
          // const p = new Pin(n) — track pin expression
          if (ts.isIdentifier(ctorArg)) pinExpr = ctorArg.text;
          else if (ts.isNumericLiteral(ctorArg)) pinExpr = ctorArg.text;
          else if (ts.isPropertyAccessExpression(ctorArg)) pinExpr = ctorArg.getText();

          if (pinExpr !== null) {
            pinInstances.set(varName, pinExpr);
            continue; // skip declaration — zero-cost
          }
        } else if (className === "I2CBus" && ctorArg && ts.isStringLiteral(ctorArg)) {
          // const I2C0 = new I2CBus("Wire") — track bus name
          i2cInstances.set(varName, ctorArg.text);
          continue;
        } else if (className === "SerialPort" && ctorArg && ts.isStringLiteral(ctorArg)) {
          // const UART0 = new SerialPort("Serial") — track port name
          serialInstances.set(varName, ctorArg.text);
          continue;
        } else if (className === "SPIBus" && ctorArg && ts.isStringLiteral(ctorArg)) {
          // const SPI0 = new SPIBus("SPI") — track bus name
          spiInstances.set(varName, ctorArg.text);
          continue;
        } else if (className === "EEPROMClass" && ctorArg && ts.isStringLiteral(ctorArg)) {
          // const EEPROM = new EEPROMClass("EEPROM") — track name
          eepromInstances.set(varName, ctorArg.text);
          requiredIncludes.add("<EEPROM.h>");
          continue;
        } else if (className === "WDTClass") {
          // const WDT = new WDTClass() — track (no ctor args)
          wdtInstances.set(varName, "WDT");
          continue;
        }
      } else if (ts.isCallExpression(declaration.initializer) && ts.isPropertyAccessExpression(declaration.initializer.expression)) {
        // const led = new Pin(n).method(args) — inline the method
        const receiver = declaration.initializer.expression.expression;
        const method = declaration.initializer.expression.name.text;

        // Try Pin chained constructor
        const resolved = resolvePinReceiver(receiver);
        if (resolved) {
          const argIRs = declaration.initializer.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars));
          const inlined = inlinePinMethod(resolved.pinExpr, method, argIRs);
          if (inlined) {
            // Methods with returnValue but no side effects (e.g., read()) — create a variable with the return value
            if (inlined.emitLines.length === 0 && inlined.returnValue) {
              lowered.push({
                kind: "var_decl",
                sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
                leadingComments: commentsAssigned ? [] : statementComments.leadingComments,
                trailingComments: [],
                name: varName,
                storage,
                cppType: "auto",
                initializer: { kind: "raw", value: inlined.returnValue },
              });
              localVariableTypes.set(varName, "auto");
              commentsAssigned = true;
              continue;
            }
            pinExpr = resolved.pinExpr;
            methodChained = true;
            inlineStmts = inlined.emitLines.map(line => ({
              kind: "call" as const,
              sourceSpan: makeSourceSpan(declaration.initializer!, fileName, sourceText),
              callee: "__EMIT__",
              args: [{ kind: "string" as const, value: line }],
            }));
          }
        }

        if (pinExpr !== null) {
          pinInstances.set(varName, pinExpr);
          if (methodChained && inlineStmts.length > 0) {
            lowered.push(...inlineStmts);
            commentsAssigned = true;
            continue;
          }
          continue;
        }

        // Try I2CBus chained constructor: const x = new I2CBus("Wire").begin()
        const busName = resolveI2CReceiver(receiver);
        if (busName) {
          const argIRs = declaration.initializer.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars));
          const inlined = inlineI2CMethod(busName, method, argIRs);
          if (inlined) {
            i2cInstances.set(varName, busName);
            const stmts = inlined.emitLines.map(line => ({
              kind: "call" as const,
              sourceSpan: makeSourceSpan(declaration.initializer!, fileName, sourceText),
              callee: "__EMIT__",
              args: [{ kind: "string" as const, value: line }],
            }));
            if (stmts.length > 0) {
              lowered.push(...stmts);
              commentsAssigned = true;
            }
            // For methods with returnValue but no emitLines, emit the variable with returnValue as initializer
            if (inlined.emitLines.length === 0 && inlined.returnValue) {
              lowered.push({
                kind: "var_decl",
                sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
                leadingComments: commentsAssigned ? [] : statementComments.leadingComments,
                trailingComments: [],
                name: varName,
                storage,
                cppType: "auto",
                initializer: { kind: "raw", value: inlined.returnValue },
              });
              localVariableTypes.set(varName, "auto");
              commentsAssigned = true;
            }
            continue;
          }
        }

        // Try I2C device accessor: const val = I2C0.device(addr).readByte(reg)
        const deviceCall = resolveI2CDeviceCall(declaration.initializer);
        if (deviceCall) {
          const argIRs = declaration.initializer.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars));
          const inlined = inlineI2CDeviceMethod(deviceCall.busName, deviceCall.addressExpr, deviceCall.method, argIRs);
          if (inlined) {
            const stmts = inlined.emitLines.map(line => ({
              kind: "call" as const,
              sourceSpan: makeSourceSpan(declaration.initializer!, fileName, sourceText),
              callee: "__EMIT__",
              args: [{ kind: "string" as const, value: line }],
            }));
            if (stmts.length > 0) {
              lowered.push(...stmts);
            }
            if (inlined.returnValue) {
              lowered.push({
                kind: "var_decl",
                sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
                leadingComments: commentsAssigned ? [] : statementComments.leadingComments,
                trailingComments: [],
                name: varName,
                storage,
                cppType: "auto",
                initializer: { kind: "raw", value: inlined.returnValue },
              });
            }
            localVariableTypes.set(varName, (inlined.varType ?? "auto") as CppTypeHint);
            commentsAssigned = true;
            continue;
          }
        }

        // Try SPI device accessor: const val = spi.device(cs).transfer(data)
        const spiDeviceCall = resolveSPIDeviceCall(declaration.initializer);
        if (spiDeviceCall) {
          const argIRs = declaration.initializer.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars));
          const inlined = inlineSPIDeviceMethod(spiDeviceCall.busName, spiDeviceCall.csExpr, spiDeviceCall.method, argIRs);
          if (inlined) {
            const stmts = inlined.emitLines.map(line => ({
              kind: "call" as const,
              sourceSpan: makeSourceSpan(declaration.initializer!, fileName, sourceText),
              callee: "__EMIT__",
              args: [{ kind: "string" as const, value: line }],
            }));
            if (stmts.length > 0) {
              lowered.push(...stmts);
            }
            if (inlined.returnValue) {
              lowered.push({
                kind: "var_decl",
                sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
                leadingComments: commentsAssigned ? [] : statementComments.leadingComments,
                trailingComments: [],
                name: varName,
                storage,
                cppType: "auto",
                initializer: { kind: "raw", value: inlined.returnValue },
              });
              localVariableTypes.set(varName, "auto");
            }
            commentsAssigned = true;
            continue;
          }
        }

        // Try SerialPort chained constructor
        const portName = resolveSerialReceiver(receiver);
        if (portName) {
          const argIRs = declaration.initializer.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars));
          const inlined = inlineSerialMethod(portName, method, argIRs);
          if (inlined) {
            serialInstances.set(varName, portName);
            const stmts = inlined.emitLines.map(line => ({
              kind: "call" as const,
              sourceSpan: makeSourceSpan(declaration.initializer!, fileName, sourceText),
              callee: "__EMIT__",
              args: [{ kind: "string" as const, value: line }],
            }));
            if (stmts.length > 0) {
              lowered.push(...stmts);
              commentsAssigned = true;
            }
            if (inlined.emitLines.length === 0 && inlined.returnValue) {
              lowered.push({
                kind: "var_decl",
                sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
                leadingComments: commentsAssigned ? [] : statementComments.leadingComments,
                trailingComments: [],
                name: varName,
                storage,
                cppType: "auto",
                initializer: { kind: "raw", value: inlined.returnValue },
              });
              localVariableTypes.set(varName, "auto");
              commentsAssigned = true;
            }
            continue;
          }
        }

        // Try SPIBus chained constructor
        const spiBusName = resolveSPIReceiver(receiver);
        if (spiBusName) {
          const argIRs = declaration.initializer.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars));
          const inlined = inlineSPIMethod(spiBusName, method, argIRs);
          if (inlined) {
            spiInstances.set(varName, spiBusName);
            const stmts = inlined.emitLines.map(line => ({
              kind: "call" as const,
              sourceSpan: makeSourceSpan(declaration.initializer!, fileName, sourceText),
              callee: "__EMIT__",
              args: [{ kind: "string" as const, value: line }],
            }));
            if (stmts.length > 0) {
              lowered.push(...stmts);
              commentsAssigned = true;
            }
            if (inlined.emitLines.length === 0 && inlined.returnValue) {
              lowered.push({
                kind: "var_decl",
                sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
                leadingComments: commentsAssigned ? [] : statementComments.leadingComments,
                trailingComments: [],
                name: varName,
                storage,
                cppType: "auto",
                initializer: { kind: "raw", value: inlined.returnValue },
              });
              localVariableTypes.set(varName, "auto");
              commentsAssigned = true;
            }
            continue;
          }
        }
      }

      // Handle: const CS = D10 — bare identifier that resolves to a pin constant
      if (declaration.initializer && ts.isIdentifier(declaration.initializer)) {
        const resolved = resolvePinReceiver(declaration.initializer);
        if (resolved) {
          pinInstances.set(varName, resolved.pinExpr);
          continue;
        }
      }

      // Fallback: Pin-only path for simple `new Pin(n)` that wasn't caught above
      if (pinExpr !== null) {
        pinInstances.set(varName, pinExpr);
        if (methodChained && inlineStmts.length > 0) {
          lowered.push(...inlineStmts);
          commentsAssigned = true;
          continue;
        }
        continue;
      }
    }

    // Check if initializer is a volatile() call - if so, unwrap it and mark as volatile
    let isVolatile = false;
    let actualInitializer = declaration.initializer;
    
    if (declaration.initializer && ts.isCallExpression(declaration.initializer)) {
      const callee = declaration.initializer.expression;
      if (ts.isIdentifier(callee) && callee.text === "volatile") {
        isVolatile = true;
        // Unwrap: use the first argument as the actual initializer
        if (declaration.initializer.arguments.length > 0) {
          actualInitializer = declaration.initializer.arguments[0];
        } else {
          actualInitializer = undefined;
        }
      }
    }

    // â”€â”€ Track function-level typed array vars for .length â†’ sizeof â”€â”€â”€â”€â”€â”€
    // Variables initialized with new TypedArray(...) inside function bodies
    // need the same tracking as top-level ones for correct .length handling.
    if (actualInitializer && ts.isNewExpression(actualInitializer)) {
      const ctorText = actualInitializer.expression && ts.isIdentifier(actualInitializer.expression)
        ? actualInitializer.expression.text : "";
      if (TYPED_ARRAY_ELEMENT_MAP[ctorText] && ts.isIdentifier(declaration.name)) {
        activeCArrayVars.add(declaration.name.text);
      }
    }

    // Detect arrow/function-expression initializers and produce lambda IR
    let lambdaInitializer: ExpressionIR | undefined;
    if (actualInitializer && (ts.isArrowFunction(actualInitializer) || ts.isFunctionExpression(actualInitializer))) {
      const fnExpr = actualInitializer;
      const params: ParameterIR[] = [];
      for (const param of fnExpr.parameters) {
        if (ts.isIdentifier(param.name)) {
          const paramType = typeNodeToCppType(param.type, typeAliases);
          params.push({
            name: param.name.text,
            cppType: (paramType === "void" ? "auto" : paramType) as any,
            defaultValue: param.initializer ? expressionToIR(param.initializer, sourceText, diagnostics) : undefined,
            isRest: false,
          });
        }
      }
      const isBlock = ts.isBlock(fnExpr.body);
      const body: StatementIR[] = isBlock
        ? lowerStatementList(
            (fnExpr.body as ts.Block).statements,
            fileName, sourceText, diagnostics,
            new Map(), new Map(),
            declaration.name.getText(),
            typeAliases,
          )
        : [{
            kind: "return" as const,
            sourceSpan: makeSourceSpan(fnExpr.body, fileName, sourceText),
            value: expressionToIR(fnExpr.body, sourceText, diagnostics),
          }];
      const returnType = typeNodeToCppType(fnExpr.type, typeAliases);
      lambdaInitializer = { kind: "lambda", params, body, returnType, isExpressionBody: !isBlock };
    }

    const loweredDeclaration: Extract<StatementIR, { kind: "var_decl" }> = {
      kind: "var_decl",
      sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
      leadingComments: commentsAssigned ? [] : statementComments.leadingComments,
      trailingComments: commentsAssigned ? [] : statementComments.trailingComments,
      name: declaration.name.text,
      storage,
      cppType: "auto",
      isVolatile,
      initializer: lambdaInitializer ?? (actualInitializer
        ? expressionToIR(actualInitializer, sourceText, diagnostics)
        : undefined),
    };
    commentsAssigned = true;

    const declarationType = resolveDeclarationType(
      declaration.type,
      declaration.initializer,
      functionReturnTypes,
      localVariableTypes,
      typeAliases,
      sourceText,
    );

    // Resolve type through nested class aliases for hoisted class names.
    let varCppType: string = declarationType.resolvedType === "void" ? "auto" : declarationType.resolvedType;
    const isPtr = varCppType.endsWith("*");
    const baseCppType = isPtr ? varCppType.slice(0, -1) : varCppType;
    if (nestedClassAliases.has(baseCppType)) {
      varCppType = nestedClassAliases.get(baseCppType)! + (isPtr ? "*" : "");
    }
    loweredDeclaration.cppType = varCppType as CppType;
    localVariableTypes.set(declaration.name.text, declarationType.resolvedType);
    activeLocalTypes.set(declaration.name.text, declarationType.resolvedType);

    // Track C-string variables for .length → strlen() conversion
    if (declarationType.resolvedType === "const char*" || declarationType.resolvedType === "char*") {
      activeStringVars.add(declaration.name.text);
    }

    // ── Array method handling ──────────────────────────────────────────────
    if (ts.isIdentifier(declaration.name) && actualInitializer) {
      const varName = declaration.name.text;

      // 1) Mutable array (push/pop/indexOf) → StaticArray with push_back init
      if (mutableArrayVars.has(varName) && ts.isArrayLiteralExpression(actualInitializer)) {
        const elements = actualInitializer.elements;
        lowered.push({
          kind: "var_decl",
          sourceSpan: loweredDeclaration.sourceSpan,
          leadingComments: loweredDeclaration.leadingComments,
          trailingComments: [],
          name: varName,
          storage: "let",
          cppType: "StaticArray<int>",
          initializer: undefined,
        });
        for (let ei = 0; ei < elements.length; ei++) {
          lowered.push({
            kind: "call",
            sourceSpan: loweredDeclaration.sourceSpan,
            callee: `${varName}.push_back`,
            args: [expressionToIR(elements[ei], sourceText, diagnostics)],
          });
        }
        commentsAssigned = true;
        continue;
      }

      // 2) arr.map(arrowFn) → inline loop
      if (ts.isCallExpression(actualInitializer) &&
          ts.isPropertyAccessExpression(actualInitializer.expression) &&
          actualInitializer.expression.name.text === "map" &&
          ts.isIdentifier(actualInitializer.expression.expression)) {
        const srcName = actualInitializer.expression.expression.text;
        const srcSize = arrayLiteralSizes.get(srcName);
        const arrowFn = actualInitializer.arguments[0];
        if (srcSize !== undefined && arrowFn && (ts.isArrowFunction(arrowFn) || ts.isFunctionExpression(arrowFn))) {
          const param = arrowFn.parameters[0];
          const paramName = param && ts.isIdentifier(param.name) ? param.name.text : "__x";
          const bodyExpr = ts.isBlock(arrowFn.body) ? undefined : arrowFn.body;
          if (bodyExpr) {
            const span = loweredDeclaration.sourceSpan;
            // result array
            const zeroElements: ExpressionIR[] = [];
            for (let zi = 0; zi < srcSize; zi++) zeroElements.push({ kind: "number", value: 0 });
            lowered.push({
              kind: "var_decl",
              sourceSpan: span,
              leadingComments: loweredDeclaration.leadingComments,
              trailingComments: [],
              name: varName,
              storage: "let",
              cppType: "auto",
              initializer: { kind: "array", elementType: "auto", elements: zeroElements },
            });
            activeCArrayVars.add(varName);
            // for loop
            lowered.push(buildInlineForLoop(
              span, srcSize, srcName, paramName, bodyExpr,
              sourceText, diagnostics, `${varName}[__tc_i]`, false,
            ));
            commentsAssigned = true;
            continue;
          }
        }
      }

      // 3) arr.filter(arrowFn) → inline loop with conditional push
      if (ts.isCallExpression(actualInitializer) &&
          ts.isPropertyAccessExpression(actualInitializer.expression) &&
          actualInitializer.expression.name.text === "filter" &&
          ts.isIdentifier(actualInitializer.expression.expression)) {
        const srcName = actualInitializer.expression.expression.text;
        const srcSize = arrayLiteralSizes.get(srcName);
        const arrowFn = actualInitializer.arguments[0];
        if (srcSize !== undefined && arrowFn && (ts.isArrowFunction(arrowFn) || ts.isFunctionExpression(arrowFn))) {
          const param = arrowFn.parameters[0];
          const paramName = param && ts.isIdentifier(param.name) ? param.name.text : "__x";
          const bodyExpr = ts.isBlock(arrowFn.body) ? undefined : arrowFn.body;
          if (bodyExpr) {
            const span = loweredDeclaration.sourceSpan;
            const lenVar = `${varName}__len`;
            // result array (oversized)
            const zeroElements: ExpressionIR[] = [];
            for (let zi = 0; zi < srcSize; zi++) zeroElements.push({ kind: "number", value: 0 });
            lowered.push({
              kind: "var_decl", sourceSpan: span,
              leadingComments: loweredDeclaration.leadingComments, trailingComments: [],
              name: varName, storage: "let", cppType: "auto",
              initializer: { kind: "array", elementType: "auto", elements: zeroElements },
            });
            // length counter
            lowered.push({
              kind: "var_decl", sourceSpan: span,
              leadingComments: [], trailingComments: [],
              name: lenVar, storage: "let", cppType: "int",
              initializer: { kind: "number", value: 0 },
            });
            filteredArrayLengthVars.set(varName, lenVar);
            // for loop with conditional push
            const conditionIR = expressionToIR(bodyExpr, sourceText, diagnostics);
            lowered.push({
              kind: "for",
              sourceSpan: span,
              initializer: { kind: "var_decl", sourceSpan: span, name: "__tc_i", storage: "let", cppType: "int", initializer: { kind: "number", value: 0 } },
              condition: { kind: "binary", left: { kind: "identifier", value: "__tc_i" }, operator: "<", right: { kind: "number", value: srcSize } },
              increment: { kind: "update", sourceSpan: span, target: "__tc_i", operator: "++", prefix: false },
              body: [
                { kind: "var_decl", sourceSpan: span, name: paramName, storage: "const", cppType: "auto",
                  initializer: { kind: "raw", value: `${srcName}[__tc_i]` } },
                { kind: "if", sourceSpan: span,
                  condition: conditionIR,
                  thenBranch: [
                    { kind: "assign", sourceSpan: span, target: `${varName}[${lenVar}]`, operator: "=",
                      value: { kind: "raw", value: `${srcName}[__tc_i]` } },
                    { kind: "update", sourceSpan: span, target: lenVar, operator: "++", prefix: false },
                  ],
                },
              ],
            });
            commentsAssigned = true;
            continue;
          }
        }
      }

      // 4) arr.reduce(arrowFn, init) → inline accumulation loop
      if (ts.isCallExpression(actualInitializer) &&
          ts.isPropertyAccessExpression(actualInitializer.expression) &&
          actualInitializer.expression.name.text === "reduce" &&
          ts.isIdentifier(actualInitializer.expression.expression)) {
        const srcName = actualInitializer.expression.expression.text;
        const srcSize = arrayLiteralSizes.get(srcName);
        const arrowFn = actualInitializer.arguments[0];
        const initVal = actualInitializer.arguments[1];
        if (srcSize !== undefined && arrowFn && (ts.isArrowFunction(arrowFn) || ts.isFunctionExpression(arrowFn))) {
          const accParam = arrowFn.parameters[0];
          const valParam = arrowFn.parameters[1];
          const accName = accParam && ts.isIdentifier(accParam.name) ? accParam.name.text : "__acc";
          const valName = valParam && ts.isIdentifier(valParam.name) ? valParam.name.text : "__val";
          const bodyExpr = ts.isBlock(arrowFn.body) ? undefined : arrowFn.body;
          if (bodyExpr && initVal) {
            const span = loweredDeclaration.sourceSpan;
            // accumulator variable with initial value
            lowered.push({
              kind: "var_decl", sourceSpan: span,
              leadingComments: loweredDeclaration.leadingComments, trailingComments: [],
              name: varName, storage: "let", cppType: "auto",
              initializer: expressionToIR(initVal, sourceText, diagnostics),
            });
            // for loop: for each element, compute new accumulator
            const bodyIR = expressionToIR(bodyExpr, sourceText, diagnostics);
            lowered.push({
              kind: "for",
              sourceSpan: span,
              initializer: { kind: "var_decl", sourceSpan: span, name: "__tc_i", storage: "let", cppType: "int", initializer: { kind: "number", value: 0 } },
              condition: { kind: "binary", left: { kind: "identifier", value: "__tc_i" }, operator: "<", right: { kind: "number", value: srcSize } },
              increment: { kind: "update", sourceSpan: span, target: "__tc_i", operator: "++", prefix: false },
              body: [
                { kind: "var_decl", sourceSpan: span, name: valName, storage: "const", cppType: "auto",
                  initializer: { kind: "raw", value: `${srcName}[__tc_i]` } },
                { kind: "var_decl", sourceSpan: span, name: accName, storage: "const", cppType: "auto",
                  initializer: { kind: "identifier", value: varName } },
                { kind: "assign", sourceSpan: span, target: varName, operator: "=", value: bodyIR },
              ],
            });
            commentsAssigned = true;
            continue;
          }
        }
      }

      // 5) const x = arr.push(val) → push_back + x = arr.size()
      if (ts.isCallExpression(actualInitializer) &&
          ts.isPropertyAccessExpression(actualInitializer.expression) &&
          actualInitializer.expression.name.text === "push" &&
          ts.isIdentifier(actualInitializer.expression.expression)) {
        const arrName = actualInitializer.expression.expression.text;
        if (mutableArrayVars.has(arrName) && actualInitializer.arguments.length > 0) {
          const span = loweredDeclaration.sourceSpan;
          lowered.push({
            kind: "call", sourceSpan: span,
            callee: `${arrName}.push_back`,
            args: [expressionToIR(actualInitializer.arguments[0], sourceText, diagnostics)],
          });
          lowered.push({
            kind: "var_decl", sourceSpan: span,
            leadingComments: loweredDeclaration.leadingComments, trailingComments: [],
            name: varName, storage, cppType: "auto",
            initializer: { kind: "raw", value: `${arrName}.size()` },
          });
          commentsAssigned = true;
          continue;
        }
      }

      // 6) Regular array literal → track in activeCArrayVars for .length → sizeof
      // These are emitted as C arrays (int arr[] = {...}), not std::vector,
      // regardless of what resolveDeclarationType reports. Fix the cppType to match.
      if (ts.isArrayLiteralExpression(actualInitializer) && !mutableArrayVars.has(varName)) {
        const vecMatch = varCppType.startsWith("std::vector<");
        const inferredVecMatch = declarationType.inferredType.startsWith("std::vector<");
        if (!vecMatch && inferredVecMatch) {
          activeArrayLiteralVars.add(varName);
          loweredDeclaration.cppType = "auto" as any;
          localVariableTypes.set(varName, declarationType.inferredType);
          activeLocalTypes.set(varName, declarationType.inferredType);
        } else if (!vecMatch) {
          activeArrayLiteralVars.add(varName);
          activeCArrayVars.add(varName);
          loweredDeclaration.cppType = "auto" as any;
          localVariableTypes.set(varName, "auto");
          activeLocalTypes.set(varName, "auto");
        }
      }
    }

    // â”€â”€ Ownership kind detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Detect Shared<T>, Mutable<T>, Owned<T> wrapper types and store the
    // ownership kind on the IR node for validation and const emission.
    const ownershipKind = extractOwnershipKindFromTypeNode(declaration.type, typeAliases);
    if (ownershipKind) {
      (loweredDeclaration as any).ownershipKind = ownershipKind;
    }

    if (declarationType.shouldWarnUnmappedType) {
      diagnostics.push(
        makeDiagnostic(
          sourceText,
          declaration.pos,
          `Type annotation on '${declaration.name.text}' is not yet mapped; emitted as 'auto'.`,
          "warning",
          "TS2CPP_UNMAPPED_TYPE",
        ),
      );
    }

    lowered.push(loweredDeclaration);
  }

  return lowered;
}

// Helper to scan for pointer variables (variables initialized with ‘new’)
export function collectPointerVars(statements: readonly ts.Statement[]): PointerTracker {
  const pointerVars = new Map<string, string>();

  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer && ts.isNewExpression(decl.initializer)) {
          const ctorText = decl.initializer.expression && ts.isIdentifier(decl.initializer.expression)
            ? decl.initializer.expression.text : "";
          if (TYPED_ARRAY_ELEMENT_MAP[ctorText]) {
            // new TypedArray([...]) etc. → C array, not a pointer
            activeCArrayVars.add(decl.name.text);
          } else {
            pointerVars.set(decl.name.text, ctorText);
          }
        }
      }
    }
  }

  return pointerVars;
}