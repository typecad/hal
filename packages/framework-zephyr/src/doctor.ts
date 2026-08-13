// ---------------------------------------------------------------------------
// @typecad/framework-zephyr — Zephyr environment doctor
//
// `cuttlefish doctor` (Zephyr framework) — verify the installed Zephyr RTOS is
// reachable and inside the framework's declared compat range, and preview how
// the configured board target resolves for that version. Exits 0 if the
// environment is OK, non-zero otherwise. Mirrors framework-arduino's doctor
// shape (dispatched via the framework's `doctor` export).
// ---------------------------------------------------------------------------

import * as ui from '@typecad/cuttlefish/utils/ui';
import { loadCuttlefishConfig } from '@typecad/cuttlefish/config-loader';
import { detectZephyrVersion, checkZephyrCompat, resolveBoardTarget } from './toolchain/compat.js';

/**
 * Verify the installed Zephyr is reachable + inside the supported range, and
 * preview board-target normalization for the configured target. Sets
 * process.exitCode = 1 on an out-of-range Zephyr.
 */
export function runDoctor(): void {
  ui.printHeader();
  ui.printStep('Checking Zephyr environment...');

  const base = process.env.ZEPHYR_BASE;
  const version = detectZephyrVersion();
  const result = checkZephyrCompat(version);

  ui.printInfo(`ZEPHYR_BASE ..... ${base ?? '(not set)'}`);
  ui.printInfo(`Zephyr version .. ${version ?? 'unknown (could not read ZEPHYR_BASE/VERSION)'}`);
  ui.printInfo(`Supported range . ${result.range ?? '(none declared)'}`);

  if (result.status === 'out-of-range') {
    ui.printError(`Zephyr ${version} is OUTSIDE the supported range (${result.range}).`);
    ui.printInfo(
      "Set ZEPHYR_BASE to a compatible Zephyr checkout, or install one via '@typecad/zephyr-installer'.",
    );
    process.exitCode = 1;
    return;
  }

  if (result.status === 'undetectable') {
    ui.printWarning('Could not detect the Zephyr version (is ZEPHYR_BASE set?) — compat check skipped.');
  } else {
    ui.printInfo('Zephyr compat ... OK');
  }

  // Preview how the configured board target resolves for this Zephyr version
  // (e.g. a stale bare id would be qualified at build time). The loader extracts
  // frameworkData.buildTarget to a top-level field.
  const config = loadCuttlefishConfig(process.cwd());
  const buildTarget = config?.buildTarget;
  if (buildTarget) {
    const resolved = resolveBoardTarget(buildTarget, version);
    ui.printInfo(`Board target .... ${buildTarget}${resolved === buildTarget ? '' : ` → ${resolved}`}`);
  }
}
