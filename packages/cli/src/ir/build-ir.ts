import path from "node:path";
import fs from "node:fs";
import ts from "typescript";
import { parseSource } from "../ast/parse";
import { Diagnostic, SourceSpan } from "../types";
import { withLineColumn } from "../utils/strings";
import { CppType, EnumIR, ClassIR, ClassFieldIR, ClassMethodIR, ExpressionIR, FunctionIR, ImportIR, ParameterIR, ProgramIR, ReExportIR, StatementIR, TypeAliasIR } from "./model";
import { inferKindByName } from "./typecode-symbols";
import { resolveBoardConstants, BoardConstants } from "./board-resolver";

function normalizeLegacyArduinoSyntax(sourceText: string): string {
  return sourceText.replace(/\bfunction\s+void\s*\(/g, "function __arduino_setup__(");
}

function makeDiagnostic(
  sourceText: string,
  position: number,
  message: string,
  severity: Diagnostic["severity"] = "warning",
  code?: string,
): Diagnostic {
  const { line, column } = withLineColumn(sourceText, position);
  return { severity, message, line, column, code };
}

function makeSourceSpan(node: ts.Node, filePath: string, sourceText: string): SourceSpan {
  const startOffset = node.getStart();
  const endOffset = node.getEnd();
  const start = withLineColumn(sourceText, startOffset);
  const end = withLineColumn(sourceText, endOffset);

  return {
    filePath,
    startOffset,
    endOffset,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

function extractNodeComments(node: ts.Node, sourceText: string): { leadingComments: string[]; trailingComments: string[] } {
  const leadingRanges = ts.getLeadingCommentRanges(sourceText, node.getFullStart()) ?? [];
  const trailingRanges = ts.getTrailingCommentRanges(sourceText, node.getEnd()) ?? [];

  const normalize = (ranges: ts.CommentRange[]): string[] =>
    ranges
      .map((range) => sourceText.slice(range.pos, range.end).trim())
      .filter((value) => value.length > 0);

  return {
    leadingComments: normalize(leadingRanges),
    trailingComments: normalize(trailingRanges),
  };
}

type CppTypeHint =
  | "int"
  | "float"
  | "bool"
  | "auto"
  | "void"
  | "std::string"
  | "unsigned int"
  | `std::vector<${string}>`
  | `std::function<${string}>`
  | `${string}*`;

interface FunctionTypeSignature {
  parameterTypes: CppTypeHint[];
  returnType: CppTypeHint;
}

function resolveAliasedTypeNode(
  node: ts.TypeNode | undefined,
  typeAliases?: Map<string, ts.TypeNode>,
  visited: Set<string> = new Set(),
): ts.TypeNode | undefined {
  if (!node || !typeAliases) {
    return node;
  }

  if (!ts.isTypeReferenceNode(node) || !ts.isIdentifier(node.typeName)) {
    return node;
  }

  const aliasName = node.typeName.text;
  if (visited.has(aliasName)) {
    return node;
  }

  const aliasNode = typeAliases.get(aliasName);
  if (!aliasNode) {
    return node;
  }

  visited.add(aliasName);
  return resolveAliasedTypeNode(aliasNode, typeAliases, visited);
}

function inferNumericCppType(literalText: string): CppTypeHint {
  return /[.eE]/.test(literalText) ? "float" : "int";
}

function normalizeTypeHintForUse(typeHint: CppTypeHint): string {
  if (typeHint === "auto") {
    return "int";
  }
  return typeHint;
}

function functionTypeNodeToCppType(node: ts.FunctionTypeNode, typeAliases?: Map<string, ts.TypeNode>): CppTypeHint {
  const returnType = normalizeTypeHintForUse(typeNodeToCppType(node.type, typeAliases));
  const parameterTypes = node.parameters
    .map((parameter) => normalizeTypeHintForUse(typeNodeToCppType(parameter.type, typeAliases)))
    .join(", ");
  return `std::function<${returnType}(${parameterTypes})>`;
}

function typeNodeToCppType(node: ts.TypeNode | undefined, typeAliases?: Map<string, ts.TypeNode>): CppTypeHint {
  if (!node) {
    return "auto";
  }

  const resolvedNode = resolveAliasedTypeNode(node, typeAliases) ?? node;

  if (ts.isArrayTypeNode(resolvedNode)) {
    const elementType = normalizeTypeHintForUse(typeNodeToCppType(resolvedNode.elementType, typeAliases));
    return `std::vector<${elementType}>`;
  }

  if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName) && resolvedNode.typeName.text === "Array") {
    const elementTypeNode = resolvedNode.typeArguments?.[0];
    const elementType = normalizeTypeHintForUse(typeNodeToCppType(elementTypeNode, typeAliases));
    return `std::vector<${elementType}>`;
  }

  if (ts.isFunctionTypeNode(resolvedNode)) {
    return functionTypeNodeToCppType(resolvedNode, typeAliases);
  }

  if (resolvedNode.kind === ts.SyntaxKind.NumberKeyword) {
    return "int";
  }

  if (resolvedNode.kind === ts.SyntaxKind.BooleanKeyword) {
    return "bool";
  }

  if (resolvedNode.kind === ts.SyntaxKind.StringKeyword) {
    return "std::string";
  }

  if (resolvedNode.kind === ts.SyntaxKind.VoidKeyword) {
    return "void";
  }

  // Recognize C++ type names as type references (int, float, bool, string, etc.)
  if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName)) {
    const typeName = resolvedNode.typeName.text;
    // Known C++ types that can be used directly in type annotations
    const cppTypes = new Set<string>([
      "int", "float", "bool", "string", "void",
      "double", "long", "unsigned",
      "uint8_t", "uint16_t", "uint32_t",
      "int8_t", "int16_t", "int32_t",
      "size_t",
    ]);
    if (cppTypes.has(typeName)) {
      if (typeName === "string") return "std::string";
      if (typeName === "unsigned") return "unsigned int";
      return typeName as CppTypeHint;
    }
  }

  return "auto";
}

