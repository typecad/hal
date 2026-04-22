// ---------------------------------------------------------------------------
// BoardDefinitionBuilder — Fluent API for creating board definitions
//
// Provides a type-safe, discoverable API for defining board packages
// without requiring manual object construction.
// ---------------------------------------------------------------------------

import type { BoardDefinition, PinDefinition, PeripheralDefinitions, MemorySpec, FeatureFlags, PeripheralInstance, ADCDefinition, PWMDefinition, PeripheralFunction, ArchitectureIdentifier } from './types';

// Type aliases for builder internal use
type MemoryConfig = MemorySpec;
type PeripheralDefinition = PeripheralDefinitions;

// ---------------------------------------------------------------------------
// Branded Types for Type Safety
// ---------------------------------------------------------------------------

/**
 * A branded type representing a physical pin number on the MCU package.
 * Use `pinNumber()` to create from a raw number.
 */
export interface PinNumber {
  readonly __brand: unique symbol;
  readonly value: number;
}

/**
 * A branded type representing a GPIO number (internal MCU GPIO index).
 * Use `gpioNumber()` to create from a raw number.
 */
export interface GPIO {
  readonly __brand: unique symbol;
  readonly value: number;
}

/**
 * Create a PinNumber from a raw number.
 * @param n The physical pin number
 */
export function pinNumber(n: number): PinNumber {
  if (n < 0 || !Number.isInteger(n)) {
    throw new Error(`Invalid pin number: ${n}. Must be a non-negative integer.`);
  }
  return { value: n } as PinNumber;
}

/**
 * Create a GPIO number from a raw number.
 * @param n The GPIO index
 */
export function gpioNumber(n: number): GPIO {
  if (n < 0 || !Number.isInteger(n)) {
    throw new Error(`Invalid GPIO number: ${n}. Must be a non-negative integer.`);
  }
  return { value: n } as GPIO;
}

// ---------------------------------------------------------------------------
// Pin Capability Builder
// ---------------------------------------------------------------------------

/**
 * Builder for pin capabilities.
 */
export class PinCapabilityBuilder {
  private _digitalInput = false;
  private _digitalOutput = false;
  private _analogInput = false;
  private _analogOutput = false;
  private _pwm = false;
  private _interrupt = false;
  private _pullUp = false;
  private _pullDown = false;
  private _touch = false;
  private _openDrain = false;

  digital(): this {
    this._digitalInput = true;
    this._digitalOutput = true;
    return this;
  }

  digitalInput(): this {
    this._digitalInput = true;
    return this;
  }

  digitalOutput(): this {
    this._digitalOutput = true;
    return this;
  }

  analog(resolution = 10): this {
    this._analogInput = true;
    return this;
  }

  analogOutput(): this {
    this._analogOutput = true;
    return this;
  }

  pwm(): this {
    this._pwm = true;
    this._digitalOutput = true;
    return this;
  }

  interrupt(): this {
    this._interrupt = true;
    return this;
  }

  pullUp(): this {
    this._pullUp = true;
    return this;
  }

  pullDown(): this {
    this._pullDown = true;
    return this;
  }

  touch(): this {
    this._touch = true;
    return this;
  }

  openDrain(): this {
    this._openDrain = true;
    return this;
  }

  build(): PinDefinition['capabilities'] {
    return {
      digitalInput: this._digitalInput,
      digitalOutput: this._digitalOutput,
      analogInput: this._analogInput,
      analogOutput: this._analogOutput,
      pwm: this._pwm,
      interrupt: this._interrupt,
      pullUp: this._pullUp,
      pullDown: this._pullDown,
      touch: this._touch,
      openDrain: this._openDrain,
    };
  }
}

// ---------------------------------------------------------------------------
// Pin Builder
// ---------------------------------------------------------------------------

/**
 * Builder for individual pin definitions.
 */
export class PinBuilder {
  private _number: number = 0;
  private _gpio: number = 0;
  private _name: string = '';
  private _capabilities: PinDefinition['capabilities'] = {
    digitalInput: false,
    digitalOutput: false,
    analogInput: false,
    analogOutput: false,
    pwm: false,
    interrupt: false,
    pullUp: false,
    pullDown: false,
    touch: false,
    openDrain: false,
  };
  private _functions: PeripheralFunction[] = [];
  private _aliases: string[] = [];
  private _onboardLed = false;

