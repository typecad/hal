// ---------------------------------------------------------------------------
// board-generators.ts — Pure string-returning generators for the board-codegen
// tool. Each function takes a BoardSpec and returns the file content as a
// string. No filesystem I/O — the orchestrator (board-codegen.ts) writes files.
//
// Golden reference: the hand-written mcus/mcu-esp32c6/ and
// boards/board-esp32c6/ packages. These generators reproduce them from a
// C6 spec.
// ---------------------------------------------------------------------------

import type { BoardSpec } from './board-spec.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate the list of GPIO numbers in the spec's range, minus exclusions. */
function gpioList(spec: BoardSpec): number[] {
  const [first, last] = spec.gpioRange;
  const excluded = new Set(spec.excludedGpio);
  const list: number[] = [];
  for (let n = first; n <= last; n++) {
    if (!excluded.has(n)) list.push(n);
  }
  return list;
}

/** "GPIO0", "GPIO1", ... for the range. */
function gpioNames(spec: BoardSpec): string[] {
  return gpioList(spec).map(n => `GPIO${n}`);
}

/** The first I2C/SPI/UART bus instance's default pins, as a lookup. */
function busDefaultPin(spec: BoardSpec, bus: 'i2c' | 'spi' | 'uart', role: string): string | undefined {
  const map = spec[bus];
  const firstKey = Object.keys(map)[0];
  if (!firstKey) return undefined;
  return (map[firstKey] as Record<string, string | undefined>)[role];
}

// ---------------------------------------------------------------------------
// MCU package generators
// ---------------------------------------------------------------------------

