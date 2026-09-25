import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import {
  collectSbomInventory,
  buildCycloneDXBom,
  buildSpdxDocument,
  sbomSerialNumber,
  canonicalJson,
  diffCycloneDxDocs,
  parseWestListOutput,
  parseZephyrVersion,
  runSbomPresenter,
  stampBuildSbom,
  __setSbomRunnerForTest,
  type SbomRunner,
  type WestModuleRef,
} from '../../../packages/framework-zephyr/src/sbom';

// ---------------------------------------------------------------------------
// Schema validation (vendored official schemas)
// ---------------------------------------------------------------------------

const fixtureDir = fileURLToPath(new URL('./fixtures/sbom', import.meta.url));
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(JSON.parse(readFileSync(path.join(fixtureDir, 'spdx.schema.json'), 'utf8')));
ajv.addSchema(JSON.parse(readFileSync(path.join(fixtureDir, 'jsf-0.82.schema.json'), 'utf8')));
const cdxSchema = JSON.parse(readFileSync(path.join(fixtureDir, 'bom-1.6.schema.json'), 'utf8'));
const spdxSchema = JSON.parse(readFileSync(path.join(fixtureDir, 'spdx-2.3.schema.json'), 'utf8'));
// The official schemas use IRI/date-time formats ajv doesn't bundle; register
// every format they mention as pass-through — the tests assert structure, not
// IRI grammar.
const collectFormats = (s: unknown, found = new Set<string>()): Set<string> => {
  if (Array.isArray(s)) {
    for (const v of s) collectFormats(v, found);
  } else if (s && typeof s === 'object') {
    const o = s as Record<string, unknown>;
    if (typeof o.format === 'string') found.add(o.format);
    for (const v of Object.values(o)) collectFormats(v, found);
  }
  return found;
};
for (const f of [...collectFormats(cdxSchema), ...collectFormats(spdxSchema)]) {
  ajv.addFormat(f, () => true);
}
const validateCdx = ajv.compile(cdxSchema);
const validateSpdx = ajv.compile(spdxSchema);

// ---------------------------------------------------------------------------
// Helpers — in-memory runner seam (mirrors licenses.test.ts)
// ---------------------------------------------------------------------------

const fsStub = (files: Record<string, string>): { readFile: SbomRunner['readFile']; readdir: SbomRunner['readdir'] } => {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const readFile: SbomRunner['readFile'] = (p) => {
    const n = norm(p);
    if (files[n] !== undefined) return files[n];
    const base = n.split("/").pop();
    const hit = Object.entries(files).find(([k]) => norm(k).split("/").pop() === base);
    return hit ? hit[1] : undefined;
  };
  const readdir: SbomRunner['readdir'] = (d) => {
    const nd = norm(d);
    const children = new Set<string>();
    for (const k of Object.keys(files)) {
      const nk = norm(k);
      if (nk.startsWith(nd + "/")) {
        const rest = nk.slice(nd.length + 1);
        const first = rest.split("/")[0];
        if (first) children.add(first);
      }
    }
    return [...children];
  };
  return { readFile, readdir };
};

const KSHA = 'c'.repeat(40);
const M1SHA = 'a'.repeat(40);
const M2SHA = 'b'.repeat(40);
const BIN_SHA = 'f'.repeat(64);
const BIN_PATH = '/b/zephyr/zephyr.bin';

function baseFiles(): Record<string, string> {
  return {
    '/zephyr/LICENSE': 'Apache License\nVersion 2.0',
    '/zephyr/VERSION': 'VERSION_MAJOR = 4\nVERSION_MINOR = 3\nVERSION_PATCH = 0\n',
    '/mods/mit/LICENSE': 'MIT licence\nPermission is hereby granted, free of charge',
    '/mods/unused/LICENSE': 'MIT licence\nPermission is hereby granted, free of charge',
    '/b/compile_commands.json': JSON.stringify([
      { file: '/zephyr/src/main.c' },
      { file: '/mods/mit/src/thing.c' },
    ]),
    '/proj/package.json': JSON.stringify({ name: 'my-fw', version: '1.2.3' }),
  };
}