  constructor(pinNumber: number) {
    this._number = pinNumber;
    this._gpio = pinNumber;
  }

  /**
   * Set the GPIO number (if different from pin number).
   */
  gpio(gpio: number | GPIO): this {
    this._gpio = typeof gpio === 'number' ? gpio : gpio.value;
    return this;
  }

  /**
   * Set the pin name.
   */
  name(name: string): this {
    this._name = name;
    return this;
  }

  /**
   * Set pin capabilities using a builder callback.
   */
  capabilities(builder: (b: PinCapabilityBuilder) => void): this {
    const b = new PinCapabilityBuilder();
    builder(b);
    this._capabilities = b.build();
    return this;
  }

  /**
   * Add a peripheral function to this pin.
   */
  addFunction(type: PeripheralFunction['type'], instance: number, role: string): this {
    this._functions.push({ type, instance, role });
    return this;
  }

  /**
   * Add I2C function (SDA or SCL).
   */
  i2c(instance: number, role: 'sda' | 'scl'): this {
    return this.addFunction('i2c', instance, role);
  }

  /**
   * Add SPI function (MOSI, MISO, SCK, or CS).
   */
  spi(instance: number, role: 'mosi' | 'miso' | 'sck' | 'cs'): this {
    return this.addFunction('spi', instance, role);
  }

  /**
   * Add UART function (TX or RX).
   */
  uart(instance: number, role: 'tx' | 'rx'): this {
    return this.addFunction('uart', instance, role);
  }

  /**
   * Add an alias for this pin.
   */
  alias(alias: string): this {
    this._aliases.push(alias);
    return this;
  }

  /**
   * Mark this pin as the on-board LED.
   */
  asLed(): this {
    this._onboardLed = true;
    return this;
  }

  build(): PinDefinition {
    if (!this._name) {
      this._name = `D${this._number}`;
    }
    return {
      number: this._number,
      gpio: this._gpio,
      name: this._name,
      capabilities: this._capabilities,
      functions: this._functions,
      aliases: this._aliases,
      onboardLed: this._onboardLed,
    };
  }
}

// ---------------------------------------------------------------------------
// Peripheral Builder
// ---------------------------------------------------------------------------

/**
 * Builder for peripheral definitions.
 */
export class PeripheralBuilder {
  private _i2c: PeripheralDefinition['i2c'] = [];
  private _spi: PeripheralDefinition['spi'] = [];
  private _uart: PeripheralDefinition['uart'] = [];
  private _adc: PeripheralDefinition['adc'] = [];
  private _pwm: PeripheralDefinition['pwm'] = { channels: 0, resolution: 8, maxFrequency: 1000 };

  addI2C(instance: number, defaultPins: { sda: string; scl: string }): this {
    this._i2c.push({ instance, defaultPins });
    return this;
  }

  addSPI(instance: number, defaultPins: { mosi: string; miso: string; sck: string; cs: string }): this {
    this._spi.push({ instance, defaultPins });
    return this;
  }

  addUART(instance: number, defaultPins: { tx: string; rx: string }): this {
    this._uart.push({ instance, defaultPins });
    return this;
  }

  addADC(instance: number, channels: number, resolution: number, referenceVoltage: number): this {
    this._adc.push({ instance, channels, resolution, referenceVoltage });
    return this;
  }

  pwmConfig(channels: number, resolution: number, maxFrequency: number): this {
    this._pwm = { channels, resolution, maxFrequency };
    return this;
  }

  build(): PeripheralDefinition {
    return {
      i2c: this._i2c,
      spi: this._spi,
      uart: this._uart,
      adc: this._adc,
      pwm: this._pwm,
    };
  }
}

