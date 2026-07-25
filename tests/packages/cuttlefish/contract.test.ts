// Tests for the contract reader — the typecad.net → cuttlefish interop seam.
//
// The contract parser, matcher, and board generator were restored from a
// deleted implementation (commit 0a6793ad) and updated for the current
// HwContract shape (version 1, optional boardName, availablePeripherals).
//
// Fixture is modeled on the real pro_mini.contract.json emitted by typecad.net
// (typeCAD/demo/hw/build/pro_mini.contract.json) — an ATmega328 design that
// includes VCC/GND/XTAL pins which must be excluded from the narrowed set.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseContractFile,
  matchConnectedPins,
  selectPeripherals,
  HwContractSchema,
  type HwContract,
} from '../../../packages/cuttlefish/src/contract/contract-parser';
import { generateBoardFile, CUTTLEFISH_DIR } from '../../../packages/cuttlefish/src/contract/board-generator';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dirPath of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
});

/** ATmega328P TypeCADManifest, mirroring @typecad/mcu-atmega328p/src/index.ts. */
const ATMEGA328P_MANIFEST = {
  pinNames: [
    'PD0', 'PD1', 'PD2', 'PD3', 'PD4', 'PD5', 'PD6', 'PD7',
    'PB0', 'PB1', 'PB2', 'PB3', 'PB4', 'PB5', 'PB6', 'PB7',
    'PC0', 'PC1', 'PC2', 'PC3', 'PC4', 'PC5', 'PC6',
  ],
  peripheralNames: ['I2C0', 'SPI0', 'UART0'],
} as const;

/** A realistic contract with power pins, a compound KiCAD name, and a boardName. */
function makeProMiniContract(overrides: Partial<HwContract> = {}): HwContract {
  return {
    version: 1,
    mcu: {
      symbol: 'MCU_Microchip_ATmega:ATmega328-MM',
      reference: 'U1',
      value: '',
      footprint: 'Package_DFN_QFN:QFN-28-1EP_4x4mm_P0.45mm_EP2.4x2.4mm',
      mpn: '',
      datasheet: '',
      description: '',
    },
    connectedPins: {
      '1': { pinName: 'VCC', pinType: 'power_in', net: 'VCC', externalComponents: [] },          // power → excluded
      '2': { pinName: 'GND', pinType: 'power_in', net: 'GND', externalComponents: [] },          // power → excluded
      '3': { pinName: 'PD0', pinType: 'bidirectional', net: 'net_uart_tx', externalComponents: [] }, // GPIO
      '5': { pinName: 'XTAL1/PB6', pinType: 'bidirectional', net: 'net_xtal', externalComponents: [] }, // compound → PB6
      '9': { pinName: 'PB5', pinType: 'bidirectional', boardName: 'D13', net: 'net_led', externalComponents: [] }, // boardName not in manifest → fallback to PB5
      '11': { pinName: 'PC4', pinType: 'bidirectional', boardName: 'A4', net: 'net_sda', externalComponents: [] }, // boardName not in manifest → fallback to PC4
    },
    availablePeripherals: { i2c: true, spi: false, uart: true },
    ...overrides,
  };
}

