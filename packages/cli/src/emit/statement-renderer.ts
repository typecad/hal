/**
 * Statement Renderer for C++ code emission.
 * Encapsulates all statement rendering logic with explicit dependencies.
 * Extracted from cpp-emitter.ts
 */

import type { StatementIR, ExpressionIR } from "../ir/model";
import type { PlatformStrategy } from "../platform/platform-strategy";
import type { BoardConstants } from "../ir/board-resolver";
import { ExpressionRenderer, transformTypeName } from "./expression-renderer";
import { isConsoleCall, getConsoleMethod, inferObjectFieldType, collectNestedStructDefs } from "./utils";
import { escapeCppKeyword } from "../utils/strings";

/**
 * Context needed for statement rendering.
 */
export interface StatementRendererContext {
  /** The platform strategy for target-specific rendering */
  strategy: PlatformStrategy;
  /** Board constants for Board.definition.* access */
  boardConstants?: BoardConstants;
  /** Map of Arduino class simple names to fully qualified names */
  arduinoClassNameMap?: Map<string, string>;
  /** Set of enum names for scoped enum access (::) */
  enumNames: Set<string>;
  /** Set of enum names with values outside 16-bit int range */
  largeEnumNames: Set<string>;
  /** Map of function names to their return types */
  knownFunctionReturnTypes: Map<string, string>;
  /** Map of variable names to their pointer types */
  pointerVarTypes?: Map<string, string>;
  /** Set of pointer struct fields for -> access */
  pointerStructFields?: Set<string>;
}

/**
 * Returns true for C++ scalar/primitive types that are cheaply passed by value.
 * Non-primitives (std::vector, String, structs, arrays) should be passed by reference
 * when borrowed via Ref<T> or MutRef<T> to avoid deep copies.
 */
function isPrimitiveCppType(cppType: string): boolean {
  const t = cppType.trim();
  const primitives = new Set([
    'int', 'float', 'double', 'bool', 'char', 'long', 'void',
    'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
    'int8_t', 'int16_t', 'int32_t', 'int64_t',
    'size_t', 'byte', 'word',
    'unsigned int', 'unsigned long', 'unsigned char',
    'signed int', 'signed long', 'signed char',
  ]);
  return primitives.has(t);
}

/**
 * Renders StatementIR nodes to C++ code strings.
 */
export class StatementRenderer {
  private readonly strategy: PlatformStrategy;
  private readonly expressionRenderer: ExpressionRenderer;
  private readonly knownFunctionReturnTypes: Map<string, string>;
  private readonly pointerVarTypes?: Map<string, string>;
  private readonly pointerStructFields?: Set<string>;
  private readonly arduinoClassNameMap?: Map<string, string>;

  constructor(context: StatementRendererContext) {
    this.strategy = context.strategy;
    this.knownFunctionReturnTypes = context.knownFunctionReturnTypes;
    this.pointerVarTypes = context.pointerVarTypes;
    this.pointerStructFields = context.pointerStructFields;
    this.arduinoClassNameMap = context.arduinoClassNameMap;

    // Create expression renderer with shared context
    this.expressionRenderer = new ExpressionRenderer({
      strategy: context.strategy,
      boardConstants: context.boardConstants,
      arduinoClassNameMap: context.arduinoClassNameMap,
      enumNames: context.enumNames,
      largeEnumNames: context.largeEnumNames,
      knownFunctionReturnTypes: context.knownFunctionReturnTypes,
      pointerVarTypes: context.pointerVarTypes,
    });
  }

  /**
   * Gets the underlying expression renderer for direct use.
   */
  getExprRenderer(): ExpressionRenderer {
    return this.expressionRenderer;
  }

  /**
   * Renders a statement IR node to a C++ string, including any snprintf
   * prelude lines accumulated during expression rendering.
   *
   * @param statement The statement to render
   * @param forHeader Whether this is for a header file (no semicolons)
   * @param calleeTransformer Optional transformer for callee names
   * @returns Object with prelude lines and the rendered statement
   */
  renderWithPrelude(statement: StatementIR, forHeader: boolean = false, calleeTransformer?: (callee: string) => string): { prelude: string[]; statement: string } {
    this.expressionRenderer.clearPrelude();
    const rendered = this.render(statement, forHeader, calleeTransformer);
    const prelude = this.expressionRenderer.drainPrelude();
    return { prelude, statement: rendered };
  }