function baseModules(): WestModuleRef[] {
  return [
    { name: 'zephyr', abspath: '/zephyr', revision: KSHA, sha: KSHA, url: 'https://github.com/zephyrproject-rtos/zephyr' },
    { name: 'hal_mit', abspath: '/mods/mit', revision: M1SHA, sha: M1SHA, url: 'https://example.com/hal-mit' },
    { name: 'hal_unused', abspath: '/mods/unused', revision: M2SHA, sha: M2SHA },
  ];
}

interface MakeOverrides extends Partial<SbomRunner> {
  files?: Record<string, string>;
}

/** In-memory runner over the standard fixture workspace. POSIX-style paths in
 *  the file map; seams normalize so Windows path.join output still matches. */
function makeRunner(over: MakeOverrides = {}): SbomRunner {
  const files = over.files ?? baseFiles();
  const { readFile, readdir } = fsStub(files);
  return {
    cwd: '/proj',
    zephyrBase: '/zephyr',
    listModules: () => baseModules(),
    compileCommandsPath: () =>
      files['/b/compile_commands.json'] !== undefined ? '/b/compile_commands.json' : undefined,
    readFile,
    readdir,
    sha256: (p) => (p.split('\\').join('/') === BIN_PATH ? BIN_SHA : null),
    fileSize: (p) => (p.split('\\').join('/') === BIN_PATH ? 4096 : null),
    statMtimeMs: () => null,
    zephyrVersionText: () => readFile('/zephyr/VERSION'),
    projectPackageJson: () => readFile('/proj/package.json'),
    toolVersions: () => ({ cuttlefish: '1.2.0', frameworkZephyr: '1.2.0', hal: '1.2.0', sdk: '1.0.1' }),
    ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'files')),
  } as SbomRunner;
}

const norm = (p: string) => p.split('\\').join('/');

// ---------------------------------------------------------------------------
// collectSbomInventory
// ---------------------------------------------------------------------------

