// Re-export commonly-used core types so consumers can import everything from @typecad/hal
export type { DigitalValue, AnalogValue } from './core/gpio.js';
export { PinMode, InterruptMode } from './core/gpio.js';
export type { IPinGroup } from './core/gpio.js';
export { createPinGroup } from './core/gpio.js';

export type { PinCapabilityFlags } from './core/capabilities.js';

export type { BasePin, PWMPin, AnalogPin, InterruptPin, IOutputModePin, IInputModePin, InterruptHandler, InterruptOptions, IToneAttachment } from './core/pin.js';

export type { ArchitectureIdentifier } from './core/board-types.js';

export type { ErrorPolicy } from './core/bus/error-policy.js';

export { I2CStatus } from './core/bus/i2c.js';
export type { I2CAddress, II2CBus, II2CDeviceAccessor, IUninitializedI2CBus, IOwnedI2CBus } from './core/bus/i2c.js';

export type { SPIBitOrder, SPIMode } from './core/bus/spi.js';
export { SPIStatus } from './core/bus/spi.js';
export type { SPISettings, ISPIBus, ISPIDevice, IUninitializedSPIBus, IOwnedSPIBus } from './core/bus/spi.js';

export { UARTParity, UARTStopBits, UARTFlowControl, UARTStatus } from './core/bus/uart.js';
export type { UARTStatusInfo, IUARTBus, ISerialPort, IUninitializedUARTBus, IOwnedSerialPort } from './core/bus/uart.js';

export { include } from './include.js';
export { board } from './board.js';
export { callback } from './callback.js';
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
