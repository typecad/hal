// ---------------------------------------------------------------------------
// project-root.test.ts — INIT_CWD resolution for the hardware test CLI.
//
// Regression: `npx typecad-hal test` from a nested suite dir (a directory
// without its own package.json, e.g. packages/framework-zephyr/hal/esp32s3)
// used process.cwd() as the project root — but npm exec resets the child's
// cwd to the nearest package.json ancestor (the workspace package), so
// discovery found zero test files. The fix resolves through INIT_CWD, the
// directory npm records as the real invocation dir.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveProjectRoot } from '../../../../packages/cuttlefish/src/test-runner/project-root';

describe('resolveProjectRoot (INIT_CWD handling)', () => {
  it('prefers INIT_CWD when it names an existing directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-initcwd-'));
    try {
      expect(resolveProjectRoot({ INIT_CWD: dir }, '/elsewhere')).toBe(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to cwd when INIT_CWD points at a missing directory', () => {
    const missing = path.join(os.tmpdir(), 'tc-initcwd-does-not-exist');
    expect(resolveProjectRoot({ INIT_CWD: missing }, '/elsewhere')).toBe('/elsewhere');
  });

  it('falls back to cwd when INIT_CWD is unset or empty', () => {
    expect(resolveProjectRoot({}, '/elsewhere')).toBe('/elsewhere');
    expect(resolveProjectRoot({ INIT_CWD: '' }, '/elsewhere')).toBe('/elsewhere');
  });
});
