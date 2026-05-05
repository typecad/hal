// ---------------------------------------------------------------------------
// Board package scaffolding
//
// Generates a complete board package structure from command-line options.
// ---------------------------------------------------------------------------

import path from "node:path";
import fs from "node:fs";
import {
  BoardTemplateOptions,
  generatePackageJson,
  generateTsConfig,
  generateIndexTs,
  generatePinsTs,
  generatePeripheralsTs,
  generateTimingTs,
  generateAnalogTs,
  generateInterruptsTs,
  generateStrategyTs,
  generateBoardTs,
} from "./templates";
import { type BoardDefinition, type PinDefinition } from '@typehal/schema';
import { WizardResult, PeripheralConfig } from "./wizard";
import { normalizeKebabName } from "../utils/strings";
import { toPascalCase } from "../utils/strings";
import { ARCH_DEFAULTS } from "./architecture-defaults";
import { generatePinFactoryStubs, ALL_PIN_FACTORY_VARIANTS } from "./pin-factory-templates";

/** Arduino core API version used in scaffolded board definitions. */
const ARDUINO_CORE_VERSION = '10819';

// Re-export for external use
export { BoardTemplateOptions } from "./templates";
export { runBoardWizard, WizardResult, PeripheralConfig } from "./wizard";
export type { PinDefinition } from "@typehal/schema";

interface ScaffoldOptions {
  /** Board name (e.g., 'my-custom-board') */
  name: string;
  /** Display name (e.g., 'My Custom Board') */
  displayName?: string;
  /** Vendor name */
  vendor?: string;
  /** Architecture identifier */
  architecture?: string;
  /** MCU part number */
  mcu?: string;
  /** Clock speed in MHz */
  clockSpeedMhz?: number;
  /** Flash size in KB */
  flashKb?: number;
  /** SRAM size in KB */
  sramKb?: number;
  /** EEPROM size in KB */
  eepromKb?: number;
  /** Framework-specific build target identifier */
  buildTarget?: string;
  /** Output directory */
  outDir?: string;
  /** Generate minimal package */
  minimal?: boolean;
}

// Valid architecture identifiers (must match @typehal/core)
const VALID_ARCHITECTURES = [
  'avr',
  'esp32',
  'esp32s2',
  'esp32s3',
  'esp32c3',
  'rp2040',
  'samd',
  'stm32',
  'nrf52',
] as const;

type ValidArchitecture = typeof VALID_ARCHITECTURES[number];

/**
 * Validate architecture identifier.
 */
function isValidArchitecture(arch: string): arch is ValidArchitecture {
  return VALID_ARCHITECTURES.includes(arch as ValidArchitecture);
}

/**
 * Get default values for an architecture.
 */
function getArchitectureDefaults(arch: ValidArchitecture): {
  mcu: string;
  clockSpeedMhz: number;
  flashKb: number;
  sramKb: number;
  eepromKb: number;
} {
  return ARCH_DEFAULTS[arch] ?? { mcu: 'Unknown', clockSpeedMhz: 16, flashKb: 32, sramKb: 2, eepromKb: 0 };
}

/**
 * Scaffold a new board package.
 *
 * @param options Scaffolding options
 * @returns Array of created file paths
 */