function resolveFunctionTypeSignature(
  typeNode: ts.TypeNode | undefined,
  typeAliases?: Map<string, ts.TypeNode>,
): FunctionTypeSignature | undefined {
  const resolvedNode = resolveAliasedTypeNode(typeNode, typeAliases);
  if (!resolvedNode || !ts.isFunctionTypeNode(resolvedNode)) {
    return undefined;
  }

  return {
    parameterTypes: resolvedNode.parameters.map((parameter) => typeNodeToCppType(parameter.type, typeAliases)),
    returnType: typeNodeToCppType(resolvedNode.type, typeAliases),
  };
}

function isStructuredTypeAnnotation(
  typeNode: ts.TypeNode | undefined,
  typeAliases?: Map<string, ts.TypeNode>,
): boolean {
  const resolvedNode = resolveAliasedTypeNode(typeNode, typeAliases);
  if (!resolvedNode) {
    return false;
  }

  if (ts.isTypeLiteralNode(resolvedNode)) {
    return true;
  }

  if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName)) {
    return resolvedNode.typeName.text === "Record";
  }

  return false;
}

function inferExprCppType(
  expr: ts.Expression,
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
): CppTypeHint {
  if (ts.isAwaitExpression(expr)) {
    return inferExprCppType(expr.expression, functionReturnTypes, localVariableTypes);
  }

  if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr)) {
    return inferExprCppType(expr.expression, functionReturnTypes, localVariableTypes);
  }

  if (ts.isNumericLiteral(expr)) {
    return inferNumericCppType(expr.text);
  }

  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return "std::string";
  }

  if (ts.isArrayLiteralExpression(expr)) {
    const inferredElementTypes = expr.elements
      .filter((item): item is ts.Expression => !ts.isSpreadElement(item))
      .map((item) => inferExprCppType(item, functionReturnTypes, localVariableTypes))
      .filter((item) => item !== "auto");

    if (inferredElementTypes.length === 0) {
      return "std::vector<int>";
    }

    if (inferredElementTypes.includes("float")) {
      return "std::vector<float>";
    }
    if (inferredElementTypes.includes("std::string")) {
      return "std::vector<std::string>";
    }
    if (inferredElementTypes.includes("bool") && !inferredElementTypes.includes("int")) {
      return "std::vector<bool>";
    }
    if (inferredElementTypes.includes("int") || inferredElementTypes.includes("bool")) {
      return "std::vector<int>";
    }
    return "std::vector<int>";
  }

  if (expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.FalseKeyword) {
    return "bool";
  }

  if (ts.isIdentifier(expr)) {
    return localVariableTypes.get(expr.text) ?? "auto";
  }

  if (ts.isParenthesizedExpression(expr)) {
    return inferExprCppType(expr.expression, functionReturnTypes, localVariableTypes);
  }

  if (ts.isBinaryExpression(expr)) {
    const operator = expr.operatorToken.kind;
    const leftType = inferExprCppType(expr.left, functionReturnTypes, localVariableTypes);
    const rightType = inferExprCppType(expr.right, functionReturnTypes, localVariableTypes);

    if (
      operator === ts.SyntaxKind.EqualsEqualsToken ||
      operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      operator === ts.SyntaxKind.ExclamationEqualsToken ||
      operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      operator === ts.SyntaxKind.GreaterThanToken ||
      operator === ts.SyntaxKind.GreaterThanEqualsToken ||
      operator === ts.SyntaxKind.LessThanToken ||
      operator === ts.SyntaxKind.LessThanEqualsToken ||
      operator === ts.SyntaxKind.AmpersandAmpersandToken ||
      operator === ts.SyntaxKind.BarBarToken
    ) {
      return "bool";
    }

    if (operator === ts.SyntaxKind.PlusToken && (leftType === "std::string" || rightType === "std::string")) {
      return "std::string";
    }

    if (leftType === "float" || rightType === "float") {
      return "float";
    }

    if ((leftType === "int" || leftType === "bool") && (rightType === "int" || rightType === "bool")) {
      return "int";
    }

    return "auto";
  }

  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return functionReturnTypes.get(expr.expression.text) ?? "auto";
  }

  if (ts.isNewExpression(expr)) {
    if (ts.isIdentifier(expr.expression)) {
      return `${expr.expression.text}*`;
    }
    return "auto";
  }

  return "auto";
}

