import { describe, it, expect } from 'vitest';
import {
  buildFlashArgs,
  resolveProbeMethod,
  classifyUploadResult,
  cleanseUploadOutput,
} from '../../../packages/framework-zephyr/src/toolchain';
import type { ZephyrChipDescriptor } from '../../../packages/framework-zephyr/src/chips/types';

// Board-package chip shape (probeMethods table) for the resolution tests.
const BLACKPILL: ZephyrChipDescriptor = {
  id: 'blackpill_f411ce/stm32f411xe', soc: 'stm32f411', gpioController: 'gpioa',
  gpio: { dtSpecs: [] },
  probeMethods: [
    { id: 'stlink', runner: 'openocd', args: ['--cmd-pre-init=reset_config none'], debug: true },
    { id: 'dfu', runner: 'dfu-util', debug: false },
    { id: 'jlink', runner: 'jlink', debug: true },
  ],
};
const NO_TABLE: ZephyrChipDescriptor = {
  id: 'esp32s3_devkitc', soc: 'esp32s3', gpioController: 'gpio0', gpio: { dtSpecs: [] },
};

describe('resolveProbeMethod (zephyr.probe → runner + args)', () => {
  it("maps the friendly id to the method's runner AND args (quirks included)", () => {
    const r = resolveProbeMethod({ probe: 'stlink' }, BLACKPILL);
    expect(r).toEqual({
      ok: true,
      runner: 'openocd',
      args: ['--cmd-pre-init=reset_config none'],
    });
  });

  it('appends user runnerArgs AFTER the method args (so they can override)', () => {
    const r = resolveProbeMethod(
      { probe: 'stlink', runnerArgs: ['--cmd-pre-init=reset_config srst_only'] },
      BLACKPILL,
    ) as Extract<ReturnType<typeof resolveProbeMethod>, { ok: true }>;
    expect(r.args).toEqual([
      '--cmd-pre-init=reset_config none',
      '--cmd-pre-init=reset_config srst_only',
    ]);
  });

  it('rejects probe + runner together (two ways of saying it)', () => {
    const r = resolveProbeMethod({ probe: 'stlink', runner: 'openocd' }, BLACKPILL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('zephyr.probe');
  });

  it('lists the supported methods on an unknown id', () => {
    const r = resolveProbeMethod({ probe: 'swd' }, BLACKPILL);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("'swd'");
      expect(r.error).toContain('stlink');
      expect(r.error).toContain('dfu');
      expect(r.error).toContain('jlink');
    }
  });

  it('hints at zephyr.runner for boards without a probeMethods table', () => {
    const r = resolveProbeMethod({ probe: 'stlink' }, NO_TABLE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('zephyr.runner');
  });

  it('resolves identically for the debug purpose when the method can debug', () => {
    const r = resolveProbeMethod({ probe: 'stlink' }, BLACKPILL, 'debug');
    expect(r).toEqual({ ok: true, runner: 'openocd', args: ['--cmd-pre-init=reset_config none'] });
  });

  it("rejects a bootloader for the debug purpose and lists the debug-capable methods", () => {
    const r = resolveProbeMethod({ probe: 'dfu' }, BLACKPILL, 'debug');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('cannot debug');
      expect(r.error).toContain('stlink');
      expect(r.error).toContain('jlink');
      expect(r.error).not.toContain('dfu,');
    }
  });

  it('passes the raw runner through untouched (escape hatch)', () => {
    expect(resolveProbeMethod({ runner: 'jlink', runnerArgs: ['--speed=4000'] }, BLACKPILL))
      .toEqual({ ok: true, runner: 'jlink', args: ['--speed=4000'] });
    expect(resolveProbeMethod(undefined, BLACKPILL)).toEqual({ ok: true, runner: undefined, args: [] });
  });
});

describe('buildFlashArgs (west flash runner selection)', () => {
  it('trusts the board.cmake default when no runner applies (no forced nrfjprog)', () => {
    // Regression: xiao_ble's board.cmake defaults to nrfutil, not nrfjprog.
    // The framework must not override that default — forcing nrfjprog broke
    // USB-bootloader boards that have no Nordic J-Link tooling installed.
    const args = buildFlashArgs('/proj/build', undefined, 'COM9', undefined);
    expect(args).toEqual(['flash', '-d', '/proj/build']);
    // No runner injected: west resolves the board.cmake default itself.
    expect(args).not.toContain('--runner');
    expect(args).not.toContain('nrfjprog');
  });


  it('appends runnerArgs verbatim after the runner (ST-Link openocd reset_config)', () => {
    const args = buildFlashArgs(
      '/proj/build', 'openocd', undefined, undefined,
      ['--cmd-pre-init=reset_config none'],
    );
    expect(args).toEqual([
      'flash', '-d', '/proj/build',
      '--runner', 'openocd',
      '--cmd-pre-init=reset_config none',
    ]);
  });

  it('does not force a runner even when no port is given', () => {
    const args = buildFlashArgs('/proj/build', undefined, undefined, undefined);
    expect(args).toEqual(['flash', '-d', '/proj/build']);
    expect(args).not.toContain('--runner');
  });

  it('forwards the port via --esp-device whenever esptool is the flash runner', () => {
    // esptool reads the device from --esp-device. Runner-gated, never
    // board-name-gated: the resolved flash runner (explicit choice OR the
    // board's declared default) decides, so any esptool board is treated
    // identically.
    const viaDefault = buildFlashArgs('/proj/build', undefined, 'COM5', 'esptool');
    expect(viaDefault).toContain('--esp-device');
    expect(viaDefault).toContain('COM5');
    // board.cmake still selects the runner — no forced --runner.
    expect(viaDefault).not.toContain('--runner');
    const viaExplicit = buildFlashArgs('/proj/build', 'esptool', 'COM5', 'esptool');
    expect(viaExplicit).toEqual([
      'flash', '-d', '/proj/build',
      '--runner', 'esptool',
      '--esp-device', 'COM5',
    ]);
  });

  it('lets an explicit zephyr.runner override the board default', () => {
    const args = buildFlashArgs('/proj/build', 'jlink', undefined, undefined);
    expect(args).toEqual(['flash', '-d', '/proj/build', '--runner', 'jlink']);
  });

  it('forwards the port via --bossac-port for the bossac runner', () => {
    // Regression: bossac defaults its port to /dev/ttyACM0, which never
    // matches on Windows — "No device found on /dev/ttyACM0" — so the port
    // must be forwarded explicitly (Nano 33 IoT / SAMD21 bootloader flash).
    const args = buildFlashArgs('/proj/build', 'bossac', 'COM8', 'bossac');
    expect(args).toEqual([
      'flash', '-d', '/proj/build',
      '--runner', 'bossac',
      '--bossac-port', 'COM8',
    ]);
  });

  it('no port forwarding for runners that do not take one', () => {
    const args = buildFlashArgs('/proj/build', 'openocd', undefined, undefined);
    expect(args).toEqual(['flash', '-d', '/proj/build', '--runner', 'openocd']);
  });
});

