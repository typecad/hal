import ts from "typescript";
import { Diagnostic } from "../types";
import { CppType, ClassIR, ClassFieldIR, ClassMethodIR, EnumIR, ExpressionIR, InterfaceIR, ParameterIR, RegisterClassIR, StatementIR, TypeAliasIR } from "./model";
import { extractNodeComments, makeSourceSpan } from "./ast-node-utils";
import { CppTypeHint, typeNodeToCppType, extractOwnershipKindFromTypeNode } from "./type-resolution";
import { getBitsRange, getRegisterAddress } from "./register-decorators";
import { registerFieldMap } from "./build-ir-state";
import { expressionToIR } from "./expression-to-ir";
import { lowerStatementList } from "./statement-to-ir";

export function classDeclarationToIR(
  node: ts.ClassDeclaration,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  typeAliasNodes: Map<string, ts.TypeNode>,
  registerClasses: RegisterClassIR[],
  scopePrefix?: string,
): ClassIR | undefined {
  if (!node.name) {
    return undefined;
  }

  const className = node.name.text;

  // ── @register(addr) detection ────────────────────────────────
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
    // Build lookup map for expression rewriting
    const fieldMap = new Map<string, { hi: number; lo: number; width: number }>();
    for (const bf of bitFields) {
      fieldMap.set(bf.name, { hi: bf.hi, lo: bf.lo, width: bf.width });
    }
    registerFieldMap.set(className, fieldMap);
    return undefined;  // Register class handled separately
  }

  const isAbstract = node.modifiers?.some(m => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;

  const extendsClass = node.heritageClauses
    ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
    ?.types[0]
    ?.expression
    ?.getText();

  const implementsInterfaces = node.heritageClauses
    ?.find((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword)
    ?.types.map(t => t.expression?.getText())
    .filter((name): name is string => name !== undefined);

  const classComments = extractNodeComments(node, sourceText);
  const fields: ClassFieldIR[] = [];
  const methods: ClassMethodIR[] = [];
  let ctor: { parameters: ParameterIR[]; statements: StatementIR[] } | undefined;

  const qualifiedName = scopePrefix ? `${scopePrefix}.${className}` : className;

  for (const member of node.members) {
    // Handle constructor
    if (ts.isConstructorDeclaration(member)) {
      const ctorParams: ParameterIR[] = [];
      const ctorLocalTypes = new Map<string, CppTypeHint>();

      for (const param of member.parameters) {
        if (ts.isIdentifier(param.name)) {
          const paramType = typeNodeToCppType(param.type, typeAliasNodes);
          ctorLocalTypes.set(param.name.text, paramType);
          const paramOwnershipKind = extractOwnershipKindFromTypeNode(param.type, typeAliasNodes);
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
            member.body.statements,
            fileName,
            sourceText,
            diagnostics,
            functionReturnTypes,
            ctorLocalTypes,
            `${qualifiedName}.constructor`,
            typeAliasNodes,
          )
        : [];

      ctor = { parameters: ctorParams, statements: ctorBody };
      continue;
    }

    // Handle property declarations
    if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const visibility: "public" | "private" | "protected" = member.modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)
        ? "private"
        : member.modifiers?.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)
          ? "protected"
          : "public";

      const fieldType = typeNodeToCppType(member.type, typeAliasNodes);

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

    // Handle method declarations
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
          const paramType = typeNodeToCppType(param.type, typeAliasNodes);
          methodLocalTypes.set(param.name.text, paramType);
          const paramOwnershipKind = extractOwnershipKindFromTypeNode(param.type, typeAliasNodes);
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
            member.body.statements,
            fileName,
            sourceText,
            diagnostics,
            functionReturnTypes,
            methodLocalTypes,
            `${qualifiedName}.${member.name.text}`,
            typeAliasNodes,
          )
        : [];
      const methodReturnType = typeNodeToCppType(member.type, typeAliasNodes);

      methods.push({
        name: member.name.text,
        returnType: (
          member.type?.kind === ts.SyntaxKind.ThisType
            ? `${className}*`
            : (methodReturnType === className ? `${className}*` : (methodReturnType === "void" ? "void" : methodReturnType))
        ) as CppType,
        parameters: methodParams,
        statements: methodBody,
        visibility,
        isStatic,
        isAbstract: isMethodAbstract,
      });
    }
  }

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
    getters: [],
    setters: [],
  };
}

export function enumDeclarationToIR(
  node: ts.EnumDeclaration,
  fileName: string,
  sourceText: string,
): EnumIR | undefined {
  if (!node.name) {
    return undefined;
  }

  const enumComments = extractNodeComments(node, sourceText);
  const isConst = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ConstKeyword) ?? false;
  const members: { name: string; value?: number }[] = [];

  let nextValue = 0;
  for (const member of node.members) {
    if (ts.isIdentifier(member.name)) {
      let value: number | undefined;

      if (member.initializer) {
        if (ts.isNumericLiteral(member.initializer)) {
          value = Number(member.initializer.text);
          nextValue = value + 1;
        } else if (ts.isPrefixUnaryExpression(member.initializer) &&
                   member.initializer.operator === ts.SyntaxKind.MinusToken &&
                   ts.isNumericLiteral(member.initializer.operand)) {
          value = -Number((member.initializer.operand as ts.NumericLiteral).text);
          nextValue = value + 1;
        }
      } else {
        value = nextValue;
        nextValue++;
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
  };
}

export function typeAliasDeclarationToIR(
  node: ts.TypeAliasDeclaration,
  fileName: string,
  sourceText: string,
  typeAliasNodes: Map<string, ts.TypeNode>,
): TypeAliasIR | undefined {
  if (node.typeParameters && node.typeParameters.length > 0) {
    return undefined;
  }
  const aliasComments = extractNodeComments(node, sourceText);
  const cppType = typeNodeToCppType(node.type, typeAliasNodes);

  // Extract struct fields when the alias is an object literal type
  let structFields: { name: string; cppType: string }[] | undefined;
  const resolved = node.type;
  if (ts.isTypeLiteralNode(resolved)) {
    structFields = resolved.members
      .filter(ts.isPropertySignature)
      .filter(m => ts.isIdentifier(m.name))
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
  };
}
