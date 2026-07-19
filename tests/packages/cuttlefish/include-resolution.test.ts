// Integration coverage for the import → #include resolution path, focused on
// the bug where ESP-IDF component imports produced `<EspWifi.h>` instead of
// `<esp_wifi.h>` because the PascalCase fallback in registry.ts fires when
// no libdef override exists.
//
// The fix has two coupled parts:
//   1. generateComponentDeclsForProject emits a sibling `.libdef.json` next
//      to each generated component `.d.ts`, declaring the real (case-preserving)
//      header name.
//   2. loadLibraryDefinitions scans recursively so libdefs under
//      `.cuttlefish/component-decls/<name>/` are discovered.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  resolveImport,
  loadLibraryDefinitions,
} from '../../../packages/cuttlefish/src/libdef/registry';
import type { ImportIR } from '../../../packages/cuttlefish/src/api/shared';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incl-res-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeJson(filePath: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

describe('resolveImport — PascalCase fallback (regression guard)', () => {
  it('returns <Foo.h> for an unknown module when no libdef exists', () => {
    // This is the existing behavior for unrecognized bare imports. We lock
    // it in so the fix doesn't accidentally change the default path.
    const importNode: ImportIR = {
      moduleSpecifier: 'foo',
      namedImports: ['foo'],
    } as ImportIR;
    const result = resolveImport(importNode, new Map(), 'native' as any);
    expect(result.include).toBe('<Foo.h>');
  });
});

describe('resolveImport — component libdef override', () => {
  it('uses the libdef include when a libdef for the moduleKey is loaded', () => {
    // Simulate the on-disk layout the component-decl generator produces:
    //   <tmpDir>/.cuttlefish/component-decls/esp_wifi/esp_wifi.libdef.json
    // The libdef declares the real lowercase header name.
    const libdefDir = path.join(tmpDir, '.cuttlefish', 'component-decls', 'esp_wifi');
    writeJson(path.join(libdefDir, 'esp_wifi.libdef.json'), {
      module: 'esp_wifi',
      include: '"esp_wifi.h"',
      source: path.join(tmpDir, 'esp_wifi.h'),
    });

    // loadLibraryDefinitions must recurse to find the nested libdef.
    const definitions = loadLibraryDefinitions(tmpDir);
    expect(definitions.get('esp_wifi')).toBeDefined();

    const importNode: ImportIR = {
      moduleSpecifier: './out/.cuttlefish/component-decls/esp_wifi/esp_wifi',
      namedImports: ['esp_wifi_init'],
    } as ImportIR;
    const result = resolveImport(importNode, definitions, 'native' as any);
    expect(result.include).toBe('"esp_wifi.h"');
    // Critical: NOT the PascalCase fallback.
    expect(result.include).not.toBe('<EspWifi.h>');
  });

  it('finds nested libdefs via recursive scan (subdirectory of subdirectory)', () => {
    // Two components, each with their own subdir + libdef. Both must load.
    writeJson(path.join(tmpDir, '.cuttlefish', 'component-decls', 'esp_wifi', 'esp_wifi.libdef.json'), {
      module: 'esp_wifi',
      include: '"esp_wifi.h"',
    });
    writeJson(path.join(tmpDir, '.cuttlefish', 'component-decls', 'nvs_flash', 'nvs_flash.libdef.json'), {
      module: 'nvs_flash',
      include: '"nvs_flash.h"',
    });

    const definitions = loadLibraryDefinitions(tmpDir);
    expect(definitions.size).toBe(2);
    expect(definitions.get('esp_wifi')?.include).toBe('"esp_wifi.h"');
    expect(definitions.get('nvs_flash')?.include).toBe('"nvs_flash.h"');
  });

  it('still discovers top-level (non-nested) libdefs — no regression', () => {
    // Existing convention: a libdef at the entry dir next to main.ts.
    writeJson(path.join(tmpDir, 'mysensor.libdef.json'), {
      module: 'mysensor',
      include: '<MySensor.h>',
    });
    const definitions = loadLibraryDefinitions(tmpDir);
    expect(definitions.get('mysensor')?.include).toBe('<MySensor.h>');
  });
});
