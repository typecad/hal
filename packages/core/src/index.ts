// ---------------------------------------------------------------------------
// @typehal/core — Barrel re-export
// ---------------------------------------------------------------------------

// --- Pin types -------------------------------------------------------------
export {
  DigitalValue,
  AnalogValue,
  HIGH,
  LOW,
  PinMode,
  InterruptMode,
  IPinGroup,
  createPinGroup,
} from './types/gpio';

export {
  PinCapabilityFlags,
} from './types/capabilities';

export {
  BasePin,
  Pin,
  PWMPin,
  AnalogPin,
  InterruptPin,
  IOutputModePin,
  IInputModePin,
  InterruptHandler,
  InterruptOptions,
  IToneAttachment,
} from './types/pin';

// --- Number utilities (fluent math API) ------------------------------------
export {
  INumNamespace,
  Num,
} from './types/num';

// --- Pulse measurement utilities -------------------------------------------
export {
  IPulseNamespace,
  Pulse,
} from './types/pulse';

// --- Shift register utilities ----------------------------------------------
export {
  ShiftBitOrder,
  IShiftNamespace,
  Shift,
} from './types/shift';

// --- Random number utilities -----------------------------------------------
export {
  IRandomNamespace,
  Random,
} from './types/random';

// --- Bus interfaces --------------------------------------------------------
export {
  ErrorPolicy,
} from './bus/error-policy';

export {
  I2CStatus,
  I2CAddress,
  II2CBus,
  IUninitializedI2CBus,
  IOwnedI2CBus,
  II2CDeviceAccessor,
} from './bus/i2c';

// --- Peripheral enums ------------------------------------------------------
export {
  BaudRate,
  I2CSpeed,
} from './types/peripheral-enums';

export {
  SPIBitOrder,
  SPIMode,
  SPIStatus,
  SPISettings,
  ISPIBus,
  IUninitializedSPIBus,
  ISPIDevice,
} from './bus/spi';

export {
  UARTParity,
  UARTStopBits,
  UARTFlowControl,
  UARTStatus,
  UARTStatusInfo,
  IUARTBus,
  IUninitializedUARTBus,
  ISerialPort,
} from './bus/uart';

// --- Board -----------------------------------------------------------------
export { ArchitectureIdentifier } from './board/types';

// --- Config ----------------------------------------------------------------
export {
  TypehalConfig,
} from './config';

// --- Ownership & Borrowing Safety -------------------------------------------
export type {
  OwnershipKind,
  Owned,
  Ref,
  MutRef,
} from './types/ownership';

// --- Shared types (for CLI and framework packages) -------------------------
export * from './shared';
