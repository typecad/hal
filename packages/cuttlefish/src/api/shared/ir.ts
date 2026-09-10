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
  /** Specific ADC channels used. Structured adc ops carry BOARD PIN NUMBERS
   *  (the op's `pin` field — the report maps pin → silicon channel via the
   *  board's `zephyr.adc.channels` facts); the arduino-era emit-string paths
   *  (analogRead) still add arduino channel numbers on those boards only. */
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
  /** USB CDC serial (USBConsole) is used */
  usb?: boolean;
  /** Watchdog is used */
  wdt?: boolean;
  /** Hardware counters are used */
  counter?: boolean;
  /** Specific USB CDC instances used (0 for USB0) */
  usbInstancesUsed?: Set<number>;
  /** Hardware counter instances used */
  counterInstancesUsed?: Set<number>;
  /** Thread instances started */
  threadInstancesUsed?: Set<number>;
  /** Specific I2C bus instances used */
  i2cInstancesUsed?: Set<number>;
  /** Specific SPI bus instances used */
  spiInstancesUsed?: Set<number>;
  /** Specific UART instances used */
  uartInstancesUsed?: Set<number>;
  /** Distinct constructed SPI targets (`bus|cs|hz|mode` keys) */
  spiTargetsUsed?: Set<string>;
  /** Distinct DT-bound sensor parts (`part|busKind+instance|port` keys) */
  sensorPartsUsed?: Set<string>;
  /** A DT-bound sensor part is used */
  sensor?: boolean;
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
  /**
   * Free functions passed by name as interrupt handlers (e.g.
   * `pin.onInterrupt(GPIO.INT_EDGE_RISING, isr)`). Their bodies carry no
   * callback IR node, so interrupt-analysis reads them from program.functions
   * by this name list to run volatile inference, unsafe-op scanning, and
   * reentrancy detection on ISR code.
   */
  isrHandlerFunctions?: string[];
  /** Map of function names to their rest parameter element types (e.g., "sum" -> "int") */
  restParamFunctions?: Map<string, string>;
}
