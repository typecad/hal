// ---------------------------------------------------------------------------
// board-catalog/sdk.ts — the installed Zephyr SDK is the source of truth.
//
// `typecad-hal create` gates on this: no SDK, no project. The check is
// fs-only (the same discovery the catalog store uses) and compares the
// installed tree against the workspace pin so a project is always created
// against the SDK the frameworks were validated with.
//
// The pin mirrors framework-zephyr's installer/versions.env
// (ZEPHYR_MANIFEST_REV) — the installer's canonical source. A drift-guard
// test keeps the two in lockstep; change them together.
// ----------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { locateZephyrBaseCheap, isZephyrBase, micromambaZephyrBase } from './store.js';
import { zephyrVersionOf, gitHeadOf } from './walker.js';

/** The Zephyr manifest revision the workspace pins (installer versions.env). */
export const PINNED_ZEPHYR_MANIFEST_REV = 'v4.4.2';

/** The Zephyr SDK (toolchain bundle) version the workspace pins. */
export const PINNED_ZEPHYR_SDK_VERSION = '1.0.1';

/** The canonical install command (the installer's own usage strings). */
export const ZEPHYR_INSTALL_CMD = 'npx --package @typecad/framework-zephyr zephyr-installer';

/** Env that disables the create-time SDK gate (tests / expert override). */
export const SDK_CHECK_ENV = 'TYPECAD_HAL_SDK_CHECK';

/** 'v4.4.2' → '4.4.2' (the tree's VERSION file form). */
function revToVersion(rev: string): string {
  return rev.replace(/^v/, '');
}

/**
 * Fingerprint of an installed Zephyr tree: version + git HEAD, hashed. This
 * is the identity the board catalog's provenance already records per-walk;
 * expose it for humans (`board sync`, `doctor`) and any consumer that wants
 * to detect "the SDK moved" without comparing fields.
 */
export function sdkFingerprint(tree: string): string | undefined {
  if (!isZephyrBase(tree)) return undefined;
  const version = zephyrVersionOf(tree);
  const head = gitHeadOf(tree) ?? 'no-git';
  if (!version) return undefined;
  return createHash('sha1').update(`${version}\0${head}`).digest('hex').slice(0, 16);
}

/** Where the tree was found — printed by create so the user knows which
 *  SDK they are building against (and why, when two machines differ). */
export type SdkDiscoverySource = 'ZEPHYR_BASE' | 'well-known workspace' | 'installer env' | 'explicit';

/** Everything the create-time gate (and doctor) needs to know about the SDK:
 *  the Zephyr tree (source of truth for boards) and the toolchain SDK dir
 *  (the compiler bundle the installer lays down beside it). */
export type SdkCheck =
  | {
      status: 'ok';
      tree: string;
      version: string;
      pinnedVersion: string;
      fingerprint: string;
      discoveredVia: SdkDiscoverySource;
      toolchainDir?: string;
      toolchainVersion?: string;
    }
  | {
      status: 'missing';
      pinnedVersion: string;
    }
  | {
      status: 'version-mismatch';
      tree: string;
      version: string;
      pinnedVersion: string;
      fingerprint: string;
      discoveredVia: SdkDiscoverySource;
      toolchainDir?: string;
      toolchainVersion?: string;
    }
  | {
      status: 'toolchain-mismatch';
      tree: string;
      version: string;
      pinnedVersion: string;
      fingerprint: string;
      discoveredVia: SdkDiscoverySource;
      toolchainDir: string;
      toolchainVersion: string;
      pinnedToolchainVersion: string;
    };

/**
 * Locate the toolchain SDK dir (the compiler bundle the installer lays
 * down — distinct from the Zephyr tree): $ZEPHYR_SDK_INSTALL_DIR, the
 * installer env-vars file, or a `zephyr-sdk-*` sibling of the tree.
 * Verifies the dir carries an sdk_version file and returns the pair.
 */
export function findToolchainSdk(tree: string): { toolchainDir: string; toolchainVersion: string } | undefined {
  const candidates: string[] = [];
  if (process.env.ZEPHYR_SDK_INSTALL_DIR) candidates.push(process.env.ZEPHYR_SDK_INSTALL_DIR);
  const root = process.env.MAMBA_ROOT_PREFIX || path.join(os.homedir(), 'micromamba');
  const envDir = path.join(root, 'envs', process.env.TYPECAD_ZEPHYR_ENV || 'zephyr');
  const envVars = process.platform === 'win32'
    ? [path.join(envDir, 'etc', 'conda', 'env-vars.ps1'), path.join(envDir, 'etc', 'conda', 'env-vars.bat')]
    : [path.join(envDir, 'etc', 'conda', 'env-vars.sh')];
  for (const f of envVars) {
    if (!fs.existsSync(f)) continue;
    try {
      const m = fs.readFileSync(f, 'utf8').match(/TYPECAD_ZEPHYR_SDK_INSTALL_DIR\s*=\s*"([^"]+)"/);
      if (m) candidates.push(m[1]);
    } catch {
      // unreadable — keep going
    }
  }
  const workspace = path.dirname(path.resolve(tree));
  for (const entry of fs.existsSync(workspace) ? fs.readdirSync(workspace) : []) {
    if (/^zephyr-sdk-/.test(entry)) candidates.push(path.join(workspace, entry));
  }
  for (const dir of candidates) {
    const versionFile = path.join(dir, 'sdk_version');
    try {
      const version = fs.readFileSync(versionFile, 'utf8').trim();
      if (version) return { toolchainDir: path.resolve(dir), toolchainVersion: version };
    } catch {
      // not an SDK dir — try the next candidate
    }
  }
  return undefined;
}

