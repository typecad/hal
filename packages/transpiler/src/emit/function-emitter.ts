import type { StatementIR } from "../ir/model";
import type { PlatformStrategy } from "../platform/platform-strategy";
import type { BoardConstants } from "../ir/board-resolver";

/**
 * Context for function emission.
 */
interface FunctionEmitterContext {
  /** The platform strategy */
  strategy: PlatformStrategy;
  /** Board constants */
  boardConstants?: BoardConstants;
  /** Framework class name map */
  classNameMap?: Map<string, string>;
  /** Enum names for scoped access */
  enumNames: Set<string>;
  /** Large enum names */
  largeEnumNames: Set<string>;
  /** Function return types */
  knownFunctionReturnTypes: Map<string, string>;
  /** Pointer variable types */
  pointerVarTypes?: Map<string, string>;
  /** Pointer struct fields */
  pointerStructFields?: Set<string>;
}

/**
 * Function definition for emission.
 */
interface FunctionDefForEmit {
  name: string;
  originalName?: string;
  returnType: string;
  parameters: Array<{ name: string; cppType: string; defaultValue?: any }>;
  statements: StatementIR[];
  isAsync?: boolean;
  leadingComments?: string[];
  trailingComments?: string[];
  sourceSpan?: any;
}

/**
 * Callback function definition for emission.
 */
interface CallbackDefForEmit {
  name: string;
  params: string[];
  statements: StatementIR[];
  debounceMs?: number;
}