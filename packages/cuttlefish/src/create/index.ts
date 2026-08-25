export { scaffoldProject, normalizeProjectName, KNOWN_TARGETS, KNOWN_BOARDS, registerKnownTarget, KNOWN_MCUS, registerKnownMcu, printCreateNextSteps } from './scaffold.js';
export type { KnownTarget, KnownBoard, KnownMcu, ScaffoldProjectResult } from './scaffold.js';
export {
  mcuAsTarget,
  findKnownMcu,
  findZephyrBoardForMcu,
  mcuSupportsZephyr,
  zephyrBoardsForMcu,
  sanitizeBoardName,
  isValidFqbn,
} from './mcu-target.js';
export type { McuCreateTarget, McuZephyrBoard } from './mcu-target.js';
export { FRAMEWORK_CATALOG, frameworksForTarget, frameworkCompatibleWithTarget, frameworkCatalogEntry, detectPackageManager, frameworkTargetProfile, probeMethodsForBoard, BOARD_PROBE_METHODS } from './framework-catalog.js';
export type { FrameworkCatalogEntry, BoardLike, PackageManager, FrameworkTargetProfile, TargetProfileInput, CatalogProbeMethod } from './framework-catalog.js';
export { installProjectDependencies, __setProjectInstallRunnerForTest } from './install-deps.js';
export type { ProjectInstallResult } from './install-deps.js';
export {
  generateProjectPackageJson,
  generateProjectTsconfig,
  generateProjectConfig,
  generateProjectEnvDts,
  generateStarterSketch,
  generateStarterTest,
  generateStarterSim,
  generateGitignore,
  generateEditorconfig,
  generateEslintConfig,
} from './templates.js';
export type { CreateProjectOptions } from './templates.js';
export { runCreateWizard } from './wizard.js';
export { generateFrameworkDebugArtifacts } from './debug-artifacts.js';
export type { FrameworkDebugArtifactsOptions, FrameworkModuleLoader } from './debug-artifacts.js';
export {
  generateExtensionsJson,
  generateTasksJson,
  watchBuildTask,
  writeEditorIntegration,
  bundledExtensionSourceDir,
  typecadUiExtensionSourceDir,
  TYPECAD_UI_EXTENSION_ID,
  TYPECAD_DEBUG_EXTENSION_ID,
  WATCH_TASK_LABEL,
} from './editor-integration.js';

// Board codegen tool (`cuttlefish board add`)
export { scaffoldBoardPackages } from './board-codegen.js';
export type { ScaffoldBoardResult } from './board-codegen.js';
export { generateFrameworkChecklist } from './board-checklist.js';
export { parseBoardSpec, safeParseBoardSpec, stripJsonc, BoardSpecSchema } from './board-spec.js';
export type { BoardSpec } from './board-spec.js';
export * as BoardGenerators from './board-generators.js';
