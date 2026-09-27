// Contract-based MCU-only configs on Zephyr — the typecad.net contract flow
// is MCU-only by schema design (board and contract are mutually exclusive),
// so a contract PCB with no typecad board package programs bare silicon via
// the same machinery: the narrowed .typecad-hal/board.ts + pin constants from
// the MCU package + the generated out-of-tree Zephyr board.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateContractBoard } from '../../../packages/cuttlefish/src/contract/board-generator';
import { parseContractFile } from '../../../packages/cuttlefish/src/contract/contract-parser';
import { parseConfigFile } from '../../../packages/cuttlefish/src/config-loader';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cf-contract-mcu-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const CONTRACT = {
  version: 1,
  mcu: { symbol: 'STM32F411CEU6' },
  connectedPins: {
    '1': { pinName: 'PA5', pinType: 'bidirectional', net: 'net_led', externalComponents: [] },
    '2': { pinName: 'PA0', pinType: 'bidirectional', net: 'net_btn', externalComponents: [] },
  },
  availablePeripherals: { i2c: false, spi: false, uart: true },
};

function writeProject(files: Record<string, unknown>): string {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(tmp, rel);
    if (typeof content === 'string') {
      writeFileSync(full, content);
    } else {
      writeFileSync(full, JSON.stringify(content));
    }
  }
  return tmp;
}

