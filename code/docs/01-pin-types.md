# Pin Type System

## Overview

The pin type system is the foundation of typeCode's compile-time hardware validation. Each pin is typed according to its capabilities, preventing invalid operations before the code reaches the hardware.

---

## Type Hierarchy

```
                    ┌─────────────┐
                    │   IPin      │
                    │  (base)     │
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
    │ IDigitalPin │ │ IAnalogPin  │ │  IPWMPin    │
    │             │ │             │ │             │
    └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
           │               │               │
    ┌──────▼──────┐ ┌──────▼──────┐       │
    │DigitalInput │ │AnalogInput  │       │
    │DigitalOutput│ │AnalogOutput │       │
    └─────────────┘ └─────────────┘       │
                                          │
                                   ┌──────▼──────┐
                                   │  PWMPin     │
                                   └─────────────┘
```

---

## Source: types/pin.ts

```typescript
// src/@typecode/core/types/pin.ts

/**
 * Digital value representation
 * HIGH = true = 1, LOW = false = 0
 */
type DigitalValue = HIGH | LOW | boolean;

declare const HIGH: unique symbol;
declare const LOW: unique symbol;

interface HIGH {
  readonly [HIGH]: true;
}

interface LOW {
  readonly [LOW]: true;
}

/**
 * Analog value type (resolution depends on architecture)
 * AVR: 0-255 (8-bit)
 * ESP32: 0-255 (8-bit LEDC default)
 * RP2040: 0-65535 (16-bit)
 */
type AnalogValue = number;

/**
 * Pin mode enumeration
 */
enum PinMode {
  INPUT = 'INPUT',
  OUTPUT = 'OUTPUT',
  INPUT_PULLUP = 'INPUT_PULLUP',
  INPUT_PULLDOWN = 'INPUT_PULLDOWN',
  OUTPUT_OPEN_DRAIN = 'OUTPUT_OPEN_DRAIN',
  ANALOG = 'ANALOG'
}

/**
 * Pin number type (branded for safety)
 */
type PinNumber = number & { readonly __pinNumber: unique symbol };

/**
 * Base pin interface - all pins have these properties
 */
interface IPin {
  /** Physical pin number on the package */
  readonly number: PinNumber;
  
  /** GPIO number (may differ from physical pin) */
  readonly gpio: PinNumber;
  
  /** Current mode of the pin */
  getMode(): PinMode;
  
  /** Set the pin mode */
  setMode(mode: PinMode): void;
}

/**
 * Digital input capabilities
 */
interface IDigitalInput extends IPin {
  /** Read current digital state */
  read(): DigitalValue;
  
  /** Check if pin is HIGH */
  isHigh(): boolean;
  
  /** Check if pin is LOW */
  isLow(): boolean;
  
  /** Wait for rising edge (with optional timeout) */
  waitForRising(timeout?: number): Promise<boolean>;
  
  /** Wait for falling edge (with optional timeout) */
  waitForFalling(timeout?: number): Promise<boolean>;
}

/**
 * Digital output capabilities
 */
interface IDigitalOutput extends IPin {
  /** Write digital state */
  write(value: DigitalValue): void;
  
  /** Set pin HIGH */
  high(): void;
  
  /** Set pin LOW */
  low(): void;
  
  /** Toggle pin state */
  toggle(): void;
  
  /** Pulse pin HIGH for specified duration */
  pulse(duration: number): void;
}

/**
 * Combined digital pin (can be input or output)
 */
interface IDigitalPin extends IDigitalInput, IDigitalOutput {
  /** Configure as input */
  asInput(): this;
  
  /** Configure as output */
  asOutput(): this;
  
  /** Configure with internal pull-up */
  asInputPullUp(): this;
  
  /** Configure with internal pull-down (if supported) */
  asInputPullDown(): this;
}

/**
 * Analog input capabilities
 */
interface IAnalogInput extends IPin {
  /** Read analog value (0-1023 on AVR, 0-4095 on ESP32) */
  read(): AnalogValue;
  
  /** Read voltage (converts based on reference voltage) */
  readVoltage(): number;
  
  /** Set analog reference voltage */
  setReference(voltage: number): void;
  
  /** Get resolution in bits */
  getResolution(): number;
}

/**
 * Analog output capabilities (DAC)
 * Note: Most microcontrollers use PWM for "analog" output
 * True DAC is only available on specific pins
 */
interface IAnalogOutput extends IPin {
  /** Write analog value */
  write(value: AnalogValue): void;
  
  /** Write voltage directly */
  writeVoltage(voltage: number): void;
  
  /** Get resolution in bits */
  getResolution(): number;
}

/**
 * PWM output capabilities
 */
interface IPWMPin extends IDigitalPin {
  /** Write PWM duty cycle (0-255 or 0-65535 depending on resolution) */
  write(value: AnalogValue): void;
  
  /** Set PWM frequency in Hz */
  setFrequency(hz: number): void;
  
  /** Set duty cycle as percentage (0.0 to 1.0) */
  setDutyCycle(duty: number): void;
  
  /** Get current frequency */
  getFrequency(): number;
  
  /** Get resolution in bits */
  getResolution(): number;
  
  /** Attach PWM to pin (architecture-specific setup) */
  attach(): void;
  
  /** Detach PWM from pin */
  detach(): void;
}

/**
 * Interrupt-capable pin
 */
interface IInterruptPin extends IPin {
  /** Attach interrupt handler */
  attachInterrupt(handler: () => void, mode: InterruptMode): void;
  
  /** Detach interrupt handler */
  detachInterrupt(): void;
  
  /** Check if interrupt is attached */
  hasInterrupt(): boolean;
}

enum InterruptMode {
  RISING = 'RISING',
  FALLING = 'FALLING',
  CHANGE = 'CHANGE',
  LOW = 'LOW',
  HIGH = 'HIGH'
}

/**
 * Touch-capable pin (ESP32 specific)
 */
interface ITouchPin extends IPin {
  /** Read touch sensor value */
  read(): number;
  
  /** Set touch threshold for interrupt */
  setThreshold(threshold: number): void;
  
  /** Attach touch interrupt */
  attachTouchInterrupt(handler: () => void): void;
}

/**
 * ADC-enabled pin with advanced features
 */
interface IADCPin extends IAnalogInput {
  /** Set attenuation (ESP32: 0dB, 2.5dB, 6dB, 11dB) */
  setAttenuation(db: number): void;
  
  /** Enable/disable continuous sampling */
  startContinuousSampling(): void;
  
  /** Stop continuous sampling */
  stopContinuousSampling(): void;
  
  /** Get averaged sample over N readings */
  readAveraged(samples: number): AnalogValue;
}

/**
 * DAC-enabled pin (true analog output)
 */
interface IDACPin extends IAnalogOutput {
  /** Output sine wave at frequency */
  outputSine(frequency: number): void;
  
  /** Stop wave output */
  stopOutput(): void;
  
  /** Set output channel (if multiple available) */
  setChannel(channel: number): void;
}
```