export function scaffoldBoardPackage(options: ScaffoldOptions): string[] {
  const {
    name: rawName,
    displayName,
    vendor = 'Unknown',
    architecture = 'avr',
    mcu: mcuOverride,
    clockSpeedMhz: clockOverride,
    flashKb: flashOverride,
    sramKb: sramOverride,
    eepromKb: eepromOverride,
    buildTarget = '',
    outDir: outDirOverride,
    minimal = false,
  } = options;

  // Normalize board name
  const name = normalizeKebabName(rawName);
  if (!name) {
    throw new Error('Invalid board name. Use alphanumeric characters and hyphens only.');
  }

  // Validate architecture
  if (!isValidArchitecture(architecture)) {
    throw new Error(
      `Invalid architecture '${architecture}'. Valid options: ${VALID_ARCHITECTURES.join(', ')}`
    );
  }

  // Get architecture defaults
  const defaults = getArchitectureDefaults(architecture);

  // Build template options
  const templateOptions: BoardTemplateOptions = {
    name,
    displayName: displayName || name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    vendor,
    architecture,
    mcu: mcuOverride || defaults.mcu,
    clockSpeedMhz: clockOverride || defaults.clockSpeedMhz,
    flashKb: flashOverride || defaults.flashKb,
    sramKb: sramOverride || defaults.sramKb,
    eepromKb: eepromOverride || defaults.eepromKb,
    buildTarget,
    minimal,
  };

  // Determine output directory
  const outDir = outDirOverride
    ? path.resolve(process.cwd(), outDirOverride)
    : path.resolve(process.cwd(), 'packages', `board-${name}`);

  // Check if directory already exists
  if (fs.existsSync(outDir)) {
    throw new Error(`Directory already exists: ${outDir}`);
  }

  const createdFiles: string[] = [];

  // Create directory structure
  const srcDir = path.join(outDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });

  // Generate files
  const files: Array<{ filename: string; content: string }> = [
    { filename: 'package.json', content: generatePackageJson(templateOptions) },
    { filename: 'tsconfig.json', content: generateTsConfig() },
    { filename: path.join('src', 'index.ts'), content: generateIndexTs(templateOptions) },
    { filename: path.join('src', 'pins.ts'), content: generatePinsTs(templateOptions) },
    { filename: path.join('src', 'peripherals.ts'), content: generatePeripheralsTs(templateOptions) },
    { filename: path.join('src', 'timing.ts'), content: generateTimingTs() },
    { filename: path.join('src', 'analog.ts'), content: generateAnalogTs(architecture) },
    { filename: path.join('src', 'interrupts.ts'), content: generateInterruptsTs() },
    { filename: path.join('src', 'strategy.ts'), content: generateStrategyTs() },
    { filename: path.join('src', 'board.ts'), content: generateBoardTs(templateOptions) },
  ];

  // Write files
  for (const { filename, content } of files) {
    const filePath = path.join(outDir, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    createdFiles.push(filePath);
  }

  return createdFiles;
}

/**
 * Scaffold a board package from wizard results (with full pin definitions).
 *
 * @param wizardResult Result from the interactive wizard
 * @param outDirOverride Optional output directory override
 * @returns Array of created file paths
 */
export function scaffoldFromWizard(wizardResult: WizardResult, outDirOverride?: string): string[] {
  const { name, displayName, vendor, architecture, mcu, clockSpeedMhz, flashKb, sramKb, eepromKb, buildTarget, pins, peripherals } = wizardResult;

  // Build template options
  const templateOptions: BoardTemplateOptions = {
    name,
    displayName,
    vendor,
    architecture,
    mcu,
    clockSpeedMhz,
    flashKb,
    sramKb,
    eepromKb,
    buildTarget,
    minimal: false,
  };

  // Determine output directory
  const outDir = outDirOverride
    ? path.resolve(process.cwd(), outDirOverride)
    : path.resolve(process.cwd(), 'packages', `board-${name}`);

  // Check if directory already exists
  if (fs.existsSync(outDir)) {
    throw new Error(`Directory already exists: ${outDir}`);
  }

  const createdFiles: string[] = [];

  // Create directory structure
  const srcDir = path.join(outDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });

  // Generate files with wizard data
  const files: Array<{ filename: string; content: string }> = [
    { filename: 'package.json', content: generatePackageJson(templateOptions) },
    { filename: 'tsconfig.json', content: generateTsConfig() },
    { filename: path.join('src', 'index.ts'), content: generateIndexTsWithPins(templateOptions, pins, peripherals) },
    { filename: path.join('src', 'pins.ts'), content: generatePinsTsWithData(templateOptions, pins) },
    { filename: path.join('src', 'peripherals.ts'), content: generatePeripheralsTs(templateOptions) },
    { filename: path.join('src', 'timing.ts'), content: generateTimingTs() },
    { filename: path.join('src', 'analog.ts'), content: generateAnalogTs(architecture) },
    { filename: path.join('src', 'interrupts.ts'), content: generateInterruptsTs() },
    { filename: path.join('src', 'strategy.ts'), content: generateStrategyTs() },
    { filename: path.join('src', 'board.ts'), content: generateBoardTsWithPins(templateOptions, pins, peripherals) },
  ];

  // Write files
  for (const { filename, content } of files) {
    const filePath = path.join(outDir, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    createdFiles.push(filePath);
  }

  return createdFiles;
}

