import ts from "typescript";
import { Diagnostic } from "../../types.js";
import { PointerTracker } from "../build-ir-state.js";
import { StatementIR, ExpressionIR, HALOpIR } from "../../api/index.js";
import { resolveHALReceiver, processHALMethodBody, isHALSingleton, HALInstance } from "../hal-resolver.js";
import { expressionToIR } from "../expression-to-ir.js";
import { renderExprAsText } from "../render-expr.js";
import { collectChainedHALEmits, emitLinesToIR, halOpsToIR } from "./hal-emit-helpers.js";
import { resolveNamespaceMethodCall } from "./namespace-methods.js";
import { makeSourceSpan } from "../ast-node-utils.js";

/**
 * Resolve a HAL method call using the HAL resolver.
 * Handles all HAL classes: Pin, I2CBus, SPIBus, SerialPort, EEPROMClass, WDTClass,
 * plus device accessor patterns (I2CDevice, SPIDevice) and namespace methods (Pulse, Shift, Random).
 */
export function tryResolveHALMethod(
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  pointerVars: PointerTracker,
): StatementIR | null {
  let method: string;
  let instance: HALInstance | null = null;

  if (ts.isPropertyAccessExpression(call.expression)) {
    method = call.expression.name.text;
    const receiver = call.expression.expression;
    instance = resolveHALReceiver(receiver);
  } else if (ts.isIdentifier(call.expression)) {
    method = call.expression.text;
    // Global functions are treated as methods on a pseudo-instance with no class
    instance = { className: "", fieldValues: new Map() };
  } else {
    return null;
  }

  const argIRs = call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars));

  // Try HAL class method resolution via resolver
  if (instance) {
    const result = processHALMethodBody(instance, method, argIRs);
    if (result) {
      // Collect emit lines and halOps from chained inner calls: led.tone(440).for(400)
      // The receiver of this call is itself a chained HAL call (led.tone(440)).
      // We need to process that inner call to collect its emit lines too.
      const chainedEmits: string[] = [];
      const chainedHalOps: HALOpIR[] = [];
      if (ts.isPropertyAccessExpression(call.expression)) {
        const innerReceiver = call.expression.expression;
        collectChainedHALEmits(innerReceiver, sourceText, diagnostics, pointerVars, chainedEmits, chainedHalOps);
      }
      // Prefer hal-op IR over raw emit lines, but preserve emit lines if both are generated
      const allHalOps = [...chainedHalOps, ...result.halOps];
      const allEmits = [...chainedEmits, ...result.emitLines];

      if (allHalOps.length > 0 && allEmits.length > 0) {
        const emitIR = emitLinesToIR(allEmits, call, fileName, sourceText);
        const halOpIR = halOpsToIR(allHalOps, call, fileName, sourceText);
        const body: StatementIR[] = [];
        if (emitIR) {
          if (emitIR.kind === "block") body.push(...emitIR.body);
          else body.push(emitIR);
        }
        if (halOpIR) {
          if (halOpIR.kind === "block") body.push(...halOpIR.body);
          else body.push(halOpIR);
        }
        return {
          kind: "block",
          body,
          sourceSpan: makeSourceSpan(call, fileName, sourceText)
        };
      }

      if (allHalOps.length > 0) return halOpsToIR(allHalOps, call, fileName, sourceText);
      if (allEmits.length > 0) return emitLinesToIR(allEmits, call, fileName, sourceText);
      if (result.returnValue === "this" && ts.isPropertyAccessExpression(call.expression)) {
        const objText = renderExprAsText(expressionToIR(call.expression.expression, sourceText, diagnostics, pointerVars));
        return {
          kind: "call",
          callee: `${objText}.${method}`,
          args: argIRs,
          sourceSpan: makeSourceSpan(call, fileName, sourceText)
        };
      }
      if (result.returnValue) return emitLinesToIR([`${result.returnValue};`], call, fileName, sourceText);
    }
  }

  const receiver = ts.isPropertyAccessExpression(call.expression) ? call.expression.expression : null;

  // Try device accessor pattern: <bus>.device(addr).method(args)
  // This resolves I2CDevice and SPIDevice calls
  if (receiver && ts.isCallExpression(receiver)) {
    const deviceCall = receiver;
    if (ts.isPropertyAccessExpression(deviceCall.expression) && deviceCall.expression.name.text === "device") {
      const busReceiver = deviceCall.expression.expression;
      const busInstance = resolveHALReceiver(busReceiver);
      if (busInstance) {
        // Resolve device() arguments to create a device instance
        const deviceArgs = deviceCall.arguments as ts.NodeArray<ts.Expression> | undefined;
        if (deviceArgs && deviceArgs.length > 0) {
          // Determine the device class based on bus class
          const deviceClassName = busInstance.className === "SPIBus" ? "SPIDevice" : "I2CDevice";
          // Build field values for the device: _bus from bus instance, _address/_cs from device() arg
          const deviceFieldValues = new Map<string, string>();
          const busField = busInstance.fieldValues.get("_bus");
          if (busField) deviceFieldValues.set("_bus", busField);
          const deviceArg = deviceArgs[0];
          if (ts.isNumericLiteral(deviceArg)) {
            const fieldName = busInstance.className === "SPIBus" ? "_cs" : "_address";
            deviceFieldValues.set(fieldName, deviceArg.text);
          } else if (ts.isIdentifier(deviceArg)) {
            // For SPI device, resolve the pin
            const pinInstance = resolveHALReceiver(deviceArg);
            if (pinInstance && pinInstance.fieldValues.has("_pin")) {
              deviceFieldValues.set("_cs", pinInstance.fieldValues.get("_pin")!);
            }
          }
          const deviceInstance = { className: deviceClassName, fieldValues: deviceFieldValues };
          const argIRs = call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars));

          const result = processHALMethodBody(deviceInstance, method, argIRs);
          if (result) {
            if (result.halOps.length > 0) return halOpsToIR(result.halOps, call, fileName, sourceText);
            if (result.emitLines.length > 0) return emitLinesToIR(result.emitLines, call, fileName, sourceText);
            if (result.returnValue) return emitLinesToIR([`${result.returnValue};`], call, fileName, sourceText);
          }
        }
      }
    }
  }

  // ── Inline fallbacks for namespace methods the HAL resolver can't express ──
  if (receiver && ts.isIdentifier(receiver)) {
    const ns = receiver.text;
    const nsResult = resolveNamespaceMethodCall(ns, method, argIRs);
    if (nsResult) {
      if (nsResult.halOps.length > 0) return halOpsToIR(nsResult.halOps, call, fileName, sourceText);
      if (nsResult.returnValue) return emitLinesToIR([`${nsResult.returnValue};`], call, fileName, sourceText);
      if (nsResult.emitLines.length > 0) return emitLinesToIR(nsResult.emitLines, call, fileName, sourceText);
    }
  }

  return null;
}

