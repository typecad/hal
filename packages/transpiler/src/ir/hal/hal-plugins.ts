import ts from "typescript";
import { HALOpIR } from "@typehal/core";
import { HALInstance } from "./hal-parser";
import { getCurrentBoardConstants, halInstances } from "../build-ir-state";
import { resolveExpressionText, extractAndRegisterCallbacks } from "./hal-emitter";

/** Resolve a single argument from a semantic call's AST node list. */
export function resolveSemanticArg(
  args: readonly ts.Expression[],
  idx: number,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults: Map<string, string> | undefined,
): string | null {
  const arg = args[idx];
  if (!arg) return null;
  return resolveExpressionText(arg, instance, paramNames, callArgTexts, paramDefaults);
}

/** Resolve a numeric argument, returning its numeric value or null. */
export function resolveNumericArg(
  args: readonly ts.Expression[],
  idx: number,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults: Map<string, string> | undefined,
): number | null {
  const text = resolveSemanticArg(args, idx, instance, paramNames, callArgTexts, paramDefaults);
  if (text === null) return null;
  // R1: Boolean coercion — true → 1, false → 0
  if (text === "true") return 1;
  if (text === "false") return 0;
  const n = Number(text);
  return isNaN(n) ? null : n;
}

/** Extract the MCU port name from the current HAL instance, if available. */
export function portFromInstance(instance: HALInstance): string | undefined {
  const port = instance.fieldValues.get('_port');
  return port && port !== '' ? port : undefined;
}

/**
 * Resolve a boardResolve() argument to a dot-path string.
 * Handles both static string paths ("peripherals.adc.0.resolution") and
 * dynamic paths ("peripherals.adc.0.referenceVoltages." + this._reference).
 */
export function tryResolveBoardResolveArg(
  args: ts.NodeArray<ts.Expression>,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults: Map<string, string> | undefined,
): string | null {
  const arg = args[0];
  if (!arg) return null;

  // Static string literal: boardResolve("peripherals.adc.0.resolution")
  if (ts.isStringLiteral(arg)) return arg.text;

  // Dynamic path via string concat: boardResolve("prefix." + this._field)
  if (ts.isBinaryExpression(arg) && arg.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveExpressionText(arg.left, instance, paramNames, callArgTexts, paramDefaults);
    const right = resolveExpressionText(arg.right, instance, paramNames, callArgTexts, paramDefaults);
    if (left !== null && right !== null) return left + right;
  }

  return null;
}

/**
 * Try to resolve a compound return expression that contains semantic calls.
 * For example, `(gpioRead(this._pin) === HIGH)` should produce a halOp for
 * `gpioRead` and return a combined expression with the strategy-resolved form.
 * Returns the resolved text with placeholders, or null if no semantic calls found.
 */
export function tryResolveCompoundSemanticReturn(
  expr: ts.Expression,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults: Map<string, string> | undefined,
  halOps: HALOpIR[],
  callArgs: any[],
): string | null {
  const semanticPlaceholders: Map<ts.Node, number> = new Map();

  // Walk the expression tree looking for semantic calls
  function findSemanticCalls(node: ts.Expression): boolean {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const semanticOp = tryResolveSemanticCall(
        node.expression.text,
        node.arguments,
        instance, paramNames, callArgTexts, paramDefaults,
        callArgs,
      );
      if (semanticOp) {
        halOps.push(semanticOp);
        semanticPlaceholders.set(node, halOps.length - 1);
        return true;
      }
    }
    let found = false;
    if (ts.isBinaryExpression(node)) {
      found = findSemanticCalls(node.left) || findSemanticCalls(node.right);
    } else if (ts.isParenthesizedExpression(node)) {
      found = findSemanticCalls(node.expression);
    } else if (ts.isAsExpression(node)) {
      found = findSemanticCalls(node.expression);
    } else if (ts.isPrefixUnaryExpression(node)) {
      found = findSemanticCalls(node.operand);
    } else if (ts.isConditionalExpression(node)) {
      found = findSemanticCalls(node.condition) || findSemanticCalls(node.whenTrue) || findSemanticCalls(node.whenFalse);
    }
    return found;
  }

  if (!findSemanticCalls(expr)) return null;

  // Now resolve the expression text, substituting semantic calls with their resolved forms
  function resolveWithSemantics(node: ts.Expression): string | null {
    // If this node was a semantic call, return a placeholder for the halOp expression
    const opIdx = semanticPlaceholders.get(node);
    if (opIdx !== undefined) {
      return `__hal_op_expr_${opIdx}__`;
    }

    // Delegate non-semantic parts to resolveExpressionText
    if (ts.isBinaryExpression(node)) {
      const left = resolveWithSemantics(node.left);
      const right = resolveWithSemantics(node.right);
      if (left === null || right === null) return null;
      let op = node.operatorToken.getText();
      if (op === "===") op = "==";
      else if (op === "!==") op = "!=";
      return `${left} ${op} ${right}`;
    }

    if (ts.isParenthesizedExpression(node)) {
      const inner = resolveWithSemantics(node.expression);
      return inner !== null ? `(${inner})` : null;
    }

    if (ts.isAsExpression(node)) {
      // Unwrap type assertions (e.g., gpioRead(pin) as unknown as boolean)
      return resolveWithSemantics(node.expression);
    }

    if (ts.isPrefixUnaryExpression(node)) {
      const operand = resolveWithSemantics(node.operand);
      if (operand === null) return null;
      const op = node.operator === ts.SyntaxKind.ExclamationToken ? "!" : node.operator === ts.SyntaxKind.MinusToken ? "-" : "";
      return `${op}${operand}`;
    }

    // Fall back to text resolution for non-semantic parts
    return resolveExpressionText(node, instance, paramNames, callArgTexts, paramDefaults);
  }

  const resolved = resolveWithSemantics(expr);
  if (resolved === null) return null;

  return resolved.replace(/===/g, "==").replace(/!==/g, "!=");
}

