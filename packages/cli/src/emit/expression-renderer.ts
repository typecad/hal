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

  constructor(context: ExpressionRendererContext) {
    this.strategy = context.strategy;
    this.boardConstants = context.boardConstants;
    this.arduinoClassNameMap = context.arduinoClassNameMap;
    this.enumNames = context.enumNames;
    this.largeEnumNames = context.largeEnumNames;
    this.knownFunctionReturnTypes = context.knownFunctionReturnTypes;
    this.pointerVarTypes = context.pointerVarTypes;
  }

  /**
   * Gets the board constants (for access by statement renderer).
   */
  getBoardConstants(): BoardConstants | undefined {
    return this.boardConstants;
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
      case "number":
        return `${expr.value}`;
      case "string":
        return `"${expr.value.replace(/"/g, '\\"')}"`;  
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
      default:
        return "/* unsupported_expr */";
    }
  }

  private renderIdentifier(value: string): string {
    const nullVal = this.strategy.nullValue();
    if (nullVal && (value === "null" || value === "undefined")) {
      return nullVal;
    }
    // Map peripheral identifiers to Arduino equivalents
    const peripheralName = value;
    if (/^I2C\d+$/.test(peripheralName)) {
      const num = peripheralName.slice(3);
      return num === '0' ? 'Wire' : `Wire${num}`;
    }
    if (/^SPI\d+$/.test(peripheralName)) {
      const num = peripheralName.slice(3);
      return num === '0' ? 'SPI' : `SPI${num}`;
    }
    if (/^UART\d+$/.test(peripheralName)) {
      const num = peripheralName.slice(4);
      return num === '0' ? 'Serial' : `Serial${num}`;
    }
    return value;
  }

  private renderRaw(value: string, exprTransformer?: (expr: string) => string): string {
    const effectiveClassNameMap = this.arduinoClassNameMap;
    if (exprTransformer) {
      return normalizeRawExpression(exprTransformer(value), this.strategy, effectiveClassNameMap);
    }
    return normalizeRawExpression(value, this.strategy, effectiveClassNameMap);
  }

  private renderTernary(expr: Extract<ExpressionIR, { kind: "ternary" }>, exprTransformer?: (expr: string) => string): string {
    return `(${this.render(expr.condition, exprTransformer)} ? ${this.render(expr.whenTrue, exprTransformer)} : ${this.render(expr.whenFalse, exprTransformer)})`;
  }

  private renderStringConcat(expr: Extract<ExpressionIR, { kind: "string_concat" }>, exprTransformer?: (expr: string) => string): string {
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
    return `String(${this.render(expr.expression, exprTransformer)})`;
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
    return `${leftRendered} ${expr.operator} ${rightRendered}`;
  }

  private renderUnary(expr: Extract<ExpressionIR, { kind: "unary" }>, exprTransformer?: (expr: string) => string): string {
    return `${expr.operator}${this.render(expr.operand, exprTransformer)}`;
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
function normalizeRawExpression(value: string, strategy: PlatformStrategy, classNameMap?: Map<string, string>): string {
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