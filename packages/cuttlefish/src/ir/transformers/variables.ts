import ts from "typescript";
import { Diagnostic } from "../../types.js";
import { StatementIR, ExpressionIR, ParameterIR, CppType, HALOpIR } from "../../api/index.js";
import { extractNodeComments, makeDiagnostic, makeSourceSpan } from "../ast-node-utils.js";
import { CppTypeHint, inferExprCppType, resolveDeclarationType, typeNodeToCppType, extractOwnershipKindFromTypeNode } from "../type-resolution.js";
import {
  type CppTypeIR,
  parseCppType,
  renderCppType,
  bareType,
  elementOf,
  isPointer,
  isVector,
  isStringLike,
} from "../../api/shared/cpp-type-ir.js";
import {
  PointerTracker,
  TYPED_ARRAY_ELEMENT_MAP,
  activeCArrayVars,
  activeArrayLiteralVars,
  activeStringVars,
  mutableArrayVars,
  arrayLiteralSizes,
  filteredArrayLengthVars,
  halInstances,
  nestedClassAliases,
  registerFieldMap,
  getContext,
  activeStringEnumNames,
  requiredIncludes,
} from "../build-ir-state.js";
import { getCurrentIrTypeScope, setScopeLocalType } from "../symbol-types.js";
import { renderExprAsText } from "../render-expr.js";
import { expressionToIR } from "../expression-to-ir.js";
import { buildInlineForLoop } from "./array-methods.js";
import {
  isKnownHALClass,
  getCtorIncludes,
  getHALCtorFieldMap,
  registerFloatVariable,
  resolveHALReceiver,
  isHALSingleton,
  HALInstance,
} from "../hal-resolver.js";
import { requestCtorFields, halClassRegistry } from "../hal/hal-parser.js";
import { resolveHALCallForVarInit } from "./hal-call-resolver.js";
import { recordSignal } from "./ui-call-resolver.js";
import { hasSafetyHook, requireSafetyHook } from "../../safety-hook.js";

function replaceHalReadBufferPlaceholder(_op: HALOpIR, _varName: string): HALOpIR {
  // i2c/spi read_buffer ops were removed with the legacy Wire/SPI surfaces.
  return _op;
}

export function assignmentOperatorToString(kind: ts.SyntaxKind): Extract<StatementIR, { kind: "assign" }>['operator'] | undefined {
  switch (kind) {
    case ts.SyntaxKind.EqualsToken:
      return "=";
    case ts.SyntaxKind.PlusEqualsToken:
      return "+=";
    case ts.SyntaxKind.MinusEqualsToken:
      return "-=";
    case ts.SyntaxKind.AsteriskEqualsToken:
      return "*=";
    case ts.SyntaxKind.SlashEqualsToken:
      return "/=";
    case ts.SyntaxKind.PercentEqualsToken:
      return "%=";
    case ts.SyntaxKind.AmpersandEqualsToken:
      return "&=";
    case ts.SyntaxKind.BarEqualsToken:
      return "|=";
    case ts.SyntaxKind.CaretEqualsToken:
      return "^=";
    case ts.SyntaxKind.LessThanLessThanEqualsToken:
      return "<<=";
    case ts.SyntaxKind.GreaterThanGreaterThanEqualsToken:
      return ">>=";
    default:
      return undefined;
  }
}

export function updateLocalTypeFromAssignment(
  target: string,
  operator: Extract<StatementIR, { kind: "assign" }>['operator'],
  valueType: CppTypeHint,
  localVariableTypes: Map<string, CppTypeHint>,
): void {
  const currentType = localVariableTypes.get(target) ?? "auto";

  if (operator === "=") {
    localVariableTypes.set(target, valueType);
    return;
  }

  if (valueType === "float" || currentType === "float") {
    localVariableTypes.set(target, "float");
    return;
  }

  if (valueType === "int" || currentType === "int" || valueType === "bool" || currentType === "bool") {
    localVariableTypes.set(target, "int");
    return;
  }

  localVariableTypes.set(target, currentType);
}

export function extractForInKeys(expr: ts.Expression): string[] | undefined {
  if (ts.isObjectLiteralExpression(expr)) {
    return expr.properties
      .filter(ts.isPropertyAssignment)
      .map(p => (ts.isIdentifier(p.name) ? p.name.text : p.name.getText()));
  }
  if (ts.isIdentifier(expr)) {
    const varName = expr.text;
    let parent: ts.Node | undefined = expr.parent;
    while (parent && !ts.isBlock(parent) && !ts.isSourceFile(parent)) {
      parent = parent.parent;
    }
    if (parent && (ts.isBlock(parent) || ts.isSourceFile(parent))) {
      for (const stmt of parent.statements) {
        if (ts.isVariableStatement(stmt)) {
          for (const decl of stmt.declarationList.declarations) {
            if (ts.isIdentifier(decl.name) && decl.name.text === varName && decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
              return decl.initializer.properties
                .filter(ts.isPropertyAssignment)
                .map(p => (ts.isIdentifier(p.name) ? p.name.text : p.name.getText()));
            }
          }
        }
      }
    }
  }
  return undefined;
}