/**
 * Try to resolve a semantic HAL function call to a HALOpIR node.
 * Returns the HALOpIR if the function name is recognized, or null.
 */
export function tryResolveSemanticCall(
  fnName: string,
  args: readonly ts.Expression[],
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults: Map<string, string> | undefined,
  callArgs?: any[],
): HALOpIR | null {
  // Extract MCU port name from instance (set by Pin.fromPort())
  const port = portFromInstance(instance);

  switch (fnName) {
    // ── GPIO ──
    case "gpioWrite": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || value === null) return null;
      return { operation: "gpio.write", port, pin, value: (value ? 1 : 0) as 0 | 1 };
    }
    case "gpioRead": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "gpio.read", port, pin };
    }
    case "gpioToggle": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "gpio.toggle", port, pin };
    }
    case "gpioSetMode": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const mode = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || mode === null) return null;
      return { operation: "gpio.set_mode", port, pin, mode };
    }

    // ── PWM ──
    case "pwmWrite": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const duty = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || duty === null) return null;
      return { operation: "pwm.write", port, pin, duty };
    }

    // ── ADC ──
    case "adcRead": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "adc.read", port, pin };
    }
    case "adcSetReference": {
      const ref = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (ref === null) return null;
      const numRef = Number(ref);
      return { operation: "adc.set_reference", reference: isNaN(numRef) ? ref : numRef };
    }
    case "adcReadVoltage": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      const op: Record<string, unknown> = { operation: "adc.read_voltage", port, pin };
      const bc = getCurrentBoardConstants();
      if (bc) {
        // Check if ADC has a non-default reference set
        const adcInst = halInstances.get("ADC");
        const ref = adcInst?.fieldValues.get("_reference");
        const refKey = ref && ref !== "DEFAULT" ? ref : null;
        const vRefPath = refKey
          ? `peripherals.adc.0.referenceVoltages.${refKey}`
          : `peripherals.adc.0.referenceVoltage`;
        const vRef = bc.get(vRefPath);
        const maxValue = bc.get("peripherals.adc.0.maxValue");
        if (vRef !== undefined) op.vRef = Number(vRef);
        if (maxValue !== undefined) op.maxValue = Number(maxValue);
      }
      return op as unknown as HALOpIR;
    }

    // ── DAC ──
    case "dacWrite": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || value === null) return null;
      return { operation: "dac.write", port, pin, value };
    }

    // ── Interrupts ──
    case "interruptAttach": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const handler = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const mode = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || handler === null || mode === null) return null;
      return { operation: "interrupt.attach", port, pin, handler, mode };
    }
    case "interruptDetach": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "interrupt.detach", port, pin };
    }

    // ── Tone ──
    case "tonePlay": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const frequency = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const duration = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || frequency === null) return null;
      return { operation: "tone.play", port, pin, frequency, ...(duration !== null ? { duration } : {}) };
    }
    case "toneStop": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "tone.stop", port, pin };
    }

    // ── Timing ──
    case "delayMs": {
      const ms = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (ms === null) return null;
      return { operation: "timing.delay", ms };
    }
    case "delayMicro": {
      const us = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (us === null) return null;
      return { operation: "timing.delay_microseconds", us };
    }
    case "getMillis":
      return { operation: "timing.millis" };
    case "getMicros":
      return { operation: "timing.micros" };

    // ── I2C ──
    case "i2cBegin": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const address = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "i2c.begin", bus, ...(address !== null ? { address } : {}) };
    }
    case "i2cEnd": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "i2c.end", bus };
    }
    case "i2cSetClock": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const hz = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || hz === null) return null;
      return { operation: "i2c.set_clock", bus, hz };
    }
    case "i2cBeginTx": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const address = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || address === null) return null;
      return { operation: "i2c.begin_transmission", bus, address };
    }
    case "i2cWrite": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const data = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || data === null) return null;
      return { operation: "i2c.write", bus, data };
    }
    case "i2cEndTx": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const stop = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || stop === null) return null;
      return { operation: "i2c.end_transmission", bus, stop: stop !== "false" };
    }
    case "i2cRequestFrom": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const address = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const quantity = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      const stop = resolveSemanticArg(args, 3, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || address === null || quantity === null || stop === null) return null;
      return { operation: "i2c.request_from", bus, address, quantity, stop: stop !== "false" };
    }
    case "i2cAvailable": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "i2c.available", bus };
    }
    case "i2cRead": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "i2c.read", bus };
    }

    // ── SPI ──
    case "spiBegin": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "spi.begin", bus };
    }
    case "spiEnd": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "spi.end", bus };
    }
    case "spiTransfer": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const data = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || data === null) return null;
      return { operation: "spi.transfer", bus, data };
    }
    case "spiBeginTx": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const settings = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || settings === null) return null;
      return { operation: "spi.begin_transaction", bus, settings };
    }
    case "spiEndTx": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "spi.end_transaction", bus };
    }
    case "spiCsLow": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "spi.cs_low", port, pin };
    }
    case "spiCsHigh": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "spi.cs_high", port, pin };
    }
    case "spiSetMode": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const mode = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || mode === null) return null;
      return { operation: "spi.set_mode", bus, mode };
    }
    case "spiSetBitOrder": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const order = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || order === null) return null;
      return { operation: "spi.set_bit_order", bus, order };
    }

    // ── UART ──
    case "uartBegin": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const baud = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null || baud === null) return null;
      return { operation: "uart.begin", port, baud };
    }
    case "uartEnd": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "uart.end", port };
    }
    case "uartPrint": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null || value === null) return null;
      return { operation: "uart.print", port, value };
    }
    case "uartPrintln": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null || value === null) return null;
      return { operation: "uart.println", port, value };
    }
    case "uartWrite": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const data = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null || data === null) return null;
      return { operation: "uart.write", port, data };
    }
    case "uartRead": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "uart.read", port };
    }
    case "uartPeek": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "uart.peek", port };
    }
    case "uartAvailable": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "uart.available", port };
    }
    case "uartFlush": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "uart.flush", port };
    }

    // ── Pulse ──
    case "pulseIn_": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const timeout = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || value === null) return null;
      return { operation: "pulse.in", port, pin, value: (value ? 1 : 0) as 0 | 1, ...(timeout !== null ? { timeout } : {}) };
    }
    case "pulseInLong_": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || value === null) return null;
      return { operation: "pulse.in_long", port, pin, value: (value ? 1 : 0) as 0 | 1 };
    }

    // ── Shift ──
    case "shiftOut_": {
      const dataPin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const clockPin = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const bitOrder = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericArg(args, 3, instance, paramNames, callArgTexts, paramDefaults);
      if (dataPin === null || clockPin === null || bitOrder === null || value === null) return null;
      return { operation: "shift.out", dataPin, clockPin, bitOrder, value };
    }
    case "shiftIn_": {
      const dataPin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const clockPin = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const bitOrder = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (dataPin === null || clockPin === null || bitOrder === null) return null;
      return { operation: "shift.in", dataPin, clockPin, bitOrder };
    }

    // ── Board ──
    case "boardResolve": {
      const p = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (p === null) return null;
      return { operation: "board.resolve", path: p };
    }

    // ── Raw C++ passthrough ──
    case "rawCpp": {
      const code = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (code === null) return null;
      return { operation: "raw", code };
    }

    default:
      return null;
  }
}
