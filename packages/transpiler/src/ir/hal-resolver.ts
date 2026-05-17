import fs from "fs";
import path from "path";
import ts from "typescript";
import { parseSource } from "../ast/parse";
import { requiredIncludes, registeredCallbacks, getCurrentBoardConstants, mcuPinForwardMap, mcuPinReverseMap, activeStringVars, activeLocalTypes, activeGlobalTypes } from "./build-ir-state";
import { ExpressionIR, HALOpIR } from "@typehal/core";
import { mapPeripheralName } from "../mapping/peripheral-names";
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
  spreadParamName?: string;
  paramDefaults: Map<string, string>;
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
const halGlobalFunctions = new Map<string, HALMethodEntry>();
const halSingletons = new Map<string, { className: string; fieldValues: Map<string, string>; includes?: string[] }>();

// Guard: only load once per process
let halModulesLoaded = false;

/** Check if an identifier name refers to a known HAL singleton or mapped peripheral. */
export function isHALSingleton(name: string): boolean {
  if (halSingletons.has(name)) return true;
  if (mapPeripheralName(name) !== undefined) return true;
  return false;
}



/** Resolve the HAL source directory. */
function resolveHALSourceDir(): string {
  const monoPath = path.resolve(__dirname, "..", "..", "..", "hal", "src");
  let res = "";
  if (fs.existsSync(path.join(monoPath, "gpio.ts"))) {
    res = monoPath;
  } else {
    try {
      const pkgDir = path.dirname(require.resolve("@typehal/hal/package.json"));
      res = path.join(pkgDir, "src");
    } catch {}
  }
  if (!res) throw new Error("Could not resolve @typehal/hal/src/");
  return res;
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

/** Extract parameter names and defaults from a function-like node. */
function extractParams(node: ts.FunctionLikeDeclarationBase): { paramNames: string[], spreadParamName?: string, paramDefaults: Map<string, string> } {
  const paramNames: string[] = [];
  const paramDefaults = new Map<string, string>();
  for (const p of node.parameters) {
    if (ts.isIdentifier(p.name)) {
      const name = p.name.text;
      paramNames.push(name);
      if (p.initializer) {
        if (ts.isNumericLiteral(p.initializer)) paramDefaults.set(name, p.initializer.text);
        else if (ts.isStringLiteral(p.initializer)) paramDefaults.set(name, `"${p.initializer.text}"`);
        else if (p.initializer.kind === ts.SyntaxKind.TrueKeyword) paramDefaults.set(name, "true");
        else if (p.initializer.kind === ts.SyntaxKind.FalseKeyword) paramDefaults.set(name, "false");
      }
    }
  }
  const spreadParam = node.parameters.find(p => !!p.dotDotDotToken);
  const spreadParamName = spreadParam && ts.isIdentifier(spreadParam.name) ? spreadParam.name.text : undefined;
  return { paramNames, spreadParamName, paramDefaults };
}

// Store constructor includes per class
const halCtorIncludes = new Map<string, string[]>();

/** Extract method entries from a class declaration. */
function extractMethods(cls: ts.ClassDeclaration): Map<string, HALMethodEntry> {
  const methods = new Map<string, HALMethodEntry>();
  for (const member of cls.members) {
    if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const methodName = member.name.text;
      const { paramNames, spreadParamName, paramDefaults } = extractParams(member);
      methods.set(methodName, { methodNode: member, paramNames, spreadParamName, paramDefaults });
    }
  }
  return methods;
}