export function variableStatementToIR(
  statement: ts.VariableStatement,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  typeAliases: Map<string, ts.TypeNode> | undefined,
  pointerVars: PointerTracker,
  functionNameForDiagnostics: string,
  lowerStatementListCallback: (
    statements: readonly ts.Statement[] | ts.NodeArray<ts.Statement>,
    fileName: string,
    sourceText: string,
    diagnostics: Diagnostic[],
    functionReturnTypes: Map<string, CppTypeHint>,
    localVariableTypes: Map<string, CppTypeHint>,
    functionNameForDiagnostics: string,
    typeAliases?: Map<string, ts.TypeNode>,
    pointerVars?: PointerTracker,
  ) => StatementIR[],
): StatementIR[] {
  const statementComments = extractNodeComments(statement, sourceText);
  const storage: "var" | "let" | "const" =
    statement.declarationList.flags & ts.NodeFlags.Const
      ? "const"
      : statement.declarationList.flags & ts.NodeFlags.Let
        ? "let"
        : "var";

  const lowered: StatementIR[] = [];
  let commentsAssigned = false;
  for (const declaration of statement.declarationList.declarations) {
    // Handle object destructuring: const { a, b } = obj;
    if (ts.isObjectBindingPattern(declaration.name)) {
      if (!declaration.initializer) {
        diagnostics.push(
          makeDiagnostic(
            sourceText,
            declaration.pos,
            "Destructured declaration without initializer is unsupported.",
            "error",
            "TS2CPP_UNSUPPORTED_DECL",
          ),
        );
        continue;
      }
      
      const objExpr = expressionToIR(declaration.initializer, sourceText, diagnostics);
      const objText = renderExprAsText(objExpr);
      const objType = ts.isIdentifier(declaration.initializer)
        ? getCurrentIrTypeScope()?.locals.get(declaration.initializer.text) ?? getCurrentIrTypeScope()?.globals.get(declaration.initializer.text)
        : undefined;
      const isPointerAccess = objType ? isPointer(parseCppType(objType)) : false;
      const accessor = isPointerAccess ? "->" : ".";
      
      for (let i = 0; i < declaration.name.elements.length; i++) {
        const element = declaration.name.elements[i];
        if (!ts.isBindingElement(element)) {
          continue;
        }
        if (ts.isObjectBindingPattern(element.name)) {
          const nestedPropName = element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : undefined;
          if (nestedPropName) {
            const nestedObjText = `${objText}${accessor}${nestedPropName}`;
            // The nested object (e.g. `stats.inner`) is itself a property-access
            // on the root object. Build it as a structured node so the chained
            // access renders correctly and is classified as runtime. See the
            // non-nested case below for the same rationale (demo #6 fix D).
            const nestedObjExpr: ExpressionIR = {
              kind: "property-access",
              object: objExpr,
              property: nestedPropName,
              isPointer: isPointerAccess,
            };
            for (const nestedElement of element.name.elements) {
              if (!ts.isBindingElement(nestedElement) || !ts.isIdentifier(nestedElement.name)) continue;
              const nestedVarName = nestedElement.name.text;
              let nPropName = nestedVarName;
              if (nestedElement.propertyName && ts.isIdentifier(nestedElement.propertyName)) {
                nPropName = nestedElement.propertyName.text;
              }
              const propAccess: ExpressionIR = {
                kind: "property-access",
                object: nestedObjExpr,
                property: nPropName,
                isPointer: false,
              };
              const initializer = nestedElement.initializer
                ? { kind: "raw" as const, value: `cuttlefish_nullish(${renderExprAsText(propAccess)}, ${renderExprAsText(expressionToIR(nestedElement.initializer, sourceText, diagnostics))})` }
                : propAccess;
              lowered.push({
                kind: "var_decl",
                sourceSpan: makeSourceSpan(nestedElement, fileName, sourceText),
                leadingComments: [],
                trailingComments: [],
                name: nestedVarName,
                storage,
                cppType: "auto",
                initializer,
              });
              localVariableTypes.set(nestedVarName, "auto");
              commentsAssigned = true;
            }
          }
          continue;
        }
        if (!ts.isIdentifier(element.name)) {
          continue;
        }

        const varName = element.name.text;
        // Get the property name (could be renamed via propertyName)
        let propName: string;
        if (element.propertyName && ts.isIdentifier(element.propertyName)) {
          propName = element.propertyName.text;
        } else {
          propName = varName;
        }

        // Create individual variable declaration for each destructured property.
        // Build a structured `property-access` IR node (NOT a `{kind:"raw"}`
        // string) so that isRuntimeExpression() recognizes the initializer as
        // runtime (a member access on a variable) and routes the declaration
        // into the enclosing function body rather than file scope. A raw
        // "stats.field" string was misclassified as compile-time, so top-level
        // destructuring of a local hoisted the split decls out of main()'s
        // scope ("'stats' was not declared in this scope"). See demo #6 fix D.
        const propAccess: ExpressionIR = {
          kind: "property-access",
          object: objExpr,
          property: propName,
          isPointer: isPointerAccess,
        };
        const initializer = element.initializer
          ? {
              kind: "raw" as const,
              value: `cuttlefish_nullish(${renderExprAsText(propAccess)}, ${renderExprAsText(expressionToIR(element.initializer, sourceText, diagnostics))})`,
            }
          : propAccess;

        lowered.push({
          kind: "var_decl",
          sourceSpan: makeSourceSpan(element, fileName, sourceText),
          leadingComments: i === 0 && !commentsAssigned ? statementComments.leadingComments : [],
          trailingComments: [],
          name: varName,
          storage,
          cppType: "auto",
          initializer,
        });

        localVariableTypes.set(varName, "auto");
        commentsAssigned = true;
      }
      continue;
    }
    
    // Handle array destructuring: const [a, b] = arr;
    if (ts.isArrayBindingPattern(declaration.name)) {
      if (!declaration.initializer) {
        diagnostics.push(
          makeDiagnostic(
            sourceText,
            declaration.pos,
            "Destructured declaration without initializer is unsupported.",
            "error",
            "TS2CPP_UNSUPPORTED_DECL",
          ),
        );
        continue;
      }

      const arrExpr = expressionToIR(declaration.initializer, sourceText, diagnostics);
      const arrText = renderExprAsText(arrExpr);
      const isArrayLiteral = arrExpr.kind === "array";
      const arrElements = isArrayLiteral ? (arrExpr as { kind: "array"; elementType: string; elements: ExpressionIR[] }).elements : null;
      const arrElementType = isArrayLiteral ? (arrExpr as { kind: "array"; elementType: string; elements: ExpressionIR[] }).elementType : "auto";
      const knownSourceLength = isArrayLiteral
        ? arrElements?.length
        : ts.isIdentifier(declaration.initializer)
          ? arrayLiteralSizes.get(declaration.initializer.text)
          : undefined;

      for (let i = 0; i < declaration.name.elements.length; i++) {
        const element = declaration.name.elements[i];
        // Skip omitted expressions (holes in array binding pattern)
        if (!ts.isBindingElement(element)) {
          continue;
        }

        // Handle rest element: const [a, ...rest] = arr;
        if (element.dotDotDotToken && ts.isIdentifier(element.name)) {
          const varName = element.name.text;
          if (isArrayLiteral && arrElements) {
            const remaining = arrElements.slice(i);
            lowered.push({
              kind: "var_decl",
              sourceSpan: makeSourceSpan(element, fileName, sourceText),
              leadingComments: [],
              trailingComments: [],
              name: varName,
              storage,
              cppType: "auto",
              initializer: { kind: "array", elementType: arrElementType, elements: remaining },
            });
            localVariableTypes.set(varName, "auto");
            activeCArrayVars.add(varName);
            commentsAssigned = true;
          } else {
            // Derive the element type from the source array so the rest slice
            // lowers to std::vector<ElemType> (NOT std::vector<ElemType&> —
            // `decltype(arr[0])` yields a reference, and vector-of-references
            // is illegal in C++). Fall back to std::remove_reference_t<decltype(...)>
            // when the element type can't be statically resolved.
            //
            // AVR note: a rest element from a VARIABLE lowers to a std::vector
            // slice (no recoverable size from a runtime array), which AVR can't
            // express (no <vector>). Emit a clean, located TS2CPP_NO_VECTOR_STORAGE
            // diagnostic instead of letting it reach g++ as a raw
            // "'vector' is not a member of 'std'" (destructure stress test
            // Finding B). A rest from a LITERAL still works (the literal branch
            // above) because the size is recoverable.
            if (!(getContext().activeStrategy?.needsStdVector() ?? true)) {
              diagnostics.push(
                makeDiagnostic(
                  sourceText,
                  element.pos,
                  `Rest element \`${varName}\` lowers to std::vector<ElemType> (a runtime slice of \`${arrText}\`), which is not available on this target (ATmega AVR has no <vector>). Use a rest element from an array LITERAL (whose size is recoverable) or index the source array directly.`,
                  "error",
                  "TS2CPP_NO_VECTOR_STORAGE",
                ),
              );
            }
            const srcType = getCurrentIrTypeScope()?.locals.get(arrText) ?? getCurrentIrTypeScope()?.globals.get(arrText);
            let elemType = "auto";
            if (srcType) {
              // One structured lookup replaces the vector/[]/StaticArray branch ladder.
              const elemIr = elementOf(parseCppType(srcType));
              if (elemIr) elemType = renderCppType(elemIr);
            }
            const vectorType = elemType !== "auto"
              ? `std::vector<${elemType}>`
              : `std::vector<std::remove_reference_t<decltype(${arrText}[0])>>`;
            lowered.push({
              kind: "var_decl",
              sourceSpan: makeSourceSpan(element, fileName, sourceText),
              leadingComments: [],
              trailingComments: [],
              name: varName,
              storage,
              cppType: "auto",
              initializer: { kind: "raw", value: `${vectorType}(${arrText}.begin() + ${i}, ${arrText}.end())` },
            });
            localVariableTypes.set(varName, "auto");
            commentsAssigned = true;
          }
          continue;
        }

        if (!ts.isIdentifier(element.name)) {
          continue;
        }

        const varName = element.name.text;

        // For array literals, use elements directly; otherwise index into the expression
        let initializer: ExpressionIR;
        if (isArrayLiteral && arrElements) {
          initializer = arrElements[i] ?? { kind: "raw", value: "CUTTLEFISH_UNDEFINED" };
        } else {
          initializer = { kind: "raw", value: `${arrText}[${i}]` };
        }

        if (element.initializer) {
          const defaultValue = expressionToIR(element.initializer, sourceText, diagnostics);
          initializer = knownSourceLength !== undefined && i >= knownSourceLength
            ? defaultValue
            : {
                kind: "raw" as const,
                value: `cuttlefish_nullish(${renderExprAsText(initializer)}, ${renderExprAsText(defaultValue)})`,
              };
        }

        lowered.push({
          kind: "var_decl",
          sourceSpan: makeSourceSpan(element, fileName, sourceText),
          leadingComments: i === 0 && !commentsAssigned ? statementComments.leadingComments : [],
          trailingComments: [],
          name: varName,
          storage,
          cppType: "auto",
          initializer,
        });

        localVariableTypes.set(varName, "auto");
        commentsAssigned = true;
      }
      continue;
    }
    
    if (!ts.isIdentifier(declaration.name)) {
      diagnostics.push(
        makeDiagnostic(
          sourceText,
          declaration.pos,
          "Destructured declarations are currently unsupported.",
          "error",
          "TS2CPP_UNSUPPORTED_DECL",
        ),
      );
      continue;
    }

    // ── HAL resolver for variable declarations ──────────────────────────────
    if (declaration.initializer && ts.isIdentifier(declaration.name)) {
      const varName = declaration.name.text;

      // ── ui.signal(v): record the signal under the declaration name and emit
      // a plain device variable. The const X = ui.signal(v) binding gives the
      // signal an author-chosen name (preferred over synthesized names).
      if (
        ts.isCallExpression(declaration.initializer) &&
        ts.isPropertyAccessExpression(declaration.initializer.expression) &&
        ts.isIdentifier(declaration.initializer.expression.expression) &&
        declaration.initializer.expression.expression.text === "ui" &&
        declaration.initializer.expression.name.text === "signal"
      ) {
        const valueArg = declaration.initializer.arguments[0];
        let initialValue: number | string | boolean = 0;
        let cppType = "int";
        if (valueArg) {
          if (ts.isNumericLiteral(valueArg)) {
            initialValue = Number(valueArg.text);
            cppType = Number.isInteger(initialValue) ? "int" : "double";
          } else if (ts.isStringLiteral(valueArg)) {
            initialValue = valueArg.text;
            cppType = "const char*";
          } else if (valueArg.kind === ts.SyntaxKind.TrueKeyword || valueArg.kind === ts.SyntaxKind.FalseKeyword) {
            initialValue = valueArg.kind === ts.SyntaxKind.TrueKeyword;
            cppType = "bool";
          }
        }
        recordSignal(varName, cppType, initialValue);
        // Do NOT push a var_decl here — signals are emitted at file scope by
        // uiSignalDecls() so they're global (accessible from binding functions
        // and hoisted timer callbacks). Just register the type for lookups.
        localVariableTypes.set(varName, cppType as CppTypeHint);
        continue;
      }

      // ── safe.<method>(...) — @typecad/safety call as initializer.
      // Handles expression-position safe.* calls like `const r = safe.read(pin)`.
      // The statement-position form (safe.pinMode(...)) is handled in the
      // call-statement transformer. Both produce hal-op IR nodes that
      // routeHALOp() later dispatches to the safety hook.
      if (
        hasSafetyHook() &&
        ts.isCallExpression(declaration.initializer) &&
        ts.isPropertyAccessExpression(declaration.initializer.expression) &&
        ts.isIdentifier(declaration.initializer.expression.expression) &&
        declaration.initializer.expression.expression.text === "safe"
      ) {
        const method = declaration.initializer.expression.name.text;
        const argValues: unknown[] = declaration.initializer.arguments.map((a) => {
          if (ts.isNumericLiteral(a)) return Number(a.text);
          if (ts.isStringLiteral(a)) return a.text;
          if (a.kind === ts.SyntaxKind.TrueKeyword) return true;
          if (a.kind === ts.SyntaxKind.FalseKeyword) return false;
          if (ts.isIdentifier(a)) {
            const name = a.text;
            if (name === "INPUT") return 0;
            if (name === "OUTPUT") return 1;
            if (name === "INPUT_PULLUP") return 2;
            return name;
          }
          return undefined;
        });
        const op = requireSafetyHook().resolveSemanticCall?.(`safe.${method}`, argValues);
        if (op) {
          // Emit a var_decl initialized by a hal-expr carrying the safety op.
          // routeHALOp() resolves it to the C++ expression at emit time.
          const initExpr: ExpressionIR = { kind: "hal-expr", operation: op } as ExpressionIR;
          lowered.push({
            kind: "var_decl",
            name: varName,
            storage,
            cppType: "auto",
            initializer: initExpr,
            sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
          } as unknown as StatementIR);
          // auto-deduced to SafeReadResult on the C++ side.
          localVariableTypes.set(varName, "auto" as CppTypeHint);
          continue;
        }
      }

      if (ts.isNewExpression(declaration.initializer) && ts.isIdentifier(declaration.initializer.expression)) {
        const className = declaration.initializer.expression.text;
        const ctorArgs = declaration.initializer.arguments as ts.NodeArray<ts.Expression> | undefined;

        if (isKnownHALClass(className)) {
          const fieldValues = new Map<string, string>();
          const ctorIncludes = getCtorIncludes(className);
          for (const inc of ctorIncludes) {
            requiredIncludes.add(inc);
          }

          if (ctorArgs) {
            for (const arg of ctorArgs) {
              if (ts.isIdentifier(arg)) {
                // Resolved pin/port identifier mappings
              } else if (ts.isStringLiteral(arg)) {
                if (className === "I2CBus") fieldValues.set("_bus", arg.text);
                else if (className === "SPIBus") fieldValues.set("_bus", arg.text);
                else if (className === "UART") fieldValues.set("_port", arg.text);
              } else if (ts.isNumericLiteral(arg)) {
                if (className === "Pin") fieldValues.set("_pin", arg.text);
              } else if (ts.isPropertyAccessExpression(arg)) {
                if (className === "Pin") fieldValues.set("_pin", arg.getText());
              }
            }
          }

          // new Sensor(SENSOR.<part>, I2C1.device(0x44)) — the generic
          // DT-bound peripheral. The part token is kept as text (property
          // access text like 'SENSOR.sensirion_sht3xd'); the bus + address
          // come from the I2CTarget the second arg resolves to. The lowering
          // resolves the token against the generated catalog.
          if (className === "Sensor" && ctorArgs && ctorArgs.length >= 2) {
            const dev = resolveSensorDeviceArg(ctorArgs[1]);
            if (dev) {
              fieldValues.set("_part", ctorArgs[0].getText());
              fieldValues.set("_bus", dev.bus);
              fieldValues.set("_kind", dev.kind);
              fieldValues.set("_port", dev.port);
            } else {
              diagnostics.push(
                makeDiagnostic(
                  sourceText,
                  declaration.pos,
                  `new Sensor(...) second argument must be an I2C device (e.g. I2C1.device(0x44), possibly via a const) — got '${ctorArgs[1].getText()}'.`,
                  "error",
                  "HAL_SENSOR_CTOR",
                ),
              );
            }
            // opts object literal: numeric properties pass through, pin
            // identifiers resolve to their number (alert?: PA5). Absent
            // properties fall back to the class-field initializer defaults
            // (_spiHz = 1000000 etc.) so `this._spiHz` in an inlined method
            // body always resolves.
            const sensorDefaults = halClassRegistry.get("Sensor")?.fieldDefaults;
            if (sensorDefaults) {
              for (const [name, val] of sensorDefaults) {
                if (!fieldValues.has(name)) fieldValues.set(name, val);
              }
            }
            if (ctorArgs.length >= 3 && ts.isObjectLiteralExpression(ctorArgs[2])) {
              for (const prop of ctorArgs[2].properties) {
                if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
                const name = prop.name.text;
                if (ts.isNumericLiteral(prop.initializer)) {
                  fieldValues.set(`_${name}`, prop.initializer.text);
                } else if (ts.isIdentifier(prop.initializer)) {
                  const inst = halInstances.get(prop.initializer.text);
                  fieldValues.set(`_${name}`, inst?.fieldValues.get("_pin") ?? inst?.fieldValues.get("pin") ?? prop.initializer.text);
                }
              }
            }
          }

          // new Request(method, url, opts?) — shared capture (also serves
          // bare `new Request(...).send()` receivers via resolveHALReceiver).
          if (className === "Request") {
            const reqFields = requestCtorFields(ctorArgs, ctorArgs?.[0]?.getSourceFile());
            if (reqFields) for (const [k, v] of reqFields) fieldValues.set(k, v);
          }

          // Thin Zephyr-shaped peripherals (GPIO/PWM/ADC/DAC/
          // Watchdog/Counter — hal/gpio-pin.ts and siblings). Same discipline
          // as Sensor: construction facts become instance fields. Pin args
          // keep their identifier/text form (resolved to numbers later);
          // flag/gain token EXPRESSIONS keep their source text — the lowering
          // maps token names to C macros; numeric opts props pass through as
          // numbers (numeric separators stripped for C++).
          const thinPinFirst: Record<string, true> = { GPIO: true, PWM: true, ADC: true, DAC: true };
          if (thinPinFirst[className] && ctorArgs && ctorArgs.length >= 1) {
            const pinArg = ctorArgs[0];
            if (ts.isIdentifier(pinArg)) {
              // resolveHALReceiver seeds board-module pin constants (LED,
              // BUTTON, datasheet names) into halInstances on first lookup —
              // a plain halInstances.get() would miss them.
              const inst = halInstances.get(pinArg.text) ?? resolveHALReceiver(pinArg);
              fieldValues.set("_pin", inst?.fieldValues.get("_pin") ?? inst?.fieldValues.get("pin") ?? pinArg.text);
            } else {
              fieldValues.set("_pin", pinArg.getText());
            }
          }
          if (className === "GPIO" && ctorArgs && ctorArgs.length >= 2) {
            // "GPIO.OUTPUT | GPIO.PULL_UP" — the token text is the IR carrier.
            fieldValues.set("_flags", ctorArgs[1].getText());
          }
          const thinOptsCtor: Record<string, true> = { PWM: true, ADC: true, DAC: true, Counter: true };
          if (thinOptsCtor[className] && ctorArgs && ctorArgs.length >= 2 && ts.isObjectLiteralExpression(ctorArgs[1])) {
            for (const prop of ctorArgs[1].properties) {
              if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
              const name = prop.name.text;
              if (ts.isNumericLiteral(prop.initializer)) {
                fieldValues.set(`_${name}`, prop.initializer.text.replace(/_/g, ""));
              } else {
                // Token (ADC.GAIN_1_4) or runtime expression text.
                fieldValues.set(`_${name}`, prop.initializer.getText());
              }
            }
          }
          if (className === "Watchdog" && ctorArgs && ctorArgs.length >= 1 && ts.isNumericLiteral(ctorArgs[0])) {
            fieldValues.set("_timeoutMs", ctorArgs[0].text.replace(/_/g, ""));
          }
          // Thin File/Mqtt: the path / broker-uri + client-id facts.
          if (className === "File" && ctorArgs && ctorArgs.length >= 1 && ts.isStringLiteral(ctorArgs[0])) {
            fieldValues.set("_path", ctorArgs[0].text);
          }
          if (className === "Mqtt" && ctorArgs && ctorArgs.length >= 1 && ts.isStringLiteral(ctorArgs[0])) {
            fieldValues.set("_uri", ctorArgs[0].text);
            const mopts = ctorArgs[1];
            if (mopts && ts.isObjectLiteralExpression(mopts)) {
              for (const prop of mopts.properties) {
                if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)
                    && prop.name.text === "clientId" && ts.isStringLiteral(prop.initializer)) {
                  fieldValues.set("_clientId", prop.initializer.text);
                }
              }
            }
          }
          // Thin Store: the namespace is the construction fact (plain text —
          // the plugin case quotes it when composing the settings key).
          if (className === "Store" && ctorArgs && ctorArgs.length >= 1 && ts.isStringLiteral(ctorArgs[0])) {
            fieldValues.set("_ns", ctorArgs[0].text);
          }
          // Thin BLE: the advertised name is the construction fact.
          if (className === "BLE" && ctorArgs && ctorArgs.length >= 1 && ts.isStringLiteral(ctorArgs[0])) {
            fieldValues.set("_name", JSON.stringify(ctorArgs[0].text));
          }
          if (className === "Counter" && ctorArgs && ctorArgs.length >= 1 && ts.isNumericLiteral(ctorArgs[0])) {
            fieldValues.set("_instance", ctorArgs[0].text.replace(/_/g, ""));
          }

          // Thin WiFi station: first arg is the ssid literal; the opts carry
          // the link facts. Nested ipv4 facts flatten to _ipAddr/_gateway/
          // _netmask. Computed defaults (security ternary, timeoutMs ??) are
          // applied by the wifiJoin plugin case, not here.
          if (className === "WiFi" && ctorArgs && ctorArgs.length >= 1) {
            if (ts.isStringLiteral(ctorArgs[0])) {
              fieldValues.set("_ssid", JSON.stringify(ctorArgs[0].text));
            } else {
              fieldValues.set("_ssid", ctorArgs[0].getText());
            }
            const wopts = ctorArgs[1];
            if (wopts && ts.isObjectLiteralExpression(wopts)) {
              for (const prop of wopts.properties) {
                if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
                const name = prop.name.text;
                if (name === "ipv4" && ts.isObjectLiteralExpression(prop.initializer)) {
                  for (const ip of prop.initializer.properties) {
                    if (!ts.isPropertyAssignment(ip) || !ts.isIdentifier(ip.name)) continue;
                    const ipName = ip.name.text;
                    const key = ipName === "addr" ? "_ipAddr" : `_${ipName}`;
                    if (ts.isStringLiteral(ip.initializer)) {
                      fieldValues.set(key, JSON.stringify(ip.initializer.text));
                    } else {
                      fieldValues.set(key, ip.initializer.getText());
                    }
                  }
                } else if (name !== "powerSave") {
                  if (ts.isStringLiteral(prop.initializer)) {
                    fieldValues.set(`_${name}`, JSON.stringify(prop.initializer.text));
                  } else if (ts.isNumericLiteral(prop.initializer)) {
                    fieldValues.set(`_${name}`, prop.initializer.text.replace(/_/g, ""));
                  } else {
                    fieldValues.set(`_${name}`, prop.initializer.getText());
                  }
                } else {
                  // powerSave: WiFi.PS_OFF token → ps=1 flag (0 = default on).
                  const txt = prop.initializer.getText();
                  fieldValues.set("_ps", txt.includes("PS_OFF") ? "1" : "0");
                }
              }
            }
          }
          if (className === "Thread" && ctorArgs && ctorArgs.length >= 1 && ts.isNumericLiteral(ctorArgs[0])) {
            fieldValues.set("_index", ctorArgs[0].text.replace(/_/g, ""));
            // stackKb → bytes here (the class-body arithmetic is erased).
            const kbArg = ctorArgs.length >= 2 && ts.isObjectLiteralExpression(ctorArgs[1])
              ? ctorArgs[1].properties.find((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "stackKb")
              : undefined;
            const kb = kbArg && ts.isPropertyAssignment(kbArg) && ts.isNumericLiteral(kbArg.initializer)
              ? parseInt(kbArg.initializer.text.replace(/_/g, ""), 10) : 2;
            fieldValues.set("_stackBytes", String((isNaN(kb) ? 2 : kb) * 1024));
          }

          // Tier-2 thin buses. The first arg is the board's bus/port instance
          // export (I2C0/SPI0/UART1) — kept as text, which the lowerings'
          // parseControllerIndex reads; SPITarget adds the cs pin (identifier
          // or property access, resolved later like every pin arg); opts carry
          // the wire facts (hz/mode/baud).
          const thinBusFirst: Record<string, true> = { I2CTarget: true, SPITarget: true, UART: true };
          if (thinBusFirst[className] && ctorArgs && ctorArgs.length >= 1) {
            const busArg = ctorArgs[0];
            if (ts.isIdentifier(busArg)) {
              const inst = halInstances.get(busArg.text);
              fieldValues.set("_bus", inst?.fieldValues.get("_bus") ?? busArg.text);
              fieldValues.set("_port", inst?.fieldValues.get("_port") ?? inst?.fieldValues.get("_bus") ?? busArg.text);
            } else if (ts.isStringLiteral(busArg)) {
              fieldValues.set("_bus", busArg.text);
              fieldValues.set("_port", busArg.text);
            } else {
              fieldValues.set("_bus", busArg.getText());
              fieldValues.set("_port", busArg.getText());
            }
          }
          if (className === "SPITarget" && ctorArgs && ctorArgs.length >= 2) {
            const csArg = ctorArgs[1];
            if (ts.isIdentifier(csArg)) {
              const inst = halInstances.get(csArg.text);
              fieldValues.set("_cs", inst?.fieldValues.get("_pin") ?? inst?.fieldValues.get("pin") ?? csArg.text);
            } else {
              fieldValues.set("_cs", csArg.getText());
            }
          }
          if (className === "I2CTarget" && ctorArgs && ctorArgs.length >= 2 && ts.isNumericLiteral(ctorArgs[1])) {
            fieldValues.set("_address", ctorArgs[1].text);
          }
          const thinBusOpts: Record<string, true> = { I2CTarget: true, SPITarget: true, UART: true, Thread: true };
          if (thinBusOpts[className] && ctorArgs && ctorArgs.length >= 2) {
            // I2CTarget/UART: (bus, opts?); SPITarget: (bus, cs, opts?).
            const optsArg = ctorArgs.length === 2 ? ctorArgs[1] : ctorArgs[2];
            if (optsArg && ts.isObjectLiteralExpression(optsArg)) {
              for (const prop of optsArg.properties) {
                if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
                const name = prop.name.text;
                if (ts.isNumericLiteral(prop.initializer)) {
                  fieldValues.set(`_${name}`, prop.initializer.text.replace(/_/g, ""));
                } else {
                  fieldValues.set(`_${name}`, prop.initializer.getText());
                }
              }
            }
          }

          // Thin-class field DEFAULTS (the singleton __default_fields channel
          // does not reach constructed instances). Fill only absent fields —
          // an omitted opts object must resolve to these sentinels, not leak
          // `this->_gain` text into the ops (string args pass through raw).
          const thinFieldDefaults: Record<string, Record<string, string>> = {
            ADC: { _gain: "", _reference: "" },
            I2CTarget: { _hz: "0" },
            SPITarget: { _hz: "1000000", _mode: "0" },
            UART: { _baud: "115200", _rxBufferBytes: "64" },
            DAC: { _resolution: "0" },
          };
          // WiFi absent-fact sentinels: fields whose class initializer is
          // `opts.x?.y` render as raw `this->_x` when the fact was omitted.
          // "undefined" is what dropUndefined() strips at the plugin case,
          // so the op omits the fact entirely.
          if (className === "WiFi") {
            const wifiDefaults: Record<string, string> = {
              _psk: "undefined", _ipAddr: "undefined", _gateway: "undefined",
              _netmask: "undefined", _timeoutMs: "15000", _channel: "0",
              _band: "0", _ps: "0",
            };
            for (const [k, v] of Object.entries(wifiDefaults)) {
              if (!fieldValues.has(k)) fieldValues.set(k, v);
            }
          }
          const thinDefs = thinFieldDefaults[className];
          if (thinDefs) {
            for (const [k, v] of Object.entries(thinDefs)) {
              if (!fieldValues.has(k)) fieldValues.set(k, v);
            }
          }

          if (ctorArgs) {
            // Resolve a Pin-identifier ctor arg to its _pin number, for any HAL
            // class whose first constructor field is _pin (Pin itself, plus
            // pin-bearing wrappers like RmtChannel). Mirrors the Pin branch
            // above but keyed off the class's registered ctor field map so new
            // pin-keyed classes work without a per-class branch here.
            const ctorFieldMap = getHALCtorFieldMap(className);
            const firstFieldIsPin = ctorFieldMap && Array.from(ctorFieldMap.keys())[0] === "_pin";
            for (const arg of ctorArgs) {
              if (ts.isIdentifier(arg) && (className === "Pin" || firstFieldIsPin)) {
                const existing = halInstances.get(arg.text);
                if (existing && existing.fieldValues.has("_pin")) {
                  fieldValues.set("_pin", existing.fieldValues.get("_pin")!);
                } else {
                  fieldValues.set("_pin", arg.text);
                }
              }
            }
          }

          halInstances.set(varName, { className, fieldValues });
          continue; // skip declaration
        }
      } else if (ts.isCallExpression(declaration.initializer) && ts.isPropertyAccessExpression(declaration.initializer.expression)) {
        const method = declaration.initializer.expression.name.text;
        const result = resolveHALCallForVarInit(declaration.initializer, sourceText, diagnostics, pointerVars);
        const receiver = declaration.initializer.expression.expression;
        const isOwnershipMethod = method === "take" || method === "release" || method === "begin" || method === "end";
        const isSingletonReceiver = ts.isIdentifier(receiver) && isHALSingleton(receiver.text);

        if (result && (!isOwnershipMethod || isSingletonReceiver)) {
          const isHalOpReturn = result.returnValue === "__hal_op_return__";

          // A __TYPED_ARRAY__ return comes ONLY from a HAL method body
          // (`return new Uint8Array(count)` in buffer-returning device
          // methods). The method's side-effect HAL ops (the
          // i2c.read_buffer / spi.read_buffer fill loops) write INTO this buffer
          // via the __HAL_READ_BUF__ placeholder (rewritten to `varName`). So the
          // buffer var_decl MUST precede the fill ops in emitted order — at top
          // level the var_decl is hoisted to file scope which masks this, but a
          // function-local `const data = ...readBytes()` would otherwise emit the
          // fill loop referencing `data` before its declaration. Detect the typed
          // array up front so we can emit its declaration first.
          const isTypedArrayReturn = typeof result.returnValue === "string" && result.returnValue.startsWith("__TYPED_ARRAY__:");
          if (isTypedArrayReturn && typeof result.returnValue === "string") {
            const parts = result.returnValue.split(":");
            const elementType = parts[1];
            const size = parts[2];
            // Force non-const storage (the buffer is written by the fill op) and
            // synthesize a zero-init array initializer so the var_decl renderer
            // emits `T data[] = { 0, 0, ... }` — a bare `const T data[N];` that
            // is later written would fail to compile (assignment to const).
            // Mirrors plain `new Uint8Array(N)` (expression-to-ir.ts).
            const count = parseInt(size, 10);
            const initElements = !isNaN(count) && count > 0 && count <= 256
              ? Array(count).fill(0).map(() => ({ kind: "number" as const, value: 0 }))
              : [];
            lowered.push({
              kind: "var_decl",
              sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
              leadingComments: commentsAssigned ? [] : statementComments.leadingComments,
              trailingComments: [],
              name: varName,
              storage: "let",
              cppType: `${elementType}[${size}]`,
              initializer: initElements.length > 0
                ? { kind: "array" as const, elements: initElements, elementType }
                : undefined,
            });
            activeCArrayVars.add(varName);
            commentsAssigned = true;
          }

          if (result.halOps && result.halOps.length > 0) {
            const sideEffectOps = isHalOpReturn ? result.halOps.slice(0, -1) : result.halOps;
            const halStmts = sideEffectOps.map(op => ({
              kind: "hal-op" as const,
              sourceSpan: makeSourceSpan(declaration.initializer!, fileName, sourceText),
              operation: replaceHalReadBufferPlaceholder(op, varName),
              returns_value: false,
            }));
            lowered.push(...halStmts);
            commentsAssigned = true;
          }
          const stmts = result.emitLines.map(line => ({
            kind: "call" as const,
            sourceSpan: makeSourceSpan(declaration.initializer!, fileName, sourceText),
            callee: "__EMIT__",
            args: [{ kind: "string" as const, value: line.replace(/__HAL_READ_BUF__/g, varName) }],
          }));
          if (stmts.length > 0) {
            lowered.push(...stmts);
            commentsAssigned = true;
          }
          const init = declaration.initializer as ts.CallExpression;
          if (result.returnClassName && ts.isPropertyAccessExpression(init.expression)) {
            const receiver = init.expression.expression;
            const instance = resolveHALReceiver(receiver);
            const fieldValues = new Map(instance?.fieldValues || []);
            // For device() factory calls, copy the address/cs from the call arg
            // so I2CTarget/SPITarget methods can resolve this._address / this._cs.
            if (result.returnClassName === "I2CTarget" || result.returnClassName === "SPITarget") {
              const isSpiTarget = result.returnClassName === "SPITarget";
              const fieldName = isSpiTarget ? "_cs" : "_address";
              // The targets' __default_fields channel does not reach factory
              // results; carry the wire defaults so this._hz / this._mode
              // resolve in the inlined method bodies.
              fieldValues.set("_hz", isSpiTarget ? "1000000" : "0");
              if (isSpiTarget) fieldValues.set("_mode", "0");
              const firstArg = init.arguments?.[0];
              if (firstArg) {
                if (ts.isNumericLiteral(firstArg)) fieldValues.set(fieldName, firstArg.text);
                else if (ts.isStringLiteral(firstArg)) fieldValues.set(fieldName, firstArg.text);
                else if (ts.isIdentifier(firstArg)) {
                  // Resolve pin identifiers (e.g. D10 → 10) via halInstances
                  const argInst = resolveHALReceiver(firstArg);
                  const pinVal = argInst?.fieldValues.get('_pin') ?? argInst?.fieldValues.get('pin');
                  fieldValues.set(fieldName, pinVal ?? firstArg.text);
                }
              }
            }
            halInstances.set(varName, {
              className: result.returnClassName,
              fieldValues,
            });
          } else if (ts.isPropertyAccessExpression(init.expression)) {
            const receiver = init.expression.expression;
            const instance = resolveHALReceiver(receiver);
            // Register the variable as the receiver instance ONLY when the
            // method returns the pin itself ("this", e.g. asOutput/asInput) or
            // returns nothing (a pure side-effect). A value-bearing halOp
            // (readAnalog/readVoltage — returnValue === "__hal_op_return__")
            // must NOT alias the variable to the pin: the variable holds the
            // READ RESULT, and aliasing it makes every later use substitute the
            // pin number (demo #34 Finding B). The value is captured into a
            // real var_decl below (the isHalOpReturn branch).
            if (instance && (!result.returnValue || result.returnValue === "this") && !isHalOpReturn) {
              const aliasInst: HALInstance = {
                className: instance.className,
                fieldValues: new Map(instance.fieldValues),
                ...(instance._spreadParamName ? { _spreadParamName: instance._spreadParamName } : {}),
              };
              if (method === "take" && ts.isIdentifier(receiver) && isHALSingleton(receiver.text)) {
                aliasInst.canonicalBusName = receiver.text;
                lowered.push({
                  kind: "call" as const,
                  sourceSpan: makeSourceSpan(declaration.initializer!, fileName, sourceText),
                  callee: `${receiver.text}.take`,
                  args: [],
                });
                commentsAssigned = true;
              }
              halInstances.set(varName, aliasInst);
            }
          }
          if (result.returnValue && result.returnValue !== "this") {
            const lastOp = result.halOps[result.halOps.length - 1];
            // A double-returning HAL op makes the captured var floating
            // (sensor.get → val1 + val2/1e6): the snprintf specifier picker
            // reads floatVariables and must pick %g, not %d.
            if (lastOp && lastOp.operation === "sensor.get") registerFloatVariable(varName);
            if (isHalOpReturn) {
              lowered.push({
                kind: "var_decl",
                sourceSpan: makeSourceSpan(declaration.initializer!, fileName, sourceText),
                leadingComments: commentsAssigned ? [] : statementComments.leadingComments,
                trailingComments: [],
                name: varName,
                storage,
                cppType: "auto",
                initializer: { kind: "hal-expr", operation: lastOp },
              });
            } else {
              if (/\b\d+\.\d+\b/.test(result.returnValue)) {
                registerFloatVariable(varName);
              }
              // __TYPED_ARRAY__ returns are handled above (declared BEFORE the
              // fill ops). Everything else is a scalar/value return captured
              // after the side-effect ops.
              const isTypedArray = result.returnValue.startsWith("__TYPED_ARRAY__:");
              // A factory returning a compile-time HAL instance (e.g.
              // `const req = Http.get(url)` → returnValue `new HttpRequest(...)`)
              // is fully tracked via halInstances — every later method call on
              // the variable resolves at compile time. Emitting the raw
              // `new HttpRequest(...)` would reference a class that doesn't
              // exist in the C++ output.
              const isHalInstanceReturn = !!result.returnClassName && /^new\s/.test(result.returnValue.trim());
              if (!isTypedArray && !isHalInstanceReturn) {
                lowered.push({
                  kind: "var_decl",
                  sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
                  leadingComments: commentsAssigned ? [] : statementComments.leadingComments,
                  trailingComments: [],
                  name: varName,
                  storage,
                  cppType: "auto",
                  initializer: { kind: "raw", value: result.returnValue },
                });
              }
            }
            localVariableTypes.set(varName, "auto");
            commentsAssigned = true;
          }
          continue;
        }
      }

      if (declaration.initializer && ts.isIdentifier(declaration.initializer)) {
        const existing = halInstances.get(declaration.initializer.text);
        if (existing) {
          halInstances.set(varName, existing);
          continue;
        }
      }
    }

    let isVolatile = false;
    let actualInitializer = declaration.initializer;

    if (declaration.initializer && ts.isCallExpression(declaration.initializer)) {
      const callee = declaration.initializer.expression;
      if (ts.isIdentifier(callee) && callee.text === "volatile") {
        isVolatile = true;
        if (declaration.initializer.arguments.length > 0) {
          actualInitializer = declaration.initializer.arguments[0];
        } else {
          actualInitializer = undefined;
        }
      }
    }

    // A typed-array buffer declared `const` stays writable storage: HAL fills
    // write through it (e.g. spi.transceive's rx buffer), so the emitted C
    // array must not be const — mirroring the __TYPED_ARRAY__ return branch.
    // Keeping the source storage would split the definition (`uint8_t id[]`,
    // the array renderer drops the qualifier) from the split-mode extern
    // (`extern const uint8_t id[]`) — a conflicting declaration.
    let effectiveStorage = storage;
    if (actualInitializer && ts.isNewExpression(actualInitializer)) {
      const ctorText = actualInitializer.expression && ts.isIdentifier(actualInitializer.expression)
        ? actualInitializer.expression.text : "";
      if (TYPED_ARRAY_ELEMENT_MAP[ctorText] && ts.isIdentifier(declaration.name)) {
        activeCArrayVars.add(declaration.name.text);
        if (effectiveStorage === "const") effectiveStorage = "let";
      }
    }

    let lambdaInitializer: ExpressionIR | undefined;
    if (actualInitializer && (ts.isArrowFunction(actualInitializer) || ts.isFunctionExpression(actualInitializer))) {
      const fnExpr = actualInitializer;
      const params: ParameterIR[] = [];
      for (const param of fnExpr.parameters) {
        if (ts.isIdentifier(param.name)) {
          const paramType = typeNodeToCppType(param.type, typeAliases);
          params.push({
            name: param.name.text,
            cppType: (paramType === "void" ? "auto" : paramType) as any,
            defaultValue: param.initializer ? expressionToIR(param.initializer, sourceText, diagnostics, pointerVars) : undefined,
            isRest: !!param.dotDotDotToken,
          });
        }
      }
      const isBlock = ts.isBlock(fnExpr.body);
      const body: StatementIR[] = isBlock
        ? lowerStatementListCallback(
            (fnExpr.body as ts.Block).statements,
            fileName, sourceText, diagnostics,
            new Map(), new Map(),
            declaration.name.getText(),
            typeAliases,
            pointerVars,
          )
        : [{
            kind: "return" as const,
            sourceSpan: makeSourceSpan(fnExpr.body, fileName, sourceText),
            value: expressionToIR(fnExpr.body, sourceText, diagnostics, pointerVars),
          }];
      const returnType = typeNodeToCppType(fnExpr.type, typeAliases);
      lambdaInitializer = { kind: "lambda", params, body, returnType, isExpressionBody: !isBlock };
    }

    const loweredDeclaration: Extract<StatementIR, { kind: "var_decl" }> = {
      kind: "var_decl",
      sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
      leadingComments: commentsAssigned ? [] : statementComments.leadingComments,
      trailingComments: commentsAssigned ? [] : statementComments.trailingComments,
      name: declaration.name.text,
      storage: effectiveStorage,
      cppType: "auto",
      isVolatile,
      initializer: lambdaInitializer ?? (actualInitializer
        ? expressionToIR(actualInitializer, sourceText, diagnostics, pointerVars)
        : undefined),
    };
    commentsAssigned = true;

    const declarationType = resolveDeclarationType(
      declaration.type,
      declaration.initializer,
      functionReturnTypes,
      localVariableTypes,
      typeAliases,
      sourceText,
    );

    let varCppType: string = declarationType.resolvedType === "void" ? "auto" : declarationType.resolvedType;

    // A string enum lowers to a C++ namespace (not a type), so a variable
    // whose declared TS type is a string enum must use `const char*` as its
    // C++ type — the actual type of a string-enum member. Without this,
    // `const currentColor: Color = Color.Green` emits `Color currentColor = {}`
    // where `Color` is a namespace name, not a valid C++ type (enum stress
    // test Finding A).
    if (activeStringEnumNames.has(varCppType)) {
      varCppType = "const char*";
    }

    // Resolve the base type (with pointer/const stripped) via structured IR so
    // the nestedClassAliases lookup compares against the bare name.
    {
      const varIr = parseCppType(varCppType);
      const ptr = isPointer(varIr);
      const bare = bareType(varIr);
      const bareName = bare.kind === "named" ? bare.name : renderCppType(bare);
      if (nestedClassAliases.has(bareName)) {
        const aliased = nestedClassAliases.get(bareName)!;
        const aliasedIr: CppTypeIR = ptr
          ? { kind: "pointer", base: parseCppType(aliased) }
          : parseCppType(aliased);
        varCppType = renderCppType(aliasedIr);
      }
    }

    // Object literals without a type annotation get "auto" from type resolution,
    // but the emitter will generate a struct _name_t. Set the cppType early so
    // that string-concat rendering (shouldSkipStringWrap) can recognise string
    // fields by looking up the struct type in interfaceFieldTypes.
    if (varCppType === "auto" && actualInitializer && ts.isObjectLiteralExpression(actualInitializer)) {
      varCppType = `_${declaration.name.text}_t`;
    }
    if (actualInitializer && ts.isArrayLiteralExpression(actualInitializer)) {
      const hasObjectElements = actualInitializer.elements.some(
        (e): e is ts.Expression => !ts.isSpreadElement(e) && ts.isObjectLiteralExpression(e)
      );
      if (hasObjectElements) {
        // Only generate a shadow struct (_name_t) when the declared type isn't
        // already a named-type vector (e.g. `const pts: Point[]` resolves to
        // std::vector<Point> — use Point directly, don't override with a shadow
        // struct that collides at multiple sites — demo #11 Finding D).
        const varIr = parseCppType(varCppType);
        const elemIr = elementOf(varIr);
        const elemType = elemIr ? renderCppType(elemIr) : null;
        const isNamedElementType = elemType ? /^[A-Z]/.test(elemType) : false;
        if (!isNamedElementType) {
          const structType = `_${declaration.name.text}_t`;
          const ir: CppTypeIR = { kind: "vector", element: parseCppType(structType) };
          varCppType = renderCppType(ir);
        }
      }
    }
    loweredDeclaration.cppType = varCppType as CppType;
    localVariableTypes.set(declaration.name.text, varCppType as CppTypeHint);
    // Mirror into the scope's locals view so getCurrentIrTypeScope().locals
    // readers (in expression-to-ir) see this binding. localVariableTypes is the
    // accumulating threaded map; scope.locals is the function-resettable view —
    // both must be written because a nested lowerStatementList reset clears
    // scope.locals (not localVariableTypes) and re-syncs from it.
    setScopeLocalType(declaration.name.text, varCppType as CppTypeHint);

    // Top-level (module-scope) declarations also go into the file-scoped globals
    // map so they resolve from any function in the file.
    if (!functionNameForDiagnostics || functionNameForDiagnostics === "") {
      getCurrentIrTypeScope()?.globals.set(declaration.name.text, varCppType as CppTypeHint);
    }

    // String-var detection via structured isStringLike rather than a string-equality ladder.
    if (isStringLike(parseCppType(declarationType.resolvedType))) {
      activeStringVars.add(declaration.name.text);
    }

    if (ts.isIdentifier(declaration.name) && actualInitializer) {
      const varName = declaration.name.text;

      if (ts.isArrayLiteralExpression(actualInitializer)
          && (getContext().activeStrategy?.promotesArrayLiteralsToStaticArray?.() ?? true)) {
        const elements = actualInitializer.elements;
        let elemType = "int";
        // Extract element type via structured elementOf. Prefer `varCppType`
        // (the corrected declared type — for an anonymous-object array literal
        // it carries the shadow struct `_<name>_t`, set above) over the raw
        // resolver view (`declarationType.resolvedType`), which can mis-infer
        // an anonymous object element as `double`.
        const resolvedIr = parseCppType(varCppType && varCppType !== "auto" ? varCppType : declarationType.resolvedType);
        const elemIr = elementOf(resolvedIr);
        if (elemIr) {
          elemType = renderCppType(elemIr);
        } else if (declarationType.resolvedType === "auto" && elements.length > 0) {
          elemType = inferExprCppType(elements[0], functionReturnTypes, localVariableTypes, sourceText);
        }

        // Promote to StaticArray when the array is mutated (the original
        // condition) OR when the element type is a struct/non-primitive: a
        // read-only primitive array already emits a C array correctly, but a
        // read-only STRUCT-element array otherwise lowers to std::vector<T>
        // and SILENTLY miscompiles on AVR (no <vector>, no diagnostic) —
        // destructuring stress test Finding D. A named (capitalized) element
        // type is the struct case, as is an anonymous-object shadow struct
        // (`_<name>_t`, generated for inline `{ x, y }` element types);
        // primitives (int32_t, bool, ...) take the existing C-array path.
        const isStructElement = (/^[A-Z]/.test(elemType) && elemType !== "Int")
          || /^_[A-Za-z0-9_]+_t$/.test(elemType)
          // Anonymous-object array literal: the type resolver may mis-infer
          // the element type (e.g. {x,y}[] → std::vector<double>), so also
          // detect struct elements structurally — any element that is an
          // object literal means a struct-element array (shadow struct).
          || actualInitializer.elements.some(
            (e): e is ts.Expression => !ts.isSpreadElement(e) && ts.isObjectLiteralExpression(e),
          );
        const shouldPromote = mutableArrayVars.has(varName) || isStructElement;

        if (shouldPromote) {
          // When the element type is a shadow struct (anonymous object), emit
          // the struct definition BEFORE the StaticArray var_decl. The
          // non-promotion path emits it via the object-literal initializer;
          // the promotion path replaces that initializer, so the definition
          // must be emitted here explicitly.
          if (/^_[A-Za-z0-9_]+_t$/.test(elemType)) {
            const firstObj = elements.find(
              (e): e is ts.Expression => !ts.isSpreadElement(e) && ts.isObjectLiteralExpression(e),
            );
            if (firstObj && ts.isObjectLiteralExpression(firstObj)) {
              const fieldDefs = firstObj.properties
                .filter(ts.isPropertyAssignment)
                .map((p) => {
                  const fname = ts.isIdentifier(p.name) ? p.name.text : p.name.getText();
                  const ftype = inferExprCppType(p.initializer, functionReturnTypes, localVariableTypes, sourceText);
                  return `${ftype || "auto"} ${fname};`;
                })
                .join("  ");
              lowered.push({
                kind: "call",
                sourceSpan: loweredDeclaration.sourceSpan,
                callee: "__EMIT__",
                args: [{ kind: "string", value: `struct ${elemType} { ${fieldDefs} };` }],
              });
            }
          }
          const capacity = elements.length + 2;
          const staticArrayIr: CppTypeIR = {
            kind: "staticArray",
            element: parseCppType(elemType),
            size: capacity,
          };
          lowered.push({
            kind: "var_decl",
            sourceSpan: loweredDeclaration.sourceSpan,
            leadingComments: loweredDeclaration.leadingComments,
            trailingComments: [],
            name: varName,
            storage: "let",
            cppType: renderCppType(staticArrayIr) as any,
            initializer: undefined,
          });
          for (let ei = 0; ei < elements.length; ei++) {
            lowered.push({
              kind: "call",
              sourceSpan: loweredDeclaration.sourceSpan,
              callee: `${varName}.push`,
              args: [expressionToIR(elements[ei], sourceText, diagnostics)],
            });
          }
          commentsAssigned = true;
          continue;
        }
      }

      // Native target lowers array literals to std::vector (not StaticArray), so
      // the promotion block above is skipped — but a `const` array mutated via
      // .push/.pop/[i]= must STILL be demoted to non-const storage, or the
      // emitted `const std::vector` rejects push_back/operator[]. This mirrors
      // the `storage: "let"` the promotion block sets for StaticArray.
      if (mutableArrayVars.has(varName) && ts.isArrayLiteralExpression(actualInitializer)
          && !(getContext().activeStrategy?.promotesArrayLiteralsToStaticArray?.() ?? true)) {
        loweredDeclaration.storage = "let";
      }

      if (mutableArrayVars.has(varName) && !ts.isArrayLiteralExpression(actualInitializer)) {
        loweredDeclaration.storage = "let";
      }

      if (ts.isCallExpression(actualInitializer) &&
          ts.isPropertyAccessExpression(actualInitializer.expression) &&
          actualInitializer.expression.name.text === "map" &&
          ts.isIdentifier(actualInitializer.expression.expression)) {
        const srcName = actualInitializer.expression.expression.text;
        const srcSize = arrayLiteralSizes.get(srcName);
        const arrowFn = actualInitializer.arguments[0];
        if (srcSize !== undefined && arrowFn && (ts.isArrowFunction(arrowFn) || ts.isFunctionExpression(arrowFn))) {
          const param = arrowFn.parameters[0];
          const paramName = param && ts.isIdentifier(param.name) ? param.name.text : "__x";
          const bodyExpr = ts.isBlock(arrowFn.body) ? undefined : arrowFn.body;
          if (bodyExpr) {
            const span = loweredDeclaration.sourceSpan;
            const srcType = getCurrentIrTypeScope()?.locals.get(srcName) ?? getCurrentIrTypeScope()?.globals.get(srcName) ?? "auto";
            // Element type of a vector/staticArray/cArray, else the type itself.
            const elemType = (() => {
              const e = elementOf(parseCppType(srcType));
              return e ? renderCppType(e) : srcType;
            })();
            const zeroElements: ExpressionIR[] = [];
            for (let zi = 0; zi < srcSize; zi++) zeroElements.push({ kind: "number", value: 0 });
            lowered.push({
              kind: "var_decl",
              sourceSpan: span,
              leadingComments: loweredDeclaration.leadingComments,
              trailingComments: [],
              name: varName,
              storage: "let",
              cppType: "auto",
              initializer: { kind: "array", elementType: elemType, elements: zeroElements },
            });
            activeCArrayVars.add(varName);
            lowered.push(buildInlineForLoop(
              span, srcSize, srcName, paramName, bodyExpr,
              sourceText, diagnostics, `${varName}[__tc_i]`, false,
            ));
            commentsAssigned = true;
            continue;
          }
        }
      }

      if (ts.isCallExpression(actualInitializer) &&
          ts.isPropertyAccessExpression(actualInitializer.expression) &&
          actualInitializer.expression.name.text === "filter" &&
          ts.isIdentifier(actualInitializer.expression.expression)) {
        const srcName = actualInitializer.expression.expression.text;
        const srcSize = arrayLiteralSizes.get(srcName);
        const arrowFn = actualInitializer.arguments[0];
        // Only inline-lower filter when the source has a known, non-zero
        // literal size. A source initialised as `[]` (size 0) or grown via
        // .push() is runtime-sized: the inline lowering would emit a
        // zero-length fixed C array and a `for (... < 0; ...)` loop that
        // never runs. Fall through to the strategy's `__tc_filter` polyfill,
        // which returns a std::vector<T> built up with push_back.
        if (srcSize !== undefined && srcSize > 0 && arrowFn && (ts.isArrowFunction(arrowFn) || ts.isFunctionExpression(arrowFn))) {
          const param = arrowFn.parameters[0];
          const paramName = param && ts.isIdentifier(param.name) ? param.name.text : "__x";
          const bodyExpr = ts.isBlock(arrowFn.body) ? undefined : arrowFn.body;
          if (bodyExpr) {
            const span = loweredDeclaration.sourceSpan;
            const lenVar = `${varName}__len`;
            const srcType = getCurrentIrTypeScope()?.locals.get(srcName) ?? getCurrentIrTypeScope()?.globals.get(srcName) ?? "auto";
            // Element type of a vector/staticArray/cArray, else the type itself.
            const elemType = (() => {
              const e = elementOf(parseCppType(srcType));
              return e ? renderCppType(e) : srcType;
            })();
            const zeroElements: ExpressionIR[] = [];
            for (let zi = 0; zi < srcSize; zi++) zeroElements.push({ kind: "number", value: 0 });
            lowered.push({
              kind: "var_decl", sourceSpan: span,
              leadingComments: loweredDeclaration.leadingComments, trailingComments: [],
              name: varName, storage: "let", cppType: "auto",
              initializer: { kind: "array", elementType: elemType, elements: zeroElements },
            });
            lowered.push({
              kind: "var_decl", sourceSpan: span,
              leadingComments: [], trailingComments: [],
              name: lenVar, storage: "let", cppType: "int",
              initializer: { kind: "number", value: 0 },
            });
            filteredArrayLengthVars.set(varName, lenVar);
            const conditionIR = expressionToIR(bodyExpr, sourceText, diagnostics);
            lowered.push({
              kind: "for",
              sourceSpan: span,
              initializer: { kind: "var_decl", sourceSpan: span, name: "__tc_i", storage: "let", cppType: "int", initializer: { kind: "number", value: 0 } },
              condition: { kind: "binary", left: { kind: "identifier", value: "__tc_i" }, operator: "<", right: { kind: "number", value: srcSize } },
              increment: { kind: "update", sourceSpan: span, target: "__tc_i", operator: "++", prefix: false },
              body: [
                { kind: "var_decl", sourceSpan: span, name: paramName, storage: "const", cppType: "auto",
                  initializer: { kind: "raw", value: `${srcName}[__tc_i]` } },
                { kind: "if", sourceSpan: span,
                  condition: conditionIR,
                  thenBranch: [
                    { kind: "assign", sourceSpan: span, target: `${varName}[${lenVar}]`, operator: "=",
                      value: { kind: "raw", value: `${srcName}[__tc_i]` } },
                    { kind: "update", sourceSpan: span, target: lenVar, operator: "++", prefix: false },
                  ],
                },
              ],
            });
            commentsAssigned = true;
            continue;
          }
        }
      }

      if (ts.isCallExpression(actualInitializer) &&
          ts.isPropertyAccessExpression(actualInitializer.expression) &&
          actualInitializer.expression.name.text === "reduce" &&
          ts.isIdentifier(actualInitializer.expression.expression)) {
        const srcName = actualInitializer.expression.expression.text;
        const srcSize = arrayLiteralSizes.get(srcName);
        const arrowFn = actualInitializer.arguments[0];
        const initVal = actualInitializer.arguments[1];
        if (srcSize !== undefined && arrowFn && (ts.isArrowFunction(arrowFn) || ts.isFunctionExpression(arrowFn))) {
          const accParam = arrowFn.parameters[0];
          const valParam = arrowFn.parameters[1];
          const accName = accParam && ts.isIdentifier(accParam.name) ? accParam.name.text : "__acc";
          const valName = valParam && ts.isIdentifier(valParam.name) ? valParam.name.text : "__val";
          const bodyExpr = ts.isBlock(arrowFn.body) ? undefined : arrowFn.body;
          if (!initVal) {
            diagnostics.push(
              makeDiagnostic(
                sourceText,
                actualInitializer.pos,
                "reduce() requires an initial value argument for C++ transpilation.",
                "warning",
                "TS2CPP_REDUCE_NO_INIT",
              ),
            );
          }
          if (bodyExpr && initVal) {
            const span = loweredDeclaration.sourceSpan;
            lowered.push({
              kind: "var_decl", sourceSpan: span,
              leadingComments: loweredDeclaration.leadingComments, trailingComments: [],
              name: varName, storage: "let", cppType: "auto",
              initializer: expressionToIR(initVal, sourceText, diagnostics),
            });
            const bodyIR = expressionToIR(bodyExpr, sourceText, diagnostics);
            lowered.push({
              kind: "for",
              sourceSpan: span,
              initializer: { kind: "var_decl", sourceSpan: span, name: "__tc_i", storage: "let", cppType: "int", initializer: { kind: "number", value: 0 } },
              condition: { kind: "binary", left: { kind: "identifier", value: "__tc_i" }, operator: "<", right: { kind: "number", value: srcSize } },
              increment: { kind: "update", sourceSpan: span, target: "__tc_i", operator: "++", prefix: false },
              body: [
                { kind: "var_decl", sourceSpan: span, name: valName, storage: "const", cppType: "auto",
                  initializer: { kind: "raw", value: `${srcName}[__tc_i]` } },
                { kind: "var_decl", sourceSpan: span, name: accName, storage: "const", cppType: "auto",
                  initializer: { kind: "identifier", value: varName } },
                { kind: "assign", sourceSpan: span, target: varName, operator: "=", value: bodyIR },
              ],
            });
            commentsAssigned = true;
            continue;
          }
        }
      }

      if (ts.isCallExpression(actualInitializer) &&
          ts.isPropertyAccessExpression(actualInitializer.expression) &&
          actualInitializer.expression.name.text === "push" &&
          ts.isIdentifier(actualInitializer.expression.expression)) {
        const arrName = actualInitializer.expression.expression.text;
        if (mutableArrayVars.has(arrName) && actualInitializer.arguments.length > 0) {
          const span = loweredDeclaration.sourceSpan;
          lowered.push({
            kind: "call", sourceSpan: span,
            callee: `${arrName}.push`,
            args: [expressionToIR(actualInitializer.arguments[0], sourceText, diagnostics)],
          });
          lowered.push({
            kind: "var_decl", sourceSpan: span,
            leadingComments: loweredDeclaration.leadingComments, trailingComments: [],
            name: varName, storage, cppType: "auto",
            initializer: { kind: "raw", value: `${arrName}.size()` },
          });
          commentsAssigned = true;
          continue;
        }
      }

      if (ts.isArrayLiteralExpression(actualInitializer) && !mutableArrayVars.has(varName)) {
        const vecMatch = isVector(parseCppType(varCppType));
        const inferredVecMatch = isVector(parseCppType(declarationType.inferredType));
        if (!vecMatch && inferredVecMatch) {
          activeArrayLiteralVars.add(varName);
          loweredDeclaration.cppType = "auto" as any;
          localVariableTypes.set(varName, declarationType.inferredType);
          setScopeLocalType(varName, declarationType.inferredType);
        } else if (!vecMatch) {
          activeArrayLiteralVars.add(varName);
          activeCArrayVars.add(varName);
          loweredDeclaration.cppType = "auto" as any;
          localVariableTypes.set(varName, "auto");
          setScopeLocalType(varName, "auto");
        } else if (vecMatch && !(getContext().activeStrategy?.needsStdVector() ?? true)) {
          // Demo #33 Finding B — an explicitly array-TYPED non-mutated literal
          // (`const SAMPLES: int32_t[] = [...]`) keeps its `std::vector<...>`
          // cppType (so emit renders the right element type), but on a target
          // that does NOT need std::vector (`!needsStdVector()`, e.g. Arduino
          // AVR) it STILL emits as a RAW C array `T name[] = {...}` (the
          // emit-side discriminator class-emitter.ts addCArrayIfNotMutable
          // uses exactly `!needsStdVector()`). Without tracking it in
          // activeArrayLiteralVars, `.length` resolution fell through to the
          // default `.size()` — invalid for a raw C array (avr-g++: "request
          // for member 'size' in 'SAMPLES', which is of non-class type").
          // The localVariableTypes entry keeps the `std::vector<...>` spelling
          // so resolveLengthProperty's container-vs-sizeof decision (which
          // checks needsStdVector + mutableArrayVars membership) routes
          // correctly.
          activeArrayLiteralVars.add(varName);
        }
      }
    }

    const ownershipKind = extractOwnershipKindFromTypeNode(declaration.type, typeAliases);
    if (ownershipKind) {
      loweredDeclaration.ownershipKind = ownershipKind;
    }

    if (declarationType.shouldWarnUnmappedType) {
      diagnostics.push(
        makeDiagnostic(
          sourceText,
          declaration.pos,
          `Type annotation on '${declaration.name.text}' is not yet mapped; emitted as 'auto'.`,
          "warning",
          "TS2CPP_UNMAPPED_TYPE",
        ),
      );
    }

    if (ts.isIdentifier(declaration.name) && !actualInitializer && mutableArrayVars.has(declaration.name.text)) {
      loweredDeclaration.storage = "let";
    }

    lowered.push(loweredDeclaration);
  }

  return lowered;
}

