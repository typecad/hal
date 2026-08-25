// MCU-only create flow — the catalog, the Zephyr board snapshot join, FQBN
// validation, and the scaffolded artifacts for bare-silicon targets.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  KNOWN_MCUS,
  scaffoldProject,
} from '../../../packages/cuttlefish/src/create/scaffold';
import {
  findKnownMcu,
  mcuAsTarget,
  mcuSupportsZephyr,
  zephyrBoardsForMcu,
  findZephyrBoardForMcu,
  sanitizeBoardName,
  isValidFqbn,
  type McuCreateTarget,
} from '../../../packages/cuttlefish/src/create/mcu-target';
import { ZEPHYR_BOARD_SNAPSHOT } from '../../../packages/cuttlefish/src/create/zephyr-boards.generated';
import {
  generateProjectConfig,
  generateProjectTsconfig,
  generateProjectPackageJson,
  generateStarterSketch,
} from '../../../packages/cuttlefish/src/create/templates';

const stm32f411 = mcuAsTarget(findKnownMcu('stm32f411')!);

describe('KNOWN_MCUS catalog', () => {
  it('every entry names its package @typecad/mcu-<id>', () => {
    for (const m of KNOWN_MCUS) {
      expect(m.mcu).toBe(`@typecad/mcu-${m.id}`);
    }
  });

  it('every zephyrSocs entry exists in the snapshot (the join key is real)', () => {
    for (const m of KNOWN_MCUS) {
      for (const soc of m.zephyrSocs) {
        expect(ZEPHYR_BOARD_SNAPSHOT[soc], `${m.id}: soc '${soc}' missing from snapshot`).toBeDefined();
      }
    }
  });

  it('the stm32f411 silicon socs match the MCU package (consistency)', async () => {
    const mod = await import('@typecad/mcu-stm32f411');
    const def = (mod as { STM32F411: { zephyr?: { socs?: string[] } } }).STM32F411;
    expect(def.zephyr?.socs).toEqual(stm32f411.zephyrSocs);
  });
});

describe('mcu-target resolution', () => {
  it('finds catalog entries and reports unknown ids', () => {
    expect(findKnownMcu('stm32f411')).toBeDefined();
    expect(findKnownMcu('nope-123')).toBeUndefined();
  });

  it('mcuAsTarget carries no boardPackage and the package specifier as mcu', () => {
    expect(stm32f411.boardPackage).toBeUndefined();
    expect(stm32f411.mcu).toBe('@typecad/mcu-stm32f411');
    expect(stm32f411.isNative).toBe(false);
  });

  it('Zephyr requires the silicon zephyr block', () => {
    expect(mcuSupportsZephyr(stm32f411)).toBe(true);
    expect(mcuSupportsZephyr(mcuAsTarget(findKnownMcu('atmega328p')!))).toBe(false);
  });
});

describe('zephyr board snapshot join', () => {
  it('lists every snapshot board for the MCU socs, with qualified targets', () => {
    const boards = zephyrBoardsForMcu(stm32f411);
    expect(boards.length).toBeGreaterThan(0);
    const blackpill = boards.find((b) => b.name === 'blackpill_f411ce');
    expect(blackpill).toBeDefined();
    expect(blackpill!.target).toBe('blackpill_f411ce/stm32f411xe');
  });

  it('multi-variant SoCs get their application-core cluster qualifier', () => {
    const esp32s3Mcu: McuCreateTarget = {
      ...stm32f411,
      id: 'esp32s3-test',
      zephyrSocs: ['esp32s3'],
    };
    const boards = zephyrBoardsForMcu(esp32s3Mcu);
    expect(boards.length).toBeGreaterThan(0);
    for (const b of boards) {
      expect(b.target.endsWith('/esp32s3/procpu')).toBe(true);
    }
  });

  it('findZephyrBoardForMcu resolves by bare name and rejects other-SoC boards', () => {
    expect(findZephyrBoardForMcu(stm32f411, 'blackpill_f411ce')?.target)
      .toBe('blackpill_f411ce/stm32f411xe');
    expect(findZephyrBoardForMcu(stm32f411, 'nrf52840dk')).toBeUndefined();
  });
});

