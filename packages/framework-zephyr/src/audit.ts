// ---------------------------------------------------------------------------
// @typecad/framework-zephyr — security baseline audit
//
// `typecad-hal audit` — evaluate the last build's MERGED Kconfig
// (<buildDir>/zephyr/.config, the as-built truth nothing else reads) against
// a curated Zephyr security baseline, in the spirit of the EU Cyber
// Resilience Act's essential requirements (secure by default, attack surface
// minimised, no hard-coded credentials, functioning crypto underpinnings).
//
// Architecture mirrors the AUTOSAR compliance module and the sbom command:
// rules are DATA evaluated over facts, never board-name branches; justified
// exceptions are DEVIATIONS recorded in a committed waiver file
// (.typecad-hal/audit-waivers.json) rather than suppressed findings; the
// presenter never calls process.exit() and sets process.exitCode under
// --strict only for unwaived high/medium findings. A machine-readable
// sidecar (<buildDir>/security-audit.json) is written on every run — the
// input the CRA technical file and the future VEX/audit feed consume.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as ui from '@typecad/cuttlefish/utils/ui';
import { loadTypecadConfig } from '@typecad/cuttlefish/config-loader';
import type { ReadFile } from '@typecad/cuttlefish/api/shared';
import { findCompileCommandsPath } from './west-inventory.js';

// ---------------------------------------------------------------------------
// Merged-config parsing
// ---------------------------------------------------------------------------

export type KconfigValue = string | number | boolean;

/** Parse a merged Kconfig file: `CONFIG_X=y` (true), `# CONFIG_X is not set`
 *  (explicit false), `CONFIG_X=123` / `CONFIG_X="s"` (value). Comment blocks
 *  and everything else are ignored. Absent symbols are simply not in the map
 *  (Kconfig default applies — treat as "not enabled" for y/n symbols). */
