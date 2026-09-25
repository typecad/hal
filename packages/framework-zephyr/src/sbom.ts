// ---------------------------------------------------------------------------
// @typecad/framework-zephyr — SBOM (software bill of materials)
//
// `typecad-hal sbom` — emit a build-true software bill of materials for this
// project, in CycloneDX 1.6 JSON (default) or SPDX 2.3 JSON. The inventory is
// the same as-built ground truth the licenses presenter reports from: the
// Zephyr kernel + the west modules the last build ACTUALLY compiled
// (compile_commands.json), each recorded immutably by its checked-out commit
// SHA, plus the firmware artifact itself (SHA-256 hashed) and the target
// board. The toolchain (cuttlefish / framework / hal / SDK pin) is recorded
// in the CycloneDX `formulation` block — the build environment, deliberately
// NOT part of the product's runtime components, which is the classic embedded
// SBOM mistake (generic scanners pollute the runtime BOM with build tools;
// the firmware links none of them — their contribution is code the engine
// GENERATED into the app, which the hashed firmware component already
// captures).
//
// EU Cyber Resilience Act alignment: the CRA's essential requirements ask
// placed-on-market products for an SBOM in a commonly used format (CycloneDX
// and SPDX both qualify) covering at minimum the top-level dependencies. The
// default scope here is stronger — only what linked into the binary — and
// `--check` gates a release on the recorded BOM still matching the build,
// while `--diff` reports exactly what changed between two builds (the input
// to update notifications and vulnerability reassessment).
//
// Presenter mirrors licenses.ts: injected seams for unit testing, never calls
// process.exit(), sets process.exitCode under --strict / --check failures.
// ---------------------------------------------------------------------------

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import * as ui from '@typecad/cuttlefish/utils/ui';
import { loadTypecadConfig } from '@typecad/cuttlefish/config-loader';
import { PINNED_ZEPHYR_SDK_VERSION } from '@typecad/cuttlefish/board-catalog';
import {
  resolveLibraryLicense,
  type ReadFile,
  type ReadDir,
} from '@typecad/cuttlefish/api/shared';
import { discoverWest } from './toolchain/west-discover.js';
import { westSpawn } from './toolchain/west-spawn.js';
import { filterLinkedModules, findCompileCommandsPath } from './west-inventory.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SbomFormat = 'cyclonedx' | 'spdx';

/** Options accepted by `runSbomPresenter` (the parsed `typecad-hal sbom`
 *  command options are structurally compatible). */
export interface SbomPresenterOptions {
  format?: SbomFormat;
  /** Scope to every west manifest module (default: only linked modules). */
  all?: boolean;
  /** Exit non-zero on integrity warnings (floating revisions, missing SHAs). */
  strict?: boolean;
  /** Verify the recorded CycloneDX SBOM against the current build. */
  check?: boolean;
  /** Print the JSON to stdout instead of writing a file. */
  stdout?: boolean;
  /** Output path (default: <buildDir>/sbom.cdx.json, or ./sbom.cdx.json). */
  output?: string;
  /** Compare two SBOM files instead of generating. */
  diff?: [string, string];
}

/** One `west list` project with its immutable identity. */
export interface WestModuleRef {
  name: string;
  abspath: string;
  /** Manifest revision (SHA, tag, or branch — see floating-revision warning). */
  revision?: string;
  /** Checked-out commit SHA (what the build actually compiled). */
  sha?: string;
  url?: string;
}

export type SbomWarningKind =
  | 'floating-revision'
  | 'missing-sha'
  | 'no-build'
  | 'unknown-license'
  | 'west-list-limited';

export interface SbomWarning {
  kind: SbomWarningKind;
  component: string;
  detail?: string;
}

export interface SbomModule {
  name: string;
  isKernel: boolean;
  /** Identity: the checked-out SHA (kernel: friendly version, e.g. 4.3.0). */
  version: string;
  sha?: string;
  revision?: string;
  url?: string;
  /** Resolved SPDX license id (absent when undeterminable). */
  spdx?: string;
  kernelVersion?: string;
}

export interface SbomInventoryMeta {
  projectName?: string;
  projectVersion?: string;
  boardTarget?: string;
}

export type SbomInventory =
  | {
      ok: true;
      scope: 'linked' | 'all';
      projectName: string;
      projectVersion: string;
      boardTarget?: string;
      buildDir?: string;
      artifact?: {
        path: string;
        fileName: string;
        sha256: string;
        sizeBytes: number;
      };
      modules: SbomModule[];
      tools: {
        cuttlefish?: string;
        frameworkZephyr?: string;
        /** @typecad/hal as installed in THIS project — the API surface the
         *  firmware source compiled against (part of the generator ladder,
         *  never a linked runtime component). */
        hal?: string;
        sdk?: string;
      };
      warnings: SbomWarning[];
      needsBuild: boolean;
    }
  | { ok: false; reason: 'no-workspace'; message: string };

