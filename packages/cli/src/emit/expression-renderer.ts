/**
 * Expression Renderer for C++ code emission.
 * Encapsulates all expression rendering logic with explicit dependencies.
 * Extracted from cpp-emitter.ts
 */

import type { ExpressionIR } from "../ir/model";
import type { PlatformStrategy } from "../platform/platform-strategy";
import type { BoardConstants } from "../ir/board-resolver";
import type { TypehalReceiverKind } from "../ir/typehal-symbols";
import { extractPropertyChain } from "@typehal/framework-arduino";
import { escapeCppKeyword } from "../utils/strings";
import { accessorGetterName } from "./utils/cpp-helpers";
import { mapPeripheralName, renderPeripheralProperty } from "../mapping/peripheral-names";

/**
 * Context needed for expression rendering.
 */
export interface ExpressionRendererContext {
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
  knownFunctionReturnTypes?: Map<string, string>;
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
}

/**
 * Renders ExpressionIR nodes to C++ code strings.
 */
export class ExpressionRenderer {
  private readonly strategy: PlatformStrategy;
  private readonly boardConstants?: BoardConstants;
  private readonly arduinoClassNameMap?: Map<string, string>;
  private readonly enumNames: Set<string>;
  private readonly largeEnumNames: Set<string>;
  private readonly knownFunctionReturnTypes?: Map<string, string>;
  private readonly pointerVarTypes?: Map<string, string>;
  private readonly stringVarNames?: Set<string>;
  private readonly cArrayVarNames?: Set<string>;
  private readonly namespaceNames: Set<string>;
  private readonly varAccessorNames: Map<string, Map<string, "getter" | "setter" | "both">>;

  /** Accumulated snprintf prelude lines (buffer declarations, dtostrf calls, snprintf calls). */
  private _preludeLines: string[] = [];
  /** Monotonic counter for unique snprintf buffer names. */
  private _snprintfTempCounter = 0;

  constructor(context: ExpressionRendererContext) {
    this.strategy = context.strategy;
    this.boardConstants = context.boardConstants;
    this.arduinoClassNameMap = context.arduinoClassNameMap;
    this.enumNames = context.enumNames;
    this.largeEnumNames = context.largeEnumNames;
    this.knownFunctionReturnTypes = context.knownFunctionReturnTypes;
    this.pointerVarTypes = context.pointerVarTypes;
    this.stringVarNames = context.stringVarNames;
    this.cArrayVarNames = context.cArrayVarNames;
    this.namespaceNames = context.namespaceNames ?? new Set();
    this.varAccessorNames = context.varAccessorNames ?? new Map();
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
    this._snprintfTempCounter = 0;
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
   * @returns The C++ code string
   */
  render(expr: ExpressionIR, exprTransformer?: (expr: string) => string): string {
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
        rendered = this.renderStringConcat(expr, exprTransformer);
        break;
      case "template_string":
        rendered = this.renderTemplateString(expr, exprTransformer);
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
        rendered = `/* spread_array: see variable declaration */`;
        break;
      case "paren":
        rendered = `(${this.render(expr.inner, exprTransformer)})`;
        break;
      case "binary":
        rendered = this.renderBinary(expr, exprTransformer);
        break;
      case "unary":
        rendered = this.renderUnary(expr, exprTransformer);
        break;
      case "property-access":
        rendered = this.renderPropertyAccess(expr, exprTransformer);
        break;
      case "typehal-call":
        rendered = this.renderTypehalCall(expr, exprTransformer);
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
      default:
        rendered = "0 /* unsupported_expr */";
    }
    return this.fixPointerAccess(rendered);
  }

  private renderIdentifier(value: string): string {
    const nullVal = this.strategy.nullValue();
    if (nullVal && (value === "null" || value === "undefined")) {
      return nullVal;
    }
    // Delegate peripheral identifier mapping to the platform strategy
    const mapped = this.strategy.mapPeripheralIdentifier?.(value);
    if (mapped) return mapped;
    return escapeCppKeyword(value);
  }

