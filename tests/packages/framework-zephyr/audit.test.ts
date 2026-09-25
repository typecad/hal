import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  parseMergedConfig,
  sweepCompatibles,
  evaluateSecurityRules,
  parseWaiverFile,
  runAuditPresenter,
  __setAuditRunnerForTest,
  type AuditRunner,
  type SecurityFacts,
} from '../../../packages/framework-zephyr/src/audit';

// ---------------------------------------------------------------------------
// parseMergedConfig + sweepCompatibles
// ---------------------------------------------------------------------------

describe('parseMergedConfig', () => {
  it('parses y, not-set, numbers, and strings; ignores comments', () => {
    const cfg = parseMergedConfig(
      [
        '#',
        '# Zephyr',
        '#',
        'CONFIG_CONSOLE=y',
        '# CONFIG_WATCHDOG is not set',
        'CONFIG_BT_FIXED_PASSKEY=123456',
        'CONFIG_APP_NAME="my fw"',
        'CONFIG_MAIN_STACK_SIZE=4096',
        '# end of Zephyr',
        '',
      ].join('\n'),
    );
    expect(cfg.get('CONFIG_CONSOLE')).toBe(true);
    expect(cfg.get('CONFIG_WATCHDOG')).toBe(false);
    expect(cfg.get('CONFIG_BT_FIXED_PASSKEY')).toBe(123456);
    expect(cfg.get('CONFIG_APP_NAME')).toBe('my fw');
    expect(cfg.get('CONFIG_MAIN_STACK_SIZE')).toBe(4096);
    expect(cfg.has('CONFIG_ABSENT')).toBe(false);
    // Comment decoration must not look like an unset symbol.
    expect(cfg.has('CONFIG_Zephyr')).toBe(false);
    expect(cfg.has('CONFIG_end')).toBe(false);
  });
});

describe('sweepCompatibles', () => {
  it('collects unique compatible strings, sorted', () => {
    const dts = [
      '/ {',
      '  soc {',
      '    uart0: uart@4000 { compatible = "st,stm32-uart"; };',
      '    wdt: watchdog { compatible = "st,stm32-iwdg"; };',
      '    clone: alias { compatible = "st,stm32-uart"; };',
      '  };',
      '};',
    ].join('\n');
    expect(sweepCompatibles(dts)).toEqual(['st,stm32-iwdg', 'st,stm32-uart']);
  });
});

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const facts = (configText: string, compatibles: string[] = []): SecurityFacts => ({
  config: parseMergedConfig(configText),
  compatibles,
});

/** Config that fires no rules — the "hardened console-less" baseline. */
const CLEAN = [
  '# CONFIG_SHELL is not set',
  '# CONFIG_UART_CONSOLE is not set',
  '# CONFIG_USB_CONSOLE is not set',
  '# CONFIG_RTT_CONSOLE is not set',
  'CONFIG_WATCHDOG=y',
  'CONFIG_ENTROPY_GENERATOR=y',
  'CONFIG_HARDENING=y',
].join('\n');

