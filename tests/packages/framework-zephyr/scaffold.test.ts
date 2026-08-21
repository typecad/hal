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
