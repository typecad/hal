const COMPILE_TIME_ONLY_CALLS = new Set<string>([
  "registerPlatformStrategy",
  "registerPolyfill",
  "registerBoard",
  "defineBoardManifest",
]);

const COMPILE_TIME_ONLY_CLASSES = new Set<string>([
  "NativeStrategy",
  "BoardStrategy",
]);

export function isCompileTimeOnlyCallName(name: string): boolean {
  return COMPILE_TIME_ONLY_CALLS.has(name);
}

export function isCompileTimeOnlyClassName(name: string): boolean {
  return COMPILE_TIME_ONLY_CLASSES.has(name) || name.endsWith("Strategy");
}
