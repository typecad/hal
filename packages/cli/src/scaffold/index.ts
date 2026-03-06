// ---------------------------------------------------------------------------
// Scaffold module - Board package generation
// ---------------------------------------------------------------------------

export {
  scaffoldBoardPackage,
  scaffoldFromWizard,
  printNextSteps,
  normalizeBoardName,
  isValidArchitecture,
  type ScaffoldOptions,
} from "./board-scaffold";

export {
  type BoardTemplateOptions,
} from "./templates";

export {
  runBoardWizard,
  type WizardResult,
  type PinDefinition,
  type PeripheralConfig,
} from "./wizard";
