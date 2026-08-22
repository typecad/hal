import { describe, it, expect } from 'vitest';
import { parseCommandLine } from '../../../packages/cuttlefish/src/utils/cli';
import type { LibraryCommandOptions } from '../../../packages/cuttlefish/src/types';

// ---------------------------------------------------------------------------
// `cuttlefish library <subcommand>` argument parsing — including the
// equals-form flags (the generic readFlag helper only handles the
// space-separated form, which silently dropped `--category=led`).
// ---------------------------------------------------------------------------

function parse(argv: string[]): LibraryCommandOptions {
  const opts = parseCommandLine(['node', 'cuttlefish', ...argv]);
  if (typeof opts === 'object' && 'subcommand' in opts) {
    return opts as LibraryCommandOptions;
  }
  throw new Error('not a library options object');
}

describe('cuttlefish library argument parsing', () => {
  it('requires a known subcommand', () => {
    expect(() => parse(['library'])).toThrow(/Usage: cuttlefish library/);
    expect(() => parse(['library', 'frobnicate'])).toThrow(/Usage: cuttlefish library/);
  });

  it('parses search text positionals and category in both flag forms', () => {
    expect(parse(['library', 'search']).subcommand).toBe('search');
    const spaced = parse(['library', 'search', 'ws2812', '--category', 'led', '--json']);
    expect(spaced.positionals).toEqual(['ws2812']);
    expect(spaced.category).toBe('led');
    expect(spaced.json).toBe(true);

    const equals = parse(['library', 'search', 'ws2812', '--category=led']);
    expect(equals.category).toBe('led');
    expect(equals.positionals).toEqual(['ws2812']);
    expect(equals.json).toBe(false);
  });

  it('does not mistake flag values for positionals', () => {
    const opts = parse(['library', 'init', '@acme/ring', '--framework', 'zephyr', '--targets', 'a,b']);
    expect(opts.positionals).toEqual(['@acme/ring']);
    expect(opts.framework).toBe('zephyr');
    expect(opts.targets).toBe('a,b');
  });

  it('parses init flags in both forms plus --yes/-y', () => {
    const spaced = parse(['library', 'init', 'x', '--dir', '/tmp/x', '--yes']);
    expect(spaced.dir).toBe('/tmp/x');
    expect(spaced.yes).toBe(true);
    const equals = parse(['library', 'init', 'x', '--framework=zephyr', '--category=led', '-y']);
    expect(equals.framework).toBe('zephyr');
    expect(equals.category).toBe('led');
    expect(equals.yes).toBe(true);
  });

  it('collects install package names as positionals', () => {
    const opts = parse(['library', 'install', '@typecad/zephyr-esp32s3-rgb', '@acme/other']);
    expect(opts.subcommand).toBe('install');
    expect(opts.positionals).toEqual(['@typecad/zephyr-esp32s3-rgb', '@acme/other']);
  });

  it('rejects --category outside search/init', () => {
    expect(() => parse(['library', 'install', 'x', '--category', 'led'])).toThrow(
      /--category applies to/,
    );
  });
});
