import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { transpileFile } from '../../../packages/transpiler/src/transpile';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dirPath of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
});

function createTempWorkspace(): string {
  const baseDir = path.join(process.cwd(), '.build');
  fs.mkdirSync(baseDir, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(baseDir, 'unit-types-'));
  tempDirs.push(tempDir);
  return tempDir;
}

describe('Peripheral configuration', () => {
  it('transpiles bare number peripheral configuration through the CLI pipeline', async () => {
    const workspaceDir = createTempWorkspace();
    const entryPath = path.join(workspaceDir, 'sketch.ts');

    fs.writeFileSync(
      entryPath,
      [
        "import { UART0 } from '@typecode/board-arduino-uno';",
        '',
        'UART0.begin(115200);',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = await transpileFile({
      inputFile: entryPath,
      emitMode: 'cpp',
      target: 'arduino',
      emitMaps: false,
    });

    const sourceText = fs.readFileSync(result.sourcePath, 'utf8');
    expect(sourceText).toContain('Serial.begin(115200)');
  }, 15000);

  it('accepts bare number in baudRate config (no unit wrapping required)', async () => {
    const workspaceDir = createTempWorkspace();
    const entryPath = path.join(workspaceDir, 'sketch.ts');

    fs.writeFileSync(
      entryPath,
      [
        "import { UART0 } from '@typecode/board-arduino-uno';",
        '',
        'UART0.begin(9600);',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = await transpileFile({
      inputFile: entryPath,
      emitMode: 'cpp',
      target: 'arduino',
      emitMaps: false,
    });

    const sourceText = fs.readFileSync(result.sourcePath, 'utf8');
    expect(result.diagnostics).toHaveLength(0);
    expect(sourceText).toContain('Serial.begin(9600)');
  }, 15000);

  it('transpiles I2C with bare number', async () => {
    const workspaceDir = createTempWorkspace();
    const entryPath = path.join(workspaceDir, 'sketch.ts');

    fs.writeFileSync(
      entryPath,
      [
        "import { I2C0 } from '@typecode/board-arduino-uno';",
        '',
        'const i2c = I2C0.begin();',
        'i2c.setClock(400000);',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = await transpileFile({
      inputFile: entryPath,
      emitMode: 'cpp',
      target: 'arduino',
      emitMaps: false,
    });

    const sourceText = fs.readFileSync(result.sourcePath, 'utf8');
    expect(sourceText).toContain('Wire.begin()');
    expect(sourceText).toContain('Wire.setClock(400000)');
  }, 15000);
});
