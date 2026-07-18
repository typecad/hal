import { spawnSync } from 'node:child_process';
import { requireIdfEnv } from './idf-env.js';

export interface EspIdfUploadResult {
  success: boolean;
  output: string;
  errorMessage?: string;
}

export function uploadEspIdf(outputDir: string, port: string): EspIdfUploadResult {
  try {
    requireIdfEnv();
  } catch (e) {
    return { success: false, output: '', errorMessage: (e as Error).message };
  }

  const result = spawnSync('idf.py', ['-p', port, 'flash'], {
    cwd: outputDir,
    encoding: 'utf8',
    shell: true,
    timeout: 120000,
  });

  return {
    success: result.status === 0,
    output: (result.stdout ?? '') + (result.stderr ?? ''),
    errorMessage: result.status !== 0 ? `idf.py flash exited with ${result.status}` : undefined,
  };
}
