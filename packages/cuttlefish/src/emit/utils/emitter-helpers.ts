import type { ExpressionIR, ParameterIR, EnumIR, ClassFieldIR, ClassMethodIR, ClassGetterIR, ClassSetterIR, ClassConstructorIR, ClassIR, StatementIR } from "../../api";
import type { PlatformStrategy } from "../../api/shared";
import type { EmitterContext } from "../emitters/emitter-context";
import type { EmissionScopeState } from "../../api/shared/snprintf-types";
import { appendSourceLine, appendRenderedStatement } from "../emitters/line-appender";
import { accessorGetterName, accessorSetterName } from "./cpp-helpers";
import { parsedIsPointer } from "../../api/shared/cpp-type-ir";
import { escapeCppKeyword } from "../../utils/strings";
import { createChildEmissionScope } from "../snprintf-helpers";
import { emitCommentLines } from "../utils";

export type RenderExpressionFn = (expr: ExpressionIR, calleeTransformer?: (callee: string) => string) => string;
export type RenderParametersFn = (params: ParameterIR[], forHeader?: boolean) => string;
export type RenderTypedNameFn = (cppType: string, name: string) => string;

export function createRenderHelpers(ctx: EmitterContext): {
  renderExpression: RenderExpressionFn;
  renderParameters: RenderParametersFn;
  renderTypedName: RenderTypedNameFn;
} {
  const { exprRenderer, statementRenderer } = ctx;
  return {
    renderExpression: (expr, calleeTransformer) => exprRenderer.render(expr, calleeTransformer),
    renderParameters: (params, forHeader) => statementRenderer.renderParameters(params, forHeader),
    renderTypedName: (cppType, name) => statementRenderer.renderTypedName(cppType, name),
  };
}

export function emitEnumDefinition(
  ctx: EmitterContext,
  enumDef: EnumIR,
  strategy: PlatformStrategy,
  indent: string,
): void {
  emitCommentLines(enumDef.leadingComments, indent, (line) => appendSourceLine(ctx, line));
  const enumKeyword = "enum class";
  const needsLongUnderlying = strategy.needsLargeEnumUnderlying() &&
    enumDef.members.some(m => typeof m.value === "number" && (m.value > 32767 || m.value < -32768));
  const underlyingType = needsLongUnderlying ? " : long" : "";
  appendSourceLine(ctx, `${indent}${enumKeyword} ${enumDef.name}${underlyingType} {`);
  let autoValue = 0;
  for (let i = 0; i < enumDef.members.length; i++) {
    const member = enumDef.members[i];
    let valueSuffix: string;
    if (typeof member.value === "number") {
      valueSuffix = ` = ${member.value}`;
      autoValue = member.value + 1;
    } else if (typeof member.value === "string") {
      valueSuffix = ` = ${autoValue}`;
      autoValue++;
    } else {
      valueSuffix = "";
      autoValue++;
    }
    const commaSuffix = i < enumDef.members.length - 1 ? "," : "";
    appendSourceLine(ctx, `${indent}  ${member.name}${valueSuffix}${commaSuffix}`);
  }
  appendSourceLine(ctx, `${indent}};`);
  emitCommentLines(enumDef.trailingComments, indent, (line) => appendSourceLine(ctx, line));
  appendSourceLine(ctx, "");
}

export function fixPointerFieldAccess(
  callee: string,
  pointerVarTypes: Map<string, string>,
  pointerStructFields: Set<string>,
): string {
  callee = callee.replace(/\bthis\./g, "this->");
  for (const [varName, varType] of pointerVarTypes) {
    if (parsedIsPointer(varType)) {
      const pattern = new RegExp(`\\b${varName}\\.`, "g");
      callee = callee.replace(pattern, `${varName}->`);
    }
  }
  for (const pointerField of pointerStructFields) {
    const pattern = new RegExp(`(^|[^>])${pointerField.replace(".", "\\.")}\\.`, "g");
    callee = callee.replace(pattern, `$1${pointerField}->`);
  }
  return callee;
}

interface ClassSectionMembers {
  fields: ClassFieldIR[];
  methods: ClassMethodIR[];
  getters: ClassGetterIR[];
  setters: ClassSetterIR[];
}

