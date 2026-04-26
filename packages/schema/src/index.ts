// ---------------------------------------------------------------------------
// @typecode/schema — Board definition schema and metadata exports
// ---------------------------------------------------------------------------

export type {
  ArchitectureIdentifier,
  MemorySpec,
  PinDefinition,
  PeripheralFunction,
  PinDefinitions,
  PeripheralInstance,
  ADCDefinition,
  DACDefinition,
  PWMDefinition,
  USBDefinition,
  WiFiDefinition,
  BluetoothDefinition,
  TouchDefinition,
  PeripheralDefinitions,
  FeatureFlags,
  BuildConfig,
  BoardDefinition,
} from './board/types';

export {
  GPIO,
  gpioNumber,
  PinCapabilityBuilder,
  PinBuilder,
  PeripheralBuilder,
  BoardDefinitionBuilder,
  validateBoardDefinition,
} from './board/builder';
