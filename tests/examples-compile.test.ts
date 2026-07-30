// ---------------------------------------------------------------------------
// Validates that every website example still transpiles cleanly against the
// current HAL/firmware packages. This is the synchronization guarantee: if an
// HAL change breaks an example, this test goes red in `npm test` / CI before
// the website is ever rebuilt.
//
// Each example under website/src/content/examples/<slug>/ is discovered, its
// cuttlefish.config.ts is read to derive the board/target, and the entry .ts
// file is fed to the same transpile() helper the rest of the test suite uses.
// We assert zero error-severity diagnostics and non-empty C++ output.
//
// Deliberately NOT asserted:
//   - emitted C++ snapshots (would fail on any legitimate HAL change, which
//     defeats the purpose — we want to catch *errors*, not freeze *output*).
//   - .test.ts files (those run through the @typecad/expect preprocessor, a
//     separate pipeline a bare transpile() call does not exercise).
//   - real cross-compilation to .hex/.bin (needs arduino-cli + toolchains,
//     which the repo treats as environment-dependent — see setup.ts).
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { transpile } from './setup';
import { loadCuttlefishConfig } from '../packages/cuttlefish/src/testing';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesRoot = path.resolve(__dirname, '..', 'website', 'src', 'content', 'examples');

/**
 * The config's `framework` field is a package specifier
 * ('@typecad/framework-arduino' | '@typecad/framework-zephyr' |
 * '@typecad/framework-native' | custom). transpile()'s `target` option is the
 * framework *family* ('arduino' | 'native' | 'generic'). Only native maps to
 * 'native'; the Arduino framework transpiles under 'arduino', with the
 * specific board carried by buildTarget (FQBN) + boardPackage.
 */
function targetForFramework(framework?: string): 'arduino' | 'native' {
	if (!framework) return 'arduino';
	return framework.includes('native') ? 'native' : 'arduino';
}

// Discover example slug directories up front. If none exist the whole suite
// self-skips (keeps CI green during rollout and if examples are removed).
const examples = fs.existsSync(examplesRoot)
	? fs
			.readdirSync(examplesRoot, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name)
			.sort()
	: [];

describe('website examples transpile cleanly against the HAL', () => {
	if (!examples.length) {
		it.skip('no examples present', () => {});
		return;
	}

	for (const slug of examples) {
		describe(`example: ${slug}`, () => {
			const dir = path.join(examplesRoot, slug);
			const config = loadCuttlefishConfig(dir);

			// Entry from config, falling back to the conventional default. UI
			// examples (entry ending in .ui) use a different transpile path and
			// are skipped rather than reported as failures.
			const entry = config?.entry ?? './src/main.ts';
			if (!entry.endsWith('.ts')) {
				it.skip(`entry ${entry} is not a .ts file`, () => {});
				return;
			}

			const entryPath = path.resolve(dir, entry);
			if (!fs.existsSync(entryPath)) {
				it.skip(`entry ${entry} not found`, () => {});
				return;
			}

			it(`${entry} transpiles with no errors`, () => {
				const source = fs.readFileSync(entryPath, 'utf-8');
				const result = transpile(source, {
					target: targetForFramework(config?.framework),
					boardPackage: config?.board,
					platformContext: config?.buildTarget
						? { frameworkData: { buildTarget: config.buildTarget } }
						: undefined,
				});

				const errors = result.diagnostics.filter((d) => d.severity === 'error');
				expect(
					errors,
					`HAL/transpile errors in ${slug}/${entry}:\n${JSON.stringify(errors, null, 2)}`
				).toEqual([]);
				expect(result.cpp.length, `transpiler produced empty output for ${slug}/${entry}`).toBeGreaterThan(0);
			});
		});
	}
});
