import ts from "typescript";
import { Diagnostic, SourceSpan } from "../types";
import { ClassIR, ClassFieldIR, ClassMethodIR, ClassGetterIR, ClassSetterIR, CppType, ExpressionIR, ParameterIR, StatementIR } from "./model";
import { extractNodeComments, makeDiagnostic, makeSourceSpan } from "./ast-node-utils";
import { isCompileTimeOnlyCallName, isCompileTimeOnlyClassName } from "./compile-time-only";
import { CppTypeHint, inferExprCppType, resolveDeclarationType, typeNodeToCppType, extractOwnershipKindFromTypeNode, resolveAliasedTypeNode } from "./type-resolution";
import { inferKindByName } from "./typehal-symbols";
import { escapeCppKeyword } from "../utils/strings";
import { PointerTracker, TYPED_ARRAY_ELEMENT_MAP, registerFieldMap, hoistedNestedFunctions, hoistedNestedClasses, hoistedNestedEnums, hoistedNestedInterfaces, hoistedNestedTypeAliases, nestedFunctionAliases, nestedClassAliases, activePinAliases, activeBusAliases, activeCArrayVars, activeArrayLiteralVars, activeStringVars, mutableArrayVars, arrayLiteralSizes, filteredArrayLengthVars, activeLocalTypes, resetFunctionScopeState, topLevelClassNames, topLevelClasses } from "./build-ir-state";
import { calleeToText, renderExprAsText } from "./render-expr";
import { expressionToIR } from "./expression-to-ir";
import { enumDeclarationToIR, interfaceDeclarationToIR, typeAliasDeclarationToIR } from "./declaration-builders";
import { extractRootAndChain } from "./ast-patterns";

function callToStatement(
  statementNode: ts.ExpressionStatement,
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  pointerVars: PointerTracker = new Map(),
): StatementIR {
  const comments = extractNodeComments(statementNode, sourceText);
  
  // ---- Typehal call detection at statement level -------------------------
  // Handle D13.asOutput(), D9.pwm(), D2.pullup(), etc.
  // These need to be detected as typehal-call IR nodes for proper transpilation.
  if (ts.isPropertyAccessExpression(call.expression)) {
    const chainInfo = extractRootAndChain(call.expression);
    if (chainInfo) {
      const kind = inferKindByName(chainInfo.root);
      if (kind !== 'unknown') {
        // Build the full method path (e.g., "config.output" from D13.config.output)
        const fullMethod = chainInfo.chain.join('.');
        return {
          kind: "typehal-call",
          sourceSpan: makeSourceSpan(call, fileName, sourceText),
          receiver: chainInfo.root,
          receiverKind: kind,
          method: fullMethod,
          args: call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
        };
      }
      // Pin alias resolution at statement level: led.toggle() â†’ LED.toggle()
      // Unknown symbols may still represent a pin-like object that is passed in
      // as a function parameter. Recognize pin configuration and interrupt API
      // methods for these values even when the receiver identifier cannot be
      // resolved statically.
      const safePinMethods = new Set([
        'asInput', 'asInputPullUp', 'asOutput',
        'pullup', 'pulldown', 'float',
        'onFalling', 'onRising', 'onChange', 'onLow', 'onHigh',
        'offFalling', 'offRising', 'offChange', 'offAll',
      ]);
      const fullMethod = chainInfo.chain.join('.');
      if (safePinMethods.has(fullMethod)) {
        return {
          kind: "typehal-call",
          sourceSpan: makeSourceSpan(call, fileName, sourceText),
          receiver: chainInfo.root,
          receiverKind: 'digital',
          method: fullMethod,
          args: call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
        };
      }

      const aliasTarget = activePinAliases.get(chainInfo.root);
      if (aliasTarget) {
        const aliasKind = inferKindByName(aliasTarget);
        if (aliasKind !== 'unknown') {
          const fullMethod = chainInfo.chain.join('.');
          return {
            kind: "typehal-call",
            sourceSpan: makeSourceSpan(call, fileName, sourceText),
            receiver: aliasTarget,
            receiverKind: aliasKind,
            method: fullMethod,
            args: call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
          };
        }
      }
      // Bus alias resolution at statement level: i2c.device() â†’ I2C0.device()
      const busAlias = activeBusAliases.get(chainInfo.root);
      if (busAlias) {
        const fullMethod = chainInfo.chain.join('.');
        return {
          kind: "typehal-call",
          sourceSpan: makeSourceSpan(call, fileName, sourceText),
          receiver: busAlias.receiver,
          receiverKind: busAlias.kind,
          method: fullMethod,
          args: call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
        };
      }
    }

    // â”€â”€ Device accessor pattern detection at statement level â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Handle: I2C0.device(0x76).writeByte(0xFA, 0x55)
    //   or:   i2c.device(0x76).writeByte(0xFA, 0x55)  (bus alias)
    // This MUST be outside the chainInfo block because extractRootAndChain
    // cannot traverse through intermediate CallExpression nodes.
    if (ts.isCallExpression(call.expression.expression) &&
        ts.isPropertyAccessExpression(call.expression.expression.expression)) {
      const innerCall = call.expression.expression;
      const innerProp = call.expression.expression.expression;
      const outerMethod = call.expression.name.text;

      if (innerProp.name.text === 'device' && ts.isIdentifier(innerProp.expression)) {
        const rootName = innerProp.expression.text;
        const kind = inferKindByName(rootName);
        if (kind !== 'unknown') {
          return {
            kind: "typehal-call",
            sourceSpan: makeSourceSpan(call, fileName, sourceText),
            receiver: rootName,
            receiverKind: kind,
            method: `device.${outerMethod}`,
            args: [
              ...innerCall.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
              ...call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
            ],
          };
        }
        // Bus alias resolution for device accessor
        const busAlias = activeBusAliases.get(rootName);
        if (busAlias) {
          return {
            kind: "typehal-call",
            sourceSpan: makeSourceSpan(call, fileName, sourceText),
            receiver: busAlias.receiver,
            receiverKind: busAlias.kind,
            method: `device.${outerMethod}`,
            args: [
              ...innerCall.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
              ...call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
            ],
          };
        }
        // Pin alias resolution for device accessor
        const pinAlias = activePinAliases.get(rootName);
        if (pinAlias) {
          const aliasKind = inferKindByName(pinAlias);
          if (aliasKind !== 'unknown') {
            return {
              kind: "typehal-call",
              sourceSpan: makeSourceSpan(call, fileName, sourceText),
              receiver: pinAlias,
              receiverKind: aliasKind,
              method: `device.${outerMethod}`,
              args: [
                ...innerCall.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
                ...call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
              ],
            };
          }
        }
      }
    }
  }
  
  // ---- Fluent peripheral config chain detection at statement level -------
  // Handle UART0.config.baudRate(115200).begin() -> Serial.begin(115200)
  // Handle I2C0.config.speed(400000).begin() -> Wire.begin() + Wire.setClock()
  // Handle SPI0.config.frequency(1000000).begin() -> SPI.begin()
  if (ts.isPropertyAccessExpression(call.expression) && 
      call.expression.name.text === "begin" &&
      ts.isCallExpression(call.expression.expression)) {
    
    const innerCall = call.expression.expression;
    const innerCallee = innerCall.expression;
    
    // Check for peripheral.config.method(value).begin() pattern
    if (ts.isPropertyAccessExpression(innerCallee)) {
      const configMethodName = innerCallee.name.text;  // baudRate, speed, frequency
      
      if (ts.isPropertyAccessExpression(innerCallee.expression) &&
          innerCallee.expression.name.text === "config") {
        
        const peripheralExpr = innerCallee.expression.expression;
        if (ts.isIdentifier(peripheralExpr)) {
          const peripheralName = peripheralExpr.text;
          const kind = inferKindByName(peripheralName);
          
          if (kind === 'serial' || kind === 'i2c' || kind === 'spi') {
            const configValue = innerCall.arguments.length > 0 
              ? expressionToIR(innerCall.arguments[0], sourceText, diagnostics, pointerVars)
              : undefined;
            
            return {
              kind: "typehal-call",
              sourceSpan: makeSourceSpan(call, fileName, sourceText),
              receiver: peripheralName,
              receiverKind: kind,
              method: "configBegin",
              args: configValue ? [configValue] : [],
              configMethod: configMethodName,
            } as any;
          }
        }
      }
    }
  }
  
  // ---- Debounce chain detection at statement level -----------------------
  // Handle D2.onFalling(() => {...}).debounce(50) pattern
  if (ts.isPropertyAccessExpression(call.expression) && 
      call.expression.name.text === "debounce" &&
      call.arguments.length === 1 &&
      ts.isCallExpression(call.expression.expression)) {
    
    const innerCall = call.expression.expression;
    const debounceArg = call.arguments[0];
    let debounceMs: number | undefined;
    
    if (ts.isNumericLiteral(debounceArg)) {
      debounceMs = Number(debounceArg.text);
    }
    
    // Process the inner call recursively
    const innerStmt = callToStatement(statementNode, innerCall, fileName, sourceText, diagnostics, pointerVars);
    
    // If the inner statement is a call with a callback argument, attach debounce
    if (innerStmt.kind === "call") {
      for (const arg of innerStmt.args) {
        if (arg.kind === "callback" && debounceMs !== undefined) {
          arg.debounceMs = debounceMs;
        }
      }
    }
    
    return innerStmt;
  }

  // ── Array method translation: push → push_back, pop → pop_back ──────────
  if (ts.isPropertyAccessExpression(call.expression)) {
    const methodName = call.expression.name.text;
    const objExpr = call.expression.expression;
    if (ts.isIdentifier(objExpr) && mutableArrayVars.has(objExpr.text)) {
      if (methodName === "push") {
        return {
          kind: "call",
          sourceSpan: makeSourceSpan(call, fileName, sourceText),
          leadingComments: comments.leadingComments,
          trailingComments: comments.trailingComments,
          callee: `${objExpr.text}.push_back`,
          args: call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
        };
      }
      if (methodName === "pop") {
        return {
          kind: "call",
          sourceSpan: makeSourceSpan(call, fileName, sourceText),
          leadingComments: comments.leadingComments,
          trailingComments: comments.trailingComments,
          callee: `${objExpr.text}.pop_back`,
          args: [],
        };
      }
    }
  }

  // Format callee, using -> for pointer variables
  let calleeText: string;
  if (ts.isPropertyAccessExpression(call.expression)) {
    const objExpr = call.expression.expression;
    const methodName = escapeCppKeyword(call.expression.name.text);
    if (ts.isIdentifier(objExpr) && pointerVars.has(objExpr.text)) {
      calleeText = `${objExpr.text}->${methodName}`;
    } else if (ts.isCallExpression(objExpr) && ts.isPropertyAccessExpression(objExpr.expression)) {
      // Chained method call: obj.method1().method2()
      const innerReceiver = objExpr.expression.expression;
      const innerMethodName = objExpr.expression.name.text;
      const innerCallText = renderExprAsText(expressionToIR(objExpr, sourceText, diagnostics, pointerVars));
      let accessor = ".";
      if (ts.isIdentifier(innerReceiver) && pointerVars.has(innerReceiver.text)) {
        let className = pointerVars.get(innerReceiver.text);
        if (className) className = nestedClassAliases.get(className) ?? className;
        const cls = className ? hoistedNestedClasses.find(c => c.name === className) : undefined;
        const method = cls?.methods.find(m => m.name === innerMethodName);
        if (method && (method.returnType as string).endsWith("*")) {
          accessor = "->";
        }
      } else if (ts.isIdentifier(innerReceiver) && topLevelClassNames.has(innerReceiver.text)) {
        // Static method call on a top-level or cross-module class returning an instance
        const cls = topLevelClasses.get(innerReceiver.text);
        if (!cls) {
          // Cross-module class: factory methods typically return class instances (pointers)
          accessor = "->";
        } else {
          const chainMethod = cls.methods.find(m => m.name === innerMethodName);
          if (chainMethod && ((chainMethod.returnType as string).endsWith("*") || (chainMethod.returnType as string) === innerReceiver.text)) {
            accessor = "->";
          }
        }
      }
      calleeText = `${innerCallText}${accessor}${methodName}`;
    } else {
      calleeText = calleeToText(call.expression);
    }
  } else {
    calleeText = calleeToText(call.expression);
  }
  
  return {
    kind: "call",
    sourceSpan: makeSourceSpan(call, fileName, sourceText),
    leadingComments: comments.leadingComments,
    trailingComments: comments.trailingComments,
    callee: calleeText,
    args: call.arguments.map((arg) => expressionToIR(arg, sourceText, diagnostics, pointerVars)),
  };
}

