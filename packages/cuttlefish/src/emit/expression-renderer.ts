/**
 * Expression Renderer for C++ code emission.
 * Encapsulates all expression rendering logic with explicit dependencies.
 * Extracted from cpp-emitter.ts
 */

import type { ExpressionIR } from "../api/index.js";
import type { PlatformStrategy } from "../api/shared/index.js";
import type { BoardConstants } from "../ir/board-resolver.js";
import type { KnownVariableInfo } from "../api/shared/index.js";
import { routeHALOp } from "./route-hal-op.js";
import type { Diagnostic } from "../types.js";
import { extractPropertyChain } from "../ir/extract-property-chain.js";
import { escapeCppKeyword, escapeCppStringLiteral } from "../utils/strings.js";
import { accessorGetterName } from "./utils/cpp-helpers.js";
import { INTEGRAL_CPP_TYPE_RE } from "./utils/cpp-helpers.js";
import { renderPeripheralProperty } from "../mapping/peripheral-names.js";
import { parseCppType, renderCppType, bareType, parsedIsPointer, parsedIsStringLike, parsedElementString, parsedIsVector, needsCStrForStringLike } from "../api/shared/cpp-type-ir.js";
import { cppTypeForHalOp } from "./utils/hal-op-cpp-type.js";

/**
 * Context needed for expression rendering.
 */
interface ExpressionRendererContext {
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
  knownFunctionReturnTypes?: Map<string, string>;
  /** Map of variable names to their inferred C++ types (for snprintf format specifiers) */
  knownVariableTypes?: Map<string, KnownVariableInfo>;
  /** Map of variable names to their pointer types */
  pointerVarTypes?: Map<string, string>;
  /** Module-scope (file-global) variables resolved to pointer C++ types, used
   *  to decide `->` vs `.` when a bare identifier resolves to a global pointer
   *  (e.g. an ISR-captured `const btn = new Button()` accessed inside a hoisted
   *  callback, where the local-scope type map is empty). Replaces the
   *  file-wide `\b${name}\.` → `${name}->` text sweep that previously patched
   *  this in output-finalizer.ts. */
  globalPointerVarTypes?: Map<string, string>;
  /** Set of variable names known to hold string values (for snprintf %s) */
  stringVarNames?: Set<string>;
  /** Set of variable names known to be emitted as C arrays */
  cArrayVarNames?: Set<string>;
  /** Set of namespace names for scoped access (::) instead of (.) */
  namespaceNames?: Set<string>;
  /** Cross-module class names recognized by the expression renderer. */
  crossModuleClassNames?: Set<string>;
  /** Map of variable names to their class's accessor map for getter/setter rewriting */
  varAccessorNames?: Map<string, Map<string, "getter" | "setter" | "both">>;
  /**
   * Map of class type names to their accessor map. Used as a fallback when a
   * member access's receiver isn't in `varAccessorNames` (e.g. a for-of loop
   * variable, a function-call return, or a chained access) but its resolved
   * C++ type names a class with getters. Lets the getter rewrite
   * (`obj.prop` → `obj->getProp()`) fire for any pointer-valued receiver of a
   * known class type, not just `this` and explicitly-registered variables.
   */
  typeAccessorNames?: Map<string, Map<string, "getter" | "setter" | "both">>;
  /** Optional transformer for expression values */
  exprTransformer?: (expr: string) => string;
  /** Shared counter for unique snprintf buffer names across statement renders */
  snprintfCounter?: { value: number };
  /** Map of interface/type name to field C++ types */
  interfaceFieldTypes?: Map<string, Map<string, string>>;
  /** Names of top-level const object variables (e.g. `const CONFIG = {...}`),
   *  used to distinguish `.` member access on an instance from `::` on a
   *  namespace/class. */
  knownTopLevelObjectTypes?: Map<string, string>;
  /**
   * Shared sink for emit-time diagnostics. When provided, the renderer's
   * fallback paths (e.g. an unregistered HAL operation) push structured
   * warnings here instead of silently emitting placeholder comments. The
   * array is the same one finalizeOutput merges into the final diagnostics
   * list. Optional so ad-hoc/test constructions still work.
   */
  diagnostics?: Diagnostic[];
}

/**
 * Renders ExpressionIR nodes to C++ code strings.
 */
export class ExpressionRenderer {
  private readonly strategy: PlatformStrategy;
  private readonly boardConstants?: BoardConstants;
  private readonly classNameMap?: Map<string, string>;
  private readonly enumNames: Set<string>;
  private readonly stringEnumNames: Set<string>;
  private readonly largeEnumNames: Set<string>;
  private readonly knownFunctionReturnTypes?: Map<string, string>;
  // Mutable: render() temporarily installs a per-scope map (function params)
  // for the duration of a call so recursive renders + renderIdentifier see it.
  private knownVariableTypes?: Map<string, KnownVariableInfo>;
  private readonly pointerVarTypes?: Map<string, string>;
  private readonly globalPointerVarTypes?: Map<string, string>;
  private readonly stringVarNames?: Set<string>;
  private readonly cArrayVarNames?: Set<string>;
  private readonly namespaceNames: Set<string>;
  private readonly varAccessorNames: Map<string, Map<string, "getter" | "setter" | "both">>;
  private readonly typeAccessorNames: Map<string, Map<string, "getter" | "setter" | "both">>;
  private readonly interfaceFieldTypes: Map<string, Map<string, string>>;
  private readonly knownTopLevelObjectTypes?: Map<string, string>;

  /** Accumulated snprintf prelude lines (buffer declarations, dtostrf calls, snprintf calls). */
  private _preludeLines: string[] = [];
  /** Monotonic counter for unique snprintf buffer names. Shared across renders when provided. */
  private _snprintfCounter: { value: number };
  /** Shared emit-time diagnostics sink (see ExpressionRendererContext.diagnostics). */
  private readonly _diagnostics: Diagnostic[];

  constructor(context: ExpressionRendererContext) {
    this.strategy = context.strategy;
    this.boardConstants = context.boardConstants;
    this.classNameMap = context.classNameMap;
    this.enumNames = context.enumNames;
    this.stringEnumNames = context.stringEnumNames ?? new Set();
    this.largeEnumNames = context.largeEnumNames;
    this.knownFunctionReturnTypes = context.knownFunctionReturnTypes;
    this.knownVariableTypes = context.knownVariableTypes;
    this.pointerVarTypes = context.pointerVarTypes;
    this.globalPointerVarTypes = context.globalPointerVarTypes;
    this.stringVarNames = context.stringVarNames;
    this.cArrayVarNames = context.cArrayVarNames;
    this.namespaceNames = context.namespaceNames ?? new Set();
    this.varAccessorNames = context.varAccessorNames ?? new Map();
    this.typeAccessorNames = context.typeAccessorNames ?? new Map();
    this.interfaceFieldTypes = context.interfaceFieldTypes ?? new Map();
    this.knownTopLevelObjectTypes = context.knownTopLevelObjectTypes;
    this._snprintfCounter = context.snprintfCounter ?? { value: 0 };
    this._diagnostics = context.diagnostics ?? [];
  }

  /**
   * Gets the board constants (for access by statement renderer).
   */
  getBoardConstants(): BoardConstants | undefined {
    return this.boardConstants;
  }

  /**
   * Clear accumulated prelude lines. Call before each top-level render.
   */
  clearPrelude(): void {
    this._preludeLines = [];
  }

  /**
   * Drain accumulated prelude lines and clear. The caller is responsible
   * for emitting these lines before the statement that uses the expression.
   */
  drainPrelude(): string[] {
    const lines = this._preludeLines;
    this._preludeLines = [];
    return lines;
  }

  /**
   * Push lines directly into the prelude buffer. Used by the statement renderer
   * to inject multi-statement expansions (e.g. Wire read setup) that must appear
   * before the surrounding statement.
   */
  pushPrelude(lines: string[]): void {
    this._preludeLines.push(...lines);
  }

