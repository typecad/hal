import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { discoverComponentHeaders } from '../../../packages/cuttlefish/src/libdef/component-discovery';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-disc-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeHeader(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

describe('discoverComponentHeaders', () => {
  it('discovers headers in managed_components/<name>/include/ first', () => {
    const managed = path.join(tmpDir, 'managed_components', 'espressif__esp_wifi', 'include');
    writeHeader(path.join(managed, 'esp_wifi.h'), 'void esp_wifi_init(void);');
    writeHeader(path.join(managed, 'esp_wifi_types.h'), 'typedef int wifi_mode_t;');

    const headers = discoverComponentHeaders(tmpDir, {
      managed: ['espressif__esp_wifi'],
      local: [],
      builtin: [],
    });
    expect(headers.map((h) => path.basename(h.path)).sort()).toEqual([
      'esp_wifi.h',
      'esp_wifi_types.h',
    ]);
    // Managed: output dir is alongside the header.
    expect(headers.every((h) => h.outputDir === managed)).toBe(true);
  });

  it('falls back to managed_components/<name>/ when no include/ subdir', () => {
    const managed = path.join(tmpDir, 'managed_components', 'foo');
    writeHeader(path.join(managed, 'foo.h'), 'void foo(void);');

    const headers = discoverComponentHeaders(tmpDir, { managed: ['foo'], local: [], builtin: [] });
    expect(headers.map((h) => path.basename(h.path))).toEqual(['foo.h']);
    expect(headers[0].outputDir).toBe(managed);
  });

  it('discovers local component headers', () => {
    const local = path.join(tmpDir, 'components', 'my_sensor', 'include');
    writeHeader(path.join(local, 'my_sensor.h'), 'void my_sensor_read(void);');

    const headers = discoverComponentHeaders(tmpDir, {
      managed: [],
      local: [path.join(tmpDir, 'components', 'my_sensor')],
      builtin: [],
    });
    expect(headers.map((h) => path.basename(h.path))).toEqual(['my_sensor.h']);
    expect(headers[0].outputDir).toBe(local);
  });

  it('returns empty when no components present', () => {
    expect(discoverComponentHeaders(tmpDir, { managed: [], local: [], builtin: [] })).toEqual([]);
  });

  it('discovers built-in component headers from $IDF_PATH/components/<name>/include/', () => {
    // Simulate an IDF install layout under tmpDir/idf-root.
    const idfRoot = path.join(tmpDir, 'idf-root');
    const includeDir = path.join(idfRoot, 'components', 'esp_wifi', 'include');
    writeHeader(path.join(includeDir, 'esp_wifi.h'), 'esp_err_t esp_wifi_init(void);');
    writeHeader(path.join(includeDir, 'esp_wifi_types.h'), 'typedef int wifi_mode_t;');

    const headers = discoverComponentHeaders(tmpDir, {
      managed: [],
      local: [],
      builtin: ['esp_wifi'],
      idfRoot,
    });
    expect(headers.map((h) => path.basename(h.path)).sort()).toEqual([
      'esp_wifi.h',
      'esp_wifi_types.h',
    ]);
    // CRITICAL: builtins write to a project-local cache, never into the IDF install.
    const expectedOut = path.join(tmpDir, '.cuttlefish', 'component-decls', 'esp_wifi');
    expect(headers.every((h) => h.outputDir === expectedOut)).toBe(true);
    expect(fs.existsSync(expectedOut)).toBe(true);
    // And the IDF install is untouched.
    expect(fs.readdirSync(includeDir).some((f) => f.endsWith('.d.ts'))).toBe(false);
  });

  it('skips builtins when idfRoot is undefined', () => {
    // Even with builtin names declared, no idfRoot means no scan — avoids
    // crashing or scanning bogus paths.
    const headers = discoverComponentHeaders(tmpDir, {
      managed: [],
      local: [],
      builtin: ['esp_wifi'],
    });
    expect(headers).toEqual([]);
  });
});
