/**
 * Expression Renderer for C++ code emission.
 * Encapsulates all expression rendering logic with explicit dependencies.
 * Extracted from cpp-emitter.ts
 */

import type { ExpressionIR } from "../api";
import type { PlatformStrategy } from "../api/shared";
import type { BoardConstants } from "../ir/board-resolver";
import type { KnownVariableInfo } from "../api/shared";
import { extractPropertyChain } from "../ir/extract-property-chain";
import { escapeCppKeyword } from "../utils/strings";
import { accessorGetterName } from "./utils/cpp-helpers";
import { renderPeripheralProperty } from "../mapping/peripheral-names";

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
  private readonly knownVariableTypes?: Map<string, KnownVariableInfo>;
  private readonly pointerVarTypes?: Map<string, string>;
  private readonly stringVarNames?: Set<string>;
  private readonly cArrayVarNames?: Set<string>;
  private readonly namespaceNames: Set<string>;
  private readonly varAccessorNames: Map<string, Map<string, "getter" | "setter" | "both">>;
  private readonly interfaceFieldTypes: Map<string, Map<string, string>>;
  private readonly knownTopLevelObjectTypes?: Map<string, string>;

  /** Accumulated snprintf prelude lines (buffer declarations, dtostrf calls, snprintf calls). */
  private _preludeLines: string[] = [];
  /** Monotonic counter for unique snprintf buffer names. Shared across renders when provided. */
  private _snprintfCounter: { value: number };

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
    this.stringVarNames = context.stringVarNames;
    this.cArrayVarNames = context.cArrayVarNames;
    this.namespaceNames = context.namespaceNames ?? new Set();
    this.varAccessorNames = context.varAccessorNames ?? new Map();
    this.interfaceFieldTypes = context.interfaceFieldTypes ?? new Map();
    this.knownTopLevelObjectTypes = context.knownTopLevelObjectTypes;
    this._snprintfCounter = context.snprintfCounter ?? { value: 0 };
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
        rendered = this.renderIdentifier(expr.value);
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
      case "element-access":
        rendered = this.renderElementAccess(expr, exprTransformer);
        break;
      case "hal-expr": {
        const resolved = this.strategy.resolveHALOperation?.(expr.operation);
        if (resolved?.expression) {
          rendered = resolved.expression;
        } else if (resolved?.code) {
          // Strip trailing semicolon if present for expression context
          rendered = resolved.code.replace(/;\s*$/, "");
        } else {
          rendered = `/* unhandled hal-expr: ${expr.operation.operation} */`;
        }
        break;
      }
      default:
        rendered = "0 /* unsupported_expr */";
    }
    return normalizeRawExpression(rendered, this.strategy, this.classNameMap);
  }

  private renderIdentifier(value: string): string {
    const nullVal = this.strategy.nullValue();
    // expression-to-ir lowers the TS `null` literal to the identifier sentinel
    // "nullptr" and `undefined` to "CUTTLEFISH_UNDEFINED". Both must route
    // through nullValue() so the platform's chosen null representation is used
    // — otherwise "nullptr" is mangled to "nullptr_" by escapeCppKeyword (since
    // nullptr is a C++ keyword) and emitted as an undefined token.
    if (nullVal && (value === "null" || value === "undefined" || value === "nullptr")) {
      return nullVal;
    }
    return escapeCppKeyword(value, this.strategy.reservedNames());
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
    let normalized = cppType.trim().replace(/^const\s+/, "").replace(/\s+const$/, "").trim();
    const smartPointer = normalized.match(/^std::(?:shared_ptr|unique_ptr)<\s*(.+)\s*>$/);
    if (smartPointer) normalized = smartPointer[1].trim();
    return normalized.replace(/[\s*&]+$/, "").trim();
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
        if (this.stringVarNames?.has(expr.value)) return "std::string";
        return undefined;
      }
      case "await":
        return this.inferExpressionCppType(expr.value, knownVariableTypes);
      case "paren":
        return this.inferExpressionCppType(expr.inner, knownVariableTypes);
      case "ternary": {
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
        const normalized = objectType.trim();
        const vectorMatch = normalized.match(/^std::vector<(.+)>$/);
        if (vectorMatch) return vectorMatch[1].trim();
        const staticArrayMatch = normalized.match(/^(?:__tc_StaticArray|StaticArray)<\s*(.+),\s*\d+\s*>$/);
        if (staticArrayMatch) return staticArrayMatch[1].trim();
        const arrayMatch = normalized.match(/^(.+)\[\d*\]$/);
        return arrayMatch?.[1].trim();
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
        formatString += part.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
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
    if (expr.kind !== "number" && expr.kind !== "boolean" && expr.kind !== "string") {
      const inferredType = this.inferExpressionCppType(expr, knownVariableTypes);
      if (inferredType) {
        const rendered = this.render(expr, exprTransformer, knownVariableTypes);
        const normalized = this.strategy.normalizeCppType(inferredType);
        if (this.isStringLikeCppType(inferredType)) {
          const needsCStr = normalized === "std::string" || normalized === "String" || normalized === "__tc_str_ptr";
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
          if (normalized.includes("long") || /32_t$/.test(normalized)) {
            return { format: "%ld", arg: rendered, estimatedLength: 12 };
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
        return { format: "%s", arg: `"${expr.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`, estimatedLength: Math.max(expr.value.length, 1) };
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
        if (cppType === "int" || cppType === "short" || cppType === "int16_t" || cppType === "uint16_t") {
          return { format: "%d", arg: expr.value, estimatedLength: 12 };
        }
        if (cppType === "long" || cppType === "int32_t" || cppType === "uint32_t" || cppType === "auto") {
          return { format: "%ld", arg: expr.value, estimatedLength: 12 };
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
        // HAL expressions that resolve to string-like outputs use %s
        if (rendered.startsWith('"') || this.stringVarNames?.has(rendered)) {
          return { format: "%s", arg: rendered, estimatedLength: 32 };
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
        // These helpers return std::string, so snprintf needs .c_str().
        if (/^__tc_(toUpperCase|toLowerCase|trim|replace|charAt|substring|slice|padStart|padEnd|repeat|jsonStringify)\b/.test(rendered)) {
          return { format: "%s", arg: `${rendered}.c_str()`, estimatedLength: 32 };
        }
        // Check if it's a property access on a string (e.g. s.length)
        if (expr.kind === "property-access" && (expr.property === "length" || expr.property === "size")) {
          return { format: "%d", arg: rendered, estimatedLength: 10 };
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

  private renderElementAccess(expr: Extract<ExpressionIR, { kind: "element-access" }>, exprTransformer?: (expr: string) => string): string {
    const objectText = this.render(expr.object, exprTransformer);
    const indexText = this.render(expr.index, exprTransformer);
    return `${objectText}[${indexText}]`;
  }

  private isEnumComparisonOperand(expr: ExpressionIR, inferredType: string | undefined): boolean {
    if (inferredType && this.enumNames.has(inferredType)) return true;
    // Property/element access on an enum name (e.g. Color::Green) is also enum-valued.
    if (expr.kind === "property-access" && expr.object.kind === "identifier" && this.enumNames.has(expr.object.value)) return true;
    return false;
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
    // (+, -, *, /). C++ enum class values don't support arithmetic with int
    // implicitly, so `trophic - 1` fails to compile. Cast the enum operand(s)
    // to int. This mirrors the comparison-operator enum handling below.
    const arithmeticOps = new Set(["+", "-", "*", "/"]);
    let preLeft = leftRendered;
    let preRight = rightRendered;
    if (arithmeticOps.has(expr.operator) && expr.operator !== "+") {
      // Skip "+" because it may be string concatenation (handled by the
      // wrapStringConcat path above); only numeric arithmetic needs the cast.
      if (this.isEnumComparisonOperand(expr.left, modLeftType)) {
        preLeft = `static_cast<int>(${leftRendered})`;
      }
      if (this.isEnumComparisonOperand(expr.right, modRightType)) {
        preRight = `static_cast<int>(${rightRendered})`;
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
        const n = this.strategy.normalizeCppType(t ?? "");
        return n === "std::string" || n === "String" || n === "__tc_str_ptr";
      };
      if ((expr.operator === "===" || expr.operator === "==" || expr.operator === "!==" || expr.operator === "!=") &&
          (leftIsCStringValue || rightIsCStringValue) &&
          !isManagedStringVar(expr.left, modLeftType) && !isManagedStringVar(expr.right, modRightType)) {
        const wantEqual = expr.operator === "===" || expr.operator === "==";
        finalLeft = `strcmp(${leftRendered}, ${rightRendered})`;
        return `${finalLeft} ${wantEqual ? "==" : "!="} 0`;
      }

      const leftIsEnumOperand = !leftIsStringEnum && this.isEnumComparisonOperand(expr.left, modLeftType);
      const rightIsEnumOperand = !rightIsStringEnum && this.isEnumComparisonOperand(expr.right, modRightType);
      if (leftIsEnumOperand) {
        finalLeft = `static_cast<int>(${leftRendered})`;
      }
      if (rightIsEnumOperand) {
        finalRight = `static_cast<int>(${rightRendered})`;
      }
      // Defensive symmetry: if exactly one side was detected as an enum,
      // cast the other side too unconditionally. static_cast<int>(...) is
      // always safe on a scalar operand (enum, int, double, bool all
      // convert) and produces the required matching-type form for
      // `enum class` comparisons. The previous condition only cast the
      // unknown side when its inferred type was undefined/auto/"" — but a
      // struct field of enum type (e.g. `a.severity` on an `Alarm` struct)
      // can resolve to the enum name `Severity` via interfaceFieldTypes
      // WITHOUT isEnumComparisonOperand noticing (it only checks
      // inferredType-against-enumNames for the whole expression, not for
      // struct-field-access sub-expressions), leaving one side un-cast and
      // producing `Severity >= int` errors.
      if (leftIsEnumOperand && !rightIsEnumOperand) {
        finalRight = `static_cast<int>(${rightRendered})`;
      }
      if (rightIsEnumOperand && !leftIsEnumOperand) {
        finalLeft = `static_cast<int>(${leftRendered})`;
      }
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
      return `this->${expr.property}`;
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
      return `${objStr}${accessor}${expr.property}`;
    }
    if (expr.isNamespace || expr.isStatic || (expr.object.kind === "identifier" && this.namespaceNames.has(expr.object.value))) {
      return `${objStr}::${expr.property}`;
    }

    if (expr.object.kind === "identifier" && (expr.property === "length" || expr.property === "size")) {
      const varName = expr.object.value;
      if (this.cArrayVarNames?.has(varName)) {
        return `(sizeof(${objStr}) / sizeof(${objStr}[0]))`;
      }
      const varInfo = knownVariableTypes?.get(varName) ?? this.knownVariableTypes?.get(varName);
      if (varInfo?.cppType.startsWith("__tc_StaticArray")) {
        return `${objStr}.${expr.property}()`;
      }
      // C-style strings (const char*, char*) require strlen().
      if (varInfo?.cppType === "const char*" || varInfo?.cppType === "char*") {
        return `strlen(${objStr})`;
      }
      // std::vector<T> exposes .size() (not .length).
      if (varInfo && varInfo.cppType.startsWith("std::vector<")) {
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
    // Rewrite property access to getter call if the property is an accessor
    if (expr.object.kind === "identifier") {
      const accessors = this.varAccessorNames.get(expr.object.value);
      if (accessors?.has(expr.property)) {
        const getterName = accessorGetterName(expr.property);
        return `${objStr}->${getterName}()`;
      }
    }
    const accessor = expr.isPointer ? "->" : ".";
    const rendered = `${objStr}${accessor}${expr.property}`;
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
    }

    if (/\b([A-Za-z_][A-Za-z0-9_]*)\.(?:length|size)$/g.test(callee)) {
      return callee;
    }
    return `${callee}(${argsText})`;
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
