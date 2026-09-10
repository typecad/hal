import { describe, it, expect } from 'vitest';
import { parseCommandLine } from '../../../packages/cuttlefish/src/utils/cli';
import type { QueryCommandOptions } from '../../../packages/cuttlefish/src/types';

function parse(argv: string[]): QueryCommandOptions {
  return parseCommandLine(['node', 'typecad-hal', ...argv]) as QueryCommandOptions;
}

describe('typecad-hal query argument parsing', () => {
  it('parses the subject and an optional entry positional', () => {
    const opts = parse(['query', 'summary', 'src/main.ts']);
    expect(opts.command).toBe('query');
    expect(opts.subject).toBe('summary');
    expect(opts.entryFile).toBe('src/main.ts');
    expect(opts.json).toBe(false);
  });

  it('leaves the subject empty when only flags are given (prints the subject list)', () => {
    const opts = parse(['query', '--json']);
    expect(opts.subject).toBe('');
    expect(opts.json).toBe(true);
  });

  it('parses --board and --framework in space and equals forms', () => {
    const space = parse(['query', 'pins', '--board', 'xiao_ble/nrf52840', '--framework', '@typecad/framework-zephyr']);
    expect(space.board).toBe('xiao_ble/nrf52840');
    expect(space.framework).toBe('@typecad/framework-zephyr');

    const equals = parse(['query', 'pins', '--board=foo/bar']);
    expect(equals.board).toBe('foo/bar');
  });

  it('rejects unknown flags instead of silently dropping them', () => {
    expect(() => parse(['query', 'summary', '--wat'])).toThrow(/Unknown query flag: --wat/);
  });

  it('rejects unknown flags in --flag=value form too, not just bare form', () => {
    expect(() => parse(['query', 'summary', '--wat=1'])).toThrow(/Unknown query flag: --wat/);
  });

  it('rejects negative-style short flags it does not know', () => {
    expect(() => parse(['query', 'summary', '-x'])).toThrow(/Unknown query flag: -x/);
  });

  it('accepts --json=true/false and rejects any other --json= value', () => {
    expect(parse(['query', 'summary', '--json=true']).json).toBe(true);
    expect(parse(['query', 'summary', '--json=false']).json).toBe(false);
    expect(() => parse(['query', 'summary', '--json=banana'])).toThrow(/Invalid --json value: banana/);
  });

  it('rejects a value flag with no value (end of argv, a following flag, or empty =)', () => {
    expect(() => parse(['query', 'pins', '--board'])).toThrow(/Query flag --board requires a value/);
    expect(() => parse(['query', 'pins', '--board', '--json'])).toThrow(/Query flag --board requires a value/);
    expect(() => parse(['query', 'pins', '--board='])).toThrow(/Query flag --board requires a value/);
  });
});
