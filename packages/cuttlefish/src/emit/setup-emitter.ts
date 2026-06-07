import type { StatementIR } from "../api";
import type { PlatformStrategy } from "../api/shared";
import type { BoardConstants } from "../ir/board-resolver";
import type { PlatformContext } from "../types";

/**
 * Context for setup/loop emission.
 */
interface SetupEmitterContext {
  /** The platform strategy */
  strategy: PlatformStrategy;
  /** Board constants */
  boardConstants?: BoardConstants;
  /** Platform context */
  platformContext?: PlatformContext;
}

/**
 * Result of setup/loop generation.
 */
interface SetupLoopResult {
  /** Setup function statements */
  setupStatements: StatementIR[];
  /** Whether a loop function is required */
  requiresLoop: boolean;
  /** Loop function comments */
  loopComments?: string[];
  /** Main function needed (for non-Arduino targets) */
  needsMain: boolean;
}