describe('naming + FQBN validation', () => {
  it('sanitizeBoardName matches the framework-zephyr generator rules', () => {
    expect(sanitizeBoardName('My F411!')).toBe('my_f411');
    expect(sanitizeBoardName('pro-mini.v2')).toBe('pro_mini_v2');
    expect(sanitizeBoardName('!!!')).toBe('custom_board');
  });

  it('isValidFqbn accepts 3-4 segments with non-empty heads', () => {
    expect(isValidFqbn('arduino:avr:pro')).toBe(true);
    expect(isValidFqbn('arduino:avr:pro:cpu=8MHz')).toBe(true);
    expect(isValidFqbn('arduino:avr')).toBe(false);
    expect(isValidFqbn('a:b:c:d:e')).toBe(false);
    expect(isValidFqbn(':avr:pro')).toBe(false);
  });
});

describe('MCU-only scaffold artifacts', () => {
  const options = {
    projectName: 'my-pro-mini',
    targetId: 'atmega328p',
    targetDisplayName: 'ATmega328P (bare MCU)',
    isNative: false as const,
    architecture: 'avr' as const,
    frameworkPackage: '@typecad/framework-arduino',
    framework: 'arduino',
    buildTarget: 'arduino:avr:pro',
    mcu: '@typecad/mcu-atmega328p',
    sketchPin: 'PB5',
    baudRate: 9600,
    includeSketch: true,
    toolchainType: 'arduino-cli',
  };

  it('the config has mcu, no board, and the pasted FQBN as build target', () => {
    const config = generateProjectConfig(options);
    expect(config).toContain("mcu: '@typecad/mcu-atmega328p'");
    expect(config).not.toContain('board:');
    expect(config).toContain("buildTarget: 'arduino:avr:pro'");
  });

  it('the tsconfig maps @typecad/board but not @typecad/test-pins (board data)', () => {
    const tsconfig = generateProjectTsconfig(options);
    expect(tsconfig).toContain('"@typecad/board": ["./.cuttlefish/board.ts"]');
    expect(tsconfig).not.toContain('@typecad/test-pins');
  });

  it('package.json depends on the MCU package instead of a board package', () => {
    const pkg = JSON.parse(generateProjectPackageJson(options));
    expect(pkg.dependencies['@typecad/mcu-atmega328p']).toBeDefined();
    expect(Object.keys(pkg.dependencies).some((d) => d.startsWith('@typecad/board-'))).toBe(false);
  });

  it('the starter sketch blinks a datasheet port pin, not a board LED alias', () => {
    const sketch = generateStarterSketch(options);
    expect(sketch).toContain('import { PB5, delay }');
    expect(sketch).not.toContain('LED');
  });

  it('the zephyr custom-board flag lands in the config zephyr section', () => {
    const config = generateProjectConfig({
      ...options,
      framework: 'zephyr',
      frameworkPackage: '@typecad/framework-zephyr',
      toolchainType: 'west',
      buildTarget: 'my_f411',
      zephyrCustomBoard: true,
    });
    expect(config).toContain('customBoard: true');
    expect(config).toContain("buildTarget: 'my_f411'");
  });

  it('scaffoldProject writes a buildable MCU-only project tree', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cf-mcu-scaffold-'));
    try {
      const result = scaffoldProject(options, join(tmp, 'proj'));
      const configPath = result.createdFiles.find((f) => f.endsWith('cuttlefish.config.ts'))!;
      const config = readFileSync(configPath, 'utf8');
      expect(config).toContain("mcu: '@typecad/mcu-atmega328p'");
      expect(result.createdFiles.some((f) => f.replace(/\\/g, '/').endsWith('src/main.ts'))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
