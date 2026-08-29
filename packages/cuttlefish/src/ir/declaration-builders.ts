import ts from "typescript";
import { Diagnostic } from "../types.js";
import { CppType, ClassIR, ClassFieldIR, ClassMethodIR, ClassGetterIR, ClassSetterIR, EnumIR, ExpressionIR, InterfaceIR, ParameterIR, RegisterClassIR, StatementIR, TypeAliasIR } from "../api/index.js";
import { extractNodeComments, makeSourceSpan } from "./ast-node-utils.js";
import { CppTypeHint, typeNodeToCppType, extractOwnershipKindFromTypeNode } from "./type-resolution.js";
import { getBitsRange, getRegisterAddress } from "./register-decorators.js";
import { registerFieldMap, PointerTracker, setActiveExtendsClass, discriminatedUnionVariantNames, requiredIncludes } from "./build-ir-state.js";
import { getCurrentIrTypeScope } from "./symbol-types.js";
import { expressionToIR } from "./expression-to-ir.js";
import { lowerStatementList } from "./statement-to-ir.js";

/**
 * Format an `ExpressionWithTypeArguments` (a heritage-clause type) as a C++
 * base-class specifier, resolving each type argument through `typeNodeToCppType`.
 * `extends Registry<string, number>` → `Registry<std::string, double>`.
 * Without this, `.expression.getText()` drops the type arguments and leaves
 * the base as an unsubstituted template.
 */
function formatHeritageType(
  heritage: ts.ExpressionWithTypeArguments,
  typeAliasNodes: Map<string, ts.TypeNode>,
): string | undefined {
  const baseName = heritage.expression.getText();
  if (!heritage.typeArguments || heritage.typeArguments.length === 0) {
    return baseName;
  }
  const args = heritage.typeArguments.map(ta => typeNodeToCppType(ta, typeAliasNodes));
  return `${baseName}<${args.join(", ")}>`;
}