/** Load and parse all HAL source files. Dynamic discovery. */
export function loadHALModules(force = false): void {
  if (halModulesLoaded && !force) return;
  halModulesLoaded = true;

  if (force) {
    halClassRegistry.clear();
    halCtorIncludes.clear();
    halSingletons.clear();
  }

  try {
    const srcDir = resolveHALSourceDir();
    const files = fs.readdirSync(srcDir).filter(f => f.endsWith(".ts") && f !== "index.ts");

    for (const fileName of files) {
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
          
          // Metadata extraction for singletons
          let instanceName: string | undefined;
          let includes: string[] | undefined;
          const defaultFields = new Map<string, string>();

          for (const member of stmt.members) {
            if (ts.isPropertyDeclaration(member) && 
                member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) &&
                ts.isIdentifier(member.name)) {
              if (member.name.text === "__instance_name" && member.initializer && ts.isStringLiteral(member.initializer)) {
                instanceName = member.initializer.text;
              }
              if (member.name.text === "__includes" && member.initializer && ts.isArrayLiteralExpression(member.initializer)) {
                includes = member.initializer.elements.filter(ts.isStringLiteral).map(e => e.text);
              }
              if (member.name.text === "__default_fields" && member.initializer && ts.isObjectLiteralExpression(member.initializer)) {
                for (const prop of member.initializer.properties) {
                  if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && ts.isStringLiteral(prop.initializer)) {
                    defaultFields.set(prop.name.text, prop.initializer.text);
                  }
                }
              }
            }
          }

          halClassRegistry.set(className, { ctorFieldMap, ctorDefaults, methods });

          if (instanceName) {
            halSingletons.set(instanceName, { className, fieldValues: defaultFields, includes });
          }
          if (ctorIncludes.length > 0) {
            halCtorIncludes.set(className, ctorIncludes);
          }
        } else if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
          const functionName = stmt.name.text;
          const { paramNames, spreadParamName, paramDefaults } = extractParams(stmt);
          halGlobalFunctions.set(functionName, { methodNode: stmt as any, paramNames, spreadParamName, paramDefaults });
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

    // Metadata-driven singleton resolution (e.g., ADC, EEPROM, WDT)
    const singleton = halSingletons.get(receiver.text);
    if (singleton) {
      if (singleton.includes) {
        for (const inc of singleton.includes) requiredIncludes.add(inc);
      }
      // Reuse cached instance so state updates (e.g. ADC._reference) persist
      const cached = halInstances.get(receiver.text);
      if (cached) return cached;
      const inst = { className: singleton.className, fieldValues: new Map(singleton.fieldValues) };
      halInstances.set(receiver.text, inst);
      return inst;
    }

    const name = receiver.text;
    const bc = getCurrentBoardConstants();

    // Board-defined peripheral aliases (e.g., UART0 -> Serial)
    // Consolidates both canonical (UART0) and platform (Serial) names via the manifest.
    const mappedName = mapPeripheralName(name);
    if (mappedName) {
      const canonical = name.toUpperCase();
      if (canonical.startsWith("UART")) return { className: "SerialPort", fieldValues: new Map([["_port", mappedName]]) };
      if (canonical.startsWith("I2C")) return { className: "I2CBus", fieldValues: new Map([["_bus", mappedName]]) };
      if (canonical.startsWith("SPI")) return { className: "SPIBus", fieldValues: new Map([["_bus", mappedName]]) };
    }

    // Bare pin resolution (D0, A0, etc.) — enriched with MCU port name
    const dMatch = name.match(/^D(\d+)$/);
    if (dMatch) {
      const arduinoPin = dMatch[1];
      const portName = mcuPinReverseMap.get(arduinoPin);
      const fields: Map<string, string> = new Map([["_pin", arduinoPin]]);
      if (portName) fields.set("_port", portName);
      const inst = { className: "Pin", fieldValues: fields };
      halInstances.set(name, inst);
      return inst;
    }
    const aMatch = name.match(/^A(\d+)$/);
    if (aMatch) {
      const offset = Number(bc.get("pins.analogOffset") ?? 0);
      const pinNum = String(Number(aMatch[1]) + offset);
      const portName = mcuPinReverseMap.get(pinNum);
      const fields: Map<string, string> = new Map([["_pin", pinNum]]);
      if (portName) fields.set("_port", portName);
      const inst = { className: "Pin", fieldValues: fields };
      halInstances.set(name, inst);
      return inst;
    }

    const timerMatch = name.match(/^Timer(\d+)$/);
    if (timerMatch) {
      return { className: "HardwareTimer", fieldValues: new Map([["_instance", timerMatch[1]]]) };
    }
  }

  // Chained call result: new Pin(13).asOutput()
  // Also handles static factory calls: Pin.fromPort("PB5")
  if (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression)) {
    // Static factory: Pin.fromPort("PB5") → Pin with _port field
    if (ts.isIdentifier(receiver.expression.expression) &&
        receiver.expression.expression.text === 'Pin' &&
        receiver.expression.name.text === 'fromPort') {
      const factoryArgs = (receiver as ts.CallExpression).arguments;
      if (factoryArgs && factoryArgs.length > 0 && ts.isStringLiteral(factoryArgs[0])) {
        const portName = factoryArgs[0].text;
        // Resolve Arduino pin number from MCU forward map
        const arduinoPin = mcuPinForwardMap.get(portName) ?? '-1';
        return { className: 'Pin', fieldValues: new Map([['_port', portName], ['_pin', arduinoPin]]) };
      }
    }

    const innerInstance = resolveHALReceiver(receiver.expression.expression);
    if (innerInstance) {
      const methodName = receiver.expression.name.text;
      // Specialized handling for Pin chaining (Pin -> OutputPin/InputPin)
      if (innerInstance.className === "Pin" && (methodName === "asOutput" || methodName === "asInput" || methodName === "asInputPullUp")) {
        const returnClassName = methodName === "asOutput" ? "OutputPin" : "InputPin";
        return { className: returnClassName, fieldValues: new Map(innerInstance.fieldValues) };
      }

      // Specialized handling for device() factory pattern (I2CBus/SPIBus -> I2CDevice/SPIDevice)
      // This allows propagating the address/CS pin from the call argument to the new instance.
      if (methodName === "device" && (innerInstance.className === "I2CBus" || innerInstance.className === "SPIBus") && receiver.arguments.length > 0) {
        const returnClassName = innerInstance.className === "SPIBus" ? "SPIDevice" : "I2CDevice";
        const fieldValues = new Map(innerInstance.fieldValues);
        const arg = receiver.arguments[0];
        let argVal: string | null = null;
        if (ts.isNumericLiteral(arg)) argVal = arg.text;
        else if (ts.isIdentifier(arg)) {
          // Check halInstances first (e.g. D10)
          const argInst = halInstances.get(arg.text);
          if (argInst && argInst.fieldValues.has("_pin")) argVal = argInst.fieldValues.get("_pin")!;
          else argVal = arg.text;
        }
        if (argVal) {
          const fieldName = innerInstance.className === "SPIBus" ? "_cs" : "_address";
          fieldValues.set(fieldName, argVal);
          return { className: returnClassName, fieldValues };
        }
      }

      // Specialized handling for tone() chaining (OutputPin -> ToneChain)
      if (methodName === "tone" && innerInstance.className === "OutputPin" && receiver.arguments.length > 0) {
        const fieldValues = new Map(innerInstance.fieldValues);
        const arg = receiver.arguments[0];
        let argVal: string | null = null;
        if (ts.isNumericLiteral(arg)) argVal = arg.text;
        else if (ts.isIdentifier(arg)) argVal = arg.text;
        
        if (argVal) {
          fieldValues.set("_lastFreq", argVal);
          return { className: "ToneChain", fieldValues };
        }
      }

      // General fallback: if the method is known to return another HAL class, carry over fields
      const classEntry = halClassRegistry.get(innerInstance.className);
      const methodEntry = classEntry?.methods.get(methodName);
      if (methodEntry && methodEntry.methodNode.type && ts.isTypeReferenceNode(methodEntry.methodNode.type) && ts.isIdentifier(methodEntry.methodNode.type.typeName)) {
        const returnClassName = methodEntry.methodNode.type.typeName.text;
        if (halClassRegistry.has(returnClassName)) {
          return { className: returnClassName, fieldValues: new Map(innerInstance.fieldValues) };
        }
      }
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

/** Resolve an arbitrary expression to its text form, with this/param substitution. */
function resolveExpressionText(
  expr: ts.Expression,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults?: Map<string, string>,
): string | null {
  // this._field → look up in instance
  // OtherInstance._field → look up in tracked halInstances (cross-instance reference)
  if (ts.isPropertyAccessExpression(expr)) {
    const isThis = expr.expression.kind === ts.SyntaxKind.ThisKeyword
      || (ts.isIdentifier(expr.expression) && expr.expression.text === "this")
      || expr.expression.getText() === "this";
    if (isThis) {
      const fieldName = expr.name.text;
      const val = instance.fieldValues.get(fieldName) ?? instance.fieldValues.get(fieldName.startsWith("_") ? fieldName.slice(1) : "_" + fieldName);
      if (val !== undefined && val !== null) return val;
      
      // Fallback: try to see if it's a known field that should be mapped
      if (fieldName === "_pin" && instance.fieldValues.has("pin")) return instance.fieldValues.get("pin")!;
      if (fieldName === "_bus" && instance.fieldValues.has("bus")) return instance.fieldValues.get("bus")!;

      return `this->${fieldName}`;
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
    const obj = resolveExpressionText(expr.expression, instance, paramNames, callArgTexts, paramDefaults);
    if (obj === null) return null;
    return `${obj}.${expr.name.text}`;
  }

  // Identifier → parameter or constant
  if (ts.isIdentifier(expr)) {
    const paramIdx = paramNames.indexOf(expr.text);
    if (paramIdx !== -1) {
      if (paramIdx < callArgTexts.length) {
        const isSpread = expr.text === (instance as any)._spreadParamName;
        if (isSpread) {
          const spreadArgs = callArgTexts.slice(paramIdx);
          return spreadArgs.join(", ");
        }
        return callArgTexts[paramIdx];
      } else if (paramDefaults?.has(expr.text)) {
        return paramDefaults.get(expr.text)!;
      }
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

    const callee = resolveExpressionText(expr.expression, instance, paramNames, callArgTexts, paramDefaults);
    if (callee === null) return null;
    const args = expr.arguments.map(arg => resolveExpressionText(arg, instance, paramNames, callArgTexts, paramDefaults));
    if (args.some(a => a === null)) return null;
    return `${callee}(${args.join(", ")})`;
  }

  // Binary expression
  if (ts.isBinaryExpression(expr)) {
    const left = resolveExpressionText(expr.left, instance, paramNames, callArgTexts, paramDefaults);
    const right = resolveExpressionText(expr.right, instance, paramNames, callArgTexts, paramDefaults);
    if (left === null || right === null) return null;
    
    let op = expr.operatorToken.getText();
    if (op === "===") op = "==";
    else if (op === "!==") op = "!=";
    else if (op === "??") {
      // If the left side is a literal expression (true/false/number/string),
      // it can never be undefined so use it directly
      if (expr.left.kind === ts.SyntaxKind.TrueKeyword || expr.left.kind === ts.SyntaxKind.FalseKeyword || 
          ts.isNumericLiteral(expr.left) || ts.isStringLiteral(expr.left)) {
        return left;
      }
      // If the left side is an identifier whose resolved text matches its source,
      // it means the parameter was not provided by the caller, so use the right side
      if (ts.isIdentifier(expr.left) && left === expr.left.text) {
        return right;
      }
      // If the left side resolved to a recognized literal (true, false, or number),
      // the parameter was provided with a concrete value, not undefined.
      if (left === "true" || left === "false" || /^-?\d+(\.\d+)?$/.test(left)) {
        return left;
      }
      // Use a more concise ternary for C++
      return `(${left} != TYPEHAL_UNDEFINED ? ${left} : ${right})`;
    }
    
    return `${left} ${op} ${right}`;
  }

  // Parenthesized expression: (expr) → unwrap to inner expression
  if (ts.isParenthesizedExpression(expr)) {
    return resolveExpressionText(expr.expression, instance, paramNames, callArgTexts, paramDefaults);
  }

  // Type assertion: this as any → unwrap to inner expression
  if (ts.isAsExpression(expr)) {
    return resolveExpressionText(expr.expression, instance, paramNames, callArgTexts, paramDefaults);
  }

  // Template expression: `text ${expr} more text`
  if (ts.isTemplateExpression(expr)) {
    let result = expr.head.text;
    for (const span of expr.templateSpans) {
      const resolved = resolveExpressionText(span.expression, instance, paramNames, callArgTexts, paramDefaults);
      if (resolved === null) return null;
      result += resolved + span.literal.text;
    }
    return result;
  }

  // No-substitution template literal: `text`
  if (ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
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

// ---------------------------------------------------------------------------
// Semantic HAL function → HALOpIR resolver
//
// When HAL source files use semantic functions (gpioWrite, i2cBegin, etc.)
// instead of raw emit("..."), this table maps each function name to a
// HALOpIR node using the resolved argument expressions.
// ---------------------------------------------------------------------------

/** Resolve a single argument from a semantic call's AST node list. */
function resolveSemanticArg(
  args: readonly ts.Expression[],
  idx: number,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults: Map<string, string> | undefined,
): string | null {
  const arg = args[idx];
  if (!arg) return null;
  return resolveExpressionText(arg, instance, paramNames, callArgTexts, paramDefaults);
}

/** Resolve a numeric argument, returning its numeric value or null. */
function resolveNumericArg(
  args: readonly ts.Expression[],
  idx: number,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults: Map<string, string> | undefined,
): number | null {
  const text = resolveSemanticArg(args, idx, instance, paramNames, callArgTexts, paramDefaults);
  if (text === null) return null;
  // R1: Boolean coercion — true → 1, false → 0
  if (text === "true") return 1;
  if (text === "false") return 0;
  const n = Number(text);
  return isNaN(n) ? null : n;
}

/** Extract the MCU port name from the current HAL instance, if available. */
function portFromInstance(instance: HALInstance): string | undefined {
  const port = instance.fieldValues.get('_port');
  return port && port !== '' ? port : undefined;
}

/**
 * Try to resolve a compound return expression that contains semantic calls.
 * For example, `(gpioRead(this._pin) === HIGH)` should produce a halOp for
 * `gpioRead` and return a combined expression with the strategy-resolved form.
 * Returns the resolved text with placeholders, or null if no semantic calls found.
 */
function tryResolveCompoundSemanticReturn(
  expr: ts.Expression,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults: Map<string, string> | undefined,
  halOps: HALOpIR[],
): string | null {
  const semanticPlaceholders: Map<ts.Node, number> = new Map();

  // Walk the expression tree looking for semantic calls
  function findSemanticCalls(node: ts.Expression): boolean {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const semanticOp = tryResolveSemanticCall(
        node.expression.text,
        node.arguments,
        instance, paramNames, callArgTexts, paramDefaults,
      );
      if (semanticOp) {
        halOps.push(semanticOp);
        semanticPlaceholders.set(node, halOps.length - 1);
        return true;
      }
    }
    let found = false;
    if (ts.isBinaryExpression(node)) {
      found = findSemanticCalls(node.left) || findSemanticCalls(node.right);
    } else if (ts.isParenthesizedExpression(node)) {
      found = findSemanticCalls(node.expression);
    } else if (ts.isAsExpression(node)) {
      found = findSemanticCalls(node.expression);
    } else if (ts.isPrefixUnaryExpression(node)) {
      found = findSemanticCalls(node.operand);
    } else if (ts.isConditionalExpression(node)) {
      found = findSemanticCalls(node.condition) || findSemanticCalls(node.whenTrue) || findSemanticCalls(node.whenFalse);
    }
    return found;
  }

  if (!findSemanticCalls(expr)) return null;

  // Now resolve the expression text, substituting semantic calls with their resolved forms
  function resolveWithSemantics(node: ts.Expression): string | null {
    // If this node was a semantic call, return a placeholder for the halOp expression
    const opIdx = semanticPlaceholders.get(node);
    if (opIdx !== undefined) {
      return `__hal_op_expr_${opIdx}__`;
    }

    // Delegate non-semantic parts to resolveExpressionText
    if (ts.isBinaryExpression(node)) {
      const left = resolveWithSemantics(node.left);
      const right = resolveWithSemantics(node.right);
      if (left === null || right === null) return null;
      let op = node.operatorToken.getText();
      if (op === "===") op = "==";
      else if (op === "!==") op = "!=";
      return `${left} ${op} ${right}`;
    }

    if (ts.isParenthesizedExpression(node)) {
      const inner = resolveWithSemantics(node.expression);
      return inner !== null ? `(${inner})` : null;
    }

    if (ts.isAsExpression(node)) {
      // Unwrap type assertions (e.g., gpioRead(pin) as unknown as boolean)
      return resolveWithSemantics(node.expression);
    }

    if (ts.isPrefixUnaryExpression(node)) {
      const operand = resolveWithSemantics(node.operand);
      if (operand === null) return null;
      const op = node.operator === ts.SyntaxKind.ExclamationToken ? "!" : node.operator === ts.SyntaxKind.MinusToken ? "-" : "";
      return `${op}${operand}`;
    }

    // Fall back to text resolution for non-semantic parts
    return resolveExpressionText(node, instance, paramNames, callArgTexts, paramDefaults);
  }

  const resolved = resolveWithSemantics(expr);
  if (resolved === null) return null;

  return resolved.replace(/===/g, "==").replace(/!==/g, "!=");
}

/**
 * Try to resolve a semantic HAL function call to a HALOpIR node.
 * Returns the HALOpIR if the function name is recognized, or null.
 */
function tryResolveSemanticCall(
  fnName: string,
  args: readonly ts.Expression[],
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults: Map<string, string> | undefined,
): HALOpIR | null {
  // Extract MCU port name from instance (set by Pin.fromPort())
  const port = portFromInstance(instance);

  switch (fnName) {
    // ── GPIO ──
    case "gpioWrite": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || value === null) return null;
      return { operation: "gpio.write", port, pin, value: (value ? 1 : 0) as 0 | 1 };
    }
    case "gpioRead": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "gpio.read", port, pin };
    }
    case "gpioToggle": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "gpio.toggle", port, pin };
    }
    case "gpioSetMode": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const mode = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || mode === null) return null;
      return { operation: "gpio.set_mode", port, pin, mode };
    }

    // ── PWM ──
    case "pwmWrite": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const duty = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || duty === null) return null;
      return { operation: "pwm.write", port, pin, duty };
    }

    // ── ADC ──
    case "adcRead": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "adc.read", port, pin };
    }
    case "adcSetReference": {
      const ref = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (ref === null) return null;
      const numRef = Number(ref);
      return { operation: "adc.set_reference", reference: isNaN(numRef) ? ref : numRef };
    }
    case "adcReadVoltage": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "adc.read_voltage", port, pin };
    }

    // ── DAC ──
    case "dacWrite": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || value === null) return null;
      return { operation: "dac.write", port, pin, value };
    }

    // ── Interrupts ──
    case "interruptAttach": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const handler = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const mode = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || handler === null || mode === null) return null;
      return { operation: "interrupt.attach", port, pin, handler, mode };
    }
    case "interruptDetach": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "interrupt.detach", port, pin };
    }

    // ── Tone ──
    case "tonePlay": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const frequency = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const duration = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || frequency === null) return null;
      return { operation: "tone.play", port, pin, frequency, ...(duration !== null ? { duration } : {}) };
    }
    case "toneStop": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "tone.stop", port, pin };
    }

    // ── Timing ──
    case "delayMs": {
      const ms = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (ms === null) return null;
      return { operation: "timing.delay", ms };
    }
    case "delayMicro": {
      const us = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (us === null) return null;
      return { operation: "timing.delay_microseconds", us };
    }
    case "getMillis":
      return { operation: "timing.millis" };
    case "getMicros":
      return { operation: "timing.micros" };

    // ── I2C ──
    case "i2cBegin": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const address = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "i2c.begin", bus, ...(address !== null ? { address } : {}) };
    }
    case "i2cEnd": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "i2c.end", bus };
    }
    case "i2cSetClock": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const hz = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || hz === null) return null;
      return { operation: "i2c.set_clock", bus, hz };
    }
    case "i2cBeginTx": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const address = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || address === null) return null;
      return { operation: "i2c.begin_transmission", bus, address };
    }
    case "i2cWrite": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const data = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || data === null) return null;
      return { operation: "i2c.write", bus, data };
    }
    case "i2cEndTx": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const stop = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || stop === null) return null;
      return { operation: "i2c.end_transmission", bus, stop: stop !== "false" };
    }
    case "i2cRequestFrom": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const address = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const quantity = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      const stop = resolveSemanticArg(args, 3, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || address === null || quantity === null || stop === null) return null;
      return { operation: "i2c.request_from", bus, address, quantity, stop: stop !== "false" };
    }
    case "i2cAvailable": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "i2c.available", bus };
    }
    case "i2cRead": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "i2c.read", bus };
    }

    // ── SPI ──
    case "spiBegin": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "spi.begin", bus };
    }
    case "spiEnd": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "spi.end", bus };
    }
    case "spiTransfer": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const data = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || data === null) return null;
      return { operation: "spi.transfer", bus, data };
    }
    case "spiBeginTx": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const settings = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || settings === null) return null;
      return { operation: "spi.begin_transaction", bus, settings };
    }
    case "spiEndTx": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "spi.end_transaction", bus };
    }
    case "spiCsLow": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "spi.cs_low", port, pin };
    }
    case "spiCsHigh": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "spi.cs_high", port, pin };
    }
    case "spiSetMode": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const mode = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || mode === null) return null;
      return { operation: "spi.set_mode", bus, mode };
    }
    case "spiSetBitOrder": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const order = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || order === null) return null;
      return { operation: "spi.set_bit_order", bus, order };
    }

    // ── UART ──
    case "uartBegin": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const baud = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null || baud === null) return null;
      return { operation: "uart.begin", port, baud };
    }
    case "uartEnd": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "uart.end", port };
    }
    case "uartPrint": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null || value === null) return null;
      return { operation: "uart.print", port, value };
    }
    case "uartPrintln": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null || value === null) return null;
      return { operation: "uart.println", port, value };
    }
    case "uartWrite": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const data = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null || data === null) return null;
      return { operation: "uart.write", port, data };
    }
    case "uartRead": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "uart.read", port };
    }
    case "uartPeek": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "uart.peek", port };
    }
    case "uartAvailable": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "uart.available", port };
    }
    case "uartFlush": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "uart.flush", port };
    }

    // ── Pulse ──
    case "pulseIn_": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const timeout = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || value === null) return null;
      return { operation: "pulse.in", port, pin, value: (value ? 1 : 0) as 0 | 1, ...(timeout !== null ? { timeout } : {}) };
    }
    case "pulseInLong_": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || value === null) return null;
      return { operation: "pulse.in_long", port, pin, value: (value ? 1 : 0) as 0 | 1 };
    }

    // ── Shift ──
    case "shiftOut_": {
      const dataPin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const clockPin = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const bitOrder = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericArg(args, 3, instance, paramNames, callArgTexts, paramDefaults);
      if (dataPin === null || clockPin === null || bitOrder === null || value === null) return null;
      return { operation: "shift.out", dataPin, clockPin, bitOrder, value };
    }
    case "shiftIn_": {
      const dataPin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const clockPin = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const bitOrder = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (dataPin === null || clockPin === null || bitOrder === null) return null;
      return { operation: "shift.in", dataPin, clockPin, bitOrder };
    }

    // ── Board ──
    case "boardResolve": {
      const p = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (p === null) return null;
      return { operation: "board.resolve", path: p };
    }

    // ── Raw C++ passthrough ──
    case "rawCpp": {
      const code = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (code === null) return null;
      return { operation: "raw", code };
    }

    default:
      return null;
  }
}

