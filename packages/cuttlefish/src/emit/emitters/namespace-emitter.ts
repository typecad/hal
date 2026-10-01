import type { ExpressionIR, ParameterIR } from "../../api/index.js";
import { emitCommentLines } from "../utils/index.js";
import { appendSourceLine, appendHeaderLine, appendRenderedStatement } from "./line-appender.js";
import { createChildEmissionScope } from "../snprintf-helpers.js";
import { escapeCppKeyword } from "../../utils/strings.js";
import { isStringEnum } from "../../api/shared/index.js";
import { resolveEnumValues, narrowestEnumUnderlying } from "../utils/cpp-helpers.js";
import type { EmitterContext } from "./emitter-context.js";

export function emitNamespaces(ctx: EmitterContext): void {
  const { program, strategy, reservedNames, mappedFunctions, topLevelScope, exprRenderer, statementRenderer, effectiveEmitMode } = ctx;
  const normalizeCppTypeForTarget = (cppType: string) => strategy.normalizeCppType(cppType);
  const renderExpression = (expr: ExpressionIR, calleeTransformer?: (callee: string) => string) =>
    exprRenderer.render(expr, calleeTransformer);
  const renderParameters = (params: ParameterIR[], forHeader: boolean = false) =>
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

      // String enum → inner namespace of constexpr const char* constants
      // (see type-decl-emitter.ts / isStringEnum for rationale).
      if (isStringEnum(enumDef)) {
        appendSourceLine(ctx, `  namespace ${enumDef.name} {`);
        for (const member of enumDef.members) {
          const memberName = ctx.reservedNames.has(member.name)
            ? `_${member.name}`
            : member.name;
          const renamed = strategy.renameEnumMember(enumDef.name, memberName);
          const escaped = String(member.value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
          appendSourceLine(ctx, `    constexpr const char* ${renamed} = "${escaped}";`);
        }
        appendSourceLine(ctx, "  }");
        emitCommentLines(enumDef.trailingComments, "  ", (line) => appendSourceLine(ctx, line));
        appendSourceLine(ctx, "");
        continue;
      }

      const enumKeyword = "enum class";
      const underlyingType = narrowestEnumUnderlying(
        resolveEnumValues(enumDef.members),
        strategy.needsLargeEnumUnderlying(),
      );
      appendSourceLine(ctx, `  ${enumKeyword} ${enumDef.name}${underlyingType} {`);
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
      const isConst = constant.storage === "const" || constant.storage === undefined;
      if (constType !== "auto") {
        if (isConst) {
          appendSourceLine(ctx, `  const ${constType} ${constant.name} = ${renderExpression(constant.value, undefined)};`);
        } else {
          appendSourceLine(ctx, `  ${constType} ${constant.name} = ${renderExpression(constant.value, undefined)};`);
        }
      } else {
        if (isConst) {
          appendSourceLine(ctx, `  const auto ${constant.name} = ${renderExpression(constant.value, undefined)};`);
        } else {
          appendSourceLine(ctx, `  auto ${constant.name} = ${renderExpression(constant.value, undefined)};`);
        }
      }
    }
    if (ns.assignments) {
      for (const assign of ns.assignments) {
        appendSourceLine(ctx, `  ${assign.target} = ${renderExpression(assign.value, undefined)};`);
      }
    }
    if (ns.constants.length > 0) {
      appendSourceLine(ctx, "");
    }

    // Namespace classes
    for (const classDef of ns.classes) {
      emitCommentLines(classDef.leadingComments, "  ", (line) => appendSourceLine(ctx, line));
      // C++14 static data members: in-class declaration only; the initializer
      // lives on an out-of-class definition emitted after the class `};`
      // (inside the namespace, so it defines Ns::Class::name). Mirrors
      // class-emitter's staticFieldDefs.
      const staticFieldDefs: string[] = [];
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
            // Friend declaration must match the synthesized callback's actual
            // signature (void name() for ISRs, or R name(args) for typed
            // std::function-callback lambdas). See renderCallbackSignature in
            // function-emitter-impl.ts.
            const fret = callback.returnType && callback.returnType !== "void" ? callback.returnType : "void";
            const fparams = (callback.typedParams ?? []).map((p: { name: string; cppType: string }) => `${p.cppType} ${p.name}`).join(", ");
            appendSourceLine(ctx, `    friend ${fret} ${callback.name}(${fparams});`);
          }
          appendSourceLine(ctx, "");
        }
        if (classDef.constructor) {
          const ctorParams = renderParameters(classDef.constructor.parameters, true);
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
          // A static field stays a static member (a static method's
          // `Cls::field` access must resolve — namespace stress test Finding
          // 2), but C++14 allows no in-class initializer: the initializer
          // moves to the out-of-class definition (staticFieldDefs).
          if (field.isStatic) {
            staticFieldDefs.push(`  ${fieldType} ${classDef.name}::${field.name}${initSuffix};`);
            appendSourceLine(ctx, `    static ${renderTypedName(fieldType, field.name)};`);
            continue;
          }
          appendSourceLine(ctx, `    ${renderTypedName(fieldType, field.name)}${initSuffix};`);
        }
        if (publicFields.length > 0) appendSourceLine(ctx, "");
        for (const method of publicMethods) {
          const methodParams = renderParameters(method.parameters, true);
          const staticPrefix = method.isStatic ? "static " : "";
          const returnType = normalizeCppTypeForTarget(method.returnType);
          if (method.isAbstract) {
            appendSourceLine(ctx, `    virtual ${returnType} ${escapeCppKeyword(method.name, reservedNames)}(${methodParams}) = 0;`);
            appendSourceLine(ctx, "");
            continue;
          }
          appendSourceLine(ctx, `    ${staticPrefix}${returnType} ${escapeCppKeyword(method.name, reservedNames)}(${methodParams}) {`);
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
          // A static field stays a static member (a static method's
          // `Cls::field` access must resolve — namespace stress test Finding
          // 2), but C++14 allows no in-class initializer: the initializer
          // moves to the out-of-class definition (staticFieldDefs).
          if (field.isStatic) {
            staticFieldDefs.push(`  ${fieldType} ${classDef.name}::${field.name}${initSuffix};`);
            appendSourceLine(ctx, `    static ${renderTypedName(fieldType, field.name)};`);
            continue;
          }
          appendSourceLine(ctx, `    ${renderTypedName(fieldType, field.name)}${initSuffix};`);
        }
        for (const method of privateMethods) {
          const methodParams = renderParameters(method.parameters, true);
          appendSourceLine(ctx, `    ${normalizeCppTypeForTarget(method.returnType)} ${escapeCppKeyword(method.name, reservedNames)}(${methodParams}) {`);
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
          // A static field stays a static member (a static method's
          // `Cls::field` access must resolve — namespace stress test Finding
          // 2), but C++14 allows no in-class initializer: the initializer
          // moves to the out-of-class definition (staticFieldDefs).
          if (field.isStatic) {
            staticFieldDefs.push(`  ${fieldType} ${classDef.name}::${field.name}${initSuffix};`);
            appendSourceLine(ctx, `    static ${renderTypedName(fieldType, field.name)};`);
            continue;
          }
          appendSourceLine(ctx, `    ${renderTypedName(fieldType, field.name)}${initSuffix};`);
        }
        for (const method of protectedMethods) {
          const methodParams = renderParameters(method.parameters, true);
          appendSourceLine(ctx, `    ${normalizeCppTypeForTarget(method.returnType)} ${escapeCppKeyword(method.name, reservedNames)}(${methodParams}) {`);
          const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
          for (const stmt of method.statements) {
            appendRenderedStatement(ctx, stmt, "      ", methodScope);
          }
          appendSourceLine(ctx, "    }");
        }
      }

      appendSourceLine(ctx, "  };");
      for (const def of staticFieldDefs) {
        appendSourceLine(ctx, def);
      }
      emitCommentLines(classDef.trailingComments, "  ", (line) => appendSourceLine(ctx, line));
      appendSourceLine(ctx, "");
    }

    // Namespace functions — CROSS-MODULE visibility rules:
    //  · every function DECLares in the module HEADER inside the namespace
    //    (main.cpp's `Metrics::dewPointC(...)` needs the declaration; the
    //    namespace used to exist only in the .cpp — "'Metrics' has not been
    //    declared" at every cross-file call site);
    //  · template members DEFINE in the header (a template definition in a
    //    .cpp is invisible to other TUs — undefined reference at link time);
    //  · the .cpp gets forward declarations at the TOP of its namespace
    //    block (C++ name lookup is declaration-order — a sibling calling a
    //    later-defined member failed with "'clamp' was not declared").
    const isTemplateFn = (f: typeof ns.functions[number]): boolean =>
      !!f.typeParameters && f.typeParameters.length > 0;

    // Header pass — split mode only. Single-file output has no header: the
    // definitions stay in the .cpp (the forward declarations below keep
    // sibling calls order-independent).
    const splitMode = effectiveEmitMode === "split";
    if (splitMode) {
      appendHeaderLine(ctx, `namespace ${ns.name} {`);
    }
    for (const fn of ns.functions) {
      const parameterList = renderParameters(fn.parameters, true);
      if (!splitMode) continue;
      emitCommentLines(fn.leadingComments, "  ", (line) => appendHeaderLine(ctx, line));
      if (isTemplateFn(fn)) {
        // Full definition in the header (buffer swap: appendRenderedStatement
        // is hardwired to the source buffer — see class-emitter's swap).
        const swapLines = ctx.sourceLines;
        ctx.sourceLines = ctx.headerLines;
        ctx.headerLines = swapLines;
        const swapMaps = ctx.sourceMapEntries;
        ctx.sourceMapEntries = ctx.headerMapEntries;
        ctx.headerMapEntries = swapMaps;
        appendSourceLine(ctx, `  template<typename ${fn.typeParameters!.join(", typename ")}>`);
        appendSourceLine(ctx, `  ${normalizeCppTypeForTarget(fn.returnType)} ${fn.originalName}(${renderParameters(fn.parameters)}) {`);
        const templateScope = createChildEmissionScope(topLevelScope, fn.parameters);
        for (const statement of fn.statements) {
          appendRenderedStatement(ctx, statement, "    ", templateScope);
        }
        appendSourceLine(ctx, "  }");
        ctx.headerLines = ctx.sourceLines;
        ctx.sourceLines = swapLines;
        ctx.headerMapEntries = ctx.sourceMapEntries;
        ctx.sourceMapEntries = swapMaps;
      } else {
        appendHeaderLine(ctx, `  ${normalizeCppTypeForTarget(fn.returnType)} ${fn.originalName}(${parameterList});`);
      }
      emitCommentLines(fn.trailingComments, "  ", (line) => appendHeaderLine(ctx, line));
    }
    if (splitMode) {
      appendHeaderLine(ctx, `} // namespace ${ns.name}`);
      appendHeaderLine(ctx, "");
    }

    // .cpp forward declarations inside the namespace block.
    const cppDeclared = ns.functions.filter(fn => !isTemplateFn(fn));
    if (cppDeclared.length > 0) {
      for (const fn of cppDeclared) {
        const parameterList = renderParameters(fn.parameters, true);
        if (isTemplateFn(fn)) continue;
        if (fn.typeParameters && fn.typeParameters.length > 0) {
          appendSourceLine(ctx, `  template<typename ${fn.typeParameters.join(", typename ")}>`);
        }
        appendSourceLine(ctx, `  ${normalizeCppTypeForTarget(fn.returnType)} ${fn.originalName}(${parameterList});`);
      }
      appendSourceLine(ctx, "");
    }

    // Definitions — template members skip only in split mode (their
    // definition lives in the header, visible to every TU).
    for (const fn of ns.functions) {
      if (isTemplateFn(fn) && splitMode) continue;
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

    if (ns.children && ns.children.length > 0) {
      emitNestedNamespaces(ctx, ns.children, "  ");
    }

    appendSourceLine(ctx, `} // namespace ${ns.name}`);
    emitCommentLines(ns.trailingComments, "", (line) => appendSourceLine(ctx, line));
    appendSourceLine(ctx, "");
  }
}