export function classDeclarationToIR(
  node: ts.ClassDeclaration,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  typeAliasNodes: Map<string, ts.TypeNode>,
  registerClasses: RegisterClassIR[],
  pointerVars: PointerTracker = new Map(),
  scopePrefix?: string,
): ClassIR | undefined {
  if (!node.name) {
    return undefined;
  }

  const className = node.name.text;

  const regAddr = getRegisterAddress(node);
  if (regAddr !== undefined) {
    const classComments = extractNodeComments(node, sourceText);
    const bitFields: RegisterClassIR['bitFields'] = [];
    for (const member of node.members) {
      if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
        const range = getBitsRange(member);
        if (range) {
          bitFields.push({
            name: member.name.text,
            hi: range.hi,
            lo: range.lo,
            width: range.hi - range.lo + 1,
          });
        }
      }
    }
    const regIR: RegisterClassIR = {
      name: className,
      address: regAddr,
      bitFields,
      sourceSpan: makeSourceSpan(node, fileName, sourceText),
      leadingComments: classComments.leadingComments,
      trailingComments: classComments.trailingComments,
    };
    registerClasses.push(regIR);
    const fieldMap = new Map<string, { hi: number; lo: number; width: number }>();
    for (const bf of bitFields) {
      fieldMap.set(bf.name, { hi: bf.hi, lo: bf.lo, width: bf.width });
    }
    registerFieldMap.set(className, fieldMap);
    return undefined;
  }

  const isAbstract = node.modifiers?.some(m => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;

  // Render the extends-clause type, INCLUDING type arguments, so a subclass of
  // a generic base (`extends Registry<string, number>`) lowers to
  // `: public Registry<std::string, double>` rather than dropping the
  // instantiation (which would leave the base as an unsubstituted template).
  const extendsHeritage = node.heritageClauses
    ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
    ?.types[0];
  const extendsClass = extendsHeritage ? formatHeritageType(extendsHeritage, typeAliasNodes) : undefined;

  const implementsInterfaces = node.heritageClauses
    ?.find((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword)
    ?.types.map(t => t.expression?.getText())
    .filter((name): name is string => name !== undefined);

  const classComments = extractNodeComments(node, sourceText);
  const fields: ClassFieldIR[] = [];
  const methods: ClassMethodIR[] = [];
  const getters: ClassGetterIR[] = [];
  const setters: ClassSetterIR[] = [];
  let ctor: { parameters: ParameterIR[]; statements: StatementIR[] } | undefined;

  const qualifiedName = scopePrefix ? `${scopePrefix}.${className}` : className;
  const staticBlockStatements: StatementIR[] = [];

  const preScannedFieldTypes = new Map<string, CppTypeHint>();
  for (const member of node.members) {
    if (ts.isPropertyDeclaration(member) && member.name) {
      const fName = ts.isIdentifier(member.name) ? member.name.text
        : member.name.kind === ts.SyntaxKind.PrivateIdentifier ? `__priv_${member.name.text.substring(1)}` : null;
      if (fName) {
        const fType = typeNodeToCppType(member.type, typeAliasNodes);
        preScannedFieldTypes.set(`this->${fName}`, fType);
        getCurrentIrTypeScope()?.classFields.set(`this->${fName}`, fType);
      }
    }
  }

  for (const member of node.members) {
    if ((ts as any).isClassStaticBlockDeclaration?.(member) || member.kind === (ts.SyntaxKind as any).ClassStaticBlockDeclaration) {
      const block = member as unknown as { body: ts.Block };
      if (block.body) {
        const stmts = lowerStatementList(
          block.body.statements,
          fileName,
          sourceText,
          diagnostics,
          functionReturnTypes,
          new Map(),
          `${qualifiedName}.staticBlock`,
          typeAliasNodes,
          pointerVars,
        );
        staticBlockStatements.push(...stmts);
      }
      continue;
    }

    if (ts.isConstructorDeclaration(member)) {
      const ctorParams: ParameterIR[] = [];
      const ctorLocalTypes = new Map<string, CppTypeHint>();
      const paramPropertyNames: string[] = [];

      for (const param of member.parameters) {
        if (ts.isIdentifier(param.name)) {
          const paramType = typeNodeToCppType(param.type, typeAliasNodes);
          ctorLocalTypes.set(param.name.text, paramType);
          const paramOwnershipKind = extractOwnershipKindFromTypeNode(param.type, typeAliasNodes);
          ctorParams.push({
            name: param.name.text,
            cppType: (paramType === "void" ? "auto" : paramType) as Exclude<CppTypeHint, "void">,
            defaultValue: param.initializer
              ? expressionToIR(param.initializer, sourceText, diagnostics, pointerVars)
              : undefined,
            isRest: !!param.dotDotDotToken,
            ...(paramOwnershipKind ? { ownershipKind: paramOwnershipKind } : {}),
          });

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
                ? expressionToIR(param.initializer, sourceText, diagnostics, pointerVars)
                : undefined,
            });
            paramPropertyNames.push(param.name.text);
          }
        }
      }

      const ctorBody = member.body
        ? lowerStatementList(
            member.body.statements,
            fileName,
            sourceText,
            diagnostics,
            functionReturnTypes,
            ctorLocalTypes,
            `${qualifiedName}.constructor`,
            typeAliasNodes,
            pointerVars,
          )
        : [];

      const syntheticSpan = { filePath: fileName, startOffset: 0, endOffset: 0, startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 };
      const paramPropertyAssignments: StatementIR[] = paramPropertyNames.map(name => ({
        kind: "assign" as const,
        sourceSpan: syntheticSpan,
        target: `this->${name}`,
        operator: "=" as const,
        value: { kind: "identifier" as const, value: name },
      }));

      ctor = { parameters: ctorParams, statements: [...paramPropertyAssignments, ...ctorBody, ...staticBlockStatements] };
      continue;
    }

    if (ts.isPropertyDeclaration(member) && member.name) {
      if (member.modifiers?.some(m => m.kind === ts.SyntaxKind.AbstractKeyword)) {
        continue;
      }

      let fieldName: string;
      let fieldVisibility: "public" | "private" | "protected";
      if (member.name.kind === ts.SyntaxKind.PrivateIdentifier) {
        fieldName = `__priv_${member.name.text.substring(1)}`;
        fieldVisibility = "private";
      } else if (ts.isIdentifier(member.name)) {
        fieldName = member.name.text;
        fieldVisibility = member.modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)
          ? "private"
          : member.modifiers?.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)
            ? "protected"
            : "public";
      } else {
        continue;
      }

      const fieldType = typeNodeToCppType(member.type, typeAliasNodes);

      fields.push({
        name: fieldName,
        cppType: (fieldType === "void" ? "auto" : fieldType) as CppType,
        visibility: fieldVisibility,
        initializer: member.initializer
          ? expressionToIR(member.initializer, sourceText, diagnostics, pointerVars)
          : undefined,
        isStatic: member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) ?? false,
      });
      continue;
    }

    if (ts.isMethodDeclaration(member) && member.name) {
      let methodName: string;
      let methodVisibility: "public" | "private" | "protected";
      if (member.name.kind === ts.SyntaxKind.PrivateIdentifier) {
        methodName = `__priv_${member.name.text.substring(1)}`;
        methodVisibility = "private";
      } else if (ts.isIdentifier(member.name)) {
        methodName = member.name.text;
        methodVisibility = member.modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)
          ? "private"
          : member.modifiers?.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)
            ? "protected"
            : "public";
      } else {
        continue;
      }

      const isStatic = member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
      const isMethodAbstract = member.modifiers?.some(m => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;
      const isOverride = member.modifiers?.some(m => m.kind === ts.SyntaxKind.OverrideKeyword) ?? false;

      if (extendsClass && !isStatic) {
        setActiveExtendsClass(extendsClass);
      }

      // Resolve this method's declared return type and register it under the
      // same qualified key used as functionNameForDiagnostics below, so that
      // return statements inside the body get the enclosing return type
      // annotated on the ReturnIR (used by the emitter to lower
      // `return null`/`undefined` to `return {};` for struct returns — demo
      // #14 Finding A). Top-level functions get this via buildFunctionReturnTypeMap;
      // methods do not, so we add it here.
      const methodQualifiedKey = `${qualifiedName}.${methodName}`;
      const preMethodReturnType = typeNodeToCppType(member.type, typeAliasNodes);
      if (preMethodReturnType && preMethodReturnType !== "void") {
        functionReturnTypes.set(methodQualifiedKey, preMethodReturnType);
      }

      const methodParams: ParameterIR[] = [];
      const methodLocalTypes = new Map<string, CppTypeHint>(preScannedFieldTypes);

      for (const param of member.parameters) {
        if (ts.isIdentifier(param.name)) {
          const paramType = typeNodeToCppType(param.type, typeAliasNodes);
          methodLocalTypes.set(param.name.text, paramType);
          const paramOwnershipKind = extractOwnershipKindFromTypeNode(param.type, typeAliasNodes);
          methodParams.push({
            name: param.name.text,
            cppType: (paramType === "void" ? "auto" : paramType) as Exclude<CppTypeHint, "void">,
            defaultValue: param.initializer
              ? expressionToIR(param.initializer, sourceText, diagnostics, pointerVars)
              : undefined,
            isRest: !!param.dotDotDotToken,
            ...(paramOwnershipKind ? { ownershipKind: paramOwnershipKind } : {}),
          });
        }
      }

      const methodBody = member.body
        ? lowerStatementList(
            member.body.statements,
            fileName,
            sourceText,
            diagnostics,
            functionReturnTypes,
            methodLocalTypes,
            `${qualifiedName}.${methodName}`,
            typeAliasNodes,
            pointerVars,
          )
        : [];
      const methodReturnType = typeNodeToCppType(member.type, typeAliasNodes);

      setActiveExtendsClass(undefined);

      methods.push({
        name: methodName,
        returnType: (
          member.type?.kind === ts.SyntaxKind.ThisType
            ? `${className}*`
            : (methodReturnType === className ? `${className}*` : (methodReturnType === "void" ? "void" : methodReturnType))
        ) as CppType,
        parameters: methodParams,
        statements: methodBody,
        visibility: methodVisibility,
        isStatic,
        isAbstract: isMethodAbstract,
        isAsync: member.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
        isOverride,
        ...(member.typeParameters && member.typeParameters.length > 0
          ? { typeParameters: member.typeParameters.map(tp => tp.name.text) }
          : {}),
      });
    }

    if (ts.isGetAccessorDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const visibility: "public" | "private" | "protected" = member.modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)
        ? "private"
        : member.modifiers?.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)
          ? "protected"
          : "public";

      if (extendsClass) {
        const isStatic = member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
        if (!isStatic) setActiveExtendsClass(extendsClass);
      }

      const accessorLocalTypes = new Map<string, CppTypeHint>();
      const accessorBody = member.body
        ? lowerStatementList(
            member.body.statements,
            fileName,
            sourceText,
            diagnostics,
            functionReturnTypes,
            accessorLocalTypes,
            `${qualifiedName}.get:${member.name.text}`,
            typeAliasNodes,
            pointerVars,
          )
        : [];

      setActiveExtendsClass(undefined);

      getters.push({
        name: member.name.text,
        returnType: typeNodeToCppType(member.type, typeAliasNodes) as CppType,
        statements: accessorBody,
        visibility,
        isStatic: member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) ?? false,
      });
    }

    if (ts.isSetAccessorDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const visibility: "public" | "private" | "protected" = member.modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)
        ? "private"
        : member.modifiers?.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)
          ? "protected"
          : "public";

      const setParams: ParameterIR[] = [];
      const setterLocalTypes = new Map<string, CppTypeHint>();

      for (const param of member.parameters) {
        if (ts.isIdentifier(param.name)) {
          const paramType = typeNodeToCppType(param.type, typeAliasNodes);
          setterLocalTypes.set(param.name.text, paramType);
          setParams.push({
            name: param.name.text,
            cppType: (paramType === "void" ? "auto" : paramType) as Exclude<CppTypeHint, "void">,
            isRest: !!param.dotDotDotToken,
          });
        }
      }

      if (extendsClass) {
        const isStatic = member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
        if (!isStatic) setActiveExtendsClass(extendsClass);
      }

      const accessorBody = member.body
        ? lowerStatementList(
            member.body.statements,
            fileName,
            sourceText,
            diagnostics,
            functionReturnTypes,
            setterLocalTypes,
            `${qualifiedName}.set:${member.name.text}`,
            typeAliasNodes,
            pointerVars,
          )
        : [];

      setActiveExtendsClass(undefined);

      setters.push({
        name: member.name.text,
        parameter: setParams[0] ?? { name: "value", cppType: "auto", isRest: false },
        statements: accessorBody,
        visibility,
        isStatic: member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) ?? false,
      });
    }
  }

  if (!ctor && staticBlockStatements.length > 0) {
    ctor = { parameters: [], statements: [...staticBlockStatements] };
  }

  const classDecorators: string[] | undefined = (node as any).decorators
    ? ((node as any).decorators as any[])
        .map((d: any) => {
          if (d.expression && ts.isIdentifier(d.expression)) return d.expression.text;
          if (d.expression && ts.isCallExpression(d.expression) && ts.isIdentifier(d.expression.expression)) return d.expression.expression.text;
          return undefined;
        })
        .filter((d: any): d is string => d !== undefined)
    : undefined;

  const classTypeParams = node.typeParameters
    ? node.typeParameters.map(tp => tp.name.text)
    : undefined;

  return {
    name: className,
    extendsClass,
    implementsInterfaces,
    isAbstract,
    sourceSpan: makeSourceSpan(node, fileName, sourceText),
    leadingComments: classComments.leadingComments,
    trailingComments: classComments.trailingComments,
    fields,
    methods,
    constructor: ctor,
    getters,
    setters,
    ...(classTypeParams && classTypeParams.length > 0 ? { typeParameters: classTypeParams } : {}),
    ...(classDecorators && classDecorators.length > 0 ? { decorators: classDecorators } : {}),
  };
}

