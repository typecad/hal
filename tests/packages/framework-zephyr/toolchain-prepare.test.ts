import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateBoard } from '../../../packages/framework-zephyr/src/boardgen';
import { Toolchain } from '../../../packages/framework-zephyr/src/toolchain';

function generatedConstants(target: string): Map<string, string | number | boolean> {
  const g = generateBoard(target);
  return new Map(Object.entries(JSON.parse(g.boardJson).constants));
}

describe('Toolchain.prepare writes the DT overlay', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zephyr-prepare-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('writes app/boards/<board>.overlay with enabled peripherals', () => {
    // Minimal emitted source that triggers i2c usage. The overlay generator
    // reads the chip view from the persisted board constants — seed them the
    // way a real transpile does.
    const srcDir = join(dir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'main.cpp'), 'int main(){ i2c_transfer(); return 0; }');
    writeFileSync(join(dir, 'src', 'board-constants.json'), JSON.stringify(Object.fromEntries(generatedConstants('xiao_ble/nrf52840'))));
    Toolchain.prepare(dir, join(srcDir, 'main.cpp'));
    // prepare() writes the overlay BEFORE the real target is known — the
    // placeholder file is boards/board.overlay (compile rewrites it under
    // the actual board id).
    const overlayPath = join(dir, 'boards', 'board.overlay');
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
    const txt = readFileSync(join(dir, 'boards', 'board.overlay'), 'utf8');
    // The display node is emitted as a full / { mipi-dbi { display0: display@0 } }
    // definition (boards have no display node to enable with &display0), so assert
    // on the label + compatible. The default profile is the ILI9341, so the
    // compatible follows its controller.
    expect(txt).toContain('display0: display@0');
    expect(txt).toContain('compatible = "ilitek,ili9341"');
  });

  it('recovers the display profile from the adapter marker, not the default profile', () => {
    // Regression: a st7796-zephyr build used to get the default ILI9341
    // profile's DT node (wrong controller/compatible/geometry) because the
    // toolchain never learned which profile the adapter emitted. The adapter
    // now stamps `typecad-display-profile: <driver>` and prepare() looks it
    // up in the profile registry.
    const srcDir = join(dir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, 'main.cpp'),
      '// typecad-display-profile: st7796-zephyr\nint main(){ display_init(); return 0; }',
    );
    Toolchain.prepare(dir, join(srcDir, 'main.cpp'));
    const txt = readFileSync(join(dir, 'boards', 'board.overlay'), 'utf8');
    expect(txt).toContain('compatible = "sitronix,st7796s"');
    expect(txt).toContain('madctl = <0x28>');
    expect(txt).not.toContain('compatible = "ilitek,ili9341"');
    // Native panel geometry (320x480 portrait raster), not the effective dims.
    expect(txt).toContain('width = <320>');
    expect(txt).toContain('height = <480>');
  });

  it('omits the display node when the program does not use the display', () => {
    const srcDir = join(dir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'main.cpp'), 'int main(){ gpio_pin_set(); return 0; }');
    Toolchain.prepare(dir, join(srcDir, 'main.cpp'));
    const txt = readFileSync(join(dir, 'boards', 'board.overlay'), 'utf8');
    expect(txt).not.toContain('display0: display@0');
  });
});
