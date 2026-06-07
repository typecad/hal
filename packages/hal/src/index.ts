// Re-export commonly-used core types so consumers can import everything from @typecad/hal
export type { DigitalValue, AnalogValue } from './core/gpio';
export { PinMode, InterruptMode } from './core/gpio';
export type { IPinGroup } from './core/gpio';
export { createPinGroup } from './core/gpio';

export type { PinCapabilityFlags } from './core/capabilities';

export type { BasePin, PWMPin, AnalogPin, InterruptPin, IOutputModePin, IInputModePin, InterruptHandler, InterruptOptions, IToneAttachment } from './core/pin';

export type { ArchitectureIdentifier } from './core/board-types';

export type { ErrorPolicy } from './core/bus/error-policy';

export { I2CStatus } from './core/bus/i2c';
export type { I2CAddress, II2CBus, II2CDeviceAccessor, IUninitializedI2CBus, IOwnedI2CBus } from './core/bus/i2c';

export type { SPIBitOrder, SPIMode } from './core/bus/spi';
export { SPIStatus } from './core/bus/spi';
export type { SPISettings, ISPIBus, ISPIDevice, IUninitializedSPIBus, IOwnedSPIBus } from './core/bus/spi';

export { UARTParity, UARTStopBits, UARTFlowControl, UARTStatus } from './core/bus/uart';
export type { UARTStatusInfo, IUARTBus, ISerialPort, IUninitializedUARTBus, IOwnedSerialPort } from './core/bus/uart';

export { include } from './include';
export { board } from './board';
export { callback } from './callback';
export { HIGH, LOW, OUTPUT, INPUT, INPUT_PULLUP, LED_BUILTIN, LSBFIRST, MSBFIRST, WDTO_15MS, WDTO_30MS, WDTO_60MS, WDTO_120MS, WDTO_250MS, WDTO_500MS, WDTO_1S, WDTO_2S, WDTO_4S, WDTO_8S } from './constants';
export { delay, millis, micros, delayMicroseconds, map, constrain, TimingClass, Timing } from './timing';
export { abs, min, max, NumClass, Num } from './math';
export { Pulse, pulseIn, pulseInLong } from './pulse';
export { Shift, shiftIn, shiftOut } from './shift';
export { Random } from './random';
export { randomSeed, random } from './random';
export { noInterrupts, interrupts, attachInterrupt, detachInterrupt } from './interrupts';
export { Pin, OutputPin, InputPin, ToneChain } from './gpio';
export { I2CBus, i2cName } from './i2c';
export { SPIBus, spiName } from './spi';
export { SerialPort, serialName } from './uart';
export { createHALInstances } from './utils';
export { EEPROMClass, EEPROM } from './eeprom';
export { WDTClass, WDT } from './wdt';
export { ADCClass, ADC } from './adc';
export { DACClass, DAC } from './dac';
export { PreferencesClass, Preferences } from './preferences';
export { HardwareTimer, Timer0, Timer1, Timer2 } from './timer';
export { FSClass, FS } from './fs';
export { PowerClass, Power } from './power';
export { AsyncClass, Async } from './async';
