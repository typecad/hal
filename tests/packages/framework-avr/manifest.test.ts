import { describe, expect, it } from 'vitest';
import { validateFramework } from '../cuttlefish/manifest-test-helpers.js';

// AVR: known display inheritance errors are tolerated (documented in the
// manifest itself). Anything else is a regression.
const KNOWN_STRATEGIC_ERRORS: ReadonlySet<string> = new Set<string>([
  'hal/display/declared-unsupported-but-actually-lowers',
  'hal/display/op/display.init/status-mismatch',
]);

describe('framework-avr manifest', () => {
  it('matches its implementation modulo known display inheritance errors', async () => {
    const result = await validateFramework('@typecad/framework-avr');
    const novel = result.errors.filter((e) => !KNOWN_STRATEGIC_ERRORS.has(e.code));
    const dump = novel.map((e) => `[${e.code}] ${e.message}`).join('\n');
    expect(novel, dump).toEqual([]);
  });
});
