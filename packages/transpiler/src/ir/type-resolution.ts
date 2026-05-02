import ts from "typescript";
import { CppType } from "./model";
import { topLevelClasses } from "./build-ir-state";
import { inferKindByName } from "@typehal/core/shared";

export type CppTypeHint =
  | "int"
  | "long long"
  | "float"
  | "double"
  | "bool"
  | "auto"
  | "void"
  | "long"
  | "std::string"
  | "unsigned int"
  | `std::vector<${string}>`
  | `std::set<${string}>`
  | `std::map<${string}, ${string}>`
  | `std::function<${string}>`
  | `${string}*`;

interface FunctionTypeSignature {
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
  ["Uint8Array", "uint8_t*"],
  ["Uint16Array", "uint16_t*"],
  ["Uint32Array", "uint32_t*"],
  ["Int8Array", "int8_t*"],
  ["Int16Array", "int16_t*"],
  ["Int32Array", "int32_t*"],
  ["Float32Array", "float*"],
  ["Float64Array", "double*"],
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

const OWNERSHIP_WRAPPER_TYPE_NAMES = new Set<string>([
  "Owned", "Shared", "Mutable",
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
  return /[.eE]/.test(literalText) ? "double" : "int";
}

function getDirectCppType(typeName: string): CppTypeHint | undefined {
  const directCppType = DIRECT_CPP_TYPE_MAP.get(typeName);
  return directCppType as CppTypeHint | undefined;
}

function isBoardDefinitionTypeName(typeName: string): boolean {
  return typeName.endsWith("Board") || typeName.endsWith("Definition") ||
    typeName.startsWith("Native");
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
  // Framework pin implementation types follow the convention {FRAMEWORK}{Capability}Pin
  // (e.g., AVRDigitalPin, ESP32AnalogPin, STM32PWMPin). Recognized by ALL_CAPS prefix
  // followed by a pin-related suffix, or the Native* prefix for bare-metal strategies.
  return typeName.startsWith("Native") ||
    (/^[A-Z][A-Z0-9]/.test(typeName) && /Pin/.test(typeName));
}

function isSharedCompileTimeOnlyTypeName(typeName: string): boolean {
  return PIN_INTERFACE_TYPE_NAMES.has(typeName) ||
    STRATEGY_TYPE_NAMES.has(typeName) ||
    BOARD_CONSTANT_TYPE_NAMES.has(typeName) ||
    OWNERSHIP_WRAPPER_TYPE_NAMES.has(typeName) ||
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
    return "double";
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
  // Shared<T>, Mutable<T>, Owned<T> are phantom types that wrap the real type.
  // We must check the ORIGINAL node before alias resolution, because
  // `type Shared<T> = T` would resolve Shared<number> → number, hiding the wrapper.
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const wrapperName = node.typeName.text;
    if (OWNERSHIP_WRAPPER_TYPE_NAMES.has(wrapperName)) {
      const innerTypeNode = node.typeArguments?.[0];
      return typeNodeToCppType(innerTypeNode, typeAliases);
    }
  }

  const resolvedNode = resolveAliasedTypeNode(node, typeAliases) ?? node;

  // If the resolved node is an object literal type (e.g. type X = { a: number }),
  // return the original type reference name as the C++ struct type.
  if (ts.isTypeLiteralNode(resolvedNode) && ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    return node.typeName.text as CppTypeHint;
  }

  // Handle mapped types like { readonly [P in keyof SomeType]: SomeType[P] }
  // These are type-level copies; in C++ they're equivalent to the source type.
  // Resolve to the source type name since C++ doesn't have readonly.
  if (ts.isMappedTypeNode(resolvedNode)) {
    const constraint = resolvedNode.typeParameter?.constraint;
    if (constraint && ts.isTypeOperatorNode(constraint) && constraint.operator === ts.SyntaxKind.KeyOfKeyword) {
      const sourceType = constraint.type;
      if (sourceType && ts.isTypeReferenceNode(sourceType) && ts.isIdentifier(sourceType.typeName)) {
        // The mapped type mirrors the source type; resolve to the source type name
        return sourceType.typeName.text as CppTypeHint;
      }
    }
    // Generic mapped type fallback: use the outer type reference name
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      return node.typeName.text as CppTypeHint;
    }
  }

  if (ts.isParenthesizedTypeNode(resolvedNode)) {
    return typeNodeToCppType(resolvedNode.type, typeAliases);
  }

