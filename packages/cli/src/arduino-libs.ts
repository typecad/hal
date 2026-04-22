import path from "node:path";
import { loadFrameworkPackage } from "./framework-package";

const FRAMEWORK_PACKAGE = "@typecode/framework-arduino";

function getArduinoFramework(fromDir: string): any {
  return loadFrameworkPackage(FRAMEWORK_PACKAGE, fromDir);
}

export function getInstalledLibraries(): unknown {
  const pkg = getArduinoFramework(process.cwd());
  return pkg.getInstalledLibraries();
}

export function findArduinoLibrary(name: string): unknown {
  const pkg = getArduinoFramework(process.cwd());
  return pkg.findArduinoLibrary(name);
}

export function findLibraryHeader(library: unknown): unknown {
  const pkg = getArduinoFramework(process.cwd());
  return pkg.findLibraryHeader(library);
}

export function findLibrarySources(library: unknown): unknown {
  const pkg = getArduinoFramework(process.cwd());
  return pkg.findLibrarySources(library);
}

export function isArduinoLibraryImport(importName: string): boolean {
  const pkg = getArduinoFramework(process.cwd());
  return pkg.isArduinoLibraryImport(importName);
}

export function mapCppTypeToTs(typeName: string): string {
  const pkg = getArduinoFramework(process.cwd());
  return pkg.mapCppTypeToTs(typeName);
}

export function parseParameters(signature: string): unknown {
  const pkg = getArduinoFramework(process.cwd());
  return pkg.parseParameters(signature);
}

export function parseCppClass(source: string): unknown {
  const pkg = getArduinoFramework(process.cwd());
  return pkg.parseCppClass(source);
}

export function generateArduinoLibDecl(library: unknown): string {
  const pkg = getArduinoFramework(process.cwd());
  return pkg.generateArduinoLibDecl(library);
}

export function tryGenerateArduinoLibDecl(modulePath: string, file: string): string | undefined {
  const pkg = getArduinoFramework(path.dirname(modulePath));
  return pkg.tryGenerateArduinoLibDecl(modulePath, file);
}

export function getArduinoLibraryHeaderName(library: unknown): string {
  const pkg = getArduinoFramework(process.cwd());
  return pkg.getArduinoLibraryHeaderName(library);
}

export function getArduinoLibraryClassNames(library: unknown): string[] {
  const pkg = getArduinoFramework(process.cwd());
  return pkg.getArduinoLibraryClassNames(library);
}

export function generateUsageDocumentation(library: unknown): string {
  const pkg = getArduinoFramework(process.cwd());
  return pkg.generateUsageDocumentation(library);
}

export function clearLibraryCache(): void {
  const pkg = getArduinoFramework(process.cwd());
  return pkg.clearLibraryCache();
}