describe('contract MCU-only config with a generated Zephyr board', () => {
  it('parses contract + mcu + zephyr.customBoard (contract forbids board, not mcu)', () => {
    writeProject({
      'board.contract.json': CONTRACT,
      'typecad-hal.config.ts': [
        "import type { TypecadConfig } from '@typecad/cuttlefish/api';",
        'const config: TypecadConfig = {',
        "  entry: './src/main.ts',",
        "  ",
        "  soc: 'stm32f411xe',",
        "  contract: './board.contract.json',",
        "  framework: '@typecad/framework-zephyr',",
        "  storageKb: 512,",
        "  frameworkData: { buildTarget: 'my_pcb' },",
        '  zephyr: { customBoard: true },',
        '};',
        'export default config;',
        '',
      ].join('\n'),
    });

    const config = parseConfigFile(join(tmp, 'typecad-hal.config.ts'));
    expect(config).toBeDefined();
    expect(config!.soc).toBe('stm32f411xe');
    expect(config!.board).toBeUndefined();
    expect(config!.contract).toBe('./board.contract.json');
    expect(config!.buildTarget).toBe('my_pcb');
    expect(config!.storageKb).toBe(512);
    expect((config!.zephyrConfig as Record<string, unknown>).customBoard).toBe(true);
  });

  it('generates the narrowed board.ts from the contract + soc descriptor', async () => {
    writeProject({ 'board.contract.json': CONTRACT });

    const contract = parseContractFile(join(tmp, 'board.contract.json'));
    void contract;
    const { generateBoardFile } = await import('../../../packages/cuttlefish/src/contract/board-generator');
    const boardPath = generateBoardFile({
      projectDir: tmp,
      soc: 'stm32f411xe',
      connectedPins: ['PA5', 'PA0'],
      peripherals: ['UART0'],
      gatedExports: ['UART', 'Store', 'File'],
    });

    expect(existsSync(boardPath)).toBe(true);
    const board = readFileSync(boardPath, 'utf8');
    // Only the wired pins are exposed; unwired silicon is a compile error.
    expect(board).toContain("export const PA5 = Pin.fromPort('PA5');");
    expect(board).toContain("export const PA0 = Pin.fromPort('PA0');");
    expect(board).not.toContain('PC13');
    expect(board).toContain("export const UART0 = new UART('UART0');");
    // The gated hardware classes ride along — a contract board without them
    // cannot even name its own peripherals' classes or the persistent Store.
    expect(board).toContain("export { UART, Store, File } from '@typecad/hal/core';");
    // HAL imports so `import { Time } from '@typecad/hal'` resolves.
    expect(board).toContain("import { Pin, I2CBus, SPIBus, UART } from '@typecad/hal/core';");
    // Gates the board's facts did NOT support are named in the file — silent
    // absence is what forces users to shim around a gate they never heard of.
    expect(board).toContain('NOT available on this board');
    const withheldLine = board.split('\n').find((l) => l.startsWith('//   ')) ?? '';
    expect(withheldLine).toContain('ADC');
    expect(withheldLine).toContain('DAC');
    expect(withheldLine).toContain('Watchdog');
    expect(withheldLine).not.toContain('Store');
    expect(withheldLine).not.toContain('File');
  });

  it('layers the strategy-resolved gated exports + storage facts onto the contract board', async () => {
    writeProject({ 'board.contract.json': CONTRACT });
    const zephyrBase = process.env.ZEPHYR_BASE ?? 'C:/Users/justi/zephyrproject/zephyr';
    let hasTree = false;
    try {
      hasTree = existsSync(join(zephyrBase, 'dts'));
    } catch {
      hasTree = false;
    }
    if (!hasTree) {
      console.warn('skipping (no Zephyr tree at', zephyrBase, ')');
      return;
    }
    const { generateBoardModuleFromContract } = await import('../../../packages/framework-zephyr/src/boardgen');
    const generated = generateBoardModuleFromContract({
      soc: 'esp32s3',
      zephyrBase,
      pinNames: ['GPIO4', 'GPIO5'],
      peripherals: { i2c: true, spi: false, uart: false },
    });
    // A wired i2c bus gates in the target classes; the esp32s3 dtsi family
    // declares flash sizes, so Store/File gate in too.
    expect(generated.gatedExports).toContain('I2CTarget');
    expect(generated.gatedExports).toContain('I2CResponder');
    expect(generated.gatedExports).toContain('Store');
    // The synthesized storage region rides board.json — the settings/FS
    // backend reads zephyr.storage.* from it.
    const manifest = JSON.parse(generated.boardJson);
    expect(manifest.constants['zephyr.storage.offset']).toBeDefined();
    expect(manifest.constants['zephyr.storage.size']).toBeGreaterThan(0);
  });

  it('gates Store/File in from a declared storageKb when the dtsi harvest sees no flash', async () => {
    writeProject({ 'board.contract.json': CONTRACT });
    // A "zephyr tree" with no dts at all: socFlashKbFromTree returns
    // undefined, exactly like an external-flash board whose flash lives in
    // the board dts rather than the soc dtsi.
    const emptyBase = join(tmp, 'zephyr-fixture');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(emptyBase, { recursive: true });

    const { generateBoardModuleFromContract } = await import('../../../packages/framework-zephyr/src/boardgen');

    const withoutDeclaration = generateBoardModuleFromContract({
      soc: 'esp32s3',
      zephyrBase: emptyBase,
      pinNames: ['GPIO4', 'GPIO5'],
      peripherals: { i2c: false, spi: false, uart: true },
    });
    expect(withoutDeclaration.gatedExports).not.toContain('Store');
    const bareManifest = JSON.parse(withoutDeclaration.boardJson);
    expect(bareManifest.constants['zephyr.storage.size']).toBeUndefined();

    const declared = generateBoardModuleFromContract({
      soc: 'esp32s3',
      zephyrBase: emptyBase,
      pinNames: ['GPIO4', 'GPIO5'],
      peripherals: { i2c: false, spi: false, uart: true },
      storageKb: 4096,
    });
    expect(declared.gatedExports).toContain('Store');
    expect(declared.gatedExports).toContain('File');
    // The synthesized storage region rides board.json from the declared size.
    const manifest = JSON.parse(declared.boardJson);
    expect(manifest.constants['zephyr.storage.offset']).toBeDefined();
    expect(manifest.constants['zephyr.storage.size']).toBeGreaterThan(0);
    expect(manifest.constants['zephyr.storage.size']).toBeLessThanOrEqual(4096 * 1024);
  });

  it('still rejects a config that sets both board and contract', () => {
    writeProject({
      'board.contract.json': CONTRACT,
      'typecad-hal.config.ts': [
        'const config = {',
        "  soc: 'stm32f411xe',",
        "  board: 'blackpill_f411ce/stm32f411xe',",
        "  contract: './board.contract.json',",
        '};',
        'export default config;',
        '',
      ].join('\n'),
    });

    expect(() => parseConfigFile(join(tmp, 'typecad-hal.config.ts'))).toThrow();
  });
});
