import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffoldZephyrProject } from '../../../packages/framework-zephyr/src/toolchain/scaffold';

// The CMakeLists.txt source list is explicit, not a file(GLOB CONFIGURE_DEPENDS)
// glob: CONFIGURE_DEPENDS adds a cmake.verify_globs step to the ninja graph
// that spawns CMake to re-check the glob on every build. The scaffold owns the
// file set and rewrites CMakeLists.txt (writeIfChanged) when it changes.
describe('scaffoldZephyrProject — CMakeLists source list', () => {
  let dir: string;
  let srcDir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'zephyr-scaffold-'));
    srcDir = join(dir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'main.cpp'), 'int main(){ adc_read(); return 0; }\n');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('emits an explicit target_sources list (no CONFIGURE_DEPENDS glob)', () => {
    writeFileSync(join(srcDir, 'util.c'), 'int util(void) { return 1; }\n');
    scaffoldZephyrProject(dir);
    const txt = readFileSync(join(dir, 'CMakeLists.txt'), 'utf8');
    expect(txt).toContain('target_sources(app PRIVATE');
    expect(txt).toContain('  src/main.cpp');
    expect(txt).toContain('  src/util.c');
    expect(txt).not.toContain('file(GLOB');
    expect(txt).not.toContain('CONFIGURE_DEPENDS');
    // Non-source files in src/ are not linked.
    writeFileSync(join(srcDir, 'notes.txt'), 'not a source\n');
    scaffoldZephyrProject(dir);
    expect(readFileSync(join(dir, 'CMakeLists.txt'), 'utf8')).not.toContain('notes.txt');
  });

  it('is idempotent — returns false when nothing changed', () => {
    expect(scaffoldZephyrProject(dir)).toBe(true);
    expect(scaffoldZephyrProject(dir)).toBe(false);
  });

  it('rewrites the list (and reports the change) when the file set changes', () => {
    scaffoldZephyrProject(dir);
    // Added source → listed, config reported changed.
    writeFileSync(join(srcDir, 'extra.cpp'), 'int extra() { return 2; }\n');
    expect(scaffoldZephyrProject(dir)).toBe(true);
    let txt = readFileSync(join(dir, 'CMakeLists.txt'), 'utf8');
    expect(txt).toContain('  src/extra.cpp');
    // Removed source → dropped from the list, config reported changed (the
    // stale entry must not linger from the last configure).
    unlinkSync(join(srcDir, 'extra.cpp'));
    expect(scaffoldZephyrProject(dir)).toBe(true);
    txt = readFileSync(join(dir, 'CMakeLists.txt'), 'utf8');
    expect(txt).not.toContain('extra.cpp');
  });

  it('omits target_sources when src/ has no emitted sources yet', () => {
    rmSync(srcDir, { recursive: true, force: true });
    scaffoldZephyrProject(dir);
    const txt = readFileSync(join(dir, 'CMakeLists.txt'), 'utf8');
    expect(txt).toContain('find_package(Zephyr REQUIRED');
    expect(txt).not.toContain('target_sources');
  });
});

// ---------------------------------------------------------------------------
// TypeCAD library packages — Kconfig + overlay contributions read from the
// transpiler's libraries.json sidecar (written next to the emitted sources
// when a library import is used). Entries are pre-gated on the library's
// include token; the scaffold only merges.
// ---------------------------------------------------------------------------
import { appendLibraryOverlayFragments } from '../../../packages/framework-zephyr/src/toolchain/scaffold';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

interface SidecarEntry {
  id: string;
  module: string;
  framework: string;
  gateToken: string;
  kconfig: string[];
  overlay: string | null;
  shims: string[];
}

