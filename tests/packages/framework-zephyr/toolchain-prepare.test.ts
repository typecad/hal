import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Toolchain } from '../../../packages/framework-zephyr/src/toolchain';

describe('Toolchain.prepare writes the DT overlay', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zephyr-prepare-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('writes app/boards/<board>.overlay with enabled peripherals', () => {
    // Minimal emitted source that triggers i2c usage.
    const srcDir = join(dir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'main.cpp'), 'int main(){ i2c_transfer(); return 0; }');
    Toolchain.prepare(dir, join(srcDir, 'main.cpp'));
    const overlayPath = join(dir, 'app', 'boards', 'xiao_ble.overlay');
    expect(existsSync(overlayPath)).toBe(true);
    const txt = readFileSync(overlayPath, 'utf8');
    expect(txt).toContain('&i2c1');
    expect(txt).toContain('status = "okay"');
  });
});