function assignmentOperatorToString(kind: ts.SyntaxKind): Extract<StatementIR, { kind: "assign" }>['operator'] | undefined {
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

function updateLocalTypeFromAssignment(
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

function extractForInKeys(expr: ts.Expression): string[] | undefined {
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

function forInitializerToIR(
  declarationList: ts.VariableDeclarationList,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
): StatementIR | undefined {
  const storage: "var" | "let" | "const" =
    declarationList.flags & ts.NodeFlags.Const
      ? "const"
      : declarationList.flags & ts.NodeFlags.Let
        ? "let"
        : "var";

  const declaration = declarationList.declarations[0];
  if (!declaration || !ts.isIdentifier(declaration.name)) {
    return undefined;
  }

  const declarationType = resolveDeclarationType(
    declaration.type,
    declaration.initializer,
    functionReturnTypes,
    localVariableTypes,
  );

  localVariableTypes.set(declaration.name.text, declarationType.resolvedType);

  // Resolve type through nested class aliases for hoisted class names.
  let resolvedType: string = declarationType.resolvedType === "void" ? "auto" : declarationType.resolvedType;
  const isPointer = resolvedType.endsWith("*");
  const baseType = isPointer ? resolvedType.slice(0, -1) : resolvedType;
  if (nestedClassAliases.has(baseType)) {
    resolvedType = nestedClassAliases.get(baseType)! + (isPointer ? "*" : "");
  }

  return {
    kind: "var_decl",
    sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
    name: declaration.name.text,
    storage,
    cppType: resolvedType as CppType,
    initializer: declaration.initializer
      ? expressionToIR(declaration.initializer, sourceText, diagnostics)
      : undefined,
  };
}

function incrementorToIR(
  expr: ts.Expression,
  sourceText: string,
  diagnostics: Diagnostic[],
  localVariableTypes: Map<string, CppTypeHint>,
): StatementIR | undefined {
  if (ts.isPostfixUnaryExpression(expr) && ts.isIdentifier(expr.operand)) {
    if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
      return {
        kind: "update",
        sourceSpan: makeSourceSpan(expr, "", sourceText),
        target: expr.operand.text,
        operator: expr.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--",
        prefix: false,
      };
    }
  }

  if (ts.isPrefixUnaryExpression(expr) && ts.isIdentifier(expr.operand)) {
    if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
      return {
        kind: "update",
        sourceSpan: makeSourceSpan(expr, "", sourceText),
        target: expr.operand.text,
        operator: expr.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--",
        prefix: true,
      };
    }
  }

  if (ts.isBinaryExpression(expr) && ts.isIdentifier(expr.left)) {
    const operator = assignmentOperatorToString(expr.operatorToken.kind);
    if (operator) {
      const valueType = inferExprCppType(expr.right, new Map(), localVariableTypes, sourceText);
      updateLocalTypeFromAssignment(expr.left.text, operator, valueType, localVariableTypes);
      return {
        kind: "assign",
        sourceSpan: makeSourceSpan(expr, "", sourceText),
        target: expr.left.text,
        operator,
        value: expressionToIR(expr.right, sourceText, diagnostics),
      };
    }
  }

  return undefined;
}

export function expressionStatementToIR(
  statement: ts.ExpressionStatement,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  pointerVars: PointerTracker = new Map(),
): StatementIR | undefined {
  const expr = statement.expression;

  if (ts.isCallExpression(expr)) {
    return callToStatement(statement, expr, fileName, sourceText, diagnostics, pointerVars);
  }

  if (ts.isAwaitExpression(expr) && ts.isCallExpression(expr.expression)) {
    const callStmt = callToStatement(statement, expr.expression, fileName, sourceText, diagnostics, pointerVars);
    if (callStmt && callStmt.kind === "call") {
      return { ...callStmt, isAwaited: true };
    }
    return callStmt;
  }

  // â”€â”€ Register bit-field write â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Handle: RegName.fieldName = value
  // Emits:  *RegName = (*RegName & ~mask) | ((value & fieldMask) << lo)
  if (ts.isBinaryExpression(expr) && ts.isPropertyAccessExpression(expr.left) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const objExpr = expr.left.expression;
    const fieldName = expr.left.name.text;
    if (ts.isIdentifier(objExpr)) {
      const regName = objExpr.text;
      const fieldMap = registerFieldMap.get(regName);
      if (fieldMap) {
        const field = fieldMap.get(fieldName);
        if (field) {
          const fieldMask = ((1 << field.width) - 1) >>> 0;
          const fieldMaskUL = fieldMask + 'UL';
          const shiftMask = (fieldMask << field.lo) >>> 0;
          const shiftMaskUL = shiftMask + 'UL';
          const valueIR = expressionToIR(expr.right, sourceText, diagnostics);
          const valueText = renderExprAsText(valueIR);
          const comments = extractNodeComments(statement, sourceText);
          // Generate: *REG = (*REG & ~clearMask) | ((value & fieldMask) << lo)
          const cppExpr = `*${regName} = (*${regName} & ~${shiftMaskUL}) | ((${valueText} & ${fieldMaskUL}) << ${field.lo})`;
          return {
            kind: "assign",
            sourceSpan: makeSourceSpan(statement, fileName, sourceText),
            leadingComments: comments.leadingComments,
            trailingComments: comments.trailingComments,
            target: `*${regName}`,
            operator: "=",
            value: { kind: "raw", value: `(*${regName} & ~${shiftMaskUL}) | ((${valueText} & ${fieldMaskUL}) << ${field.lo})` },
          };
        }
      }
    }
    // Fall through to normal handling if not a register field
  }

  // Handle this.field = value, obj.field = value, and compound assignments (+=, -=, etc.)
  if (ts.isBinaryExpression(expr) && ts.isPropertyAccessExpression(expr.left)) {
    const operator = assignmentOperatorToString(expr.operatorToken.kind);
    if (operator) {
      const targetIR = expressionToIR(expr.left, sourceText, diagnostics, pointerVars);
      const targetText = renderExprAsText(targetIR);

      // Propagate pin aliases through assignments to `this` fields.
      // Example: this.pin = input; where `input` is an alias for D2.
      if (expr.left.expression.kind === ts.SyntaxKind.ThisKeyword && ts.isIdentifier(expr.right)) {
        const fieldName = expr.left.name.text;
        if (fieldName === 'pin' || fieldName.toLowerCase().endsWith('pin')) {
          activePinAliases.set(targetText, expr.right.text);
        }
      }

      const comments = extractNodeComments(statement, sourceText);
      return {
        kind: "assign",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: targetText,
        operator,
        value: expressionToIR(expr.right, sourceText, diagnostics),
      };
    }
  }

  // Handle arr[index] = value and compound assignments (arr[i] += 5, etc.)
  if (ts.isBinaryExpression(expr) && ts.isElementAccessExpression(expr.left)) {
    const operator = assignmentOperatorToString(expr.operatorToken.kind);
    if (operator) {
      const targetIR = expressionToIR(expr.left, sourceText, diagnostics, pointerVars);
      const targetText = renderExprAsText(targetIR);
      const comments = extractNodeComments(statement, sourceText);
      return {
        kind: "assign",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: targetText,
        operator,
        value: expressionToIR(expr.right, sourceText, diagnostics),
      };
    }
  }

  if (ts.isBinaryExpression(expr) && ts.isIdentifier(expr.left)) {
    // Handle ||= operator: x ||= val → x = (x == TYPEHAL_UNDEFINED) ? val : x;
    if (expr.operatorToken.kind === ts.SyntaxKind.BarBarEqualsToken) {
      const comments = extractNodeComments(statement, sourceText);
      const varName = expr.left.text;
      const valIR = expressionToIR(expr.right, sourceText, diagnostics);
      return {
        kind: "assign",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: varName,
        operator: "=",
        value: {
          kind: "ternary",
          condition: {
            kind: "binary",
            operator: "==",
            left: { kind: "identifier", value: varName },
            right: { kind: "identifier", value: "TYPEHAL_UNDEFINED" },
          },
          whenTrue: valIR,
          whenFalse: { kind: "identifier", value: varName },
        },
      };
    }
    // Handle &&= operator: x &&= val → if (x) x = val;
    if (expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken) {
      const comments = extractNodeComments(statement, sourceText);
      return {
        kind: "if",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        condition: { kind: "identifier", value: expr.left.text },
        thenBranch: [{
          kind: "assign",
          sourceSpan: makeSourceSpan(statement, fileName, sourceText),
          target: expr.left.text,
          operator: "=",
          value: expressionToIR(expr.right, sourceText, diagnostics),
        }],
      };
    }
    const operator = assignmentOperatorToString(expr.operatorToken.kind);
    if (!operator) {
      return undefined;
    }

    const valueType = inferExprCppType(expr.right, functionReturnTypes, localVariableTypes, sourceText);
    updateLocalTypeFromAssignment(expr.left.text, operator, valueType, localVariableTypes);
    const comments = extractNodeComments(statement, sourceText);

    return {
      kind: "assign",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      target: expr.left.text,
      operator,
      value: expressionToIR(expr.right, sourceText, diagnostics),
    };
  }

  if (ts.isPrefixUnaryExpression(expr) && ts.isIdentifier(expr.operand)) {
    if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
      const comments = extractNodeComments(statement, sourceText);
      return {
        kind: "update",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: expr.operand.text,
        operator: expr.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--",
        prefix: true,
      };
    }
  }

  if (ts.isPostfixUnaryExpression(expr) && ts.isIdentifier(expr.operand)) {
    if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
      const comments = extractNodeComments(statement, sourceText);
      return {
        kind: "update",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: expr.operand.text,
        operator: expr.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--",
        prefix: false,
      };
    }
  }

  return undefined;
}