/** Process a HAL method body, resolving emit()/include()/semantic calls.
 *  Returns { emitLines, halOps, returnValue, returnClassName } or null if unresolvable.
 *
 *  `emitLines` contains legacy raw C++ strings (from `emit()` calls).
 *  `halOps` contains structured HALOpIR nodes (from semantic function calls like
 *  `gpioWrite()`, `i2cBegin()`, etc.).
 *
 *  During migration both can coexist; consumers should prefer `halOps` when present. */
export function processHALMethodBody(
  instance: HALInstance,
  methodName: string,
  callArgs: ExpressionIR[],
): { emitLines: string[]; halOps: HALOpIR[]; returnValue?: string; returnClassName?: string } | null {
  let methodEntry: HALMethodEntry | undefined;

  if (instance.className) {
    const classEntry = halClassRegistry.get(instance.className);
    if (!classEntry) return null;

    methodEntry = classEntry.methods.get(methodName);

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
  } else {
    methodEntry = halGlobalFunctions.get(methodName);
  }

  if (!methodEntry || !methodEntry.methodNode.body) return null;

  const paramNames = methodEntry.paramNames;
  const spreadParamName = methodEntry.spreadParamName;
  const callArgTexts = callArgs.map(a => renderExprAsText(a));
  
  (instance as any)._spreadParamName = spreadParamName;
  const paramDefaults = methodEntry.paramDefaults;

  const body = methodEntry.methodNode.body;

  const emitLines: string[] = [];
  const halOps: HALOpIR[] = [];

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
        const resolved = resolveExpressionText(right, instance, paramNames, callArgTexts, paramDefaults);
        if (resolved !== null) {
          instance.fieldValues.set(fieldName, resolved);
        }
      }
    }

    // emit(...) call or semantic HAL function call
    if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
      const call = stmt.expression;

      // ── Semantic HAL function calls (gpioWrite, i2cBegin, etc.) ──
      if (ts.isIdentifier(call.expression)) {
        // Extract callbacks from semantic call arguments and patch callArgTexts
        // with placeholder names before resolving (mirrors the emit() path at
        // line ~1090).  Without this, callback(handler) inside a semantic call
        // like interruptAttach(pin, callback(handler), "FALLING") would never
        // be registered, and the handler placeholder would not be substituted.
        for (const arg of call.arguments) {
          extractAndRegisterCallbacks(arg, paramNames, callArgs, callArgTexts);
        }

        const semanticOp = tryResolveSemanticCall(
          call.expression.text,
          call.arguments,
          instance,
          paramNames,
          callArgTexts,
          paramDefaults,
        );
        if (semanticOp) {
          halOps.push(semanticOp);
          continue;
        }
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

    // R4: if statement with compile-time condition evaluation
    if (ts.isIfStatement(stmt)) {
      let conditionTrue = true; // default: process then-branch
      const cond = stmt.expression;
      if (cond && ts.isBinaryExpression(cond)) {
        const left = resolveExpressionText(cond.left, instance, paramNames, callArgTexts, paramDefaults);
        const right = resolveExpressionText(cond.right, instance, paramNames, callArgTexts, paramDefaults);
        if (left !== null && right !== null) {
          const op = cond.operatorToken.kind;
          if (op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsEqualsToken) {
            conditionTrue = left === right;
          } else if (op === ts.SyntaxKind.ExclamationEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
            conditionTrue = left !== right;
          }
        }
      }

      if (conditionTrue && stmt.thenStatement) {
        const returnRef = returnValue !== undefined ? undefined : { value: "" };
        processStatementList(
          ts.isBlock(stmt.thenStatement) ? (stmt.thenStatement as ts.Block).statements : [stmt.thenStatement as ts.Statement],
          instance, paramNames, callArgTexts, emitLines, halOps, callArgs, paramDefaults, returnRef,
        );
        if (returnRef && returnRef.value) returnValue = returnRef.value;
      }
      if (!conditionTrue && stmt.elseStatement) {
        const returnRef = returnValue !== undefined ? undefined : { value: "" };
        processStatementList(
          ts.isBlock(stmt.elseStatement) ? (stmt.elseStatement as ts.Block).statements : [stmt.elseStatement as ts.Statement],
          instance, paramNames, callArgTexts, emitLines, halOps, callArgs, paramDefaults, returnRef,
        );
        if (returnRef && returnRef.value) returnValue = returnRef.value;
      }
      continue;
    }

    // R2: return expr — check for semantic call first, then fall back to resolveExpressionText
    if (ts.isReturnStatement(stmt) && stmt.expression && returnValue === undefined) {
      const retExpr = stmt.expression;
      // Check if the return expression is a semantic HAL function call
      if (ts.isCallExpression(retExpr) && ts.isIdentifier(retExpr.expression)) {
        for (const arg of retExpr.arguments) {
          extractAndRegisterCallbacks(arg, paramNames, callArgs, callArgTexts);
        }
        const semanticOp = tryResolveSemanticCall(
          retExpr.expression.text,
          retExpr.arguments,
          instance, paramNames, callArgTexts, paramDefaults,
        );
        if (semanticOp) {
          halOps.push(semanticOp);
          // Mark returnValue as a sentinel so consumers know there's a return
          // The actual expression comes from the last halOp via strategy.resolveHALOperation
          returnValue = "__hal_op_return__";
          continue;
        }
      }
      // Try to resolve semantic calls within compound expressions (e.g., gpioRead(pin) === HIGH)
      const compoundResult = tryResolveCompoundSemanticReturn(retExpr, instance, paramNames, callArgTexts, paramDefaults, halOps);
      if (compoundResult !== null) {
        returnValue = compoundResult;
        continue;
      }
      // Fall back to expression text resolution
      const resolved = resolveExpressionText(retExpr, instance, paramNames, callArgTexts, paramDefaults);
      if (resolved !== null) {
        returnValue = resolved.replace(/===/g, "==").replace(/!==/g, "!=");
      }
    }
  }

  // Auto-passthrough for stub methods: if no emit() calls and the return is a literal
  // (e.g., return 0), construct the C++ expression as <objectName>.<method>(<args>).
  // Skip for Pin classes since Pin methods are typically lowered to standalone C calls (digitalRead/Write).
  if (emitLines.length === 0 && isLiteralReturnValue(returnValue)
      && instance.className !== "Pin"
      && instance.className !== "OutputPin"
      && instance.className !== "InputPin") {
    const cppObj = resolveCppObjectName(instance);
    if (cppObj) {
      const argsStr = callArgTexts.join(", ");
      return { emitLines: [], halOps: [], returnValue: `${cppObj}.${methodName}(${argsStr})` };
    }
  }

  // Return null if nothing useful was resolved, allowing inline fallbacks to kick in
  if (emitLines.length === 0 && halOps.length === 0 && returnValue === undefined) {
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


  return { emitLines, halOps, returnValue, returnClassName };
}

