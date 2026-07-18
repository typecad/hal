import { describe, it, expect, afterEach } from 'vitest';
import { detectIdfEnv } from '../../../packages/framework-esp32/src/toolchain/idf-env';

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