  /**
   * Renders a statement IR node to a C++ string.
   *
   * @param statement The statement to render
   * @param forHeader Whether this is for a header file (no semicolons)
   * @param calleeTransformer Optional transformer for callee names
   * @returns The C++ code string
   */
  render(statement: StatementIR, forHeader: boolean = false, calleeTransformer?: (callee: string) => string): string {
    if (statement.kind === "typecode-call") {
      return this.renderTypecodeCallStatement(statement, forHeader);
    }

    if (statement.kind === "call") {
      return this.renderCall(statement, forHeader, calleeTransformer);
    }

    if (statement.kind === "assign") {
      return forHeader 
        ? `${statement.target} ${statement.operator} ${this.expressionRenderer.render(statement.value)}`
        : `${statement.target} ${statement.operator} ${this.expressionRenderer.render(statement.value)};`;
    }

    if (statement.kind === "update") {
      return statement.prefix
        ? `${statement.operator}${statement.target}${forHeader ? "" : ";"}`
        : `${statement.target}${statement.operator}${forHeader ? "" : ";"}`;
    }

    if (statement.kind === "return") {
      return statement.value ? `return ${this.expressionRenderer.render(statement.value)};` : "return;";
    }

    if (statement.kind === "while") {
      return `while (${this.expressionRenderer.render(statement.condition)})`;
    }

    if (statement.kind === "if") {
      return `if (${this.expressionRenderer.render(statement.condition)})`;
    }

    if (statement.kind === "for") {
      const init = statement.initializer ? this.render(statement.initializer, true) : "";
      const cond = statement.condition ? this.expressionRenderer.render(statement.condition) : "";
      const incr = statement.increment ? this.render(statement.increment, true) : "";
      return `for (${init}; ${cond}; ${incr})`;
    }

    if (statement.kind === "for_of") {
      const varDecl = statement.variable;
      if (varDecl.kind === "var_decl") {
        return `for (${this.renderTypedName(varDecl.cppType, varDecl.name, varDecl.storage === "const")} : ${this.expressionRenderer.render(statement.iterable)})`;
      }
      return `for (auto item : ${this.expressionRenderer.render(statement.iterable)})`;
    }

    if (statement.kind === "for_in") {
      const varDecl = statement.variable;
      if (varDecl.kind === "var_decl") {
        return `for (${this.renderTypedName(varDecl.cppType, varDecl.name, varDecl.storage === "const")} : ${this.expressionRenderer.render(statement.object)})`;
      }
      return `for (auto key : ${this.expressionRenderer.render(statement.object)})`;
    }

    if (statement.kind === "break") {
      return "break;";
    }

    if (statement.kind === "continue") {
      return "continue;";
    }

    if (statement.kind === "do_while") {
      return `do`;
    }

    if (statement.kind === "switch") {
      return `switch (${this.expressionRenderer.render(statement.expression)})`;
    }

    if (statement.kind === "try") {
      return "try";
    }

    if (statement.kind === "throw") {
      return this.strategy.renderThrow(this.expressionRenderer.render(statement.value));
    }

    if (statement.kind === "labeled") {
      return `${statement.label}:`;
    }

    if (statement.kind === "block") {
      return `{`;
    }

    if (statement.kind !== "var_decl") {
      return "/* unsupported_statement */";
    }

    return this.renderVarDecl(statement, forHeader, calleeTransformer);
  }

  private renderTypecodeCallStatement(statement: Extract<StatementIR, { kind: "typecode-call" }>, forHeader: boolean): string {
    const renderA = (e: ExpressionIR) => this.expressionRenderer.render(e);
    const translated = this.strategy.tryRenderTypecodeCall(
      statement.receiver,
      statement.receiverKind,
      statement.method,
      statement.args,
      renderA,
      this.expressionRenderer.getBoardConstants(),
      (statement as any).interruptMode
    );
    if (translated !== undefined) {
      return forHeader ? translated : `${translated};`;
    }
    // Fallback: render as plain method call
    return forHeader
      ? `${statement.receiver}.${statement.method}(${statement.args.map(renderA).join(", ")})`
      : `${statement.receiver}.${statement.method}(${statement.args.map(renderA).join(", ")});`;
  }