export function lowerStatement(
  statement: ts.Statement,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  functionNameForDiagnostics: string,
  typeAliases?: Map<string, ts.TypeNode>,
  pointerVars: PointerTracker = new Map(),
): StatementIR[] | undefined {
  if (ts.isExpressionStatement(statement)) {
    // Handle arr.forEach(arrowFn) as a standalone statement → inline loop
    if (ts.isCallExpression(statement.expression) &&
        ts.isPropertyAccessExpression(statement.expression.expression) &&
        statement.expression.expression.name.text === "forEach" &&
        ts.isIdentifier(statement.expression.expression.expression)) {
      const srcName = statement.expression.expression.expression.text;
      const srcSize = arrayLiteralSizes.get(srcName);
      const arrowFn = statement.expression.arguments[0];
      if (srcSize !== undefined && arrowFn && (ts.isArrowFunction(arrowFn) || ts.isFunctionExpression(arrowFn))) {
        const param = arrowFn.parameters[0];
        const paramName = param && ts.isIdentifier(param.name) ? param.name.text : "__x";
        const span = makeSourceSpan(statement, fileName, sourceText);
        const comments = extractNodeComments(statement, sourceText);
        if (!ts.isBlock(arrowFn.body)) {
          // Expression body
          const bodyIR = expressionToIR(arrowFn.body, sourceText, diagnostics);
          return [{
            kind: "for",
            sourceSpan: span,
            leadingComments: comments.leadingComments,
            trailingComments: comments.trailingComments,
            initializer: { kind: "var_decl", sourceSpan: span, name: "__tc_i", storage: "let", cppType: "int", initializer: { kind: "number", value: 0 } },
            condition: { kind: "binary", left: { kind: "identifier", value: "__tc_i" }, operator: "<", right: { kind: "number", value: srcSize } },
            increment: { kind: "update", sourceSpan: span, target: "__tc_i", operator: "++", prefix: false },
            body: [
              { kind: "var_decl", sourceSpan: span, name: paramName, storage: "const", cppType: "auto",
                initializer: { kind: "raw", value: `${srcName}[__tc_i]` } },
              { kind: "var_decl", sourceSpan: span, name: "__tc_result", storage: "let", cppType: "auto", initializer: bodyIR },
            ],
          }];
        } else {
          // Block body — lower statements and prepend param decl
          const blockStatements = lowerStatementList(
            arrowFn.body.statements, fileName, sourceText, diagnostics,
            functionReturnTypes, localVariableTypes, functionNameForDiagnostics, typeAliases,
          );
          return [{
            kind: "for",
            sourceSpan: span,
            leadingComments: comments.leadingComments,
            trailingComments: comments.trailingComments,
            initializer: { kind: "var_decl", sourceSpan: span, name: "__tc_i", storage: "let", cppType: "int", initializer: { kind: "number", value: 0 } },
            condition: { kind: "binary", left: { kind: "identifier", value: "__tc_i" }, operator: "<", right: { kind: "number", value: srcSize } },
            increment: { kind: "update", sourceSpan: span, target: "__tc_i", operator: "++", prefix: false },
            body: [
              { kind: "var_decl", sourceSpan: span, name: paramName, storage: "const", cppType: "auto",
                initializer: { kind: "raw", value: `${srcName}[__tc_i]` } },
              ...blockStatements,
            ],
          }];
        }
      }
    }

    // Check for compile-time-only calls first (e.g., registerPlatformStrategy())
    // These are registration calls that don't need C++ emission
    if (ts.isCallExpression(statement.expression)) {
      const call = statement.expression;
      if (ts.isIdentifier(call.expression)) {
        const calleeName = call.expression.text;
        if (isCompileTimeOnlyCallName(calleeName)) {
          return []; // Skip silently - no C++ emission needed
        }
      }
      // Also check for method calls like "something.register()" that are compile-time only
      if (ts.isPropertyAccessExpression(call.expression)) {
        const method = call.expression.name.text;
        if (isCompileTimeOnlyCallName(method)) {
          return [];
        }
      }
    }
    
    // Check for new expressions that are compile-time only (e.g., new NativeStrategy())
    if (ts.isNewExpression(statement.expression)) {
      // New expressions at top level in board packages are typically compile-time only
      // Check if it's a known strategy type
      if (ts.isIdentifier(statement.expression.expression)) {
        const className = statement.expression.expression.text;
        if (isCompileTimeOnlyClassName(className)) {
          return []; // Skip silently
        }
      }
    }

    const loweredExpression = expressionStatementToIR(
      statement,
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      pointerVars,
    );
    return loweredExpression ? [loweredExpression] : undefined;
  }

  if (ts.isVariableStatement(statement)) {
    return variableStatementToIR(
      statement,
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      typeAliases,
      pointerVars,
    );
  }

  if (ts.isReturnStatement(statement) && !statement.expression) {
    const comments = extractNodeComments(statement, sourceText);
    return [{
      kind: "return",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
    }];
  }

  if (ts.isReturnStatement(statement) && statement.expression) {
    const comments = extractNodeComments(statement, sourceText);
    return [{
      kind: "return",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      value: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
    }];
  }

  if (ts.isWhileStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const bodyStatements = lowerStatementList(
      ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
    );

    return [{
      kind: "while",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      condition: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
      body: bodyStatements,
    }];
  }

  if (ts.isIfStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const thenStatements = lowerStatementList(
      ts.isBlock(statement.thenStatement) ? statement.thenStatement.statements : [statement.thenStatement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
    );

    let elseBranch: StatementIR[] | undefined;
    if (statement.elseStatement) {
      elseBranch = lowerStatementList(
        ts.isBlock(statement.elseStatement) ? statement.elseStatement.statements : [statement.elseStatement],
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        localVariableTypes,
        functionNameForDiagnostics,
      );
    }

    return [{
      kind: "if",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      condition: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
      thenBranch: thenStatements,
      elseBranch,
    }];
  }

  if (ts.isForStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);

    let initializer: StatementIR | undefined;
    if (statement.initializer) {
      if (ts.isVariableDeclarationList(statement.initializer)) {
        initializer = forInitializerToIR(
          statement.initializer,
          fileName,
          sourceText,
          diagnostics,
          functionReturnTypes,
          localVariableTypes,
        );
      } else if (ts.isExpressionStatement(statement.initializer)) {
        const loweredExpr = expressionStatementToIR(
          statement.initializer,
          fileName,
          sourceText,
          diagnostics,
          functionReturnTypes,
          localVariableTypes,
          pointerVars,
        );
        initializer = loweredExpr;
      }
    }

    const condition = statement.condition
      ? expressionToIR(statement.condition, sourceText, diagnostics, pointerVars)
      : undefined;

    let increment: StatementIR | undefined;
    if (statement.incrementor) {
      increment = incrementorToIR(statement.incrementor, sourceText, diagnostics, localVariableTypes);
    }

    const bodyStatements = lowerStatementList(
      ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
    );

    return [{
      kind: "for",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      initializer,
      condition,
      increment,
      body: bodyStatements,
    }];
  }

  if (ts.isForOfStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);

    let variable: StatementIR | undefined;
    if (ts.isVariableDeclarationList(statement.initializer)) {
      variable = forInitializerToIR(
        statement.initializer,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        localVariableTypes,
      );
    }

    const bodyStatements = lowerStatementList(
      ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
    );

    return [{
      kind: "for_of",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      variable: variable!,
      iterable: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
      body: bodyStatements,
    }];
  }

  // Handle for...in loops (iterates over object keys)
  if (ts.isForInStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);

    let variable: StatementIR | undefined;
    if (ts.isVariableDeclarationList(statement.initializer)) {
      variable = forInitializerToIR(
        statement.initializer,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        localVariableTypes,
      );
    }

    const bodyStatements = lowerStatementList(
      ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
    );

    const keys = extractForInKeys(statement.expression);

    return [{
      kind: "for_in",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      variable: variable!,
      object: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
      keys,
      body: bodyStatements,
    }];
  }

  if (ts.isBreakStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    return [{
      kind: "break",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
    }];
  }

  if (ts.isContinueStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    return [{
      kind: "continue",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
    }];
  }

  // Handle do...while loops
  if (ts.isDoStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const bodyStatements = lowerStatementList(
      ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
    );

    return [{
      kind: "do_while",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      condition: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
      body: bodyStatements,
    }];
  }

  // Handle switch statements
  if (ts.isSwitchStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const cases: Array<{ kind: "case"; sourceSpan: SourceSpan; leadingComments?: string[]; trailingComments?: string[]; value?: ExpressionIR; body: StatementIR[] }> = [];

    for (const clause of statement.caseBlock.clauses) {
      const caseComments = extractNodeComments(clause, sourceText);
      
      if (ts.isDefaultClause(clause)) {
        cases.push({
          kind: "case",
          sourceSpan: makeSourceSpan(clause, fileName, sourceText),
          leadingComments: caseComments.leadingComments,
          trailingComments: caseComments.trailingComments,
          value: undefined,  // default case has no value
          body: lowerStatementList(
            clause.statements,
            fileName,
            sourceText,
            diagnostics,
            functionReturnTypes,
            localVariableTypes,
            functionNameForDiagnostics,
          ),
        });
      } else if (ts.isCaseClause(clause)) {
        cases.push({
          kind: "case",
          sourceSpan: makeSourceSpan(clause, fileName, sourceText),
          leadingComments: caseComments.leadingComments,
          trailingComments: caseComments.trailingComments,
          value: expressionToIR(clause.expression, sourceText, diagnostics, pointerVars),
          body: lowerStatementList(
            clause.statements,
            fileName,
            sourceText,
            diagnostics,
            functionReturnTypes,
            localVariableTypes,
            functionNameForDiagnostics,
          ),
        });
      }
    }

    return [{
      kind: "switch",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      expression: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
      cases,
    }];
  }

  // Handle try/catch/finally statements
  if (ts.isTryStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const tryBlock = lowerStatementList(
      statement.tryBlock.statements,
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
    );

    let catchParam: string | undefined;
    let catchBlock: StatementIR[] | undefined;
    
    if (statement.catchClause) {
      if (statement.catchClause.variableDeclaration && ts.isIdentifier(statement.catchClause.variableDeclaration.name)) {
        catchParam = statement.catchClause.variableDeclaration.name.text;
      }
      catchBlock = lowerStatementList(
        statement.catchClause.block.statements,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        localVariableTypes,
        functionNameForDiagnostics,
      );
    }

    // Handle finally block
    let finallyBlock: StatementIR[] | undefined;
    if (statement.finallyBlock) {
      finallyBlock = lowerStatementList(
        statement.finallyBlock.statements,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        localVariableTypes,
        functionNameForDiagnostics,
      );
    }

    return [{
      kind: "try",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      tryBlock,
      catchParam,
      catchBlock,
      finallyBlock,
    }];
  }

  // Handle throw statements
  if (ts.isThrowStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    return [{
      kind: "throw",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      value: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
    }];
  }

  // Handle empty statements (just semicolons) - skip them silently
  if (ts.isEmptyStatement(statement)) {
    return [];
  }

  // Handle side-effect call statements at top level (e.g., registerPlatformStrategy())
  // These are compile-time registration calls that don't need C++ emission
  if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
    const call = statement.expression;
    // Check for known compile-time-only function calls
    if (ts.isIdentifier(call.expression)) {
      const calleeName = call.expression.text;
      const compileTimeOnlyCalls = new Set([
        'registerPlatformStrategy',
        'registerPolyfill',
        'registerBoard',
        'defineBoardManifest',
      ]);
      if (compileTimeOnlyCalls.has(calleeName)) {
        return []; // Skip silently - no C++ emission needed
      }
    }
    // For other top-level calls, try to lower them normally
    const lowered = expressionStatementToIR(
      statement,
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      pointerVars,
    );
    if (lowered) {
      return [lowered];
    }
  }

  // Handle labeled statements (e.g., label: for (...))
  if (ts.isLabeledStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const label = statement.label.text;
    const bodyStatements = lowerStatementList(
      ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
      typeAliases,
    );
    
    return [{
      kind: "labeled",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      label,
      body: bodyStatements,
    }];
  }

  // Handle standalone block statements
  if (ts.isBlock(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const bodyStatements = lowerStatementList(
      statement.statements,
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
      typeAliases,
    );
    
    return [{
      kind: "block",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      body: bodyStatements,
    }];
  }

  // Local interface declarations are type-only; no runtime IR needed
  if (ts.isInterfaceDeclaration(statement)) {
    return [];
  }

  // Local type alias declarations are type-only; no runtime IR needed
  if (ts.isTypeAliasDeclaration(statement)) {
    return [];
  }

  diagnostics.push(
    makeDiagnostic(
      sourceText,
      statement.pos,
      `Unsupported statement in function '${functionNameForDiagnostics}'.`,
      "warning",
      "TS2CPP_UNSUPPORTED_STMT",
    ),
  );
  return undefined;
}

