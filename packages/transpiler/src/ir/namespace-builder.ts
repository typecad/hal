import ts from "typescript";
import { Diagnostic } from "../types";
import { CppType, ExpressionIR, FunctionIR, NamespaceIR, ParameterIR } from "@typehal/core";
import { extractNodeComments, makeSourceSpan } from "./ast-node-utils";
import { CppTypeHint, typeNodeToCppType, extractOwnershipKindFromTypeNode, resolveFunctionReturnType } from "./type-resolution";
import { expressionToIR } from "./expression-to-ir";
import { lowerStatementList } from "./statement-to-ir";
import { classDeclarationToIR, enumDeclarationToIR, interfaceDeclarationToIR, typeAliasDeclarationToIR } from "./declaration-builders";
import { RegisterClassIR } from "@typehal/core";

export function namespaceToIR(
  node: ts.ModuleDeclaration,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  typeAliasNodes: Map<string, ts.TypeNode>,
  registerClasses: RegisterClassIR[],
): NamespaceIR | undefined {
  if (!node.name || !ts.isIdentifier(node.name)) {
    return undefined;
  }

  if (!node.body || !ts.isModuleBlock(node.body)) {
    return undefined;
  }

  const namespaceComments = extractNodeComments(node, sourceText);
  const namespaceName = node.name.text;

  const nsEnums: NamespaceIR['enums'] = [];
  const nsClasses: NamespaceIR['classes'] = [];
  const nsInterfaces: NamespaceIR['interfaces'] = [];
  const nsTypeAliases: NamespaceIR['typeAliases'] = [];
  const nsFunctions: FunctionIR[] = [];
  const nsConstants: { name: string; cppType: CppType; value: ExpressionIR }[] = [];

  for (const nsNode of node.body.statements) {
    // Handle nested namespaces (skip for now - could be recursive)
    if (ts.isModuleDeclaration(nsNode)) {
      continue;
    }

    // Handle enums in namespace
    if (ts.isEnumDeclaration(nsNode) && nsNode.name) {
      const enumIR = enumDeclarationToIR(nsNode, fileName, sourceText);
      if (enumIR) {
        nsEnums.push(enumIR);
      }
      continue;
    }

    // Handle classes in namespace
    if (ts.isClassDeclaration(nsNode) && nsNode.name) {
      const classIR = classDeclarationToIR(
        nsNode,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        typeAliasNodes,
        registerClasses,
        namespaceName,
      );
      if (classIR) {
        nsClasses.push(classIR);
      }
      continue;
    }

    // Handle interfaces in namespace
    if (ts.isInterfaceDeclaration(nsNode) && nsNode.name) {
      const ifaceIR = interfaceDeclarationToIR(nsNode, fileName, sourceText, typeAliasNodes);
      if (ifaceIR) {
        nsInterfaces.push(ifaceIR);
      }
      continue;
    }

    // Handle type aliases in namespace
    if (ts.isTypeAliasDeclaration(nsNode)) {
      const aliasIR = typeAliasDeclarationToIR(nsNode, fileName, sourceText, typeAliasNodes);
      if (aliasIR) {
        nsTypeAliases.push(aliasIR);
      }
      continue;
    }

    // Handle functions in namespace
    if (ts.isFunctionDeclaration(nsNode) && nsNode.name) {
      const fnComments = extractNodeComments(nsNode, sourceText);
      const isAsync = nsNode.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false;

      const localVariableTypes = new Map<string, CppTypeHint>();
      const parameters: ParameterIR[] = [];

      for (const parameter of nsNode.parameters) {
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
        nsNode.body?.statements ?? [],
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        localVariableTypes,
        `${namespaceName}.${nsNode.name.text}`,
        typeAliasNodes,
      );

      const nsFnTypeParams = nsNode.typeParameters
        ? nsNode.typeParameters.map(tp => tp.name.text)
        : undefined;
      const nsFnReturnType = nsNode.type
        ? typeNodeToCppType(nsNode.type, typeAliasNodes)
        : resolveFunctionReturnType(nsNode.name.text, functionReturnTypes);
      nsFunctions.push({
        originalName: nsNode.name.text,
        isAsync,
        returnType: nsFnReturnType,
        sourceSpan: makeSourceSpan(nsNode, fileName, sourceText),
        leadingComments: fnComments.leadingComments,
        trailingComments: fnComments.trailingComments,
        parameters,
        statements: bodyStatements,
        ...(nsFnTypeParams && nsFnTypeParams.length > 0 ? { typeParameters: nsFnTypeParams } : {}),
      });
      continue;
    }

    // Handle const variables in namespace
    if (ts.isVariableStatement(nsNode)) {
      for (const decl of nsNode.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          const constType = typeNodeToCppType(decl.type, typeAliasNodes);
          nsConstants.push({
            name: decl.name.text,
            cppType: constType,
            value: expressionToIR(decl.initializer, sourceText, diagnostics),
          });
        }
      }
      continue;
    }
  }

  return {
    name: namespaceName,
    sourceSpan: makeSourceSpan(node, fileName, sourceText),
    leadingComments: namespaceComments.leadingComments,
    trailingComments: namespaceComments.trailingComments,
    enums: nsEnums,
    classes: nsClasses,
    interfaces: nsInterfaces,
    typeAliases: nsTypeAliases,
    functions: nsFunctions,
    constants: nsConstants,
  };
}