export function collectPointerVars(statements: readonly ts.Statement[]): PointerTracker {
  const pointerVars = new Map<string, string>();

  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer && ts.isNewExpression(decl.initializer)) {
          const ctorText = decl.initializer.expression && ts.isIdentifier(decl.initializer.expression)
            ? decl.initializer.expression.text : "";
          if (TYPED_ARRAY_ELEMENT_MAP[ctorText]) {
            activeCArrayVars.add(decl.name.text);
          } else {
            pointerVars.set(decl.name.text, ctorText);
          }
        }
      }
    }
  }

  return pointerVars;
}

/**
 * Resolve the second `new Sensor(part, <dev>)` argument to an I2C bus name +
 * 7-bit address. Accepts the inline factory form `I2C1.device(0x44)` and an
 * identifier previously bound to one (`const dev = I2C1.device(0x44)`). The
 * general receiver resolution carries the bus fields through `device()`'s
 * I2CTarget return type; the inline form's address is taken from the call's
 * numeric argument (the general path does not extract call args).
 */
function resolveSensorDeviceArg(arg: ts.Expression): { bus: string; port: string; kind: "i2c" | "spi" } | null {
  const inst = resolveHALReceiver(arg);
  const portField = inst?.className === "SPITarget" ? "_cs" : "_address";
  if (inst && (inst.className === "I2CTarget" || inst.className === "SPITarget") && inst.fieldValues.has("_bus") && inst.fieldValues.has(portField)) {
    return { bus: inst.fieldValues.get("_bus")!, port: inst.fieldValues.get(portField)!, kind: inst.className === "SPITarget" ? "spi" : "i2c" };
  }
  // Inline bus.device(<port>) call: the general receiver path carries the bus
  // fields through device()'s return type but drops the argument — take the
  // port from the call's numeric literal.
  if (ts.isCallExpression(arg) && ts.isPropertyAccessExpression(arg.expression) && arg.expression.name.text === "device") {
    const args = (arg.arguments as ts.NodeArray<ts.Expression> | undefined) ?? [];
    const numericArg = args.find((a) => ts.isNumericLiteral(a));
    // SPI CS arrives as a pin identifier (SPI0.device(PA4)) — resolve it to
    // its number the same way the device() chain path does.
    const pinArg = args.find((a) => ts.isIdentifier(a));
    const pinInst = pinArg && ts.isIdentifier(pinArg) ? halInstances.get(pinArg.text) : undefined;
    const portText = numericArg && ts.isNumericLiteral(numericArg)
      ? numericArg.text
      : (pinInst?.fieldValues.get("_pin") ?? pinInst?.fieldValues.get("pin"));
    if (inst && inst.fieldValues.has("_bus") && portText !== undefined) {
      // The bus kind follows the receiver's resolved class when it round-
      // tripped; otherwise infer from the bus alias (SPI/SPI<n> vs Wire).
      const busName = inst.fieldValues.get("_bus")!;
      const kind: "i2c" | "spi" = inst.className === "SPITarget" || /^SPI/.test(busName) ? "spi" : "i2c";
      return { bus: busName, port: portText, kind };
    }
  }
  return null;
}
