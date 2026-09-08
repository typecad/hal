import fs from "node:fs";
import path from "node:path";
import { findGeneratedBoard } from "../ir/board-resolver.js";

export interface ResolvedNpmPackage {
  packagePath: string;
  sourcePath: string;
  subpath: string;
  packageName: string;
  moduleKey: string;
}

export interface NativeCppModule {
  declPath: string;
  cppPath: string;
  headerPath?: string;
  moduleKey: string;
}

export interface TranspileGraphResult {
  files: string[];
  npmPackages: Map<string, ResolvedNpmPackage>;
  nativeModules: Map<string, NativeCppModule>;
  /** `.ui.html` modules discovered during graph build, keyed by resolved path. */
  uiModules: Set<string>;
}

function resolveLocalImport(fromFile: string, moduleSpecifier: string): string | undefined {
  if (!moduleSpecifier.startsWith(".")) {
    return undefined;
  }

  let normalizedSpecifier = moduleSpecifier;
  if (normalizedSpecifier.endsWith(".js")) {
    normalizedSpecifier = normalizedSpecifier.slice(0, -3) + ".ts";
  } else if (normalizedSpecifier.endsWith(".mjs")) {
    normalizedSpecifier = normalizedSpecifier.slice(0, -5) + ".ts";
  }

  const basePath = path.resolve(path.dirname(fromFile), normalizedSpecifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      continue;
    }

    const extension = path.extname(candidate).toLowerCase();
    if (extension === ".ts" || extension === ".tsx") {
      return path.resolve(candidate);
    }
    // .ui.html resolves as a UI module (not TypeScript). Only the .ui.html
    // convention is accepted — plain .html is not a UI module.
    if (candidate.toLowerCase().endsWith(".ui.html")) {
      return path.resolve(candidate);
    }
  }

  return undefined;
}

function parseModuleSpecifier(moduleSpecifier: string): { packageName: string; subpath: string } {
  const parts = moduleSpecifier.split("/");
  if (moduleSpecifier.startsWith("@")) {
    const scope = parts[0];
    const packageName = parts.length > 1 ? `${scope}/${parts[1]}` : scope;
    const subpath = parts.length > 2 ? parts.slice(2).join("/") : "";
    return { packageName, subpath };
  }

  const packageName = parts[0];
  const subpath = parts.length > 1 ? parts.slice(1).join("/") : "";
  return { packageName, subpath };
}

function findNodeModulesPackage(fromFile: string, packageName: string): string | undefined {
  let currentDir = path.dirname(path.resolve(fromFile));

  while (currentDir !== path.dirname(currentDir)) {
    const packageDir = path.join(currentDir, "node_modules", packageName);
    if (fs.existsSync(packageDir) && fs.statSync(packageDir).isDirectory()) {
      return packageDir;
    }
    currentDir = path.dirname(currentDir);
  }

  const rootPackageDir = path.join(currentDir, "node_modules", packageName);
  if (fs.existsSync(rootPackageDir) && fs.statSync(rootPackageDir).isDirectory()) {
    return rootPackageDir;
  }

  return undefined;
}

