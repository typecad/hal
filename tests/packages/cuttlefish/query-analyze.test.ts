import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeProject, runQuery, resolveQueryInvocation, QUERY_SUBJECTS } from '../../../packages/cuttlefish/src/query';

// Mirrors demos/demo: HAL imports (USB, Time) + an async task + a relative
// import so the module graph and task/timer derivations have real work.
const HELPER_TS = [
  'export function readTemp(): number {',
  '  return 2180; // 21.80 °C in int16 0.01 °C units',
  '}',
  '',
].join('\n');

const MAIN_TS = [
  "import { Time, USB0 } from '@typecad/hal';",
  "import { readTemp } from './helper';",
  '',
  'export async function pollTemperature() {',
  "  USB0.writeLine('tick');",
  '}',
  '',
  'USB0.open();',
  "USB0.writeLine('temp=' + readTemp());",
  '',
  'while (true) {',
  '  Time.sleep(1000);',
  '}',
  '',
].join('\n');

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typecad-query-'));
  fs.writeFileSync(path.join(dir, 'helper.ts'), HELPER_TS, 'utf8');
  fs.writeFileSync(path.join(dir, 'main.ts'), MAIN_TS, 'utf8');
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('analyzeProject (read-only, no emit)', () => {
  it('walks the import graph and leaves nothing written', async () => {
    const before = fs.readdirSync(dir).sort();
    const result = await analyzeProject({ entryFile: path.join(dir, 'main.ts') });
    const after = fs.readdirSync(dir).sort();

    expect(result.files.some((f) => f.endsWith('main.ts'))).toBe(true);
    expect(result.files.some((f) => f.endsWith('helper.ts'))).toBe(true);
    expect(after).toEqual(before); // read-only: no output artifacts
  });

  it('derives async tasks, timer usage, and peripheral allocations without emitting', async () => {
    const { report } = await analyzeProject({ entryFile: path.join(dir, 'main.ts') });

    expect(report.asyncTasks.map((t) => t.name)).toContain('pollTemperature');
    expect(report.executionFlow.usesTimers).toBe(true);
    expect(report.executionFlow.entryPoints).toContain('main');
    expect(report.pinUsage.peripherals.some((p) => p.type === 'usb')).toBe(true);
  });

  it('reports entry diagnostics', async () => {
    const { program } = await analyzeProject({ entryFile: path.join(dir, 'main.ts') });
    expect(program.diagnostics).toEqual([]);
  });

  // Regression: a runtime-expression argument (ternary) to writeReg used to
  // resolve null in the i2c plugins, silently dropping the op — the call fell
  // back to raw unlowered C++ and vanished from peripheral usage entirely.
  it('records I2C usage when register arguments are runtime expressions', async () => {
    const file = path.join(dir, 'ternary-reg.ts');
    fs.writeFileSync(
      file,
      [
        "import { I2CBus } from '@typecad/hal';",
        "const i2c = new I2CBus('I2C0');",
        'const therm = i2c.device(0x48);',
        'therm.writeReg(1, 1 > 0 ? 1 : 0);',
        '',
      ].join('\n'),
      'utf8',
    );
    const { program, report } = await analyzeProject({ entryFile: file });
    expect(program.peripheralUsage?.i2c).toBe(true);
    expect([...(program.peripheralUsage?.i2cInstancesUsed ?? [])]).toEqual([0]);
    expect(report.pinUsage.peripherals.some((p) => p.type === 'i2c')).toBe(true);
  });
});

describe('resolveQueryInvocation (config is the base; positionals/flags override)', () => {
  // The config must stay in effect when only the entry is overridden with a
  // positional — otherwise `query pins src/main.ts` inside a configured
  // project silently analyzed against no board at all.
  let cfgDir: string;
  let prevCwd: string;

  beforeAll(() => {
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typecad-query-cfg-'));
    fs.mkdirSync(path.join(cfgDir, 'src'));
    fs.writeFileSync(path.join(cfgDir, 'src', 'main.ts'), 'export const x = 1;\n', 'utf8');
    fs.writeFileSync(
      path.join(cfgDir, 'typecad-hal.config.ts'),
      [
        'export default {',
        "  entry: './src/main.ts',",
        "  board: 'xiao_ble/nrf52840',",
        "  framework: '@typecad/framework-zephyr',",
        '};',
        '',
      ].join('\n'),
      'utf8',
    );
    prevCwd = process.cwd();
    process.chdir(cfgDir);
  });

  afterAll(() => {
    process.chdir(prevCwd);
    fs.rmSync(cfgDir, { recursive: true, force: true });
  });

  it('fills entry, board and framework from the config', () => {
    const inv = resolveQueryInvocation({});
    expect(inv.entryFile).toBe(path.join(cfgDir, 'src', 'main.ts'));
    expect(inv.projectRoot).toBe(cfgDir);
    expect(inv.boardTarget).toBe('xiao_ble/nrf52840');
    expect(inv.frameworkPackage).toBe('@typecad/framework-zephyr');
  });

  it('keeps the config board/framework when only the entry is overridden positionally', () => {
    const inv = resolveQueryInvocation({ entryFile: 'other.ts' });
    expect(inv.entryFile).toBe('other.ts');
    expect(inv.boardTarget).toBe('xiao_ble/nrf52840');
    expect(inv.frameworkPackage).toBe('@typecad/framework-zephyr');
  });

  it('lets explicit --board/--framework flags win over the config', () => {
    const inv = resolveQueryInvocation({ board: 'other/board', framework: '@typecad/framework-native' });
    expect(inv.boardTarget).toBe('other/board');
    expect(inv.frameworkPackage).toBe('@typecad/framework-native');
  });

  it('throws when no entry is given and no config provides one', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typecad-query-empty-'));
    try {
      expect(() => resolveQueryInvocation({}, emptyDir)).toThrow(/No entry file/);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe('runQuery subjects', () => {
  it('emits valid JSON for every subject', async () => {
    for (const subject of QUERY_SUBJECTS) {
      const logged: string[] = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((line?: string) => {
        logged.push(String(line));
      });
      try {
        await runQuery({ command: 'query', subject, entryFile: path.join(dir, 'main.ts'), json: true });
      } finally {
        spy.mockRestore();
      }
      const json = JSON.parse(logged.join('\n'));
      expect(json, subject).toBeTruthy();
      expect(typeof json).toBe('object');
    }
  });

  it('summary JSON carries board-independent facts', async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line?: string) => {
      logged.push(String(line));
    });
    try {
      await runQuery({ command: 'query', subject: 'summary', entryFile: path.join(dir, 'main.ts'), json: true });
    } finally {
      spy.mockRestore();
    }
    const summary = JSON.parse(logged.join('\n'));
    expect(summary.modules).toBeGreaterThanOrEqual(2);
    expect(summary.asyncTasks).toBe(1);
    expect(summary.usesTimers).toBe(true);
    expect(summary.peripherals).toContain('USB');
    expect(summary.diagnostics).toEqual({ errors: 0, warnings: 0 });
  });

  it('throws on unknown subjects and missing entries', async () => {
    await expect(
      runQuery({ command: 'query', subject: 'frobnicate', entryFile: path.join(dir, 'main.ts') }),
    ).rejects.toThrow(/Unknown subject 'frobnicate'/);
    await expect(runQuery({ command: 'query', subject: 'summary', entryFile: path.join(dir, 'nope.ts') })).rejects.toThrow(
      /Entry file not found/,
    );
  });
});
