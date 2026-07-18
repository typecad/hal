import { spawnSync } from 'node:child_process';
import { idfSpawn } from './activate.js';

export function monitorEspIdf(port: string, projectDir: string = process.cwd()): void {
  // idfSpawn throws if discovery fails entirely (no install + no env).
  // stdio: 'inherit' so the user sees live output and can Ctrl+] to exit.
  const inv = idfSpawn(projectDir, ['-p', port, 'monitor'], {
    cwd: projectDir,
    stdio: 'inherit',
    shell: true,
    timeout: 0,
  });
  if (inv.activation?.message) {
    console.error(inv.activation.message);
  }
  spawnSync(inv.command, inv.args, inv.options);
}