  /**
   * Renders an expression IR node to a C++ string.
   * 
   * @param expr The expression to render
   * @param exprTransformer Optional transformer for raw expressions
   * @param knownVariableTypes Optional override for variable type mapping
   * @returns The C++ code string
   */
  render(expr: ExpressionIR, exprTransformer?: (expr: string) => string, knownVariableTypes?: Map<string, KnownVariableInfo>): string {
    // Safety check
    if (!expr || typeof expr !== 'object' || !expr.kind) {
      return "/* invalid expression */";
    }

    // When a per-scope knownVariableTypes is passed (e.g. a function's child
    // emission scope carrying its parameters), install it on the instance for
    // the duration of this render so every recursive render() call and
    // renderIdentifier() reads the merged scope (globals + params). Without
    // this, recursive paths that don't forward knownVariableTypes (ternary
    // branches, call args, array elements, …) would resolve identifiers
    // against only the top-level scope, missing function parameters — which
    // breaks reserved-name escaping for params like `min`/`max` on Arduino.
    const prevKnownVariableTypes = this.knownVariableTypes;
    if (knownVariableTypes) {
      this.knownVariableTypes = knownVariableTypes;
    }

    let rendered: string;
    switch (expr.kind) {
      case "number": {
        if (expr.cppType === "float" || !Number.isInteger(expr.value)) {
          const str = `${expr.value}`;
          rendered = str.includes('.') || str.includes('e') || str.includes('E')
            ? `${str}f`
            : `${str}.0f`;
          break;
        }
        rendered = `${expr.value}`;
        break;
      }
      case "string":
        rendered = `"${expr.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
        break;
      case "boolean":
        rendered = expr.value ? "true" : "false";
        break;
      case "identifier":
        rendered = this.renderIdentifier(expr.value, knownVariableTypes);
        break;
      case "raw":
        rendered = this.renderRaw(expr.value, exprTransformer);
        break;
      case "await":
        rendered = this.render(expr.value, exprTransformer);
        break;
      case "ternary":
        rendered = this.renderTernary(expr, exprTransformer);
        break;
      case "string_concat":
        rendered = this.renderStringConcat(expr, exprTransformer, knownVariableTypes);
        break;
      case "template_string":
        rendered = this.renderTemplateString(expr, exprTransformer, knownVariableTypes);
        break;
      case "array":
        rendered = this.renderArray(expr, exprTransformer);
        break;
      case "object":
        rendered = this.renderObject(expr, exprTransformer);
        break;
      case "instanceof":
        rendered = this.renderInstanceof(expr, exprTransformer);
        break;
      case "spread_array":
        rendered = this.renderSpreadArray(expr, exprTransformer);
        break;
      case "paren":
        rendered = `(${this.render(expr.inner, exprTransformer)})`;
        break;
      case "binary":
        rendered = this.renderBinary(expr, exprTransformer, knownVariableTypes);
        break;
      case "unary":
        rendered = this.renderUnary(expr, exprTransformer);
        break;
      case "property-access":
        rendered = this.renderPropertyAccess(expr, exprTransformer, knownVariableTypes);
        break;
      case "callback":
        rendered = this.renderCallback(expr);
        break;
      case "lambda":
        rendered = this.renderLambda(expr, exprTransformer);
        break;
      case "method-call":
        rendered = this.renderMethodCall(expr, exprTransformer);
        break;
      case "call": {
        // Bare call expression: `Name(args)` with no receiver (e.g. a
        // constructor call `SafeInt(x)` written inline, or a free function).
        // Method-on-receiver calls lower as "method-call"; this arm is for the
        // receiverless form. The callee is escaped against C++ reserved names;
        // when a target type is in scope, renderValueForTarget (the caller)
        // wraps this with template args (SafeInt(x) -> SafeInt<int32_t>(x)).
        const callArgs = expr.args.map(a => this.render(a, exprTransformer)).join(", ");
        const callCallee = escapeCppKeyword(
          exprTransformer ? exprTransformer(expr.callee) : expr.callee,
          this.strategy.reservedNames(),
        );
        rendered = `${callCallee}(${callArgs})`;
        break;
      }
      case "element-access":
        rendered = this.renderElementAccess(expr, exprTransformer, knownVariableTypes);
        break;
      case "hal-expr": {
        const resolved = routeHALOp(expr.operation, this.strategy);
        // A method body's preceding side-effect ops (bus transactions, pin
        // configures) must run even in expression position — wrap them with
        // the value in a GCC statement-expression.
        const prefix = (expr.prefixOps ?? [])
          .map((op) => routeHALOp(op, this.strategy))
          .map((r) => r?.code ?? `/* unhandled hal-op prefix: dropped */`)
          .join(' ');
        if (resolved?.expression) {
          rendered = prefix
            ? `({ ${prefix} ${resolved.expression}; })`
            : resolved.expression;
        } else if (resolved?.code) {
          // Strip trailing semicolon and a leading `return ` for expression
          // context. HAL rawCpp definitions (e.g. Preferences.getString) bake
          // in `return X;` for statement context; in expression context the
          // `return` keyword is invalid (avr-g++: "expected primary-expression
          // before 'return'") and would leak as
          // `strcmp(return Preferences.getString(...), ...)`. Demo #33 Finding C.
          const asExpr = resolved.code.replace(/;\s*$/, "").replace(/^\s*return\s+/, "");
          rendered = prefix ? `({ ${prefix} ${asExpr}; })` : asExpr;
        } else {
          // Unregistered HAL op: surface as a warning so the user sees it, but
          // keep HAL as an extensibility point. The bare comment is retained
          // as a visual marker in the generated C++.
          this._diagnostics.push({
            severity: "warning",
            code: "TS2CPP_UNHANDLED_HAL",
            message: `HAL operation '${expr.operation.operation}' is not registered with the platform strategy; emitting a placeholder comment.`,
          });
          rendered = `/* unhandled hal-expr: ${expr.operation.operation} */`;
        }
        break;
      }
      default: {
        // An ExpressionIR kind the renderer doesn't know how to render is a
        // transpiler bug — the renderer should cover every kind the IR builders
        // produce. This arm is unreachable in the normal transpileFile path
        // (IR lowering marks unsupported expressions as errors and the build
        // aborts before emit). Throw so any path that does reach here fails
        // loudly instead of emitting "0 /* unsupported_expr */" into the C++.
        const kind = (expr as { kind?: string }).kind ?? "<unknown>";
        throw new Error(
          `ExpressionRenderer: unsupported ExpressionIR kind '${kind}' reached emission. ` +
            `This is a transpiler bug; the renderer is missing a case for this kind.`,
        );
      }
    }
    this.knownVariableTypes = prevKnownVariableTypes;
    return normalizeRawExpression(rendered, this.strategy, this.classNameMap);
  }

  private renderIdentifier(value: string, scopeKnownVariableTypes?: Map<string, KnownVariableInfo>): string {
    const nullVal = this.strategy.nullValue();
    // expression-to-ir lowers the TS `null` literal to the identifier sentinel
    // "nullptr" and `undefined` to "CUTTLEFISH_UNDEFINED". Both must route
    // through nullValue() so the platform's chosen null representation is used
    // — otherwise "nullptr" is mangled to "nullptr_" by escapeCppKeyword (since
    // nullptr is a C++ keyword) and emitted as an undefined token.
    if (nullVal && (value === "null" || value === "undefined" || value === "nullptr")) {
      return nullVal;
    }
    // Platform value/function-like macros (e.g. Arduino INPUT, OUTPUT, HIGH,
    // LOW) must pass through verbatim — escaping them to `OUTPUT_` would emit
    // an undefined symbol since the Arduino header defines them as macros.
    if (this.strategy.passthroughMacroNames().has(value)) {
      return value;
    }
    // Platform-reserved names (e.g. Arduino `Serial`, or the `min`/`max` math
    // macros) are globals/macros provided by the framework headers. Escaping
    // them would break references to those globals — UNLESS the name is a
    // user-declared variable/parameter that shadows and would collide. Check
    // both the instance field (globals/locals seen so far) AND the per-scope
    // map passed by the caller (function parameters, which live in the child
    // emission scope and aren't on the instance field). Declaration sites
    // already escape user vars (renderParameters → renderTypedName), so the
    // body references must escape to match.
    const reservedNames = this.strategy.reservedNames();
    if (reservedNames.has(value)) {
      const isUserVar = (this.knownVariableTypes !== undefined && this.knownVariableTypes.has(value)) ||
        (scopeKnownVariableTypes !== undefined && scopeKnownVariableTypes.has(value)) ||
        (this.pointerVarTypes !== undefined && this.pointerVarTypes.has(value)) ||
        (this.globalPointerVarTypes !== undefined && this.globalPointerVarTypes.has(value)) ||
        (this.stringVarNames !== undefined && this.stringVarNames.has(value));
      if (!isUserVar) {
        return value;
      }
    }
    return escapeCppKeyword(value, reservedNames);
  }

  private renderRaw(value: string, exprTransformer?: (expr: string) => string): string {
    const effectiveClassNameMap = this.classNameMap;
    let result = exprTransformer
      ? normalizeRawExpression(exprTransformer(value), this.strategy, effectiveClassNameMap)
      : normalizeRawExpression(value, this.strategy, effectiveClassNameMap);
    const cArrayNames = this.cArrayVarNames ?? new Set();
    result = result.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\.(?:length|size)(?:\(\))?/g, (match, varName) => {
      if (cArrayNames.has(varName)) return `(sizeof(${varName}) / sizeof(${varName}[0]))`;
      // Only C-string pointers require strlen(); std::string vars keep member-call syntax.
      const varInfo = this.knownVariableTypes?.get(varName);
      if (varInfo?.cppType === "const char*" || varInfo?.cppType === "char*") return `strlen(${varName})`;
      return match;
    });
    // Rewrite getter property access: s->reading → s->getReading()
    for (const [varName, accessors] of this.varAccessorNames) {
      for (const [propName, kind] of accessors) {
        if (kind === "getter" || kind === "both") {
          const getterName = accessorGetterName(propName);
          const pattern = new RegExp(`\\b${varName}->${propName}\\b(?!\\()`, "g");
          result = result.replace(pattern, `${varName}->${getterName}()`);
        }
      }
    }
    return result;
  }

  private renderTernary(expr: Extract<ExpressionIR, { kind: "ternary" }>, exprTransformer?: (expr: string) => string): string {
    return `(${this.render(expr.condition, exprTransformer)} ? ${this.render(expr.whenTrue, exprTransformer)} : ${this.render(expr.whenFalse, exprTransformer)})`;
  }

  private normalizeRecordType(cppType: string): string {
    // Strip const/pointer/reference qualifiers and unwrap smart-pointer
    // wrappers, returning the bare underlying type name. Used to look up
    // interface field types by struct name.
    let ir = parseCppType(cppType);
    if (ir.kind === "smartPointer") ir = ir.inner;
    return renderCppType(bareType(ir));
  }

  private inferExpressionCppType(expr: ExpressionIR, knownVariableTypes?: Map<string, KnownVariableInfo>): string | undefined {
    const effectiveKnownVariableTypes = knownVariableTypes ?? this.knownVariableTypes;
    switch (expr.kind) {
      case "string":
      case "string_concat":
      case "template_string":
        return "std::string";
      case "number":
        return expr.cppType ?? (Number.isInteger(expr.value) ? "int" : "double");
      case "boolean":
        return "bool";
      case "identifier": {
        const known = effectiveKnownVariableTypes?.get(expr.value)?.cppType;
        if (known) return known;
        // A bare identifier that resolves to a module-scope (file-global)
        // pointer variable — e.g. an ISR-captured `const btn = new Button()`
        // accessed inside a hoisted callback, where the local type map is
        // empty. Its C++ type is a pointer (e.g. `Button*`), so member access
        // must use `->`. Previously patched by the output-finalizer file-wide
        // text sweep; now resolved structurally here.
        const globalPtrType = this.globalPointerVarTypes?.get(expr.value);
        if (globalPtrType) return globalPtrType;
        if (this.stringVarNames?.has(expr.value)) return "std::string";
        return undefined;
      }
      case "await":
        return this.inferExpressionCppType(expr.value, knownVariableTypes);
      case "paren":
        return this.inferExpressionCppType(expr.inner, knownVariableTypes);
      case "ternary": {
        // A ternary of two string LITERALS renders as `(c ? "a" : "b")` — a
        // const char*, which has no .c_str() member. inferExpressionCppType
        // returns "std::string" for a `string` IR node, and the equality check
        // below would then short-circuit to "std::string", so the
        // concat/snprintf path wraps the ternary in an invalid `.c_str()`
        // (demo #34 Finding D). Guard the both-branches-are-string-literals
        // case FIRST. Only literal string operands are narrowed; a branch that
        // is a real std::string variable keeps the std::string widening.
        const bothStringLiterals = expr.whenTrue.kind === "string" && expr.whenFalse.kind === "string";
        if (bothStringLiterals) return "const char*";
        const whenTrue = this.inferExpressionCppType(expr.whenTrue, knownVariableTypes);
        const whenFalse = this.inferExpressionCppType(expr.whenFalse, knownVariableTypes);
        if (whenTrue && whenFalse && whenTrue === whenFalse) return whenTrue;
        if (this.strategy.isStringLikeType(whenTrue ?? "") || this.strategy.isStringLikeType(whenFalse ?? "")) return "std::string";
        if (whenTrue === "double" || whenTrue === "float" || whenFalse === "double" || whenFalse === "float") return "double";
        return whenTrue ?? whenFalse;
      }
      case "property-access": {
        // String enum member access (e.g. Color.Red) resolves to a const char*,
        // because string enums are lowered to namespaces of constexpr const char*.
        if ((expr.isEnum || (expr.object.kind === "identifier" && this.stringEnumNames.has(expr.object.value)))
            && expr.object.kind === "identifier"
            && this.stringEnumNames.has(expr.object.value)) {
          return "const char*";
        }
        // Numeric enum member access (e.g. Cell.Dead) resolves to the enum
        // type itself, so a wrapping expression (ternary, paren, call result)
        // whose branches are enum members infers to the enum and the
        // enum↔integral storage boundary can fire. Without this, `Cell.Dead`
        // inferred to `undefined` (Cell is an enum name, not a variable, so
        // neither the known-variable map nor interface-field map hit), and a
        // ternary `(c ? Cell.Dead : Cell.Alive)` stored into `uint8_t`
        // storage missed the boundary cast. Demo #32 Finding A.
        if (
          expr.object.kind === "identifier"
          && this.enumNames.has(expr.object.value)
          && !this.stringEnumNames.has(expr.object.value)
        ) {
          return expr.object.value;
        }
        if (expr.property === "length" || expr.property === "size") return "int";
        if (expr.object.kind === "raw" && expr.object.value === "this") {
          return effectiveKnownVariableTypes?.get(expr.property)?.cppType;
        }
        const objectType = this.inferExpressionCppType(expr.object, knownVariableTypes);
        if (!objectType) return undefined;
        return this.interfaceFieldTypes.get(this.normalizeRecordType(objectType))?.get(expr.property);
      }
      case "element-access": {
        if (expr.elementType && expr.elementType !== "auto") return expr.elementType;
        const objectType = this.inferExpressionCppType(expr.object, knownVariableTypes);
        if (!objectType) return undefined;
        // Element type of vector/staticArray/cArray, detected structurally.
        // The bare StaticArray<T,N> spelling (without __tc_ prefix) also flows
        // through here as a named template; elementOf doesn't cover it, so
        // fall back to rendering the first arg.
        const objIr = parseCppType(objectType);
        if (objIr.kind === "named" && objIr.name === "StaticArray" && objIr.args?.[0]) {
          return renderCppType(objIr.args[0]);
        }
        const elemIr = objIr.kind === "vector" || objIr.kind === "staticArray" || objIr.kind === "cArray"
          ? objIr.element
          : undefined;
        return elemIr ? renderCppType(elemIr) : undefined;
      }
      case "array":
        return `std::vector<${expr.elementType}>`;
      case "method-call": {
        const helper = expr.callee.match(/^__tc_(?:toUpperCase|toLowerCase|trim|replace|charAt|substring|slice|padStart|padEnd|repeat|jsonStringify)\b/);
        if (helper) return "std::string";
        if (/^__tc_(?:startsWith|endsWith|includes)\b/.test(expr.callee)) return "bool";
        if (/^__tc_(?:charCodeAt|indexOf|lastIndexOf)\b/.test(expr.callee)) return "int";
        if (expr.cppType) return expr.cppType;
        // Look up the method's return type. The callee text may be a full
        // receiver chain (`this->methodName`, `obj->methodName`), so strip
        // any `->` / `.` prefix to get the bare method name, which is how
        // class method return types are registered in setup.ts.
        const bareName = expr.callee.replace(/^.*->|^.*\./, "");
        return this.knownFunctionReturnTypes?.get(expr.callee)
          ?? this.knownFunctionReturnTypes?.get(bareName);
      }
      case "raw": {
        if (/^std::string\(/.test(expr.value) || /^__tc_(?:toUpperCase|toLowerCase|trim|replace|charAt|substring|slice|padStart|padEnd|repeat|jsonStringify)\b/.test(expr.value)) {
          return "std::string";
        }
        if (/^__tc_(?:startsWith|endsWith|includes)\b/.test(expr.value)) return "bool";
        if (/^__tc_(?:charCodeAt|indexOf|lastIndexOf)\b/.test(expr.value)) return "int";
        if (/^std::(floor|ceil|round|abs|sqrt|sin|cos|tan|atan2|log|exp|pow|fmod)\b/.test(expr.value)) {
          return "double";
        }
        const callMatch = expr.value.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
        return callMatch ? this.knownFunctionReturnTypes?.get(callMatch[1]) : undefined;
      }
      case "binary": {
        const booleanOperators = new Set(["==", "===", "!=", "!==", "<", "<=", ">", ">=", "&&", "||"]);
        if (booleanOperators.has(expr.operator)) return "bool";
        const leftType = this.inferExpressionCppType(expr.left, knownVariableTypes);
        const rightType = this.inferExpressionCppType(expr.right, knownVariableTypes);
        if (expr.operator === "+" && (this.isStringLikeCppType(leftType) || this.isStringLikeCppType(rightType))) {
          return "std::string";
        }
        if (leftType === "double" || leftType === "float" || rightType === "double" || rightType === "float") return "double";
        return leftType ?? rightType;
      }
      case "unary":
        return expr.operator === "!" ? "bool" : this.inferExpressionCppType(expr.operand, knownVariableTypes);
      case "hal-expr":
        return cppTypeForHalOp(expr.operation.operation);
      default:
        return undefined;
    }
  }

  /**
   * True when a C++ type name denotes a string value: either the strategy's
   * built-in string-like types (std::string, const char*, Arduino String, …)
   * OR a TypeScript string-enum name, which is lowered to `const char*`.
   */
  private isStringLikeCppType(cppType: string | undefined): boolean {
    return !!cppType && (this.strategy.isStringLikeType(cppType) || this.stringEnumNames.has(cppType));
  }

  private shouldSkipStringWrap(expr: ExpressionIR, knownVariableTypes?: Map<string, KnownVariableInfo>): boolean {
    const cppType = this.inferExpressionCppType(expr, knownVariableTypes);
    return this.isStringLikeCppType(cppType);
  }

  /**
   * Resolve an expression to its C++ type when possible (consulting
   * `knownVariableTypes`, interface/class field type maps, enum/string-enum
   * sets, etc.). Returns `undefined` when the type cannot be determined.
   *
   * Public so emit-layer callers (e.g. the switch emitter in line-appender)
   * can make type-aware lowering decisions — see demo #16 gap #1: a `switch`
   * on a struct field of enum type must not be wrapped in `std::string(...)`.
   */
  inferCppType(expr: ExpressionIR, knownVariableTypes?: Map<string, KnownVariableInfo>): string | undefined {
    return this.inferExpressionCppType(expr, knownVariableTypes);
  }

  private renderKnownStringValue(rendered: string, cppType: string): string {
    const normalized = this.strategy.normalizeCppType(cppType);
    if (!this.strategy.useSnprintfForStrings() && (normalized === "const char*" || normalized === "char*")) {
      return `std::string(${rendered})`;
    }
    return rendered;
  }

  private renderStringConcat(expr: Extract<ExpressionIR, { kind: "string_concat" }>, exprTransformer?: (expr: string) => string, knownVariableTypes?: Map<string, KnownVariableInfo>): string {
    // When snprintf mode is active, build snprintf buffer instead of String() concatenation
    if (this.strategy.useSnprintfForStrings()) {
      const snprintfResult = this.buildSnprintfFromParts(expr.parts, exprTransformer, knownVariableTypes);
      if (snprintfResult) {
        return snprintfResult;
      }
    }
    // Fallback: Build a String concatenation chain
    const renderedParts = expr.parts.map(part => {
      if (part.kind === "boolean") {
        return `std::string(${part.value ? '"true"' : '"false"'})`;
      }
      const rendered = this.render(part, exprTransformer, knownVariableTypes);
      if (part.kind === "string") {
        return rendered;
      }
      if (part.kind === "template_string") {
        return rendered;
      }
      if (this.shouldSkipStringWrap(part, knownVariableTypes)) {
        return rendered;
      }
      if (part.kind === "identifier") {
        const effectiveKnownVariableTypes = knownVariableTypes ?? this.knownVariableTypes;
        const varInfo = effectiveKnownVariableTypes?.get(part.value);
        if (varInfo?.cppType === "bool") {
          return `(${part.value} ? "true" : "false")`;
        }
      }
      // Doubles/floats need JS-compatible formatting; std::to_string appends trailing zeros (3.000000).
      const partType = this.inferExpressionCppType(part, knownVariableTypes);
      if (partType === "double" || partType === "float") {
        const bufferName = `__cuttlefish_str_${++this._snprintfCounter.value}`;
        this._preludeLines.push(
          `char ${bufferName}[32];`,
          `snprintf(${bufferName}, sizeof(${bufferName}), "%.15g", ${rendered});`,
        );
        return `std::string(${bufferName})`;
      }
      return this.strategy.wrapStringObject(rendered);
    });
    return renderedParts.join(" + ");
  }

  private renderTemplateString(expr: Extract<ExpressionIR, { kind: "template_string" }>, exprTransformer?: (expr: string) => string, knownVariableTypes?: Map<string, KnownVariableInfo>): string {
    // When snprintf mode is active, build snprintf buffer for single interpolation
    if (this.strategy.useSnprintfForStrings()) {
      const argInfo = this.inferFormatSpecifier(expr.expression, exprTransformer, knownVariableTypes);
      if (argInfo) {
        if (argInfo.preludeLines) {
          this._preludeLines.push(...argInfo.preludeLines);
        }
        const bufferName = `__cuttlefish_str_${++this._snprintfCounter.value}`;
        const estimatedLength = Math.max(argInfo.estimatedLength + 1, 16);
        this._preludeLines.push(
          `char ${bufferName}[${estimatedLength}];`,
          `snprintf(${bufferName}, sizeof(${bufferName}), "${argInfo.format}", ${argInfo.arg});`,
        );
        return bufferName;
      }
    }
    const inferredType = this.inferExpressionCppType(expr.expression, knownVariableTypes);
    const rendered = this.render(expr.expression, exprTransformer, knownVariableTypes);
    if (this.isStringLikeCppType(inferredType)) {
      return this.renderKnownStringValue(rendered, inferredType ?? "");
    }
    if (expr.expression.kind === "boolean") {
      return `std::string(${expr.expression.value ? '"true"' : '"false"'})`;
    }
    if (inferredType === "bool") {
      return `std::string(${rendered} ? "true" : "false")`;
    }
    if (inferredType === "double" || inferredType === "float") {
      const bufferName = `__cuttlefish_str_${++this._snprintfCounter.value}`;
      this._preludeLines.push(
        `char ${bufferName}[32];`,
        `snprintf(${bufferName}, sizeof(${bufferName}), "%.15g", ${rendered});`,
      );
      return `std::string(${bufferName})`;
    }
    return this.strategy.wrapStringObject(rendered);
  }

  /**
   * Build snprintf format string and args from string_concat parts.
   * Returns the buffer name on success, or undefined if snprintf can't handle it.
   */
  private buildSnprintfFromParts(
    parts: ExpressionIR[],
    exprTransformer?: (expr: string) => string,
    knownVariableTypes?: Map<string, KnownVariableInfo>,
  ): string | undefined {
    let formatString = "";
    const args: string[] = [];
    let estimatedLength = 1;

    for (const part of parts) {
      if (part.kind === "string") {
        // Escape literal text for the snprintf format string. Backslash/quote
        // escapes are for the C string literal; the % → %% escape is for
        // snprintf itself, since a bare % in the format string starts a
        // conversion specifier (e.g. `hp=${x}%` would otherwise emit
        // "hp=%.15g%" — a dangling conversion). MUST run before the other
        // escapes so the doubled %% isn't itself touched.
        formatString += part.value.replace(/%/g, "%%").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
        estimatedLength += part.value.length;
        continue;
      }

      const argInfo = this.inferFormatSpecifier(part, exprTransformer, knownVariableTypes);
      if (argInfo) {
        if (argInfo.preludeLines) {
          this._preludeLines.push(...argInfo.preludeLines);
        }
        formatString += argInfo.format;
        args.push(argInfo.arg);
        estimatedLength += argInfo.estimatedLength;
        continue;
      }

      // Can't handle other part types with snprintf
      return undefined;
    }

    const bufferName = `__cuttlefish_str_${++this._snprintfCounter.value}`;
    estimatedLength = Math.max(estimatedLength, 16);
    this._preludeLines.push(
      `char ${bufferName}[${estimatedLength}];`,
      `snprintf(${bufferName}, sizeof(${bufferName}), "${formatString}"${args.length > 0 ? `, ${args.join(", ")}` : ""});`,
    );
    return bufferName;
  }

  /**
   * Infer printf format specifier for an expression.
   * Returns format string, rendered arg, estimated length, and optional prelude lines, or undefined if unknown.
   */
  public inferFormatSpecifier(
    expr: ExpressionIR,
    exprTransformer?: (expr: string) => string,
    knownVariableTypes?: Map<string, KnownVariableInfo>,
  ): { format: string; arg: string; estimatedLength: number; preludeLines?: string[] } | undefined {
    const effectiveKnownVariableTypes = knownVariableTypes ?? this.knownVariableTypes;
    if (expr.kind === "template_string") {
      return this.inferFormatSpecifier(expr.expression, exprTransformer, knownVariableTypes);
    }
    // Namespace-const access (`Ns.MEMBER`) lowers to a `property-access` IR
    // node whose `property` is the member name. Resolve the member's type from
    // knownVariableTypes (namespace consts are registered there by bare name
    // in setup.ts) so a namespace `const string` operand formats as %s with
    // .c_str(), not the %d default (namespace stress test Finding 3b).
    if (expr.kind === "property-access") {
      const memberType = effectiveKnownVariableTypes?.get(expr.property);
      if (memberType) {
        const rendered = this.render(expr, exprTransformer, knownVariableTypes);
        if (this.isStringLikeCppType(memberType.cppType)) {
          const normalized = this.strategy.normalizeCppType(memberType.cppType);
          const needsCStr = needsCStrForStringLike(normalized);
          return { format: "%s", arg: needsCStr ? `${rendered}.c_str()` : rendered, estimatedLength: 128 };
        }
        if (memberType.cppType === "bool") {
          return { format: "%s", arg: `(${rendered} ? "true" : "false")`, estimatedLength: 5 };
        }
      }
    }
    if (expr.kind !== "number" && expr.kind !== "boolean" && expr.kind !== "string") {
      const inferredType = this.inferExpressionCppType(expr, knownVariableTypes);
      if (inferredType) {
        const rendered = this.render(expr, exprTransformer, knownVariableTypes);
        const normalized = this.strategy.normalizeCppType(inferredType);
        if (this.isStringLikeCppType(inferredType)) {
          // .c_str() is needed for std::string-like types (which own a buffer)
          // but NOT for const char* / char* (already C-strings). Detect via the
          // structured IR: string/strPtr/string-enum need it; char pointers don't.
          const needsCStr = needsCStrForStringLike(normalized);
          // std::string operands can be arbitrarily long (a method like
          // statusLine() may return a 100+ char string), so budget a generous
          // estimate. The previous value (32) truncated output whenever a
          // string-returning method was interpolated into a concat.
          return { format: "%s", arg: needsCStr ? `${rendered}.c_str()` : rendered, estimatedLength: 128 };
        }
        if (normalized === "bool") {
          return { format: "%s", arg: `(${rendered} ? "true" : "false")`, estimatedLength: 5 };
        }
        if (normalized === "float" || normalized === "double") {
          const knownPrecision = expr.kind === "identifier"
            ? effectiveKnownVariableTypes?.get(expr.value)?.floatPrecision
            : undefined;
          const floatArg = this.strategy.floatToSnprintfArg?.(rendered, knownPrecision, ++this._snprintfCounter.value);
          if (floatArg !== undefined) return floatArg;
          // Use %.15g (not %g) so large integer-valued doubles don't collapse
          // to scientific notation — matches JS Number.toString() more closely.
          return { format: knownPrecision !== undefined ? `%.${knownPrecision}f` : "%.15g", arg: rendered, estimatedLength: 16 };
        }
        // Enum-typed value (struct field, variable, etc. whose type resolves
        // to a known numeric enum name). C++ enum class values need
        // static_cast<int>(...) for %d — without it, -Wformat= warns that
        // the argument type (enum) doesn't match %d (int).
        if (this.enumNames.has(normalized) && !this.stringEnumNames.has(normalized)) {
          return { format: "%d", arg: `static_cast<int>(${rendered})`, estimatedLength: 12 };
        }
        if (/^(?:unsigned\s+)?(?:char|short|int|long|long long)$/.test(normalized) || /^(?:u?int(?:8|16|32|64)_t|size_t)$/.test(normalized)) {
          if (normalized.includes("long long") || /64_t$/.test(normalized)) {
            return { format: "%lld", arg: rendered, estimatedLength: 20 };
          }
          // `long` is its own C++ type and matches %ld regardless of width.
          // int32_t/uint32_t are typedefs for int/unsigned int on every target
          // cuttlefish supports (AVR/ARM), so they must use %d/%u — using %ld
          // triggers -Wformat= ("expects long int, has int").
          if (normalized.includes("long")) {
            return { format: normalized.startsWith("unsigned") ? "%lu" : "%ld", arg: rendered, estimatedLength: 12 };
          }
          // 32_t/16_t/8_t and bare int/short/char. These are `int`-sized or
          // narrower; unsigned variants are `unsigned int`-sized → %u. size_t
          // is platform-dependent but unsigned int on the targets here → %u.
          if (/^size_t$/.test(normalized) || normalized.startsWith("uint") || normalized.startsWith("unsigned")) {
            return { format: "%u", arg: rendered, estimatedLength: 12 };
          }
          return { format: "%d", arg: rendered, estimatedLength: 12 };
        }
      }
    }
    switch (expr.kind) {
      case "number": {
        if (expr.cppType === "float" || !Number.isInteger(expr.value)) {
          const str = `${expr.value}`;
          const rendered = str.includes('.') || str.includes('e') || str.includes('E')
            ? `${str}f`
            : `${str}.0f`;
          return { format: "%.15g", arg: rendered, estimatedLength: 16 };
        }
        return { format: "%d", arg: `${expr.value}`, estimatedLength: 12 };
      }
      case "boolean":
        return { format: "%s", arg: expr.value ? '"true"' : '"false"', estimatedLength: 5 };
      case "string":
        // Route through the shared `escapeCppStringLiteral` (handles `\`, `"`,
        // `\n`, `\r`, `\t`) so a string-literal template/concat part carrying a
        // control char renders as the escape sequence, not a raw char inside the
        // C++ string literal. Demo #29 Finding A sibling — this path was reached
        // by a standalone `${'x\ny'}` template part: the partial escape here
        // (only `\` and `"`) emitted a raw newline → an unterminated C++ literal.
        return { format: "%s", arg: `"${escapeCppStringLiteral(expr.value)}"`, estimatedLength: Math.max(expr.value.length, 1) };
      case "identifier": {
        const knownVar = effectiveKnownVariableTypes?.get(expr.value);
        const cppType = knownVar?.cppType ?? this.knownFunctionReturnTypes?.get(expr.value);

        if (this.isStringLikeCppType(cppType)) {
          const normalized = this.strategy.normalizeCppType(cppType ?? "");
          const arg = normalized === "__tc_str_ptr" ? `${expr.value}.c_str()` : expr.value;
          return { format: "%s", arg, estimatedLength: 128 };
        }
        if (cppType === "bool") {
          return { format: "%s", arg: `(${expr.value} ? "true" : "false")`, estimatedLength: 5 };
        }
        if (cppType === "float" || cppType === "double") {
          const floatArg = this.strategy.floatToSnprintfArg?.(expr.value, knownVar?.floatPrecision, ++this._snprintfCounter.value);
          if (floatArg !== undefined) return floatArg;
          return { format: knownVar?.floatPrecision !== undefined ? `%.${knownVar.floatPrecision}f` : "%.15g", arg: expr.value, estimatedLength: 16 };
        }
        if (cppType === "int" || cppType === "short" || cppType === "int16_t" || cppType === "uint16_t" || cppType === "int32_t") {
          return { format: "%d", arg: expr.value, estimatedLength: 12 };
        }
        if (cppType === "uint32_t") {
          return { format: "%u", arg: expr.value, estimatedLength: 12 };
        }
        // auto-deduced local: infer the real type from the retained initializer
        // before falling back. Treating `auto` as `%ld` is wrong for locals
        // deduced from a string/enum/float expression (e.g.
        // `const name = loot.name` → std::string). Re-dispatch through the
        // general inference path so the proper specifier is chosen.
        if (cppType === "auto" && knownVar?.initializer) {
          const inferredFromInit = this.inferFormatSpecifier(knownVar.initializer, exprTransformer, knownVariableTypes);
          if (inferredFromInit) {
            // Replace the placeholder arg with the local variable name, since
            // the initializer's rendered form would re-evaluate side effects.
            return { ...inferredFromInit, arg: expr.value };
          }
        }
        if (cppType === "long") {
          return { format: "%ld", arg: expr.value, estimatedLength: 12 };
        }
        if (cppType === "unsigned long") {
          return { format: "%lu", arg: expr.value, estimatedLength: 12 };
        }
        if (cppType === "long long" || cppType === "unsigned long long" || cppType === "int64_t" || cppType === "uint64_t") {
          return { format: "%lld", arg: expr.value, estimatedLength: 20 };
        }
        if (this.stringVarNames?.has(expr.value)) {
          return { format: "%s", arg: expr.value, estimatedLength: 32 };
        }
        // Numeric enum-typed variable: static_cast<int> for snprintf (%d).
        // String enums are const char* (handled by isStringLikeType above).
        if (cppType && this.enumNames.has(cppType) && !this.stringEnumNames.has(cppType)) {
          return { format: "%d", arg: `static_cast<int>(${expr.value})`, estimatedLength: 12 };
        }
        // Default to %d for integers and unknowns
        return { format: "%d", arg: expr.value, estimatedLength: 12 };
      }
      case "hal-expr": {
        const rendered = this.render(expr, exprTransformer);
        if (rendered.startsWith('"') || this.stringVarNames?.has(rendered)) {
          return { format: "%s", arg: rendered, estimatedLength: 32 };
        }
        const cppType = cppTypeForHalOp(expr.operation.operation);
        if (cppType && this.isStringLikeCppType(cppType)) {
          return { format: "%s", arg: rendered, estimatedLength: 32 };
        }
        if (cppType === "bool") {
          return { format: "%s", arg: `(${rendered} ? "true" : "false")`, estimatedLength: 5 };
        }
        return { format: "%d", arg: rendered, estimatedLength: 12 };
      }
      case "method-call":
      case "property-access":
      case "binary":
      case "unary":
      case "ternary":
      case "raw": {
        const rendered = this.render(expr, exprTransformer);
        // String-returning helpers (__tc_toUpperCase, etc.) use %s.
        // On hosted targets these return std::string, so snprintf needs
        // .c_str(). On targets WITHOUT std::string (e.g. Arduino AVR) the
        // helpers already return const char*, so .c_str() would be a redundant
        // member access on a non-class type (avr-g++: "request for member
        // 'c_str' in '__tc_trim(...)', which is of non-class type 'const
        // char*'"). Demo #35 Finding A.
        if (/^__tc_(toUpperCase|toLowerCase|trim|replace|charAt|substring|slice|padStart|padEnd|repeat|jsonStringify)\b/.test(rendered)) {
          const needsCStr = this.strategy.needsStdString();
          return { format: "%s", arg: needsCStr ? `${rendered}.c_str()` : rendered, estimatedLength: 32 };
        }
        // Check if it's a property access on a string (e.g. s.length)
        if (expr.kind === "property-access" && (expr.property === "length" || expr.property === "size")) {
          // Demo #30 Finding B — `.length`/`.size` now ALWAYS render as
          // `static_cast<long long>(...)` (the array/vector `.size()` path was
          // already cast; the std::string `.length()` path was cast in the same
          // demo so the two are uniform). The rendered arg is therefore a
          // signed `long long`, so the format specifier MUST be `%lld`. The
          // previous hardcoded `%d` mismatched the unsigned `size_type` returned
          // by `std::string::length()`, triggering g++ -Wformat=
          // ("expects int, has size_type").
          return { format: "%lld", arg: rendered, estimatedLength: 20 };
        }
        // Demo #30 Finding B (raw-node sibling) — `.length`/`.size` on an
        // array/vector/string receiver lowers to a `raw` IR node whose text is
        // `static_cast<long long>(x.size())` / `static_cast<long long>(s.length())`
        // (the lowering in resolveLengthProperty casts to long long). That raw
        // text is a signed `long long`, so the snprintf specifier must be `%lld`
        // — the previous fall-through to the `%d` default mismatched the cast
        // type and tripped g++ -Wformat=. This catches the lowered form; the
        // `property-access` branch above catches the (rare) un-lowered form.
        if (expr.kind === "raw" && /^static_cast<long long>\(.*\.(?:size|length)\(\)\)$/.test(rendered)) {
          return { format: "%lld", arg: rendered, estimatedLength: 20 };
        }
        // String enum member access → const char* → %s with c_str() for snprintf.
        if (expr.kind === "property-access" && expr.object.kind === "identifier"
            && this.stringEnumNames.has(expr.object.value)) {
          return { format: "%s", arg: `${rendered}.c_str()`, estimatedLength: 32 };
        }
        // Numeric enum member access → static_cast<int> for %d.
        if (expr.kind === "property-access" && expr.object.kind === "identifier"
            && this.enumNames.has(expr.object.value) && !this.stringEnumNames.has(expr.object.value)) {
          return { format: "%d", arg: `static_cast<int>(${rendered})`, estimatedLength: 12 };
        }
        // Fallback for expressions that render as string-like pointers
        if (this.stringVarNames?.has(rendered)) {
          return { format: "%s", arg: rendered, estimatedLength: 32 };
        }
        // Default to %d for other complex expressions (mostly numeric)
        return { format: "%d", arg: rendered, estimatedLength: 12 };
      }
      default:
        return undefined;
    }
  }

  private renderArray(expr: Extract<ExpressionIR, { kind: "array" }>, exprTransformer?: (expr: string) => string): string {
    const elements = expr.elements.map((e) => this.render(e, exprTransformer)).join(", ");
    return `{ ${elements} }`;
  }

  private renderObject(expr: Extract<ExpressionIR, { kind: "object" }>, exprTransformer?: (expr: string) => string): string {
    const fields = expr.fields.map((f) => `${this.render(f.value, exprTransformer)}`).join(", ");
    return `{ ${fields} }`;
  }

  private renderSpreadArray(expr: Extract<ExpressionIR, { kind: "spread_array" }>, exprTransformer?: (expr: string) => string): string {
    const spreadText = this.render(expr.spreadExpr, exprTransformer);
    const elementType = expr.elementType === "auto" ? "auto" : expr.elementType;
    const extras = expr.additionalElements.map(e => this.render(e, exprTransformer)).join(", ");
    if (extras.length === 0) return spreadText;
    const combined = [spreadText, extras].join(", ");
    return `std::vector<${elementType}>({ ${combined} })`;
  }

  private renderInstanceof(expr: Extract<ExpressionIR, { kind: "instanceof" }>, exprTransformer?: (expr: string) => string): string {
    return `(typeid(*${this.render(expr.object, exprTransformer)}) == typeid(${expr.className}))`;
  }

  private renderElementAccess(expr: Extract<ExpressionIR, { kind: "element-access" }>, exprTransformer?: (expr: string) => string, knownVariableTypes?: Map<string, KnownVariableInfo>): string {
    const objectText = this.render(expr.object, exprTransformer);
    // An enum-typed index (e.g. `GLYPHS[op]` where `op: Op`, a `const enum`)
    // must be cast to an integral type — a C++ `enum class` does not
    // implicitly convert to `size_t`, so `vector[enumValue]` fails to compile.
    // `renderEnumSafeValue` already wraps numeric-enum operands in
    // `static_cast<int>(...)`; route the index through it
    // (with the in-scope variable types so a bare enum-typed identifier
    // resolves) so enum indices lower correctly. Non-enum indices are passed
    // through unchanged. Demo #28 Finding E.
    const indexText = this.renderEnumSafeValue(expr.index, knownVariableTypes);
    return `${objectText}[${indexText}]`;
  }

  private isEnumComparisonOperand(expr: ExpressionIR, inferredType: string | undefined): boolean {
    if (inferredType && this.enumNames.has(inferredType)) return true;
    // Property/element access on an enum name (e.g. Color::Green) is also enum-valued.
    if (expr.kind === "property-access" && expr.object.kind === "identifier" && this.enumNames.has(expr.object.value)) return true;
    return false;
  }

  /**
   * Render an expression value that will be assigned to a non-enum lvalue,
   * passed as a non-enum argument, or otherwise consumed where C++ `enum class`
   * won't implicitly convert. If the value is a numeric-enum operand, wrap it
   * in `static_cast<int>(...)` so it composes with int-typed targets (e.g.
   * `links[0] = LinkFlag.Wired` → `links[0] = static_cast<int>(LinkFlag::Wired)`).
   * String-enum operands are passed through unchanged (they're `const char*`).
   *
   * This is the assignment/argument-site counterpart to the operator-level
   * enum wrapping in renderBinary. Enum values used as integers need an
   * explicit cast in C++.
   */
  public renderEnumSafeValue(expr: ExpressionIR, knownVariableTypes?: Map<string, KnownVariableInfo>): string {
    const rendered = this.render(expr, undefined, knownVariableTypes);
    const inferredType = this.inferExpressionCppType(expr, knownVariableTypes);
    if (
      !this.isStringEnumOperand(expr, inferredType) &&
      this.isEnumComparisonOperand(expr, inferredType)
    ) {
      const enumName = this.getNumericEnumOperandName(expr, inferredType);
      const castType = enumName
        ? (this.strategy.enumCastType(enumName) ?? (this.largeEnumNames.has(enumName) ? "long" : "int"))
        : "int";
      if (/^static_cast<[^>]+>\(/.test(rendered)) {
        return rendered;
      }
      return `static_cast<${castType}>(${rendered})`;
    }
    return rendered;
  }

  /**
   * Render a value that will be stored into an lvalue of a known C++ type
   * (an `assign` target, a `var_decl` initializer, a `push_back` argument,
   * ...). Centralizes the **enum ↔ integral storage boundary** so every
   * assignment/initialization site lowers consistently:
   *
   *   - target is a numeric C++ type, value is a numeric-enum operand →
   *     `static_cast<int>(value)` (enum → int). This is the existing
   *     `renderEnumSafeValue` direction, now driven by the target type
   *     instead of duplicated per site.
   *   - target is a C++ `enum class`, value is a numeric/element-access
   *     operand → `static_cast<EnumType>(value)` (int → enum). C++ `enum
   *     class` does not implicitly convert FROM an integral storage type
   *     either, so reading an `int`/`uint8_t` cell back into an enum-typed
   *     local needs the reverse cast.
   *
   * This closes the "enum↔integral storage boundary" family — the previous
   * point-specific casts handled enum-as-array-index (demo #28 E) and
   * enum-as-Map-key (demo #28 E review) but NOT enum stored into integral
   * storage, integral storage read back into an enum, or an enum value
   * passed to `push_back` on an integral-element vector. Demo #32 Finding A.
   *
   * String enums (`const char*`) and string-like targets are passed through
   * unchanged. Unknown/auto target types are passed through unchanged
   * (safer than a wrong cast).
   */
  public renderValueForTarget(
    expr: ExpressionIR,
    targetType: string | undefined,
    knownVariableTypes?: Map<string, KnownVariableInfo>,
    exprTransformer?: (expr: string) => string,
  ): string {
    if (!targetType) return this.render(expr, exprTransformer, knownVariableTypes);
    const normalizedTarget = targetType.trim();

    // Inject template args for constructor calls on pre-C++17 toolchains
    // (e.g. AVR without CTAD). SafeVariable(0) → SafeVariable<int32_t>(0).
    // Handles both `method-call` (when the constructor appears as a standalone
    // initializer) and `call` (when it appears on the RHS of an assignment,
    // which lowers as `T x = {}; x = T(args);`). The callee must match the
    // template name and the target must be a `Name<...>` instantiation, so a
    // regular function call assigned to a non-templated type never matches.
    const tmplMatch = normalizedTarget.match(/^([A-Za-z_]\w*)<(.+)>/);
    const exprAny = expr as { kind?: string; callee?: string; args?: ExpressionIR[] };
    const isCtorCall = tmplMatch != null
      && (exprAny.kind === "method-call" || exprAny.kind === "call")
      && exprAny.callee === tmplMatch[1]
      && exprAny.callee != null && !exprAny.callee.includes("<");
    if (isCtorCall && exprAny.args) {
      const argsText = exprAny.args.map(a => this.render(a, exprTransformer, knownVariableTypes)).join(", ");
      return `${tmplMatch[1]}<${tmplMatch[2]}>(${argsText})`;
    }

    const rendered = this.render(expr, exprTransformer, knownVariableTypes);
    // Never cast into string-like storage — enums that lower to const char*
    // (string enums) already match, and a string target is never an enum boundary.
    if (this.isStringLikeCppType(normalizedTarget)) return rendered;

    const valueIsEnum = !this.isStringEnumOperand(expr, undefined)
      && this.isEnumComparisonOperand(expr, this.inferExpressionCppType(expr, knownVariableTypes));
    const targetIsEnum = this.enumNames.has(normalizedTarget) && !this.stringEnumNames.has(normalizedTarget);
    const targetIsIntegral = INTEGRAL_CPP_TYPE_RE.test(normalizedTarget);

    // enum value → integral storage: cast the value to int.
    if (targetIsIntegral && valueIsEnum && !/^static_cast<[^>]+>\(/.test(rendered)) {
      return this.renderEnumSafeValue(expr, knownVariableTypes);
    }
    // integral value → enum storage: cast the value to the enum type.
    if (targetIsEnum && !valueIsEnum) {
      const valueType = this.inferExpressionCppType(expr, knownVariableTypes);
      const valueIsIntegral = valueType !== undefined && INTEGRAL_CPP_TYPE_RE.test(valueType);
      if (valueIsIntegral && !/^static_cast<[^>]+>\(/.test(rendered)) {
        return `static_cast<${normalizedTarget}>(${rendered})`;
      }
    }
    return rendered;
  }

  /**
   * Resolve a rendered C++ lvalue STRING (the `target` carried by an `assign`
   * IR node, e.g. `this->nxt[r][c]`, `cells[i]`, `flag`) to its declared C++
   * element/value type. This is the string-target counterpart to
   * `inferExpressionCppType`'s element-access / property-access / identifier
   * branches: the assign target is already rendered to text at IR-build time,
   * so the emit layer must recover its type from the text + the shared type
   * maps (the same maps `inferExpressionCppType` consults).
   *
   * Structural, not regex-rewrite: it splits the base from trailing `[...]`
   * subscripts, resolves the base via the class-field / local / global-pointer
   * maps, then unwraps one `std::vector<T>` / `StaticArray<T,N>` layer per
   * subscript. Returns `undefined` when the type can't be resolved confidently
   * — callers fall through to plain rendering (never an incorrect cast).
   * Demo #32 Finding A.
   */
  public inferLvalueCppType(
    target: string,
    knownVariableTypes?: Map<string, KnownVariableInfo>,
  ): string | undefined {
    let depth = 0;
    let base = target.trim();
    // Strip trailing `[...]` subscripts (balanced: a subscript body holds no
    // nested brackets in practice because element-access lowers one level at a
    // time; a `this->m[a[b]]` would render `this->m[a[b]]` whose outermost
    // `[a[b]]` we still strip correctly via the greedy-non-bracket regex below
    // — the inner `[b]` is left on `a` and resolved as a separate base, which
    // is fine because we only need the OUTER element type here).
    while (/\[[^\[\]]*\]\s*$/.test(base)) {
      base = base.replace(/\[[^\[\]]*\]\s*$/, "").trim();
      depth++;
    }
    const baseType = this.resolveLvalueBaseType(base, knownVariableTypes);
    if (!baseType) return undefined;
    if (depth === 0) return baseType;
    // Unwrap `depth` layers of std::vector<T> / StaticArray<T,N>.
    let inner = baseType;
    for (let i = 0; i < depth; i++) {
      const parsed = parseCppType(inner);
      if (parsed.kind === "vector" || parsed.kind === "staticArray" || parsed.kind === "cArray") {
        inner = renderCppType(parsed.element);
      } else if (parsed.kind === "named" && parsed.name === "StaticArray" && parsed.args?.[0]) {
        inner = renderCppType(parsed.args[0]);
      } else {
        return undefined;
      }
    }
    return inner;
  }

  /**
   * Resolve a subscript-free rendered base (`this->field`, `obj->field`,
   * `obj.field`, or a bare local name) to its declared C++ type. The string
   * counterpart of `inferExpressionCppType`'s identifier / property-access
   * branches. Demo #32 Finding A.
   */
  private resolveLvalueBaseType(
    base: string,
    knownVariableTypes?: Map<string, KnownVariableInfo>,
  ): string | undefined {
    const memberMatch = base.match(/^(.+?)(?:->|\.)(\w+)$/);
    if (memberMatch) {
      const [, objStr, propName] = memberMatch;
      const objBase = objStr.trim();
      // `this->field` / `(*this).field`: class fields are seeded into the
      // known-variable-types map under their bare name (mirrors how
      // inferExpressionCppType's property-access `this` branch resolves), so a
      // `this->prop` lookup hits `knownVariableTypes.get(prop)`.
      if (objBase === "this" || objBase === "(*this)") {
        return knownVariableTypes?.get(propName)?.cppType;
      }
      // `obj->field` / `obj.field`: resolve the object's type, then look the
      // field up in the interface-field-type map for that struct.
      const objType = this.resolveLvalueBaseType(objBase, knownVariableTypes);
      if (objType) {
        const structName = this.normalizeRecordType(objType).replace(/\s*\*$/, "").trim();
        const fieldType = this.interfaceFieldTypes.get(structName)?.get(propName);
        if (fieldType) return fieldType;
      }
      return undefined;
    }
    // Bare local / parameter / global.
    if (/^\w+$/.test(base)) {
      const local = knownVariableTypes?.get(base)?.cppType;
      if (local) return local;
      const ptr = this.globalPointerVarTypes?.get(base);
      if (ptr) return ptr;
      if (this.stringVarNames?.has(base)) return "std::string";
    }
    return undefined;
  }


  /**
   * Shared enum-operand wrapping for binary operators. Detects whether each
   * side is a numeric-enum operand (excluding string enums), casts it to int,
   * and applies defensive symmetry: if exactly one side is an enum, the other
   * side is also cast so the operator sees `int op int`. Returns the
   * (possibly rewrapped) left and right strings.
   *
   * Used by the arithmetic, bitwise, and comparison branches of renderBinary
   * so the enum-cast logic lives in one place rather than three.
   */
  private castEnumOperandsForOperator(
    leftExpr: ExpressionIR,
    rightExpr: ExpressionIR,
    leftType: string | undefined,
    rightType: string | undefined,
    leftRendered: string,
    rightRendered: string,
  ): { left: string; right: string; leftIsEnum: boolean; rightIsEnum: boolean } {
    const leftIsEnum = !this.isStringEnumOperand(leftExpr, leftType) && this.isEnumComparisonOperand(leftExpr, leftType);
    const rightIsEnum = !this.isStringEnumOperand(rightExpr, rightType) && this.isEnumComparisonOperand(rightExpr, rightType);
    let left = leftRendered;
    let right = rightRendered;
    if (leftIsEnum) {
      left = `static_cast<int>(${leftRendered})`;
    }
    if (rightIsEnum) {
      right = `static_cast<int>(${rightRendered})`;
    }
    // Defensive symmetry: static_cast<int> is always safe on a scalar (enum,
    // int, double, bool all convert) and produces the matching-type `int op
    // int` form C++ requires when one side is enum and the other isn't.
    if (leftIsEnum && !rightIsEnum) {
      right = `static_cast<int>(${rightRendered})`;
    }
    if (rightIsEnum && !leftIsEnum) {
      left = `static_cast<int>(${leftRendered})`;
    }
    return { left, right, leftIsEnum, rightIsEnum };
  }

  /**
   * Returns true when an expression is a string-enum member access, i.e. it
   * resolves to a `constexpr const char*` (e.g. `Color.Red` where Color is a
   * TS string enum). Such operands must NOT be static_cast<int>'d in
   * comparisons — they compare as C-strings instead.
   */
  private isStringEnumOperand(expr: ExpressionIR, inferredType: string | undefined): boolean {
    if (inferredType && this.stringEnumNames.has(inferredType)) return true;
    if (expr.kind === "property-access" && expr.object.kind === "identifier" && this.stringEnumNames.has(expr.object.value)) return true;
    return false;
  }

  private getNumericEnumOperandName(expr: ExpressionIR, inferredType?: string): string | undefined {
    if (inferredType && this.enumNames.has(inferredType) && !this.stringEnumNames.has(inferredType)) {
      return inferredType;
    }
    if (
      expr.kind === "property-access" &&
      expr.object.kind === "identifier" &&
      this.enumNames.has(expr.object.value) &&
      !this.stringEnumNames.has(expr.object.value)
    ) {
      return expr.object.value;
    }
    return undefined;
  }

  private renderBinary(expr: Extract<ExpressionIR, { kind: "binary" }>, exprTransformer?: (expr: string) => string, knownVariableTypes?: Map<string, KnownVariableInfo>): string {
    const leftRendered = this.render(expr.left, exprTransformer, knownVariableTypes);
    const rightRendered = this.render(expr.right, exprTransformer, knownVariableTypes);
    // Platform-specific string concat wrapping (Arduino: String())
    if (expr.operator === "+") {
      const wrapped = this.strategy.wrapStringConcat(leftRendered, rightRendered, expr.left.kind === "string");
      if (wrapped !== undefined) return wrapped;
    }
    // C++ doesn't define % for double — use fmod
    const modLeftType = this.inferExpressionCppType(expr.left, knownVariableTypes);
    const modRightType = this.inferExpressionCppType(expr.right, knownVariableTypes);
    if (expr.operator === "%" && (modLeftType === "double" || modLeftType === "float" || modRightType === "double" || modRightType === "float")) {
      const left = expr.left.kind === "binary" ? `(${leftRendered})` : leftRendered;
      const right = expr.right.kind === "binary" ? `(${rightRendered})` : rightRendered;
      return `fmod(${left}, ${right})`;
    }
    // Promote integer division to double to match JavaScript semantics
    if (expr.operator === "/" && this.strategy.promoteDivisionToDouble?.()) {
      const left = expr.left.kind === "binary" ? `(${leftRendered})` : leftRendered;
      const right = expr.right.kind === "binary" ? `(${rightRendered})` : rightRendered;
      return `static_cast<double>(${left}) / static_cast<double>(${right})`;
    }
    if (expr.operator === "**") {
      const left = expr.left.kind === "binary" ? `(${leftRendered})` : leftRendered;
      const right = expr.right.kind === "binary" ? `(${rightRendered})` : rightRendered;
      return `pow(${left}, ${right})`;
    }
    // Wrap enum-class operands in static_cast<int>() for arithmetic operators
    // (+, -, *, /) and bitwise operators (&, |, ^, <<, >>). C++ enum class
    // values don't interoperate with int implicitly — `trophic - 1`, `a | b`,
    // `x & MASK` all fail without the cast. The
    // shared castEnumOperandsForOperator helper handles detection + defensive
    // symmetry in one place.
    const numericOps = new Set(["+", "-", "*", "/", "&", "|", "^", "<<", ">>"]);
    let preLeft = leftRendered;
    let preRight = rightRendered;
    if (numericOps.has(expr.operator)) {
      // For "+", only cast when neither side is string-like — "+" may be
      // string concatenation (handled by the wrapStringConcat path above),
      // and casting a string operand to int would be wrong. Numeric "+"
      // (e.g. `power + rarity`) still needs the enum-side cast. The other
      // numeric ops are never string concat, so they always qualify.
      const leftIsStringLike = this.isStringLikeCppType(modLeftType) || expr.left.kind === "string";
      const rightIsStringLike = this.isStringLikeCppType(modRightType) || expr.right.kind === "string";
      const isNumericContext = expr.operator !== "+" || (!leftIsStringLike && !rightIsStringLike);
      if (isNumericContext) {
        const cast = this.castEnumOperandsForOperator(
          expr.left, expr.right, modLeftType, modRightType, leftRendered, rightRendered,
        );
        preLeft = cast.left;
        preRight = cast.right;
      }
    }
    // Wrap enum-class operands in static_cast<int>() for comparisons against
    // integers, since C++ enum class values don't compare with int implicitly.
    const comparisonOps = new Set(["==", "===", "!=", "!==", "<", "<=", ">", ">="]);
    let finalLeft = preLeft;
    let finalRight = preRight;
    if (comparisonOps.has(expr.operator)) {
      const leftIsStringEnum = this.isStringEnumOperand(expr.left, modLeftType);
      const rightIsStringEnum = this.isStringEnumOperand(expr.right, modRightType);
      const leftIsStrLiteral = expr.left.kind === "string";
      const rightIsStrLiteral = expr.right.kind === "string";

      // Detect operands that render to a raw C-string value (char buffer from
      // snprintf concat, or a string enum member) so equality against a string
      // literal uses strcmp instead of pointer ==.
      // Only snprintf buffers and string enums need this — std::string has
      // operator==, and const char* variables retain their pre-existing ==
      // behavior. Including std::string here would break valid comparisons.
      const isRawCString = (e: ExpressionIR, t: string | undefined): boolean => {
        if (e.kind === "string_concat" || e.kind === "template_string") return true;
        if (e.kind === "string") return true;
        return this.isStringEnumOperand(e, t);
      };
      const leftIsCStringValue = isRawCString(expr.left, modLeftType);
      const rightIsCStringValue = isRawCString(expr.right, modRightType);

      // String equality: any C-string operand compared with == / != must use
      // strcmp (C++ pointer == on char* compares addresses, not contents).
      // But std::string/String variables have operator==, so skip strcmp when
      // an operand is a managed-string *variable* (would break valid ==).
      // Note: string_concat/template_string render to char[] buffers even
      // though their inferred type is std::string, so they still need strcmp.
      const isManagedStringVar = (e: ExpressionIR, t: string | undefined): boolean => {
        if (e.kind === "string_concat" || e.kind === "template_string" || e.kind === "string") return false;
        return needsCStrForStringLike(this.strategy.normalizeCppType(t ?? ""));
      };
      if ((expr.operator === "===" || expr.operator === "==" || expr.operator === "!==" || expr.operator === "!=") &&
          (leftIsCStringValue || rightIsCStringValue) &&
          !isManagedStringVar(expr.left, modLeftType) && !isManagedStringVar(expr.right, modRightType)) {
        const wantEqual = expr.operator === "===" || expr.operator === "==";
        finalLeft = `strcmp(${leftRendered}, ${rightRendered})`;
        return `${finalLeft} ${wantEqual ? "==" : "!="} 0`;
      }

      // After the strcmp path, apply the shared enum-operand cast (with
      // defensive symmetry). The strcmp path above handles string-valued
      // operands; this handles numeric-enum operands compared against ints.
      const cast = this.castEnumOperandsForOperator(
        expr.left, expr.right, modLeftType, modRightType, leftRendered, rightRendered,
      );
      finalLeft = cast.left;
      finalRight = cast.right;
    }
    // Precedence-aware parenthesization to preserve TS semantics in C++.
    const cppOp = expr.operator === "===" ? "==" : expr.operator === "!==" ? "!=" : expr.operator;
    const myPrec = operatorPrecedence(expr.operator);
    const leftNeedsParens = expr.left.kind === "binary" && operatorPrecedence((expr.left as any).operator) < myPrec;
    const rightNeedsParens = expr.right.kind === "binary" && operatorPrecedence((expr.right as any).operator) <= myPrec;
    const left = leftNeedsParens ? `(${finalLeft})` : finalLeft;
    const right = rightNeedsParens ? `(${finalRight})` : finalRight;
    return `${left} ${cppOp} ${right}`;
  }

  private renderUnary(expr: Extract<ExpressionIR, { kind: "unary" }>, exprTransformer?: (expr: string) => string): string {
    const rendered = this.render(expr.operand, exprTransformer);
    // Postfix operators (e.g. i++, i--) render after the operand.
    if ((expr as any).postfix) {
      return `${rendered}${expr.operator}`;
    }
    return `${expr.operator}${rendered}`;
  }

  private renderPropertyAccess(expr: Extract<ExpressionIR, { kind: "property-access" }>, exprTransformer?: (expr: string) => string, knownVariableTypes?: Map<string, KnownVariableInfo>): string {
    const chain = extractPropertyChain(expr);
    if (chain) {
      // Check for Board.definition.* access first
      const boardDef = this.strategy.renderBoardDefinitionAccess(chain, this.boardConstants);
      if (boardDef !== undefined) return boardDef;
      
      // Check for peripheral stub property access (I2C0.isInitialized, SPI0.isInitialized, Serial.isInitialized)
      const peripheralProperty = renderPeripheralProperty(chain, this.strategy);
      if (peripheralProperty !== undefined) return peripheralProperty;
    }
    const objStr = this.render(expr.object, exprTransformer);
    // In C++, 'this' is a pointer — always use -> for member access.
    // But first: if `this` has a getter for the accessed property, rewrite
    // to a getter call (`this->getX()`). The class emitter registers the
    // current class's accessors under the "this" key in varAccessorNames
    // while emitting each non-static method. This must run before the
    // plain `this->x` early-return below, otherwise getter access on
    // `this` is never rewritten (the call site stays as `this->x` and
    // fails to compile against the generated `getX()` method).
    if (expr.object.kind === "raw" && expr.object.value === "this") {
      const thisAccessors = this.varAccessorNames.get("this");
      if (thisAccessors?.has(expr.property)) {
        const getterName = accessorGetterName(expr.property);
        return `this->${getterName}()`;
      }
      const safeProperty = escapeCppKeyword(expr.property, this.strategy.reservedNames());
      return `this->${safeProperty}`;
    }

    // Use C++ scope-resolution operator (::) for enum class member access.
    if (expr.isEnum || (expr.object.kind === "identifier" && this.enumNames.has(expr.object.value))) {
      const enumName = expr.object.kind === "identifier" ? expr.object.value : objStr;
      const enumMember = this.strategy.renameEnumMember(enumName, expr.property);
      const enumAccess = `${objStr}::${enumMember}`;
      const castType = this.strategy.enumCastType(enumName);
      if (castType !== undefined) {
        return `static_cast<${castType}>(${enumAccess})`;
      }
      return enumAccess;
    }

    // Use C++ scope-resolution operator (::) for namespace or static member access.
    // BUT: a top-level const object (e.g. `const CONFIG = {...}` lowered to an
    // `extern _CONFIG_t CONFIG` variable) is an instance, not a namespace/class,
    // even though the IR may flag it isStatic. Use `.` for those.
    if (expr.object.kind === "identifier" && this.knownTopLevelObjectTypes?.has(expr.object.value)) {
      const accessor = expr.isPointer ? "->" : ".";
      const safeProperty = escapeCppKeyword(expr.property, this.strategy.reservedNames());
      return `${objStr}${accessor}${safeProperty}`;
    }
    // Multi-level static access through a namespace: `Ns.Class.member`. The
    // outer `Ns.Class` renders via the namespace branch below as `Ns::Class`
    // (a namespace-qualified class path). The INNER `.member` access has an
    // `expr.object` that is itself a property-access (not an identifier), so
    // the `namespaceNames.has(...)` check below misses it — it fell through to
    // the instance `.` default and emitted `Ns::Class.member` (mixed), failing
    // at g++ time for a static member (needs `Ns::Class::member`). When the
    // object rendered to a `::`-form it names a namespace/class, not an
    // instance, so the member access is also `::`.
    if (objStr.includes("::") && expr.object.kind === "property-access") {
      const safeProperty = escapeCppKeyword(expr.property, this.strategy.reservedNames());
      return `${objStr}::${safeProperty}`;
    }
    if (expr.isNamespace || expr.isStatic || (expr.object.kind === "identifier" && this.namespaceNames.has(expr.object.value))) {
      // Static getter access: `Counter.total` where `total` is a static getter
      // lowers to `Counter::getTotal()`, not the raw field `Counter::total`.
      // (Instance getters are handled below; this branch runs first for static
      // access and would otherwise bypass the getter rewrite — demo #14 E.)
      if (expr.isStatic && expr.object.kind === "identifier") {
        const staticAccessors = this.typeAccessorNames.get(expr.object.value);
        if (staticAccessors?.has(expr.property)) {
          const getterName = accessorGetterName(expr.property);
          return `${objStr}::${getterName}()`;
        }
      }
      const safeProperty = escapeCppKeyword(expr.property, this.strategy.reservedNames());
      return `${objStr}::${safeProperty}`;
    }

    if (expr.object.kind === "identifier" && (expr.property === "length" || expr.property === "size")) {
      const varName = expr.object.value;
      if (this.cArrayVarNames?.has(varName)) {
        return `(sizeof(${objStr}) / sizeof(${objStr}[0]))`;
      }
      const varInfo = knownVariableTypes?.get(varName) ?? this.knownVariableTypes?.get(varName);
      if (varInfo && parseCppType(varInfo.cppType).kind === "staticArray") {
        return `${objStr}.${expr.property}()`;
      }
      // C-style strings (const char*, char*) require strlen().
      if (varInfo && (varInfo.cppType === "const char*" || varInfo.cppType === "char*")) {
        return `strlen(${objStr})`;
      }
      // std::vector<T> exposes .size() (not .length).
      if (varInfo && parsedIsVector(varInfo.cppType)) {
        return `${objStr}.size()`;
      }
      // String variable detected via IR scan (Issue 2): std::string exposes length()/size().
      if (this.stringVarNames?.has(varName)) {
        return `${objStr}.${expr.property}()`;
      }
    }
    // Passthrough enums: members render as bare identifiers (e.g. INTERNAL, not AnalogReference::INTERNAL).
    if (expr.object.kind === "identifier" && this.strategy.passthroughEnumNames?.().has(expr.object.value)) {
      return expr.property;
    }

    // Fallback for general size/length accessors if not handled above
    if (expr.property === "size" || expr.property === "length") {
      // (Handled above for identified strings/arrays)
    }
    // Rewrite property access to getter call if the property is an accessor.
    // Primary lookup: the receiver is an explicitly-registered variable
    // (var_decl / param / top-level binding) in varAccessorNames. Fallback:
    // the receiver's resolved C++ type names a class with getters
    // (typeAccessorNames). The fallback covers for-of loop variables, function
    // returns, and chained access — receivers whose variable name was never
    // registered but whose type is a known class with accessors.
    if (expr.object.kind === "identifier") {
      let accessors = this.varAccessorNames.get(expr.object.value);
      if (!accessors) {
        const resolvedType = this.inferExpressionCppType(expr.object, knownVariableTypes);
        if (resolvedType) {
          // Bare class name (pointer/const stripped) via structured IR.
          const bareTypeStr = renderCppType(bareType(parseCppType(resolvedType)));
          accessors = this.typeAccessorNames.get(bareTypeStr);
        }
      }
      if (accessors?.has(expr.property)) {
        const getterName = accessorGetterName(expr.property);
        return `${objStr}->${getterName}()`;
      }
    }
    // Decide -> vs "." for the member access. Prefer the IR's isPointer flag
    // (set during IR build for pointer variables / this). When that's absent,
    // fall back to resolving the object's C++ type: if it's a pointer (ends
    // with '*'), the access must use ->. This catches struct/interface fields
    // of class-pointer type (e.g. `dungeon.monster.name` where monster is a
    // Monster* field) that the IR-build-time isPointer detection misses,
    // because interface/struct field types aren't visible during IR build.
    let accessor = expr.isPointer ? "->" : ".";
    if (accessor === ".") {
      const objectType = this.inferExpressionCppType(expr.object, knownVariableTypes);
      if (objectType && parsedIsPointer(objectType)) {
        accessor = "->";
      }
    }
    const safeProperty = escapeCppKeyword(expr.property, this.strategy.reservedNames());
    const rendered = `${objStr}${accessor}${safeProperty}`;
    return rendered;
  }

  private renderCallback(expr: Extract<ExpressionIR, { kind: "callback" }>): string {
    // Callbacks are rendered by the statement emitter which tracks them globally
    // Here we just return a marker that gets replaced with the actual function name
    return `/* callback:${expr.sourceSpan.startLine}:${expr.sourceSpan.startColumn} */`;
  }

  private renderLambda(expr: Extract<ExpressionIR, { kind: "lambda" }>, exprTransformer?: (expr: string) => string): string {
    const params = expr.params.map(p => `${p.cppType} ${p.name}`).join(", ");
    const ret = expr.returnType && expr.returnType !== "auto" ? ` -> ${expr.returnType}` : "";
    if (expr.isExpressionBody && expr.body.length === 1 && expr.body[0].kind === "return" && "value" in expr.body[0]) {
      return `[&](${params})${ret} { return ${this.render((expr.body[0] as any).value, exprTransformer)}; }`;
    }
    const bodyStr = expr.body.map(s => {
      if (s.kind === "return" && s.value) return `  return ${this.render(s.value, exprTransformer)};`;
      if (s.kind === "var_decl") {
        const safeName = s.name;
        const init = s.initializer ? this.render(s.initializer, exprTransformer) : "";
        return `  auto ${safeName} = ${init};`;
      }
      if (s.kind === "assign") return `  ${s.target} ${s.operator} ${s.value ? this.render(s.value, exprTransformer) : ""};`;
      if (s.kind === "call") return `  ${this.render(s as any, exprTransformer)};`;
      return `  /* ${s.kind} */`;
    }).join("\n");
    return `[&](${params})${ret} {\n${bodyStr}\n}`;
  }

  private renderMethodCall(expr: Extract<ExpressionIR, { kind: "method-call" }>, exprTransformer?: (expr: string) => string): string {
    const argsText = expr.args.map(a => this.render(a, exprTransformer)).join(", ");
    let callee = exprTransformer ? exprTransformer(expr.callee) : expr.callee;
    const rExpr = (expr as { receiverExpr?: ExpressionIR }).receiverExpr;
    const mName = (expr as { methodName?: string }).methodName;
    
    // Convert . to :: for static or namespace method calls if the IR flagged them.
    if (expr.isStatic || expr.isNamespace) {
      callee = callee.replace(/\./g, "::");
    }

    const escapedStringVarNames = new Set(Array.from(this.stringVarNames ?? []).map(name => escapeCppKeyword(name, this.strategy.reservedNames())));
    const stringVarNames = this.stringVarNames ?? new Set();
    const cArrayNames = this.cArrayVarNames ?? new Set();
    // Convert . to -> for pointer method calls if the IR flagged them.
    if (expr.isPointer && !callee.includes("->")) {
      callee = callee.replace(/\./g, "->");
    } else if (!callee.includes("->")) {
      // Fallback: the IR's isPointer flag is unset when the receiver is a
      // module-scope (file-global) pointer variable accessed from a scope
      // where its type wasn't visible at IR build time — notably an
      // ISR-captured `const btn = new Button()` referenced inside the hoisted
      // callback. Consult globalPointerVarTypes (threaded from EmitterContext)
      // to recover the pointer-ness and arrow the leading `obj.` → `obj->`.
      // This is the structural replacement for the file-wide text sweep that
      // formerly lived in output-finalizer.ts. Only the leading receiver is
      // rewritten: a chain like `btn->field.method` keeps its inner `.`.
      const m = callee.match(/^([A-Za-z_$][\w$]*)\./);
      if (m && this.globalPointerVarTypes?.has(m[1])) {
        callee = callee.replace(/^([A-Za-z_$][\w$]*)\./, "$1->");
      }
    }

    if (/\b([A-Za-z_][A-Za-z0-9_]*)\.(?:length|size)$/g.test(callee)) {
      return callee;
    }
    callee = this.escapeFinalMemberName(callee);
    // Structured-receiver path: when the method-call IR carries a receiverExpr
    // (the safe.read().ok().fail() chain builder sets this), render the receiver
    // via the full renderer so nested lambda args survive (the flat callee string
    // would have destroyed them as /* __lambda__ */ placeholders). The methodName
    // is escaped against reserved names (e.g. div -> div_).
    const receiverExpr = (expr as { receiverExpr?: ExpressionIR }).receiverExpr;
    const methodName = (expr as { methodName?: string }).methodName;
    if (receiverExpr !== undefined && methodName !== undefined) {
      const receiverText = this.render(receiverExpr, exprTransformer);
      const escapedMethod = escapeCppKeyword(methodName, this.strategy.reservedNames());
      return `${receiverText}.${escapedMethod}(${argsText})`;
    }
    return `${callee}(${argsText})`;
  }

  private escapeFinalMemberName(callee: string): string {
    if (callee.startsWith("std::")) {
      return callee;
    }
    return callee.replace(/(->|::|\.)([A-Za-z_][A-Za-z0-9_]*)$/, (_match, separator: string, memberName: string) => {
      return `${separator}${escapeCppKeyword(memberName, this.strategy.reservedNames())}`;
    });
  }

}

/**
 * Returns the C++ operator precedence for precedence-aware parenthesization.
 * Higher number = higher precedence (binds tighter).
 */
function operatorPrecedence(op: string): number {
  switch (op) {
    case "**": return 6;
    case "*": case "/": case "%": return 5;
    case "+": case "-": return 4;
    case "<<": case ">>": case ">>>": return 3;
    case "<": case "<=": case ">": case ">=": return 2;
    case "==": case "!=": return 1;
    case "&": return 0;
    case "^": return -1;
    case "|": return -2;
    case "&&": return -3;
    case "||": return -4;
    default: return 0;
  }
}

/**
 * Transform class names in expressions to their fully qualified names.
 * E.g., "new SHT3x()" -> "new Microfire::SHT3x()"
 */
function transformClassNames(value: string, classNameMap: Map<string, string>): string {
  if (classNameMap.size === 0) {
    return value;
  }
  
  // Transform "new ClassName(" patterns
  let result = value;
  for (const [simpleName, fullName] of classNameMap) {
    // Only transform if the full name is different (has namespace)
    if (fullName !== simpleName && fullName.includes("::")) {
      const pattern = new RegExp(`\\bnew\\s+${simpleName}\\b`, "g");
      result = result.replace(pattern, `new ${fullName}`);
    }
  }
  
  return result;
}

/**
 * Normalizes a raw expression string for C++ output.
 * Handles === to == conversion, enum access, and class name transformation.
 */
export function normalizeRawExpression(value: string, strategy: PlatformStrategy, classNameMap?: Map<string, string>): string {
  let normalized = value
    .replace(/\?\?/g, "/* ?? */"); // Fallback for raw expressions; usually handled at IR level

  // Apply platform-specific expression normalisation
  normalized = strategy.normalizeRawExpression(normalized);

  // Transform Arduino library class names to their fully qualified names
  if (classNameMap) {
    normalized = transformClassNames(normalized, classNameMap);
  }

  return normalized;
}

/**
 * Transform type names to their fully qualified names (with namespaces).
 * E.g., "SHT3x*" -> "Microfire::SHT3x*", "SHT3x" -> "Microfire::SHT3x"
 */
export function transformTypeName(cppType: string, classNameMap: Map<string, string> | undefined): string {
  if (!classNameMap || classNameMap.size === 0) {
    return cppType;
  }
  
  let result = cppType;
  for (const [simpleName, fullName] of classNameMap) {
    // Only transform if the full name is different (has namespace)
    if (fullName !== simpleName && fullName.includes("::")) {
      // Match the simple name as a word boundary (not already qualified with ::)
      // Handle patterns like "SHT3x", "SHT3x*", "SHT3x&", etc.
      // Use negative lookbehind to avoid matching already-qualified names
      const pattern = new RegExp(`(?<![a-zA-Z0-9_:])${simpleName}\\b`, "g");
      result = result.replace(pattern, fullName);
    }
  }
  
  return result;
}