function evaluateConstExpr(
  expr: ts.Expression,
  memberMap: Map<string, number>,
  sourceText: string,
): number | undefined {
  if (ts.isNumericLiteral(expr)) {
    return Number(expr.text);
  }
  if (ts.isPrefixUnaryExpression(expr)) {
    const operand = evaluateConstExpr(expr.operand, memberMap, sourceText);
    if (operand === undefined) return undefined;
    switch (expr.operator) {
      case ts.SyntaxKind.MinusToken: return -operand;
      case ts.SyntaxKind.PlusToken: return +operand;
      case ts.SyntaxKind.TildeToken: return ~operand;
      case ts.SyntaxKind.ExclamationToken: return operand ? 0 : 1;
      default: return undefined;
    }
  }
  if (ts.isBinaryExpression(expr)) {
    const left = evaluateConstExpr(expr.left, memberMap, sourceText);
    const right = evaluateConstExpr(expr.right, memberMap, sourceText);
    if (left === undefined || right === undefined) return undefined;
    switch (expr.operatorToken.kind) {
      case ts.SyntaxKind.PlusToken: return left + right;
      case ts.SyntaxKind.MinusToken: return left - right;
      case ts.SyntaxKind.AsteriskToken: return left * right;
      case ts.SyntaxKind.SlashToken: return Math.trunc(left / right);
      case ts.SyntaxKind.PercentToken: return left % right;
      case ts.SyntaxKind.BarToken: return left | right;
      case ts.SyntaxKind.AmpersandToken: return left & right;
      case ts.SyntaxKind.CaretToken: return left ^ right;
      case ts.SyntaxKind.LessThanLessThanToken: return left << right;
      case ts.SyntaxKind.GreaterThanGreaterThanToken: return left >> right;
      case ts.SyntaxKind.BarBarToken: return left || right;
      case ts.SyntaxKind.AmpersandAmpersandToken: return left && right;
      default: return undefined;
    }
  }
  if (ts.isIdentifier(expr)) {
    return memberMap.get(expr.text);
  }
  if (ts.isPropertyAccessExpression(expr)) {
    if (ts.isIdentifier(expr.expression)) {
      const enumPrefix = expr.expression.text;
      const memberName = expr.name.text;
      const qualifiedKey = `${enumPrefix}.${memberName}`;
      return memberMap.get(qualifiedKey) ?? memberMap.get(memberName);
    }
  }
  if (ts.isParenthesizedExpression(expr)) {
    return evaluateConstExpr(expr.expression, memberMap, sourceText);
  }
  return undefined;
}

