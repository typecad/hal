import path from "node:path";
import ts from "typescript";
import { readText } from "../utils/fs.js";
import {
  ResolvedNpmPackage,
  NativeCppModule,
  TranspileGraphResult,
  detectNativeCppModule,
  getNpmPackageInfoForFile,
  isInNodeModules,
  resolveImport,
  isCuttlefishSDKPath,
} from "../transpile/resolution.js";
import { requireUIHook } from "../ui-hook.js";
import { isSafetyImportSpecifier } from "../safety/specifiers.js";
import { registerCuttlefishLibraryFromSpecifier } from "../library-packages.js";

/**
 * Sort files in dependency order using Kahn's algorithm.
 * Dependencies come before dependents so that include ordering is correct
 * (e.g., if A imports B, B appears before A in the result).
 *
 * Falls back to the original order for any files involved in dependency cycles.
 */
export function topologicalSortFiles(
  files: string[],
  dependencies: Map<string, Set<string>>,
): string[] {
  if (files.length <= 1) return [...files];

  const fileSet = new Set(files);

  // Build reverse adjacency list: dep → Set<files that depend on dep>
  const dependents = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  for (const f of files) {
    dependents.set(f, new Set());
    inDegree.set(f, 0);
  }

  for (const [file, deps] of dependencies) {
    if (!fileSet.has(file)) continue;
    for (const dep of deps) {
      if (fileSet.has(dep) && dep !== file) {
        dependents.get(dep)!.add(file);
        inDegree.set(file, (inDegree.get(file) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm: start with files that have no in-edges
  const queue: string[] = [];
  for (const f of files) {
    if (inDegree.get(f) === 0) {
      queue.push(f);
    }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const file = queue.shift()!;
    sorted.push(file);
    for (const dependent of dependents.get(file) ?? []) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  // If there are cycles, append remaining files in original order
  if (sorted.length < files.length) {
    const sortedSet = new Set(sorted);
    for (const f of files) {
      if (!sortedSet.has(f)) sorted.push(f);
    }
  }

  return sorted;
}

/**
 * Collects all files that need to be transpiled, following both relative and npm imports.
 * Also detects native C++ modules (.d.ts + .cpp pairs).
 * Files are returned in dependency order (dependencies before dependents).
 *
 * @param boardTarget  When provided, virtual board imports fall back to
 *                      this package specifier (legacy; generated boards win).
 */
export async function collectTranspileGraph(
  entryFile: string,
  boardTarget?: string,
  imageDecodeOpts?: { maxW?: number; maxH?: number },
): Promise<TranspileGraphResult> {
  const ordered: string[] = [];
  const pending: string[] = [path.resolve(entryFile)];
  const visited = new Set<string>();
  const npmPackages = new Map<string, ResolvedNpmPackage>();
  const nativeModules = new Map<string, NativeCppModule>();
  const uiModules = new Set<string>();
  // Track dependency edges for topological sorting
  const dependencies = new Map<string, Set<string>>();

  while (pending.length > 0) {
    const filePath = pending.shift();
    if (!filePath || visited.has(filePath)) {
      continue;
    }

    visited.add(filePath);

    // Skip TypeCAD SDK files — they are type-level definitions only
    if (isCuttlefishSDKPath(filePath)) {
      continue;
    }

    ordered.push(filePath);
    const fileDeps = new Set<string>();
    dependencies.set(filePath, fileDeps);

    const sourceText = readText(filePath);
    const extension = path.extname(filePath).toLowerCase();

    // .ui single-file component: split into script/style/template. The <script>
    // becomes the TS source for graph walking; the template+style are registered
    // as a UI module at a synthetic .ui.html path (so loadUIModuleFromText caches
    // it + the UI registry generates the type declaration under types/). The script's
    // `screen` reference resolves to the in-file template.
    if (extension === ".ui") {
      const ui = requireUIHook();
      const parts = ui.splitUiFile(sourceText);
      // Register the template as a UI module at <file>.ui.html (synthetic path).
      const uiHtmlPath = filePath + ".html";
      // Prime the image-conversion cache before the (synchronous) module
      // load — <img src="*.png|jpg|ico|…"> decodes here, and the module's
      // asset reader + natural-size layout pull from the cache.
      await ui.warmUpImageDecoding(parts.html, path.dirname(filePath), imageDecodeOpts ?? {});
      ui.loadUIModuleFromText(uiHtmlPath, parts.html, parts.style, filePath);
      uiModules.add(uiHtmlPath);
      // Use the <script> as the TS source for import-graph walking. Inject an
      // implicit `import { screen } from './<base>.ui.html'` so the script can
      // reference `screen` without an explicit import.
      const baseName = path.basename(filePath, ".ui");
      const scriptWithImport = `import { screen } from './${baseName}.ui.html';\n` + parts.script;
      const uiSource = ts.createSourceFile(filePath, scriptWithImport, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      // Walk the script's imports to discover dependencies.
      for (const statement of uiSource.statements) {
        let moduleSpecifier: string | undefined;
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
          moduleSpecifier = statement.moduleSpecifier.text;
        } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
          moduleSpecifier = statement.moduleSpecifier.text;
        }
        if (!moduleSpecifier) continue;
        // Cuttlefish library package: an import whose package ships a
        // typecad-hal.library.json contributes native shims + build fragments
        // instead of transpiling — its own TypeScript types are the contract.
        // Must precede the @typecad/* skips: scoped libraries would otherwise
        // be dropped as "SDK packages" here (the .ui script loop skips ALL
        // @typecad/* specifiers, unlike the selective main-loop skip list).
        if (registerCuttlefishLibraryFromSpecifier(filePath, moduleSpecifier)) continue;
        if (moduleSpecifier === "@typecad/hal/testing" || moduleSpecifier === "@typecad/ui" || isSafetyImportSpecifier(moduleSpecifier)) continue;
        if (moduleSpecifier.startsWith("@typecad/")) continue;
        const resolved = resolveImport(filePath, moduleSpecifier, boardTarget);
        if (!resolved) continue;
        if (resolved.uiModule) continue; // already handled above
        fileDeps.add(resolved.sourcePath);
        if (!visited.has(resolved.sourcePath)) pending.push(resolved.sourcePath);
      }
      continue; // .ui file itself is not a TS file; the script is inlined at emit
    }

    const source = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      extension === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    for (const statement of source.statements) {
      let moduleSpecifier: string | undefined;

      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        moduleSpecifier = statement.moduleSpecifier.text;
      } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        moduleSpecifier = statement.moduleSpecifier.text;
      }

      if (!moduleSpecifier) {
        continue;
      }

      // Check for native C++ module (.d.ts + .cpp pair)
      const nativeModule = detectNativeCppModule(filePath, moduleSpecifier);
      if (nativeModule) {
        nativeModules.set(moduleSpecifier, nativeModule);
        continue; // Don't try to resolve as TypeScript
      }

      // Cuttlefish library package: an import whose package ships a
      // typecad-hal.library.json contributes native shims + build fragments
      // instead of transpiling — its own TypeScript types are the contract.
      // Checked before the @typecad/* skips so scoped libraries register.
      if (registerCuttlefishLibraryFromSpecifier(filePath, moduleSpecifier)) {
        continue;
      }

      // Skip the testing DSL (@typecad/hal/testing) — it provides type-level
      // stubs only. The AST preprocessor rewrites all describe/expect calls
      // before transpilation.
      if (moduleSpecifier === "@typecad/hal/testing") {
        continue;
      }

      // The simulator is host-only (Node/vitest). A device build importing it
      // would otherwise fail with a confusing lowering error after the broad
      // @typecad/* skip silently drops it — fail with the fix instead.
      if (moduleSpecifier === "@typecad/hal/sim") {
        throw new Error(
          `${path.basename(filePath)} imports '@typecad/hal/sim' — the simulator runs on your computer ` +
          `(vitest, sim/), not on the board. Keep simulator imports in sim/**/*.test.ts.`,
        );
      }

      // Skip @typecad/ui and the safety authoring surface — they provide
      // compile-time authoring stubs only. Their calls (ui.mount/signal/bind,
      // safe.read) are intercepted at IR-build time and lowered to IR; the
      // modules themselves must NOT be emitted as C++ (they would synthesize
      // bogus _ui_t / _safe_t structs). All runtime definitions the user code
      // needs (enums, structs, shims) are provided by the safety polyfill.
      if (moduleSpecifier === "@typecad/ui" || isSafetyImportSpecifier(moduleSpecifier)) {
        continue;
      }

      // Skip the legacy board/mcu package prefixes, @typecad/hal,
      // and @typecad/framework-* — these packages ship src/ for HAL metadata
      // introspection (hal-parser.ts, board-resolver.ts) but their source
      // must NOT be transpiled to C++. The HAL resolver loads class/method
      // metadata from these files separately; emitting them as C++ produces
      // thousands of lines of stub functions (board(), gpioWrite(), etc.)
      // and pulls in unsupported types (Promise, variant, Object.freeze).
      // Skipping @typecad/hal is especially important: its 28 source files
      // (gpio.ts, i2c.ts, spi.ts, etc.) were all walked through full
      // buildProgramIR, adding ~40 seconds to every transpile.
      if (moduleSpecifier === "@typecad/hal"
        || moduleSpecifier.startsWith("@typecad/board-")
        || moduleSpecifier.startsWith("@typecad/mcu-")
        || moduleSpecifier.startsWith("@typecad/framework-")) {
        continue;
      }

      const resolved = resolveImport(filePath, moduleSpecifier, boardTarget);
      // .ui.html modules: load into the UI registry, record the path, and don't
      // push onto `pending` (they are never parsed as TypeScript).
      if (resolved?.uiModule) {
        const uiHtmlText = readText(resolved.sourcePath);
        await requireUIHook().warmUpImageDecoding(uiHtmlText, path.dirname(resolved.sourcePath), imageDecodeOpts ?? {});
        requireUIHook().loadUIModule(resolved.sourcePath);
        uiModules.add(resolved.sourcePath);
        // Track the dependency edge so topological sort orders the importer
        // after the (virtual) UI module.
        fileDeps.add(resolved.sourcePath);
        continue;
      }
      if (resolved) {
        // Track dependency edge for topological sorting
        fileDeps.add(resolved.sourcePath);

        if (!visited.has(resolved.sourcePath)) {
          pending.push(resolved.sourcePath);
          if (resolved.npmPackage) {
            npmPackages.set(resolved.sourcePath, resolved.npmPackage);
          } else if (isInNodeModules(resolved.sourcePath)) {
            // If the file is in node_modules but wasn't resolved as an npm package,
            // it was reached via relative import from another npm package file.
            // Create npm package info for it.
            const npmInfo = getNpmPackageInfoForFile(resolved.sourcePath, moduleSpecifier);
            if (npmInfo) {
              npmPackages.set(resolved.sourcePath, npmInfo);
            }
          }
        }
      }
    }
  }

  // Sort files in dependency order (dependencies before dependents)
  const sorted = topologicalSortFiles(ordered, dependencies);
  return { files: sorted, npmPackages, nativeModules, uiModules };
}