/**
 * Resolve a HAL call for use in variable initializers and expression contexts.
 * Returns emitLines and returnValue via the HAL resolver.
 */
export function resolveHALCallForVarInit(
  call: ts.CallExpression,
  sourceText: string,
  diagnostics: Diagnostic[],
  pointerVars: PointerTracker,
): { emitLines: string[]; halOps: HALOpIR[]; returnValue?: string; returnClassName?: string } | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;

  const method = call.expression.name.text;
  const receiver = call.expression.expression;
  const argIRs = call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars));

  const instance = resolveHALReceiver(receiver);
  if (instance) {
    const result = processHALMethodBody(instance, method, argIRs);
    if (result) {
      // Variable-initializer context is effectively expression context: the
      // returnValue is substituted into `T name = <returnValue>;`. A leading
      // `return ` (baked into HAL rawCpp for statement context) would leak as
      // `T name = return Preferences.getString(...);`. Strip it. Demo #33.
      const returnValue = result.returnValue ? result.returnValue.replace(/^\s*return\s+/, "") : result.returnValue;
      return { emitLines: result.emitLines, halOps: result.halOps, returnValue, returnClassName: result.returnClassName };
    }
  }

  // Try device accessor pattern
  if (ts.isCallExpression(receiver)) {
    const deviceCall = receiver;
    if (ts.isPropertyAccessExpression(deviceCall.expression) && deviceCall.expression.name.text === "device") {
      const busReceiver = deviceCall.expression.expression;
      const busInstance = resolveHALReceiver(busReceiver);
      if (busInstance) {
        const deviceArgs = deviceCall.arguments as ts.NodeArray<ts.Expression> | undefined;
        if (deviceArgs && deviceArgs.length > 0) {
          const deviceClassName = busInstance.className === "SPIBus" ? "SPIDevice" : "I2CDevice";
          const deviceFieldValues = new Map<string, string>();
          const busField = busInstance.fieldValues.get("_bus");
          if (busField) deviceFieldValues.set("_bus", busField);
          const deviceArg = deviceArgs[0];
          if (ts.isNumericLiteral(deviceArg)) {
            const fieldName = busInstance.className === "SPIBus" ? "_cs" : "_address";
            deviceFieldValues.set(fieldName, deviceArg.text);
          } else if (ts.isIdentifier(deviceArg)) {
            const pinInstance = resolveHALReceiver(deviceArg);
            if (pinInstance && pinInstance.fieldValues.has("_pin")) {
              deviceFieldValues.set("_cs", pinInstance.fieldValues.get("_pin")!);
            }
          }
          const deviceInstance = { className: deviceClassName, fieldValues: deviceFieldValues };
          const result = processHALMethodBody(deviceInstance, method, argIRs);
          if (result) return { emitLines: result.emitLines, halOps: result.halOps, returnValue: result.returnValue };
        }
      }
    }
  }

  // Namespace method fallbacks (Pulse, Shift, Random) — used in variable initializer context
  if (ts.isIdentifier(receiver)) {
    const ns = receiver.text;
    return resolveNamespaceMethodCall(ns, method, argIRs);
  }

  return null;
}

