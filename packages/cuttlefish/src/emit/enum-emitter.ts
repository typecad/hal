import type { PlatformStrategy } from "../api/shared/index.js";

/**
 * Context for enum emission.
 */
interface EnumEmitterContext {
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
interface EnumDefForEmit {
  name: string;
  members: Array<{ name: string; value?: number }>;
  isConst?: boolean;
  leadingComments?: string[];
  trailingComments?: string[];
}

/**
 * Type alias definition for emission.
 */
interface TypeAliasForEmit {
  name: string;
  cppType: string;
  leadingComments?: string[];
  trailingComments?: string[];
}