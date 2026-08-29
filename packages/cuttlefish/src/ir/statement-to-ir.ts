import ts from "typescript";
import { Diagnostic, SourceSpan } from "../types.js";
import { ClassIR, ClassFieldIR, ClassMethodIR, ClassGetterIR, ClassSetterIR, CppType, ExpressionIR, HALOpIR, ParameterIR, StatementIR } from "../api/index.js";
import { isStringEnum } from "../api/shared/index.js";
import { extractNodeComments, makeDiagnostic, makeSourceSpan } from "./ast-node-utils.js";
import { isCompileTimeOnlyCallName, isCompileTimeOnlyClassName } from "./compile-time-only.js";
import { CppTypeHint, inferExprCppType, resolveDeclarationType, typeNodeToCppType, extractOwnershipKindFromTypeNode, resolveAliasedTypeNode } from "./type-resolution.js";
import { escapeCppKeyword } from "../utils/strings.js";
import { PointerTracker, TYPED_ARRAY_ELEMENT_MAP, registerFieldMap, hoistedNestedFunctions, hoistedNestedClasses, hoistedNestedEnums, hoistedNestedInterfaces, hoistedNestedTypeAliases, nestedFunctionAliases, nestedClassAliases, activeCArrayVars, activeArrayLiteralVars, activeStringVars, mutableArrayVars, arrayLiteralSizes, filteredArrayLengthVars, activeEnumNames, activeStringEnumNames, resetFunctionScopeState, topLevelClassNames, topLevelClasses, requiredIncludes } from "./build-ir-state.js";
import { getCurrentIrTypeScope, bindIrTypeScopeLocals } from "./symbol-types.js";
import { calleeToText, renderExprAsText } from "./render-expr.js";
import { expressionToIR } from "./expression-to-ir.js";
import { enumDeclarationToIR, interfaceDeclarationToIR, typeAliasDeclarationToIR } from "./declaration-builders.js";
import { forInitializerToIR, incrementorToIR, lowerControlFlowStatement } from "./transformers/control-flow.js";
export { forInitializerToIR, incrementorToIR, lowerControlFlowStatement };
import { tryLowerRegisterWrite } from "./transformers/register-assignment.js";
import { expressionStatementToIR as delegateExpressionStatementToIR } from "./transformers/expressions.js";

import { resolveHALReceiver, processHALMethodBody, halInstances, getCtorIncludes, isKnownHALClass, registerFloatVariable, HALInstance, isHALSingleton } from "./hal-resolver.js";
import { collectChainedHALEmits, emitLinesToIR, halOpsToIR } from "./transformers/hal-emit-helpers.js";

import { NamespaceMethodResult, resolveNamespaceMethodCall } from "./transformers/namespace-methods.js";

import { tryResolveHALMethod, resolveHALCallForVarInit, tryResolveHALExpression } from "./transformers/hal-call-resolver.js";
import { resolveElementValue } from "./transformers/ui-call-resolver.js";
export { tryResolveHALMethod, resolveHALCallForVarInit, tryResolveHALExpression };
import { hoistNestedFunction, hoistNestedClass } from "./function-builder.js";
import { prescanArrayUsage, buildInlineForLoop } from "./transformers/array-methods.js";
export { prescanArrayUsage, buildInlineForLoop };



import { callToStatement } from "./transformers/call-statement.js";
export { callToStatement };

import { assignmentOperatorToString, updateLocalTypeFromAssignment, extractForInKeys, variableStatementToIR, collectPointerVars } from "./transformers/variables.js";
export { assignmentOperatorToString, updateLocalTypeFromAssignment, extractForInKeys, variableStatementToIR, collectPointerVars };



