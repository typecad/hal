import { describe, expect, it } from 'vitest';
import { validateFrameworkWithCoverage } from '../cuttlefish/manifest-test-helpers.js';

// ESP32: known display inheritance errors are tolerated (documented in the
// manifest itself, deferred to v1.1). Anything else is a regression.
const KNOWN_STRATEGIC_ERRORS: ReadonlySet<string> = new Set<string>([
  'hal/display/declared-unsupported-but-actually-lowers',
  'hal/display/op/display.init/status-mismatch',
]);

describe('framework-esp32 manifest', () => {
  it('matches its implementation modulo known display inheritance errors', async () => {
    const { result, coverageTable } = await validateFrameworkWithCoverage('@typecad/framework-esp32');
    console.log(coverageTable);
    const novel = result.errors.filter((e) => !KNOWN_STRATEGIC_ERRORS.has(e.code));
    const dump = novel.map((e) => `[${e.code}] ${e.message}`).join('\n');
    expect(novel, dump).toEqual([]);
  });
});
