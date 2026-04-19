import path from "node:path";
import fs from "node:fs";
import ts from "typescript";
import { parseSource } from "../ast/parse";
import { Diagnostic, SourceSpan } from "../types";
import { CppType, EnumIR, ClassIR, ClassFieldIR, ClassMethodIR, ExpressionIR, FunctionIR, ImportIR, InterfaceIR, NamespaceIR, ParameterIR, ProgramIR, ReExportIR, RegisterClassIR, StatementIR, TypeAliasIR } from "./model";
import { extractNodeComments, makeDiagnostic, makeSourceSpan } from "./ast-node-utils";
import { isCompileTimeOnlyCallName, isCompileTimeOnlyClassName, isCompileTimeOnlyMethodName } from "./compile-time-only";
import { buildFunctionReturnTypeMap, collectReturns, CppTypeHint, FunctionTypeSignature, inferExprCppType, resolveAliasedTypeNode, resolveDeclarationType, resolveFunctionReturnType, resolveFunctionTypeSignature, typeNodeToCppType, extractOwnershipKindFromTypeNode } from "./type-resolution";
import { inferKindByName, TypecodeReceiverKind } from "./typecode-symbols";
import { resolveBoardConstants, BoardConstants } from "./board-resolver";
import { analyzePeripheralUsage, createEmptyPeripheralUsage, PeripheralUsage } from "./peripheral-usage";
import { getBitsRange, getRegisterAddress } from "./register-decorators";
import { runProgramValidations } from "./validation-orchestrator";