// ---------------------------------------------------------------------------
// Board Definition Builder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for creating board definitions.
 * 
 * @example
 * ```typescript
 * const uno = BoardDefinitionBuilder.create('arduino-uno')
 *   .displayName('Arduino Uno')
 *   .vendor('Arduino')
 *   .architecture('avr')
 *   .withMCU('ATmega328P', 16_000_000)
 *   .withMemory({ flash: 32_768, sram: 2_048, eeprom: 1_024 })
 *   .addDigitalPins(0, 13)
 *   .addAnalogPins(14, 19, { prefix: 'A' })
 *   .addPWMPins([3, 5, 6, 9, 10, 11])
 *   .setLedPin(13)
 *   .addI2C(0, { sda: 'A4', scl: 'A5' })
 *   .addSPI(0, { mosi: 'D11', miso: 'D12', sck: 'D13', cs: 'D10' })
 *   .addUART(0, { tx: 'D1', rx: 'D0' })
 *   .withFQBN('arduino:avr:uno')
 *   .build();
 * ```
 */
export class BoardDefinitionBuilder {
  private _id: string;
  private _name: string;
  private _vendor: string = 'Unknown';
  private _description: string = '';
  private _architecture: string = 'avr';
  private _mcu: string = 'Unknown';
  private _clockSpeed: number = 16_000_000;
  private _memory: MemoryConfig = { flash: 0, sram: 0, eeprom: 0 };
  private _pins: PinDefinition[] = [];
  private _peripherals: PeripheralDefinition = {
    i2c: [],
    spi: [],
    uart: [],
    adc: [],
    pwm: { channels: 0, resolution: 8, maxFrequency: 1000 },
  };
  private _features: FeatureFlags = {
    multicore: false,
    coreCount: 1,
    deepSleep: false,
    watchdog: true,
    externalInterrupts: true,
    hardwareRng: false,
    fpu: false,
  };
  private _fqbn: string = '';
  private _extraFlags: string[] = [];
  private _defines: Record<string, string> = {};

  private constructor(id: string) {
    this._id = id;
    this._name = id;
  }

  /**
   * Create a new board definition builder.
   * @param id Unique board identifier (e.g., 'arduino-uno', 'esp32-devkit')
   */
  static create(id: string): BoardDefinitionBuilder {
    const normalizedId = id
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/^-+|-+$/g, '');
    
    if (!normalizedId) {
      throw new Error('Invalid board ID. Use alphanumeric characters and hyphens only.');
    }
    
