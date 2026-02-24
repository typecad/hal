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
} from './types/pin';

// --- Bus interfaces --------------------------------------------------------
export {
  I2CSpeed,
  type I2CAddress,
  type I2CConfig,
  I2CError,
  I2CNackError,
  I2CTimeoutError,
  I2CArbitrationLostError,
  type II2CBus,
  type II2CDevice,
  createI2CDevice,
} from './bus/i2c';

export {
  SPIClockPolarity,
  SPIClockPhase,
  SPIBitOrder,
  SPIMode,
  type SPIConfig,
  type SPITransferOptions,
  SPIError,
  SPITimeoutError,
  type ISPIBus,
  type ISPIDevice,
  createSPIDevice,
} from './bus/spi';

export {
  UARTParity,
  UARTStopBits,
  UARTFlowControl,
  type UARTConfig,
  type UARTStatus,
  UARTError,
  UARTBufferOverflowError,
  type IUART,
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

// --- Config ----------------------------------------------------------------
export {
  type OutputFramework,
  type OptimizationLevel,
  type TypecodeOutputConfig,
  type TypecodeConfig,
} from './config';
