import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { generateCDecl } from '../../../packages/cuttlefish/src/libdef/c-to-decl';

const FIXTURES = path.join(__dirname, 'c-to-decl-fixtures');

describe('generateCDecl — free functions (names verbatim)', () => {
  it('emits one export declare function per C function, name unchanged', () => {
    const header = path.join(FIXTURES, 'simple_funcs.h');
    const out = generateCDecl(header);
    expect(out).toBeTruthy();
    const content = fs.readFileSync(out!, 'utf8');

    // Names are preserved 1-to-1 with the C header — no namespace grouping.
    expect(content).toContain('export declare function simple_init(port: number): esp_err_t;');
    expect(content).toContain('export declare function simple_set_mode(mode: number): esp_err_t;');
    expect(content).toContain('export declare function simple_no_args(): void;');

    // Unknown return type `esp_err_t` falls back to a type alias of number
    // (cross-header reference) so the .d.ts compiles standalone.
    expect(content).toContain('export type esp_err_t = number;');

    // No dotted/namespace form anywhere.
    expect(content).not.toMatch(/export declare const \w+: \{/);
  });
});

describe('generateCDecl — enums, structs, opaque handles, arrays', () => {
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

  it('emits functions named verbatim (no prefix stripping)', () => {
    const content = fs.readFileSync(generateCDecl(header)!, 'utf8');
    expect(content).toContain('export declare function device_open(cfg: number): device_handle_t;');
    expect(content).toContain(
      'export declare function device_get_mode(h: device_handle_t): device_mode_t;',
    );
  });
});

describe('generateCDecl — ESP-IDF-style headers (the demo target)', () => {
  const header = path.join(FIXTURES, 'esp_idf_style.h');

  it('emits plain alias typedefs (esp_err_t) as type aliases', () => {
    const content = fs.readFileSync(generateCDecl(header)!, 'utf8');
    expect(content).toContain('export type esp_err_t = number;');
  });

  it('emits opaque handles (esp_netif_t) as number', () => {
    const content = fs.readFileSync(generateCDecl(header)!, 'utf8');
    expect(content).toContain('export type esp_netif_t = number;');
  });

  it('emits named enum constants verbatim (WIFI_MODE_STA, WIFI_IF_STA)', () => {
    const content = fs.readFileSync(generateCDecl(header)!, 'utf8');
    expect(content).toContain('export const WIFI_MODE_STA: wifi_mode_t = 1;');
    expect(content).toContain('export const WIFI_IF_STA: wifi_interface_t = 0;');
  });

  it('emits struct array fields as TS arrays', () => {
    const content = fs.readFileSync(generateCDecl(header)!, 'utf8');
    expect(content).toMatch(/ssid_addr:\s+number\[\]/);
  });

  it('emits function-pointer typedefs as any with an explanatory comment', () => {
    const content = fs.readFileSync(generateCDecl(header)!, 'utf8');
    expect(content).toContain('export type esp_event_handler_t = any;');
    expect(content).toMatch(/esp_event_handler_t.*function-pointer/i);
  });

  it('emits free functions named exactly as ESP-IDF examples call them', () => {
    const content = fs.readFileSync(generateCDecl(header)!, 'utf8');
    // These names are lifted verbatim from ESP-IDF station example code.
    expect(content).toContain('export declare function nvs_flash_init(): esp_err_t;');
    expect(content).toContain('export declare function esp_netif_init(): esp_err_t;');
    expect(content).toContain(
      'export declare function esp_event_loop_create_default(): esp_err_t;',
    );
    expect(content).toContain(
      'export declare function esp_netif_create_default_wifi_sta(): esp_netif_t;',
    );
    expect(content).toContain(
      'export declare function esp_wifi_init(config: number): esp_err_t;',
    );
    expect(content).toContain(
      'export declare function esp_wifi_set_mode(mode: wifi_mode_t): esp_err_t;',
    );
    expect(content).toContain(
      'export declare function esp_wifi_set_config(interface: wifi_interface_t, conf: number): esp_err_t;',
    );
    expect(content).toContain('export declare function esp_wifi_start(): esp_err_t;');
    expect(content).toContain('export declare function esp_wifi_connect(): esp_err_t;');
    expect(content).toContain(
      'export declare function esp_netif_get_ip_info(esp_netif: esp_netif_t, ip_info: number): esp_err_t;',
    );
  });
});
