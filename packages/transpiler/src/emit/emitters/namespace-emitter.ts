import { emitCommentLines } from "../utils";
import { appendSourceLine, appendRenderedStatement } from "./line-appender";
import { createChildEmissionScope } from "../snprintf-helpers";
import { escapeCppKeyword } from "../../utils/strings";
import type { EmitterContext } from "./emitter-context";

export function emitNamespaces(ctx: EmitterContext): void {
  const { program, strategy, platformReservedNames, mappedFunctions, topLevelScope, exprRenderer, statementRenderer } = ctx;
  const normalizeCppTypeForTarget = (cppType: string) => strategy.normalizeCppType(cppType);
  const renderExpression = (expr: any, calleeTransformer?: (callee: string) => string) =>
    exprRenderer.render(expr, calleeTransformer);
  const renderParameters = (params: any[], forHeader: boolean = false) =>
    statementRenderer.renderParameters(params, forHeader);
  const renderTypedName = (cppType: string, name: string) =>
    statementRenderer.renderTypedName(cppType, name);

  for (const ns of program.namespaces) {
    emitCommentLines(ns.leadingComments, "", (line) => appendSourceLine(ctx, line));
    appendSourceLine(ctx, `namespace ${ns.name} {`);
    appendSourceLine(ctx, "");

    // Namespace enums
    for (const enumDef of ns.enums) {
      emitCommentLines(enumDef.leadingComments, "  ", (line) => appendSourceLine(ctx, line));
      const enumKeyword = "enum class";
      const needsLongUnderlying = strategy.needsLargeEnumUnderlying() &&
        enumDef.members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768));
      const underlyingType = needsLongUnderlying ? " : long" : "";
      appendSourceLine(ctx, `  ${enumKeyword} ${enumDef.name}${underlyingType} {`);
      for (let i = 0; i < enumDef.members.length; i++) {
        const member = enumDef.members[i];
        const valueSuffix = member.value !== undefined ? ` = ${member.value}` : "";
        const commaSuffix = i < enumDef.members.length - 1 ? "," : "";
        appendSourceLine(ctx, `    ${member.name}${valueSuffix}${commaSuffix}`);
      }
      appendSourceLine(ctx, "  };");
      emitCommentLines(enumDef.trailingComments, "  ", (line) => appendSourceLine(ctx, line));
      appendSourceLine(ctx, "");
    }

    // Namespace type aliases
    for (const typeAlias of ns.typeAliases) {
      emitCommentLines(typeAlias.leadingComments, "  ", (line) => appendSourceLine(ctx, line));
      const cppType = normalizeCppTypeForTarget(typeAlias.cppType);
      if (cppType !== "auto" && !strategy.shouldSkipTypeAlias(cppType)) {
        appendSourceLine(ctx, `  using ${typeAlias.name} = ${cppType};`);
        emitCommentLines(typeAlias.trailingComments, "  ", (line) => appendSourceLine(ctx, line));
        appendSourceLine(ctx, "");
      }
    }

    // Namespace constants
    for (const constant of ns.constants) {
      const constType = normalizeCppTypeForTarget(constant.cppType);
      if (constType !== "auto") {
        appendSourceLine(ctx, `  const ${constType} ${constant.name} = ${renderExpression(constant.value, undefined)};`);
      } else {
        appendSourceLine(ctx, `  const auto ${constant.name} = ${renderExpression(constant.value, undefined)};`);
      }
    }
    if (ns.constants.length > 0) {
      appendSourceLine(ctx, "");
    }

    // Namespace classes
    for (const classDef of ns.classes) {
      emitCommentLines(classDef.leadingComments, "  ", (line) => appendSourceLine(ctx, line));
      if (classDef.isAbstract) {
        appendSourceLine(ctx, `  // Abstract class - contains pure virtual methods`);
      }
      appendSourceLine(ctx, `  class ${classDef.name} {`);

      const publicFields = classDef.fields.filter(f => f.visibility === "public");
      const privateFields = classDef.fields.filter(f => f.visibility === "private");
      const protectedFields = classDef.fields.filter(f => f.visibility === "protected");
      const publicMethods = classDef.methods.filter(m => m.visibility === "public");
      const privateMethods = classDef.methods.filter(m => m.visibility === "private");
      const protectedMethods = classDef.methods.filter(m => m.visibility === "protected");

      const needsPublicSection = publicFields.length > 0 || publicMethods.length > 0 || classDef.constructor || ctx.callbackFunctions.length > 0;
      if (needsPublicSection) {
        appendSourceLine(ctx, "  public:");
        if (ctx.callbackFunctions.length > 0) {
          for (const callback of ctx.callbackFunctions) {
            appendSourceLine(ctx, `    friend void ${callback.name}();`);
          }
          appendSourceLine(ctx, "");
        }
        if (classDef.constructor) {
          const ctorParams = renderParameters(classDef.constructor.parameters);
          appendSourceLine(ctx, `    ${classDef.name}(${ctorParams}) {`);
          const ctorScope = createChildEmissionScope(topLevelScope, classDef.constructor.parameters);
          for (const stmt of classDef.constructor.statements) {
            appendRenderedStatement(ctx, stmt, "      ", ctorScope);
          }
          appendSourceLine(ctx, "    }");
          appendSourceLine(ctx, "");
        }
        for (const field of publicFields) {
          const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined)}` : "";
          const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType));
          appendSourceLine(ctx, `    ${renderTypedName(fieldType, field.name)}${initSuffix};`);
        }
        if (publicFields.length > 0) appendSourceLine(ctx, "");
        for (const method of publicMethods) {
          const methodParams = renderParameters(method.parameters);
          const staticPrefix = method.isStatic ? "static " : "";
          const returnType = normalizeCppTypeForTarget(method.returnType);
          if (method.isAbstract) {
            appendSourceLine(ctx, `    virtual ${returnType} ${escapeCppKeyword(method.name, platformReservedNames)}(${methodParams}) = 0;`);
            appendSourceLine(ctx, "");
            continue;
          }
          appendSourceLine(ctx, `    ${staticPrefix}${returnType} ${escapeCppKeyword(method.name, platformReservedNames)}(${methodParams}) {`);
          const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
          for (const stmt of method.statements) {
            appendRenderedStatement(ctx, stmt, "      ", methodScope);
          }
          appendSourceLine(ctx, "    }");
          appendSourceLine(ctx, "");
        }
      }

      if (privateFields.length > 0 || privateMethods.length > 0) {
        appendSourceLine(ctx, "  private:");
        for (const field of privateFields) {
          const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined)}` : "";
          const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType));
          appendSourceLine(ctx, `    ${renderTypedName(fieldType, field.name)}${initSuffix};`);
        }
        for (const method of privateMethods) {
          const methodParams = renderParameters(method.parameters);
          appendSourceLine(ctx, `    ${normalizeCppTypeForTarget(method.returnType)} ${escapeCppKeyword(method.name, platformReservedNames)}(${methodParams}) {`);
          const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
          for (const stmt of method.statements) {
            appendRenderedStatement(ctx, stmt, "      ", methodScope);
          }
          appendSourceLine(ctx, "    }");
        }
      }

      if (protectedFields.length > 0 || protectedMethods.length > 0) {
        appendSourceLine(ctx, "  protected:");
        for (const field of protectedFields) {
          const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined)}` : "";
          const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType));
          appendSourceLine(ctx, `    ${renderTypedName(fieldType, field.name)}${initSuffix};`);
        }
        for (const method of protectedMethods) {
          const methodParams = renderParameters(method.parameters);
          appendSourceLine(ctx, `    ${normalizeCppTypeForTarget(method.returnType)} ${escapeCppKeyword(method.name, platformReservedNames)}(${methodParams}) {`);
          const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
          for (const stmt of method.statements) {
            appendRenderedStatement(ctx, stmt, "      ", methodScope);
          }
          appendSourceLine(ctx, "    }");
        }
      }

      appendSourceLine(ctx, "  };");
      emitCommentLines(classDef.trailingComments, "  ", (line) => appendSourceLine(ctx, line));
      appendSourceLine(ctx, "");
    }

    // Namespace functions
    for (const fn of ns.functions) {
      const parameterList = renderParameters(fn.parameters);
      emitCommentLines(fn.leadingComments, "  ", (line) => appendSourceLine(ctx, line));
      appendSourceLine(ctx, `  ${normalizeCppTypeForTarget(fn.returnType)} ${fn.originalName}(${parameterList}) {`);
      const namespaceFunctionScope = createChildEmissionScope(topLevelScope, fn.parameters);
      for (const statement of fn.statements) {
        appendRenderedStatement(ctx, statement, "    ", namespaceFunctionScope);
      }
      appendSourceLine(ctx, "  }");
      emitCommentLines(fn.trailingComments, "  ", (line) => appendSourceLine(ctx, line));
      appendSourceLine(ctx, "");
    }

    appendSourceLine(ctx, `} // namespace ${ns.name}`);
    emitCommentLines(ns.trailingComments, "", (line) => appendSourceLine(ctx, line));
    appendSourceLine(ctx, "");
  }
}