function normalizeLegacyArduinoSyntax(sourceText: string): string {
  return sourceText.replace(/\bfunction\s+void\s*\(/g, "function __arduino_setup__(");
}

/** Module-level register field map, populated during buildProgramIR. */
const registerFieldMap = new Map<string, Map<string, { hi: number; lo: number; width: number }>>();

// Track variables that are pointers (from 'new' expressions)
type PointerTracker = Set<string>;

// Module-level accumulators for nested function hoisting (Bug 6).
// These are reset at the start of each buildProgramIR() call.
let hoistedNestedFunctions: FunctionIR[] = [];
let nestedFunctionAliases: Map<string, string> = new Map();

// Context flags for expression processing
type ExpressionContext = {
  pointerVars: PointerTracker;
  suppressRawExprWarning?: boolean;  // Suppress warnings for compile-time constructs
};

// Pin factory function names that should be constant-folded to the pin number
const PIN_FACTORY_FUNCTIONS = new Set([
  "createDigitalPin",
  "createPWMPin", 
  "createAnalogPin",
  "createInterruptPin",
]);

// Helper functions that should be constant-folded to their first argument
const CONSTANT_FOLD_FUNCTIONS = new Set<string>([]);

// Maps typed array constructor names to their C++ element types.
// Used for: new expression handling, collectPointerVars, and function-level tracking.
const TYPED_ARRAY_ELEMENT_MAP: Record<string, string> = {
  Uint8Array:  "uint8_t",
  Int8Array:   "int8_t",
  Uint16Array: "uint16_t",
  Int16Array:  "int16_t",
  Uint32Array: "uint32_t",
  Int32Array:  "int32_t",
  Float32Array: "float",
  Float64Array: "double",
};

function expressionToIR(expr: ts.Expression, sourceText: string, diagnostics: Diagnostic[], pointerVars: PointerTracker = new Set()): ExpressionIR {
  function emitUnsupportedExpression(message: string): ExpressionIR {
    diagnostics.push(makeDiagnostic(
      sourceText,
      expr.pos,
      message,
      "warning",
      "TS2CPP_UNSUPPORTED_EXPR",
    ));
    return { kind: "raw", value: "0 /* unsupported_expr */" };
  }

  function isOptionalChainNode(node: ts.Node): boolean {
    return !!(node as any).questionDotToken ||
      (typeof (ts as any).isOptionalChain === "function" && (ts as any).isOptionalChain(node));
  }

  function renderMemberAccessText(receiverNode: ts.Expression, memberName: string): string {
    const isThisAccess = receiverNode.kind === ts.SyntaxKind.ThisKeyword ||
      (ts.isIdentifier(receiverNode) && receiverNode.text === "this");
    if (isThisAccess) {
      if (memberName === "length") {
        return `this->size()`;
      }
      return `this->${memberName}`;
    }
    if (ts.isIdentifier(receiverNode) && pointerVars.has(receiverNode.text)) {
      return `${receiverNode.text}->${memberName}`;
    }
    if (ts.isIdentifier(receiverNode) && receiverNode.text === "Math") {
      return `std::${memberName}`;
    }
    const objectText = formatExpressionText(receiverNode);
    if (memberName === "length") {
      if (ts.isIdentifier(receiverNode) && activeCArrayVars.has(receiverNode.text)) {
        return `(sizeof(${objectText}) / sizeof(${objectText}[0]))`;
      }
      return `${objectText}.size()`;
    }
    return `${objectText}.${memberName}`;
  }

  function renderOptionalGuardedAccess(receiverNode: ts.Expression, accessText: string): string {
    const receiverText = formatExpressionText(receiverNode);
    return `(typecode_exists(${receiverText}) ? ${accessText} : 0)`;
  }

  const formatExpressionText = (node: ts.Expression): string => {
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      return formatExpressionText(node.expression);
    }

    if (ts.isParenthesizedExpression(node)) {
      return `(${formatExpressionText(node.expression)})`;
    }

    if (ts.isPropertyAccessExpression(node)) {
      const accessText = renderMemberAccessText(node.expression, node.name.text);
      if (isOptionalChainNode(node)) {
        return renderOptionalGuardedAccess(node.expression, accessText);
      }
      return accessText;
    }

    if (ts.isElementAccessExpression(node)) {
      const objectText = formatExpressionText(node.expression);
      const argumentText = node.argumentExpression ? formatExpressionText(node.argumentExpression) : "0";
      return `${objectText}[${argumentText}]`;
    }

    if (ts.isCallExpression(node)) {
      const argsText = node.arguments.map((arg) => formatExpressionText(arg)).join(", ");
      if (isOptionalChainNode(node) && ts.isPropertyAccessExpression(node.expression)) {
        const calleeText = renderMemberAccessText(node.expression.expression, node.expression.name.text);
        return renderOptionalGuardedAccess(node.expression.expression, `${calleeText}(${argsText})`);
      }
      const calleeText = formatExpressionText(node.expression);
      return `${calleeText}(${argsText})`;
    }

    if (ts.isPrefixUnaryExpression(node)) {
      return `${node.operator === ts.SyntaxKind.PlusPlusToken ? "++" : node.operator === ts.SyntaxKind.MinusMinusToken ? "--" : ts.tokenToString(node.operator) ?? ""}${formatExpressionText(node.operand)}`;
    }

    if (ts.isBinaryExpression(node)) {
      let operator = ts.tokenToString(node.operatorToken.kind) ?? node.operatorToken.getText();
      if (operator === "===") {
        operator = "==";
      } else if (operator === "!==") {
        operator = "!=";
      } else if (operator === "??") {
        // Nullish coalescing must not use truthiness semantics because 0/false
        // are valid values in TypeScript. Emit a helper call instead.
        const left = formatExpressionText(node.left);
        const right = formatExpressionText(node.right);
        return `typecode_nullish(${left}, ${right})`;
      }
      return `${formatExpressionText(node.left)} ${operator} ${formatExpressionText(node.right)}`;
    }

    return node.getText();
  };

  if (ts.isNumericLiteral(expr)) {
    const numValue = Number(expr.text);
    // Use original source text to detect float literals — TypeScript normalizes "2.0" to "2" in expr.text
    const originalText = sourceText.substring(expr.pos, expr.end).trim();
    const isFloat = /[.eE]/.test(originalText);
    return { kind: "number" as const, value: numValue, ...(isFloat ? { cppType: "float" as const } : {}) };
  }

  if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr)) {
    return expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
  }

  if (ts.isAwaitExpression(expr)) {
    return {
      kind: "await",
      value: expressionToIR(expr.expression, sourceText, diagnostics, pointerVars),
    };
  }

  // Handle 'as const' and other type assertions - unwrap and process inner expression
  if (ts.isAsExpression(expr)) {
    return expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
  }

  // Handle type assertions like (<Type>expr) - unwrap and process inner expression
  if (ts.isTypeAssertionExpression(expr)) {
    return expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
  }

  // Handle instanceof expressions (must be before generic binary expression handling)
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
    const object = expressionToIR(expr.left, sourceText, diagnostics);
    const className = expr.right.getText();
    return { kind: "instanceof", object, className };
  }

  // Detect string-bearing + chains and fold them into string_concat IR so they
  // flow through the same snprintf / std::string pipeline that template literals use.
  function isStringBearingConcatChain(e: ts.Expression): boolean {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e)) return true;
    if (
      ts.isBinaryExpression(e) &&
      e.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      return isStringBearingConcatChain(e.left) || isStringBearingConcatChain(e.right);
    }
    return false;
  }

  function flattenStringConcatParts(e: ts.Expression): ExpressionIR[] {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
      return e.text ? [{ kind: "string", value: e.text }] : [];
    }
    if (ts.isTemplateExpression(e)) {
      const nested = expressionToIR(e, sourceText, diagnostics, pointerVars);
      return nested.kind === "string_concat" ? nested.parts : [nested];
    }
    if (
      ts.isBinaryExpression(e) &&
      e.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      isStringBearingConcatChain(e)
    ) {
      return [
        ...flattenStringConcatParts(e.left),
        ...flattenStringConcatParts(e.right),
      ];
    }
    return [{ kind: "template_string", expression: expressionToIR(e, sourceText, diagnostics, pointerVars) }];
  }

  // Route string-bearing + chains into string_concat IR (same path as template literals).
  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.PlusToken &&
    isStringBearingConcatChain(expr)
  ) {
    const parts = flattenStringConcatParts(expr);
    if (parts.length === 1) return parts[0];
    return { kind: "string_concat", parts };
  }

  // Nullish coalescing: use a helper instead of truthiness so that
  // values like 0 and false are preserved correctly.
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    const left = renderExprAsText(expressionToIR(expr.left, sourceText, diagnostics, pointerVars));
    const right = renderExprAsText(expressionToIR(expr.right, sourceText, diagnostics, pointerVars));
    return { kind: "raw", value: `typecode_nullish(${left}, ${right})` };
  }

  // Recurse into binary expressions so nested typecode calls are translated correctly.
  if (ts.isBinaryExpression(expr)) {
    let operator = ts.tokenToString(expr.operatorToken.kind) ?? expr.operatorToken.getText();
    if (operator === "===") operator = "==";
    else if (operator === "!==") operator = "!=";
    return {
      kind: "binary",
      left: expressionToIR(expr.left, sourceText, diagnostics, pointerVars),
      operator,
      right: expressionToIR(expr.right, sourceText, diagnostics, pointerVars),
    };
  }

  // Preserve parenthesized expressions as a `paren` IR node so that explicit
  // grouping from the TS source is retained in the emitted C++ (e.g. `(2+3)*4`).
  if (ts.isParenthesizedExpression(expr)) {
    return { kind: "paren", inner: expressionToIR(expr.expression, sourceText, diagnostics, pointerVars) };
  }

  // Recurse into prefix unary so nested typecode calls are translated correctly.
  if (ts.isPrefixUnaryExpression(expr)) {
    const operator = ts.tokenToString(expr.operator) ?? "";
    return {
      kind: "unary",
      operator,
      operand: expressionToIR(expr.operand, sourceText, diagnostics, pointerVars),
    };
  }

  // Handle postfix unary (i++, i--) so they compose correctly in IR.
  if (ts.isPostfixUnaryExpression(expr)) {
    const operator = ts.tokenToString(expr.operator) ?? "";
    return {
      kind: "unary",
      operator,
      operand: expressionToIR(expr.operand, sourceText, diagnostics, pointerVars),
      postfix: true,
    };
  }

  if (ts.isCallExpression(expr)) {
    // Warn about optional chaining on call expressions — we preserve a null guard,
    // but the runtime semantics are still only approximate compared to TypeScript.
    if (isOptionalChainNode(expr)) {
      diagnostics.push(makeDiagnostic(
        sourceText, expr.pos,
        "Optional chaining (?.) is lowered with an approximate null guard in C++; semantics may differ from TypeScript.",
        "warning", "TS2CPP_OPTIONAL_CHAINING"
      ));
      if (ts.isPropertyAccessExpression(expr.expression)) {
        const argsText = expr.arguments
          .map(arg => renderExprAsText(expressionToIR(arg, sourceText, diagnostics, pointerVars)))
          .join(", ");
        const calleeText = renderMemberAccessText(expr.expression.expression, expr.expression.name.text);
        return {
          kind: "raw",
          value: renderOptionalGuardedAccess(expr.expression.expression, `${calleeText}(${argsText})`),
        };
      }
    }
    // ---- Debounce chain detection -------------------------------------------
    // Handle D2.onFalling(() => {...}).debounce(50) pattern
    // The outer call is .debounce(ms), inner call is the interrupt attachment
    if (ts.isPropertyAccessExpression(expr.expression) && 
        expr.expression.name.text === "debounce" &&
        expr.arguments.length === 1 &&
        ts.isCallExpression(expr.expression.expression)) {
      
      const innerCall = expr.expression.expression;
      const debounceArg = expr.arguments[0];
      let debounceMs: number | undefined;
      
      if (ts.isNumericLiteral(debounceArg)) {
        debounceMs = Number(debounceArg.text);
      }
      
      // Process the inner call (the interrupt attachment with callback)
      const innerResult = expressionToIR(innerCall, sourceText, diagnostics, pointerVars);
      
      // If the inner result is a typecode-call with a callback argument, attach debounce
      if (innerResult.kind === "typecode-call") {
        for (const arg of innerResult.args) {
          if (arg.kind === "callback" && debounceMs !== undefined) {
            arg.debounceMs = debounceMs;
          }
        }
      }
      
      return innerResult;
    }

    // ---- Fluent peripheral config chain detection ---------------------------
    // Handle UART0.config.baudRate(115200).begin() -> Serial.begin(115200)
    // Handle I2C0.config.speed(400000).begin() -> Wire.begin() + Wire.setClock()
    // Handle SPI0.config.frequency(1000000).begin() -> SPI.begin()
    // 
    // AST structure: CallExpression
    //   expression: PropertyAccessExpression (.begin)
    //     expression: CallExpression (baudRate(115200))
    //       expression: PropertyAccessExpression (.baudRate)
    //         expression: PropertyAccessExpression (.config)
    //           expression: Identifier (UART0)
    if (ts.isPropertyAccessExpression(expr.expression) && 
        expr.expression.name.text === "begin" &&
        ts.isCallExpression(expr.expression.expression)) {
      
      const innerCall = expr.expression.expression;
      const innerCallee = innerCall.expression;
      
      // Check for peripheral.config.method(value).begin() pattern
      // innerCallee should be: UART0.config.baudRate (PropertyAccessExpression)
      if (ts.isPropertyAccessExpression(innerCallee)) {
        const configMethodName = innerCallee.name.text;  // baudRate, speed, frequency
        
        // Check if innerCallee.expression is UART0.config (PropertyAccessExpression with .config)
        if (ts.isPropertyAccessExpression(innerCallee.expression) &&
            innerCallee.expression.name.text === "config") {
          
          // Get the peripheral name (UART0, I2C0, SPI0)
          const peripheralExpr = innerCallee.expression.expression;
          if (ts.isIdentifier(peripheralExpr)) {
            const peripheralName = peripheralExpr.text;
            const kind = inferKindByName(peripheralName);
            
            // Only handle peripheral types (serial, i2c, spi)
            if (kind === 'serial' || kind === 'i2c' || kind === 'spi') {
              // Extract the config value
              const configValue = innerCall.arguments.length > 0 
                ? expressionToIR(innerCall.arguments[0], sourceText, diagnostics, pointerVars)
                : undefined;
              
              // Return a typecode-call with the config value passed to begin
              return {
                kind: "typecode-call",
                receiver: peripheralName,
                receiverKind: kind,
                method: "configBegin",  // Special method that handles config + begin
                args: configValue ? [configValue] : [],
                configMethod: configMethodName,  // Pass along which config method was used
              } as any;
            }
          }
        }
      }
    }

    // ---- Tone().for() chain detection ---------------------------------------
    // Handle D3.tone(500).for(1000) pattern -> tone(pin, 500, 1000)
    // Works on all digital output pins (digital, pwm, interrupt)
    if (ts.isPropertyAccessExpression(expr.expression) && 
        expr.expression.name.text === "for" &&
        expr.arguments.length === 1 &&
        ts.isCallExpression(expr.expression.expression)) {
      
      const innerCall = expr.expression.expression;
      const durationArg = expr.arguments[0];
      
      // Check if inner call is a tone() call on any digital-capable pin
      if (ts.isPropertyAccessExpression(innerCall.expression) &&
          innerCall.expression.name.text === "tone" &&
          ts.isIdentifier(innerCall.expression.expression)) {
        
        const pinName = innerCall.expression.expression.text;
        const kind = inferKindByName(pinName);
        
        // Allow tone on digital, pwm, and interrupt pins
        if (kind === 'pwm' || kind === 'digital' || kind === 'interrupt') {
          // Build a typecode-call with toneFor method that includes duration
          const frequencyArg = innerCall.arguments[0];
          return {
            kind: "typecode-call",
            receiver: pinName,
            receiverKind: kind,
            method: "toneFor",  // Special method that emits tone(pin, freq, duration)
            args: [
              expressionToIR(frequencyArg, sourceText, diagnostics, pointerVars),
              expressionToIR(durationArg, sourceText, diagnostics, pointerVars),
            ],
          };
        }
      }
    }

    // ---- Pin factory constant-folding ---------------------------------------
    // createDigitalPin(pin, gpio), createPWMPin(pin, gpio), etc. are folded to
    // just the pin number (first argument) at compile time.
    if (ts.isIdentifier(expr.expression) && PIN_FACTORY_FUNCTIONS.has(expr.expression.text)) {
      if (expr.arguments.length >= 1 && ts.isNumericLiteral(expr.arguments[0])) {
        return { kind: "number", value: Number(expr.arguments[0].text) };
      }
    }

    // ---- Helper function constant-folding -----------------------------------
    // pinNumber(n) is folded to just the number value at compile time.
    if (ts.isIdentifier(expr.expression) && CONSTANT_FOLD_FUNCTIONS.has(expr.expression.text)) {
      if (expr.arguments.length >= 1 && ts.isNumericLiteral(expr.arguments[0])) {
        return { kind: "number", value: Number(expr.arguments[0].text) };
      }
      // Also handle nested expressions like pinNumber(someVar)
      if (expr.arguments.length >= 1) {
        return expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars);
      }
    }

    // ---- Typecode SDK method call detection (expression context) -----------
    // Detects A0.read(), D13.high(), Serial.println(), Board.A0.read(), etc.
    // and emits a structured `typecode-call` IR node instead of a raw string.
    // The emitter translates these to Arduino built-ins without regex.
    if (ts.isPropertyAccessExpression(expr.expression)) {
      const method = expr.expression.name.text;
      const receiverNode = expr.expression.expression;

      // Device accessor in expression context:
      //   spi.device(cs).transfer(x)  -> receiver: SPI0, method: device.transfer, args: [cs, x]
      //   i2c.device(addr).readByte(r) -> receiver: I2C0, method: device.readByte, args: [addr, r]
      if (
        ts.isCallExpression(receiverNode) &&
        ts.isPropertyAccessExpression(receiverNode.expression) &&
        receiverNode.expression.name.text === 'device' &&
        ts.isIdentifier(receiverNode.expression.expression)
      ) {
        const rootName = receiverNode.expression.expression.text;
        const directKind = inferKindByName(rootName);
        const busAlias = activeBusAliases.get(rootName);
        const resolvedReceiver = directKind !== 'unknown' ? rootName : busAlias?.receiver;
        const resolvedKind = directKind !== 'unknown' ? directKind : busAlias?.kind;

        if (resolvedReceiver && resolvedKind) {
          return {
            kind: "typecode-call",
            receiver: resolvedReceiver,
            receiverKind: resolvedKind,
            method: `device.${method}`,
            args: [
              ...receiverNode.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
              ...expr.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
            ],
          };
        }
      }

      // Flat interrupt API: D2.onFalling(callback), D2.onRising(callback), D2.onChange(callback)
      // Pattern: pin.onFalling(callback) where method is onFalling/onRising/onChange
      if (method === 'onFalling' || method === 'onRising' || method === 'onChange') {
        const pinName = ts.isIdentifier(receiverNode) ? receiverNode.text : null;
        if (pinName) {
          const kind = inferKindByName(pinName);
          if (kind !== 'unknown') {
            const interruptModeMap: Record<string, string> = {
              onFalling: 'FALLING',
              onRising: 'RISING',
              onChange: 'CHANGE',
            };
            return {
              kind: "typecode-call",
              receiver: pinName,
              receiverKind: kind,
              method: `attachInterrupt`,
              interruptMode: interruptModeMap[method] as "FALLING" | "RISING" | "CHANGE",
              args: expr.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
            };
          }
        }
      }

      // Flat interrupt detach API: D2.offFalling(), D2.offRising(), D2.offChange(), D2.offAll()
      if (method === 'offFalling' || method === 'offRising' || method === 'offChange' || method === 'offAll') {
        const pinName = ts.isIdentifier(receiverNode) ? receiverNode.text : null;
        if (pinName) {
          const kind = inferKindByName(pinName);
          if (kind !== 'unknown') {
            return {
              kind: "typecode-call",
              receiver: pinName,
              receiverKind: kind,
              method: `detachInterrupt`,
              interruptMode: method.toUpperCase() as "FALLING" | "RISING" | "CHANGE" | "ALL",
              args: expr.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
            };
          }
        }
      }

      // Board.A0.method() or Pins.A0.method()
      if (
        ts.isPropertyAccessExpression(receiverNode) &&
        ts.isIdentifier(receiverNode.expression) &&
        (receiverNode.expression.text === 'Board' || receiverNode.expression.text === 'Pins')
      ) {
        const pinName = receiverNode.name.text;
        const kind = inferKindByName(pinName);
        if (kind !== 'unknown') {
          return {
            kind: "typecode-call",
            receiver: pinName,
            receiverKind: kind,
            method,
            args: expr.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
          };
        }
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // CRITICAL: Fluent Peripheral API Detection
      // ═══════════════════════════════════════════════════════════════════════════
      // This helper extracts the root identifier from nested property access chains
      // like UART0.write.line() or I2C0.device(addr).write.bytes().
      //
      // DO NOT REMOVE: Without this, fluent peripheral APIs will NOT transpile:
      //   - UART0.write.line("text") → would emit raw "UART0.write.line()" 
      //   - I2C0.device(addr).read() → would emit raw "I2C0.device(addr).read()"
      //   - SPI0.config.frequency().begin() → would emit raw chain
      //
      // The correct behavior generates a `typecode-call` IR node that the emitter
      // translates to Arduino APIs (Serial.println, Wire.begin, etc.)
      //
      // See: docs/transpiler/ir-model.md - Typecode-Call IR Node
      // ═══════════════════════════════════════════════════════════════════════════
      // Helper to extract root identifier and method chain from property access
      // e.g., UART0.write.line -> { root: "UART0", chain: ["write", "line"] }
      const extractRootAndChain = (node: ts.Expression): { root: string; chain: string[] } | undefined => {
        if (ts.isIdentifier(node)) {
          return { root: node.text, chain: [] };
        }
        if (ts.isPropertyAccessExpression(node)) {
          const inner = extractRootAndChain(node.expression);
          if (inner) {
            return { root: inner.root, chain: [...inner.chain, node.name.text] };
          }
        }
        return undefined;
      };

      // symbol.method() — direct typecode symbol (A0.read(), Serial.println(), etc.)
      // Also handles nested chains like UART0.write.line() -> receiver: "UART0", method: "write.line"
      const chainInfo = extractRootAndChain(expr.expression);
      if (chainInfo) {
        const kind = inferKindByName(chainInfo.root);
        if (kind !== 'unknown') {
          // Build the full method path (e.g., "write.line" from UART0.write.line)
          const fullMethod = chainInfo.chain.length > 0
            ? chainInfo.chain.join('.')
            : method;
          return {
            kind: "typecode-call",
            receiver: chainInfo.root,
            receiverKind: kind,
            method: fullMethod,
            args: expr.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
          };
        }
        // Pin alias resolution: led.toggle() → LED.toggle()
        const aliasTarget = activePinAliases.get(chainInfo.root);
        if (aliasTarget) {
          const aliasKind = inferKindByName(aliasTarget);
          if (aliasKind !== 'unknown') {
            const fullMethod = chainInfo.chain.length > 0
              ? chainInfo.chain.join('.')
              : method;
            return {
              kind: "typecode-call",
              receiver: aliasTarget,
              receiverKind: aliasKind,
              method: fullMethod,
              args: expr.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
            };
          }
        }
        // Bus alias resolution: i2c.device() → I2C0.device()
        const busAlias = activeBusAliases.get(chainInfo.root);
        if (busAlias) {
          const fullMethod = chainInfo.chain.length > 0
            ? chainInfo.chain.join('.')
            : method;
          return {
            kind: "typecode-call",
            receiver: busAlias.receiver,
            receiverKind: busAlias.kind,
            method: fullMethod,
            args: expr.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
          };
        }
      }

      // ── Device accessor pattern detection ──────────────────────────────
      // Handle: I2C0.device(0x76).writeByte(0xFA, 0x55)
      //   or:   i2c.device(0x76).writeByte(0xFA, 0x55)  (bus alias)
      // AST: CallExpr(PropertyAccessExpr(CallExpr(PropertyAccessExpr(root, "device"), [addr]), outerMethod), [args])
      if (ts.isCallExpression(expr.expression.expression) &&
          ts.isPropertyAccessExpression(expr.expression.expression.expression)) {
        const innerCall = expr.expression.expression;
        const innerProp = expr.expression.expression.expression;
        const outerMethod = expr.expression.name.text;

        if (innerProp.name.text === 'device' && ts.isIdentifier(innerProp.expression)) {
          const rootName = innerProp.expression.text;
          const kind = inferKindByName(rootName);
          if (kind !== 'unknown') {
            return {
              kind: "typecode-call",
              receiver: rootName,
              receiverKind: kind,
              method: `device.${outerMethod}`,
              args: [
                ...innerCall.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
                ...expr.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
              ],
            };
          }
          // Bus alias resolution for device accessor
          const busAlias = activeBusAliases.get(rootName);
          if (busAlias) {
            return {
              kind: "typecode-call",
              receiver: busAlias.receiver,
              receiverKind: busAlias.kind,
              method: `device.${outerMethod}`,
              args: [
                ...innerCall.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
                ...expr.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
              ],
            };
          }
          // Pin alias resolution for device accessor
          const pinAlias = activePinAliases.get(rootName);
          if (pinAlias) {
            const aliasKind = inferKindByName(pinAlias);
            if (aliasKind !== 'unknown') {
              return {
                kind: "typecode-call",
                receiver: pinAlias,
                receiverKind: aliasKind,
                method: `device.${outerMethod}`,
                args: [
                  ...innerCall.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
                  ...expr.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
                ],
              };
            }
          }
        }
      }
    }
    // ---- end typecode detection -----------------------------------------

    if (ts.isIdentifier(expr.expression) && expr.expression.text === "defineBoardManifest" && expr.arguments.length === 1) {
      return expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars);
    }

    // Handle method calls like this.method() or obj.method()
    // Use -> for pointer variables (from 'new') and for 'this', . for value types
    let calleeText: string;
    if (ts.isPropertyAccessExpression(expr.expression)) {
      // Check if it's a this.method() call - in C++, this is a pointer so use ->
      if (expr.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
        calleeText = `this->${expr.expression.name.text}`;
      } else if (ts.isIdentifier(expr.expression.expression) && expr.expression.expression.text === "Math") {
        calleeText = `std::${expr.expression.name.text}`;
      } else {
        const objText = renderExprAsText(expressionToIR(expr.expression.expression, sourceText, diagnostics, pointerVars));
        const accessor = pointerVars.has(expr.expression.expression.getText()) ? "->" : ".";
        calleeText = `${objText}${accessor}${expr.expression.name.text}`;
      }
    } else {
      const rawText = expr.expression.getText();
      calleeText = nestedFunctionAliases.get(rawText) ?? rawText;
    }
    const argsText = expr.arguments.map(arg => renderExprAsText(expressionToIR(arg, sourceText, diagnostics, pointerVars))).join(", ");
    return { kind: "raw", value: `${calleeText}(${argsText})` };
  }

  if (ts.isNewExpression(expr)) {
    const ctorText = formatExpressionText(expr.expression);

    // Special case: new TypedArray([...]) → C++ array initializer
    const elementType = TYPED_ARRAY_ELEMENT_MAP[ctorText];
    if (elementType) {
      const args = expr.arguments ?? [];
      if (args.length === 1 && ts.isArrayLiteralExpression(args[0])) {
        const elements = args[0].elements.map(e =>
          expressionToIR(e, sourceText, diagnostics, pointerVars)
        );
        return { kind: "array", elements, elementType } as any;
      }
      // new TypedArray(n) — allocate n elements (zero-initialized)
      if (args.length === 1) {
        const sizeIR = expressionToIR(args[0], sourceText, diagnostics, pointerVars);
        const size = renderExprAsText(sizeIR);
        const count = parseInt(size, 10);
        if (!isNaN(count) && count > 0 && count <= 256) {
          // Return array IR with zero elements so var_decl renderer emits proper C array
          const zeros = Array(count).fill(0).map(() => ({ kind: "number" as const, value: 0 }));
          return { kind: "array", elements: zeros, elementType } as any;
        }
        // Dynamic size fallback — emit as raw (may not compile in all contexts)
        return { kind: "raw", value: `{${elementType}(${size})}` };
      }
    }

    const argsText = (expr.arguments ?? [])
      .map((arg) => {
        if (ts.isObjectLiteralExpression(arg)) {
          return "0";
        }
        return renderExprAsText(expressionToIR(arg, sourceText, diagnostics, pointerVars));
      })
      .join(", ");

    if (ctorText === "Error") {
      const message = expr.arguments && expr.arguments.length > 0
        ? renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars))
        : '"error"';
      return { kind: "raw", value: `std::runtime_error(${message})` };
    }

    return { kind: "raw", value: `new ${ctorText}(${argsText})` };
  }
  if (ts.isStringLiteral(expr)) {
    return { kind: "string", value: expr.text };
  }

  // Handle template literals without interpolation (simple strings)
  if (ts.isNoSubstitutionTemplateLiteral(expr)) {
    return { kind: "string", value: expr.text };
  }

  // Handle template literals with interpolation - convert to string concatenation
  if (ts.isTemplateExpression(expr)) {
    // Build a string concatenation expression from the template literal
    const parts: ExpressionIR[] = [];
    
    // Add the head text (before first interpolation)
    if (expr.head.text) {
      parts.push({ kind: "string", value: expr.head.text });
    }
    
    // Add each template span (interpolation + trailing text)
    for (const span of expr.templateSpans) {
      // Add the interpolated expression (converted to string if needed)
      const exprIR = expressionToIR(span.expression, sourceText, diagnostics, pointerVars);
      // Wrap in a template_string conversion - the emitter will handle toString conversion
      parts.push({ kind: "template_string", expression: exprIR });
      
      // Add the trailing text
      if (span.literal.text) {
        parts.push({ kind: "string", value: span.literal.text });
      }
    }
    
    // If only one part, return it directly
    if (parts.length === 1) {
      return parts[0];
    }
    
    // Build concatenation chain
    return { kind: "string_concat", parts };
  }

  if (expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.FalseKeyword) {
    return { kind: "boolean", value: expr.kind === ts.SyntaxKind.TrueKeyword };
  }

  if (ts.isIdentifier(expr)) {
    const pinAlias = activePinAliases.get(expr.text);
    if (pinAlias) {
      return { kind: "identifier", value: pinAlias };
    }
    const busAlias = activeBusAliases.get(expr.text);
    if (busAlias) {
      return { kind: "identifier", value: busAlias.receiver };
    }
    return { kind: "identifier", value: expr.text };
  }

  // Handle 'this' keyword
  if (expr.kind === ts.SyntaxKind.ThisKeyword) {
    return { kind: "raw", value: "this" };
  }

  // Handle property access expressions like obj.property or this.field
  if (ts.isPropertyAccessExpression(expr)) {
    if (isOptionalChainNode(expr)) {
      diagnostics.push(makeDiagnostic(
        sourceText, expr.pos,
        "Optional chaining (?.) is lowered with an approximate null guard in C++; semantics may differ from TypeScript.",
        "warning", "TS2CPP_OPTIONAL_CHAINING"
      ));
      const accessText = renderMemberAccessText(expr.expression, expr.name.text);
      return { kind: "raw", value: renderOptionalGuardedAccess(expr.expression, accessText) };
    }
    // ── Register bit-field read ──────────────────────────────────
    // If the object is a register class name and the property is a known
    // bit field, emit the inline bit-extract expression.
    if (ts.isIdentifier(expr.expression)) {
      const regName = expr.expression.text;
      const fieldName = expr.name.text;
      const fieldMap = registerFieldMap.get(regName);
      if (fieldMap) {
        const field = fieldMap.get(fieldName);
        if (field) {
          const mask = ((1 << field.width) - 1) >>> 0;
          const maskUL = mask + 'UL';
          if (field.lo === 0 && field.width === 1) {
            return { kind: "raw", value: `(*${regName} >> ${field.lo}) & 1UL` };
          }
          return { kind: "raw", value: `(*${regName} >> ${field.lo}) & ${maskUL}` };
        }
      }
    }

    // In C++, 'this' is a pointer, so use -> instead of .
    if (expr.expression.kind === ts.SyntaxKind.ThisKeyword) {
      return { kind: "raw", value: `this->${expr.name.text}` };
    }
    if (ts.isIdentifier(expr.expression) && expr.expression.text === "Math") {
      return { kind: "raw", value: `std::${expr.name.text}` };
    }
    const object = expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
    if (expr.name.text === "length") {
      if (ts.isIdentifier(expr.expression) && activeCArrayVars.has(expr.expression.text)) {
        const objName = renderExprAsText(object);
        return { kind: "raw", value: `(sizeof(${objName}) / sizeof(${objName}[0]))` };
      }
      return { kind: "raw", value: `${renderExprAsText(object)}.size()` };
    }
    return { kind: "property-access", object, property: expr.name.text };
  }

  // Handle element access expressions like arr[index]
  if (ts.isElementAccessExpression(expr)) {
    const object = expressionToIR(expr.expression, sourceText, diagnostics);
    const index = expressionToIR(expr.argumentExpression, sourceText, diagnostics);
    return { kind: "raw", value: `${renderExprAsText(object)}[${renderExprAsText(index)}]` };
  }

  // Handle ternary/conditional expressions: a ? b : c
  if (ts.isConditionalExpression(expr)) {
    return {
      kind: "ternary",
      condition: expressionToIR(expr.condition, sourceText, diagnostics),
      whenTrue: expressionToIR(expr.whenTrue, sourceText, diagnostics),
      whenFalse: expressionToIR(expr.whenFalse, sourceText, diagnostics),
    };
  }

  // Handle array literals
  if (ts.isArrayLiteralExpression(expr)) {
    // Check for spread element in array
    const spreadIndex = expr.elements.findIndex(e => ts.isSpreadElement(e));
    
    if (spreadIndex !== -1) {
      // Handle spread in array: [...arr, x, y] 
      // We only support spread at the beginning for now
      const spreadElement = expr.elements[spreadIndex];
      if (ts.isSpreadElement(spreadElement)) {
        const spreadExpr = expressionToIR(spreadElement.expression, sourceText, diagnostics);
        const additionalElements = expr.elements
          .slice(spreadIndex + 1)
          .map(e => expressionToIR(e, sourceText, diagnostics));
        
        // Emit as spread_array IR node
        return { 
          kind: "spread_array", 
          elementType: "auto", 
          spreadExpr, 
          additionalElements 
        };
      }
    }
    
    const elements = expr.elements.map((e) => expressionToIR(e, sourceText, diagnostics));
    // Default element type to "auto" - could be enhanced with type inference
    return { kind: "array", elementType: "auto", elements };
  }

  // Handle object literals - suppress warning for compile-time type contexts
  // Object literals in board package files are often type-asserted to pin interfaces
  // These are compile-time constructs that don't need C++ emission
  if (ts.isObjectLiteralExpression(expr)) {
    const fields: { name: string; value: ExpressionIR }[] = [];
    for (const prop of expr.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const name = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText();
        fields.push({
          name,
          value: expressionToIR(prop.initializer, sourceText, diagnostics, pointerVars),
        });
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        fields.push({
          name: prop.name.text,
          value: { kind: "identifier", value: prop.name.text },
        });
      } else if (ts.isMethodDeclaration(prop)) {
        // Method definitions like `foo() { }` in object literals
        // These are stubs in board package files - return a stub value
        const name = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText();
        fields.push({
          name,
          value: { kind: "raw", value: "/* method stub */" },
        });
      } else if (ts.isAccessor(prop)) {
        // Getters/setters in object literals - also stubs
        const name = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText();
        fields.push({
          name,
          value: { kind: "raw", value: "/* accessor stub */" },
        });
      }
    }
    // Return object IR without warning - these are handled by the emitter
    return { kind: "object", fields };
  }

  // Handle function expressions and arrow functions in compile-time contexts
  // These are stubs in board package files that get replaced by transpiler magic
  // For interrupt handlers, we need to generate a proper callback function
  if (ts.isFunctionExpression(expr) || ts.isArrowFunction(expr)) {
    // Check if this is an interrupt handler context (passed to attachInterrupt)
    // If so, we need to generate a proper callback function
    const body = expr.body;
    const statements: StatementIR[] = [];
    
    // Collect parameter names (for interrupt handlers, typically empty)
    const params: string[] = [];
    for (const param of expr.parameters) {
      if (ts.isIdentifier(param.name)) {
        params.push(param.name.text);
      }
    }
    
    // Convert body to statements
    if (ts.isBlock(body)) {
      // It's a block - convert each statement
      for (const stmt of body.statements) {
        const lowered = lowerStatement(
          stmt,
          "",
          sourceText,
          diagnostics,
          new Map(),
          new Map(),
          "<callback>",
          new Map(),
          pointerVars,
        );
        if (lowered) {
          statements.push(...lowered);
        }
      }
    } else {
      // It's an expression body - convert to return statement
      statements.push({
        kind: "return",
        sourceSpan: makeSourceSpan(body, "", sourceText),
        value: expressionToIR(body, sourceText, diagnostics, pointerVars),
      });
    }
    
    // Return a callback IR node that the emitter can handle
    return { kind: "callback", params, statements, sourceSpan: makeSourceSpan(expr, "", sourceText) };
  }

  // Handle instanceof expressions
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
    const object = expressionToIR(expr.left, sourceText, diagnostics);
    const className = expr.right.getText();
    return { kind: "instanceof", object, className };
  }

  // Handle class expressions (anonymous classes assigned to variables)
  if (ts.isClassExpression(expr)) {
    return emitUnsupportedExpression("Class expressions are unsupported in the C++ transpiler and were lowered to a placeholder.");
  }

  // Handle tagged template expressions (e.g., tag`template`)
  if (ts.isTaggedTemplateExpression(expr)) {
    return emitUnsupportedExpression("Tagged template expressions are unsupported in the C++ transpiler and were lowered to a placeholder.");
  }

  // Handle meta properties (e.g., import.meta, new.target)
  if (ts.isMetaProperty(expr)) {
    return emitUnsupportedExpression("Meta-property expressions are unsupported in the C++ transpiler and were lowered to a placeholder.");
  }

  return emitUnsupportedExpression(
    `Unsupported expression kind '${ts.SyntaxKind[expr.kind] ?? expr.kind}' was lowered to a placeholder.`,
  );
}