/**
 * Generate index.ts with full pin definitions.
 */
function generateIndexTsWithPins(options: BoardTemplateOptions, pins: PinDefinition[], peripherals: PeripheralConfig): string {
  const { name, displayName, vendor, architecture, mcu, clockSpeedMhz, flashKb, sramKb, eepromKb, buildTarget } = options;
  const clockSpeed = clockSpeedMhz * 1_000_000;
  const className = toPascalCase(name);

  // Build pins.all array
  const pinsAllLines = pins.map(pin => {
    const caps = pin.capabilities;
    const capStr = `{
      digitalInput: ${caps.digitalInput}, digitalOutput: ${caps.digitalOutput},
      analogInput: ${caps.analogInput}, analogOutput: ${caps.analogOutput},
      pwm: ${caps.pwm}, interrupt: ${caps.interrupt},
      pullUp: ${caps.pullUp}, pullDown: ${caps.pullDown},
      touch: ${caps.touch}, openDrain: ${caps.openDrain},
    }`;
    
    const functionsStr = pin.functions!.length > 0
      ? `, functions: [${pin.functions!.map(f => `{ type: '${f.type}', instance: ${f.instance}, role: '${f.role}' }`).join(', ')}]`
      : '';
    
    const aliasesStr = pin.aliases!.length > 0
      ? `, aliases: [${pin.aliases!.map(a => `'${a}'`).join(', ')}]`
      : '';
    
    const ledStr = pin.onboardLed ? ', onboardLed: true' : '';
    
    return `  { number: ${pin.number}, gpio: ${pin.gpio ?? pin.number}, name: '${pin.name}', capabilities: ${capStr}${functionsStr}${aliasesStr}${ledStr} },`;
  });

  // Build pin name arrays
  const digitalPins = pins.filter(p => p.capabilities.digitalInput || p.capabilities.digitalOutput);
  const analogPins = pins.filter(p => p.capabilities.analogInput);
  const pwmPins = pins.filter(p => p.capabilities.pwm);

  // Find peripheral pins
  const i2cPins = findPeripheralPins(pins, 'i2c', peripherals.i2cCount);
  const spiPins = findPeripheralPins(pins, 'spi', peripherals.spiCount);
  const uartPins = findPeripheralPins(pins, 'uart', peripherals.uartCount);
  const ledPin = pins.find(p => p.onboardLed);

  return `// ---------------------------------------------------------------------------
// @typehal/board-${name} — Board definition manifest
// Generated by TypeHAL Board Wizard
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typehal/schema';

// Re-export the platform strategy so the CLI can resolve it automatically
export { BoardStrategy } from './strategy';

// ---------------------------------------------------------------------------
// Default capability flags
// ---------------------------------------------------------------------------

const NO  = false as const;
const YES = true  as const;

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const ${className}: BoardDefinition = {
  id: '${name}',
  name: '${displayName}',
  vendor: '${vendor}',
  description: '${displayName} — ${mcu}',
  architecture: '${architecture}',
  mcu: '${mcu}',
  clockSpeed: ${clockSpeed},

  // ----- Memory ------------------------------------------------------------
  memory: {
    flash:  ${flashKb * 1024},
    sram:   ${sramKb * 1024},
    eeprom: ${eepromKb * 1024},
  },

  // ----- Pins --------------------------------------------------------------
  pins: {
    all: [
${pinsAllLines.join('\n')}
    ],

    digital: [${digitalPins.map(p => `'${p.name}'`).join(', ')}],
    analog: [${analogPins.map(p => `'${p.name}'`).join(', ')}],
    pwm: [${pwmPins.map(p => `'${p.name}'`).join(', ')}],

    i2c: {
${i2cPins.map((bus, i) => `      ${i}: { sda: '${bus.sda}', scl: '${bus.scl}' },`).join('\n')}
    },
    spi: {
${spiPins.map((bus, i) => `      ${i}: { mosi: '${bus.mosi}', miso: '${bus.miso}', sck: '${bus.sck}', cs: '${bus.ss}' },`).join('\n')}
    },
    uart: {
${uartPins.map((bus, i) => `      ${i}: { tx: '${bus.tx}', rx: '${bus.rx}' },`).join('\n')}
    },

    led: ${ledPin ? `'${ledPin.name}'` : "'D13'"},
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    i2c: [${Array.from({ length: peripherals.i2cCount }, (_, i) => {
      const bus = i2cPins[i];
      return `{ instance: ${i}, defaultPins: { sda: '${bus?.sda ?? 'TODO'}', scl: '${bus?.scl ?? 'TODO'}' } }`;
    }).join(', ')}],
    spi: [${Array.from({ length: peripherals.spiCount }, (_, i) => {
      const bus = spiPins[i];
      return `{ instance: ${i}, defaultPins: { mosi: '${bus?.mosi ?? 'TODO'}', miso: '${bus?.miso ?? 'TODO'}', sck: '${bus?.sck ?? 'TODO'}', cs: '${bus?.ss ?? 'TODO'}' } }`;
    }).join(', ')}],
    uart: [${Array.from({ length: peripherals.uartCount }, (_, i) => {
      const bus = uartPins[i];
      return `{ instance: ${i}, defaultPins: { tx: '${bus?.tx ?? 'TODO'}', rx: '${bus?.rx ?? 'TODO'}' } }`;
    }).join(', ')}],
    adc: [{ instance: 0, channels: ${peripherals.adcChannels}, resolution: ${peripherals.adcResolution}, referenceVoltage: 3.3 }],
    pwm: { channels: ${peripherals.pwmChannels}, resolution: ${peripherals.pwmResolution}, maxFrequency: 1000 },
  },

  // ----- Features ----------------------------------------------------------
  features: {
    multicore: false,
    coreCount: 1,
    deepSleep: ${architecture.startsWith('esp32') || architecture === 'nrf52'},
    watchdog: true,
    externalInterrupts: true,
    hardwareRng: ${architecture.startsWith('esp32')},
    fpu: ${architecture !== 'avr'},
  },

  // ----- Build config ------------------------------------------------------
  build: {
    frameworks: {
      arduino: '${buildTarget}',
    },
    extraFlags: [],
    defines: {
      F_CPU: '${clockSpeed}UL',
      ARDUINO: ARDUINO_CORE_VERSION,
    },
  },
};

export default ${className};

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Typed pins
export { ${pins.map(p => p.name).join(', ')} } from './pins';

// Re-export HIGH/LOW constants from core
export { HIGH, LOW } from '@typehal/core';

// Peripheral bus instances
export { I2C0, SPI0, UART0 } from './peripherals';

// Timing / utility functions
export { delay, millis, micros, delayMicroseconds, map, constrain } from './timing';

// Analog helpers
export { AnalogReference, analogReference } from './analog';

// Interrupt helpers
export { noInterrupts, interrupts, attachInterrupt, detachInterrupt } from './interrupts';

// Board namespace (single-import convenience)
export { Board } from './board';
export type { IBoard, DigitalPins, AnalogPins } from './board';
`;
}

