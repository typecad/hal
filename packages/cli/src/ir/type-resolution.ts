import ts from "typescript";
import { CppType } from "./model";

export type CppTypeHint =
  | "int"
  | "float"
  | "bool"
  | "auto"
  | "void"
  | "std::string"
  | "unsigned int"
  | `std::vector<${string}>`
  | `std::set<${string}>`
  | `std::map<${string}, ${string}>`
  | `std::function<${string}>`
  | `${string}*`;

export interface FunctionTypeSignature {
  parameterTypes: CppTypeHint[];
  returnType: CppTypeHint;
}

export interface ResolvedDeclarationType {
  explicitType: CppTypeHint;
  inferredType: CppTypeHint;
  resolvedType: CppTypeHint;
  canLowerFromStructuredInitializer: boolean;
  isKnownCompileTimeType: boolean;
  shouldWarnUnmappedType: boolean;
}

const DIRECT_CPP_TYPE_MAP = new Map<string, string>([
  ["int", "int"],
  ["float", "float"],
  ["bool", "bool"],
  ["string", "std::string"],
  ["void", "void"],
  ["double", "double"],
  ["long", "long"],
  ["unsigned", "unsigned int"],
  ["uint8_t", "uint8_t"],
  ["uint16_t", "uint16_t"],
  ["uint32_t", "uint32_t"],
  ["int8_t", "int8_t"],
  ["int16_t", "int16_t"],
  ["int32_t", "int32_t"],
  ["size_t", "size_t"],
]);

const PIN_INTERFACE_TYPE_NAMES = new Set<string>([
  "BasePin", "Pin", "PWMPin", "AnalogPin", "InterruptPin",
  "InterruptOptions",
  "PinMode", "InterruptMode",
]);

const BUS_INTERFACE_TYPE_NAMES = new Set<string>([
  "II2CBus", "ISPIBus", "ISerialPort", "IUART",
  "I2CConfig", "SPIConfig", "UARTConfig",
  "I2CAddress", "UARTStatus", "SPITransferOptions",
]);

const STRATEGY_TYPE_NAMES = new Set<string>([
  "NativeStrategy", "ArduinoStrategy", "BoardStrategy",
  "RuntimePolyfillIR", "PeripheralUsage",
]);

const BOARD_CONSTANT_TYPE_NAMES = new Set<string>([
  "INPUT", "OUTPUT", "INPUT_PULLUP", "INPUT_PULLDOWN",
  "CHANGE", "FALLING", "RISING",
]);

export function resolveAliasedTypeNode(
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

function getDirectCppType(typeName: string): CppTypeHint | undefined {
  const directCppType = DIRECT_CPP_TYPE_MAP.get(typeName);
  return directCppType as CppTypeHint | undefined;
}

function isBoardDefinitionTypeName(typeName: string): boolean {
  return typeName.endsWith("Board") || typeName.endsWith("Definition") ||
    typeName.startsWith("Native") || typeName.startsWith("Arduino");
}

function isSerialTypeName(typeName: string): boolean {
  return typeName === "Serial" || typeName.endsWith("Serial");
}

function isPinConstantTypeName(typeName: string): boolean {
  return /^D\d+$/.test(typeName) ||
    /^A\d+$/.test(typeName) ||
    typeName === "LED" ||
    typeName === "TX" ||
    typeName === "RX" ||
    typeName.startsWith("TX") ||
    typeName.startsWith("RX");
}

function isPinImplementationTypeName(typeName: string): boolean {
  return typeName.startsWith("AVR") || typeName.startsWith("ESP");
}

function isSharedCompileTimeOnlyTypeName(typeName: string): boolean {
  return PIN_INTERFACE_TYPE_NAMES.has(typeName) ||
    STRATEGY_TYPE_NAMES.has(typeName) ||
    BOARD_CONSTANT_TYPE_NAMES.has(typeName) ||
    isBoardDefinitionTypeName(typeName) ||
    isSerialTypeName(typeName) ||
    isPinConstantTypeName(typeName) ||
    isPinImplementationTypeName(typeName);
}

function isKnownCompileTimeOnlyTypeName(typeName: string): boolean {
  return BUS_INTERFACE_TYPE_NAMES.has(typeName) || isSharedCompileTimeOnlyTypeName(typeName);
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

export function typeNodeToCppType(node: ts.TypeNode | undefined, typeAliases?: Map<string, ts.TypeNode>): CppTypeHint {
  if (!node) {
    return "auto";
  }

  // ── Ownership wrapper detection (before alias resolution) ───────────
  // Ref<T>, MutRef<T>, Owned<T> are phantom types that wrap the real type.
  // We must check the ORIGINAL node before alias resolution, because
  // `type Ref<T> = T` would resolve Ref<number> → number, hiding the wrapper.
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const wrapperName = node.typeName.text;
    if (wrapperName === 'Ref' || wrapperName === 'MutRef' || wrapperName === 'Owned') {
      const innerTypeNode = node.typeArguments?.[0];
      return typeNodeToCppType(innerTypeNode, typeAliases);
    }
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

  if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName)) {
    const typeName = resolvedNode.typeName.text;
    const directCppType = getDirectCppType(typeName);
    if (directCppType) {
      return directCppType;
    }

    if (isSharedCompileTimeOnlyTypeName(typeName)) {
      return "auto";
    }
  }

  if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName) && resolvedNode.typeName.text === "Set") {
    const elementTypeNode = resolvedNode.typeArguments?.[0];
    const elementType = normalizeTypeHintForUse(typeNodeToCppType(elementTypeNode, typeAliases));
    return `std::set<${elementType}>`;
  }

  if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName) && resolvedNode.typeName.text === "Map") {
    const keyTypeNode = resolvedNode.typeArguments?.[0];
    const valueTypeNode = resolvedNode.typeArguments?.[1];
    const keyType = normalizeTypeHintForUse(typeNodeToCppType(keyTypeNode, typeAliases));
    const valueType = normalizeTypeHintForUse(typeNodeToCppType(valueTypeNode, typeAliases));
    return `std::map<${keyType}, ${valueType}>`;
  }

  if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName) && resolvedNode.typeName.text === "Record") {
    const keyTypeNode = resolvedNode.typeArguments?.[0];
    const valueTypeNode = resolvedNode.typeArguments?.[1];
    const keyType = normalizeTypeHintForUse(typeNodeToCppType(keyTypeNode, typeAliases));
    const valueType = normalizeTypeHintForUse(typeNodeToCppType(valueTypeNode, typeAliases));
    return `std::map<${keyType}, ${valueType}>`;
  }

  return "auto";
}

