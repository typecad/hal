import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The project-activation template is what makes "open a terminal -> env active"
// work in a cuttlefish Zephyr project. Guard that the files ship, are
// machine-agnostic (no hardcoded user paths), and the VS Code profile wires the
// activator with -NoExit and a workspace-relative path.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const tplDir = join(repoRoot, 'packages/zephyr-installer/templates/project');

describe('zephyr-installer project activation template', () => {
  it('ships the Windows + POSIX activators and a VS Code profile', () => {
    expect(existsSync(join(tplDir, '.typecad/activate-zephyr.ps1'))).toBe(true);
    expect(existsSync(join(tplDir, '.typecad/activate-zephyr.sh'))).toBe(true);
    expect(existsSync(join(tplDir, '.vscode/settings.json'))).toBe(true);
    expect(existsSync(join(tplDir, 'README.md'))).toBe(true);
  });

  it('activators default to the zephyr env and are overridable + machine-agnostic', () => {
    const ps1 = readFileSync(join(tplDir, '.typecad/activate-zephyr.ps1'), 'utf8');
    const sh = readFileSync(join(tplDir, '.typecad/activate-zephyr.sh'), 'utf8');

    // Default env name, overridable via TYPECAD_ZEPHYR_ENV.
    expect(ps1).toContain("TYPECAD_ZEPHYR_ENV");
    expect(ps1).toContain("'zephyr'");
    expect(sh).toContain('TYPECAD_ZEPHYR_ENV:-zephyr');

    // No machine-specific absolute user paths baked in: must use the env var /
    // $HOME, not a hardcoded C:\Users\<someone> or /home/<someone>.
    expect(ps1).toMatch(/\$env:USERPROFILE/);
    expect(ps1).not.toMatch(/C:\\Users\\/);
    expect(sh).toMatch(/"\$HOME/);
    expect(sh).not.toMatch(/\/home\/[a-z_-]+\//);

    // Both invoke the activation.
    expect(ps1).toMatch(/micromamba activate/);
    expect(sh).toMatch(/micromamba activate/);
  });

  it('VS Code profile runs the activator with -NoExit and a workspace-relative path', () => {
    const cfg = readFileSync(join(tplDir, '.vscode/settings.json'), 'utf8');
    expect(cfg).toContain('zephyr-powershell');
    expect(cfg).toContain('${workspaceFolder}');
    expect(cfg).toContain('activate-zephyr.ps1');
    expect(cfg).toContain('-NoExit');
    // Prefers pwsh 7 with a Windows PowerShell 5.1 fallback. (Use substring
    // checks — readFileSync sees the JSON's `\\` as raw double backslashes,
    // which makes exact-path regexes brittle.)
    expect(cfg).toContain('pwsh.exe');
    expect(cfg).toContain('WindowsPowerShell');
    expect(cfg).toContain('v1.0');
  });
});
