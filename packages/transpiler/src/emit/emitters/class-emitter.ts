import { emitCommentLines, isRuntimeExpression, collectNestedStructDefs, inferObjectFieldType } from "../utils";
import { appendSourceLine, appendHeaderLine, appendRenderedStatement } from "./line-appender";
import { createChildEmissionScope } from "../snprintf-helpers";
import { escapeCppKeyword } from "../../utils/strings";
import { accessorGetterName, accessorSetterName } from "../utils/cpp-helpers";
import type { EmitterContext } from "./emitter-context";

export function emitClasses(ctx: EmitterContext): void {
  const { program, strategy, effectiveEmitMode, platformReservedNames, mappedFunctions, topLevelScope, exprRenderer, statementRenderer, isEntryFile } = ctx;
  const normalizeCppTypeForTarget = (cppType: string) => strategy.normalizeCppType(cppType);
  const renderExpression = (expr: any, calleeTransformer?: (callee: string) => string) =>
    exprRenderer.render(expr, calleeTransformer);
  const renderParameters = (params: any[], forHeader: boolean = false) =>
    statementRenderer.renderParameters(params, forHeader);
  const renderTypedName = (cppType: string, name: string) =>
    statementRenderer.renderTypedName(cppType, name);

  // Forward-declare locally-defined base classes
  const localClassNames = new Set(program.classes.map(c => c.name));
  const baseClassesNeeded = new Set<string>();
  for (const classDef of program.classes) {
    if (classDef.extendsClass && !localClassNames.has(classDef.extendsClass)) {
      // Base class from import — header handles it
    } else if (classDef.extendsClass && localClassNames.has(classDef.extendsClass)) {
      baseClassesNeeded.add(classDef.extendsClass);
    }
  }
  for (const classDef of program.classes) {
    if (classDef.extendsClass && baseClassesNeeded.has(classDef.extendsClass)) {
      const baseIdx = program.classes.findIndex(c => c.name === classDef.extendsClass);
      const derivedIdx = program.classes.findIndex(c => c.name === classDef.name);
      if (derivedIdx < baseIdx) {
        appendSourceLine(ctx, `class ${classDef.extendsClass};`);
      }
    }
  }

  // Track static member names per class
  const classStaticMembers = new Map<string, Set<string>>();
  for (const classDef of program.classes) {
    const statics = new Set<string>();
    for (const method of classDef.methods) {
      if (method.isStatic) statics.add(method.name);
    }
    for (const field of classDef.fields) {
      if ((field as any).isStatic) statics.add(field.name);
    }
    for (const getter of classDef.getters) {
      if (getter.isStatic) statics.add(getter.name);
    }
    for (const setter of classDef.setters) {
      if (setter.isStatic) statics.add(setter.name);
    }
    if (statics.size > 0) {
      classStaticMembers.set(classDef.name, statics);
    }
  }

  // String-typed variable tracking + C-array variable tracking
  const stringVarTypes = new Set<string>();
  ctx.cArrayVarNames = new Set<string>();
  const fnCArrayVarNames = new Map<string, Set<string>>();
  const addCArrayIfNotMutable = (name: string, normalizedType: string, target: Set<string>) => {
    if (!normalizedType.startsWith("StaticArray<")) {
      target.add(name);
    }
  };
  const isStringLikeType = (t: string) => t === "const char*" || t === "char*" || t === "String";
  for (const stmt of program.topLevelStatements) {
    if (stmt.kind === "var_decl") {
      const normalizedType = normalizeCppTypeForTarget(stmt.cppType);
      if (isStringLikeType(normalizedType)) {
        stringVarTypes.add(stmt.name);
      }
      if (stmt.initializer?.kind === "array") {
        if (!normalizedType.startsWith("std::vector<") || !strategy.needsStdVector()) {
          addCArrayIfNotMutable(stmt.name, normalizedType, ctx.cArrayVarNames);
        }
      }
      if (stmt.initializer?.kind === "spread_array") {
        addCArrayIfNotMutable(stmt.name, normalizedType, ctx.cArrayVarNames);
      }
    }
  }
  for (let fi = 0; fi < mappedFunctions.length; fi++) {
    const fn = mappedFunctions[fi];
    const fnSet = new Set<string>();
    for (const stmt of fn.statements) {
      if (stmt.kind === "var_decl") {
        const normalizedType = normalizeCppTypeForTarget(stmt.cppType);
        if (isStringLikeType(normalizedType)) {
          stringVarTypes.add(stmt.name);
        }
        if (stmt.initializer?.kind === "array") {
          if (!normalizedType.startsWith("std::vector<") || !strategy.needsStdVector()) {
            addCArrayIfNotMutable(stmt.name, normalizedType, fnSet);
          }
        }
        if (stmt.initializer?.kind === "spread_array") {
          addCArrayIfNotMutable(stmt.name, normalizedType, fnSet);
        }
      }
    }
    fnCArrayVarNames.set(String(fi), fnSet);
  }
  ctx.fnCArrayVarNames = fnCArrayVarNames;

  // Build class accessor name map
  const classAccessorNames = new Map<string, Map<string, "getter" | "setter" | "both">>();
  for (const classDef of program.classes) {
    const accessors = new Map<string, "getter" | "setter" | "both">();
    for (const g of classDef.getters) {
      accessors.set(g.name, accessors.has(g.name) ? "both" : "getter");
    }
    for (const s of classDef.setters) {
      accessors.set(s.name, accessors.has(s.name) ? "both" : "setter");
    }
    if (accessors.size > 0) {
      classAccessorNames.set(classDef.name, accessors);
    }
  }

  // Build variable → accessor map
  const allVarDecls: { name: string; cppType: string }[] = [];
  for (const stmt of program.topLevelStatements) {
    if (stmt.kind === "var_decl") allVarDecls.push(stmt);
  }
  for (const fn of mappedFunctions) {
    for (const stmt of fn.statements) {
      if (stmt.kind === "var_decl") allVarDecls.push(stmt);
    }
  }
  for (const v of allVarDecls) {
    const bareType = v.cppType.replace(/\*$/, "").replace(/^const\s+/, "");
    const accessors = classAccessorNames.get(bareType);
    if (accessors) {
      ctx.varAccessorNames.set(v.name, accessors);
    }
  }

  // Emit each class
  for (const classDef of program.classes) {
    emitCommentLines(classDef.leadingComments, "", (line) => appendSourceLine(ctx, line));

    const inheritanceParts: string[] = [];
    if (classDef.extendsClass) {
      inheritanceParts.push(`public ${classDef.extendsClass}`);
    }
    const inheritanceClause = inheritanceParts.length > 0 ? ` : ${inheritanceParts.join(", ")}` : "";

    if (classDef.isAbstract) {
      appendSourceLine(ctx, `// Abstract class - contains pure virtual methods`);
    }
    appendSourceLine(ctx, `class ${classDef.name}${inheritanceClause} {`);

    const publicFields = classDef.fields.filter(f => f.visibility === "public");
    const privateFields = classDef.fields.filter(f => f.visibility === "private");
    const protectedFields = classDef.fields.filter(f => f.visibility === "protected");
    const publicMethods = classDef.methods.filter(m => m.visibility === "public");
    const privateMethods = classDef.methods.filter(m => m.visibility === "private");
    const protectedMethods = classDef.methods.filter(m => m.visibility === "protected");
    const publicGetters = classDef.getters.filter(g => g.visibility === "public");
    const publicSetters = classDef.setters.filter(s => s.visibility === "public");
    const privateGetters = classDef.getters.filter(g => g.visibility === "private");
    const privateSetters = classDef.setters.filter(s => s.visibility === "private");
    const protectedGetters = classDef.getters.filter(g => g.visibility === "protected");
    const protectedSetters = classDef.setters.filter(s => s.visibility === "protected");

    const needsPublicSection = publicFields.length > 0 || publicMethods.length > 0 || publicGetters.length > 0 || publicSetters.length > 0 || classDef.constructor || ctx.callbackFunctions.length > 0;

    if (needsPublicSection) {
      appendSourceLine(ctx, "public:");
      if (ctx.callbackFunctions.length > 0) {
        for (const callback of ctx.callbackFunctions) {
          appendSourceLine(ctx, `  friend void ${callback.name}();`);
        }
        appendSourceLine(ctx, "");
      }

      if (classDef.constructor) {
        const ctorParamsMapped = classDef.constructor.parameters.map(p => ({
          ...p,
          cppType: normalizeCppTypeForTarget(p.cppType)
        }));
        const ctorParams = renderParameters(ctorParamsMapped);
        let ctorInitializer = "";
        let ctorStatements = classDef.constructor.statements;
        const firstCtorStatement = ctorStatements[0];
        if (classDef.extendsClass && firstCtorStatement && firstCtorStatement.kind === "call" && firstCtorStatement.callee === "super") {
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

      for (const field of publicFields) {
        const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined)}` : "";
        const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType));
        appendSourceLine(ctx, `  ${renderTypedName(fieldType, field.name)}${initSuffix};`);
      }
      if (publicFields.length > 0) appendSourceLine(ctx, "");

      for (const method of publicMethods) {
        const methodParams = renderParameters(method.parameters);
        const staticPrefix = method.isStatic ? "static " : "";
        const returnType = normalizeCppTypeForTarget(method.returnType);
        if (method.isAbstract) {
          appendSourceLine(ctx, `  virtual ${returnType} ${escapeCppKeyword(method.name, platformReservedNames)}(${methodParams}) = 0;`);
          appendSourceLine(ctx, "");
          continue;
        }
        appendSourceLine(ctx, `  ${staticPrefix}${returnType} ${escapeCppKeyword(method.name, platformReservedNames)}(${methodParams}) {`);
        const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
        for (const stmt of method.statements) {
          appendRenderedStatement(ctx, stmt, "    ", methodScope);
        }
        appendSourceLine(ctx, "  }");
        appendSourceLine(ctx, "");
      }

      for (const getter of publicGetters) {
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

      for (const setter of publicSetters) {
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

    // Private section
    if (privateFields.length > 0 || privateMethods.length > 0 || privateGetters.length > 0 || privateSetters.length > 0) {
      appendSourceLine(ctx, "private:");
      for (const field of privateFields) {
        const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined)}` : "";
        const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType));
        appendSourceLine(ctx, `  ${renderTypedName(fieldType, field.name)}${initSuffix};`);
      }
      if (privateFields.length > 0) appendSourceLine(ctx, "");
      for (const method of privateMethods) {
        const methodParams = renderParameters(method.parameters);
        const staticPrefix = method.isStatic ? "static " : "";
        appendSourceLine(ctx, `  ${staticPrefix}${normalizeCppTypeForTarget(method.returnType)} ${escapeCppKeyword(method.name, platformReservedNames)}(${methodParams}) {`);
        const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
        for (const stmt of method.statements) {
          appendRenderedStatement(ctx, stmt, "    ", methodScope);
        }
        appendSourceLine(ctx, "  }");
        appendSourceLine(ctx, "");
      }
      for (const getter of privateGetters) {
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
      for (const setter of privateSetters) {
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

    // Protected section
    if (protectedFields.length > 0 || protectedMethods.length > 0 || protectedGetters.length > 0 || protectedSetters.length > 0) {
      appendSourceLine(ctx, "protected:");
      for (const field of protectedFields) {
        const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined)}` : "";
        const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType));
        appendSourceLine(ctx, `  ${renderTypedName(fieldType, field.name)}${initSuffix};`);
      }
      if (protectedFields.length > 0) appendSourceLine(ctx, "");
      for (const method of protectedMethods) {
        const methodParams = renderParameters(method.parameters);
        const staticPrefix = method.isStatic ? "static " : "";
        appendSourceLine(ctx, `  ${staticPrefix}${normalizeCppTypeForTarget(method.returnType)} ${escapeCppKeyword(method.name, platformReservedNames)}(${methodParams}) {`);
        const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
        for (const stmt of method.statements) {
          appendRenderedStatement(ctx, stmt, "    ", methodScope);
        }
        appendSourceLine(ctx, "  }");
        appendSourceLine(ctx, "");
      }
      for (const getter of protectedGetters) {
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
      for (const setter of protectedSetters) {
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

    appendSourceLine(ctx, "};");
    emitCommentLines(classDef.trailingComments, "", (line) => appendSourceLine(ctx, line));
    appendSourceLine(ctx, "");
  }
}
