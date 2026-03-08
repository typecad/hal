// ---------------------------------------------------------------------------
// Polyfill Plugin System
//
// Provides an extensibility mechanism for third-party polyfills.
// Plugins can be loaded from config and registered with the PolyfillRegistry.
// ---------------------------------------------------------------------------

import type { PolyfillDefinition, PolyfillContext, PolyfillNeed, RuntimePolyfillIR } from './types';
import type { ProgramIR } from '../ir/model';

// ---------------------------------------------------------------------------
// Plugin Interface
// ---------------------------------------------------------------------------

/**
 * A polyfill plugin that can be loaded dynamically.
 * Plugins allow third-party extensions to add custom polyfills.
 */
export interface PolyfillPlugin {
  /**
   * Unique identifier for this plugin.
   * Should be namespaced (e.g., "@myorg/polyfill-esp32-touch")
   */
  id: string;

  /**
   * Human-readable name for the plugin.
   */
  name: string;

  /**
   * Plugin version (semver recommended).
   */
  version?: string;

  /**
   * Description of what polyfills this plugin provides.
   */
  description?: string;

  /**
   * List of polyfill definitions this plugin provides.
   */
  polyfills: PolyfillDefinition[];

  /**
   * Optional initialization hook called when the plugin is loaded.
   * Use this to set up any required state or validate the environment.
   */
  init?(context: PluginContext): void | Promise<void>;

  /**
   * Optional cleanup hook called when the plugin is unloaded.
   */
  dispose?(): void | Promise<void>;
}

/**
 * Context provided to plugins during initialization.
 */
export interface PluginContext {
  /**
   * The target platform being compiled for.
   */
  target: string;

  /**
   * Configuration options from typecode.config.ts.
   */
  config: Record<string, unknown>;

  /**
   * Logger for plugin messages.
   */
  log: PluginLogger;
}

/**
 * Simple logger interface for plugins.
 */
export interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

// ---------------------------------------------------------------------------
// Plugin Loader
// ---------------------------------------------------------------------------

/**
 * Result of loading a plugin.
 */
export interface PluginLoadResult {
  success: boolean;
  plugin?: PolyfillPlugin;
  error?: string;
}

/**
 * Plugin loader options.
 */
export interface PluginLoaderOptions {
  /**
   * Base directory for resolving relative plugin paths.
   */
  basePath?: string;

  /**
   * Whether to allow loading plugins from node_modules.
   */
  allowNodeModules?: boolean;

  /**
   * Custom logger instance.
   */
  logger?: PluginLogger;
}

/**
 * Default logger implementation.
 */
const defaultLogger: PluginLogger = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

/**
 * Loads a polyfill plugin from various sources.
 */
