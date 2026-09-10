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
    });

    expect(existsSync(boardPath)).toBe(true);
    const board = readFileSync(boardPath, 'utf8');
    // Only the wired pins are exposed; unwired silicon is a compile error.
    expect(board).toContain("export const PA5 = Pin.fromPort('PA5');");
    expect(board).toContain("export const PA0 = Pin.fromPort('PA0');");
    expect(board).not.toContain('PC13');
    expect(board).toContain("export const UART0 = new UART('UART0');");
    // HAL imports so `import { Time } from '@typecad/hal'` resolves.
    expect(board).toContain("import { Pin, I2CBus, SPIBus, UART } from '@typecad/hal/core';");
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