describe('evaluateSecurityRules', () => {
  it('fires nothing on a hardened console-less config', () => {
    expect(evaluateSecurityRules(facts(CLEAN))).toEqual([]);
  });

  it('orders findings high → medium → low', () => {
    const cfg = [
      'CONFIG_SHELL=y',                       // high
      '# CONFIG_WATCHDOG is not set',         // medium
      'CONFIG_UART_CONSOLE=y',                // low (hardening-off also low)
    ].join('\n');
    const severities = evaluateSecurityRules(facts(cfg)).map((f) => f.severity);
    expect(severities).toEqual(['high', 'medium', 'low', 'low']);
  });

  it('gdbstub: fires only when compiled in', () => {
    expect(evaluateSecurityRules(facts('CONFIG_GDBSTUB=y'))[0]?.rule).toBe('zephyr.gdbstub');
    expect(evaluateSecurityRules(facts(CLEAN)).some((f) => f.rule === 'zephyr.gdbstub')).toBe(false);
  });

  it('bt-fixed-passkey: fires on a numeric passkey, not on dynamic pairing', () => {
    const bad = 'CONFIG_BT=y\nCONFIG_BT_FIXED_PASSKEY=123456';
    const good = 'CONFIG_BT=y\n# CONFIG_BT_FIXED_PASSKEY is not set';
    expect(evaluateSecurityRules(facts(bad))[0]?.rule).toBe('zephyr.bt-fixed-passkey');
    expect(evaluateSecurityRules(facts(good)).some((f) => f.rule === 'zephyr.bt-fixed-passkey')).toBe(false);
  });

  it('entropy-missing: fires only when a crypto consumer is enabled', () => {
    const consumer = 'CONFIG_BT=y\n# CONFIG_ENTROPY_GENERATOR is not set';
    const withEntropy = 'CONFIG_BT=y\nCONFIG_ENTROPY_GENERATOR=y';
    const noConsumer = '# CONFIG_BT is not set\n# CONFIG_ENTROPY_GENERATOR is not set';
    expect(evaluateSecurityRules(facts(consumer))[0]?.rule).toBe('zephyr.entropy-missing');
    expect(evaluateSecurityRules(facts(withEntropy)).some((f) => f.rule === 'zephyr.entropy-missing')).toBe(false);
    expect(evaluateSecurityRules(facts(noConsumer)).some((f) => f.rule === 'zephyr.entropy-missing')).toBe(false);
  });

  it('network-no-tls: networking without mbedTLS fires; with mbedTLS does not', () => {
    // NETWORKING=y also (correctly) fires entropy-missing (high) — check by
    // rule id, not index.
    const bad = 'CONFIG_NETWORKING=y\n# CONFIG_MBEDTLS is not set';
    const good = 'CONFIG_NETWORKING=y\nCONFIG_MBEDTLS=y';
    const badRules = evaluateSecurityRules(facts(bad)).map((f) => f.rule);
    expect(badRules).toContain('zephyr.network-no-tls');
    expect(badRules).toContain('zephyr.entropy-missing');
    expect(evaluateSecurityRules(facts(good)).some((f) => f.rule === 'zephyr.network-no-tls')).toBe(false);
  });

  it('watchdog-absent and console-enabled and hardening-off fire as documented', () => {
    const cfg = '# CONFIG_WATCHDOG is not set\nCONFIG_UART_CONSOLE=y\n';
    const rules = evaluateSecurityRules(facts(cfg)).map((f) => f.rule);
    expect(rules).toContain('zephyr.watchdog-absent');
    expect(rules).toContain('zephyr.console-enabled');
    expect(rules).toContain('zephyr.hardening-off');
  });
});

// ---------------------------------------------------------------------------
// Waivers
// ---------------------------------------------------------------------------

