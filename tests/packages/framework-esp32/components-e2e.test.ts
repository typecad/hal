import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scaffoldEspIdfProject } from '../../../packages/framework-esp32/src/toolchain/scaffold';
import { resolveComponents } from '../../../packages/framework-esp32/src/components/types';
import { generateComponentDeclsForProject } from '../../../packages/cuttlefish/src/libdef/cpp-to-decl';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-comp-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('components end-to-end (no IDF)', () => {
  it('scaffolds + generates decls for a synthetic managed component', () => {
    // Simulate idf.py having populated managed_components/.
    const compDir = path.join(tmpDir, 'managed_components', 'espressif__esp_wifi', 'include');
    fs.mkdirSync(compDir, { recursive: true });
    fs.writeFileSync(
      path.join(compDir, 'esp_wifi.h'),
      'typedef enum { WIFI_MODE_NULL=0, WIFI_MODE_STA=1 } wifi_mode_t;\n' +
        'typedef struct wifi_init_config wifi_init_config_t;\n' +
        'int esp_wifi_init(const wifi_init_config_t *cfg);\n' +
        'int esp_wifi_set_mode(wifi_mode_t mode);\n',
      'utf8',
    );

    const frameworkConfig = {
      target: 'esp32s3',
      components: { managed: { 'espressif/esp_wifi': '^1.0' } },
    };
    const components = resolveComponents(frameworkConfig, tmpDir);

    // Layer 2: scaffold materializes idf_component.yml.
    scaffoldEspIdfProject(tmpDir, 'esp32s3', components);
    const yml = fs.readFileSync(path.join(tmpDir, 'main', 'idf_component.yml'), 'utf8');
    expect(yml).toContain('espressif/esp_wifi: "^1.0"');

    // Layer 4: gen-decls produces a usable .d.ts.
    const created = generateComponentDeclsForProject(tmpDir, {
      managed: ['espressif__esp_wifi'],
      local: [],
    });
    expect(created.length).toBeGreaterThan(0);
    const dts = fs.readFileSync(created[0], 'utf8');
    expect(dts).toContain('export declare const esp_wifi: {');
    expect(dts).toContain('init(cfg: number): number;');
    expect(dts).toContain('set_mode(mode: wifi_mode_t): number;');
    expect(dts).toContain('export type wifi_mode_t = 0 | 1;');
  });
});
