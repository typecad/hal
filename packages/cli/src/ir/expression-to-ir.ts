import ts from "typescript";
import { Diagnostic } from "../types";
import { ExpressionIR, StatementIR } from "./model";
import { makeDiagnostic, makeSourceSpan } from "./ast-node-utils";
import { inferKindByName } from "./typecode-symbols";
import { parsePinNumber } from "./peripheral-usage";
import { PointerTracker, PIN_FACTORY_FUNCTIONS, CONSTANT_FOLD_FUNCTIONS, TYPED_ARRAY_ELEMENT_MAP, activePinAliases, activeBusAliases, activeCArrayVars, activeArrayLiteralVars, activeStringVars, nestedFunctionAliases, nestedClassAliases, registerFieldMap, hoistedNestedClasses, mutableArrayVars, arrayLiteralSizes, filteredArrayLengthVars, activeNamespaceNames, activeLocalTypes, topLevelClassNames, topLevelClasses } from "./build-ir-state";
import { renderExprAsText } from "./render-expr";
import { lowerStatement } from "./statement-to-ir";
import { escapeCppKeyword } from "../utils/strings";
import { extractRootAndChain } from "./ast-patterns";

export function expressionToIR(expr: ts.Expression, sourceText: string, diagnostics: Diagnostic[], pointerVars: PointerTracker = new Map()): ExpressionIR {
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

  /**
   * Resolve .length property access to the correct C++ expression.
   * Shared by both renderMemberAccessText and the main PropertyAccess handler
   * to ensure consistent behavior for top-level and nested .length access.
   *
   * Returns the C++ text. Special case: returns the filteredArrayLengthVars
   * variable name prefixed with "__FILTERED_LEN__" so the caller can detect it.
   */
  function resolveLengthProperty(receiverNode: ts.Expression, objectText: string): string {
    // Escape C++ keywords in identifier texts for generated C++ output
    const safeText = ts.isIdentifier(receiverNode) ? escapeCppKeyword(objectText) : objectText;
    if (ts.isIdentifier(receiverNode) && filteredArrayLengthVars.has(receiverNode.text)) {
      return `__FILTERED_LEN__${filteredArrayLengthVars.get(receiverNode.text)!}`;
    }
    if (ts.isIdentifier(receiverNode) && mutableArrayVars.has(receiverNode.text)) {
      return `${safeText}.size()`;
    }
    if (ts.isIdentifier(receiverNode) && activeCArrayVars.has(receiverNode.text)) {
      return `(sizeof(${safeText}) / sizeof(${safeText}[0]))`;
    }
    if (ts.isIdentifier(receiverNode) && activeArrayLiteralVars.has(receiverNode.text)) {
      const varType = activeLocalTypes.get(receiverNode.text);
      if (typeof varType === 'string' && (varType.startsWith('std::vector<') || varType.startsWith('StaticArray<'))) {
        return `${safeText}.size()`;
      }
      return `(sizeof(${safeText}) / sizeof(${safeText}[0]))`;
    }
    if (ts.isIdentifier(receiverNode) && activeLocalTypes.get(receiverNode.text) === "auto") {
      return `(sizeof(${safeText}) / sizeof(${safeText}[0]))`;
    }
    if (ts.isCallExpression(receiverNode)) {
      return `strlen(${safeText})`;
    }
    if (ts.isIdentifier(receiverNode) && activeStringVars.has(receiverNode.text)) {
      return `strlen(${safeText})`;
    }
    // const char* / char* variables → strlen()
    if (ts.isIdentifier(receiverNode)) {
      const varType = activeLocalTypes.get(receiverNode.text);
      if (varType === "const char*" || varType === "char*") {
        return `strlen(${safeText})`;
      }
      if (varType === "std::string") {
        return `${safeText}.size()`;
      }
    }
    // Handle this->field.length where field is a string (const char*)
    if (ts.isPropertyAccessExpression(receiverNode) && receiverNode.expression.kind === ts.SyntaxKind.ThisKeyword) {
      return `strlen(${safeText})`;
    }
    return `${safeText}.size()`;
  }

  function renderMemberAccessText(receiverNode: ts.Expression, memberName: string): string {
    const escapedName = escapeCppKeyword(memberName);
    const isThisAccess = receiverNode.kind === ts.SyntaxKind.ThisKeyword ||
      (ts.isIdentifier(receiverNode) && receiverNode.text === "this");
    if (isThisAccess) {
      if (memberName === "length") {
        return `this->size()`;
      }
      return `this->${escapedName}`;
    }
    if (ts.isIdentifier(receiverNode) && pointerVars.has(receiverNode.text)) {
      return `${receiverNode.text}->${escapedName}`;
    }
    if (ts.isIdentifier(receiverNode) && receiverNode.text === "Math") {
      return `std::${escapedName}`;
    }
    if (ts.isIdentifier(receiverNode) && activeNamespaceNames.has(receiverNode.text)) {
      return `${receiverNode.text}::${escapedName}`;
    }
    const objectText = formatExpressionText(receiverNode);
    // Detect if receiver is a method call that returns a pointer (for chaining)
    if (ts.isCallExpression(receiverNode) && ts.isPropertyAccessExpression(receiverNode.expression)) {
      const innerReceiver = receiverNode.expression.expression;
      const innerMethodName = receiverNode.expression.name.text;
      if (ts.isIdentifier(innerReceiver) && pointerVars.has(innerReceiver.text)) {
        let className = pointerVars.get(innerReceiver.text)!;
        className = nestedClassAliases.get(className) ?? className;
        const cls = hoistedNestedClasses.find(c => c.name === className);
        const chainMethod = cls?.methods.find(m => m.name === innerMethodName);
        if (chainMethod && (chainMethod.returnType as string).endsWith("*")) {
          return `${objectText}->${escapedName}`;
        }
      }
    }
    if (memberName === "length" || memberName === "size") {
      const resolved = resolveLengthProperty(receiverNode, objectText);
      // Filtered length vars use a special prefix — extract the variable name
      if (resolved.startsWith("__FILTERED_LEN__")) {
        return resolved.slice("__FILTERED_LEN__".length);
      }
      return resolved;
    }
    return `${objectText}.${escapedName}`;
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
    // Use original source text to detect float literals â€” TypeScript normalizes "2.0" to "2" in expr.text
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
    if (ts.isIdentifier(e) && (activeStringVars.has(e.text) || activeLocalTypes.get(e.text) === "std::string")) return true;
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

  // Handle typeof expressions — at transpile time, typeof on a known variable
  // can be resolved. For typeof x === "number", the binary handler will compare.
  // Standalone typeof x emits a type-name string literal.
  if (ts.isTypeOfExpression(expr)) {
    const operand = expr.expression;
    if (ts.isIdentifier(operand)) {
      const varType = activeLocalTypes.get(operand.text);
      const typeName = varType === "int" || varType === "float" || varType === "double" || varType === "long" || varType === "unsigned" || varType === "size_t"
        ? "number"
        : varType === "bool"
          ? "boolean"
          : varType === "std::string"
            ? "string"
            : varType === "void"
              ? "undefined"
              : "object";
      return { kind: "string", value: typeName };
    }
    // typeof on a literal — resolve from the literal itself
    if (ts.isNumericLiteral(operand)) return { kind: "string", value: "number" };
    if (ts.isStringLiteral(operand) || ts.isNoSubstitutionTemplateLiteral(operand)) return { kind: "string", value: "string" };
    if (operand.kind === ts.SyntaxKind.TrueKeyword || operand.kind === ts.SyntaxKind.FalseKeyword) return { kind: "string", value: "boolean" };
    return { kind: "raw", value: `/* typeof */` };
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
    // Warn about optional chaining on call expressions â€” we preserve a null guard,
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

    // ---- Array method translation for mutable arrays (StaticArray) -----------
    // Translate push → push_back, pop → pop_back, indexOf → indexOf at the expression level.
    if (ts.isPropertyAccessExpression(expr.expression) &&
        ts.isIdentifier(expr.expression.expression) &&
        mutableArrayVars.has(expr.expression.expression.text)) {
      const arrName = expr.expression.expression.text;
      const methodName = expr.expression.name.text;
      if (methodName === "pop") {
        return { kind: "raw", value: `${arrName}.pop_back()` };
      }
      if (methodName === "push") {
        const argsText = expr.arguments.map(arg => renderExprAsText(expressionToIR(arg, sourceText, diagnostics, pointerVars))).join(", ");
        return { kind: "raw", value: `${arrName}.push_back(${argsText})` };
      }
      if (methodName === "indexOf") {
        const argsText = expr.arguments.map(arg => renderExprAsText(expressionToIR(arg, sourceText, diagnostics, pointerVars))).join(", ");
        return { kind: "raw", value: `${arrName}.indexOf(${argsText})` };
      }
    }

    // ---- String indexOf wrapping (const char* needs String() on Arduino) ---
    if (ts.isPropertyAccessExpression(expr.expression) &&
        ts.isIdentifier(expr.expression.expression) &&
        expr.expression.name.text === "indexOf" &&
        !mutableArrayVars.has(expr.expression.expression.text) &&
        !activeCArrayVars.has(expr.expression.expression.text)) {
      const varName = expr.expression.expression.text;
      const argsText = expr.arguments.map(arg => renderExprAsText(expressionToIR(arg, sourceText, diagnostics, pointerVars))).join(", ");
      return { kind: "raw", value: `String(${varName}).indexOf(${argsText})` };
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

      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      // CRITICAL: Fluent Peripheral API Detection
      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      // This helper extracts the root identifier from nested property access chains
      // like UART0.write.line() or I2C0.device(addr).write.bytes().
      //
      // DO NOT REMOVE: Without this, fluent peripheral APIs will NOT transpile:
      //   - UART0.write.line("text") â†’ would emit raw "UART0.write.line()" 
      //   - I2C0.device(addr).read() â†’ would emit raw "I2C0.device(addr).read()"
      //   - SPI0.config.frequency().begin() â†’ would emit raw chain
      //
      // The correct behavior generates a `typecode-call` IR node that the emitter
      // translates to Arduino APIs (Serial.println, Wire.begin, etc.)
      //
      // See: docs/transpiler/ir-model.md - Typecode-Call IR Node
      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      // symbol.method() â€” direct typecode symbol (A0.read(), Serial.println(), etc.)
      // Also handles nested chains like UART0.write.line() -> receiver: "UART0", method: "write.line"
      const chainInfo = extractRootAndChain(expr.expression);
      if (chainInfo) {
        const fullMethod = chainInfo.chain.length > 0
          ? chainInfo.chain.join('.')
          : method;
        const kind = inferKindByName(chainInfo.root);
        const pinMethodCandidates = new Set([
          'asInput', 'asInputPullUp', 'asOutput',
          'pullup', 'pulldown', 'float',
          'onFalling', 'onRising', 'onChange', 'onLow', 'onHigh',
          'offFalling', 'offRising', 'offChange', 'offAll',
          'read', 'high', 'low', 'toggle', 'write', 'pulse',
          'isHigh', 'isLow', 'getMode', 'setMode', 'inputPullUp', 'inputPullDown',
          'tone', 'toneFor', 'noTone',
          'readAnalog', 'readVoltage', 'getResolution', 'setReference',
          'setDutyCycle', 'setFrequency',
        ]);

        // Pin alias resolution: led.toggle() → LED.toggle()
        const aliasTarget = activePinAliases.get(chainInfo.root);
        if (aliasTarget) {
          const originalAliasKind = inferKindByName(aliasTarget);
          let aliasKind = originalAliasKind;
          if (aliasKind === 'unknown' && pinMethodCandidates.has(fullMethod)) {
            aliasKind = 'digital';
          }
          if (originalAliasKind !== 'unknown') {
            return {
              kind: "typecode-call",
              receiver: aliasTarget,
              receiverKind: aliasKind,
              method: fullMethod,
              args: expr.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
            };
          }
          return {
            kind: "typecode-call",
            receiver: chainInfo.root,
            receiverKind: aliasKind,
            method: fullMethod,
            args: expr.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
          };
        }

        if (kind !== 'unknown') {
          return {
            kind: "typecode-call",
            receiver: chainInfo.root,
            receiverKind: kind,
            method: fullMethod,
            args: expr.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
          };
        }

        // Unknown symbols may still represent a pin-like object that is passed in
        // as a parameter. Recognize the pin configuration and interrupt APIs
        // even when the identifier cannot be resolved statically.
        const safePinMethods = new Set([
          'asInput', 'asInputPullUp', 'asOutput',
          'pullup', 'pulldown', 'float',
          'onFalling', 'onRising', 'onChange', 'onLow', 'onHigh',
          'offFalling', 'offRising', 'offChange', 'offAll',
        ]);
        if (safePinMethods.has(fullMethod)) {
          return {
            kind: "typecode-call",
            receiver: chainInfo.root,
            receiverKind: 'digital',
            method: fullMethod,
            args: expr.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
          };
        }

        // Do not assume unknown symbols with pin-like method names are digital pins.
        // This prevents class/static methods like AddrLib.read() from being miscompiled.
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

      // â”€â”€ Device accessor pattern detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                receiver: rootName,
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
      const receiver = expr.expression.expression;
      const methodName = escapeCppKeyword(expr.expression.name.text);
      // Check if it's a this.method() call - in C++, this is a pointer so use ->
      if (receiver.kind === ts.SyntaxKind.ThisKeyword) {
        calleeText = `this->${methodName}`;
      } else if (ts.isIdentifier(receiver) && receiver.text === "Math") {
        const mathMethod = expr.expression.name.text;
        calleeText = `std::${mathMethod}`;
      } else if (ts.isIdentifier(receiver) && (hoistedNestedClasses.some(c => c.name === receiver.text) || nestedClassAliases.has(receiver.text) || topLevelClassNames.has(receiver.text))) {
        // Static method call on a hoisted or top-level class: use :: with resolved name
        const resolvedName = nestedClassAliases.get(receiver.text) ?? receiver.text;
        calleeText = `${resolvedName}::${methodName}`;
      } else if (ts.isIdentifier(receiver) && activeNamespaceNames.has(receiver.text)) {
        // Namespace method call: use ::
        calleeText = `${receiver.text}::${methodName}`;
      } else {
        const objText = renderExprAsText(expressionToIR(receiver, sourceText, diagnostics, pointerVars));
        let accessor = ".";
        if (ts.isIdentifier(receiver) && pointerVars.has(receiver.text)) {
          accessor = "->";
        } else if (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression)) {
          const innerReceiver = receiver.expression.expression;
          const innerMethodName = receiver.expression.name.text;
          if (ts.isIdentifier(innerReceiver) && pointerVars.has(innerReceiver.text)) {
            // Check if the inner method returns a pointer type (for method chaining)
            let className = pointerVars.get(innerReceiver.text);
            // Resolve nested class aliases (e.g., "Builder" → "__tc_fn6__Builder")
            if (className) className = nestedClassAliases.get(className) ?? className;
            const cls = className ? hoistedNestedClasses.find(c => c.name === className) : undefined;
            const chainMethod = cls?.methods.find(m => m.name === innerMethodName);
            if (chainMethod && (chainMethod.returnType as string).endsWith("*")) {
              accessor = "->";
            }
          } else if (ts.isIdentifier(innerReceiver) && topLevelClassNames.has(innerReceiver.text)) {
            // Static method call on a top-level class returning a pointer
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
        }
        calleeText = `${objText}${accessor}${methodName}`;
      }
    } else {
      const rawText = expr.expression.getText();
      calleeText = nestedFunctionAliases.get(rawText) ?? rawText;
    }
    const argIRs = expr.arguments.map(arg => expressionToIR(arg, sourceText, diagnostics, pointerVars));
    // Preserve structured IR when args contain callbacks/lambdas so the emitter can hoist them
    if (argIRs.some(arg => arg.kind === "callback" || arg.kind === "lambda")) {
      return { kind: "method-call", callee: calleeText, args: argIRs } as any;
    }
    const argsText = argIRs.map(arg => renderExprAsText(arg)).join(", ");
    return { kind: "raw", value: `${calleeText}(${argsText})` };
  }

  if (ts.isNewExpression(expr)) {
    const ctorText = formatExpressionText(expr.expression);

    // Special case: new TypedArray([...]) â†’ C++ array initializer
    const elementType = TYPED_ARRAY_ELEMENT_MAP[ctorText];
    if (elementType) {
      const args = expr.arguments ?? [];
      if (args.length === 1 && ts.isArrayLiteralExpression(args[0])) {
        const elements = args[0].elements.map(e =>
          expressionToIR(e, sourceText, diagnostics, pointerVars)
        );
        return { kind: "array", elements, elementType } as any;
      }
      // new TypedArray(n) â€” allocate n elements (zero-initialized)
      if (args.length === 1) {
        const sizeIR = expressionToIR(args[0], sourceText, diagnostics, pointerVars);
        const size = renderExprAsText(sizeIR);
        const count = parseInt(size, 10);
        if (!isNaN(count) && count > 0 && count <= 256) {
          // Return array IR with zero elements so var_decl renderer emits proper C array
          const zeros = Array(count).fill(0).map(() => ({ kind: "number" as const, value: 0 }));
          return { kind: "array", elements: zeros, elementType } as any;
        }
        // Dynamic size fallback â€” emit as raw (may not compile in all contexts)
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

    const resolvedCtorText = nestedClassAliases.get(ctorText) ?? ctorText;
    return { kind: "raw", value: `new ${resolvedCtorText}(${argsText})` };
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

  // Handle null keyword
  if (expr.kind === ts.SyntaxKind.NullKeyword) {
    return { kind: "raw", value: "nullptr" };
  }

  if (ts.isIdentifier(expr)) {
    const pinAlias = activePinAliases.get(expr.text);
    if (pinAlias) {
      const aliasKind = inferKindByName(pinAlias);
      if (aliasKind === 'unknown') {
        return { kind: "identifier", value: expr.text };
      }
      return { kind: "identifier", value: pinAlias };
    }
    const busAlias = activeBusAliases.get(expr.text);
    if (busAlias) {
      return { kind: "identifier", value: busAlias.receiver };
    }
    // Resolve typecode pin identifiers to their numeric values when used as plain values
    const kind = inferKindByName(expr.text);
    if (kind === 'digital' || kind === 'interrupt' || kind === 'pwm' || kind === 'analog-input') {
      const pinNum = parsePinNumber(expr.text);
      if (pinNum !== null) {
        return { kind: "number", value: pinNum };
      }
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
    // â”€â”€ Register bit-field read â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      return { kind: "raw", value: `this->${escapeCppKeyword(expr.name.text)}` };
    }
    if (ts.isIdentifier(expr.expression) && expr.expression.text === "Math") {
      return { kind: "raw", value: `std::${escapeCppKeyword(expr.name.text)}` };
    }
    // Use -> for pointer variables in property access
    if (ts.isIdentifier(expr.expression) && pointerVars.has(expr.expression.text)) {
      return { kind: "raw", value: `${expr.expression.text}->${escapeCppKeyword(expr.name.text)}` };
    }
    const object = expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
    if (expr.name.text === "length") {
      const objectText = renderExprAsText(object);
      const resolved = resolveLengthProperty(expr.expression, objectText);
      if (resolved.startsWith("__FILTERED_LEN__")) {
        return { kind: "identifier", value: resolved.slice("__FILTERED_LEN__".length) };
      }
      return { kind: "raw", value: resolved };
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
      const spreadElement = expr.elements[spreadIndex];
      if (ts.isSpreadElement(spreadElement)) {
        // If spread source is a known-size array variable, expand inline
        if (ts.isIdentifier(spreadElement.expression) && arrayLiteralSizes.has(spreadElement.expression.text)) {
          const srcName = spreadElement.expression.text;
          const srcSize = arrayLiteralSizes.get(srcName)!;
          const expandedElements: ExpressionIR[] = [];
          for (let i = 0; i < srcSize; i++) {
            expandedElements.push({ kind: "raw", value: `${srcName}[${i}]` });
          }
          for (const elem of expr.elements.slice(spreadIndex + 1)) {
            expandedElements.push(expressionToIR(elem, sourceText, diagnostics));
          }
          return { kind: "array", elementType: "auto", elements: expandedElements };
        }
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