// ---------------------------------------------------------------------------
// Shared types barrel export
//
// Re-exports all shared types for use by CLI and framework packages.
// ---------------------------------------------------------------------------

// Base types
export type { Diagnostic, PlatformContext, SourceSpan, TargetProfile } from './types.js';
// Source-map types (read by framework-esp32's gdb-script generator)
export type { GeneratedSourceMap, SourceMapEntry } from '../../types.js';

// C++ type IR (structured replacement for stringly-typed CppType)
export type {
  CppTypeIR,
  CppTypeKind,
  CppPrimitiveName,
  CppFormatKind,
} from './cpp-type-ir.js';
export {
  parseCppType,
  renderCppType,
  splitTemplateArgs,
  isPointer,
  isReference,
  isContainer,
  isVector,
  isMap,
  isSet,
  isTuple,
  isVariant,
  isStdFunction,
  isStaticArray,
  isCArray,
  isStringLike,
  isPrimitive,
  bareType,
  elementOf,
  formatKindOf,
  CppTypeIR as cppTypeIRBuilder,
  parsedIsPointer,
  parsedIsStringLike,
  parsedIsPrimitive,
  parsedIsContainer,
  parsedIsVector,
  parsedIsMap,
  parsedIsSet,
  parsedIsTuple,
  parsedIsVariant,
  parsedIsStaticArray,
  parsedIsStdString,
  parsedElementOf,
  parsedElementString,
  parsedBareString,
  parsedBareType,
  collectNamedTypes,
  parsedCollectNamedTypes,
  needsCStrForStringLike,
  parsedIsPlainStructType,
} from './cpp-type-ir.js';

// IR types
export type {
  ExpressionIR,
  StatementIR,
  ProgramIR,
  ImportIR,
  ReExportIR,
  CallExpressionIR,
  SuperCallIR,
  VariableDeclarationIR,
  AssignmentIR,
  UpdateIR,
  ReturnIR,
  WhileIR,
  IfIR,
  ForIR,
  ForOfIR,
  ForInIR,
  BreakIR,
  ContinueIR,
  DoWhileIR,
  SwitchIR,
  CaseIR,
  TryIR,
  ThrowIR,
  LabeledIR,
  BlockIR,
  HALOpStatementIR,
  FunctionIR,
  StructDefIR,
  EnumIR,
  ClassFieldIR,
  ClassConstructorIR,
  ClassMethodIR,
  ClassGetterIR,
  ClassSetterIR,
  ClassIR,
  InterfaceIR,
  TypeAliasIR,
  NamespaceIR,
  PeripheralUsageIR,
  RegisterBitFieldIR,
  RegisterClassIR,
  ParameterIR,
  CppType,
} from './ir.js';

// HAL Operation IR types
export type {
  HALOpIR,
  HALOperationKind,
} from './hal-op-ir.js';
export { HAL_OPERATION_KINDS } from './hal-op-ir.js';

// Display HAL Operation IR types (graphics draw calls)
export type {
  DisplayInitOp,
  DisplayFillRectOp,
  DisplayDrawTextOp,
  DisplayDrawRectOp,
  DisplayFlushOp,
  DisplayHALOp,
} from './display-op-ir.js';
export { DISPLAY_OPERATION_KINDS } from './display-op-ir.js';

// Platform graphics strategy (display driver resolution + per-target capacity)
export type { PlatformGraphicsStrategy, GraphicsCapacity } from './graphics-strategy.js';

// Display profiles (declarative hardware description)
export type { DisplayProfile, DisplayConfig, DisplaySize, TouchProfile, TouchLibrary, TouchAdapterCodegen, ResolvedDisplay } from './display-profile.js';
export { effectiveDisplaySize, normalizeDisplayRotation, resolveDisplayProfile, resolveScrollConfig, DEFAULT_SCROLL_CANVAS_BUDGET_BYTES } from './display-profile.js';

// Shared 5x7 glcdfont table (Adafruit public-domain source). Consumed by
// the SDL preview adapter and the native CuttlefishGFX runtime-header slice.
export { GLCDFONT_BYTES, renderGlcdfontArray } from './glcdfont.js';