export function parseMergedConfig(text: string): Map<string, KconfigValue> {
  const out = new Map<string, KconfigValue>();
  for (const line of text.split(/\r?\n/)) {
    const notSet = line.match(/^#\s*CONFIG_([A-Z0-9_]+) is not set$/);
    if (notSet) {
      out.set(`CONFIG_${notSet[1]}`, false);
      continue;
    }
    const set = line.match(/^CONFIG_([A-Z0-9_]+)=(.*)$/);
    if (set) {
      const raw = set[2].trim();
      if (raw === 'y') out.set(`CONFIG_${set[1]}`, true);
      else if (raw === 'n') out.set(`CONFIG_${set[1]}`, false);
      else if (/^-?\d+$/.test(raw)) out.set(`CONFIG_${set[1]}`, Number(raw));
      else if (/^".*"$/s.test(raw)) out.set(`CONFIG_${set[1]}`, raw.slice(1, -1));
      else out.set(`CONFIG_${set[1]}`, raw);
    }
  }
  return out;
}

/** Sweep a resolved devicetree for every `compatible` string — the enabled
 *  hardware the firmware actually wired (attack-surface inventory input).
 *  Multi-string compatibles ("a,b", "a,b-fallback") contribute EVERY entry
 *  (the fallback binds the same node); nodes marked status = "disabled"
 *  contribute nothing. Node scoping is a brace-depth walk: every block is a
 *  node, and only its OWN properties (nested child blocks stripped) decide
 *  its status/compatibles. */
export function sweepCompatibles(dtsText: string): string[] {
  const found = new Set<string>();
  // The block's own properties: the text with nested child blocks removed.
  const ownProps = (body: string): string => {
    let out = '';
    let depth = 0;
    for (const ch of body) {
      if (ch === '{') { depth++; continue; }
      if (ch === '}') { depth--; continue; }
      if (depth === 0) out += ch;
    }
    return out;
  };
  // Visit EVERY node block (advancing past '{' only, so nested nodes are
  // found by later iterations too).
  let i = 0;
  while (i < dtsText.length) {
    const open = dtsText.indexOf('{', i);
    if (open < 0) break;
    let depth = 1;
    let j = open + 1;
    while (j < dtsText.length && depth > 0) {
      const c = dtsText[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      j++;
    }
    const props = ownProps(dtsText.slice(open + 1, Math.min(j, dtsText.length) - (depth === 0 ? 1 : 0)));
    if (!/status\s*=\s*"disabled"/.test(props)) {
      for (const m of props.matchAll(/compatible\s*=\s*((?:"[^"]*"\s*,?\s*)+)/g)) {
        for (const s of m[1].matchAll(/"([^"]+)"/g)) found.add(s[1]);
      }
    }
    i = open + 1;
  }
  return [...found].sort();
}

// ---------------------------------------------------------------------------
// Facts + rules
// ---------------------------------------------------------------------------

export interface SecurityFacts {
  config: Map<string, KconfigValue>;
  compatibles: string[];
}

const on = (f: SecurityFacts, name: string): boolean => f.config.get(name) === true;
const anyOn = (f: SecurityFacts, ...names: string[]): boolean => names.some((n) => on(f, n));

export type AuditSeverity = 'high' | 'medium' | 'low';

export interface AuditFinding {
  rule: string;
  title: string;
  severity: AuditSeverity;
  requirement: string;
  remediation: string;
  /** The as-built evidence line(s) that triggered the rule. */
  evidence: string;
}

export interface AuditRule {
  id: string;
  title: string;
  severity: AuditSeverity;
  /** CRA essential-requirement paraphrase this rule maps to. */
  requirement: string;
  remediation: string;
  /** Returns the evidence string when the rule fires, else null. */
  evaluate: (facts: SecurityFacts) => string | null;
}

/**
 * The Zephyr security baseline. Rules read ONLY config/devicetree facts —
 * never a board name or SoC family (all-boards-are-equal). Every rule must
 * be waivable with a recorded justification: real products have real
 * exceptions, and a conformity assessor wants to see them documented, not
 * hidden.
 */
export const SECURITY_RULES: readonly AuditRule[] = [
  {
    id: 'zephyr.gdbstub',
    title: 'remote debug stub compiled into the image',
    severity: 'high',
    requirement: 'Annex I 1.2(a) — attack surface minimised; no remotely exploitable debug interfaces',
    remediation: 'disable CONFIG_GDBSTUB for production builds (gate it behind a debug build type)',
    evaluate: (f) => (on(f, 'CONFIG_GDBSTUB') ? 'CONFIG_GDBSTUB=y' : null),
  },
  {
    id: 'zephyr.bt-fixed-passkey',
    title: 'static Bluetooth pairing passkey (hard-coded credential)',
    severity: 'high',
    requirement: 'Annex I 1.2(f) — no hard-coded credentials; unique per-device secrets',
    remediation: 'remove CONFIG_BT_FIXED_PASSKEY and use per-device pairing (just-in-time/numeric comparison)',
    evaluate: (f) => {
      const v = f.config.get('CONFIG_BT_FIXED_PASSKEY');
      return typeof v === 'number' ? `CONFIG_BT_FIXED_PASSKEY=${v}` : null;
    },
  },
  {
    id: 'zephyr.entropy-missing',
    title: 'crypto/networking enabled without a hardware entropy source',
    severity: 'high',
    requirement: 'Annex I 1.2(c) — cryptographic primitives backed by proper randomness',
    remediation: 'enable CONFIG_ENTROPY_GENERATOR (the board SoC entropy driver) — keys and nonces '
      + 'derived without it are predictable',
    evaluate: (f) => {
      if (on(f, 'CONFIG_ENTROPY_GENERATOR')) return null;
      const consumers = ['CONFIG_BT', 'CONFIG_NETWORKING', 'CONFIG_MBEDTLS', 'CONFIG_TINYCRYPT'].filter(
        (n) => on(f, n),
      );
      if (consumers.length === 0) return null;
      return '# CONFIG_ENTROPY_GENERATOR is not set (while '
        + consumers.map((c) => `${c}=y`).join(', ')
        + ')';
    },
  },
  {
    id: 'zephyr.shell-enabled',
    title: 'interactive shell compiled in',
    severity: 'high',
    requirement: 'Annex I 1.2(a) — attack surface minimised; no unnecessary interactive interfaces',
    remediation: 'disable CONFIG_SHELL for production builds, or restrict it to a debug build type',
    evaluate: (f) => (on(f, 'CONFIG_SHELL') ? 'CONFIG_SHELL=y' : null),
  },
  {
    id: 'zephyr.network-no-tls',
    title: 'network stack enabled without a TLS library',
    severity: 'medium',
    requirement: 'Annex I 1.2(c)/(e) — confidential communication over networks',
    remediation: 'enable CONFIG_MBEDTLS (mbedTLS SSL) for networked firmware, or document why the '
      + 'traffic may stay in cleartext',
    evaluate: (f) =>
      on(f, 'CONFIG_NETWORKING') && !on(f, 'CONFIG_MBEDTLS')
        ? 'CONFIG_NETWORKING=y, # CONFIG_MBEDTLS is not set'
        : null,
  },
  {
    id: 'zephyr.watchdog-absent',
    title: 'no watchdog configured',
    severity: 'medium',
    requirement: 'Annex I 1.3(b) — resilience and availability of essential functions',
    remediation: 'enable CONFIG_WATCHDOG and feed it from the app (hal: `new Watchdog(...)` on a '
      + 'watchdog-capable board) so hangs recover instead of bricking the product',
    evaluate: (f) => (on(f, 'CONFIG_WATCHDOG') ? null : '# CONFIG_WATCHDOG is not set'),
  },
  {
    id: 'zephyr.console-enabled',
    title: 'diagnostic console enabled',
    severity: 'low',
    requirement: 'Annex I 1.2(a) — attack surface minimised (informational: consoles are often '
      + 'intentional in the field)',
    remediation: 'if the console is not needed in production, disable it (CONFIG_UART_CONSOLE / '
      + 'CONFIG_USB_CONSOLE / CONFIG_RTT_CONSOLE)',
    evaluate: (f) => {
      const which = ['CONFIG_UART_CONSOLE', 'CONFIG_USB_CONSOLE', 'CONFIG_RTT_CONSOLE'].filter((n) =>
        on(f, n),
      );
      return which.length > 0 ? which.join(', ') + ' enabled' : null;
    },
  },
  {
    id: 'zephyr.hardening-off',
    title: 'compiler hardening stack not enabled',
    severity: 'low',
    requirement: 'Annex I 1.2(b) — reduce exploitability of residual vulnerabilities',
    remediation: 'enable CONFIG_HARDENING (stack canaries and friends) unless the overhead is '
      + 'measured to matter',
    evaluate: (f) => (on(f, 'CONFIG_HARDENING') ? null : 'CONFIG_HARDENING not enabled'),
  },
];

/** Evaluate the baseline over the facts. Order follows rule severity. */
export function evaluateSecurityRules(facts: SecurityFacts): AuditFinding[] {
  const order: Record<AuditSeverity, number> = { high: 0, medium: 1, low: 2 };
  const findings: AuditFinding[] = [];
  for (const rule of SECURITY_RULES) {
    const evidence = rule.evaluate(facts);
    if (evidence !== null) {
      findings.push({
        rule: rule.id,
        title: rule.title,
        severity: rule.severity,
        requirement: rule.requirement,
        remediation: rule.remediation,
        evidence,
      });
    }
  }
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return findings;
}

// ---------------------------------------------------------------------------
// Waivers (recorded deviations, committed with the project)
// ---------------------------------------------------------------------------

export interface AuditWaiver {
  rule: string;
  justification: string;
  date?: string;
}

export function parseWaiverFile(text: string | undefined): { waivers: AuditWaiver[]; error?: string } {
  if (!text) return { waivers: [] };
  try {
    const parsed = JSON.parse(text) as { waivers?: unknown };
    if (!parsed || !Array.isArray(parsed.waivers)) {
      return { waivers: [], error: 'waiver file must be `{ "waivers": [...] }` — ignored' };
    }
    const waivers: AuditWaiver[] = [];
    for (const w of parsed.waivers) {
      if (
        w &&
        typeof w === 'object' &&
        typeof (w as AuditWaiver).rule === 'string' &&
        typeof (w as AuditWaiver).justification === 'string'
      ) {
        const entry = w as AuditWaiver;
        if (entry.justification.trim().length === 0) {
          return { waivers: [], error: `waiver for ${entry.rule} has an empty justification — ignored` };
        }
        waivers.push(entry);
      }
    }
    return { waivers };
  } catch {
    return { waivers: [], error: 'waiver file is not valid JSON — ignored' };
  }
}

/** Find .typecad-hal/audit-waivers.json, walking up from `cwd` (bounded). */
export function findWaiverFile(readFile: ReadFile, cwd: string): string | undefined {
  let dir = path.resolve(cwd);
  for (let i = 0; i < 5; i++) {
    const p = path.join(dir, '.typecad-hal', 'audit-waivers.json');
    if (readFile(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Runner seam (test injection; no west needed — the audit reads the build)
// ---------------------------------------------------------------------------

export interface AuditRunner {
  cwd?: string;
  /** The last build's compile_commands.json path, or undefined. */
  compileCommandsPath?: () => string | undefined;
  readFile: ReadFile;
}

function defaultAuditRunner(cwd = process.cwd()): AuditRunner {
  const readFile: ReadFile = (p) => {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      return undefined;
    }
  };
  const readdir = (d: string): string[] => {
    try {
      return readdirSync(d);
    } catch {
      return [];
    }
  };
  return {
    cwd,
    compileCommandsPath: () => findCompileCommandsPath(readFile, readdir, cwd),
    readFile,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface AuditReport {
  schema: 'typecad-hal/security-audit@1';
  generated: string;
  buildDir: string;
  summary: {
    console: 'uart' | 'usb' | 'rtt' | 'none';
    shell: boolean;
    network: boolean;
    bluetooth: boolean;
    usbDevice: boolean;
    entropy: boolean;
    watchdog: boolean;
    hardware: string[];
  };
  findings: AuditFinding[];
  deviations: (AuditFinding & { justification: string; date?: string })[];
  rulesEvaluated: number;
  waiverFile?: string;
}

export function buildAuditReport(args: {
  buildDir: string;
  facts: SecurityFacts;
  findings: AuditFinding[];
  deviations: (AuditFinding & { justification: string; date?: string })[];
  generated?: string;
  waiverFile?: string;
}): AuditReport {
  const f = args.facts;
  const consoleType = on(f, 'CONFIG_UART_CONSOLE')
    ? 'uart'
    : on(f, 'CONFIG_USB_CONSOLE')
      ? 'usb'
      : on(f, 'CONFIG_RTT_CONSOLE')
        ? 'rtt'
        : 'none';
  return {
    schema: 'typecad-hal/security-audit@1',
    generated: args.generated ?? new Date().toISOString(),
    buildDir: args.buildDir,
    summary: {
      console: consoleType,
      shell: on(f, 'CONFIG_SHELL'),
      network: on(f, 'CONFIG_NETWORKING'),
      bluetooth: on(f, 'CONFIG_BT'),
      usbDevice: anyOn(f, 'CONFIG_USB_DEVICE_STACK', 'CONFIG_USB_DEVICE_DRIVER'),
      entropy: on(f, 'CONFIG_ENTROPY_GENERATOR'),
      watchdog: on(f, 'CONFIG_WATCHDOG'),
      hardware: f.compatibles,
    },
    findings: args.findings,
    deviations: args.deviations,
    rulesEvaluated: SECURITY_RULES.length,
    waiverFile: args.waiverFile,
  };
}

/** Options accepted by `runAuditPresenter` (structurally compatible with the
 *  parsed `typecad-hal audit` CLI options). */
export interface AuditPresenterOptions {
  /** Exit 1 on any unwaived high/medium finding. */
  strict?: boolean;
  /** Print only the JSON report (clean CI pipe); the sidecar is still written. */
  json?: boolean;
}

let testRunner: AuditRunner | undefined;

/** @internal Test-only override of the default runner. */
export function __setAuditRunnerForTest(runner: AuditRunner | undefined): void {
  testRunner = runner;
}

function printFinding(f: AuditFinding, waived?: string): void {
  // ui.printWarning already stamps its own "! " marker.
  ui.printWarning(`${waived ? 'waived ' : ''}[${f.severity}] ${f.rule} — ${f.title}`);
  ui.printInfo(`    requirement: ${f.requirement}`);
  ui.printInfo(`    evidence:    ${f.evidence}`);
  ui.printInfo(`    fix:         ${f.remediation}`);
  if (waived) ui.printInfo(`    waived:      ${waived}`);
}

/** `typecad-hal audit` presenter. */
export function runAuditPresenter(options: AuditPresenterOptions): void {
  const runner = testRunner ?? defaultAuditRunner();
  const cwd = runner.cwd ?? process.cwd();

  const ccPath = runner.compileCommandsPath ? runner.compileCommandsPath() : undefined;
  const buildDir = ccPath ? path.dirname(ccPath) : undefined;
  const configText = buildDir ? runner.readFile(path.join(buildDir, 'zephyr', '.config')) : undefined;
  if (!buildDir || configText === undefined) {
    ui.printError(
      'No build found — audit reads the merged zephyr/.config of the last build. Run typecad-hal build first.',
    );
    process.exitCode = 1;
    return;
  }
  const dtsText = runner.readFile(path.join(buildDir, 'zephyr', 'zephyr.dts'));
  const facts: SecurityFacts = {
    config: parseMergedConfig(configText),
    compatibles: dtsText ? sweepCompatibles(dtsText) : [],
  };

  const all = evaluateSecurityRules(facts);
  const waiverPath = findWaiverFile(runner.readFile, cwd);
  const { waivers, error: waiverError } = parseWaiverFile(
    waiverPath ? runner.readFile(waiverPath) : undefined,
  );
  const waivedByRule = new Map(waivers.map((w) => [w.rule, w]));
  const findings = all.filter((f) => !waivedByRule.has(f.rule));
  const deviations = all
    .filter((f) => waivedByRule.has(f.rule))
    .map((f) => ({ ...f, ...(waivedByRule.get(f.rule) as AuditWaiver) }));

  const report = buildAuditReport({ buildDir, facts, findings, deviations, waiverFile: waiverPath });

  // Sidecar first (best-effort, never fatal), then the human/JSON surface.
  try {
    mkdirSync(buildDir, { recursive: true });
    writeFileSync(path.join(buildDir, 'security-audit.json'), JSON.stringify(report, null, 2) + '\n');
  } catch {
    /* best-effort sidecar */
  }

  // --strict: unwaived high/medium findings fail. Waived findings are
  // recorded deviations, not failures.
  const failing = findings.filter((f) => f.severity === 'high' || f.severity === 'medium');
  if (options.strict && failing.length > 0) {
    process.exitCode = 1;
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  ui.printHeader();
  ui.printStep('Auditing the merged build configuration (security baseline)');

  let boardTarget: string | undefined;
  try {
    boardTarget = loadTypecadConfig(process.cwd())?.buildTarget;
  } catch {
    /* best-effort */
  }
  if (boardTarget) ui.printInfo(`board ............. ${boardTarget}`);

  const s = report.summary;
  ui.printInfo(
    `surface ........... console ${s.console} · shell ${s.shell ? 'ON' : 'off'} · net ${s.network ? 'ON' : 'off'} · ` +
      `BLE ${s.bluetooth ? 'ON' : 'off'} · USB device ${s.usbDevice ? 'ON' : 'off'}`,
  );
  ui.printInfo(
    `underpinnings ..... entropy ${s.entropy ? 'ok' : 'OFF'} · watchdog ${s.watchdog ? 'ok' : 'OFF'} · ` +
      `${s.hardware.length} wired compatible(s)`,
  );
  if (waiverError) ui.printWarning(`waiver file: ${waiverError}`);

  for (const f of findings) printFinding(f);
  for (const d of deviations) {
    printFinding(d, `${d.justification}${d.date ? ` (${d.date})` : ''}`);
  }

  if (all.length === 0) {
    ui.printSuccess(`baseline clean — ${report.rulesEvaluated} rules evaluated, 0 findings.`);
  } else {
    ui.printWarning(
      `${findings.length} finding(s) (${failing.length} unwaived high/medium), ` +
        `${deviations.length} waived deviation(s).`,
    );
  }
  if (waiverPath) {
    ui.printInfo(`waivers .......... ${waiverPath}`);
  }
  ui.printInfo(`sidecar .......... ${path.join(buildDir, 'security-audit.json')}`);
  if (options.strict) {
    ui.printInfo(
      failing.length > 0
        ? '--strict .......... FAIL (unwaived high/medium findings above)'
        : '--strict .......... pass',
    );
  }
}