describe('parseContractFile', () => {
  it('parses a valid v1 contract', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-'));
    tempDirs.push(dir);
    const contractPath = path.join(dir, 'board.contract.json');
    const contract = makeProMiniContract();
    fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2));

    const parsed = parseContractFile(contractPath);
    expect(parsed.version).toBe(1);
    expect(parsed.connectedPins['3'].pinName).toBe('PD0');
    expect(parsed.availablePeripherals.uart).toBe(true);
  });

  it('throws on an unsupported version (fast path, before schema validation)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-'));
    tempDirs.push(dir);
    const contractPath = path.join(dir, 'board.contract.json');
    fs.writeFileSync(contractPath, JSON.stringify({ version: 99, connectedPins: {} }));

    expect(() => parseContractFile(contractPath)).toThrow(/Unsupported contract version/);
  });

  it('throws a schema error on a missing connectedPins (path-annotated)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-'));
    tempDirs.push(dir);
    const contractPath = path.join(dir, 'board.contract.json');
    fs.writeFileSync(contractPath, JSON.stringify({ version: 1, mcu: { symbol: 'X' }, availablePeripherals: { i2c: false, spi: false, uart: false } }));

    // zod reports missing required fields with a path; the formatter surfaces it readably.
    expect(() => parseContractFile(contractPath)).toThrow(/failed validation/);
    expect(() => parseContractFile(contractPath)).toThrow(/connectedPins/);
  });

  it('throws on an unreadable file', () => {
    expect(() => parseContractFile(path.join(os.tmpdir(), 'definitely-missing.contract.json'))).toThrow(
      /Could not read contract file/,
    );
  });

  it('rejects a malformed availablePeripherals with a precise message', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-'));
    tempDirs.push(dir);
    const contractPath = path.join(dir, 'board.contract.json');
    // i2c is a string instead of a boolean — exactly the silent-failure case zod catches.
    const malformed = {
      version: 1,
      mcu: { symbol: 'X' },
      connectedPins: {},
      availablePeripherals: { i2c: 'yes', spi: false, uart: false },
    };
    fs.writeFileSync(contractPath, JSON.stringify(malformed));

    expect(() => parseContractFile(contractPath)).toThrow(/availablePeripherals\.i2c/);
    expect(() => parseContractFile(contractPath)).toThrow(/expected boolean, received string/i);
  });

  it('rejects an unknown top-level key (.strict() → forward-incompat detection)', () => {
    // A future v2 contract adding a top-level field is rejected clearly rather
    // than silently dropped. This complements the version check.
    const result = HwContractSchema.safeParse({
      version: 1,
      mcu: { symbol: 'X' },
      connectedPins: {},
      availablePeripherals: { i2c: false, spi: false, uart: false },
      futureField: 'something',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a contract whose externalComponents carry unknown fields (forward-compat)', () => {
    // typecad.net may add component metadata (voltage, wattage, tolerance, ...).
    // The component schema is .passthrough() so cuttlefish stays forward-compatible
    // without a release for every new component field.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-'));
    tempDirs.push(dir);
    const contractPath = path.join(dir, 'board.contract.json');
    const contract = {
      version: 1,
      mcu: { symbol: 'X' },
      connectedPins: {
        '1': {
          pinName: 'PB5',
          pinType: 'bidirectional',
          net: 'net_led',
          externalComponents: [
            { reference: 'D1', dnp: false, voltage: '2.1V', forwardCurrent: '20mA' },
          ],
        },
      },
      availablePeripherals: { i2c: false, spi: false, uart: false },
    };
    fs.writeFileSync(contractPath, JSON.stringify(contract));

    const parsed = parseContractFile(contractPath);
    expect(parsed.connectedPins['1'].externalComponents[0].reference).toBe('D1');
  });

  it('accepts a contract whose mcu carries extra identifying fields (forward-compat)', () => {
    // The mcu block is .passthrough() — only `symbol` is load-bearing for cuttlefish.
    const contract = {
      version: 1,
      mcu: { symbol: 'X', reference: 'U1', footprint: 'QFN-28', mpn: 'ATmega328P-MU' },
      connectedPins: {},
      availablePeripherals: { i2c: false, spi: false, uart: false },
    };
    expect(() => HwContractSchema.parse(contract)).not.toThrow();
  });
});

describe('matchConnectedPins', () => {
  it('excludes power and ground pins', () => {
    const matched = matchConnectedPins(makeProMiniContract(), ATMEGA328P_MANIFEST.pinNames);
    expect(matched).not.toContain('VCC');
    // GND is not a port name anyway, but VCC-as-pin is excluded by pinType=power_in.
  });

  it('matches simple port names directly', () => {
    const matched = matchConnectedPins(makeProMiniContract(), ATMEGA328P_MANIFEST.pinNames);
    expect(matched).toContain('PD0'); // pinName "PD0" exact match
  });

  it('extracts the port name from a compound KiCAD name (XTAL1/PB6 → PB6)', () => {
    const matched = matchConnectedPins(makeProMiniContract(), ATMEGA328P_MANIFEST.pinNames);
    expect(matched).toContain('PB6');
  });

  it('falls back to substring when boardName is not an MCU pin (D13 not in pinNames → PB5)', () => {
    const matched = matchConnectedPins(makeProMiniContract(), ATMEGA328P_MANIFEST.pinNames);
    // boardName "D13" is a board alias, not an MCU port; falls back to pinName "PB5".
    expect(matched).toContain('PB5');
    expect(matched).not.toContain('D13');
  });

  it('uses boardName when it IS an MCU pin name', () => {
    // Construct a contract whose boardName is a valid MCU port (simulating a
    // typehal map keyed by port name rather than board alias).
    const contract: HwContract = {
      version: 1,
      mcu: makeProMiniContract().mcu,
      connectedPins: {
        '9': { pinName: 'PB5', pinType: 'bidirectional', boardName: 'PB5', net: 'net_led', externalComponents: [] },
      },
      availablePeripherals: { i2c: false, spi: false, uart: false },
    };
    const matched = matchConnectedPins(contract, ATMEGA328P_MANIFEST.pinNames);
    expect(matched).toEqual(['PB5']);
  });

  it('de-duplicates matched pins', () => {
    const contract: HwContract = {
      version: 1,
      mcu: makeProMiniContract().mcu,
      connectedPins: {
        '1': { pinName: 'PB5', pinType: 'bidirectional', net: 'net_a', externalComponents: [] },
        '2': { pinName: 'PB5', pinType: 'bidirectional', net: 'net_a', externalComponents: [] },
      },
      availablePeripherals: { i2c: false, spi: false, uart: false },
    };
    const matched = matchConnectedPins(contract, ATMEGA328P_MANIFEST.pinNames);
    expect(matched).toEqual(['PB5']);
  });
});

