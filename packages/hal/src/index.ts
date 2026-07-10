// Re-export commonly-used types so consumers can import everything from @typecad/hal
export type { DigitalValue, AnalogValue } from './types.js';
export { PinMode, InterruptMode } from './types.js';
export type { IPinGroup, PinGroupMember } from './types.js';
export { createPinGroup } from './types.js';

export type { PinCapabilityFlags } from './types.js';

export type { BasePin, PWMPin, AnalogPin, InterruptPin, IOutputModePin, IInputModePin, InterruptHandler, InterruptOptions, IToneAttachment } from './types.js';

export type { ArchitectureIdentifier } from './types.js';

export type { ErrorPolicy } from './types.js';

export { I2CStatus } from './types.js';
export type { I2CAddress, II2CBus, II2CDeviceAccessor } from './types.js';

export type { SPIBitOrder, SPIMode } from './types.js';
export { SPIStatus } from './types.js';
export type { SPISettings, ISPIBus, ISPIDevice } from './types.js';

export { UARTParity, UARTStopBits, UARTFlowControl, UARTStatus } from './types.js';
export type { UARTStatusInfo, IUARTBus, ISerialPort } from './types.js';

export { include } from './include.js';
export { board } from './board.js';
export { callback } from './callback.js';
export { emit, rawCpp } from './emit.js';
export { HIGH, LOW, OUTPUT, INPUT, INPUT_PULLUP, LED_BUILTIN, LSBFIRST, MSBFIRST, WDTO_15MS, WDTO_30MS, WDTO_60MS, WDTO_120MS, WDTO_250MS, WDTO_500MS, WDTO_1S, WDTO_2S, WDTO_4S, WDTO_8S } from './constants.js';
export { delay, millis, micros, delayMicroseconds, map, constrain, TimingClass, Timing } from './timing.js';
export { abs, min, max, NumClass, Num } from './math.js';
export { Pulse, pulseIn, pulseInLong } from './pulse.js';
export { Shift, shiftIn, shiftOut } from './shift.js';
export { Random } from './random.js';
export { randomSeed, random } from './random.js';
export { noInterrupts, interrupts, attachInterrupt, detachInterrupt } from './interrupts.js';
export { Pin, OutputPin, InputPin, ToneChain } from './gpio.js';
export { I2CBus, i2cName } from './i2c.js';
export { SPIBus, spiName } from './spi.js';
export { SerialPort, serialName } from './uart.js';
export { createHALInstances } from './utils.js';
export { EEPROMClass, EEPROM } from './eeprom.js';
export { WDTClass, WDT } from './wdt.js';
export { ADCClass, ADC } from './adc.js';
export { DACClass, DAC } from './dac.js';
export { PreferencesClass, Preferences } from './preferences.js';
export { HardwareTimer, Timer0, Timer1, Timer2 } from './timer.js';
export { FSClass, FS } from './fs.js';
export { PowerClass, Power } from './power.js';
export { AsyncClass, Async } from './async.js';
