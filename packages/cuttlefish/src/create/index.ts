export { scaffoldProject, normalizeProjectName, KNOWN_TARGETS, KNOWN_BOARDS, registerKnownTarget, printInitNextSteps } from './init-scaffold.js';
export type { KnownTarget, KnownBoard, ScaffoldProjectResult } from './init-scaffold.js';
export { FRAMEWORK_CATALOG, frameworksForTarget, frameworkCatalogEntry, detectPackageManager, frameworkTargetProfile } from './framework-catalog.js';
export type { FrameworkCatalogEntry, BoardLike, PackageManager, FrameworkTargetProfile, TargetProfileInput } from './framework-catalog.js';
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
  generateEslintConfig,
} from './init-templates.js';
export type { InitProjectOptions } from './init-templates.js';
export { runInitWizard } from './init-wizard.js';

// Board codegen tool (`cuttlefish board add`)
export { scaffoldBoardPackages } from './board-codegen.js';
export type { ScaffoldBoardResult } from './board-codegen.js';
export { generateFrameworkChecklist } from './board-checklist.js';
export { parseBoardSpec, safeParseBoardSpec, stripJsonc, BoardSpecSchema } from './board-spec.js';
export type { BoardSpec } from './board-spec.js';
export * as BoardGenerators from './board-generators.js';
