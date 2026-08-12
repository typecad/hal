// `cuttlefish install` command — install a @typecad/framework-* package.
export { handleInstall, installFrameworkPackage, __setInstallRunnerForTest } from "./handle-install.js";
export type { InstallResult } from "./handle-install.js";
export {
  FRAMEWORK_CATALOG,
  frameworkCatalogEntry,
  frameworksForTarget,
  detectPackageManager,
  buildInstallCommand,
} from "./framework-catalog.js";
export type {
  FrameworkCatalogEntry,
  BoardLike,
  PackageManager,
} from "./framework-catalog.js";