export function enumDeclarationToIR(
  node: ts.EnumDeclaration,
  fileName: string,
  sourceText: string,
): EnumIR | undefined {
  if (!node.name) {
    return undefined;
  }

  const enumName = node.name.text;
  const enumComments = extractNodeComments(node, sourceText);
  const isConst = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ConstKeyword) ?? false;
  const members: { name: string; value?: number | string }[] = [];
  const memberMap = new Map<string, number>();

  let nextValue = 0;
  for (const member of node.members) {
    if (ts.isIdentifier(member.name)) {
      let value: number | string | undefined;

      if (member.initializer) {
        value = evaluateConstExpr(member.initializer, memberMap, sourceText);
        if (value === undefined) {
          if (ts.isNumericLiteral(member.initializer)) {
            value = Number(member.initializer.text);
          } else if (ts.isPrefixUnaryExpression(member.initializer) &&
                     member.initializer.operator === ts.SyntaxKind.MinusToken &&
                     ts.isNumericLiteral(member.initializer.operand)) {
            value = -Number((member.initializer.operand as ts.NumericLiteral).text);
          } else if (ts.isStringLiteral(member.initializer)) {
            value = member.initializer.text;
          }
        }
        if (value !== undefined && typeof value === "number") {
          nextValue = value + 1;
        } else {
          nextValue++;
        }
      } else {
        value = nextValue;
        nextValue++;
      }

      if (value !== undefined && typeof value === "number") {
        memberMap.set(member.name.text, value);
        memberMap.set(`${enumName}.${member.name.text}`, value);
      }

      members.push({
        name: member.name.text,
        value,
      });
    }
  }

  return {
    name: node.name.text,
    sourceSpan: makeSourceSpan(node, fileName, sourceText),
    leadingComments: enumComments.leadingComments,
    trailingComments: enumComments.trailingComments,
    members,
    isConst,
  };
}