---

## Source: types/capabilities.ts

```typescript
// src/@typecode/core/types/capabilities.ts

/**
 * Pin capability flags
 * These are compile-time constants that define pin behavior
 */
interface PinCapabilities {
  /** Can read digital values */
  readonly digitalInput: boolean;
  
  /** Can write digital values */
  readonly digitalOutput: boolean;
  
  /** Can read analog values (ADC) */
  readonly analogInput: boolean;
  
  /** Can write analog values (DAC) */
  readonly analogOutput: boolean;
  
  /** Supports PWM output */
  readonly pwm: boolean;
  
  /** Supports hardware interrupts */
  readonly interrupt: boolean;
  
  /** Has internal pull-up resistor */
  readonly pullUp: boolean;
  
  /** Has internal pull-down resistor */
  readonly pullDown: boolean;
  
  /** Is touch-capable (ESP32) */
  readonly touch: boolean;
  
  /** Is open-drain capable */
  readonly openDrain: boolean;
}

/**
 * Capability set for a basic digital-only pin
 */
interface DigitalOnlyCapabilities extends PinCapabilities {
  readonly digitalInput: true;
  readonly digitalOutput: true;
  readonly analogInput: false;
  readonly analogOutput: false;
  readonly pwm: false;
  readonly interrupt: true;
  readonly pullUp: true;
  readonly pullDown: false;
  readonly touch: false;
  readonly openDrain: false;
}

/**
 * Capability set for a PWM-capable pin
 */
interface PWMCapabilities extends PinCapabilities {
  readonly digitalInput: true;
  readonly digitalOutput: true;
  readonly analogInput: false;
  readonly analogOutput: false;
  readonly pwm: true;
  readonly interrupt: true;
  readonly pullUp: true;
  readonly pullDown: boolean;
  readonly touch: false;
  readonly openDrain: false;
}

/**
 * Capability set for an analog input pin
 */
interface AnalogInputCapabilities extends PinCapabilities {
  readonly digitalInput: true;
  readonly digitalOutput: boolean;
  readonly analogInput: true;
  readonly analogOutput: false;
  readonly pwm: boolean;
  readonly interrupt: boolean;
  readonly pullUp: true;
  readonly pullDown: boolean;
  readonly touch: false;
  readonly openDrain: false;
}

/**
 * Capability set for a touch-capable pin (ESP32)
 */
interface TouchCapabilities extends PinCapabilities {
  readonly digitalInput: true;
  readonly digitalOutput: true;
  readonly analogInput: false;
  readonly analogOutput: false;
  readonly pwm: boolean;
  readonly interrupt: true;
  readonly pullUp: true;
  readonly pullDown: true;
  readonly touch: true;
  readonly openDrain: false;
}

/**
 * Type guard: Check if pin supports PWM
 */
function hasPWM(pin: IPin & { capabilities: PinCapabilities }): pin is IPWMPin {
  return pin.capabilities.pwm === true;
}

/**
 * Type guard: Check if pin supports analog input
 */
function hasAnalogInput(pin: IPin & { capabilities: PinCapabilities }): pin is IAnalogInput {
  return pin.capabilities.analogInput === true;
}

/**
 * Type guard: Check if pin supports interrupts
 */
function hasInterrupt(pin: IPin & { capabilities: PinCapabilities }): pin is IInterruptPin {
  return pin.capabilities.interrupt === true;
}

/**
 * Type guard: Check if pin is touch-capable
 */
function hasTouch(pin: IPin & { capabilities: PinCapabilities }): pin is ITouchPin {
  return pin.capabilities.touch === true;
}

/**
 * Compile-time capability check helper
 * Usage: if (supports<PWMCapabilities>(pin)) { ... }
 */
type SupportsCapabilities<T extends PinCapabilities, U extends PinCapabilities> = 
  T extends U ? true : false;
```

