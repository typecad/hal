/**
 * Emitter State - Encapsulates all mutable state for C++ code emission.
 * 
 * This class replaces the module-level mutable state previously used in cpp-emitter.ts:
 * - _emitBoardConstants
 * - _arduinoClassNameMap
 * - _emitEnumNames
 * - _largeEnumNames
 * - _defaultStrategy
 * 
 * Using a state object makes dependencies explicit, improves testability,
 * and enables concurrent transpilation.
 * 
 * Note: This is different from the EmitterContext interface in base-emitter.ts
 * which is for configuration. This class is for mutable state tracking.
 */

import type { PlatformStrategy } from "../platform/platform-strategy";
import type { BoardConstants } from "../ir/board-resolver";

/**
 * Mutable state for a single transpilation run.
 * Tracks enums, types, and other information needed during emission.
 */
export class EmitterState {
  /** Board constants for Board.definition.* access */
  boardConstants: BoardConstants | undefined = undefined;

  /** Map of Arduino class simple names to fully qualified names (with namespaces) */
  arduinoClassNameMap: Map<string, string> = new Map();

  /** Set of enum class names for scoped enum access (::) */
  enumNames: Set<string> = new Set();

  /** Set of enum names with values outside 16-bit int range (need `long` underlying type on AVR) */
  largeEnumNames: Set<string> = new Set();

  /** The platform strategy for target-specific rendering */
  strategy: PlatformStrategy;

  /** Map of function names to their return types */
  knownFunctionReturnTypes: Map<string, string> = new Map();

  /** Map of variable names to their pointer types (for -> access) */
  pointerVarTypes: Map<string, string> = new Map();

  /** Set of pointer struct fields for -> access (e.g., "Board.A0") */
  pointerStructFields: Set<string> = new Set();

  constructor(strategy: PlatformStrategy) {
    this.strategy = strategy;
  }

  /**
   * Registers an enum name for scoped enum access.
   * Also checks if the enum needs a `long` underlying type on AVR.
   */
  registerEnum(name: string, members: { name: string; value?: number }[]): void {
    this.enumNames.add(name);
    if (members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768))) {
      this.largeEnumNames.add(name);
    }
  }

  /**
   * Registers multiple enums at once.
   */
  registerEnums(enums: Iterable<{ name: string; members: { name: string; value?: number }[] }>): void {
    for (const e of enums) {
      this.registerEnum(e.name, e.members);
    }
  }

  /**
   * Checks if an enum name has large values (outside 16-bit int range).
   */
  hasLargeEnum(name: string): boolean {
    return this.largeEnumNames.has(name);
  }

  /**
   * Checks if a name is a registered enum.
   */
  isEnum(name: string): boolean {
    return this.enumNames.has(name);
  }

  /**
   * Clears all state for reuse.
   */
  reset(): void {
    this.boardConstants = undefined;
    this.arduinoClassNameMap.clear();
    this.enumNames.clear();
    this.largeEnumNames.clear();
    this.knownFunctionReturnTypes.clear();
    this.pointerVarTypes.clear();
    this.pointerStructFields.clear();
  }
}

/**
 * Creates a new emitter state with the given strategy.
 */
export function createEmitterState(strategy: PlatformStrategy): EmitterState {
  return new EmitterState(strategy);
}
