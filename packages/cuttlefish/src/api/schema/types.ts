// ---------------------------------------------------------------------------
// @typecad/cuttlefish/api/schema — Board definition manifest types
// ---------------------------------------------------------------------------

import type { PinCapabilityFlags } from '../capabilities.js';
import type { ArchitectureIdentifier } from '../board-types.js';

// ---------------------------------------------------------------------------
// Memory spec
// ---------------------------------------------------------------------------

export interface MemorySpec {
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
  /** Pin name — MCU-native identifier (e.g. "PB5", "GPIO21", "PC0"). */
  name: string;
  /** MCU port identifier for contract matching (e.g. "PB5", "GPIO21"). Auto-derived from name if absent. */
  port?: string;
  /** Alternate names (e.g. ["LED", "SCK"], ["SDA"]). */
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
}

// ---------------------------------------------------------------------------
// Pin definitions aggregate
// ---------------------------------------------------------------------------

export interface PinDefinitions {
  /** Offset for analog pin numbers (e.g. A0 = 14 on Uno). */
  analogOffset?: number;
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

  /**
   * Additional named board pins (e.g. a PWM-driven onboard LED). Keys should
   * be snake_case so the flattened `pins.<key>` entry registers the
   * UPPER_SNAKE identifier in the transpiler's pin alias map.
   */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Peripheral definitions
// ---------------------------------------------------------------------------

export interface PeripheralInstance {
  instance: number;
  defaultPins: Record<string, string>;
  alternatePins?: Record<string, string[]>;
}

export interface ADCDefinition {
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

export interface DACDefinition {
  instance: number;
  /** Resolution in bits. */
  resolution: number;
  pins: string[];
}

export interface PWMDefinition {
  channels: number;
  /** Resolution in bits. */
  resolution: number;
  /** Maximum frequency in Hz. */
  maxFrequency: number;
}

export interface USBDefinition {
  type: 'device' | 'host' | 'otg';
  vid: string;
  pid: string;
}

export interface WiFiDefinition {
  type: 'wifi' | 'wifi6';
  supportsStation: boolean;
  supportsAp: boolean;
}

export interface BluetoothDefinition {
  type: 'classic' | 'ble' | 'dual';
  version: string;
}

export interface TouchDefinition {
  channels: number;
  pins: string[];
}

export interface TimerDefinition {
  instance: number;
  /** Timer type classification. */
  type: 'general' | 'high_speed' | 'rtc' | 'sys';
  /** Register width in bits. */
  bits: 8 | 16 | 32 | 64;
  /** Counter frequency in Hz (if fixed). */
  frequency?: number;
  /** Features supported by this timer. */
  features?: Array<'pwm' | 'capture' | 'compare' | 'interrupt' | 'dma'>;
}

export interface DMADefinition {
  instance: number;
  /** Number of independent DMA channels. */
  channels: number;
  /** Peripherals that can act as DMA triggers/destinations. */
  peripherals?: string[];
  /** Max transfer size in bytes per transaction. */
  maxTransferSize?: number;
}

export interface PeripheralDefinitions {
  /** Peripheral object name aliases (e.g. UART0 -> Serial). */
  aliases?: Record<string, string>;
  i2c: readonly PeripheralInstance[];
  spi: readonly PeripheralInstance[];
  uart: readonly PeripheralInstance[];
  adc: readonly ADCDefinition[];
  dac?: readonly DACDefinition[];
  pwm: PWMDefinition;
  usb?: USBDefinition;
  wifi?: WiFiDefinition;
  bluetooth?: BluetoothDefinition;
  touch?: TouchDefinition;
  /** Hardware timers available for application use. */
  timers?: readonly TimerDefinition[];
  /** DMA controllers available for high-speed transfers. */
  dma?: readonly DMADefinition[];
}

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

export interface FeatureFlags {
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

export interface BuildConfig {
  /** Framework-specific build identifiers (e.g., { 'my-framework': 'target:arch:board' }). */
  frameworks?: Record<string, string>;
  linkerScript?: string;
  extraFlags?: string[];
  defines?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// MCU definition (hardware silicon)
// ---------------------------------------------------------------------------

/**
 * Intrinsic hardware definition for a Microcontroller (MCU).
 * Describes the silicon capabilities that are independent of any board.
 */
export interface MCUDefinition {
  /** MCU identifier (e.g. "stm32f411"). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Target architecture. */
  architecture: ArchitectureIdentifier;
  /** Built-in memory specifications. */
  memory: MemorySpec;
  /** Intrinsic pin definitions and capabilities. */
  pins: PinDefinitions;
  /** Hardware peripheral instances. */
  peripherals: PeripheralDefinitions;
  /** Silicon-level features. */
  features: FeatureFlags;
  /** MCU-specific build configuration. */
  build: BuildConfig;
  /**
   * Silicon-level @typecad/framework-zephyr chip data for this MCU. The lower
   * layer of the same record boards carry (BoardDefinition.zephyr): SoC
   * name(s), devicetree includes, GPIO controller split, default console and
   * clock plan — facts of the chip, not of any PCB. An MCU-only config (no
   * board package) flattens these into board constants under `zephyr.*` so
   * framework-zephyr's resolveChipFromBoard() reconstructs its chip descriptor
   * and the custom-board generator can emit an out-of-tree board for the
   * chip. Board packages keep board-level Zephyr facts (target name, probe
   * methods, storage layout, onboard LED/button DT aliases) in their own
   * zephyr field.
   */
  zephyr?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Board definition (top-level manifest)
// ---------------------------------------------------------------------------

/**
 * Board definition manifest.
 * Describes a specific PCB implementation that utilizes an MCU.
 */
export interface BoardDefinition {
  /** Board identifier (e.g. "my-board"). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Board vendor. */
  vendor: string;
  /** Board description. */
  description?: string;

  /** The MCU used on this board. */
  mcu: MCUDefinition;

  /** External clock speed in Hz. */
  clockSpeed: number;

  /**
   * Memory specifications (extends/overrides MCU memory).
   * Used for boards with external flash or RAM.
   */
  memory?: Partial<MemorySpec>;

  /**
   * Pin definitions (extends/overrides MCU pins).
   * Used for board-level aliases (D0, LED), header mappings, etc.
   */
  pins: PinDefinitions;

  /**
   * Built-in peripherals (extends/overrides MCU peripherals).
   * Used for board-level aliases (Serial, Wire, SPI).
   */
  peripherals: PeripheralDefinitions;

  /** Build configuration (overrides/extends MCU build). */
  build: BuildConfig;

  /**
   * Optional @typecad/framework-zephyr chip data for this board.
   *
   * Opaque (`Record<string, unknown>`) here so the core schema does not import
   * framework-zephyr's typed descriptor. framework-zephyr reads the flattened
   * board constants under `zephyr.*` to reconstruct its `ZephyrChipDescriptor`
   * — e.g. `zephyr.gpio.dtSpecs` maps GPIO pins to devicetree aliases (`led0`,
   * `sw0`), so the GPIO lowering emits `gpio_pin_*_dt()` (polarity-correct via
   * the DT's `GPIO_ACTIVE_LOW` flag) instead of the raw-controller fallback.
   *
   * Only literal object/array data is honored (the board-constants flattener
   * walks it recursively); `as const` on nested values defeats the walker, so
   * nested objects/arrays must be plain literals.
   */
  zephyr?: Record<string, unknown>;

  /** Related board variants. */
  variants?: string[];
}
