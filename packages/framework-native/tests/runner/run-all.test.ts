// ---------------------------------------------------------------------------
// Native test runner — vitest entry point
//
// Discovers all NN-name.test.ts fixtures in tests/ and runs each through the
// full native pipeline (preprocess -> transpile -> compile -> run -> verify).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runNativeTest } from './native-pipeline';

interface Fixture {
  name: string;
  path: string;
}

function discoverFixtures(): Fixture[] {
  const testsDir = path.resolve(__dirname, '..');
  const entries = fs.readdirSync(testsDir);
  return entries
    .filter(f => /^\d{2}-.+\.test\.ts$/.test(f))
    .sort()
    .map(f => ({
      name: f.replace(/\.test\.ts$/, ''),
      path: path.join(testsDir, f),
    }));
}

const fixtures = discoverFixtures();

describe('Native executable test suite', () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const result = runNativeTest(fixture.path);

      if (result.error) {
        throw new Error(`Pipeline error in ${fixture.name}:\n${result.error}`);
      }

      const failures: string[] = [];
      for (const desc of result.describes) {
        for (const test of desc.tests) {
          for (const assertion of test.assertions) {
            if (!assertion.passed) {
              failures.push(
                `  ${desc.name} > ${test.name}: ` +
                `expect(${assertion.actual}).${assertion.matcher}(${assertion.expected})`,
              );
            }
          }
        }
      }

      expect(failures, `Assertion failures in ${fixture.name}:\n${failures.join('\n')}`).toHaveLength(0);
    });
  }
});