/**
 * Hoist a nested function declaration to file scope.
 * Creates a mangled name (parent__inner) and registers it in the alias map
 * so that call sites within the parent function get rewritten.
 */
function hoistNestedFunction(
  statement: ts.FunctionDeclaration,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  parentFunctionName: string,
  typeAliases?: Map<string, ts.TypeNode>,
): void {
  const originalName = statement.name!.text;
  const safeParentName = parentFunctionName.replace(/\./g, "_");
  const mangledName = `${safeParentName}__${originalName}`;

  // Resolve return type from annotation, or default to auto
  const returnType = statement.type
    ? typeNodeToCppType(statement.type, typeAliases)
    : "auto";

  // Detect if the return type is a readonly mapped type (e.g. ReadonlyGuarded<T>)
  // so the emitter can add `const` to the C++ return type.
  const isReadonlyReturnType = statement.type
    ? isReadonlyMappedType(statement.type, typeAliases)
    : false;

  // Register the nested function's return type so that inferExprCppType
  // can resolve call expressions to this function later in the same scope.
  // For template functions, callers should use auto (concrete type depends
  // on template argument deduction which only the C++ compiler can do).
  const hasTypeParams = !!(statement.typeParameters && statement.typeParameters.length > 0);
  functionReturnTypes.set(originalName, (hasTypeParams ? "auto" : returnType) as CppTypeHint);
  functionReturnTypes.set(mangledName, returnType as CppTypeHint);

  const localVariableTypes = new Map<string, CppTypeHint>();
  const parameters: ParameterIR[] = [];

  for (const parameter of statement.parameters) {
    if (ts.isIdentifier(parameter.name)) {
      const parameterType = typeNodeToCppType(parameter.type, typeAliases);
      localVariableTypes.set(parameter.name.text, parameterType);
      const paramOwnershipKind = extractOwnershipKindFromTypeNode(parameter.type, typeAliases);
      parameters.push({
        name: parameter.name.text,
        cppType: (parameterType === "void" ? "auto" : parameterType) as Exclude<CppTypeHint, "void">,
        defaultValue: parameter.initializer
          ? expressionToIR(parameter.initializer, sourceText, diagnostics)
          : undefined,
        isRest: false,
        ...(paramOwnershipKind ? { ownershipKind: paramOwnershipKind } : {}),
      });
    }
  }

  // Lower the body â€” recursive call to lowerStatementList handles deeper nesting
  const bodyStatements = lowerStatementList(
    statement.body?.statements ?? [],
    fileName,
    sourceText,
    diagnostics,
    functionReturnTypes,
    localVariableTypes,
    mangledName,
    typeAliases,
  );

  const typeParams = statement.typeParameters
    ? statement.typeParameters.map(tp => tp.name.text)
    : undefined;

  // Capture generic type constraints as C++ static_assert expressions
  const constraints = new Map<string, string>();
  if (statement.typeParameters) {
    for (const tp of statement.typeParameters) {
      if (tp.constraint) {
        const cppConstraint = typeConstraintToCppAssert(tp.name.text, tp.constraint);
        if (cppConstraint) {
          constraints.set(tp.name.text, cppConstraint);
        }
      }
    }
  }

  hoistedNestedFunctions.push({
    originalName: mangledName,
    isAsync: false,
    returnType: returnType as any,
    sourceSpan: makeSourceSpan(statement, fileName, sourceText),
    ...extractNodeComments(statement, sourceText),
    parameters,
    statements: bodyStatements,
    ...(typeParams && typeParams.length > 0 ? { typeParameters: typeParams } : {}),
    ...(constraints.size > 0 ? { typeParameterConstraints: constraints } : {}),
    ...(isReadonlyReturnType ? { isReadonlyReturnType: true } : {}),
  });
}