---

## Source: types/gpio.ts

```typescript
// src/@typecode/core/types/gpio.ts

import { IPin, IDigitalPin, IPWMPin, IAnalogInput, PinNumber } from './pin';
import { PinCapabilities } from './capabilities';

/**
 * GPIO configuration options
 */
interface GPIOConfig {
  /** Pin number on the board */
  pin: PinNumber;
  
  /** Optional GPIO number (defaults to pin number) */
  gpio?: PinNumber;
  
  /** Pin capabilities */
  capabilities: PinCapabilities;
  
  /** Human-readable name */
  name?: string;
  
  /** Associated hardware peripheral (e.g., "I2C0_SDA") */
  peripheral?: string;
}

/**
 * Factory for creating typed GPIO pins
 * Architecture shims use this to create pin instances
 */
interface IGPIOPinFactory {
  /** Create a basic digital pin */
  createDigitalPin(config: GPIOConfig): IDigitalPin;
  
  /** Create a PWM-capable pin */
  createPWMPin(config: GPIOConfig): IPWMPin;
  
  /** Create an analog input pin */
  createAnalogPin(config: GPIOConfig): IAnalogInput;
  
  /** Create a pin from configuration (auto-detects type) */
  createPin(config: GPIOConfig): IPin;
}

/**
 * Pin group for related pins (e.g., a parallel bus)
 */
interface IPinGroup<T extends IPin = IPin> {
  /** Group name */
  readonly name: string;
  
  /** Pins in the group */
  readonly pins: ReadonlyArray<T>;
  
  /** Write values to all pins simultaneously */
  writeAll(values: number[]): void;
  
  /** Read all pins simultaneously */
  readAll(): number[];
}

/**
 * 8-bit parallel port interface
 */
interface IParallelPort extends IPinGroup<IDigitalPin> {
  /** Write a byte to the port */
  writeByte(value: number): void;
  
  /** Read a byte from the port */
  readByte(): number;
  
  /** Set direction for all pins */
  setDirection(output: boolean): void;
}

/**
 * Pin state for serialization/debugging
 */
interface PinState {
  number: number;
  mode: string;
  value: number | boolean;
  capabilities: PinCapabilities;
}

/**
 * Helper to get pin state (useful for debugging)
 */
function getPinState(pin: IPin): PinState {
  return {
    number: pin.number,
    mode: pin.getMode(),
    value: 'read' in pin ? (pin as IDigitalPin).read() : 0,
    capabilities: (pin as IPin & { capabilities: PinCapabilities }).capabilities
  };
}
```

---

## Architecture-Specific Implementations

### Arduino AVR Pins

