import type { ExpressionIR, ParameterIR } from "../../api/index.js";
import { emitCommentLines, isRuntimeExpression, collectNestedStructDefs, inferObjectFieldType } from "../utils/index.js";
import { appendSourceLine, appendHeaderLine, appendRenderedStatement } from "./line-appender.js";
import { createChildEmissionScope } from "../snprintf-helpers.js";
import { escapeCppKeyword } from "../../utils/strings.js";
import { accessorGetterName, accessorSetterName } from "../utils/cpp-helpers.js";
import type { EmitterContext } from "./emitter-context.js";
import { parseCppType, parsedIsPointer, parsedIsVector, parsedIsStringLike, isStaticArray } from "../../api/shared/cpp-type-ir.js";

// ── Getter const-qualification analysis ─────────────────────────────────────
//
// A `const` member function may only call `const` siblings on the same
// object, so stamping every getter `const` breaks the build whenever a
// getter's body reaches a non-const method (`get mS() { return this.getF32(...) }`
// emitted `getMS() const` calling the non-const `getF32`). A getter is
// const-safe iff its body writes no `this->` member (writes THROUGH a
// pointer member are fine — the pointee is not the receiver) and calls no
// sibling method or setter and no sibling getter that fails the same test
// (a fixpoint — getter-to-getter chains).
//
// Writes: a direct member write (`this->x`, `this->x[i]`, `this->x.y`)
// mutates the receiver; `this->x->y` does not (x is a pointer member).
// Calls: `this->method(...)` — calls through pointer members
// (`this->registers->setU8(...)`) mutate another object, not the receiver.

/** Assign/update targets that mutate the receiver. */
const RECEIVER_WRITE = /^this->[A-Za-z_]\w*(?:\[[^\]]*\]|\.[A-Za-z_]\w*)*$/;
/** A sibling call: `this->name` exactly (no further member access). */
const SIBLING_CALL = /^this->([A-Za-z_]\w*)$/;

/** Scan one IR node (statement or expression) tree for receiver writes and
 *  sibling calls. The IR is structural; walk every array/object property. */
function scanBody(node: unknown, out: { writes: boolean; calls: Set<string> }): void {
  if (Array.isArray(node)) {
    for (const item of node) scanBody(item, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  const ir = node as Record<string, unknown>;
  if (ir.kind === "assign" || ir.kind === "update") {
    if (typeof ir.target === "string" && RECEIVER_WRITE.test(ir.target)) out.writes = true;
  } else if (ir.kind === "call" || ir.kind === "method-call") {
    const m = typeof ir.callee === "string" ? SIBLING_CALL.exec(ir.callee) : null;
    if (m) out.calls.add(m[1]);
  }
  for (const value of Object.values(ir)) {
    if (value === ir.kind) continue;
    scanBody(value, out);
  }
}

/** Per class: which getters may carry the `const` qualifier. */
function computeConstSafeGetters(classDef: any): Set<string> {
  const bodies = new Map<string, { writes: boolean; calls: Set<string> }>();
  for (const g of classDef.getters ?? []) {
    const scan = { writes: false, calls: new Set<string>() };
    for (const stmt of g.statements ?? []) scanBody(stmt, scan);
    bodies.set(g.name, scan);
  }
  // Methods and setters are emitted without `const`, so calling one from a
  // const getter is a compile error — seed them as non-const callees.
  const nonConst = new Set<string>();
  for (const m of classDef.methods ?? []) nonConst.add(m.name);
  for (const s of classDef.setters ?? []) nonConst.add(s.name);
  // Fixpoint over getter→getter chains.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, scan] of bodies) {
      if (nonConst.has(name)) continue;
      if (scan.writes || [...scan.calls].some(callee => nonConst.has(callee))) {
        nonConst.add(name);
        changed = true;
      }
    }
  }
  const safe = new Set<string>();
  for (const name of bodies.keys()) {
    if (!nonConst.has(name)) safe.add(name);
  }
  return safe;
}

