// ---------------------------------------------------------------------------
// generated-board.test.ts — the full board-target pipeline, end to end:
//
//   typecad-hal.config.ts (board: '<zephyr target>')
//     → loadTypecadConfig
//     → generateVirtualTypeDeclaration (boardgen via the framework hook)
//     → .typecad-hal/board.ts + board.json
//     → transpile `import { GPIO, GPIO2 } from '@typecad/hal'`
//     → Zephyr C++ carrying the board's pin facts
//
// The generated board module IS the user's '@typecad/hal' (tsconfig paths
// mapping). No @typecad/board-* package is involved
// anywhere.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTypecadConfig, generateVirtualTypeDeclaration } from '../../../packages/cuttlefish/src/config-loader';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';
import { transpile } from '../../setup';

let proj: string;

beforeAll(() => {
  proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-genboard-'));
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(proj, 'typecad-hal.config.ts'),
    [
      "import type { TypecadConfig } from '@typecad/cuttlefish/api';",
      'const config: TypecadConfig = {',
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
    const config = loadTypecadConfig(proj);
    expect(config).toBeDefined();
    expect(config!.board).toBe('esp32s3_devkitc/esp32s3/procpu');
    expect(config!.soc).toBeUndefined();
  });

  it('materializes .typecad-hal/board.ts + board.json via the framework hook', () => {
    const config = loadTypecadConfig(proj)!;
    generateVirtualTypeDeclaration(config);

    const boardTs = path.join(proj, '.typecad-hal', 'board.ts');
    const boardJson = path.join(proj, '.typecad-hal', 'board.json');
    expect(fs.existsSync(boardTs)).toBe(true);
    expect(fs.existsSync(boardJson)).toBe(true);

    const ts = fs.readFileSync(boardTs, 'utf-8');
    expect(ts).toContain("GPIO2 = Pin.fromPort('GPIO2')");
    // The module reaches the real HAL through the './core' subpath (the
    // plain specifier maps back onto this file in the project tsconfig).
    expect(ts).toContain("from '@typecad/hal/core'");
    expect(ts).not.toContain("from '@typecad/hal'");
    // The ungated surface (always-available classes/functions) is
    // re-exported verbatim so every hal name stays importable.
    expect(ts).toMatch(/export \{ [^}]*\bGPIO\b[^}]*\} from '@typecad\/hal\/core';/);
    expect(ts).toMatch(/export type \{ [^}]*\bBit\b[^}]*\} from '@typecad\/hal\/core';/);
    // All boards are equal: no curated LED override — the S3 devkit's DTS
    // has no gpio-leds node, so the module honestly carries no LED export.
    expect(ts).not.toContain('export const LED =');
    expect(ts).toContain('export const BUTTON');

    // Editor annotations: harvested facts ride JSDoc on the pin exports so
    // plain tsserver shows capabilities in hover/completions without any
    // extension (route/matrix coverage lives in the framework's boardgen
    // pin-docs unit test — the fixture catalog carries no silicon routes;
    // the board-DTS button fact is what this record has). Every doc line
    // immediately precedes a pin export; pins with no fact stay bare.
    const annotated = ts.match(/\/\*\*[^\n]*\*\/\nexport const GPIO0 = Pin\.fromPort\('GPIO0'\);/) ?? [];
    expect(annotated.length).toBe(1);
    expect(ts).toMatch(/\/\*\* aliases: BUTTON \*\/\nexport const GPIO0 = Pin\.fromPort\('GPIO0'\);/);

    const manifest = JSON.parse(fs.readFileSync(boardJson, 'utf-8'));
    expect(manifest.soc).toBe('esp32s3');
    expect(manifest.constants['build.frameworks.zephyr']).toBe('esp32s3_devkitc/esp32s3/procpu');
  });

  it("transpiles `import { GPIO, GPIO2 } from '@typecad/hal'` against the generated module", () => {
    // The entry file lives under the project so the generated-board walk-up
    // (findGeneratedBoard) resolves the specifier's board constants and pin
    // map — the user-facing path: pins and classes from one import.
    const entry = path.join(proj, 'src', 'main.ts');
    const result = transpile(
      [
        "import { GPIO, GPIO2 } from '@typecad/hal';",
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
