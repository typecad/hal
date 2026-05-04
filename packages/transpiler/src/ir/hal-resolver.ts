import fs from "fs";
import path from "path";
import ts from "typescript";
import { parseSource } from "../ast/parse";
import { requiredIncludes, registeredCallbacks, getCurrentBoardConstants } from "./build-ir-state";
import { ExpressionIR } from "./model";
import { renderExprAsText } from "./render-expr";

// ---------------------------------------------------------------------------
// HAL Method Resolver — reads HAL TypeScript source files and resolves method
// calls by processing the emit()/include() calls in their method bodies.
// ---------------------------------------------------------------------------

export interface HALInstance {
  className: string;
  fieldValues: Map<string, string>; // "_pin" → "LED_BUILTIN"
}

export interface HALMethodEntry {
  methodNode: ts.MethodDeclaration;
  paramNames: string[];
}

interface HALClassEntry {
  ctorFieldMap: Map<string, string>; // "_pin" → param name "pin" or "__literal__value"
  ctorDefaults: Map<string, string>; // "_pin" → literal default value
  methods: Map<string, HALMethodEntry>;
}

// Unified instance tracking for all HAL classes
export const halInstances = new Map<string, HALInstance>();

// Registry of HAL class method ASTs, keyed by class name
const halClassRegistry = new Map<string, HALClassEntry>();

// Guard: only load once per process
let halModulesLoaded = false;

// HAL source files to load
const HAL_SOURCE_FILES = [
  "gpio.ts",
  "i2c.ts",
  "spi.ts",
  "uart.ts",
  "eeprom.ts",
  "wdt.ts",
  "adc.ts",
];

/** Resolve the HAL source directory. */
function resolveHALSourceDir(): string {
  // Monorepo: transpiler/dist/ir/ → ../../../typehal/src/
  const monoPath = path.resolve(__dirname, "..", "..", "..", "typehal", "src");
  if (fs.existsSync(path.join(monoPath, "gpio.ts"))) return monoPath;

  // Try npm package resolution
  try {
    const pkgDir = path.dirname(require.resolve("@typehal/typehal/package.json"));
    const npmPath = path.join(pkgDir, "src");
    if (fs.existsSync(path.join(npmPath, "gpio.ts"))) return npmPath;
  } catch {}

  throw new Error("Could not resolve @typehal/typehal/src/");
}

/** Extract constructor field mappings: which `this._field = param` assignments exist. */
function extractCtorFieldMap(ctor: ts.ConstructorDeclaration): { fieldMap: Map<string, string>; defaults: Map<string, string> } {
  const fieldMap = new Map<string, string>();
  const defaults = new Map<string, string>();
  if (!ctor.body) return { fieldMap, defaults };

  for (const stmt of ctor.body.statements) {
    if (
      ts.isExpressionStatement(stmt) &&
      ts.isBinaryExpression(stmt.expression) &&
      stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const left = stmt.expression.left;
      const right = stmt.expression.right;
      if (
        ts.isPropertyAccessExpression(left) &&
        (left.expression.kind === ts.SyntaxKind.ThisKeyword ||
          (ts.isIdentifier(left.expression) && left.expression.text === "this"))
      ) {
        // this._field = paramName (constructor parameter)
        if (ts.isIdentifier(right)) {
          fieldMap.set(left.name.text, right.text);
        }
        // this._field = "stringLiteral" (default value)
        if (ts.isStringLiteral(right)) {
          fieldMap.set(left.name.text, "__literal__" + right.text);
          defaults.set(left.name.text, right.text);
        }
      }
    }
    // include("...") in constructor body
    if (
      ts.isExpressionStatement(stmt) &&
      ts.isCallExpression(stmt.expression) &&
      ts.isIdentifier(stmt.expression.expression) &&
      stmt.expression.expression.text === "include"
    ) {
      const firstArg = stmt.expression.arguments[0];
      if (firstArg && ts.isStringLiteral(firstArg)) {
        // Constructor includes are registered when instances are created
        // Store as a special field so processCtorIncludes can find them
      }
    }
  }
  return { fieldMap, defaults };
}

