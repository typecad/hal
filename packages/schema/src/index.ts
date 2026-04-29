// ---------------------------------------------------------------------------
// @typehal/schema — Board definition schema and metadata exports
// ---------------------------------------------------------------------------

export type {
  BoardDefinition,
  PinDefinition,
  PeripheralFunction,
} from './board/types';

export {
  ARDUINO_CORE_VERSION,
  pinNumber,
} from './board/builder';