export function interfaceDeclarationToIR(
  node: ts.InterfaceDeclaration,
  fileName: string,
  sourceText: string,
  typeAliasNodes: Map<string, ts.TypeNode>,
): InterfaceIR | undefined {
  if (!node.name) {
    return undefined;
  }

  const interfaceComments = extractNodeComments(node, sourceText);
  const interfaceName = node.name.text;

  const extendsInterfaces = node.heritageClauses
    ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
    ?.types.map(t => t.expression?.getText())
    .filter((name): name is string => name !== undefined);

  const fields: InterfaceIR['fields'] = [];
  const methods: InterfaceIR['methods'] = [];
  let indexSignature: InterfaceIR['indexSignature'];

  for (const member of node.members) {
    if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
      const propName = member.name.text;
      const isOptional = !!member.questionToken;
      const propType = typeNodeToCppType(member.type, typeAliasNodes);

      fields.push({
        name: propName,
        cppType: propType,
        isOptional,
      });
      continue;
    }

    if (ts.isMethodSignature(member) && member.name && ts.isIdentifier(member.name)) {
      const methodName = member.name.text;
      const returnType = typeNodeToCppType(member.type, typeAliasNodes);
      const params: ParameterIR[] = [];

      for (const param of member.parameters) {
        if (ts.isIdentifier(param.name)) {
          const paramType = typeNodeToCppType(param.type, typeAliasNodes);
          params.push({
            name: param.name.text,
            cppType: (paramType === "void" ? "auto" : paramType) as Exclude<CppTypeHint, "void">,
            isRest: !!param.dotDotDotToken,
          });
        }
      }

      methods.push({
        name: methodName,
        returnType,
        parameters: params,
      });
      continue;
    }

    if (ts.isIndexSignatureDeclaration(member)) {
      let keyType = "string";
      if (member.parameters.length > 0 && ts.isIdentifier(member.parameters[0].name)) {
        const paramType = member.parameters[0].type;
        if (paramType && ts.isTypeNode(paramType)) {
          keyType = typeNodeToCppType(paramType, typeAliasNodes);
        }
      }
      const valueType = typeNodeToCppType(member.type, typeAliasNodes);
      indexSignature = { keyType, valueType };
    }
  }

  return {
    name: interfaceName,
    sourceSpan: makeSourceSpan(node, fileName, sourceText),
    leadingComments: interfaceComments.leadingComments,
    trailingComments: interfaceComments.trailingComments,
    extendsInterfaces,
    fields,
    methods,
    indexSignature,
  };
}

