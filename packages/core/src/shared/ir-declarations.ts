// ---------------------------------------------------------------------------
// IR: Declaration types
//
// Contains IR types for top-level declarations: functions, classes,
// interfaces, enums, structs, namespaces, type aliases, and register-mapped
// structs. These all depend on ExpressionIR/StatementIR from ir-core.ts
// but do not create circular references.
// ---------------------------------------------------------------------------

import type { SourceSpan } from './types';
import type { CppType, ExpressionIR, ParameterIR, StatementIR } from './ir-core';

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
  members: { name: string; value?: number }[];
  isConst: boolean;
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

export interface ClassFieldIR {
  name: string;
  cppType: CppType;
  visibility: "public" | "private" | "protected";
  initializer?: ExpressionIR;
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
  /** Generic type parameters (e.g. `["T"]` for `method<T>(...)`). */
  typeParameters?: string[];
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
}

// ---------------------------------------------------------------------------
// Namespaces and type aliases
// ---------------------------------------------------------------------------

export interface TypeAliasIR {
  name: string;
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  cppType: string;  // The underlying C++ type
  structFields?: { name: string; cppType: string }[];  // Set when type alias is an object literal type
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
  constants: { name: string; cppType: CppType; value: ExpressionIR }[];
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
