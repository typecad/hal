// ---------------------------------------------------------------------------
// @typecad/framework-arduino — Arduino Library Utilities
//
// Thin re-export barrel. Implementation is split across:
//   - lib-discovery.ts    — finding installed libraries via arduino-cli
//   - cpp-parser.ts       — parsing C++ headers into an IR
//   - lib-declaration.ts  — generating .d.ts declarations + docs
// ---------------------------------------------------------------------------

export type { ArduinoLibrary } from './lib-discovery.js';
export {
  getInstalledLibraries,
  findArduinoLibrary,
  findLibraryHeader,
  isArduinoLibraryImport,
  matchLibraryBySpecifier,
  clearLibraryCache,
} from './lib-discovery.js';

export type { CppParseResult } from './cpp-parser.js';
export {
  mapCppTypeToTs,
  parseParameters,
  parseCppClass,
} from './cpp-parser.js';

export type { GeneratedArduinoLib } from './lib-declaration.js';
export {
  tryGenerateArduinoLibDecl,
  getArduinoLibraryHeaderName,
  getArduinoLibraryClassNames,
  generateUsageDocumentation,
} from './lib-declaration.js';

