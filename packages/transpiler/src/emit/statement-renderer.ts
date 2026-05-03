/**
 * Statement Renderer for C++ code emission.
 * Encapsulates all statement rendering logic with explicit dependencies.
 * Extracted from cpp-emitter.ts
 */

import type { StatementIR, ExpressionIR } from "../ir/model";
import type { PlatformStrategy } from "../platform/platform-strategy";
import type { BoardConstants } from "../ir/board-resolver";
import type { KnownVariableInfo } from "@typehal/core/shared";
import { ExpressionRenderer, transformTypeName } from "./expression-renderer";
import { isConsoleCall, getConsoleMethod, inferObjectFieldType, collectNestedStructDefs } from "./utils";
import { escapeCppKeyword } from "../utils/strings";
import { accessorGetterName, accessorSetterName } from "./utils/cpp-helpers";

/**
 * Context needed for statement rendering.
 */
interface StatementRendererContext {
  /** The platform strategy for target-specific rendering */
  strategy: PlatformStrategy;
  /** Board constants for Board.definition.* access */
  boardConstants?: BoardConstants;
  /** Map of class simple names to fully qualified names (framework library imports) */
  classNameMap?: Map<string, string>;
  /** Set of enum names for scoped enum access (::) */
  enumNames: Set<string>;
  /** Set of enum names with values outside 16-bit int range */
  largeEnumNames: Set<string>;
  /** Map of function names to their return types */
  knownFunctionReturnTypes: Map<string, string>;
  /** Map of variable names to their inferred C++ types (for snprintf format specifiers) */
  knownVariableTypes?: Map<string, KnownVariableInfo>;
  /** Map of variable names to their pointer types */
  pointerVarTypes?: Map<string, string>;
  /** Set of pointer struct fields for -> access */
  pointerStructFields?: Set<string>;
  /** Set of variable names known to hold string values */
  stringVarNames?: Set<string>;
  /** Set of variable names known to be emitted as C arrays */
  cArrayVarNames?: Set<string>;
  /** Set of namespace names for scoped access (::) */
  namespaceNames?: Set<string>;
  /** Map of variable names to their class's accessor map for getter/setter rewriting */
  varAccessorNames?: Map<string, Map<string, "getter" | "setter" | "both">>;
  /** Imported class names from other transpiled modules */
  crossModuleClassNames?: Set<string>;
  /** Shared counter for unique snprintf buffer names across statement renders */
  snprintfCounter?: { value: number };
}

