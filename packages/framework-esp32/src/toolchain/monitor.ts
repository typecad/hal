import { spawnSync } from 'node:child_process';
import { requireIdfEnv } from './idf-env.js';

export function monitorEspIdf(port: string): void {
  requireIdfEnv();
  // Inherit stdio so the user sees live output and can Ctrl+] to exit.
  spawnSync('idf.py', ['-p', port, 'monitor'], {
    stdio: 'inherit',
    shell: true,
    timeout: 0,
  });
}