/** Check if a resolved C++ value string is a simple literal (for stub detection). */
function isLiteralReturnValue(val: string | undefined): boolean {
  if (val === undefined) return false;
  return val === "0" || val === "true" || val === "false" || val === "''" || val === '""';
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

/** Process a list of statements for emit/include/semantic calls/return. */
function processStatementList(
  stmts: readonly ts.Statement[],
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  emitLines: string[],
  halOps: HALOpIR[],
  callArgs: ExpressionIR[],
  paramDefaults: Map<string, string>,
  returnExpr?: { value: string },
): void {
  for (const stmt of stmts) {
    if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
      const call = stmt.expression;
      if (ts.isIdentifier(call.expression)) {
        if (call.expression.text === "include") {
          const firstArg = call.arguments[0];
          if (firstArg && ts.isStringLiteral(firstArg)) {
            requiredIncludes.add(firstArg.text);
          }
        } else {
          // R3: Try semantic HAL function call
          for (const arg of call.arguments) {
            extractAndRegisterCallbacks(arg, paramNames, callArgs, callArgTexts);
          }
          const semanticOp = tryResolveSemanticCall(
            call.expression.text, call.arguments,
            instance, paramNames, callArgTexts, paramDefaults,
          );
          if (semanticOp) {
            halOps.push(semanticOp);
          }
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
      // Check for string variable reference: template_string wrapping an identifier
      const isStringVar = part.kind === "template_string"
        && part.expression.kind === "identifier"
        && (activeStringVars.has((part.expression as any).value) || activeLocalTypes.get((part.expression as any).value) === "std::string" || activeGlobalTypes.get((part.expression as any).value) === "std::string");

      // Check for float variable reference: template_string wrapping an identifier
      const isFloatVar = part.kind === "template_string"
        && part.expression.kind === "identifier"
        && floatVariables.has((part.expression as any).value);

      if (isStringVar) {
        formatString += "%s";
        const varName = (part.expression as any).value;
        const varType = activeLocalTypes.get(varName) || activeGlobalTypes.get(varName) || "";
        const cleanType = varType.replace(/\bconst\b\s*/g, "").trim();
        if (cleanType && cleanType !== "char*" && cleanType !== "const char*") {
          args.push(`${text}.c_str()`);
        } else {
          args.push(text);
        }
        estimatedLength += 32;
      } else if (isFloatVar) {
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
