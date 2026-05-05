import fs from "fs";
import path from "path";
import ts from "typescript";
import { parseSource } from "../ast/parse";
import { requiredIncludes, registeredCallbacks, getCurrentBoardConstants } from "./build-ir-state";
import { ExpressionIR } from "@typehal/core";
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

    // Bare pin resolution (D0, A0, etc.)
    const dMatch = name.match(/^D(\d+)$/);
    if (dMatch) {
      const inst = { className: "Pin", fieldValues: new Map([["_pin", dMatch[1]]]) };
      halInstances.set(name, inst);
      return inst;
    }
    const aMatch = name.match(/^A(\d+)$/);
    if (aMatch) {
      const offset = Number(bc.get("pins.analogOffset") ?? 0);
      const pinNum = Number(aMatch[1]) + offset;
      const inst = { className: "Pin", fieldValues: new Map([["_pin", String(pinNum)]]) };
      halInstances.set(name, inst);
      return inst;
    }

    const timerMatch = name.match(/^Timer(\d+)$/);
    if (timerMatch) {
      return { className: "HardwareTimer", fieldValues: new Map([["_instance", timerMatch[1]]]) };
    }
  }

  // Chained call result: new Pin(13).asOutput()
  if (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression)) {
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

/** Resolve a template expression with field/param substitution. */
function resolveTemplateLiteral(
  node: ts.Expression,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults?: Map<string, string>,
): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  if (ts.isTemplateExpression(node)) {
    let result = node.head.text;
    for (const span of node.templateSpans) {
      const resolved = resolveExpressionText(span.expression, instance, paramNames, callArgTexts, paramDefaults);
      if (resolved === null) return null;
      result += resolved + span.literal.text;
    }
    return result;
  }

  return resolveExpressionText(node, instance, paramNames, callArgTexts, paramDefaults);
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
      // Use a more concise ternary for C++
      return `(${left} != TYPEHAL_UNDEFINED ? ${left} : ${right})`;
    }
    
    return `${left} ${op} ${right}`;
  }

  // Type assertion: this as any → unwrap to inner expression
  if (ts.isAsExpression(expr)) {
    return resolveExpressionText(expr.expression, instance, paramNames, callArgTexts, paramDefaults);
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
            paramDefaults,
          );
            if (resolved !== null) {
              const normalized = resolved
                .replace(/===/g, "==")
                .replace(/!==/g, "!=");
              // Convention: emit("return EXPR") means this is a return value expression
              if (normalized.startsWith("return ")) {
                const returnExpr = normalized.slice(7).replace(/;$/, "");
                returnValue = returnExpr;
              } else {
                emitLines.push(normalized);
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
          instance, paramNames, callArgTexts, emitLines, paramDefaults, returnRef,
        );
        if (returnRef && returnRef.value) returnValue = returnRef.value;
      }
      continue;
    }

    // return expr — only set if not already set by emit("return EXPR") convention
    if (ts.isReturnStatement(stmt) && stmt.expression && returnValue === undefined) {
      const resolved = resolveExpressionText(stmt.expression, instance, paramNames, callArgTexts, paramDefaults);
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

/** Process a list of statements for emit/include/return. */
function processStatementList(
  stmts: readonly ts.Statement[],
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  emitLines: string[],
  paramDefaults: Map<string, string>,
  returnExpr?: { value: string },
): void {
  for (const stmt of stmts) {
    if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
      const call = stmt.expression;
      if (ts.isIdentifier(call.expression) && call.expression.text === "emit") {
        const templateArg = call.arguments[0];
        if (templateArg) {
          const resolved = resolveTemplateLiteral(
            templateArg as ts.Expression, instance, paramNames, callArgTexts, paramDefaults,
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