```typescript
// src/@typecode/arch-avr/pins.ts

import { IDigitalPin, IPWMPin, IAnalogInput, PinMode, PinNumber } from '@typecode/core';

/**
 * Arduino Uno Pin Map
 * ATmega328P-PU (DIP-28 package)
 */
const AVR_PIN_MAP = {
  // Digital pins
  D0:  { gpio: 0,  pwm: false, analog: false },  // RX
  D1:  { gpio: 1,  pwm: false, analog: false },  // TX
  D2:  { gpio: 2,  pwm: false, analog: false, interrupt: true },
  D3:  { gpio: 3,  pwm: true,  analog: false, interrupt: true },  // PWM ~
  D4:  { gpio: 4,  pwm: false, analog: false },
  D5:  { gpio: 5,  pwm: true,  analog: false },  // PWM ~
  D6:  { gpio: 6,  pwm: true,  analog: false },  // PWM ~
  D7:  { gpio: 7,  pwm: false, analog: false },
  D8:  { gpio: 8,  pwm: false, analog: false },
  D9:  { gpio: 9,  pwm: true,  analog: false },  // PWM ~
  D10: { gpio: 10, pwm: true,  analog: false },  // PWM ~, SS
  D11: { gpio: 11, pwm: true,  analog: false },  // PWM ~, MOSI
  D12: { gpio: 12, pwm: false, analog: false },  // MISO
  D13: { gpio: 13, pwm: false, analog: false },  // LED, SCK
  
  // Analog pins (can also be digital)
  A0:  { gpio: 14, pwm: false, analog: true },
  A1:  { gpio: 15, pwm: false, analog: true },
  A2:  { gpio: 16, pwm: false, analog: true },
  A3:  { gpio: 17, pwm: false, analog: true },
  A4:  { gpio: 18, pwm: false, analog: true },  // SDA
  A5:  { gpio: 19, pwm: false, analog: true },  // SCL
} as const;

/**
 * AVR Digital Pin Implementation
 * Transpiles to: pinMode(), digitalWrite(), digitalRead()
 */
class AVRDigitalPin implements IDigitalPin {
  readonly number: PinNumber;
  readonly gpio: PinNumber;
  private _mode: PinMode;
  
  constructor(number: number, gpio: number) {
    this.number = number as PinNumber;
    this.gpio = gpio as PinNumber;
    this._mode = PinMode.INPUT;
  }
  
  getMode(): PinMode {
    return this._mode;
  }
  
  setMode(mode: PinMode): void {
    this._mode = mode;
    // Transpiles to: pinMode(this.gpio, mode);
  }
  
  read(): boolean {
    // Transpiles to: return digitalRead(this.gpio);
    return false;
  }
  
  isHigh(): boolean {
    return this.read() === true;
  }
  
  isLow(): boolean {
    return this.read() === false;
  }
  
  async waitForRising(timeout?: number): Promise<boolean> {
    // Transpiles to polling loop or attachInterrupt
    return false;
  }
  
  async waitForFalling(timeout?: number): Promise<boolean> {
    // Transpiles to polling loop or attachInterrupt
    return false;
  }
  
  write(value: boolean): void {
    // Transpiles to: digitalWrite(this.gpio, value ? HIGH : LOW);
  }
  
  high(): void {
    this.write(true);
  }
  
  low(): void {
    this.write(false);
  }
  
  toggle(): void {
    // Transpiles to: digitalWrite(this.gpio, !digitalRead(this.gpio));
  }
  
  pulse(duration: number): void {
    this.high();
    // Transpiles to: delayMicroseconds(duration);
    this.low();
  }
  
  asInput(): this {
    this.setMode(PinMode.INPUT);
    return this;
  }
  
  asOutput(): this {
    this.setMode(PinMode.OUTPUT);
    return this;
  }
  
  asInputPullUp(): this {
    this.setMode(PinMode.INPUT_PULLUP);
    return this;
  }
  
  asInputPullDown(): this {
    // AVR does not support internal pull-down
    throw new Error('AVR does not support INPUT_PULLDOWN');
  }
}

/**
 * AVR PWM Pin Implementation
 * Transpiles to: analogWrite()
 */
class AVRPWMPin extends AVRDigitalPin implements IPWMPin {
  private _frequency: number = 490;  // Default Arduino PWM frequency
  private _resolution: number = 8;   // 8-bit (0-255)
  
  constructor(number: number, gpio: number) {
    super(number, gpio);
  }
  
  write(value: number): void {
    // Ensure pin is in OUTPUT mode
    this.setMode(PinMode.OUTPUT);
    // Transpiles to: analogWrite(this.gpio, value);
  }
  
  setFrequency(hz: number): void {
    this._frequency = hz;
    // AVR: Requires timer register manipulation
    // Transpiles to timer prescaler configuration
  }
  
  setDutyCycle(duty: number): void {
    const value = Math.floor(duty * 255);
    this.write(value);
  }
  
  getFrequency(): number {
    return this._frequency;
  }
  
  getResolution(): number {
    return this._resolution;
  }
  
  attach(): void {
    // No special setup needed for AVR analogWrite
  }
  
  detach(): void {
    // Transpiles to: analogWrite(this.gpio, 0);
    this.write(0);
  }
}

/**
 * AVR Analog Input Implementation
 * Transpiles to: analogRead()
 */
class AVRAnalogPin implements IAnalogInput {
  readonly number: PinNumber;
  readonly gpio: PinNumber;
  private _reference: number = 5.0;  // 5V reference
  private _resolution: number = 10;   // 10-bit (0-1023)
  
  constructor(number: number, gpio: number) {
    this.number = number as PinNumber;
    this.gpio = gpio as PinNumber;
  }
  
  getMode(): PinMode {
    return PinMode.ANALOG;
  }
  
  setMode(mode: PinMode): void {
    // Analog pins don't need mode setting on AVR
  }
  
  read(): number {
    // Transpiles to: return analogRead(this.gpio);
    return 0;
  }
  
  readVoltage(): number {
    const raw = this.read();
    return (raw / 1023.0) * this._reference;
  }
  
  setReference(voltage: number): void {
    this._reference = voltage;
    // Transpiles to: analogReference(INTERNAL or EXTERNAL)
  }
  
  getResolution(): number {
    return this._resolution;
  }
}
```

