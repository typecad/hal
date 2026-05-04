// ---------------------------------------------------------------------------
// @typehal/schema — Board definition manifest types
// ---------------------------------------------------------------------------

import type { PinCapabilityFlags, ArchitectureIdentifier } from '@typehal/core';

// ---------------------------------------------------------------------------
// Memory spec
// ---------------------------------------------------------------------------

interface MemorySpec {
  /** Flash / program memory in bytes. */
  flash: number;
  /** SRAM in bytes. */
  sram: number;
  /** EEPROM in bytes (0 if none). */
  eeprom: number;
  /** External RAM (PSRAM) in bytes, if available. */
  externalRam?: number;
  /** RTC memory in bytes, if available. */
  rtcMemory?: number;
}

// ---------------------------------------------------------------------------
// Pin definition
// ---------------------------------------------------------------------------

export interface PinDefinition {
  /** Pin number on the physical package. */
  number: number;
  /** GPIO number (may differ from physical pin). */
  gpio?: number;
  /** Pin name (e.g. "D13", "A0", "GP0"). */
  name: string;
  /** Alternate names (e.g. ["RX"], ["SDA"]). */
  aliases?: string[];
  /** Pin capabilities. */
  capabilities: PinCapabilityFlags;
  /** Associated peripheral functions. */
  functions?: PeripheralFunction[];
  /** Is this pin connected to the on-board LED? */
  onboardLed?: boolean;
  /** Is this pin connected to the on-board button? */
  onboardButton?: boolean;
  /** Notes / warnings about this pin. */
  notes?: string;
  /** Is this pin marked as unsafe? Use with caution (e.g., boot strapping pins). */
  unsafe?: boolean;
  /**
   * Peripheral functions this pin participates in, expressed as human-readable
   * strings for IDE hover / documentation. E.g. ["I2C0 SDA", "ADC ch4"].
   * Auto-derived from `functions` but can be overridden for clarity.
   */
  alternateFunctions?: string[];
  /**
   * Warnings about using this pin. Shown in IDE hover and transpile diagnostics.
   * E.g. ["Conflicts with UART0 — avoid if using Serial"]
   */
  warnings?: string[];
}

export interface PeripheralFunction {
  /** Peripheral type. */
  type: 'i2c' | 'spi' | 'uart' | 'adc' | 'dac' | 'pwm' | 'touch' | 'usb';
  /** Peripheral instance number. */
  instance: number;
  /** Function role (e.g. "sda", "scl", "mosi", "miso"). */
  role: string;
  /** Timer associated with this PWM function (e.g. "timer0", "timer1"). */
  timer?: string;
}

// ---------------------------------------------------------------------------
// Pin definitions aggregate
// ---------------------------------------------------------------------------

interface PinDefinitions {
  /** Complete list of every pin on the board. */
  all: PinDefinition[];

  /** Digital pin names. */
  digital: string[];
  /** Analog input pin names. */
  analog: string[];
  /** PWM-capable pin names. */
  pwm: string[];
  /** Pin names marked as unsafe (for validation warnings). */
  unsafe?: string[];

  /** I2C bus pin assignments keyed by bus instance number. */
  i2c: Record<number, { sda: string; scl: string }>;
  /** SPI bus pin assignments keyed by bus instance number. */
  spi: Record<number, { mosi: string; miso: string; sck: string; cs?: string }>;
  /** UART bus pin assignments keyed by bus instance number. */
  uart: Record<number, { tx: string; rx: string; rts?: string; cts?: string }>;

  /** On-board LED pin name. */
  led?: string;
  /** On-board button pin name. */
  button?: string;
}

// ---------------------------------------------------------------------------
// Peripheral definitions
// ---------------------------------------------------------------------------

interface PeripheralInstance {
  instance: number;
  defaultPins: Record<string, string>;
  alternatePins?: Record<string, string[]>;
}

interface ADCDefinition {
  instance: number;
  channels: number;
  /** Resolution in bits. */
  resolution: number;
  /** Default reference voltage (used when no analogReference() call precedes readVoltage()). */
  referenceVoltage: number;
  /** Pre-computed maximum ADC value: (1 << resolution) - 1. Used by readVoltage() and board(). */
  maxValue: number;
  /** Per-reference voltage map keyed by AnalogReference member name (e.g. { DEFAULT: 5.0, INTERNAL: 1.1 }). */
  referenceVoltages?: Record<string, number>;
}

interface DACDefinition {
  instance: number;
  /** Resolution in bits. */
  resolution: number;
  pins: string[];
}

interface PWMDefinition {
  channels: number;
  /** Resolution in bits. */
  resolution: number;
  /** Maximum frequency in Hz. */
  maxFrequency: number;
}

interface USBDefinition {
  type: 'device' | 'host' | 'otg';
  vid: string;
  pid: string;
}

interface WiFiDefinition {
  type: 'wifi' | 'wifi6';
  supportsStation: boolean;
  supportsAp: boolean;
}

interface BluetoothDefinition {
  type: 'classic' | 'ble' | 'dual';
  version: string;
}

interface TouchDefinition {
  channels: number;
  pins: string[];
}

interface PeripheralDefinitions {
  i2c: PeripheralInstance[];
  spi: PeripheralInstance[];
  uart: PeripheralInstance[];
  adc: ADCDefinition[];
  dac?: DACDefinition[];
  pwm: PWMDefinition;
  usb?: USBDefinition;
  wifi?: WiFiDefinition;
  bluetooth?: BluetoothDefinition;
  touch?: TouchDefinition;
}

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

interface FeatureFlags {
  multicore: boolean;
  coreCount: number;
  deepSleep: boolean;
  watchdog: boolean;
  externalInterrupts: boolean;
  hardwareRng: boolean;
  fpu: boolean;
}

// ---------------------------------------------------------------------------
// Build configuration
// ---------------------------------------------------------------------------

interface BuildConfig {
  /** Framework-specific build identifiers (e.g., { 'my-framework': 'target:arch:board' }). */
  frameworks?: Record<string, string>;
  linkerScript?: string;
  extraFlags?: string[];
  defines?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Board definition (top-level manifest)
// ---------------------------------------------------------------------------

export interface BoardDefinition {
  /** Board identifier (e.g. "my-board"). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Board vendor. */
  vendor: string;
  /** Board description. */
  description?: string;

  /** Target architecture. */
  architecture: ArchitectureIdentifier;
  /** MCU / FPGA part number. */
  mcu: string;
  /** Clock speed in Hz. */
  clockSpeed: number;

  /** Memory specifications. */
  memory: MemorySpec;
  /** Pin definitions. */
  pins: PinDefinitions;
  /** Built-in peripherals. */
  peripherals: PeripheralDefinitions;
  /** Supported features. */
  features: FeatureFlags;
  /** Build configuration. */
  build: BuildConfig;

  /** Related board variants. */
  variants?: string[];
}
