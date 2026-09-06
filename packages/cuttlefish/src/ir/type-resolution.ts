import ts from "typescript";
import { CppType } from "../api/index.js";
import { classTypeNames, topLevelClasses, discriminatedUnionVariantNames, activeEnumNames } from "./build-ir-state.js";
import { getCurrentIrTypeScope } from "./symbol-types.js";
import {
  type CppTypeIR,
  parseCppType,
  renderCppType,
  splitTemplateArgs,
  bareType,
  elementOf,
  isPointer,
} from "../api/shared/cpp-type-ir.js";

export type CppTypeHint =
  | "int"
  | "long long"
  | "unsigned long long"
  | "float"
  | "double"
  | "bool"
  | "auto"
  | "void"
  | "long"
  | "std::string"
  | "unsigned int"
  | "__tc_str_ptr"
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
  "II2CBus", "ISPIBus", "ISerialPort",
  "I2CConfig", "SPIConfig", "UARTConfig",
  "I2CAddress", "SPITransferOptions",
]);

const STRATEGY_TYPE_NAMES = new Set<string>([
  "NativeStrategy", "ZephyrStrategy", "BoardStrategy",
  "RuntimePolyfillIR", "PeripheralUsage",
]);

const BOARD_CONSTANT_TYPE_NAMES = new Set<string>([
  "INPUT", "OUTPUT", "INPUT_PULLUP", "INPUT_PULLDOWN",
  "CHANGE", "FALLING", "RISING",
]);

const OWNERSHIP_WRAPPER_TYPE_NAMES = new Set<string>([
  "Owned", "Shared", "Mutable",
]);

/** Safety wrapper types: like ownership wrappers (phantom TS types that carry
 *  a type parameter), but instead of stripping the wrapper, the C++ keeps it
 *  as a template instantiation: SafeVariable<number> → SafeVariable<double>,
 *  SafeInt<number> → SafeInt<int32_t> (integer-only by contract).
 *  The C++ template definition is provided by the safety polyfill. */