/** Extract include() calls from a constructor body. */
function extractCtorIncludes(ctor: ts.ConstructorDeclaration | undefined): string[] {
  const includes: string[] = [];
  if (!ctor?.body) return includes;

  for (const stmt of ctor.body.statements) {
    if (
      ts.isExpressionStatement(stmt) &&
      ts.isCallExpression(stmt.expression) &&
      ts.isIdentifier(stmt.expression.expression) &&
      stmt.expression.expression.text === "include"
    ) {
      const firstArg = stmt.expression.arguments[0];
      if (firstArg && ts.isStringLiteral(firstArg)) {
        includes.push(firstArg.text);
      }
    }
  }
  return includes;
}

// Store constructor includes per class
const halCtorIncludes = new Map<string, string[]>();

/** Extract method entries from a class declaration. */
function extractMethods(cls: ts.ClassDeclaration): Map<string, HALMethodEntry> {
  const methods = new Map<string, HALMethodEntry>();
  for (const member of cls.members) {
    if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const methodName = member.name.text;
      const paramNames = (member.parameters ?? []).map(p =>
        ts.isIdentifier(p.name) ? p.name.text : "",
      );
      methods.set(methodName, { methodNode: member, paramNames });
    }
  }
  return methods;
}

/** Load and parse all HAL source files. Idempotent. */
export function loadHALModules(): void {
  if (halModulesLoaded) return;
  halModulesLoaded = true;

  try {
    const srcDir = resolveHALSourceDir();

    for (const fileName of HAL_SOURCE_FILES) {
      const filePath = path.join(srcDir, fileName);
      if (!fs.existsSync(filePath)) continue;
      const source = fs.readFileSync(filePath, "utf-8");
      const sourceFile = parseSource(fileName, source);

      for (const stmt of sourceFile.statements) {
        if (ts.isClassDeclaration(stmt) && stmt.name) {
          const className = stmt.name.text;
          const ctor = stmt.members.find(ts.isConstructorDeclaration) as
            | ts.ConstructorDeclaration
            | undefined;
          const { fieldMap: ctorFieldMap, defaults: ctorDefaults } = ctor ? extractCtorFieldMap(ctor) : { fieldMap: new Map<string, string>(), defaults: new Map<string, string>() };
          const ctorIncludes = extractCtorIncludes(ctor);
          const methods = extractMethods(stmt);
          halClassRegistry.set(className, { ctorFieldMap, ctorDefaults, methods });
          if (ctorIncludes.length > 0) {
            halCtorIncludes.set(className, ctorIncludes);
          }
        }
      }
    }
  } catch (e) {
    console.warn("[hal-resolver] Failed to load HAL modules:", (e as Error).message);
  }
}

/** Get constructor includes for a HAL class. */
export function getCtorIncludes(className: string): string[] {
  return halCtorIncludes.get(className) ?? [];
}