function calleeToText(expr: ts.LeftHandSideExpression): string {
  if (ts.isIdentifier(expr)) {
    const alias = nestedFunctionAliases.get(expr.text);
    return alias ?? expr.text;
  }

  if (ts.isPropertyAccessExpression(expr)) {
    return `${calleeToText(expr.expression as ts.LeftHandSideExpression)}.${expr.name.text}`;
  }

  return expr.getText();
}

function renderExprAsText(expr: ExpressionIR): string {
  switch (expr.kind) {
    case "number": {
      if (expr.cppType === "float" || !Number.isInteger(expr.value)) {
        const str = `${expr.value}`;
        return str.includes('.') || str.includes('e') || str.includes('E')
          ? `${str}f`
          : `${str}.0f`;
      }
      return `${expr.value}`;
    }
    case "string":
      return `"${expr.value.replace(/"/g, '\\"')}"`;
    case "boolean":
      return expr.value ? "true" : "false";
    case "identifier":
      return expr.value;
    case "raw":
      return expr.value;
    case "await":
      return renderExprAsText(expr.value);
    case "ternary":
      return `(${renderExprAsText(expr.condition)} ? ${renderExprAsText(expr.whenTrue)} : ${renderExprAsText(expr.whenFalse)})`;
    case "array":
      const elements = expr.elements.map((e) => renderExprAsText(e)).join(", ");
      return `{ ${elements} }`;
    case "object":
      const fieldValues = expr.fields.map((f) => `${renderExprAsText(f.value)}`).join(", ");
      return `{ ${fieldValues} }`;
    case "binary":
      return `${renderExprAsText(expr.left)} ${expr.operator} ${renderExprAsText(expr.right)}`;
    case "unary":
      return `${expr.operator}${renderExprAsText(expr.operand)}`;
    case "property-access":
      return `${renderExprAsText(expr.object)}.${expr.property}`;
    case "paren":
      return `(${renderExprAsText(expr.inner)})`;
    case "typecode-call":
      // Fallback text rendering used inside build-ir.ts only.
      // The real Arduino translation happens in renderExpression (cpp-emitter.ts).
      return `${expr.receiver}.${expr.method}(${expr.args.map(renderExprAsText).join(', ')})`;
    default:
      return "0 /* unsupported_expr */";
  }
}

