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
} from "@typehal/framework-arduino";
export type { ArduinoLibrary, GeneratedArduinoLib } from "@typehal/framework-arduino";