/**
 * Generate pins.ts with actual pin data.
 */
function generatePinsTsWithData(options: BoardTemplateOptions, pins: PinDefinition[]): string {
  const { name } = options;

  // Group pins by capability for factory function selection
  const pinExports = pins.map(pin => {
    const caps = pin.capabilities;
    let factoryFn = 'createDigitalPin';
    let interfaceType = 'BasePin';
    
    if (caps.analogInput && caps.pwm && caps.interrupt) {
      factoryFn = 'createFullPin';
      interfaceType = 'BasePin & PWMPin & AnalogPin & InterruptPin';
    } else if (caps.analogInput && caps.pwm) {
      factoryFn = 'createAnalogPWMPin';
      interfaceType = 'BasePin & PWMPin & AnalogPin';
    } else if (caps.analogInput) {
      factoryFn = 'createAnalogPin';
      interfaceType = 'AnalogPin';
    } else if (caps.pwm && caps.interrupt) {
      factoryFn = 'createPWMInterruptPin';
      interfaceType = 'BasePin & PWMPin & InterruptPin';
    } else if (caps.pwm) {
      factoryFn = 'createPWMPin';
      interfaceType = 'PWMPin';
    } else if (caps.interrupt) {
      factoryFn = 'createInterruptPin';
      interfaceType = 'BasePin & InterruptPin';
    }
    
    return `export const ${pin.name}: ${interfaceType} = ${factoryFn}(${pin.number}, ${pin.gpio ?? pin.number});`;
  });

  // Find alias pins
  const ledPin = pins.find(p => p.onboardLed);
  const sdaPins = pins.filter(p => p.aliases!.includes('SDA'));
  const sclPins = pins.filter(p => p.aliases!.includes('SCL'));
  const mosiPins = pins.filter(p => p.aliases!.includes('MOSI'));
  const misoPins = pins.filter(p => p.aliases!.includes('MISO'));
  const sckPins = pins.filter(p => p.aliases!.includes('SCK'));
  const ssPins = pins.filter(p => p.aliases!.includes('SS'));
  const txPins = pins.filter(p => p.aliases!.includes('TX'));
  const rxPins = pins.filter(p => p.aliases!.includes('RX'));

  return `// ---------------------------------------------------------------------------
// @typehal/board-${name} — Typed pin exports
// Generated by TypeHAL Board Wizard
// ---------------------------------------------------------------------------

import type {
  BasePin,
  PWMPin,
  AnalogPin,
  InterruptPin,
} from '@typehal/core';
import { pinNumber } from '@typehal/schema';

// ---------------------------------------------------------------------------
// Internal stub factories (no-op at runtime; consumed by transpiler)
// ---------------------------------------------------------------------------

${generatePinFactoryStubs(ALL_PIN_FACTORY_VARIANTS)}

// ---------------------------------------------------------------------------
// Pin exports
// ---------------------------------------------------------------------------

${pinExports.join('\n')}

// ---------------------------------------------------------------------------
// Convenience aliases
// ---------------------------------------------------------------------------

${ledPin ? `/** On-board LED. */\nexport const LED = ${ledPin.name};` : '// No on-board LED defined'}

${sdaPins.length > 0 ? `/** I2C data line. */\nexport const SDA = ${sdaPins[0].name};` : ''}
${sclPins.length > 0 ? `/** I2C clock line. */\nexport const SCL = ${sclPins[0].name};` : ''}

${mosiPins.length > 0 ? `/** SPI master-out / slave-in. */\nexport const MOSI = ${mosiPins[0].name};` : ''}
${misoPins.length > 0 ? `/** SPI master-in / slave-out. */\nexport const MISO = ${misoPins[0].name};` : ''}
${sckPins.length > 0 ? `/** SPI clock. */\nexport const SCK = ${sckPins[0].name};` : ''}
${ssPins.length > 0 ? `/** SPI slave select. */\nexport const SS = ${ssPins[0].name};` : ''}

${txPins.length > 0 ? `/** UART transmit. */\nexport const TX = ${txPins[0].name};` : ''}
${rxPins.length > 0 ? `/** UART receive. */\nexport const RX = ${rxPins[0].name};` : ''}
`;
}

