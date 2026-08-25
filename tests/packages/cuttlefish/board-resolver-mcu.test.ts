// MCU-package board-constants resolution — the MCU-only path (a config with
// `mcu:` and no `board:`). tryResolveBoardDefFile() must accept @typecad/mcu-*
// specifiers and resolve the silicon definition (src/mcu.ts when present,
// else src/index.ts), and resolveBoardConstants() must load pins.all.* AND
// merge the sibling peripherals.ts — the merge board files get via
// mergeMCUConstants, which nothing triggers when the MCU file is resolved
// directly. Without these, MCU-only projects transpile "successfully" but
// every pin method call passes through untranslated (broken C++).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  tryResolveBoardDefFile,
  resolveBoardConstants,
} from '../../../packages/cuttlefish/src/ir/board-resolver';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cf-mcu-resolver-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Write a fake MCU package + an importing user file, and return the user file path. */
function writeMcuPackage(
  style: 'mcu-ts' | 'index-ts',
  files: Record<string, string> = {},
): { userFile: string } {
  const pkgDir = join(tmp, 'node_modules', '@typecad', `mcu-fake-${style}`);
  const srcDir = join(pkgDir, 'src');
  mkdirSync(srcDir, { recursive: true });

  if (style === 'mcu-ts') {
    // atmega-style: the definition lives in mcu.ts; index.ts is a barrel.
    writeFileSync(
      join(srcDir, 'mcu.ts'),
      [
        "import type { MCUDefinition } from '@typecad/cuttlefish/api/schema';",
        "import { MCU_PERIPHERALS } from './peripherals.js';",
        'export const FAKE: MCUDefinition = {',
        "  id: 'fake',",
        "  name: 'Fake',",
        "  architecture: 'avr',",
        '  memory: { flash: 32768, sram: 2048, eeprom: 1024 },',
        '  pins: { all: [',
        "    { number: 0, gpio: 0, name: 'PD0' },",
        "    { number: 13, gpio: 13, name: 'PB5' },",
        '  ] },',
        '  peripherals: MCU_PERIPHERALS,',
        '  features: { multicore: false },',
        '  build: { extraFlags: [] },',
        ...(files['mcu.ts'] ? [files['mcu.ts']] : []),
        '};',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(srcDir, 'index.ts'),
      "export * from './mcu.js';\nexport * from './peripherals.js';\nexport * from './pins.js';\n",
    );
  } else {
    // esp32-style: the definition is inline in index.ts.
    writeFileSync(
      join(srcDir, 'index.ts'),
      [
        "import type { MCUDefinition } from '@typecad/cuttlefish/api/schema';",
        'export const FAKE: MCUDefinition = {',
        "  id: 'fake2',",
        "  name: 'Fake2',",
        "  architecture: 'esp32',",
        '  memory: { flash: 4194304, sram: 532480, eeprom: 0 },',
        '  pins: { all: [',
        "    { number: 2, gpio: 2, name: 'GPIO2' },",
        '  ] },',
        '  peripherals: {},',
        '  features: { multicore: false },',
        '  build: { extraFlags: [] },',
        ...(files['index.ts'] ? [files['index.ts']] : []),
        '};',
        '',
      ].join('\n'),
    );
  }

  writeFileSync(
    join(srcDir, 'peripherals.ts'),
    [
      'export const MCU_PERIPHERALS = {',
      '  i2c: { count: 1 },',
      '  uart: { count: 1 },',
      '};',
      '',
      'export const ADC_INSTANCES = [',
      "  { resolution: 10 }",
      '];',
      '',
    ].join('\n'),
  );
  const projDir = join(tmp, 'proj');
  mkdirSync(projDir, { recursive: true });
  const userFile = join(projDir, 'main.ts');
  writeFileSync(userFile, "import { PD0 } from '@typecad/board';\n");
  return { userFile };
}

describe('tryResolveBoardDefFile — @typecad/mcu-* specifiers', () => {
  it('resolves an MCU package with its definition in src/mcu.ts (barrel index)', () => {
    const { userFile } = writeMcuPackage('mcu-ts');
    const resolved = tryResolveBoardDefFile(userFile, '@typecad/mcu-fake-mcu-ts');
    expect(resolved).toBeDefined();
    expect(resolved!.replace(/\\/g, '/')).toMatch(/mcu-fake-mcu-ts\/src\/mcu\.ts$/);
  });

  it('resolves an MCU package with its definition inline in src/index.ts', () => {
    const { userFile } = writeMcuPackage('index-ts');
    const resolved = tryResolveBoardDefFile(userFile, '@typecad/mcu-fake-index-ts');
    expect(resolved).toBeDefined();
    expect(resolved!.replace(/\\/g, '/')).toMatch(/mcu-fake-index-ts\/src\/index\.ts$/);
  });

  it('rewrites the @typecad/board virtual import to the MCU package', () => {
    const { userFile } = writeMcuPackage('mcu-ts');
    const resolved = tryResolveBoardDefFile(userFile, '@typecad/board', '@typecad/mcu-fake-mcu-ts');
    expect(resolved).toBeDefined();
    expect(resolved!.replace(/\\/g, '/')).toMatch(/mcu-fake-mcu-ts\/src\/mcu\.ts$/);
  });

  it('still returns undefined for unknown non-board non-mcu packages', () => {
    const { userFile } = writeMcuPackage('mcu-ts');
    expect(tryResolveBoardDefFile(userFile, '@typecad/something-else')).toBeUndefined();
  });
});

describe('resolveBoardConstants — directly on an MCU definition file', () => {
  it('loads pins.all.* and merges the sibling peripherals.ts (mcu.ts style)', () => {
    const { userFile } = writeMcuPackage('mcu-ts');
    const defFile = tryResolveBoardDefFile(userFile, '@typecad/mcu-fake-mcu-ts')!;
    const constants = resolveBoardConstants(defFile);

    // Pin identity — what pin lowering (mcuPinForwardMap) consumes.
    expect(constants.get('pins.all.0.name')).toBe('PD0');
    expect(constants.get('pins.all.0.number')).toBe(0);
    expect(constants.get('pins.all.1.name')).toBe('PB5');
    expect(constants.get('pins.all.1.number')).toBe(13);

    // The sibling peripherals.ts merge. Peripheral data arrives via the
    // *_INSTANCES array special-case (the MCU_PERIPHERALS object itself is
    // identifier-referenced from the definition — unparseable, same as the
    // board-file path).
    expect(constants.get('peripherals.adc.0.resolution')).toBe(10);

    // MCU identity.
    expect(constants.get('architecture')).toBe('avr');
  });

  it('loads pins from an inline index.ts definition too', () => {
    const { userFile } = writeMcuPackage('index-ts');
    const defFile = tryResolveBoardDefFile(userFile, '@typecad/mcu-fake-index-ts')!;
    const constants = resolveBoardConstants(defFile);
    expect(constants.get('pins.all.0.name')).toBe('GPIO2');
    expect(constants.get('pins.all.0.number')).toBe(2);
  });

  it('flattens a silicon zephyr block (socs as CSV, nested objects indexed)', () => {
    const { userFile } = writeMcuPackage('mcu-ts', {
      'mcu.ts': [
        '  zephyr: {',
        "    socs: ['fake41'],",
        '    console: { nodeLabel: "usart1", speed: 115200 },',
        '    gpioControllers: [',
        "      { nodelabel: 'gpioa', minPin: 0, maxPin: 15 },",
        '    ],',
        '  },',
      ].join('\n'),
    });
    const defFile = tryResolveBoardDefFile(userFile, '@typecad/mcu-fake-mcu-ts')!;
    const constants = resolveBoardConstants(defFile);
    expect(constants.get('zephyr.socs')).toBe('fake41');
    expect(constants.get('zephyr.console.nodeLabel')).toBe('usart1');
    expect(constants.get('zephyr.console.speed')).toBe(115200);
    expect(constants.get('zephyr.gpioControllers.0.nodelabel')).toBe('gpioa');
    expect(constants.get('zephyr.gpioControllers.0.maxPin')).toBe(15);
  });
});

describe('real MCU packages resolve (regression)', () => {
  it('mcu-atmega328p (mcu.ts style): PB5 → Arduino 13', () => {
    const constants = resolveBoardConstants('mcus/mcu-atmega328p/src/mcu.ts');
    const count = [...constants.keys()].filter((k) => /^pins\.all\.\d+\.name$/.test(k)).length;
    // PD0–PD7 + PB0–PB5 + PC0–PC5 = 20 ports.
    expect(count).toBe(20);
    for (let i = 0; i < count; i++) {
      if (constants.get(`pins.all.${i}.name`) === 'PB5') {
        expect(constants.get(`pins.all.${i}.number`)).toBe(13);
      }
    }
  });

  it('mcu-stm32f411 (index.ts style): silicon zephyr block loads', () => {
    const constants = resolveBoardConstants('mcus/mcu-stm32f411/src/index.ts');
    expect(constants.get('zephyr.socs')).toBe('stm32f411xe');
    expect(constants.get('zephyr.console.nodeLabel')).toBe('usart1');
    expect(constants.get('pins.all.0.name')).toBe('PA0');
  });
});