### ESP32 Pins

```typescript
// src/@typecode/arch-esp32/pins.ts

import { IDigitalPin, IPWMPin, IAnalogInput, PinMode, PinNumber, ITouchPin } from '@typecode/core';

/**
 * ESP32 GPIO Matrix
 * Most pins can be mapped to any function
 */
const ESP32_PIN_CONSTRAINTS = {
  // Inputs only (no internal pull-up/pull-down)
  INPUT_ONLY: [34, 35, 36, 39],
  
  // Touch-capable pins
  TOUCH: [0, 2, 3, 4, 12, 13, 14, 15, 27, 32, 33],
  
  // ADC2 pins (unusable when WiFi enabled)
  ADC2: [0, 2, 4, 12, 13, 14, 15, 25, 26, 27],
  
  // DAC pins (true analog output)
  DAC: [25, 26],
  
  // Strapping pins (have special behavior at boot)
  STRAPPING: [0, 2, 12, 15],
  
  // Flash memory pins (do not use)
  FLASH: [6, 7, 8, 9, 10, 11],
} as const;

/**
 * ESP32 Digital Pin Implementation
 * Transpiles to: gpio_set_direction(), gpio_set_level(), gpio_get_level()
 */
class ESP32DigitalPin implements IDigitalPin {
  readonly number: PinNumber;
  readonly gpio: PinNumber;
  private _mode: PinMode;
  
  constructor(number: number) {
    this.number = number as PinNumber;
    this.gpio = number as PinNumber;  // ESP32 uses GPIO number directly
    this._mode = PinMode.INPUT;
  }
  
  getMode(): PinMode {
    return this._mode;
  }
  
  setMode(mode: PinMode): void {
    this._mode = mode;
    // Transpiles to:
    // gpio_config_t io_conf = {};
    // io_conf.pin_bit_mask = (1ULL << this.gpio);
    // io_conf.mode = mode === OUTPUT ? GPIO_MODE_OUTPUT : GPIO_MODE_INPUT;
    // gpio_config(&io_conf);
  }
  
  read(): boolean {
    // Transpiles to: return gpio_get_level(this.gpio);
    return false;
  }
  
  isHigh(): boolean {
    return this.read();
  }
  
  isLow(): boolean {
    return !this.read();
  }
  
  async waitForRising(timeout?: number): Promise<boolean> {
    // Transpiles to: gpio_isr_handler_add() with edge detection
    return false;
  }
  
  async waitForFalling(timeout?: number): Promise<boolean> {
    return false;
  }
  
  write(value: boolean): void {
    // Transpiles to: gpio_set_level(this.gpio, value ? 1 : 0);
  }
  
  high(): void {
    this.write(true);
  }
  
  low(): void {
    this.write(false);
  }
  
  toggle(): void {
    // Transpiles to: gpio_set_level(this.gpio, !gpio_get_level(this.gpio));
  }
  
  pulse(duration: number): void {
    // Transpiles to esp_timer for precise timing
  }
  
  asInput(): this {
    this.setMode(PinMode.INPUT);
    return this;
  }
  
  asOutput(): this {
    this.setMode(PinMode.OUTPUT);
    return this;
  }
  
  asInputPullUp(): this {
    this.setMode(PinMode.INPUT_PULLUP);
    // Transpiles to: gpio_pullup_en(this.gpio);
    return this;
  }
  
  asInputPullDown(): this {
    this.setMode(PinMode.INPUT_PULLDOWN);
    // Transpiles to: gpio_pulldown_en(this.gpio);
    return this;
  }
}

/**
 * ESP32 PWM Pin Implementation (LEDC)
 * Transpiles to: ledc_setup(), ledc_attach_pin(), ledc_write()
 */
class ESP32PWMPin extends ESP32DigitalPin implements IPWMPin {
  private _frequency: number = 5000;
  private _resolution: number = 8;  // 8-bit (0-255)
  private _channel: number = 0;
  
  constructor(number: number, channel: number) {
    super(number);
    this._channel = channel;
  }
  
  write(value: number): void {
    // Transpiles to: ledc_write(this._channel, value);
  }
  
  setFrequency(hz: number): void {
    this._frequency = hz;
    // Transpiles to: ledc_set_freq(LEDC_LOW_SPEED_MODE, LEDC_TIMER_0, hz);
  }
  
  setDutyCycle(duty: number): void {
    const max = Math.pow(2, this._resolution) - 1;
    this.write(Math.floor(duty * max));
  }
  
  getFrequency(): number {
    return this._frequency;
  }
  
  getResolution(): number {
    return this._resolution;
  }
  
  attach(): void {
    // Transpiles to:
    // ledc_setup(this._channel, this._frequency, this._resolution);
    // ledc_attach_pin(this.gpio, this._channel);
  }
  
  detach(): void {
    // Transpiles to: ledc_stop(LEDC_LOW_SPEED_MODE, this._channel, 0);
  }
}

/**
 * ESP32 Analog Input Implementation
 * Transpiles to: adc1_get_raw() or adc2_get_raw()
 */
class ESP32AnalogPin implements IAnalogInput {
  readonly number: PinNumber;
  readonly gpio: PinNumber;
  private _attenuation: number = 11;  // 11dB (full scale 0-3.3V)
  private _resolution: number = 12;   // 12-bit (0-4095)
  private _channel: number;
  private _unit: number;  // ADC1 or ADC2
  
  constructor(number: number, channel: number, unit: number) {
    this.number = number as PinNumber;
    this.gpio = number as PinNumber;
    this._channel = channel;
    this._unit = unit;
  }
  
  getMode(): PinMode {
    return PinMode.ANALOG;
  }
  
  setMode(mode: PinMode): void {
    // ADC pins don't need mode setting
  }
  
  read(): number {
    // Transpiles to: adc1_get_raw(this._channel)
    // or for ADC2: adc2_get_raw(this._channel, ADC_WIDTH_BIT_12, &raw)
    return 0;
  }
  
  readVoltage(): number {
    const raw = this.read();
    return (raw / 4095.0) * 3.3;
  }
  
  setReference(voltage: number): void {
    // ESP32 uses internal 1.1V reference with attenuation
    // Set attenuation based on desired voltage range
  }
  
  getResolution(): number {
    return this._resolution;
  }
}

/**
 * ESP32 Touch Pin Implementation
 * Transpiles to: touch_read(), touch_pad_set_thresh()
 */
class ESP32TouchPin extends ESP32DigitalPin implements ITouchPin {
  private _threshold: number = 0;
  
  constructor(number: number, touchChannel: number) {
    super(number);
  }
  
  read(): number {
    // Transpiles to: touchRead(this.gpio) (Arduino)
    // or: touch_pad_read(this._touchChannel) (ESP-IDF)
    return 0;
  }
  
  setThreshold(threshold: number): void {
    this._threshold = threshold;
    // Transpiles to: touch_pad_set_thresh(this._touchChannel, threshold)
  }
  
  attachTouchInterrupt(handler: () => void): void {
    // Transpiles to: touch_pad_isr_handler_add()
  }
}
```

