/**
 * Polyfill Generator.
 * Automatically generates platform-appropriate polyfills based on detected needs.
 */

import { ProgramIR } from "../ir/model";
import {
  ArchitectureCapabilities,
  getArchitectureCapabilities,
  resolvePolyfillTemplate,
  POLYFILL_TEMPLATES,
  type ResolvedPolyfill,
} from "./template-types";
import { PolyfillConfig, RuntimePolyfillIR } from "./types";

// Import templates to register them
import "./templates";

/**
 * Detected polyfill need from program analysis.
 */
export interface DetectedPolyfillNeed {
  templateId: string;
  usageCount: number;
  config: Record<string, any>;
}

/**
 * Result of polyfill generation.
 */
export interface PolyfillGenerationResult {
  /** Combined C++ code for all polyfills */
  code: string;
  /** All required includes */
  includes: string[];
  /** All forward declarations */
  forwardDeclarations: string[];
  /** Setup statements to inject */
  setupStatements: string[];
  /** Individual resolved polyfills */
  polyfills: ResolvedPolyfill[];
}

/**
 * Polyfill Generator class.
 * Analyzes program IR and generates appropriate polyfills for the target architecture.
 */
export class PolyfillGenerator {
  private readonly capabilities: ArchitectureCapabilities;
  private readonly config: PolyfillConfig;

  constructor(architecture?: string, config?: Partial<PolyfillConfig>) {
    this.capabilities = getArchitectureCapabilities(architecture);
    this.config = { ...getDefaultConfig(), ...config };
  }

  /**
   * Analyzes a program and detects which polyfills are needed.
   */
  detectNeeds(program: ProgramIR): DetectedPolyfillNeed[] {
    const needs: Map<string, DetectedPolyfillNeed> = new Map();

    // Helper to track need
    const trackNeed = (templateId: string, config: Record<string, any> = {}) => {
      const existing = needs.get(templateId);
      if (existing) {
        existing.usageCount++;
        existing.config = { ...existing.config, ...config };
      } else {
        needs.set(templateId, { templateId, usageCount: 1, config });
      }
    };

    // Analyze program for polyfill needs
    this.detectArrayNeeds(program, trackNeed);
    this.detectStringNeeds(program, trackNeed);
    this.detectConsoleNeeds(program, trackNeed);

    return Array.from(needs.values());
  }

  /**
   * Detects array method usage.
   */
  private detectArrayNeeds(
    program: ProgramIR,
    trackNeed: (id: string, config: Record<string, any>) => void
  ): void {
    const arrayMethods = ["push", "pop", "shift", "unshift", "length", "map", "filter", "forEach", "indexOf", "contains"];

    const checkStatement = (stmt: any): void => {
      if (stmt.kind === "call" && stmt.callee) {
        for (const method of arrayMethods) {
          if (stmt.callee.includes(`.${method}`) || stmt.callee.includes(`.${method}(`)) {
            trackNeed("static_array", {
              maxSize: this.config.arrays?.staticMaxSize ?? this.capabilities.recommendedStaticArraySize,
            });
            return;
          }
        }
      }

      // Recursively check nested statements
      if (stmt.body) this.forEachStatement(stmt.body, checkStatement);
      if (stmt.thenBranch) this.forEachStatement(stmt.thenBranch, checkStatement);
      if (stmt.elseBranch) this.forEachStatement(stmt.elseBranch, checkStatement);
      if (stmt.tryBlock) this.forEachStatement(stmt.tryBlock, checkStatement);
      if (stmt.catchBlock) this.forEachStatement(stmt.catchBlock, checkStatement);
      if (stmt.cases) {
        for (const c of stmt.cases) {
          this.forEachStatement(c.body, checkStatement);
        }
      }
    };

    this.forEachProgramStatement(program, checkStatement);
  }

  /**
   * Detects string method usage.
   */
  private detectStringNeeds(
    program: ProgramIR,
    trackNeed: (id: string, config: Record<string, any>) => void
  ): void {
    const stringMethods = ["charAt", "substring", "indexOf", "split", "trim", "toLowerCase", "toUpperCase"];

    const checkStatement = (stmt: any): void => {
      if (stmt.kind === "call" && stmt.callee) {
        for (const method of stringMethods) {
          if (stmt.callee.includes(`.${method}`) || stmt.callee.includes(`.${method}(`)) {
            trackNeed("static_string", {
              maxLen: this.config.strings?.staticMaxLen ?? this.capabilities.recommendedStaticStringLength,
            });
            return;
          }
        }
      }

      // Recursively check nested statements
      if (stmt.body) this.forEachStatement(stmt.body, checkStatement);
      if (stmt.thenBranch) this.forEachStatement(stmt.thenBranch, checkStatement);
      if (stmt.elseBranch) this.forEachStatement(stmt.elseBranch, checkStatement);
      if (stmt.tryBlock) this.forEachStatement(stmt.tryBlock, checkStatement);
      if (stmt.catchBlock) this.forEachStatement(stmt.catchBlock, checkStatement);
      if (stmt.cases) {
        for (const c of stmt.cases) {
          this.forEachStatement(c.body, checkStatement);
        }
      }
    };

    this.forEachProgramStatement(program, checkStatement);
  }

