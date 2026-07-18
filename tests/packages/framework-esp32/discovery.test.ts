import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('framework-esp32 discovery wiring', () => {
  it('init-wizard.ts includes an ESP32 IDF option', () => {
    const src = readFileSync('packages/cuttlefish/src/create/init-wizard.ts', 'utf8');
    expect(src).toMatch(/ESP32.*native ESP-IDF/);
    expect(src).toMatch(/@typecad\/framework-esp32/);
  });

  it('init-scaffold.ts has idf-flavored esp32 targets', () => {
    const src = readFileSync('packages/cuttlefish/src/create/init-scaffold.ts', 'utf8');
    expect(src).toMatch(/esp32-devkit-idf/);
    expect(src).toMatch(/esp32s3-idf/);
    expect(src).toMatch(/esp32c3-idf/);
    expect(src).toMatch(/esp32c6-idf/);
  });

  it('idf targets carry frameworkData.target', () => {
    const src = readFileSync('packages/cuttlefish/src/create/init-scaffold.ts', 'utf8');
    expect(src).toMatch(/frameworkData:\s*\{\s*target:\s*'esp32'/);
    expect(src).toMatch(/target:\s*'esp32s3'/);
    expect(src).toMatch(/target:\s*'esp32c3'/);
    expect(src).toMatch(/target:\s*'esp32c6'/);
  });

  it('KnownTarget interface allows frameworkData', () => {
    const src = readFileSync('packages/cuttlefish/src/create/init-scaffold.ts', 'utf8');
    expect(src).toMatch(/frameworkData\?\:\s*Record<string,\s*unknown>/);
  });
});
