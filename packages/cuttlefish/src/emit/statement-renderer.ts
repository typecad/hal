/**
 * Statement Renderer for C++ code emission.
 * Encapsulates all statement rendering logic with explicit dependencies.
 * Extracted from cpp-emitter.ts
 */

import type { StatementIR, ExpressionIR } from "../api/index.js";
import type { PlatformStrategy } from "../api/shared/index.js";
import type { BoardConstants } from "../ir/board-resolver.js";
import type { KnownVariableInfo } from "../api/shared/index.js";
import { routeHALOp } from "./route-hal-op.js";
import { activeNamespaceNames } from "../ir/build-ir-state.js";
import type { Diagnostic } from "../types.js";
import { ExpressionRenderer, transformTypeName, normalizeRawExpression } from "./expression-renderer.js";
import { inferObjectFieldType, collectNestedStructDefs } from "./utils/index.js";
import { escapeCppKeyword, escapeTrailingMember } from "../utils/strings.js";
import { accessorGetterName, accessorSetterName } from "./utils/cpp-helpers.js";
import { parseCppType, renderCppType, bareType, parsedIsPointer, parsedIsVector, parsedElementString, parsedIsPlainStructType } from "../api/shared/cpp-type-ir.js";

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
  /** Module-scope (file-global) pointer variables, consulted to arrow assign/
   *  update targets (`btn.lastPress = 1` → `btn->lastPress = 1`) when the
   *  target's receiver is a global pointer (e.g. ISR-captured). Threaded from
   *  EmitterContext; replaces the file-wide text sweep formerly in
   *  output-finalizer.ts. */
  globalPointerVarTypes?: Map<string, string>;
  /** Set of variable names known to hold string values */
  stringVarNames?: Set<string>;
  /** Set of variable names known to be emitted as C arrays */
  cArrayVarNames?: Set<string>;
  /** Set of namespace names for scoped access (::) */
  namespaceNames?: Set<string>;
  /** Map of variable names to their class's accessor map for getter/setter rewriting */
  varAccessorNames?: Map<string, Map<string, "getter" | "setter" | "both">>;
  /** Map of class type names to their accessor map (type-keyed fallback for getter/setter rewriting). */
  typeAccessorNames?: Map<string, Map<string, "getter" | "setter" | "both">>;
  /** Imported class names from other transpiled modules */
  crossModuleClassNames?: Set<string>;
  /** Shared counter for unique snprintf buffer names across statement renders */
  snprintfCounter?: { value: number };
  /** Map of interface/type name to field C++ types */
  interfaceFieldTypes?: Map<string, Map<string, string>>;
  /**
   * Shared sink for emit-time diagnostics. When provided, the renderer's
   * fallback paths (e.g. an unregistered HAL operation) push structured
   * warnings here instead of silently emitting placeholder comments. The
   * array is the same one finalizeOutput merges into the final diagnostics
   * list. Optional so ad-hoc/test constructions still work.
   */
  diagnostics?: Diagnostic[];
  /**
   * Optional compliance context for A3-9-1 (fixed-width integer default).
   * When provided and A3-9-1 is enforced, defaultNumericType() returns a
   * fixed-width type instead of the legacy 'int'.
   */
  compliance?: { isBanned(ruleId: string): boolean };
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
  // Pointer or C-array. Detected structurally rather than by regex.
  if (strategy.isPointerType(cppType)) return true;
  const ir = parseCppType(cppType);
  return ir.kind === "cArray" || ir.kind === "staticArray";
}

/** True for any `std::`-prefixed type (vector/map/set/tuple/variant/function/string).
 *  Replaces the historical `cppType.startsWith('std::')` check. */
function parsedIsStdContainer(cppType: string): boolean {
  const ir = parseCppType(cppType);
  switch (ir.kind) {
    case "vector": case "map": case "set":
    case "tuple": case "variant": case "function":
    case "string": case "smartPointer":
      return true;
    default:
      return false;
  }
}

/**
 * True if a C++ return type denotes a STRUCT (value class/interface) rather
 * than a primitive, pointer, void, container, or enum. Used to decide whether
 * `return null` must lower to `return {};` (value-init) instead of a nullish
 * literal. Demo #14 Finding A.
 */
