/**
 * Enum Emitter for C++ code emission.
 * Handles rendering of enums and type aliases.
 * Extracted from cpp-emitter.ts
 */

import type { PlatformStrategy } from "../platform/platform-strategy";
import { emitCommentLines } from "./utils";

/**
 * Context for enum emission.
 */
export interface EnumEmitterContext {
  /** The platform strategy */
  strategy: PlatformStrategy;
  /** Set of enum names with values outside 16-bit int range */
  largeEnumNames: Set<string>;
  /** Reserved names that need prefixing */
  reservedNames: Set<string>;
  /** API reserved enum names that need guards */
  apiReservedEnums: Set<string>;
}

/**
 * Enum definition for emission.
 */
export interface EnumDefForEmit {
  name: string;
  members: Array<{ name: string; value?: number }>;
  isConst?: boolean;
  leadingComments?: string[];
  trailingComments?: string[];
}

/**
 * Type alias definition for emission.
 */
export interface TypeAliasForEmit {
  name: string;
  cppType: string;
  leadingComments?: string[];
  trailingComments?: string[];
}

/**
 * Handles emission of C++ enums and type aliases.
 */
export class EnumEmitter {
  private readonly strategy: PlatformStrategy;
  private readonly largeEnumNames: Set<string>;
  private readonly reservedNames: Set<string>;
  private readonly apiReservedEnums: Set<string>;

  constructor(context: EnumEmitterContext) {
    this.strategy = context.strategy;
    this.largeEnumNames = context.largeEnumNames;
    this.reservedNames = context.reservedNames;
    this.apiReservedEnums = context.apiReservedEnums;
  }

  /**
   * Renders an enum definition.
   */
  renderEnum(
    enumDef: EnumDefForEmit,
    appendLine: (line: string) => void
  ): void {
    emitCommentLines(enumDef.leadingComments, "", (line) => appendLine(line));
    
    // Add explicit underlying type for enums with large values
    const needsLongUnderlying = this.strategy.needsLargeEnumUnderlying() &&
      enumDef.members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768));
    const underlyingType = needsLongUnderlying ? " : long" : "";
    
    // Guard enum classes that conflict with target API typedef declarations
    const needsApiGuard = this.apiReservedEnums.has(enumDef.name);
    
    if (needsApiGuard) {
      appendLine(`#if !defined(ARDUINO_API_VERSION)`);
    }
    
    appendLine(`enum class ${enumDef.name}${underlyingType} {`);
    
    for (let i = 0; i < enumDef.members.length; i++) {
      const member = enumDef.members[i];
      const valueSuffix = member.value !== undefined ? ` = ${member.value}` : "";
      const commaSuffix = i < enumDef.members.length - 1 ? "," : "";
      
      // Prefix reserved names for platform compatibility
      const memberName = this.reservedNames.has(member.name)
        ? `_${member.name}`
        : member.name;
      
      appendLine(`  ${memberName}${valueSuffix}${commaSuffix}`);
    }
    
    appendLine("};");
    
    if (needsApiGuard) {
      appendLine(`#endif // !defined(ARDUINO_API_VERSION)`);
    }
    
    emitCommentLines(enumDef.trailingComments, "", (line) => appendLine(line));
    appendLine("");
  }

  /**
   * Renders a type alias.
   */
  renderTypeAlias(
    typeAlias: TypeAliasForEmit,
    appendLine: (line: string) => void
  ): void {
    emitCommentLines(typeAlias.leadingComments, "", (line) => appendLine(line));
    
    const cppType = this.strategy.normalizeCppType(typeAlias.cppType);
    
    // Skip type aliases with 'auto' (not valid in C++ type aliases)
    if (cppType === "auto") {
      return;
    }
    
    // Skip if strategy decides to skip (e.g., std::string on AVR)
    if (this.strategy.shouldSkipTypeAlias(cppType)) {
      return;
    }
    
    appendLine(`using ${typeAlias.name} = ${cppType};`);
    
    emitCommentLines(typeAlias.trailingComments, "", (line) => appendLine(line));
    appendLine("");
  }

  /**
   * Renders multiple enums.
   */
  renderEnums(
    enums: EnumDefForEmit[],
    appendLine: (line: string) => void
  ): void {
    for (const enumDef of enums) {
      this.renderEnum(enumDef, appendLine);
    }
  }

  /**
   * Renders multiple type aliases.
   */
  renderTypeAliases(
    typeAliases: TypeAliasForEmit[],
    appendLine: (line: string) => void
  ): void {
    for (const typeAlias of typeAliases) {
      this.renderTypeAlias(typeAlias, appendLine);
    }
  }
}