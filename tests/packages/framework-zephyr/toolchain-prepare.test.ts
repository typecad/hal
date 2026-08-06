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
    // prepare() writes the board overlay to <projectRoot>/boards/<boardId>.overlay
    // (boardId is the bare board id before any hardware-qualifier suffix).
    const overlayPath = join(dir, 'boards', 'xiao_ble.overlay');
    expect(existsSync(overlayPath)).toBe(true);
    const txt = readFileSync(overlayPath, 'utf8');
    expect(txt).toContain('&i2c1');
    expect(txt).toContain('status = "okay"');
  });

  it('enables the display DT node when the program uses the display', () => {
    const srcDir = join(dir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'main.cpp'), 'int main(){ display_init(); display_fill_rect(); return 0; }');
    Toolchain.prepare(dir, join(srcDir, 'main.cpp'));
    const txt = readFileSync(join(dir, 'boards', 'xiao_ble.overlay'), 'utf8');
    // The display node is emitted as a full / { mipi-dbi { display0: display@0 } }
    // definition (boards have no display node to enable with &display0), so assert
    // on the label + compatible.
    expect(txt).toContain('display0: display@0');
    expect(txt).toContain('compatible = "sitronix,st7796s"');
  });

  it('omits the display node when the program does not use the display', () => {
    const srcDir = join(dir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'main.cpp'), 'int main(){ gpio_pin_set(); return 0; }');
    Toolchain.prepare(dir, join(srcDir, 'main.cpp'));
    const txt = readFileSync(join(dir, 'boards', 'xiao_ble.overlay'), 'utf8');
    expect(txt).not.toContain('display0: display@0');
  });
});
