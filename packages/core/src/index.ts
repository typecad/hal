// ---------------------------------------------------------------------------
// @typecode/core — Barrel re-export
// ---------------------------------------------------------------------------

// --- Pin types -------------------------------------------------------------
export {
  DigitalValue,
  AnalogValue,
  HIGH,
  LOW,
  PinMode,
  InterruptMode,
  GPIOConfig,
  IGPIOPinFactory,
  IPinGroup,
  IParallelPort,
  createPinGroup,
  createParallelPort,
} from './types/gpio';

export {
  PinCapabilityFlags,
  DigitalOnlyCapabilities,
  PWMCapabilities,
  AnalogInputCapabilities,
  TouchCapabilities,
  SupportsCapabilities,
  hasPWM,
  hasAnalogInput,
  hasInterrupt,
  isPWMPin,
  isAnalogPin,
  isInterruptPin,
  assertPWM,
  assertAnalog,
  assertInterrupt,
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
  isPwmPin,
  assertPwm,
  IPinGroupOptions,
} from './types/pin';

// --- Number utilities (fluent math API) ------------------------------------
export {
  INumMapChain,
  INumClampChain,
  INumNamespace,
  Num,
} from './types/num';

// --- Pulse measurement utilities -------------------------------------------
export {
  IPulseChain,
  IPulseNamespace,
  Pulse,
} from './types/pulse';

// --- Shift register utilities ----------------------------------------------
export {
  ShiftBitOrder,
  IShiftReadChain,
  IShiftWriteChain,
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
  I2CStatus,
  I2CAddress,
  II2CBus,
  IUninitializedI2CBus,
  IOwnedI2CBus,
  II2CDeviceAccessor,
  ErrorPolicy as I2CErrorPolicy,
} from './bus/i2c';

// --- Peripheral enums ------------------------------------------------------
export {
  BaudRate,
  I2CSpeed,
  SPIClock,
  AnalogRef,
} from './types/peripheral-enums';

export {
  SPIBitOrder,
  SPIMode,
  SPIStatus,
  SPISettings,
  ISPIBus,
  IUninitializedSPIBus,
  IOwnedSPIBus,
  ISPIDevice,
  ErrorPolicy as SPIErrorPolicy,
  spiModeToCpolCpha,
  cpolCphaToSpiMode,
} from './bus/spi';

export {
  UARTParity,
  UARTStopBits,
  UARTFlowControl,
  UARTStatus,
  UARTStatusInfo,
  IUARTBus,
  IUninitializedUARTBus,
  IOwnedSerialPort,
  ISerialPort,
  IDebugSerial,
  LogLevel,
  ErrorPolicy as UARTErrorPolicy,
} from './bus/uart';

// --- Concurrency -----------------------------------------------------------
export {
  TaskState,
  TaskPriority,
  TaskConfig,
  TaskCreateOptions,
  TaskStats,
  ITaskHandle,
  ITaskManager,
} from './concurrency/task';

export {
  SchedulerConfig,
  SchedulerStats,
  IScheduler,
  TimerConfig,
  ITimer,
  ITimerManager,
} from './concurrency/scheduler';

export {
  LockCapabilities,
  IMutex,
  ISemaphore,
  IBinarySemaphore,
  ISpinlock,
  ICriticalSection,
  ILockFactory,
  IQueue,
  IQueueFactory,
  IEvent,
  IEventFactory,
} from './concurrency/lock';

// --- Memory ----------------------------------------------------------------
export {
  MemoryRegion,
  MemoryOptions,
  MemoryDecorator,
  getMemoryMeta,
  Static,
  ProgramMemory,
  Packed,
  Volatile,
  volatile,
  Aligned,
  DmaBuffer,
  RtcMemory,
  EEPROM,
  External,
  NoInit,
  Retain,
} from './memory/decorators';

// --- Register-mapped structs -----------------------------------------------
export {
  Bit,
  Bits,
  BitFieldMeta,
  RegisterClassMeta,
  register,
  bits,
  getRegisterMeta,
  getBitFields,
} from './memory/register';

export {
  FixedBuffer,
  CircularBuffer,
  ObjectPool,
} from './memory/buffer';

// --- Board -----------------------------------------------------------------
export {
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

// --- Board Definition Builder ----------------------------------------------
export {
  GPIO,
  gpioNumber,
  PinCapabilityBuilder,
  PinBuilder,
  PeripheralBuilder,
  BoardDefinitionBuilder,
  validateBoardDefinition,
} from './board/builder';

// --- Config ----------------------------------------------------------------
export {
  OutputFramework,
  OptimizationLevel,
  TypecodeOutputConfig,
  TypecodeConfig,
  ToolchainType,
  ArduinoCliOptions,
  TypecodeToolchainConfig,
  TypecodeTestConfig,
  TypecodeConsoleConfig,
} from './config';

// --- Ownership & Borrowing Safety -------------------------------------------
export type {
  OwnershipKind,
  Owned,
  Ref,
  MutRef,
} from './types/ownership';
export {
  extractOwnershipKind,
  unwrapOwnershipType,
} from './types/ownership';

// --- Shared types (for CLI and framework packages) -------------------------
export * from './shared';
