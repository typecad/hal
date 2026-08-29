// Import specifiers that activate the safety engine. The safety engine was
// merged into @typecad/cuttlefish from the former @typecad/safety package;
// both specifiers keep working. Detection is purely by name — the module is
// never resolved or parsed (the graph builder skips it), so the legacy
// specifier does not require the frozen npm package to be installed.

/** The canonical specifier for the safety authoring surface. */
export const SAFETY_SPECIFIER = "@typecad/cuttlefish/safety";

/** The legacy specifier from when safety was a standalone package. */
export const LEGACY_SAFETY_SPECIFIER = "@typecad/safety";

/** True iff an import specifier refers to the safety authoring surface. */
export function isSafetyImportSpecifier(moduleSpecifier: string): boolean {
  return (
    moduleSpecifier === SAFETY_SPECIFIER ||
    moduleSpecifier === LEGACY_SAFETY_SPECIFIER
  );
}