function collectReturns(block: ts.Block): ts.ReturnStatement[] {
  const returns: ts.ReturnStatement[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isReturnStatement(node)) {
      returns.push(node);
      return;
    }
    node.forEachChild(walk);
  };

  walk(block);
  return returns;
}

function buildFunctionReturnTypeMap(source: ts.SourceFile): Map<string, CppTypeHint> {
  const result = new Map<string, CppTypeHint>();
  const functions = source.statements.filter(ts.isFunctionDeclaration);

  for (let pass = 0; pass < 3; pass++) {
    for (const fn of functions) {
      if (!fn.name || !fn.body) {
        continue;
      }

      if (fn.type) {
        const annotatedType = typeNodeToCppType(fn.type);
        if (annotatedType !== "auto") {
          result.set(fn.name.text, annotatedType);
          continue;
        }
      }

      const returns = collectReturns(fn.body).filter((item) => item.expression);
      if (returns.length === 0) {
        continue;
      }

      const inferredTypes = returns
        .map((item) => inferExprCppType(item.expression as ts.Expression, result, new Map<string, CppTypeHint>()))
        .filter((item) => item !== "auto");

      if (inferredTypes.length === 0) {
        continue;
      }

      if (inferredTypes.includes("float")) {
        result.set(fn.name.text, "float");
      } else if (inferredTypes.includes("int")) {
        result.set(fn.name.text, "int");
      } else if (inferredTypes.includes("bool")) {
        result.set(fn.name.text, "bool");
      } else if (inferredTypes.includes("std::string")) {
        result.set(fn.name.text, "std::string");
      } else {
        result.set(fn.name.text, inferredTypes[0]);
      }
    }
  }

  return result;
}

function resolveFunctionReturnType(name: string, functionReturnTypes: Map<string, CppTypeHint>): CppType {
  return functionReturnTypes.get(name) ?? "void";
}

// Track variables that are pointers (from 'new' expressions)
type PointerTracker = Set<string>;