/** Resolve a call receiver to a tracked HAL instance. */
export function resolveHALReceiver(receiver: ts.Expression): HALInstance | null {
  // Variable reference: led.method()
  if (ts.isIdentifier(receiver)) {
    const inst = halInstances.get(receiver.text);
    if (inst) return inst;

    // Bare-name fallbacks for well-known singleton instances
    const bareNameMap: Record<string, { className: string; fieldValues: Map<string, string>; includes?: string[] }> = {
      EEPROM: { className: "EEPROMClass", fieldValues: new Map([["_name", "EEPROM"]]), includes: ["<EEPROM.h>"] },
      WDT: { className: "WDTClass", fieldValues: new Map() },
      ADC: { className: "ADCClass", fieldValues: new Map([["_reference", "DEFAULT"]]) },
    };
    const bare = bareNameMap[receiver.text];
    if (bare) {
      if (bare.includes) {
        for (const inc of bare.includes) requiredIncludes.add(inc);
      }
      // Reuse cached instance so state updates (e.g. ADC._reference) persist
      const cached = halInstances.get(receiver.text);
      if (cached) return cached;
      halInstances.set(receiver.text, bare);
      return bare;
    }

    // Pattern-based fallbacks for unimported bus aliases
    const uartMatch = receiver.text.match(/^UART(\d+)$/);
    if (uartMatch) {
      const portName = uartMatch[1] === '0' ? 'Serial' : `Serial${uartMatch[1]}`;
      return { className: "SerialPort", fieldValues: new Map([["_port", portName]]) };
    }
    const i2cMatch = receiver.text.match(/^I2C(\d+)$/);
    if (i2cMatch) {
      const busName = i2cMatch[1] === '0' ? 'Wire' : `Wire${i2cMatch[1]}`;
      return { className: "I2CBus", fieldValues: new Map([["_bus", busName]]) };
    }
    const spiMatch = receiver.text.match(/^SPI(\d+)$/);
    if (spiMatch) {
      const busName = spiMatch[1] === '0' ? 'SPI' : `SPI${spiMatch[1]}`;
      return { className: "SPIBus", fieldValues: new Map([["_bus", busName]]) };
    }

    // D-pin and A-pin bare-name fallbacks
    const dMatch = receiver.text.match(/^D(\d+)$/);
    if (dMatch) {
      return { className: "Pin", fieldValues: new Map([["_pin", dMatch[1]]]) };
    }
    const aMatch = receiver.text.match(/^A(\d+)$/);
    if (aMatch) {
      return { className: "Pin", fieldValues: new Map([["_pin", aMatch[1]]]) };
    }
  }

  // Inline new expression: new Pin(x).method()
  if (ts.isNewExpression(receiver) && ts.isIdentifier(receiver.expression)) {
    const className = receiver.expression.text;
    const classEntry = halClassRegistry.get(className);
    if (!classEntry) return null;

    const args = receiver.arguments as ts.NodeArray<ts.Expression> | undefined;
    const fieldValues = resolveCtorFieldValues(classEntry.ctorFieldMap, args, classEntry.ctorDefaults);
    if (fieldValues) {
      return { className, fieldValues };
    }
  }

  return null;
}

/** Build field values from constructor arguments using the field mapping.
 *  Falls back to literal defaults from the constructor body when no arg is provided. */
function resolveCtorFieldValues(
  ctorFieldMap: Map<string, string>,
  args: ts.NodeArray<ts.Expression> | undefined,
  ctorDefaults?: Map<string, string>,
): Map<string, string> | null {
  const fieldValues = new Map<string, string>();
  const argArr = args ?? [];

  // Track which param names are from literal defaults (skip them for arg matching)
  const literalFields = new Set<string>();
  for (const [fieldName, paramName] of ctorFieldMap) {
    if (paramName.startsWith("__literal__")) {
      literalFields.add(fieldName);
      const defaultVal = ctorDefaults?.get(fieldName);
      if (defaultVal !== undefined) {
        fieldValues.set(fieldName, defaultVal);
      }
    }
  }

  // Match remaining fields to constructor arguments
  const paramFields = Array.from(ctorFieldMap.entries()).filter(([f]) => !literalFields.has(f));
  for (const [fieldName, paramName] of paramFields) {
    const paramIdx = paramFields.findIndex(([, p]) => p === paramName);
    if (paramIdx === -1 || paramIdx >= argArr.length) continue;
    const arg = argArr[paramIdx];
    if (ts.isIdentifier(arg)) {
      fieldValues.set(fieldName, arg.text);
    } else if (ts.isNumericLiteral(arg)) {
      fieldValues.set(fieldName, arg.text);
    } else if (ts.isStringLiteral(arg)) {
      fieldValues.set(fieldName, arg.text);
    } else if (ts.isPropertyAccessExpression(arg)) {
      fieldValues.set(fieldName, arg.getText());
    } else {
      return null;
    }
  }
  return fieldValues;
}

/** Resolve a template expression with field/param substitution. */
function resolveTemplateLiteral(
  node: ts.Expression,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
): string | null {
  if (ts.isStringLiteral(node)) {
    return node.text;
  }

  if (ts.isTemplateExpression(node)) {
    let result = node.head.text;
    for (const span of node.templateSpans) {
      const resolved = resolveExpressionText(span.expression, instance, paramNames, callArgTexts);
      if (resolved === null) return null;
      result += resolved + span.literal.text;
    }
    return result;
  }

  return resolveExpressionText(node, instance, paramNames, callArgTexts);
}

