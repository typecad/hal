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
        "  board: 'esp32_devkitc/esp32/procpu',",
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

  it('loads the test.usb identity block', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typecad-expect-config-'));
    fs.writeFileSync(
      path.join(dir, 'cuttlefish.config.ts'),
      [
        'export default {',
        "  target: 'stm32f411',",
        "  board: 'blackpill_f411ce/stm32f411xe',",
        "  frameworkData: { buildTarget: 'blackpill_f411ce/stm32f411xe' },",
        '  test: {',
        "    usb: { vid: '2FE3', pid: '0002', serial: 'DEV-A' },",
        '  },',
        '};',
        '',
      ].join('\n'),
      'utf8',
    );

    const config = loadConfig(dir);
    expect(config.test.usb).toEqual({ vid: '2FE3', pid: '0002', serial: 'DEV-A' });
  });

  it('drops test.usb when --port overrides (explicit port wins)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typecad-expect-config-'));
    fs.writeFileSync(
      path.join(dir, 'cuttlefish.config.ts'),
      [
        'export default {',
        "  target: 'stm32f411',",
        "  board: 'blackpill_f411ce/stm32f411xe',",
        '  test: {',
        "    usb: { vid: '2FE3', pid: '0002' },",
        "    port: 'COM7',",
        '  },',
        '};',
        '',
      ].join('\n'),
      'utf8',
    );

    const config = loadConfig(dir, { port: 'COM9' });
    expect(config.test.usb).toBeUndefined();
    expect(config.test.port).toBe('COM9');
  });
});
