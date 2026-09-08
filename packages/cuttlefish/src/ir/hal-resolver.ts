import { halInstances } from "./build-ir-state.js";
export { halInstances };

export {
  HALInstance,
  HALMethodEntry,
  HALClassEntry,
  halClassRegistry,
  halGlobalFunctions,
  halSingletons,
  halCtorIncludes,
  halModulesLoaded,
  isHALSingleton,
  setHALProjectDir,
  resolveHALSourceDir,
  extractCtorFieldMap,
  extractCtorIncludes,
  extractParams,
  extractMethods,
  loadHALModules,
  getCtorIncludes,
  resolveHALReceiver,
  resolveCtorFieldValues,
  isKnownHALClass,
  getHALCtorFieldMap,
} from "./hal/hal-parser.js";

export {
  resolveSemanticArg,
  resolveNumericArg,
  portFromInstance,
  tryResolveBoardResolveArg,
  tryResolveCompoundSemanticReturn,
  tryResolveSemanticCall,
} from "./hal/hal-plugins.js";

export {
  maybeEscapeResolvedText,
  resolveExpressionText,
  extractAndRegisterCallbacks,
  processHALMethodBody,
  isLiteralReturnValue,
  resolveCppObjectName,
  processStatementList,
  resetHALResolver,
  setActiveStrategy,
  resolveHALExprToText,
  registerFloatVariable,
  buildSnprintfFromConcat,
} from "./hal/hal-emitter.js";