function isStructReturnType(cppType: string, strategy: PlatformStrategy): boolean {
  const t = cppType.trim();
  if (!t || t === "void" || t === "auto") return false;
  if (isPrimitiveCppType(t)) return false;
  if (isIndirectType(t, strategy)) return false;
  // Containers and pseudo-types (std::vector, std::string, __tc_StaticArray,
  // __tc_str_ptr, std::function, …) already value-initialize from {} or their
  // own defaults. Restrict this path to plain struct names. Detected by "the
  // parsed IR is a bare named type (no std::/__tc_ wrapper)".
  const ir = parseCppType(t);
  const bare = bareType(ir);
  if (bare.kind !== "named") return false;
  // Exclude the pseudo-type markers themselves (which parse to their own kinds,
  // not `named`, so this is belt-and-braces).
  return !t.startsWith("__tc_");
}

/**
 * True if a return-value expression lowers to a nullish literal — `null`
 * (`nullptr`), `undefined` (`CUTTLEFISH_UNDEFINED`), or a nullish-coalescing
 * `cuttlefish_nullish(x, nullptr)`/`typecad_nullish(...)` whose fallback is
 * nullish. Such a value cannot convert to a struct return type. Demo #14 A.
 */
function isNullishReturnValue(value: ExpressionIR): boolean {
  if (value.kind === "identifier") {
    // `null` → "nullptr" (escaped to nullptr_ at render), `undefined` → the
    // literal identifier "undefined" or the CUTTLEFISH_UNDEFINED macro.
    return value.value === "nullptr" || value.value === "nullptr_" || value.value === "undefined" || value.value === "CUTTLEFISH_UNDEFINED";
  }
  // `x ?? null` lowers to a raw `cuttlefish_nullish(x, nullptr)` /
  // `typecad_nullish(x, nullptr)`. The fallback is the struct-incompatible
  // part; treat the whole expression as nullish for return purposes.
  if (value.kind === "raw") {
    const v = value.value;
    return /(?:cuttlefish|typecad)_nullish\([^,]*,\s*(?:nullptr|CUTTLEFISH_UNDEFINED)\s*\)/.test(v);
  }
  return false;
}

/**
 * Renders StatementIR nodes to C++ code strings.
 */
export class StatementRenderer {
  private readonly strategy: PlatformStrategy;
  private readonly expressionRenderer: ExpressionRenderer;
  private readonly knownFunctionReturnTypes: Map<string, string>;
  private readonly pointerVarTypes?: Map<string, string>;
  private readonly globalPointerVarTypes?: Map<string, string>;
  private readonly classNameMap?: Map<string, string>;
  private readonly varAccessorNames: Map<string, Map<string, "getter" | "setter" | "both">>;
  private readonly crossModuleClassNames?: Set<string>;
  private readonly enumNames: Set<string>;
  private readonly stringEnumNames: Set<string>;
  /** Namespace names — used to rewrite assign-target `Ns.x` to `Ns::x`. */
  private readonly namespaceNames: Set<string>;
  private readonly interfaceFieldTypes: Map<string, Map<string, string>>;
  /** Shared emit-time diagnostics sink (see StatementRendererContext.diagnostics). */
  private readonly _diagnostics: Diagnostic[];
  /** Compliance context for A3-9-1 fixed-width integer default. */
  private readonly _compliance?: { isBanned(ruleId: string): boolean };

