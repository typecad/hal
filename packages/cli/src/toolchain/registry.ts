// ---------------------------------------------------------------------------
// Toolchain registry — manages available toolchain implementations
//
// Toolchains register themselves here, and the registry resolves the
// appropriate one based on configuration.
// ---------------------------------------------------------------------------

import type { Toolchain, ResolvedToolchainConfig } from './types';

const _registry = new Map<string, Toolchain>();

/**
 * Register a toolchain implementation.
 * Called by toolchain modules on import.
 */
export function registerToolchain(toolchain: Toolchain): void {
  _registry.set(toolchain.id, toolchain);
}

/**
 * Get a toolchain by its ID.
 * Returns undefined if not registered.
 */
export function getToolchain(id: string): Toolchain | undefined {
  return _registry.get(id);
}

/**
 * Resolve a toolchain from configuration.
 * Falls back to arduino-cli if not specified.
 */
export function resolveToolchain(config?: ResolvedToolchainConfig): Toolchain {
  const toolchainType = config?.type ?? 'arduino-cli';
  const toolchain = _registry.get(toolchainType);
  
  if (!toolchain) {
    throw new Error(`Unknown toolchain: '${toolchainType}'. Available: ${Array.from(_registry.keys()).join(', ')}`);
  }
  
  return toolchain;
}

/**
 * List all registered toolchain IDs.
 */
export function listToolchains(): string[] {
  return Array.from(_registry.keys());
}

/**
 * Check if any toolchain is available (installed on the system).
 * Returns the first available toolchain ID, or undefined if none.
 */
export async function findAvailableToolchain(): Promise<string | undefined> {
  for (const [id, toolchain] of _registry) {
    const installed = await toolchain.isInstalled();
    if (installed) {
      return id;
    }
  }
  return undefined;
}