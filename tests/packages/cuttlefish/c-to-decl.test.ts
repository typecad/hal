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

describe('generateCDecl — enums, structs, opaque handles', () => {
  const header = path.join(FIXTURES, 'types.h');

  it('emits an enum as a union of literal values plus named const exports', () => {
    const out = generateCDecl(header);
    const content = fs.readFileSync(out!, 'utf8');
    expect(content).toContain('export type device_mode_t = 0 | 1 | 5;');
    expect(content).toContain('export const MODE_OFF: device_mode_t = 0;');
    expect(content).toContain('export const MODE_ON: device_mode_t = 1;');
    expect(content).toContain('export const MODE_AUTO: device_mode_t = 5;');
  });

  it('emits a struct as an interface with mapped field types', () => {
    const content = fs.readFileSync(generateCDecl(header)!, 'utf8');
    expect(content).toContain('export interface device_config_t {');
    expect(content).toContain('slot: number;');
    expect(content).toContain('flags: number;');
    expect(content).toContain('}');
  });

  it('emits an opaque handle typedef as number', () => {
    const content = fs.readFileSync(generateCDecl(header)!, 'utf8');
    expect(content).toContain('export type device_handle_t = number;');
  });

  it('emits the namespace with prefix-stripped methods', () => {
    const content = fs.readFileSync(generateCDecl(header)!, 'utf8');
    expect(content).toContain('export declare const device: {');
    // const device_config_t *cfg → cfg: number (pointer)
    expect(content).toContain('open(cfg: number): device_handle_t;');
    // device_handle_t h → keeps the typedef name (more faithful than collapsing to number)
    expect(content).toContain('get_mode(h: device_handle_t): device_mode_t;');
  });
});
