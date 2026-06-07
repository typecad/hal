// ---------------------------------------------------------------------------
// Vitest setup — ensures the framework-native strategy is loadable
// ---------------------------------------------------------------------------

// The TypeCAD CLI discovers the framework at transpile time by loading
// the package named in TypeCAD.config.ts. No global registration needed
// since the pipeline invokes the CLI as a subprocess.
