// ---------------------------------------------------------------------------
// Cuttlefish library packages
//
// A library package is an npm package whose root carries a
// `typecad-hal.library.json` manifest. It contributes native artifacts to the
// generated firmware application:
//
//   - an include mapping (the import emits `#include` of the shim header)
//   - shim files (native C++ written into the emitted source directory)
//   - framework build contributions (Kconfig lines, a devicetree overlay
//     fragment) consumed by the framework toolchain via the sidecar
//
// Discovery is import-driven: when the transpile graph builder resolves an
// import whose package ships the manifest, the package is registered at that
// moment and its TypeScript is NOT transpiled — the package's own types are
// the compile-time contract, and the native shim is the implementation.
// Nothing scans node_modules; an installed-but-never-imported library
// contributes nothing.
//
// The transpiler writes a `libraries.json` sidecar next to the emitted
// sources (the board-constants.json convention) recording the libraries that
// were actually used, so build-time consumers (framework toolchains) can
// re-derive their contributions idempotently from disk.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { LibraryDefinition } from "./types.js";
import { toModuleKey } from "./utils/strings.js";

/** A native source file a library contributes to the emitted sources. */
export interface CuttlefishLibraryShim {
  /** Path of the shim file, relative to the library package root. */
  path: string;
  /** File name the shim is written as, in the emitted source directory. */
  outName: string;
}

/** The parsed `typecad-hal.library.json` manifest. */
export interface CuttlefishLibraryManifest {
  /** Stable library id (diagnostics / sidecar records). */
  id: string;
  /** The import specifier this library resolves (e.g. '@typecad/zephyr-esp32s3-rgb'). */
  module: string;
  /** The framework (strategy id) this library requires, e.g. 'zephyr'. */
  framework: string;
  /** Build-target prefixes this library supports (matched against buildTarget). */
  targets?: string[];
  /** C++ include directive content for the import, e.g. '"__tc_rgbled.h"'. */
  include: string;
  /** Token whose presence in emitted sources gates the library's artifacts. */
  gateToken: string;
  /** Native shim files written into the emitted source directory. */
  shims: CuttlefishLibraryShim[];
  /** CONFIG_ lines contributed to the framework's prj.conf. */
  kconfig?: string[];
  /** Path of a devicetree overlay fragment, relative to the package root. */
  overlay?: string;
}

/** A registered library: manifest + resolved package root. */
export interface RegisteredCuttlefishLibrary {
  manifest: CuttlefishLibraryManifest;
  packageRoot: string;
}

/** One record of the `libraries.json` sidecar (build-time contribution set). */
export interface LibrarySidecarEntry {
  id: string;
  module: string;
  framework: string;
  gateToken: string;
  kconfig: string[];
  /** Absolute path of the overlay fragment, or null. */
  overlay: string | null;
  /** Shim file names written into the emitted source directory. */
  shims: string[];
}

/** Sidecar file name — written next to the emitted sources. */
export const LIBRARY_SIDECAR_NAME = "libraries.json";

const registered = new Map<string, RegisteredCuttlefishLibrary>();
/** Specifiers known NOT to be library packages (avoids repeated resolve attempts). */
const knownNonLibraries = new Set<string>();

/** Clear all registrations. Called once per transpilation, before graph build. */
export function resetCuttlefishLibraries(): void {
  registered.clear();
  knownNonLibraries.clear();
}

/** All libraries registered during this transpilation (import-driven). */
export function getRegisteredCuttlefishLibraries(): RegisteredCuttlefishLibrary[] {
  return [...registered.values()];
}

/**
 * Whether the specifier resolves to a library registered in this
 * transpilation. Library packages are exempt from the @typecad/* "SDK
 * imports are type-level only" include skip — their import IS the include
 * of the shim header.
 */
export function isRegisteredCuttlefishLibrary(moduleSpecifier: string): boolean {
  return registered.has(moduleSpecifier.toLowerCase());
}

