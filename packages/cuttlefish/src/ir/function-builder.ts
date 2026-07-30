import ts from "typescript";
import { Diagnostic, SourceSpan } from "../types.js";
import {
  FunctionIR,
  ParameterIR,
  StatementIR,
  ClassFieldIR,
  ClassMethodIR,
  ClassGetterIR,
  ClassSetterIR,
  CppType,
  ExpressionIR,
} from "../api/index.js";
import { extractNodeComments, makeDiagnostic, makeSourceSpan } from "./ast-node-utils.js";
import {
  collectReturns,
  CppTypeHint,
  inferExprCppType,
  typeNodeToCppType,
  extractOwnershipKindFromTypeNode,
  resolveFunctionReturnType,
  resolveFunctionTypeSignature,
  resolveAliasedTypeNode,
} from "./type-resolution.js";
import { parsedIsPointer } from "../api/shared/cpp-type-ir.js";
import { expressionToIR } from "./expression-to-ir.js";
import {
  PointerTracker,
  hoistedNestedFunctions,
  hoistedNestedClasses,
  nestedClassAliases,
  nestedFunctionAliases,
  restParamFunctions,
} from "./build-ir-state.js";
import { getCurrentIrTypeScope } from "./symbol-types.js";
import { renderExprAsText } from "./render-expr.js";

type DestructuredParamResult = {
  syntheticParam: ParameterIR;
  extractionStatements: StatementIR[];
  localVariableTypes: Map<string, CppTypeHint>;
};

function processDestructuredParameter(
  parameter: ts.ParameterDeclaration,
  typeAliasNodes: Map<string, ts.TypeNode>,
  sourceText: string,
  diagnostics: Diagnostic[],
  paramIndex: number,
): DestructuredParamResult | null {
  const paramType = typeNodeToCppType(parameter.type, typeAliasNodes) || "auto";
  const syntheticName = `__param_${paramIndex}`;
  const ownershipKind = extractOwnershipKindFromTypeNode(parameter.type, typeAliasNodes);
  
  const syntheticParam: ParameterIR = {
    name: syntheticName,
    cppType: (paramType === "void" ? "auto" : paramType) as Exclude<CppTypeHint, "void">,
    isRest: !!parameter.dotDotDotToken,
    ...(ownershipKind ? { ownershipKind } : {}),
  };
  
  const localVariableTypes = new Map<string, CppTypeHint>();
  const extractionStatements: StatementIR[] = [];
  const isPointer = parsedIsPointer(paramType);
  const accessor = isPointer ? "->" : ".";
  
  const processBindingElement = (element: ts.BindingElement, prefix: string): void => {
    if (ts.isIdentifier(element.name)) {
      const varName = element.name.text;
      const propName = element.propertyName && ts.isIdentifier(element.propertyName) 
        ? element.propertyName.text 
        : varName;
      const accessExpr: ExpressionIR = { kind: "raw", value: `${prefix}${accessor}${propName}` };
      const initializer: ExpressionIR = element.initializer
        ? { kind: "raw", value: `cuttlefish_nullish(${prefix}${accessor}${propName}, ${renderExprAsText(expressionToIR(element.initializer, sourceText, diagnostics))})` }
        : accessExpr;
      extractionStatements.push({
        kind: "var_decl",
        sourceSpan: makeSourceSpan(element, sourceText, sourceText),
        leadingComments: [],
        trailingComments: [],
        name: varName,
        storage: "const",
        cppType: "auto",
        initializer,
      });
      localVariableTypes.set(varName, "auto");
    } else if (ts.isObjectBindingPattern(element.name)) {
      const propName = element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : null;
      const newPrefix = propName ? `${prefix}${accessor}${propName}` : prefix;
      for (const nested of element.name.elements) {
        if (ts.isBindingElement(nested) && ts.isIdentifier(nested.name)) {
          const nestedVarName = nested.name.text;
          const nestedPropName = nested.propertyName && ts.isIdentifier(nested.propertyName)
            ? nested.propertyName.text
            : nestedVarName;
          const nestedAccess = `${newPrefix}${accessor}${nestedPropName}`;
          const nestedInitializer: ExpressionIR = nested.initializer
            ? { kind: "raw", value: `cuttlefish_nullish(${nestedAccess}, ${renderExprAsText(expressionToIR(nested.initializer, sourceText, diagnostics))})` }
            : { kind: "raw", value: nestedAccess };
          extractionStatements.push({
            kind: "var_decl",
            sourceSpan: makeSourceSpan(nested, sourceText, sourceText),
            leadingComments: [],
            trailingComments: [],
            name: nestedVarName,
            storage: "const",
            cppType: "auto",
            initializer: nestedInitializer,
          });
          localVariableTypes.set(nestedVarName, "auto");
        }
      }
    }
  };
  
  const bindingPattern = parameter.name;
  if (ts.isObjectBindingPattern(bindingPattern)) {
    for (const element of bindingPattern.elements) {
      if (ts.isBindingElement(element)) {
        processBindingElement(element, syntheticName);
      }
    }
  } else if (ts.isArrayBindingPattern(bindingPattern)) {
    for (let i = 0; i < bindingPattern.elements.length; i++) {
      const element = bindingPattern.elements[i];
      if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
        const varName = element.name.text;
        const accessExpr: ExpressionIR = { kind: "raw", value: `${syntheticName}[${i}]` };
        const initializer: ExpressionIR = element.initializer
          ? { kind: "raw", value: `cuttlefish_nullish(${syntheticName}[${i}], ${renderExprAsText(expressionToIR(element.initializer, sourceText, diagnostics))})` }
          : accessExpr;
        extractionStatements.push({
          kind: "var_decl",
          sourceSpan: makeSourceSpan(element, sourceText, sourceText),
          leadingComments: [],
          trailingComments: [],
          name: varName,
          storage: "const",
          cppType: "auto",
          initializer,
        });
        localVariableTypes.set(varName, "auto");
      }
    }
  }
  
  return {
    syntheticParam,
    extractionStatements,
    localVariableTypes,
  };
}

