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
    });
    expect(headers.map((h) => path.basename(h)).sort()).toEqual([
      'esp_wifi.h',
      'esp_wifi_types.h',
    ]);
  });

  it('falls back to managed_components/<name>/ when no include/ subdir', () => {
    const managed = path.join(tmpDir, 'managed_components', 'foo');
    writeHeader(path.join(managed, 'foo.h'), 'void foo(void);');

    const headers = discoverComponentHeaders(tmpDir, { managed: ['foo'], local: [] });
    expect(headers.map((h) => path.basename(h))).toEqual(['foo.h']);
  });

  it('discovers local component headers', () => {
    const local = path.join(tmpDir, 'components', 'my_sensor', 'include');
    writeHeader(path.join(local, 'my_sensor.h'), 'void my_sensor_read(void);');

    const headers = discoverComponentHeaders(tmpDir, {
      managed: [],
      local: [path.join(tmpDir, 'components', 'my_sensor')],
    });
    expect(headers.map((h) => path.basename(h))).toEqual(['my_sensor.h']);
  });

  it('returns empty when no components present', () => {
    expect(discoverComponentHeaders(tmpDir, { managed: [], local: [] })).toEqual([]);
  });
});