/**
 * Generate board.ts with pin data.
 */
function generateBoardTsWithPins(options: BoardTemplateOptions, pins: PinDefinition[], peripherals: PeripheralConfig): string {
  const { name, displayName } = options;
  const className = toPascalCase(name);

  const digitalPins = pins.filter(p => p.capabilities.digitalInput || p.capabilities.digitalOutput);
  const analogPins = pins.filter(p => p.capabilities.analogInput);

  return `// ---------------------------------------------------------------------------
// Board namespace facade
// Generated by TypeHAL Board Wizard
// ---------------------------------------------------------------------------

import type {
  BasePin,
  PWMPin,
  AnalogPin,
  InterruptPin,
  II2CBus,
  ISPIBus,
  ISerialPort,
  BoardDefinition,
} from '@typehal/schema';

import {
  ${pins.map(p => p.name).join(',\n  ')},
} from './pins';

import { I2C0, SPI0, UART0 } from './peripherals';
import { ${className} } from './index';

// ---------------------------------------------------------------------------
// Type-safe pin collections
// ---------------------------------------------------------------------------

export interface DigitalPins {
  ${digitalPins.map(p => {
    const types = ['BasePin'];
    if (p.capabilities.pwm) types.push('PWMPin');
    if (p.capabilities.interrupt) types.push('InterruptPin');
    return `${p.name}: ${types.join(' & ')};`;
  }).join('\n  ')}
}

export interface AnalogPins {
  ${analogPins.map(p => `${p.name}: AnalogPin;`).join('\n  ')}
}

// ---------------------------------------------------------------------------
// Board facade
// ---------------------------------------------------------------------------

export interface IBoard {
  /** Board definition manifest (read-only metadata). */
  readonly definition: BoardDefinition;

  // ---- Individual pins ---------------------------------------------------
  ${pins.map(p => {
    const types = ['BasePin'];
    if (p.capabilities.pwm) types.push('PWMPin');
    if (p.capabilities.analogInput) types.push('AnalogPin');
    if (p.capabilities.interrupt) types.push('InterruptPin');
    return `readonly ${p.name}: ${types.join(' & ')};`;
  }).join('\n  ')}

  // ---- Peripherals -------------------------------------------------------
  readonly I2C0: II2CBus;
  readonly SPI0: ISPIBus;
  readonly UART0: ISerialPort;

  // ---- Pin collections ---------------------------------------------------
  readonly digital: DigitalPins;
  readonly analog: AnalogPins;
}

// ---------------------------------------------------------------------------
// Singleton board instance
// ---------------------------------------------------------------------------

/**
 * \`Board\` — the ${displayName} expressed as a fully-typed namespace.
 */
export const Board: IBoard = {
  definition: ${className},

  // Pins
  ${pins.map(p => p.name).join(',\n  ')},

  // Peripherals
  I2C0,
  SPI0,
  UART0,

  // Collections
  digital: { ${digitalPins.map(p => p.name).join(', ')} },
  analog: { ${analogPins.map(p => p.name).join(', ')} },
} as IBoard;

export default Board;
`;
}