describe('classifyUploadResult (west flash exit-status interpretation)', () => {
  it('treats exit 0 as success', () => {
    expect(classifyUploadResult('uf2', 0, '')).toBe(true);
    expect(classifyUploadResult('nrfutil', 0, '')).toBe(true);
    expect(classifyUploadResult(undefined, 0, '')).toBe(true);
  });

  it('treats the uf2 WinError 433 copymode race as success (firmware flashed)', () => {
    // Regression: the UF2 bootloader reboots the instant the file copy finishes,
    // unmounting the drive before shutil.copy's trailing chmod. west exits
    // non-zero with this traceback even though the flash succeeded. The copy
    // having started ("Copying UF2 file to") proves the data reached the drive.
    const out = [
      '-- runners.uf2: Copying UF2 file to \'D:\\\'',
      "OSError: [WinError 433] A device which does not exist was specified: 'D:\\zephyr.uf2'",
      'File "...shutil.py", line 317, in copymode',
    ].join('\n');
    expect(classifyUploadResult('uf2', 1, out)).toBe(true);
  });

  it('does not mask a uf2 failure that never started copying', () => {
    // "No matching UF2 partitions found" is a genuine failure — the board was
    // not in bootloader mode. Must NOT be reclassified as success.
    const out = 'RuntimeError: No matching UF2 partitions found';
    expect(classifyUploadResult('uf2', 1, out)).toBe(false);
  });

  it('does not mask a uf2 write error that lacks the copymode signature', () => {
    // A copy that fails before the drive vanishes (e.g. disk full) is real.
    const out = "-- runners.uf2: Copying UF2 file to 'D:\\'\nOSError: [Errno 28] No space left";
    expect(classifyUploadResult('uf2', 1, out)).toBe(false);
  });

  it('does not apply the uf2 tolerance to other runners', () => {
    // The WinError-433 mitigation is uf2-specific; a non-zero nrfutil exit is
    // a real failure regardless of the traceback text.
    const out = "-- runners.nrfutil: Copying UF2 file to 'D:\\'\nOSError: [WinError 433]";
    expect(classifyUploadResult('nrfutil', 1, out)).toBe(false);
    expect(classifyUploadResult(undefined, 1, out)).toBe(false);
  });
});

describe('cleanseUploadOutput (suppress benign uf2 traceback noise)', () => {
  const raceOutput = [
    "-- west flash: using runner uf2",
    "-- runners.uf2: Copying UF2 file to 'D:\\'",
    'Traceback (most recent call last):',
    "  OSError: [WinError 433] A device which does not exist was specified: 'D:\\zephyr.uf2'",
    '  File "...shutil.py", line 317, in copymode',
  ].join('\n');

  it('strips the traceback on a benign uf2 drive-vanish race', () => {
    const cleansed = cleanseUploadOutput('uf2', 1, raceOutput);
    // The "Copying UF2 file to" line is preserved (it shows the flash happened).
    expect(cleansed).toContain("Copying UF2 file to 'D:\\'");
    // The scary Python traceback and WinError are gone — nothing after the copy.
    expect(cleansed).not.toContain('Traceback');
    expect(cleansed).not.toContain('WinError 433');
    expect(cleansed).not.toContain('copymode');
    // The output ends at the "Copying UF2 file to" line (no extra note).
    expect(cleansed.trim()).toBe("-- west flash: using runner uf2\n-- runners.uf2: Copying UF2 file to 'D:\\'");
  });

  it('leaves a clean exit-0 output untouched', () => {
    const out = "-- runners.uf2: Copying UF2 file to 'D:\\'\nDone.";
    expect(cleanseUploadOutput('uf2', 0, out)).toBe(out);
  });

  it('leaves a genuine uf2 failure (no partition) fully visible', () => {
    const out = 'RuntimeError: No matching UF2 partitions found';
    // Not a drive-vanish race → must not be cleansed.
    expect(cleanseUploadOutput('uf2', 1, out)).toBe(out);
  });

  it('does not cleanse other runners even when the race text appears', () => {
    // The mitigation is uf2-only; nrfutil output is returned verbatim.
    expect(cleanseUploadOutput('nrfutil', 1, raceOutput)).toBe(raceOutput);
  });
});