function callToStatement(
  statementNode: ts.ExpressionStatement,
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  pointerVars: PointerTracker = new Set(),
): StatementIR {
  const comments = extractNodeComments(statementNode, sourceText);
  
  // ---- Typecode call detection at statement level -------------------------
  // Handle D13.asOutput(), D9.pwm(), D2.pullup(), etc.
  // These need to be detected as typecode-call IR nodes for proper transpilation.
  if (ts.isPropertyAccessExpression(call.expression)) {
    const extractRootAndChain = (node: ts.Expression): { root: string; chain: string[] } | undefined => {
      if (ts.isIdentifier(node)) {
        return { root: node.text, chain: [] };
      }
      if (ts.isPropertyAccessExpression(node)) {
        const inner = extractRootAndChain(node.expression);
        if (inner) {
          return { root: inner.root, chain: [...inner.chain, node.name.text] };
        }
      }
      return undefined;
    };
    
    const chainInfo = extractRootAndChain(call.expression);
    if (chainInfo) {
      const kind = inferKindByName(chainInfo.root);
      if (kind !== 'unknown') {
        // Build the full method path (e.g., "config.output" from D13.config.output)
        const fullMethod = chainInfo.chain.join('.');
        return {
          kind: "typecode-call",
          sourceSpan: makeSourceSpan(call, fileName, sourceText),
          receiver: chainInfo.root,
          receiverKind: kind,
          method: fullMethod,
          args: call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
        };
      }
      // Pin alias resolution at statement level: led.toggle() → LED.toggle()
      const aliasTarget = activePinAliases.get(chainInfo.root);
      if (aliasTarget) {
        const aliasKind = inferKindByName(aliasTarget);
        if (aliasKind !== 'unknown') {
          const fullMethod = chainInfo.chain.join('.');
          return {
            kind: "typecode-call",
            sourceSpan: makeSourceSpan(call, fileName, sourceText),
            receiver: aliasTarget,
            receiverKind: aliasKind,
            method: fullMethod,
            args: call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
          };
        }
      }
      // Bus alias resolution at statement level: i2c.device() → I2C0.device()
      const busAlias = activeBusAliases.get(chainInfo.root);
      if (busAlias) {
        const fullMethod = chainInfo.chain.join('.');
        return {
          kind: "typecode-call",
          sourceSpan: makeSourceSpan(call, fileName, sourceText),
          receiver: busAlias.receiver,
          receiverKind: busAlias.kind,
          method: fullMethod,
          args: call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
        };
      }
    }

    // ── Device accessor pattern detection at statement level ──────────
    // Handle: I2C0.device(0x76).writeByte(0xFA, 0x55)
    //   or:   i2c.device(0x76).writeByte(0xFA, 0x55)  (bus alias)
    // This MUST be outside the chainInfo block because extractRootAndChain
    // cannot traverse through intermediate CallExpression nodes.
    if (ts.isCallExpression(call.expression.expression) &&
        ts.isPropertyAccessExpression(call.expression.expression.expression)) {
      const innerCall = call.expression.expression;
      const innerProp = call.expression.expression.expression;
      const outerMethod = call.expression.name.text;

      if (innerProp.name.text === 'device' && ts.isIdentifier(innerProp.expression)) {
        const rootName = innerProp.expression.text;
        const kind = inferKindByName(rootName);
        if (kind !== 'unknown') {
          return {
            kind: "typecode-call",
            sourceSpan: makeSourceSpan(call, fileName, sourceText),
            receiver: rootName,
            receiverKind: kind,
            method: `device.${outerMethod}`,
            args: [
              ...innerCall.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
              ...call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
            ],
          };
        }
        // Bus alias resolution for device accessor
        const busAlias = activeBusAliases.get(rootName);
        if (busAlias) {
          return {
            kind: "typecode-call",
            sourceSpan: makeSourceSpan(call, fileName, sourceText),
            receiver: busAlias.receiver,
            receiverKind: busAlias.kind,
            method: `device.${outerMethod}`,
            args: [
              ...innerCall.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
              ...call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
            ],
          };
        }
        // Pin alias resolution for device accessor
        const pinAlias = activePinAliases.get(rootName);
        if (pinAlias) {
          const aliasKind = inferKindByName(pinAlias);
          if (aliasKind !== 'unknown') {
            return {
              kind: "typecode-call",
              sourceSpan: makeSourceSpan(call, fileName, sourceText),
              receiver: pinAlias,
              receiverKind: aliasKind,
              method: `device.${outerMethod}`,
              args: [
                ...innerCall.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
                ...call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
              ],
            };
          }
        }
      }
    }
  }
  
  // ---- Fluent peripheral config chain detection at statement level -------
  // Handle UART0.config.baudRate(115200).begin() -> Serial.begin(115200)
  // Handle I2C0.config.speed(400000).begin() -> Wire.begin() + Wire.setClock()
  // Handle SPI0.config.frequency(1000000).begin() -> SPI.begin()
  if (ts.isPropertyAccessExpression(call.expression) && 
      call.expression.name.text === "begin" &&
      ts.isCallExpression(call.expression.expression)) {
    
    const innerCall = call.expression.expression;
    const innerCallee = innerCall.expression;
    
    // Check for peripheral.config.method(value).begin() pattern
    if (ts.isPropertyAccessExpression(innerCallee)) {
      const configMethodName = innerCallee.name.text;  // baudRate, speed, frequency
      
      if (ts.isPropertyAccessExpression(innerCallee.expression) &&
          innerCallee.expression.name.text === "config") {
        
        const peripheralExpr = innerCallee.expression.expression;
        if (ts.isIdentifier(peripheralExpr)) {
          const peripheralName = peripheralExpr.text;
          const kind = inferKindByName(peripheralName);
          
          if (kind === 'serial' || kind === 'i2c' || kind === 'spi') {
            const configValue = innerCall.arguments.length > 0 
              ? expressionToIR(innerCall.arguments[0], sourceText, diagnostics, pointerVars)
              : undefined;
            
            return {
              kind: "typecode-call",
              sourceSpan: makeSourceSpan(call, fileName, sourceText),
              receiver: peripheralName,
              receiverKind: kind,
              method: "configBegin",
              args: configValue ? [configValue] : [],
              configMethod: configMethodName,
            } as any;
          }
        }
      }
    }
  }
  
  // ---- Debounce chain detection at statement level -----------------------
  // Handle D2.onFalling(() => {...}).debounce(50) pattern
  if (ts.isPropertyAccessExpression(call.expression) && 
      call.expression.name.text === "debounce" &&
      call.arguments.length === 1 &&
      ts.isCallExpression(call.expression.expression)) {
    
    const innerCall = call.expression.expression;
    const debounceArg = call.arguments[0];
    let debounceMs: number | undefined;
    
    if (ts.isNumericLiteral(debounceArg)) {
      debounceMs = Number(debounceArg.text);
    }
    
    // Process the inner call recursively
    const innerStmt = callToStatement(statementNode, innerCall, fileName, sourceText, diagnostics, pointerVars);
    
    // If the inner statement is a call with a callback argument, attach debounce
    if (innerStmt.kind === "call") {
      for (const arg of innerStmt.args) {
        if (arg.kind === "callback" && debounceMs !== undefined) {
          arg.debounceMs = debounceMs;
        }
      }
    }
    
    return innerStmt;
  }
  
  // Format callee, using -> for pointer variables
  let calleeText: string;
  if (ts.isPropertyAccessExpression(call.expression)) {
    const objExpr = call.expression.expression;
    if (ts.isIdentifier(objExpr) && pointerVars.has(objExpr.text)) {
      calleeText = `${objExpr.text}->${call.expression.name.text}`;
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
  );

  localVariableTypes.set(declaration.name.text, declarationType.resolvedType);

  return {
    kind: "var_decl",
    sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
    name: declaration.name.text,
    storage,
    cppType: (declarationType.resolvedType === "void" ? "auto" : declarationType.resolvedType) as Exclude<CppTypeHint, "void">,
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

function expressionStatementToIR(
  statement: ts.ExpressionStatement,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  pointerVars: PointerTracker = new Set(),
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

  // ── Register bit-field write ────────────────────────────────────────
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

function lowerStatement(
  statement: ts.Statement,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  functionNameForDiagnostics: string,
  typeAliases?: Map<string, ts.TypeNode>,
  pointerVars: PointerTracker = new Set(),
): StatementIR[] | undefined {
  if (ts.isExpressionStatement(statement)) {
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
        if (isCompileTimeOnlyMethodName(method)) {
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
      value: expressionToIR(statement.expression, sourceText, diagnostics),
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
      condition: expressionToIR(statement.expression, sourceText, diagnostics),
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
      condition: expressionToIR(statement.expression, sourceText, diagnostics),
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
        );
        initializer = loweredExpr;
      }
    }

    const condition = statement.condition
      ? expressionToIR(statement.condition, sourceText, diagnostics)
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
      iterable: expressionToIR(statement.expression, sourceText, diagnostics),
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

    return [{
      kind: "for_in",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      variable: variable!,
      object: expressionToIR(statement.expression, sourceText, diagnostics),
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
      condition: expressionToIR(statement.expression, sourceText, diagnostics),
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
          value: expressionToIR(clause.expression, sourceText, diagnostics),
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
      expression: expressionToIR(statement.expression, sourceText, diagnostics),
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
      value: expressionToIR(statement.expression, sourceText, diagnostics),
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

  // Lower the body — recursive call to lowerStatementList handles deeper nesting
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

  hoistedNestedFunctions.push({
    originalName: mangledName,
    isAsync: false,
    returnType: returnType as any,
    sourceSpan: makeSourceSpan(statement, fileName, sourceText),
    ...extractNodeComments(statement, sourceText),
    parameters,
    statements: bodyStatements,
    ...(typeParams && typeParams.length > 0 ? { typeParameters: typeParams } : {}),
  });
}

function lowerStatementList(
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

  // Phase 1: Pre-scan for nested function declarations — register aliases only.
  // This ensures sibling functions can reference each other.
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const originalName = statement.name.text;
      const safeParentName = functionNameForDiagnostics.replace(/\./g, "_");
      const mangledName = `${safeParentName}__${originalName}`;
      nestedFunctionAliases.set(originalName, mangledName);
      nestedNames.push(originalName);
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

  // Phase 3: Process remaining (non-function) statements.
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement)) {
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
    );
    if (result) {
      lowered.push(...result);
    }
  }

  // Phase 4: Clean up aliases so they don't leak to sibling scopes.
  for (const name of nestedNames) {
    nestedFunctionAliases.delete(name);
  }

  return lowered;
}

function variableStatementToIR(
  statement: ts.VariableStatement,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  typeAliases?: Map<string, ts.TypeNode>,
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
                ? { kind: "raw" as const, value: `typecode_nullish(${renderExprAsText(propAccess)}, ${renderExprAsText(expressionToIR(nestedElement.initializer, sourceText, diagnostics))})` }
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
              value: `typecode_nullish(${renderExprAsText(propAccess)}, ${renderExprAsText(expressionToIR(element.initializer, sourceText, diagnostics))})`,
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
            value: `typecode_nullish(${renderExprAsText(initializer)}, ${renderExprAsText(expressionToIR(element.initializer, sourceText, diagnostics))})`,
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

    // ── Track function-level typed array vars for .length → sizeof ──────
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

    // ── Pin alias detection ──────────────────────────────────────────────
    // Handle: const led = LED.asOutput() or const btn = D2.asInput()
    // These create compile-time-only aliases — no C++ variable is emitted.
    // The typecode-call (pinMode) is emitted as a standalone statement,
    // and the variable name is recorded for alias resolution in subsequent calls.
    const initIR = loweredDeclaration.initializer as any;
    if (initIR?.kind === 'typecode-call' &&
        typeof initIR.method === 'string' &&
        (initIR.method === 'asOutput' || initIR.method === 'asInput' || initIR.method === 'asInputPullUp')) {
      activePinAliases.set(declaration.name.text, initIR.receiver);
      lowered.push({
        kind: "typecode-call",
        sourceSpan: loweredDeclaration.sourceSpan,
        leadingComments: loweredDeclaration.leadingComments,
        trailingComments: loweredDeclaration.trailingComments,
        receiver: initIR.receiver,
        receiverKind: initIR.receiverKind,
        method: initIR.method,
        args: initIR.args || [],
      });
      continue;
    }

    // ── Ownership-handle bus alias detection ─────────────────────────────
    // Handle: const bus = I2C0.take() / SPI0.take() / UART0.take()
    // These are compile-time aliases for ownership analysis, and the emitted
    // statement remains the underlying take() call.
    if (initIR?.kind === 'typecode-call' &&
        typeof initIR.method === 'string' &&
        (initIR.method === 'take' || initIR.method === 'begin' || initIR.method === 'configBegin') &&
        (initIR.receiverKind === 'i2c' || initIR.receiverKind === 'spi' || initIR.receiverKind === 'serial')) {
      activeBusAliases.set(declaration.name.text, { receiver: initIR.receiver, kind: initIR.receiverKind });
      lowered.push({
        kind: "typecode-call",
        sourceSpan: loweredDeclaration.sourceSpan,
        leadingComments: loweredDeclaration.leadingComments,
        trailingComments: loweredDeclaration.trailingComments,
        receiver: initIR.receiver,
        receiverKind: initIR.receiverKind,
        method: initIR.method,
        args: initIR.args || [],
      });
      continue;
    }

    const declarationType = resolveDeclarationType(
      declaration.type,
      declaration.initializer,
      functionReturnTypes,
      localVariableTypes,
      typeAliases,
    );

    loweredDeclaration.cppType = (declarationType.resolvedType === "void" ? "auto" : declarationType.resolvedType) as Exclude<CppTypeHint, "void">;
    localVariableTypes.set(declaration.name.text, declarationType.resolvedType);

    // ── Ownership kind detection ────────────────────────────────────────
    // Detect Ref<T>, MutRef<T>, Owned<T> wrapper types and store the
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

// Helper to scan for pointer variables (variables initialized with 'new')
function collectPointerVars(statements: readonly ts.Statement[]): PointerTracker {
  const pointerVars = new Set<string>();
  
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
            pointerVars.add(decl.name.text);
          }
        }
      }
    }
  }
  
  return pointerVars;
}