describe('selectPeripherals', () => {
  it('keeps only peripherals flagged true in availablePeripherals', () => {
    const contract = makeProMiniContract(); // i2c: true, spi: false, uart: true
    const selected = selectPeripherals(contract, ATMEGA328P_MANIFEST.peripheralNames);
    expect(selected).toContain('I2C0');
    expect(selected).toContain('UART0');
    expect(selected).not.toContain('SPI0');
  });

  it('drops all peripherals when none are available', () => {
    const contract = makeProMiniContract({ availablePeripherals: { i2c: false, spi: false, uart: false } });
    const selected = selectPeripherals(contract, ATMEGA328P_MANIFEST.peripheralNames);
    expect(selected).toEqual([]);
  });

  it('preserves unknown peripheral families (does not silently drop)', () => {
    const contract = makeProMiniContract();
    const selected = selectPeripherals(contract, ['I2C0', 'WDT0', 'TIMER1']);
    expect(selected).toContain('WDT0');
    expect(selected).toContain('TIMER1');
  });
});

describe('generateBoardFile', () => {
  it('writes a narrowed board.ts to .cuttlefish/ with matched pins and selected peripherals', () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-'));
    tempDirs.push(projectDir);

    const outPath = generateBoardFile({
      projectDir,
      mcuPackage: '@typecad/mcu-atmega328p',
      connectedPins: ['PD0', 'PB5', 'PB6', 'PC4'],
      peripherals: ['I2C0', 'UART0'],
    });

    expect(outPath).toBe(path.join(projectDir, CUTTLEFISH_DIR, 'board.ts'));
    const content = fs.readFileSync(outPath, 'utf-8');

    // HAL surface re-exported in full.
    expect(content).toContain("export * from '@typecad/hal';");
    // Narrowed pins re-exported from the MCU package.
    expect(content).toContain("export { PD0, PB5, PB6, PC4 } from '@typecad/mcu-atmega328p';");
    // Selected peripherals re-exported; SPI0 absent because the contract said spi:false.
    expect(content).toContain('I2C0');
    expect(content).toContain('UART0');
    expect(content).not.toContain('SPI0');
    // Auto-generated header so users don't hand-edit.
    expect(content).toContain('Auto-generated');
  });

  it('omits the peripherals block when none are selected', () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-'));
    tempDirs.push(projectDir);

    generateBoardFile({
      projectDir,
      mcuPackage: '@typecad/mcu-atmega328p',
      connectedPins: ['PB5'],
      peripherals: [],
    });

    const content = fs.readFileSync(path.join(projectDir, CUTTLEFISH_DIR, 'board.ts'), 'utf-8');
    expect(content).not.toContain('Narrowed peripheral set');
  });

  it('handles an empty connected-pins set', () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-'));
    tempDirs.push(projectDir);

    generateBoardFile({
      projectDir,
      mcuPackage: '@typecad/mcu-atmega328p',
      connectedPins: [],
      peripherals: [],
    });

    const content = fs.readFileSync(path.join(projectDir, CUTTLEFISH_DIR, 'board.ts'), 'utf-8');
    // Still re-exports the HAL surface even with no matched pins.
    expect(content).toContain("export * from '@typecad/hal';");
    expect(content).not.toContain('export {');
  });
});
