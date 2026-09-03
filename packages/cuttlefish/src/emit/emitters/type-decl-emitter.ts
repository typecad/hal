import { emitCommentLines, isRuntimeExpression } from "../utils/index.js";
import { appendSourceLine, appendHeaderLine, appendRenderedStatement } from "./line-appender.js";
import type { EmitterContext } from "./emitter-context.js";
import { escapeCppKeyword } from "../../utils/strings.js";
import { isStringEnum } from "../../api/shared/index.js";
import { parsedIsVector } from "../../api/shared/cpp-type-ir.js";
import { resolveEnumValues, narrowestEnumUnderlying } from "../utils/cpp-helpers.js";

export function emitTypeDeclarations(ctx: EmitterContext): void {
  const { program, strategy, effectiveEmitMode, reservedNames, emittedTopLevelStatements, topLevelScope } = ctx;
  const normalizeCppTypeForTarget = (cppType: string) => {
    // A3-9-1: resolve "auto" and substitute "int" with the fixed-width
    // default — but ONLY when autosar is active. When off, fall through to
    // the strategy's normalizeCppType (Arduino returns "auto" for "auto").
    const autosarOn = ctx.compliance.isEnabled() && ctx.compliance.isBanned("A3-9-1");
    if (autosarOn && (cppType === "auto" || cppType === "int")) {
      return strategy.defaultNumericType(ctx.compliance);
    }
    // Also apply the int->int32_t substitution to the inner template argument
    // of safety wrappers (SafeInt<int> -> SafeInt<int32_t>, SafeVariable<int>
    // -> SafeVariable<int32_t>). The whole-type check above misses these
    // because the full string is "Name<int>", not "int".
    if (autosarOn) {
      const wrapperMatch = cppType.match(/^(Safe(?:Int|Variable))<int>$/);
      if (wrapperMatch) {
        const fixedWidth = strategy.defaultNumericType(ctx.compliance);
        return `${wrapperMatch[1]}<${fixedWidth}>`;
      }
    }
    return strategy.normalizeCppType(cppType);
  };

  // Split-mode header include + forward declarations
  if (effectiveEmitMode === "split") {
    appendSourceLine(ctx, `#include \"${ctx.baseName}.h\"`);
  }
  if (effectiveEmitMode === "split" && program.classes.length > 0) {
    for (const classDef of program.classes) {
      if (classDef.typeParameters && classDef.typeParameters.length > 0) {
        const templateParams = classDef.typeParameters.map((p: string) => `typename ${p}`).join(", ");
        appendHeaderLine(ctx, `template<${templateParams}> class ${classDef.name};`);
      } else {
        appendHeaderLine(ctx, `class ${classDef.name};`);
      }
    }
    appendHeaderLine(ctx, "");
  }
  if (effectiveEmitMode !== "split" && program.classes.length > 0) {
    for (const classDef of program.classes) {
      if (classDef.typeParameters && classDef.typeParameters.length > 0) {
        const templateParams = classDef.typeParameters.map((p: string) => `typename ${p}`).join(", ");
        appendSourceLine(ctx, `template<${templateParams}> class ${classDef.name};`);
      } else {
        appendSourceLine(ctx, `class ${classDef.name};`);
      }
    }
    appendSourceLine(ctx, "");
  }

  // Emit register-mapped structs
  for (const reg of program.registerClasses ?? []) {
    const addrHex = '0x' + reg.address.toString(16).toUpperCase().replace(/^0X/, '');
    emitCommentLines(reg.leadingComments, "", (line) => appendSourceLine(ctx, line));
    appendSourceLine(ctx, `volatile uint32_t* const ${reg.name} = reinterpret_cast<volatile uint32_t*>(${addrHex});`);
    emitCommentLines(reg.trailingComments, "", (line) => appendSourceLine(ctx, line));
  }
  if ((program.registerClasses?.length ?? 0) > 0) {
    appendSourceLine(ctx, "");
  }

  // Emit enums
  const apiReservedEnums = strategy.apiReservedEnumNames();
  for (const enumDef of program.enums) {
    const appendLine = effectiveEmitMode === "split" ? appendHeaderLine : appendSourceLine;
    emitCommentLines(enumDef.leadingComments, "", (line) => appendLine(ctx, line));

    // String enums are lowered to a namespace of `constexpr const char*`
    // constants so member access yields a `const char*`. This makes `===`
    // comparisons against string literals and string concatenation behave
    // like TypeScript (see isStringEnum). Mixed enums fall through to the
    // numeric `enum class` path below.
    if (isStringEnum(enumDef)) {
      appendLine(ctx, `namespace ${enumDef.name} {`);
      for (const member of enumDef.members) {
        const memberName = ctx.reservedNames.has(member.name)
          ? `_${member.name}`
          : member.name;
        const renamed = strategy.renameEnumMember(enumDef.name, memberName);
        // value is a string (guaranteed by isStringEnum); escape for C++ literal
        const escaped = String(member.value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        appendLine(ctx, `  constexpr const char* ${renamed} = "${escaped}";`);
      }
      appendLine(ctx, "}");
      emitCommentLines(enumDef.trailingComments, "", (line) => appendLine(ctx, line));
      appendLine(ctx, "");
      continue;
    }

    const enumKeyword = "enum class";
    const underlyingType = narrowestEnumUnderlying(
      resolveEnumValues(enumDef.members),
      strategy.needsLargeEnumUnderlying(),
    );
    const guard = apiReservedEnums.has(enumDef.name) ? strategy.enumApiGuard(enumDef.name) : undefined;
    if (guard) {
      appendLine(ctx, guard.open);
    }
    appendLine(ctx, `${enumKeyword} ${enumDef.name}${underlyingType} {`);
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
      const memberName = ctx.reservedNames.has(member.name)
        ? `_${member.name}`
        : member.name;
      appendLine(ctx, `  ${memberName}${valueSuffix}${commaSuffix}`);
    }
    appendLine(ctx, "};");
    if (guard) {
      appendLine(ctx, guard.close);
    }
    emitCommentLines(enumDef.trailingComments, "", (line) => appendLine(ctx, line));
    appendLine(ctx, "");
  }

  // Emit interfaces as C++ structs BEFORE type aliases — an alias may
  // reference an interface (`using EntryPatch = Entry;`), so the struct must
  // be declared first (demo #10 fix A: alias-to-user-type ordering).
  for (const iface of program.interfaces) {
    const appendLine = effectiveEmitMode === "split" ? appendHeaderLine : appendSourceLine;
    emitCommentLines(iface.leadingComments, "", (line) => appendLine(ctx, line));
    if (iface.fields.length > 0 || iface.indexSignature) {
      if (iface.parentScope) {
        appendLine(ctx, `namespace ${iface.parentScope} {`);
        ctx.interfaceNamespaceMap.set(iface.name, iface.parentScope);
      }
      const typeParams = new Set<string>();
      for (const field of iface.fields) {
        if (/^[A-Z]$/.test(field.cppType)) {
          typeParams.add(field.cppType);
        }
      }
      if (typeParams.size > 0) {
        appendLine(ctx, `template<typename ${Array.from(typeParams).join(", typename ")}>`);
      }
      appendLine(ctx, `struct ${iface.name} {`);
      for (const field of iface.fields) {
        const fieldType = normalizeCppTypeForTarget(field.cppType);
        // Escape the field name with the SAME function class-field declarations
        // and field accesses use (escapeCppKeyword over reservedNames), so an
        // interface/struct field named like an Arduino macro (`min`/`max`) is
        // declared `min_`/`max_` to MATCH the renamed accesses (`s.min_`).
        // Previously interface fields used the bare name while declarations
        // (escapeCppKeyword → suffix `_`) and accesses (escapeFinalMemberName)
        // disagreed, so `struct Stats { int32_t min; }` was accessed as
        // `s.min_` → g++ "has no member named 'min_'". Demo #33 Finding D.
        const safeFieldName = escapeCppKeyword(field.name, reservedNames);
        appendLine(ctx, `  ${fieldType} ${safeFieldName};`);
      }
      if (iface.indexSignature) {
        const keyType = normalizeCppTypeForTarget(iface.indexSignature.keyType);
        const valueType = normalizeCppTypeForTarget(iface.indexSignature.valueType);
        appendLine(ctx, `  std::map<${keyType}, ${valueType}> data;`);
      }
      appendLine(ctx, "};");
      if (iface.parentScope) {
        appendLine(ctx, "}");
      }
    }
    emitCommentLines(iface.trailingComments, "", (line) => appendLine(ctx, line));
    appendLine(ctx, "");
  }

  // Emit type aliases (after interfaces, so alias-to-struct refs resolve).
  for (const typeAlias of program.typeAliases) {
    const appendLine = effectiveEmitMode === "split" ? appendHeaderLine : appendSourceLine;
    emitCommentLines(typeAlias.leadingComments, "", (line) => appendLine(ctx, line));

    if (typeAlias.variantStructs && typeAlias.variantStructs.length > 0) {
      for (const variant of typeAlias.variantStructs) {
        appendLine(ctx, `struct ${variant.name} {`);
        for (const field of variant.fields) {
          const fieldType = normalizeCppTypeForTarget(field.cppType);
          appendLine(ctx, `  ${fieldType} ${field.name};`);
        }
        appendLine(ctx, "};");
      }
      appendLine(ctx, `using ${typeAlias.name} = ${normalizeCppTypeForTarget(typeAlias.cppType)};`);
      emitCommentLines(typeAlias.trailingComments, "", (line) => appendLine(ctx, line));
      appendLine(ctx, "");
      continue;
    }

    if (typeAlias.structFields && typeAlias.structFields.length > 0) {
      if (typeAlias.typeParameters && typeAlias.typeParameters.length > 0) {
        appendLine(ctx, `template<typename ${typeAlias.typeParameters.join(", typename ")}>`);
      }
      appendLine(ctx, `struct ${typeAlias.name} {`);
      for (const field of typeAlias.structFields) {
        const fieldType = normalizeCppTypeForTarget(field.cppType);
        appendLine(ctx, `  ${fieldType} ${field.name};`);
      }
      appendLine(ctx, "};");
      emitCommentLines(typeAlias.trailingComments, "", (line) => appendLine(ctx, line));
      appendLine(ctx, "");
      continue;
    }
    const cppType = normalizeCppTypeForTarget(typeAlias.cppType);
    if (cppType === "auto") continue;
    if (strategy.shouldSkipTypeAlias(cppType)) continue;
    appendLine(ctx, `using ${typeAlias.name} = ${cppType};`);
    emitCommentLines(typeAlias.trailingComments, "", (line) => appendLine(ctx, line));
    appendLine(ctx, "");
  }

  // Emit top-level constant declarations BEFORE classes
  for (const statement of emittedTopLevelStatements) {
    if (statement.kind === "var_decl" && statement.initializer && isRuntimeExpression(statement.initializer)) {
      continue;
    }
    appendRenderedStatement(ctx, statement, "", topLevelScope);
  }
  if (emittedTopLevelStatements.some(s =>
    s.kind === "var_decl" &&
    !(s.initializer && isRuntimeExpression(s.initializer))
  )) {
    appendSourceLine(ctx, "");
  }

  // In split mode, emit extern declarations for exported top-level variables
  if (effectiveEmitMode === "split") {
    const platformReservedNames = strategy.reservedNames();
    const crossModuleVarTypes = ctx.options.crossModuleVariableTypes;
    let emitted = false;
    for (const statement of emittedTopLevelStatements) {
      if (statement.kind !== "var_decl") continue;
      if (statement.initializer && isRuntimeExpression(statement.initializer)) continue;
      let cppType = strategy.normalizeCppType(statement.cppType);
      if (cppType === "auto" && crossModuleVarTypes) {
        const resolved = crossModuleVarTypes.get(statement.name);
        if (resolved) cppType = strategy.normalizeCppType(resolved);
      }
      const isConst = statement.storage === "const";
      // A const-qualified top-level variable whose cppType already begins with
      // `const` (e.g. a string-literal global lowered as `const char*`) would
      // otherwise emit `extern const const char* X;` — a duplicate-const error.
      // Don't prepend the storage qualifier when the type already carries it.
      const typeAlreadyConst = cppType.trimStart().startsWith("const");
      const constPrefix = isConst && !typeAlreadyConst ? "const " : "";
      const varName = escapeCppKeyword(statement.name, platformReservedNames);
      // Array-typed top-level consts (e.g. `export const ARR: T[] = [...]`
      // and `new Uint8Array(N)` buffers) lower with an `{ kind: "array",
      // elementType }` initializer — typed arrays carry a pointer cppType
      // (`uint8_t*`) even though renderVarDecl emits the DEFINITION as a
      // C-style array (`T name[] = {...}`). The matching extern must use the
      // same array form regardless of cppType — a pointer extern conflicts
      // with the array definition. Vector-typed arrays are the exception: the
      // definition emits `std::vector<T> name = {...}`, so the extern stays a
      // vector extern. Without this, cross-file consumers fail with "was not
      // declared in this scope" (the definition lives in the .cpp only).
      // Mirror renderVarDecl's element-type fallback for "auto".
      if (statement.initializer && statement.initializer.kind === "array" && !parsedIsVector(cppType)) {
        const elemType = statement.initializer.elementType && statement.initializer.elementType !== "auto"
          ? strategy.normalizeCppType(statement.initializer.elementType)
          : strategy.defaultNumericType(ctx.compliance.isEnabled() ? ctx.compliance : undefined);
        appendHeaderLine(ctx, `extern ${constPrefix}${elemType} ${varName}[];`);
        emitted = true;
        continue;
      }
      if (cppType === "auto") continue;
      appendHeaderLine(ctx, `extern ${constPrefix}${cppType} ${varName};`);
      emitted = true;
    }
    if (emitted) {
      appendHeaderLine(ctx, "");
    }
  }
}
