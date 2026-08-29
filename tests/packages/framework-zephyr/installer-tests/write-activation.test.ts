import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression guard for the POSIX-only backtick-in-heredoc bug: write-activation.sh
// builds env-vars.ps1 with an UNQUOTED heredoc, so a backtick there is command
// substitution (not an escape) and expanded `$env` aborted under `set -u` before
// the SDK downloaded. The dry-run tests never exercised this path (write_activation
// only runs in a real install), which is why it slipped through to alpha.8.
// This sources the script under `set -eu` and asserts it runs clean + emits
// literal `$env:` (PowerShell) and `export` (POSIX) lines with resolved paths.
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const pkgDir = join(repoRoot, 'packages/framework-zephyr/installer').split('\\').join('/');

const bashAvailable = (() => {
  try {
    return spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0;
  } catch {
    return false;
  }
})();
const itBash = bashAvailable ? it : it.skip;

describe('write-activation.sh', () => {
  itBash('writes env-vars.{sh,bat,ps1} with no heredoc/unbound-variable errors', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'tc-write-act-')).split('\\').join('/');
    const script = [
      'set -eu',
      `PKG_DIR='${pkgDir}'`,
      `ENV_PREFIX='${tmp}/env'`,
      `WORKSPACE_DIR='${tmp}/ws'`,
      `ZEPHYR_SDK_INSTALL_DIR='${tmp}/sdk/zephyr-sdk-0.17.4'`,
      `ZEPHYR_SDK_VERSION='0.17.4'`,
      `DRY_RUN=0`,
      `. '${pkgDir}/lib/write-activation.sh'`,
      `write_activation`,
      `echo '===PS1==='`,
      `cat '${tmp}/env/etc/conda/env-vars.ps1'`,
      `echo '===SH==='`,
      `cat '${tmp}/env/etc/conda/env-vars.sh'`,
    ].join('\n');

    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    expect(r.status, `write_activation failed under set -eu: ${r.stderr ?? ''}`).toBe(0);

    // PowerShell env-vars must contain a LITERAL `$env:` (the bug expanded it).
    // The resolved paths are substituted into the double-quoted RHS.
    expect(r.stdout).toContain('$env:TYPECAD_ZEPHYR_BASE');
    expect(r.stdout).toContain('$env:TYPECAD_ZEPHYR_SDK_INSTALL_DIR');
    expect(r.stdout).toContain(`${tmp}/ws/zephyr`);
    expect(r.stdout).toContain(`${tmp}/sdk/zephyr-sdk-0.17.4`);

    // POSIX env-vars use `export` with the resolved path.
    expect(r.stdout).toContain('export TYPECAD_ZEPHYR_BASE=');
    expect(r.stdout).toContain('export TYPECAD_ZEPHYR_SDK_INSTALL_DIR=');
  });
});
