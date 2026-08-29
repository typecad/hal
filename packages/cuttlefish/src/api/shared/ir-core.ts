// ---------------------------------------------------------------------------
// IR: Core expression and statement types
//
// Contains ExpressionIR and StatementIR (and all supporting interfaces).
// These two union types are mutually recursive (callbacks embed statements,
// statements embed expressions) so they must live in the same file.
// ---------------------------------------------------------------------------

import type { HALOpIR } from './hal-op-ir.js';
import type { SourceSpan } from './types.js';

// ---------------------------------------------------------------------------
// Shared primitive types
// ---------------------------------------------------------------------------

/**
 * The C++ type carried on every IR declaration field. Stored as a string at
 * the IR level (so construction sites read naturally: `cppType: "int"`), but
 * every *consumer* parses it once via `parseCppType` and inspects the resulting
 * `CppTypeIR` structurally (by `kind`) instead of re-parsing with
 * startsWith/endsWith/slice. See `cpp-type-ir.ts`.
 *
 * Keeping the field a string preserves readable IR construction; the structural
 * value is realized at inspection sites, which is where the historical ad-hoc
 * string parsing was concentrated.
 */
export type CppType = string;

export interface ParameterIR {
  name: string;
  cppType: string;
  defaultValue?: ExpressionIR;
  isRest: boolean;
  /** Ownership kind inferred from type annotation (Shared<T>, Mutable<T>, Owned<T>). */
  ownershipKind?: 'owned' | 'shared' | 'mutable';
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export type ExpressionIR =
  | { kind: "number"; value: number; cppType?: "int" | "float" | "double" }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "identifier"; value: string }
  | { kind: "raw"; value: string; newClassName?: string }
  | { kind: "await"; value: ExpressionIR }
  | { kind: "ternary"; condition: ExpressionIR; whenTrue: ExpressionIR; whenFalse: ExpressionIR }
  | { kind: "array"; elementType: string; elements: ExpressionIR[] }
  | { kind: "string_concat"; parts: ExpressionIR[] }
  | { kind: "template_string"; expression: ExpressionIR }
  | { kind: "object"; fields: { name: string; value: ExpressionIR }[]; cppType?: CppType }
  | { kind: "instanceof"; object: ExpressionIR; className: string }
  | { kind: "spread_array"; elementType: string; spreadExpr: ExpressionIR; additionalElements: ExpressionIR[] }
  /** Binary expression: left OP right (e.g. `val + 100`, `a && b`). */
  | { kind: "binary"; left: ExpressionIR; operator: string; right: ExpressionIR }
  /** Unary expression: OP operand (prefix) or operand OP (postfix). */
  | { kind: "unary"; operator: string; operand: ExpressionIR; postfix?: boolean }
  /**
   * Property access: `object.property`.
   * Produced by `expressionToIR` for all property-read expressions so that
   * the emitter can recognise and translate TypeCAD metadata paths like
   * `Board.definition.mcu` without regex post-processing.
   */
  | { kind: "property-access"; object: ExpressionIR; property: string; isStatic?: boolean; isEnum?: boolean; isNamespace?: boolean; isPointer?: boolean }
  /**
   * A callback function (arrow function or function expression) passed as an argument.
   * Used for interrupt handlers and other callback contexts.
   * The emitter generates a standalone function and passes its name.
   * debounceMs: Optional debounce delay in milliseconds (set by .debounce() chain).
   * isInterruptHandler: True when this callback is an ISR (affects safety validation).
   */
  | { kind: "callback"; params: string[]; statements: StatementIR[]; sourceSpan: SourceSpan; debounceMs?: number; isInterruptHandler?: boolean }
  /** Arrow function or lambda expression: (params) => expression | { statements } */
  | { kind: "lambda"; params: ParameterIR[]; body: StatementIR[]; returnType: CppType; isExpressionBody: boolean }
  /** A general method call with structured argument IR (preserves callbacks/lambdas). */
  | { kind: "method-call"; callee: string; args: ExpressionIR[]; isStatic?: boolean; isNamespace?: boolean; isPointer?: boolean; restElementType?: string; cppType?: string; receiverExpr?: ExpressionIR; methodName?: string }
  /** A receiverless call: `Name(args)` (free function or constructor). Method-on-receiver calls lower as "method-call"; this is the receiverless form, e.g. `SafeInt(x)`. */
  | CallExpressionIR
  /** Array element access: `object[index]`. */
  | { kind: "element-access"; object: ExpressionIR; index: ExpressionIR; elementType?: string }
  /** Tuple element access: `std::get<N>(object)` for std::tuple types. */
  | { kind: "tuple-access"; object: ExpressionIR; index: number }
  /** Parenthesized expression: preserves explicit grouping from TS source (e.g. `(2+3)*4`). */
  | { kind: "paren"; inner: ExpressionIR }
  /**
   * HAL operation used as an expression (returns a value).
   * The framework strategy resolves the operation to a C++ expression string.
   * `prefixOps` carries a method body's PRECEDING side-effect ops: expression
   * positions historically kept only the last op, silently dropping e.g. a
   * bus transaction prefix (i2c begin/write/end before a read) or a pin
   * configure before a read. The renderer emits them as a GCC
   * statement-expression `({ op; ...; value; })` so every op runs.
   */
  | { kind: "hal-expr"; operation: HALOpIR; prefixOps?: HALOpIR[] };

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

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
  /** Ownership kind inferred from type annotation (Shared<T>, Mutable<T>, Owned<T>). */
  ownershipKind?: 'owned' | 'shared' | 'mutable';
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
  /**
   * The C++ return type of the enclosing function, when known at IR-build
   * time. Used by the renderer to lower `return null`/`return undefined` to a
   * value-initialized `return {};` when the function returns a struct (a
   * `nullptr`/`CUTTLEFISH_UNDEFINED` literal cannot convert to a struct type).
   * Demo #14 Finding A.
   */
  functionReturnType?: CppType;
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
  /** Field/key names of the iterated object, used to generate a key array for C++ emission */
  keys?: string[];
  body: StatementIR[];
}

export interface BreakIR {
  kind: "break";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  label?: string;
}

export interface ContinueIR {
  kind: "continue";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  label?: string;
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

export interface HALOpStatementIR {
  kind: "hal-op";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  /** The semantic hardware operation to emit. */
  operation: HALOpIR;
  /** When true, the operation returns a value that should be captured. */
  returns_value: boolean;
}

export interface YieldIR {
  kind: "yield";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  value?: ExpressionIR;
  isDelegate?: boolean;
}

export interface SuperCallIR {
  kind: "super_call";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  args: ExpressionIR[];
}

export type StatementIR =
  | CallExpressionIR
  | SuperCallIR
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
  | HALOpStatementIR
  | YieldIR;
