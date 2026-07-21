import { describe, expect, it } from 'vitest';
import { validateFrameworkWithCoverage } from '../cuttlefish/manifest-test-helpers.js';

// Arduino is the canonical reference — no known-strategic errors allowed.
describe('framework-arduino manifest', () => {
  it('matches its implementation with zero errors', async () => {
    const { result, coverageTable } = await validateFrameworkWithCoverage('@typecad/framework-arduino');
    // Print the per-op coverage table so it's visible on every test run.
    // Use console.log so vitest's default reporter shows it (may require --reporter=verbose
    // or no --silent flag; on CI it appears in the test's stdout).
    console.log(coverageTable);
    const dump = result.errors.map((e) => `[${e.code}] ${e.message}`).join('\n');
    expect(result.errors, dump).toEqual([]);
  });
});
