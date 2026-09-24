import { describe, it, expect } from 'vitest';
import { parseCommandLine } from '../../../packages/cuttlefish/src/utils/cli';
import type { TraceCommandOptions } from '../../../packages/cuttlefish/src/types';

function parse(argv: string[]): TraceCommandOptions {
  return parseCommandLine(['node', 'typecad-hal', ...argv]) as TraceCommandOptions;
}

describe('typecad-hal trace argument parsing', () => {
  it('requires a known subcommand', () => {
    expect(() => parse(['trace'])).toThrow(/Usage: typecad-hal trace <capture\|report\|view>/);
    expect(() => parse(['trace', 'wat'])).toThrow(/Usage: typecad-hal trace <capture\|report\|view>/);
  });

  it('capture defaults: 115200 baud, ./trace.json output, run until Ctrl+C', () => {
    const opts = parse(['trace', 'capture']);
    expect(opts.command).toBe('trace');
    expect(opts.subcommand).toBe('capture');
    expect(opts.baudRate).toBe(115200);
    expect(opts.output).toBe('trace.json');
    expect(opts.durationSeconds).toBeUndefined();
    expect(opts.port).toBeUndefined();
  });

  it('parses capture value flags in both --flag value and --flag=value forms', () => {
    const spaced = parse(['trace', 'capture', '--port', 'COM10', '--duration', '10', '--output', 'out.json', '--baud', '9600']);
    expect(spaced.port).toBe('COM10');
    expect(spaced.durationSeconds).toBe(10);
    expect(spaced.output).toBe('out.json');
    expect(spaced.baudRate).toBe(9600);

    const eq = parse(['trace', 'capture', '--port=COM7', '--duration=5']);
    expect(eq.port).toBe('COM7');
    expect(eq.durationSeconds).toBe(5);
  });

  it('rejects unknown capture flags instead of silently dropping them', () => {
    expect(() => parse(['trace', 'capture', '--wat'])).toThrow(/Unknown trace capture flag: --wat/);
  });

  it('validates --baud and --duration values', () => {
    expect(() => parse(['trace', 'capture', '--baud', 'nope'])).toThrow(/--baud must be a positive integer/);
    expect(() => parse(['trace', 'capture', '--duration', '-1'])).toThrow(/--duration must be seconds >= 0/);
  });

  it('report defaults to ./trace.json input; --json switches output', () => {
    const opts = parse(['trace', 'report']);
    expect(opts.subcommand).toBe('report');
    expect(opts.input).toBe('trace.json');
    expect(opts.json).toBeFalsy();

    const json = parse(['trace', 'report', '--input', 'runs/night.json', '--json']);
    expect(json.input).toBe('runs/night.json');
    expect(json.json).toBe(true);
  });

  it('rejects capture-only flags on report', () => {
    expect(() => parse(['trace', 'report', '--port', 'COM10'])).toThrow(/Unknown trace report flag/);
  });

  it('capture accepts --quiet/--flash bools and --gate/--gates-file (the one-command loop)', () => {
    const opts = parse(['trace', 'capture', '--quiet', '--flash', '--gate', 'cpu-avg:main<=50', '--gates-file', 'trace-gates.json']);
    expect(opts.quiet).toBe(true);
    expect(opts.flash).toBe(true);
    expect(opts.gates).toEqual(['cpu-avg:main<=50']);
    expect(opts.gatesFile).toBe('trace-gates.json');
    // Defaults unchanged.
    const plain = parse(['trace', 'capture']);
    expect(plain.quiet).toBeFalsy();
    expect(plain.flash).toBeFalsy();
    expect(plain.gates).toBeUndefined();
  });

  it('capture --forever = continuous until Ctrl+C (continuous monitoring)', () => {
    const opts = parse(['trace', 'capture', '--forever', '--port', 'COM10']);
    expect(opts.forever).toBe(true);
    expect(opts.durationSeconds).toBeUndefined();
    // Off by default; not valid on report.
    expect(parse(['trace', 'capture']).forever).toBeFalsy();
    expect(() => parse(['trace', 'report', '--forever'])).toThrow(/Unknown trace report flag/);
  });

  it('capture --forever and --duration are mutually exclusive', () => {
    expect(() => parse(['trace', 'capture', '--forever', '--duration', '10']))
      .toThrow(/--forever and --duration are mutually exclusive/);
  });

  it('capture rejects unknown flags as before', () => {
    expect(() => parse(['trace', 'capture', '--worst', '5'])).toThrow(/Unknown trace capture flag/);
  });

  it('report validates --worst as an integer 1-100', () => {
    expect(parse(['trace', 'report', '--worst', '5']).worst).toBe(5);
    expect(() => parse(['trace', 'report', '--worst', '0'])).toThrow(/--worst must be an integer 1-100/);
    expect(() => parse(['trace', 'report', '--worst', 'many'])).toThrow(/--worst must be an integer 1-100/);
  });

  it('view defaults to ./trace.json on HTTP port 5175', () => {
    const opts = parse(['trace', 'view']);
    expect(opts.subcommand).toBe('view');
    expect(opts.input).toBe('trace.json');
    expect(opts.httpPort).toBe(5175);
  });

  it('view --port is the HTTP port (not a serial port)', () => {
    const opts = parse(['trace', 'view', '--port', '8080', '--input', 'night.json']);
    expect(opts.httpPort).toBe(8080);
    expect(opts.input).toBe('night.json');
  });

  it('report accepts repeatable --gate expressions', () => {
    const opts = parse(['trace', 'report', '--gate', 'cpu-avg:main<=50', '--gate', 'stack-min:main>=256']);
    expect(opts.gates).toEqual(['cpu-avg:main<=50', 'stack-min:main>=256']);
  });

  it('report without --gate carries no gates array', () => {
    expect(parse(['trace', 'report']).gates).toBeUndefined();
  });

  it('parses --baseline as value-optional and --drift on capture AND report', () => {
    const bare = parse(['trace', 'capture', '--baseline']);
    expect(bare.baseline).toBe(true);
    const withPath = parse(['trace', 'capture', '--baseline', 'runs/night-report.json', '--drift', '15']);
    expect(withPath.baseline).toBe('runs/night-report.json');
    expect(withPath.driftPct).toBe(15);
    const report = parse(['trace', 'report', '--baseline', 'old.json', '--drift', '5']);
    expect(report.baseline).toBe('old.json');
    expect(report.driftPct).toBe(5);
    // A following flag means the bare form (the sidecar), not a swallowed flag.
    const beforeFlag = parse(['trace', 'capture', '--baseline', '--quiet']);
    expect(beforeFlag.baseline).toBe(true);
    expect(beforeFlag.quiet).toBe(true);
    // Defaults carry neither.
    expect(parse(['trace', 'capture']).baseline).toBeUndefined();
    expect(parse(['trace', 'report']).driftPct).toBeUndefined();
  });

  it('validates --drift as a percent 0-100', () => {
    expect(() => parse(['trace', 'capture', '--drift', '-5'])).toThrow(/--drift must be a percent 0-100/);
    expect(() => parse(['trace', 'report', '--drift', 'many'])).toThrow(/--drift must be a percent 0-100/);
  });

  it('view still rejects the monitoring flags (capture/report only)', () => {
    expect(() => parse(['trace', 'view', '--baseline'])).toThrow(/Unknown trace view flag/);
  });

  it('view rejects unknown flags and bad ports', () => {
    expect(() => parse(['trace', 'view', '--baud', '115200'])).toThrow(/Unknown trace view flag/);
    expect(() => parse(['trace', 'view', '--port', 'nope'])).toThrow(/--port must be an HTTP port/);
  });
});
