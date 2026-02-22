import { Diagnostic, SourceSpan } from "../types";

export interface ImportIR {
  moduleSpecifier: string;
  namedImports: string[];
}

export interface CallExpressionIR {
  kind: "call";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  callee: string;
  args: ExpressionIR[];
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
}

export interface ThrowIR {
  kind: "throw";
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  value: ExpressionIR;
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
  | ThrowIR;

export type CppType = string;

export interface ParameterIR {
  name: string;
  cppType: string;
  defaultValue?: ExpressionIR;
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

export interface ClassMethodIR {
  name: string;
  returnType: CppType;
  parameters: ParameterIR[];
  statements: StatementIR[];
  visibility: "public" | "private" | "protected";
  isStatic: boolean;
}

export interface ClassConstructorIR {
  parameters: ParameterIR[];
  statements: StatementIR[];
}

export interface ClassIR {
  name: string;
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  fields: ClassFieldIR[];
  methods: ClassMethodIR[];
  constructor?: ClassConstructorIR;
}

export interface TypeAliasIR {
  name: string;
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  cppType: string;  // The underlying C++ type
}

export interface ProgramIR {
  fileName: string;
  imports: ImportIR[];
  structs: StructDefIR[];
  enums: EnumIR[];
  classes: ClassIR[];
  typeAliases: TypeAliasIR[];
  topLevelStatements: StatementIR[];
  functions: FunctionIR[];
  boilerplates: Set<string>;
  diagnostics: Diagnostic[];
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
  | { kind: "object"; fields: { name: string; value: ExpressionIR }[] }
  | { kind: "instanceof"; object: ExpressionIR; className: string }
  | { kind: "spread_array"; elementType: string; spreadExpr: ExpressionIR; additionalElements: ExpressionIR[] };
