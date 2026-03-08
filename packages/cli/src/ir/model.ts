// ---------------------------------------------------------------------------
// Intermediate Representation (IR) types
//
// These types represent the transpiled TypeScript code in a form
// that can be emitted as C++ code.
//
// NOTE: This file re-exports the IR types from @typecode/core for backwards
// compatibility. New code should import directly from '@typecode/core'.
// ---------------------------------------------------------------------------

// Re-export all IR types from the canonical source in @typecode/core
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
  TypecodeCallStatementIR,
  
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
  
  // Program
  ProgramIR,
} from "@typecode/core";

// Re-export related types that are defined locally in CLI
export type { TypecodeReceiverKind } from './typecode-symbols';
export type { BoardConstants } from './board-resolver';