export function typeAliasDeclarationToIR(
  node: ts.TypeAliasDeclaration,
  fileName: string,
  sourceText: string,
  typeAliasNodes: Map<string, ts.TypeNode>,
): TypeAliasIR | undefined {
  const aliasComments = extractNodeComments(node, sourceText);
  const aliasTypeParams = node.typeParameters
    ? node.typeParameters.map(tp => tp.name.text)
    : undefined;

  const resolved = node.type;

  if (ts.isUnionTypeNode(resolved)) {
    const variantStructs = extractDiscriminatedUnionVariants(resolved, typeAliasNodes, node.name.text);
    if (variantStructs) {
      const variantNames = variantStructs.map(v => v.name);
      discriminatedUnionVariantNames.set(node.name.text, variantNames);
      return {
        name: node.name.text,
        sourceSpan: makeSourceSpan(node, fileName, sourceText),
        leadingComments: aliasComments.leadingComments,
        trailingComments: aliasComments.trailingComments,
        cppType: `std::variant<${variantNames.join(", ")}>`,
        variantStructs,
        ...(aliasTypeParams && aliasTypeParams.length > 0 ? { typeParameters: aliasTypeParams } : {}),
      };
      // std::variant requires <variant>; register the include so the header
      // compiles (demo #9 Finding A — was emitting `std::variant<...>` with
      // no include, giving "'variant' is not a member of 'std'").
      if (variantNames.length > 0) {
        requiredIncludes.add("<variant>");
      }
    }
  }

  const cppType = typeNodeToCppType(node.type, typeAliasNodes);

  let structFields;
  if (ts.isTypeLiteralNode(resolved)) {
    structFields = resolved.members
      .filter(ts.isPropertySignature)
      .filter(m => ts.isIdentifier(m.name!))
      .map(m => ({
        name: (m.name as ts.Identifier).text,
        cppType: typeNodeToCppType(m.type, typeAliasNodes),
      }));
  }

  return {
    name: node.name.text,
    sourceSpan: makeSourceSpan(node, fileName, sourceText),
    leadingComments: aliasComments.leadingComments,
    trailingComments: aliasComments.trailingComments,
    cppType,
    structFields,
    ...(aliasTypeParams && aliasTypeParams.length > 0 ? { typeParameters: aliasTypeParams } : {}),
  };
}

function extractDiscriminatedUnionVariants(
  unionNode: ts.UnionTypeNode,
  typeAliasNodes: Map<string, ts.TypeNode>,
  aliasName: string,
): { name: string; fields: { name: string; cppType: string }[] }[] | null {
  const typeLiterals = unionNode.types.filter(ts.isTypeLiteralNode);
  if (typeLiterals.length === 0 || typeLiterals.length !== unionNode.types.length) {
    return null;
  }

  const variants: { name: string; fields: { name: string; cppType: string }[] }[] = [];
  for (let i = 0; i < typeLiterals.length; i++) {
    const literal = typeLiterals[i];
    const variantName = `_${aliasName}_Variant_${i}`;
    const fields = literal.members
      .filter(ts.isPropertySignature)
      .filter(m => ts.isIdentifier(m.name!))
      .map(m => ({
        name: (m.name as ts.Identifier).text,
        cppType: typeNodeToCppType(m.type, typeAliasNodes),
      }));
    variants.push({ name: variantName, fields });
  }
  return variants;
}
