import { PolyfillDefinition, PolyfillContext, PolyfillNeed, RuntimePolyfillIR, DEFAULT_POLYFILL_CONFIG, PolyfillConfig } from "./types";
import { ProgramIR } from "../ir/model";
import type { PolyfillPlugin, PluginLogger } from "./plugin";

// Import all polyfill definitions
import { consolePolyfill } from "./polyfills/console";
import { arduinoAsyncPolyfill } from "./polyfills/async-arduino";
import { arrayMethodsPolyfill } from "./polyfills/array-methods";
import { stringMethodsPolyfill } from "./polyfills/string-methods";

/**
 * Registry of all built-in polyfills
 */
const BUILTIN_POLYFILLS: PolyfillDefinition[] = [
  consolePolyfill,
  arduinoAsyncPolyfill,
  arrayMethodsPolyfill,
  stringMethodsPolyfill,
];

/**
 * PolyfillRegistry manages polyfill detection and generation
 * 
 * Supports both built-in polyfills and plugins.
 */
export class PolyfillRegistry {
  private polyfills: Map<string, PolyfillDefinition>;
  private plugins: Map<string, PolyfillPlugin>;
  private config: PolyfillConfig;
  private logger: PluginLogger;

  constructor(config?: Partial<PolyfillConfig>, logger?: PluginLogger) {
    this.polyfills = new Map();
    this.plugins = new Map();
    this.config = { ...DEFAULT_POLYFILL_CONFIG, ...config };
    this.logger = logger ?? console;
    
    // Register all built-in polyfills
    for (const polyfill of BUILTIN_POLYFILLS) {
      this.polyfills.set(polyfill.id, polyfill);
    }
  }

  // ---------------------------------------------------------------------------
  // Plugin Support
  // ---------------------------------------------------------------------------

  /**
   * Register a polyfill plugin.
   * All polyfills from the plugin are added to the registry.
   */
  registerPlugin(plugin: PolyfillPlugin): void {
    if (this.plugins.has(plugin.id)) {
      this.logger.warn?.(`Plugin "${plugin.id}" is already registered`);
      return;
    }

    // Register all polyfills from the plugin
    for (const polyfill of plugin.polyfills) {
      if (this.polyfills.has(polyfill.id)) {
        this.logger.warn?.(`Polyfill "${polyfill.id}" from plugin "${plugin.id}" overrides existing polyfill`);
      }
      this.polyfills.set(polyfill.id, polyfill);
    }

    this.plugins.set(plugin.id, plugin);
    this.logger.info?.(`Registered polyfill plugin: ${plugin.name} (${plugin.id})`);
  }

  /**
   * Unregister a polyfill plugin.
   * Removes all polyfills that were registered by this plugin.
   */
  unregisterPlugin(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return false;
    }

    // Remove polyfills from this plugin
    for (const polyfill of plugin.polyfills) {
      // Only remove if it wasn't overridden by another plugin
      const current = this.polyfills.get(polyfill.id);
      if (current === polyfill) {
        this.polyfills.delete(polyfill.id);
      }
    }

    this.plugins.delete(pluginId);
    this.logger.info?.(`Unregistered polyfill plugin: ${pluginId}`);
    return true;
  }

  /**
   * Get all registered plugins.
   */
  getPlugins(): PolyfillPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Check if a plugin is registered.
   */
  hasPlugin(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  // ---------------------------------------------------------------------------
  // Manual Polyfill Registration
  // ---------------------------------------------------------------------------

  /**
   * Register a custom polyfill definition directly.
   */
  registerPolyfill(polyfill: PolyfillDefinition): void {
    if (this.polyfills.has(polyfill.id)) {
      this.logger.warn?.(`Overriding existing polyfill: ${polyfill.id}`);
    }
    this.polyfills.set(polyfill.id, polyfill);
  }

  /**
   * Register multiple polyfill definitions.
   */
  registerPolyfills(polyfills: PolyfillDefinition[]): void {
    for (const polyfill of polyfills) {
      this.registerPolyfill(polyfill);
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