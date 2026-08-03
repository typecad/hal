// ---------------------------------------------------------------------------
// @typecad/framework-arduino — Arduino framework strategy
//
// Provides the ArduinoStrategy implementation for Arduino framework code
// generation. This is the main entry point for the framework-arduino package.
// ---------------------------------------------------------------------------

// Export the main strategy class
export { ArduinoStrategy, splitStreamChain } from './strategy.js';

// Export as FrameworkStrategy for consistency with framework package naming
export { ArduinoStrategy as FrameworkStrategy } from './strategy.js';

// Arduino compile/upload/monitor
export {
  flattenGeneratedModulesIntoSketch,
  compileArduinoSketch,
  uploadArduinoSketch,
  monitorArduinoSketch,
} from './arduino-compile.js';

// Toolchain object for the framework registry
import { flattenGeneratedModulesIntoSketch, compileArduinoSketch, uploadArduinoSketch, monitorArduinoSketch } from './arduino-compile.js';
export const Toolchain = {
  prepare: flattenGeneratedModulesIntoSketch,
  compile: (options: any) => compileArduinoSketch(options.sourcePath, options.buildTarget, {
    extraFlags: options.extraFlags,
    defines: options.defines,
  }),
  upload: (options: any) => uploadArduinoSketch(options.outputDir, options.buildTarget, options.port),
  monitor: (options: any) => monitorArduinoSketch(options.port, options.baud),
};

// Library discovery — consumed by the transpiler's dynamic module loader
export { isArduinoLibraryImport as isFrameworkLibraryImport, getArduinoLibraryHeaderName as getFrameworkLibraryHeaderName } from './arduino-libs.js';
export { tryGenerateArduinoLibDecl as tryGenerateLibDecl } from './arduino-libs.js';
export { buildArduinoClassNameMap as buildClassNameMap } from './arduino-class-map.js';

// Subcommand presenters — consumed by the cuttlefish CLI dispatcher via the
// LoadedFramework object (see framework-package.ts). `doctor` and `licenses`
// are Arduino-specific (they shell out to arduino-cli and read Arduino core/
// library layout), so they live in framework-arduino rather than in cuttlefish.
// Re-exported under their dispatcher-facing aliases (`doctor` / `licenses`) so
// the loader picks them up as mod.doctor / mod.licenses.
export { runDoctor as doctor } from './doctor.js';
export { runLicensesPresenter as licenses } from './licenses.js';
