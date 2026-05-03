// ---------------------------------------------------------------------------
// Intermediate Representation (IR) types
//
// These types represent the transpiled TypeScript code in a form
// that can be emitted as C++ code.
//
// NOTE: This file re-exports the IR types from @typehal/core for backwards
// compatibility. New code should import directly from '@typehal/core'.
// ---------------------------------------------------------------------------

// Re-export all IR types from the canonical source in @typehal/core
export type {
  // Imports and exports
  ImportIR,
  ReExportIR,
  
  // Expressions
  ExpressionIR,
  CppType,
  ParameterIR,
  
  // Statements
  StatementIR,
  CallExpressionIR,
  VariableDeclarationIR,
  AssignmentIR,
  UpdateIR,
  ReturnIR,
  WhileIR,
  IfIR,
  ForIR,
  ForOfIR,
  ForInIR,
  BreakIR,
  ContinueIR,
  DoWhileIR,
  SwitchIR,
  CaseIR,
  TryIR,
  ThrowIR,
  LabeledIR,
  BlockIR,

  // Functions
  FunctionIR,
  
  // Structs and Enums
  StructDefIR,
  EnumIR,
  
  // Classes
  ClassIR,
  ClassFieldIR,
  ClassConstructorIR,
  ClassMethodIR,
  ClassGetterIR,
  ClassSetterIR,
  
  // Interfaces
  InterfaceIR,
  
  // Namespaces
  NamespaceIR,
  TypeAliasIR,
  
  // Peripheral usage
  PeripheralUsageIR,
  
  // Register-mapped structs
  RegisterBitFieldIR,
  RegisterClassIR,
  
  // Program
  ProgramIR,
} from "@typehal/core";

// Re-export related types that are defined locally in CLI
export type { BoardConstants } from './board-resolver';