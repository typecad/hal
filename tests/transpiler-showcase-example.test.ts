import * as fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { transpileArduino } from './setup';

describe('Transpiler showcase example', () => {
  it('transpiles the showcase example without unsupported diagnostics', () => {
    const source = fs.readFileSync(
      new URL('../examples/23-transpiler-showcase.ts', import.meta.url),
      'utf-8',
    );

    const result = transpileArduino(source);
    const unsupported = result.diagnostics.filter((diagnostic) =>
      (diagnostic.code ?? '').startsWith('TS2CPP_UNSUPPORTED'),
    );

    expect(unsupported).toEqual([]);
    expect(result.cpp).toContain('enum class SystemMode');
    expect(result.cpp).toContain('class OffsetMeter');
    expect(result.cpp).toContain('Serial.begin(115200)');
    expect(result.cpp).toContain('Serial.println("TypeCode Uno validation showcase")');
    expect(result.cpp).toContain('while (true)');
  });

  it('keeps enum helper return types intact in the showcase', () => {
    const source = fs.readFileSync(
      new URL('../examples/23-transpiler-showcase.ts', import.meta.url),
      'utf-8',
    );

    const result = transpileArduino(source);

    expect(result.cpp).toContain('int classify(int value);');
    expect(result.cpp).toContain('int classify(int value)');
    expect(result.cpp).not.toContain('void classify(int value)');
  });
});