// ---------------------------------------------------------------------------
// Pin alias tracking
// ---------------------------------------------------------------------------

// Module-level pin alias map for the current buildProgramIR invocation.
// Maps alias variable names (e.g., "led") to their original pin names (e.g., "LED").
// Reset at the start of each buildProgramIR call.
let activePinAliases: Map<string, string> = new Map();

// Module-level bus alias map for the current buildProgramIR invocation.
// Maps alias variable names (e.g., "i2c") to their original peripheral receiver info.
// Reset at the start of each buildProgramIR call.
let activeBusAliases: Map<string, { receiver: string; kind: TypecodeReceiverKind }> = new Map();

// Module-level C-array variable tracker for the current buildProgramIR invocation.
// Tracks variable names initialized with new Uint8Array([...]) (or similar typed array
// constructors) that transpile to C arrays rather than pointers. For these variables,
// .length should become sizeof(arr)/sizeof(arr[0]) instead of arr.size().
// Reset at the start of each buildProgramIR call.
let activeCArrayVars: Set<string> = new Set();

/**
 * Given a source file path and a relative import module specifier, check
 * whether the import resolves to a typecode board-definition package
 * (path pattern: /code/board-*\/index.ts).
 *
 * Returns the absolute path to the board index.ts on match, otherwise
 * undefined.
 */
