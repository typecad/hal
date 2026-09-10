import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  resetCuttlefishLibraries,
  registerCuttlefishLibraryFromSpecifier,
  getRegisteredCuttlefishLibraries,
  cuttlefishLibraryLibdefs,
  libraryDefinitionKey,
  validateCuttlefishLibraries,
  writeCuttlefishLibraryArtifacts,
  readCuttlefishLibrarySidecar,
  LIBRARY_SIDECAR_NAME,
} from '../../../packages/cuttlefish/src/library-packages';
import { resolveImport } from '../../../packages/cuttlefish/src/libdef/registry';

// ---------------------------------------------------------------------------
// TypeCAD library packages — import-driven registration, libdef injection,
// validation, and artifact (shim + sidecar) emission.
//
// A synthetic library package is laid out in a temp node_modules tree so the
// tests control every artifact byte; the workspace's own
// @typecad/zephyr-esp32s3-rgb is exercised for registration + libdef shape.
// ---------------------------------------------------------------------------

const FIXTURE_SPECIFIER = '@scope/fake-rgb';

function writeFixtureLibrary(root: string): void {
  const pkgRoot = join(root, 'node_modules', '@scope', 'fake-rgb');
  mkdirSync(join(pkgRoot, 'shims'), { recursive: true });
  writeFileSync(
    join(pkgRoot, 'package.json'),
    JSON.stringify({ name: FIXTURE_SPECIFIER, main: 'index.js' }),
  );
  writeFileSync(join(pkgRoot, 'index.js'), '// fixture entry\n');
  writeFileSync(
    join(pkgRoot, 'typecad-hal.library.json'),
    JSON.stringify({
      id: 'fake-rgb',
      module: FIXTURE_SPECIFIER,
      framework: 'zephyr',
      targets: ['esp32s3_devkitc'],
      include: '"__tc_fake_rgb.h"',
      gateToken: '__tc_fake_rgb',
      shims: [
        { path: 'shims/x.h', outName: '__tc_fake_rgb.h' },
        { path: 'shims/x.cpp', outName: '__tc_fake_rgb.cpp' },
      ],
      kconfig: ['CONFIG_LED_STRIP=y'],
      overlay: 'shims/frag.overlay',
    }),
  );
  writeFileSync(join(pkgRoot, 'shims', 'x.h'), '// fake shim header\n');
  writeFileSync(join(pkgRoot, 'shims', 'x.cpp'), '// fake shim source\n');
  writeFileSync(join(pkgRoot, 'shims', 'frag.overlay'), '&i2s0 { status = "okay"; };\n');
}