function expressionToIR(expr: ts.Expression, sourceText: string, diagnostics: Diagnostic[], pointerVars: PointerTracker = new Set()): ExpressionIR {
  const formatExpressionText = (node: ts.Expression): string => {
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      return formatExpressionText(node.expression);
    }

    if (ts.isParenthesizedExpression(node)) {
      return `(${formatExpressionText(node.expression)})`;
    }

    if (ts.isPropertyAccessExpression(node)) {
      // In C++, 'this' is a pointer, so use -> instead of .
      // Check if expression is 'this' keyword
      const isThisAccess = node.expression.kind === ts.SyntaxKind.ThisKeyword || 
                           (ts.isIdentifier(node.expression) && node.expression.text === "this");
      if (isThisAccess) {
        if (node.name.text === "length") {
          return `this->size()`;
        }
        return `this->${node.name.text}`;
      }
      // Check if the object is a pointer variable (from 'new')
      if (ts.isIdentifier(node.expression) && pointerVars.has(node.expression.text)) {
        return `${node.expression.text}->${node.name.text}`;
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === "Math") {
        return `std::${node.name.text}`;
      }
      const objectText = formatExpressionText(node.expression);
      if (node.name.text === "length") {
        return `${objectText}.size()`;
      }
      return `${objectText}.${node.name.text}`;
    }

    if (ts.isElementAccessExpression(node)) {
      const objectText = formatExpressionText(node.expression);
      const argumentText = node.argumentExpression ? formatExpressionText(node.argumentExpression) : "0";
      return `${objectText}[${argumentText}]`;
    }

    if (ts.isCallExpression(node)) {
      const calleeText = formatExpressionText(node.expression);
      const argsText = node.arguments.map((arg) => formatExpressionText(arg)).join(", ");
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
      }
      return `${formatExpressionText(node.left)} ${operator} ${formatExpressionText(node.right)}`;
    }

    return node.getText();
  };

  if (ts.isNumericLiteral(expr)) {
    return { kind: "number", value: Number(expr.text) };
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

  // Unwrap parenthesized expressions — the emitter re-parenthesizes as needed.
  if (ts.isParenthesizedExpression(expr)) {
    return expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
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

  if (ts.isCallExpression(expr)) {
    // ---- Typecode SDK method call detection (expression context) -----------
    // Detects A0.read(), D13.high(), Serial.println(), Board.A0.read(), etc.
    // and emits a structured `typecode-call` IR node instead of a raw string.
    // The emitter translates these to Arduino built-ins without regex.
    if (ts.isPropertyAccessExpression(expr.expression)) {
      const method = expr.expression.name.text;
      const receiverNode = expr.expression.expression;

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

      // symbol.method() — direct typecode symbol (A0.read(), Serial.println(), etc.)
      if (ts.isIdentifier(receiverNode)) {
        const kind = inferKindByName(receiverNode.text);
        if (kind !== 'unknown') {
          return {
            kind: "typecode-call",
            receiver: receiverNode.text,
            receiverKind: kind,
            method,
            args: expr.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
          };
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
      calleeText = expr.expression.getText();
    }
    const argsText = expr.arguments.map(arg => renderExprAsText(expressionToIR(arg, sourceText, diagnostics, pointerVars))).join(", ");
    return { kind: "raw", value: `${calleeText}(${argsText})` };
  }

  if (ts.isNewExpression(expr)) {
    const ctorText = formatExpressionText(expr.expression);
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

  // Handle template literals with interpolation - emit as raw for now
  if (ts.isTemplateExpression(expr)) {
    diagnostics.push(
      makeDiagnostic(
        sourceText,
        expr.pos,
        "Template literal with interpolation emitted as raw text; consider using string concatenation instead.",
        "warning",
        "TS2CPP_RAW_EXPR",
      ),
    );
    return { kind: "raw", value: expr.getText() };
  }

  if (expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.FalseKeyword) {
    return { kind: "boolean", value: expr.kind === ts.SyntaxKind.TrueKeyword };
  }

  if (ts.isIdentifier(expr)) {
    return { kind: "identifier", value: expr.text };
  }

  // Handle 'this' keyword
  if (expr.kind === ts.SyntaxKind.ThisKeyword) {
    return { kind: "raw", value: "this" };
  }

  // Handle property access expressions like obj.property or this.field
  if (ts.isPropertyAccessExpression(expr)) {
    // In C++, 'this' is a pointer, so use -> instead of .
    if (expr.expression.kind === ts.SyntaxKind.ThisKeyword) {
      return { kind: "raw", value: `this->${expr.name.text}` };
    }
    if (ts.isIdentifier(expr.expression) && expr.expression.text === "Math") {
      return { kind: "raw", value: `std::${expr.name.text}` };
    }
    const object = expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
    if (expr.name.text === "length") {
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

  // Handle object literals
  if (ts.isObjectLiteralExpression(expr)) {
    const fields: { name: string; value: ExpressionIR }[] = [];
    for (const prop of expr.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const name = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText();
        fields.push({
          name,
          value: expressionToIR(prop.initializer, sourceText, diagnostics),
        });
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        fields.push({
          name: prop.name.text,
          value: { kind: "identifier", value: prop.name.text },
        });
      }
    }
    return { kind: "object", fields };
  }

  // Handle instanceof expressions
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
    const object = expressionToIR(expr.left, sourceText, diagnostics);
    const className = expr.right.getText();
    return { kind: "instanceof", object, className };
  }

  diagnostics.push(
    makeDiagnostic(
      sourceText,
      expr.pos,
      "Expression emitted as raw text; add lowering rule for this AST node.",
      "warning",
      "TS2CPP_RAW_EXPR",
    ),
  );
  return { kind: "raw", value: expr.getText() };
}

function calleeToText(expr: ts.LeftHandSideExpression): string {
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }

  if (ts.isPropertyAccessExpression(expr)) {
    return `${calleeToText(expr.expression as ts.LeftHandSideExpression)}.${expr.name.text}`;
  }

  return expr.getText();
}

function renderExprAsText(expr: ExpressionIR): string {
  switch (expr.kind) {
    case "number":
      return `${expr.value}`;
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
    case "typecode-call":
      // Fallback text rendering used inside build-ir.ts only.
      // The real Arduino translation happens in renderExpression (cpp-emitter.ts).
      return `${expr.receiver}.${expr.method}(${expr.args.map(renderExprAsText).join(', ')})`;
    default:
      return "/* unsupported_expr */";
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

  const explicitType = typeNodeToCppType(declaration.type);
  const inferredType = declaration.initializer
    ? inferExprCppType(declaration.initializer, functionReturnTypes, localVariableTypes)
    : "auto";

  let resolvedType: CppTypeHint;
  if (explicitType === "auto") {
    resolvedType = inferredType;
  } else if (explicitType === "int" && inferredType === "float") {
    resolvedType = "float";
  } else {
    resolvedType = explicitType;
  }

  localVariableTypes.set(declaration.name.text, resolvedType);

  return {
    kind: "var_decl",
    sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
    name: declaration.name.text,
    storage,
    cppType: (resolvedType === "void" ? "auto" : resolvedType) as Exclude<CppTypeHint, "void">,
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
      const valueType = inferExprCppType(expr.right, new Map(), localVariableTypes);
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
    return callToStatement(statement, expr.expression, fileName, sourceText, diagnostics, pointerVars);
  }

  if (ts.isBinaryExpression(expr) && ts.isIdentifier(expr.left)) {
    const operator = assignmentOperatorToString(expr.operatorToken.kind);
    if (!operator) {
      return undefined;
    }

    const valueType = inferExprCppType(expr.right, functionReturnTypes, localVariableTypes);
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

  // Handle try/catch statements
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

    return [{
      kind: "try",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      tryBlock,
      catchParam,
      catchBlock,
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

  for (const statement of statements) {
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

    const loweredDeclaration: Extract<StatementIR, { kind: "var_decl" }> = {
      kind: "var_decl",
      sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
      leadingComments: commentsAssigned ? [] : statementComments.leadingComments,
      trailingComments: commentsAssigned ? [] : statementComments.trailingComments,
      name: declaration.name.text,
      storage,
      cppType: "auto",
      initializer: declaration.initializer
        ? expressionToIR(declaration.initializer, sourceText, diagnostics)
        : undefined,
    };
    commentsAssigned = true;

    const explicitType = typeNodeToCppType(declaration.type, typeAliases);
    const inferredType = declaration.initializer
      ? inferExprCppType(declaration.initializer, functionReturnTypes, localVariableTypes)
      : "auto";
    const hasStructuredTypeAnnotation = isStructuredTypeAnnotation(declaration.type, typeAliases);

    let resolvedType: CppTypeHint;
    if (explicitType === "auto") {
      resolvedType = inferredType;
    } else if (explicitType === "int" && inferredType === "float") {
      resolvedType = "float";
    } else {
      resolvedType = explicitType;
    }

    loweredDeclaration.cppType = (resolvedType === "void" ? "auto" : resolvedType) as Exclude<CppTypeHint, "void">;
    localVariableTypes.set(declaration.name.text, resolvedType);

    const canLowerFromStructuredInitializer =
      hasStructuredTypeAnnotation &&
      !!declaration.initializer &&
      ts.isObjectLiteralExpression(declaration.initializer);

    if (explicitType === "auto" && inferredType === "auto" && declaration.type && !canLowerFromStructuredInitializer) {
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
          pointerVars.add(decl.name.text);
        }
      }
    }
  }
  
  return pointerVars;
}

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
): string | undefined {
  if (!moduleSpecifier.startsWith(".")) return undefined;

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

export function buildProgramIR(fileName: string, sourceText: string): ProgramIR {
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
  const typeAliasNodes = new Map<string, ts.TypeNode>();
  const boilerplates = new Set<string>();
  const functionReturnTypes = buildFunctionReturnTypeMap(source);
  const topLevelVariableTypes = new Map<string, CppTypeHint>();
  
  // Collect pointer variables at top level (for correct -> vs . usage)
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

    if (ts.isFunctionDeclaration(node)) {
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
          parameters.push({
            name: parameter.name.text,
            cppType: (parameterType === "void" ? "auto" : parameterType) as Exclude<CppTypeHint, "void">,
            defaultValue: parameter.initializer
              ? expressionToIR(parameter.initializer, sourceText, diagnostics)
              : undefined,
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

      functions.push({
        originalName: node.name.text,
        isAsync,
        returnType: resolveFunctionReturnType(node.name.text, functionReturnTypes),
        sourceSpan: makeSourceSpan(node, fileName, sourceText),
        ...extractNodeComments(node, sourceText),
        parameters,
        statements: bodyStatements,
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
            parameters.push({
              name: parameter.name.text,
              cppType: (parameterType === "void" ? "auto" : parameterType) as Exclude<CppTypeHint, "void">,
              defaultValue: parameter.initializer
                ? expressionToIR(parameter.initializer, sourceText, diagnostics)
                : undefined,
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

          if (resolvedReturnType === "auto") {
            if (ts.isBlock(fnExpression.body)) {
              const returnTypes = collectReturns(fnExpression.body)
                .filter((item) => item.expression)
                .map((item) => inferExprCppType(item.expression as ts.Expression, functionReturnTypes, localVariableTypes))
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
              resolvedReturnType = inferExprCppType(fnExpression.body, functionReturnTypes, localVariableTypes);
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
      const extendsClass = node.heritageClauses
        ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
        ?.types[0]
        ?.expression
        ?.getText();
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
              ctorParams.push({
                name: param.name.text,
                cppType: (paramType === "void" ? "auto" : paramType) as Exclude<CppTypeHint, "void">,
                defaultValue: param.initializer
                  ? expressionToIR(param.initializer, sourceText, diagnostics)
                  : undefined,
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
          
          fields.push({
            name: member.name.text,
            cppType: (typeNodeToCppType(member.type, typeAliasNodes) === "void" ? "auto" : typeNodeToCppType(member.type, typeAliasNodes)) as CppType,
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

          methods.push({
            name: member.name.text,
            returnType: (
              member.type?.kind === ts.SyntaxKind.ThisType
                ? `${className}*`
                : (typeNodeToCppType(member.type, typeAliasNodes) === "void"
                    ? "void"
                    : typeNodeToCppType(member.type, typeAliasNodes))
            ) as CppType,
            parameters: methodParams,
            statements: methodBody,
            visibility,
            isStatic,
          });
        }
      }

      classes.push({
        name: className,
        extendsClass,
        sourceSpan: makeSourceSpan(node, fileName, sourceText),
        leadingComments: classComments.leadingComments,
        trailingComments: classComments.trailingComments,
        fields,
        methods,
        constructor: ctor,
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

  // Handle interface declarations (type-only, no C++ output needed)
    if (ts.isInterfaceDeclaration(node)) {
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

  // Resolve board-definition constants from the actual board package file.
  // This replaces the old hard-coded ARDUINO_BOARD_METADATA table in
  // typecode-map.ts so that Board.definition.* folds to the real values.
  let boardConstants: BoardConstants | undefined;
  for (const imp of imports) {
    const boardFile = tryResolveBoardDefFile(fileName, imp.moduleSpecifier);
    if (boardFile) {
      try {
        boardConstants = resolveBoardConstants(boardFile);
      } catch {
        // Non-fatal: missing or malformed board file — fall back to no-fold.
      }
      break;
    }
  }

  return {
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
    boardConstants,
  };
}
