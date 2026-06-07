import ts from "typescript";
import { Diagnostic } from "../types";
import { ExpressionIR, StatementIR } from "../api";
import { makeDiagnostic, makeSourceSpan } from "./ast-node-utils";
import { PointerTracker, PIN_FACTORY_FUNCTIONS, CONSTANT_FOLD_FUNCTIONS, TYPED_ARRAY_ELEMENT_MAP, activeCArrayVars, activeArrayLiteralVars, activeStringVars, nestedFunctionAliases, nestedClassAliases, registerFieldMap, hoistedNestedClasses, mutableArrayVars, arrayLiteralSizes, filteredArrayLengthVars, activeNamespaceNames, activeEnumNames, activeLocalTypes, activeGlobalTypes, topLevelClassNames, topLevelClasses, getActiveExtendsClass } from "./build-ir-state";
import { renderExprAsText } from "./render-expr";
import { lowerStatement, tryResolveHALExpression } from "./statement-to-ir";
import { halInstances } from "./hal-resolver";
import { escapeCppKeyword } from "../utils/strings";
import { tryLowerRegisterRead } from "./transformers/register-assignment";
import { tryLowerArrayAndStringMethods } from "./transformers/array-methods";

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
      return `${safeText}.length()`;
    }
    if (ts.isIdentifier(receiverNode) && activeCArrayVars.has(receiverNode.text)) {
      return `(sizeof(${safeText}) / sizeof(${safeText}[0]))`;
    }
    if (ts.isIdentifier(receiverNode) && activeArrayLiteralVars.has(receiverNode.text)) {
      const varType = activeLocalTypes.get(receiverNode.text);
      if (typeof varType === 'string' && (varType.startsWith('std::vector<') || varType.startsWith('StaticArray<'))) {
        return `${safeText}.length()`;
      }
      return `(sizeof(${safeText}) / sizeof(${safeText}[0]))`;
    }
    if (ts.isIdentifier(receiverNode) && activeLocalTypes.get(receiverNode.text) === "auto") {
      return `(sizeof(${safeText}) / sizeof(${safeText}[0]))`;
    }
    if (ts.isCallExpression(receiverNode)) {
      const returnType = ts.isPropertyAccessExpression(receiverNode.expression) && ts.isIdentifier(receiverNode.expression.expression)
        ? activeLocalTypes.get(receiverNode.expression.expression.text)
        : undefined;
      if (returnType === "std::string") return `${safeText}.length()`;
      return `${safeText}.size()`;
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
        return `${safeText}.length()`;
      }
    }
    // Handle this->field.length where field is a string (const char*)
    if (ts.isPropertyAccessExpression(receiverNode) && receiverNode.expression.kind === ts.SyntaxKind.ThisKeyword) {
      const fieldType = activeLocalTypes.get(`this->${receiverNode.name.text}`);
      if (fieldType === "std::string") return `${safeText}.length()`;
      if (fieldType && (fieldType.startsWith("std::vector<") || fieldType.startsWith("StaticArray<"))) return `${safeText}.size()`;
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
      if (memberName === "random") return `__tc_random()`;
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
    return `(cuttlefish_exists(${receiverText}) ? ${accessText} : 0)`;
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
        return `cuttlefish_nullish(${left}, ${right})`;
      } else if (operator === "**") {
        // C++ has no ** operator — translate to pow()
        const left = formatExpressionText(node.left);
        const right = formatExpressionText(node.right);
        return `pow(${left}, ${right})`;
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

  if (expr.kind === ts.SyntaxKind.RegularExpressionLiteral) {
    const regexText = expr.getText();
    return { kind: "raw", value: `std::regex(${JSON.stringify(regexText)})` };
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

  if (expr.kind === ts.SyntaxKind.VoidExpression) {
    const voidExpr = expr as ts.VoidExpression;
    const inner = expressionToIR(voidExpr.expression, sourceText, diagnostics, pointerVars);
    const innerText = renderExprAsText(inner);
    return { kind: "raw", value: `(void)(${innerText}), CUTTLEFISH_UNDEFINED` };
  }

  // Handle 'as const' and other type assertions - unwrap and process inner expression
  if (ts.isAsExpression(expr)) {
    return expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
  }

  // Handle type assertions like (<Type>expr) - unwrap and process inner expression
  if (ts.isTypeAssertionExpression(expr)) {
    return expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
  }

  // Handle 'satisfies' expressions (TS 4.9+) - unwrap and process inner expression
  if ((ts as any).isSatisfiesExpression?.(expr)) {
    return expressionToIR((expr as any).expression, sourceText, diagnostics, pointerVars);
  }
  if (expr.kind === (ts.SyntaxKind as any).SatisfiesExpression) {
    return expressionToIR((expr as any).expression, sourceText, diagnostics, pointerVars);
  }

  // Handle instanceof expressions (must be before generic binary expression handling)
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
    const object = expressionToIR(expr.left, sourceText, diagnostics);
    const className = expr.right.getText();
    return { kind: "instanceof", object, className };
  }

  // Handle 'in' operator: "key" in obj → map.count() or vector find
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.InKeyword) {
    const left = renderExprAsText(expressionToIR(expr.left, sourceText, diagnostics, pointerVars));
    const rightNode = expr.right;
    let rightVarType: string | undefined;
    if (ts.isIdentifier(rightNode)) {
      rightVarType = activeLocalTypes.get(rightNode.text) ?? activeGlobalTypes.get(rightNode.text);
    }
    if (rightVarType && rightVarType.startsWith("std::map<")) {
      return { kind: "raw", value: `(${rightNode.getText()}.count(${left}) > 0)` };
    }
    if (rightVarType && rightVarType.startsWith("std::vector<")) {
      return { kind: "raw", value: `(std::find(${rightNode.getText()}.begin(), ${rightNode.getText()}.end(), ${left}) != ${rightNode.getText()}.end())` };
    }
    if (rightVarType && rightVarType.startsWith("std::set<")) {
      return { kind: "raw", value: `(${rightNode.getText()}.count(${left}) > 0)` };
    }
    return { kind: "raw", value: `(std::find(${rightNode.getText()}.begin(), ${rightNode.getText()}.end(), ${left}) != ${rightNode.getText()}.end())` };
  }

  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken) {
    const leftText = renderExprAsText(expressionToIR(expr.left, sourceText, diagnostics, pointerVars));
    const rightText = renderExprAsText(expressionToIR(expr.right, sourceText, diagnostics, pointerVars));
    return { kind: "raw", value: `static_cast<unsigned int>(static_cast<unsigned int>(${leftText}) >> ${rightText})` };
  }

  // Detect string-bearing + chains and fold them into string_concat IR so they
  // flow through the same snprintf / std::string pipeline that template literals use.
  const STRING_RETURNING_METHODS = new Set([
    'toUpperCase', 'toLowerCase', 'trim', 'replace',
    'charAt', 'substring', 'slice', 'endsWith', 'includes', 'toString',
  ]);

  const ALL_STRING_METHODS = new Set([
    'toUpperCase', 'toLowerCase', 'trim', 'replace', 'charAt', 'charCodeAt',
    'substring', 'slice', 'endsWith', 'startsWith', 'includes', 'indexOf',
    'lastIndexOf', 'padStart', 'padEnd', 'repeat', 'split', 'toString',
  ]);
  function isStringBearingConcatChain(e: ts.Expression): boolean {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e)) return true;
    if (ts.isIdentifier(e) && (activeStringVars.has(e.text) || activeLocalTypes.get(e.text) === "std::string")) return true;
    // Recognize string-returning method calls like x.toUpperCase(), s.charAt(0)
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
      const methodName = e.expression.name.text;
      if (STRING_RETURNING_METHODS.has(methodName)) return true;
      // Also detect when the receiver is a known string variable
      if (ts.isIdentifier(e.expression.expression) && activeStringVars.has(e.expression.expression.text)) return true;
    }
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
    return { kind: "raw", value: `cuttlefish_nullish(${left}, ${right})` };
  }

  // Handle typeof expressions — at transpile time, typeof on a known variable
  // can be resolved. For typeof x === "number", the binary handler will compare.
  // Standalone typeof x emits a type-name string literal.
  if (ts.isTypeOfExpression(expr)) {
    const operand = expr.expression;
    if (ts.isIdentifier(operand)) {
      const varType = activeLocalTypes.get(operand.text);
      const typeName = varType === "int" || varType === "float" || varType === "double" || varType === "long" || varType === "long long" || varType === "unsigned long long" || varType === "unsigned" || varType === "size_t"
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
    if (ts.isNumericLiteral(operand)) return { kind: "string", value: "number" };
    if (ts.isStringLiteral(operand) || ts.isNoSubstitutionTemplateLiteral(operand)) return { kind: "string", value: "string" };
    if (operand.kind === ts.SyntaxKind.TrueKeyword || operand.kind === ts.SyntaxKind.FalseKeyword) return { kind: "string", value: "boolean" };
    if (ts.isArrayLiteralExpression(operand)) return { kind: "string", value: "object" };
    if (ts.isObjectLiteralExpression(operand)) return { kind: "string", value: "object" };
    if (ts.isFunctionExpression(operand) || ts.isArrowFunction(operand)) return { kind: "string", value: "function" };
    if (ts.isNewExpression(operand)) return { kind: "string", value: "object" };
    if (ts.isPropertyAccessExpression(operand)) {
      if (operand.name.text === "length") return { kind: "string", value: "number" };
      return { kind: "string", value: "object" };
    }
    if (ts.isCallExpression(operand) && ts.isPropertyAccessExpression(operand.expression)) {
      const methodName = operand.expression.name.text;
      if (["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "concat", "slice", "filter", "map", "reduce", "find", "findIndex", "every", "some", "forEach", "includes", "indexOf", "lastIndexOf", "join"].includes(methodName)) {
        return { kind: "string", value: "object" };
      }
    }
    return { kind: "string", value: "object" };
  }

  // Recurse into binary expressions so nested typehal calls are translated correctly.
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

  // Recurse into prefix unary so nested typehal calls are translated correctly.
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
    // ---- HAL inline evaluator for expression context ----
    const halResult = tryResolveHALExpression(expr, sourceText, diagnostics, pointerVars);
    if (halResult) return halResult.ir;

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

    const arrayMethodRes = tryLowerArrayAndStringMethods(expr, sourceText, diagnostics, pointerVars);
    if (arrayMethodRes !== null) {
      return arrayMethodRes;
    }

    if (ts.isPropertyAccessExpression(expr.expression) && ALL_STRING_METHODS.has(expr.expression.name.text)) {
      const receiver = expr.expression.expression;
      const isStringLiteralReceiver = ts.isStringLiteral(receiver) || ts.isNoSubstitutionTemplateLiteral(receiver);
      const isTemplateExprReceiver = ts.isTemplateExpression(receiver);
      const isStringVarReceiver = ts.isIdentifier(receiver) && (activeStringVars.has(receiver.text) || activeLocalTypes.get(receiver.text) === "std::string");
      if (isStringLiteralReceiver || isTemplateExprReceiver || isStringVarReceiver) {
        const receiverIR = expressionToIR(receiver, sourceText, diagnostics, pointerVars);
        let receiverText = renderExprAsText(receiverIR);
        if (receiver.kind === ts.SyntaxKind.StringLiteral || receiver.kind === (ts.SyntaxKind as any).NoSubstitutionTemplateLiteral) {
          receiverText = `std::string(${receiverText})`;
        }
        const methodName = expr.expression.name.text;
        const argsText = expr.arguments.map(a => renderExprAsText(expressionToIR(a, sourceText, diagnostics, pointerVars))).join(", ");
        return { kind: "raw", value: `${receiverText}.${methodName}(${argsText})` };
      }
    }

    if (ts.isIdentifier(expr.expression) && expr.expression.text === "Error") {
      const message = expr.arguments.length > 0
        ? renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars))
        : '"error"';
      return { kind: "raw", value: `std::runtime_error(${message})` };
    }

    if (ts.isIdentifier(expr.expression)) {
      const fnName = expr.expression.text;
      if (fnName === "parseInt" && expr.arguments.length >= 1) {
        const argText = renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars));
        return { kind: "raw", value: `atoi(${argText})` };
      }
      if (fnName === "parseFloat" && expr.arguments.length >= 1) {
        const argText = renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars));
        return { kind: "raw", value: `atof(${argText})` };
      }
      if (fnName === "isNaN" && expr.arguments.length >= 1) {
        const argText = renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars));
        return { kind: "raw", value: `std::isnan(${argText})` };
      }
      if (fnName === "isFinite" && expr.arguments.length >= 1) {
        const argText = renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars));
        return { kind: "raw", value: `std::isfinite(${argText})` };
      }
      if (fnName === "Number" && expr.arguments.length >= 1) {
        return expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars);
      }
      if (fnName === "String" && expr.arguments.length >= 1) {
        const argIR = expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars);
        return { kind: "template_string", expression: argIR };
      }
      if (fnName === "Boolean" && expr.arguments.length >= 1) {
        const argIR = expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars);
        return { kind: "raw", value: `static_cast<bool>(${renderExprAsText(argIR)})` };
      }
    }

    // Handle static method calls on built-in objects: Array.isArray, Object.keys/values/entries/assign
    if (ts.isPropertyAccessExpression(expr.expression) && ts.isIdentifier(expr.expression.expression)) {
      const objName = expr.expression.expression.text;
      const methodName = expr.expression.name.text;

      if (objName === "Array" && methodName === "isArray" && expr.arguments.length === 1) {
        const argIR = expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars);
        const argText = renderExprAsText(argIR);
        let argType: string | undefined;
        if (ts.isIdentifier(expr.arguments[0])) {
          argType = activeLocalTypes.get(expr.arguments[0].text) ?? activeGlobalTypes.get(expr.arguments[0].text);
        }
        if (argType && argType.startsWith("std::vector<")) {
          return { kind: "boolean", value: true };
        }
        return { kind: "boolean", value: false };
      }

      if (objName === "Object" && expr.arguments.length >= 1) {
        const argNode = expr.arguments[0];
        const argIR = expressionToIR(argNode, sourceText, diagnostics, pointerVars);
        const argText = renderExprAsText(argIR);
        let argType: string | undefined;
        if (ts.isIdentifier(argNode)) {
          argType = activeLocalTypes.get(argNode.text) ?? activeGlobalTypes.get(argNode.text);
        }

        if (methodName === "keys") {
          if (argType && argType.startsWith("std::map<")) {
            return { kind: "raw", value: `__tc_mapKeys(${argText})` };
          }
          if (ts.isObjectLiteralExpression(argNode)) {
            const fieldNames = argNode.properties
              .filter(ts.isPropertyAssignment)
              .filter(p => ts.isIdentifier(p.name))
              .map(p => (p.name as ts.Identifier).text);
            return { kind: "array", elementType: "const char*", elements: fieldNames.map(n => ({ kind: "string" as const, value: n })) };
          }
          return emitUnsupportedExpression("Object.keys on non-map types is unsupported.");
        }
        if (methodName === "values") {
          if (argType && argType.startsWith("std::map<")) {
            return { kind: "raw", value: `__tc_mapValues(${argText})` };
          }
          if (ts.isObjectLiteralExpression(argNode)) {
            const elements = argNode.properties
              .filter(ts.isPropertyAssignment)
              .map(p => expressionToIR(p.initializer, sourceText, diagnostics, pointerVars));
            return { kind: "array", elementType: "auto", elements };
          }
          return emitUnsupportedExpression("Object.values on non-map types is unsupported.");
        }
        if (methodName === "entries") {
          if (argType && argType.startsWith("std::map<")) {
            return { kind: "raw", value: `__tc_mapEntries(${argText})` };
          }
          return emitUnsupportedExpression("Object.entries on non-map types is unsupported.");
        }
        if (methodName === "assign" && expr.arguments.length === 2) {
          const targetText = argText;
          const srcIR = expressionToIR(expr.arguments[1], sourceText, diagnostics, pointerVars);
          const srcText = renderExprAsText(srcIR);
          return { kind: "raw", value: `(${targetText} = ${srcText})` };
        }
      }
    }

    if (ts.isIdentifier(expr.expression) && expr.expression.text === "defineBoardManifest" && expr.arguments.length === 1) {
      return expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars);
    }

    // Handle method calls like this.method() or obj.method()
    // Use -> for pointer variables (from 'new') and for 'this', . for value types
    let calleeText: string;
    if (ts.isPropertyAccessExpression(expr.expression)) {
      const receiver = expr.expression.expression;
      const rawMethodName = expr.expression.name.kind === ts.SyntaxKind.PrivateIdentifier
        ? `__priv_${expr.expression.name.text.substring(1)}`
        : expr.expression.name.text;
      const methodName = escapeCppKeyword(rawMethodName);

      // --- Map/Set method lowering ---
      if ((methodName === "set" || methodName === "get" || methodName === "has" || methodName === "delete" || methodName === "add") && expr.arguments.length >= 1) {
        let receiverType: string | undefined;
        let receiverText: string | undefined;

        if (ts.isIdentifier(receiver)) {
          receiverType = activeLocalTypes.get(receiver.text) ?? activeGlobalTypes.get(receiver.text);
        } else if (ts.isPropertyAccessExpression(receiver) && receiver.expression.kind === ts.SyntaxKind.ThisKeyword) {
          receiverType = activeLocalTypes.get(`this->${receiver.name.text}`);
        }

        if (receiverType && (receiverType.startsWith("std::map<") || receiverType.startsWith("std::set<"))) {
          const recIR = expressionToIR(receiver, sourceText, diagnostics, pointerVars);
          receiverText = renderExprAsText(recIR);
          const arg0IR = expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars);
          const arg0Text = renderExprAsText(arg0IR);

          if (receiverType.startsWith("std::map<")) {
            if (methodName === "set" && expr.arguments.length >= 2) {
              const arg1IR = expressionToIR(expr.arguments[1], sourceText, diagnostics, pointerVars);
              const arg1Text = renderExprAsText(arg1IR);
              return { kind: "raw", value: `(${receiverText}[${arg0Text}] = ${arg1Text})` };
            }
            if (methodName === "get") {
              return { kind: "raw", value: `${receiverText}[${arg0Text}]` };
            }
            if (methodName === "has") {
              return { kind: "raw", value: `(${receiverText}.count(${arg0Text}) > 0)` };
            }
            if (methodName === "delete") {
              return { kind: "raw", value: `(${receiverText}.erase(${arg0Text}) > 0)` };
            }
          }
          if (receiverType.startsWith("std::set<")) {
            if (methodName === "add") {
              return { kind: "raw", value: `${receiverText}.insert(${arg0Text})` };
            }
            if (methodName === "has") {
              return { kind: "raw", value: `(${receiverText}.count(${arg0Text}) > 0)` };
            }
            if (methodName === "delete") {
              return { kind: "raw", value: `(${receiverText}.erase(${arg0Text}) > 0)` };
            }
          }
        }
      }

      // Check if it's a this.method() call - in C++, this is a pointer so use ->
      if (receiver.kind === ts.SyntaxKind.ThisKeyword) {
        calleeText = `this->${methodName}`;
      } else if (ts.isIdentifier(receiver) && receiver.text === "Math") {
        const mathMethod = expr.expression.name.text;
        if (mathMethod === "random") {
          calleeText = "__tc_random";
        } else {
          calleeText = `std::${mathMethod}`;
        }
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
        if (ts.isIdentifier(receiver) && (pointerVars.has(receiver.text) || activeLocalTypes.get(receiver.text)?.endsWith("*") || activeGlobalTypes.get(receiver.text)?.endsWith("*"))) {
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
    const argIRs: ExpressionIR[] = [];
    for (const arg of expr.arguments) {
      if (ts.isSpreadElement(arg)) {
        const spreadIR = expressionToIR(arg.expression, sourceText, diagnostics, pointerVars);
        const spreadText = renderExprAsText(spreadIR);
        let spreadType: string | undefined;
        if (ts.isIdentifier(arg.expression)) {
          spreadType = activeLocalTypes.get(arg.expression.text) ?? activeGlobalTypes.get(arg.expression.text);
        }
        if (spreadType && spreadType.startsWith("std::vector<")) {
          const varName = ts.isIdentifier(arg.expression) ? arg.expression.text : spreadText;
          argIRs.push({ kind: "raw", value: `${varName}.begin()`, cppType: "auto" } as any);
          argIRs.push({ kind: "raw", value: `${varName}.end()`, cppType: "auto" } as any);
        } else {
          argIRs.push(spreadIR);
        }
      } else {
        argIRs.push(expressionToIR(arg, sourceText, diagnostics, pointerVars));
      }
    }
    
    let isStatic = false;
    let isNamespace = false;
    if (ts.isPropertyAccessExpression(expr.expression)) {
      const methodName = expr.expression.name.text;
      const receiver = expr.expression.expression;
      if (methodName === "values" || methodName === "keys" || methodName === "entries") {
        if (expr.arguments === undefined || expr.arguments.length === 0) {
          const receiverIR = expressionToIR(receiver, sourceText, diagnostics, pointerVars);
          const receiverText = renderExprAsText(receiverIR);
          return receiverIR;
        }
      }
      let root: ts.Expression = expr.expression;
      while (ts.isPropertyAccessExpression(root)) {
        root = root.expression;
      }
      if (ts.isIdentifier(root)) {
        const name = root.text;
        if (activeNamespaceNames.has(name)) {
          isNamespace = true;
        } else if (topLevelClassNames.has(name) || nestedClassAliases.has(name) || name === "Math") {
          isStatic = true;
        }
      }
    }

    return { 
      kind: "method-call", 
      callee: calleeText, 
      args: argIRs,
      isStatic,
      isNamespace,
      isPointer: calleeText.includes("->")
    };
  }

  if (ts.isNewExpression(expr)) {
    let ctorText = formatExpressionText(expr.expression);
    if (expr.typeArguments && expr.typeArguments.length > 0) {
      const typeArgs = expr.typeArguments.map((ta: ts.TypeNode) => ta.getText()).join(", ");
      ctorText = `${ctorText}<${typeArgs}>`;
    }

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
          const fields: string[] = [];
          for (const prop of arg.properties) {
            if (ts.isPropertyAssignment(prop)) {
              const name = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText();
              const val = renderExprAsText(expressionToIR(prop.initializer, sourceText, diagnostics, pointerVars));
              fields.push(`.${name} = ${val}`);
            }
          }
          return fields.length > 0 ? `{ ${fields.join(", ")} }` : "0";
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

    if (ctorText === "Map") {
      return { kind: "raw", value: "{}" };
    }
    if (ctorText === "Set") {
      return { kind: "raw", value: "{}" };
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
    return { kind: "identifier", value: "nullptr" };
  }

  if (expr.kind === ts.SyntaxKind.UndefinedKeyword) {
    return { kind: "identifier", value: "CUTTLEFISH_UNDEFINED" };
  }

  if (ts.isIdentifier(expr)) {
    // Resolve tracked HAL instances to their resolved values
    const halInst = halInstances.get(expr.text);
    if (halInst) {
      // For Pin instances, resolve to the pin number
      if (halInst.fieldValues.has("_pin")) {
        return { kind: "raw", value: halInst.fieldValues.get("_pin")! };
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
    const propName = expr.name.kind === ts.SyntaxKind.PrivateIdentifier
      ? `__priv_${expr.name.text.substring(1)}`
      : expr.name.text;
    if (isOptionalChainNode(expr)) {
      diagnostics.push(makeDiagnostic(
        sourceText, expr.pos,
        "Optional chaining (?.) is lowered with an approximate null guard in C++; semantics may differ from TypeScript.",
        "warning", "TS2CPP_OPTIONAL_CHAINING"
      ));
      const accessText = renderMemberAccessText(expr.expression, propName);
      return { kind: "raw", value: renderOptionalGuardedAccess(expr.expression, accessText) };
    }
    const regRead = tryLowerRegisterRead(expr, sourceText, diagnostics);
    if (regRead !== null) {
      return regRead;
    }

    if (expr.expression.kind === ts.SyntaxKind.ThisKeyword) {
      return { kind: "property-access", object: { kind: "raw", value: "this" }, property: propName };
    }
    if (ts.isIdentifier(expr.expression) && expr.expression.text === "Math") {
      if (propName === "random") return { kind: "raw", value: "__tc_random()" };
      return { kind: "raw", value: `std::${propName}` };
    }
    const object = expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
    if (propName === "length") {
      const objectText = renderExprAsText(object);
      const resolved = resolveLengthProperty(expr.expression, objectText);
      if (resolved.startsWith("__FILTERED_LEN__")) {
        return { kind: "identifier", value: resolved.slice("__FILTERED_LEN__".length) };
      }
      return { kind: "raw", value: resolved };
    }

    // Use -> for pointer variables in property access
    if (ts.isIdentifier(expr.expression) && (pointerVars.has(expr.expression.text) || activeLocalTypes.get(expr.expression.text)?.endsWith("*") || activeGlobalTypes.get(expr.expression.text)?.endsWith("*"))) {
      return { 
        kind: "property-access", 
        object: { kind: "identifier", value: expr.expression.text }, 
        property: propName,
        isPointer: true
      };
    }

    let isEnum = false;
    let isNamespace = false;
    let isStatic = false;

    if (ts.isIdentifier(expr.expression)) {
      const name = expr.expression.text;
      if (activeEnumNames.has(name)) {
        isEnum = true;
      } else if (activeNamespaceNames.has(name)) {
        isNamespace = true;
      } else if (topLevelClassNames.has(name) || nestedClassAliases.has(name)) {
        isStatic = true;
      }
    } else if (ts.isPropertyAccessExpression(expr.expression)) {
      let root: ts.Expression = expr.expression;
      while (ts.isPropertyAccessExpression(root)) {
        root = root.expression;
      }
      if (ts.isIdentifier(root) && activeNamespaceNames.has(root.text)) {
        isNamespace = true;
      }
    }

    let isPointer = false;
    if (ts.isIdentifier(expr.expression) && pointerVars.has(expr.expression.text)) {
      isPointer = true;
    } else if ((expr.expression.kind as number) === ts.SyntaxKind.ThisKeyword) {
      isPointer = true;
    }

    return { 
      kind: "property-access", 
      object, 
      property: propName,
      isEnum,
      isNamespace,
      isStatic,
      isPointer
    };
  }

  // Handle element access expressions like arr[index]
  if (ts.isElementAccessExpression(expr)) {
    const object = expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
    const index = expressionToIR(expr.argumentExpression, sourceText, diagnostics, pointerVars);
    return { kind: "element-access", object, index };
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
    
    const elements = expr.elements
      .filter(e => e.kind !== ts.SyntaxKind.OmittedExpression)
      .map((e) => expressionToIR(e, sourceText, diagnostics));
    // Default element type to "auto" - could be enhanced with type inference
    return { kind: "array", elementType: "auto", elements };
  }

  // Handle object literals - suppress warning for compile-time type contexts
  // Object literals in board package files are often type-asserted to pin interfaces
  // These are compile-time constructs that don't need C++ emission
  if (ts.isObjectLiteralExpression(expr)) {
    const fields: { name: string; value: ExpressionIR }[] = [];
    const spreadSources: ExpressionIR[] = [];
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
        const name = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText();
        fields.push({
          name,
          value: { kind: "raw", value: "/* method stub */" },
        });
      } else if (ts.isAccessor(prop)) {
        const name = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText();
        fields.push({
          name,
          value: { kind: "raw", value: "/* accessor stub */" },
        });
      } else if (ts.isSpreadAssignment(prop)) {
        spreadSources.push(expressionToIR(prop.expression, sourceText, diagnostics, pointerVars));
      }
    }
    if (fields.length === 0 && spreadSources.length > 0) {
      return spreadSources[0];
    }
    if (spreadSources.length > 0 && fields.length > 0) {
      const allFields: { name: string; value: ExpressionIR }[] = [];
      for (const src of spreadSources) {
        const srcText = renderExprAsText(src);
        allFields.push({ name: "__spread__", value: src });
      }
      allFields.push(...fields);
      return { kind: "object", fields: allFields };
    }
    return { kind: "object", fields };
  }

  // Handle function expressions and arrow functions in compile-time contexts
  // These are stubs in board package files that get replaced by transpiler magic
  // For interrupt handlers, we need to generate a proper callback function
  if (ts.isFunctionExpression(expr) || ts.isArrowFunction(expr)) {
    const body = expr.body;
    
    const paramList: {name: string; cppType: string}[] = [];
    for (const param of expr.parameters) {
      if (ts.isIdentifier(param.name)) {
        paramList.push({
          name: param.name.text,
          cppType: "auto",
        });
      }
    }
    
    const isBlock = ts.isBlock(body);
    const bodyStmts: StatementIR[] = isBlock
      ? (body as ts.Block).statements.map(stmt => {
          const lowered = lowerStatement(
            stmt,
            "",
            sourceText,
            diagnostics,
            new Map(),
            new Map(),
            "<lambda>",
            new Map(),
            pointerVars,
          );
          const stmts = lowered ?? [{ kind: "call" as const, sourceSpan: makeSourceSpan(stmt, "", sourceText), callee: "__EMIT__", args: [{ kind: "string" as const, value: "" }] }];
          return stmts;
        }).flat()
      : [{
          kind: "return" as const,
          sourceSpan: makeSourceSpan(body, "", sourceText),
          value: expressionToIR(body, sourceText, diagnostics, pointerVars),
        }];
    
    const lambdaParams = paramList.map(p => ({ name: p.name, cppType: p.cppType }));
    return { kind: "lambda", params: lambdaParams, body: bodyStmts, returnType: "auto", isExpressionBody: !isBlock } as ExpressionIR;
  }

  // Handle instanceof expressions
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
    const object = expressionToIR(expr.left, sourceText, diagnostics);
    const className = expr.right.getText();
    return { kind: "instanceof", object, className };
  }

  // Handle class expressions (anonymous classes assigned to variables)
  if (ts.isClassExpression(expr)) {
    const className = expr.name ? expr.name.text : `__tc_anonClass`;
    const members: any[] = [];
    let ctor: any;
    const fields: any[] = [];
    const methods: any[] = [];
    const getters: any[] = [];
    const setters: any[] = [];

    for (const member of expr.members) {
      if (ts.isConstructorDeclaration(member)) {
        const ctorParams: any[] = [];
        for (const param of member.parameters) {
          if (ts.isIdentifier(param.name)) {
            ctorParams.push({ name: param.name.text, cppType: "auto", isRest: !!param.dotDotDotToken });
          }
        }
        const ctorBody = member.body
          ? [...member.body.statements as any].map(s => {
              const lowered = lowerStatement(s, "", sourceText, diagnostics, new Map(), new Map(), "<anon-class>", new Map(), pointerVars);
              return lowered ?? [];
            }).flat()
          : [];
        ctor = { parameters: ctorParams, statements: ctorBody };
        continue;
      }
      if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
        const methodBody = member.body
          ? [...member.body.statements as any].map(s => {
              const lowered = lowerStatement(s, "", sourceText, diagnostics, new Map(), new Map(), `<anon-class>.${member.name!.getText()}`, new Map(), pointerVars);
              return lowered ?? [];
            }).flat()
          : [];
        methods.push({
          name: member.name.text,
          returnType: "auto",
          parameters: [],
          statements: methodBody,
          visibility: "public" as const,
          isStatic: false,
          isAbstract: false,
        });
        continue;
      }
      if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
        fields.push({
          name: member.name.text,
          cppType: "auto",
          visibility: "public" as const,
          initializer: member.initializer ? expressionToIR(member.initializer, sourceText, diagnostics, pointerVars) : undefined,
        });
        continue;
      }
      if (ts.isGetAccessorDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
        const getterBody = member.body
          ? [...member.body.statements as any].map(s => {
              const lowered = lowerStatement(s, "", sourceText, diagnostics, new Map(), new Map(), `<anon-class>.get:${member.name!.getText()}`, new Map(), pointerVars);
              return lowered ?? [];
            }).flat()
          : [];
        getters.push({
          name: member.name.text,
          returnType: "auto",
          statements: getterBody,
          visibility: "public" as const,
          isStatic: false,
        });
        continue;
      }
      if (ts.isSetAccessorDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
        const setterBody = member.body
          ? [...member.body.statements as any].map(s => {
              const lowered = lowerStatement(s, "", sourceText, diagnostics, new Map(), new Map(), `<anon-class>.set:${member.name!.getText()}`, new Map(), pointerVars);
              return lowered ?? [];
            }).flat()
          : [];
        setters.push({
          name: member.name.text,
          parameter: { name: "value", cppType: "auto", isRest: false },
          statements: setterBody,
          visibility: "public" as const,
          isStatic: false,
        });
        continue;
      }
    }

    const syntheticSpan = { filePath: "", startOffset: 0, endOffset: 0, startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 };
    hoistedNestedClasses.push({
      name: className,
      isAbstract: false,
      sourceSpan: syntheticSpan,
      fields,
      methods,
      getters,
      setters,
      ...(ctor ? { constructor: ctor } : {}),
    });
    topLevelClassNames.add(className);

    const extendsClass = expr.heritageClauses
      ?.find((clause: ts.HeritageClause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
      ?.types[0]?.expression?.getText();
    if (extendsClass) {
      hoistedNestedClasses[hoistedNestedClasses.length - 1].extendsClass = extendsClass;
    }

    return { kind: "identifier", value: className };
  }

  // Handle delete expressions: delete obj.key → map.erase(key)
  if (ts.isDeleteExpression(expr)) {
    const target = expr.expression;
    if (ts.isPropertyAccessExpression(target)) {
      const keyText = target.name.text;
      const objNode = target.expression;
      const objText = renderExprAsText(expressionToIR(objNode, sourceText, diagnostics, pointerVars));
      let objType: string | undefined;
      if (ts.isIdentifier(objNode)) {
        objType = activeLocalTypes.get(objNode.text) ?? activeGlobalTypes.get(objNode.text);
      }
      if (objType && (objType.startsWith("std::map<") || objType.startsWith("std::set<"))) {
        return { kind: "raw", value: `(${objText}.erase(${keyText}), true)` };
      }
      if (objType && objType.startsWith("std::vector<")) {
        const elemText = renderExprAsText(expressionToIR(target, sourceText, diagnostics, pointerVars));
        return { kind: "raw", value: `(${objText}.erase(std::find(${objText}.begin(), ${objText}.end(), ${keyText})), true)` };
      }
    }
    if (ts.isElementAccessExpression(target)) {
      const keyIR = expressionToIR(target.argumentExpression, sourceText, diagnostics, pointerVars);
      const objNode = target.expression;
      const objText = renderExprAsText(expressionToIR(objNode, sourceText, diagnostics, pointerVars));
      const keyText = renderExprAsText(keyIR);
      let objType: string | undefined;
      if (ts.isIdentifier(objNode)) {
        objType = activeLocalTypes.get(objNode.text) ?? activeGlobalTypes.get(objNode.text);
      }
      if (objType && objType.startsWith("std::map<")) {
        return { kind: "raw", value: `(${objText}.erase(${keyText}) > 0)` };
      }
    }

    if (ts.isPropertyAccessExpression(target)) {
      const keyText = target.name.text;
      const objNode = target.expression;
      const objText = renderExprAsText(expressionToIR(objNode, sourceText, diagnostics, pointerVars));
      let objType: string | undefined;
      if (ts.isIdentifier(objNode)) {
        objType = activeLocalTypes.get(objNode.text) ?? activeGlobalTypes.get(objNode.text);
      }
      if (objType) {
        const fieldTypeName = objType;
        let defaultValue = "0";
        if (fieldTypeName === "std::string" || fieldTypeName === "const char*") defaultValue = "\"\"";
        else if (fieldTypeName === "bool") defaultValue = "false";
        else if (fieldTypeName.endsWith("*")) defaultValue = "nullptr";
        return { kind: "raw", value: `(${objText}.${keyText} = ${defaultValue}, true)` };
      }
    }

    return emitUnsupportedExpression("delete on non-map types is unsupported in C++.");
  }

  // Handle comma expressions: (a, b, c) → evaluate all, return last
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    const leftIR = expressionToIR(expr.left, sourceText, diagnostics, pointerVars);
    const rightIR = expressionToIR(expr.right, sourceText, diagnostics, pointerVars);
    const leftText = renderExprAsText(leftIR);
    const rightText = renderExprAsText(rightIR);
    return { kind: "raw", value: `(${leftText}, ${rightText})` };
  }

  // Handle tagged template expressions (e.g., tag`template`)
  if (ts.isTaggedTemplateExpression(expr)) {
    return emitUnsupportedExpression("Tagged template expressions are unsupported in the C++ transpiler and were lowered to a placeholder.");
  }

  // Handle meta properties (e.g., import.meta, new.target)
  if (ts.isMetaProperty(expr)) {
    return emitUnsupportedExpression("Meta-property expressions are unsupported in the C++ transpiler and were lowered to a placeholder.");
  }

  if (ts.isNonNullExpression(expr)) {
    return expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
  }

  if (expr.kind === ts.SyntaxKind.SuperKeyword) {
    const extendsClass = getActiveExtendsClass();
    if (extendsClass) {
      return { kind: "raw", value: extendsClass };
    }
    return emitUnsupportedExpression("super keyword outside of class method");
  }

  if (ts.isPartiallyEmittedExpression(expr)) {
    return expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
  }

  if (expr.kind === (ts.SyntaxKind as any).YieldExpression || (ts as any).isYieldExpression?.(expr)) {
    const yieldExpr = expr as any;
    const value = yieldExpr.expression
      ? expressionToIR(yieldExpr.expression, sourceText, diagnostics, pointerVars)
      : undefined;
    return { kind: "raw", value: value ? `co_yield ${renderExprAsText(value)}` : "co_yield" };
  }

  return emitUnsupportedExpression(
    `Unsupported expression kind '${ts.SyntaxKind[expr.kind] ?? expr.kind}' was lowered to a placeholder.`,
  );
}