export function resolveFunctionTypeSignature(
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

export function isStructuredTypeAnnotation(
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

function isKnownTypeName(typeName: string): boolean {
  return isKnownCompileTimeOnlyTypeName(typeName);
}

export function isKnownCompileTimeType(
  typeNode: ts.TypeNode | undefined,
  typeAliases?: Map<string, ts.TypeNode>,
): boolean {
  const resolvedNode = resolveAliasedTypeNode(typeNode, typeAliases);
  if (!resolvedNode) {
    return false;
  }

  if (ts.isIntersectionTypeNode(resolvedNode)) {
    return resolvedNode.types.every((part) => isKnownCompileTimeType(part, typeAliases));
  }

  if (ts.isUnionTypeNode(resolvedNode)) {
    return resolvedNode.types.every((part) => isKnownCompileTimeType(part, typeAliases));
  }

  if (ts.isParenthesizedTypeNode(resolvedNode)) {
    return isKnownCompileTimeType(resolvedNode.type, typeAliases);
  }

  if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName)) {
    return isKnownTypeName(resolvedNode.typeName.text);
  }

  return false;
}

export function inferExprCppType(
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

export function resolveDeclarationType(
  typeNode: ts.TypeNode | undefined,
  initializer: ts.Expression | undefined,
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  typeAliases?: Map<string, ts.TypeNode>,
): ResolvedDeclarationType {
  const explicitType = typeNodeToCppType(typeNode, typeAliases);
  const inferredType = initializer
    ? inferExprCppType(initializer, functionReturnTypes, localVariableTypes)
    : "auto";

  let resolvedType: CppTypeHint;
  if (explicitType === "auto") {
    resolvedType = inferredType;
  } else if (explicitType === "int" && inferredType === "float") {
    resolvedType = "float";
  } else {
    resolvedType = explicitType;
  }

  const canLowerFromStructuredInitializer =
    isStructuredTypeAnnotation(typeNode, typeAliases) &&
    !!initializer &&
    ts.isObjectLiteralExpression(initializer);

  const isKnownType = isKnownCompileTimeType(typeNode, typeAliases);

  return {
    explicitType,
    inferredType,
    resolvedType,
    canLowerFromStructuredInitializer,
    isKnownCompileTimeType: isKnownType,
    shouldWarnUnmappedType:
      explicitType === "auto" &&
      inferredType === "auto" &&
      !!typeNode &&
      !canLowerFromStructuredInitializer &&
      !isKnownType,
  };
}

export function collectReturns(block: ts.Block): ts.ReturnStatement[] {
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

export function buildFunctionReturnTypeMap(source: ts.SourceFile): Map<string, CppTypeHint> {
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

export function resolveFunctionReturnType(name: string, functionReturnTypes: Map<string, CppTypeHint>): CppType {
  return functionReturnTypes.get(name) ?? "void";
}

/**
 * Extract the ownership kind from a TypeScript type node.
 * Detects Ref<T>, MutRef<T>, and Owned<T> wrapper types.
 * Returns undefined if no ownership wrapper is found.
 */
export function extractOwnershipKindFromTypeNode(
  node: ts.TypeNode | undefined,
  typeAliases?: Map<string, ts.TypeNode>,
): 'owned' | 'ref' | 'mut_ref' | undefined {
  if (!node) return undefined;

  // Check the ORIGINAL node before alias resolution.
  // `type Ref<T> = T` would resolve Ref<number> → number, hiding the wrapper.
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const wrapperName = node.typeName.text;
    if (wrapperName === 'Ref') return 'ref';
    if (wrapperName === 'MutRef') return 'mut_ref';
    if (wrapperName === 'Owned') return 'owned';
  }

  return undefined;
}