describe('collectSbomInventory — linked scope (default)', () => {
  it('records kernel + compiled modules only, with SHAs, licenses, artifact, identity', () => {
    const inv = collectSbomInventory(makeRunner(), false, { boardTarget: 'blackpill_f411ce' });
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;
    expect(inv.scope).toBe('linked');
    // hal_unused never appears in compile_commands.json → filtered out.
    expect(inv.modules.map((m) => m.name)).toEqual(['zephyr', 'hal_mit']);
    const kernel = inv.modules[0];
    expect(kernel.isKernel).toBe(true);
    expect(kernel.version).toBe('4.3.0'); // parsed from $ZEPHYR_BASE/VERSION
    expect(kernel.sha).toBe(KSHA);
    expect(kernel.spdx).toBe('Apache-2.0');
    const mit = inv.modules[1];
    expect(mit.version).toBe(M1SHA);
    expect(mit.spdx).toBe('MIT');
    expect(inv.artifact?.sha256).toBe(BIN_SHA);
    expect(inv.artifact?.sizeBytes).toBe(4096);
    expect(norm(inv.artifact!.path)).toBe(BIN_PATH);
    expect(inv.projectName).toBe('my-fw');
    expect(inv.projectVersion).toBe('1.2.3');
    expect(inv.boardTarget).toBe('blackpill_f411ce');
    expect(inv.needsBuild).toBe(false);
  });

  it('--all scope includes modules the build did not link', () => {
    const inv = collectSbomInventory(makeRunner(), true);
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;
    expect(inv.scope).toBe('all');
    expect(inv.modules.map((m) => m.name)).toEqual(['zephyr', 'hal_mit', 'hal_unused']);
  });

  it('no build: kernel-only, needsBuild, no-build warning, no artifact', () => {
    const files = baseFiles();
    delete files['/b/compile_commands.json'];
    const inv = collectSbomInventory(makeRunner({ files }));
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;
    expect(inv.needsBuild).toBe(true);
    expect(inv.modules.map((m) => m.name)).toEqual(['zephyr']);
    expect(inv.artifact).toBeUndefined();
    expect(inv.warnings.some((w) => w.kind === 'no-build')).toBe(true);
  });

  it('west list failed but $ZEPHYR_BASE known: kernel-only + west-list-limited warning', () => {
    const inv = collectSbomInventory(makeRunner({ listModules: () => null }));
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;
    expect(inv.modules.map((m) => m.name)).toEqual(['zephyr']);
    expect(inv.warnings.some((w) => w.kind === 'west-list-limited')).toBe(true);
  });

  it('west list failed and no $ZEPHYR_BASE: ok:false no-workspace', () => {
    const inv = collectSbomInventory(
      makeRunner({ listModules: () => null, zephyrBase: undefined }),
    );
    expect(inv.ok).toBe(false);
    if (!inv.ok) expect(inv.reason).toBe('no-workspace');
  });

  it('flags floating revisions and missing SHAs as integrity warnings', () => {
    const modules = (): WestModuleRef[] => [
      { name: 'zephyr', abspath: '/zephyr', revision: KSHA, sha: KSHA },
      { name: 'hal_float', abspath: '/mods/float', revision: 'main' },
    ];
    const inv = collectSbomInventory(
      makeRunner({
        listModules: modules,
        files: {
          ...baseFiles(),
          '/mods/float/LICENSE': 'MIT licence\nPermission is hereby granted, free of charge',
          '/b/compile_commands.json': JSON.stringify([
            { file: '/zephyr/src/main.c' },
            { file: '/mods/float/src/x.c' },
          ]),
        },
      }),
    );
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;
    const kinds = inv.warnings.map((w) => w.kind);
    expect(kinds).toContain('floating-revision');
    expect(kinds).toContain('missing-sha');
  });

  it('unknown license is a warning, not an error, and omits the spdx field', () => {
    const files = {
      ...baseFiles(),
      // hal_mit has no LICENSE anywhere.
      '/b/compile_commands.json': JSON.stringify([{ file: '/mods/mit/src/x.c' }]),
    };
    delete files['/mods/mit/LICENSE'];
    const inv = collectSbomInventory(makeRunner({ files }));
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;
    const mit = inv.modules.find((m) => m.name === 'hal_mit');
    expect(mit?.spdx).toBeUndefined();
    expect(inv.warnings.some((w) => w.kind === 'unknown-license' && w.component === 'hal_mit')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('parseZephyrVersion', () => {
  it('parses full and partial VERSION files, tolerates absence', () => {
    expect(parseZephyrVersion('VERSION_MAJOR = 4\nVERSION_MINOR = 3\nVERSION_PATCH = 1\n')).toBe('4.3.1');
    expect(parseZephyrVersion('VERSION_MAJOR = 4\n')).toBe('4.0.0');
    expect(parseZephyrVersion(undefined)).toBeUndefined();
    expect(parseZephyrVersion('VERSION_MINOR = 3\n')).toBeUndefined();
  });
});

describe('parseWestListOutput', () => {
  it('parses 5-column TSV, maps empty columns to undefined, skips junk', () => {
    const mods = parseWestListOutput(
      [
        `zephyr\tC:\\ws\\zephyr\t${KSHA}\t${KSHA}\thttps://github.com/zephyrproject-rtos/zephyr`,
        'hal_float\t/ws/hal_float\tmain\t\thttps://example.com/hal',
        'plain\t/ws/plain',
        '',
        'garbage-line-without-tabs',
      ].join('\n'),
    );
    expect(mods).toHaveLength(3);
    expect(mods[0]).toMatchObject({ name: 'zephyr', sha: KSHA, revision: KSHA });
    expect(mods[1]).toMatchObject({ name: 'hal_float', revision: 'main', sha: undefined });
    expect(mods[2]).toMatchObject({ name: 'plain', revision: undefined, sha: undefined, url: undefined });
  });

  it('maps west\'s "N/A" placeholder (manifest-imported zephyr) to undefined', () => {
    const mods = parseWestListOutput(`zephyr\tC:\\ws\\zephyr\tHEAD\tN/A\tN/A`);
    expect(mods[0]).toMatchObject({ name: 'zephyr', revision: 'HEAD', sha: undefined, url: undefined });
  });
});

describe('canonicalJson', () => {
  it('is insensitive to object key order', () => {
    expect(canonicalJson({ a: 1, b: { y: 2, x: 3 } })).toBe(
      canonicalJson({ b: { x: 3, y: 2 }, a: 1 }),
    );
  });
});

// ---------------------------------------------------------------------------
// CycloneDX 1.6 writer
// ---------------------------------------------------------------------------

describe('buildCycloneDXBom', () => {
  const inv = () => collectSbomInventory(makeRunner(), false, { boardTarget: 'blackpill_f411ce' }) as Extract<ReturnType<typeof collectSbomInventory>, { ok: true }>;
  const opts = { toolVersion: '1.2.0', timestamp: '2026-09-22T00:00:00.000Z' };

  it('emits a schema-valid CycloneDX 1.6 document', () => {
    const doc = buildCycloneDXBom(inv(), opts);
    const valid = validateCdx(doc);
    expect(valid || ajv.errorsText(validateCdx.errors)).toBe(true);
  });

  it('serial is deterministic and changes with any component identity', () => {
    const a = sbomSerialNumber(inv());
    const b = sbomSerialNumber(inv());
    expect(a).toBe(b);
    expect(a).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    // A different module SHA must produce a different serial.
    const changed = collectSbomInventory(
      makeRunner({
        listModules: () => [
          { name: 'zephyr', abspath: '/zephyr', revision: KSHA, sha: KSHA },
          { name: 'hal_mit', abspath: '/mods/mit', revision: M2SHA, sha: M2SHA },
        ],
      }),
    ) as Extract<ReturnType<typeof collectSbomInventory>, { ok: true }>;
    expect(sbomSerialNumber(changed)).not.toBe(a);
  });

  it('main component is the hashed firmware; board is hardware; app depends only on modules', () => {
    const doc = buildCycloneDXBom(inv(), opts) as {
      metadata: { component: Record<string, unknown> };
      components: { type: string; 'bom-ref': string; name: string }[];
      formulation: { components: { type: string; name: string }[] }[];
      dependencies: { ref: string; dependsOn: string[] }[];
    };
    expect(doc.metadata.component.type).toBe('firmware');
    expect((doc.metadata.component.hashes as { content: string }[])[0].content).toBe(BIN_SHA);

    const refs = doc.components.map((c) => c['bom-ref']);
    expect(refs).toContain('hardware:blackpill_f411ce');
    expect(doc.components.find((c) => c['bom-ref'] === 'hardware:blackpill_f411ce')?.type).toBe('device');

    // Toolchain lives in formulation (build environment), not components.
    expect(doc.formulation[0].components.map((c) => c.name)).toEqual([
      '@typecad/cuttlefish',
      '@typecad/framework-zephyr',
      '@typecad/hal',
      'typeCAD Zephyr SDK',
    ]);
    expect(refs.some((r) => r.startsWith('tool:'))).toBe(false);

    const appDep = doc.dependencies.find((d) => d.ref === String(doc.metadata.component['bom-ref']));
    expect(appDep?.dependsOn).toContain('west:zephyr@4.3.0');
    expect(appDep?.dependsOn).toContain(`west:hal_mit@${M1SHA}`);
    expect(appDep?.dependsOn.some((r) => r.startsWith('hardware:'))).toBe(false);
  });

  it('resolved licenses use SPDX ids; unresolved ones are omitted', () => {
    const files = { ...baseFiles() };
    delete files['/mods/mit/LICENSE'];
    const bad = collectSbomInventory(makeRunner({ files })) as Extract<
      ReturnType<typeof collectSbomInventory>,
      { ok: true }
    >;
    const doc = buildCycloneDXBom(bad, opts) as {
      components: { name: string; licenses?: { license: { id: string } }[] }[];
    };
    const kernel = doc.components.find((c) => c.name === 'zephyr');
    const mit = doc.components.find((c) => c.name === 'hal_mit');
    expect(kernel?.licenses).toEqual([{ license: { id: 'Apache-2.0' } }]);
    expect(mit?.licenses).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SPDX 2.3 writer
// ---------------------------------------------------------------------------

describe('buildSpdxDocument', () => {
  it('emits a schema-valid SPDX 2.3 document with DESCRIBES + DEPENDS_ON', () => {
    const inv = collectSbomInventory(makeRunner(), false) as Extract<
      ReturnType<typeof collectSbomInventory>,
      { ok: true }
    >;
    const doc = buildSpdxDocument(inv, { toolVersion: '1.2.0', timestamp: '2026-09-22T00:00:00.000Z' });
    const valid = validateSpdx(doc);
    expect(valid || ajv.errorsText(validateSpdx.errors)).toBe(true);

    const doc2 = doc as unknown as {
      packages: { SPDXID: string; checksums?: { checksumValue: string }[]; licenseDeclared: string }[];
      relationships: { relationshipType: string; relatedSpdxElement: string }[];
    };
    expect(doc2.packages).toHaveLength(inv.modules.length + 1);
    const app = doc2.packages[0];
    expect(app.checksums?.[0].checksumValue).toBe(BIN_SHA);
    expect(doc2.relationships[0].relationshipType).toBe('DESCRIBES');
    const depends = doc2.relationships.filter((r) => r.relationshipType === 'DEPENDS_ON');
    expect(depends).toHaveLength(inv.modules.length);
    expect(depends.every((r) => r.relatedSpdxElement.startsWith('SPDXRef-Package-west-'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// diffCycloneDxDocs
// ---------------------------------------------------------------------------

describe('diffCycloneDxDocs', () => {
  const opts = { toolVersion: '1.2.0', timestamp: '2026-09-22T00:00:00.000Z' };
  const build = (): Record<string, unknown> =>
    buildCycloneDXBom(
      collectSbomInventory(makeRunner(), false) as Extract<
        ReturnType<typeof collectSbomInventory>,
        { ok: true }
      >,
      opts,
    );

  it('reports added, removed, and changed components (keyed by type:name)', () => {
    const a = build();
    // b: hal_mit's SHA changed and hal_extra appeared.
    const b = buildCycloneDXBom(
      collectSbomInventory(
        makeRunner({
          listModules: () => [
            { name: 'zephyr', abspath: '/zephyr', revision: KSHA, sha: KSHA },
            { name: 'hal_mit', abspath: '/mods/mit', revision: M2SHA, sha: M2SHA },
            {
              name: 'hal_extra',
              abspath: '/mods/extra',
              revision: M2SHA,
              sha: M2SHA,
            },
          ],
          files: {
            ...baseFiles(),
            '/mods/extra/LICENSE': 'MIT licence\nPermission is hereby granted, free of charge',
          },
        }),
        true,
      ) as Extract<ReturnType<typeof collectSbomInventory>, { ok: true }>,
      opts,
    );
    const d = diffCycloneDxDocs(a, b);
    expect(d.added).toContain('library:hal_extra');
    // A SHA move is a version CHANGE on the same component, not remove+add.
    expect(d.changed.some((c) => c.component === 'library:hal_mit' && c.field === 'version')).toBe(true);
    expect(d.removed).toHaveLength(0);

    // c: hal_mit gone entirely.
    const c = buildCycloneDXBom(
      collectSbomInventory(
        makeRunner({
          listModules: () => [{ name: 'zephyr', abspath: '/zephyr', revision: KSHA, sha: KSHA }],
        }),
        true,
      ) as Extract<ReturnType<typeof collectSbomInventory>, { ok: true }>,
      opts,
    );
    const d2 = diffCycloneDxDocs(a, c);
    expect(d2.removed).toContain('library:hal_mit');
  });

  it('identical docs diff to empty', () => {
    const d = diffCycloneDxDocs(build(), build());
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.changed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Presenter + build-stamp round trips (real temp dirs)
// ---------------------------------------------------------------------------

describe('runSbomPresenter + stampBuildSbom — file flows', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitCode: number | string | undefined;
  const tempDirs: string[] = [];

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    __setSbomRunnerForTest(undefined);
    logSpy.mockRestore();
    process.exitCode = exitCode;
    for (const d of tempDirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  });

  function output(): string {
    return logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
  }

  /** Real-disk project: kernel + one module, build dir with cc + zephyr.bin,
   *  project package.json. Returns the dir and a runner factory; `mutate`
   *  lets tests change the module SHA between generate and check. */
  function makeTempProject(): { dir: string; buildDir: string; binPath: string; runner: () => SbomRunner; setMitSha: (sha: string) => void } {
    const dir = mkdtempSync(path.join(tmpdir(), 'sbom-test-'));
    tempDirs.push(dir);
    const zephyrDir = path.join(dir, 'zephyr');
    const mitDir = path.join(dir, 'hal_mit');
    const buildDir = path.join(dir, 'src', 'out', 'build');
    mkdirSync(zephyrDir, { recursive: true });
    mkdirSync(mitDir, { recursive: true });
    mkdirSync(path.join(buildDir, 'zephyr'), { recursive: true });
    writeFileSync(path.join(zephyrDir, 'LICENSE'), 'Apache License\nVersion 2.0');
    writeFileSync(path.join(zephyrDir, 'VERSION'), 'VERSION_MAJOR = 4\nVERSION_MINOR = 3\nVERSION_PATCH = 0\n');
    writeFileSync(path.join(mitDir, 'LICENSE'), 'MIT licence\nPermission is hereby granted, free of charge');
    writeFileSync(
      path.join(buildDir, 'compile_commands.json'),
      JSON.stringify([
        { file: norm(path.join(zephyrDir, 'main.c')) },
        { file: norm(path.join(mitDir, 'thing.c')) },
      ]),
    );
    const binPath = path.join(buildDir, 'zephyr', 'zephyr.bin');
    writeFileSync(binPath, 'BINARY-CONTENT');
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'temp-fw', version: '9.9.9' }));

    let mitSha = M1SHA;
    const runner = (): SbomRunner => ({
      cwd: dir,
      zephyrBase: zephyrDir,
      listModules: () => [
        { name: 'zephyr', abspath: zephyrDir, revision: KSHA, sha: KSHA, url: 'https://github.com/zephyrproject-rtos/zephyr' },
        { name: 'hal_mit', abspath: mitDir, revision: mitSha, sha: mitSha },
      ],
      compileCommandsPath: () => path.join(buildDir, 'compile_commands.json'),
      readFile: (p) => {
        try {
          return readFileSync(p, 'utf8');
        } catch {
          return undefined;
        }
      },
      readdir: (d) => {
        try {
          return readdirSync(d);
        } catch {
          return [];
        }
      },
      sha256: (p) => {
        try {
          return createHash('sha256').update(readFileSync(p)).digest('hex');
        } catch {
          return null;
        }
      },
      fileSize: (p) => {
        try {
          return statSync(p).size;
        } catch {
          return null;
        }
      },
      statMtimeMs: (p) => {
        try {
          return statSync(p).mtimeMs;
        } catch {
          return null;
        }
      },
      zephyrVersionText: () => readFileSync(path.join(zephyrDir, 'VERSION'), 'utf8'),
      projectPackageJson: () => readFileSync(path.join(dir, 'package.json'), 'utf8'),
      toolVersions: () => ({ cuttlefish: '1.2.0', sdk: '1.0.1' }),
    });
    return { dir, buildDir, binPath, runner, setMitSha: (sha: string) => (mitSha = sha) };
  }

  it('generate writes <buildDir>/sbom.cdx.json and prints a summary', () => {
    const p = makeTempProject();
    __setSbomRunnerForTest(p.runner());
    runSbomPresenter({});
    const out = path.join(p.buildDir, 'sbom.cdx.json');
    expect(existsSync(out)).toBe(true);
    expect(output()).toContain('SBOM written to');
    const doc = JSON.parse(readFileSync(out, 'utf8'));
    expect(doc.bomFormat).toBe('CycloneDX');
    expect(validateCdx(doc) || ajv.errorsText(validateCdx.errors)).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('--stdout prints ONLY the JSON document (clean CI pipe)', () => {
    const p = makeTempProject();
    __setSbomRunnerForTest(p.runner());
    runSbomPresenter({ stdout: true });
    // Exactly one console.log — the JSON document, no banner/summary lines.
    expect(logSpy.mock.calls).toHaveLength(1);
    const doc = JSON.parse(logSpy.mock.calls[0].join(' '));
    expect(doc.bomFormat).toBe('CycloneDX');
    expect(validateCdx(doc) || ajv.errorsText(validateCdx.errors)).toBe(true);
    expect(existsSync(path.join(p.buildDir, 'sbom.cdx.json'))).toBe(false);
  });

  it('--format=spdx writes a schema-valid SPDX document', () => {
    const p = makeTempProject();
    __setSbomRunnerForTest(p.runner());
    runSbomPresenter({ format: 'spdx' });
    const out = path.join(p.buildDir, 'sbom.spdx.json');
    expect(existsSync(out)).toBe(true);
    const doc = JSON.parse(readFileSync(out, 'utf8'));
    expect(doc.spdxVersion).toBe('SPDX-2.3');
    expect(validateSpdx(doc) || ajv.errorsText(validateSpdx.errors)).toBe(true);
  });

  it('--strict exits 1 on a floating revision', () => {
    const p = makeTempProject();
    p.setMitSha(M1SHA);
    const runner = p.runner();
    // Rewrite the manifest with a moving revision for hal_mit.
    const zephyrDir = path.join(p.dir, 'zephyr');
    const mitDir = path.join(p.dir, 'hal_mit');
    __setSbomRunnerForTest({
      ...runner,
      listModules: () => [
        { name: 'zephyr', abspath: zephyrDir, revision: KSHA, sha: KSHA },
        { name: 'hal_mit', abspath: mitDir, revision: 'main', sha: M1SHA },
      ],
    });
    runSbomPresenter({ strict: true });
    expect(output()).toContain('floating-revision');
    expect(process.exitCode).toBe(1);
  });

  it('--check passes when nothing drifted since generation', () => {
    const p = makeTempProject();
    __setSbomRunnerForTest(p.runner());
    runSbomPresenter({});
    runSbomPresenter({ check: true });
    expect(output()).toContain('matches the recorded build');
    expect(process.exitCode).toBeUndefined();
  });

  it('--check exits 1 on component drift (module SHA moved)', () => {
    const p = makeTempProject();
    __setSbomRunnerForTest(p.runner());
    runSbomPresenter({});
    p.setMitSha(M2SHA);
    __setSbomRunnerForTest(p.runner()); // fresh runner picks up the mutated SHA
    runSbomPresenter({ check: true });
    expect(output()).toContain('does not match');
    expect(process.exitCode).toBe(1);
  });

  it('--check exits 1 when the firmware binary is newer than the record', () => {
    const p = makeTempProject();
    __setSbomRunnerForTest(p.runner());
    runSbomPresenter({});
    const sbomPath = path.join(p.buildDir, 'sbom.cdx.json');
    const now = Date.now() / 1000;
    utimesSync(sbomPath, new Date(now - 3600), new Date(now - 3600)); // record: an hour old
    utimesSync(p.binPath, new Date(now), new Date(now)); // binary: fresh
    runSbomPresenter({ check: true });
    expect(output()).toContain('newer than the recorded SBOM');
    expect(process.exitCode).toBe(1);
  });

  it('--check exits 1 when no SBOM is recorded', () => {
    const p = makeTempProject();
    __setSbomRunnerForTest(p.runner());
    runSbomPresenter({ check: true });
    expect(output()).toContain('No readable CycloneDX SBOM');
    expect(process.exitCode).toBe(1);
  });

  it('--check with --format=spdx is rejected (CycloneDX is the record)', () => {
    runSbomPresenter({ check: true, format: 'spdx' });
    expect(output()).toContain('generate-only');
    expect(process.exitCode).toBe(1);
  });

  it('--diff reports what changed between two recorded SBOMs', () => {
    const p = makeTempProject();
    __setSbomRunnerForTest(p.runner());
    runSbomPresenter({ output: path.join(p.dir, 'old.json') });
    p.setMitSha(M2SHA);
    __setSbomRunnerForTest(p.runner());
    runSbomPresenter({ output: path.join(p.dir, 'new.json') });
    logSpy.mockClear();
    runSbomPresenter({ diff: [path.join(p.dir, 'old.json'), path.join(p.dir, 'new.json')] });
    const diffOut = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(diffOut).toContain('changed');
    expect(diffOut).toContain('library:hal_mit');
    expect(diffOut).toContain('re-assess vulnerabilities');
  });

  it('--diff of identical component sets reports identical', () => {
    const p = makeTempProject();
    __setSbomRunnerForTest(p.runner());
    runSbomPresenter({ output: path.join(p.dir, 'a.json') });
    runSbomPresenter({ output: path.join(p.dir, 'b.json') });
    runSbomPresenter({ diff: [path.join(p.dir, 'a.json'), path.join(p.dir, 'b.json')] });
    expect(output()).toContain('Component sets are identical');
  });

  it('--diff exits 1 on an unreadable file', () => {
    runSbomPresenter({ diff: ['C:/definitely-missing-a.json', 'C:/definitely-missing-b.json'] });
    expect(output()).toContain('Could not read');
    expect(process.exitCode).toBe(1);
  });

  it('reports west NOT FOUND and exits 1', () => {
    __setSbomRunnerForTest(null);
    runSbomPresenter({});
    expect(output()).toContain('NOT FOUND');
    expect(process.exitCode).toBe(1);
  });

  it('stampBuildSbom writes the build-stamped record next to the artifact', () => {
    const p = makeTempProject();
    const out = stampBuildSbom({ buildDir: p.buildDir, board: 'blackpill_f411ce', projectRoot: p.dir }, p.runner());
    expect(out).toBeTruthy();
    expect(out && existsSync(out)).toBe(true);
    const doc = JSON.parse(readFileSync(out!, 'utf8'));
    expect(doc.bomFormat).toBe('CycloneDX');
    expect(validateCdx(doc) || ajv.errorsText(validateCdx.errors)).toBe(true);
    expect(JSON.stringify(doc)).toContain('hardware:blackpill_f411ce');
  });

  it('stampBuildSbom returns undefined (never throws) without a workspace', () => {
    const out = stampBuildSbom(
      { buildDir: 'C:/nowhere', projectRoot: 'C:/nowhere' },
      { listModules: () => null, readFile: () => undefined, readdir: () => [] },
    );
    expect(out).toBeUndefined();
  });

  it('stampBuildSbom refuses to stamp an incomplete record (west list failed)', () => {
    // Even with $ZEPHYR_BASE known, a kernel-only inventory must not be
    // silently stamped — --check would then verify a lie.
    const p = makeTempProject();
    const runner = p.runner();
    const out = stampBuildSbom(
      { buildDir: p.buildDir, projectRoot: p.dir },
      { ...runner, listModules: () => null },
    );
    expect(out).toBeUndefined();
    expect(existsSync(path.join(p.buildDir, 'sbom.cdx.json'))).toBe(false);
  });
});