export function emitClasses(ctx: EmitterContext): void {
  const { program, strategy, effectiveEmitMode, reservedNames, mappedFunctions, topLevelScope, exprRenderer, statementRenderer, isEntryFile } = ctx;

  if (effectiveEmitMode === "split") {
    const _swapLines = ctx.sourceLines;
    ctx.sourceLines = ctx.headerLines;
    ctx.headerLines = _swapLines;
    const _swapMaps = ctx.sourceMapEntries;
    ctx.sourceMapEntries = ctx.headerMapEntries;
    ctx.headerMapEntries = _swapMaps;
  }

  const normalizeCppTypeForTarget = (cppType: string) => strategy.normalizeCppType(cppType);
  const renderExpression = (expr: ExpressionIR, calleeTransformer?: (callee: string) => string) =>
    exprRenderer.render(expr, calleeTransformer);
  const renderParameters = (params: ParameterIR[], forHeader: boolean = false) =>
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
      if (field.isStatic) statics.add(field.name);
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
  // Note: this intentionally matches only const char*/char*/String, NOT
  // std::string — the latter is tracked separately as a "managed" string var.
  const isStringLikeType = (t: string) => t === "const char*" || t === "char*" || t === "String";
  for (const stmt of program.topLevelStatements) {
    if (stmt.kind === "var_decl") {
      const normalizedType = normalizeCppTypeForTarget(stmt.cppType);
      if (isStringLikeType(normalizedType)) {
        stringVarTypes.add(stmt.name);
      }
      if (stmt.initializer?.kind === "array") {
        if (!parsedIsVector(normalizedType) || !strategy.needsStdVector()) {
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
          if (!parsedIsVector(normalizedType) || !strategy.needsStdVector()) {
            addCArrayIfNotMutable(stmt.name, normalizedType, fnSet);
          }
        }
        if (stmt.initializer?.kind === "spread_array") {
          addCArrayIfNotMutable(stmt.name, normalizedType, fnSet);
        }
        // Demo #17 Finding A — `new Uint8Array([...])` / `new Int8Array(N)`
        // lowers to a raw C array var_decl whose cppType is a staticArray
        // (e.g. `uint8_t[5]`) but whose initializer is NOT `kind: "array"`
        // (it's a raw/text initializer). The `stmt.initializer?.kind === "array"`
        // gate above therefore misses it, so `.length` on the buffer fell
        // through to the invalid `buf.size()` (avr-g++: "request for member
        // 'size' in 'buf', which is of non-class type 'uint8_t [5]'").
        // Detect by cppType shape: a staticArray on a no-std::vector target is
        // a raw C array → sizeof. (StaticArray<T,N> — the mutable promoted
        // form — is excluded by addCArrayIfNotMutable and keeps its .size().)
        if (!strategy.needsStdVector() && isStaticArray(parseCppType(normalizedType))) {
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

  // Build variable → accessor map. NOTE: the variable/parameter registration
  // now lives in setup.ts so it runs before any emit pass. The classAccessorNames
  // map built here is still used below for the per-method "this" registration.
  // (demo #4 fix.)

  // Build virtual/override maps for inherited methods
  const classMethodNames = new Map<string, Set<string>>();
  for (const cls of program.classes) {
    const names = new Set(
      cls.methods
        .filter(m => !m.isStatic && !m.isAbstract)
        .map(m => m.name)
    );
    classMethodNames.set(cls.name, names);
  }
  const virtualMethodNames = new Map<string, Set<string>>();
  for (const cls of program.classes) {
    if (cls.extendsClass) {
      const baseMethods = classMethodNames.get(cls.extendsClass);
      if (baseMethods) {
        for (const method of cls.methods) {
          if (!method.isStatic && !method.isAbstract && baseMethods.has(method.name)) {
            if (!virtualMethodNames.has(cls.extendsClass)) {
              virtualMethodNames.set(cls.extendsClass, new Set());
            }
            virtualMethodNames.get(cls.extendsClass)!.add(method.name);
          }
        }
      }
    }
  }

  const collectAllFields = (classDef: any): any[] => {
    const fields: any[] = [...classDef.fields];
    if (classDef.extendsClass) {
      const parent = program.classes.find((c: any) => c.name === classDef.extendsClass);
      if (parent) fields.push(...collectAllFields(parent));
    }
    return fields;
  };

  const addClassFieldsToScope = (classDef: any, scope: any) => {
    for (const f of collectAllFields(classDef)) {
      const normalizedFieldType = strategy.normalizeCppType(f.cppType);
      scope.knownVariableTypes.set(f.name, { cppType: normalizedFieldType });
    }
  };

  const withThisAccessors = (classDef: any, isStatic: boolean, fn: () => void) => {
    const classAccessors = classAccessorNames.get(classDef.name);
    if (classAccessors && !isStatic) ctx.varAccessorNames.set("this", classAccessors);
    fn();
    if (classAccessors && !isStatic) ctx.varAccessorNames.delete("this");
  };

  // Emit each class
  // Split-mode accumulator: every class's out-of-class static data-member
  // definitions, appended to the SOURCE stream after the header/source swap
  // (one definition per program, in the module's .cpp — see the swap below).
  const staticFieldDefsAll: string[] = [];
  for (const classDef of program.classes) {
    emitCommentLines(classDef.leadingComments, "", (line) => appendSourceLine(ctx, line));
    // C++14: a mutable (or non-integral-const) static data member may not be
    // initialized in-class — the initializer goes on an out-of-class
    // definition emitted right after `};`. (`static inline` is C++17; under
    // --autosar=C++14 g++ rejected it: "inline variables are only available
    // with '-std=c++17'".) Uninitialized statics still need the out-of-class
    // definition when odr-used (`Class::counter++`).
    const staticFieldDefs: string[] = [];

    const inheritanceParts: string[] = [];
    if (classDef.extendsClass) {
      inheritanceParts.push(`public ${classDef.extendsClass}`);
    }
    // `implements` a METHOD-BEARING interface needs real inheritance: the
    // interface lowers to an abstract struct, and using the object through
    // the interface pointer requires the virtual overrides to derive from it.
    // Field-only interfaces stay structural (aggregate structs) — inheriting
    // those would double-declare fields the class re-states.
    for (const ifaceName of classDef.implementsInterfaces ?? []) {
      const ifaceDef = program.interfaces.find((i: any) => i.name === ifaceName);
      if (ifaceDef && ifaceDef.methods.length > 0) {
        inheritanceParts.push(`public ${ifaceName}`);
      }
    }
    const inheritanceClause = inheritanceParts.length > 0 ? ` : ${inheritanceParts.join(", ")}` : "";

    if (classDef.isAbstract) {
      appendSourceLine(ctx, `// Abstract class - contains pure virtual methods`);
    }
    if (classDef.decorators && (classDef.decorators as string[]).length > 0) {
      for (const dec of classDef.decorators as string[]) {
        if (dec === "sealed") appendSourceLine(ctx, `// @sealed → class marked final`);
        else if (dec === "deprecated") appendSourceLine(ctx, `[[deprecated]]`);
        else if (dec === "nodiscard") appendSourceLine(ctx, `[[nodiscard]]`);
      }
    }
    if (classDef.decorators && (classDef.decorators as string[]).includes("sealed")) {
      if (classDef.typeParameters && classDef.typeParameters.length > 0) {
        appendSourceLine(ctx, `template<typename ${(classDef.typeParameters as string[]).join(", typename ")}>`);
      }
      // `final` must precede the base-clause (`class X final : public Y`).
      // After it (`class X : public Y final`) g++ rejects the derived form
      // ("virt-specifiers ... not allowed outside a class definition").
      appendSourceLine(ctx, `class ${classDef.name} final${inheritanceClause} {`);
    } else {
      if (classDef.typeParameters && classDef.typeParameters.length > 0) {
        appendSourceLine(ctx, `template<typename ${(classDef.typeParameters as string[]).join(", typename ")}>`);
      }
      // A3-1-1: stamp `final` on leaf classes (nothing inherits from them).
      // baseClassesNeeded holds every class name that appears as an
      // extendsClass somewhere in the program. Disabled when autosar is off.
      // `final` precedes the base-clause (see the sealed branch above).
      const isLeaf = !baseClassesNeeded.has(classDef.name);
      const finalKw = ctx.compliance.isEnabled() && isLeaf ? " final" : "";
      appendSourceLine(ctx, `class ${classDef.name}${finalKw}${inheritanceClause} {`);
    }

    const publicFields = classDef.fields.filter(f => f.visibility === "public");
    const constSafeGetters = computeConstSafeGetters(classDef);
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

    const classPointerFieldNames = classDef.fields
      .filter(f => parsedIsPointer(f.cppType))
      .map(f => f.name);
    ctx.currentClassPointerFields = classPointerFieldNames.length > 0 ? classPointerFieldNames : undefined;
    const classPointerFieldTypes = new Map<string, string>();
    for (const f of classDef.fields) {
      if (parsedIsPointer(f.cppType)) {
        classPointerFieldTypes.set(f.name, f.cppType as string);
      }
    }
    ctx.currentClassPointerFieldTypes = classPointerFieldTypes.size > 0 ? classPointerFieldTypes : undefined;

    const needsPublicSection = publicFields.length > 0 || publicMethods.length > 0 || publicGetters.length > 0 || publicSetters.length > 0 || classDef.constructor || ctx.callbackFunctions.length > 0;

    if (needsPublicSection) {
      appendSourceLine(ctx, "public:");
      if (ctx.callbackFunctions.length > 0) {
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

      if (classDef.constructor) {
        const ctorParamsMapped = classDef.constructor.parameters.map(p => ({
          ...p,
          cppType: normalizeCppTypeForTarget(p.cppType)
        }));
        const ctorParams = renderParameters(ctorParamsMapped, true);
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
        addClassFieldsToScope(classDef, ctorScope);
        const classAccessors = classAccessorNames.get(classDef.name);
        if (classAccessors) ctx.varAccessorNames.set("this", classAccessors);
        for (const stmt of ctorStatements) {
          appendRenderedStatement(ctx, stmt, "    ", ctorScope);
        }
        if (classAccessors) ctx.varAccessorNames.delete("this");
        appendSourceLine(ctx, "  }");
        appendSourceLine(ctx, "");
      }

      // Class-typed fields are references, not implicitly owned allocations.
      // Deleting every pointer field here double-frees borrowed constructor
      // parameters and breaks aliasing. Only bases used polymorphically need a
      // generated destructor, and the default destructor is sufficient.
      if (program.classes.some((candidate) => candidate.extendsClass === classDef.name)) {
        appendSourceLine(ctx, `  virtual ~${classDef.name}() = default;`);
        appendSourceLine(ctx, "");
      }

      for (const field of publicFields) {
        if (field.isHalInstance) continue; // no C++ declaration — HAL ops carry it
        const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined)}` : "";
        const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType));
        // Static data member: C++14 allows no in-class initializer for a
        // mutable (or non-integral-const) static — the initializer moves to
        // the out-of-class definition (staticFieldDefs, emitted after `};`).
        if (field.isStatic) {
          staticFieldDefs.push(`${fieldType} ${classDef.name}::${field.name}${initSuffix};`);
          appendSourceLine(ctx, `  static ${renderTypedName(fieldType, field.name)};`);
          continue;
        }
        appendSourceLine(ctx, `  ${renderTypedName(fieldType, field.name)}${initSuffix};`);
      }
      if (publicFields.length > 0) appendSourceLine(ctx, "");

      for (const method of publicMethods) {
        const methodParams = renderParameters(method.parameters, true);
        const staticPrefix = method.isStatic ? "static " : "";
        const returnType = normalizeCppTypeForTarget(method.returnType);
        if (method.isAbstract) {
          appendSourceLine(ctx, `  virtual ${returnType} ${escapeCppKeyword(method.name, reservedNames)}(${methodParams}) = 0;`);
          appendSourceLine(ctx, "");
          continue;
        }
        const virtualSet = virtualMethodNames.get(classDef.name);
        const isVirtual = !method.isStatic && virtualSet?.has(method.name);
        const virtualPrefix = isVirtual ? "virtual " : "";
        const baseMethods = classDef.extendsClass ? classMethodNames.get(classDef.extendsClass) : undefined;
        const isOverrideMethod = !method.isStatic && (method.isOverride || baseMethods?.has(method.name));
        const overrideSuffix = isOverrideMethod ? " override" : "";
        if (method.typeParameters && method.typeParameters.length > 0) {
          appendSourceLine(ctx, `  template<typename ${method.typeParameters.join(", typename ")}>`);
        }
        // Async methods: the body becomes an owner-bound cooperative task
        // (setup.ts generates it); the in-class body just binds the receiver
        // via the forward-declared starter. Return type is void — the task
        // is fire-and-forget.
        const asyncKick = method.isAsync && ctx.hasAsyncRuntime;
        const emittedReturnType = asyncKick ? "void" : returnType;
        appendSourceLine(ctx, `  ${virtualPrefix}${staticPrefix}${emittedReturnType} ${escapeCppKeyword(method.name, reservedNames)}(${methodParams})${overrideSuffix} {`);
        if (asyncKick) {
          appendSourceLine(ctx, `    __tc_async_start_${classDef.name}_${method.name}(this);`);
          appendSourceLine(ctx, "  }");
          appendSourceLine(ctx, "");
          continue;
        }
        const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
        addClassFieldsToScope(classDef, methodScope);
        const classAccessors = classAccessorNames.get(classDef.name);
        if (classAccessors && !method.isStatic) ctx.varAccessorNames.set("this", classAccessors);
        for (const stmt of method.statements) {
          appendRenderedStatement(ctx, stmt, "    ", methodScope);
        }
        if (classAccessors && !method.isStatic) ctx.varAccessorNames.delete("this");
        appendSourceLine(ctx, "  }");
        appendSourceLine(ctx, "");
      }

      for (const getter of publicGetters) {
        const staticPrefix = getter.isStatic ? "static " : "";
        const returnType = normalizeCppTypeForTarget(getter.returnType);
        const getterName = accessorGetterName(getter.name);
        // A `const` cv-qualifier is illegal on a static member function
        // (g++: "static member function ... cannot have cv-qualifier"), and
        // only const-SAFE getters may carry it — one that writes a member or
        // calls a non-const sibling would not compile.
        const constQualifier = getter.isStatic ? "" : constSafeGetters.has(getter.name) ? " const" : "";
        appendSourceLine(ctx, `  ${staticPrefix}${returnType} ${getterName}()${constQualifier} {`);
        const getterScope = createChildEmissionScope(topLevelScope, []);
        addClassFieldsToScope(classDef, getterScope);
        withThisAccessors(classDef, getter.isStatic, () => {
          for (const stmt of getter.statements) {
            appendRenderedStatement(ctx, stmt, "    ", getterScope);
          }
        });
        appendSourceLine(ctx, "  }");
        appendSourceLine(ctx, "");
      }

      for (const setter of publicSetters) {
        const staticPrefix = setter.isStatic ? "static " : "";
        const paramType = normalizeCppTypeForTarget(setter.parameter.cppType);
        const setterName = accessorSetterName(setter.name);
        appendSourceLine(ctx, `  ${staticPrefix}void ${setterName}(${paramType} ${setter.parameter.name}) {`);
        const setterScope = createChildEmissionScope(topLevelScope, [setter.parameter]);
        addClassFieldsToScope(classDef, setterScope);
        withThisAccessors(classDef, setter.isStatic, () => {
          for (const stmt of setter.statements) {
            appendRenderedStatement(ctx, stmt, "    ", setterScope);
          }
        });
        appendSourceLine(ctx, "  }");
        appendSourceLine(ctx, "");
      }
    }

    // Private section
    if (privateFields.length > 0 || privateMethods.length > 0 || privateGetters.length > 0 || privateSetters.length > 0) {
      appendSourceLine(ctx, "private:");
      for (const field of privateFields) {
        if (field.isHalInstance) continue; // no C++ declaration — HAL ops carry it
        const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined)}` : "";
        const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType));
        if (field.isStatic) {
          staticFieldDefs.push(`${fieldType} ${classDef.name}::${field.name}${initSuffix};`);
          appendSourceLine(ctx, `  static ${renderTypedName(fieldType, field.name)};`);
          continue;
        }
        appendSourceLine(ctx, `  ${renderTypedName(fieldType, field.name)}${initSuffix};`);
      }
      if (privateFields.length > 0) appendSourceLine(ctx, "");
      for (const method of privateMethods) {
        const methodParams = renderParameters(method.parameters, true);
        const staticPrefix = method.isStatic ? "static " : "";
        const virtualSet = virtualMethodNames.get(classDef.name);
        const isVirtual = !method.isStatic && virtualSet?.has(method.name);
        const virtualPrefix = isVirtual ? "virtual " : "";
        const baseMethods = classDef.extendsClass ? classMethodNames.get(classDef.extendsClass) : undefined;
        const isOverrideMethod = !method.isStatic && (method.isOverride || baseMethods?.has(method.name));
        const overrideSuffix = isOverrideMethod ? " override" : "";
        if (method.typeParameters && method.typeParameters.length > 0) {
          appendSourceLine(ctx, `  template<typename ${method.typeParameters.join(", typename ")}>`);
        }
        const asyncKick = method.isAsync && ctx.hasAsyncRuntime;
        const emittedReturnType = asyncKick ? "void" : normalizeCppTypeForTarget(method.returnType);
        appendSourceLine(ctx, `  ${virtualPrefix}${staticPrefix}${emittedReturnType} ${escapeCppKeyword(method.name, reservedNames)}(${methodParams})${overrideSuffix} {`);
        if (asyncKick) {
          appendSourceLine(ctx, `    __tc_async_start_${classDef.name}_${method.name}(this);`);
          appendSourceLine(ctx, "  }");
          appendSourceLine(ctx, "");
          continue;
        }
        const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
        addClassFieldsToScope(classDef, methodScope);
        withThisAccessors(classDef, method.isStatic, () => {
          for (const stmt of method.statements) {
            appendRenderedStatement(ctx, stmt, "    ", methodScope);
          }
        });
        appendSourceLine(ctx, "  }");
        appendSourceLine(ctx, "");
      }
      for (const getter of privateGetters) {
        const staticPrefix = getter.isStatic ? "static " : "";
        const returnType = normalizeCppTypeForTarget(getter.returnType);
        const getterName = accessorGetterName(getter.name);
        const constQualifier = getter.isStatic ? "" : constSafeGetters.has(getter.name) ? " const" : "";
        appendSourceLine(ctx, `  ${staticPrefix}${returnType} ${getterName}()${constQualifier} {`);
        const getterScope = createChildEmissionScope(topLevelScope, []);
        addClassFieldsToScope(classDef, getterScope);
        withThisAccessors(classDef, getter.isStatic, () => {
          for (const stmt of getter.statements) {
            appendRenderedStatement(ctx, stmt, "    ", getterScope);
          }
        });
        appendSourceLine(ctx, "  }");
        appendSourceLine(ctx, "");
      }
      for (const setter of privateSetters) {
        const staticPrefix = setter.isStatic ? "static " : "";
        const paramType = normalizeCppTypeForTarget(setter.parameter.cppType);
        const setterName = accessorSetterName(setter.name);
        appendSourceLine(ctx, `  ${staticPrefix}void ${setterName}(${paramType} ${setter.parameter.name}) {`);
        const setterScope = createChildEmissionScope(topLevelScope, [setter.parameter]);
        addClassFieldsToScope(classDef, setterScope);
        withThisAccessors(classDef, setter.isStatic, () => {
          for (const stmt of setter.statements) {
            appendRenderedStatement(ctx, stmt, "    ", setterScope);
          }
        });
        appendSourceLine(ctx, "  }");
        appendSourceLine(ctx, "");
      }
    }

    // Protected section
    if (protectedFields.length > 0 || protectedMethods.length > 0 || protectedGetters.length > 0 || protectedSetters.length > 0) {
      appendSourceLine(ctx, "protected:");
      for (const field of protectedFields) {
        if (field.isHalInstance) continue; // no C++ declaration — HAL ops carry it
        const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined)}` : "";
        const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType));
        if (field.isStatic) {
          staticFieldDefs.push(`${fieldType} ${classDef.name}::${field.name}${initSuffix};`);
          appendSourceLine(ctx, `  static ${renderTypedName(fieldType, field.name)};`);
          continue;
        }
        appendSourceLine(ctx, `  ${renderTypedName(fieldType, field.name)}${initSuffix};`);
      }
      if (protectedFields.length > 0) appendSourceLine(ctx, "");
      for (const method of protectedMethods) {
        const methodParams = renderParameters(method.parameters, true);
        const staticPrefix = method.isStatic ? "static " : "";
        const virtualSet = virtualMethodNames.get(classDef.name);
        const isVirtual = !method.isStatic && virtualSet?.has(method.name);
        const virtualPrefix = isVirtual ? "virtual " : "";
        const baseMethods = classDef.extendsClass ? classMethodNames.get(classDef.extendsClass) : undefined;
        const isOverrideMethod = !method.isStatic && (method.isOverride || baseMethods?.has(method.name));
        const overrideSuffix = isOverrideMethod ? " override" : "";
        if (method.typeParameters && method.typeParameters.length > 0) {
          appendSourceLine(ctx, `  template<typename ${method.typeParameters.join(", typename ")}>`);
        }
        const asyncKick = method.isAsync && ctx.hasAsyncRuntime;
        const emittedReturnType = asyncKick ? "void" : normalizeCppTypeForTarget(method.returnType);
        appendSourceLine(ctx, `  ${virtualPrefix}${staticPrefix}${emittedReturnType} ${escapeCppKeyword(method.name, reservedNames)}(${methodParams})${overrideSuffix} {`);
        if (asyncKick) {
          appendSourceLine(ctx, `    __tc_async_start_${classDef.name}_${method.name}(this);`);
          appendSourceLine(ctx, "  }");
          appendSourceLine(ctx, "");
          continue;
        }
        const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
        addClassFieldsToScope(classDef, methodScope);
        withThisAccessors(classDef, method.isStatic, () => {
          for (const stmt of method.statements) {
            appendRenderedStatement(ctx, stmt, "    ", methodScope);
          }
        });
        appendSourceLine(ctx, "  }");
        appendSourceLine(ctx, "");
      }
      for (const getter of protectedGetters) {
        const staticPrefix = getter.isStatic ? "static " : "";
        const returnType = normalizeCppTypeForTarget(getter.returnType);
        const getterName = accessorGetterName(getter.name);
        const constQualifier = getter.isStatic ? "" : constSafeGetters.has(getter.name) ? " const" : "";
        appendSourceLine(ctx, `  ${staticPrefix}${returnType} ${getterName}()${constQualifier} {`);
        const getterScope = createChildEmissionScope(topLevelScope, []);
        addClassFieldsToScope(classDef, getterScope);
        withThisAccessors(classDef, getter.isStatic, () => {
          for (const stmt of getter.statements) {
            appendRenderedStatement(ctx, stmt, "    ", getterScope);
          }
        });
        appendSourceLine(ctx, "  }");
        appendSourceLine(ctx, "");
      }
      for (const setter of protectedSetters) {
        const staticPrefix = setter.isStatic ? "static " : "";
        const paramType = normalizeCppTypeForTarget(setter.parameter.cppType);
        const setterName = accessorSetterName(setter.name);
        appendSourceLine(ctx, `  ${staticPrefix}void ${setterName}(${paramType} ${setter.parameter.name}) {`);
        const setterScope = createChildEmissionScope(topLevelScope, [setter.parameter]);
        addClassFieldsToScope(classDef, setterScope);
        withThisAccessors(classDef, setter.isStatic, () => {
          for (const stmt of setter.statements) {
            appendRenderedStatement(ctx, stmt, "    ", setterScope);
          }
        });
        appendSourceLine(ctx, "  }");
        appendSourceLine(ctx, "");
      }
    }

    appendSourceLine(ctx, "};");
    // Out-of-class definitions for the class's static data members (C++14 —
    // see staticFieldDefs above). In split mode these hold back: the class
    // (and this `};` block) swaps into the HEADER below, and a definition
    // baked into a header included by several TUs is a multiple-definition
    // link error (`Pid::constructed` defined by control.cpp.obj AND
    // src.cpp.obj). Split mode appends them to the SOURCE stream after the
    // swap — one definition, in the class's own module .cpp, matching the
    // in-class `static T field;` declaration every TU sees.
    if (effectiveEmitMode !== "split") {
      for (const def of staticFieldDefs) {
        appendSourceLine(ctx, def);
      }
    } else {
      staticFieldDefsAll.push(...staticFieldDefs);
    }
    emitCommentLines(classDef.trailingComments, "", (line) => appendSourceLine(ctx, line));
    appendSourceLine(ctx, "");
    ctx.currentClassPointerFields = undefined;
    ctx.currentClassPointerFieldTypes = undefined;
  }

  if (effectiveEmitMode === "split") {
    const _swapLines = ctx.sourceLines;
    ctx.sourceLines = ctx.headerLines;
    ctx.headerLines = _swapLines;
    const _swapMaps = ctx.sourceMapEntries;
    ctx.sourceMapEntries = ctx.headerMapEntries;
    ctx.headerMapEntries = _swapMaps;
    // The static data-member definitions deferred above land in the SOURCE
    // stream (the module's .cpp) — after the swap, so ordering with the
    // class definition in the header (which the .cpp includes) is correct.
    for (const def of staticFieldDefsAll) {
      appendSourceLine(ctx, def);
    }
  }
}
