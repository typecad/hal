// Contract-based MCU-only configs on Zephyr — the typecad.net contract flow
// is MCU-only by schema design (board and contract are mutually exclusive),
// so a contract PCB with no typecad board package programs bare silicon via
// the same machinery: the narrowed .cuttlefish/board.ts + pin constants from
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
      'cuttlefish.config.ts': [
        "import type { CuttlefishConfig } from '@typecad/cuttlefish/api';",
        'const config: CuttlefishConfig = {',
        "  entry: './src/main.ts',",
        "  target: 'stm32f411',",
        "  mcu: '@typecad/mcu-stm32f411',",
        "  contract: './board.contract.json',",
        "  framework: '@typecad/framework-zephyr',",
        "  frameworkData: { buildTarget: 'my_pcb' },",
        '  zephyr: { customBoard: true },',
        '};',
        'export default config;',
        '',
      ].join('\n'),
    });

    const config = parseConfigFile(join(tmp, 'cuttlefish.config.ts'));
    expect(config).toBeDefined();
    expect(config!.mcu).toBe('@typecad/mcu-stm32f411');
    expect(config!.board).toBeUndefined();
    expect(config!.contract).toBe('./board.contract.json');
    expect(config!.buildTarget).toBe('my_pcb');
    expect((config!.zephyrConfig as Record<string, unknown>).customBoard).toBe(true);
  });

  it('generates the narrowed board.ts from the contract + MCU manifest', async () => {
    writeProject({ 'board.contract.json': CONTRACT });

    const contract = parseContractFile(join(tmp, 'board.contract.json'));
    const { generateBoardFile } = await import('../../../packages/cuttlefish/src/contract/board-generator');
    const boardPath = generateBoardFile({
      projectDir: tmp,
      mcuPackage: '@typecad/mcu-stm32f411',
      connectedPins: ['PA5', 'PA0'],
      peripherals: ['UART0'],
    });

    expect(existsSync(boardPath)).toBe(true);
    const board = readFileSync(boardPath, 'utf8');
    // Only the wired pins are exposed; unwired silicon is a compile error.
    expect(board).toContain("export { PA5, PA0 } from '@typecad/mcu-stm32f411'");
    expect(board).not.toContain('PC13');
    // Full HAL surface so `import { delay } from '@typecad/board'` resolves.
    expect(board).toContain("export * from '@typecad/hal'");
  });

  it('still rejects a config that sets both board and contract', () => {
    writeProject({
      'board.contract.json': CONTRACT,
      'cuttlefish.config.ts': [
        'const config = {',
        "  mcu: '@typecad/mcu-stm32f411',",
        "  board: '@typecad/board-blackpill-f411ce',",
        "  contract: './board.contract.json',",
        '};',
        'export default config;',
        '',
      ].join('\n'),
    });

    expect(() => parseConfigFile(join(tmp, 'cuttlefish.config.ts'))).toThrow();
  });
});
