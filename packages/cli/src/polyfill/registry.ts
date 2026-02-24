import { PolyfillDefinition, PolyfillContext, PolyfillNeed, RuntimePolyfillIR, DEFAULT_POLYFILL_CONFIG, PolyfillConfig } from "./types";
import { ProgramIR } from "../ir/model";

// Import all polyfill definitions
import { consolePolyfill } from "./polyfills/console";
import { arduinoAsyncPolyfill } from "./polyfills/async-arduino";
import { arrayMethodsPolyfill } from "./polyfills/array-methods";
import { stringMethodsPolyfill } from "./polyfills/string-methods";

/**
 * Registry of all available polyfills
 */
const POLYFILLS: PolyfillDefinition[] = [
  consolePolyfill,
  arduinoAsyncPolyfill,
  arrayMethodsPolyfill,
  stringMethodsPolyfill,
];

/**
 * PolyfillRegistry manages polyfill detection and generation
 */
export class PolyfillRegistry {
  private polyfills: Map<string, PolyfillDefinition>;
  private config: PolyfillConfig;

  constructor(config?: Partial<PolyfillConfig>) {
    this.polyfills = new Map();
    this.config = { ...DEFAULT_POLYFILL_CONFIG, ...config };
    
    // Register all polyfills
    for (const polyfill of POLYFILLS) {
      this.polyfills.set(polyfill.id, polyfill);
    }
  }

  /**
   * Get all registered polyfill definitions
   */
  getPolyfills(): PolyfillDefinition[] {
    return Array.from(this.polyfills.values());
  }

  /**
   * Get a specific polyfill by ID
   */
  getPolyfill(id: string): PolyfillDefinition | undefined {
    return this.polyfills.get(id);
  }

  /**
   * Detect which polyfills are needed for a program
   */
  detect(program: ProgramIR, context: PolyfillContext): Map<string, PolyfillNeed[]> {
    const needs = new Map<string, PolyfillNeed[]>();
    const effectiveContext = { ...context, config: this.config };

    for (const [id, polyfill] of this.polyfills) {
      // Check if this polyfill applies to the current target
      const domainMatches = this.domainMatches(polyfill, context.target);
      
      if (!domainMatches) {
        continue;
      }

      // Check if this polyfill is enabled in config
      if (!this.isPolyfillEnabled(id)) {
        continue;
      }

      const detectedNeeds = polyfill.detect(program, effectiveContext);
      if (detectedNeeds.length > 0) {
        needs.set(id, detectedNeeds);
      }
    }

    return needs;
  }

  /**
   * Generate polyfill IR for detected needs
   */
  generate(needs: Map<string, PolyfillNeed[]>, context: PolyfillContext): RuntimePolyfillIR[] {
    const results: RuntimePolyfillIR[] = [];
    const effectiveContext = { ...context, config: this.config };

    for (const [id, polyfillNeeds] of needs) {
      const polyfill = this.polyfills.get(id);
      if (!polyfill) {
        continue;
      }

      const ir = polyfill.generate(polyfillNeeds, effectiveContext);
      results.push(ir);
    }

    return results;
  }

  /**
   * Detect and generate all needed polyfills in one step
   */
  detectAndGenerate(program: ProgramIR, context: PolyfillContext): RuntimePolyfillIR[] {
    const needs = this.detect(program, context);
    return this.generate(needs, context);
  }

  /**
   * Check if a polyfill's domain matches the target
   */
  private domainMatches(polyfill: PolyfillDefinition, target: string): boolean {
    if (target === "arduino") {
      return polyfill.domains.includes("arduino") || 
             polyfill.domains.includes("embedded") ||
             polyfill.domains.includes("standard");
    }
    
    // Generic target
    return polyfill.domains.includes("standard") || 
           polyfill.domains.includes("embedded");
  }

  /**
   * Check if a polyfill is enabled in config
   */
  private isPolyfillEnabled(id: string): boolean {
    const configKey = this.resolveConfigKey(id);
    if (!configKey) {
      return true;
    }
    const polyfillConfig = this.config[configKey];
    
    if (!polyfillConfig) {
      return true; // Enabled by default if not configured
    }

    return polyfillConfig.enabled === true;
  }

  private resolveConfigKey(id: string): keyof PolyfillConfig | undefined {
    if (id === "console") {
      return "console";
    }
    if (id === "async_arduino") {
      return "async";
    }
    if (id === "array_methods") {
      return "arrays";
    }
    if (id === "string_methods") {
      return "strings";
    }
    return undefined;
  }
}

/**
 * Create a default polyfill registry
 */
export function createPolyfillRegistry(config?: Partial<PolyfillConfig>): PolyfillRegistry {
  return new PolyfillRegistry(config);
}