/** How the tree at `base` was discovered (for the create printout). */
function discoverySource(base: string): SdkDiscoverySource {
  if (process.env.ZEPHYR_BASE && path.resolve(process.env.ZEPHYR_BASE) === base) return 'ZEPHYR_BASE';
  const installer = micromambaZephyrBase();
  if (installer && path.resolve(installer) === base) return 'installer env';
  return 'well-known workspace';
}

/**
 * Check the installed Zephyr SDK against the workspace pin. `tree` is
 * optional injection for tests; without it, discovery runs (fs-only,
 * ZEPHYR_BASE authoritative when set). Pure — no throwing, callers decide.
 */
export function checkZephyrSdk(tree?: string): SdkCheck {
  const pinnedVersion = revToVersion(PINNED_ZEPHYR_MANIFEST_REV);
  let discoveredVia: SdkDiscoverySource = 'explicit';
  let base: string | undefined;
  if (tree !== undefined) {
    base = isZephyrBase(tree) ? path.resolve(tree) : undefined;
  } else {
    base = locateZephyrBaseCheap();
    if (base) discoveredVia = discoverySource(base);
  }
  if (!base) return { status: 'missing', pinnedVersion };
  const version = zephyrVersionOf(base);
  const fingerprint = sdkFingerprint(base);
  if (!version || !fingerprint) return { status: 'missing', pinnedVersion };
  const toolchain = findToolchainSdk(base);
  if (version !== pinnedVersion) {
    return {
      status: 'version-mismatch', tree: base, version, pinnedVersion, fingerprint,
      discoveredVia, ...(toolchain ?? {}),
    };
  }
  // The toolchain bundle is the SDK proper — the installer pins it in
  // lockstep with the manifest revision, so a mismatch means a partial
  // upgrade (tree re-pinned, toolchains not re-fetched, or vice versa).
  if (toolchain && toolchain.toolchainVersion !== PINNED_ZEPHYR_SDK_VERSION) {
    return {
      status: 'toolchain-mismatch', tree: base, version, pinnedVersion, fingerprint,
      discoveredVia,
      toolchainDir: toolchain.toolchainDir,
      toolchainVersion: toolchain.toolchainVersion,
      pinnedToolchainVersion: PINNED_ZEPHYR_SDK_VERSION,
    };
  }
  return {
    status: 'ok', tree: base, version, pinnedVersion, fingerprint,
    discoveredVia, ...(toolchain ?? {}),
  };
}

/**
 * The create-time gate: throw with actionable guidance unless a matching SDK
 * is installed. Suppressed by TYPECAD_HAL_SDK_CHECK=off (tests / experts who
 * track their own tree against the looser build-time compat range).
 */
export function assertZephyrSdkForCreate(): Extract<SdkCheck, { status: 'ok' }> | undefined {
  if (process.env[SDK_CHECK_ENV] === 'off') return undefined;
  const check = checkZephyrSdk();
  if (check.status === 'ok') return check;
  if (check.status === 'missing') {
    throw new Error(
      `No Zephyr SDK found on this machine — a project is only useful with one.\n` +
      `Install the pinned SDK (Zephyr ${check.pinnedVersion}, toolchain SDK ${PINNED_ZEPHYR_SDK_VERSION}):\n` +
      `  ${ZEPHYR_INSTALL_CMD}\n` +
      `Then re-run 'typecad-hal create'. (Set ZEPHYR_BASE if your tree lives elsewhere.)`,
    );
  }
  throw new Error(
    `The installed Zephyr SDK (${check.version} at ${check.tree}) does not match the\n` +
    `workspace pin (${check.pinnedVersion}). Re-pin your tree to the validated revision:\n` +
    `  ${ZEPHYR_INSTALL_CMD}            # interactive — re-checks out the pinned revision\n` +
    `or track your own tree by setting TYPECAD_HAL_SDK_CHECK=off (the build-time\n` +
    `compat check still applies).`,
  );
}

/** Multi-line summary of a successful check — the CLI's indented
 *  key/value list style (match the `board sync` block's format). */
export function formatZephyrSdkFound(check: Extract<SdkCheck, { status: 'ok' }>): string[] {
  const lines = [
    `  zephyr:       ${check.version} @ ${check.tree}`,
  ];
  lines.push(
    check.toolchainDir
      ? `  toolchain:    SDK ${check.toolchainVersion ?? ''} @ ${check.toolchainDir}`
      : `  toolchain:    not found (west builds still work; some runners may not)`,
  );
  return lines;
}