/** Convert a TS type constraint to a C++ static_assert expression. */
function typeConstraintToCppAssert(paramName: string, constraint: ts.TypeNode): string | undefined {
  // Handle union types: string | number → std::is_same_v<T, std::string> || std::is_arithmetic_v<T>
  if (ts.isUnionTypeNode(constraint)) {
    const parts = constraint.types
      .map(t => singleConstraintToCpp(paramName, t))
      .filter((s): s is string => !!s);
    return parts.length > 0 ? parts.join(" || ") : undefined;
  }
  return singleConstraintToCpp(paramName, constraint);
}

function singleConstraintToCpp(paramName: string, constraint: ts.TypeNode): string | undefined {
  if (constraint.kind === ts.SyntaxKind.StringKeyword) {
    return `std::is_same_v<${paramName}, std::string>`;
  }
  if (constraint.kind === ts.SyntaxKind.NumberKeyword) {
    return `std::is_arithmetic_v<${paramName}>`;
  }
  if (constraint.kind === ts.SyntaxKind.BooleanKeyword) {
    return `std::is_same_v<${paramName}, bool>`;
  }
  return undefined;
}

/** Check if a type node resolves through a mapped type with readonly modifier. */
function isReadonlyMappedType(node: ts.TypeNode, typeAliases?: Map<string, ts.TypeNode>): boolean {
  if (!typeAliases) return false;

  // Resolve through type aliases
  const resolvedNode = resolveAliasedTypeNode(node, typeAliases) ?? node;

  if (ts.isMappedTypeNode(resolvedNode)) {
    // Check if the mapped type has a readonly modifier
    const modifier = (resolvedNode as any).readonlyToken;
    if (modifier) return true;
    // Also check the modifier property (TS uses different representations)
    if ((resolvedNode as any).modifier) return true;
  }

  // If the original node is a type reference, resolve the alias and check
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const aliasNode = typeAliases.get(node.typeName.text);
    if (aliasNode && ts.isMappedTypeNode(aliasNode)) {
      const modifier = (aliasNode as any).readonlyToken;
      if (modifier) return true;
      if ((aliasNode as any).modifier) return true;
    }
  }

  return false;
}