### RP2040 Pins

```typescript
// src/@typecode/arch-rp2040/pins.ts

import { IDigitalPin, IPWMPin, IAnalogInput, PinMode, PinNumber } from '@typecode/core';

/**
 * RP2040 GPIO Constraints
 */
const RP2040_PIN_CONSTRAINTS = {
  // ADC-capable pins (ADC0-ADC3 + internal temperature sensor)
  ADC: [26, 27, 28, 29],
  
  // PWM slice assignments (2 channels per slice)
  PWM_SLICES: {
    0: [0, 1],    // Slice 0: GPIO 0 (A), GPIO 1 (B)
    1: [2, 3],    // Slice 1: GPIO 2 (A), GPIO 3 (B)
    2: [4, 5],
    3: [6, 7],
    4: [8, 9],
    5: [10, 11],
    6: [12, 13],
    7: [14, 15],
    // Slice 8-15 are aliases for 0-7 on RP2040
  },
  
  // I2C pins
  I2C0: { SDA: [0, 4, 8, 12, 16, 20], SCL: [1, 5, 9, 13, 17, 21] },
  I2C1: { SDA: [2, 6, 10, 14, 18, 22], SCL: [3, 7, 11, 15, 19, 23] },
  
  // SPI pins
  SPI0: { RX: [0, 4, 16], CS: [1, 5, 17], SCK: [2, 6, 18], TX: [3, 7, 19] },
  SPI1: { RX: [8, 12, 24], CS: [9, 13, 25], SCK: [10, 14, 26], TX: [11, 15, 27] },
  
  // UART pins
  UART0: { TX: [0, 12, 16, 28], RX: [1, 13, 17, 29] },
  UART1: { TX: [4, 8, 20, 24], RX: [5, 9, 21, 25] },
} as const;

/**
 * RP2040 Digital Pin Implementation
 * Transpiles to: gpio_set_dir(), gpio_put(), gpio_get()
 */
class RP2040DigitalPin implements IDigitalPin {
  readonly number: PinNumber;
  readonly gpio: PinNumber;
  private _mode: PinMode;
  
  constructor(number: number) {
    this.number = number as PinNumber;
    this.gpio = number as PinNumber;
    this._mode = PinMode.INPUT;
  }
  
  getMode(): PinMode {
    return this._mode;
  }
  
  setMode(mode: PinMode): void {
    this._mode = mode;
    // Transpiles to:
    // gpio_init(this.gpio);
    // gpio_set_dir(this.gpio, mode === OUTPUT ? GPIO_OUT : GPIO_IN);
    // if (mode === INPUT_PULLUP) gpio_pull_up(this.gpio);
    // if (mode === INPUT_PULLDOWN) gpio_pull_down(this.gpio);
  }
  
  read(): boolean {
    // Transpiles to: return gpio_get(this.gpio);
    return false;
  }
  
  isHigh(): boolean {
    return this.read();
  }
  
  isLow(): boolean {
    return !this.read();
  }
  
  async waitForRising(timeout?: number): Promise<boolean> {
    // Transpiles to: gpio_set_irq_enabled_with_callback()
    return false;
  }
  
  async waitForFalling(timeout?: number): Promise<boolean> {
    return false;
  }
  
  write(value: boolean): void {
    // Transpiles to: gpio_put(this.gpio, value);
  }
  
  high(): void {
    this.write(true);
  }
  
  low(): void {
    this.write(false);
  }
  
  toggle(): void {
    // Transpiles to: gpio_put(this.gpio, !gpio_get(this.gpio));
  }
  
  pulse(duration: number): void {
    // Uses busy_wait_us() for short pulses
  }
  
  asInput(): this {
    this.setMode(PinMode.INPUT);
    return this;
  }
  
  asOutput(): this {
    this.setMode(PinMode.OUTPUT);
    return this;
  }
  
  asInputPullUp(): this {
    this.setMode(PinMode.INPUT_PULLUP);
    return this;
  }
  
  asInputPullDown(): this {
    this.setMode(PinMode.INPUT_PULLDOWN);
    return this;
  }
}

/**
 * RP2040 PWM Pin Implementation
 * Transpiles to: pwm_set_gpio(), pwm_set_wrap(), pwm_set_chan_level()
 */
class RP2040PWMPin extends RP2040DigitalPin implements IPWMPin {
  private _frequency: number = 1000;
  private _resolution: number = 16;  // 16-bit (0-65535)
  private _slice: number;
  private _channel: number;  // A or B
  
  constructor(number: number) {
    super(number);
    this._slice = Math.floor(number / 2);
    this._channel = number % 2;  // 0 = A, 1 = B
  }
  
  write(value: number): void {
    // Transpiles to: pwm_set_chan_level(this._slice, this._channel, value);
  }
  
  setFrequency(hz: number): void {
    this._frequency = hz;
    // Calculate wrap value based on system clock
    // Transpiles to: pwm_set_wrap(this._slice, clock_get_hz(clk_sys) / hz);
  }
  
  setDutyCycle(duty: number): void {
    const max = 65535;
    this.write(Math.floor(duty * max));
  }
  
  getFrequency(): number {
    return this._frequency;
  }
  
  getResolution(): number {
    return this._resolution;
  }
  
  attach(): void {
    // Transpiles to:
    // gpio_set_function(this.gpio, GPIO_FUNC_PWM);
    // pwm_config config = pwm_get_default_config();
    // pwm_init(this._slice, &config, true);
  }
  
  detach(): void {
    // Transpiles to: pwm_set_chan_level(this._slice, this._channel, 0);
  }
}

/**
 * RP2040 Analog Input Implementation
 * Transpiles to: adc_init(), adc_gpio_init(), adc_read()
 */
class RP2040AnalogPin implements IAnalogInput {
  readonly number: PinNumber;
  readonly gpio: PinNumber;
  private _reference: number = 3.3;
  private _resolution: number = 12;  // 12-bit (0-4095)
  private _channel: number;
  
  constructor(number: number) {
    this.number = number as PinNumber;
    this.gpio = number as PinNumber;
    this._channel = number - 26;  // ADC0-3 on GPIO 26-29
  }
  
  getMode(): PinMode {
    return PinMode.ANALOG;
  }
  
  setMode(mode: PinMode): void {
    // ADC pins configured at initialization
  }
  
  read(): number {
    // Transpiles to:
    // adc_select_input(this._channel);
    // return adc_read();
    return 0;
  }
  
  readVoltage(): number {
    const raw = this.read();
    return (raw / 4095.0) * this._reference;
  }
  
  setReference(voltage: number): void {
    this._reference = voltage;
    // RP2040 uses fixed 3.3V reference
  }
  
  getResolution(): number {
    return this._resolution;
  }
}
```

