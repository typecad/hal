// Tests for the debug breakpoint loader.
//
// The loader reads .cuttlefish/breakpoints.json — written by the
// vscode-typecad-debug extension — and exposes loadBreakpoints() /
// getBreakpointsForFile() to the transpiler. The flat-array format
// { breakpoints: [...] } is the canonical extension format and is checked
// first; the raw-array and legacy keyed-map formats are also tolerated.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadBreakpoints,
  getBreakpointsForFile,
  CUTTLEFISH_DIR,
  BREAKPOINTS_FILE,
} from '../../../packages/cuttlefish/src/debug/breakpoint-loader';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeProject(structure: 'flat-array' | 'raw-array' | 'legacy-keyed', payload: unknown): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuttlefish-debug-'));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, CUTTLEFISH_DIR), { recursive: true });
  const content =
    structure === 'flat-array'
      ? JSON.stringify({ breakpoints: payload })
      : structure === 'raw-array'
        ? JSON.stringify(payload)
        : JSON.stringify(payload); // legacy-keyed: payload is the object literal
  fs.writeFileSync(path.join(root, CUTTLEFISH_DIR, BREAKPOINTS_FILE), content);
  return root;
}

describe('loadBreakpoints — formats', () => {
  it('reads the canonical VS Code flat-array format', () => {
    const root = makeProject('flat-array', [
      { file: 'index.ts', line: 12 },
      { file: 'index.ts', line: 27, condition: 'counter > 5' },
      { file: 'sensor.ts', line: 8, logMessage: 'value = {value}' },
    ]);

    const map = loadBreakpoints(root);

    expect(map).toBeDefined();
    expect(map!['index.ts']).toHaveLength(2);
    expect(map!['index.ts'][0]).toEqual({ file: 'index.ts', line: 12, condition: undefined, logMessage: undefined });
    expect(map!['index.ts'][1]).toEqual({ file: 'index.ts', line: 27, condition: 'counter > 5', logMessage: undefined });
    expect(map!['sensor.ts']).toEqual([
      { file: 'sensor.ts', line: 8, condition: undefined, logMessage: 'value = {value}' },
    ]);
  });

  it('reads the raw-array format', () => {
    const root = makeProject('raw-array', [{ file: 'main.ts', line: 3 }]);

    const map = loadBreakpoints(root);

    expect(map!['main.ts']).toEqual([{ file: 'main.ts', line: 3, condition: undefined, logMessage: undefined }]);
  });

  it('reads the legacy keyed-map format with bare line numbers', () => {
    const root = makeProject('legacy-keyed', { 'app.ts': [10, 15] });

    const map = loadBreakpoints(root);

    expect(map!['app.ts']).toEqual([
      { file: 'app.ts', line: 10, condition: undefined, logMessage: undefined },
      { file: 'app.ts', line: 15, condition: undefined, logMessage: undefined },
    ]);
  });

  it('reads the legacy keyed-map format with rich elements', () => {
    const root = makeProject('legacy-keyed', {
      'app.ts': [8, { line: 20, condition: 'x > 1', logMessage: 'x={x}' }],
    });

    const map = loadBreakpoints(root);

    expect(map!['app.ts']).toHaveLength(2);
    expect(map!['app.ts'][1]).toEqual({ file: 'app.ts', line: 20, condition: 'x > 1', logMessage: 'x={x}' });
  });
});

describe('loadBreakpoints — discovery & robustness', () => {
  it('walks up from a subdirectory to find .cuttlefish at project root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuttlefish-debug-'));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, 'src', 'lib'), { recursive: true });
    fs.mkdirSync(path.join(root, CUTTLEFISH_DIR), { recursive: true });
    fs.writeFileSync(
      path.join(root, CUTTLEFISH_DIR, BREAKPOINTS_FILE),
      JSON.stringify({ breakpoints: [{ file: 'index.ts', line: 5 }] }),
    );

    const map = loadBreakpoints(path.join(root, 'src', 'lib'));

    expect(map!['index.ts']).toEqual([{ file: 'index.ts', line: 5, condition: undefined, logMessage: undefined }]);
  });

  it('returns undefined when no .cuttlefish directory exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuttlefish-debug-'));
    tempDirs.push(root);

    expect(loadBreakpoints(root)).toBeUndefined();
  });

  it('returns undefined when the directory exists but the file does not', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuttlefish-debug-'));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, CUTTLEFISH_DIR), { recursive: true });

    expect(loadBreakpoints(root)).toBeUndefined();
  });

  it('returns undefined (and does not throw) on malformed JSON', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuttlefish-debug-'));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, CUTTLEFISH_DIR), { recursive: true });
    fs.writeFileSync(path.join(root, CUTTLEFISH_DIR, BREAKPOINTS_FILE), '{ not valid json');

    expect(loadBreakpoints(root)).toBeUndefined();
  });

  it('drops entries with a missing file or a falsy line', () => {
    const root = makeProject('flat-array', [
      { file: 'a.ts', line: 5 },
      { line: 10 }, // no file → dropped
      { file: 'b.ts' }, // no line → dropped
      { file: 'c.ts', line: 0 }, // line 0 is falsy → dropped
    ]);

    const map = loadBreakpoints(root);

    expect(Object.keys(map!)).toEqual(['a.ts']);
  });
});

describe('getBreakpointsForFile — matching', () => {
  // Build a map directly to exercise matching in isolation from loading.
  const map = {
    'exact.ts': [{ file: 'exact.ts', line: 1 }],
    'shared.ts': [{ file: 'shared.ts', line: 2 }],
    'src/nested.ts': [{ file: 'src/nested.ts', line: 3 }],
  } as const;

  it('matches by exact path key', () => {
    expect(getBreakpointsForFile(map as never, 'exact.ts')[0].line).toBe(1);
  });

  it('falls back to basename when no exact key matches', () => {
    // Absolute path on POSIX — no exact key, but basename 'shared.ts' hits.
    expect(getBreakpointsForFile(map as never, '/home/proj/src/shared.ts')[0].line).toBe(2);
  });

  it('falls back to suffix match (key endsWith basename)', () => {
    // 'src/nested.ts' should suffix-match a longer absolute path on POSIX.
    expect(getBreakpointsForFile(map as never, '/home/proj/src/nested.ts')[0].line).toBe(3);
  });

  it('returns [] when nothing matches', () => {
    expect(getBreakpointsForFile(map as never, 'nope.ts')).toEqual([]);
  });
});
