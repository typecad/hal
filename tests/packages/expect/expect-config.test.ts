// ---------------------------------------------------------------------------
// Unit tests for @typecad/expect — Config parsing
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../../packages/expect/src/host/config';

describe('expect config', () => {
  it('loads test.exclude patterns from cuttlefish.config.ts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typecad-expect-config-'));
    fs.writeFileSync(
      path.join(dir, 'cuttlefish.config.ts'),
      [
        'export default {',
        "  target: 'esp32',",
        "  board: '@typecad/board-esp32-devkit',",
        "  frameworkData: { buildTarget: 'esp32:esp32:esp32' },",
        '  test: {',
        "    port: 'COM3',",
        "    include: ['tests/**/*.test.ts'],",
        "    exclude: ['tests/32-wdt.test.ts'],",
        '  },',
        '};',
        '',
      ].join('\n'),
      'utf8',
    );

    const config = loadConfig(dir);

    expect(config.test.exclude).toEqual(['tests/32-wdt.test.ts']);
    expect(config.buildTarget).toBe('esp32:esp32:esp32');
  });
});
