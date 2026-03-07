import { Diagnostic, SourceSpan } from "../types";
export type { TypecodeReceiverKind } from './typecode-symbols';
export type { BoardConstants } from './board-resolver';

export interface ImportIR {
  moduleSpecifier: string;
  namedImports: string[];
}

export interface ReExportIR {
  moduleSpecifier: string;
  /** true for `export * from`, array for `export { a, b } from` */
  exportAll: boolean;
  namedExports?: string[];
}

export interface CallExpressionIR {
  kind: "call";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  callee: string;
  args: ExpressionIR[];
  /** True when this call was originally written as `await call()` in the TS source. */
  isAwaited?: boolean;
}

export interface VariableDeclarationIR {
  kind: "var_decl";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  name: string;
  storage: "var" | "let" | "const";
  cppType: string;
  initializer?: ExpressionIR;
  /** True when the variable should be marked as volatile in C++ (prevents compiler optimization). */
  isVolatile?: boolean;
}

export interface AssignmentIR {
  kind: "assign";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  target: string;
  operator:
    | "="
    | "+="
    | "-="
    | "*="
    | "/="
    | "%="
    | "&="
    | "|="
    | "^="
    | "<<="
    | ">>=";
  value: ExpressionIR;
}

export interface UpdateIR {
  kind: "update";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  target: string;
  operator: "++" | "--";
  prefix: boolean;
}

export interface ReturnIR {
  kind: "return";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  value?: ExpressionIR;
}

export interface WhileIR {
  kind: "while";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  condition: ExpressionIR;
  body: StatementIR[];
}

export interface IfIR {
  kind: "if";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  condition: ExpressionIR;
  thenBranch: StatementIR[];
  elseBranch?: StatementIR[];
}

export interface ForIR {
  kind: "for";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  initializer?: StatementIR;
  condition?: ExpressionIR;
  increment?: StatementIR;
  body: StatementIR[];
}

export interface ForOfIR {
  kind: "for_of";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  variable: StatementIR;
  iterable: ExpressionIR;
  body: StatementIR[];
}

export interface ForInIR {
  kind: "for_in";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  variable: StatementIR;
  object: ExpressionIR;
  body: StatementIR[];
}

export interface BreakIR {
  kind: "break";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
}

export interface ContinueIR {
  kind: "continue";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
}

export interface DoWhileIR {
  kind: "do_while";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  condition: ExpressionIR;
  body: StatementIR[];
}

export interface SwitchIR {
  kind: "switch";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  expression: ExpressionIR;
  cases: CaseIR[];
}

export interface CaseIR {
  kind: "case";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  value?: ExpressionIR;  // undefined for default case
  body: StatementIR[];
}

export interface TryIR {
  kind: "try";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  tryBlock: StatementIR[];
  catchParam?: string;
  catchBlock?: StatementIR[];
  finallyBlock?: StatementIR[];
}

export interface ThrowIR {
  kind: "throw";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  value: ExpressionIR;
}

export interface LabeledIR {
  kind: "labeled";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  label: string;
  body: StatementIR[];
}

export interface BlockIR {
  kind: "block";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  body: StatementIR[];
}

export type StatementIR = 
  | CallExpressionIR 
  | VariableDeclarationIR 
  | AssignmentIR 
  | UpdateIR 
  | ReturnIR 
  | WhileIR 
  | DoWhileIR
  | IfIR 
  | ForIR 
  | ForOfIR 
  | ForInIR
  | BreakIR 
  | ContinueIR
  | SwitchIR
  | TryIR
  | ThrowIR
  | LabeledIR
  | BlockIR
  | TypecodeCallStatementIR;

/**
 * A typecode SDK method call as a statement (e.g., UART0.config.baudRate(115200).begin()).
 * This is a statement-level version of typecode-call for fluent chains.
 */
export interface TypecodeCallStatementIR {
  kind: "typecode-call";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  receiver: string;
  receiverKind: import('./typecode-symbols').TypecodeReceiverKind;
  method: string;
  args: ExpressionIR[];
  configMethod?: string;
}

export type CppType = string;

export interface ParameterIR {
  name: string;
  cppType: string;
  defaultValue?: ExpressionIR;
  isRest: boolean;
}

export interface FunctionIR {
  originalName: string;
  isAsync: boolean;
  returnType: CppType;
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  parameters: ParameterIR[];
  statements: StatementIR[];
}

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

export interface InterfaceIR {
  name: string;
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  extendsInterfaces?: string[];
  fields: { name: string; cppType: CppType; isOptional: boolean }[];
  methods: { name: string; returnType: CppType; parameters: ParameterIR[] }[];
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

export interface TypeAliasIR {
  name: string;
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  cppType: string;  // The underlying C++ type
}

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
  topLevelStatements: StatementIR[];
  functions: FunctionIR[];
  boilerplates: Set<string>;
  diagnostics: Diagnostic[];
  /** Compile-time constants extracted from the imported board-definition file. */
  boardConstants?: import('./board-resolver').BoardConstants;
  /** Tracks which hardware peripherals are used (for optimized initialization) */
  peripheralUsage?: PeripheralUsageIR;
}

export type ExpressionIR =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "identifier"; value: string }
  | { kind: "raw"; value: string }
  | { kind: "await"; value: ExpressionIR }
  | { kind: "ternary"; condition: ExpressionIR; whenTrue: ExpressionIR; whenFalse: ExpressionIR }
  | { kind: "array"; elementType: string; elements: ExpressionIR[] }
  | { kind: "string_concat"; parts: ExpressionIR[] }
  | { kind: "template_string"; expression: ExpressionIR }
  | { kind: "object"; fields: { name: string; value: ExpressionIR }[] }
  | { kind: "instanceof"; object: ExpressionIR; className: string }
  | { kind: "spread_array"; elementType: string; spreadExpr: ExpressionIR; additionalElements: ExpressionIR[] }
  /** Binary expression: left OP right (e.g. `val + 100`, `a && b`). */
  | { kind: "binary"; left: ExpressionIR; operator: string; right: ExpressionIR }
  /** Prefix unary expression: OP operand (e.g. `!flag`, `-x`, `~n`). */
  | { kind: "unary"; operator: string; operand: ExpressionIR }
  /**
   * Property access: `object.property`.
   * Produced by `expressionToIR` for all property-read expressions so that
   * the emitter can recognise and translate typecode metadata paths like
   * `Board.definition.mcu` without regex post-processing.
   */
  | { kind: "property-access"; object: ExpressionIR; property: string }
  /**
   * A call to a typecode SDK method that the emitter translates to a
   * platform-specific built-in (e.g. `A0.read()` → `analogRead(A0)`).
   * Produced by `expressionToIR` when it detects a typecode receiver.
   */
  | { kind: "typecode-call"; receiver: string; receiverKind: import('./typecode-symbols').TypecodeReceiverKind; method: string; args: ExpressionIR[]; interruptMode?: "FALLING" | "RISING" | "CHANGE" }
  /**
   * A callback function (arrow function or function expression) passed as an argument.
   * Used for interrupt handlers and other callback contexts.
   * The emitter generates a standalone function and passes its name.
   * debounceMs: Optional debounce delay in milliseconds (set by .debounce() chain).
   */
  | { kind: "callback"; params: string[]; statements: StatementIR[]; sourceSpan: import("../types").SourceSpan; debounceMs?: number }
  /** Arrow function or lambda expression: (params) => expression | { statements } */
  | { kind: "lambda"; params: ParameterIR[]; body: StatementIR[]; returnType: CppType; isExpressionBody: boolean };