function hoistNestedClass(
  node: ts.ClassDeclaration,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  functionNameForDiagnostics: string,
  typeAliases?: Map<string, ts.TypeNode>,
): void {
  if (!node.name) return;
  const originalClassName = node.name.text;
  const safeParentName = functionNameForDiagnostics.replace(/\./g, "_");
  const className = safeParentName ? `${safeParentName}__${originalClassName}` : originalClassName;

  const rawExtendsClass = node.heritageClauses
    ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
    ?.types[0]
    ?.expression
    ?.getText();

  // Resolve extends name through nested class aliases (abstract parent may also be hoisted).
  const extendsClass = rawExtendsClass
    ? (nestedClassAliases.get(rawExtendsClass) ?? rawExtendsClass)
    : undefined;

  const isAbstract = node.modifiers?.some(m => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;
  const classComments = extractNodeComments(node, sourceText);
  const fields: ClassFieldIR[] = [];
  const methods: ClassMethodIR[] = [];
  const getters: ClassGetterIR[] = [];
  const setters: ClassSetterIR[] = [];
  let ctor: { parameters: ParameterIR[]; statements: StatementIR[] } | undefined;

  for (const member of node.members) {
    if (ts.isConstructorDeclaration(member)) {
      const ctorParams: ParameterIR[] = [];
      const ctorLocalTypes = new Map<string, CppTypeHint>();
      for (const param of member.parameters) {
        if (ts.isIdentifier(param.name)) {
          const paramType = typeNodeToCppType(param.type, typeAliases);
          ctorLocalTypes.set(param.name.text, paramType);
          const paramOwnershipKind = extractOwnershipKindFromTypeNode(param.type, typeAliases);
          ctorParams.push({
            name: param.name.text,
            cppType: (paramType === "void" ? "auto" : paramType) as Exclude<CppTypeHint, "void">,
            defaultValue: param.initializer
              ? expressionToIR(param.initializer, sourceText, diagnostics)
              : undefined,
            isRest: false,
            ...(paramOwnershipKind ? { ownershipKind: paramOwnershipKind } : {}),
          });

          // TypeScript parameter property shorthand: constructor(public x: number)
          const hasVisibility = param.modifiers?.some(m =>
            m.kind === ts.SyntaxKind.PublicKeyword ||
            m.kind === ts.SyntaxKind.PrivateKeyword ||
            m.kind === ts.SyntaxKind.ProtectedKeyword
          );
          if (hasVisibility) {
            const visibility: "public" | "private" | "protected" = param.modifiers!.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)
              ? "private"
              : param.modifiers!.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)
                ? "protected"
                : "public";
            fields.push({
              name: param.name.text,
              cppType: (paramType === "void" ? "auto" : paramType) as CppType,
              visibility,
              initializer: param.initializer
                ? expressionToIR(param.initializer, sourceText, diagnostics)
                : undefined,
            });
          }
        }
      }
      const ctorBody = member.body
        ? lowerStatementList(
            member.body.statements, fileName, sourceText, diagnostics,
            functionReturnTypes, ctorLocalTypes, `${className}.constructor`, typeAliases,
          )
        : [];
      ctor = { parameters: ctorParams, statements: ctorBody };
      continue;
    }

    if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const visibility: "public" | "private" | "protected" = member.modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)
        ? "private"
        : member.modifiers?.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)
          ? "protected"
          : "public";
      const fieldType = typeNodeToCppType(member.type, typeAliases);
      fields.push({
        name: member.name.text,
        cppType: (fieldType === "void" ? "auto" : fieldType) as CppType,
        visibility,
        initializer: member.initializer
          ? expressionToIR(member.initializer, sourceText, diagnostics)
          : undefined,
      });
      continue;
    }

    if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const visibility: "public" | "private" | "protected" = member.modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)
        ? "private"
        : member.modifiers?.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)
          ? "protected"
          : "public";
      const isStatic = member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
      const isMethodAbstract = member.modifiers?.some(m => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;

      const methodParams: ParameterIR[] = [];
      const methodLocalTypes = new Map<string, CppTypeHint>();
      for (const param of member.parameters) {
        if (ts.isIdentifier(param.name)) {
          const paramType = typeNodeToCppType(param.type, typeAliases);
          methodLocalTypes.set(param.name.text, paramType);
          const paramOwnershipKind = extractOwnershipKindFromTypeNode(param.type, typeAliases);
          methodParams.push({
            name: param.name.text,
            cppType: (paramType === "void" ? "auto" : paramType) as Exclude<CppTypeHint, "void">,
            defaultValue: param.initializer
              ? expressionToIR(param.initializer, sourceText, diagnostics)
              : undefined,
            isRest: false,
            ...(paramOwnershipKind ? { ownershipKind: paramOwnershipKind } : {}),
          });
        }
      }

      const methodBody = member.body
        ? lowerStatementList(
            member.body.statements, fileName, sourceText, diagnostics,
            functionReturnTypes, methodLocalTypes, `${className}.${member.name.text}`, typeAliases,
          )
        : [];
      const methodReturnType = typeNodeToCppType(member.type, typeAliases);
      const typeText = member.type ? sourceText.substring(member.type.pos, member.type.end).trim() : "";
      const returnsSelf = member.type?.kind === ts.SyntaxKind.ThisType
        || typeText === originalClassName
        || typeText === className
        || methodReturnType === originalClassName
        || methodReturnType === className;
      // Resolve return type through nested class aliases
      const resolvedReturnType = nestedClassAliases.get(methodReturnType) ?? methodReturnType;

      methods.push({
        name: member.name.text,
        returnType: (
          returnsSelf
            ? `${className}*`
            : (resolvedReturnType === "void" ? "void" : resolvedReturnType)
        ) as CppType,
        parameters: methodParams,
        statements: methodBody,
        visibility,
        isStatic,
        isAbstract: isMethodAbstract,
      });
      continue;
    }

    // Handle get accessors in nested classes
    if (ts.isGetAccessorDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const visibility: "public" | "private" | "protected" = member.modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)
        ? "private"
        : member.modifiers?.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)
          ? "protected"
          : "public";
      const isStatic = member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
      const returnType = typeNodeToCppType(member.type, typeAliases);
      const body = member.body
        ? lowerStatementList(
            member.body.statements, fileName, sourceText, diagnostics,
            functionReturnTypes, new Map<string, CppTypeHint>(),
            `${className}.${member.name.text}`, typeAliases,
          )
        : [];
      getters.push({
        name: member.name.text,
        returnType: (returnType === "void" ? "auto" : returnType) as CppType,
        statements: body,
        visibility,
        isStatic,
      });
      continue;
    }

    // Handle set accessors in nested classes
    if (ts.isSetAccessorDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const visibility: "public" | "private" | "protected" = member.modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)
        ? "private"
        : member.modifiers?.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)
          ? "protected"
          : "public";
      const isStatic = member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
      const param = member.parameters[0];
      const paramType = param && ts.isIdentifier(param.name)
        ? typeNodeToCppType(param.type, typeAliases)
        : "auto";
      const body = member.body
        ? lowerStatementList(
            member.body.statements, fileName, sourceText, diagnostics,
            functionReturnTypes, new Map<string, CppTypeHint>(),
            `${className}.${member.name.text}`, typeAliases,
          )
        : [];
      setters.push({
        name: member.name.text,
        parameter: {
          name: param && ts.isIdentifier(param.name) ? param.name.text : "value",
          cppType: (paramType === "void" ? "auto" : paramType) as CppType,
          isRest: false,
        },
        statements: body,
        visibility,
        isStatic,
      });
      continue;
    }
  }

  hoistedNestedClasses.push({
    name: className,
    extendsClass,
    isAbstract,
    sourceSpan: makeSourceSpan(node, fileName, sourceText),
    leadingComments: classComments.leadingComments,
    trailingComments: classComments.trailingComments,
    fields,
    methods,
    constructor: ctor,
    getters,
    setters,
  });

  if (safeParentName) {
    nestedClassAliases.set(originalClassName, className);
  }
}

// ---------------------------------------------------------------------------
// Array method pre-scan
// ---------------------------------------------------------------------------

// Methods that require StaticArray promotion (not all are mutating — indexOf is read-only
// but needs StaticArray since C arrays don't have an indexOf method).
const ARRAY_METHODS_REQUIRING_STATIC_ARRAY = new Set(["push", "pop", "indexOf"]);

function prescanArrayUsage(statement: ts.Statement): void {
  if (ts.isVariableStatement(statement)) {
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer) {
        if (ts.isArrayLiteralExpression(decl.initializer)) {
          arrayLiteralSizes.set(decl.name.text, decl.initializer.elements.length);
        }
        prescanExprForArrayMethods(decl.initializer);
      }
    }
  } else if (ts.isExpressionStatement(statement)) {
    prescanExprForArrayMethods(statement.expression);
  } else if (ts.isReturnStatement(statement) && statement.expression) {
    prescanExprForArrayMethods(statement.expression);
  } else if (ts.isIfStatement(statement)) {
    prescanArrayUsageBlock(statement.thenStatement);
    if (statement.elseStatement) prescanArrayUsageBlock(statement.elseStatement);
  } else if (ts.isForStatement(statement) || ts.isWhileStatement(statement) || ts.isDoStatement(statement)) {
    prescanArrayUsageBlock(statement.statement);
  } else if (ts.isForOfStatement(statement) || ts.isForInStatement(statement)) {
    prescanArrayUsageBlock(statement.statement);
  } else if (ts.isBlock(statement)) {
    for (const s of statement.statements) prescanArrayUsage(s);
  }
}

function prescanArrayUsageBlock(stmt: ts.Statement): void {
  if (ts.isBlock(stmt)) {
    for (const s of stmt.statements) prescanArrayUsage(s);
  } else {
    prescanArrayUsage(stmt);
  }
}

function prescanExprForArrayMethods(expr: ts.Expression): void {
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
    const methodName = expr.expression.name.text;
    if (ARRAY_METHODS_REQUIRING_STATIC_ARRAY.has(methodName) && ts.isIdentifier(expr.expression.expression)) {
      const varName = expr.expression.expression.text;
      if (arrayLiteralSizes.has(varName)) {
        mutableArrayVars.add(varName);
      }
    }
  }
}

