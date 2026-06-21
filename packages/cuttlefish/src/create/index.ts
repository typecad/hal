export { scaffoldProject, normalizeProjectName, KNOWN_TARGETS, KNOWN_BOARDS, registerKnownTarget, printInitNextSteps } from './init-scaffold.js';
export type { KnownTarget, KnownBoard, ScaffoldProjectResult } from './init-scaffold.js';
export {
  generateProjectPackageJson,
  generateProjectTsconfig,
  generateProjectConfig,
  generateProjectEnvDts,
  generateStarterSketch,
  generateGitignore,
  generateEslintConfig,
} from './init-templates.js';
export type { InitProjectOptions } from './init-templates.js';
export { runInitWizard } from './init-wizard.js';
