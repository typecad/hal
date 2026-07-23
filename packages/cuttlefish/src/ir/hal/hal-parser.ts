import fs from "fs";
import path from "path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parseSource } from "../../ast/parse.js";
import { requiredIncludes, getCurrentBoardConstants, mcuPinForwardMap, mcuPinReverseMap, halInstances, topLevelAliasReceivers } from "../build-ir-state.js";
import { mapPeripheralName } from "../../mapping/peripheral-names.js";
import { escapeCppStringLiteral } from "../../utils/strings.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface HALInstance {
  className: string;
  fieldValues: Map<string, string>;
  _spreadParamName?: string;
  /** When a bus alias comes from `const x = I2C0.take()`, tracks the singleton name for ownership IR. */
  canonicalBusName?: string;
  [key: string]: unknown;
}

export interface HALMethodEntry {
  methodNode: ts.MethodDeclaration;
  paramNames: string[];
  spreadParamName?: string;
  paramDefaults: Map<string, string>;
}

export interface HALClassEntry {
  ctorFieldMap: Map<string, string>; // "_pin" → param name "pin" or "__literal__value"
  ctorDefaults: Map<string, string>; // "_pin" → literal default value
  methods: Map<string, HALMethodEntry>;
}

// Registry of HAL class method ASTs, keyed by class name
export const halClassRegistry = new Map<string, HALClassEntry>();
export const halGlobalFunctions = new Map<string, HALMethodEntry>();
export const halSingletons = new Map<string, { className: string; fieldValues: Map<string, string>; includes?: string[] }>();
export const halCtorIncludes = new Map<string, string[]>();

// Guard: only load once per process
export let halModulesLoaded = false;

/** Check if an identifier name refers to a known HAL singleton or mapped peripheral. */
export function isHALSingleton(name: string): boolean {
  if (halSingletons.has(name)) return true;
  if (mapPeripheralName(name) !== undefined) return true;
  return false;
}

/** Resolve the HAL source directory. */
export function resolveHALSourceDir(): string {
  const monoPath = path.resolve(__dirname, "..", "..", "..", "..", "hal", "src");
  let res = "";
  if (fs.existsSync(path.join(monoPath, "gpio.ts"))) {
    res = monoPath;
  } else {
    try {
      const pkgDir = path.dirname(require.resolve("@typecad/hal/package.json"));
      res = path.join(pkgDir, "src");
    } catch {}
  }
  if (!res) throw new Error("Could not resolve @typecad/hal/src/");
  return res;
}

