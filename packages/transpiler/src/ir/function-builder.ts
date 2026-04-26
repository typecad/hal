import ts from "typescript";
import { Diagnostic } from "../types";
import { FunctionIR, ParameterIR, StatementIR } from "./model";
import { extractNodeComments, makeDiagnostic, makeSourceSpan } from "./ast-node-utils";
import { collectReturns, CppTypeHint, inferExprCppType, typeNodeToCppType, extractOwnershipKindFromTypeNode, resolveFunctionReturnType, resolveFunctionTypeSignature } from "./type-resolution";
import { expressionToIR } from "./expression-to-ir";
import { lowerStatementList } from "./statement-to-ir";

export function functionDeclarationToIR(
  node: ts.FunctionDeclaration,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  typeAliasNodes: Map<string, ts.TypeNode>,
  boilerplates: Set<string>,
): FunctionIR | undefined {
  // Skip overload signatures (declarations without a body).
  if (!node.body) return undefined;

  if (!node.name) {
    diagnostics.push(makeDiagnostic(sourceText, node.pos, "Anonymous function declaration is unsupported.", "warning"));
    return undefined;
  }

  const isAsync = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
  if (isAsync) {
    boilerplates.add("async_stub");
    diagnostics.push(
      makeDiagnostic(
        sourceText,
        node.pos,
        "Async function encountered. Added async compatibility boilerplate stub; semantics are approximate.",
        "warning",
        "TS2CPP_ASYNC_STUB",
      ),
    );
  }

  const localVariableTypes = new Map<string, CppTypeHint>();
  const parameters: ParameterIR[] = [];

  for (const parameter of node.parameters) {
    if (ts.isIdentifier(parameter.name)) {
      const parameterType = typeNodeToCppType(parameter.type, typeAliasNodes);
      localVariableTypes.set(parameter.name.text, parameterType);
      const paramOwnershipKind = extractOwnershipKindFromTypeNode(parameter.type, typeAliasNodes);
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

  const bodyStatements = lowerStatementList(
    node.body?.statements ?? [],
    fileName,
    sourceText,
    diagnostics,
    functionReturnTypes,
    localVariableTypes,
    node.name.text,
    typeAliasNodes,
  );

  const fnTypeParams = node.typeParameters
    ? node.typeParameters.map(tp => tp.name.text)
    : undefined;

  return {
    originalName: node.name.text,
    isAsync,
    returnType: resolveFunctionReturnType(node.name.text, functionReturnTypes),
    sourceSpan: makeSourceSpan(node, fileName, sourceText),
    ...extractNodeComments(node, sourceText),
    parameters,
    statements: bodyStatements,
    ...(fnTypeParams && fnTypeParams.length > 0 ? { typeParameters: fnTypeParams } : {}),
  };
}

export function variableAsFunctionToIR(
  node: ts.VariableStatement,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  typeAliasNodes: Map<string, ts.TypeNode>,
  boilerplates: Set<string>,
): FunctionIR[] | undefined {
  const functionExpressionDeclarations = node.declarationList.declarations.filter((declaration) => {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
      return false;
    }
    return ts.isFunctionExpression(declaration.initializer) || ts.isArrowFunction(declaration.initializer);
  });

  if (
    functionExpressionDeclarations.length === 0 ||
    functionExpressionDeclarations.length !== node.declarationList.declarations.length
  ) {
    return undefined;
  }

  const declarationComments = extractNodeComments(node, sourceText);
  let commentsAssigned = false;
  const results: FunctionIR[] = [];

  for (const declaration of functionExpressionDeclarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
      continue;
    }

    const fnExpression = declaration.initializer;
    if (!ts.isFunctionExpression(fnExpression) && !ts.isArrowFunction(fnExpression)) {
      continue;
    }

    const signatureFromAlias = resolveFunctionTypeSignature(declaration.type, typeAliasNodes);
    const localVariableTypes = new Map<string, CppTypeHint>();
    const parameters: ParameterIR[] = [];

    for (let index = 0; index < fnExpression.parameters.length; index++) {
      const parameter = fnExpression.parameters[index];
      if (!ts.isIdentifier(parameter.name)) {
        continue;
      }

      const explicitParameterType = typeNodeToCppType(parameter.type, typeAliasNodes);
      const aliasedParameterType = signatureFromAlias?.parameterTypes[index] ?? "auto";
      const parameterType = explicitParameterType !== "auto" ? explicitParameterType : aliasedParameterType;

      localVariableTypes.set(parameter.name.text, parameterType);
      const paramOwnershipKind = extractOwnershipKindFromTypeNode(parameter.type, typeAliasNodes);
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

    const bodyStatements: StatementIR[] = ts.isBlock(fnExpression.body)
      ? lowerStatementList(
          fnExpression.body.statements,
          fileName,
          sourceText,
          diagnostics,
          functionReturnTypes,
          localVariableTypes,
          declaration.name.text,
          typeAliasNodes,
        )
      : [
          {
            kind: "return" as const,
            sourceSpan: makeSourceSpan(fnExpression.body, fileName, sourceText),
            value: expressionToIR(fnExpression.body, sourceText, diagnostics),
          },
        ];

    const explicitReturnType = typeNodeToCppType(fnExpression.type, typeAliasNodes);
    let resolvedReturnType: CppTypeHint = explicitReturnType;

    if (resolvedReturnType === "auto" && signatureFromAlias && signatureFromAlias.returnType !== "auto") {
      resolvedReturnType = signatureFromAlias.returnType;
    }

    // Promote int → float when the function body returns float expressions
    if (resolvedReturnType === "int") {
      if (ts.isBlock(fnExpression.body)) {
        const returnTypes = collectReturns(fnExpression.body)
          .filter((item) => item.expression)
          .map((item) => inferExprCppType(item.expression as ts.Expression, functionReturnTypes, localVariableTypes, sourceText))
          .filter((item) => item !== "auto");
        if (returnTypes.includes("float")) {
          resolvedReturnType = "float";
        }
      } else {
        const inferredBodyType = inferExprCppType(fnExpression.body, functionReturnTypes, localVariableTypes, sourceText);
        if (inferredBodyType === "float") {
          resolvedReturnType = "float";
        }
      }
    }

    if (resolvedReturnType === "auto") {
      if (ts.isBlock(fnExpression.body)) {
        const returnTypes = collectReturns(fnExpression.body)
          .filter((item) => item.expression)
          .map((item) => inferExprCppType(item.expression as ts.Expression, functionReturnTypes, localVariableTypes, sourceText))
          .filter((item) => item !== "auto");

        if (returnTypes.includes("float")) {
          resolvedReturnType = "float";
        } else if (returnTypes.includes("int")) {
          resolvedReturnType = "int";
        } else if (returnTypes.includes("bool")) {
          resolvedReturnType = "bool";
        } else if (returnTypes.includes("std::string")) {
          resolvedReturnType = "std::string";
        } else if (returnTypes.length > 0) {
          resolvedReturnType = returnTypes[0];
        }
      } else {
        resolvedReturnType = inferExprCppType(fnExpression.body, functionReturnTypes, localVariableTypes, sourceText);
      }
    }

    const isAsync = fnExpression.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
    if (isAsync) {
      boilerplates.add("async_stub");
      diagnostics.push(
        makeDiagnostic(
          sourceText,
          declaration.pos,
          "Async function encountered. Added async compatibility boilerplate stub; semantics are approximate.",
          "warning",
          "TS2CPP_ASYNC_STUB",
        ),
      );
    }

    const sourceSpanTarget = fnExpression.name ?? declaration;
    results.push({
      originalName: declaration.name.text,
      isAsync,
      returnType: resolvedReturnType === "auto" ? "void" : resolvedReturnType,
      sourceSpan: makeSourceSpan(sourceSpanTarget, fileName, sourceText),
      leadingComments: commentsAssigned ? [] : declarationComments.leadingComments,
      trailingComments: commentsAssigned ? [] : declarationComments.trailingComments,
      parameters,
      statements: bodyStatements,
    });

    functionReturnTypes.set(declaration.name.text, resolvedReturnType === "auto" ? "void" : resolvedReturnType);
    commentsAssigned = true;
  }

  return results;
}