/** Resolve an arbitrary expression to its text form, with this/param substitution. */
function resolveExpressionText(
  expr: ts.Expression,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
): string | null {
  // this._field → look up in instance
  // OtherInstance._field → look up in tracked halInstances (cross-instance reference)
  if (ts.isPropertyAccessExpression(expr)) {
    const isThis = expr.expression.kind === ts.SyntaxKind.ThisKeyword
      || (ts.isIdentifier(expr.expression) && expr.expression.text === "this");
    if (isThis) {
      const val = instance.fieldValues.get(expr.name.text);
      return val ?? null;
    }
    // Cross-instance field reference: e.g. ADC._reference → look up tracked instance
    if (ts.isIdentifier(expr.expression)) {
      let crossInst = halInstances.get(expr.expression.text);
      // Fall back to bare-name defaults if not yet cached
      if (!crossInst && expr.expression.text === "ADC") {
        crossInst = { className: "ADCClass", fieldValues: new Map([["_reference", "DEFAULT"]]) };
      }
      if (crossInst) {
        const val = crossInst.fieldValues.get(expr.name.text);
        if (val !== undefined) return val;
      }
    }
    const obj = resolveExpressionText(expr.expression, instance, paramNames, callArgTexts);
    if (obj === null) return null;
    return `${obj}.${expr.name.text}`;
  }

  // Identifier → parameter or constant
  if (ts.isIdentifier(expr)) {
    const paramIdx = paramNames.indexOf(expr.text);
    if (paramIdx !== -1 && paramIdx < callArgTexts.length) {
      return callArgTexts[paramIdx];
    }
    return expr.text;
  }

  if (ts.isNumericLiteral(expr)) return expr.text;
  if (ts.isStringLiteral(expr)) return expr.text;

  // Call expression (e.g., digitalRead(this._pin), board("path"))
  if (ts.isCallExpression(expr)) {
    // callback(param) → return the patched placeholder text
    if (ts.isIdentifier(expr.expression) && expr.expression.text === "callback") {
      const cbArg = expr.arguments[0];
      if (cbArg && ts.isIdentifier(cbArg)) {
        const paramIdx = paramNames.indexOf(cbArg.text);
        if (paramIdx !== -1 && paramIdx < callArgTexts.length) {
          return callArgTexts[paramIdx];
        }
      }
      return null;
    }

    // board("path") → look up in current board constants
    if (ts.isIdentifier(expr.expression) && expr.expression.text === "board") {
      const pathArg = expr.arguments[0];
      // Static string literal path: board("peripherals.adc.0.resolution")
      if (pathArg && ts.isStringLiteral(pathArg)) {
        const bc = getCurrentBoardConstants();
        if (bc) {
          const val = bc.get(pathArg.text);
          if (val !== undefined) return String(val);
        }
      }
      // Dynamic path via string concat: board("prefix." + this._field)
      if (pathArg && ts.isBinaryExpression(pathArg) && pathArg.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = resolveExpressionText(pathArg.left, instance, paramNames, callArgTexts);
        const right = resolveExpressionText(pathArg.right, instance, paramNames, callArgTexts);
        if (left !== null && right !== null) {
          const fullPath = left + right;
          const bc = getCurrentBoardConstants();
          if (bc) {
            const val = bc.get(fullPath);
            if (val !== undefined) return String(val);
          }
        }
      }
      return null;
    }

    const callee = resolveExpressionText(expr.expression as ts.Expression, instance, paramNames, callArgTexts);
    if (callee === null) return null;
    const args: string[] = [];
    for (const a of expr.arguments) {
      const resolved = resolveExpressionText(a as ts.Expression, instance, paramNames, callArgTexts);
      if (resolved === null) return null;
      args.push(resolved);
    }
    return `${callee}(${args.join(", ")})`;
  }

  // Binary expression
  if (ts.isBinaryExpression(expr)) {
    const left = resolveExpressionText(expr.left, instance, paramNames, callArgTexts);
    const right = resolveExpressionText(expr.right, instance, paramNames, callArgTexts);
    if (left === null || right === null) return null;
    return `${left} ${expr.operatorToken.getText()} ${right}`;
  }

  // Type assertion: this as any → unwrap to inner expression
  if (ts.isAsExpression(expr)) {
    return resolveExpressionText(expr.expression, instance, paramNames, callArgTexts);
  }

  return expr.getText ? expr.getText() : null;
}

