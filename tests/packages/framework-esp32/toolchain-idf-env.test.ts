import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectIdfEnv } from '../../../packages/framework-esp32/src/toolchain/idf-env';
import { discoverIdfRoot } from '../../../packages/framework-esp32/src/toolchain/discover';

const ORIG_IDF_PATH = process.env.IDF_PATH;

afterEach(() => {
  if (ORIG_IDF_PATH === undefined) delete process.env.IDF_PATH;
  else process.env.IDF_PATH = ORIG_IDF_PATH;
});

describe('detectIdfEnv', () => {
  it('returns idf-path-missing when IDF_PATH unset', () => {
    delete process.env.IDF_PATH;
    const status = detectIdfEnv();
    expect(status.available).toBe(false);
    expect(status.reason).toBe('idf-path-missing');
    expect(status.message).toMatch(/\$IDF_PATH is not set/);
    expect(status.message).toMatch(/export\.sh/);
  });

  it('returns idfpy-not-on-path when IDF_PATH set but idf.py missing', () => {
    process.env.IDF_PATH = '/nonexistent/esp-idf';
    const status = detectIdfEnv();
    expect(status.available).toBe(false);
    expect(status.reason).toBe('idfpy-not-on-path');
    expect(status.message).toMatch(/idf\.py not found/);
  });

  // (When the real env IS sourced, available=true — but we can't rely on that in CI.)
});

describe('detectIdfEnv discoveredRoot', () => {
  // When IDF_PATH is unset but a real install is discoverable on the machine,
  // the status carries discoveredRoot and the message says "auto-sourced".
  // On machines with no ESP-IDF, discoveredRoot stays undefined.

  it('populates discoveredRoot when an install is found via discovery', () => {
    // Only meaningful when the host actually has an IDF install.
    const installed = discoverIdfRoot() !== null;
    if (!installed) {
      console.log('  (skipped: no ESP-IDF install discovered on this machine)');
      return;
    }
    delete process.env.IDF_PATH;
    const status = detectIdfEnv();
    expect(status.available).toBe(false);
    expect(status.discoveredRoot).toBeDefined();
    expect(status.discoveredRoot!.path).toBeTruthy();
    expect(status.message).toMatch(/auto-sourced|discovered at/i);
  });

  it('leaves discoveredRoot undefined when no install is discoverable', () => {
    // Skip on machines that DO have an install — we can't pretend it's not there.
    const installed = discoverIdfRoot() !== null;
    if (installed) {
      console.log('  (skipped: ESP-IDF is installed on this machine)');
      return;
    }
    delete process.env.IDF_PATH;
    const status = detectIdfEnv();
    expect(status.discoveredRoot).toBeUndefined();
  });
});
