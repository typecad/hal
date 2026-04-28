// ---------------------------------------------------------------------------
// Vitest setup — ensures the framework-native strategy is loadable
// ---------------------------------------------------------------------------

// The typehal CLI discovers the framework at transpile time by loading
// the package named in typehal.config.ts. No global registration needed
// since the pipeline invokes the CLI as a subprocess.
