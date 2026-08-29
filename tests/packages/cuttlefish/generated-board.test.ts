// ---------------------------------------------------------------------------
// generated-board.test.ts — the full board-target pipeline, end to end:
//
//   cuttlefish.config.ts (board: '<zephyr target>')
//     → loadCuttlefishConfig
//     → generateVirtualTypeDeclaration (boardgen via the framework hook)
//     → .cuttlefish/board.ts + board.json
//     → transpile `import { GPIO2, LED } from '@typecad/board'`
//     → Zephyr C++ carrying the board's pin facts
//
// This is the replacement for the board-package path: no @typecad/board-*
// package is involved anywhere.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCuttlefishConfig, generateVirtualTypeDeclaration } from '../../../packages/cuttlefish/src/config-loader';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';
import { transpile } from '../../setup';

let proj: string;

beforeAll(() => {
  proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-genboard-'));
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(proj, 'cuttlefish.config.ts'),
    [
      "import type { CuttlefishConfig } from '@typecad/cuttlefish/api';",
      'const config: CuttlefishConfig = {',
      "  entry: './src/main.ts',",
      "  target: 'esp32s3',",
      "  board: 'esp32s3_devkitc/esp32s3/procpu',",
      "  framework: '@typecad/framework-zephyr',",
      "  frameworkData: { buildTarget: 'esp32s3_devkitc/esp32s3/procpu' },",
      "  output: { framework: 'zephyr', outDir: './out' },",
      '};',
      'export default config;',
      '',
    ].join('\n'),
  );
});

afterAll(() => {
  fs.rmSync(proj, { recursive: true, force: true });
});

describe('generated board module (board-target config)', () => {
  it('loads the config with board as the Zephyr target', () => {
    const config = loadCuttlefishConfig(proj);
    expect(config).toBeDefined();
    expect(config!.board).toBe('esp32s3_devkitc/esp32s3/procpu');
    expect(config!.soc).toBeUndefined();
  });

  it('materializes .cuttlefish/board.ts + board.json via the framework hook', () => {
    const config = loadCuttlefishConfig(proj)!;
    generateVirtualTypeDeclaration(config);

    const boardTs = path.join(proj, '.cuttlefish', 'board.ts');
    const boardJson = path.join(proj, '.cuttlefish', 'board.json');
    expect(fs.existsSync(boardTs)).toBe(true);
    expect(fs.existsSync(boardJson)).toBe(true);

    const ts = fs.readFileSync(boardTs, 'utf-8');
    expect(ts).toContain("GPIO2 = Pin.fromPort('GPIO2')");
    // The S3 devkit's LED is the WS2812 on GPIO48 — no gpio-leds node, but
    // the curated board override maps it (plain GPIO, like the old package).
    expect(ts).toContain('export const LED = GPIO48');
    expect(ts).toContain('export const BUTTON');

    const manifest = JSON.parse(fs.readFileSync(boardJson, 'utf-8'));
    expect(manifest.soc).toBe('esp32s3');
    expect(manifest.tier).toBe('validated');
    expect(manifest.constants['build.frameworks.zephyr']).toBe('esp32s3_devkitc/esp32s3/procpu');
  });

  it("transpiles `import { GPIO2 } from '@typecad/board'` against the generated module", () => {
    // The entry file lives under the project so the generated-board walk-up
    // (findGeneratedBoard) resolves the virtual specifier.
    const entry = path.join(proj, 'src', 'main.ts');
    const result = transpile(
      [
        "import { GPIO } from '@typecad/hal';",
        "import { GPIO2 } from '@typecad/board';",
        'const led = new GPIO(GPIO2, GPIO.OUTPUT);',
        'led.set(true);',
        '',
      ].join('\n'),
      { fileName: entry, strategy: new ZephyrStrategy() },
    );

    const errs = (result.diagnostics ?? []).filter((d: any) => d.severity === 'error');
    expect(errs.map((e: any) => e.message)).toEqual([]);
    // Pin 2 on the esp32s3 resolves through the gpio0 controller.
    expect(result.cpp).toMatch(/gpio_pin_(set|configure)/);
    expect(result.cpp).toContain('DT_NODELABEL(gpio0)');
  });
});
