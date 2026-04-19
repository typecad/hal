import ts from "typescript";
import { Diagnostic, SourceSpan } from "../types";
import { ClassIR, ClassFieldIR, ClassMethodIR, CppType, ExpressionIR, ParameterIR, StatementIR } from "./model";
import { extractNodeComments, makeDiagnostic, makeSourceSpan } from "./ast-node-utils";
import { isCompileTimeOnlyCallName, isCompileTimeOnlyClassName, isCompileTimeOnlyMethodName } from "./compile-time-only";
import { CppTypeHint, inferExprCppType, resolveDeclarationType, typeNodeToCppType, extractOwnershipKindFromTypeNode } from "./type-resolution";
import { inferKindByName } from "./typecode-symbols";
import { escapeCppKeyword } from "../utils/strings";
import { PointerTracker, TYPED_ARRAY_ELEMENT_MAP, registerFieldMap, hoistedNestedFunctions, hoistedNestedClasses, nestedFunctionAliases, activePinAliases, activeBusAliases, activeCArrayVars } from "./build-ir-state";
import { calleeToText, renderExprAsText } from "./render-expr";
import { expressionToIR } from "./expression-to-ir";
import { extractRootAndChain } from "./ast-patterns";

export function callToStatement(
  statementNode: ts.ExpressionStatement,
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  pointerVars: PointerTracker = new Map(),
): StatementIR {
  const comments = extractNodeComments(statementNode, sourceText);
  
  // ---- Typecode call detection at statement level -------------------------
  // Handle D13.asOutput(), D9.pwm(), D2.pullup(), etc.
  // These need to be detected as typecode-call IR nodes for proper transpilation.
  if (ts.isPropertyAccessExpression(call.expression)) {
    const chainInfo = extractRootAndChain(call.expression);
    if (chainInfo) {
      const kind = inferKindByName(chainInfo.root);
      if (kind !== 'unknown') {
        // Build the full method path (e.g., "config.output" from D13.config.output)
        const fullMethod = chainInfo.chain.join('.');
        return {
          kind: "typecode-call",
          sourceSpan: makeSourceSpan(call, fileName, sourceText),
          receiver: chainInfo.root,
          receiverKind: kind,
          method: fullMethod,
          args: call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
        };
      }
      // Pin alias resolution at statement level: led.toggle() â†’ LED.toggle()
      const aliasTarget = activePinAliases.get(chainInfo.root);
      if (aliasTarget) {
        const aliasKind = inferKindByName(aliasTarget);
        if (aliasKind !== 'unknown') {
          const fullMethod = chainInfo.chain.join('.');
          return {
            kind: "typecode-call",
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
          kind: "typecode-call",
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
            kind: "typecode-call",
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
            kind: "typecode-call",
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
              kind: "typecode-call",
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
              kind: "typecode-call",
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
        const className = pointerVars.get(innerReceiver.text);
        const cls = className ? hoistedNestedClasses.find(c => c.name === className) : undefined;
        const method = cls?.methods.find(m => m.name === innerMethodName);
        if (method && (method.returnType as string).endsWith("*")) {
          accessor = "->";
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

  return {
    kind: "var_decl",
    sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
    name: declaration.name.text,
    storage,
    cppType: (declarationType.resolvedType === "void" ? "auto" : declarationType.resolvedType) as Exclude<CppTypeHint, "void">,
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
        if (isCompileTimeOnlyMethodName(method)) {
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

  hoistedNestedFunctions.push({
    originalName: mangledName,
    isAsync: false,
    returnType: returnType as any,
    sourceSpan: makeSourceSpan(statement, fileName, sourceText),
    ...extractNodeComments(statement, sourceText),
    parameters,
    statements: bodyStatements,
    ...(typeParams && typeParams.length > 0 ? { typeParameters: typeParams } : {}),
  });
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
  const className = node.name.text;

  const extendsClass = node.heritageClauses
    ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
    ?.types[0]
    ?.expression
    ?.getText();

  const isAbstract = node.modifiers?.some(m => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;
  const classComments = extractNodeComments(node, sourceText);
  const fields: ClassFieldIR[] = [];
  const methods: ClassMethodIR[] = [];
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
        || typeText === className
        || methodReturnType === className;

      methods.push({
        name: member.name.text,
        returnType: (
          returnsSelf
            ? `${className}*`
            : (methodReturnType === "void" ? "void" : methodReturnType)
        ) as CppType,
        parameters: methodParams,
        statements: methodBody,
        visibility,
        isStatic,
        isAbstract: isMethodAbstract || isAbstract,
      });
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
    getters: [],
    setters: [],
  });
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

  // Phase 3: Process remaining (non-function, non-class) statements.
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement)) {
      continue; // Already hoisted
    }
    if (ts.isClassDeclaration(statement)) {
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
                ? { kind: "raw" as const, value: `typecode_nullish(${renderExprAsText(propAccess)}, ${renderExprAsText(expressionToIR(nestedElement.initializer, sourceText, diagnostics))})` }
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
              value: `typecode_nullish(${renderExprAsText(propAccess)}, ${renderExprAsText(expressionToIR(element.initializer, sourceText, diagnostics))})`,
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
            value: `typecode_nullish(${renderExprAsText(initializer)}, ${renderExprAsText(expressionToIR(element.initializer, sourceText, diagnostics))})`,
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
    // The typecode-call (pinMode) is emitted as a standalone statement,
    // and the variable name is recorded for alias resolution in subsequent calls.
    const initIR = loweredDeclaration.initializer as any;
    if (initIR?.kind === 'typecode-call' &&
        typeof initIR.method === 'string' &&
        (initIR.method === 'asOutput' || initIR.method === 'asInput' || initIR.method === 'asInputPullUp')) {
      activePinAliases.set(declaration.name.text, initIR.receiver);
      lowered.push({
        kind: "typecode-call",
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

    // â”€â”€ Ownership-handle bus alias detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Handle: const bus = I2C0.take() / SPI0.take() / UART0.take()
    // These are compile-time aliases for ownership analysis, and the emitted
    // statement remains the underlying take() call.
    if (initIR?.kind === 'typecode-call' &&
        typeof initIR.method === 'string' &&
        (initIR.method === 'take' || initIR.method === 'begin' || initIR.method === 'configBegin') &&
        (initIR.receiverKind === 'i2c' || initIR.receiverKind === 'spi' || initIR.receiverKind === 'serial')) {
      activeBusAliases.set(declaration.name.text, { receiver: initIR.receiver, kind: initIR.receiverKind });
      lowered.push({
        kind: "typecode-call",
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

    loweredDeclaration.cppType = (declarationType.resolvedType === "void" ? "auto" : declarationType.resolvedType) as Exclude<CppTypeHint, "void">;
    localVariableTypes.set(declaration.name.text, declarationType.resolvedType);

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