function parseManifest(packageRoot: string): CuttlefishLibraryManifest | undefined {
  const manifestPath = path.join(packageRoot, "typecad-hal.library.json");
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const m = raw as Partial<CuttlefishLibraryManifest>;
  if (
    typeof m.id !== "string" ||
    typeof m.module !== "string" ||
    typeof m.framework !== "string" ||
    typeof m.include !== "string" ||
    typeof m.gateToken !== "string" ||
    !Array.isArray(m.shims) ||
    m.shims.length === 0
  ) {
    return undefined;
  }
  for (const shim of m.shims) {
    if (typeof shim?.path !== "string" || typeof shim?.outName !== "string") {
      return undefined;
    }
  }
  return {
    id: m.id,
    module: m.module,
    framework: m.framework,
    targets: m.targets,
    include: m.include,
    gateToken: m.gateToken,
    shims: m.shims,
    kconfig: Array.isArray(m.kconfig) ? m.kconfig.filter((k): k is string => typeof k === "string") : [],
    overlay: typeof m.overlay === "string" ? m.overlay : undefined,
  };
}

/**
 * Resolve the package root for a bare npm specifier from the importing file,
 * then register the package as a typecad-hal library if it ships a
 * `typecad-hal.library.json`. Returns true when the specifier resolved to a
 * registered library (the import must then be skipped by the graph builder).
 */
export function registerCuttlefishLibraryFromSpecifier(
  fromFile: string,
  moduleSpecifier: string,
): boolean {
  // Only bare npm specifiers ('pkg' or '@scope/pkg'[/subpath]) — relative
  // imports and node builtins cannot be library packages.
  if (moduleSpecifier.startsWith(".") || moduleSpecifier.startsWith("node:")) {
    return false;
  }
  const cacheKey = moduleSpecifier.toLowerCase();
  if (knownNonLibraries.has(cacheKey)) return false;
  if (registered.has(cacheKey)) return true;

  let packageRoot: string | undefined;
  try {
    const req = createRequire(path.resolve(fromFile));
    // Resolve the package entry, then walk up to the nearest package.json —
    // the package root. (Resolving the manifest subpath directly would be
    // blocked by exports encapsulation; the entry point always resolves.)
    const entry = req.resolve(moduleSpecifier);
    let dir = path.dirname(entry);
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, "package.json"))) break;
      dir = path.dirname(dir);
    }
    if (dir !== path.dirname(dir)) packageRoot = dir;
  } catch {
    packageRoot = undefined;
  }

  if (packageRoot === undefined) {
    knownNonLibraries.add(cacheKey);
    return false;
  }

  const manifest = parseManifest(packageRoot);
  if (manifest === undefined) {
    knownNonLibraries.add(cacheKey);
    return false;
  }

  registered.set(cacheKey, { manifest, packageRoot });
  return true;
}

/** Libdef entries for the registry: import → shim include. */
export function cuttlefishLibraryLibdefs(): LibraryDefinition[] {
  return getRegisteredCuttlefishLibraries().map(({ manifest }) => ({
    module: manifest.module,
    include: manifest.include,
  }));
}

/**
 * Validate registered libraries against the loaded framework (and, when
 * known, the build target). Throws with an actionable message when a library
 * cannot work in this project — far earlier and clearer than the native
 * compiler would.
 */
export function validateCuttlefishLibraries(frameworkId: string, buildTarget?: string): void {
  for (const { manifest } of getRegisteredCuttlefishLibraries()) {
    if (manifest.framework !== frameworkId) {
      throw new Error(
        `Library ${manifest.module} requires the '${manifest.framework}' framework, ` +
          `but this project uses '${frameworkId}'. ` +
          `Install the matching framework or a '${frameworkId}' counterpart of this library.`,
      );
    }
    if (
      buildTarget !== undefined &&
      manifest.targets !== undefined &&
      manifest.targets.length > 0 &&
      !manifest.targets.some((t) => buildTarget.toLowerCase().startsWith(t.toLowerCase()))
    ) {
      throw new Error(
        `Library ${manifest.module} supports board targets ` +
          `[${manifest.targets.join(", ")}], but this project builds for '${buildTarget}'.`,
      );
    }
  }
}