/**
 * Returns true for C++ scalar/primitive types that are cheaply passed by value.
 * Non-primitives (std::vector, String, structs, arrays) should be passed by reference
 * when borrowed via Shared<T> or Mutable<T> to avoid deep copies.
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

function isIndirectType(cppType: string): boolean {
  const t = cppType.trim();
  return /\*$/.test(t) || /\[\d*\]$/.test(t);
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
  private readonly classNameMap?: Map<string, string>;
  private readonly varAccessorNames: Map<string, Map<string, "getter" | "setter" | "both">>;
  private readonly crossModuleClassNames?: Set<string>;

  constructor(context: StatementRendererContext) {
    this.strategy = context.strategy;
    this.knownFunctionReturnTypes = context.knownFunctionReturnTypes;
    this.pointerVarTypes = context.pointerVarTypes;
    this.pointerStructFields = context.pointerStructFields;
    this.classNameMap = context.classNameMap;
    this.varAccessorNames = context.varAccessorNames ?? new Map();
    this.crossModuleClassNames = context.crossModuleClassNames;

    // Create expression renderer with shared context
    this.expressionRenderer = new ExpressionRenderer({
      strategy: context.strategy,
      boardConstants: context.boardConstants,
      classNameMap: context.classNameMap,
      enumNames: context.enumNames,
      largeEnumNames: context.largeEnumNames,
      knownFunctionReturnTypes: context.knownFunctionReturnTypes,
      knownVariableTypes: context.knownVariableTypes,
      pointerVarTypes: context.pointerVarTypes,
      stringVarNames: context.stringVarNames,
      cArrayVarNames: context.cArrayVarNames,
      namespaceNames: context.namespaceNames,
      varAccessorNames: context.varAccessorNames,
      crossModuleClassNames: context.crossModuleClassNames,
      snprintfCounter: context.snprintfCounter,
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
    let prelude = this.expressionRenderer.drainPrelude();
    // When returning a snprintf buffer, make it static so the pointer remains
    // valid after the function returns (avoids dangling pointer to local stack).
    if (statement.kind === "return" && prelude.length > 0) {
      prelude = prelude.map(line => line.replace(/^char /, "static char "));
    }
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
    const rendered = (() => {
      if (statement.kind === "call") {
        return this.renderCall(statement, forHeader, calleeTransformer);
      }

      if (statement.kind === "assign") {
        let target = escapeCppKeyword(statement.target, this.strategy.reservedNames());
        target = this.fixPointerFieldAccess(target);
        // Rewrite setter assignments: c->count = val → c->setCount(val)
        if (statement.operator === "=" || statement.operator === "+=" || statement.operator === "-=") {
          const setterMatch = target.match(/^(.+?)(->|\.)(\w+)$/);
          if (setterMatch) {
            const [, objStr, sep, propName] = setterMatch;
            const varName = objStr.trim();
            const accessors = this.varAccessorNames.get(varName);
            if (accessors?.has(propName)) {
              const kind = accessors.get(propName)!;
              if (kind === "setter" || kind === "both") {
                const setterName = accessorSetterName(propName);
                const renderedValue = this.expressionRenderer.render(statement.value);
                if (statement.operator === "=") {
                  return forHeader
                    ? `${varName}${sep}${setterName}(${renderedValue})`
                    : `${varName}${sep}${setterName}(${renderedValue});`;
                }
                const getterName = accessorGetterName(propName);
                const op = statement.operator.replace("=", "");
                return forHeader
                  ? `${varName}${sep}${setterName}(${varName}${sep}${getterName}() ${op} ${renderedValue})`
                  : `${varName}${sep}${setterName}(${varName}${sep}${getterName}() ${op} ${renderedValue});`;
              }
            }
          }
        }
        return forHeader
          ? `${target} ${statement.operator} ${this.expressionRenderer.render(statement.value)}`
          : `${target} ${statement.operator} ${this.expressionRenderer.render(statement.value)};`;
      }

      if (statement.kind === "update") {
        let target = escapeCppKeyword(statement.target, this.strategy.reservedNames());
        target = this.fixPointerFieldAccess(target);
        return statement.prefix
          ? `${statement.operator}${target}${forHeader ? "" : ";"}`
          : `${target}${statement.operator}${forHeader ? "" : ";"}`;
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
        if (statement.keys && statement.keys.length > 0) {
          const keysArr = statement.keys.map(k => `"${k}"`).join(", ");
          const objName = statement.object.kind === "identifier" ? statement.object.value : "_obj";
          const idxVar = `_ki_${objName}`;
          this.expressionRenderer.pushPrelude([
            `const char* ${idxVar}_keys[] = { ${keysArr} };`,
          ]);
          return `for (${this.strategy.defaultNumericType()} ${idxVar} = 0; ${idxVar} < ${statement.keys.length}; ${idxVar}++)`;
        }
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
    })();

    return this.fixPointerFieldAccess(rendered);
  }

  private fixCrossModuleMethodCall(callee: string): string {
    const lastDot = callee.lastIndexOf(".");
    if (lastDot === -1) {
      return callee;
    }

    const receiverCallee = callee.slice(0, lastDot);
    const memberName = callee.slice(lastDot + 1);
    const receiverMatch = receiverCallee.match(/^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\(/);
    if (!receiverMatch) {
      return callee;
    }

    const receiverCallName = receiverMatch[1];
    const receiverClassName = receiverCallName.split(".")[0];
    const hasKnown = this.knownFunctionReturnTypes?.has(receiverCallName);
    const returnType = this.knownFunctionReturnTypes?.get(receiverCallName);
    const isCrossModuleClass = this.crossModuleClassNames?.has(receiverClassName);
    if (!hasKnown && !isCrossModuleClass) {
      return callee;
    }

    const callPrefix = receiverCallee.replace(
      new RegExp(`^${receiverCallName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*\\(`),
      `${receiverCallName.replace(/\./g, "::")}(`,
    );

    if (returnType?.endsWith("*") || isCrossModuleClass) {
      return `${callPrefix}->${memberName}`;
    }

    return `${callPrefix}.${memberName}`;
  }

  private renderCall(statement: Extract<StatementIR, { kind: "call" }>, forHeader: boolean, calleeTransformer?: (callee: string) => string): string {
    // Handle raw statements from setupInitCode
    if (statement.callee.startsWith('__RAW_STMT__')) {
      const rawStmt = statement.callee.slice('__RAW_STMT__'.length);
      return forHeader ? rawStmt : `${rawStmt.endsWith(';') ? rawStmt : rawStmt + ';'}`;
    }
    // Handle emit() — compile-time C++ injection
    if (statement.callee === "__EMIT__") {
      const rawText = statement.args.map(arg => this.renderEmitArg(arg)).join("");
      return forHeader ? rawText : `${rawText.endsWith(';') ? rawText : rawText + ';'}`;
    }
    // Handle console.* calls specially
    if (isConsoleCall(statement.callee)) {
      return this.transformConsoleCall(statement.callee, statement.args, forHeader);
    }
    let callee = statement.callee;
    if (callee.startsWith("this.")) {
      callee = `this->${callee.slice("this.".length)}`;
    }
    if (calleeTransformer) {
      callee = calleeTransformer(callee);
    }
    callee = this.fixCrossModuleMethodCall(callee);
    callee = this.fixPointerFieldAccess(callee);
    const renderedArgs = statement.args.map((arg) => this.expressionRenderer.render(arg)).join(", ");
    return forHeader ? `${callee}(${renderedArgs})` : `${callee}(${renderedArgs});`;
  }

  private renderVarDecl(statement: Extract<StatementIR, { kind: "var_decl" }>, forHeader: boolean, calleeTransformer?: (callee: string) => string): string {
    const declaredType = this.normalizeCppType(statement.cppType);
    const volatilePrefix = statement.isVolatile ? "volatile " : "";
    // Transform type name for Arduino library classes (add namespace prefix)
    const transformedType = transformTypeName(statement.cppType, this.classNameMap);
    const ownershipKind = (statement as any).ownershipKind as 'owned' | 'shared' | 'mutable' | undefined;
    // Emit const for Shared<T> ownership annotations (ownershipKind === 'shared')
    const isConst = statement.storage === "const" || ownershipKind === 'shared';
    // Emit C++ reference for non-primitive Shared<T>/Mutable<T> from named variables.
    // Primitives pass by value (no overhead). Temporary/literal initializers fall back to copy.
    const isRef = (ownershipKind === 'shared' || ownershipKind === 'mutable')
      && !isPrimitiveCppType(statement.cppType)
      && !isIndirectType(statement.cppType)
      && statement.initializer?.kind === 'identifier';
    const declaration = `${volatilePrefix}${this.renderTypedName(transformedType, statement.name, isConst, isRef)}`;
    
    if (statement.initializer) {
      // Handle lambda initializers: const fn = (x) => expr
      if (statement.initializer.kind === "lambda") {
        const params = statement.initializer.params.map(p => `${p.cppType} ${p.name}`).join(", ");
        const ret = statement.initializer.returnType && statement.initializer.returnType !== "auto"
          ? ` -> ${statement.initializer.returnType}` : "";
        const bodyStr = statement.initializer.body.map(s => "  " + this.render(s)).join("\n");
        const safeName = escapeCppKeyword(statement.name, this.strategy.reservedNames());
        return `auto ${safeName} = [=](${params})${ret} {\n${bodyStr}\n};`;
      }

      // Handle array initializers
      if (statement.initializer.kind === "array") {
        const elements = statement.initializer.elements.map((e) => this.expressionRenderer.render(e)).join(", ");
        const safeArrName = escapeCppKeyword(statement.name, this.strategy.reservedNames());
        const rawType = statement.cppType;

        if (this.strategy.needsStdVector() && rawType.startsWith("std::vector<")) {
          return forHeader
            ? `${declaration} = { ${elements} }`
            : `${declaration} = { ${elements} };`;
        }

        if (!this.strategy.needsStdVector() && rawType.startsWith("std::vector<")) {
          // Non-mutable arrays annotated as Array<T> or ReadonlyArray<T> on platforms
          // that don't support std::vector → emit as a plain C-style array.
          // Mutable arrays (.push/.pop/.indexOf) are rewritten to StaticArray<int> in
          // the IR builder (via mutableArrayVars) and never reach this branch.
          const elementType = rawType.slice("std::vector<".length, -1) || this.strategy.defaultNumericType();
          return forHeader
            ? `${elementType} ${safeArrName}[] = { ${elements} }`
            : `${elementType} ${safeArrName}[] = { ${elements} };`;
        }

        // Use "int" for "auto" element type since C arrays need explicit types
        const arrayType = statement.initializer.elementType === "auto" ? this.strategy.defaultNumericType() : statement.initializer.elementType;
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
        const safeObjName = escapeCppKeyword(statement.name, this.strategy.reservedNames());
        return forHeader
          ? `struct ${structName} { ${fieldDefs} } ${safeObjName} = { ${initValues} }`
          : `struct ${structName} { ${fieldDefs} } ${safeObjName} = { ${initValues} };`;
      }
      // Handle spread array initializers
      if (statement.initializer.kind === "spread_array") {
        const arrayType = statement.initializer.elementType === "auto" ? this.strategy.defaultNumericType() : statement.initializer.elementType;
        const spreadName = this.expressionRenderer.render(statement.initializer.spreadExpr, calleeTransformer);
        const renderedExtraElements = statement.initializer.additionalElements
          .map(e => this.expressionRenderer.render(e, calleeTransformer));
        const safeSpreadArrName = escapeCppKeyword(statement.name, this.strategy.reservedNames());
        if (this.strategy.needsStdVector()) {
          const parts = [`std::vector<${arrayType}> ${safeSpreadArrName}(${spreadName})`];
          for (const elem of renderedExtraElements) {
            parts.push(`${safeSpreadArrName}.push_back(${elem})`);
          }
          return forHeader
            ? parts[0]
            : parts.join("; ") + ";";
        }
        const initializerParts = [`/* spread from ${spreadName} */`, ...renderedExtraElements];
        const initializerText = initializerParts.join(', ');
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
    const safeName = escapeCppKeyword(name, this.strategy.reservedNames());
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
   * Emits `const` for parameters annotated with `Shared<T>` (ownershipKind === 'shared').
   */
  renderParameters(
    parameters: Array<{ name: string; cppType: string; defaultValue?: any; ownershipKind?: 'owned' | 'shared' | 'mutable' }>,
  ): string {
    if (parameters.length === 0) {
      return "";
    }

    return parameters
      .map((parameter) => {
        const paramOwnershipKind = (parameter as any).ownershipKind as 'owned' | 'shared' | 'mutable' | undefined;
        const isConst = paramOwnershipKind === 'shared';
        // Emit C++ reference for non-primitive Shared<T>/Mutable<T> parameters.
        const isRef = (paramOwnershipKind === 'shared' || paramOwnershipKind === 'mutable')
          && !isPrimitiveCppType(parameter.cppType)
          && !isIndirectType(parameter.cppType);
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
      this.strategy.defaultNumericType(),
      (o, n) => this.strategy.resolvePinType?.(o, n),
    );
  }

  /**
   * Transform method calls on pointer variables and pointer struct fields from '.' to '->'
   */
  private fixPointerFieldAccess(callee: string): string {
    // In C++, 'this' is a pointer — always use -> for member access.
    callee = callee.replace(/\bthis\./g, "this->");
    // Handle top-level pointer variables (e.g., sensor.method() -> sensor->method())
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

  private renderEmitArg(arg: ExpressionIR): string {
    if (arg.kind === "string") return arg.value;
    if (arg.kind === "string_concat") return arg.parts.map(p => this.renderEmitArg(p)).join("");
    if (arg.kind === "template_string") return this.expressionRenderer.render(arg.expression);
    return this.expressionRenderer.render(arg);
  }
}