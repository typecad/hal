import { describe, it, expect } from 'vitest';
import {
  buildFlashArgs,
  classifyUploadResult,
  cleanseUploadOutput,
} from '../../../packages/framework-zephyr/src/toolchain';

describe('buildFlashArgs (west flash runner selection)', () => {
  it('trusts the board.cmake default for non-ESP32 boards (no forced nrfjprog)', () => {
    // Regression: xiao_ble's board.cmake defaults to nrfutil, not nrfjprog.
    // The framework must not override that default — forcing nrfjprog broke
    // USB-bootloader boards that have no Nordic J-Link tooling installed.
    const args = buildFlashArgs('/proj/build', 'xiao_ble', undefined, 'COM9');
    expect(args).toEqual(['flash', '-d', '/proj/build']);
    // No runner injected: west resolves the board.cmake default itself.
    expect(args).not.toContain('--runner');
    expect(args).not.toContain('nrfjprog');
  });

  it('does not force a runner even when no port is given', () => {
    const args = buildFlashArgs('/proj/build', 'xiao_ble', undefined, undefined);
    expect(args).toEqual(['flash', '-d', '/proj/build']);
    expect(args).not.toContain('--runner');
  });

  it('forwards the port via --esp-device for ESP32 boards', () => {
    // esptool reads the device from --esp-device; board.cmake picks the runner.
    const args = buildFlashArgs('/proj/build', 'esp32s3_devkitc', undefined, 'COM5');
    expect(args).toContain('--esp-device');
    expect(args).toContain('COM5');
    // ESP32 lets board.cmake select esptool — no explicit --runner either.
    expect(args).not.toContain('--runner');
  });

  it('lets an explicit zephyr.runner override the board default', () => {
    const args = buildFlashArgs('/proj/build', 'xiao_ble', 'jlink', undefined);
    expect(args).toEqual(['flash', '-d', '/proj/build', '--runner', 'jlink']);
  });

  it('honors an explicit runner even on ESP32 (no --esp-device without a port)', () => {
    const args = buildFlashArgs('/proj/build', 'esp32_devkitc', 'openocd', undefined);
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