function buildInlineForLoop(
  span: any,
  srcSize: number,
  srcName: string,
  paramName: string,
  bodyExpr: ts.Expression,
  sourceText: string,
  diagnostics: Diagnostic[],
  assignTarget: string,
  _isFilter: boolean,
): StatementIR {
  const bodyIR = expressionToIR(bodyExpr, sourceText, diagnostics);
  return {
    kind: "for",
    sourceSpan: span,
    initializer: { kind: "var_decl", sourceSpan: span, name: "__tc_i", storage: "let", cppType: "int", initializer: { kind: "number", value: 0 } },
    condition: { kind: "binary", left: { kind: "identifier", value: "__tc_i" }, operator: "<", right: { kind: "number", value: srcSize } },
    increment: { kind: "update", sourceSpan: span, target: "__tc_i", operator: "++", prefix: false },
    body: [
      { kind: "var_decl", sourceSpan: span, name: paramName, storage: "const", cppType: "auto",
        initializer: { kind: "raw", value: `${srcName}[__tc_i]` } },
      { kind: "assign", sourceSpan: span, target: assignTarget, operator: "=", value: bodyIR },
    ],
  };
}

export function lowerStatementList(
  statements: ts.NodeArray<ts.Statement> | ts.Statement[],
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  functionNameForDiagnostics: string,
  typeAliases?: Map<string, ts.TypeNode>,
): StatementIR[] {
  const lowered: StatementIR[] = [];
  const nestedNames: string[] = [];
  const nestedClassNames: string[] = [];

  // Phase 1: Pre-scan for nested function declarations â€” register aliases only.
  // This ensures sibling functions can reference each other.
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const originalName = statement.name.text;
      const safeParentName = functionNameForDiagnostics.replace(/\./g, "_");
      const mangledName = `${safeParentName}__${originalName}`;
      nestedFunctionAliases.set(originalName, mangledName);
      nestedNames.push(originalName);
    }
    if (ts.isClassDeclaration(statement) && statement.name) {
      const originalName = statement.name.text;
      const safeParentName = functionNameForDiagnostics.replace(/\./g, "_");
      if (safeParentName) {
        const mangledName = `${safeParentName}__${originalName}`;
        nestedClassAliases.set(originalName, mangledName);
        nestedClassNames.push(originalName);
      }
    }
  }

  // Phase 1.5: Collect local type aliases into the shared map so that
  // nested function return types can resolve generic mapped types etc.
  if (typeAliases) {
    for (const statement of statements) {
      if (ts.isTypeAliasDeclaration(statement)) {
        typeAliases.set(statement.name.text, statement.type);
      }
    }
  }

  // Phase 2: Hoist nested functions (process their bodies).
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      hoistNestedFunction(
        statement,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        functionNameForDiagnostics,
        typeAliases,
      );
    }
  }

  // Phase 2.5: Hoist nested class declarations.
  for (const statement of statements) {
    if (ts.isClassDeclaration(statement) && statement.name) {
      hoistNestedClass(
        statement,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        functionNameForDiagnostics,
        typeAliases,
      );
    }
  }

  // Phase 2.6: Hoist nested enum declarations.
  for (const statement of statements) {
    if (ts.isEnumDeclaration(statement)) {
      const enumIR = enumDeclarationToIR(statement, fileName, sourceText);
      if (enumIR && !hoistedNestedEnums.some(e => e.name === enumIR.name)) {
        hoistedNestedEnums.push(enumIR);
      }
    }
  }

  // Phase 2.6b: Hoist local interface and type alias declarations.
  // These are type-only but needed for C++ struct generation when used as return types.
  const scopeName = functionNameForDiagnostics
    ? `${functionNameForDiagnostics.replace(/\./g, "_")}__types`
    : undefined;
  for (const statement of statements) {
    if (ts.isInterfaceDeclaration(statement) && statement.name) {
      const ifaceIR = interfaceDeclarationToIR(statement, fileName, sourceText, typeAliases ?? new Map());
      if (ifaceIR && !hoistedNestedInterfaces.some(i => i.name === ifaceIR.name)) {
        if (scopeName) ifaceIR.parentScope = scopeName;
        hoistedNestedInterfaces.push(ifaceIR);
      }
    }
    if (ts.isTypeAliasDeclaration(statement)) {
      const aliasIR = typeAliasDeclarationToIR(statement, fileName, sourceText, typeAliases ?? new Map());
      if (aliasIR && !hoistedNestedTypeAliases.some(a => a.name === aliasIR.name)) {
        hoistedNestedTypeAliases.push(aliasIR);
      }
    }
  }

  // Collect pointer variables from this scope (vars initialized with 'new')
  const scopePointerVars = new Map<string, string>();
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer && ts.isNewExpression(decl.initializer)) {
          const ctorText = decl.initializer.expression && ts.isIdentifier(decl.initializer.expression)
            ? decl.initializer.expression.text : "";
          if (!TYPED_ARRAY_ELEMENT_MAP[ctorText]) {
            scopePointerVars.set(decl.name.text, ctorText);
          }
        }
      }
    }
  }

  // Phase 2.7: Pre-scan for array methods requiring StaticArray promotion.
  // Clear function-scoped state so variables from previous functions don't leak.
  resetFunctionScopeState();
  for (const statement of statements) {
    prescanArrayUsage(statement);
  }

  // Phase 3: Process remaining (non-function, non-class) statements.
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement)) {
      continue; // Already hoisted
    }
    if (ts.isClassDeclaration(statement)) {
      continue; // Already hoisted
    }
    if (ts.isEnumDeclaration(statement)) {
      continue; // Already hoisted
    }
    const result = lowerStatement(
      statement,
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
      typeAliases,
      scopePointerVars,
    );
    if (result) {
      lowered.push(...result);
    }
  }

  // Phase 4: Clean up aliases so they don't leak to sibling scopes.
  for (const name of nestedNames) {
    nestedFunctionAliases.delete(name);
  }
  for (const name of nestedClassNames) {
    nestedClassAliases.delete(name);
  }

  return lowered;
}

