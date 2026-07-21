import { describe, expect, it } from 'vitest';
import { validateFramework } from '../cuttlefish/manifest-test-helpers.js';

// Arduino is the canonical reference — no known-strategic errors allowed.
describe('framework-arduino manifest', () => {
  it('matches its implementation with zero errors', async () => {
    const result = await validateFramework('@typecad/framework-arduino');
    const dump = result.errors.map((e) => `[${e.code}] ${e.message}`).join('\n');
    expect(result.errors, dump).toEqual([]);
  });
});
