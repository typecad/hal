import { describe, it, expect } from 'vitest';
import { parseCommandLine } from '../../../packages/cuttlefish/src/utils/cli';
import type { AuditCommandOptions } from '../../../packages/cuttlefish/src/types';

function parse(argv: string[]): AuditCommandOptions {
  return parseCommandLine(['node', 'typecad-hal', ...argv]) as AuditCommandOptions;
}

describe('typecad-hal audit argument parsing', () => {
  it('defaults to human output, non-strict', () => {
    const opts = parse(['audit']);
    expect(opts.command).toBe('audit');
    expect(opts.strict).toBe(false);
    expect(opts.json).toBe(false);
  });

  it('parses --strict and --json', () => {
    const opts = parse(['audit', '--strict', '--json']);
    expect(opts.strict).toBe(true);
    expect(opts.json).toBe(true);
  });

  it('rejects unknown flags instead of silently dropping them', () => {
    expect(() => parse(['audit', '--wat'])).toThrow(/Unknown audit flag: --wat/);
  });

  it('rejects positionals — audit takes none', () => {
    expect(() => parse(['audit', 'oops'])).toThrow(/Unexpected argument 'oops'/);
  });
});