---

## Compile-Time Validation Examples

### Example 1: Invalid PWM Operation

```typescript
import { Board } from '@typecode/board-arduino-uno';

// Arduino Uno A0 is analog input only, no PWM
// This causes TypeScript error at compile time
Board.A0.write(128);  
// Error: Property 'write' does not exist on type 'IAnalogInput'.
//        IAnalogInput lacks PWM capability.
```

### Example 2: Valid PWM on Different Boards

```typescript
import { Board } from '@typecode/board-arduino-uno';
import { Board } from '@typecode/board-esp32-devkit';

// On Arduino Uno - D3 is PWM capable
Board.D3.write(128);  // ✓ Compiles - analogWrite(3, 128)

// On ESP32 - All GPIO can be PWM
Board.D2.write(128);  // ✓ Compiles - ledc_write(channel, 128)
```

### Example 3: Pull-down Availability Check

```typescript
import { Board } from '@typecode/board-arduino-uno';

// AVR does not support internal pull-down
Board.D2.asInputPullDown();  
// Error: AVR does not support INPUT_PULLDOWN
//        Property 'asInputPullDown' throws at runtime
```

---

## Transpiler Output Examples

### Arduino Uno Blink

**Input (TypeScript):**
```typescript
import { Board } from '@typecode/board-arduino-uno';

Board.LED.asOutput();

while (true) {
  Board.LED.high();
  sleep(1000);
  Board.LED.low();
  sleep(1000);
}
```

