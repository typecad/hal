// Re-export commonly-used types so consumers can import everything from @typecad/hal
//
// Runtime-contract interfaces (BasePin, II2CBus, ISPIBus, ISerialPort, the
// status enums, capability guards, ...) live in src/sim/contracts.ts —
// import them from '@typecad/hal/sim'.
export type { DigitalValue, AnalogValue } from './types.js';
export { PinMode } from './types.js';

export type { InterruptHandler } from './types.js';

export type { ArchitectureIdentifier } from './types.js';

export type { SerialValue } from './types.js';

export { include } from './include.js';
export { board } from './board.js';
export { callback } from './callback.js';
export { rawCpp, rawCppExpr, boardResolve } from './emit.js';
export { TimeClass, Time } from './time.js';
export { abs, min, max, NumClass, Num } from './math.js';

export { Random } from './random.js';
export { Pin } from './gpio.js';
export { GPIO } from './gpio-pin.js';
export { shiftOut, shiftIn } from './shift-pin.js';
export { PWM } from './pwm-pin.js';
export { ADC } from './adc-pin.js';
export { DAC } from './dac-pin.js';
export { Watchdog } from './watchdog.js';
export { Counter } from './counter.js';
export { I2CTarget } from './i2c-target.js';
export { SPITarget } from './spi-target.js';
export { UART } from './uart-port.js';
export { Thread } from './thread.js';
export { I2CBus } from './i2c.js';
export { Sensor } from './sensor.js';
export { SENSOR, CHAN, SENSOR_PART_INFO } from './sensor-catalog.generated.js';
export { ZEPHYR_ADC_GAINS, ZEPHYR_ADC_REFERENCES, ZEPHYR_GPIO_FLAGS, ZEPHYR_GPIO_INTS } from './zephyr-tokens.generated.js';
export type { SensorToken, SensorChannelName, SensorPartInfo } from './sensor-catalog.generated.js';
export { SPIBus } from './spi.js';
export { USBConsole } from './usb.js';
// Register-mapped struct decorators (compile-time markers, erased by transpiler)
export type { Bit, Bits } from './register.js';
export { register, bits } from './register.js';
export { Store } from './preferences.js';
export { File } from './fs.js';
export { Mqtt } from './mqtt.js';

export { AsyncClass, Async } from './async.js';
export { WiFi, Scan, WiFiAP } from './wifi.js';
export { Request } from './http.js';
export type { RequestOpts } from './http.js';
export { BLE, BleChain, BleValueType, BlePerm, GATT } from './ble.js';
export type { GattCharacteristicDef, CharValue } from './ble.js';

// Board-gate classification — which value exports are gated on board facts
// (see gate.ts). The ungated list is derived by the board generators from
// this index's runtime exports minus GATED_EXPORTS; the type list is manual.
// Reachable under the './core' subpath so board tooling can import it without
// colliding with the project-level '@typecad/hal' mapping.
export { GATED_EXPORTS, BOARD_UNGATED_TYPE_EXPORTS } from './gate.js';
