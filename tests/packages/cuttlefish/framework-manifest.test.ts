import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  KNOWN_FRAMEWORK_PACKAGES,
  loadFrameworkManifest,
} from '@typecad/cuttlefish/api/shared';
import {
  resolveFrameworkPackageRoot,
  resolveRepoTestsDir,
  validateFramework,
  loadFrameworkForValidation,
} from './manifest-test-helpers.js';
// Renderer lives in scripts/ — vitest resolves TS directly. Imports from
// the built cuttlefish dist, so the cuttlefish build must run first.
import { renderCoverageToString } from '../../../scripts/render-framework-coverage.js';

// Error codes that are acknowledged "known strategic" failures — documented
// in the manifest itself and slated for a separate fix spec. The central
// test allows these but fails on any OTHER error, so new regressions surface
// immediately while we don't pretend the latent bugs are fixed.
const KNOWN_STRATEGIC_ERRORS: ReadonlySet<string> = new Set<string>([
  // AVR + ESP32 inherit Arduino's resolveDisplayOp. They declare display
  // unsupported honestly; the inherited resolver still lowers display.init.
  // Fix is a separate spec: override resolveDisplayOp to throw on these
  // frameworks (or implement native display lowering for ESP32 in v1.1).
  'hal/display/declared-unsupported-but-actually-lowers',
  'hal/display/op/display.init/status-mismatch',
]);

describe('framework manifests', () => {
  it('exactly one framework is canonical', async () => {
    const canonical: string[] = [];
    for (const packageName of KNOWN_FRAMEWORK_PACKAGES) {
      const m = await loadFrameworkManifest(packageName);
      if (m.canonical) canonical.push(packageName);
    }
    expect(canonical).toEqual(['@typecad/framework-arduino']);
  });

  it('all manifests use the current schema version', async () => {
    for (const packageName of KNOWN_FRAMEWORK_PACKAGES) {
      const m = await loadFrameworkManifest(packageName);
      expect(m.schemaVersion, packageName).toBe(1);
    }
  });

  it('every framework is in KNOWN_FRAMEWORK_PACKAGES exactly once', () => {
    const dupes = KNOWN_FRAMEWORK_PACKAGES.filter(
      (p, i) => KNOWN_FRAMEWORK_PACKAGES.indexOf(p) !== i,
    );
    expect(dupes).toEqual([]);
  });

  for (const packageName of KNOWN_FRAMEWORK_PACKAGES) {
    describe(packageName, () => {
      it('declares a manifest matching its implementation (modulo known strategic errors)', async () => {
        const result = await validateFramework(packageName);
        const novel = result.errors.filter(
          (e) => !KNOWN_STRATEGIC_ERRORS.has(e.code),
        );
        const dump = novel
          .map((e) => `  [${e.code}] ${e.path}: ${e.message}`)
          .join('\n');
        expect(novel, `Novel errors for ${packageName}:\n${dump}`).toEqual([]);
      });
    });
  }

  // Document the known strategic errors explicitly so they don't drift
  // silently. If a future spec fixes the display inheritance bug, these
  // counts go to zero and the test above starts enforcing the stricter
  // invariant.
  describe('known strategic errors (documented, not fixed)', () => {
    it('framework-avr exhibits exactly the display inheritance errors', async () => {
      const result = await validateFramework('@typecad/framework-avr');
      const codes = new Set(result.errors.map((e) => e.code));
      expect(codes).toContain('hal/display/declared-unsupported-but-actually-lowers');
      expect(codes).toContain('hal/display/op/display.init/status-mismatch');
    });

    it('framework-esp32 exhibits exactly the display inheritance errors', async () => {
      const result = await validateFramework('@typecad/framework-esp32');
      const codes = new Set(result.errors.map((e) => e.code));
      expect(codes).toContain('hal/display/declared-unsupported-but-actually-lowers');
      expect(codes).toContain('hal/display/op/display.init/status-mismatch');
    });

    it('framework-arduino has no display inheritance errors (canonical reference)', async () => {
      const result = await validateFramework('@typecad/framework-arduino');
      const codes = result.errors.map((e) => e.code);
      expect(codes).not.toContain('hal/display/declared-unsupported-but-actually-lowers');
      expect(codes).not.toContain('hal/display/op/display.init/status-mismatch');
    });
  });

  // Suppress unused-import warnings for helpers re-exported for tests 15+.
  void resolveFrameworkPackageRoot;
  void resolveRepoTestsDir;
  void loadFrameworkForValidation;
});

describe('docs/framework-coverage.md freshness', () => {
  it('matches a fresh render', async () => {
    const fresh = await renderCoverageToString();
    // This file is tests/packages/cuttlefish/framework-manifest.test.ts.
    // Three ups reaches the repo root, then docs/framework-coverage.md.
    const committedPath = path.resolve(__dirname, '..', '..', '..', 'docs', 'framework-coverage.md');
    // Normalize CRLF → LF on both sides: git's core.autocrlf may rewrite
    // line endings on commit/checkout (especially on Windows), so the
    // working-tree file may have CRLF even though the renderer emits LF.
    // The semantic content is what matters.
    const committed = fs.readFileSync(committedPath, 'utf8').replace(/\r\n/g, '\n');
    const normalizedFresh = fresh.replace(/\r\n/g, '\n');
    expect(committed, 'Run `npm run render:framework-coverage` to regenerate').toBe(normalizedFresh);
  });
});