/** Extract constructor field mappings: which `this._field = param` assignments exist. */
export function extractCtorFieldMap(ctor: ts.ConstructorDeclaration): { fieldMap: Map<string, string>; defaults: Map<string, string> } {
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
export function extractCtorIncludes(ctor: ts.ConstructorDeclaration | undefined): string[] {
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
export function extractParams(node: ts.FunctionLikeDeclarationBase): { paramNames: string[], spreadParamName?: string, paramDefaults: Map<string, string> } {
  const paramNames: string[] = [];
  const paramDefaults = new Map<string, string>();
  for (const p of node.parameters) {
    if (ts.isIdentifier(p.name)) {
      const name = p.name.text;
      paramNames.push(name);
      if (p.initializer) {
        if (ts.isNumericLiteral(p.initializer)) paramDefaults.set(name, p.initializer.text);
        else if (ts.isStringLiteral(p.initializer)) paramDefaults.set(name, `"${escapeCppStringLiteral(p.initializer.text)}"`);
        else if (p.initializer.kind === ts.SyntaxKind.TrueKeyword) paramDefaults.set(name, "true");
        else if (p.initializer.kind === ts.SyntaxKind.FalseKeyword) paramDefaults.set(name, "false");
      }
    }
  }
  const spreadParam = node.parameters.find(p => !!p.dotDotDotToken);
  const spreadParamName = spreadParam && ts.isIdentifier(spreadParam.name) ? spreadParam.name.text : undefined;
  return { paramNames, spreadParamName, paramDefaults };
}

/** Extract method entries from a class declaration. */
export function extractMethods(cls: ts.ClassDeclaration): Map<string, HALMethodEntry> {
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
    halGlobalFunctions.clear();
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

/** Map an HttpClass factory method name to its HTTP verb, or null. */
export function httpFactoryVerb(methodName: string): string | null {
  switch (methodName) {
    case "get": return "GET";
    case "post": return "POST";
    case "put": return "PUT";
    case "del": return "DELETE";
    case "head": return "HEAD";
    case "patch": return "PATCH";
    default: return null;
  }
}

/** Render an Http factory URL argument as C++ expression text (string
 *  literals quoted, identifiers/member accesses verbatim), or null when the
 *  argument shape can't be resolved at compile time. */
export function httpUrlArgText(arg: ts.Expression): string | null {
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return JSON.stringify(arg.text);
  if (ts.isIdentifier(arg)) return arg.text;
  if (ts.isPropertyAccessExpression(arg)) return arg.getText();
  return null;
}

/** Resolve a call receiver to a tracked HAL instance. */
export function resolveHALReceiver(receiver: ts.Expression): HALInstance | null {
  const result = (() => {
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

        // Specialized handling for Http factory chaining
        // (Http.get(url).header(...).send()): the factory records the HTTP
        // verb and URL into the HttpRequest instance so send() can resolve
        // this._method / this._url.
        if (innerInstance.className === "HttpClass") {
          const verb = httpFactoryVerb(methodName);
          if (verb && receiver.arguments.length > 0) {
            const urlText = httpUrlArgText(receiver.arguments[0]);
            if (urlText) {
              return {
                className: "HttpRequest",
                fieldValues: new Map([["_method", verb], ["_url", urlText]]),
              };
            }
          }
        }

        // Specialized handling for BLE factory chaining
        // (Ble.server(name).characteristic(uuid,type,perms).onRead(handler)):
        // server() creates a BleServer with _name, _charCount=0, _lastChar=0,
        // _svcCount=1. characteristic() reads _charCount for the add_char call,
        // then sets _lastChar=_charCount and increments _charCount so the next
        // characteristic gets the next slot. onRead/onWrite read _lastChar.
        if (innerInstance.className === "BleClass" && methodName === "server" && receiver.arguments.length > 0) {
          const nameText = httpUrlArgText(receiver.arguments[0]);
          if (nameText) {
            return {
              className: "BleServer",
              fieldValues: new Map([["_name", nameText], ["_charCount", "0"], ["_lastChar", "0"], ["_svcCount", "1"]]),
            };
          }
        }
        if (innerInstance.className === "BleServer" && methodName === "characteristic") {
          // characteristic() returns this (BleServer). The method body reads
          // this._charCount for bleAddChar. After processing, advance the
          // counters: _lastChar = old _charCount, _charCount = old + 1.
          const count = Number(innerInstance.fieldValues.get("_charCount") ?? "0");
          innerInstance.fieldValues.set("_lastChar", String(count));
          innerInstance.fieldValues.set("_charCount", String(count + 1));
          return innerInstance;
        }
        if (innerInstance.className === "BleServer" && methodName === "service") {
          // service() returns this (BleServer); advance the service counter.
          const svc = Number(innerInstance.fieldValues.get("_svcCount") ?? "1") + 1;
          innerInstance.fieldValues.set("_svcCount", String(svc));
          return innerInstance;
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

        // Fluent `this`-returning methods (e.g. HttpRequest.header/timeout):
        // the chain result is the same instance, so keep resolving through it.
        if (methodEntry && methodEntry.methodNode.type && methodEntry.methodNode.type.kind === ts.SyntaxKind.ThisType) {
          return innerInstance;
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

    // Lazy top-level alias follow (demo #34 Finding C): if `receiver` is an
    // identifier that names a top-level `const x = <pin>.<modeSetter>(...)`
    // alias, resolve the recorded receiver name instead. This makes HAL
    // resolution order-independent — a function referencing `led` resolves it
    // even when declared before `const led = LED.asOutput()`. Only mode-setter
    // aliases are recorded (build-ir.ts Phase 0d), so a value-bearing-read
    // variable is never followed here (Finding B). Follow the chain with a
    // visited-set to guard against cycles.
    if (ts.isIdentifier(receiver) && topLevelAliasReceivers.has(receiver.text)) {
      // Collect the full alias chain (e.g. sensor → bus → I2C0), then resolve
      // the base instance and apply ALL transformations in chain order.
      const chain: { receiver: string; method: string; args?: string[] }[] = [];
      const visited = new Set<string>([receiver.text]);
      let cur = receiver.text;
      while (topLevelAliasReceivers.has(cur) && !visited.has(topLevelAliasReceivers.get(cur)!.receiver)) {
        const entry = topLevelAliasReceivers.get(cur)!;
        visited.add(entry.receiver);
        chain.push(entry);
        cur = entry.receiver;
      }
      // Resolve the base instance from the end of the chain.
      const baseName = chain.length > 0 ? chain[chain.length - 1].receiver : receiver.text;
      const baseInst = halInstances.get(baseName);
      if (baseInst) {
        let resolvedInst = baseInst;
        // Apply each transformation in chain order (first entry = outermost call).
        for (const entry of chain) {
          // Pin mode-change: Pin → OutputPin/InputPin
          if ((entry.method === "asOutput" || entry.method === "asInput" || entry.method === "asInputPullUp" || entry.method === "asInputPullDown" || entry.method === "output" || entry.method === "inputPullUp" || entry.method === "inputPullDown") && resolvedInst.className === "Pin") {
            const returnClassName = (entry.method === "asOutput" || entry.method === "output") ? "OutputPin" : "InputPin";
            resolvedInst = { className: returnClassName, fieldValues: new Map(resolvedInst.fieldValues) };
          }
          // I2C/SPI device factory: bus → device with address/cs from args
          if (entry.method === "device" && (resolvedInst.className === "I2CBus" || resolvedInst.className === "SPIBus")) {
            const returnClassName = resolvedInst.className === "SPIBus" ? "SPIDevice" : "I2CDevice";
            const fieldValues = new Map(resolvedInst.fieldValues);
            const fieldName = resolvedInst.className === "SPIBus" ? "_cs" : "_address";
            if (entry.args && entry.args.length > 0) {
              // Resolve identifier args (e.g. D10 → 10) via halInstances.
              // Numeric/string args pass through unchanged.
              const rawArg = entry.args[0];
              const argInst = halInstances.get(rawArg);
              const resolvedArg = argInst?.fieldValues.get("_pin") ?? argInst?.fieldValues.get("pin") ?? rawArg;
              fieldValues.set(fieldName, resolvedArg);
            }
            resolvedInst = { className: returnClassName, fieldValues };
          }
          // Tone chain factory: OutputPin → ToneChain with frequency from args
          if (entry.method === "tone" && resolvedInst.className === "OutputPin" && entry.args && entry.args.length > 0) {
            const fieldValues = new Map(resolvedInst.fieldValues);
            fieldValues.set("_lastFreq", entry.args[0]);
            resolvedInst = { className: "ToneChain", fieldValues };
          }
          // begin/identity: no class change, just carry the instance forward.
        }
        halInstances.set(receiver.text, resolvedInst);
        return resolvedInst;
      }
    }

    return null;
  })();
  return result;
}

/** Build field values from constructor arguments using the field mapping.
 *  Falls back to literal defaults from the constructor body when no arg is provided. */
export function resolveCtorFieldValues(
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

/** Check if a class name is a known HAL class in the registry. */
export function isKnownHALClass(className: string): boolean {
  return halClassRegistry.has(className);
}

/** Get the constructor field map for a HAL class. */
export function getHALCtorFieldMap(className: string): Map<string, string> | undefined {
  return halClassRegistry.get(className)?.ctorFieldMap;
}
