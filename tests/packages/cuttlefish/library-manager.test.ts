import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildLibrarySearchQuery,
  shapeResult,
  type NpmSearchPackage,
} from '../../../packages/cuttlefish/src/library/registry-search';
import { findProjectPackageJson, installedDependencyVersion } from '../../../packages/cuttlefish/src/library/install';
import { LIBRARY_MARKER_KEYWORD } from '../../../packages/cuttlefish/src/library/catalog';

describe('library registry search', () => {
  it('always anchors the query on the marker keyword', () => {
    expect(buildLibrarySearchQuery()).toBe(`keywords:${LIBRARY_MARKER_KEYWORD}`);
  });

  it('ANDs the category keyword and free text', () => {
    expect(buildLibrarySearchQuery('ws2812', 'led')).toBe(
      `keywords:${LIBRARY_MARKER_KEYWORD} keywords:cuttlefish-led ws2812`,
    );
    expect(buildLibrarySearchQuery('  gps  ')).toBe(
      `keywords:${LIBRARY_MARKER_KEYWORD} gps`,
    );
  });

  it('shapes results with a derived category and npm url fallback', () => {
    const pkg: NpmSearchPackage = {
      name: '@acme/led-ring',
      version: '1.2.3',
      description: 'A ring of pixels',
      keywords: ['cuttlefish-library', 'cuttlefish-led'],
    };
    expect(shapeResult(pkg)).toEqual({
      name: '@acme/led-ring',
      version: '1.2.3',
      description: 'A ring of pixels',
      category: 'led',
      npmUrl: 'https://www.npmjs.com/package/@acme/led-ring',
      published: null,
    });
    expect(shapeResult({ name: 'x', version: '0.0.1', keywords: ['cuttlefish-library'] }).category).toBeNull();
  });
});

describe('library install helpers', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tc-lib-install-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('walks up to the nearest package.json', () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{}');
    expect(findProjectPackageJson(join(dir, 'src'))).toBe(join(dir, 'package.json'));
    expect(findProjectPackageJson(dir)).toBe(join(dir, 'package.json'));
  });

  it('returns null when no package.json exists above', () => {
    expect(findProjectPackageJson(dir)).toBeNull();
  });

  it('reads installed dependency specs from all dependency sections', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        dependencies: { '@acme/a': '^1.0.0' },
        devDependencies: { '@acme/b': 'workspace:*' },
      }),
    );
    expect(installedDependencyVersion(join(dir, 'package.json'), '@acme/a')).toBe('^1.0.0');
    expect(installedDependencyVersion(join(dir, 'package.json'), '@acme/b')).toBe('workspace:*');
    expect(installedDependencyVersion(join(dir, 'package.json'), '@acme/c')).toBeUndefined();
  });
});