  /**
   * Detects console method usage.
   */
  private detectConsoleNeeds(
    program: ProgramIR,
    trackNeed: (id: string, config: Record<string, any>) => void
  ): void {
    const consoleMethods = ["log", "warn", "error", "info", "debug"];

    const checkStatement = (stmt: any): void => {
      if (stmt.kind === "call" && stmt.callee) {
        for (const method of consoleMethods) {
          if (stmt.callee === `console.${method}` || stmt.callee.includes(`console.${method}(`)) {
            trackNeed("console", {
              baudRate: this.config.console?.baudRate ?? this.capabilities.defaultBaudRate,
              useFlashStrings: this.config.console?.useFlashStrings,
            });
            return;
          }
        }
      }

      // Recursively check nested statements
      if (stmt.body) this.forEachStatement(stmt.body, checkStatement);
      if (stmt.thenBranch) this.forEachStatement(stmt.thenBranch, checkStatement);
      if (stmt.elseBranch) this.forEachStatement(stmt.elseBranch, checkStatement);
      if (stmt.tryBlock) this.forEachStatement(stmt.tryBlock, checkStatement);
      if (stmt.catchBlock) this.forEachStatement(stmt.catchBlock, checkStatement);
      if (stmt.cases) {
        for (const c of stmt.cases) {
          this.forEachStatement(c.body, checkStatement);
        }
      }
    };

    this.forEachProgramStatement(program, checkStatement);
  }

  /**
   * Helper to iterate over all statements in a program.
   */
  private forEachProgramStatement(program: ProgramIR, fn: (stmt: any) => void): void {
    // Check functions
    for (const func of program.functions) {
      for (const stmt of func.statements) {
        fn(stmt);
      }
    }

    // Check top-level statements
    for (const stmt of program.topLevelStatements) {
      fn(stmt);
    }

    // Check class methods
    for (const cls of program.classes) {
      for (const method of cls.methods) {
        for (const stmt of method.statements) {
          fn(stmt);
        }
      }
      if (cls.constructor) {
        for (const stmt of cls.constructor.statements) {
          fn(stmt);
        }
      }
    }
  }

  /**
   * Helper to iterate over statements (handles arrays).
   */
  private forEachStatement(stmts: any, fn: (stmt: any) => void): void {
    if (Array.isArray(stmts)) {
      for (const s of stmts) {
        fn(s);
      }
    }
  }

  /**
   * Generates polyfills for detected needs.
   */
  generate(needs: DetectedPolyfillNeed[]): PolyfillGenerationResult {
    const polyfills: ResolvedPolyfill[] = [];
    const includes = new Set<string>();
    const forwardDeclarations: string[] = [];
    const setupStatements: string[] = [];

    for (const need of needs) {
      const resolved = resolvePolyfillTemplate(
        need.templateId,
        this.capabilities,
        need.config
      );

      if (resolved) {
        polyfills.push(resolved);

        // Collect includes
        for (const inc of resolved.includes) {
          includes.add(inc);
        }

        // Collect forward declarations
        forwardDeclarations.push(...resolved.forwardDeclarations);

        // Collect setup statements
        setupStatements.push(...resolved.setupStatements);
      }
    }

    // Combine code
    const code = polyfills
      .map(p => `// Polyfill: ${p.id}\n${p.code}`)
      .join("\n\n");

    return {
      code,
      includes: Array.from(includes),
      forwardDeclarations,
      setupStatements,
      polyfills,
    };
  }

  /**
   * Analyzes a program and generates all needed polyfills.
   * This is the main entry point.
   */
  generateForProgram(program: ProgramIR): PolyfillGenerationResult {
    const needs = this.detectNeeds(program);
    return this.generate(needs);
  }

  /**
   * Converts to RuntimePolyfillIR for compatibility with existing emitter.
   */
  toRuntimePolyfillIR(result: PolyfillGenerationResult): RuntimePolyfillIR[] {
    return result.polyfills.map(p => ({
      kind: "polyfill" as const,
      id: p.id,
      domain: "standard" as const,
      requiredIncludes: p.includes,
      forwardDeclarations: p.forwardDeclarations,
      helperStructs: p.code.includes("struct") ? [p.code] : [],
      helperFunctions: p.code.includes("void ") || p.code.includes("class ") ? [p.code] : [],
      shimMacros: [],
      dependencies: [],
      setupStatements: p.setupStatements,
    }));
  }

  /**
   * Gets the current architecture capabilities.
   */
  getCapabilities(): ArchitectureCapabilities {
    return this.capabilities;
  }

  /**
   * Lists all available polyfill templates.
   */
  listAvailableTemplates(): string[] {
    return Array.from(POLYFILL_TEMPLATES.keys());
  }
}

/**
 * Gets default polyfill config.
 */
function getDefaultConfig(): PolyfillConfig {
  return {
    console: {
      enabled: true,
      target: "auto",
      useFlashStrings: true,
      baudRate: 9600,
      autoInjectSerialBegin: true,
    },
    async: {
      enabled: true,
      mode: "state-machine",
      scheduler: false,
    },
    arrays: {
      enabled: true,
      prefer: "auto",
      staticMaxSize: 32,
      microMaxSize: 16,
    },
    strings: {
      enabled: true,
      prefer: "auto",
      staticMaxLen: 64,
    },
    exceptions: {
      enabled: "auto",
      fallback: "error_code",
    },
  };
}

/**
 * Convenience function to generate polyfills for a program.
 */
export function generatePolyfills(
  program: ProgramIR,
  architecture?: string,
  config?: Partial<PolyfillConfig>
): PolyfillGenerationResult {
  const generator = new PolyfillGenerator(architecture, config);
  return generator.generateForProgram(program);
}