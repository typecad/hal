// ---------------------------------------------------------------------------
// registry.ts — Toolchain registry
//
// Manages registration and resolution of toolchain implementations.
// Toolchains self-register on import, allowing for extensibility.
// ---------------------------------------------------------------------------

import type { Toolchain, ToolchainConfig } from './types.js';

// Import toolchain implementations to trigger registration
import './arduino-cli.js';
import './platformio.js';

/** Global registry of toolchain implementations */
const registry = new Map<string, Toolchain>();

/**
 * Register a toolchain implementation.
 * Called automatically by toolchain modules on import.
 */
export function registerToolchain(toolchain: Toolchain): void {
  if (registry.has(toolchain.id)) {
    console.warn(`[toolchain] Warning: Overwriting existing toolchain '${toolchain.id}'`);
  }
  registry.set(toolchain.id, toolchain);
}

/**
 * Get a toolchain by its ID.
 * Returns undefined if not found.
 */
export function getToolchain(id: string): Toolchain | undefined {
  return registry.get(id);
}

/**
 * Get all registered toolchain IDs.
 */
export function getRegisteredToolchains(): string[] {
  return Array.from(registry.keys());
}

/**
 * Find the first available (installed) toolchain.
 * Checks arduino-cli first, then platformio.
 */
export async function findAvailableToolchain(): Promise<string | undefined> {
  const priority: string[] = ['arduino-cli', 'platformio'];
  
  for (const id of priority) {
    const toolchain = registry.get(id);
    if (toolchain) {
      const path = await toolchain.isInstalled();
      if (path) {
        return id;
      }
    }
  }
  
  return undefined;
}

/**
 * Resolve a toolchain from configuration.
 * 
 * Priority:
 * 1. config.type if specified
 * 2. First available toolchain (arduino-cli, then platformio)
 * 3. undefined if none available
 */
export async function resolveToolchain(config?: ToolchainConfig): Promise<Toolchain | undefined> {
  // If type is explicitly specified, use it
  if (config?.type) {
    const toolchain = registry.get(config.type);
    if (!toolchain) {
      throw new Error(`Unknown toolchain type: ${config.type}`);
    }
    return toolchain;
  }
  
  // Auto-detect available toolchain
  const id = await findAvailableToolchain();
  if (id) {
    return registry.get(id);
  }
  
  return undefined;
}

/**
 * Check if a specific toolchain is available.
 */
export async function isToolchainAvailable(id: string): Promise<boolean> {
  const toolchain = registry.get(id);
  if (!toolchain) return false;
  const path = await toolchain.isInstalled();
  return !!path;
}