import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { parseCommandLine } from '../../../packages/cuttlefish/src/utils/cli';
import type { SbomCommandOptions } from '../../../packages/cuttlefish/src/types';

function parse(argv: string[]): SbomCommandOptions {
  return parseCommandLine(['node', 'typecad-hal', ...argv]) as SbomCommandOptions;
}

describe('typecad-hal sbom argument parsing', () => {
  it('defaults to cyclonedx generate mode', () => {
    const opts = parse(['sbom']);
    expect(opts.command).toBe('sbom');
    expect(opts.format).toBe('cyclonedx');
    expect(opts.all).toBe(false);
    expect(opts.strict).toBe(false);
    expect(opts.check).toBe(false);
    expect(opts.stdout).toBe(false);
    expect(opts.output).toBeUndefined();
    expect(opts.diff).toBeUndefined();
  });

  it('parses --format in space and equals forms', () => {
    expect(parse(['sbom', '--format', 'spdx']).format).toBe('spdx');
    expect(parse(['sbom', '--format=spdx']).format).toBe('spdx');
    expect(parse(['sbom', '--format=cyclonedx']).format).toBe('cyclonedx');
  });

  it('rejects an unknown format', () => {
    expect(() => parse(['sbom', '--format', 'yaml'])).toThrow(/--format must be cyclonedx or spdx/);
  });

  it('parses boolean flags', () => {
    const opts = parse(['sbom', '--all', '--strict', '--check', '--stdout']);
    expect(opts.all).toBe(true);
    expect(opts.strict).toBe(true);
    expect(opts.check).toBe(true);
    expect(opts.stdout).toBe(true);
  });

  it('resolves --output to an absolute path (space and equals forms)', () => {
    expect(parse(['sbom', '--output', 'x.json']).output).toBe(path.resolve(process.cwd(), 'x.json'));
    expect(parse(['sbom', '--output=y.json']).output).toBe(path.resolve(process.cwd(), 'y.json'));
  });

  it('parses --diff positionals as two absolute paths', () => {
    const opts = parse(['sbom', '--diff', 'old.json', 'new.json']);
    expect(opts.diff).toEqual([
      path.resolve(process.cwd(), 'old.json'),
      path.resolve(process.cwd(), 'new.json'),
    ]);
  });

  it('rejects --diff without exactly two paths', () => {
    expect(() => parse(['sbom', '--diff', 'only.json'])).toThrow(/Usage: typecad-hal sbom --diff/);
    expect(() => parse(['sbom', '--diff'])).toThrow(/Usage: typecad-hal sbom --diff/);
  });

  it('rejects --diff together with --check', () => {
    expect(() => parse(['sbom', '--diff', 'a.json', 'b.json', '--check'])).toThrow(
      /--diff and --check cannot be used together/,
    );
  });

  it('rejects unknown flags instead of silently dropping them', () => {
    expect(() => parse(['sbom', '--wat'])).toThrow(/Unknown sbom flag: --wat/);
    expect(() => parse(['sbom', '--wat=1'])).toThrow(/Unknown sbom flag: --wat/);
  });

  it('rejects stray positionals without --diff', () => {
    expect(() => parse(['sbom', 'oops.json'])).toThrow(/Unexpected argument 'oops.json'/);
  });

  it('rejects a value flag with a missing value', () => {
    expect(() => parse(['sbom', '--format'])).toThrow(/requires a value/);
    expect(() => parse(['sbom', '--output', '--all'])).toThrow(/requires a value/);
  });
});