/** Scan an expression AST for callback() calls, extract callback IR from callArgs,
 *  register them, and patch callArgTexts with placeholder names. */
function extractAndRegisterCallbacks(
  expr: ts.Expression,
  paramNames: string[],
  callArgs: ExpressionIR[],
  callArgTexts: string[],
): void {
  function scan(node: ts.Expression): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "callback") {
      const cbArg = node.arguments[0];
      if (cbArg && ts.isIdentifier(cbArg)) {
        const paramIdx = paramNames.indexOf(cbArg.text);
        if (paramIdx !== -1 && paramIdx < callArgs.length) {
          const callbackIR = callArgs[paramIdx];
          if (callbackIR.kind === "callback") {
            const placeholder = `__CALLBACK_${callbackPlaceholderCounter++}__`;
            (callbackIR as any).isInterruptHandler = true;
            registeredCallbacks.push({ placeholderName: placeholder, callbackIR });
            callArgTexts[paramIdx] = placeholder;
          }
        }
      }
    }
    if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) {
        scan(span.expression);
      }
    }
  }
  scan(expr);
}

/** Process a HAL method body, resolving emit()/include() calls.
 *  Returns { emitLines, returnValue, returnClassName } or null if unresolvable. */
export function processHALMethodBody(
  instance: HALInstance,
  methodName: string,
  callArgs: ExpressionIR[],
): { emitLines: string[]; returnValue?: string; returnClassName?: string } | null {
  const classEntry = halClassRegistry.get(instance.className);
  if (!classEntry) return null;

  let methodEntry = classEntry.methods.get(methodName);
  // Fallback: search other HAL classes for the method (e.g., Pin instance calling InputPin.onFalling)
  if (!methodEntry) {
    for (const [, entry] of halClassRegistry) {
      const found = entry.methods.get(methodName);
      if (found && found.methodNode.body) {
        methodEntry = found;
        break;
      }
    }
  }
  if (!methodEntry || !methodEntry.methodNode.body) return null;

  const paramNames = methodEntry.paramNames;
  const callArgTexts = callArgs.map(a => renderExprAsText(a));
  const body = methodEntry.methodNode.body;

  const emitLines: string[] = [];

  // For string_concat args (template literals), generate snprintf instead of
  // C++ + concatenation which is invalid for char* on Arduino.
  for (let i = 0; i < callArgs.length; i++) {
    const arg = callArgs[i];
    if (arg.kind === "string_concat" && arg.parts.some(p => p.kind !== "string")) {
      const snprintf = buildSnprintfFromConcat(arg);
      if (snprintf) {
        emitLines.push(...snprintf.lines);
        callArgTexts[i] = snprintf.bufferName;
      }
    }
  }
  let returnValue: string | undefined;

  for (const stmt of body.statements) {
    // this._field = param — track field updates on the instance
    if (
      ts.isExpressionStatement(stmt) &&
      ts.isBinaryExpression(stmt.expression) &&
      stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const left = stmt.expression.left;
      const right = stmt.expression.right;
      if (
        ts.isPropertyAccessExpression(left) &&
        (left.expression.kind === ts.SyntaxKind.ThisKeyword ||
          (ts.isIdentifier(left.expression) && left.expression.text === "this"))
      ) {
        const fieldName = left.name.text;
        const resolved = resolveExpressionText(right, instance, paramNames, callArgTexts);
        if (resolved !== null) {
          instance.fieldValues.set(fieldName, resolved);
        }
      }
    }

    // emit(...) call
    if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
      const call = stmt.expression;
      if (ts.isIdentifier(call.expression) && call.expression.text === "emit") {
        const templateArg = call.arguments[0];
        if (templateArg) {
          // Extract callbacks from template and patch callArgTexts with placeholders
          extractAndRegisterCallbacks(templateArg as ts.Expression, paramNames, callArgs, callArgTexts);

          const resolved = resolveTemplateLiteral(
            templateArg as ts.Expression,
            instance,
            paramNames,
            callArgTexts,
          );
          if (resolved !== null) {
            // Convention: emit("return EXPR") means this is a return value expression
            if (resolved.startsWith("return ")) {
              const returnExpr = resolved.slice(7).replace(/;$/, "");
              returnValue = returnExpr;
            } else {
              emitLines.push(resolved);
            }
          }
        }
        continue;
      }

      // include(...) call
      if (ts.isIdentifier(call.expression) && call.expression.text === "include") {
        const firstArg = call.arguments[0];
        if (firstArg && ts.isStringLiteral(firstArg)) {
          requiredIncludes.add(firstArg.text);
        }
        continue;
      }
    }

    // if statement (e.g., WDT.enable with optional timeout)
    if (ts.isIfStatement(stmt)) {
      if (stmt.thenStatement) {
        const returnRef = returnValue !== undefined ? undefined : { value: "" };
        processStatementList(
          ts.isBlock(stmt.thenStatement) ? (stmt.thenStatement as ts.Block).statements : [stmt.thenStatement as ts.Statement],
          instance, paramNames, callArgTexts, emitLines, returnRef,
        );
        if (returnRef && returnRef.value) returnValue = returnRef.value;
      }
      continue;
    }

    // return expr — only set if not already set by emit("return EXPR") convention
    if (ts.isReturnStatement(stmt) && stmt.expression && returnValue === undefined) {
      const resolved = resolveExpressionText(stmt.expression, instance, paramNames, callArgTexts);
      if (resolved !== null) {
        returnValue = resolved;
      }
    }
  }

  // Auto-passthrough for stub methods: if no emit() calls and the return is a literal
  // (e.g., return 0), construct the C++ expression as <objectName>.<method>(<args>).
  // Skip for Pin class since Pin methods use standalone C functions, not object methods.
  if (emitLines.length === 0 && isLiteralReturnValue(returnValue)
      && instance.className !== "Pin"
      && instance.className !== "OutputPin"
      && instance.className !== "InputPin") {
    const cppObj = resolveCppObjectName(instance);
    if (cppObj) {
      const argsStr = callArgTexts.join(", ");
      return { emitLines: [], returnValue: `${cppObj}.${methodName}(${argsStr})` };
    }
  }

  // Return null if nothing useful was resolved, allowing inline fallbacks to kick in
  if (emitLines.length === 0 && returnValue === undefined) {
    return null;
  }

  // Extract return type annotation to support type-narrowed pattern
  // (e.g., Pin.asOutput(): OutputPin → returnClassName = "OutputPin")
  let returnClassName: string | undefined;
  const returnType = methodEntry.methodNode.type;
  if (returnType && ts.isTypeReferenceNode(returnType) && ts.isIdentifier(returnType.typeName)) {
    const name = returnType.typeName.text;
    if (halClassRegistry.has(name) && name !== instance.className) {
      returnClassName = name;
    }
  }

  return { emitLines, returnValue, returnClassName };
}

