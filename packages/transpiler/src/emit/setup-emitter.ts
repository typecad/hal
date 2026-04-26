/**
 * Setup Emitter for C++ code emission.
 * Handles generation of setup(), loop(), and main() functions.
 * Extracted from cpp-emitter.ts
 */

import type { StatementIR, ExpressionIR } from "../ir/model";
import type { PlatformStrategy } from "../platform/platform-strategy";
import type { BoardConstants } from "../ir/board-resolver";
import type { ProgramIR } from "../ir/model";
import type { PlatformContext } from "../types";

/**
 * Context for setup/loop emission.
 */
export interface SetupEmitterContext {
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
export interface SetupLoopResult {
  /** Setup function statements */
  setupStatements: StatementIR[];
  /** Whether a loop function is required */
  requiresLoop: boolean;
  /** Loop function comments */
  loopComments?: string[];
  /** Main function needed (for non-Arduino targets) */
  needsMain: boolean;
}

/**
 * Handles generation of setup(), loop(), and main() functions.
 */
export class SetupEmitter {
  private readonly strategy: PlatformStrategy;
  private readonly boardConstants?: BoardConstants;
  private readonly platformContext?: PlatformContext;

  constructor(context: SetupEmitterContext) {
    this.strategy = context.strategy;
    this.boardConstants = context.boardConstants;
    this.platformContext = context.platformContext;
  }

  /**
   * Creates setup statements from platform init code and polyfills.
   */
  createSetupStatements(
    program: ProgramIR,
    polyfillSetupLines: string[]
  ): StatementIR[] {
    const setupStmts: StatementIR[] = [];

    // Get platform-specific setup init code (e.g., UART initialization)
    const setupInitLines = this.strategy.setupInitCode?.(program, this.platformContext) ?? [];
    
    // Add platform init statements
    for (const line of setupInitLines) {
      setupStmts.push(this.createRawCallStatement(line, program));
    }

    // Add polyfill setup statements
    for (const line of polyfillSetupLines) {
      setupStmts.push(this.createRawCallStatement(line, program));
    }

    return setupStmts;
  }

  /**
   * Merges top-level executables into the entrypoint function.
   */
  mergeTopLevelIntoEntrypoint(
    existingEp: { statements: StatementIR[] } | undefined,
    topLevelExecutables: StatementIR[],
    setupStatements: StatementIR[],
    entrypointName: string,
    program: ProgramIR
  ): { statements: StatementIR[]; isNew: boolean } {
    const allSetupStmts = [...setupStatements, ...topLevelExecutables];

    if (existingEp) {
      // Prepend to existing entrypoint
      return {
        statements: [...allSetupStmts, ...existingEp.statements],
        isNew: false,
      };
    }

    // Create new entrypoint
    if (entrypointName === "main") {
      // Generic C++: int main() with return 0
      return {
        statements: [
          ...allSetupStmts,
          {
            kind: "return" as const,
            sourceSpan: this.createDefaultSourceSpan(program),
            value: { kind: "number" as const, value: 0 },
          } as StatementIR,
        ],
        isNew: true,
      };
    } else {
      // Arduino: void setup()
      return {
        statements: allSetupStmts,
        isNew: true,
      };
    }
  }

  /**
   * Determines if loop function is needed and creates it.
   */
  createLoopFunction(
    hasAsyncRuntime: boolean,
    existingLoop: { statements: StatementIR[] } | undefined,
    program: ProgramIR
  ): { needed: boolean; comments?: string[] } {
    const requiresLoop = this.strategy.requiresLoopFunction();

    if (existingLoop) {
      return { needed: true };
    }

    if (requiresLoop) {
      return {
        needed: true,
        comments: hasAsyncRuntime
          ? ["// Auto-generated loop() for async microtask pumping"]
          : undefined,
      };
    }

    return { needed: false };
  }

  /**
   * Determines if main function is needed for non-Arduino targets.
   */
  needsMainFunction(
    hasAsyncRuntime: boolean,
    hasLoopFunction: boolean,
    hasExistingMain: boolean
  ): boolean {
    // Only generate main() for entry files when there's no loop-based strategy
    return hasAsyncRuntime && !this.strategy.requiresLoopFunction() && !hasExistingMain;
  }

  /**
   * Gets the entrypoint function name for the platform.
   */
  getEntrypointName(): string {
    return this.strategy.entrypointFunctionName();
  }

  /**
   * Gets the async driver function name (usually "loop").
   */
  getAsyncDriverName(): string {
    return this.strategy.asyncDriverFunctionName();
  }

  private createRawCallStatement(line: string, program: ProgramIR): StatementIR {
    return {
      kind: "call" as const,
      callee: `__RAW_STMT__${line}`,
      args: [],
      sourceSpan: this.createDefaultSourceSpan(program),
    };
  }

  private createDefaultSourceSpan(program: ProgramIR): any {
    return {
      filePath: program.fileName,
      startOffset: 0,
      endOffset: 0,
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 1,
    };
  }
}