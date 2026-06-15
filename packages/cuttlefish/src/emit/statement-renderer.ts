/**
 * Statement Renderer for C++ code emission.
 * Encapsulates all statement rendering logic with explicit dependencies.
 * Extracted from cpp-emitter.ts
 */

import type { StatementIR, ExpressionIR } from "../api";
import type { PlatformStrategy } from "../api/shared";
import type { BoardConstants } from "../ir/board-resolver";
import type { KnownVariableInfo } from "../api/shared";
import { ExpressionRenderer, transformTypeName, normalizeRawExpression } from "./expression-renderer";
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
  /** Set of string enum names (lowered to const char* namespaces; members are const char*) */
  stringEnumNames?: Set<string>;
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
  /** Map of interface/type name to field C++ types */
  interfaceFieldTypes?: Map<string, Map<string, string>>;
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

function isIndirectType(cppType: string, strategy: PlatformStrategy): boolean {
  const t = cppType.trim();
  return strategy.isPointerType(t) || /\[\d*\]$/.test(t);
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
  private readonly enumNames: Set<string>;
  private readonly stringEnumNames: Set<string>;
  private readonly interfaceFieldTypes: Map<string, Map<string, string>>;

  constructor(context: StatementRendererContext) {
    this.strategy = context.strategy;
    this.knownFunctionReturnTypes = context.knownFunctionReturnTypes;
    this.pointerVarTypes = context.pointerVarTypes;
    this.pointerStructFields = context.pointerStructFields;
    this.classNameMap = context.classNameMap;
    this.varAccessorNames = context.varAccessorNames ?? new Map();
    this.crossModuleClassNames = context.crossModuleClassNames;
    this.enumNames = context.enumNames;
    this.stringEnumNames = context.stringEnumNames ?? new Set();
    this.interfaceFieldTypes = context.interfaceFieldTypes ?? new Map();

    // Create expression renderer with shared context
    this.expressionRenderer = new ExpressionRenderer({
      strategy: context.strategy,
      boardConstants: context.boardConstants,
      classNameMap: context.classNameMap,
      enumNames: context.enumNames,
      stringEnumNames: context.stringEnumNames,
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
      interfaceFieldTypes: this.interfaceFieldTypes,
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
   * @param knownVariableTypes Optional override for variable type mapping
   * @returns Object with prelude lines and the rendered statement
   */
  renderWithPrelude(statement: StatementIR, forHeader: boolean = false, calleeTransformer?: (callee: string) => string, knownVariableTypes?: Map<string, KnownVariableInfo>): { prelude: string[]; statement: string } {
    this.expressionRenderer.clearPrelude();
    const rendered = this.render(statement, forHeader, calleeTransformer, knownVariableTypes);
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
   * @param knownVariableTypes Optional override for variable type mapping
   * @returns The C++ code string
   */
  render(statement: StatementIR, forHeader: boolean = false, calleeTransformer?: (callee: string) => string, knownVariableTypes?: Map<string, KnownVariableInfo>): string {
    const rendered = (() => {
      if (statement.kind === "call") {
        return this.renderCall(statement, forHeader, calleeTransformer, knownVariableTypes);
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
                const renderedValue = this.expressionRenderer.render(statement.value, undefined, knownVariableTypes);
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
          ? `${target} ${statement.operator} ${this.expressionRenderer.render(statement.value, undefined, knownVariableTypes)}`
          : `${target} ${statement.operator} ${this.expressionRenderer.render(statement.value, undefined, knownVariableTypes)};`;
      }

      if (statement.kind === "update") {
        let target = escapeCppKeyword(statement.target, this.strategy.reservedNames());
        target = this.fixPointerFieldAccess(target);
        return statement.prefix
          ? `${statement.operator}${target}${forHeader ? "" : ";"}`
          : `${target}${statement.operator}${forHeader ? "" : ";"}`;
      }

      if (statement.kind === "return") {
        return statement.value ? `return ${this.expressionRenderer.render(statement.value, undefined, knownVariableTypes)};` : "return;";
      }

      if (statement.kind === "while") {
        return `while (${this.expressionRenderer.render(statement.condition, undefined, knownVariableTypes)})`;
      }

      if (statement.kind === "if") {
        return `if (${this.expressionRenderer.render(statement.condition, undefined, knownVariableTypes)})`;
      }

      if (statement.kind === "for") {
        let init = "";
        if (statement.initializer) {
          if (statement.initializer.kind === "var_decl" && statement.initializer.storage === "var") {
            const declaredType = this.normalizeCppType(statement.initializer.cppType);
            this.expressionRenderer.pushPrelude([`${declaredType} ${escapeCppKeyword(statement.initializer.name, this.strategy.reservedNames())};`]);
            const safeName = escapeCppKeyword(statement.initializer.name, this.strategy.reservedNames());
            init = statement.initializer.initializer
              ? `${safeName} = ${this.expressionRenderer.render(statement.initializer.initializer, calleeTransformer, knownVariableTypes)}`
              : safeName;
          } else {
            init = this.render(statement.initializer, true, calleeTransformer, knownVariableTypes);
          }
        }
        const cond = statement.condition ? this.expressionRenderer.render(statement.condition, undefined, knownVariableTypes) : "";
        const incr = statement.increment ? this.render(statement.increment, true, calleeTransformer, knownVariableTypes) : "";
        return `for (${init}; ${cond}; ${incr})`;
      }

      if (statement.kind === "for_of") {
        const varDecl = statement.variable;
        if (varDecl.kind === "var_decl") {
          return `for (${this.renderTypedName(varDecl.cppType, varDecl.name, varDecl.storage === "const")} : ${this.expressionRenderer.render(statement.iterable, undefined, knownVariableTypes)})`;
        }
        return `for (auto item : ${this.expressionRenderer.render(statement.iterable, undefined, knownVariableTypes)})`;
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
          return `for (${this.renderTypedName(varDecl.cppType, varDecl.name, varDecl.storage === "const")} : ${this.expressionRenderer.render(statement.object, undefined, knownVariableTypes)})`;
        }
        return `for (auto key : ${this.expressionRenderer.render(statement.object, undefined, knownVariableTypes)})`;
      }

      if (statement.kind === "break") {
        return statement.label ? `goto __break_${statement.label};` : "break;";
      }

      if (statement.kind === "continue") {
        return statement.label ? `continue /* ${statement.label}: labeled continue uses normal continue in C++ */;` : "continue;";
      }

      if (statement.kind === "do_while") {
        return `do`;
      }

      if (statement.kind === "switch") {
        const discExpr = statement.expression;
        const discText = this.expressionRenderer.render(discExpr, undefined, knownVariableTypes);
        // C++ switch requires an integral discriminant. Since `number` vars are now
        // `double`/`float` (Issue 5), cast floating-point discriminants to int.
        let needsIntCast = false;
        if (discExpr.kind === "identifier") {
          const t = knownVariableTypes?.get(discExpr.value)?.cppType;
          needsIntCast = t === "double" || t === "float" || t === "long double";
        } else if (discExpr.kind === "number" && !Number.isInteger(discExpr.value)) {
          needsIntCast = true;
        }
        return `switch (${needsIntCast ? `static_cast<int>(${discText})` : discText})`;
      }

      if (statement.kind === "try") {
        return "try";
      }

      if (statement.kind === "throw") {
        return this.strategy.renderThrow(this.expressionRenderer.render(statement.value, undefined, knownVariableTypes));
      }

      if (statement.kind === "labeled") {
        // The user's TS label is documentary only — actual control flow
        // uses `goto __break_<label>`. Emitting it as a bare C++ label
        // (`label:`) triggers -Wunused-label because no goto targets it
        // directly. Emit as a comment to preserve the source mapping
        // without the warning.
        return `/* ${statement.label}: */`;
      }

      if (statement.kind === "yield") {
        if (statement.isDelegate && statement.value) {
          const val = this.expressionRenderer.render(statement.value, undefined, knownVariableTypes);
          return `for (auto& __elem : ${val}) co_yield __elem;`;
        }
        if (statement.value) {
          return `co_yield ${this.expressionRenderer.render(statement.value, undefined, knownVariableTypes)};`;
        }
        return "co_yield;";
      }

      if (statement.kind === "block") {
        return `{`;
      }

      if (statement.kind === "hal-op") {
        const resolved = this.strategy.resolveHALOperation?.(statement.operation);
        if (resolved?.code) {
          // Strip leading 'return ' from raw hal-op code when emitted as a
          // standalone statement.  The HAL definition includes `return` because
          // the TypeScript stub returns a value, but the C++ statement context
          // (e.g. inside void setup()) does not expect it.
          const code = resolved.code;
          return code.startsWith('return ') ? code.slice('return '.length) : code;
        }
        if (resolved?.expression) {
          return forHeader ? resolved.expression : `${resolved.expression};`;
        }
        return `/* unhandled hal-op: ${statement.operation.operation} */`;
      }

      if (statement.kind !== "var_decl") {
        return "/* unsupported_statement */";
      }

      return this.renderVarDecl(statement, forHeader, calleeTransformer, knownVariableTypes);
    })();

    const fixed = this.fixPointerFieldAccess(rendered);
    return normalizeRawExpression(fixed, this.strategy, this.classNameMap);
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

    if ((returnType && this.strategy.isPointerType(returnType)) || isCrossModuleClass) {
      return `${callPrefix}->${memberName}`;
    }

    return `${callPrefix}.${memberName}`;
  }

  private renderCall(statement: Extract<StatementIR, { kind: "call" }>, forHeader: boolean, calleeTransformer?: (callee: string) => string, knownVariableTypes?: Map<string, KnownVariableInfo>): string {
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
      return this.transformConsoleCall(statement.callee, statement.args, forHeader, knownVariableTypes);
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
    const renderedArgs = statement.args.map((arg) => this.expressionRenderer.render(arg, undefined, knownVariableTypes)).join(", ");
    return forHeader ? `${callee}(${renderedArgs})` : `${callee}(${renderedArgs});`;
  }

  private renderVarDecl(statement: Extract<StatementIR, { kind: "var_decl" }>, forHeader: boolean, calleeTransformer?: (callee: string) => string, knownVariableTypes?: Map<string, KnownVariableInfo>): string {
    // Register this declaration's type in the active scope so that downstream
    // expression rendering (e.g. `arr.length` → sizeof for C arrays) can look
    // up the variable's C++ type. Without this, locals in top-level/generated
    // functions aren't visible to renderPropertyAccess.
    if (knownVariableTypes && statement.cppType) {
      knownVariableTypes.set(statement.name, { cppType: statement.cppType });
    }
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
      && !isIndirectType(statement.cppType, this.strategy)
      && statement.initializer?.kind === 'identifier';
    const declaration = `${volatilePrefix}${this.renderTypedName(transformedType, statement.name, isConst, isRef)}`;
    
    if (statement.initializer) {
      // Handle lambda initializers: const fn = (x) => expr
      if (statement.initializer.kind === "lambda") {
        const params = statement.initializer.params.map(p => `${p.cppType} ${p.name}`).join(", ");
        const ret = statement.initializer.returnType && statement.initializer.returnType !== "auto"
          ? ` -> ${statement.initializer.returnType}` : "";
        const bodyStr = statement.initializer.body.map(s => "  " + this.render(s, false, calleeTransformer, knownVariableTypes)).join("\n");
        const safeName = escapeCppKeyword(statement.name, this.strategy.reservedNames());
        return `auto ${safeName} = [&](${params})${ret} {\n${bodyStr}\n};`;
      }

      // Handle array initializers
      if (statement.initializer.kind === "array") {
        const safeArrName = escapeCppKeyword(statement.name, this.strategy.reservedNames());
        const rawType = statement.cppType;

        const hasObjectElements = statement.initializer.elements.some(e => e.kind === "object");
        if (hasObjectElements) {
          const structName = `_${statement.name}_t`;
          const firstObj = statement.initializer.elements.find(e => e.kind === "object") as Extract<ExpressionIR, { kind: "object" }>;

          const nestedStructs = collectNestedStructDefs(
            firstObj, statement.name,
            this.pointerVarTypes, this.knownFunctionReturnTypes,
          );
          if (nestedStructs.length > 0) {
            for (const nested of nestedStructs) {
              this.interfaceFieldTypes.set(nested.structName, new Map(nested.fields.map((field) => [field.name, field.type])));
            }
            const nestedDefs = nestedStructs.map(
              (ns) => `struct ${ns.structName} { ${ns.fields.map((f) => `${f.type} ${f.name};`).join(" ")} };`
            );
            this.expressionRenderer.pushPrelude(nestedDefs);
          }

          const fieldTypes = new Map(firstObj.fields.map((field) => [
            field.name,
            this.inferFieldType(field.value, statement.name, field.name),
          ]));
          this.interfaceFieldTypes.set(structName, fieldTypes);
          const fieldDefs = firstObj.fields
            .map((f) => `${fieldTypes.get(f.name)} ${f.name};`)
            .join(" ");
          this.expressionRenderer.pushPrelude([`struct ${structName} { ${fieldDefs} };`]);

          const streamFields = firstObj.fields
            .map((f) => `"${f.name}: " << obj.${f.name}`)
            .join(' << ", " << ');
          this.expressionRenderer.pushPrelude([
            `std::ostream& operator<<(std::ostream& os, const ${structName}& obj) { os << ${streamFields}; return os; }`
          ]);

          const elements = statement.initializer.elements.map((e) => {
            if (e.kind === "object") {
              const initValues = e.fields.map((f) => {
                const renderExpr = (expr: ExpressionIR) => this.expressionRenderer.render(expr, calleeTransformer, knownVariableTypes);
                const overridden = this.strategy.objectFieldInitializer(f.value, renderExpr);
                if (overridden !== undefined) return overridden;
                return renderExpr(f.value);
              }).join(", ");
              return `{ ${initValues} }`;
            }
            return this.expressionRenderer.render(e, undefined, knownVariableTypes);
          }).join(", ");

          const vecType = `std::vector<${structName}>`;
          return forHeader
            ? `${vecType} ${safeArrName} = { ${elements} }`
            : `${vecType} ${safeArrName} = { ${elements} };`;
        }

        const elements = statement.initializer.elements.map((e) => this.expressionRenderer.render(e, undefined, knownVariableTypes)).join(", ");

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
        const placeholderStructName = `_${statement.name}_t`;
        // When the source annotation names a concrete type (e.g. an exported
        // interface referenced across modules: `const cfg: ThresholdConfig = {...}`),
        // cppType already carries that interface/struct name. The struct is declared
        // elsewhere (the interface declaration), so we must NOT emit an inline
        // `struct _name_t {...}` here — that would conflict with the real type.
        // Only synthesize when no explicit named type was provided.
        const declaredCppType = statement.cppType;
        const hasExplicitNamedType =
          !!declaredCppType &&
          declaredCppType !== "auto" &&
          declaredCppType !== placeholderStructName &&
          !declaredCppType.includes("<") &&   // templates (vector<...>) stay struct-inferred
          !declaredCppType.endsWith("*") &&   // pointers stay struct-inferred
          !declaredCppType.endsWith("]");     // arrays stay struct-inferred

        const fieldTypes = new Map(statement.initializer.fields.map((field) => [
          field.name,
          this.inferFieldType(field.value, statement.name, field.name),
        ]));
        const initValues = statement.initializer.fields
          .map((f) => {
            const renderExpr = (e: ExpressionIR) => this.expressionRenderer.render(e, calleeTransformer, knownVariableTypes);
            const overridden = this.strategy.objectFieldInitializer(f.value, renderExpr);
            if (overridden !== undefined) return overridden;
            return renderExpr(f.value);
          })
          .join(", ");
        const safeObjName = escapeCppKeyword(statement.name, this.strategy.reservedNames());

        if (hasExplicitNamedType) {
          // Emit the definition using the declared named type; no inline struct.
          // const-ness follows the declared storage so it matches the extern.
          const namedType = this.normalizeCppType(declaredCppType!);
          const isConst = statement.storage === "const";
          const constPrefix = isConst ? "const " : "";
          this.interfaceFieldTypes.set(namedType, fieldTypes);
          return forHeader
            ? `${constPrefix}${namedType} ${safeObjName} = { ${initValues} }`
            : `${constPrefix}${namedType} ${safeObjName} = { ${initValues} };`;
        }

        const structName = placeholderStructName;
        // Collect nested struct definitions (deepest first) and emit as prelude
        const nestedStructs = collectNestedStructDefs(
          statement.initializer, statement.name,
          this.pointerVarTypes, this.knownFunctionReturnTypes,
        );
        if (nestedStructs.length > 0) {
          for (const nested of nestedStructs) {
            this.interfaceFieldTypes.set(nested.structName, new Map(nested.fields.map((field) => [field.name, field.type])));
          }
          const nestedDefs = nestedStructs.map(
            (ns) => `struct ${ns.structName} { ${ns.fields.map((f) => `${f.type} ${f.name};`).join(" ")} };`
          );
          this.expressionRenderer.pushPrelude(nestedDefs);
        }

        this.interfaceFieldTypes.set(structName, fieldTypes);
        const fieldDefs = statement.initializer.fields
          .map((f) => `${fieldTypes.get(f.name)} ${f.name};`)
          .join(" ");
        return forHeader
          ? `struct ${structName} { ${fieldDefs} } ${safeObjName} = { ${initValues} }`
          : `struct ${structName} { ${fieldDefs} } ${safeObjName} = { ${initValues} };`;
      }
      // Handle spread array initializers
      if (statement.initializer.kind === "spread_array") {
        let arrayType = statement.initializer.elementType === "auto" ? this.strategy.defaultNumericType() : statement.initializer.elementType;
        const spreadName = this.expressionRenderer.render(statement.initializer.spreadExpr, calleeTransformer, knownVariableTypes);
        if (statement.initializer.elementType === "auto" && knownVariableTypes && statement.initializer.spreadExpr.kind === "identifier") {
          const srcInfo = knownVariableTypes.get(statement.initializer.spreadExpr.value);
          if (srcInfo) {
            const vectorMatch = srcInfo.cppType.match(/^std::vector<(.+)>$/);
            if (vectorMatch) {
              arrayType = vectorMatch[1];
            }
          }
        }
        const renderedExtraElements = statement.initializer.additionalElements
          .map(e => this.expressionRenderer.render(e, calleeTransformer, knownVariableTypes));
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
      // Enum → number implicit conversion. TS lets you write
      // `const n: number = someEnumValue` (enums are numbers at runtime), but
      // the lowered C++ `enum class` has no implicit conversion to int, so
      // the emitted `int n = someEnumValue;` fails to compile. When the
      // declared type is a numeric C++ type and the initializer is a known
      // enum value (identifier of enum type, or an enum member access),
      // wrap the initializer in `static_cast<int>(...)`. Mirrors the existing
      // enum→int cast in console.log arg rendering above.
      const isNumericTarget = /^(?:unsigned\s+)?(?:char|short|int|long|long\s+long|double|float)$/.test(declaredType)
        || /^(?:u?int(?:8|16|32|64)_t|size_t)$/.test(declaredType);
      const initializerIsEnumValue = (() => {
        const init = statement.initializer;
        if (!knownVariableTypes) return false;
        if (init.kind === "identifier") {
          const varInfo = knownVariableTypes.get(init.value);
          return !!varInfo && this.enumNames.has(varInfo.cppType);
        }
        if (init.kind === "property-access" && init.isEnum) {
          return true;
        }
        return false;
      })();
      const initRendered = this.expressionRenderer.render(statement.initializer, calleeTransformer, knownVariableTypes);
      const finalInit = (isNumericTarget && initializerIsEnumValue)
        ? `static_cast<int>(${initRendered})`
        : initRendered;
      return forHeader
        ? `${declaration} = ${finalInit}`
        : `${declaration} = ${finalInit};`;
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
    const arrayMatch = normalizedType.match(/^(.+?)\s*\[(\d*)\]$/);
    if (arrayMatch) {
      const baseType = arrayMatch[1].trim();
      const size = arrayMatch[2];
      const constPrefix = isConst && !alreadyConstQualified ? "const " : "";
      return `${constPrefix}${baseType} ${safeName}[${size}]`;
    }
    if (isConst && !alreadyConstQualified && normalizedType.endsWith("*")) {
      return `${normalizedType} ${safeName}`;
    }
    const constPrefix = isConst && !alreadyConstQualified ? "const " : "";
    const refMark = isRef ? "& " : " ";
    return `${constPrefix}${normalizedType}${refMark}${safeName}`;
  }

  /**
   * Renders function parameters.
   * Emits `const` for parameters annotated with `Shared<T>` (ownershipKind === 'shared').
   */
  renderParameters(
    parameters: Array<{ name: string; cppType: string; defaultValue?: any; isRest?: boolean; ownershipKind?: 'owned' | 'shared' | 'mutable' }>,
    forHeader: boolean = false,
  ): string {
    if (parameters.length === 0) {
      return "";
    }

    return parameters
      .map((parameter) => {
        const paramOwnershipKind = (parameter as any).ownershipKind as 'owned' | 'shared' | 'mutable' | undefined;
        const hasOwnership = paramOwnershipKind === 'shared' || paramOwnershipKind === 'mutable';
        const isNonPrimitiveNonPointer = !isPrimitiveCppType(parameter.cppType)
          && !isIndirectType(parameter.cppType, this.strategy);
        const paramTypeName = parameter.cppType.trim();
        // User-defined struct/interface types (not std:: containers, not enums)
        // default to pass-by-const-reference to avoid expensive copies and surface
        // accidental local mutations as errors. Shared<T>/Mutable<T> keep borrowing
        // any non-primitive, non-pointer type (including std:: containers).
        const isUserStructType = isNonPrimitiveNonPointer
          && !paramTypeName.startsWith("std::")
          && !this.enumNames.has(paramTypeName);
        const isRef = (hasOwnership && isNonPrimitiveNonPointer) || isUserStructType;
        // Refs default to a const borrow; Mutable<T> unlocks a mutable reference.
        // Primitives only gain const when explicitly annotated with Shared<T>.
        const isConst = isRef
          ? (!hasOwnership || paramOwnershipKind === 'shared')
          : paramOwnershipKind === 'shared';
        let cppType = parameter.cppType;
        if ((parameter as any).isRest) {
          const elementType = cppType.replace(/^std::vector<(.+)>$/, '$1') || 'auto';
          cppType = `const std::vector<${elementType}>&`;
          const safeName = escapeCppKeyword(parameter.name, this.strategy.reservedNames());
          let result = `${cppType} ${safeName}`;
          if (forHeader && parameter.defaultValue) {
            result += ` = ${this.expressionRenderer.render(parameter.defaultValue)}`;
          }
          return result;
        }
        let result = this.renderTypedName(cppType, parameter.name, isConst, isRef);
        if (forHeader && parameter.defaultValue) {
          result += ` = ${this.expressionRenderer.render(parameter.defaultValue)}`;
        }
        return result;
      })
      .join(", ");
  }

  /**
   * Public type-mapping entry point for emitters that emit types directly
   * (function return types, forward declarations) rather than via
   * renderTypedName. Applies the same string-enum → const char* substitution.
   */
  mapTypeForEmit(typeName: string): string {
    return this.normalizeCppType(typeName);
  }

  /**
   * Map a function's return type for emission. Unlike {@link mapTypeForEmit},
   * this respects the strategy's {@code mapReturnType} contract: the value
   * produced by {@code mapReturnType} is already final and must NOT be
   * re-normalised. This matters for entrypoints like {@code main}, whose
   * mapped {@code int} return type would otherwise be turned back into
   * {@code long long} by {@code normalizeCppType}.
   *
   * For non-entrypoint functions we still apply the string-enum → const char*
   * substitution (which {@code mapReturnType} does not perform), preserving
   * existing behaviour for ordinary functions.
   */
  mapReturnTypeForEmit(fnName: string, returnType: string): string {
    if (fnName === this.strategy.entrypointFunctionName()) {
      return returnType;
    }
    return this.mapTypeForEmit(returnType);
  }

  private normalizeCppType(typeName: string): string {
    // A TS string-enum type name (e.g. `Color`) is lowered to a namespace of
    // constexpr const char* constants, so values of that type are const char*.
    // Substitute the type so declarations like `const Color c` become
    // `const const char* c` (valid: const pointer to const char).
    if (this.stringEnumNames.has(typeName)) {
      return this.strategy.normalizeCppType("const char*");
    }
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
        if (this.strategy.isPointerType(varType)) {
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
    forHeader: boolean,
    knownVariableTypes?: Map<string, KnownVariableInfo>
  ): string {
    const method = getConsoleMethod(callee);
    const renderedArgs = args.map((arg) => {
      let rendered = this.expressionRenderer.render(arg, undefined, knownVariableTypes);
      if (arg.kind === "identifier" && knownVariableTypes) {
        const varInfo = knownVariableTypes.get(arg.value);
        if (varInfo && this.enumNames.has(varInfo.cppType)) {
          rendered = `static_cast<int>(${rendered})`;
        }
      }
      if (arg.kind === "property-access" && arg.isEnum) {
        rendered = `static_cast<int>(${rendered})`;
      }
      return rendered;
    }).join(" << ");
    return this.strategy.transformConsoleCall(method, renderedArgs, forHeader);
  }

  private renderEmitArg(arg: ExpressionIR): string {
    if (arg.kind === "string") return arg.value;
    if (arg.kind === "string_concat") return arg.parts.map(p => this.renderEmitArg(p)).join("");
    if (arg.kind === "template_string") return this.expressionRenderer.render(arg.expression);
    return this.expressionRenderer.render(arg);
  }

  /**
   * Map a function name to its platform-specific name (e.g. __cuttlefish_entrypoint__ -> setup/main).
   */
  public mapFunctionName(originalName: string): string {
    if (originalName === "__cuttlefish_entrypoint__") {
      return this.strategy.entrypointFunctionName();
    }
    return originalName;
  }

  /**
   * Map a TypeScript return type to its C++ equivalent for a specific function.
   */
  public mapReturnType(fnName: string, tsType: string): string {
    return this.strategy.mapReturnType(fnName, tsType);
  }
}