export async function loadPolyfillPlugin(
  source: string | PolyfillPlugin | (() => PolyfillPlugin | Promise<PolyfillPlugin>),
  options: PluginLoaderOptions = {}
): Promise<PluginLoadResult> {
  const logger = options.logger ?? defaultLogger;

  try {
    let plugin: PolyfillPlugin;

    // Case 1: Already a plugin object
    if (typeof source === 'object' && source !== null && 'id' in source && 'polyfills' in source) {
      plugin = source as PolyfillPlugin;
    }
    // Case 2: Factory function
    else if (typeof source === 'function') {
      const result = await source();
      if (!result || !result.id || !result.polyfills) {
        return { success: false, error: 'Factory function did not return a valid plugin' };
      }
      plugin = result;
    }
    // Case 3: String path or module specifier
    else if (typeof source === 'string') {
      plugin = await loadPluginFromModule(source, options, logger);
    }
    else {
      return { success: false, error: `Invalid plugin source type: ${typeof source}` };
    }

    // Validate the plugin
    const validationError = validatePlugin(plugin);
    if (validationError) {
      return { success: false, error: validationError };
    }

    return { success: true, plugin };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to load plugin: ${message}`);
    return { success: false, error: message };
  }
}

/**
 * Load a plugin from a module path or specifier.
 */
async function loadPluginFromModule(
  modulePath: string,
  options: PluginLoaderOptions,
  logger: PluginLogger
): Promise<PolyfillPlugin> {
  const { basePath, allowNodeModules = true } = options;

  // Resolve the path
  let resolvedPath = modulePath;
  
  // Check if it's a relative path
  if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
    if (!basePath) {
      throw new Error(`Cannot resolve relative path "${modulePath}" without basePath`);
    }
    const path = await import('node:path');
    resolvedPath = path.resolve(basePath, modulePath);
  }
  
  // Check if node_modules access is allowed
  if (!allowNodeModules && !modulePath.startsWith('.') && !modulePath.startsWith('/')) {
    throw new Error(`Loading from node_modules is disabled: ${modulePath}`);
  }

  logger.debug(`Loading plugin from: ${resolvedPath}`);

  // Dynamic import
  const module = await import(resolvedPath);
  
  // Support both default export and named export
  const plugin = module.default ?? module.plugin ?? module;
  
  if (!plugin || typeof plugin !== 'object') {
    throw new Error(`Module "${modulePath}" does not export a valid plugin`);
  }

  return plugin;
}

/**
 * Validate a plugin structure.
 */
function validatePlugin(plugin: PolyfillPlugin): string | null {
  if (!plugin.id || typeof plugin.id !== 'string') {
    return 'Plugin must have a string "id" property';
  }

  if (!plugin.name || typeof plugin.name !== 'string') {
    return 'Plugin must have a string "name" property';
  }

  if (!Array.isArray(plugin.polyfills)) {
    return 'Plugin must have a "polyfills" array';
  }

  for (let i = 0; i < plugin.polyfills.length; i++) {
    const pf = plugin.polyfills[i];
    const error = validatePolyfill(pf, i);
    if (error) return error;
  }

  return null;
}

/**
 * Validate a polyfill definition.
 */
function validatePolyfill(pf: PolyfillDefinition, index: number): string | null {
  if (!pf.id || typeof pf.id !== 'string') {
    return `Polyfill at index ${index} must have a string "id" property`;
  }

  if (!Array.isArray(pf.domains)) {
    return `Polyfill "${pf.id}" must have a "domains" array`;
  }

  if (typeof pf.detect !== 'function') {
    return `Polyfill "${pf.id}" must have a "detect" function`;
  }

  if (typeof pf.generate !== 'function') {
    return `Polyfill "${pf.id}" must have a "generate" function`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Plugin Manager
// ---------------------------------------------------------------------------

/**
 * Manages loaded polyfill plugins.
 */
export class PluginManager {
  private plugins: Map<string, PolyfillPlugin> = new Map();
  private logger: PluginLogger;
  private basePath?: string;

  constructor(options: PluginLoaderOptions = {}) {
    this.logger = options.logger ?? defaultLogger;
    this.basePath = options.basePath;
  }

  /**
   * Load and register a plugin.
   */
  async load(source: string | PolyfillPlugin | (() => PolyfillPlugin | Promise<PolyfillPlugin>)): Promise<boolean> {
    const result = await loadPolyfillPlugin(source, {
      basePath: this.basePath,
      logger: this.logger,
    });

    if (!result.success || !result.plugin) {
      this.logger.error(`Failed to load plugin: ${result.error}`);
      return false;
    }

    return this.register(result.plugin);
  }

  /**
   * Register a plugin instance.
   */
  async register(plugin: PolyfillPlugin): Promise<boolean> {
    if (this.plugins.has(plugin.id)) {
      this.logger.warn(`Plugin "${plugin.id}" is already registered`);
      return false;
    }

    // Call init hook if present
    if (plugin.init) {
      try {
        await plugin.init({
          target: 'unknown', // Will be updated when compiling
          config: {},
          log: this.logger,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Plugin "${plugin.id}" init failed: ${message}`);
        return false;
      }
    }

    this.plugins.set(plugin.id, plugin);
    this.logger.info(`Registered polyfill plugin: ${plugin.name} (${plugin.id})`);
    return true;
  }

  /**
   * Unregister and dispose a plugin.
   */
  async unload(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return false;
    }

    if (plugin.dispose) {
      try {
        await plugin.dispose();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Plugin "${pluginId}" dispose failed: ${message}`);
      }
    }

    this.plugins.delete(pluginId);
    this.logger.info(`Unregistered polyfill plugin: ${pluginId}`);
    return true;
  }

  /**
   * Get all registered plugins.
   */
  getPlugins(): PolyfillPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get all polyfills from all registered plugins.
   */
  getAllPolyfills(): PolyfillDefinition[] {
    const allPolyfills: PolyfillDefinition[] = [];
    for (const plugin of this.plugins.values()) {
      allPolyfills.push(...plugin.polyfills);
    }
    return allPolyfills;
  }

  /**
   * Check if a plugin is registered.
   */
  has(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  /**
   * Get a specific plugin by ID.
   */
  get(pluginId: string): PolyfillPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Dispose all plugins.
   */
  async disposeAll(): Promise<void> {
    const unloadPromises = Array.from(this.plugins.keys()).map(id => this.unload(id));
    await Promise.all(unloadPromises);
  }
}

// ---------------------------------------------------------------------------
// Plugin Helpers
// ---------------------------------------------------------------------------

/**
 * Create a simple polyfill plugin from polyfill definitions.
 */
export function createSimplePlugin(
  id: string,
  name: string,
  polyfills: PolyfillDefinition[],
  options?: { version?: string; description?: string }
): PolyfillPlugin {
  return {
    id,
    name,
    version: options?.version,
    description: options?.description,
    polyfills,
  };
}

/**
 * Example plugin for custom board peripherals.
 * This shows how third parties can create their own polyfill plugins.
 * 
 * NOTE: This is a simplified example. Real polyfills need to implement
 * the full PolyfillDefinition interface with proper detect/generate functions.
 */
export const exampleCustomPlugin: PolyfillPlugin = {
  id: '@example/custom-peripherals',
  name: 'Custom Peripherals Polyfill',
  version: '1.0.0',
  description: 'Example polyfill plugin for custom board peripherals (demonstration only)',
  polyfills: [
    // Example polyfill definition - real implementations would have
    // proper detect() and generate() functions that return the correct types
  ],
  init: (context) => {
    context.log.info(`Custom plugin initialized for target: ${context.target}`);
  },
};
