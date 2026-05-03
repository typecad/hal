import path from "node:path";
import { setLoadedFramework } from "./framework-registry";
import type { LoadedFramework, FrameworkToolchain } from "./framework-registry";
import { registerPlatformStrategy } from "./platform/registry";

function resolveFrameworkPackage(
  packageName: string,
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
 * Extract toolchain operations from a loaded framework module.
 * Frameworks export a `Toolchain` object implementing FrameworkToolchain.
 */
function extractToolchain(mod: any): FrameworkToolchain | undefined {
  if (mod.Toolchain && typeof mod.Toolchain === "object") {
    return mod.Toolchain as FrameworkToolchain;
  }
  return undefined;
}

/**
 * Load a framework package and populate the LoadedFramework registry.
 *
 * The loaded module is expected to export at minimum `FrameworkStrategy`.
 * Optional exports include `Toolchain`, `SYMBOL_KINDS`, library resolver,
 * class name map builder, and lib declaration generator.
 *
 * Returns the raw module for backward compatibility.
 */
export function loadFrameworkPackage(
  packageName: string,
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
    const strategy = new mod.FrameworkStrategy();
    const framework: LoadedFramework = {
      strategy,
      toolchain: extractToolchain(mod),
      libraryResolver: typeof mod.isFrameworkLibraryImport === "function" ? {
        isFrameworkLibraryImport: mod.isFrameworkLibraryImport,
        getFrameworkLibraryHeaderName: mod.getFrameworkLibraryHeaderName,
      } : undefined,
      classNameMapBuilder: typeof mod.buildClassNameMap === "function" ? {
        buildClassNameMap: mod.buildClassNameMap,
      } : undefined,
      libDeclGenerator: typeof mod.tryGenerateLibDecl === "function" ? {
        tryGenerateLibDecl: mod.tryGenerateLibDecl,
      } : undefined,
    };
    setLoadedFramework(framework);
    registerPlatformStrategy(strategy);
  }

  return mod;
}