/**
 * Find peripheral pin assignments from pin definitions.
 */
function findPeripheralPins(pins: PinDefinition[], type: string, count: number): Array<Record<string, string>> {
  const result: Array<Record<string, string>> = [];
  
  for (let i = 0; i < count; i++) {
    const busPins: Record<string, string> = {};
    
    for (const pin of pins) {
      for (const fn of pin.functions!) {
        if (fn.type === type && fn.instance === i) {
          busPins[fn.role] = pin.name;
        }
      }
    }
    
    result.push(busPins);
  }
  
  return result;
}

/**
 * Print next steps after scaffolding.
 */
export function printNextSteps(name: string, outDir: string): void {
  const packageName = `@typehal/board-${name}`;
  
  console.log(`
Board package created at: ${outDir}

Next steps:

1. Edit src/pins.ts to define your board's pins
   - Add pin exports for each digital/analog/PWM pin
   - Add convenience aliases (LED, SDA, SCL, etc.)

2. Edit src/index.ts to complete the BoardDefinition
   - Fill in the pins.all array with pin definitions
   - Update peripheral default pins
   - Set correct memory sizes and features

3. Edit src/board.ts to expose pins through the Board namespace
   - Uncomment and customize pin properties
   - Add all pins to the digital/analog collections

4. Build the package:
   cd ${outDir} && npm run build

5. Add to your workspace (if using monorepo):
   Add "${outDir.replace(/\\/g, '/')}" to the workspaces array in root package.json
   Then run: npm install

6. Update your project's typehal.config.ts:
   board: '${packageName}',

For detailed guidance, see: https://github.com/justind000/typehal/blob/main/BOARD_PACKAGES.md
`);
}