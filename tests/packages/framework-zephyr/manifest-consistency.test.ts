// ---------------------------------------------------------------------------
// The REAL framework-zephyr manifest, validated against the REAL resolver.
//
// The validator probes every declared op against resolveHALOperation: a
// 'supported' declaration must lower, an 'unsupported' declaration must NOT.
// Nothing else in the tree runs it against the real manifest — without this
// test, a declared-but-broken op (or an honestly-undeclared one) drifts
// silently until a user hits it at build time.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFrameworkManifest } from '@typecad/cuttlefish/api/shared';
import manifestDefault from '../../../packages/framework-zephyr/src/framework.manifest';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';

// repoTestsDir: the repo's tests/ tree (the conformance checks resolve
// packages/<pkg>/hal-resolution/<cat>.test.ts from it).
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const repoTestsDir = path.join(repoRoot, 'tests');
const packageRoot = path.join(repoRoot, 'packages', 'framework-zephyr');

describe('framework-zephyr manifest ↔ lowering consistency', () => {
  it('every declared op matches what the resolver actually lowers', () => {
    const result = validateFrameworkManifest(manifestDefault, {
      strategy: new ZephyrStrategy(),
      moduleExports: {},
      packageRoot,
      repoTestsDir,
    });
    expect(result.errors).toEqual([]);
    expect((result.warnings ?? []).filter((w) => (w.code ?? '').startsWith('hal/'))).toEqual([]);
  });
});
