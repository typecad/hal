// ---------------------------------------------------------------------------
// @typecad/framework-zephyr — Zephyr environment doctor
//
// `typecad-hal doctor` (Zephyr framework) — verify west (the Zephyr build tool)
// is installed + responsive, the Zephyr RTOS is inside the framework's declared
// compat range, and the configured board target exists in the checkout. Exits 0
// if the environment is OK, non-zero otherwise. Follows the same contract
// doctor shape (dispatched via the framework's `doctor` export) and reuses
// checkZephyrEnv so the detection logic can be shared with the build/test gates.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ui from '@typecad/cuttlefish/utils/ui';
import { loadTypecadConfig } from '@typecad/cuttlefish/config-loader';
import { checkZephyrEnv } from './toolchain/env-check.js';
import { PINNED_ZEPHYR_MANIFEST_REV, PINNED_ZEPHYR_SDK_VERSION, sdkFingerprint } from '@typecad/cuttlefish/board-catalog';
import { resolveChipFromBoard } from './chips/resolve.js';

/**
 * Verify west is installed + responsive, the Zephyr RTOS is inside the supported
 * range, and the configured board target exists in the checkout. Sets
 * process.exitCode = 1 on failure. Thin presenter over checkZephyrEnv.
 */
export function runDoctor(): void {
  ui.printHeader();
  ui.printStep('Checking Zephyr environment...');

  const config = loadTypecadConfig(process.cwd());
  const buildTarget = config?.buildTarget;

  const result = checkZephyrEnv(buildTarget);
  const c = result.check;

  // west (the Zephyr build tool) presence.
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
  ui.printInfo(`Workspace pin ... ${PINNED_ZEPHYR_MANIFEST_REV} (SDK ${PINNED_ZEPHYR_SDK_VERSION})`);
  const fp = c.zephyrBase ? sdkFingerprint(c.zephyrBase) : undefined;
  ui.printInfo(`SDK fingerprint . ${fp ?? '(no tree — run ' + 'npx --package @typecad/framework-zephyr zephyr-installer)'}`);
  ui.printInfo(`Supported range . ${c.compatRange ?? '(none declared)'}`);

  if (c.compatStatus === 'out-of-range') {
    ui.printError(`Zephyr ${c.zephyrVersion} is OUTSIDE the supported range (${c.compatRange}).`);
  } else if (c.compatStatus === 'undetectable') {
    ui.printWarning('Could not detect the Zephyr version (is ZEPHYR_BASE set?) — compat check skipped.');
  } else {
    ui.printInfo('Zephyr compat ... OK');
  }

  // Board target availability.
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
    ui.printInfo('(no buildTarget in typecad-hal.config.ts — skipping board check)');
  }

  // Probe methods — from the board package's table, via the board constants
  // the transpile persists (candidates cover the standard out-dir layouts).
  // The debug line lists the debug-capable subset (bootloaders can't debug).
  if (buildTarget) {
    const bcPath = [
      join(process.cwd(), 'out', 'src', 'board-constants.json'),
      join(process.cwd(), 'out', 'board-constants.json'),
      join(process.cwd(), 'src', 'out', 'src', 'board-constants.json'),
      join(process.cwd(), 'src', 'out', 'board-constants.json'),
    ].find((p) => existsSync(p));
    if (bcPath) {
      try {
        const raw = JSON.parse(readFileSync(bcPath, 'utf8')) as Record<string, string | number | boolean>;
        const chip = resolveChipFromBoard(new Map(Object.entries(raw)));
        const methods = chip?.probeMethods ?? [];
        if (methods.length > 0) {
          ui.printInfo(`Probe methods .... ${methods.map((m) => m.id).join(', ')}  (zephyr.probe / --probe)`);
          const debuggable = methods.filter((m) => m.debug !== false).map((m) => m.id);
          ui.printInfo(`Debug methods .... ${debuggable.join(', ') || '(none — an external probe is required)'}`);
        }
      } catch { /* best-effort listing */ }
    } else {
      ui.printInfo('Probe methods .... (build once to list them)');
    }
  }

  // Exit code — 0 ok, non-zero otherwise.
  if (result.ok) {
    ui.printSuccess('Environment OK');
    return; // exitCode stays unset => 0
  }
  for (const line of result.messages) ui.printInfo(line);
  process.exitCode = 1;
}