function tryResolveBoardDefFile(
  fromFile: string,
  moduleSpecifier: string,
  boardPackage?: string,
): string | undefined {
  // Handle bare "@typecode" virtual import — rewrite to the concrete board
  // package so the rest of the resolution logic works unchanged.
  let effectiveSpecifier = moduleSpecifier;
  if (moduleSpecifier === "@typecode" && boardPackage) {
    effectiveSpecifier = boardPackage;
  }

  // Handle relative imports (e.g. "../code/board-arduino-uno/pins")
  if (effectiveSpecifier.startsWith(".")) {
    const dir = path.dirname(fromFile);
    const base = path.resolve(dir, moduleSpecifier);

    // Candidates: bare path, +.ts, or /index.ts
    const candidates = [
      base,
      `${base}.ts`,
      path.join(base, "index.ts"),
    ];

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      const normalized = candidate.replace(/\\/g, "/");
      if (/\/code\/board-/.test(normalized)) {
        // Always redirect to index.ts in the board package root so we parse the
        // BoardDefinition manifest regardless of which file was actually imported
        // (e.g. board.ts, pins.ts, etc.).
        const boardDir = path.dirname(candidate);
        const indexTs = path.join(boardDir, "index.ts");
        return fs.existsSync(indexTs) ? indexTs : candidate;
      }
    }
    return undefined;
  }

  // Handle npm-scoped board package imports (e.g. "@typecode/board-esp32-devkit")
  if (effectiveSpecifier.startsWith("@typecode/board-")) {
    const parts = effectiveSpecifier.split("/");
    const pkgName = parts[1]; // "board-esp32-devkit"
    // Walk up from the importing file's directory to find node_modules
    let dir = path.dirname(fromFile);
    while (true) {
      const candidate = path.join(dir, "node_modules", "@typecode", pkgName, "src", "index.ts");
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break; // reached filesystem root
      dir = parent;
    }
  }

  return undefined;
}

