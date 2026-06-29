// Module-scoped CSS theme path override.
// Set via setThemeCss() from the config loader; read by loadUIModule().
// When set, this path replaces the default sibling-file convention
// (hello.ui.html → hello.ui.css).

let themeCssOverride: string | null = null;
let themeClassOverride: string | null = null;


/** Set the CSS theme file path. When non-null, loadUIModule uses this
 *  instead of the default sibling .ui.css. Pass null to restore default. */
export function setThemeCss(path: string | null): void {
  themeCssOverride = path;
}

/** Get the CSS theme override path, or null for default sibling-file behavior. */
export function getThemeCss(): string | null {
  return themeCssOverride;
}

/** Set the active theme class for class-scoped CSS variables (e.g. "dark").
 *  When set, var() substitution prefers variables defined under this class
 *  over :root defaults. */
export function setThemeClass(cls: string | null): void {
  themeClassOverride = cls;
}

/** Get the active theme class, or null (use :root only). */
export function getThemeClass(): string | null {
  return themeClassOverride;
}

/** Reset to default (sibling-file convention). */
export function resetThemeCss(): void {
  themeCssOverride = null;
  themeClassOverride = null;
}
