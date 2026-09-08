// ---------------------------------------------------------------------------
// project-root.ts — resolve the project directory the test runner targets.
//
// `npx typecad-hal test` (npm exec) resets the child process's cwd to the npm
// local prefix — the NEAREST package.json ancestor of the invocation dir.
// From a nested suite dir (e.g. packages/framework-zephyr/hal/esp32s3, which
// has no package.json of its own) that lands on the workspace package instead
// of the project under test, and file discovery finds nothing. npm stashes
// the real invocation directory in INIT_CWD (also set by `npm run` to the
// script's package dir, which is likewise the intended root) — prefer it when
// it names an existing directory.
// ---------------------------------------------------------------------------

import fs from 'node:fs';

/**
 * Resolve the project root for a run.
 *
 * @param env  The environment to consult (defaults to `process.env`).
 * @param cwd  The fallback directory (defaults to `process.cwd()`).
 * @returns INIT_CWD when it names an existing directory, else cwd.
 */
export function resolveProjectRoot(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const initCwd = env.INIT_CWD;
  return initCwd !== undefined && initCwd !== '' && fs.existsSync(initCwd) ? initCwd : cwd;
}
