import path from "node:path";
import { createRequire } from "node:module";
import { setLoadedFramework } from "./framework-registry.js";
import type { LoadedFramework, FrameworkToolchain } from "./framework-registry.js";
import { registerPlatformStrategy } from "./platform/registry.js";
import * as nativeFramework from "./frameworks/native/index.js";

const require = createRequire(import.meta.url);

/**
 * Frameworks that ship inside @typecad/cuttlefish instead of as separate
 * @typecad/framework-* npm packages. Their config string stays the historical
 * package name for continuity; the module is loaded directly instead of via
 * require.resolve. (The native framework was merged in from the former
 * @typecad/framework-native package.)
 */
const BUILTIN_FRAMEWORK_MODULES: Record<string, unknown> = {
  "@typecad/framework-native": nativeFramework,
};

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
 * Built-in frameworks (see BUILTIN_FRAMEWORK_MODULES) are loaded from this
 * package directly; everything else resolves from the project directory.
 *
 * Returns the raw module for backward compatibility.
 */
export function loadFrameworkPackage(
  packageName: string,
  fromDir = process.cwd(),
): any {
  const builtin = BUILTIN_FRAMEWORK_MODULES[packageName];
  const mod = builtin ?? (() => {
    const packagePath = resolveFrameworkPackage(packageName, fromDir);
    if (!packagePath) {
      throw new Error(
        `Unable to resolve framework package '${packageName}' from '${fromDir}'. ` +
        `Install it or pass a different framework package name in your TypeCAD config.`,
      );
    }
    return require(packagePath);
  })();

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
      classNameMapBuilder: typeof mod.buildClassNameMap === "function" ? mod.buildClassNameMap : undefined,
      libDeclGenerator: typeof mod.tryGenerateLibDecl === "function" ? mod.tryGenerateLibDecl : undefined,
      doctor: typeof mod.doctor === "function" ? mod.doctor : undefined,
      licenses: typeof mod.licenses === "function" ? mod.licenses : undefined,
    };
    setLoadedFramework(framework);
    registerPlatformStrategy(strategy);
  }

  return mod;
}