export function variableStatementToIR(
  statement: ts.VariableStatement,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  typeAliases?: Map<string, ts.TypeNode>,
  pointerVars: PointerTracker = new Map(),
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
      
      for (let i = 0; i < declaration.name.elements.length; i++) {
        const element = declaration.name.elements[i];
        // Skip omitted expressions (holes in array binding pattern)
        if (!ts.isBindingElement(element)) {
          continue;
        }
        if (ts.isObjectBindingPattern(element.name)) {
          // Nested object destructuring: const { data: { status } } = meta;
          const nestedPropName = element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : undefined;
          if (nestedPropName) {
            const nestedObjText = `${objText}.${nestedPropName}`;
            for (const nestedElement of element.name.elements) {
              if (!ts.isBindingElement(nestedElement) || !ts.isIdentifier(nestedElement.name)) continue;
              const nestedVarName = nestedElement.name.text;
              let nPropName = nestedVarName;
              if (nestedElement.propertyName && ts.isIdentifier(nestedElement.propertyName)) {
                nPropName = nestedElement.propertyName.text;
              }
              const propAccess: ExpressionIR = { kind: "raw", value: `${nestedObjText}.${nPropName}` };
              const initializer = nestedElement.initializer
                ? { kind: "raw" as const, value: `typehal_nullish(${renderExprAsText(propAccess)}, ${renderExprAsText(expressionToIR(nestedElement.initializer, sourceText, diagnostics))})` }
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
        const propAccess: ExpressionIR = { kind: "raw", value: `${objText}.${propName}` };
        const initializer = element.initializer
          ? {
              kind: "raw" as const,
              value: `typehal_nullish(${renderExprAsText(propAccess)}, ${renderExprAsText(expressionToIR(element.initializer, sourceText, diagnostics))})`,
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
            value: `typehal_nullish(${renderExprAsText(initializer)}, ${renderExprAsText(expressionToIR(element.initializer, sourceText, diagnostics))})`,
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

    // Check if initializer is a volatile() call - if so, unwrap it and mark as volatile
    let isVolatile = false;
    let actualInitializer = declaration.initializer;
    
    if (declaration.initializer && ts.isCallExpression(declaration.initializer)) {
      const callee = declaration.initializer.expression;
      if (ts.isIdentifier(callee) && callee.text === "volatile") {
        isVolatile = true;
        // Unwrap: use the first argument as the actual initializer
        if (declaration.initializer.arguments.length > 0) {
          actualInitializer = declaration.initializer.arguments[0];
        } else {
          actualInitializer = undefined;
        }
      }
    }

    // â”€â”€ Track function-level typed array vars for .length â†’ sizeof â”€â”€â”€â”€â”€â”€
    // Variables initialized with new TypedArray(...) inside function bodies
    // need the same tracking as top-level ones for correct .length handling.
    if (actualInitializer && ts.isNewExpression(actualInitializer)) {
      const ctorText = actualInitializer.expression && ts.isIdentifier(actualInitializer.expression)
        ? actualInitializer.expression.text : "";
      if (TYPED_ARRAY_ELEMENT_MAP[ctorText] && ts.isIdentifier(declaration.name)) {
        activeCArrayVars.add(declaration.name.text);
      }
    }

    // Detect arrow/function-expression initializers and produce lambda IR
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
            defaultValue: param.initializer ? expressionToIR(param.initializer, sourceText, diagnostics) : undefined,
            isRest: false,
          });
        }
      }
      const isBlock = ts.isBlock(fnExpr.body);
      const body: StatementIR[] = isBlock
        ? lowerStatementList(
            (fnExpr.body as ts.Block).statements,
            fileName, sourceText, diagnostics,
            new Map(), new Map(),
            declaration.name.getText(),
            typeAliases,
          )
        : [{
            kind: "return" as const,
            sourceSpan: makeSourceSpan(fnExpr.body, fileName, sourceText),
            value: expressionToIR(fnExpr.body, sourceText, diagnostics),
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
        ? expressionToIR(actualInitializer, sourceText, diagnostics)
        : undefined),
    };
    commentsAssigned = true;

    // â”€â”€ Pin alias detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Handle: const led = LED.asOutput() or const btn = D2.asInput()
    // These create compile-time-only aliases â€” no C++ variable is emitted.
    // The typehal-call (pinMode) is emitted as a standalone statement,
    // and the variable name is recorded for alias resolution in subsequent calls.
    const initIR = loweredDeclaration.initializer as any;
    if (initIR?.kind === 'typehal-call' &&
        typeof initIR.method === 'string' &&
        (initIR.method === 'asOutput' || initIR.method === 'asInput' || initIR.method === 'asInputPullUp')) {
      const aliasTarget = initIR.receiver;
      const aliasKind = inferKindByName(aliasTarget);
      activePinAliases.set(declaration.name.text, aliasTarget);
      if (aliasKind === 'unknown') {
        loweredDeclaration.initializer = { kind: "raw", value: aliasTarget };
        lowered.push(loweredDeclaration);
      }
      lowered.push({
        kind: "typehal-call",
        sourceSpan: loweredDeclaration.sourceSpan,
        leadingComments: loweredDeclaration.leadingComments,
        trailingComments: loweredDeclaration.trailingComments,
        receiver: aliasTarget,
        receiverKind: initIR.receiverKind,
        method: initIR.method,
        args: initIR.args || [],
      });
      if (aliasKind !== 'unknown') {
        continue;
      }
      continue;
    }

    // â”€â”€ Ownership-handle bus alias detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Handle: const bus = I2C0.take() / SPI0.take() / UART0.take()
    // These are compile-time aliases for ownership analysis, and the emitted
    // statement remains the underlying take() call.
    if (initIR?.kind === 'typehal-call' &&
        typeof initIR.method === 'string' &&
        (initIR.method === 'take' || initIR.method === 'begin' || initIR.method === 'configBegin') &&
        (initIR.receiverKind === 'i2c' || initIR.receiverKind === 'spi' || initIR.receiverKind === 'serial')) {
      activeBusAliases.set(declaration.name.text, { receiver: initIR.receiver, kind: initIR.receiverKind });
      lowered.push({
        kind: "typehal-call",
        sourceSpan: loweredDeclaration.sourceSpan,
        leadingComments: loweredDeclaration.leadingComments,
        trailingComments: loweredDeclaration.trailingComments,
        receiver: initIR.receiver,
        receiverKind: initIR.receiverKind,
        method: initIR.method,
        args: initIR.args || [],
      });
      continue;
    }

    const declarationType = resolveDeclarationType(
      declaration.type,
      declaration.initializer,
      functionReturnTypes,
      localVariableTypes,
      typeAliases,
    );

    // Resolve type through nested class aliases for hoisted class names.
    let varCppType: string = declarationType.resolvedType === "void" ? "auto" : declarationType.resolvedType;
    const isPtr = varCppType.endsWith("*");
    const baseCppType = isPtr ? varCppType.slice(0, -1) : varCppType;
    if (nestedClassAliases.has(baseCppType)) {
      varCppType = nestedClassAliases.get(baseCppType)! + (isPtr ? "*" : "");
    }
    loweredDeclaration.cppType = varCppType as CppType;
    localVariableTypes.set(declaration.name.text, declarationType.resolvedType);
    activeLocalTypes.set(declaration.name.text, declarationType.resolvedType);

    // Track C-string variables for .length → strlen() conversion
    if (declarationType.resolvedType === "const char*" || declarationType.resolvedType === "char*") {
      activeStringVars.add(declaration.name.text);
    }

    // ── Array method handling ──────────────────────────────────────────────
    if (ts.isIdentifier(declaration.name) && actualInitializer) {
      const varName = declaration.name.text;

      // 1) Mutable array (push/pop/indexOf) → StaticArray with push_back init
      if (mutableArrayVars.has(varName) && ts.isArrayLiteralExpression(actualInitializer)) {
        const elements = actualInitializer.elements;
        lowered.push({
          kind: "var_decl",
          sourceSpan: loweredDeclaration.sourceSpan,
          leadingComments: loweredDeclaration.leadingComments,
          trailingComments: [],
          name: varName,
          storage: "let",
          cppType: "StaticArray<int>",
          initializer: undefined,
        });
        for (let ei = 0; ei < elements.length; ei++) {
          lowered.push({
            kind: "call",
            sourceSpan: loweredDeclaration.sourceSpan,
            callee: `${varName}.push_back`,
            args: [expressionToIR(elements[ei], sourceText, diagnostics)],
          });
        }
        commentsAssigned = true;
        continue;
      }

      // 2) arr.map(arrowFn) → inline loop
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
            // result array
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
            // for loop
            lowered.push(buildInlineForLoop(
              span, srcSize, srcName, paramName, bodyExpr,
              sourceText, diagnostics, `${varName}[__tc_i]`, false,
            ));
            commentsAssigned = true;
            continue;
          }
        }
      }

      // 3) arr.filter(arrowFn) → inline loop with conditional push
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
            // result array (oversized)
            const zeroElements: ExpressionIR[] = [];
            for (let zi = 0; zi < srcSize; zi++) zeroElements.push({ kind: "number", value: 0 });
            lowered.push({
              kind: "var_decl", sourceSpan: span,
              leadingComments: loweredDeclaration.leadingComments, trailingComments: [],
              name: varName, storage: "let", cppType: "auto",
              initializer: { kind: "array", elementType: "auto", elements: zeroElements },
            });
            // length counter
            lowered.push({
              kind: "var_decl", sourceSpan: span,
              leadingComments: [], trailingComments: [],
              name: lenVar, storage: "let", cppType: "int",
              initializer: { kind: "number", value: 0 },
            });
            filteredArrayLengthVars.set(varName, lenVar);
            // for loop with conditional push
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

      // 4) arr.reduce(arrowFn, init) → inline accumulation loop
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
            // accumulator variable with initial value
            lowered.push({
              kind: "var_decl", sourceSpan: span,
              leadingComments: loweredDeclaration.leadingComments, trailingComments: [],
              name: varName, storage: "let", cppType: "auto",
              initializer: expressionToIR(initVal, sourceText, diagnostics),
            });
            // for loop: for each element, compute new accumulator
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

      // 5) const x = arr.push(val) → push_back + x = arr.size()
      if (ts.isCallExpression(actualInitializer) &&
          ts.isPropertyAccessExpression(actualInitializer.expression) &&
          actualInitializer.expression.name.text === "push" &&
          ts.isIdentifier(actualInitializer.expression.expression)) {
        const arrName = actualInitializer.expression.expression.text;
        if (mutableArrayVars.has(arrName) && actualInitializer.arguments.length > 0) {
          const span = loweredDeclaration.sourceSpan;
          lowered.push({
            kind: "call", sourceSpan: span,
            callee: `${arrName}.push_back`,
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

      // 6) Regular array literal → track in activeCArrayVars for .length → sizeof
      // These are emitted as C arrays (int arr[] = {...}), not std::vector,
      // regardless of what resolveDeclarationType reports. Fix the cppType to match.
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

    // â”€â”€ Ownership kind detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Detect Ref<T>, MutRef<T>, Owned<T> wrapper types and store the
    // ownership kind on the IR node for validation and const emission.
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

// Helper to scan for pointer variables (variables initialized with ‘new’)
export function collectPointerVars(statements: readonly ts.Statement[]): PointerTracker {
  const pointerVars = new Map<string, string>();

  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer && ts.isNewExpression(decl.initializer)) {
          const ctorText = decl.initializer.expression && ts.isIdentifier(decl.initializer.expression)
            ? decl.initializer.expression.text : "";
          if (TYPED_ARRAY_ELEMENT_MAP[ctorText]) {
            // new TypedArray([...]) etc. → C array, not a pointer
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