// ---------------------------------------------------------------------------
// @typecode/core — Barrel re-export
// ---------------------------------------------------------------------------

// --- Pin types -------------------------------------------------------------
export {
  type PinNumber,
  pinNumber,
  type DigitalValue,
  type AnalogValue,
  PinMode,
  InterruptMode,
  type GPIOConfig,
  type IGPIOPinFactory,
  type IPinGroup,
  type IParallelPort,
  createPinGroup,
  createParallelPort,
} from './types/gpio';

// HIGH and LOW are both a *type* and a *value* in gpio.ts (interface + const).
// Re-export the values; consumers can use `typeof HIGH` for the type.
export { HIGH, LOW } from './types/gpio';

export {
  type PinCapabilityFlags,
  type DigitalOnlyCapabilities,
  type PWMCapabilities,
  type AnalogInputCapabilities,
  type TouchCapabilities,
  type SupportsCapabilities,
  hasPWM,
  hasAnalogInput,
  hasInterrupt,
  hasTouch,
  // Convenience aliases
  isPWMPin,
  isAnalogPin,
  isInterruptPin,
  isTouchPin,
  // Assertion functions
  assertPWM,
  assertAnalog,
  assertInterrupt,
} from './types/capabilities';

export {
  type IPin,
  type IDigitalInput,
  type IDigitalOutput,
  type IDigitalPin,
  type IAnalogInput,
  type IAnalogOutput,
  type IPWMPin,
  type IInterruptPin,
  type InterruptHandler,
  type ITouchPin,
  type IADCPin,
  type IDACPin,
  // Pin configuration types
  type IOutputConfig,
  type IInputConfig,
  type IPinConfig,
  type IPWMOutputConfig,
  type IPWMConfig,
  type IAnalogInputConfig,
  type IAnalogConfig,
  // Tone API
  type IToneAttachment,
} from './types/pin';

// --- Number utilities (fluent math API) ------------------------------------
export {
  type INumMapChain,
  type INumConstrainChain,
  type INumNamespace,
  Num,
} from './types/num';

// --- Pulse measurement utilities -------------------------------------------
export {
  type IPulseChain,
  type IPulseNamespace,
  Pulse,
} from './types/pulse';

// --- Shift register utilities ----------------------------------------------
export {
  MSBFIRST,
  LSBFIRST,
  type IShiftReadChain,
  type IShiftWriteChain,
  type IShiftNamespace,
  Shift,
} from './types/shift';

// --- Random number utilities -----------------------------------------------
export {
  type IRandomNamespace,
  Random,
} from './types/random';

// --- Bus interfaces --------------------------------------------------------
export {
  I2CStatus,
  type I2CAddress,
  type II2CBus,
  type II2CDevice,
  type II2CConfigBuilder,
  type II2CDeviceAccessor,
  type II2CReadBuilder,
  type II2CWriteBuilder,
  type II2CReadSource,
  type II2CWriteTarget,
  type II2CReadResult,
  type II2CWriteResult,
  type II2CResult,
  createI2CDevice,
} from './bus/i2c';

export {
  SPIClockPolarity,
  SPIClockPhase,
  SPIBitOrder,
  SPIMode,
  SPIStatus,
  type SPISettings,
  type SPITransferOptions,
  type ISPIWriteResult,
  type ISPIReadResult,
  type ISPITransferResult,
  type ISPIFluentConfig,
  type ISPIFluentWrite,
  type ISPIFluentRead,
  type ISPIFluentTransfer,
  type ISPIFluentDevice,
  type ISPIBus,
  type ISPIDevice,
  SPIError,
  SPITimeoutError,
  createSPIDevice,
  spiModeToCpolCpha,
  cpolCphaToSpiMode,
} from './bus/spi';

export {
  UARTParity,
  UARTStopBits,
  UARTFlowControl,
  UARTStatus,
  type UARTStatusInfo,
  UARTError,
  UARTBufferOverflowError,
  UARTTimeoutError,
  type IUARTReadResult,
  type IUARTWriteResult,
  type IUARTFluentConfig,
  type IUARTFluentWrite,
  type IUARTFluentRead,
  type IUARTBus,
  type ISerialPort,
  type IDebugSerial,
  type LogLevel,
} from './bus/uart';

// --- Concurrency -----------------------------------------------------------
export {
  TaskState,
  TaskPriority,
  type TaskConfig,
  type TaskCreateOptions,
  type TaskStats,
  type ITaskHandle,
  type ITaskManager,
} from './concurrency/task';

export {
  type SchedulerConfig,
  type SchedulerStats,
  type IScheduler,
  type TimerConfig,
  type ITimer,
  type ITimerManager,
} from './concurrency/scheduler';

export {
  type LockCapabilities,
  type IMutex,
  type ISemaphore,
  type IBinarySemaphore,
  type ISpinlock,
  type ICriticalSection,
  type ILockFactory,
  type IQueue,
  type IQueueFactory,
  type IEvent,
  type IEventFactory,
} from './concurrency/lock';

// --- Memory ----------------------------------------------------------------
export {
  MemoryRegion,
  type MemoryOptions,
  type MemoryDecorator,
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

export {
  type FixedBuffer,
  type CircularBuffer,
  type ObjectPool,
} from './memory/buffer';

// --- Board -----------------------------------------------------------------
export {
  type ArchitectureIdentifier,
  type MemorySpec,
  type PinDefinition,
  type PeripheralFunction,
  type PinDefinitions,
  type PeripheralInstance,
  type ADCDefinition,
  type DACDefinition,
  type PWMDefinition,
  type USBDefinition,
  type WiFiDefinition,
  type BluetoothDefinition,
  type TouchDefinition,
  type PeripheralDefinitions,
  type FeatureFlags,
  type BuildConfig,
  type BoardDefinition,
} from './board/types';

// --- Board Definition Builder ----------------------------------------------
export {
  // Branded types
  type PinNumber as BrandedPinNumber,
  type GPIO,
  pinNumber as createPinNumber,
  gpioNumber,
  // Builders
  PinCapabilityBuilder,
  PinBuilder,
  PeripheralBuilder,
  BoardDefinitionBuilder,
  // Validation
  validateBoardDefinition,
} from './board/builder';

// --- Config ----------------------------------------------------------------
export {
  type OutputFramework,
  type OptimizationLevel,
  type TypecodeOutputConfig,
  type TypecodeConfig,
  type ToolchainType,
  type ArduinoCliOptions,
  type TypecodeToolchainConfig,
  type TypecodeTestConfig,
  type TypecodeConsoleConfig,
} from './config';

// --- Shared types (for CLI and framework packages) -------------------------
export * from './shared';
