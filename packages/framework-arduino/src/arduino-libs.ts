// ---------------------------------------------------------------------------
// @typecode/framework-arduino — Arduino Library Utilities
//
// Thin re-export barrel. Implementation is split across:
//   - lib-discovery.ts    — finding installed libraries via arduino-cli
//   - cpp-parser.ts       — parsing C++ headers into an IR
//   - lib-declaration.ts  — generating .d.ts declarations + docs
// ---------------------------------------------------------------------------

export type { ArduinoLibrary } from './lib-discovery';
export {
  getInstalledLibraries,
  findArduinoLibrary,
  findLibraryHeader,
  findLibrarySources,
  isArduinoLibraryImport,
  clearLibraryCache,
} from './lib-discovery';

export type { CppParseResult } from './cpp-parser';
export {
  mapCppTypeToTs,
  parseParameters,
  parseCppClass,
} from './cpp-parser';

export type { GeneratedArduinoLib } from './lib-declaration';
export {
  generateArduinoLibDecl,
  tryGenerateArduinoLibDecl,
  getArduinoLibraryHeaderName,
  getArduinoLibraryClassNames,
  generateUsageDocumentation,
} from './lib-declaration';

