# Intermediate Representation (IR) Model

The TypeCode IR is the intermediate representation between TypeScript AST and C++ emission.

## Overview

The IR captures the semantic structure of the program:

```
TypeScript AST → IR → C++ Emission
```

## Core IR Types

### ProgramIR

Top-level container for all IR nodes:

```typescript
interface ProgramIR {
  functions: Map<string, FunctionIR>;
  classes: Map<string, ClassIR>;
  enums: Map<string, EnumIR>;
  variables: Map<string, VariableIR>;
  imports: ImportIR[];
  exports: ExportIR[];
  entryPoints: Set<string>;
}
```

### FunctionIR

Represents a function:

```typescript
interface FunctionIR {
  name: string;
  parameters: ParameterIR[];
  returnType: TypeIR;
  body: StatementIR[];
  isStatic: boolean;
  isExported: boolean;
  isAsync: boolean;
  symbolId: SymbolId;
}
```

### ClassIR

Represents a class:

```typescript
interface ClassIR {
  name: string;
  fields: FieldIR[];
  methods: MethodIR[];
  constructor: ConstructorIR | null;
  baseClass: string | null;
  implements: string[];
  isExported: boolean;
  symbolId: SymbolId;
}
```

### EnumIR

Represents an enum:

```typescript
interface EnumIR {
  name: string;
  members: Map<string, number | string>;
  isConst: boolean;
  isExported: boolean;
  symbolId: SymbolId;
}
```

### VariableIR

Represents a top-level variable:

```typescript
interface VariableIR {
  name: string;
  type: TypeIR;
  initializer: ExpressionIR | null;
  isConst: boolean;
  isExported: boolean;
  symbolId: SymbolId;
}
```

## Statement IR

### Statement Types

```typescript
type StatementIR =
  | ExpressionStatementIR
  | VariableDeclarationIR
  | IfStatementIR
  | WhileStatementIR
  | ForStatementIR
  | ForOfStatementIR
  | SwitchStatementIR
  | ReturnStatementIR
  | BreakStatementIR
  | ContinueStatementIR
  | BlockStatementIR;
```

### If Statement

```typescript
interface IfStatementIR {
  kind: 'if';
  condition: ExpressionIR;
  thenBranch: StatementIR;
  elseBranch: StatementIR | null;
}
```

### For Statement

```typescript
interface ForStatementIR {
  kind: 'for';
  init: VariableDeclarationIR | ExpressionIR | null;
  condition: ExpressionIR | null;
  update: ExpressionIR | null;
  body: StatementIR;
}
```

## Expression IR

### Expression Types

```typescript
type ExpressionIR =
  | LiteralIR
  | IdentifierIR
  | BinaryExpressionIR
  | UnaryExpressionIR
  | CallExpressionIR
  | MemberExpressionIR
  | AssignmentExpressionIR
  | ArrayLiteralIR
  | ObjectLiteralIR
  | NewExpressionIR
  | ConditionalExpressionIR;
```

### Literal

```typescript
interface LiteralIR {
  kind: 'literal';
  value: string | number | boolean | null;
  type: TypeIR;
}
```

### Binary Expression

```typescript
interface BinaryExpressionIR {
  kind: 'binary';
  operator: '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '>' | '<=' | '>=' | '&&' | '||' | '&' | '|' | '^' | '<<' | '>>';
  left: ExpressionIR;
  right: ExpressionIR;
}
```

### Call Expression

```typescript
interface CallExpressionIR {
  kind: 'call';
  callee: ExpressionIR;
  arguments: ExpressionIR[];
  callType: 'function' | 'method' | 'constructor';
}
```

### Typecode-Call Expression (Fluent Peripheral APIs)

**CRITICAL for UART/I2C/SPI transpilation.**

The `typecode-call` IR node represents calls to TypeCode SDK symbols that must be translated to Arduino APIs. This includes fluent peripheral chains like `UART0.write.line()`.

```typescript
interface TypecodeCallIR {
  kind: 'typecode-call';
  receiver: string;        // e.g., "UART0", "I2C0", "SPI0", "D13", "A0"
  receiverKind: string;    // e.g., "serial", "i2c", "spi", "digital", "analog"
  method: string;          // e.g., "write.line", "configBegin", "begin"
  args: ExpressionIR[];
  interruptMode?: "FALLING" | "RISING" | "CHANGE";  // For attachInterrupt
}
```

#### Transpilation Examples