export function emitClassSection(
  ctx: EmitterContext,
  classDef: ClassIR,
  visibility: "public" | "private" | "protected",
  members: ClassSectionMembers,
  renderExpression: RenderExpressionFn,
  renderParameters: RenderParametersFn,
  renderTypedName: RenderTypedNameFn,
  includeConstructor: boolean,
  includeFriendCallbacks: boolean,
): void {
  const { strategy, reservedNames, topLevelScope } = ctx;
  const normalizeCppTypeForTarget = (cppType: string) => strategy.normalizeCppType(cppType);

  appendSourceLine(ctx, `${visibility}:`);

  if (includeFriendCallbacks && ctx.callbackFunctions.length > 0) {
    for (const callback of ctx.callbackFunctions) {
      // Friend declaration must match the synthesized callback's actual
      // signature (void name() for ISRs, or R name(args) for typed
      // std::function-callback lambdas). See renderCallbackSignature in
      // function-emitter-impl.ts.
      const fret = callback.returnType && callback.returnType !== "void" ? callback.returnType : "void";
      const fparams = (callback.typedParams ?? []).map((p: { name: string; cppType: string }) => `${p.cppType} ${p.name}`).join(", ");
      appendSourceLine(ctx, `  friend ${fret} ${callback.name}(${fparams});`);
    }
    appendSourceLine(ctx, "");
  }

  if (includeConstructor && classDef.constructor) {
    const ctorParamsMapped = classDef.constructor.parameters.map(p => ({
      ...p,
      cppType: normalizeCppTypeForTarget(p.cppType)
    }));
    const ctorParams = renderParameters(ctorParamsMapped);
    let ctorInitializer = "";
    let ctorStatements = classDef.constructor.statements;
    const firstCtorStatement = ctorStatements[0];
    if (classDef.extendsClass && firstCtorStatement && firstCtorStatement.kind === "super_call") {
      const baseArgs = firstCtorStatement.args.map((arg) => renderExpression(arg, ctx.fixPointerFieldAccess)).join(", ");
      ctorInitializer = ` : ${classDef.extendsClass}(${baseArgs})`;
      ctorStatements = ctorStatements.slice(1);
    }
    appendSourceLine(ctx, `  ${classDef.name}(${ctorParams})${ctorInitializer} {`);
    const ctorScope = createChildEmissionScope(topLevelScope, classDef.constructor.parameters);
    for (const stmt of ctorStatements) {
      appendRenderedStatement(ctx, stmt, "    ", ctorScope);
    }
    appendSourceLine(ctx, "  }");
    appendSourceLine(ctx, "");
  }

  if (visibility === "public" && classDef.extendsClass && includeConstructor) {
    appendSourceLine(ctx, `  virtual ~${classDef.name}() = default;`);
    appendSourceLine(ctx, "");
  }

  for (const field of members.fields) {
    const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined)}` : "";
    const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType));
    appendSourceLine(ctx, `  ${renderTypedName(fieldType, field.name)}${initSuffix};`);
  }
  if (members.fields.length > 0) appendSourceLine(ctx, "");

  for (const method of members.methods) {
    const methodParams = renderParameters(method.parameters);
    const staticPrefix = method.isStatic ? "static " : "";
    const returnType = normalizeCppTypeForTarget(method.returnType);
    if (method.isAbstract) {
      appendSourceLine(ctx, `  virtual ${returnType} ${escapeCppKeyword(method.name, reservedNames)}(${methodParams}) = 0;`);
      appendSourceLine(ctx, "");
      continue;
    }
    const overrideSuffix = method.isOverride ? " override" : "";
    if (method.typeParameters && method.typeParameters.length > 0) {
      appendSourceLine(ctx, `  template<typename ${method.typeParameters.join(", typename ")}>`);
    }
    appendSourceLine(ctx, `  ${staticPrefix}${returnType} ${escapeCppKeyword(method.name, reservedNames)}(${methodParams})${overrideSuffix} {`);
    const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
    for (const stmt of method.statements) {
      appendRenderedStatement(ctx, stmt, "    ", methodScope);
    }
    appendSourceLine(ctx, "  }");
    appendSourceLine(ctx, "");
  }

  for (const getter of members.getters) {
    const staticPrefix = getter.isStatic ? "static " : "";
    const returnType = normalizeCppTypeForTarget(getter.returnType);
    const getterName = accessorGetterName(getter.name);
    appendSourceLine(ctx, `  ${staticPrefix}${returnType} ${getterName}() const {`);
    const getterScope = createChildEmissionScope(topLevelScope, []);
    for (const stmt of getter.statements) {
      appendRenderedStatement(ctx, stmt, "    ", getterScope);
    }
    appendSourceLine(ctx, "  }");
    appendSourceLine(ctx, "");
  }

  for (const setter of members.setters) {
    const staticPrefix = setter.isStatic ? "static " : "";
    const paramType = normalizeCppTypeForTarget(setter.parameter.cppType);
    const setterName = accessorSetterName(setter.name);
    appendSourceLine(ctx, `  ${staticPrefix}void ${setterName}(${paramType} ${setter.parameter.name}) {`);
    const setterScope = createChildEmissionScope(topLevelScope, [setter.parameter]);
    for (const stmt of setter.statements) {
      appendRenderedStatement(ctx, stmt, "    ", setterScope);
    }
    appendSourceLine(ctx, "  }");
    appendSourceLine(ctx, "");
  }
}
