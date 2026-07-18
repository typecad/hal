import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const PROJECT_DIR = join(import.meta.dirname, 'fixtures', 'handwritten-idf-project');

function idfEnvAvailable(): boolean {
  if (!process.env.IDF_PATH) return false;
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['idf.py'], {
    encoding: 'utf8', shell: true,
  });
  return which.status === 0;
}

const SKIP = !idfEnvAvailable();
const itMaybe = SKIP ? it.skip : it;

describe('idf.py toolchain spike (HARD GATE)', () => {
  itMaybe('hand-written project compiles via idf.py build', () => {
    expect(existsSync(join(PROJECT_DIR, 'main', 'main.cc'))).toBe(true);

    // First-time setup: set-target. Idempotent if sdkconfig already targets esp32.
    if (!existsSync(join(PROJECT_DIR, 'sdkconfig'))) {
      const setup = spawnSync('idf.py', ['set-target', 'esp32'], {
        cwd: PROJECT_DIR, encoding: 'utf8', shell: true, timeout: 180000,
      });
      expect(setup.status).toBe(0);
    }

    const result = spawnSync('idf.py', ['build'], {
      cwd: PROJECT_DIR, encoding: 'utf8', shell: true, timeout: 300000,
    });
    const combined = (result.stdout ?? '') + (result.stderr ?? '');
    expect(result.status).toBe(0);
    // ESP-IDF's successful build prints a "Project build complete" line
    expect(combined).toMatch(/Project build complete|Generated.*bin|app_main/);
  }, 600000);
});
