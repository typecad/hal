/**
 * Arduino Library Utilities — thin re-export from @typecode/framework-arduino
 */
export {
  getInstalledLibraries,
  findArduinoLibrary,
  findLibraryHeader,
  findLibrarySources,
  isArduinoLibraryImport,
  mapCppTypeToTs,
  parseParameters,
  parseCppClass,
  generateArduinoLibDecl,
  tryGenerateArduinoLibDecl,
  getArduinoLibraryHeaderName,
  getArduinoLibraryClassNames,
  generateUsageDocumentation,
  clearLibraryCache,
} from "@typecode/framework-arduino";
export type { ArduinoLibrary, GeneratedArduinoLib } from "@typecode/framework-arduino";