const SAFE_WRAPPER_TYPE_NAMES = new Set<string>([
  "SafeVariable",
  "SafeInt",
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

export function getDirectCppType(typeName: string): CppTypeHint | undefined {
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

function functionTypeNodeToCppType(node: ts.FunctionTypeNode, typeAliases?: Map<string, ts.TypeNode>, typeParametersInScope?: Set<string>): CppTypeHint {
  // Build via CppTypeIR so the function signature is structured, then flatten
  // to the canonical `std::function<R(P...)>` string at the boundary.
  const returnType = normalizeTypeHintForUse(typeNodeToCppType(node.type, typeAliases, typeParametersInScope));
  const params = node.parameters.map((parameter) =>
    normalizeTypeHintForUse(typeNodeToCppType(parameter.type, typeAliases, typeParametersInScope)),
  );
  const ir: CppTypeIR = {
    kind: "function",
    returnType: parseCppType(returnType),
    params: params.map((p) => parseCppType(p)),
  };
  return renderCppType(ir) as CppTypeHint;
}

export function typeNodeToCppType(node: ts.TypeNode | undefined, typeAliases?: Map<string, ts.TypeNode>, typeParametersInScope?: Set<string>): CppTypeHint {
  if (!node) {
    return "auto";
  }

  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const typeName = node.typeName.text;
    if (typeParametersInScope && typeParametersInScope.has(typeName)) {
      return typeName as CppTypeHint;
    }
  }

  // ── Ownership wrapper detection (before alias resolution) ───────────
  // Shared<T>, Mutable<T>, Owned<T> are phantom types that wrap the real type.
  // We must check the ORIGINAL node before alias resolution, because
  // `type Shared<T> = T` would resolve Shared<number> → number, hiding the wrapper.
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const wrapperName = node.typeName.text;
    if (OWNERSHIP_WRAPPER_TYPE_NAMES.has(wrapperName)) {
      const innerTypeNode = node.typeArguments?.[0];
      return typeNodeToCppType(innerTypeNode, typeAliases, typeParametersInScope);
    }
    // SafeVariable<T> is a safety wrapper: unlike ownership wrappers (which
    // strip the wrapper name entirely), SafeVariable keeps the wrapper name
    // in the C++ type because the polyfill provides a template definition.
    // SafeVariable<number> → SafeVariable<double> (the keyword's general
    // mapping; the polyfill ships float/double specializations).
    if (SAFE_WRAPPER_TYPE_NAMES.has(wrapperName)) {
      const innerTypeNode = node.typeArguments?.[0];
      // SafeInt is signed-integer-only by contract — its polyfill carries a
      // static_assert rejecting floating-point T. The TS `number` keyword
      // (and SafeInt's implicit `T = number` default) therefore resolves to
      // int32_t, NOT the general number→double mapping. An explicit float /
      // double annotation still passes through so the static_assert fires as
      // designed.
      if (wrapperName === "SafeInt" &&
          (innerTypeNode === undefined || innerTypeNode.kind === ts.SyntaxKind.NumberKeyword)) {
        return "SafeInt<int32_t>" as CppTypeHint;
      }
      const innerCppType = typeNodeToCppType(innerTypeNode, typeAliases, typeParametersInScope);
      return `${wrapperName}<${innerCppType}>` as CppTypeHint;
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
    return typeNodeToCppType(resolvedNode.type, typeAliases, typeParametersInScope);
  }

  if (ts.isUnionTypeNode(resolvedNode)) {
    const nonNullTypes = resolvedNode.types.filter(t => {
      return t.kind !== ts.SyntaxKind.NullKeyword && t.kind !== ts.SyntaxKind.UndefinedKeyword;
    });
    if (nonNullTypes.length === 0) {
      return "auto";
    }
    if (nonNullTypes.length === 1) {
      return typeNodeToCppType(nonNullTypes[0], typeAliases, typeParametersInScope);
    }

    const allAreTypeLiterals = nonNullTypes.every(ts.isTypeLiteralNode);
    if (allAreTypeLiterals) {
      const variantNames = discriminatedUnionVariantNames.get(ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) ? node.typeName.text : "");
      if (variantNames) {
        return `std::variant<${variantNames.join(", ")}>` as CppTypeHint;
      }
      const variantNamesFallback = nonNullTypes.map((_, i) => `_Variant_${i}`);
      return `std::variant<${variantNamesFallback.join(", ")}>` as CppTypeHint;
    }

    const memberTypes = nonNullTypes
      .map(t => typeNodeToCppType(t, typeAliases, typeParametersInScope))
      .filter((t): t is CppTypeHint => t !== "auto" && t !== undefined);
    const uniqueTypes = [...new Set(memberTypes)];
    if (uniqueTypes.length >= 2) {
      // Build via CppTypeIR.variant so the members are parsed structure, not
      // a hand-joined string. Renders byte-identically to the old form.
      const ir: CppTypeIR = {
        kind: "variant",
        members: uniqueTypes.map((t) => parseCppType(t)),
      };
      return renderCppType(ir) as CppTypeHint;
    }
    if (uniqueTypes.length === 1) {
      return uniqueTypes[0];
    }
    return "auto";
  }

  if (ts.isArrayTypeNode(resolvedNode)) {
    const elementType = normalizeTypeHintForUse(typeNodeToCppType(resolvedNode.elementType, typeAliases, typeParametersInScope));
    const ir: CppTypeIR = { kind: "vector", element: parseCppType(elementType) };
    return renderCppType(ir) as CppTypeHint;
  }

  if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName) && resolvedNode.typeName.text === "Array") {
    const elementTypeNode = resolvedNode.typeArguments?.[0];
    const elementType = normalizeTypeHintForUse(typeNodeToCppType(elementTypeNode, typeAliases, typeParametersInScope));
    const ir: CppTypeIR = { kind: "vector", element: parseCppType(elementType) };
    return renderCppType(ir) as CppTypeHint;
  }

  if (ts.isFunctionTypeNode(resolvedNode)) {
    return functionTypeNodeToCppType(resolvedNode, typeAliases, typeParametersInScope);
  }

  if (resolvedNode.kind === ts.SyntaxKind.NumberKeyword) {
    return "double";
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
    const elementType = normalizeTypeHintForUse(typeNodeToCppType(elementTypeNode, typeAliases, typeParametersInScope));
    const ir: CppTypeIR = { kind: "set", element: parseCppType(elementType) };
    return renderCppType(ir) as CppTypeHint;
  }

  if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName) && resolvedNode.typeName.text === "ReadonlySet") {
    const elementTypeNode = resolvedNode.typeArguments?.[0];
    const elementType = normalizeTypeHintForUse(typeNodeToCppType(elementTypeNode, typeAliases, typeParametersInScope));
    const ir: CppTypeIR = { kind: "set", element: parseCppType(elementType) };
    return renderCppType(ir) as CppTypeHint;
  }

  if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName) && resolvedNode.typeName.text === "Map") {
    const keyTypeNode = resolvedNode.typeArguments?.[0];
    const valueTypeNode = resolvedNode.typeArguments?.[1];
    const keyType = normalizeTypeHintForUse(typeNodeToCppType(keyTypeNode, typeAliases, typeParametersInScope));
    const valueType = normalizeTypeHintForUse(typeNodeToCppType(valueTypeNode, typeAliases, typeParametersInScope));
    const ir: CppTypeIR = { kind: "map", key: parseCppType(keyType), value: parseCppType(valueType) };
    return renderCppType(ir) as CppTypeHint;
  }

  if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName) && resolvedNode.typeName.text === "ReadonlyMap") {
    const keyTypeNode = resolvedNode.typeArguments?.[0];
    const valueTypeNode = resolvedNode.typeArguments?.[1];
    const keyType = normalizeTypeHintForUse(typeNodeToCppType(keyTypeNode, typeAliases, typeParametersInScope));
    const valueType = normalizeTypeHintForUse(typeNodeToCppType(valueTypeNode, typeAliases, typeParametersInScope));
    const ir: CppTypeIR = { kind: "map", key: parseCppType(keyType), value: parseCppType(valueType) };
    return renderCppType(ir) as CppTypeHint;
  }

  if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName) && resolvedNode.typeName.text === "Record") {
    const keyTypeNode = resolvedNode.typeArguments?.[0];
    const valueTypeNode = resolvedNode.typeArguments?.[1];
    const keyType = normalizeTypeHintForUse(typeNodeToCppType(keyTypeNode, typeAliases, typeParametersInScope));
    const valueType = normalizeTypeHintForUse(typeNodeToCppType(valueTypeNode, typeAliases, typeParametersInScope));
    const ir: CppTypeIR = { kind: "map", key: parseCppType(keyType), value: parseCppType(valueType) };
    return renderCppType(ir) as CppTypeHint;
  }

  if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName) && resolvedNode.typeName.text === "ReadonlyArray") {
    const elementTypeNode = resolvedNode.typeArguments?.[0];
    const elementType = normalizeTypeHintForUse(typeNodeToCppType(elementTypeNode, typeAliases, typeParametersInScope));
    const ir: CppTypeIR = { kind: "vector", element: parseCppType(elementType) };
    return renderCppType(ir) as CppTypeHint;
  }

  // Tuple types: [A, B, C] → std::tuple<A, B, C>
  if (ts.isTupleTypeNode(resolvedNode)) {
    const elementTypes = resolvedNode.elements.map((el: ts.TypeNode) => {
      if (ts.isOptionalTypeNode(el)) {
        return normalizeTypeHintForUse(typeNodeToCppType(el.type, typeAliases, typeParametersInScope));
      }
      if (ts.isRestTypeNode(el)) {
        return normalizeTypeHintForUse(typeNodeToCppType(el.type, typeAliases, typeParametersInScope));
      }
      return normalizeTypeHintForUse(typeNodeToCppType(el, typeAliases, typeParametersInScope));
    });
    const ir: CppTypeIR = { kind: "tuple", elements: elementTypes.map((t) => parseCppType(t)) };
    return renderCppType(ir) as CppTypeHint;
  }

  // User-defined types (interfaces, classes, enums) pass through as their C++ type name.
  if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName)) {
    const typeName = resolvedNode.typeName.text;

    if (typeName === "Partial" && resolvedNode.typeArguments?.length === 1) {
      return normalizeTypeHintForUse(typeNodeToCppType(resolvedNode.typeArguments[0], typeAliases, typeParametersInScope)) as CppTypeHint;
    }
    if (typeName === "Required" && resolvedNode.typeArguments?.length === 1) {
      return normalizeTypeHintForUse(typeNodeToCppType(resolvedNode.typeArguments[0], typeAliases, typeParametersInScope)) as CppTypeHint;
    }
    if (typeName === "NonNullable" && resolvedNode.typeArguments?.length === 1) {
      const inner = typeNodeToCppType(resolvedNode.typeArguments[0], typeAliases, typeParametersInScope);
      return (inner || "auto") as CppTypeHint;
    }
    if (typeName === "Readonly" && resolvedNode.typeArguments?.length === 1) {
      return normalizeTypeHintForUse(typeNodeToCppType(resolvedNode.typeArguments[0], typeAliases, typeParametersInScope)) as CppTypeHint;
    }
    if (typeName === "Pick" && resolvedNode.typeArguments?.length === 2) {
      return normalizeTypeHintForUse(typeNodeToCppType(resolvedNode.typeArguments[0], typeAliases, typeParametersInScope)) as CppTypeHint;
    }
    if (typeName === "Omit" && resolvedNode.typeArguments?.length === 2) {
      return normalizeTypeHintForUse(typeNodeToCppType(resolvedNode.typeArguments[0], typeAliases, typeParametersInScope)) as CppTypeHint;
    }
    if (typeName === "Record" && resolvedNode.typeArguments?.length === 2) {
      const keyType = typeNodeToCppType(resolvedNode.typeArguments[0], typeAliases, typeParametersInScope);
      const valueType = typeNodeToCppType(resolvedNode.typeArguments[1], typeAliases, typeParametersInScope);
      const ir: CppTypeIR = { kind: "map", key: parseCppType(keyType), value: parseCppType(valueType) };
      return renderCppType(ir) as CppTypeHint;
    }
    if (typeName === "ReturnType" || typeName === "Parameters" || typeName === "ConstructorParameters" || typeName === "InstanceType" || typeName === "Extract" || typeName === "Exclude") {
      return "auto";
    }

    // TypeScript class values are references. Keep that representation consistent
    // across declarations, parameters, returns, fields, and containers so `new X()`
    // is never assigned to a value-typed C++ `X` by accident. Modeled as a
    // `pointer(named(typeName, args?))` so the class-vs-value distinction is
    // structural, not a trailing `*` to be re-parsed.
    if (classTypeNames.has(typeName)) {
      const typeArgs = resolvedNode.typeArguments?.map((arg) =>
        normalizeTypeHintForUse(typeNodeToCppType(arg, typeAliases, typeParametersInScope))
      );
      const namedIr: CppTypeIR = {
        kind: "named",
        name: typeName,
        args: typeArgs && typeArgs.length > 0 ? typeArgs.map((t) => parseCppType(t)) : undefined,
      };
      const ir: CppTypeIR = { kind: "pointer", base: namedIr };
      return renderCppType(ir) as CppTypeHint;
    }

    return resolvedNode.typeName.text as CppTypeHint;
  }

  if (ts.isIntersectionTypeNode(resolvedNode)) {
    for (const part of resolvedNode.types) {
      const cppType = typeNodeToCppType(part, typeAliases, typeParametersInScope);
      if (cppType && cppType !== "auto" && cppType !== "void") {
        return cppType;
      }
    }
    return "auto";
  }

  if (ts.isLiteralTypeNode(resolvedNode)) {
    if (ts.isStringLiteral(resolvedNode.literal)) return "std::string" as CppTypeHint;
    if (ts.isNumericLiteral(resolvedNode.literal)) return "int" as CppTypeHint;
    if (resolvedNode.literal.kind === ts.SyntaxKind.TrueKeyword || resolvedNode.literal.kind === ts.SyntaxKind.FalseKeyword) return "bool" as CppTypeHint;
    return "auto";
  }

  // Indexed access types: T[K] — resolve to auto for now since C++ doesn't have this
  if ((resolvedNode as any).kind === ts.SyntaxKind.IndexedAccessType) {
    const indexed = resolvedNode as ts.IndexedAccessTypeNode;
    const objectType = typeNodeToCppType(indexed.objectType, typeAliases, typeParametersInScope);
    if (objectType && objectType !== "auto") {
      const indexType = indexed.indexType;
      if (ts.isLiteralTypeNode(indexType) && ts.isStringLiteral(indexType.literal)) {
        return "auto";
      }
    }
    return "auto";
  }

  // Conditional types: T extends U ? X : Y — resolve to true branch optimistically
  if ((resolvedNode as any).kind === (ts.SyntaxKind as any).ConditionalType) {
    const conditional = resolvedNode as ts.ConditionalTypeNode;
    return typeNodeToCppType(conditional.trueType, typeAliases, typeParametersInScope);
  }

  // Template literal types — no C++ equivalent
  if ((resolvedNode as any).kind === ts.SyntaxKind.TemplateLiteralType ||
      (resolvedNode as any).kind === ts.SyntaxKind.TemplateLiteralTypeSpan) {
    return "auto";
  }

  // keyof T — return auto since C++ doesn't have this concept
  if (ts.isTypeOperatorNode(resolvedNode) && resolvedNode.operator === ts.SyntaxKind.KeyOfKeyword) {
    return "auto";
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

export function inferExprCppType(
  expr: ts.Expression,
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  sourceText?: string,
): CppTypeHint {
  if (ts.isAwaitExpression(expr)) {
    return inferExprCppType(expr.expression, functionReturnTypes, localVariableTypes, sourceText);
  }

  if (ts.isNonNullExpression(expr) || ts.isParenthesizedExpression(expr)) {
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
    const firstElem = inferredElementTypes[0];
    if (firstElem) {
      return `std::vector<${firstElem}>`;
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
        if (className === "Math") {
          const method = expr.expression.name.text;
          if (["floor", "ceil", "round", "abs", "sqrt", "sin", "cos", "tan", "atan2", "log", "exp", "pow", "fmod"].includes(method)) {
            return "double";
          }
          if (method === "min" || method === "max") {
            const leftType = expr.arguments.length > 0
              ? inferExprCppType(expr.arguments[0], functionReturnTypes, localVariableTypes, sourceText)
              : "auto";
            if (leftType !== "auto") return leftType;
            return "int";
          }
          if (method === "random") return "double";
        }
        const classDef = topLevelClasses.get(className);
        if (classDef) {
          const method = expr.expression.name.text;
          const classMethod = classDef.methods.find((m) => m.name === method);
          if (classMethod) {
            return classMethod.returnType as CppTypeHint;
          }
        }
      }

      const receiverType = inferExprCppType(expr.expression.expression, functionReturnTypes, localVariableTypes, sourceText);
      // Peel pointer/const off the receiver to recover the bare class name.
      // Uses the structured bareType() rather than ad-hoc slice/replace.
      const receiverIr = parseCppType(receiverType);
      const receiverClassName = (() => {
        const bare = bareType(receiverIr);
        return bare.kind === "named" ? bare.name : renderCppType(bare);
      })();
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
    // Demo #31 Finding C — a bare identifier may resolve to a MODULE-SCOPE
    // (top-level const/let) variable, not just a function local. The prior
    // code consulted `localVariableTypes` only, so a `for (const r of ARR)`
    // over a top-level `const ARR: string[]` resolved `ARR` to "auto" (the
    // for-of element-type inference then couldn't see the vector element
    // type, the loop variable carried `auto`, and because a for-of var has
    // no initializer the snprintf specifier picker couldn't recover the real
    // type — defaulting to `%d` for a `std::string`, tripping g++ -Wformat=
    // and producing garbage at runtime). The fix consults the IR type scope's
    // `globals` map (populated for every top-level decl in variables.ts) as a
    // fallback, matching what `resolveReceiverCppType` in array-methods.ts
    // already does for the string/array-method disambiguation. This is the
    // same lookup shape used at line ~747 for member-access receivers.
    const fromLocals = localVariableTypes.get(expr.text);
    if (fromLocals && fromLocals !== "auto") return fromLocals;
    const fromGlobals = getCurrentIrTypeScope()?.globals.get(expr.text);
    if (fromGlobals && fromGlobals !== "auto") return fromGlobals as CppTypeHint;
    return fromLocals ?? "auto";
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
    if (ts.isIdentifier(expr.expression)) {
      const objName = expr.expression.text;
      if (activeEnumNames.has(objName)) {
        return objName as CppTypeHint;
      }
      if (/^[A-Z]/.test(objName)) {
        return "int";
      }
    }
    if (expr.expression.kind === ts.SyntaxKind.ThisKeyword) {
      const fieldKey = `this->${expr.name.text}`;
      const fieldType = getCurrentIrTypeScope()?.classFields.get(fieldKey);
      if (fieldType && fieldType !== "auto") return fieldType as CppTypeHint;
    }
    if (ts.isIdentifier(expr.expression)) {
      // Prefer the caller-supplied local types (e.g. a lambda's param types)
      // before the module-level scope maps, so a callback body like
      // `(n: Node) => n.capacity` resolves `n` -> Node -> capacity -> double.
      // `scope.locals` is the same Map the caller threaded as
      // localVariableTypes, so the prior activeLocalTypes fallback is subsumed.
      const scope = getCurrentIrTypeScope();
      const objType = localVariableTypes.get(expr.expression.text)
        ?? scope?.locals.get(expr.expression.text) ?? scope?.globals.get(expr.expression.text);
      if (objType && objType !== "auto") {
        // Peel pointer to recover the bare class name via the structured IR.
        const className = (() => {
          const bare = bareType(parseCppType(objType));
          return bare.kind === "named" ? bare.name : "";
        })();
        const classDef = topLevelClasses.get(className);
        if (classDef) {
          const field = classDef.fields.find(f => f.name === expr.name.text);
          if (field && field.cppType !== "auto") return field.cppType as CppTypeHint;
        }
      }
    }
    // Handle chained property access: s.player.weaponName
    if (ts.isPropertyAccessExpression(expr.expression)) {
      const receiverType = inferExprCppType(expr.expression, functionReturnTypes, localVariableTypes, sourceText);
      if (receiverType && receiverType !== "auto") {
        const className = (() => {
          const bare = bareType(parseCppType(receiverType));
          return bare.kind === "named" ? bare.name : "";
        })();
        const classDef = topLevelClasses.get(className);
        if (classDef) {
          const field = classDef.fields.find(f => f.name === expr.name.text);
          if (field && field.cppType !== "auto") return field.cppType as CppTypeHint;
        }
      }
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

    if ((leftType === "int" || leftType === "bool" || leftType === "long long" || leftType === "unsigned long long") && (rightType === "int" || rightType === "bool" || rightType === "long long" || rightType === "unsigned long long")) {
      if (leftType === "long long" || rightType === "long long" || leftType === "unsigned long long" || rightType === "unsigned long long") {
        return "long long";
      }
      return "int";
    }

    // Partial type info: if one operand is auto, use the other for arithmetic ops
    if (leftType === "auto" && rightType !== "auto") return rightType;
    if (rightType === "auto" && leftType !== "auto") return leftType;

    return "auto";
  }

  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return functionReturnTypes.get(expr.expression.text) ?? "auto";
  }

  if (ts.isNewExpression(expr)) {
    if (ts.isIdentifier(expr.expression)) {
      const ctorName = expr.expression.text;
      const directType = getDirectCppType(ctorName);
      if (directType) {
        return directType;
      }
      // Build the class pointer via structured IR: pointer(named(ctorName, args?)).
      const typeArgs = expr.typeArguments?.map((ta: ts.TypeNode) => ta.getText());
      const namedIr: CppTypeIR = {
        kind: "named",
        name: ctorName,
        args: typeArgs && typeArgs.length > 0 ? typeArgs.map((t) => parseCppType(t)) : undefined,
      };
      const ir: CppTypeIR = { kind: "pointer", base: namedIr };
      return renderCppType(ir) as CppTypeHint;
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

    const objectIr = parseCppType(objectType);

    // std::tuple<N> element access → extract Nth type
    if (objectIr.kind === "tuple") {
      const argExpr = expr.argumentExpression;
      if (argExpr && ts.isNumericLiteral(argExpr)) {
        const idx = parseInt(argExpr.text, 10);
        if (idx >= 0 && idx < objectIr.elements.length) {
          return renderCppType(objectIr.elements[idx]) as CppTypeHint;
        }
      }
      return "auto";
    }

    // Element type of vector / staticArray / cArray, or value type of map.
    // Replaces the three duplicated inline parsers (vector / __tc_StaticArray /
    // C-array) with one structured lookup. The uint8_t/int8_t → int and
    // float/double → double promotions are preserved for element access.
    const elemIr = elementOf(objectIr);
    if (elemIr) {
      const elemStr = renderCppType(elemIr);
      if (elemStr === "uint8_t" || elemStr === "int8_t") return "int";
      if (elemStr === "float" || elemStr === "double") return "double";
      return elemStr as CppTypeHint;
    }

    // Check local variable declarations for typed array constructors
    if (ts.isIdentifier(expr.expression)) {
      const varName = expr.expression.text;
      const varType = localVariableTypes.get(varName);
      if (varType === "float*") return "float";
    }
    return "auto";
  }

  // Handle arrow functions and function expressions — infer return type from body
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
    const body = expr.body;
    if (ts.isBlock(body)) {
      const returnTypes = collectReturns(body)
        .filter((item) => item.expression)
        .map((item) => inferExprCppType(item.expression as ts.Expression, functionReturnTypes, localVariableTypes, sourceText))
        .filter((item) => item !== "auto");
      if (returnTypes.includes("float") || returnTypes.includes("double")) {
        return "double";
      }
      if (returnTypes.includes("std::string")) {
        return "std::string";
      }
      if (returnTypes.includes("int") || returnTypes.includes("bool")) {
        return "int";
      }
      if (returnTypes.length > 0) {
        return returnTypes[0];
      }
      return "void";
    }
    // Expression body — infer from the expression
    return inferExprCppType(body, functionReturnTypes, localVariableTypes, sourceText);
  }

  return "auto";
}

export function resolveDeclarationType(
  typeNode: ts.TypeNode | undefined,
  initializer: ts.Expression | undefined,
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  typeAliases?: Map<string, ts.TypeNode>,
  sourceText?: string,
): ResolvedDeclarationType {
  const explicitType = typeNodeToCppType(typeNode, typeAliases);
  const inferredType = initializer
    ? inferExprCppType(initializer, functionReturnTypes, localVariableTypes, sourceText)
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
        // For generic functions the annotated return type may reference a type
        // parameter (e.g. `function clamp<T>(...): T`). At a call site we can't
        // resolve `T` to a concrete C++ type, so store "auto" — the caller's
        // declaration will then fall back to `auto`/template deduction rather
        // than emitting a literal `T` (which is not a valid C++ type).
        const typeParamNames = new Set((fn.typeParameters ?? []).map(tp => tp.name.text));
        const resolvedAnnotated = typeParamNames.has(annotatedType) ? "auto" : annotatedType;
        if (resolvedAnnotated !== "auto") {
          // Promote int → float when the function body returns float expressions
          if (resolvedAnnotated === "int") {
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
          result.set(fn.name.text, resolvedAnnotated);
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