  private renderCall(statement: Extract<StatementIR, { kind: "call" }>, forHeader: boolean, calleeTransformer?: (callee: string) => string): string {
    // Handle raw statements from setupInitCode
    if (statement.callee.startsWith('__RAW_STMT__')) {
      const rawStmt = statement.callee.slice('__RAW_STMT__'.length);
      return forHeader ? rawStmt : `${rawStmt.endsWith(';') ? rawStmt : rawStmt + ';'}`;
    }
    // Handle console.* calls specially
    if (isConsoleCall(statement.callee)) {
      return this.transformConsoleCall(statement.callee, statement.args, forHeader);
    }
    // Handle typecode SDK calls via strategy (pin/serial/i2c/spi)
    const renderA = (e: ExpressionIR) => this.expressionRenderer.render(e);
    const translated = this.strategy.tryRenderCallStatement(
      statement.callee, 
      statement.args, 
      renderA, 
      this.expressionRenderer.getBoardConstants()
    );
    if (translated !== undefined) {
      return forHeader ? translated : `${translated};`;
    }
    let callee = statement.callee;
    if (callee.startsWith("this.")) {
      callee = `this->${callee.slice("this.".length)}`;
    }
    if (calleeTransformer) {
      callee = calleeTransformer(callee);
    }
    callee = this.fixPointerFieldAccess(callee);
    const renderedArgs = statement.args.map((arg) => this.expressionRenderer.render(arg)).join(", ");
    return forHeader ? `${callee}(${renderedArgs})` : `${callee}(${renderedArgs});`;
  }