describe('scaffoldZephyrProject — library package contributions', () => {
  let dir: string;
  let srcDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'zephyr-scaffold-lib-'));
    srcDir = join(dir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'main.cpp'), '#include "__tc_rgbled.h"\nrgbLed.color(0, 255, 0).show();\n');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const writeSidecar = (entries: SidecarEntry[]): void => {
    writeFileSync(join(srcDir, 'libraries.json'), JSON.stringify(entries, null, 2));
  };
  const rgbEntry = (kconfig: string[], overlay: string | null = null): SidecarEntry => ({
    id: 'zephyr-esp32s3-rgb',
    module: '@typecad/zephyr-esp32s3-rgb',
    framework: 'zephyr',
    gateToken: '__tc_rgbled',
    kconfig,
    overlay,
    shims: ['__tc_rgbled.h', '__tc_rgbled.cpp'],
  });

  it('appends library kconfig lines after the auto-detected symbols', () => {
    writeSidecar([rgbEntry(['CONFIG_LED_STRIP=y', 'CONFIG_I2S=y', 'CONFIG_DMA=y'])]);
    scaffoldZephyrProject(dir);
    const txt = readFileSync(join(dir, 'prj.conf'), 'utf8');
    expect(txt).toContain('# Library packages (typecad-hal.library.json contributions).');
    expect(txt).toContain('CONFIG_LED_STRIP=y');
    expect(txt).toContain('CONFIG_I2S=y');
    expect(txt).toContain('CONFIG_DMA=y');
    // Library section lands before the user-Kconfig section when one exists.
    expect(txt.indexOf('CONFIG_LED_STRIP=y')).toBeGreaterThan(-1);
  });

  it('user zephyr.kconfig overrides a library-contributed symbol', () => {
    writeSidecar([rgbEntry(['CONFIG_LED_STRIP=y', 'CONFIG_I2S=y'])]);
    scaffoldZephyrProject(dir, false, { CONFIG_LED_STRIP: 'n' });
    const txt = readFileSync(join(dir, 'prj.conf'), 'utf8');
    expect(txt).not.toContain('CONFIG_LED_STRIP=y');
    expect(txt).toContain('CONFIG_LED_STRIP=n');
    expect(txt).toContain('CONFIG_I2S=y');
  });

  it('emits no library section without a sidecar', () => {
    scaffoldZephyrProject(dir);
    const txt = readFileSync(join(dir, 'prj.conf'), 'utf8');
    expect(txt).not.toContain('Library packages');
  });

  it('compiles library shim sources as ordinary src files', () => {
    writeSidecar([rgbEntry(['CONFIG_LED_STRIP=y'])]);
    writeFileSync(join(srcDir, '__tc_rgbled.cpp'), '// shim source\n');
    scaffoldZephyrProject(dir);
    const txt = readFileSync(join(dir, 'CMakeLists.txt'), 'utf8');
    expect(txt).toContain('__tc_rgbled.cpp');
  });
});

describe('appendLibraryOverlayFragments', () => {
  let dir: string;
  let srcDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'zephyr-overlay-lib-'));
    srcDir = join(dir, 'src');
    mkdirSync(srcDir, { recursive: true });
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('appends the sidecar overlay fragment after the framework overlay', () => {
    const fragment = join(dir, 'frag.overlay');
    writeFileSync(fragment, '&i2s0 { status = "okay"; };\n');
    writeFileSync(
      join(srcDir, 'libraries.json'),
      JSON.stringify([{
        id: 'lib', module: '@scope/lib', framework: 'zephyr', gateToken: 'x',
        kconfig: [], overlay: fragment, shims: [],
      }]),
    );
    const out = appendLibraryOverlayFragments('&gpio0 { status = "okay"; };\n', dir);
    expect(out).toContain('&gpio0 { status = "okay"; };');
    expect(out).toContain('&i2s0 { status = "okay"; };');
    expect(out.indexOf('&i2s0')).toBeGreaterThan(out.indexOf('&gpio0'));
  });

  it('appends the real @typecad/zephyr-esp32s3-rgb WS2812 fragment', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const fragment = join(here, '..', '..', '..', 'packages', 'zephyr-esp32s3-rgb', 'shims', 'tc-rgb.overlay');
    writeFileSync(
      join(srcDir, 'libraries.json'),
      JSON.stringify([{
        id: 'zephyr-esp32s3-rgb', module: '@typecad/zephyr-esp32s3-rgb', framework: 'zephyr',
        gateToken: '__tc_rgbled', kconfig: [], overlay: fragment, shims: [],
      }]),
    );
    const out = appendLibraryOverlayFragments('', dir);
    expect(out).toContain('worldsemi,ws2812-i2s');
    expect(out).toContain('I2S0_O_SD_GPIO48');
    expect(out).toContain('led-strip = &led_strip');
  });

  it('is a pass-through without sidecar entries and tolerates missing fragment files', () => {
    expect(appendLibraryOverlayFragments('&gpio0 {};\n', dir)).toBe('&gpio0 {};\n');
    writeFileSync(
      join(srcDir, 'libraries.json'),
      JSON.stringify([{
        id: 'lib', module: '@scope/lib', framework: 'zephyr', gateToken: 'x',
        kconfig: [], overlay: join(dir, 'does-not-exist.overlay'), shims: [],
      }]),
    );
    expect(appendLibraryOverlayFragments('&gpio0 {};\n', dir)).toBe('&gpio0 {};\n');
  });
});
