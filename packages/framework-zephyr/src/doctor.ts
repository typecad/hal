// ---------------------------------------------------------------------------
// @typecad/framework-zephyr — Zephyr environment doctor
//
// `cuttlefish doctor` (Zephyr framework) — verify west (the Zephyr build tool)
// is installed + responsive, the Zephyr RTOS is inside the framework's declared
// compat range, and the configured board target exists in the checkout. Exits 0
// if the environment is OK, non-zero otherwise. Mirrors framework-arduino's
// doctor shape (dispatched via the framework's `doctor` export) and reuses
// checkZephyrEnv so the detection logic can be shared with the build/test gates.
// ---------------------------------------------------------------------------

import * as ui from '@typecad/cuttlefish/utils/ui';
import { loadCuttlefishConfig } from '@typecad/cuttlefish/config-loader';
import { checkZephyrEnv } from './toolchain/env-check.js';

/**
 * Verify west is installed + responsive, the Zephyr RTOS is inside the supported
 * range, and the configured board target exists in the checkout. Sets
 * process.exitCode = 1 on failure. Thin presenter over checkZephyrEnv.
 */
export function runDoctor(): void {
  ui.printHeader();
  ui.printStep('Checking Zephyr environment...');

  const config = loadCuttlefishConfig(process.cwd());
  const buildTarget = config?.buildTarget;

  const result = checkZephyrEnv(buildTarget);
  const c = result.check;

  // west (the Zephyr build tool) — the analog of arduino-cli presence.
  if (c.westFound) {
    const ver = c.westVersion ?? 'found';
    const src = c.westSource ? `  (${c.westSource})` : '';
    ui.printInfo(`west ............. ${ver}  ✓${src}`);
  } else {
    ui.printError('west ............. NOT FOUND');
  }

  // Zephyr RTOS version + declared compat range.
  ui.printInfo(`ZEPHYR_BASE ...... ${c.zephyrBase ?? '(not set)'}`);
  ui.printInfo(`Zephyr version .. ${c.zephyrVersion ?? 'unknown (could not read ZEPHYR_BASE/VERSION)'}`);
  ui.printInfo(`Supported range . ${c.compatRange ?? '(none declared)'}`);

  if (c.compatStatus === 'out-of-range') {
    ui.printError(`Zephyr ${c.zephyrVersion} is OUTSIDE the supported range (${c.compatRange}).`);
  } else if (c.compatStatus === 'undetectable') {
    ui.printWarning('Could not detect the Zephyr version (is ZEPHYR_BASE set?) — compat check skipped.');
  } else {
    ui.printInfo('Zephyr compat ... OK');
  }

  // Board target — the analog of the Arduino core presence check.
  if (buildTarget) {
    const resolved = c.resolvedBoardTarget ?? buildTarget;
    const arrow = resolved === buildTarget ? '' : ` → ${resolved}`;
    if (c.boardTargetSupported === false) {
      ui.printError(`Board target .... ${buildTarget}${arrow}  NOT found in this Zephyr checkout`);
      ui.printInfo('  → check the board id, or run: west boards');
    } else if (c.boardTargetSupported === undefined) {
      ui.printInfo(`Board target .... ${buildTarget}${arrow}`);
      ui.printInfo('(could not verify board presence — no ZEPHYR_BASE boards/ tree found)');
    } else {
      ui.printInfo(`Board target .... ${buildTarget}${arrow}`);
    }
  } else {
    ui.printInfo('(no buildTarget in cuttlefish.config.ts — skipping board check)');
  }

  // Exit code — mirrors framework-arduino's doctor.
  if (result.ok) {
    ui.printSuccess('Environment OK');
    return; // exitCode stays unset => 0
  }
  for (const line of result.messages) ui.printInfo(line);
  process.exitCode = 1;
}
