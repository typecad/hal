import ts from "typescript";
import { Diagnostic } from "../types.js";
import { CppType, ExpressionIR, FunctionIR, NamespaceIR, ParameterIR } from "../api/index.js";
import { extractNodeComments, makeSourceSpan } from "./ast-node-utils.js";
import { CppTypeHint, typeNodeToCppType, extractOwnershipKindFromTypeNode, resolveFunctionReturnType } from "./type-resolution.js";
import { expressionToIR } from "./expression-to-ir.js";
import { lowerStatementList } from "./statement-to-ir.js";
import { classDeclarationToIR, enumDeclarationToIR, interfaceDeclarationToIR, typeAliasDeclarationToIR } from "./declaration-builders.js";
import { RegisterClassIR } from "../api/index.js";
import { PointerTracker } from "./build-ir-state.js";

export function namespaceToIR(
  node: ts.ModuleDeclaration,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  typeAliasNodes: Map<string, ts.TypeNode>,
  registerClasses: RegisterClassIR[],
  pointerVars: PointerTracker = new Map(),
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
  const nsConstants: { name: string; cppType: CppType; value: ExpressionIR; storage?: "const" | "let" | "var" }[] = [];
  const nsAssignments: { target: string; value: ExpressionIR }[] = [];

  const nsChildren: NamespaceIR[] = [];

  for (const nsNode of node.body.statements) {
    if (ts.isModuleDeclaration(nsNode)) {
      const childNs = namespaceToIR(nsNode, fileName, sourceText, diagnostics, functionReturnTypes, typeAliasNodes, registerClasses, pointerVars);
      if (childNs) {
        nsChildren.push(childNs);
      }
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
        pointerVars,
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
      const isGenerator = !!(nsNode as any).asteriskToken;

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
              ? expressionToIR(parameter.initializer, sourceText, diagnostics, pointerVars)
              : undefined,
            isRest: !!parameter.dotDotDotToken,
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
        pointerVars,
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
        ...(isGenerator ? { isGenerator: true } : {}),
      });
      continue;
    }

    if (ts.isVariableStatement(nsNode)) {
      const storage: "const" | "let" | "var" =
        nsNode.declarationList.flags & ts.NodeFlags.Const
          ? "const"
          : nsNode.declarationList.flags & ts.NodeFlags.Let
            ? "let"
            : "var";
      for (const decl of nsNode.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          const constType = typeNodeToCppType(decl.type, typeAliasNodes);
          nsConstants.push({
            name: decl.name.text,
            cppType: constType,
            value: expressionToIR(decl.initializer, sourceText, diagnostics, pointerVars),
            storage,
          });
        }
      }
      continue;
    }

    if (ts.isExpressionStatement(nsNode) && ts.isBinaryExpression(nsNode.expression)) {
      const expr = nsNode.expression;
      if (expr.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(expr.left)) {
        nsAssignments.push({
          target: expr.left.text,
          value: expressionToIR(expr.right, sourceText, diagnostics, pointerVars),
        });
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
    ...(nsAssignments.length > 0 ? { assignments: nsAssignments } : {}),
    ...(nsChildren.length > 0 ? { children: nsChildren } : {}),
  };
}