export function buildProgramIR(fileName: string, sourceText: string, boardPackage?: string): ProgramIR {
  const normalizedSourceText = normalizeLegacyArduinoSyntax(sourceText);
  const source = parseSource(fileName, normalizedSourceText);
  const diagnostics: Diagnostic[] = [];
  const imports: ImportIR[] = [];
  const reExports: ReExportIR[] = [];
  const topLevelStatements: StatementIR[] = [];
  const functions: FunctionIR[] = [];
  const enums: EnumIR[] = [];
  const classes: ClassIR[] = [];
  const typeAliases: TypeAliasIR[] = [];
  const interfaces: InterfaceIR[] = [];
  const namespaces: NamespaceIR[] = [];
  const registerClasses: RegisterClassIR[] = [];
  const typeAliasNodes = new Map<string, ts.TypeNode>();
  const boilerplates = new Set<string>();
  const functionReturnTypes = buildFunctionReturnTypeMap(source);
  const topLevelVariableTypes = new Map<string, CppTypeHint>();
  
  // Reset alias tracking for this file
  activePinAliases = new Map();
  activeBusAliases = new Map();
  activeCArrayVars = new Set();
  hoistedNestedFunctions = [];
  nestedFunctionAliases = new Map();
  
  // Collect pointer variables at top level (for correct -> vs . usage)
  // This also populates activeCArrayVars for typed array variables
  const topLevelPointerVars = collectPointerVars(source.statements);

  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      typeAliasNodes.set(statement.name.text, statement.type);
    }
  }

  source.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
      imports.push({
        moduleSpecifier,
        namedImports: node.importClause.namedBindings.elements.map((e) => e.name.text),
      });
      return;
    }

    // Handle re-exports: export * from "./module" or export { a, b } from "./module"
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const moduleSpecifier = node.moduleSpecifier.text;
      const exportAll = !node.exportClause || !ts.isNamedExports(node.exportClause);
      const namedExports = node.exportClause && ts.isNamedExports(node.exportClause)
        ? node.exportClause.elements.map((e) => e.name.text)
        : undefined;
      
      reExports.push({
        moduleSpecifier,
        exportAll,
        namedExports,
      });
      return;
    }

    // Handle export default statements (ExportAssignment)
    // These are compile-time constructs for board packages - skip silently
    if (ts.isExportAssignment(node)) {
      return;
    }

    // Handle namespace declarations
    if (ts.isModuleDeclaration(node)) {
      // Only handle namespace (not external modules)
      if (!node.name || !ts.isIdentifier(node.name)) {
        return;
      }
      
      // Check if this has a body (namespace block)
      if (!node.body || !ts.isModuleBlock(node.body)) {
        return;
      }
      
      const namespaceComments = extractNodeComments(node, sourceText);
      const namespaceName = node.name.text;
      
      const nsEnums: EnumIR[] = [];
      const nsClasses: ClassIR[] = [];
      const nsInterfaces: InterfaceIR[] = [];
      const nsTypeAliases: TypeAliasIR[] = [];
      const nsFunctions: FunctionIR[] = [];
      const nsConstants: { name: string; cppType: CppType; value: ExpressionIR }[] = [];
      
      // Process each statement in the namespace block
      for (const nsNode of node.body.statements) {
        // Handle nested namespaces (skip for now - could be recursive)
        if (ts.isModuleDeclaration(nsNode)) {
          continue;
        }
        
        // Handle enums in namespace
        if (ts.isEnumDeclaration(nsNode) && nsNode.name) {
          const enumComments = extractNodeComments(nsNode, sourceText);
          const isConst = nsNode.modifiers?.some(m => m.kind === ts.SyntaxKind.ConstKeyword) ?? false;
          const members: { name: string; value?: number }[] = [];
          
          let nextValue = 0;
          for (const member of nsNode.members) {
            if (ts.isIdentifier(member.name)) {
              let value: number | undefined;
              
              if (member.initializer) {
                if (ts.isNumericLiteral(member.initializer)) {
                  value = Number(member.initializer.text);
                  nextValue = value + 1;
                } else if (ts.isPrefixUnaryExpression(member.initializer) && 
                           member.initializer.operator === ts.SyntaxKind.MinusToken &&
                           ts.isNumericLiteral(member.initializer.operand)) {
                  value = -Number((member.initializer.operand as ts.NumericLiteral).text);
                  nextValue = value + 1;
                }
              } else {
                value = nextValue;
                nextValue++;
              }
              
              members.push({
                name: member.name.text,
                value,
              });
            }
          }
          
          nsEnums.push({
            name: nsNode.name.text,
            sourceSpan: makeSourceSpan(nsNode, fileName, sourceText),
            leadingComments: enumComments.leadingComments,
            trailingComments: enumComments.trailingComments,
            members,
            isConst,
          });
          continue;
        }
        
        // Handle classes in namespace
        if (ts.isClassDeclaration(nsNode) && nsNode.name) {
          // Similar to top-level class handling but add to nsClasses
          const className = nsNode.name.text;
          const classComments = extractNodeComments(nsNode, sourceText);
          const isAbstract = nsNode.modifiers?.some(m => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;
          const extendsClass = nsNode.heritageClauses
            ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
            ?.types[0]
            ?.expression
            ?.getText();
          const implementsInterfaces = nsNode.heritageClauses
            ?.find((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword)
            ?.types.map(t => t.expression?.getText())
            .filter((name): name is string => name !== undefined);
          
          const fields: ClassFieldIR[] = [];
          const methods: ClassMethodIR[] = [];
          let ctor: { parameters: ParameterIR[]; statements: StatementIR[] } | undefined;
          
          for (const member of nsNode.members) {
            if (ts.isConstructorDeclaration(member)) {
              const ctorParams: ParameterIR[] = [];
              const ctorLocalTypes = new Map<string, CppTypeHint>();
              
              for (const param of member.parameters) {
                if (ts.isIdentifier(param.name)) {
                  const paramType = typeNodeToCppType(param.type, typeAliasNodes);
                  ctorLocalTypes.set(param.name.text, paramType);
                  ctorParams.push({
                    name: param.name.text,
                    cppType: (paramType === "void" ? "auto" : paramType) as Exclude<CppTypeHint, "void">,
                    defaultValue: param.initializer
                      ? expressionToIR(param.initializer, sourceText, diagnostics)
                      : undefined,
                    isRest: false,
                  });
                }
              }
              
              const ctorBody = member.body
                ? lowerStatementList(
                    member.body.statements,
                    fileName,
                    sourceText,
                    diagnostics,
                    functionReturnTypes,
                    ctorLocalTypes,
                    `${namespaceName}.${className}.constructor`,
                    typeAliasNodes,
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
              const fieldType = typeNodeToCppType(member.type, typeAliasNodes);
              
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
                  const paramType = typeNodeToCppType(param.type, typeAliasNodes);
                  methodLocalTypes.set(param.name.text, paramType);
                  methodParams.push({
                    name: param.name.text,
                    cppType: (paramType === "void" ? "auto" : paramType) as Exclude<CppTypeHint, "void">,
                    defaultValue: param.initializer
                      ? expressionToIR(param.initializer, sourceText, diagnostics)
                      : undefined,
                    isRest: false,
                  });
                }
              }
              
              const methodBody = member.body
                ? lowerStatementList(
                    member.body.statements,
                    fileName,
                    sourceText,
                    diagnostics,
                    functionReturnTypes,
                    methodLocalTypes,
                    `${namespaceName}.${className}.${member.name.text}`,
                    typeAliasNodes,
                  )
                : [];
              const methodReturnType = typeNodeToCppType(member.type, typeAliasNodes);
              
              methods.push({
                name: member.name.text,
                returnType: (
                  member.type?.kind === ts.SyntaxKind.ThisType
                    ? `${className}*`
                    : (methodReturnType === "void" ? "void" : methodReturnType)
                ) as CppType,
                parameters: methodParams,
                statements: methodBody,
                visibility,
                isStatic,
                isAbstract: isMethodAbstract || isAbstract,
              });
            }
          }
          
          nsClasses.push({
            name: className,
            extendsClass,
            implementsInterfaces,
            isAbstract,
            sourceSpan: makeSourceSpan(nsNode, fileName, sourceText),
            leadingComments: classComments.leadingComments,
            trailingComments: classComments.trailingComments,
            fields,
            methods,
            constructor: ctor,
            getters: [],
            setters: [],
          });
          continue;
        }
        
        // Handle interfaces in namespace
        if (ts.isInterfaceDeclaration(nsNode) && nsNode.name) {
          const interfaceComments = extractNodeComments(nsNode, sourceText);
          const interfaceName = nsNode.name.text;
          const extendsInterfaces = nsNode.heritageClauses
            ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
            ?.types.map(t => t.expression?.getText())
            .filter((name): name is string => name !== undefined);
          
          const ifaceFields: InterfaceIR['fields'] = [];
          const ifaceMethods: InterfaceIR['methods'] = [];
          
          for (const member of nsNode.members) {
            if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
              const propName = member.name.text;
              const isOptional = !!member.questionToken;
              const propType = typeNodeToCppType(member.type, typeAliasNodes);
              
              ifaceFields.push({
                name: propName,
                cppType: propType,
                isOptional,
              });
              continue;
            }
            
            if (ts.isMethodSignature(member) && member.name && ts.isIdentifier(member.name)) {
              const methodName = member.name.text;
              const returnType = typeNodeToCppType(member.type, typeAliasNodes);
              const params: ParameterIR[] = [];
              
              for (const param of member.parameters) {
                if (ts.isIdentifier(param.name)) {
                  const paramType = typeNodeToCppType(param.type, typeAliasNodes);
                  params.push({
                    name: param.name.text,
                    cppType: (paramType === "void" ? "auto" : paramType) as Exclude<CppTypeHint, "void">,
                    isRest: !!param.dotDotDotToken,
                  });
                }
              }
              
              ifaceMethods.push({
                name: methodName,
                returnType,
                parameters: params,
              });
            }
          }
          
          nsInterfaces.push({
            name: interfaceName,
            sourceSpan: makeSourceSpan(nsNode, fileName, sourceText),
            leadingComments: interfaceComments.leadingComments,
            trailingComments: interfaceComments.trailingComments,
            extendsInterfaces,
            fields: ifaceFields,
            methods: ifaceMethods,
          });
          continue;
        }
        
        // Handle type aliases in namespace
        if (ts.isTypeAliasDeclaration(nsNode)) {
          if (nsNode.typeParameters && nsNode.typeParameters.length > 0) {
            continue;
          }
          const aliasComments = extractNodeComments(nsNode, sourceText);
          const cppType = typeNodeToCppType(nsNode.type, typeAliasNodes);
          nsTypeAliases.push({
            name: nsNode.name.text,
            sourceSpan: makeSourceSpan(nsNode, fileName, sourceText),
            leadingComments: aliasComments.leadingComments,
            trailingComments: aliasComments.trailingComments,
            cppType,
          });
          continue;
        }
        
        // Handle functions in namespace
        if (ts.isFunctionDeclaration(nsNode) && nsNode.name) {
          const fnComments = extractNodeComments(nsNode, sourceText);
          const isAsync = nsNode.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
          
          const localVariableTypes = new Map<string, CppTypeHint>();
          const parameters: ParameterIR[] = [];
          
          for (const parameter of nsNode.parameters) {
            if (ts.isIdentifier(parameter.name)) {
              const parameterType = typeNodeToCppType(parameter.type, typeAliasNodes);
              localVariableTypes.set(parameter.name.text, parameterType);
              const paramOwnershipKind = extractOwnershipKindFromTypeNode(parameter.type, typeAliasNodes);
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
          
          const bodyStatements = lowerStatementList(
            nsNode.body?.statements ?? [],
            fileName,
            sourceText,
            diagnostics,
            functionReturnTypes,
            localVariableTypes,
            `${namespaceName}.${nsNode.name.text}`,
            typeAliasNodes,
          );
          
          const nsFnTypeParams = nsNode.typeParameters
            ? nsNode.typeParameters.map(tp => tp.name.text)
            : undefined;
          nsFunctions.push({
            originalName: nsNode.name.text,
            isAsync,
            returnType: resolveFunctionReturnType(nsNode.name.text, functionReturnTypes),
            sourceSpan: makeSourceSpan(nsNode, fileName, sourceText),
            leadingComments: fnComments.leadingComments,
            trailingComments: fnComments.trailingComments,
            parameters,
            statements: bodyStatements,
            ...(nsFnTypeParams && nsFnTypeParams.length > 0 ? { typeParameters: nsFnTypeParams } : {}),
          });
          continue;
        }
        
        // Handle const variables in namespace
        if (ts.isVariableStatement(nsNode)) {
          const isConst = nsNode.declarationList.flags & ts.NodeFlags.Const;
          
          for (const decl of nsNode.declarationList.declarations) {
            if (ts.isIdentifier(decl.name) && decl.initializer) {
              const constType = typeNodeToCppType(decl.type, typeAliasNodes);
              nsConstants.push({
                name: decl.name.text,
                cppType: constType,
                value: expressionToIR(decl.initializer, sourceText, diagnostics),
              });
            }
          }
          continue;
        }
      }
      
      namespaces.push({
        name: namespaceName,
        sourceSpan: makeSourceSpan(node, fileName, sourceText),
        leadingComments: namespaceComments.leadingComments,
        trailingComments: namespaceComments.trailingComments,
        enums: nsEnums,
        classes: nsClasses,
        interfaces: nsInterfaces,
        typeAliases: nsTypeAliases,
        functions: nsFunctions,
        constants: nsConstants,
      });
      return;
    }

    if (ts.isFunctionDeclaration(node)) {
      // Skip overload signatures (declarations without a body).
      if (!node.body) return;

      if (!node.name) {
        diagnostics.push(makeDiagnostic(sourceText, node.pos, "Anonymous function declaration is unsupported.", "warning"));
        return;
      }

      const isAsync = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
      if (isAsync) {
        boilerplates.add("async_stub");
        diagnostics.push(
          makeDiagnostic(
            sourceText,
            node.pos,
            "Async function encountered. Added async compatibility boilerplate stub; semantics are approximate.",
            "warning",
            "TS2CPP_ASYNC_STUB",
          ),
        );
      }

      const localVariableTypes = new Map<string, CppTypeHint>();
      const parameters: ParameterIR[] = [];

      for (const parameter of node.parameters) {
        if (ts.isIdentifier(parameter.name)) {
          const parameterType = typeNodeToCppType(parameter.type, typeAliasNodes);
          localVariableTypes.set(parameter.name.text, parameterType);
          const paramOwnershipKind = extractOwnershipKindFromTypeNode(parameter.type, typeAliasNodes);
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

      const bodyStatements = lowerStatementList(
        node.body?.statements ?? [],
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        localVariableTypes,
        node.name.text,
        typeAliasNodes,
      );

      const fnTypeParams = node.typeParameters
        ? node.typeParameters.map(tp => tp.name.text)
        : undefined;
      functions.push({
        originalName: node.name.text,
        isAsync,
        returnType: resolveFunctionReturnType(node.name.text, functionReturnTypes),
        sourceSpan: makeSourceSpan(node, fileName, sourceText),
        ...extractNodeComments(node, sourceText),
        parameters,
        statements: bodyStatements,
        ...(fnTypeParams && fnTypeParams.length > 0 ? { typeParameters: fnTypeParams } : {}),
      });
      return;
    }

    if (ts.isVariableStatement(node)) {
      const functionExpressionDeclarations = node.declarationList.declarations.filter((declaration) => {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
          return false;
        }
        return ts.isFunctionExpression(declaration.initializer) || ts.isArrowFunction(declaration.initializer);
      });

      if (
        functionExpressionDeclarations.length > 0 &&
        functionExpressionDeclarations.length === node.declarationList.declarations.length
      ) {
        const declarationComments = extractNodeComments(node, sourceText);
        let commentsAssigned = false;

        for (const declaration of functionExpressionDeclarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
            continue;
          }

          const fnExpression = declaration.initializer;
          if (!ts.isFunctionExpression(fnExpression) && !ts.isArrowFunction(fnExpression)) {
            continue;
          }

          const signatureFromAlias = resolveFunctionTypeSignature(declaration.type, typeAliasNodes);
          const localVariableTypes = new Map<string, CppTypeHint>();
          const parameters: ParameterIR[] = [];

          for (let index = 0; index < fnExpression.parameters.length; index++) {
            const parameter = fnExpression.parameters[index];
            if (!ts.isIdentifier(parameter.name)) {
              continue;
            }

            const explicitParameterType = typeNodeToCppType(parameter.type, typeAliasNodes);
            const aliasedParameterType = signatureFromAlias?.parameterTypes[index] ?? "auto";
            const parameterType = explicitParameterType !== "auto" ? explicitParameterType : aliasedParameterType;

            localVariableTypes.set(parameter.name.text, parameterType);
            const paramOwnershipKind = extractOwnershipKindFromTypeNode(parameter.type, typeAliasNodes);
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

          const bodyStatements: StatementIR[] = ts.isBlock(fnExpression.body)
            ? lowerStatementList(
                fnExpression.body.statements,
                fileName,
                sourceText,
                diagnostics,
                functionReturnTypes,
                localVariableTypes,
                declaration.name.text,
                typeAliasNodes,
              )
            : [
                {
                  kind: "return" as const,
                  sourceSpan: makeSourceSpan(fnExpression.body, fileName, sourceText),
                  value: expressionToIR(fnExpression.body, sourceText, diagnostics),
                },
              ];

          const explicitReturnType = typeNodeToCppType(fnExpression.type, typeAliasNodes);
          let resolvedReturnType: CppTypeHint = explicitReturnType;

          if (resolvedReturnType === "auto" && signatureFromAlias && signatureFromAlias.returnType !== "auto") {
            resolvedReturnType = signatureFromAlias.returnType;
          }

          // Promote int → float when the function body returns float expressions
          if (resolvedReturnType === "int") {
            if (ts.isBlock(fnExpression.body)) {
              const returnTypes = collectReturns(fnExpression.body)
                .filter((item) => item.expression)
                .map((item) => inferExprCppType(item.expression as ts.Expression, functionReturnTypes, localVariableTypes, sourceText))
                .filter((item) => item !== "auto");
              if (returnTypes.includes("float")) {
                resolvedReturnType = "float";
              }
            } else {
              const inferredBodyType = inferExprCppType(fnExpression.body, functionReturnTypes, localVariableTypes, sourceText);
              if (inferredBodyType === "float") {
                resolvedReturnType = "float";
              }
            }
          }

          if (resolvedReturnType === "auto") {
            if (ts.isBlock(fnExpression.body)) {
              const returnTypes = collectReturns(fnExpression.body)
                .filter((item) => item.expression)
                .map((item) => inferExprCppType(item.expression as ts.Expression, functionReturnTypes, localVariableTypes, sourceText))
                .filter((item) => item !== "auto");

              if (returnTypes.includes("float")) {
                resolvedReturnType = "float";
              } else if (returnTypes.includes("int")) {
                resolvedReturnType = "int";
              } else if (returnTypes.includes("bool")) {
                resolvedReturnType = "bool";
              } else if (returnTypes.includes("std::string")) {
                resolvedReturnType = "std::string";
              } else if (returnTypes.length > 0) {
                resolvedReturnType = returnTypes[0];
              }
            } else {
              resolvedReturnType = inferExprCppType(fnExpression.body, functionReturnTypes, localVariableTypes, sourceText);
            }
          }

          const isAsync = fnExpression.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
          if (isAsync) {
            boilerplates.add("async_stub");
            diagnostics.push(
              makeDiagnostic(
                sourceText,
                declaration.pos,
                "Async function encountered. Added async compatibility boilerplate stub; semantics are approximate.",
                "warning",
                "TS2CPP_ASYNC_STUB",
              ),
            );
          }

          const sourceSpanTarget = fnExpression.name ?? declaration;
          functions.push({
            originalName: declaration.name.text,
            isAsync,
            returnType: resolvedReturnType === "auto" ? "void" : resolvedReturnType,
            sourceSpan: makeSourceSpan(sourceSpanTarget, fileName, sourceText),
            leadingComments: commentsAssigned ? [] : declarationComments.leadingComments,
            trailingComments: commentsAssigned ? [] : declarationComments.trailingComments,
            parameters,
            statements: bodyStatements,
          });

          functionReturnTypes.set(declaration.name.text, resolvedReturnType === "auto" ? "void" : resolvedReturnType);
          commentsAssigned = true;
        }

        return;
      }

      topLevelStatements.push(
        ...variableStatementToIR(
          node,
          fileName,
          sourceText,
          diagnostics,
          functionReturnTypes,
          topLevelVariableTypes,
          typeAliasNodes,
        ),
      );
      return;
    }

    if (ts.isExpressionStatement(node)) {
      const lowered = expressionStatementToIR(
        node,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        topLevelVariableTypes,
        topLevelPointerVars,
      );
      if (lowered) {
        topLevelStatements.push(lowered);
      }
      return;
    }

    if (ts.isClassDeclaration(node)) {
      if (!node.name) {
        return;
      }

      const className = node.name.text;

      // ── @register(addr) detection ────────────────────────────────
      // If the class has a @register(addr) decorator, create a
      // RegisterClassIR instead of a normal ClassIR and skip normal
      // class processing.
      const regAddr = getRegisterAddress(node);
      if (regAddr !== undefined) {
        const classComments = extractNodeComments(node, sourceText);
        const bitFields: RegisterClassIR['bitFields'] = [];
        for (const member of node.members) {
          if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
            const range = getBitsRange(member);
            if (range) {
              bitFields.push({
                name: member.name.text,
                hi: range.hi,
                lo: range.lo,
                width: range.hi - range.lo + 1,
              });
            }
          }
        }
        const regIR: RegisterClassIR = {
          name: className,
          address: regAddr,
          bitFields,
          sourceSpan: makeSourceSpan(node, fileName, sourceText),
          leadingComments: classComments.leadingComments,
          trailingComments: classComments.trailingComments,
        };
        registerClasses.push(regIR);
        // Build lookup map for expression rewriting
        const fieldMap = new Map<string, { hi: number; lo: number; width: number }>();
        for (const bf of bitFields) {
          fieldMap.set(bf.name, { hi: bf.hi, lo: bf.lo, width: bf.width });
        }
        registerFieldMap.set(className, fieldMap);
        return;
      }

      // Check for abstract modifier
      const isAbstract = node.modifiers?.some(m => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;
      
      const extendsClass = node.heritageClauses
        ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
        ?.types[0]
        ?.expression
        ?.getText();
      
      // Get implemented interfaces
      const implementsInterfaces = node.heritageClauses
        ?.find((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword)
        ?.types.map(t => t.expression?.getText())
        .filter((name): name is string => name !== undefined);
      const classComments = extractNodeComments(node, sourceText);
      const fields: ClassFieldIR[] = [];
      const methods: ClassMethodIR[] = [];
      let ctor: { parameters: ParameterIR[]; statements: StatementIR[] } | undefined;

      for (const member of node.members) {
        // Handle constructor
        if (ts.isConstructorDeclaration(member)) {
          const ctorParams: ParameterIR[] = [];
          const ctorLocalTypes = new Map<string, CppTypeHint>();
          
          for (const param of member.parameters) {
            if (ts.isIdentifier(param.name)) {
              const paramType = typeNodeToCppType(param.type, typeAliasNodes);
              ctorLocalTypes.set(param.name.text, paramType);
              const paramOwnershipKind = extractOwnershipKindFromTypeNode(param.type, typeAliasNodes);
              ctorParams.push({
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

          const ctorBody = member.body
            ? lowerStatementList(
                member.body.statements,
                fileName,
                sourceText,
                diagnostics,
                functionReturnTypes,
                ctorLocalTypes,
                `${className}.constructor`,
                typeAliasNodes,
              )
            : [];

          ctor = { parameters: ctorParams, statements: ctorBody };
          continue;
        }

        // Handle property declarations
        if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
          const visibility: "public" | "private" | "protected" = member.modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)
            ? "private"
            : member.modifiers?.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)
              ? "protected"
              : "public";
          
          const isStatic = member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
          const fieldType = typeNodeToCppType(member.type, typeAliasNodes);
          
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

        // Handle method declarations
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
              const paramType = typeNodeToCppType(param.type, typeAliasNodes);
              methodLocalTypes.set(param.name.text, paramType);
              const paramOwnershipKind = extractOwnershipKindFromTypeNode(param.type, typeAliasNodes);
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
                member.body.statements,
                fileName,
                sourceText,
                diagnostics,
                functionReturnTypes,
                methodLocalTypes,
                `${className}.${member.name.text}`,
                typeAliasNodes,
              )
            : [];
          const methodReturnType = typeNodeToCppType(member.type, typeAliasNodes);

          methods.push({
            name: member.name.text,
            returnType: (
              member.type?.kind === ts.SyntaxKind.ThisType
                ? `${className}*`
                : (methodReturnType === "void" ? "void" : methodReturnType)
            ) as CppType,
            parameters: methodParams,
            statements: methodBody,
            visibility,
            isStatic,
            isAbstract: isMethodAbstract || isAbstract,
          });
        }
      }

      classes.push({
        name: className,
        extendsClass,
        implementsInterfaces,
        isAbstract,
        sourceSpan: makeSourceSpan(node, fileName, sourceText),
        leadingComments: classComments.leadingComments,
        trailingComments: classComments.trailingComments,
        fields,
        methods,
        constructor: ctor,
        getters: [],
        setters: [],
      });
      return;
    }

    // Handle enum declarations
    if (ts.isEnumDeclaration(node)) {
      if (!node.name) {
        return;
      }

      const enumComments = extractNodeComments(node, sourceText);
      const isConst = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ConstKeyword) ?? false;
      const members: { name: string; value?: number }[] = [];
      
      let nextValue = 0;
      for (const member of node.members) {
        if (ts.isIdentifier(member.name)) {
          let value: number | undefined;
          
          if (member.initializer) {
            if (ts.isNumericLiteral(member.initializer)) {
              value = Number(member.initializer.text);
              nextValue = value + 1;
            } else if (ts.isPrefixUnaryExpression(member.initializer) && 
                       member.initializer.operator === ts.SyntaxKind.MinusToken &&
                       ts.isNumericLiteral(member.initializer.operand)) {
              value = -Number((member.initializer.operand as ts.NumericLiteral).text);
              nextValue = value + 1;
            }
          } else {
            value = nextValue;
            nextValue++;
          }
          
          members.push({
            name: member.name.text,
            value,
          });
        }
      }

      enums.push({
        name: node.name.text,
        sourceSpan: makeSourceSpan(node, fileName, sourceText),
        leadingComments: enumComments.leadingComments,
        trailingComments: enumComments.trailingComments,
        members,
        isConst,
      });
      return;
    }

  // Handle interface declarations
    if (ts.isInterfaceDeclaration(node)) {
      if (!node.name) {
        return;
      }

      const interfaceComments = extractNodeComments(node, sourceText);
      const interfaceName = node.name.text;
      
      // Get extended interfaces
      const extendsInterfaces = node.heritageClauses
        ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
        ?.types.map(t => t.expression?.getText())
        .filter((name): name is string => name !== undefined);
      
      const fields: InterfaceIR['fields'] = [];
      const methods: InterfaceIR['methods'] = [];
      
      for (const member of node.members) {
        // Handle property signatures
        if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
          const propName = member.name.text;
          const isOptional = !!member.questionToken;
          const propType = typeNodeToCppType(member.type, typeAliasNodes);
          
          fields.push({
            name: propName,
            cppType: propType,
            isOptional,
          });
          continue;
        }
        
        // Handle method signatures
        if (ts.isMethodSignature(member) && member.name && ts.isIdentifier(member.name)) {
          const methodName = member.name.text;
          const returnType = typeNodeToCppType(member.type, typeAliasNodes);
          const params: ParameterIR[] = [];
          
          for (const param of member.parameters) {
            if (ts.isIdentifier(param.name)) {
              const paramType = typeNodeToCppType(param.type, typeAliasNodes);
              params.push({
                name: param.name.text,
                cppType: (paramType === "void" ? "auto" : paramType) as Exclude<CppTypeHint, "void">,
                isRest: !!param.dotDotDotToken,
              });
            }
          }
          
          methods.push({
            name: methodName,
            returnType,
            parameters: params,
          });
        }
      }
      
      // Store the interface for type checking (no C++ output - interfaces are TypeScript-only)
      interfaces.push({
        name: interfaceName,
        sourceSpan: makeSourceSpan(node, fileName, sourceText),
        leadingComments: interfaceComments.leadingComments,
        trailingComments: interfaceComments.trailingComments,
        extendsInterfaces,
        fields,
        methods,
      });
      return;
    }

    // Handle type alias declarations
    if (ts.isTypeAliasDeclaration(node)) {
      if (node.typeParameters && node.typeParameters.length > 0) {
        return;
      }
      const aliasComments = extractNodeComments(node, sourceText);
      const cppType = typeNodeToCppType(node.type, typeAliasNodes);
      typeAliases.push({
        name: node.name.text,
        sourceSpan: makeSourceSpan(node, fileName, sourceText),
        leadingComments: aliasComments.leadingComments,
        trailingComments: aliasComments.trailingComments,
        cppType,
      });
      return;
    }

    if (node.kind === ts.SyntaxKind.EndOfFileToken) {
      return;
    }

    // General fallthrough: lower any remaining statement types (while, for,
    // if, switch, do-while, etc.) that appear at the top level directly.
    {
      const lowered = lowerStatement(
        node as ts.Statement,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        topLevelVariableTypes,
        "<top-level>",
        typeAliasNodes,
        topLevelPointerVars,
      );
      if (lowered) {
        topLevelStatements.push(...lowered);
        return;
      }
    }

    diagnostics.push(
      makeDiagnostic(
        normalizedSourceText,
        node.pos,
        "Top-level node currently unsupported and skipped.",
        "warning",
        "TS2CPP_UNSUPPORTED_TOPLEVEL",
      ),
    );
  });

  // Collect any nested functions that were hoisted during IR building
  functions.push(...hoistedNestedFunctions);

  // Resolve board-definition constants from the actual board package file.
  // This replaces the old hard-coded ARDUINO_BOARD_METADATA table in
  // typecode-map.ts so that Board.definition.* folds to the real values.
  let boardConstants: BoardConstants | undefined;
  for (const imp of imports) {
    const boardFile = tryResolveBoardDefFile(fileName, imp.moduleSpecifier, boardPackage);
    if (boardFile) {
      try {
        boardConstants = resolveBoardConstants(boardFile);
      } catch {
        // Non-fatal: missing or malformed board file — fall back to no-fold.
      }
      break;
    }
  }

  // Analyze peripheral usage for optimization
  let peripheralUsage: PeripheralUsage;
  try {
    peripheralUsage = analyzePeripheralUsage({
      fileName,
      imports,
      reExports,
      structs: [],
      enums,
      classes,
      typeAliases,
      topLevelStatements,
      functions,
      boilerplates,
      diagnostics,
      registerClasses,
      boardConstants,
      interfaces,
      namespaces,
    });

    const program: ProgramIR = {
      fileName,
      imports,
      reExports,
      structs: [],
      enums,
      classes,
      typeAliases,
      registerClasses,
      topLevelStatements,
      functions,
      boilerplates,
      diagnostics,
      boardConstants,
      peripheralUsage,
      interfaces,
      namespaces,
    };

    diagnostics.push(...runProgramValidations(program));
  } catch (e) {
    // If peripheral analysis fails, use empty usage
    peripheralUsage = createEmptyPeripheralUsage();
  }

  return {
    fileName,
    imports,
    reExports,
    structs: [],
    enums,
    classes,
    typeAliases,
    registerClasses,
    topLevelStatements,
    functions,
    boilerplates,
    diagnostics,
    boardConstants,
    peripheralUsage,
    interfaces,
    namespaces,
  };
}