  constructor(context: StatementRendererContext) {
    this.strategy = context.strategy;
    this.knownFunctionReturnTypes = context.knownFunctionReturnTypes;
    this.pointerVarTypes = context.pointerVarTypes;
    this.globalPointerVarTypes = context.globalPointerVarTypes;
    this.classNameMap = context.classNameMap;
    this.varAccessorNames = context.varAccessorNames ?? new Map();
    this.crossModuleClassNames = context.crossModuleClassNames;
    this.enumNames = context.enumNames;
    this.stringEnumNames = context.stringEnumNames ?? new Set();
    this.namespaceNames = context.namespaceNames ?? new Set();
    this.interfaceFieldTypes = context.interfaceFieldTypes ?? new Map();
    this._diagnostics = context.diagnostics ?? [];
    this._compliance = context.compliance;

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
      typeAccessorNames: context.typeAccessorNames,
      crossModuleClassNames: context.crossModuleClassNames,
      snprintfCounter: context.snprintfCounter,
      interfaceFieldTypes: this.interfaceFieldTypes,
      diagnostics: this._diagnostics,
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
        // `statement.target` may be a compound member-access string
        // (`this.field`, `obj->field`, `obj.field`) — NOT a bare identifier.
        // escapeCppKeyword renames only WHOLE identifiers that are in the
        // reserved set, so applying it to `this.min` leaves `min` untouched
        // even when `min` is a reserved Arduino macro. That diverged from
        // renderPropertyAccess (which escapes just the trailing property
        // name), so a field declared `min_` (via renameStructField) was
        // written as `this->min = ...` on assignment but read as
        // `this->min_` on access — a declaration/access rename mismatch that
        // fails at g++ time. Escape the trailing member name uniformly here.
        let target = escapeTrailingMember(statement.target, this.strategy.reservedNames());
        target = this.arrowGlobalPointerTarget(target);
        // A namespace member used as an ASSIGNMENT TARGET must use `::`
        // (scope resolution), not `.` — a namespace is not an object. The
        // property-READ path already does this via namespaceNames; the
        // assign-target path did not, so `Devices.total = ...` emitted with
        // `.` and failed at g++ time (namespace stress test Finding 3).
        const nsTargetMatch = target.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/);
        if (nsTargetMatch && this.namespaceNames.has(nsTargetMatch[1])) {
          target = target.replace(/^([A-Za-z_$][\w$]*)\./, "$1::");
        }
        // Multi-level static access target: `Ns::Class.member` (a namespace,
        // then a static class member). After the single-level rewrite above,
        // a `Devices.Registry.count = ...` target is `Devices::Registry.count`.
        // `Registry.count` is a static class member, so the second access is
        // also `::` → `Devices::Registry::count` (namespace stress test
        // Finding 4). Only fires when the target begins with a `::`-qualified
        // namespace path (so a genuine `obj.field` instance access is
        // untouched).
        const nsClassTargetMatch = target.match(/^([A-Za-z_$][\w$]*)::([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/);
        if (nsClassTargetMatch && this.namespaceNames.has(nsClassTargetMatch[1])) {
          target = target.replace(/^([A-Za-z_$][\w$]*)::([A-Za-z_$][\w$]*)\./, "$1::$2::");
        }
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
        // Render the assigned value type-aware: when the target's resolved
        // C++ type sits on the other side of an enum↔integral boundary from
        // the value (e.g. `this->nxt[r][c] = next` where `nxt` is
        // `vector<vector<uint8_t>>` and `next` is an `enum class Cell`),
        // `renderValueForTarget` inserts the required `static_cast`. Falls
        // through to plain rendering when the target type is unknown. Demo #32 A.
        const assignTargetType = this.expressionRenderer.inferLvalueCppType(statement.target, knownVariableTypes);
        const renderedAssignValue = assignTargetType
          ? this.expressionRenderer.renderValueForTarget(statement.value, assignTargetType, knownVariableTypes)
          : this.expressionRenderer.render(statement.value, undefined, knownVariableTypes);
        return forHeader
          ? `${target} ${statement.operator} ${renderedAssignValue}`
          : `${target} ${statement.operator} ${renderedAssignValue};`;
      }

      if (statement.kind === "update") {
        let target = escapeCppKeyword(statement.target, this.strategy.reservedNames());
        target = this.arrowGlobalPointerTarget(target);
        return statement.prefix
          ? `${statement.operator}${target}${forHeader ? "" : ";"}`
          : `${target}${statement.operator}${forHeader ? "" : ";"}`;
      }

      if (statement.kind === "return") {
        if (!statement.value) return "return;";
        // When the enclosing function returns a STRUCT (a non-primitive,
        // non-pointer value type such as an interface), a `return null` /
        // `return undefined` (or `return map.get(k) ?? null`) cannot lower to
        // `return nullptr;` / `return CUTTLEFISH_UNDEFINED;` — those are
        // integer/pointer literals that won't convert to the struct type.
        // Lower to a value-initialized `return {};` instead. The `T | null`
        // union already strips to `T`, so the function
        // signature really does return the struct. Demo #14 Finding A.
        const retType = statement.functionReturnType;
        if (retType && isStructReturnType(retType, this.strategy) && isNullishReturnValue(statement.value)) {
          return `return {};`;
        }
        const renderedValue =
          retType && this.enumNames.has(retType)
            ? this.expressionRenderer.render(statement.value, undefined, knownVariableTypes)
            : this.expressionRenderer.renderEnumSafeValue(statement.value, knownVariableTypes);
        return `return ${renderedValue};`;
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
          // Range-for by reference for non-primitive element types (structs,
          // classes, strings) to avoid the per-iteration copy g++ warns about
          // (-Wrange-loop-construct). Primitives stay by value.
          const isRef = !isPrimitiveCppType(varDecl.cppType) && !isIndirectType(varDecl.cppType, this.strategy);
          return `for (${this.renderTypedName(varDecl.cppType, varDecl.name, varDecl.storage === "const", isRef)} : ${this.expressionRenderer.render(statement.iterable, undefined, knownVariableTypes)})`;
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
          return `for (${this.strategy.defaultNumericType(this._compliance)} ${idxVar} = 0; ${idxVar} < ${statement.keys.length}; ${idxVar}++)`;
        }
        const varDecl = statement.variable;
        if (varDecl.kind === "var_decl") {
          const isRef = !isPrimitiveCppType(varDecl.cppType) && !isIndirectType(varDecl.cppType, this.strategy);
          return `for (${this.renderTypedName(varDecl.cppType, varDecl.name, varDecl.storage === "const", isRef)} : ${this.expressionRenderer.render(statement.object, undefined, knownVariableTypes)})`;
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
        // Blocks reach the single-line renderer as async state-machine segment
        // pre-statements (chained HAL calls lower to a block of hal-ops). The
        // former bare `{` dropped the block body AND emitted an unbalanced
        // brace. Mirrors the line-appender's block emission: empty body →
        // no-op, otherwise brace + rendered statements.
        const bodyLines = statement.body
          .map((nested) => this.render(nested, forHeader, calleeTransformer, knownVariableTypes))
          .filter((line) => line.length > 0);
        if (bodyLines.length === 0) {
          return "";
        }
        return ["{", ...bodyLines, "}"].join("\n");
      }

      if (statement.kind === "hal-op") {
        const resolved = routeHALOp(statement.operation, this.strategy);
        if (resolved) {
          // `{ code: '' }` is a registered op's deliberate elision (sentinel
          // facts — an absent request body, insecure=false) — emit nothing and
          // do NOT fall through to the unregistered-op warning.
          if (resolved.code) {
            // Strip leading 'return ' from raw hal-op code when emitted as a
            // standalone statement.  The HAL definition includes `return` because
            // the TypeScript stub returns a value, but the C++ statement context
            // (e.g. inside void setup()) does not expect it.
            let code = resolved.code;
            if (code.startsWith('return ')) code = code.slice('return '.length);
            // A raw hal-op statement (e.g. `Async.sleep(10)` →
            // `__cuttlefish_async_sleep(10)`) is a complete C++ statement and
            // needs a terminating semicolon, unless it already ends with one or
            // with `}` (a compound block).
            if (!forHeader && !code.endsWith(';') && !code.endsWith('}')) {
              code = code + ';';
            }
            return code;
          }
          if (resolved.expression) {
            return forHeader ? resolved.expression : `${resolved.expression};`;
          }
          return "";
        }
        // Unregistered HAL op: surface as a warning so the user sees it, but
        // keep HAL as an extensibility point. The bare comment is retained as
        // a visual marker in the generated C++.
        this._diagnostics.push({
          severity: "warning",
          code: "TS2CPP_UNHANDLED_HAL",
          message: `HAL operation '${statement.operation.operation}' is not registered with the platform strategy; emitting a placeholder comment.`,
        });
        return `/* unhandled hal-op: ${statement.operation.operation} */`;
      }

      if (statement.kind !== "var_decl") {
        // A StatementIR kind the renderer doesn't know how to render is a
        // transpiler bug — the renderer should cover every kind the IR
        // statement builders produce. This arm is unreachable in the normal
        // transpileFile path (IR lowering marks unsupported statements as
        // errors and the build aborts before emit). Throw so any path that
        // does reach here fails loudly instead of emitting
        // "/* unsupported_statement */" into the C++.
        const kind = (statement as { kind?: string }).kind ?? "<unknown>";
        throw new Error(
          `StatementRenderer: unsupported StatementIR kind '${kind}' reached emission. ` +
            `This is a transpiler bug; the renderer is missing a case for this kind.`,
        );
      }

      return this.renderVarDecl(statement, forHeader, calleeTransformer, knownVariableTypes);
    })();

    return normalizeRawExpression(rendered, this.strategy, this.classNameMap);
  }

  /**
   * Arrow the leading receiver of an assign/update target when it is a
   * module-scope (file-global) pointer variable: `btn.lastPress` →
   * `btn->lastPress`. This covers ISR-captured globals whose pointer type
   * wasn't visible at IR build time (the target is a plain string here, not a
   * property-access IR node). Only the leading receiver is rewritten — a
   * chain like `btn->field.x` is left alone. Replaces the file-wide text sweep
   * formerly in output-finalizer.ts.
   */
  private arrowGlobalPointerTarget(target: string): string {
    if (!this.globalPointerVarTypes || this.globalPointerVarTypes.size === 0) return target;
    const m = target.match(/^([A-Za-z_$][\w$]*)\./);
    if (m && this.globalPointerVarTypes.has(m[1])) {
      return target.replace(/^([A-Za-z_$][\w$]*)\./, "$1->");
    }
    return target;
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
    // HAL bus ownership markers (take/release) — compile-time only, no C++ emission.
    if (statement.args.length === 0 && /\.(take|release)$/.test(statement.callee)) {
      return "";
    }
    // Handle raw statements from setupInitCode
    if (statement.callee.startsWith('__RAW_STMT__')) {
      const rawStmt = statement.callee.slice('__RAW_STMT__'.length);
      return forHeader ? rawStmt : `${rawStmt.endsWith(';') ? rawStmt : rawStmt + ';'}`;
    }
    // Handle expression statements whose IR must render at EMIT time (not the
    // build-time renderExprAsText). The safe.read().ok().fail() chain uses this:
    // its lambda args can only render via the emit-time renderLambda (which
    // produces [&](){...}), so the structured chain IR is carried as args[0]
    // and rendered here via the expression renderer.
    if (statement.callee === '__EXPR_STMT__' && statement.args.length >= 1) {
      const exprText = this.expressionRenderer.render(statement.args[0]!, undefined, knownVariableTypes);
      return forHeader ? exprText : `${exprText};`;
    }
    // Awaited network markers (__WIFI_WAIT__/__HTTP_WAIT__) reaching the
    // plain renderer means the await sits outside an async state machine
    // (top-level await, or a position the state-machine splitter doesn't
    // support). Fall back to the blocking form of the op they carry.
    if ((statement.callee === "__WIFI_WAIT__" || statement.callee === "__HTTP_WAIT__" || statement.callee === "__BLE_WAIT__" || statement.callee === "__HAL_WAIT__")
        && statement.args[0]?.kind === "hal-expr") {
      const resolved = routeHALOp(statement.args[0].operation, this.strategy);
      const code = resolved?.code ?? (resolved?.expression ? `${resolved.expression};` : undefined);
      if (code) {
        return forHeader ? code.replace(/;$/, "") : code;
      }
      // A resolved op with no code/expression is a deliberate elision
      // (sentinel facts) — emit nothing, no placeholder comment.
      if (resolved) {
        return "";
      }
      return `/* unhandled awaited hal-op: ${statement.args[0].operation.operation} */`;
    }
    // Handle emit() — compile-time C++ injection
    if (statement.callee === "__EMIT__") {
      const rawText = statement.args.map(arg => this.renderEmitArg(arg)).join("");
      return forHeader ? rawText : `${rawText.endsWith(';') ? rawText : rawText + ';'}`;
    }
    // console.* is not a supported API — it was a TypeScript carry-over whose
    // lowering (platform print + a config section routing it) cost more than
    // it bought. Programs write to a serial console explicitly instead.
    if (statement.callee.startsWith("console.")) {
      this._diagnostics.push({
        severity: "error",
        code: "console-unsupported",
        message: `console.${statement.callee.slice("console.".length)}() is not supported — write to a serial console instead: \`USB0.writeLine(...)\` (USB CDC) or \`UART0.writeLine(...)\` from the board module.`,
      });
      return "";
    }
    let callee = statement.callee;
    if (callee.startsWith("this.")) {
      callee = `this->${callee.slice("this.".length)}`;
    }
    if (calleeTransformer) {
      callee = calleeTransformer(callee);
    }
    // Apply the strategy's user-function rename to BARE free-function callees
    // (no `.`/`->`/`::` — those are method/qualified calls, not free fns). This
    // is the single chokepoint through which every call statement is rendered
    // (function bodies, class methods, AND top-level executables spliced into
    // the auto-generated entrypoint), so a rename like Arduino's `main` →
    // `cuttlefish_main` propagates to every call site uniformly, including the
    // `main()` call a top-level executable flows into `setup()`. Routed through
    // mapFunctionName (which the entrypoint sentinel and the strategy both
    // weigh in on), so it stays a no-op on targets with no rename.
    if (!callee.includes('.') && !callee.includes("->") && !callee.includes("::")) {
      callee = this.mapFunctionName(callee);
    }
    callee = this.fixCrossModuleMethodCall(callee);
    callee = this.arrowGlobalPointerTarget(callee);
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
    // Transform type name for Arduino library classes (add namespace prefix).
    // A3-9-1: substitute the fixed-width default for the IR's hardcoded "int"
    // BEFORE the class-name transform so var declarations match the other
    // declaration paths under --autosar.
    const transformedType = transformTypeName(declaredType, this.classNameMap);
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
          // Check if the declared array type's element is a known named type
          // (e.g. `const pts: Point[]` → std::vector<Point>). If so, use Point
          // directly instead of generating a shadow `_{name}_t` struct (which
          // collides when the same shape appears at multiple sites — demo #11
          // Finding D).
          let elementTypeName: string | null = null;
          // Element type of std::vector<T> or T[], detected structurally.
          const elemType = parsedElementString(rawType) ?? null;
          if (elemType && /^[A-Z]/.test(elemType)) {
            elementTypeName = elemType;
          }
          if (elementTypeName) {
            // Use the named element type directly — no shadow struct needed.
            const elements = statement.initializer.elements.map((e) => {
              if (e.kind === "object") {
                const initValues = e.fields.map((f) => {
                  const val = this.expressionRenderer.render(f.value, undefined);
                  return val;
                }).join(", ");
                return `{ ${initValues} }`;
              }
              return this.expressionRenderer.render(e, undefined);
            });
            const vecType = `std::vector<${elementTypeName}>`;
            const safeArrName2 = escapeCppKeyword(statement.name, this.strategy.reservedNames());
            const constPrefix2 = isConst ? "const " : "";
            return `${constPrefix2}${vecType} ${safeArrName2} = { ${elements} };`;
          }
          const structName = `_${statement.name}_t`;
          // Compile-time-only namespace values (e.g. the `ui` authoring handle
          // from @typecad/ui) are intercepted at IR-build time; their calls
          // lower to IR but the binding itself must emit nothing. Skip the
          // struct synthesis + initializer for these.
          if (activeNamespaceNames.has(statement.name)) {
            return "";
          }
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

        if (this.strategy.needsStdVector() && parsedIsVector(rawType)) {
          return forHeader
            ? `${declaration} = { ${elements} }`
            : `${declaration} = { ${elements} };`;
        }

        if (!this.strategy.needsStdVector() && parsedIsVector(rawType)) {
          // Non-mutable arrays annotated as Array<T> or ReadonlyArray<T> on platforms
          // that don't support std::vector → emit as a plain C-style array.
          // Mutable arrays (.push/.pop/.indexOf) are rewritten to StaticArray<int> in
          // the IR builder (via mutableArrayVars) and never reach this branch.
          const elementType = parsedElementString(rawType) ?? this.strategy.defaultNumericType(this._compliance);
          return forHeader
            ? `${elementType} ${safeArrName}[] = { ${elements} }`
            : `${elementType} ${safeArrName}[] = { ${elements} };`;
        }

        // Use "int" for "auto" element type since C arrays need explicit types
        const arrayType = statement.initializer.elementType === "auto" ? this.strategy.defaultNumericType(this._compliance) : statement.initializer.elementType;
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
          parsedIsPlainStructType(declaredCppType);

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
          // Demo #18 Finding C: do NOT overwrite an existing authoritative
          // field-type map for this named type (registered in setup.ts from the
          // interface/class declaration). The inferred fieldTypes here come from
          // the initializer VALUES and, after strategy normalization, can be
          // wider/incorrect (e.g. int32_t + name -> all "long long" under the
          // native strategy). Clobbering the correct declared types then makes
          // downstream snprintf format inference pick wrong specifiers
          // (e.g. "%lld" + missing .c_str() for a std::string field). Only seed
          // the map when no declared entry exists (e.g. an anonymous struct).
          if (!this.interfaceFieldTypes.has(namedType)) {
            this.interfaceFieldTypes.set(namedType, fieldTypes);
          }
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
        let arrayType = statement.initializer.elementType === "auto" ? this.strategy.defaultNumericType(this._compliance) : statement.initializer.elementType;
        const spreadName = this.expressionRenderer.render(statement.initializer.spreadExpr, calleeTransformer, knownVariableTypes);
        if (statement.initializer.elementType === "auto" && knownVariableTypes && statement.initializer.spreadExpr.kind === "identifier") {
          const srcInfo = knownVariableTypes.get(statement.initializer.spreadExpr.value);
          if (srcInfo) {
            const vectorElem = parsedElementString(srcInfo.cppType);
            if (vectorElem) {
              arrayType = vectorElem;
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
      // Enum ↔ integral storage boundary. TS lets an
      // enum and a number flow into each other freely (enums ARE numbers at
      // runtime), but the lowered C++ `enum class` has NO implicit conversion
      // in EITHER direction: `const n: int = Color.Red` AND
      // `const c: Color = intCell` both fail. Route the initializer through
      // the shared target-type-aware helper so both directions lower with the
      // right `static_cast`, replacing the prior point-specific enum→int-only
      // inline check. Demo #32 Finding A.
      const finalInit = this.expressionRenderer.renderValueForTarget(
        statement.initializer, declaredType, knownVariableTypes, calleeTransformer,
      );
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
    if (isConst && !alreadyConstQualified && parsedIsPointer(normalizedType)) {
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
          && !parsedIsStdContainer(paramTypeName)
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
    // A3-9-1: under autosar, substitute the platform's default numeric type
    // for the legacy "int" spelling. The IR layer hardcodes "int" for number
    // literals, so we catch it here at the renderer boundary.
    if (typeName === "int" && this._compliance?.isBanned("A3-9-1")) {
      return this.strategy.defaultNumericType(this._compliance);
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
      this.strategy.defaultNumericType(this._compliance),
      (o, n) => this.strategy.resolvePinType?.(o, n),
    );
  }

  private renderEmitArg(arg: ExpressionIR): string {
    if (arg.kind === "string") return arg.value;
    if (arg.kind === "string_concat") return arg.parts.map(p => this.renderEmitArg(p)).join("");
    // For template_string inside emit(), the inner expression is a
    // string_concat of literal parts and interpolated identifiers. We render
    // each part directly as C++ text — string literals contribute their raw
    // text, identifiers contribute their variable name — bypassing the
    // snprintf machinery that normal string rendering would use.
    if (arg.kind === "template_string") return this.renderEmitArg(arg.expression);
    return this.expressionRenderer.render(arg);
  }

  /**
   * Map a function name to its platform-specific name.
   *
   * The entrypoint sentinel `__cuttlefish_entrypoint__` maps to the strategy's
   * entrypoint name (`main` on native, `setup` on Arduino). For every OTHER
   * name we delegate to `strategy.mapFunctionName`, which is where a target
   * can rename a user function that would otherwise collide with a C++/
   * framework reserved name — e.g. the Arduino strategy renames a user
   * `function main()` to `cuttlefish_main`, because Arduino has no `main()`
   * (the entrypoints are the auto-generated `setup()`/`loop()`), and a
   * file-scope `static void main()` collides with C++'s required `int main()`
   * signature. Routing every name through the strategy here is the single
   * place that makes such renames actually take effect at emit time.
   */
  public mapFunctionName(originalName: string): string {
    if (originalName === "__cuttlefish_entrypoint__") {
      return this.strategy.entrypointFunctionName();
    }
    return this.strategy.mapFunctionName(originalName);
  }

  /**
   * Map a TypeScript return type to its C++ equivalent for a specific function.
   */
  public mapReturnType(fnName: string, tsType: string): string {
    return this.strategy.mapReturnType(fnName, tsType);
  }
}
