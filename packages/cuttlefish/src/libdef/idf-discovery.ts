// Minimal IDF discovery for the gen-decls pre-transpile pass.
//
// We can't import framework-esp32's discovery from cuttlefish (it would
// create a package dependency from core → framework). This module mirrors
// the cheapest strategies from framework-esp32/src/toolchain/discover.ts:
// $IDF_PATH env var, well-known install locations, and a version-dir scan
// under <sysdrive>/esp/ (where the Espressif Windows installer puts
// `v6.0.2/esp-idf`, etc.). It is good enough to find an IDF install on a
// developer machine so the .d.ts cache can be populated before type-checking.
//
// For richer discovery (EIM manifest, PATH search) the framework-esp32
// compile path performs its own discovery at compile time and regenerates
// the cache — this minimal version is only for the pre-transpile pass.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const IS_WIN = process.platform === 'win32';

function wellKnownPaths(): string[] {
  const paths: string[] = [];
  if (IS_WIN) {
    const sysDrive = process.env.SystemDrive ?? 'C:';
    paths.push(
      join(`${sysDrive}\\esp`, 'esp-idf'),
      join(`${sysDrive}\\Espressif`, 'esp-idf'),
    );
    // Versioned subdir scan: <sysdrive>/esp/v*/esp-idf (Windows installer layout).
    const espRoot = `${sysDrive}\\esp`;
    if (existsSync(espRoot)) {
      try {
        for (const entry of readdirSync(espRoot)) {
          if (/^v/i.test(entry)) {
            paths.push(join(espRoot, entry, 'esp-idf'));
          }
        }
      } catch {
        // readdir failed; skip.
      }
    }
  } else {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    paths.push(
      join(home, 'esp', 'esp-idf'),
      join(home, '.espressif', 'esp-idf'),
      '/opt/esp/esp-idf',
    );
  }
  return paths;
}

/**
 * Discover an ESP-IDF install root by checking $IDF_PATH first, then
 * well-known install locations. Returns the absolute path if found and
 * the `components/` subdir exists (the only thing gen-decls needs), or
 * undefined otherwise.
 */
export function discoverIdfRootForGenDecls(): string | undefined {
  const candidates = [
    process.env.IDF_PATH,
    ...wellKnownPaths(),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);

  for (const p of candidates) {
    if (existsSync(join(p, 'components'))) return p;
  }
  return undefined;
}