/**
 * Try to resolve a HAL expression call for use inside expression contexts.
 * Returns a raw string ExpressionIR if resolved, or null if not a HAL call.
 * Side effects (emitLines) are accumulated and returned separately.
 */
export function tryResolveHALExpression(
  call: ts.CallExpression,
  sourceText: string,
  diagnostics: Diagnostic[],
  pointerVars: PointerTracker,
): { ir: ExpressionIR; sideEffects: string[] } | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;

  const method = call.expression.name.text;
  const receiver = call.expression.expression;
  const argIRs = call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars));

  const instance = resolveHALReceiver(receiver);
  if (instance) {
    const result = processHALMethodBody(instance, method, argIRs);
    if (result) {
      // Prefer hal-expr for semantic HAL operations
      if (result.halOps.length > 0) {
        // Use the last halOp as the expression; preceding ones are side effects
        const lastOp = result.halOps[result.halOps.length - 1];
        return {
          ir: { kind: "hal-expr", operation: lastOp },
          sideEffects: result.emitLines,
        };
      }
      if (result.returnValue === "this") {
        // Return structured method call for analysis
        const objText = renderExprAsText(expressionToIR(receiver, sourceText, diagnostics, pointerVars));
        return {
          ir: { kind: "method-call", callee: `${objText}.${method}`, args: argIRs },
          sideEffects: result.emitLines
        };
      }
      if (result.returnValue) {
        // Expression context: a leading `return ` (baked into many HAL
        // rawCpp definitions for statement context) is invalid inside an
        // expression and would leak as e.g.
        // `strcmp(return Preferences.getString(...), ...)` (avr-g++: "expected
        // primary-expression before 'return'"). Strip it here so the value is
        // usable as a sub-expression. Statement context keeps the `return`
        // via tryResolveHALMethod. Demo #33 Finding B.
        const exprValue = result.returnValue.replace(/^\s*return\s+/, "");
        return { ir: { kind: "raw", value: exprValue }, sideEffects: result.emitLines };
      }
      if (result.emitLines.length > 0) {
        return { ir: { kind: "raw", value: "0" }, sideEffects: result.emitLines };
      }
    }
  }

  return null;
}
