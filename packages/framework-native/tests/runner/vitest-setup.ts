// ---------------------------------------------------------------------------
// Vitest setup — ensures the framework-native strategy is loadable
// ---------------------------------------------------------------------------

// The typecode CLI discovers the framework at transpile time by loading
// the package named in typecode.config.ts. No global registration needed
// since the pipeline invokes the CLI as a subprocess.
