/**
 * Expression Renderer for C++ code emission.
 * Encapsulates all expression rendering logic with explicit dependencies.
 * Extracted from cpp-emitter.ts
 */

import type { ExpressionIR } from "../ir/model";
import type { PlatformStrategy } from "../platform/platform-strategy";
import type { BoardConstants } from "../ir/board-resolver";
import type { TypecodeReceiverKind } from "../ir/typecode-symbols";
import { extractPropertyChain } from "../platform/typecode-map";
import { escapeCppKeyword } from "../utils/strings";
import { accessorGetterName } from "./utils/cpp-helpers";

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
  /** Set of namespace names for scoped access (::) instead of (.) */
  namespaceNames?: Set<string>;
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
    
    switch (expr.kind) {
      case "number": {
        if (expr.cppType === "float" || !Number.isInteger(expr.value)) {
          const str = `${expr.value}`;
          return str.includes('.') || str.includes('e') || str.includes('E')
            ? `${str}f`
            : `${str}.0f`;
        }
        return `${expr.value}`;
      }
      case "string":
        return `"${expr.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
      case "boolean":
        return expr.value ? "true" : "false";
      case "identifier":
        return this.renderIdentifier(expr.value);
      case "raw":
        return this.renderRaw(expr.value, exprTransformer);
      case "await":
        return this.render(expr.value, exprTransformer);
      case "ternary":
        return this.renderTernary(expr, exprTransformer);
      case "string_concat":
        return this.renderStringConcat(expr, exprTransformer);
      case "template_string":
        return this.renderTemplateString(expr, exprTransformer);
      case "array":
        return this.renderArray(expr, exprTransformer);
      case "object":
        return this.renderObject(expr, exprTransformer);
      case "instanceof":
        return this.renderInstanceof(expr, exprTransformer);
      case "spread_array":
        return `/* spread_array: see variable declaration */`;
      case "paren":
        return `(${this.render(expr.inner, exprTransformer)})`;
      case "binary":
        return this.renderBinary(expr, exprTransformer);
      case "unary":
        return this.renderUnary(expr, exprTransformer);
      case "property-access":
        return this.renderPropertyAccess(expr, exprTransformer);
      case "typecode-call":
        return this.renderTypecodeCall(expr, exprTransformer);
      case "callback":
        return this.renderCallback(expr);
      case "lambda":
        return this.renderLambda(expr, exprTransformer);
      default:
        return "0 /* unsupported_expr */";
    }
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
        const bufferName = `__typecode_str_${++this._snprintfTempCounter}`;
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

    const bufferName = `__typecode_str_${++this._snprintfTempCounter}`;
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
      case "typecode-call":
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
    return `${objStr}.${expr.property}`;
  }

  private renderTypecodeCall(expr: Extract<ExpressionIR, { kind: "typecode-call" }>, exprTransformer?: (expr: string) => string): string {
    const renderA = (e: ExpressionIR) => this.render(e, exprTransformer);
    const translated = this.strategy.tryRenderTypecodeCall(
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
 * Render peripheral stub property access to appropriate C++ values.
 * TypeScript peripheral stubs (I2C0, SPI0, UART0) have properties like isInitialized,
 * busNumber, speed that don't exist in C++. We map them to appropriate values.
 * 
 * @param chain Property access chain (e.g., ["I2C0", "isInitialized"])
 * @returns C++ value string or undefined if not a peripheral property
 */
function renderPeripheralProperty(chain: string[]): string | undefined {
  // Must have exactly 2 parts: peripheral name and property
  if (chain.length !== 2) return undefined;
  
  const [peripheral, property] = chain;
  
  // Resolve peripheral name to C++ equivalent
  let cppPeripheral: string | undefined;
  
  // I2C buses: I2C0 -> Wire, I2C1 -> Wire1, I2C2 -> Wire2
  if (/^I2C\d+$/.test(peripheral)) {
    const num = peripheral.slice(3);
    cppPeripheral = num === '0' ? 'Wire' : `Wire${num}`;
  }
  // SPI buses: SPI0 -> SPI, SPI1 -> SPI1, SPI2 -> SPI2
  else if (/^SPI\d+$/.test(peripheral)) {
    const num = peripheral.slice(3);
    cppPeripheral = num === '0' ? 'SPI' : `SPI${num}`;
  }
  // UART ports: UART0 -> Serial, UART1 -> Serial1, UART2 -> Serial2
  else if (/^UART\d+$/.test(peripheral)) {
    const num = peripheral.slice(4);
    cppPeripheral = num === '0' ? 'Serial' : `Serial${num}`;
  }
  // Serial ports: Serial -> Serial, Serial1 -> Serial1, Serial2 -> Serial2
  else if (/^Serial\d*$/.test(peripheral)) {
    cppPeripheral = peripheral;
  }
  
  // Check if this is a known peripheral
  if (!cppPeripheral) return undefined;
  
  // Properties that exist on the C++ objects
  // For these, we can access them directly
  const directProperties = new Set(["available"]);
  
  // Properties that are compile-time stubs in TypeScript but don't exist in C++
  // These should return true (since the peripheral is initialized in setup())
  const stubProperties = new Set([
    "isInitialized", 
    "isConnected",
  ]);
  
  // Properties that are numeric constants in TypeScript
  const numericProperties = new Set([
    "busNumber", 
    "uartNumber",
  ]);
  
  if (directProperties.has(property)) {
    // These exist on the C++ object
    return `${cppPeripheral}.${property}`;
  }
  
  if (stubProperties.has(property)) {
    // These are runtime state - return true since we initialize in setup()
    // A more sophisticated solution would track initialization state
    return "true";
  }
  
  if (numericProperties.has(property)) {
    // busNumber is always 0 for the main peripheral
    if (property === "busNumber" || property === "uartNumber") {
      return "0";
    }
  }
  
  // For speed, we could return Wire.getClock() or similar, but it's runtime
  // For now, return a default standard speed
  if (property === "speed") {
    return "100000"; // 100kHz standard speed
  }
  
  return undefined;
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