function writeIfChanged(filePath: string, content: string): void {
  try {
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === content) return;
  } catch {
    /* fall through and write */
  }
  fs.writeFileSync(filePath, content);
}

function readEmittedTokens(srcDir: string): string {
  let out = "";
  let names: string[] = [];
  try {
    names = fs.readdirSync(srcDir);
  } catch {
    return "";
  }
  for (const name of names) {
    if (!/\.(cpp|cc|c|h|hpp|ino)$/.test(name)) continue;
    try {
      out += fs.readFileSync(path.join(srcDir, name), "utf8");
    } catch {
      /* best-effort */
    }
  }
  return out;
}

function readSidecar(sidecarPath: string): LibrarySidecarEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is LibrarySidecarEntry =>
        typeof e === "object" && e !== null && typeof e.module === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Emit the library artifacts for the libraries actually used in this
 * transpilation, and write the `libraries.json` sidecar:
 *
 *   1. scan the emitted sources for each library's gate token;
 *   2. write (write-if-changed) the shims of every gated library into the
 *      emitted source directory — the framework scaffold's CMake/program
 *      regen picks the sources up automatically;
 *   3. delete shim files recorded in the previous sidecar that are no longer
 *      used, so removing an import removes its native code;
 *   4. persist the sidecar (even when empty — that clears stale state).
 */
export function writeCuttlefishLibraryArtifacts(outDir: string, srcDir: string): void {
  const sidecarPath = path.join(outDir, LIBRARY_SIDECAR_NAME);
  const previous = readSidecar(sidecarPath);
  const previousShims = new Set(previous.flatMap((e) => e.shims));

  const emitted = readEmittedTokens(srcDir);
  const usedShims = new Set<string>();
  const entries: LibrarySidecarEntry[] = [];

  for (const { manifest, packageRoot } of getRegisteredCuttlefishLibraries()) {
    if (!emitted.includes(manifest.gateToken)) continue;

    for (const shim of manifest.shims) {
      let content: string;
      try {
        content = fs.readFileSync(path.join(packageRoot, shim.path), "utf8");
      } catch {
        continue; // broken library packaging — the missing header surfaces at compile
      }
      writeIfChanged(path.join(srcDir, shim.outName), content);
      usedShims.add(shim.outName);
    }

    entries.push({
      id: manifest.id,
      module: manifest.module,
      framework: manifest.framework,
      gateToken: manifest.gateToken,
      kconfig: manifest.kconfig ?? [],
      overlay: manifest.overlay ? path.join(packageRoot, manifest.overlay) : null,
      shims: manifest.shims.map((s) => s.outName).filter((n) => usedShims.has(n)),
    });
  }

  // Remove shims from a previous build whose library is no longer used.
  for (const name of previousShims) {
    if (usedShims.has(name)) continue;
    try {
      fs.rmSync(path.join(srcDir, name), { force: true });
    } catch {
      /* best-effort */
    }
  }

  writeIfChanged(sidecarPath, JSON.stringify(entries, null, 2) + "\n");
}

/**
 * Read the `libraries.json` sidecar for build-time consumers (framework
 * toolchains). Tolerant of a missing or corrupt file (returns []).
 */
export function readCuttlefishLibrarySidecar(outDir: string): LibrarySidecarEntry[] {
  return readSidecar(path.join(outDir, LIBRARY_SIDECAR_NAME));
}

/** Re-exported for transpile.ts libdef injection convenience. */
export function libraryDefinitionKey(module: string): string {
  return toModuleKey(module);
}