/**
 * Injected seams so the inventory + presenters are unit-testable without
 * spawning west or touching disk. The production runner (defaultSbomRunner)
 * wires these to discoverWest + westSpawn + fs + crypto.
 */
export interface SbomRunner {
  /** Directory the project lives in (project name fallback, build search). */
  cwd?: string;
  /** Discovered $ZEPHYR_BASE (absolute), or undefined. */
  zephyrBase?: string;
  /** west manifest projects with identity fields, or null when west failed. */
  listModules: () => WestModuleRef[] | null;
  /** The last build's compile_commands.json path, or undefined. */
  compileCommandsPath?: () => string | undefined;
  readFile: ReadFile;
  readdir: ReadDir;
  statMtimeMs?: (p: string) => number | null;
  sha256?: (p: string) => string | null;
  fileSize?: (p: string) => number | null;
  /** $ZEPHYR_BASE/VERSION text (kernel friendly version), or undefined. */
  zephyrVersionText?: () => string | undefined;
  /** Project package.json text, or undefined. */
  projectPackageJson?: () => string | undefined;
  /** Toolchain versions for the formulation block. */
  toolVersions?: () => { cuttlefish?: string; frameworkZephyr?: string; sdk?: string };
}

// ---------------------------------------------------------------------------
// Inventory collection
// ---------------------------------------------------------------------------

/** Parse a Zephyr VERSION file ("VERSION_MAJOR = 4\n...") into "4.3.0". */
export function parseZephyrVersion(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const grab = (key: string): string | undefined => {
    const m = text.match(new RegExp(`^${key}\\s*=\\s*(\\d+)`, 'm'));
    return m ? m[1] : undefined;
  };
  const major = grab('VERSION_MAJOR');
  const minor = grab('VERSION_MINOR');
  const patch = grab('VERSION_PATCH');
  if (major === undefined) return undefined;
  return [major, minor ?? '0', patch ?? '0'].join('.');
}

function boardTargetFromConfig(): string | undefined {
  try {
    return loadTypecadConfig(process.cwd())?.buildTarget;
  } catch {
    return undefined;
  }
}

/**
 * Collect the as-built inventory: kernel + west modules (linked-only by
 * default), each one's immutable identity + resolved SPDX license, the hashed
 * firmware artifact, the project identity, and the toolchain versions.
 * Never throws.
 */