export function genMcuPackageJson(spec: BoardSpec): string {
  const pkg = {
    name: `@typecad/mcu-${spec.architecture}`,
    version: '0.1.0',
    description: `TypeCAD MCU definition for ${spec.mcuName} — datasheet pins, peripheral capabilities, and HAL instances`,
    type: 'module',
    main: './dist/index.js',
    types: './dist/index.d.ts',
    exports: {
      '.': {
        types: './dist/index.d.ts',
        default: './dist/index.js',
      },
    },
    files: ['dist'],
    scripts: { build: 'tsc' },
    dependencies: {
      '@typecad/cuttlefish': '*',
      '@typecad/hal': '*',
    },
    license: 'MIT',
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}

export function genMcuTsconfig(_spec: BoardSpec): string {
  // Static — identical for every MCU package.
  return JSON.stringify({
    compilerOptions: {
      composite: true, target: 'ES2021', module: 'Node16', moduleResolution: 'Node16',
      strict: true, esModuleInterop: true, skipLibCheck: true,
      forceConsistentCasingInFileNames: true, declaration: true, declarationMap: true,
      sourceMap: true, rootDir: 'src', outDir: 'dist',
      experimentalDecorators: true, emitDecoratorMetadata: true,
    },
    include: ['src/**/*.ts'],
    references: [{ path: '../../packages/hal' }, { path: '../../packages/cuttlefish' }],
  }, null, 2) + '\n';
}

export function genMcuPins(spec: BoardSpec): string {
  const gpios = gpioList(spec);
  const lines: string[] = [
    `// ---------------------------------------------------------------------------`,
    `// @typecad/mcu-${spec.architecture} — Datasheet pin definitions`,
    `//`,
    `// Each pin is a Pin instance from @typecad/hal.`,
    `// ---------------------------------------------------------------------------`,
    '',
    `import { Pin } from '@typecad/hal';`,
    '',
  ];

  // GPIO constants
  for (const n of gpios) {
    lines.push(`export const GPIO${n} = new Pin(${n});`);
  }

  // Bus aliases
  const sda = busDefaultPin(spec, 'i2c', 'sda');
  const scl = busDefaultPin(spec, 'i2c', 'scl');
  const mosi = busDefaultPin(spec, 'spi', 'mosi');
  const miso = busDefaultPin(spec, 'spi', 'miso');
  const sck = busDefaultPin(spec, 'spi', 'sck');
  const ss = busDefaultPin(spec, 'spi', 'cs');
  const tx = busDefaultPin(spec, 'uart', 'tx');
  const rx = busDefaultPin(spec, 'uart', 'rx');

  lines.push('');
  lines.push('// ---------------------------------------------------------------------------');
  lines.push('// Convenience aliases (Silicon-level defaults — match Arduino-ESP32 core)');
  lines.push('// ---------------------------------------------------------------------------');
  lines.push('');

  if (sda) lines.push(`/** I2C0 data line (${sda}). */`, `export const SDA = ${sda};`);
  if (scl) lines.push(`/** I2C0 clock line (${scl}). */`, `export const SCL = ${scl};`);
  if (mosi) lines.push(`/** SPI0 MOSI (${mosi}). */`, `export const MOSI = ${mosi};`);
  if (miso) lines.push(`/** SPI0 MISO (${miso}). */`, `export const MISO = ${miso};`);
  if (sck) lines.push(`/** SPI0 clock (${sck}). */`, `export const SCK = ${sck};`);
  if (ss) lines.push(`/** SPI0 slave select (${ss}). */`, `export const SS = ${ss};`);
  if (tx) lines.push(`/** UART0 transmit (${tx}). */`, `export const TX = ${tx};`);
  if (rx) lines.push(`/** UART0 receive (${rx}). */`, `export const RX = ${rx};`);
  lines.push('');

  return lines.join('\n');
}

export function genMcuPeripherals(spec: BoardSpec): string {
  const arch = spec.architecture;
  const mcuName = spec.mcuName;
  const lines: string[] = [
    `// ---------------------------------------------------------------------------`,
    `// @typecad/mcu-${arch} — Hardware peripheral descriptions`,
    `// ---------------------------------------------------------------------------`,
    '',
    `import type {`,
    `  PeripheralInstance, ADCDefinition, PWMDefinition, TimerDefinition,`,
    `} from '@typecad/cuttlefish/api/schema';`,
    `import {`,
    `  I2CBus, SPIBus, SerialPort, i2cName, spiName, serialName, createHALInstances,`,
    `} from '@typecad/hal';`,
    '',
  ];

  // I2C instances
  lines.push('export const I2C_INSTANCES: readonly PeripheralInstance[] = [');
  for (const inst of spec.peripheralInstances.i2c) {
    const pins = Object.entries(inst.defaultPins).map(([k, v]) => `${k}: '${v}'`).join(', ');
    lines.push(`  { instance: ${inst.instance}, defaultPins: { ${pins} } },`);
  }
  lines.push('] as const;');
  lines.push('');

  // SPI instances
  lines.push('export const SPI_INSTANCES: readonly PeripheralInstance[] = [');
  for (const inst of spec.peripheralInstances.spi) {
    const pins = Object.entries(inst.defaultPins).map(([k, v]) => `${k}: '${v}'`).join(', ');
    lines.push(`  { instance: ${inst.instance}, defaultPins: { ${pins} } },`);
  }
  lines.push('] as const;');
  lines.push('');

  // UART instances
  lines.push('export const UART_INSTANCES: readonly PeripheralInstance[] = [');
  for (const inst of spec.peripheralInstances.uart) {
    const pins = Object.entries(inst.defaultPins).map(([k, v]) => `${k}: '${v}'`).join(', ');
    lines.push(`  { instance: ${inst.instance}, defaultPins: { ${pins} } },`);
  }
  lines.push('] as const;');
  lines.push('');

  // ADC instances
  lines.push('export const ADC_INSTANCES: readonly ADCDefinition[] = [');
  for (const adc of spec.adc) {
    const refV = adc.referenceVoltages
      ? `, referenceVoltages: { ${Object.entries(adc.referenceVoltages).map(([k, v]) => `${k}: ${v}`).join(', ')} }`
      : '';
    lines.push(`  { instance: ${adc.instance}, channels: ${adc.channels}, resolution: ${adc.resolution}, referenceVoltage: ${adc.referenceVoltage}, maxValue: ${adc.maxValue}${refV} },`);
  }
  lines.push('] as const;');
  lines.push('');

  // PWM
  lines.push('export const PWM_CAPABILITIES: PWMDefinition = {');
  lines.push(`  channels: ${spec.pwm.channels}, resolution: ${spec.pwm.resolution}, maxFrequency: ${spec.pwm.maxFrequency},`);
  lines.push('} as const;');
  lines.push('');

  // Touch (conditional)
  if (spec.touch) {
    lines.push('export const TOUCH_CAPABILITIES = {');
    lines.push(`  channels: ${spec.touch.channels},`);
    lines.push(`  pins: [${spec.touch.pins.map(p => `'${p}'`).join(', ')}],`);
    lines.push('};');
    lines.push('');
  }

  // Timers
  lines.push('export const TIMER_INSTANCES: readonly TimerDefinition[] = [');
  for (const t of spec.timers) {
    const feats = t.features ? `, features: [${t.features.map(f => `'${f}'`).join(', ')}]` : '';
    lines.push(`  { instance: ${t.instance}, type: '${t.type}', bits: ${t.bits} as 64${feats} },`);
  }
  lines.push('] as const;');
  lines.push('');

  // Connectivity
  lines.push(`export const WIFI_CAPABILITIES = { type: '${spec.wifi.type}', supportsStation: ${spec.wifi.supportsStation}, supportsAp: ${spec.wifi.supportsAp} } as const;`);
  lines.push(`export const BLUETOOTH_CAPABILITIES = { type: '${spec.bluetooth.type}', version: '${spec.bluetooth.version}' } as const;`);
  lines.push(`export const USB_CAPABILITIES = { type: '${spec.usb.type}', vid: '${spec.usb.vid}', pid: '${spec.usb.pid}' } as const;`);
  lines.push('');

  // MCU_PERIPHERALS aggregate
  lines.push('export const MCU_PERIPHERALS = {');
  lines.push('  i2c: [...I2C_INSTANCES],');
  lines.push('  spi: [...SPI_INSTANCES],');
  lines.push('  uart: [...UART_INSTANCES],');
  lines.push('  adc: [...ADC_INSTANCES],');
  lines.push('  pwm: PWM_CAPABILITIES,');
  if (spec.touch) lines.push('  touch: TOUCH_CAPABILITIES,');
  lines.push('  timers: [...TIMER_INSTANCES],');
  lines.push('  wifi: WIFI_CAPABILITIES,');
  lines.push('  bluetooth: BLUETOOTH_CAPABILITIES,');
  lines.push('  usb: USB_CAPABILITIES,');
  lines.push('} as const;');
  lines.push('');

  // HAL instances
  const i2cNames = spec.peripheralInstances.i2c.map((_, i) => `I2C${i}`).join(', ');
  const spiNames = spec.peripheralInstances.spi.map((_, i) => `SPI${i}`).join(', ');
  const uartNames = spec.peripheralInstances.uart.map((_, i) => `UART${i}`).join(', ');

  lines.push(`export const [${i2cNames}] = createHALInstances(I2C_INSTANCES, i => new I2CBus(i2cName(i)));`);
  lines.push(`export const [${spiNames}] = createHALInstances(SPI_INSTANCES, i => new SPIBus(spiName(i)));`);
  lines.push(`export const [${uartNames}] = createHALInstances(UART_INSTANCES, i => new SerialPort(serialName(i)));`);
  lines.push('');

  return lines.join('\n');
}

export function genMcuIndex(spec: BoardSpec): string {
  const arch = spec.architecture;
  const archUpper = arch.toUpperCase();
  const lines: string[] = [
    `// ---------------------------------------------------------------------------`,
    `// @typecad/mcu-${arch} — MCU definition manifest`,
    `// ---------------------------------------------------------------------------`,
    '',
    `import type { MCUDefinition } from '@typecad/cuttlefish/api/schema';`,
    `import { MCU_PERIPHERALS } from './peripherals.js';`,
    '',
    `const NO  = false as const;`,
    `const YES = true  as const;`,
    '',
    `const FULL_GPIO = {`,
    `  digitalInput: YES, digitalOutput: YES,`,
    `  analogInput: NO,   analogOutput: NO,`,
    `  pwm: YES,          interrupt: YES,`,
    `  pullUp: YES,       pullDown: YES,`,
    `  touch: NO,         openDrain: NO,`,
    `} as const;`,
    '',
    `const FULL_GPIO_ANALOG = { ...FULL_GPIO, analogInput: YES } as const;`,
  ];

  // Emit the capability flag helpers that are actually used by the pins
  const usedCaps = new Set(spec.pins.map(p => p.capabilities));
  if (usedCaps.has('FULL_GPIO_TOUCH')) {
    lines.push(`const FULL_GPIO_TOUCH = { ...FULL_GPIO, touch: YES } as const;`);
  }
  if (usedCaps.has('FULL_GPIO_ANALOG_TOUCH')) {
    lines.push(`const FULL_GPIO_ANALOG_TOUCH = { ...FULL_GPIO, analogInput: YES, touch: YES } as const;`);
  }
  if (usedCaps.has('FULL_GPIO_DAC')) {
    lines.push(`const FULL_GPIO_DAC = { ...FULL_GPIO, analogInput: YES, analogOutput: YES } as const;`);
  }
  if (usedCaps.has('INPUT_ONLY')) {
    lines.push(`const INPUT_ONLY = {`);
    lines.push(`  digitalInput: YES, digitalOutput: NO,`);
    lines.push(`  analogInput: YES,  analogOutput: NO,`);
    lines.push(`  pwm: NO,           interrupt: YES,`);
    lines.push(`  pullUp: NO,        pullDown: NO,`);
    lines.push(`  touch: NO,         openDrain: NO,`);
    lines.push(`} as const;`);
  }

  lines.push('');

  // adc/touch helpers
  lines.push(
    `function adc(n: number, ch: number) {`,
    `  return { type: 'adc' as const, instance: n, role: \`ch\${ch}\` };`,
    `}`,
  );
  if (spec.touch) {
    lines.push(
      `function touch(ch: number) {`,
      `  return { type: 'touch' as const, instance: 0, role: \`touch\${ch}\` };`,
      `}`,
    );
  }
  lines.push('');

  // MCU definition
  lines.push(`export const ${archUpper}: MCUDefinition = {`);
  lines.push(`  id: '${spec.mcuId}',`);
  lines.push(`  name: '${spec.mcuName}',`);
  lines.push(`  architecture: '${arch}',`);
  lines.push(`  memory: {`);
  lines.push(`    flash:    ${spec.memory.flash},`);
  lines.push(`    sram:     ${spec.memory.sram},`);
  lines.push(`    eeprom:   ${spec.memory.eeprom},`);
  if (spec.memory.rtcMemory) lines.push(`    rtcMemory: ${spec.memory.rtcMemory},`);
  lines.push(`  },`);

  // pins.all
  lines.push(`  pins: {`);
  lines.push(`    all: [`);
  for (const pin of spec.pins) {
    const parts: string[] = [`number: ${pin.gpio}`, `gpio: ${pin.gpio}`, `name: 'GPIO${pin.gpio}'`, `capabilities: ${pin.capabilities}`];
    if (pin.functions && pin.functions.length > 0) {
      const fns = pin.functions.map(f => {
        if (f.type === 'adc') return `adc(${f.instance}, ${f.role.replace('ch', '')})`;
        if (f.type === 'touch') return `touch(${f.role.replace('touch', '').replace('Touch', '')})`;
        return `{ type: '${f.type}', instance: ${f.instance}, role: '${f.role}' }`;
      }).join(', ');
      parts.push(`functions: [${fns}]`);
    }
    if (pin.alt && pin.alt.length > 0) {
      parts.push(`alternateFunctions: [${pin.alt.map(a => `'${a}'`).join(', ')}]`);
    }
    if (pin.warnings && pin.warnings.length > 0) {
      parts.push(`warnings: [${pin.warnings.map(w => `'${w}'`).join(', ')}]`);
    }
    if (pin.unsafe) parts.push(`unsafe: true`);
    if (pin.notes) parts.push(`notes: '${pin.notes}'`);
    if (pin.onboardLed) parts.push(`onboardLed: true`);
    lines.push(`      { ${parts.join(', ')} },`);
  }
  lines.push(`    ],`);

  // digital/analog/pwm/unsafe arrays
  const allNames = gpioNames(spec);
  lines.push(`    digital: [${allNames.map(n => `'${n}'`).join(', ')}],`);
  lines.push(`    analog: [${spec.analog.map(n => `'${n}'`).join(', ')}],`);
  // pwm = all GPIOs minus the unsafe flash/USB/strap pins at the end (use digital list minus unsafe)
  const unsafeSet = new Set(spec.unsafe);
  const pwmPins = allNames.filter(n => !unsafeSet.has(n) || true); // include all — pwm is permissive
  lines.push(`    pwm: [${pwmPins.map(n => `'${n}'`).join(', ')}],`);
  lines.push(`    unsafe: [${spec.unsafe.map(n => `'${n}'`).join(', ')}],`);

  // bus maps
  const i2cKey = Object.keys(spec.i2c)[0];
  const i2cPins = spec.i2c[i2cKey];
  lines.push(`    i2c:  { ${i2cKey}: { sda: '${i2cPins.sda}', scl: '${i2cPins.scl}' } },`);
  const spiKey = Object.keys(spec.spi)[0];
  const spiPins = spec.spi[spiKey];
  lines.push(`    spi:  { ${spiKey}: { mosi: '${spiPins.mosi}', miso: '${spiPins.miso}', sck: '${spiPins.sck}', cs: '${spiPins.cs}' } },`);
  const uartKey = Object.keys(spec.uart)[0];
  const uartPins = spec.uart[uartKey];
  lines.push(`    uart: { ${uartKey}: { tx: '${uartPins.tx}', rx: '${uartPins.rx}' } },`);
  lines.push(`  },`);

  lines.push(`  peripherals: MCU_PERIPHERALS,`);

  // features
  const f = spec.features;
  lines.push(`  features: {`);
  lines.push(`    multicore: ${f.multicore},`);
  lines.push(`    coreCount: ${f.coreCount},`);
  lines.push(`    deepSleep: ${f.deepSleep},`);
  lines.push(`    watchdog: ${f.watchdog},`);
  lines.push(`    externalInterrupts: ${f.externalInterrupts},`);
  lines.push(`    hardwareRng: ${f.hardwareRng},`);
  lines.push(`    fpu: ${f.fpu},`);
  lines.push(`  },`);
  lines.push(`  build: { extraFlags: [] },`);
  lines.push(`};`);
  lines.push('');

  lines.push(`export default ${archUpper};`);
  lines.push('');
  lines.push(`export * from './pins.js';`);
  lines.push(`export * from './peripherals.js';`);
  lines.push('');

  // TypeCADManifest
  lines.push('/**');
  lines.push(' * Structured manifest consumed by the TypeCAD CLI for contract-based');
  lines.push(' * board generation.');
  lines.push(' */');
  lines.push('export const TypeCADManifest = {');
  lines.push(`  pinNames: [${allNames.map(n => `'${n}'`).join(', ')}] as const,`);
  const periNames: string[] = [];
  spec.peripheralInstances.i2c.forEach((_, i) => periNames.push(`'I2C${i}'`));
  spec.peripheralInstances.spi.forEach((_, i) => periNames.push(`'SPI${i}'`));
  spec.peripheralInstances.uart.forEach((_, i) => periNames.push(`'UART${i}'`));
  lines.push(`  peripheralNames: [${periNames.join(', ')}] as const,`);
  lines.push('} as const;');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Board package generators
// ---------------------------------------------------------------------------

export function genBoardPackageJson(spec: BoardSpec): string {
  const pkg = {
    name: `@typecad/board-${spec.architecture}`,
    version: '0.1.0',
    description: `TypeCAD ${spec.boardName} board definition with typed pins and peripherals`,
    type: 'module',
    main: './dist/index.js',
    types: './dist/index.d.ts',
    exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
    files: ['dist'],
    scripts: { build: 'tsc' },
    dependencies: {
      '@typecad/cuttlefish': '*',
      '@typecad/hal': '*',
      [`@typecad/mcu-${spec.architecture}`]: '*',
    },
    license: 'MIT',
    publishConfig: { access: 'public' },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}

export function genBoardTsconfig(spec: BoardSpec): string {
  return JSON.stringify({
    compilerOptions: {
      composite: true, target: 'ES2021', module: 'Node16', moduleResolution: 'Node16',
      strict: true, esModuleInterop: true, skipLibCheck: true,
      forceConsistentCasingInFileNames: true, declaration: true, declarationMap: true,
      sourceMap: true, rootDir: 'src', outDir: 'dist',
      experimentalDecorators: true, emitDecoratorMetadata: true,
    },
    include: ['src/**/*.ts'],
    references: [
      { path: '../../packages/hal' }, { path: '../../packages/cuttlefish' }, { path: `../../mcus/mcu-${spec.architecture}` },
    ],
  }, null, 2) + '\n';
}

export function genBoardAnalog(_spec: BoardSpec): string {
  return [
    '// ---------------------------------------------------------------------------',
    `// @typecad/board-${_spec.architecture} — Analog constants`,
    '// ---------------------------------------------------------------------------',
    '',
    '/** Default reference (3.3V). */',
    'export const DEFAULT = 0;',
    '/** Internal 1.1V reference. */',
    'export const INTERNAL = 3;',
    '',
  ].join('\n');
}

export function genBoardPins(spec: BoardSpec): string {
  const arch = spec.architecture;
  // Dx aliases: GPIO in range, excluding unsafe flash pins (those at the end
  // whose alt names start with "SPI"). We include all non-flash GPIOs.
  const unsafeFlashPins = new Set(
    spec.pins.filter(p => p.unsafe && p.alt?.some(a => a.startsWith('SPI'))).map(p => p.gpio)
  );
  const dPins = gpioList(spec).filter(n => !unsafeFlashPins.has(n));

  // Ax aliases: from spec.analog (ADC1 only)
  const aPins = spec.analog.map(name => parseInt(name.replace('GPIO', ''), 10));

  // Bus instance counts
  const i2cCount = spec.peripheralInstances.i2c.length;
  const spiCount = spec.peripheralInstances.spi.length;
  const uartCount = spec.peripheralInstances.uart.length;
  const i2cNames = Array.from({ length: i2cCount }, (_, i) => `I2C${i}`).join(', ');
  const spiNames = Array.from({ length: spiCount }, (_, i) => `SPI${i}`).join(', ');
  const uartNames = Array.from({ length: uartCount }, (_, i) => `UART${i}`).join(', ');

  const lines: string[] = [
    `// ---------------------------------------------------------------------------`,
    `// @typecad/board-${arch} — Pin aliases`,
    `// ---------------------------------------------------------------------------`,
    '',
  ];

  // Import GPIO constants from MCU (only the ones we alias)
  const allImportedGpio = Array.from(new Set([...dPins, ...aPins])).sort((a, b) => a - b);
  const importList = allImportedGpio.map(n => `GPIO${n}`).join(', ');
  lines.push(`import {`);
  lines.push(`  ${importList},`);
  lines.push(`} from '@typecad/mcu-${arch}';`);
  lines.push('');

  // Dx aliases
  lines.push(`// Arduino-style digital pin aliases (D-numbers match GPIO numbers)`);
  for (const n of dPins) {
    lines.push(`export const D${n} = GPIO${n};`);
  }
  lines.push('');

  // Ax aliases
  lines.push(`// Analog input aliases (ADC1 channels — usable while Wi-Fi is active).`);
  aPins.forEach((n, i) => {
    lines.push(`export const A${i} = GPIO${n};`);
  });
  lines.push('');

  // Bus re-exports
  lines.push(`// Bus aliases (default pins for I2C0 / SPI0 / UART0)`);
  lines.push(`export { ${i2cNames}, ${spiNames}, ${uartNames} } from '@typecad/mcu-${arch}';`);
  lines.push('');

  return lines.join('\n');
}

export function genBoardIndex(spec: BoardSpec): string {
  const arch = spec.architecture;
  const archUpper = arch.toUpperCase();
  const boardName = spec.boardName;
  const desc = spec.description || `${spec.mcuName} generic devboard`;

  // Dx pins (non-flash)
  const unsafeFlashPins = new Set(
    spec.pins.filter(p => p.unsafe && p.alt?.some(a => a.startsWith('SPI'))).map(p => p.gpio)
  );
  const dPins = gpioList(spec).filter(n => !unsafeFlashPins.has(n));

  // Analog GPIOs
  const aGpios = spec.analog.map(name => `GPIO${parseInt(name.replace('GPIO', ''), 10)}`);

  const lines: string[] = [
    `// ---------------------------------------------------------------------------`,
    `// @typecad/board-${arch} — Board definition manifest`,
    `// ---------------------------------------------------------------------------`,
    '',
    `import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';`,
    `import { ${archUpper} } from '@typecad/mcu-${arch}';`,
    '',
    `const ARDUINO_CORE_VERSION = '10819';`,
    '',
    `export const ${archUpper}Board: BoardDefinition = {`,
    `  id: '${spec.boardId}',`,
    `  name: '${boardName}',`,
    `  vendor: '${spec.vendor}',`,
    `  description: '${desc.replace(/'/g, "\\'")}',`,
    '',
    `  mcu: ${archUpper},`,
    `  clockSpeed: ${spec.clockSpeed},`,
    '',
  ];

  // Memory
  lines.push(`  memory: {`);
  if (spec.moduleFlash) lines.push(`    flash: ${spec.moduleFlash},`);
  if (spec.externalRam) lines.push(`    externalRam: ${spec.externalRam},`);
  lines.push(`  },`);
  lines.push('');

  // Pins (spread MCU, no led for generic boards)
  lines.push(`  pins: {`);
  lines.push(`    ...${archUpper}.pins,`);
  lines.push(`  },`);
  lines.push('');

  // Peripherals with aliases
  const i2cCount = spec.peripheralInstances.i2c.length;
  const spiCount = spec.peripheralInstances.spi.length;
  const uartCount = spec.peripheralInstances.uart.length;
  lines.push(`  peripherals: {`);
  lines.push(`    ...${archUpper}.peripherals,`);
  lines.push(`    aliases: {`);
  const aliasEntries: string[] = [];
  for (let i = 0; i < uartCount; i++) aliasEntries.push(`UART${i}: 'Serial${i === 0 ? '' : i + 1}'`);
  for (let i = 0; i < i2cCount; i++) aliasEntries.push(`I2C${i}: 'Wire${i === 0 ? '' : i + 1}'`);
  for (let i = 0; i < spiCount; i++) aliasEntries.push(`SPI${i}: 'SPI${i === 0 ? '' : i + 1}'`);
  lines.push(`      ${aliasEntries.join(', ')},`);
  lines.push(`    },`);
  lines.push(`  },`);
  lines.push('');

  // Build config
  lines.push(`  build: {`);
  lines.push(`    frameworks: {`);
  lines.push(`      arduino: '${spec.fqbn}',`);
  lines.push(`    },`);
  lines.push(`    defines: {`);
  lines.push(`      F_CPU: '${spec.clockSpeed}UL',`);
  lines.push(`      ARDUINO: ARDUINO_CORE_VERSION,`);
  lines.push(`      ${spec.arduinoDefine}: '1',`);
  lines.push(`    },`);
  lines.push(`  },`);
  lines.push(`};`);
  lines.push('');

  lines.push(`export default ${archUpper}Board;`);
  lines.push('');
  lines.push(`export * from '@typecad/mcu-${arch}';`);
  lines.push('');

  // HAL re-exports
  lines.push(`export {`);
  lines.push(`  HIGH, LOW, INPUT, OUTPUT, INPUT_PULLUP,`);
  lines.push(`  delay, millis, micros, delayMicroseconds,`);
  lines.push(`  map, constrain,`);
  lines.push(`  abs, min, max, Num,`);
  lines.push(`  pulseIn, pulseInLong, Pulse,`);
  lines.push(`  shiftIn, shiftOut, Shift,`);
  lines.push(`  randomSeed, random, Random,`);
  lines.push(`  noInterrupts, interrupts, attachInterrupt, detachInterrupt,`);
  lines.push(`  ADC, AsyncClass, Async`);
  lines.push(`} from '@typecad/hal';`);
  lines.push('');

  // Discovery arrays — import GPIO constants
  const discoveryGpio = dPins.map(n => `GPIO${n}`).join(', ');
  const analogGpio = aGpios.join(', ');
  lines.push(`import {`);
  lines.push(`  ${discoveryGpio},`);
  lines.push(`} from '@typecad/mcu-${arch}';`);
  lines.push('');

  lines.push(`export const pins = {`);
  lines.push(`  pwm: [${discoveryGpio}] as const,`);
  lines.push(`  analog: [${analogGpio}] as const,`);
  lines.push(`  interrupt: [${discoveryGpio}] as const,`);
  lines.push(`  digital: [${discoveryGpio}] as const,`);
  lines.push(`} as const;`);
  lines.push('');

  // PeripheralPins
  lines.push(`export const PeripheralPins = {`);
  const i2cKey = Object.keys(spec.i2c)[0];
  const i2cPins = spec.i2c[i2cKey];
  lines.push(`  I2C0: { SDA: '${i2cPins.sda}', SCL: '${i2cPins.scl}' } as const,`);
  const spiKey = Object.keys(spec.spi)[0];
  const spiPins = spec.spi[spiKey];
  lines.push(`  SPI0: { MOSI: '${spiPins.mosi}', MISO: '${spiPins.miso}', SCK: '${spiPins.sck}', CS: '${spiPins.cs}' } as const,`);
  const uartKey = Object.keys(spec.uart)[0];
  const uartPins = spec.uart[uartKey];
  lines.push(`  UART0: { TX: '${uartPins.tx}', RX: '${uartPins.rx}' } as const,`);
  if (uartCount > 1) {
    lines.push(`  UART1: { TX: 'remappable', RX: 'remappable' } as const,`);
  }
  lines.push(`} as const;`);
  lines.push('');

  lines.push(`export * from './pins.js';`);
  lines.push(`export * from './analog.js';`);
  lines.push(`export { Board } from './board.js';`);
  lines.push('');

  return lines.join('\n');
}

export function genBoardNamespace(spec: BoardSpec): string {
  const arch = spec.architecture;
  const archUpper = arch.toUpperCase();

  // Dx pins (non-flash)
  const unsafeFlashPins = new Set(
    spec.pins.filter(p => p.unsafe && p.alt?.some(a => a.startsWith('SPI'))).map(p => p.gpio)
  );
  const dPins = gpioList(spec).filter(n => !unsafeFlashPins.has(n));
  const aCount = spec.analog.length;

  const dNames = dPins.map(n => `D${n}`);
  const aNames = Array.from({ length: aCount }, (_, i) => `A${i}`);

  const i2cCount = spec.peripheralInstances.i2c.length;
  const spiCount = spec.peripheralInstances.spi.length;
  const uartCount = spec.peripheralInstances.uart.length;
  const periNames: string[] = [];
  for (let i = 0; i < i2cCount; i++) periNames.push(`I2C${i}`);
  for (let i = 0; i < spiCount; i++) periNames.push(`SPI${i}`);
  for (let i = 0; i < uartCount; i++) periNames.push(`UART${i}`);

  const lines: string[] = [
    `// ---------------------------------------------------------------------------`,
    `// @typecad/board-${arch} — Board namespace`,
    `// ---------------------------------------------------------------------------`,
    '',
    `import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';`,
    '',
    `import {`,
    `  ${dNames.join(', ')},`,
    `  ${aNames.join(', ')},`,
    `} from './pins.js';`,
    '',
    `import { ${periNames.join(', ')} } from '@typecad/mcu-${arch}';`,
    `import { ${archUpper}Board } from './index.js';`,
    '',
    `export const Board = {`,
    `  definition: ${archUpper}Board,`,
    '',
    `  ${dNames.join(', ')},`,
    `  ${aNames.join(', ')},`,
    '',
    `  ${periNames.join(', ')},`,
    '',
    `  digital: { ${dNames.join(', ')} },`,
    `  analog:  { ${aNames.join(', ')} },`,
    `};`,
    '',
    `export default Board;`,
    '',
  ];

  return lines.join('\n');
}

