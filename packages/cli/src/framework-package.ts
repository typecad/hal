import path from "node:path";
import { setFrameworkApi, clearFrameworkApi } from "./framework-api";
import type { FrameworkApi } from "./framework-api";

export const DEFAULT_FRAMEWORK_PACKAGE = "@typecode/framework-arduino";

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

export function loadFrameworkPackage(
  packageName = DEFAULT_FRAMEWORK_PACKAGE,
  fromDir = process.cwd(),
): FrameworkApi {
  const packagePath = resolveFrameworkPackage(packageName, fromDir);
  if (!packagePath) {
    throw new Error(
      `Unable to resolve framework package '${packageName}' from '${fromDir}'. ` +
      `Install it or pass a different framework package name in your TypeCode config.`,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(packagePath) as FrameworkApi;
  setFrameworkApi(mod);
  return mod;
}

export function loadOptionalFrameworkPackage(
  packageName = DEFAULT_FRAMEWORK_PACKAGE,
  fromDir = process.cwd(),
): FrameworkApi | undefined {
  const packagePath = resolveFrameworkPackage(packageName, fromDir);
  if (!packagePath) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(packagePath) as FrameworkApi;
  setFrameworkApi(mod);
  return mod;
}

export function resetFrameworkPackage(): void {
  clearFrameworkApi();
}
