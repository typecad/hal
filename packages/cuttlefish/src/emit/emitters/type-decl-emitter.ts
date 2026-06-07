import { emitCommentLines, isRuntimeExpression } from "../utils";
import { appendSourceLine, appendHeaderLine, appendRenderedStatement } from "./line-appender";
import type { EmitterContext } from "./emitter-context";

export function emitTypeDeclarations(ctx: EmitterContext): void {
  const { program, strategy, effectiveEmitMode, platformReservedNames, emittedTopLevelStatements, topLevelScope } = ctx;
  const normalizeCppTypeForTarget = (cppType: string) => strategy.normalizeCppType(cppType);

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
    const enumKeyword = "enum class";
    const needsLongUnderlying = strategy.needsLargeEnumUnderlying() &&
      enumDef.members.some(m => typeof m.value === "number" && (m.value > 32767 || m.value < -32768));
    const underlyingType = needsLongUnderlying ? " : long" : "";
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

  // Emit type aliases
  for (const typeAlias of program.typeAliases) {
    const appendLine = effectiveEmitMode === "split" ? appendHeaderLine : appendSourceLine;
    emitCommentLines(typeAlias.leadingComments, "", (line) => appendLine(ctx, line));
    if (typeAlias.structFields && typeAlias.structFields.length > 0) {
      if ((typeAlias as any).typeParameters && (typeAlias as any).typeParameters.length > 0) {
        appendLine(ctx, `template<typename ${(typeAlias as any).typeParameters.join(", typename ")}>`);
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

  // Emit interfaces as C++ structs
  for (const iface of program.interfaces) {
    const appendLine = effectiveEmitMode === "split" ? appendHeaderLine : appendSourceLine;
    emitCommentLines(iface.leadingComments, "", (line) => appendLine(ctx, line));
    if (iface.fields.length > 0) {
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
        appendLine(ctx, `  ${fieldType} ${field.name};`);
      }
      appendLine(ctx, "};");
      if (iface.parentScope) {
        appendLine(ctx, "}");
      }
    }
    emitCommentLines(iface.trailingComments, "", (line) => appendLine(ctx, line));
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
}
