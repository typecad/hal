// ---------------------------------------------------------------------------
// can-usage-scan.test.ts — the CAN usage token is __tc_can, not 'can_'.
//
// Regression: the usage detector was src.includes('can_'), and the WiFi
// scan shim's own identifiers (scan_count, scan_results) contain that
// substring — every WiFi program enabled the can@ controller in its
// overlay, and on Zephyr 4.4.2 the esp32 TWAI binding requires pinctrl-0,
// which the plain enable does not provide: hard devicetree failure for
// every WiFi build on that board. The CAN shim's unambiguous prefix is
// __tc_can (every emitted CAN identifier derives from it).
// ----------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffoldZephyrProject } from '../../../packages/framework-zephyr/src/toolchain/scaffold';

describe('CAN usage gating (the can_ substring false positive)', () => {
  let wifiProject: string;
  let canProject: string;

  beforeAll(() => {
    wifiProject = mkdtempSync(join(tmpdir(), 'tc-wifi-scan-'));
    mkdirSync(join(wifiProject, 'src'), { recursive: true });
    // The WiFi scan shim's state block — contains scan_count/scan_results,
    // the identifiers that matched the old 'can_' token.
    writeFileSync(join(wifiProject, 'src', 'main.cpp'),
      'static struct { int32_t scan_count; struct wifi_scan_result scan_results[16]; } __tc_wifi;\n' +
      'int main() { return 0; }\n');

    canProject = mkdtempSync(join(tmpdir(), 'tc-can-'));
    mkdirSync(join(canProject, 'src'), { recursive: true });
    writeFileSync(join(canProject, 'src', 'main.cpp'),
      'static void __tc_can0_send(void) {}\n' +
      'int main() { return 0; }\n');
  });

  afterAll(() => {
    rmSync(wifiProject, { recursive: true, force: true });
    rmSync(canProject, { recursive: true, force: true });
  });

  it('does not enable CONFIG_CAN for a WiFi program (scan_count ≠ can_)', () => {
    scaffoldZephyrProject(wifiProject);
    const prj = readFileSync(join(wifiProject, 'prj.conf'), 'utf8');
    expect(prj).not.toMatch(/CONFIG_CAN=y/);
  });

  it('enables CONFIG_CAN for a program that uses the CAN shim (__tc_can)', () => {
    scaffoldZephyrProject(canProject);
    const prj = readFileSync(join(canProject, 'prj.conf'), 'utf8');
    expect(prj).toMatch(/CONFIG_CAN=y/);
  });
});
