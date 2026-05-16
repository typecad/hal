// ---------------------------------------------------------------------------
// @typehal/schema — Board definition schema and metadata exports
// ---------------------------------------------------------------------------

export type {
  BoardDefinition,
  MCUDefinition,
  PinDefinition,
  PeripheralFunction,
  PeripheralInstance,
  PeripheralDefinitions,
  ADCDefinition,
  DACDefinition,
  PWMDefinition,
  TimerDefinition,
  FeatureFlags,
  MemorySpec,
  BuildConfig,
} from './board/types';

export {
  pinNumber,
} from './board/builder';
