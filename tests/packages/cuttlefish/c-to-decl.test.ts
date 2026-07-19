import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { generateCDecl } from '../../../packages/cuttlefish/src/libdef/c-to-decl';

const FIXTURES = path.join(__dirname, 'c-to-decl-fixtures');

describe('generateCDecl — free functions', () => {
  it('emits a namespace of functions with prefix-stripped names', () => {
    const header = path.join(FIXTURES, 'simple_funcs.h');
    const out = generateCDecl(header);
    expect(out).toBeTruthy();
    const content = fs.readFileSync(out!, 'utf8');

    // Namespace derived from common prefix `simple_`.
    expect(content).toContain('export declare const simple: {');
    expect(content).toContain('init(port: number): esp_err_t;');
    expect(content).toContain('set_mode(mode: number): esp_err_t;');
    expect(content).toContain('no_args(): void;');

    // Unknown return type `esp_err_t` falls back to a type alias of number.
    expect(content).toContain('export type esp_err_t = number;');
  });
});