**Output (C++):**
```cpp
#include <Arduino.h>

void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(1000);
  digitalWrite(13, LOW);
  delay(1000);
}
```

### ESP32 PWM Breathing LED

**Input (TypeScript):**
```typescript
import { Board } from '@typecode/board-esp32-devkit';

Board.D2.setFrequency(5000);
Board.D2.attach();

while (true) {
  for (let i = 0; i < 256; i++) {
    Board.D2.write(i);
    sleep(10);
  }
  for (let i = 255; i >= 0; i--) {
    Board.D2.write(i);
    sleep(10);
  }
}
```

**Output (C++):**
```cpp
#include <Arduino.h>

const int LED_PIN = 2;
const int PWM_CHANNEL = 0;
const int PWM_FREQ = 5000;
const int PWM_RESOLUTION = 8;

void setup() {
  ledcSetup(PWM_CHANNEL, PWM_FREQ, PWM_RESOLUTION);
  ledcAttachPin(LED_PIN, PWM_CHANNEL);
}

void loop() {
  for (int i = 0; i < 256; i++) {
    ledcWrite(PWM_CHANNEL, i);
    delay(10);
  }
  for (int i = 255; i >= 0; i--) {
    ledcWrite(PWM_CHANNEL, i);
    delay(10);
  }
}
```

---

## Next Steps

- **[02-bus-interfaces.md](./02-bus-interfaces.md)** - I2C, SPI, UART interfaces
- **[05-board-definitions.md](./05-board-definitions.md)** - Board manifest format