    return new BoardDefinitionBuilder(normalizedId);
  }

  /**
   * Set the display name for the board.
   */
  displayName(name: string): this {
    this._name = name;
    this._description = name;
    return this;
  }

  /**
   * Set the vendor/manufacturer name.
   */
  vendor(vendor: string): this {
    this._vendor = vendor;
    return this;
  }

  /**
   * Set the architecture identifier (avr, esp32, rp2040, etc.).
   */
  architecture(arch: string): this {
    this._architecture = arch;
    return this;
  }

  /**
   * Set the MCU part number and clock speed.
   */
  withMCU(mcu: string, clockSpeedHz: number): this {
    this._mcu = mcu;
    this._clockSpeed = clockSpeedHz;
    return this;
  }

  /**
   * Set the memory configuration.
   */
  withMemory(memory: Partial<MemoryConfig>): this {
    this._memory = { ...this._memory, ...memory };
    return this;
  }

  /**
   * Add a single pin with full control.
   */
  addPin(pinNumber: number, builder: (p: PinBuilder) => void): this {
    const p = new PinBuilder(pinNumber);
    builder(p);
    this._pins.push(p.build());
    return this;
  }

  /**
   * Add a range of digital-only pins.
   */
  addDigitalPins(start: number, end: number, options?: { prefix?: string }): this {
    const prefix = options?.prefix ?? 'D';
    for (let i = start; i <= end; i++) {
      const name = `${prefix}${i}`;
      this._pins.push({
        number: i,
        gpio: i,
        name,
        capabilities: {
          digitalInput: true,
          digitalOutput: true,
          analogInput: false,
          analogOutput: false,
          pwm: false,
          interrupt: false,
          pullUp: true,
          pullDown: false,
          touch: false,
          openDrain: false,
        },
        functions: [],
        aliases: [],
        onboardLed: false,
      });
    }
    return this;
  }

  /**
   * Add a range of analog-capable pins.
   */
  addAnalogPins(start: number, end: number, options?: { 
    prefix?: string; 
    adcChannels?: number;
    resolution?: number;
  }): this {
    const prefix = options?.prefix ?? 'A';
    let adcChannel = options?.adcChannels ?? 0;
    
    for (let i = start; i <= end; i++) {
      const name = `${prefix}${i - start}`;
      this._pins.push({
        number: i,
        gpio: i,
        name,
        capabilities: {
          digitalInput: true,
          digitalOutput: true,
          analogInput: true,
          analogOutput: false,
          pwm: false,
          interrupt: false,
          pullUp: true,
          pullDown: false,
          touch: false,
          openDrain: false,
        },
        functions: [{ type: 'adc', instance: 0, role: `ch${adcChannel}` }],
        aliases: [],
        onboardLed: false,
      });
      adcChannel++;
    }
    return this;
  }

  /**
   * Mark specific pins as PWM-capable.
   */
  addPWMPins(pins: number[]): this {
    for (const pinNum of pins) {
      const existing = this._pins.find(p => p.number === pinNum);
      if (existing) {
        existing.capabilities.pwm = true;
      } else {
        this._pins.push({
          number: pinNum,
          gpio: pinNum,
          name: `D${pinNum}`,
          capabilities: {
            digitalInput: true,
            digitalOutput: true,
            analogInput: false,
            analogOutput: false,
            pwm: true,
            interrupt: false,
            pullUp: true,
            pullDown: false,
            touch: false,
            openDrain: false,
          },
          functions: [],
          aliases: [],
          onboardLed: false,
        });
      }
    }
    return this;
  }

  /**
   * Mark specific pins as interrupt-capable.
   */
  addInterruptPins(pins: number[]): this {
    for (const pinNum of pins) {
      const existing = this._pins.find(p => p.number === pinNum);
      if (existing) {
        existing.capabilities.interrupt = true;
      }
    }
    return this;
  }

  /**
   * Set the on-board LED pin.
   */
  setLedPin(pin: number | string): this {
    const pinNum = typeof pin === 'string' ? parseInt(pin.replace(/\D/g, ''), 10) : pin;
    const existing = this._pins.find(p => p.number === pinNum);
    if (existing) {
      existing.onboardLed = true;
      // Ensure aliases array exists
      if (!existing.aliases) {
        existing.aliases = [];
      }
      if (!existing.aliases.includes('LED')) {
        existing.aliases.push('LED');
      }
    }
    return this;
  }

  /**
   * Configure peripherals using a builder callback.
   */
  withPeripherals(builder: (p: PeripheralBuilder) => void): this {
    const p = new PeripheralBuilder();
    builder(p);
    this._peripherals = p.build();
    return this;
  }

  /**
   * Add an I2C bus.
   */
  addI2C(instance: number, defaultPins: { sda: string; scl: string }): this {
    this._peripherals.i2c.push({ instance, defaultPins });
    return this;
  }

  /**
   * Add an SPI bus.
   */
  addSPI(instance: number, defaultPins: { mosi: string; miso: string; sck: string; cs: string }): this {
    this._peripherals.spi.push({ instance, defaultPins });
    return this;
  }

  /**
   * Add a UART/Serial port.
   */
  addUART(instance: number, defaultPins: { tx: string; rx: string }): this {
    this._peripherals.uart.push({ instance, defaultPins });
    return this;
  }

  /**
   * Configure ADC.
   */
  withADC(instance: number, channels: number, resolution: number, referenceVoltage: number): this {
    this._peripherals.adc.push({ instance, channels, resolution, referenceVoltage });
    return this;
  }

  /**
   * Configure features.
   */
  withFeatures(features: Partial<FeatureFlags>): this {
    this._features = { ...this._features, ...features };
    return this;
  }

  /**
   * Set the Fully Qualified Board Name for Arduino CLI.
   */
  withFQBN(fqbn: string): this {
    this._fqbn = fqbn;
    return this;
  }

  /**
   * Add extra build flags.
   */
  addExtraFlags(flags: string[]): this {
    this._extraFlags.push(...flags);
    return this;
  }

  /**
   * Add preprocessor defines.
   */
  addDefines(defines: Record<string, string>): this {
    Object.assign(this._defines, defines);
    return this;
  }

  /**
   * Build the final board definition.
   */
  build(): BoardDefinition {
    // Sort pins by number
    this._pins.sort((a, b) => a.number - b.number);

    // Build pin collections
    const digitalPins = this._pins
      .filter(p => p.capabilities.digitalInput || p.capabilities.digitalOutput)
      .map(p => p.name);
    
    const analogPins = this._pins
      .filter(p => p.capabilities.analogInput)
      .map(p => p.name);
    
    const pwmPins = this._pins
      .filter(p => p.capabilities.pwm)
      .map(p => p.name);

    const ledPin = this._pins.find(p => p.onboardLed);

    // Build I2C pin map
    const i2cMap: Record<number, { sda: string; scl: string }> = {};
    for (const bus of this._peripherals.i2c) {
      i2cMap[bus.instance] = bus.defaultPins as { sda: string; scl: string };
    }

    // Build SPI pin map
    const spiMap: Record<number, { mosi: string; miso: string; sck: string; cs: string }> = {};
    for (const bus of this._peripherals.spi) {
      spiMap[bus.instance] = bus.defaultPins as { mosi: string; miso: string; sck: string; cs: string };
    }

    // Build UART pin map
    const uartMap: Record<number, { tx: string; rx: string }> = {};
    for (const port of this._peripherals.uart) {
      uartMap[port.instance] = port.defaultPins as { tx: string; rx: string };
    }

    return {
      id: this._id,
      name: this._name,
      vendor: this._vendor,
      description: this._description || `${this._name} — ${this._mcu}`,
      architecture: this._architecture as ArchitectureIdentifier,
      mcu: this._mcu,
      clockSpeed: this._clockSpeed,
      memory: this._memory,
      pins: {
        all: this._pins,
        digital: digitalPins,
        analog: analogPins,
        pwm: pwmPins,
        i2c: i2cMap,
        spi: spiMap,
        uart: uartMap,
        led: ledPin?.name ?? '',
      },
      peripherals: this._peripherals,
      features: this._features,
      build: {
        arduino: this._fqbn,
        extraFlags: this._extraFlags,
        defines: {
          F_CPU: `${this._clockSpeed}UL`,
          ARDUINO: '10819',
          ...this._defines,
        },
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Validation Helpers
// ---------------------------------------------------------------------------

/**
 * Validate a board definition for common issues.
 * Returns an array of error messages (empty if valid).
 */
export function validateBoardDefinition(board: BoardDefinition): string[] {
  const errors: string[] = [];

  // Check required fields
  if (!board.id) errors.push('Board ID is required');
  if (!board.name) errors.push('Board name is required');
  if (!board.mcu) errors.push('MCU is required');
  if (board.clockSpeed <= 0) errors.push('Clock speed must be positive');

  // Check memory
  if (board.memory.flash <= 0) errors.push('Flash memory must be positive');
  if (board.memory.sram <= 0) errors.push('SRAM must be positive');

  // Check pins
  if (board.pins.all.length === 0) {
    errors.push('At least one pin must be defined');
  }

  // Check for duplicate pin numbers
  const pinNumbers = new Set<number>();
  for (const pin of board.pins.all) {
    if (pinNumbers.has(pin.number)) {
      errors.push(`Duplicate pin number: ${pin.number}`);
    }
    pinNumbers.add(pin.number);
  }

  // Check for duplicate pin names
  const pinNames = new Set<string>();
  for (const pin of board.pins.all) {
    if (pinNames.has(pin.name)) {
      errors.push(`Duplicate pin name: ${pin.name}`);
    }
    pinNames.add(pin.name);
  }

  // Check LED pin exists
  if (board.pins.led) {
    const ledExists = board.pins.all.some(p => p.name === board.pins.led);
    if (!ledExists) {
      errors.push(`LED pin '${board.pins.led}' not found in pin definitions`);
    }
  }

  // Check peripheral pins exist
  for (const [inst, pins] of Object.entries(board.pins.i2c ?? {})) {
    const i2cPins = pins as { sda: string; scl: string };
    if (!board.pins.all.some(p => p.name === i2cPins.sda)) {
      errors.push(`I2C${inst} SDA pin '${i2cPins.sda}' not found`);
    }
    if (!board.pins.all.some(p => p.name === i2cPins.scl)) {
      errors.push(`I2C${inst} SCL pin '${i2cPins.scl}' not found`);
    }
  }

  return errors;
}