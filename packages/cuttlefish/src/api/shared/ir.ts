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

import type { BoardConstants } from './board-resolver.js';
import type { Diagnostic } from './types.js';
import type { RegisteredCallback } from '../../ir/build-ir-state.js';

// Re-export everything from sub-modules so existing imports keep working.
export type {
  CppType,
  ParameterIR,
  ExpressionIR,
  CallExpressionIR,
  SuperCallIR,
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
  HALOpStatementIR,
  StatementIR,
} from './ir-core.js';

export type {
  HALOpIR,
  HALOperationKind,
  GpioWriteOp,
  GpioReadOp,
  GpioToggleOp,
  InterruptDetachOp,
  I2cReadOp,
  I2cRecoverOp,
  BoardResolveOp,
  SnprintfEmitOp,
  RawCppOp,
} from './hal-op-ir.js';

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
} from './ir-declarations.js';

// ---------------------------------------------------------------------------
// Imports and Exports
// ---------------------------------------------------------------------------

export interface ImportIR {
  moduleSpecifier: string;
  namedImports: string[];
  /** For default imports: import X from "./module.js" */
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
  /** Pins configured as output */
  outputPins: Set<number>;
  /** Pins configured as input with pullup */
  inputPullupPins: Set<number>;
  /** Pins configured as input (no pullup) */
  inputPins: Set<number>;
  /** Pins configured as input with pulldown */
  inputPulldownPins: Set<number>;
  /** All pin names explicitly referenced */
  pinsUsed: Set<string>;
  /** Specific pins used for external interrupts */
  interruptPinsUsed: Set<number>;
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
} from './ir-declarations.js';

import type { StatementIR } from './ir-core.js';

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
  /** Library includes registered by inline evaluators (e.g., "<SPI.h>", "<Wire.h>") */
  requiredIncludes?: Set<string>;
  /** The name of the default export, if this module has `export default <name>` */
  defaultExportName?: string;
  /** Registered callbacks from the HAL resolver */
  registeredCallbacks?: RegisteredCallback[];
  /** Map of function names to their rest parameter element types (e.g., "sum" -> "int") */
  restParamFunctions?: Map<string, string>;
}
