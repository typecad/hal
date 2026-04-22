import path from "node:path";

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
): any {
  const packagePath = resolveFrameworkPackage(packageName, fromDir);
  if (!packagePath) {
    throw new Error(
      `Unable to resolve framework package '${packageName}' from '${fromDir}'. ` +
      `Install it or pass a different framework package name in your TypeCode config.`,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(packagePath);
}

export function loadOptionalFrameworkPackage(
  packageName = DEFAULT_FRAMEWORK_PACKAGE,
  fromDir = process.cwd(),
): any | undefined {
  const packagePath = resolveFrameworkPackage(packageName, fromDir);
  if (!packagePath) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(packagePath);
}
