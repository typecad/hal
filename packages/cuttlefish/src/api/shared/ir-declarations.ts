// ---------------------------------------------------------------------------
// IR: Declaration types
//
// Contains IR types for top-level declarations: functions, classes,
// interfaces, enums, structs, namespaces, type aliases, and register-mapped
// structs. These all depend on ExpressionIR/StatementIR from ir-core.ts
// but do not create circular references.
// ---------------------------------------------------------------------------

import type { SourceSpan } from './types.js';
import type { CppType, ExpressionIR, ParameterIR, StatementIR } from './ir-core.js';

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export interface FunctionIR {
  originalName: string;
  isAsync: boolean;
  returnType: CppType;
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  parameters: ParameterIR[];
  statements: StatementIR[];
  /** Generic type parameters (e.g. `["T"]` for `function clamp<T>(...)`). */
  typeParameters?: string[];
  /** C++ static_assert expressions for constrained type parameters (e.g. `"T" → "std::is_arithmetic_v<T>"`). */
  typeParameterConstraints?: Map<string, string>;
  /** True when the return type is a readonly mapped type — emitter adds `const`. */
  isReadonlyReturnType?: boolean;
  /** True when this is a generator function (function*). */
  isGenerator?: boolean;
  /** True when the function is exported (has `export` keyword). */
  isExported?: boolean;
  /** Decorators applied to this function (e.g. ["asilD"]). Mirrors
   *  ClassIR.decorators. Used by the safety hook's analyzeIR to gate
   *  ISO 26262 rule enforcement by ASIL level. */
  decorators?: string[];
}

// ---------------------------------------------------------------------------
// Structs and Enums
// ---------------------------------------------------------------------------

export interface StructDefIR {
  name: string;
  fields: { name: string; cppType: CppType }[];
}

export interface EnumIR {
  name: string;
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  members: { name: string; value?: number | string }[];
  isConst: boolean;
}

/**
 * A "string enum" is a TypeScript enum whose members are all initialized to
 * string literals, e.g. `enum Color { Red = "RED", Green = "GREEN" }`.
 *
 * String enums are lowered to a `namespace` of `constexpr const char*`
 * constants so that member access (`Color::Red`) yields a `const char*`.
 * This makes `===` comparisons against string literals and string
 * concatenation behave like TypeScript without requiring reverse-mapping
 * helpers or `std::to_string`.
 *
 * A mixed enum (some numeric, some string members) is NOT a string enum —
 * it is emitted as a numeric `enum class` as before.
 */
export function isStringEnum(enumDef: { members: { value?: number | string }[] }): boolean {
  if (enumDef.members.length === 0) return false;
  return enumDef.members.every(m => typeof m.value === "string");
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

export interface ClassFieldIR {
  name: string;
  cppType: CppType;
  visibility: "public" | "private" | "protected";
  initializer?: ExpressionIR;
  isStatic?: boolean;
}

export interface ClassConstructorIR {
  parameters: ParameterIR[];
  statements: StatementIR[];
}

export interface ClassMethodIR {
  name: string;
  returnType: CppType;
  parameters: ParameterIR[];
  statements: StatementIR[];
  visibility: "public" | "private" | "protected";
  isStatic: boolean;
  isAbstract: boolean;
  isOverride?: boolean;
  /** Generic type parameters (e.g. `["T"]` for `method<T>(...)`). */
  typeParameters?: string[];
  /** True when this is a generator method. */
  isGenerator?: boolean;
  /** True when declared `async` — the body lowers to an owner-bound
   *  cooperative state-machine task (see async-state-machine.ts), not an
   *  ordinary method. */
  isAsync?: boolean;
  /** Decorators applied to this method (e.g. ["asilD"]). */
  decorators?: string[];
}

export interface ClassGetterIR {
  name: string;
  returnType: CppType;
  statements: StatementIR[];
  visibility: "public" | "private" | "protected";
  isStatic: boolean;
}

export interface ClassSetterIR {
  name: string;
  parameter: ParameterIR;
  statements: StatementIR[];
  visibility: "public" | "private" | "protected";
  isStatic: boolean;
}

export interface ClassIR {
  name: string;
  extendsClass?: string;
  implementsInterfaces?: string[];
  isAbstract: boolean;
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  fields: ClassFieldIR[];
  methods: ClassMethodIR[];
  getters: ClassGetterIR[];
  setters: ClassSetterIR[];
  constructor?: ClassConstructorIR;
  typeParameters?: string[];
  decorators?: string[];
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface InterfaceIR {
  name: string;
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  extendsInterfaces?: string[];
  fields: { name: string; cppType: CppType; isOptional: boolean }[];
  methods: { name: string; returnType: CppType; parameters: ParameterIR[] }[];
  /** Namespace scope for hoisted interfaces (e.g. "test_complex_types__types"). */
  parentScope?: string;
  /** Index signature (e.g., `[key: string]: number`). */
  indexSignature?: { keyType: string; valueType: CppType };
}

// ---------------------------------------------------------------------------
// Namespaces and type aliases
// ---------------------------------------------------------------------------

export interface VariantStructIR {
  name: string;
  fields: { name: string; cppType: string }[];
}

export interface TypeAliasIR {
  name: string;
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  cppType: string;
  structFields?: { name: string; cppType: string }[];
  variantStructs?: VariantStructIR[];
  typeParameters?: string[];
}

export interface NamespaceIR {
  name: string;
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  enums: EnumIR[];
  classes: ClassIR[];
  interfaces: InterfaceIR[];
  typeAliases: TypeAliasIR[];
  functions: FunctionIR[];
  constants: { name: string; cppType: CppType; value: ExpressionIR; storage?: "const" | "let" | "var" }[];
  /** Reassignment statements inside the namespace (e.g. x = 5). */
  assignments?: { target: string; value: ExpressionIR }[];
  children?: NamespaceIR[];
}

// ---------------------------------------------------------------------------
// Register-mapped structs
// ---------------------------------------------------------------------------

export interface RegisterBitFieldIR {
  /** Field name */
  name: string;
  /** High bit index (inclusive) */
  hi: number;
  /** Low bit index (inclusive) */
  lo: number;
  /** Width in bits (hi - lo + 1) */
  width: number;
}

export interface RegisterClassIR {
  /** Register class name (e.g. "USART1") */
  name: string;
  /** MMIO register address (e.g. 0x40011000) */
  address: number;
  /** Bit field descriptors */
  bitFields: RegisterBitFieldIR[];
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
}