/** Check if a return value is a literal (0, "", etc.) indicating a stub. */
function isLiteralReturnValue(val: string | undefined): boolean {
  if (val === undefined) return true;
  if (val === "0") return true;
  if (val === "''" || val === '""') return true;
  return false;
}

/** Resolve the C++ object name from a HAL instance's constructor field values. */
function resolveCppObjectName(instance: HALInstance): string | null {
  // Convention: the first constructor parameter's field is the C++ object name
  // I2CBus._bus → "Wire", SPIBus._bus → "SPI", SerialPort._port → "Serial",
  // EEPROMClass._name → "EEPROM"
  const fieldMap = halClassRegistry.get(instance.className)?.ctorFieldMap;
  if (!fieldMap) return null;

  // Get the first field value from the instance that matches a constructor field
  for (const [fieldName] of fieldMap) {
    const val = instance.fieldValues.get(fieldName);
    if (val) return val;
  }
  return null;
}

/** Process a list of statements for emit/include/return. */
function processStatementList(
  stmts: readonly ts.Statement[],
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  emitLines: string[],
  returnExpr?: { value: string },
): void {
  for (const stmt of stmts) {
    if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
      const call = stmt.expression;
      if (ts.isIdentifier(call.expression) && call.expression.text === "emit") {
        const templateArg = call.arguments[0];
        if (templateArg) {
          const resolved = resolveTemplateLiteral(
            templateArg as ts.Expression, instance, paramNames, callArgTexts,
          );
          if (resolved !== null) {
            if (resolved.startsWith("return ") && returnExpr) {
              returnExpr.value = resolved.slice(7).replace(/;$/, "");
            } else {
              emitLines.push(resolved);
            }
          }
        }
      } else if (ts.isIdentifier(call.expression) && call.expression.text === "include") {
        const firstArg = call.arguments[0];
        if (firstArg && ts.isStringLiteral(firstArg)) {
          requiredIncludes.add(firstArg.text);
        }
      }
    }
  }
}