  private renderVarDecl(statement: Extract<StatementIR, { kind: "var_decl" }>, forHeader: boolean, calleeTransformer?: (callee: string) => string): string {
    const declaredType = this.normalizeCppType(statement.cppType);
    const volatilePrefix = statement.isVolatile ? "volatile " : "";
    // Transform type name for Arduino library classes (add namespace prefix)
    const transformedType = transformTypeName(statement.cppType, this.arduinoClassNameMap);
    const ownershipKind = (statement as any).ownershipKind as 'owned' | 'ref' | 'mut_ref' | undefined;
    // Emit const for Ref<T> ownership annotations (ownershipKind === 'ref')
    const isConst = statement.storage === "const" || ownershipKind === 'ref';
    // Emit C++ reference for non-primitive Ref<T>/MutRef<T> from named variables.
    // Primitives pass by value (no overhead). Temporary/literal initializers fall back to copy.
    const isRef = (ownershipKind === 'ref' || ownershipKind === 'mut_ref')
      && !isPrimitiveCppType(statement.cppType)
      && statement.initializer?.kind === 'identifier';
    const declaration = `${volatilePrefix}${this.renderTypedName(transformedType, statement.name, isConst, isRef)}`;
    
    if (statement.initializer) {
      // Handle device.readByte / device.readBytes — multi-statement Wire expansions
      // that cannot be used as a C++ r-value expression.
      if (statement.initializer.kind === "typecode-call") {
        const initCall = statement.initializer as Extract<ExpressionIR, { kind: "typecode-call" }>;
        if (initCall.method === "device.readByte" || initCall.method === "device.readBytes") {
          const renderA = (e: ExpressionIR) => this.expressionRenderer.render(e);
          const addr = renderA(initCall.args[0]);
          const reg = renderA(initCall.args[1]);
          const wireNum = initCall.receiver.slice(3); // strip leading "I2C"
          const wire = wireNum === '0' ? 'Wire' : `Wire${wireNum}`;

          if (initCall.method === "device.readByte") {
            // Emit Wire setup as prelude, keep Wire.read() as the variable initializer.
            this.expressionRenderer.pushPrelude([
              `${wire}.beginTransmission(${addr});`,
              `${wire}.write(${reg});`,
              `${wire}.endTransmission(false);`,
              `${wire}.requestFrom(${addr}, 1);`,
            ]);
            return forHeader
              ? `${declaration} = ${wire}.read()`
              : `${declaration} = ${wire}.read();`;
          } else {
            // device.readBytes: declare a uint8_t array and fill it via a read loop.
            const count = renderA(initCall.args[2]);
            const name = statement.name;
            this.expressionRenderer.pushPrelude([
              `uint8_t ${name}[${count}];`,
              `${wire}.beginTransmission(${addr});`,
              `${wire}.write(${reg});`,
              `${wire}.endTransmission(false);`,
              `${wire}.requestFrom(${addr}, ${count});`,
              `for (int i = 0; i < ${count}; i++) { ${name}[i] = ${wire}.read(); }`,
            ]);
            // The declaration is fully handled in the prelude; return empty so
            // the emitter just appends a blank line.
            return "";
          }
        }
      }

      // Handle array initializers
      if (statement.initializer.kind === "array") {
        const elements = statement.initializer.elements.map((e) => this.expressionRenderer.render(e)).join(", ");
        if (declaredType.startsWith("std::vector<") && this.strategy.needsStdVector()) {
          return forHeader
            ? `${declaration} = { ${elements} }`
            : `${declaration} = { ${elements} };`;
        }
        // Use "int" for "auto" element type since C arrays need explicit types
        const arrayType = statement.initializer.elementType === "auto" ? "int" : statement.initializer.elementType;
        const safeArrName = escapeCppKeyword(statement.name);
        return forHeader
          ? `${arrayType} ${safeArrName}[] = { ${elements} }`
          : `${arrayType} ${safeArrName}[] = { ${elements} };`;
      }
      // Handle object initializers with inline struct definition
      if (statement.initializer.kind === "object") {
        const structName = `_${statement.name}_t`;

        // Collect nested struct definitions (deepest first) and emit as prelude
        const nestedStructs = collectNestedStructDefs(
          statement.initializer, statement.name,
          this.pointerVarTypes, this.knownFunctionReturnTypes,
        );
        if (nestedStructs.length > 0) {
          const nestedDefs = nestedStructs.map(
            (ns) => `struct ${ns.structName} { ${ns.fields.map((f) => `${f.type} ${f.name};`).join(" ")} };`
          );
          this.expressionRenderer.pushPrelude(nestedDefs);
        }

        const fieldDefs = statement.initializer.fields
          .map((f) => `${this.inferFieldType(f.value, statement.name, f.name)} ${f.name};`)
          .join(" ");
        const initValues = statement.initializer.fields
          .map((f) => {
            const renderExpr = (e: ExpressionIR) => this.expressionRenderer.render(e, calleeTransformer);
            const overridden = this.strategy.objectFieldInitializer(f.value, renderExpr);
            if (overridden !== undefined) return overridden;
            return renderExpr(f.value);
          })
          .join(", ");
        const safeObjName = escapeCppKeyword(statement.name);
        return forHeader
          ? `struct ${structName} { ${fieldDefs} } ${safeObjName} = { ${initValues} }`
          : `struct ${structName} { ${fieldDefs} } ${safeObjName} = { ${initValues} };`;
      }
      // Handle spread array initializers
      if (statement.initializer.kind === "spread_array") {
        const arrayType = statement.initializer.elementType === "auto" ? "int" : statement.initializer.elementType;
        const spreadName = this.expressionRenderer.render(statement.initializer.spreadExpr, calleeTransformer);
        const renderedExtraElements = statement.initializer.additionalElements
          .map(e => this.expressionRenderer.render(e, calleeTransformer));
        const initializerParts = [`/* spread from ${spreadName} */`, ...renderedExtraElements];
        const initializerText = initializerParts.join(', ');
        const safeSpreadArrName = escapeCppKeyword(statement.name);
        return forHeader
          ? `${arrayType} ${safeSpreadArrName}[] = { ${initializerText} }`
          : `${arrayType} ${safeSpreadArrName}[] = { ${initializerText} };`;
      }
      return forHeader 
        ? `${declaration} = ${this.expressionRenderer.render(statement.initializer, calleeTransformer)}`
        : `${declaration} = ${this.expressionRenderer.render(statement.initializer, calleeTransformer)};`;
    }

    return forHeader ? declaration : `${declaration};`;
  }