function readPackageJson(packageDir: string): Record<string, unknown> | null {
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(packageJsonPath, "utf8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolvePackageExports(
  packageDir: string,
  subpath: string,
  packageJson: Record<string, unknown>,
): string | undefined {
  const exportsField = packageJson["exports"];
  if (!exportsField || typeof exportsField !== "object") {
    return undefined;
  }

  const exportKey = subpath ? `./${subpath}` : ".";
  let exportTarget = (exportsField as Record<string, unknown>)[exportKey];

  if (exportTarget && typeof exportTarget === "object") {
    const conditional = exportTarget as Record<string, unknown>;
    exportTarget = conditional["types"] ?? conditional["import"] ?? conditional["default"];
  }

  if (typeof exportTarget !== "string") {
    return undefined;
  }

  return mapDistToSource(packageDir, exportTarget, subpath);
}

function mapDistToSource(packageDir: string, distPath: string, subpath: string): string | undefined {
  const relativePath = distPath.startsWith("./") ? distPath.slice(2) : distPath;

  let sourcePath: string | undefined;
  const packagesMatch = relativePath.match(/^dist\/(packages\/[^/]+\/src\/.+)\.js$/);
  if (packagesMatch) {
    sourcePath = path.join(packageDir, packagesMatch[1] + ".ts");
    if (fs.existsSync(sourcePath)) {
      return sourcePath;
    }
  }

  const distSrcMatch = relativePath.match(/^dist\/(src\/.+)\.js$/);
  if (distSrcMatch) {
    sourcePath = path.join(packageDir, distSrcMatch[1] + ".ts");
    if (fs.existsSync(sourcePath)) {
      return sourcePath;
    }
  }

  const distMatch = relativePath.match(/^dist\/(.+)\.js$/);
  if (distMatch) {
    sourcePath = path.join(packageDir, "src", distMatch[1] + ".ts");
    if (fs.existsSync(sourcePath)) {
      return sourcePath;
    }
    sourcePath = path.join(packageDir, distMatch[1] + ".ts");
    if (fs.existsSync(sourcePath)) {
      return sourcePath;
    }
  }

  const subpathPrefix = subpath ? `${subpath}/` : "";
  if (subpath) {
    sourcePath = path.join(packageDir, "packages", subpath, "src", "index.ts");
    if (fs.existsSync(sourcePath)) {
      return sourcePath;
    }
  }

  sourcePath = path.join(packageDir, "src", subpathPrefix, "index.ts");
  if (fs.existsSync(sourcePath)) {
    return sourcePath;
  }

  sourcePath = path.join(packageDir, subpathPrefix, "index.ts");
  if (fs.existsSync(sourcePath)) {
    return sourcePath;
  }

  return undefined;
}

function resolveNpmPackageImport(
  fromFile: string,
  moduleSpecifier: string,
): ResolvedNpmPackage | undefined {
  const { packageName, subpath } = parseModuleSpecifier(moduleSpecifier);
  const packageDir = findNodeModulesPackage(fromFile, packageName);
  if (!packageDir) {
    return undefined;
  }

  const packageJson = readPackageJson(packageDir);
  if (!packageJson) {
    return undefined;
  }

  let sourcePath = resolvePackageExports(packageDir, subpath, packageJson);
  if (!sourcePath) {
    if (subpath) {
      sourcePath = path.join(packageDir, "packages", subpath, "src", "index.ts");
    }
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      sourcePath = path.join(packageDir, "src", "index.ts");
    }
    if (!fs.existsSync(sourcePath)) {
      sourcePath = path.join(packageDir, "index.ts");
    }
    if (!fs.existsSync(sourcePath)) {
      sourcePath = undefined;
    }
  }

  if (!sourcePath) {
    return undefined;
  }

  let moduleKey = subpath || packageName.split("/").pop() || packageName;
  if (moduleKey.endsWith(".js")) {
    moduleKey = moduleKey.slice(0, -3);
  } else if (moduleKey.endsWith(".mjs")) {
    moduleKey = moduleKey.slice(0, -4);
  }

  return {
    packagePath: packageDir,
    sourcePath: path.resolve(sourcePath),
    subpath,
    packageName,
    moduleKey,
  };
}