function emitNestedNamespaces(ctx: EmitterContext, namespaces: import("../../api/index.js").NamespaceIR[], indent: string): void {
  const { strategy, reservedNames, topLevelScope, exprRenderer, statementRenderer } = ctx;
  const normalizeCppTypeForTarget = (cppType: string) => strategy.normalizeCppType(cppType);
  const renderExpression = (expr: ExpressionIR, calleeTransformer?: (callee: string) => string) =>
    exprRenderer.render(expr, calleeTransformer);
  const renderParameters = (params: ParameterIR[], forHeader: boolean = false) =>
    statementRenderer.renderParameters(params, forHeader);
  const renderTypedName = (cppType: string, name: string) =>
    statementRenderer.renderTypedName(cppType, name);

  for (const ns of namespaces) {
    emitCommentLines(ns.leadingComments, indent, (line) => appendSourceLine(ctx, line));
    appendSourceLine(ctx, `${indent}namespace ${ns.name} {`);
    appendSourceLine(ctx, "");

    for (const enumDef of ns.enums) {
      emitCommentLines(enumDef.leadingComments, `${indent}  `, (line) => appendSourceLine(ctx, line));
      const enumKeyword = "enum class";
      const underlyingType = narrowestEnumUnderlying(
        resolveEnumValues(enumDef.members),
        strategy.needsLargeEnumUnderlying(),
      );
      appendSourceLine(ctx, `${indent}  ${enumKeyword} ${enumDef.name}${underlyingType} {`);
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
        appendSourceLine(ctx, `${indent}    ${member.name}${valueSuffix}${commaSuffix}`);
      }
      appendSourceLine(ctx, `${indent}  };`);
      appendSourceLine(ctx, "");
    }

    for (const constant of ns.constants) {
      const constType = normalizeCppTypeForTarget(constant.cppType);
      const isConst = constant.storage === "const" || constant.storage === undefined;
      if (constType !== "auto") {
        if (isConst) {
          appendSourceLine(ctx, `${indent}  const ${constType} ${constant.name} = ${renderExpression(constant.value, undefined)};`);
        } else {
          appendSourceLine(ctx, `${indent}  ${constType} ${constant.name} = ${renderExpression(constant.value, undefined)};`);
        }
      } else {
        if (isConst) {
          appendSourceLine(ctx, `${indent}  const auto ${constant.name} = ${renderExpression(constant.value, undefined)};`);
        } else {
          appendSourceLine(ctx, `${indent}  auto ${constant.name} = ${renderExpression(constant.value, undefined)};`);
        }
      }
    }
    if (ns.assignments) {
      for (const assign of ns.assignments) {
        appendSourceLine(ctx, `${indent}  ${assign.target} = ${renderExpression(assign.value, undefined)};`);
      }
    }

    for (const fn of ns.functions) {
      const parameterList = renderParameters(fn.parameters);
      appendSourceLine(ctx, `${indent}  ${normalizeCppTypeForTarget(fn.returnType)} ${fn.originalName}(${parameterList}) {`);
      const fnScope = createChildEmissionScope(topLevelScope, fn.parameters);
      for (const statement of fn.statements) {
        appendRenderedStatement(ctx, statement, `${indent}    `, fnScope);
      }
      appendSourceLine(ctx, `${indent}  }`);
      appendSourceLine(ctx, "");
    }

    if (ns.children && ns.children.length > 0) {
      emitNestedNamespaces(ctx, ns.children, `${indent}  `);
    }

    appendSourceLine(ctx, `${indent}} // namespace ${ns.name}`);
    emitCommentLines(ns.trailingComments, indent, (line) => appendSourceLine(ctx, line));
    appendSourceLine(ctx, "");
  }
}