  private renderRaw(value: string, exprTransformer?: (expr: string) => string): string {
    const effectiveClassNameMap = this.arduinoClassNameMap;
    let result = exprTransformer
      ? normalizeRawExpression(exprTransformer(value), this.strategy, effectiveClassNameMap)
      : normalizeRawExpression(value, this.strategy, effectiveClassNameMap);
    result = this.fixPointerAccess(result);
    const escapedStringVarNames = new Set(Array.from(this.stringVarNames ?? []).map(name => escapeCppKeyword(name)));
    const stringVarNames = this.stringVarNames ?? new Set();
    const cArrayNames = this.cArrayVarNames ?? new Set();
    result = result.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\.(?:length|size)(?:\(\))?/g, (match, varName) => {
      if (stringVarNames.has(varName) || escapedStringVarNames.has(varName)) return `strlen(${varName})`;
      if (cArrayNames.has(varName)) return `(sizeof(${varName}) / sizeof(${varName}[0]))`;
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

  private renderStringConcat(expr: Extract<ExpressionIR, { kind: "string_concat" }>, exprTransformer?: (expr: string) => string): string {
    // When snprintf mode is active, build snprintf buffer instead of String() concatenation
    if (this.strategy.useSnprintfForStrings()) {
      const snprintfResult = this.buildSnprintfFromParts(expr.parts, exprTransformer);
      if (snprintfResult) {
        return snprintfResult;
      }
    }
    // Fallback: Build a String concatenation chain
    const renderedParts = expr.parts.map(part => {
      const rendered = this.render(part, exprTransformer);
      // Wrap non-string expressions in String() constructor for concatenation
      if (part.kind === "string") {
        return rendered;
      }
      // For template_string, wrap in String() to convert to string
      if (part.kind === "template_string") {
        return `String(${rendered})`;
      }
      // For other types, also wrap in String()
      return `String(${rendered})`;
    });
    return renderedParts.join(" + ");
  }

  private renderTemplateString(expr: Extract<ExpressionIR, { kind: "template_string" }>, exprTransformer?: (expr: string) => string): string {
    // When snprintf mode is active, build snprintf buffer for single interpolation
    if (this.strategy.useSnprintfForStrings()) {
      const argInfo = this.inferFormatSpecifier(expr.expression, exprTransformer);
      if (argInfo) {
        const bufferName = `__typehal_str_${++this._snprintfTempCounter}`;
        const estimatedLength = Math.max(argInfo.estimatedLength + 1, 16);
        this._preludeLines.push(
          `char ${bufferName}[${estimatedLength}];`,
          `snprintf(${bufferName}, sizeof(${bufferName}), "${argInfo.format}", ${argInfo.arg});`,
        );
        return bufferName;
      }
    }
    // Fallback: Wrap the expression in String() to convert to string
    return `String(${this.render(expr.expression, exprTransformer)})`;
  }

  /**
   * Build snprintf format string and args from string_concat parts.
   * Returns the buffer name on success, or undefined if snprintf can't handle it.
   */
  private buildSnprintfFromParts(
    parts: ExpressionIR[],
    exprTransformer?: (expr: string) => string,
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

      if (part.kind === "template_string") {
        const argInfo = this.inferFormatSpecifier(part.expression, exprTransformer);
        if (!argInfo) return undefined;
        formatString += argInfo.format;
        args.push(argInfo.arg);
        estimatedLength += argInfo.estimatedLength;
        continue;
      }

      // Can't handle other part types with snprintf
      return undefined;
    }

    const bufferName = `__typehal_str_${++this._snprintfTempCounter}`;
    estimatedLength = Math.max(estimatedLength, 16);
    this._preludeLines.push(
      `char ${bufferName}[${estimatedLength}];`,
      `snprintf(${bufferName}, sizeof(${bufferName}), "${formatString}"${args.length > 0 ? `, ${args.join(", ")}` : ""});`,
    );
    return bufferName;
  }

  /**
   * Infer printf format specifier for an expression.
   * Returns format string, rendered arg, and estimated length, or undefined if unknown.
   */
  private inferFormatSpecifier(
    expr: ExpressionIR,
    exprTransformer?: (expr: string) => string,
  ): { format: string; arg: string; estimatedLength: number } | undefined {
    switch (expr.kind) {
      case "number": {
        if (expr.cppType === "float" || !Number.isInteger(expr.value)) {
          const str = `${expr.value}`;
          const rendered = str.includes('.') || str.includes('e') || str.includes('E')
            ? `${str}f`
            : `${str}.0f`;
          return { format: "%g", arg: rendered, estimatedLength: 16 };
        }
        return { format: "%d", arg: `${expr.value}`, estimatedLength: 12 };
      }
      case "boolean":
        return { format: "%s", arg: expr.value ? '"true"' : '"false"', estimatedLength: 5 };
      case "string":
        return { format: "%s", arg: `"${expr.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`, estimatedLength: Math.max(expr.value.length, 1) };
      case "identifier": {
        // Check known variable types for better format specifiers
        const cppType = this.knownFunctionReturnTypes?.get(expr.value);
        if (cppType === "bool") {
          return { format: "%s", arg: `(${expr.value} ? "true" : "false")`, estimatedLength: 5 };
        }
        if (cppType === "float" || cppType === "double") {
          return { format: "%g", arg: expr.value, estimatedLength: 16 };
        }
        if (this.stringVarNames?.has(expr.value)) {
          return { format: "%s", arg: expr.value, estimatedLength: 32 };
        }
        // Default to %d for integers and unknowns
        return { format: "%d", arg: expr.value, estimatedLength: 12 };
      }
      case "raw":
      case "property-access":
      case "binary":
      case "unary":
      case "ternary":
      case "typehal-call":
        return { format: "%d", arg: this.render(expr, exprTransformer), estimatedLength: 12 };
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

  private renderInstanceof(expr: Extract<ExpressionIR, { kind: "instanceof" }>, exprTransformer?: (expr: string) => string): string {
    return `(dynamic_cast<const ${expr.className}*>(${this.render(expr.object, exprTransformer)}) != nullptr)`;
  }

  private renderBinary(expr: Extract<ExpressionIR, { kind: "binary" }>, exprTransformer?: (expr: string) => string): string {
    const leftRendered = this.render(expr.left, exprTransformer);
    const rightRendered = this.render(expr.right, exprTransformer);
    // Platform-specific string concat wrapping (Arduino: String())
    if (expr.operator === "+") {
      const wrapped = this.strategy.wrapStringConcat(leftRendered, rightRendered, expr.left.kind === "string");
      if (wrapped !== undefined) return wrapped;
    }
    // Precedence-aware parenthesization to preserve TS semantics in C++.
    const myPrec = operatorPrecedence(expr.operator);
    const leftNeedsParens = expr.left.kind === "binary" && operatorPrecedence((expr.left as any).operator) < myPrec;
    const rightNeedsParens = expr.right.kind === "binary" && operatorPrecedence((expr.right as any).operator) <= myPrec;
    const left = leftNeedsParens ? `(${leftRendered})` : leftRendered;
    const right = rightNeedsParens ? `(${rightRendered})` : rightRendered;
    return `${left} ${expr.operator} ${right}`;
  }

  private renderUnary(expr: Extract<ExpressionIR, { kind: "unary" }>, exprTransformer?: (expr: string) => string): string {
    const rendered = this.render(expr.operand, exprTransformer);
    // Postfix operators (e.g. i++, i--) render after the operand.
    if ((expr as any).postfix) {
      return `${rendered}${expr.operator}`;
    }
    return `${expr.operator}${rendered}`;
  }

  private renderPropertyAccess(expr: Extract<ExpressionIR, { kind: "property-access" }>, exprTransformer?: (expr: string) => string): string {
    const chain = extractPropertyChain(expr);
    if (chain) {
      // Check for Board.definition.* access first
      const boardDef = this.strategy.renderBoardDefinitionAccess(chain, this.boardConstants);
      if (boardDef !== undefined) return boardDef;
      
      // Check for peripheral stub property access (I2C0.isInitialized, SPI0.isInitialized, Serial.isInitialized)
      const peripheralProperty = renderPeripheralProperty(chain);
      if (peripheralProperty !== undefined) return peripheralProperty;
    }
    const objStr = this.render(expr.object, exprTransformer);
    if (expr.object.kind === "identifier" && expr.property === "length") {
      if (this.cArrayVarNames?.has(expr.object.value)) {
        return `(sizeof(${objStr}) / sizeof(${objStr}[0]))`;
      }
      if (this.stringVarNames?.has(expr.object.value)) {
        return `strlen(${objStr})`;
      }
    }
    // Use C++ scope-resolution operator (::) for enum class member access.
    if (expr.object.kind === "identifier" && this.enumNames.has(expr.object.value)) {
      const enumMember = this.strategy.renameEnumMember(expr.object.value, expr.property);
      const enumAccess = `${objStr}::${enumMember}`;
      const castType = this.strategy.enumCastType(expr.object.value);
      if (castType !== undefined) {
        return `static_cast<${castType}>(${enumAccess})`;
      }
      return enumAccess;
    }
    // Use C++ scope-resolution operator (::) for namespace member access.
    if (expr.object.kind === "identifier" && this.namespaceNames.has(expr.object.value)) {
      return `${objStr}::${expr.property}`;
    }
    if (expr.property === "size" || expr.property === "length") {
      if (expr.object.kind === "identifier" && this.stringVarNames?.has(expr.object.value)) {
        return `strlen(${objStr})`;
      }
    }
    const rendered = `${objStr}.${expr.property}`;
    return this.fixPointerAccess(rendered);
  }

  private renderTypehalCall(expr: Extract<ExpressionIR, { kind: "typehal-call" }>, exprTransformer?: (expr: string) => string): string {
    const renderA = (e: ExpressionIR) => this.render(e, exprTransformer);
    const translated = this.strategy.tryRenderTypehalCall(
      expr.receiver, 
      expr.receiverKind, 
      expr.method, 
      expr.args, 
      renderA, 
      this.boardConstants,
      expr.interruptMode
    );
    if (translated !== undefined) return translated;
    // Fallback: render as plain method call
    return `${expr.receiver}.${expr.method}(${expr.args.map(renderA).join(", ")})`;
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
      return `[=](${params})${ret} { return ${this.render((expr.body[0] as any).value, exprTransformer)}; }`;
    }
    return `[=](${params})${ret} { /* body */ }`;
  }

  private renderMethodCall(expr: Extract<ExpressionIR, { kind: "method-call" }>, exprTransformer?: (expr: string) => string): string {
    const argsText = expr.args.map(a => this.render(a, exprTransformer)).join(", ");
    let callee = exprTransformer ? exprTransformer(expr.callee) : expr.callee;
    const escapedStringVarNames = new Set(Array.from(this.stringVarNames ?? []).map(name => escapeCppKeyword(name)));
    const stringVarNames = this.stringVarNames ?? new Set();
    const cArrayNames = this.cArrayVarNames ?? new Set();
    callee = callee.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\.(?:length|size)$/g, (match, varName) => {
      if (stringVarNames.has(varName) || escapedStringVarNames.has(varName)) return `strlen(${varName})`;
      if (cArrayNames.has(varName)) return `(sizeof(${varName}) / sizeof(${varName}[0]))`;
      return match;
    });
    if (/\b([A-Za-z_][A-Za-z0-9_]*)\.(?:length|size)$/g.test(callee)) {
      return callee;
    }
    return this.fixPointerAccess(`${callee}(${argsText})`);
  }

  private fixPointerAccess(code: string): string {
    if (this.pointerVarTypes) {
      for (const [varName, varType] of this.pointerVarTypes) {
        if (varType.endsWith("*")) {
          code = code.replace(new RegExp(`\\b${varName}\\.`, "g"), `${varName}->`);
        }
      }
    }
    return code;
  }
}

/**
 * Returns the C++ operator precedence for precedence-aware parenthesization.
 * Higher number = higher precedence (binds tighter).
 */
function operatorPrecedence(op: string): number {
  switch (op) {
    case "*": case "/": case "%": return 5;
    case "+": case "-": return 4;
    case "<<": case ">>": return 3;
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
    .replace(/===/g, "==")
    .replace(/!==/g, "!=");

  // Convert TypeScript-style enum member access (EnumType.MEMBER_NAME) to C++ scoped
  // enum access (EnumType::MEMBER_NAME).  The pattern matches an identifier followed by
  // a dot followed by an ALL_CAPS name (2+ uppercase letters at the start), which is the
  // naming convention for enum class members.  Pin aliases like D0, D1 (single uppercase
  // letter + digits) are intentionally excluded because they don't start with 2+ uppercase
  // letters.
  normalized = normalized.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Z]{2,}[A-Z0-9_]*)\b/g,
    "$1::$2"
  );

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