// ---------------------------------------------------------------------------
// Intermediate Representation (IR) types
//
// This file defines the top-level program container (ProgramIR) and
// re-exports all IR types from the focused sub-modules:
//
//   ir-core.ts        — ExpressionIR, StatementIR, and supporting types
//   ir-declarations.ts — FunctionIR, ClassIR, InterfaceIR, NamespaceIR, etc.
//
// Consumers can import from this file as before, or directly from the
// sub-modules for more precise dependencies.
// ---------------------------------------------------------------------------

import type { BoardConstants } from './board-resolver';
import type { Diagnostic } from './types';

// Re-export everything from sub-modules so existing imports keep working.
export type {
  CppType,
  ParameterIR,
  ExpressionIR,
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
  StatementIR,
} from './ir-core';

export type {
  FunctionIR,
  StructDefIR,
  EnumIR,
  ClassFieldIR,
  ClassConstructorIR,
  ClassMethodIR,
  ClassGetterIR,
  ClassSetterIR,
  ClassIR,
  InterfaceIR,
  TypeAliasIR,
  NamespaceIR,
  RegisterBitFieldIR,
  RegisterClassIR,
} from './ir-declarations';

// ---------------------------------------------------------------------------
// Imports and Exports
// ---------------------------------------------------------------------------

export interface ImportIR {
  moduleSpecifier: string;
  namedImports: string[];
  /** For default imports: import X from "./module" */
  defaultImportName?: string;
}

export interface ReExportIR {
  moduleSpecifier: string;
  /** true for `export * from`, array for `export { a, b } from` */
  exportAll: boolean;
  namedExports?: string[];
}

// ---------------------------------------------------------------------------
// Peripheral Usage
// ---------------------------------------------------------------------------

/**
 * Tracks which hardware peripherals are used in the program.
 * This enables compile-time initialization optimization.
 */
export interface PeripheralUsageIR {
  /** ADC is used (analogRead on A0-A5) */
  adc: boolean;
  /** PWM is used (analogWrite on D3, D5, D6, D9, D10, D11) */
  pwm: boolean;
  /** External interrupts are used (attachInterrupt on D2, D3) */
  externalInterrupts: boolean;
  /** Timer0-based timing is used (millis, micros) */
  timer0: boolean;
  /** I2C bus is used */
  i2c: boolean;
  /** SPI bus is used */
  spi: boolean;
  /** UART/Serial is used */
  uart: boolean;
  /** Specific PWM pins used (for targeted timer initialization) */
  pwmPinsUsed: Set<number>;
  /** Specific ADC channels used */
  adcChannelsUsed: Set<number>;
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

import type {
  StructDefIR,
  EnumIR,
  ClassIR,
  InterfaceIR,
  NamespaceIR,
  TypeAliasIR,
  RegisterClassIR,
  FunctionIR,
} from './ir-declarations';

import type { StatementIR } from './ir-core';

export interface ProgramIR {
  fileName: string;
  imports: ImportIR[];
  reExports: ReExportIR[];
  structs: StructDefIR[];
  enums: EnumIR[];
  classes: ClassIR[];
  interfaces: InterfaceIR[];
  namespaces: NamespaceIR[];
  typeAliases: TypeAliasIR[];
  /** Register-mapped structs (from @register decorator) */
  registerClasses: RegisterClassIR[];
  topLevelStatements: StatementIR[];
  functions: FunctionIR[];
  boilerplates: Set<string>;
  diagnostics: Diagnostic[];
  /** Compile-time constants extracted from the imported board-definition file. */
  boardConstants?: BoardConstants;
  /** Tracks which hardware peripherals are used (for optimized initialization) */
  peripheralUsage?: PeripheralUsageIR;
  /** The name of the default export, if this module has `export default <name>` */
  defaultExportName?: string;
}