describe('typecad-hal library packages', () => {
  let root: string;
  let srcDir: string;

  beforeEach(() => {
    resetCuttlefishLibraries();
    root = mkdtempSync(join(tmpdir(), 'tc-libraries-'));
    writeFixtureLibrary(root);
    srcDir = join(root, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'main.ts'), '// importing file\n');
  });
  afterEach(() => {
    resetCuttlefishLibraries();
    rmSync(root, { recursive: true, force: true });
  });

  describe('registration (import-driven)', () => {
    it('registers a package whose root ships typecad-hal.library.json', () => {
      expect(registerCuttlefishLibraryFromSpecifier(join(srcDir, 'main.ts'), FIXTURE_SPECIFIER)).toBe(true);
      const libs = getRegisteredCuttlefishLibraries();
      expect(libs).toHaveLength(1);
      expect(libs[0]!.manifest.id).toBe('fake-rgb');
      expect(libs[0]!.manifest.include).toBe('"__tc_fake_rgb.h"');
      expect(libs[0]!.packageRoot).toContain(join('node_modules', '@scope', 'fake-rgb'));
    });

    it('is idempotent per specifier', () => {
      const from = join(srcDir, 'main.ts');
      expect(registerCuttlefishLibraryFromSpecifier(from, FIXTURE_SPECIFIER)).toBe(true);
      expect(registerCuttlefishLibraryFromSpecifier(from, FIXTURE_SPECIFIER)).toBe(true);
      expect(getRegisteredCuttlefishLibraries()).toHaveLength(1);
    });

    it('returns false for relative specifiers and unknown packages (and caches the miss)', () => {
      const from = join(srcDir, 'main.ts');
      expect(registerCuttlefishLibraryFromSpecifier(from, './local')).toBe(false);
      expect(registerCuttlefishLibraryFromSpecifier(from, 'totally-not-a-library')).toBe(false);
      expect(registerCuttlefishLibraryFromSpecifier(from, 'totally-not-a-library')).toBe(false);
      expect(getRegisteredCuttlefishLibraries()).toHaveLength(0);
    });

    it('registers the workspace library package @typecad/zephyr-esp32s3-rgb', () => {
      // The importing file must live under the repo (node_modules lookup walks
      // up from it); this test file's own path is a stable anchor.
      const from = fileURLToPath(import.meta.url);
      expect(registerCuttlefishLibraryFromSpecifier(from, '@typecad/zephyr-esp32s3-rgb')).toBe(true);
      const lib = getRegisteredCuttlefishLibraries().find(
        (l) => l.manifest.id === 'zephyr-esp32s3-rgb',
      );
      expect(lib).toBeDefined();
      expect(lib!.manifest.framework).toBe('zephyr');
      expect(lib!.manifest.include).toBe('"__tc_rgbled.h"');
      expect(lib!.manifest.shims.map((s) => s.outName).sort()).toEqual(['__tc_rgbled.cpp', '__tc_rgbled.h']);
      expect(lib!.manifest.kconfig).toContain('CONFIG_LED_STRIP=y');
    });
  });

  describe('libdef injection', () => {
    it('produces registry entries keyed by module basename', () => {
      registerCuttlefishLibraryFromSpecifier(join(srcDir, 'main.ts'), FIXTURE_SPECIFIER);
      const entries = cuttlefishLibraryLibdefs();
      expect(entries).toHaveLength(1);
      expect(libraryDefinitionKey(entries[0]!.module)).toBe('fake-rgb');
    });

    it('resolves the import to the shim include via the libdef registry', () => {
      registerCuttlefishLibraryFromSpecifier(join(srcDir, 'main.ts'), FIXTURE_SPECIFIER);
      const definitions = new Map(
        cuttlefishLibraryLibdefs().map((d) => [libraryDefinitionKey(d.module), d]),
      );
      const resolved = resolveImport(
        { moduleSpecifier: FIXTURE_SPECIFIER, namedImports: ['rgbLed'] } as any,
        definitions,
      );
      expect(resolved.include).toBe('"__tc_fake_rgb.h"');
      expect(resolved.symbolMap['rgbLed']).toBe('rgbLed');
    });
  });

  describe('validation', () => {
    it('throws on framework mismatch', () => {
      registerCuttlefishLibraryFromSpecifier(join(srcDir, 'main.ts'), FIXTURE_SPECIFIER);
      expect(() => validateCuttlefishLibraries('arduino')).toThrow(/requires the 'zephyr' framework/);
      expect(() => validateCuttlefishLibraries('zephyr')).not.toThrow();
    });

    it('throws on build-target mismatch and accepts a prefix match', () => {
      registerCuttlefishLibraryFromSpecifier(join(srcDir, 'main.ts'), FIXTURE_SPECIFIER);
      expect(() => validateCuttlefishLibraries('zephyr', 'esp32c3_devkitm/esp32c3')).toThrow(
        /supports board targets/,
      );
      expect(() =>
        validateCuttlefishLibraries('zephyr', 'esp32s3_devkitc/esp32s3/procpu'),
      ).not.toThrow();
    });
  });

  describe('artifact emission (shims + sidecar)', () => {
    it('writes shims and the sidecar when the gate token appears in emitted sources', () => {
      registerCuttlefishLibraryFromSpecifier(join(srcDir, 'main.ts'), FIXTURE_SPECIFIER);
      writeFileSync(join(srcDir, 'main.cpp'), '#include "__tc_fake_rgb.h"\nrgbLed.color(1,2,3);\n');
      writeCuttlefishLibraryArtifacts(srcDir, srcDir);

      expect(readFileSync(join(srcDir, '__tc_fake_rgb.h'), 'utf8')).toBe('// fake shim header\n');
      expect(readFileSync(join(srcDir, '__tc_fake_rgb.cpp'), 'utf8')).toBe('// fake shim source\n');

      const sidecar = readCuttlefishLibrarySidecar(srcDir);
      expect(sidecar).toHaveLength(1);
      expect(sidecar[0]!.id).toBe('fake-rgb');
      expect(sidecar[0]!.kconfig).toEqual(['CONFIG_LED_STRIP=y']);
      expect(sidecar[0]!.overlay).toContain('frag.overlay');
      expect(sidecar[0]!.shims).toEqual(['__tc_fake_rgb.h', '__tc_fake_rgb.cpp']);
    });

    it('contributes nothing when the gate token is absent (sidecar written empty)', () => {
      registerCuttlefishLibraryFromSpecifier(join(srcDir, 'main.ts'), FIXTURE_SPECIFIER);
      writeFileSync(join(srcDir, 'main.cpp'), 'int main() { return 0; }\n');
      writeCuttlefishLibraryArtifacts(srcDir, srcDir);

      expect(existsSync(join(srcDir, '__tc_fake_rgb.h'))).toBe(false);
      expect(readCuttlefishLibrarySidecar(srcDir)).toEqual([]);
    });

    it('deletes stale shims when the library stops being used', () => {
      registerCuttlefishLibraryFromSpecifier(join(srcDir, 'main.ts'), FIXTURE_SPECIFIER);
      writeFileSync(join(srcDir, 'main.cpp'), '#include "__tc_fake_rgb.h"\n');
      writeCuttlefishLibraryArtifacts(srcDir, srcDir);
      expect(existsSync(join(srcDir, '__tc_fake_rgb.cpp'))).toBe(true);

      // Import removed: gate token gone → shims from the previous sidecar are cleaned up.
      writeFileSync(join(srcDir, 'main.cpp'), 'int main() { return 0; }\n');
      writeCuttlefishLibraryArtifacts(srcDir, srcDir);
      expect(existsSync(join(srcDir, '__tc_fake_rgb.h'))).toBe(false);
      expect(existsSync(join(srcDir, '__tc_fake_rgb.cpp'))).toBe(false);
      expect(existsSync(join(srcDir, LIBRARY_SIDECAR_NAME))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Registration through the graph builder — the regression guard for the
// .ui-entry bug: the .ui script loop blanket-skips @typecad/* specifiers, so
// the library check must run BEFORE that skip (demo-shadcn's app.ui import
// otherwise emitted rgbLed calls with no include/shim behind them).
// Files live under the repo's .build (gitignored) so node_modules lookup from
// the entry finds the workspace link (os.tmpdir() has no node_modules above).
// ---------------------------------------------------------------------------
import { collectTranspileGraph } from '../../../packages/cuttlefish/src/orchestrator/graph-builder';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

describe('library registration through collectTranspileGraph', () => {
  let dir: string;

  beforeEach(() => {
    resetCuttlefishLibraries();
    dir = join(repoRoot, '.build', `tc-lib-graph-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => {
    resetCuttlefishLibraries();
    rmSync(dir, { recursive: true, force: true });
  });

  it("registers a .ui script's @typecad-scoped library import (not dropped by the SDK skip)", async () => {
    writeFileSync(
      join(dir, 'app.ui'),
      [
        '<script>',
        "import { rgbLed } from '@typecad/zephyr-esp32s3-rgb';",
        'rgbLed.color(0, 255, 0).show();',
        '</script>',
        '<screen><view></view></screen>',
        '',
      ].join('\n'),
    );
    await collectTranspileGraph(join(dir, 'app.ui'));
    expect(getRegisteredCuttlefishLibraries().map((l) => l.manifest.id)).toContain('zephyr-esp32s3-rgb');
  });

  it("registers a plain .ts entry's library import and keeps the package out of the transpile graph", async () => {
    writeFileSync(
      join(dir, 'main.ts'),
      "import { rgbLed } from '@typecad/zephyr-esp32s3-rgb';\nrgbLed.off();\n",
    );
    const result = await collectTranspileGraph(join(dir, 'main.ts'));
    // Only the entry is transpiled — the library contributes shims, not TS.
    expect(result.files).toHaveLength(1);
    expect(getRegisteredCuttlefishLibraries().map((l) => l.manifest.id)).toContain('zephyr-esp32s3-rgb');
  });
});
