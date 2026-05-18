import ts from "typescript";
import { Diagnostic, SourceSpan } from "../types";
import { ClassIR, ClassFieldIR, ClassMethodIR, ClassGetterIR, ClassSetterIR, CppType, ExpressionIR, HALOpIR, ParameterIR, StatementIR } from "@typehal/core";
import { extractNodeComments, makeDiagnostic, makeSourceSpan } from "./ast-node-utils";
import { isCompileTimeOnlyCallName, isCompileTimeOnlyClassName } from "./compile-time-only";
import { CppTypeHint, inferExprCppType, resolveDeclarationType, typeNodeToCppType, extractOwnershipKindFromTypeNode, resolveAliasedTypeNode } from "./type-resolution";
import { escapeCppKeyword } from "../utils/strings";
import { PointerTracker, TYPED_ARRAY_ELEMENT_MAP, registerFieldMap, hoistedNestedFunctions, hoistedNestedClasses, hoistedNestedEnums, hoistedNestedInterfaces, hoistedNestedTypeAliases, nestedFunctionAliases, nestedClassAliases, activeCArrayVars, activeArrayLiteralVars, activeStringVars, mutableArrayVars, arrayLiteralSizes, filteredArrayLengthVars, activeLocalTypes, activeGlobalTypes, resetFunctionScopeState, topLevelClassNames, topLevelClasses, requiredIncludes } from "./build-ir-state";
import { calleeToText, renderExprAsText } from "./render-expr";
import { expressionToIR } from "./expression-to-ir";
import { enumDeclarationToIR, interfaceDeclarationToIR, typeAliasDeclarationToIR } from "./declaration-builders";
import { forInitializerToIR, incrementorToIR, lowerControlFlowStatement } from "./transformers/control-flow";
export { forInitializerToIR, incrementorToIR, lowerControlFlowStatement };
import { tryLowerRegisterWrite } from "./transformers/register-assignment";
import { expressionStatementToIR as delegateExpressionStatementToIR } from "./transformers/expressions";

import { resolveHALReceiver, processHALMethodBody, halInstances, getCtorIncludes, isKnownHALClass, registerFloatVariable, HALInstance, isHALSingleton } from "./hal-resolver";
import { collectChainedHALEmits, emitLinesToIR, halOpsToIR } from "./transformers/hal-emit-helpers";

import { NamespaceMethodResult, resolveNamespaceMethodCall } from "./transformers/namespace-methods";

import { tryResolveHALMethod, resolveHALCallForVarInit, tryResolveHALExpression } from "./transformers/hal-call-resolver";
export { tryResolveHALMethod, resolveHALCallForVarInit, tryResolveHALExpression };
import { hoistNestedFunction, hoistNestedClass } from "./function-builder";
import { prescanArrayUsage, buildInlineForLoop } from "./transformers/array-methods";
export { prescanArrayUsage, buildInlineForLoop };



import { callToStatement } from "./transformers/call-statement";
export { callToStatement };

import { assignmentOperatorToString, updateLocalTypeFromAssignment, extractForInKeys, variableStatementToIR, collectPointerVars } from "./transformers/variables";
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
