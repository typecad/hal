// Renders docs/framework-coverage.md from per-package framework manifests.
// Deterministic: running twice produces identical output modulo the
// "Last validated" date column (stable within a UTC day).
//
// Usage: npm run render:framework-coverage
//
// Also exports renderCoverageToString() for the doc-freshness test.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import {
  KNOWN_FRAMEWORK_PACKAGES,
  loadFrameworkManifest,
  type FrameworkManifest,
  HAL_CATEGORIES,
} from '@typecad/cuttlefish/api/shared';

const __filename_esm = url.fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);
const REPO_ROOT = path.resolve(__dirname_esm, '..');
const OUT_FILE = path.join(REPO_ROOT, 'docs', 'framework-coverage.md');

type Counts = { supported: number; partial: number; unsupported: number };

function categoryCounts(manifest: FrameworkManifest): Counts {
  const c: Counts = { supported: 0, partial: 0, unsupported: 0 };
  for (const cat of HAL_CATEGORIES) {
    const decl = (manifest.hal as Record<string, { supported: boolean; partialCoverage?: boolean }>)[cat];
    if (!decl) continue;
    if (decl.supported && !decl.partialCoverage) c.supported += 1;
    else if (decl.supported && decl.partialCoverage) c.partial += 1;
    else c.unsupported += 1;
  }
  return c;
}

function fmtToolchain(m: FrameworkManifest): string {
  const ops = m.toolchain.operations;
  const sym = (b: boolean) => (b ? '✓' : '·');
  const tail = m.toolchain.reexportedFrom
    ? ` (reexported from ${m.toolchain.reexportedFrom})`
    : '';
  // debug is optional in the schema (older manifests omit it) — show it only
  // when the framework declares the capability.
  const debugTail = ops.debug === undefined ? '' : ` debug ${sym(ops.debug)}`;
  return `${m.toolchain.backend}${tail} (prepare ${sym(ops.prepare)} compile ${sym(ops.compile)} upload ${sym(ops.upload)} monitor ${sym(ops.monitor)}${debugTail})`;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function renderCoverageToString(): Promise<string> {
  const manifests: Array<{ packageName: string; m: FrameworkManifest }> = [];
  for (const packageName of KNOWN_FRAMEWORK_PACKAGES) {
    manifests.push({ packageName, m: await loadFrameworkManifest(packageName) });
  }

  const lines: string[] = [];
  lines.push('# Framework Coverage');
  lines.push('');
  lines.push('Auto-generated from per-package `framework.manifest.ts` files.');
  lines.push('Do not edit directly; run `npm run render:framework-coverage` to regenerate.');
  lines.push('');
  lines.push(`Counts are out of ${HAL_CATEGORIES.length} HAL categories (raw passthrough tracked separately).`);
  lines.push('');
  lines.push('| Framework | HAL cats supported | HAL cats partial | HAL cats unsupported | Toolchain | Last validated |');
  lines.push('|---|---|---|---|---|---|');
  for (const { packageName, m } of manifests) {
    const c = categoryCounts(m);
    const canonical = m.canonical ? ' (canonical)' : '';
    const shortName = packageName.replace('@typecad/', '');
    lines.push(`| ${shortName}${canonical} | ${c.supported}/${HAL_CATEGORIES.length} | ${c.partial} | ${c.unsupported} | ${fmtToolchain(m)} | ${todayUTC()} |`);
  }
  lines.push('');

  // Per-framework detail
  for (const { packageName, m } of manifests) {
    const shortName = packageName.replace('@typecad/', '');
    lines.push(`## ${shortName}`);
    lines.push('');
    lines.push(`**${m.displayName}** — ${m.description}`);
    lines.push('');
    const impl = m.basedOn
      ? `${m.implementationMode} (based on ${m.basedOn})`
      : m.implementationMode;
    lines.push(`**Implements:** ${impl}`);
    const ep = m.entrypoint;
    const bridge = ep.customBridgeShim ? ` wrapped in \`${ep.customBridgeShim}\` bridge` : '';
    lines.push(`**Entrypoint:** \`${ep.entrypointFunctionName}\` + ${ep.requiresLoopFunction ? '`loop`' : 'no loop'}${bridge}`);
    lines.push(`**Toolchain:** ${fmtToolchain(m)}`);
    lines.push('');
    lines.push('### HAL categories');
    lines.push('');
    lines.push('| Category | Status | Notes |');
    lines.push('|---|---|---|');
    for (const cat of HAL_CATEGORIES) {
      const decl = (m.hal as Record<string, { supported: boolean; partialCoverage?: boolean; unsupportedReason?: string }>)[cat];
      if (!decl) {
        lines.push(`| ${cat} | (undeclared) | |`);
        continue;
      }
      const status = decl.supported
        ? (decl.partialCoverage ? 'partial' : 'supported')
        : 'unsupported';
      const notes = decl.unsupportedReason ?? '—';
      lines.push(`| ${cat} | ${status} | ${notes} |`);
    }
    lines.push('');
  }

  // Cross-framework gap analysis
  lines.push('## Cross-framework gaps');
  lines.push('');
  const header = ['Capability', ...manifests.map((x) => x.packageName.replace('@typecad/', ''))];
  lines.push('| ' + header.join(' | ') + ' |');
  lines.push('| ' + header.map(() => '---').join(' | ') + ' |');
  for (const cat of HAL_CATEGORIES) {
    const row = [cat];
    for (const { m } of manifests) {
      const decl = (m.hal as Record<string, { supported: boolean; partialCoverage?: boolean; unsupportedReason?: string }>)[cat];
      if (!decl) row.push('—');
      else if (decl.supported && !decl.partialCoverage) row.push('✓');
      else if (decl.supported && decl.partialCoverage) row.push('◐ partial');
      else {
        const reason = decl.unsupportedReason ? decl.unsupportedReason.split(/[;.]/)[0].toLowerCase().trim() : 'unsupported';
        row.push(`✗ (${reason})`);
      }
    }
    lines.push('| ' + row.join(' | ') + ' |');
  }
  lines.push('');

  return lines.join('\n');
}

async function main(): Promise<void> {
  const content = await renderCoverageToString();
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, content);
  console.log(`Wrote ${path.relative(REPO_ROOT, OUT_FILE)}`);
}

// Run main when invoked directly via tsx, not when imported by a test.
const isDirectInvocation = process.argv[1] && path.resolve(process.argv[1]) === __filename_esm;
if (isDirectInvocation) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
