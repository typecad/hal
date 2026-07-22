import { describe, expect, it } from 'vitest';
import { validateFrameworkWithCoverage } from '../cuttlefish/manifest-test-helpers.js';

// AVR: display inheritance errors are fixed — resolveDisplayOp now returns
// undefined and resolveDisplayAdapter dispatches to native drivers. Zero
// strategic errors are tolerated; any error is a regression.
describe('framework-avr manifest', () => {
  it('matches its implementation with zero errors', async () => {
    const { result, coverageTable } = await validateFrameworkWithCoverage('@typecad/framework-avr');
    console.log(coverageTable);
    const dump = result.errors.map((e) => `[${e.code}] ${e.message}`).join('\n');
    expect(result.errors, dump).toEqual([]);
  });
});
