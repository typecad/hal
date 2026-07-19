import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadCuttlefishConfig } from '../../../packages/cuttlefish/src/config-loader';

// loadCuttlefishConfig(dir) reads <dir>/cuttlefish.config.ts — so we write
// the config to a temp dir and point the loader at it.
function writeConfig(dir: string, framework: string): string {
  const src = `
import type { CuttlefishConfig } from '@typecad/cuttlefish/api';
const config: CuttlefishConfig = {
  entry: './src/main.ts',
  target: 'esp32s3',
  framework: '${framework}',
  frameworkData: {
    target: 'esp32s3',
    components: { managed: { 'espressif/esp_wifi': '^1.0' } },
  },
};
export default config;
`;
  fs.writeFileSync(path.join(dir, 'cuttlefish.config.ts'), src, 'utf8');
  return dir;
}

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-esp32-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('config-loader: frameworkConfig for ESP-IDF', () => {
  it('populates frameworkConfig from frameworkData when framework is framework-esp32', () => {
    const cfg = loadCuttlefishConfig(writeConfig(tmpDir, '@typecad/framework-esp32'));
    expect(cfg?.frameworkConfig).toBeDefined();
    expect((cfg!.frameworkConfig as any).components).toBeDefined();
    expect((cfg!.frameworkConfig as any).components.managed).toEqual({ 'espressif/esp_wifi': '^1.0' });
  });

  it('does NOT populate frameworkConfig from frameworkData when framework is arduino', () => {
    const cfg = loadCuttlefishConfig(writeConfig(tmpDir, '@typecad/framework-arduino'));
    expect(cfg?.frameworkConfig).toBeUndefined();
  });
});