export function resolveImport(
  fromFile: string,
  moduleSpecifier: string,
  boardTarget?: string,
): { sourcePath: string; npmPackage?: ResolvedNpmPackage; uiModule?: boolean } | undefined {
  let effectiveSpecifier = moduleSpecifier;
  void boardTarget;

  const localResolved = resolveLocalImport(fromFile, effectiveSpecifier);
  if (localResolved) {
    // .ui.html files resolve as UI modules, not TypeScript sources. Only set
    // the flag when true, so `undefined` cleanly means "regular TS module".
    if (localResolved.toLowerCase().endsWith(".ui.html")) {
      return { sourcePath: localResolved, uiModule: true };
    }
    return { sourcePath: localResolved };
  }

  const npmResolved = resolveNpmPackageImport(fromFile, effectiveSpecifier);
  if (npmResolved) {
    return { sourcePath: npmResolved.sourcePath, npmPackage: npmResolved };
  }

  return undefined;
}

export function isInNodeModules(filePath: string): boolean {
  const normalized = path.resolve(filePath).replace(/\\/g, "/");
  return normalized.includes("/node_modules/");
}

export function getNpmPackageInfoForFile(filePath: string, moduleSpecifier: string): ResolvedNpmPackage | undefined {
  if (!isInNodeModules(filePath)) {
    return undefined;
  }

  const parts = moduleSpecifier.split("/");
  let packageName: string;
  let subpath: string;

  if (moduleSpecifier.startsWith("@")) {
    packageName = parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0];
    subpath = parts.length > 2 ? parts.slice(2).join("/") : "";
  } else {
    packageName = parts[0];
    subpath = parts.length > 1 ? parts.slice(1).join("/") : "";
  }

  let moduleKey = subpath || packageName.split("/").pop() || packageName;
  if (moduleKey.endsWith(".js")) {
    moduleKey = moduleKey.slice(0, -3);
  } else if (moduleKey.endsWith(".mjs")) {
    moduleKey = moduleKey.slice(0, -4);
  }

  let packageDir = path.dirname(filePath);
  while (packageDir !== path.dirname(packageDir)) {
    const packageJsonPath = path.join(packageDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      break;
    }
    packageDir = path.dirname(packageDir);
  }

  return {
    packagePath: packageDir,
    sourcePath: path.resolve(filePath),
    subpath,
    packageName,
    moduleKey,
  };
}

export function detectNativeCppModule(fromFile: string, moduleSpecifier: string): NativeCppModule | undefined {
  if (!moduleSpecifier.startsWith(".")) {
    return undefined;
  }

  const basePath = path.resolve(path.dirname(fromFile), moduleSpecifier);
  const declCandidates = [`${basePath}.d.ts`, path.join(basePath, "index.d.ts")];

  for (const declPath of declCandidates) {
    if (!fs.existsSync(declPath) || !fs.statSync(declPath).isFile()) {
      continue;
    }

    const cppPath = declPath.replace(/\.d\.ts$/i, ".cpp");
    if (fs.existsSync(cppPath) && fs.statSync(cppPath).isFile()) {
      const moduleKey = path.basename(declPath, ".d.ts");
      const headerPath = declPath.replace(/\.d\.ts$/i, ".h");
      const headerExists = fs.existsSync(headerPath) && fs.statSync(headerPath).isFile();
      return {
        declPath: path.resolve(declPath),
        cppPath: path.resolve(cppPath),
        headerPath: headerExists ? path.resolve(headerPath) : undefined,
        moduleKey,
      };
    }
  }

  return undefined;
}

export function isCuttlefishSDKPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return (
    /\/code\/core\//.test(normalized) ||
    /\/packages\/expect\//.test(normalized) ||
    /\/packages\/cuttlefish\//.test(normalized) ||
    /\/node_modules\/@typecad\/core\//.test(normalized) ||
    /\/node_modules\/@typecad\/expect\//.test(normalized) ||
    /\/node_modules\/@typecad\/cuttlefish\//.test(normalized) ||
    // The generated project-local board module: like @typecad/hal, its source
    // exists for pin resolution (halInstances / board constants), never for
    // C++ emission — transpiling it would treat LED/PA5 as cross-module
    // imports instead of compile-time pin facts.
    /\/\.typecad-hal\/board\.ts$/.test(normalized)
  );
}