// Display adapter generator types. Consumed by strategy.resolveDisplayAdapter
// implementations (AVR, ESP32) and the Adafruit registry.
export type { DisplayAdapterCode, DisplayAdapterGenerator } from './display-adapter.js';

// Native display-op resolver — lowers display.* HAL ops into calls against
// the adapter surface (display_init / display_targetFillRect / etc.). Used
// by NativeAVRStrategy and Esp32Strategy's resolveDisplayOp overrides.
export { resolveNativeDisplayOp } from './native-display-op-resolver.js';

// Display capabilities descriptor (Phase 2: display-agnostic core)
export type {
  DisplayCapabilities,
  DisplayFeatureFlags,
  NativeFormat,
  RefreshModel,
  PartialRefreshScope,
} from './display-capabilities.js';
export { defaultTftCapabilities, deriveCapabilities } from './display-capabilities.js';

// Board resolver
export type { BoardConstants } from './board-resolver.js';

// Polyfill types
export type {
  RuntimePolyfillIR,
  StdLibSupport,
} from './polyfill-types.js';
export { getStdLibSupport, DEFAULT_STDLIB_SUPPORT } from './polyfill-types.js';

// Platform strategy
export type {
  PlatformStrategy,
  PlatformProfileStrategy,
  PlatformPolyfillStrategy,
  PlatformTypeStrategy,
  PlatformExpressionStrategy,
  PlatformStatementStrategy,
  PlatformSafetyStrategy,
  PlatformBuildStrategy,
  PlatformDebugStrategy,
  PlatformAsyncStrategy,
  PlatformHALStrategy,
} from './platform-strategy.js';

// Toolchain types
export type { CompileError, CompileResult, UploadResult, ToolchainOptions } from './toolchain-types.js';
export { parseCompileErrors, collectCppFiles } from './toolchain-types.js';

// Snprintf types
export type {
  KnownVariableInfo,
  SnprintfArgRenderResult,
  SnprintfRenderResult,
  EmissionScopeState,
  SnprintfExpressionRenderer,
} from './snprintf-types.js';

// Polyfill helper registry
export { POLYFILL_HELPER_MAP, filterPolyfillHelpers } from './polyfill-helper-registry.js';

// Shared string-method lowering (used by all platform strategies)
export { STRING_METHODS, STRING_METHOD_NAMES, applyStringMethodRewrites } from './string-method-registry.js';
export type { StringMethodSpec, StringMethodArgForm } from './string-method-registry.js';

// Runtime helpers
export { isStringEnum } from './ir-declarations.js';

// IR transform helpers (used by the optional @typecad/safety package's pass)
export { mapProgramStatements } from '../../ir/utils/map-statements.js';

// Async types
export type { AsyncRuntimeConfig } from './async-types.js';

// Promise runtime generator (heap-based: ESP32/ESP8266/rp2040/samd/…)
export { generatePromiseRuntime } from './promise-runtime.js';
// Heap-free static async runtime generator (AVR / megaavr / no-<vector> targets)
export { generateStaticAsyncRuntime } from './async-runtime-static.js';

// Framework manifest schema + helper
export {
  FrameworkManifestSchema,
  defineFrameworkManifest,
  HAL_CATEGORIES,
  POLYFILL_BACKED_OPS,
} from './framework-manifest.js';
export type {
  FrameworkManifest,
  HalCategory,
} from './framework-manifest.js';

// Framework manifest discovery
export {
  KNOWN_FRAMEWORK_PACKAGES,
  loadFrameworkManifest,
} from './framework-manifest-registry.js';
export type { KnownFrameworkPackage } from './framework-manifest-registry.js';

// Framework manifest validator
export { validateFrameworkManifest } from './validate-framework-manifest.js';
export type {
  ManifestValidationContext,
  ManifestValidationResult,
  ManifestValidationError,
  ManifestValidationWarning,
} from './validate-framework-manifest.js';