/** Check if a class name is a known HAL class in the registry. */
export function isKnownHALClass(className: string): boolean {
  return halClassRegistry.has(className);
}

/** Get the constructor field map for a HAL class. */
export function getHALCtorFieldMap(className: string): Map<string, string> | undefined {
  return halClassRegistry.get(className)?.ctorFieldMap;
}

/** Reset resolver state (called between builds). */
export function resetHALResolver(): void {
  halInstances.clear();
  floatVariables.clear();
  callbackPlaceholderCounter = 0;
}

let snprintfCounter = 0;
let callbackPlaceholderCounter = 0;

const floatVariables: Set<string> = new Set();

export function registerFloatVariable(name: string): void {
  floatVariables.add(name);
}

/** Build snprintf prelude lines from a string_concat expression.
 *  Returns { lines, bufferName } or null if the expression can't be formatted. */
function buildSnprintfFromConcat(
  expr: Extract<ExpressionIR, { kind: "string_concat" }>,
): { lines: string[]; bufferName: string } | null {
  let formatString = "";
  const args: string[] = [];
  let estimatedLength = 1;
  const prelude: string[] = [];

  requiredIncludes.add("<stdio.h>");

  for (const part of expr.parts) {
    const text = renderExprAsText(part);
    if (part.kind === "string") {
      formatString += text.slice(1, -1).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      estimatedLength += part.value.length;
    } else if (part.kind === "number") {
      const isFloat = part.cppType === "float" || !Number.isInteger(part.value);
      if (isFloat) {
        requiredIncludes.add("<stdlib.h>");
        const floatBuf = `__typehal_float_${snprintfCounter++}`;
        prelude.push(`char ${floatBuf}[16];`);
        prelude.push(`dtostrf(${text}, 0, 1, ${floatBuf});`);
        formatString += "%s";
        args.push(floatBuf);
        estimatedLength += 16;
      } else {
        formatString += "%d";
        args.push(text);
        estimatedLength += 12;
      }
    } else {
      // Check for float variable reference: template_string wrapping an identifier
      const isFloatVar = part.kind === "template_string"
        && part.expression.kind === "identifier"
        && floatVariables.has(part.expression.value);
      if (isFloatVar) {
        requiredIncludes.add("<stdlib.h>");
        const floatBuf = `__typehal_float_${snprintfCounter++}`;
        prelude.push(`char ${floatBuf}[16];`);
        prelude.push(`dtostrf(${text}, 0, 1, ${floatBuf});`);
        formatString += "%s";
        args.push(floatBuf);
        estimatedLength += 16;
      } else {
        const numVal = Number(text);
        if (!isNaN(numVal) && !Number.isInteger(numVal)) {
          requiredIncludes.add("<stdlib.h>");
          const floatBuf = `__typehal_float_${snprintfCounter++}`;
          const precision = text.includes(".") ? text.split(".")[1].length : 1;
          prelude.push(`char ${floatBuf}[16];`);
          prelude.push(`dtostrf(${text}, 0, ${precision}, ${floatBuf});`);
          formatString += "%s";
          args.push(floatBuf);
          estimatedLength += 16;
        } else {
          formatString += "%d";
          args.push(text);
          estimatedLength += 12;
        }
      }
    }
  }

  const bufName = `__typehal_snprintf_${snprintfCounter++}`;
  const bufSize = Math.max(estimatedLength + 1, 16);

  prelude.push(`char ${bufName}[${bufSize}];`);
  prelude.push(`snprintf(${bufName}, sizeof(${bufName}), "${formatString}", ${args.join(", ")});`);

  return { lines: prelude, bufferName: bufName };
}