  /**
   * Renders a typed name with proper C++ syntax.
   */
  renderTypedName(cppType: string, name: string, isConst = false, isRef = false): string {
    const safeName = escapeCppKeyword(name);
    const normalizedType = this.normalizeCppType(cppType);
    const fnPtrMatch = normalizedType.match(/^(.+?)\s*\(\*\)\((.*)\)$/);
    if (fnPtrMatch) {
      const returnType = fnPtrMatch[1].trim();
      const params = fnPtrMatch[2].trim();
      const constPrefix = isConst ? "const " : "";
      return `${constPrefix}${returnType} (*${safeName})(${params})`;
    }
    const alreadyConstQualified = /^const\s+/.test(normalizedType);
    const constPrefix = isConst && !alreadyConstQualified ? "const " : "";
    const refMark = isRef ? "& " : " ";
    return `${constPrefix}${normalizedType}${refMark}${safeName}`;
  }

  /**
   * Renders function parameters.
   * Emits `const` for parameters annotated with `Ref<T>` (ownershipKind === 'ref').
   */
  renderParameters(
    parameters: Array<{ name: string; cppType: string; defaultValue?: any; ownershipKind?: 'owned' | 'ref' | 'mut_ref' }>,
  ): string {
    if (parameters.length === 0) {
      return "";
    }

    return parameters
      .map((parameter) => {
        const paramOwnershipKind = (parameter as any).ownershipKind as 'owned' | 'ref' | 'mut_ref' | undefined;
        const isConst = paramOwnershipKind === 'ref';
        // Emit C++ reference for non-primitive Ref<T>/MutRef<T> parameters.
        const isRef = (paramOwnershipKind === 'ref' || paramOwnershipKind === 'mut_ref')
          && !isPrimitiveCppType(parameter.cppType);
        let result = this.renderTypedName(parameter.cppType, parameter.name, isConst, isRef);
        if (parameter.defaultValue) {
          result += ` = ${this.expressionRenderer.render(parameter.defaultValue)}`;
        }
        return result;
      })
      .join(", ");
  }

  private normalizeCppType(typeName: string): string {
    return this.strategy.normalizeCppType(typeName);
  }

  private inferFieldType(value: ExpressionIR, parentName?: string, fieldName?: string): string {
    return inferObjectFieldType(
      value,
      this.pointerVarTypes,
      this.knownFunctionReturnTypes,
      undefined,
      undefined,
      undefined, // largeEnumNames - would need to pass through
      parentName,
      fieldName,
    );
  }

  /**
   * Transform method calls on pointer variables and pointer struct fields from '.' to '->'
   */
  private fixPointerFieldAccess(callee: string): string {
    // First, handle top-level pointer variables (e.g., sensor.method() -> sensor->method())
    if (this.pointerVarTypes) {
      for (const [varName, varType] of this.pointerVarTypes) {
        if (varType.endsWith("*")) {
          // Match patterns like "varName.method" and transform to "varName->method"
          const pattern = new RegExp(`\\b${varName}\\.`, "g");
          callee = callee.replace(pattern, `${varName}->`);
        }
      }
    }
    
    // Then, handle pointer struct fields (e.g., Board.A0.method() -> Board.A0->method())
    if (this.pointerStructFields) {
      for (const pointerField of this.pointerStructFields) {
        // Match patterns like "Board.A0.method" and transform to "Board.A0->method"
        const pattern = new RegExp(`(^|[^>])${pointerField.replace(".", "\\.")}\\.`, "g");
        callee = callee.replace(pattern, `$1${pointerField}->`);
      }
    }
    return callee;
  }

  /**
   * Transform console.log/error/warn calls based on target platform.
   */
  private transformConsoleCall(
    callee: string,
    args: ExpressionIR[],
    forHeader: boolean
  ): string {
    const method = getConsoleMethod(callee);
    const renderedArgs = args.map((arg) => this.expressionRenderer.render(arg)).join(", ");
    return this.strategy.transformConsoleCall(method, renderedArgs, forHeader);
  }
}