  if (ts.isUnionTypeNode(resolvedNode)) {
    const nonNullTypes = resolvedNode.types.filter(t => {
      return t.kind !== ts.SyntaxKind.NullKeyword && t.kind !== ts.SyntaxKind.UndefinedKeyword;
    });
    if (nonNullTypes.length === 0) {
      return "auto";
    }
    if (nonNullTypes.length === 1) {
      return typeNodeToCppType(nonNullTypes[0], typeAliases);
    }
    // Multi-type union: resolve each member and emit std::variant
    const memberTypes = nonNullTypes
      .map(t => typeNodeToCppType(t, typeAliases))
      .filter((t): t is CppTypeHint => t !== "auto" && t !== undefined);
    const uniqueTypes = [...new Set(memberTypes)];
    if (uniqueTypes.length >= 2) {
      return `std::variant<${uniqueTypes.join(", ")}>` as CppTypeHint;
    }
    if (uniqueTypes.length === 1) {
      return uniqueTypes[0];
    }
    return "auto";
  }

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

  if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName) && resolvedNode.typeName.text === "ReadonlySet") {
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

  if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName) && resolvedNode.typeName.text === "ReadonlyMap") {
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

  if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName) && resolvedNode.typeName.text === "ReadonlyArray") {
    const elementTypeNode = resolvedNode.typeArguments?.[0];
    const elementType = normalizeTypeHintForUse(typeNodeToCppType(elementTypeNode, typeAliases));
    return `std::vector<${elementType}>`;
  }

  // User-defined types (interfaces, classes, enums) pass through as their C++ type name.
  if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName)) {
    return resolvedNode.typeName.text as CppTypeHint;
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

function isKnownTypeName(typeName: string): boolean {
  return isKnownCompileTimeOnlyTypeName(typeName);
}

function isKnownCompileTimeType(
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

const typehalMethodReturnTypes: Map<string, CppTypeHint> = new Map([
  // analog-input methods
  ["analog-input:readVoltage", "float"],
  ["analog-input:readAnalog", "int"],
  ["analog-input:read", "int"],
  ["analog-input:getResolution", "int"],
  ["analog-input:getAnalogResolution", "int"],
  // pwm-output methods
  ["pwm-output:pwm", "void"],
  ["pwm-output:getPwmResolution", "int"],
  // digital methods
  ["digital:read", "int"],
  ["digital:high", "void"],
  ["digital:low", "void"],
  ["digital:toggle", "void"],
  // serial methods
  ["serial:read", "int"],
  ["serial:available", "int"],
  ["serial:readLine", "String" as CppTypeHint],
  ["serial:readString", "String" as CppTypeHint],
]);

export function getTypehalMethodReturnType(receiverKind: string, method: string): CppTypeHint | undefined {
  return typehalMethodReturnTypes.get(`${receiverKind}:${method}`);
}

export function inferExprCppType(
  expr: ts.Expression,
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  sourceText?: string,
): CppTypeHint {
  if (ts.isAwaitExpression(expr)) {
    return inferExprCppType(expr.expression, functionReturnTypes, localVariableTypes, sourceText);
  }

  if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr)) {
    return inferExprCppType(expr.expression, functionReturnTypes, localVariableTypes, sourceText);
  }

  // typeof always produces a string result
  if (ts.isTypeOfExpression(expr)) {
    return "std::string";
  }

  if (ts.isNumericLiteral(expr)) {
    // Use original source text — TypeScript normalizes "2.0" to "2" in expr.text
    const literalText = sourceText
      ? sourceText.substring(expr.pos, expr.end).trim()
      : expr.text;
    return inferNumericCppType(literalText);
  }

  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return "std::string";
  }

  if (ts.isArrayLiteralExpression(expr)) {
    const inferredElementTypes = expr.elements
      .filter((item): item is ts.Expression => !ts.isSpreadElement(item))
      .map((item) => inferExprCppType(item, functionReturnTypes, localVariableTypes, sourceText))
      .filter((item) => item !== "auto");

    if (inferredElementTypes.length === 0) {
      return "std::vector<int>";
    }

    if (inferredElementTypes.includes("float") || inferredElementTypes.includes("double")) {
      return "std::vector<double>";
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

  if (ts.isCallExpression(expr)) {
    if (ts.isIdentifier(expr.expression)) {
      const fnReturnType = functionReturnTypes.get(expr.expression.text);
      if (fnReturnType && fnReturnType !== "auto") {
        return fnReturnType;
      }
    }
    if (ts.isPropertyAccessExpression(expr.expression)) {
      if (ts.isIdentifier(expr.expression.expression)) {
        const className = expr.expression.expression.text;
        const classDef = topLevelClasses.get(className);
        if (classDef) {
          const method = expr.expression.name.text;
          const classMethod = classDef.methods.find((m) => m.name === method);
          if (classMethod) {
            return classMethod.returnType as CppTypeHint;
          }
        }

        const receiverKind = inferKindByName(className);
        if (receiverKind !== "unknown") {
          const method = expr.expression.name.text;
          const typehalReturn = typehalMethodReturnTypes.get(`${receiverKind}:${method}`);
          if (typehalReturn) {
            return typehalReturn;
          }
        }
      }

      const receiverType = inferExprCppType(expr.expression.expression, functionReturnTypes, localVariableTypes, sourceText);
      let receiverClassName = receiverType as string;
      if (receiverClassName.endsWith("*")) {
        receiverClassName = receiverClassName.slice(0, -1);
      }
      if (receiverClassName.startsWith("const ")) {
        receiverClassName = receiverClassName.slice("const ".length);
      }
      const classDef = topLevelClasses.get(receiverClassName);
      if (classDef) {
        const method = expr.expression.name.text;
        const classMethod = classDef.methods.find((m) => m.name === method);
        if (classMethod) {
          return classMethod.returnType as CppTypeHint;
        }
      }
    }
  }

  if (ts.isIdentifier(expr)) {
    return localVariableTypes.get(expr.text) ?? "auto";
  }

  if (ts.isParenthesizedExpression(expr)) {
    return inferExprCppType(expr.expression, functionReturnTypes, localVariableTypes, sourceText);
  }

  if (ts.isConditionalExpression(expr)) {
    const whenTrueType = inferExprCppType(expr.whenTrue, functionReturnTypes, localVariableTypes, sourceText);
    const whenFalseType = inferExprCppType(expr.whenFalse, functionReturnTypes, localVariableTypes, sourceText);

    if (whenTrueType === "std::string" || whenFalseType === "std::string") {
      return "std::string";
    }
    if (whenTrueType === "float" || whenFalseType === "float" || whenTrueType === "double" || whenFalseType === "double") {
      return "double";
    }
    if ((whenTrueType === "int" || whenTrueType === "bool") && (whenFalseType === "int" || whenFalseType === "bool")) {
      return "int";
    }
    if (whenTrueType === whenFalseType) {
      return whenTrueType;
    }
    return "auto";
  }

  if (ts.isPropertyAccessExpression(expr)) {
    if (expr.name.text === "length") {
      return "int";
    }
    if (ts.isIdentifier(expr.expression) && /^[A-Z]/.test(expr.expression.text)) {
      return "int";
    }
    return "auto";
  }

  if (ts.isBinaryExpression(expr)) {
    const operator = expr.operatorToken.kind;
    const leftType = inferExprCppType(expr.left, functionReturnTypes, localVariableTypes, sourceText);
    const rightType = inferExprCppType(expr.right, functionReturnTypes, localVariableTypes, sourceText);

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

    if (leftType === "float" || rightType === "float" || leftType === "double" || rightType === "double") {
      return "double";
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
      const ctorName = expr.expression.text;
      // Check if it's a typed array with a known C++ mapping
      const directType = getDirectCppType(ctorName);
      if (directType) {
        return directType;  // e.g. "uint8_t*" for Uint8Array
      }
      return `${ctorName}*`;
    }
    return "auto";
  }

  if (ts.isElementAccessExpression(expr)) {
    const objectType = inferExprCppType(expr.expression, functionReturnTypes, localVariableTypes, sourceText);
    // Typed array pointers → element types
    if (objectType === "float*") return "float";
    if (objectType === "uint8_t*") return "int";
    if (objectType === "int16_t*") return "int";
    if (objectType === "int32_t*") return "int";
    // Check local variable declarations for typed array constructors
    if (ts.isIdentifier(expr.expression)) {
      const varName = expr.expression.text;
      const varType = localVariableTypes.get(varName);
      if (varType === "float*") return "float";
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
  } else if (explicitType === "int" && (inferredType === "float" || inferredType === "double")) {
    resolvedType = "double";
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

/** Collect local variable types from a function body (single-level scan). */
function collectLocalVarTypes(body: ts.Block, functionReturnTypes: Map<string, CppTypeHint>, sourceText: string): Map<string, CppTypeHint> {
  const locals = new Map<string, CppTypeHint>();
  for (const stmt of body.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          const initType = inferExprCppType(decl.initializer, functionReturnTypes, locals, sourceText);
          if (initType !== "auto") {
            locals.set(decl.name.text, initType);
          }
        }
      }
    }
  }
  return locals;
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
  const sourceText = source.text;
  const functions = source.statements.filter(ts.isFunctionDeclaration);

  for (let pass = 0; pass < 3; pass++) {
    for (const fn of functions) {
      if (!fn.name || !fn.body) {
        continue;
      }

      if (fn.type) {
        const annotatedType = typeNodeToCppType(fn.type);
        if (annotatedType !== "auto") {
          // Promote int → float when the function body returns float expressions
          if (annotatedType === "int") {
            const locals = collectLocalVarTypes(fn.body, result, sourceText);
            const returns = collectReturns(fn.body).filter((item) => item.expression);
            const inferredTypes = returns
              .map((item) => inferExprCppType(item.expression as ts.Expression, result, locals, sourceText))
              .filter((item) => item !== "auto");
            if (inferredTypes.includes("float") || inferredTypes.includes("double")) {
              result.set(fn.name.text, "double");
              continue;
            }
            // Promote int → long when returning large enum values
            if (returnsLargeEnumValue(fn.body, returns)) {
              result.set(fn.name.text, "long");
              continue;
            }
          }
          result.set(fn.name.text, annotatedType);
          continue;
        }
      }

      const locals = collectLocalVarTypes(fn.body, result, sourceText);
      const returns = collectReturns(fn.body).filter((item) => item.expression);
      if (returns.length === 0) {
        continue;
      }

      const inferredTypes = returns
        .map((item) => inferExprCppType(item.expression as ts.Expression, result, locals, sourceText))
        .filter((item) => item !== "auto");

      if (inferredTypes.length === 0) {
        continue;
      }

      if (inferredTypes.includes("float") || inferredTypes.includes("double")) {
        result.set(fn.name.text, "double");
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

/**
 * Check if a function body contains enum declarations with values outside the
 * 16-bit signed int range (>32767 or <-32768) and any return expression
 * accesses those enums.
 */
function returnsLargeEnumValue(
  body: ts.Block,
  returns: ts.ReturnStatement[],
): boolean {
  const largeEnumNames = new Set<string>();

  const walkForEnums = (node: ts.Node): void => {
    if (ts.isEnumDeclaration(node) && node.name) {
      for (const member of node.members) {
        let value: number | undefined;
        if (member.initializer && ts.isNumericLiteral(member.initializer)) {
          value = Number(member.initializer.text);
        } else if (
          member.initializer &&
          ts.isPrefixUnaryExpression(member.initializer) &&
          member.initializer.operator === ts.SyntaxKind.MinusToken &&
          ts.isNumericLiteral(member.initializer.operand)
        ) {
          value = -Number((member.initializer.operand as ts.NumericLiteral).text);
        }
        if (value !== undefined && (value > 32767 || value < -32768)) {
          largeEnumNames.add(node.name.text);
          break;
        }
      }
    }
    node.forEachChild(walkForEnums);
  };
  walkForEnums(body);

  if (largeEnumNames.size === 0) return false;

  for (const ret of returns) {
    if (ret.expression &&
        ts.isPropertyAccessExpression(ret.expression) &&
        ts.isIdentifier(ret.expression.expression) &&
        largeEnumNames.has(ret.expression.expression.text)) {
      return true;
    }
  }
  return false;
}

export function resolveFunctionReturnType(name: string, functionReturnTypes: Map<string, CppTypeHint>): CppType {
  return functionReturnTypes.get(name) ?? "void";
}

/**
 * Extract the ownership kind from a TypeScript type node.
 * Detects Shared<T>, Mutable<T>, and Owned<T> wrapper types.
 * Returns undefined if no ownership wrapper is found.
 */
export function extractOwnershipKindFromTypeNode(
  node: ts.TypeNode | undefined,
  typeAliases?: Map<string, ts.TypeNode>,
): 'owned' | 'shared' | 'mutable' | undefined {
  if (!node) return undefined;

  // Check the ORIGINAL node before alias resolution.
  // `type Shared<T> = T` would resolve Shared<number> → number, hiding the wrapper.
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const wrapperName = node.typeName.text;
    if (wrapperName === 'Shared') return 'shared';
    if (wrapperName === 'Mutable') return 'mutable';
    if (wrapperName === 'Owned') return 'owned';
  }

  return undefined;
}