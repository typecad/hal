import ts from "typescript";
import { Diagnostic } from "../../types";
import { StatementIR, ExpressionIR, ParameterIR, CppType } from "../../api";
import { extractNodeComments, makeDiagnostic, makeSourceSpan } from "../ast-node-utils";
import { CppTypeHint, inferExprCppType, resolveDeclarationType, typeNodeToCppType, extractOwnershipKindFromTypeNode } from "../type-resolution";
import {
  PointerTracker,
  TYPED_ARRAY_ELEMENT_MAP,
  activeCArrayVars,
  activeArrayLiteralVars,
  activeStringVars,
  mutableArrayVars,
  arrayLiteralSizes,
  filteredArrayLengthVars,
  activeLocalTypes,
  activeGlobalTypes,
  halInstances,
  nestedClassAliases,
  registerFieldMap
} from "../build-ir-state";
import { renderExprAsText } from "../render-expr";
import { expressionToIR } from "../expression-to-ir";
import { buildInlineForLoop } from "./array-methods";
import {
  isKnownHALClass,
  getCtorIncludes,
  registerFloatVariable,
  resolveHALReceiver,
  isHALSingleton
} from "../hal-resolver";
import { resolveHALCallForVarInit } from "./hal-call-resolver";

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
            "warning",
            "TS2CPP_UNSUPPORTED_DECL",
          ),
        );
        continue;
      }
      
      const objExpr = expressionToIR(declaration.initializer, sourceText, diagnostics);
      const objText = renderExprAsText(objExpr);
      const objType = ts.isIdentifier(declaration.initializer)
        ? activeLocalTypes.get(declaration.initializer.text) ?? activeGlobalTypes.get(declaration.initializer.text)
        : undefined;
      const isPointerAccess = objType?.endsWith("*");
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
            for (const nestedElement of element.name.elements) {
              if (!ts.isBindingElement(nestedElement) || !ts.isIdentifier(nestedElement.name)) continue;
              const nestedVarName = nestedElement.name.text;
              let nPropName = nestedVarName;
              if (nestedElement.propertyName && ts.isIdentifier(nestedElement.propertyName)) {
                nPropName = nestedElement.propertyName.text;
              }
              const propAccess: ExpressionIR = { kind: "raw", value: `${nestedObjText}${accessor}${nPropName}` };
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

        // Create individual variable declaration for each destructured property
        const propAccess: ExpressionIR = { kind: "raw", value: `${objText}${accessor}${propName}` };
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
            "warning",
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
            lowered.push({
              kind: "var_decl",
              sourceSpan: makeSourceSpan(element, fileName, sourceText),
              leadingComments: [],
              trailingComments: [],
              name: varName,
              storage,
              cppType: "auto",
              initializer: { kind: "raw", value: `std::vector<decltype(${arrText}[0])>(${arrText}.begin() + ${i}, ${arrText}.end())` },
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
          initializer = arrElements[i];
        } else {
          initializer = { kind: "raw", value: `${arrText}[${i}]` };
        }

        if (element.initializer) {
          initializer = {
            kind: "raw" as const,
            value: `cuttlefish_nullish(${renderExprAsText(initializer)}, ${renderExprAsText(expressionToIR(element.initializer, sourceText, diagnostics))})`,
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
          "warning",
          "TS2CPP_UNSUPPORTED_DECL",
        ),
      );
      continue;
    }

    // ── HAL resolver for variable declarations ──────────────────────────────
    if (declaration.initializer && ts.isIdentifier(declaration.name)) {
      const varName = declaration.name.text;

      if (ts.isNewExpression(declaration.initializer) && ts.isIdentifier(declaration.initializer.expression)) {
        const className = declaration.initializer.expression.text;
        const ctorArgs = declaration.initializer.arguments as ts.NodeArray<ts.Expression> | undefined;

        if (isKnownHALClass(className)) {
          const fieldValues = new Map<string, string>();
          const ctorIncludes = getCtorIncludes(className);
          for (const inc of ctorIncludes) {
            // Under structure, requiredIncludes is tracked in build-ir-state
            const { requiredIncludes: ri } = require("../build-ir-state");
            ri.add(inc);
          }

          if (ctorArgs) {
            for (const arg of ctorArgs) {
              if (ts.isIdentifier(arg)) {
                // Resolved pin/port identifier mappings
              } else if (ts.isStringLiteral(arg)) {
                if (className === "I2CBus") fieldValues.set("_bus", arg.text);
                else if (className === "SPIBus") fieldValues.set("_bus", arg.text);
                else if (className === "SerialPort") fieldValues.set("_port", arg.text);
                else if (className === "EEPROMClass") fieldValues.set("_name", arg.text);
              } else if (ts.isNumericLiteral(arg)) {
                if (className === "Pin") fieldValues.set("_pin", arg.text);
              } else if (ts.isPropertyAccessExpression(arg)) {
                if (className === "Pin") fieldValues.set("_pin", arg.getText());
              }
            }
          }

          if (ctorArgs) {
            for (const arg of ctorArgs) {
              if (ts.isIdentifier(arg) && className === "Pin") {
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

          if (result.halOps && result.halOps.length > 0) {
            const sideEffectOps = isHalOpReturn ? result.halOps.slice(0, -1) : result.halOps;
            const halStmts = sideEffectOps.map(op => ({
              kind: "hal-op" as const,
              sourceSpan: makeSourceSpan(declaration.initializer!, fileName, sourceText),
              operation: op,
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
            halInstances.set(varName, {
              className: result.returnClassName,
              fieldValues: new Map(instance?.fieldValues || []),
            });
          } else if (ts.isPropertyAccessExpression(init.expression)) {
            const receiver = init.expression.expression;
            const instance = resolveHALReceiver(receiver);
            if (instance && (!result.returnValue || result.returnValue === "this" || isHalOpReturn)) {
              halInstances.set(varName, instance);
            }
          }
          if (result.returnValue && result.returnValue !== "this") {
            if (isHalOpReturn) {
              const lastOp = result.halOps[result.halOps.length - 1];
              lowered.push({
                kind: "var_decl",
                sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
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
              const isTypedArray = result.returnValue.startsWith("__TYPED_ARRAY__:");
              if (isTypedArray) {
                const parts = result.returnValue.split(":");
                const elementType = parts[1];
                const size = parts[2];
                lowered.push({
                  kind: "var_decl",
                  sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
                  leadingComments: commentsAssigned ? [] : statementComments.leadingComments,
                  trailingComments: [],
                  name: varName,
                  storage,
                  cppType: `${elementType}[${size}]`,
                  initializer: undefined,
                });
                activeCArrayVars.add(varName);
              } else {
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

    if (actualInitializer && ts.isNewExpression(actualInitializer)) {
      const ctorText = actualInitializer.expression && ts.isIdentifier(actualInitializer.expression)
        ? actualInitializer.expression.text : "";
      if (TYPED_ARRAY_ELEMENT_MAP[ctorText] && ts.isIdentifier(declaration.name)) {
        activeCArrayVars.add(declaration.name.text);
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
      storage,
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
    const isPtr = varCppType.endsWith("*");
    const baseCppType = isPtr ? varCppType.slice(0, -1) : varCppType;
    if (nestedClassAliases.has(baseCppType)) {
      varCppType = nestedClassAliases.get(baseCppType)! + (isPtr ? "*" : "");
    }
    if (actualInitializer && ts.isArrayLiteralExpression(actualInitializer)) {
      const hasObjectElements = actualInitializer.elements.some(
        (e): e is ts.Expression => !ts.isSpreadElement(e) && ts.isObjectLiteralExpression(e)
      );
      if (hasObjectElements) {
        const structType = `_${declaration.name.text}_t`;
        varCppType = `std::vector<${structType}>`;
      }
    }
    loweredDeclaration.cppType = varCppType as CppType;
    localVariableTypes.set(declaration.name.text, varCppType as CppTypeHint);
    activeLocalTypes.set(declaration.name.text, varCppType as CppTypeHint);

    if (!functionNameForDiagnostics || functionNameForDiagnostics === "") {
      activeGlobalTypes.set(declaration.name.text, varCppType as CppTypeHint);
    }

    const cleanTypeForStringVar = declarationType.resolvedType.replace(/\bconst\b\s*/g, "").trim();
    if (cleanTypeForStringVar === "const char*" || cleanTypeForStringVar === "char*" || cleanTypeForStringVar === "__tc_str_ptr") {
      activeStringVars.add(declaration.name.text);
    }

    if (ts.isIdentifier(declaration.name) && actualInitializer) {
      const varName = declaration.name.text;

      if (mutableArrayVars.has(varName) && ts.isArrayLiteralExpression(actualInitializer)) {
        const elements = actualInitializer.elements;
        let elemType = "int";
        if (declarationType.resolvedType.startsWith("std::vector<")) {
          elemType = declarationType.resolvedType.slice("std::vector<".length, -1);
        } else if (declarationType.resolvedType === "auto" && elements.length > 0) {
          elemType = inferExprCppType(elements[0], functionReturnTypes, localVariableTypes, sourceText);
        }

        const capacity = elements.length + 2;
        lowered.push({
          kind: "var_decl",
          sourceSpan: loweredDeclaration.sourceSpan,
          leadingComments: loweredDeclaration.leadingComments,
          trailingComments: [],
          name: varName,
          storage: "let",
          cppType: `__tc_StaticArray<${elemType}, ${capacity}>` as any,
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
              initializer: { kind: "array", elementType: "auto", elements: zeroElements },
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
        if (srcSize !== undefined && arrowFn && (ts.isArrowFunction(arrowFn) || ts.isFunctionExpression(arrowFn))) {
          const param = arrowFn.parameters[0];
          const paramName = param && ts.isIdentifier(param.name) ? param.name.text : "__x";
          const bodyExpr = ts.isBlock(arrowFn.body) ? undefined : arrowFn.body;
          if (bodyExpr) {
            const span = loweredDeclaration.sourceSpan;
            const lenVar = `${varName}__len`;
            const zeroElements: ExpressionIR[] = [];
            for (let zi = 0; zi < srcSize; zi++) zeroElements.push({ kind: "number", value: 0 });
            lowered.push({
              kind: "var_decl", sourceSpan: span,
              leadingComments: loweredDeclaration.leadingComments, trailingComments: [],
              name: varName, storage: "let", cppType: "auto",
              initializer: { kind: "array", elementType: "auto", elements: zeroElements },
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
        const vecMatch = varCppType.startsWith("std::vector<");
        const inferredVecMatch = declarationType.inferredType.startsWith("std::vector<");
        if (!vecMatch && inferredVecMatch) {
          activeArrayLiteralVars.add(varName);
          loweredDeclaration.cppType = "auto" as any;
          localVariableTypes.set(varName, declarationType.inferredType);
          activeLocalTypes.set(varName, declarationType.inferredType);
        } else if (!vecMatch) {
          activeArrayLiteralVars.add(varName);
          activeCArrayVars.add(varName);
          loweredDeclaration.cppType = "auto" as any;
          localVariableTypes.set(varName, "auto");
          activeLocalTypes.set(varName, "auto");
        }
      }
    }

    const ownershipKind = extractOwnershipKindFromTypeNode(declaration.type, typeAliases);
    if (ownershipKind) {
      (loweredDeclaration as any).ownershipKind = ownershipKind;
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