| TypeScript | IR (`method` field) | C++ Output |
|------------|---------------------|------------|
| `UART0.write.line("text")` | `"write.line"` | `Serial.println("text")` |
| `UART0.write.string("text")` | `"write.string"` | `Serial.print("text")` |
| `UART0.config.baudRate(115200).begin()` | `"configBegin"` | `Serial.begin(115200)` |
| `I2C0.config.speed(400000).begin()` | `"configBegin"` | `Wire.begin(); Wire.setClock(400000)` |
| `SPI0.config.frequency(1000000).begin()` | `"configBegin"` | `SPI.begin()` |
| `D13.high()` | `"high"` | `digitalWrite(13, HIGH)` |
| `A0.read()` | `"read"` | `analogRead(A0)` |
| `D13.config.output.initial(HIGH)` | `"config.output.initial"` | `pinMode(13, OUTPUT); digitalWrite(13, HIGH)` |
| `D2.config.input.pullup()` | `"config.input.pullup"` | `pinMode(2, INPUT_PULLUP)` |
| `D9.config.pwm.initial(50)` | `"config.pwm.initial"` | `pinMode(9, OUTPUT); analogWrite(9, 127)` |
| `A0.config.analog()` | `"config.analog"` | `pinMode(A0, INPUT)` |
| `D2.on.falling(cb)` | `"on.falling"` | `attachInterrupt(digitalPinToInterrupt(2), cb, FALLING)` |

#### Implementation Notes

The IR builder (`build-ir.ts`) uses `extractRootAndChain()` to detect nested property access chains and generate `typecode-call` IR nodes. The C++ emitter (`cpp-emitter.ts`) translates these via `renderFluentSerial()`, `renderFluentI2C()`, and `renderFluentSPI()` functions.

**Do not remove the chain detection logic** - without it, fluent APIs will emit raw TypeScript as C++ (e.g., `UART0.write.line()` instead of `Serial.println()`).

## Type IR

### Type Representation

```typescript
type TypeIR =
  | PrimitiveTypeIR
  | NumberTypeIR
  | StringTypeIR
  | BooleanTypeIR
  | VoidTypeIR
  | ArrayTypeIR
  | ClassTypeIR
  | EnumTypeIR
  | FunctionTypeIR
  | UnionTypeIR
  | TypeParameterIR;
```

### Primitive Types

```typescript
interface PrimitiveTypeIR {
  kind: 'primitive';
  name: 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float' | 'double';
}
```

### Number Type

```typescript
interface NumberTypeIR {
  kind: 'number';
  inferredType: 'int' | 'float' | 'double' | null;
}
```

## Symbol Tracking

### SymbolId

Unique identifier for each symbol:

```typescript
interface SymbolId {
  name: string;
  filePath: string;
  localId: number;
}
```

### Symbol Table

Tracks all symbols and their types:

```typescript
interface SymbolTable {
  symbols: Map<SymbolId, SymbolInfo>;
  parent: SymbolTable | null;
  
  lookup(name: string): SymbolInfo | null;
  define(name: string, info: SymbolInfo): SymbolId;
}
```

## IR Building

### Build Process

```typescript
function buildIR(
  sourceFile: ts.SourceFile,
  typeChecker: ts.TypeChecker
): ProgramIR {
  const builder = new IRBuilder(typeChecker);
  return builder.buildProgram(sourceFile);
}
```

### IRBuilder Class

```typescript
class IRBuilder {
  constructor(private typeChecker: ts.TypeChecker) {}
  
  buildProgram(sourceFile: ts.SourceFile): ProgramIR;
  buildFunction(node: ts.FunctionDeclaration): FunctionIR;
  buildClass(node: ts.ClassDeclaration): ClassIR;
  buildStatement(node: ts.Statement): StatementIR;
  buildExpression(node: ts.Expression): ExpressionIR;
  buildType(node: ts.Type): TypeIR;
}
```

## Tree Shaking

The IR supports reachability analysis for dead code elimination:

```typescript
interface ReachabilityAnalysis {
  reachable: Set<SymbolId>;
  unreachable: Set<SymbolId>;
  
  analyze(program: ProgramIR, entryPoints: string[]): void;
  filter(program: ProgramIR): ProgramIR;
}
```

### Entry Points

Default entry points:
- Arduino: `setup`, `loop`
- Generic: `main`

Custom entry points can be added via CLI flags.

## Usage

### Accessing IR

The IR is available during transpilation:

```typescript
import { buildIR } from 'typecode/ir';

const program = ts.createProgram(['sketch.ts'], {});
const sourceFile = program.getSourceFile('sketch.ts')!;
const typeChecker = program.getTypeChecker();

const ir = buildIR(sourceFile, typeChecker);

console.log(ir.functions.keys());  // All functions
console.log(ir.classes.keys());    // All classes
```

### Transforming IR

IR transformations can be applied before emission:

```typescript
function transformIR(ir: ProgramIR): ProgramIR {
  // Apply optimizations
  ir = inlineConstants(ir);
  ir = foldConstants(ir);
  ir = removeDeadCode(ir);
  return ir;
}