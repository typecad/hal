import path from "node:path";
import { setLoadedFramework, clearLoadedFramework } from "./framework-registry";
import type { LoadedFramework, FrameworkToolchain } from "./framework-registry";

export const DEFAULT_FRAMEWORK_PACKAGE = "@typehal/framework-arduino";

export function resolveFrameworkPackage(
  packageName = DEFAULT_FRAMEWORK_PACKAGE,
  fromDir = process.cwd(),
): string | undefined {
  try {
    const resolved = require.resolve(packageName, { paths: [path.resolve(fromDir)] });
    return resolved;
  } catch {
    return undefined;
  }
}

/**
 * Extract toolchain operations from a loaded framework module, if present.
 * Supports both new-style `Toolchain` object exports and legacy
 * Arduino-specific named function exports.
 */
function extractToolchain(mod: any): FrameworkToolchain | undefined {
  // New style: framework exports a Toolchain object
  if (mod.Toolchain && typeof mod.Toolchain === "object") {
    return mod.Toolchain as FrameworkToolchain;
  }

  // Legacy style: Arduino-specific named exports
  if (typeof mod.compileArduinoSketch === "function") {
    return {
      prepare: typeof mod.flattenGeneratedModulesIntoSketch === "function"
        ? (outputDir: string, entryPoint: string) => mod.flattenGeneratedModulesIntoSketch(outputDir, entryPoint)
        : undefined,
      compile: (options: any) => mod.compileArduinoSketch(options.sourcePath, options.fqbn),
      upload: typeof mod.uploadArduinoSketch === "function"
        ? (options: any) => mod.uploadArduinoSketch(options.outputDir, options.fqbn, options.port)
        : undefined,
      monitor: typeof mod.monitorArduinoSketch === "function"
        ? (options: any) => mod.monitorArduinoSketch(options.port, options.baud)
        : undefined,
    };
  }

  return undefined;
}

/**
 * Load a framework package and populate the LoadedFramework registry.
 *
 * The loaded module is expected to export at minimum `FrameworkStrategy`.
 * Optional exports include toolchain and library resolver functions.
 *
 * Returns the raw module for backward compatibility.
 */
export function loadFrameworkPackage(
  packageName = DEFAULT_FRAMEWORK_PACKAGE,
  fromDir = process.cwd(),
): any {
  const packagePath = resolveFrameworkPackage(packageName, fromDir);
  if (!packagePath) {
    throw new Error(
      `Unable to resolve framework package '${packageName}' from '${fromDir}'. ` +
      `Install it or pass a different framework package name in your TypeHAL config.`,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(packagePath);

  // Populate the registry with the loaded framework components
  if (mod.FrameworkStrategy) {
    const framework: LoadedFramework = {
      strategy: new mod.FrameworkStrategy(),
      toolchain: extractToolchain(mod),
    };
    setLoadedFramework(framework);
  }

  return mod;
}

/**
 * Load a framework package optionally — returns undefined if not found.
 */
export function loadOptionalFrameworkPackage(
  packageName = DEFAULT_FRAMEWORK_PACKAGE,
  fromDir = process.cwd(),
): any | undefined {
  const packagePath = resolveFrameworkPackage(packageName, fromDir);
  if (!packagePath) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(packagePath);

  // Populate the registry with the loaded framework components
  if (mod.FrameworkStrategy) {
    const framework: LoadedFramework = {
      strategy: new mod.FrameworkStrategy(),
      toolchain: extractToolchain(mod),
    };
    setLoadedFramework(framework);
  }

  return mod;
}

export function resetFrameworkPackage(): void {
  clearLoadedFramework();
}