export function collectSbomInventory(
  runner: SbomRunner,
  allModules = false,
  meta: SbomInventoryMeta = {},
): SbomInventory {
  const { readFile, readdir } = runner;
  const warnings: SbomWarning[] = [];
  const rows = runner.listModules();
  if (rows === null && !runner.zephyrBase) {
    return {
      ok: false,
      reason: 'no-workspace',
      message:
        '`west list` did not return a project list and $ZEPHYR_BASE is unknown (not inside a west workspace?).',
    };
  }
  if (rows === null) {
    warnings.push({
      kind: 'west-list-limited',
      component: '(workspace)',
      detail: '`west list` failed — the SBOM records only the Zephyr kernel.',
    });
  }
  const allRows = rows ?? [];

  // Kernel identity: the west row for $ZEPHYR_BASE when present (carries
  // sha/revision/url), else the row named "zephyr", else $ZEPHYR_BASE itself.
  let kernelBase: string | undefined = runner.zephyrBase;
  let kernelRow: WestModuleRef | undefined;
  if (runner.zephyrBase) {
    kernelRow =
      allRows.find((r) => path.resolve(r.abspath) === path.resolve(runner.zephyrBase!)) ??
      allRows.find((r) => r.name === 'zephyr');
    if (kernelRow) kernelBase = kernelRow.abspath;
  } else {
    kernelRow = allRows.find((r) => r.name === 'zephyr');
    if (kernelRow) kernelBase = kernelRow.abspath;
  }

  // Build discovery (both scopes want the artifact hash; the linked scope
  // additionally filters the manifest by what was compiled).
  const ccPath = runner.compileCommandsPath ? runner.compileCommandsPath() : undefined;
  const buildDir = ccPath ? path.dirname(ccPath) : undefined;
  let scoped = allRows;
  let needsBuild = false;
  if (!allModules) {
    if (!ccPath) {
      needsBuild = true;
      scoped = [];
      warnings.push({
        kind: 'no-build',
        component: '(project)',
        detail:
          'no build found — the SBOM cannot scope to linked modules or hash the firmware artifact. Run typecad-hal build first.',
      });
    } else {
      const ccText = readFile(ccPath);
      // A found-but-degenerate compile_commands.json (0-byte, unreadable,
      // unparseable, or a zero-entry array from a configure-only build)
      // must not silently scope the BOM: empty text or a parse failure
      // would fall through to allRows (every module recorded as linked),
      // an empty array to kernel-only — both stamped as authoritative.
      // Treat it like a missing build: warn, mark needsBuild, block stamping.
      let ccEntries: unknown;
      try {
        ccEntries = ccText ? JSON.parse(ccText) : undefined;
      } catch {
        ccEntries = undefined;
      }
      if (Array.isArray(ccEntries) && ccEntries.length > 0) {
        scoped = filterLinkedModules(ccText!, allRows);
      } else {
        needsBuild = true;
        scoped = [];
        warnings.push({
          kind: 'no-build',
          component: '(project)',
          detail: `compile_commands.json at ${ccPath} is empty or unreadable — the SBOM cannot scope to linked modules. Rebuild with typecad-hal build.`,
        });
      }
    }
  }

  // Firmware artifact hash (zephyr.bin, falling back to zephyr.elf).
  let artifactInfo: {
    path: string;
    fileName: string;
    sha256: string;
    sizeBytes: number;
  } | undefined;
  if (buildDir) {
    for (const name of ['zephyr.bin', 'zephyr.elf'] as const) {
      const p = path.join(buildDir, 'zephyr', name);
      const h = runner.sha256 ? runner.sha256(p) : null;
      if (h) {
        const size = runner.fileSize ? runner.fileSize(p) : null;
        artifactInfo = { path: p, fileName: `zephyr/${name}`, sha256: h, sizeBytes: size ?? 0 };
        break;
      }
    }
  }

  // Module components — kernel first (always present when known), then the
  // scoped manifest rows, deduped against the kernel.
  const modules: SbomModule[] = [];
  const pushModule = (row: WestModuleRef, isKernel: boolean): void => {
    const lic = resolveLibraryLicense(
      { name: isKernel ? 'zephyr' : row.name, installDir: row.abspath },
      readFile,
      readdir,
      // Kernel: top-level LICENSE is authoritative (mirrors licenses.ts).
      // Modules: many HALs keep theirs under zephyr/ or src/.
      isKernel ? { subdirs: [] } : { subdirs: ['zephyr', 'src'] },
    );
    const sha = row.sha && row.sha.trim() ? row.sha.trim() : undefined;
    const revision = row.revision && row.revision.trim() ? row.revision.trim() : undefined;
    if (!sha) {
      warnings.push({
        kind: 'missing-sha',
        component: row.name,
        detail: 'checked-out commit unknown (module not cloned, or west could not resolve it)',
      });
    }
    if (revision && /^(main|master|develop|head)$/i.test(revision)) {
      warnings.push({
        kind: 'floating-revision',
        component: row.name,
        detail: `manifest revision '${revision}' moves between west updates — the recorded SHA is the immutable identity; pin by SHA or tag for a reproducible BOM`,
      });
    }
    let kernelVersion: string | undefined;
    if (isKernel) {
      kernelVersion = parseZephyrVersion(
        runner.zephyrVersionText ? runner.zephyrVersionText() : undefined,
      );
    }
    modules.push({
      name: isKernel ? 'zephyr' : row.name,
      isKernel,
      version: isKernel
        ? kernelVersion ?? sha ?? revision ?? 'unknown'
        : sha ?? revision ?? 'unknown',
      sha,
      revision,
      url: row.url && row.url.trim() ? row.url.trim() : undefined,
      spdx: lic.spdx,
      kernelVersion,
    });
    if (!lic.spdx) warnings.push({ kind: 'unknown-license', component: row.name });
  };

  if (kernelBase) {
    pushModule(kernelRow ?? { name: 'zephyr', abspath: kernelBase }, true);
  }
  for (const row of scoped) {
    if (kernelBase && kernelRow && row === kernelRow) continue;
    if (kernelBase && path.resolve(row.abspath) === path.resolve(kernelBase)) continue;
    pushModule(row, false);
  }  modules.sort((a, b) => {
    if (a.isKernel !== b.isKernel) return a.isKernel ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  // Project identity: package.json name/version, else the directory name.
  let projectName: string | undefined;
  let projectVersion: string | undefined;
  try {
    const pkg = JSON.parse(runner.projectPackageJson ? runner.projectPackageJson() ?? '' : '');
    if (typeof pkg?.name === 'string' && pkg.name) projectName = pkg.name;
    if (typeof pkg?.version === 'string' && pkg.version) projectVersion = pkg.version;
  } catch {
    /* best-effort */
  }
  const cwdBase = path.basename(runner.cwd ?? process.cwd()) || 'firmware';

  return {
    ok: true,
    scope: allModules ? 'all' : 'linked',
    projectName: meta.projectName ?? projectName ?? cwdBase,
    projectVersion: meta.projectVersion ?? projectVersion ?? '0.0.0',
    boardTarget: meta.boardTarget,
    buildDir,
    artifact: artifactInfo,
    modules,
    tools: runner.toolVersions ? runner.toolVersions() : {},
    warnings,
    needsBuild,
  };
}

// ---------------------------------------------------------------------------
// Deterministic identity — UUID v5 serial number
// ---------------------------------------------------------------------------

/** Fixed typeCAD SBOM namespace (v5 namespacing; any stable UUID works). */
const SBOM_NS_HEX = 'b3d19c557e9a4d0e9f6a2c8f4d1a7b52';

function uuidV5(name: string): string {
  const ns = Buffer.from(SBOM_NS_HEX, 'hex');
  const h = createHash('sha1').update(ns).update(name, 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x50; // version 5
  h[8] = (h[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = h.toString('hex', 0, 16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Deterministic serial number: the same build (same component identities +
 * artifact hash) always produces the same urn:uuid, so `sbom --check` can
 * regenerate and compare without false drift from random UUIDs.
 */
export function sbomSerialNumber(inv: Extract<SbomInventory, { ok: true }>): string {
  const ident = [
    inv.projectName,
    inv.projectVersion,
    inv.scope,
    ...inv.modules.map((m) => `${m.name}:${m.version}:${m.sha ?? ''}`),
    inv.artifact?.sha256 ?? 'no-artifact',
  ].join('\n');
  return `urn:uuid:${uuidV5(ident)}`;
}

// ---------------------------------------------------------------------------
// CycloneDX 1.6 writer
// ---------------------------------------------------------------------------

export interface SbomBuildOpts {
  toolVersion: string;
  /** RFC3339 UTC timestamp (reused verbatim by --check comparisons). */
  timestamp: string;
}

const appBomRef = (inv: Extract<SbomInventory, { ok: true }>): string =>
  `typecad:app/${inv.projectName}@${inv.projectVersion}`;

const moduleBomRef = (m: SbomModule): string => `west:${m.name}@${m.version}`;

export function buildCycloneDXBom(
  inv: Extract<SbomInventory, { ok: true }>,
  opts: SbomBuildOpts,
): Record<string, unknown> {
  const moduleComponents = inv.modules.map((m) => {
    const c: Record<string, unknown> = {
      type: 'library',
      'bom-ref': moduleBomRef(m),
      name: m.name,
      version: m.version,
    };
    if (m.spdx) c.licenses = [{ license: { id: m.spdx } }];
    const props: { name: string; value: string }[] = [];
    if (m.sha) props.push({ name: 'typecad-hal:commit', value: m.sha });
    if (m.revision) props.push({ name: 'typecad-hal:manifest-revision', value: m.revision });
    if (m.isKernel && m.kernelVersion) {
      props.push({ name: 'typecad-hal:zephyr-version', value: m.kernelVersion });
    }
    if (props.length > 0) c.properties = props;
    if (m.url) c.externalReferences = [{ type: 'vcs', url: m.url }];
    return c;
  });

  const app: Record<string, unknown> = {
    type: 'firmware',
    'bom-ref': appBomRef(inv),
    name: inv.projectName,
    version: inv.projectVersion,
  };
  if (inv.artifact) {
    app.hashes = [{ alg: 'SHA-256', content: inv.artifact.sha256 }];
    app.properties = [{ name: 'typecad-hal:artifact', value: inv.artifact.fileName }];
  }

  const components: Record<string, unknown>[] = [...moduleComponents];
  if (inv.boardTarget) {
    // CycloneDX models physical hardware as component type "device" — the
    // board the firmware was built for, identified by its Zephyr target.
    components.push({
      type: 'device',
      'bom-ref': `hardware:${inv.boardTarget}`,
      name: inv.boardTarget,
    });
  }

  // Build environment — formulation, never a runtime component.
  const tools: Record<string, unknown>[] = [];
  if (inv.tools.cuttlefish) {
    tools.push({
      type: 'application',
      'bom-ref': `tool:cuttlefish@${inv.tools.cuttlefish}`,
      name: '@typecad/cuttlefish',
      version: inv.tools.cuttlefish,
    });
  }
  if (inv.tools.frameworkZephyr) {
    tools.push({
      type: 'application',
      'bom-ref': `tool:framework-zephyr@${inv.tools.frameworkZephyr}`,
      name: '@typecad/framework-zephyr',
      version: inv.tools.frameworkZephyr,
    });
  }
  if (inv.tools.hal) {
    tools.push({
      type: 'application',
      'bom-ref': `tool:hal@${inv.tools.hal}`,
      name: '@typecad/hal',
      version: inv.tools.hal,
    });
  }
  if (inv.tools.sdk) {
    tools.push({
      type: 'application',
      'bom-ref': `tool:typecad-zephyr-sdk@${inv.tools.sdk}`,
      name: 'typeCAD Zephyr SDK',
      version: inv.tools.sdk,
    });
  }

  return {
    $schema: 'http://cyclonedx.org/schema/bom-1.6.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: sbomSerialNumber(inv),
    version: 1,
    metadata: {
      timestamp: opts.timestamp,
      tools: {
        components: [{ type: 'application', name: 'typecad-hal', version: opts.toolVersion }],
      },
      component: app,
      properties: [{ name: 'typecad-hal:sbom-scope', value: inv.scope }],
    },
    components,
    ...(tools.length > 0
      ? { formulation: [{ 'bom-ref': 'formulation:typecad-hal', components: tools }] }
      : {}),
    dependencies: [
      { ref: appBomRef(inv), dependsOn: moduleComponents.map((c) => c['bom-ref']) },
      ...moduleComponents.map((c) => ({ ref: c['bom-ref'], dependsOn: [] })),
    ],
  };
}

// ---------------------------------------------------------------------------
// SPDX 2.3 writer
// ---------------------------------------------------------------------------

const spdxSlug = (s: string): string =>
  s.replace(/[^a-zA-Z0-9.-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'pkg';

export function buildSpdxDocument(
  inv: Extract<SbomInventory, { ok: true }>,
  opts: SbomBuildOpts,
): Record<string, unknown> {
  const appPkgId = `SPDXRef-Package-${spdxSlug(inv.projectName)}`;
  const appPkg: Record<string, unknown> = {
    name: inv.projectName,
    SPDXID: appPkgId,
    versionInfo: inv.projectVersion,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: 'NOASSERTION',
    copyrightText: 'NOASSERTION',
    description: 'Firmware application built by typecad-hal (Zephyr).',
    ...(inv.artifact
      ? { checksums: [{ algorithm: 'SHA256', checksumValue: inv.artifact.sha256 }] }
      : {}),
  };
  const modulePkgs = inv.modules.map((m) => ({
    name: m.name,
    SPDXID: `SPDXRef-Package-west-${spdxSlug(m.name)}`,
    versionInfo: m.version,
    downloadLocation: m.url ? `git+${m.url}@${m.sha ?? m.version}` : 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: m.spdx ?? 'NOASSERTION',
    copyrightText: 'NOASSERTION',
    comment: m.isKernel && m.kernelVersion ? `Zephyr ${m.kernelVersion}` : undefined,
  }));
  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `${inv.projectName}-sbom`,
    documentNamespace: `https://typecad.dev/spdx/${sbomSerialNumber(inv).slice('urn:uuid:'.length)}`,
    creationInfo: {
      created: opts.timestamp,
      creators: [`Tool: typecad-hal-${opts.toolVersion}`],
    },
    packages: [appPkg, ...modulePkgs],
    relationships: [
      {
        spdxElementId: 'SPDXRef-DOCUMENT',
        relationshipType: 'DESCRIBES',
        relatedSpdxElement: appPkgId,
      },
      ...inv.modules.map((m) => ({
        spdxElementId: appPkgId,
        relationshipType: 'DEPENDS_ON',
        relatedSpdxElement: `SPDXRef-Package-west-${spdxSlug(m.name)}`,
      })),
    ],
  };
}

// ---------------------------------------------------------------------------
// Canonical JSON + diff (for --check and --diff)
// ---------------------------------------------------------------------------

/** Stable stringify: object keys sorted, so regenerated docs compare equal. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = walk((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

export interface SbomDiffEntry {
  /** Stable component identity (`type:name` — NOT the bom-ref, which embeds
   *  the version and would turn every update into remove+add). */
  component: string;
  field: 'version' | 'license' | 'hash';
  from: string;
  to: string;
}

export interface SbomDiffResult {
  added: string[];
  removed: string[];
  changed: SbomDiffEntry[];
}

interface FlatComponent {
  key: string;
  version?: string;
  license?: string;
  hash?: string;
}

function flattenComponents(doc: Record<string, unknown>): Map<string, FlatComponent> {
  const map = new Map<string, FlatComponent>();
  const add = (c: unknown): void => {
    if (!c || typeof c !== 'object') return;
    const o = c as Record<string, unknown>;
    const type = typeof o.type === 'string' ? o.type : 'component';
    const name = typeof o.name === 'string' ? o.name : '';
    if (!name) return;
    const lic = Array.isArray(o.licenses)
      ? ((o.licenses[0] as Record<string, unknown> | undefined)?.license as
          | Record<string, unknown>
          | undefined)
      : undefined;
    const hashes = Array.isArray(o.hashes)
      ? (o.hashes[0] as Record<string, unknown> | undefined)
      : undefined;
    map.set(`${type}:${name}`, {
      key: `${type}:${name}`,
      version: typeof o.version === 'string' ? o.version : undefined,
      license: typeof lic?.id === 'string' ? lic.id : undefined,
      hash: typeof hashes?.content === 'string' ? hashes.content : undefined,
    });
  };
  const md = doc.metadata as Record<string, unknown> | undefined;
  if (md && md.component) add(md.component);
  for (const c of Array.isArray(doc.components) ? (doc.components as unknown[]) : []) add(c);
  return map;
}

/** Compare two CycloneDX documents' component sets (added/removed/changed),
 *  keyed by type:name so a version bump reads as a change, not churn. */
export function diffCycloneDxDocs(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): SbomDiffResult {
  const fa = flattenComponents(a);
  const fb = flattenComponents(b);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: SbomDiffEntry[] = [];
  for (const [key, c] of fa) {
    const other = fb.get(key);
    if (!other) {
      removed.push(key);
      continue;
    }
    if (c.version !== other.version) {
      changed.push({ component: key, field: 'version', from: c.version ?? '-', to: other.version ?? '-' });
    }
    if (c.license !== other.license) {
      changed.push({ component: key, field: 'license', from: c.license ?? '-', to: other.license ?? '-' });
    }
    if (c.hash !== other.hash) {
      changed.push({ component: key, field: 'hash', from: c.hash ?? '-', to: other.hash ?? '-' });
    }
  }
  for (const key of fb.keys()) {
    if (!fa.has(key)) added.push(key);
  }
  return { added, removed, changed };
}

// ---------------------------------------------------------------------------
// Default runner — discoverWest + westSpawn + fs + crypto
// ---------------------------------------------------------------------------

function readPackageJsonVersion(spec: string, fromDir?: string): string | undefined {
  try {
    const req = createRequire(import.meta.url);
    const p = fromDir
      ? req.resolve(`${spec}/package.json`, { paths: [fromDir] })
      : req.resolve(`${spec}/package.json`);
    const v = JSON.parse(readFileSync(p, 'utf8')).version;
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse `west list --format` TSV output into module refs. Empty columns and
 * west's "N/A" placeholder (e.g. the sha/url of the manifest-imported zephyr
 * project) become undefined; lines without a name+abspath pair are skipped.
 * Exported for unit tests.
 */
export function parseWestListOutput(out: string): WestModuleRef[] {
  const column = (raw: string | undefined): string | undefined => {
    const v = raw?.trim();
    return v && v !== 'N/A' ? v : undefined;
  };
  const mods: WestModuleRef[] = [];
  for (const line of out.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    const [name, abspath] = parts;
    if (!name || !abspath) continue;
    mods.push({
      name,
      abspath,
      revision: column(parts[2]),
      sha: column(parts[3]),
      url: column(parts[4]),
    });
  }
  return mods;
}

function defaultSbomRunner(cwd = process.cwd()): SbomRunner | null {
  const install = discoverWest();
  if (!install) return null;
  const zephyrBase = install.zephyrBase;

  // `west list` with identity columns. Older west builds reject unknown
  // format keys ({sha}), so degrade: detailed → plain name/abspath → null.
  const listModules = (): WestModuleRef[] | null => {
    const tryFormat = (fmt: string): WestModuleRef[] | null => {
      try {
        const inv = westSpawn(['list', '--format', fmt], { encoding: 'utf8', timeout: 30_000 });
        const r = spawnSync(inv.command, inv.args, inv.options);
        if (r.status !== 0) return null;
        const out = typeof r.stdout === 'string' ? r.stdout : '';
        return parseWestListOutput(out);
      } catch {
        return null;
      }
    };
    const detailed = tryFormat('{name}\t{abspath}\t{revision}\t{sha}\t{url}');
    if (detailed !== null) return detailed;
    return tryFormat('{name}\t{abspath}');
  };

  const readFile: ReadFile = (p) => {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      return undefined;
    }
  };
  const readdir: ReadDir = (d) => {
    try {
      return readdirSync(d);
    } catch {
      return [];
    }
  };

  return {
    cwd,
    zephyrBase,
    listModules,
    compileCommandsPath: () => findCompileCommandsPath(readFile, readdir, cwd),
    readFile,
    readdir,
    statMtimeMs: (p) => {
      try {
        return statSync(p).mtimeMs;
      } catch {
        return null;
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
    zephyrVersionText: () => (zephyrBase ? readFile(path.join(zephyrBase, 'VERSION')) : undefined),
    projectPackageJson: () => readFile(path.join(cwd, 'package.json')),
    toolVersions: () => ({
      // Engine + framework resolve from this module's dependency closure; hal
      // resolves from the PROJECT's node_modules — the installed copy whose
      // API surface the firmware source compiled against.
      cuttlefish: readPackageJsonVersion('@typecad/cuttlefish'),
      frameworkZephyr: readPackageJsonVersion('@typecad/framework-zephyr'),
      hal: readPackageJsonVersion('@typecad/hal', cwd),
      sdk: PINNED_ZEPHYR_SDK_VERSION,
    }),
  };
}

// ---------------------------------------------------------------------------
// Build stamping (post-build, best-effort — never fails a build)
// ---------------------------------------------------------------------------

/**
 * Write `<buildDir>/sbom.cdx.json` after a successful west build. Best-effort:
 * any failure returns undefined silently — a missing SBOM never blocks the
 * build. `runner` is a test seam; production leaves it unset.
 */
export function stampBuildSbom(
  args: { buildDir: string; board?: string; projectRoot?: string },
  runner?: SbomRunner | null,
): string | undefined {
  try {
    const base = runner !== undefined ? runner : defaultSbomRunner(args.projectRoot ?? process.cwd());
    if (!base) return undefined;
    // The toolchain knows the build dir — prefer it over cwd-relative discovery.
    const r: SbomRunner = {
      ...base,
      compileCommandsPath: () => {
        const cc = path.join(args.buildDir, 'compile_commands.json');
        if (base.readFile(cc)) return cc;
        return base.compileCommandsPath ? base.compileCommandsPath() : undefined;
      },
    };
    const inv = collectSbomInventory(r, false, { boardTarget: args.board });
    if (!inv.ok) return undefined;
    // Only stamp COMPLETE records. The presenter may generate a partial BOM
    // interactively (with visible warnings), but a silently stamped kernel-only
    // or artifact-less record would read as authoritative — and --check would
    // then verify a lie.
    const incomplete = inv.warnings.some(
      (w) => w.kind === 'west-list-limited' || w.kind === 'no-build',
    );
    if (incomplete) return undefined;
    const doc = buildCycloneDXBom(inv, {
      toolVersion: inv.tools.cuttlefish ?? '0.0.0',
      timestamp: new Date().toISOString(),
    });
    const out = path.join(args.buildDir, 'sbom.cdx.json');
    writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
    return out;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// CLI presenter
// ---------------------------------------------------------------------------

let testRunner: SbomRunner | null | undefined;

/** @internal Test-only override of the default runner. Pass null to simulate west-not-found. */
export function __setSbomRunnerForTest(runner: SbomRunner | null | undefined): void {
  testRunner = runner;
}

function runnerOrReport(): SbomRunner | null {
  const runner = testRunner !== undefined ? testRunner : defaultSbomRunner();
  if (!runner) {
    ui.printError('west ............. NOT FOUND');
    ui.printInfo('  → install west (pip install west) or run the typeCAD Zephyr installer.');
    process.exitCode = 1;
    return null;
  }
  return runner;
}

function inventoryOrReport(all: boolean, meta: SbomInventoryMeta): Extract<SbomInventory, { ok: true }> | null {
  const runner = runnerOrReport();
  if (!runner) return null;
  const inv = collectSbomInventory(runner, all, meta);
  if (!inv.ok) {
    ui.printInfo(`(${inv.message})`);
    process.exitCode = 1;
    return null;
  }
  return inv;
}

function printWarnings(inv: Extract<SbomInventory, { ok: true }>): void {
  for (const w of inv.warnings) {
    const label =
      w.kind === 'no-build'
        ? w.detail ?? 'no build found'
        : `${w.component}: ${w.kind}${w.detail ? ` — ${w.detail}` : ''}`;
    ui.printWarning(label);
  }
}

function defaultOutputPath(inv: Extract<SbomInventory, { ok: true }>, format: SbomFormat): string {
  const base = inv.buildDir ?? process.cwd();
  return path.join(base, format === 'spdx' ? 'sbom.spdx.json' : 'sbom.cdx.json');
}

function runGenerate(options: SbomPresenterOptions, cleanStdout: boolean): void {
  const inv = inventoryOrReport(options.all ?? false, { boardTarget: boardTargetFromConfig() });
  if (!inv) return;
  const format: SbomFormat = options.format ?? 'cyclonedx';
  const toolVersion = inv.tools.cuttlefish ?? '0.0.0';
  const doc =
    format === 'spdx'
      ? buildSpdxDocument(inv, { toolVersion, timestamp: new Date().toISOString() })
      : buildCycloneDXBom(inv, { toolVersion, timestamp: new Date().toISOString() });

  // --strict fails on identity holes: a BOM whose components cannot be pinned
  // to immutable commits is not a compliance record. Evaluated before the
  // stdout early-return so a clean pipe still gates CI.
  const integrityHoles = inv.warnings.filter(
    (w) => w.kind === 'floating-revision' || w.kind === 'missing-sha',
  );
  if (integrityHoles.length > 0 && options.strict) {
    process.exitCode = 1;
  }

  if (options.stdout) {
    console.log(JSON.stringify(doc, null, 2));
    return;
  }
  const out = options.output ?? defaultOutputPath(inv, format);
  try {
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  } catch (e) {
    ui.printError(`Could not write ${out}: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }
  ui.printSuccess(`SBOM written to ${out}`);

  const licensed = inv.modules.filter((m) => m.spdx).length;
  ui.printInfo(
    `components ........ ${inv.modules.length} module(s), ${licensed} with a resolved license ` +
      `(${inv.modules.length - licensed} unknown)`,
  );
  if (inv.boardTarget) ui.printInfo(`board ............. ${inv.boardTarget}`);
  if (inv.artifact) {
    ui.printInfo(
      `firmware .......... ${inv.artifact.fileName} sha256 ${inv.artifact.sha256.slice(0, 16)}…`,
    );
  }
  if (inv.tools.cuttlefish || inv.tools.sdk) {
    ui.printInfo(
      `toolchain ......... formulation: cuttlefish ${inv.tools.cuttlefish ?? '?'} / ` +
        `hal ${inv.tools.hal ?? '?'} / SDK pin ${inv.tools.sdk ?? '?'}`,
    );
  }
  printWarnings(inv);
}

function runCheck(options: SbomPresenterOptions): void {
  if ((options.format ?? 'cyclonedx') === 'spdx') {
    ui.printError('--check verifies the build-stamped CycloneDX record; SPDX output is generate-only.');
    process.exitCode = 1;
    return;
  }
  const inv = inventoryOrReport(options.all ?? false, { boardTarget: boardTargetFromConfig() });
  if (!inv) return;
  const runner = testRunner !== undefined ? testRunner : defaultSbomRunner();
  const file =
    options.output ?? (inv.buildDir ? path.join(inv.buildDir, 'sbom.cdx.json') : defaultOutputPath(inv, 'cyclonedx'));

  let recorded: Record<string, unknown>;
  try {
    recorded = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    ui.printError(
      `No readable CycloneDX SBOM at ${file} — run 'typecad-hal build' (which stamps one) or 'typecad-hal sbom'.`,
    );
    process.exitCode = 1;
    return;
  }

  // Regenerate with the recorded timestamp so only real drift differs.
  const ts =
    (recorded.metadata as { timestamp?: unknown } | undefined)?.timestamp ??
    new Date().toISOString();
  const expected = buildCycloneDXBom(inv, {
    toolVersion: inv.tools.cuttlefish ?? '0.0.0',
    timestamp: typeof ts === 'string' ? ts : new Date().toISOString(),
  });
  const matches = canonicalJson(expected) === canonicalJson(recorded);

  // Freshness: the binary newer than the SBOM means the record is stale.
  if (matches && inv.artifact && runner?.statMtimeMs) {
    const binM = runner.statMtimeMs(inv.artifact.path);
    const sbomM = runner.statMtimeMs(file);
    if (binM !== null && sbomM !== null && binM > sbomM) {
      ui.printError(
        `The firmware binary (${inv.artifact.path}) is newer than the recorded SBOM — rebuild or re-run 'typecad-hal sbom'.`,
      );
      process.exitCode = 1;
      return;
    }
  }

  if (matches) {
    ui.printSuccess(
      `SBOM matches the recorded build — ${inv.modules.length} module(s), serial ${sbomSerialNumber(inv)}.`,
    );
    return;
  }

  const d = diffCycloneDxDocs(recorded, expected);
  for (const r of d.removed) ui.printInfo(`  removed from build: ${r}`);
  for (const a of d.added) ui.printInfo(`  new in build:       ${a}`);
  for (const c of d.changed) {
    ui.printInfo(`  changed:            ${c.component} ${c.field} ${c.from} → ${c.to}`);
  }
  ui.printError('The recorded SBOM does not match the current build (drift above).');
  process.exitCode = 1;
}

function runDiff(paths: [string, string]): void {
  const parse = (p: string): Record<string, unknown> | null => {
    try {
      const doc = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
      if (doc.bomFormat !== 'CycloneDX') {
        ui.printError(`${p} is not a CycloneDX document (bomFormat missing).`);
        return null;
      }
      return doc;
    } catch (e) {
      ui.printError(`Could not read ${p}: ${(e as Error).message}`);
      return null;
    }
  };
  const a = parse(paths[0]);
  const b = parse(paths[1]);
  if (!a || !b) {
    process.exitCode = 1;
    return;
  }
  const serial = (d: Record<string, unknown>): string =>
    typeof d.serialNumber === 'string' ? d.serialNumber : '(no serial)';
  ui.printInfo(`A: ${paths[0]} — ${serial(a)}`);
  ui.printInfo(`B: ${paths[1]} — ${serial(b)}`);

  const d = diffCycloneDxDocs(a, b);
  for (const r of d.removed) ui.printInfo(`  only in A:  ${r}`);
  for (const add of d.added) ui.printInfo(`  only in B:  ${add}`);
  for (const c of d.changed) {
    ui.printInfo(`  changed:    ${c.component} ${c.field} ${c.from} → ${c.to}`);
  }
  if (d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0) {
    ui.printSuccess('Component sets are identical (timestamps and serials may still differ).');
  } else {
    ui.printWarning(
      `${d.removed.length} removed, ${d.added.length} added, ${d.changed.length} changed — ` +
        're-assess vulnerabilities for the changed set.',
    );
  }
}

/** `typecad-hal sbom` presenter: generate (default), --check, or --diff.
 *  `--stdout` (generate mode) prints ONLY the JSON document — the banner,
 *  summary, and warnings are suppressed so it is a clean CI pipe. */
export function runSbomPresenter(options: SbomPresenterOptions): void {
  const cleanStdout = (options.stdout ?? false) && !options.check && !options.diff;
  if (!cleanStdout) ui.printHeader();
  if (options.diff) {
    if (!cleanStdout) ui.printStep('Comparing two SBOMs');
    runDiff(options.diff);
    return;
  }
  if (options.check) {
    if (!cleanStdout) ui.printStep('Verifying the recorded SBOM against the current build');
    runCheck(options);
    return;
  }
  if (!cleanStdout) {
    ui.printStep(
      (options.all ?? false)
        ? 'Generating SBOM (every west manifest module)'
        : 'Generating SBOM (linked dependencies only)',
    );
  }
  runGenerate(options, cleanStdout);
}
