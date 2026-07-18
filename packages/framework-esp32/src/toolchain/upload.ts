import { spawnSync } from 'node:child_process';
import { idfSpawn } from './activate.js';

export interface EspIdfUploadResult {
  success: boolean;
  output: string;
  errorMessage?: string;
}

export function uploadEspIdf(outputDir: string, port: string): EspIdfUploadResult {
  try {
    // idfSpawn throws if discovery fails entirely (no install + no env).
    const inv = idfSpawn(outputDir, ['-p', port, 'flash'], {
      cwd: outputDir,
      encoding: 'utf8',
      shell: true,
      timeout: 120000,
    });
    const result = spawnSync(inv.command, inv.args, inv.options);
    const activationNotice = inv.activation?.message ? `${inv.activation.message}\n` : '';

    return {
      success: result.status === 0,
      output: activationNotice + (result.stdout ?? '') + (result.stderr ?? ''),
      errorMessage: result.status !== 0 ? `idf.py flash exited with ${result.status}` : undefined,
    };
  } catch (e) {
    const msg = (e as Error).message;
    return { success: false, output: msg, errorMessage: msg };
  }
}
