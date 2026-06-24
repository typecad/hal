// Module-scoped CSS theme path override.
// Set via setThemeCss() from the config loader; read by loadUIModule().
// When set, this path replaces the default sibling-file convention
// (hello.ui.html → hello.ui.css).

let themeCssOverride: string | null = null;

/** Set the CSS theme file path. When non-null, loadUIModule uses this
 *  instead of the default sibling .ui.css. Pass null to restore default. */
export function setThemeCss(path: string | null): void {
  themeCssOverride = path;
}

/** Get the CSS theme override path, or null for default sibling-file behavior. */
export function getThemeCss(): string | null {
  return themeCssOverride;
}

/** Reset to default (sibling-file convention). */
export function resetThemeCss(): void {
  themeCssOverride = null;
}