describe('parseWaiverFile', () => {
  it('accepts a well-formed waiver list', () => {
    const { waivers, error } = parseWaiverFile(
      JSON.stringify({
        waivers: [{ rule: 'zephyr.console-enabled', justification: 'field diagnostics', date: '2026-09-22' }],
      }),
    );
    expect(error).toBeUndefined();
    expect(waivers).toEqual([
      { rule: 'zephyr.console-enabled', justification: 'field diagnostics', date: '2026-09-22' },
    ]);
  });

  it('rejects empty justifications and malformed files instead of crashing', () => {
    expect(parseWaiverFile('not json').error).toMatch(/not valid JSON/);
    expect(parseWaiverFile('{"waivers": 3}').error).toMatch(/must be/);
    expect(
      parseWaiverFile(JSON.stringify({ waivers: [{ rule: 'x', justification: '  ' }] })).error,
    ).toMatch(/empty justification/);
    expect(parseWaiverFile(undefined).waivers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Presenter (real temp dirs)
// ---------------------------------------------------------------------------

describe('runAuditPresenter', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitCode: number | string | undefined;
  const tempDirs: string[] = [];

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    __setAuditRunnerForTest(undefined);
    logSpy.mockRestore();
    process.exitCode = exitCode;
    for (const d of tempDirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  });

  function output(): string {
    return logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
  }

  function makeTempProject(configText: string, dtsText?: string): { dir: string; buildDir: string } {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-test-'));
    tempDirs.push(dir);
    const buildDir = path.join(dir, 'src', 'out', 'build');
    mkdirSync(path.join(buildDir, 'zephyr'), { recursive: true });
    writeFileSync(path.join(buildDir, 'compile_commands.json'), '[]');
    writeFileSync(path.join(buildDir, 'zephyr', '.config'), configText + '\n');
    if (dtsText !== undefined) {
      writeFileSync(path.join(buildDir, 'zephyr', 'zephyr.dts'), dtsText);
    }
    const runner: AuditRunner = {
      cwd: dir,
      compileCommandsPath: () => path.join(buildDir, 'compile_commands.json'),
      readFile: (p) => {
        try {
          return readFileSync(p, 'utf8');
        } catch {
          return undefined;
        }
      },
    };
    __setAuditRunnerForTest(runner);
    return { dir, buildDir };
  }

  it('errors (exit 1) with no build to audit', () => {
    __setAuditRunnerForTest({
      cwd: process.cwd(),
      compileCommandsPath: () => undefined,
      readFile: () => undefined,
    });
    runAuditPresenter({});
    expect(output()).toContain('No build found');
    expect(process.exitCode).toBe(1);
  });

  it('reports findings, prints the surface summary, and writes the sidecar', () => {
    const p = makeTempProject(
      ['CONFIG_UART_CONSOLE=y', '# CONFIG_WATCHDOG is not set', '# CONFIG_ENTROPY_GENERATOR is not set'].join('\n'),
      'soc { wdt { compatible = "st,stm32-iwdg"; }; };',
    );
    runAuditPresenter({});
    expect(output()).toContain('zephyr.watchdog-absent');
    expect(output()).toContain('zephyr.console-enabled');
    expect(output()).toContain('console uart');
    expect(output()).toContain('watchdog OFF');
    const sidecar = path.join(p.buildDir, 'security-audit.json');
    expect(existsSync(sidecar)).toBe(true);
    const report = JSON.parse(readFileSync(sidecar, 'utf8'));
    expect(report.schema).toBe('typecad-hal/security-audit@1');
    expect(report.summary.hardware).toContain('st,stm32-iwdg');
    expect(report.rulesEvaluated).toBeGreaterThan(5);
  });

  it('--strict fails on unwaived high/medium, passes on low-only findings', () => {
    makeTempProject(['CONFIG_SHELL=y', 'CONFIG_WATCHDOG=y', 'CONFIG_ENTROPY_GENERATOR=y'].join('\n'));
    runAuditPresenter({ strict: true });
    expect(output()).toContain('zephyr.shell-enabled');
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    makeTempProject(CLEAN);
    runAuditPresenter({ strict: true });
    expect(output()).toContain('baseline clean');
    expect(process.exitCode).toBeUndefined();
  });

  it('a committed waiver turns a finding into a recorded deviation that passes --strict', () => {
    const p = makeTempProject('# CONFIG_WATCHDOG is not set\n');
    mkdirSync(path.join(p.dir, '.typecad-hal'), { recursive: true });
    writeFileSync(
      path.join(p.dir, '.typecad-hal', 'audit-waivers.json'),
      JSON.stringify({
        waivers: [
          {
            rule: 'zephyr.watchdog-absent',
            justification: 'External supervisor hardware resets the board; no internal watchdog wired.',
            date: '2026-09-22',
          },
        ],
      }),
    );
    runAuditPresenter({ strict: true });
    expect(output()).toContain('waived');
    expect(output()).toContain('External supervisor hardware');
    expect(process.exitCode).toBeUndefined();
    const report = JSON.parse(readFileSync(path.join(p.buildDir, 'security-audit.json'), 'utf8'));
    expect(report.deviations.some((d: { rule: string }) => d.rule === 'zephyr.watchdog-absent')).toBe(true);
    expect(report.findings.some((f: { rule: string }) => f.rule === 'zephyr.watchdog-absent')).toBe(false);
  });

  it('an empty-justification waiver is rejected — the finding stays unwaived', () => {
    const p = makeTempProject('# CONFIG_WATCHDOG is not set\n');
    mkdirSync(path.join(p.dir, '.typecad-hal'), { recursive: true });
    writeFileSync(
      path.join(p.dir, '.typecad-hal', 'audit-waivers.json'),
      JSON.stringify({ waivers: [{ rule: 'zephyr.watchdog-absent', justification: ' ' }] }),
    );
    runAuditPresenter({ strict: true });
    expect(output()).toContain('empty justification');
    expect(process.exitCode).toBe(1);
  });

  it('--json prints only the report (clean CI pipe) and still writes the sidecar', () => {
    const p = makeTempProject('CONFIG_SHELL=y\n');
    runAuditPresenter({ json: true });
    expect(logSpy.mock.calls).toHaveLength(1);
    const report = JSON.parse(logSpy.mock.calls[0].join(' '));
    expect(report.findings.some((f: { rule: string }) => f.rule === 'zephyr.shell-enabled')).toBe(true);
    expect(existsSync(path.join(p.buildDir, 'security-audit.json'))).toBe(true);
  });
});
