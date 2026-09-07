export { scaffoldProject, normalizeProjectName, KNOWN_TARGETS, printCreateNextSteps } from './scaffold.js';
export type { KnownTarget, ScaffoldProjectResult } from './scaffold.js';
export { FRAMEWORK_CATALOG, frameworksForTarget, frameworkCompatibleWithTarget, frameworkCatalogEntry, detectPackageManager, frameworkTargetProfile, probeMethodsForBoard, probeRunnerQuirks } from './framework-catalog.js';
export type { FrameworkCatalogEntry, BoardLike, PackageManager, FrameworkTargetProfile, TargetProfileInput, CatalogProbeMethod } from './framework-catalog.js';
export { installProjectDependencies, __setProjectInstallRunnerForTest } from './install-deps.js';
export type { ProjectInstallResult } from './install-deps.js';
export {
  generateProjectPackageJson,
  generateProjectTsconfig,
  generateProjectConfig,
  generateProjectEnvDts,
  generateStarterProgram,
  generateStarterTest,
  generateStarterSim,
  generateGitignore,
  generateEditorconfig,
  generateEslintConfig,
  starterAppRel,
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