export function expressionStatementToIR(
  statement: ts.ExpressionStatement,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  pointerVars: PointerTracker = new Map(),
): StatementIR | undefined {
  return delegateExpressionStatementToIR(
    statement,
    fileName,
    sourceText,
    diagnostics,
    functionReturnTypes,
    localVariableTypes,
    pointerVars,
  );
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
            pointerVars,
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

    // ── UI element .value write: screen.led.value = 1 ────────────────────
    // Lowers to __ui_nodes[N].value = X; ui_mark_dirty(N);
    if (
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(statement.expression.left) &&
      statement.expression.left.name.text === "value" &&
      ts.isPropertyAccessExpression(statement.expression.left.expression) &&
      ts.isIdentifier(statement.expression.left.expression.expression)
    ) {
      const treeName = statement.expression.left.expression.expression.text;
      const elemId = statement.expression.left.expression.name.text;
      const nodeIdx = resolveElementValue(treeName, elemId);
      if (nodeIdx !== undefined) {
        const valIR = expressionToIR(statement.expression.right, sourceText, diagnostics, pointerVars);
        const valText = renderExprAsText(valIR);
        return [{
          kind: "call" as const,
          sourceSpan: makeSourceSpan(statement, fileName, sourceText),
          callee: `__RAW_STMT____ui_nodes[${nodeIdx}].value = ${valText}; ui_mark_dirty(${nodeIdx});`,
          args: [],
        }];
      }
    }

    // ── UI element .text write: screen.ssid.text = "x" ──────────────────
    // Lowers to strncpy(__ui_nodes[N].textBuffer, "x", UI_TEXT_BUF);
    //         __ui_nodes[N].textBuffer[UI_TEXT_BUF] = 0; ui_mark_dirty(N);
    if (
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(statement.expression.left) &&
      statement.expression.left.name.text === "text" &&
      ts.isPropertyAccessExpression(statement.expression.left.expression) &&
      ts.isIdentifier(statement.expression.left.expression.expression)
    ) {
      const treeName = statement.expression.left.expression.expression.text;
      const elemId = statement.expression.left.expression.name.text;
      const nodeIdx = resolveElementValue(treeName, elemId);
      if (nodeIdx !== undefined) {
        const valIR = expressionToIR(statement.expression.right, sourceText, diagnostics, pointerVars);
        const valText = renderExprAsText(valIR);
        return [{
          kind: "call" as const,
          sourceSpan: makeSourceSpan(statement, fileName, sourceText),
          callee: `__RAW_STMT__strncpy(__ui_nodes[${nodeIdx}].textBuffer, ${valText}, UI_TEXT_BUF); __ui_nodes[${nodeIdx}].textBuffer[UI_TEXT_BUF] = 0; ui_mark_dirty(${nodeIdx});`,
          args: [],
        }];
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
      functionNameForDiagnostics,
      lowerStatementList,
    );
  }

  const controlFlowLowered = lowerControlFlowStatement(
    statement,
    fileName,
    sourceText,
    diagnostics,
    functionReturnTypes,
    localVariableTypes,
    functionNameForDiagnostics,
    typeAliases,
    pointerVars,
  );
  if (controlFlowLowered !== null) {
    return controlFlowLowered;
  }

  diagnostics.push(
    makeDiagnostic(
      sourceText,
      statement.pos,
      `Unsupported statement in function '${functionNameForDiagnostics}'.`,
      "error",
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


// ---------------------------------------------------------------------------
// Array method pre-scan
// ---------------------------------------------------------------------------

// Methods that require StaticArray promotion (not all are mutating — indexOf is read-only
// but needs StaticArray since C arrays don't have an indexOf method).


export function lowerStatementList(
  statements: readonly ts.Statement[] | ts.NodeArray<ts.Statement>,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  functionNameForDiagnostics: string,
  typeAliases?: Map<string, ts.TypeNode>,
  pointerVars: PointerTracker = new Map(),
): StatementIR[] {
  const lowered: StatementIR[] = [];
  const nestedNames: string[] = [];
  const nestedClassNames: string[] = [];

  // Function/method bodies run at an unmodeled time relative to top-level
  // flow, so pin-state constant folding must be off inside them (reads fall
  // back to the shadow variable), and any writes they contain invalidate the
  // top-level levels afterwards. "" and "<top-level>" are the top-level
  // markers; everything else names a function/method/lambda body.
  const isFunctionBodyCtx = functionNameForDiagnostics !== "" && functionNameForDiagnostics !== "<top-level>";

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

  // Phase 1.6: Pre-scan for enum declarations (top-level within this scope and
  // nested inside functions) so that string-concat chain detection during
  // lowering knows which enum-typed variables are string-bearing (string enums
  // lower to const char*). Must run BEFORE hoisting/lowers.
  for (const statement of statements) {
    const collectEnums = (node: ts.Node) => {
      if (ts.isEnumDeclaration(node) && node.name) {
        activeEnumNames.add(node.name.text);
        // Determine string-enum-ness from the declaration.
        let allString = true;
        let any = false;
        for (const member of node.members) {
          if (member.initializer && ts.isStringLiteral(member.initializer)) {
            any = true;
          } else if (member.initializer && !ts.isStringLiteral(member.initializer)) {
            allString = false;
          } else {
            allString = false;
          }
        }
        if (any && allString) {
          activeStringEnumNames.add(node.name.text);
        }
      }
    };
    collectEnums(statement);
    ts.forEachChild(statement, collectEnums);
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
        pointerVars,
        lowerStatementList,
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
        pointerVars,
        lowerStatementList,
      );
    }
  }

  // Phase 2.6: Hoist nested enum declarations.
  for (const statement of statements) {
    if (ts.isEnumDeclaration(statement)) {
      const enumIR = enumDeclarationToIR(statement, fileName, sourceText);
      if (enumIR && !hoistedNestedEnums.some(e => e.name === enumIR.name)) {
        hoistedNestedEnums.push(enumIR);
        // Register string-enum-ness so concat-chain detection (expression-to-ir)
        // recognizes variables of this type as string-bearing.
        if (isStringEnum(enumIR)) {
          activeStringEnumNames.add(enumIR.name);
        }
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
  // Clear function-scoped state so variables from previous functions don't leak,
  // but preserve file-level mutable array tracking (populated by build-ir.ts pre-scan).
  const savedMutableArrayVars = new Set(mutableArrayVars);
  const savedArrayLiteralSizes = new Map(arrayLiteralSizes);
  resetFunctionScopeState();
  for (const v of savedMutableArrayVars) mutableArrayVars.add(v);
  for (const [k, v] of savedArrayLiteralSizes) arrayLiteralSizes.set(k, v);

  // resetFunctionScopeState re-seeded scope.locals from classFields. Now bind
  // the threaded localVariableTypes map as the scope's locals storage (folding
  // both the re-seeded classFields entries and any entries the threaded map
  // already carried, e.g. function parameters). After this, the threaded
  // `localVariableTypes` param and getCurrentIrTypeScope().locals are the SAME
  // Map, so writes through either are visible to both — eliminating the old
  // shadow-sync that copied localVariableTypes into the global activeLocalTypes.
  const scope = getCurrentIrTypeScope();
  if (scope) {
    bindIrTypeScopeLocals(scope, localVariableTypes);
  }

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

  if (isFunctionBodyCtx) {
  }

  return lowered;
}
