// ---------------------------------------------------------------------------
// scripts/demos-strict.mjs — build every demo with --autosar=strict and fail
// on any build error OR any compiler warning not in the committed baseline
// (demos-strict-baseline.json). Warnings are regressions: the dead-code and
// narrowing finds of rounds 3 and 5 surfaced as warnings first.
//
//   node scripts/demos-strict.mjs [--update-baseline] [--skip-compile]
//
// --update-baseline  rewrite the baseline from the current run (deliberate)
// --skip-compile     transpile+typecheck only (fast gate, no g++ warnings)
// ---------------------------------------------------------------------------

import { execSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname ?? path.dirname(process.argv[1]), "..");
const DEMOS = path.join(ROOT, "demos");
const BASELINE = path.join(ROOT, "scripts/demos-strict-baseline.json");

const updateBaseline = process.argv.includes("--update-baseline");
const skipCompile = process.argv.includes("--skip-compile");

const demoDirs = fs.readdirSync(DEMOS, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .filter(e => fs.existsSync(path.join(DEMOS, e.name, "typecad-hal.config.ts")))
  .map(e => e.name)
  .sort();

console.log(`demos-strict: ${demoDirs.length} demos, compile=${!skipCompile}\n`);

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : {};
const nextBaseline = {};
const failures = [];
const knownFailures = [];
const newWarnings = [];

for (const demo of demoDirs) {
  const args = ["npx", "typecad-hal", "build"];
  if (!skipCompile) args.push("--compile");
  args.push("--autosar=strict");
  process.stdout.write(`[${demo}] `);
  const started = Date.now();
  const run = spawnSync(args.join(" "), {
    cwd: path.join(DEMOS, demo),
    shell: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = (run.stdout ?? "") + (run.stderr ?? "");
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  const warnings = [...out.matchAll(/^.*warning:.*$/gm)].map(l => l[0].replace(/#.*main\.ts/, "#…").trim());
  const buildFailed = run.status !== 0;

  // Normalized signatures (positions stripped) — the baseline keys on these
  // so pre-existing strict failures/warnings set the floor without churning.
  const key = demo;
  const prior = baseline[key];
  const knownErrors = new Set(Array.isArray(prior) ? [] : ((prior && prior.errors) ?? []));
  const knownWarnings = new Set(Array.isArray(prior) ? prior : ((prior && prior.warnings) ?? []));
  const errors = [...new Set(out.split("\n")
    .filter(l => /error:/i.test(l))
    .map(l => l.replace(/#[^ ]*/g, "").replace(/\(\d+[,:]\d+\)?/g, "").replace(/\s+/g, " ").trim().slice(0, 160)))]
    .sort();
  if (buildFailed) {
    const freshErrors = errors.filter(e => !knownErrors.has(e));
    if (freshErrors.length > 0) {
      failures.push(`${demo}: build failed with NEW errors — ${freshErrors.slice(0, 2).join(" | ")}`);
      console.log(`FAIL/NEW (${secs}s)`);
    } else {
      knownFailures.push(`${demo} (${errors.length} baselined errors)`);
      console.log(`fail-baselined (${secs}s)`);
    }
    if (errors.length > 0) nextBaseline[key] = { warnings: [], errors };
    continue;
  }

  // Dedupe + strip line numbers so renames don't churn the baseline.
  const normalized = [...new Set(warnings.map(w => w.replace(/\(?\d+[,:]\d+\)?/g, "").replace(/\s+/g, " ").trim()))].sort();
  const fresh = normalized.filter(w => !knownWarnings.has(w));
  if (fresh.length > 0) {
    newWarnings.push(...fresh.map(w => `${demo}: ${w}`));
    console.log(`NEW WARNINGS (${secs}s): ${fresh.length}`);
  } else {
    console.log(`ok (${secs}s, ${normalized.length} baselined)`);
  }
  if (normalized.length > 0) nextBaseline[key] = { warnings: normalized, errors: [] };
}

if (updateBaseline) {
  fs.writeFileSync(BASELINE, JSON.stringify(nextBaseline, Object.keys(nextBaseline).sort(), 2) + "\n");
  console.log(`\nbaseline updated: ${Object.keys(nextBaseline).length} demos with warnings`);
  process.exit(0);
}

if (failures.length > 0 || newWarnings.length > 0) {
  console.error(`\n=== FAILURES (${failures.length}):`);
  for (const f of failures) console.error("  " + f);
  console.error(`\n=== NEW WARNINGS not in baseline (${newWarnings.length}):`);
  for (const w of newWarnings) console.error("  " + w);
  console.error("\nFix the cause, or run --update-baseline to accept as the new floor.");
  process.exit(1);
}

const baselined = Object.values(baseline).reduce((a, v) => a + v.length, 0);
console.log(`\nall demos strict-green. ${baselined} known warnings baselined across ${Object.keys(baseline).length} demos.`);
