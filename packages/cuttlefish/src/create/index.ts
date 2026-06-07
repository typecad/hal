export { scaffoldProject, normalizeProjectName, KNOWN_TARGETS, KNOWN_BOARDS, registerKnownTarget, printInitNextSteps } from './init-scaffold';
export type { KnownTarget, KnownBoard, ScaffoldProjectResult } from './init-scaffold';
export {
  generateProjectPackageJson,
  generateProjectTsconfig,
  generateProjectConfig,
  generateProjectEnvDts,
  generateStarterSketch,
  generateGitignore,
} from './init-templates';
export type { InitProjectOptions } from './init-templates';
export { runInitWizard } from './init-wizard';