export type LowerStatementListFn = (
  statements: readonly ts.Statement[] | ts.NodeArray<ts.Statement>,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  functionNameForDiagnostics: string,
  typeAliases?: Map<string, ts.TypeNode>,
  pointerVars?: PointerTracker,
) => StatementIR[];

export function functionDeclarationToIR(
  node: ts.FunctionDeclaration,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  typeAliasNodes: Map<string, ts.TypeNode>,
  boilerplates: Set<string>,
  pointerVars: PointerTracker = new Map(),
  lowerStatementList: LowerStatementListFn,
): FunctionIR | undefined {
  // Skip overload signatures (declarations without a body).
  if (!node.body) return undefined;

  if (!node.name) {
    diagnostics.push(makeDiagnostic(sourceText, node.pos, "Anonymous function declaration is unsupported.", "warning"));
    return undefined;
  }

  const isAsync = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
  const isGenerator = !!(node as any).asteriskToken;
  const isExported = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  if (isAsync) {
    boilerplates.add("async_stub");
  }

  const localVariableTypes = new Map<string, CppTypeHint>();
  const parameters: ParameterIR[] = [];
  const destructuredParamStatements: StatementIR[] = [];

  for (let paramIndex = 0; paramIndex < node.parameters.length; paramIndex++) {
    const parameter = node.parameters[paramIndex];
    if (ts.isIdentifier(parameter.name)) {
      const parameterType = typeNodeToCppType(parameter.type, typeAliasNodes);
      const paramOwnershipKind = extractOwnershipKindFromTypeNode(parameter.type, typeAliasNodes);
      localVariableTypes.set(parameter.name.text, parameterType as CppTypeHint);
      parameters.push({
        name: parameter.name.text,
        cppType: (parameterType === "void" ? "auto" : parameterType) as Exclude<CppTypeHint, "void">,
        defaultValue: parameter.initializer
          ? expressionToIR(parameter.initializer, sourceText, diagnostics, pointerVars)
          : undefined,
        isRest: !!parameter.dotDotDotToken,
        ...(paramOwnershipKind ? { ownershipKind: paramOwnershipKind } : {}),
      });
    } else if (ts.isObjectBindingPattern(parameter.name) || ts.isArrayBindingPattern(parameter.name)) {
      const result = processDestructuredParameter(parameter, typeAliasNodes, sourceText, diagnostics, paramIndex);
      if (result) {
        parameters.push(result.syntheticParam);
        destructuredParamStatements.push(...result.extractionStatements);
        result.localVariableTypes.forEach((v, k) => localVariableTypes.set(k, v));
      }
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
    pointerVars,
  );

  const statements = destructuredParamStatements.length > 0
    ? [...destructuredParamStatements, ...bodyStatements]
    : bodyStatements;

  const fnTypeParams = node.typeParameters
    ? node.typeParameters.map(tp => tp.name.text)
    : undefined;

  const restParam = parameters.find(p => p.isRest);
  if (restParam && restParam.cppType.includes("std::vector<")) {
    const elementType = restParam.cppType.replace(/^(?:const\s+)?std::vector<(.+)>&?$/, "$1");
    restParamFunctions.set(node.name.text, elementType);
  }

  const fnDecorators = extractAsilFromComments(node, sourceText);

  return {
    originalName: node.name.text,
    isAsync,
    returnType: resolveFunctionReturnType(node.name.text, functionReturnTypes),
    sourceSpan: makeSourceSpan(node, fileName, sourceText),
    ...extractNodeComments(node, sourceText),
    parameters,
    statements,
    ...(fnTypeParams && fnTypeParams.length > 0 ? { typeParameters: fnTypeParams } : {}),
    ...(isGenerator ? { isGenerator: true } : {}),
    ...(isExported ? { isExported: true } : {}),
    ...(fnDecorators && fnDecorators.length > 0 ? { decorators: fnDecorators } : {}),
  };
}

/** Extract ASIL annotations from leading comments (e.g. `// @asilD`).
 *
 *  Uses comment-based annotations instead of TypeScript decorators because
 *  TS decorators on function declarations produce TS1206 errors in the VS Code
 *  language server and the @typescript-eslint/parser (both reject decorators
 *  on functions — only class/method/property decorators are supported).
 *  Comment annotations are valid TypeScript in any context, any editor, and
 *  any toolchain — no false-positive errors. */
function extractAsilFromComments(node: ts.Node, sourceText: string): string[] | undefined {
  const comments = extractNodeComments(node, sourceText);
  const names: string[] = [];
  for (const comment of comments.leadingComments) {
    // Match `// @asilD`, `// @asilC`, `// @asilB`, `// @asilA`, `// @asilQM`
    const match = comment.match(/@(asil[DCBAQM])/i);
    if (match) {
      names.push(match[1]);
    }
  }
  return names.length > 0 ? names : undefined;
}

export function variableAsFunctionToIR(
  node: ts.VariableStatement,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  typeAliasNodes: Map<string, ts.TypeNode>,
  boilerplates: Set<string>,
  pointerVars: PointerTracker = new Map(),
  lowerStatementList: LowerStatementListFn,
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
  const isExported = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
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
    const destructuredParamStatements: StatementIR[] = [];

    for (let index = 0; index < fnExpression.parameters.length; index++) {
      const parameter = fnExpression.parameters[index];
      if (ts.isIdentifier(parameter.name)) {
        const explicitParameterType = typeNodeToCppType(parameter.type, typeAliasNodes);
        const aliasedParameterType = signatureFromAlias?.parameterTypes[index] ?? "auto";
        const parameterType = explicitParameterType !== "auto" ? explicitParameterType : aliasedParameterType;

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
      } else if (ts.isObjectBindingPattern(parameter.name) || ts.isArrayBindingPattern(parameter.name)) {
        const result = processDestructuredParameter(parameter, typeAliasNodes, sourceText, diagnostics, index);
        if (result) {
          parameters.push(result.syntheticParam);
          destructuredParamStatements.push(...result.extractionStatements);
          result.localVariableTypes.forEach((v, k) => localVariableTypes.set(k, v));
        }
      }
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
          pointerVars,
        )
      : [
          {
            kind: "return" as const,
            sourceSpan: makeSourceSpan(fnExpression.body, fileName, sourceText),
            value: expressionToIR(fnExpression.body, sourceText, diagnostics, pointerVars),
          },
        ];

    const statements = destructuredParamStatements.length > 0
      ? [...destructuredParamStatements, ...bodyStatements]
      : bodyStatements;

    const explicitReturnType = typeNodeToCppType(fnExpression.type, typeAliasNodes);
    let resolvedReturnType: CppTypeHint = explicitReturnType;

    if (resolvedReturnType === "auto" && signatureFromAlias && signatureFromAlias.returnType !== "auto") {
      resolvedReturnType = signatureFromAlias.returnType;
    }

    // Promote int → double when the function body returns double/float expressions
    if (resolvedReturnType === "int") {
      if (ts.isBlock(fnExpression.body)) {
        const returnTypes = collectReturns(fnExpression.body)
          .filter((item) => item.expression)
          .map((item) => inferExprCppType(item.expression as ts.Expression, functionReturnTypes, localVariableTypes, sourceText))
          .filter((item) => item !== "auto");
        if (returnTypes.includes("float") || returnTypes.includes("double")) {
          resolvedReturnType = "double";
        }
      } else {
        const inferredBodyType = inferExprCppType(fnExpression.body, functionReturnTypes, localVariableTypes, sourceText);
        if (inferredBodyType === "float" || inferredBodyType === "double") {
          resolvedReturnType = "double";
        }
      }
    }

    if (resolvedReturnType === "auto") {
      if (ts.isBlock(fnExpression.body)) {
        const returnTypes = collectReturns(fnExpression.body)
          .filter((item) => item.expression)
          .map((item) => inferExprCppType(item.expression as ts.Expression, functionReturnTypes, localVariableTypes, sourceText))
          .filter((item) => item !== "auto");

        if (returnTypes.includes("float") || returnTypes.includes("double")) {
          resolvedReturnType = "double";
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
    const isGenerator = !!(fnExpression as any).asteriskToken;
    if (isAsync) {
      boilerplates.add("async_stub");
    }

    const sourceSpanTarget = fnExpression.name ?? declaration;
    const fnIR = {
      originalName: declaration.name.text,
      isAsync,
      returnType: resolvedReturnType === "auto" ? "void" : resolvedReturnType,
      sourceSpan: makeSourceSpan(sourceSpanTarget, fileName, sourceText),
      leadingComments: commentsAssigned ? [] : declarationComments.leadingComments,
      trailingComments: commentsAssigned ? [] : declarationComments.trailingComments,
      parameters,
      statements,
      ...(isGenerator ? { isGenerator: true } : {}),
      ...(isExported ? { isExported: true } : {}),
    };
    results.push(fnIR);

    const restParam = parameters.find(p => p.isRest);
    if (restParam && restParam.cppType.includes("std::vector<")) {
      const elementType = restParam.cppType.replace(/^(?:const\s+)?std::vector<(.+)>&?$/, "$1");
      restParamFunctions.set(declaration.name.text, elementType);
    }

    functionReturnTypes.set(declaration.name.text, resolvedReturnType === "auto" ? "void" : resolvedReturnType);
    commentsAssigned = true;
  }

  return results;
}

/** Convert a TS type constraint to a C++ static_assert expression. */
export function typeConstraintToCppAssert(paramName: string, constraint: ts.TypeNode): string | undefined {
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
export function isReadonlyMappedType(node: ts.TypeNode, typeAliases?: Map<string, ts.TypeNode>): boolean {
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

/**
 * Hoist a nested function declaration to file scope.
 * Creates a mangled name (parent__inner) and registers it in the alias map
 * so that call sites within the parent function get rewritten.
 */
export function hoistNestedFunction(
  statement: ts.FunctionDeclaration,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  parentFunctionName: string,
  typeAliases: Map<string, ts.TypeNode> | undefined,
  pointerVars: PointerTracker,
  lowerStatementList: LowerStatementListFn,
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
  const destructuredParamStatements: StatementIR[] = [];

  for (let paramIndex = 0; paramIndex < statement.parameters.length; paramIndex++) {
    const parameter = statement.parameters[paramIndex];
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
        isRest: !!parameter.dotDotDotToken,
        ...(paramOwnershipKind ? { ownershipKind: paramOwnershipKind } : {}),
      });
    } else if (ts.isObjectBindingPattern(parameter.name) || ts.isArrayBindingPattern(parameter.name)) {
      const result = processDestructuredParameter(parameter, typeAliases ?? new Map(), sourceText, diagnostics, paramIndex);
      if (result) {
        parameters.push(result.syntheticParam);
        destructuredParamStatements.push(...result.extractionStatements);
        result.localVariableTypes.forEach((v, k) => localVariableTypes.set(k, v));
      }
    }
  }

  // Lower the body — recursive call to lowerStatementListCallback
  const bodyStatements = lowerStatementList(
    statement.body?.statements ?? [],
    fileName,
    sourceText,
    diagnostics,
    functionReturnTypes,
    localVariableTypes,
    mangledName,
    typeAliases,
    pointerVars,
  );

  const statements = destructuredParamStatements.length > 0
    ? [...destructuredParamStatements, ...bodyStatements]
    : bodyStatements;

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
    statements,
    ...(typeParams && typeParams.length > 0 ? { typeParameters: typeParams } : {}),
    ...(constraints.size > 0 ? { typeParameterConstraints: constraints } : {}),
    ...(isReadonlyReturnType ? { isReadonlyReturnType: true } : {}),
  });
}

export function hoistNestedClass(
  node: ts.ClassDeclaration,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  functionNameForDiagnostics: string,
  typeAliases: Map<string, ts.TypeNode> | undefined,
  pointerVars: PointerTracker = new Map(),
  lowerStatementList: LowerStatementListFn,
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
    if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const fType = typeNodeToCppType(member.type, typeAliases);
      getCurrentIrTypeScope()?.classFields.set(`this->${member.name.text}`, fType);
    }
  }

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
            isRest: !!param.dotDotDotToken,
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
            isRest: !!param.dotDotDotToken,
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
        ...(member.typeParameters && member.typeParameters.length > 0
          ? { typeParameters: member.typeParameters.map(tp => tp.name.text) }
          : {}),
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
