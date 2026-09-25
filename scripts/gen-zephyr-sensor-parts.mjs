#!/usr/bin/env node
// ---------------------------------------------------------------------------
// gen-zephyr-sensor-parts.mjs — regenerate the Zephyr sensor part catalog
//
// Enumerates every sensor devicetree binding in a Zephyr workspace
// (dts/bindings/sensor/*.yaml) plus the channel list each in-tree driver
// actually serves (SENSOR_CHAN_* occurrences in the DT_DRV_COMPAT compilation
// unit), and writes packages/hal/src/sensor-catalog.generated.ts.
//
// The catalog backs the generic Sensor HAL class: `new Sensor(SENSOR.x,
// I2C1.device(addr))` — part identity, bus kind, and supported channels all
// come from this data, so no per-part code exists anywhere. The Zephyr
// revision is pinned (packages/framework-zephyr/installer/versions.env), so the
// checked-in catalog is stable between pins — regenerate as part of the
// version-bump checklist:
//
//   node scripts/gen-zephyr-sensor-parts.mjs <path-to-zephyr-workspace>
//
// (no argument → ~/zephyrproject)
// ----------------------------------------------------------------------------

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const workspace = process.argv[2] ?? join(homedir(), 'zephyrproject');
const zephyrBase = join(workspace, 'zephyr');
if (!existsSync(join(zephyrBase, 'dts', 'bindings', 'sensor'))) {
  console.error(`No Zephyr checkout at ${zephyrBase} — pass a west workspace path.`);
  process.exit(1);
}

const version = readFileSync(join(zephyrBase, 'VERSION'), 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('VERSION_MAJOR') || l.startsWith('VERSION_MINOR'))
  .map((l) => l.split('=')[1].trim())
  .join('.');
const pinLine = readFileSync(new URL('../packages/framework-zephyr/installer/versions.env', import.meta.url), 'utf8')
  .match(/^ZEPHYR_MANIFEST_REV=(.+)$/m)?.[1]?.trim();

// ── Pass 1: bindings → { compatible, bus, description } ────────────────────
// The binding YAMLs are uniform enough to line-scan: `compatible:` is a single
// quoted value, bus kind comes from the includes list (i2c-device.yaml /
// spi-device.yaml), and the description's first line is the human name.
// Multi-bus parts (bme280) ship one binding per bus with a shared compatible —
// merge their buses.

/** @type {Map<string, {compatible: string, buses: Set<string>, description: string}>} keyed by compatible */
const parts = new Map();
const bindingDir = join(zephyrBase, 'dts', 'bindings', 'sensor');
for (const file of readdirSync(bindingDir)) {
  if (!file.endsWith('.yaml') || file.endsWith('-common.yaml')) continue;
  const text = readFileSync(join(bindingDir, file), 'utf8');
  const compatible = text.match(/^compatible:\s*"([^"]+)"\s*$/m)?.[1];
  if (!compatible) continue; // base/common fragments carry no compatible
  const description = text.match(/^description:\s*(.+)$/m)?.[1]?.replace(/["\\]/g, '').trim() ?? '';
  // alert-gpios is the one optional binding prop the constructor exposes
  // (Sensor opts `alert?: Pin`) — presence under the properties block.
  const alert = /^\s{2,4}alert-gpios:/m.test(text);
  const buses = new Set();
  if (/i2c-device\.yaml/.test(text)) buses.add('i2c');
  if (/spi-device\.yaml/.test(text)) buses.add('spi');
  if (/w1-slave\.yaml/.test(text)) buses.add('w1');
  if (buses.size === 0) continue; // sensor-device only — not an attachable bus part
  const entry = parts.get(compatible) ?? { compatible, buses: new Set(), description, alert };
  for (const b of buses) entry.buses.add(b);
  if (!entry.description) entry.description = description;
  parts.set(compatible, entry);
}

// ── Pass 2: driver sources → channels per DT_DRV_COMPAT ────────────────────
// Every devicetree sensor driver names its compatible via
// `#define DT_DRV_COMPAT <vendor>_<device>` (the compatible with , → _), and
// serves exactly the channels whose SENSOR_CHAN_* constants appear in that
// driver's sources (the channel-get switch). Zephyr lays out one directory
// per driver, but the DT_DRV_COMPAT define may sit in the driver's .h while
// the channels live in its .c (bosch/bme280) — so channels merge across the
// whole directory when it defines exactly one compat, and per-file otherwise
// (a directory hosting several drivers keeps attribution strict).
// SENSOR_CHAN_ALL is the fetch wildcard, not a channel.

/** @type {Map<string, Set<string>>} keyed by underscored compatible */
const driverChannels = new Map();
const driverRoot = join(zephyrBase, 'drivers', 'sensor');

const fileCompat = (text) => text.match(/#\s*define\s+DT_DRV_COMPAT\s+([a-z0-9_]+)/)?.[1] ?? null;
const fileChannels = (text) => {
  const chans = new Set();
  for (const m of text.matchAll(/SENSOR_CHAN_([A-Z0-9_]+)/g)) {
    if (m[1] !== 'ALL') chans.add(m[1]);
  }
  return chans;
};
const addChannels = (compat, chans) => {
  if (compat === null || chans.size === 0) return;
  const merged = driverChannels.get(compat) ?? new Set();
  for (const c of chans) merged.add(c);
  driverChannels.set(compat, merged);
};

/** A driver unit = a directory holding .c/.h sources directly; vendors nest
 *  drivers one level down (bosch/bme280/), and loose files exist at the root
 *  (default_rtio_sensor.c) — so process every directory's own sources as a
 *  unit AND recurse into all subdirectories (drivers never nest drivers). */
const scanDriverDir = (dir) => {
  const entries = readdirSync(dir, { withFileTypes: true });
  const sources = entries
    .filter((e) => e.isFile() && (e.name.endsWith('.c') || e.name.endsWith('.h')))
    .map((f) => ({ text: readFileSync(join(dir, f.name), 'utf8') }));
  if (sources.length > 0) {
    const compats = new Set(sources.map((s) => fileCompat(s.text)).filter(Boolean));
    if (compats.size === 1) {
      const compat = [...compats][0];
      for (const s of sources) addChannels(compat, fileChannels(s.text));
    } else {
      for (const s of sources) addChannels(fileCompat(s.text), fileChannels(s.text));
    }
  }
  for (const e of entries) {
    if (e.isDirectory()) scanDriverDir(join(dir, e.name));
  }
};
scanDriverDir(driverRoot);

// ── Merge + collision check ─────────────────────────────────────────────────
// ── Channel enum → the authoritative CHAN name set ─────────────────────────
// Parsed BEFORE the merge: drivers also define private channel extensions
// (SENSOR_CHAN_<DRIVER>_INT_STATUS, SENSOR_CHAN_PRIV_START) which are legal
// for sensor_channel_get but absent from the public enum — a channel the CHAN
// map cannot name is dropped from per-part lists so the catalog stays a
// subset of CHAN.
const sensorHeader = readFileSync(join(zephyrBase, 'include', 'zephyr', 'drivers', 'sensor.h'), 'utf8');
const chanBlock = sensorHeader.match(/enum sensor_channel\s*\{([\s\S]*?)\};/)?.[1] ?? '';
const chanNames = [...chanBlock.matchAll(/^\s*(SENSOR_CHAN_[A-Z0-9_]+)/gm)]
  .map((m) => m[1].replace('SENSOR_CHAN_', ''))
  .filter((n) => n !== 'ALL' && n !== 'COMMON' && n !== 'PRIV_START');
const chanSet = new Set(chanNames);

// ── Merge + collision check ─────────────────────────────────────────────────
// The DT node-label / token form replaces [,-] with _, which is only
// reversible 1:1 if no two compatibles collapse to the same underscored form —
// drop (and report) any that do; the catalog must stay unambiguous.

/** underscored key for a compatible ('sensirion,sht3xd' → 'sensirion_sht3xd') */
const keyOf = (c) => c.replace(/[,-]/g, '_');

/** @type {Map<string, {compatible: string, buses: string[], description: string, channels: string[]}>} keyed by underscored compatible */
const catalog = new Map();
const collisions = [];
for (const [compatible, info] of parts) {
  const key = keyOf(compatible);
  if (catalog.has(key)) { collisions.push(key); continue; }
  const channels = [...(driverChannels.get(key) ?? [])].filter((c) => chanSet.has(c)).sort();
  catalog.set(key, {
    compatible,
    buses: [...info.buses].sort(),
    description: info.description,
    channels,
    alert: info.alert === true,
  });
}
for (const key of collisions) catalog.delete(key);

// ── Emit ────────────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const header = `// ---------------------------------------------------------------------------
// sensor-catalog.generated.ts — the Zephyr sensor part catalog
//
// GENERATED FILE — do not edit by hand. Regenerate against a workspace at the
// pinned revision (${pinLine ?? 'see versions.env'}) with:
//
//   node scripts/gen-zephyr-sensor-parts.mjs <workspace>
//
// Derived from Zephyr ${version}: dts/bindings/sensor/*.yaml (compatible, bus
// kind, description) joined against the in-tree drivers' SENSOR_CHAN_*
// occurrences (${driverChannels.size} drivers scanned). ${catalog.size} parts.
// Compatibles whose underscored form collides are dropped (${collisions.length}).
//
// This is the entire per-part surface of the Sensor HAL — \`SENSOR.\`
// enumerates it for completion, and framework-zephyr resolves DT facts from
// SENSOR_PART_INFO at lowering time. No per-part code exists anywhere.
// ---------------------------------------------------------------------------

/** Facts about one sensor part, keyed by its underscored compatible. */
export interface SensorPartInfo {
  /** The devicetree compatible string ('sensirion,sht3xd'). */
  compatible: string;
  /** Buses the part binds on ('i2c', 'spi', or both). */
  buses: readonly string[];
  /** First line of the binding's description (hover text). */
  description: string;
  /** SENSOR_CHAN_* suffixes the driver serves (empty = unscanned driver). */
  channels: readonly string[];
  /** The binding declares an optional alert-gpios (constructor opt alert?: Pin). */
  alert: boolean;
  /** Kconfig lines the part needs beyond CONFIG_SENSOR (empty — every in-tree
   *  sensor driver is default-y on its DT node; the field exists so an
   *  exception found by a future scan has a path to prj.conf). */
  kconfig: readonly string[];
}

/** Part facts keyed by the underscored compatible (the SENSOR token value). */
export const SENSOR_PART_INFO: Readonly<Record<string, SensorPartInfo>> = {
`;

const infoBody = [...catalog.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, p]) =>
  `  ${JSON.stringify(key)}: { compatible: ${JSON.stringify(p.compatible)}, buses: [${p.buses.map((b) => `'${b}'`).join(', ')}], description: ${JSON.stringify(p.description)}, channels: [${p.channels.map((c) => `'${c}'`).join(', ')}], alert: ${p.alert === true}, kconfig: [] },`,
).join('\n');

const tokenBody = [...catalog.keys()].sort().map((key) => {
  const p = catalog.get(key);
  const doc = `${p.description} — ${p.buses.join('+')}${p.channels.length > 0 ? `. Channels: ${p.channels.join(', ')}` : ' (no driver channel scan)'}`;
  return `  /** ${esc(doc)} */\n  ${JSON.stringify(key)}: ${JSON.stringify(key)},`;
}).join('\n');

const chanBody = chanNames.map((n) => `  ${JSON.stringify(n).slice(1, -1)} = ${JSON.stringify(n)},`).join('\n');

// Per-part channel unions — types only (erased at compile time, so 215
// entries are free to the checker). Same scan as SENSOR_PART_INFO's channels
// in the same pass, so the two cannot drift; unscanned drivers fall back to
// the string alias so those parts keep the generic get() surface.
const chanTypeBody = [...catalog.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, p]) =>
  `  ${JSON.stringify(key)}: ${p.channels.length > 0 ? p.channels.map((c) => `CHAN.${c}`).join(' | ') : 'SensorChannelName'};`,
).join('\n');

// Per-part bus kinds — types the Sensor constructor's bus-device argument so
// an SPI-only part rejects I2C0.device(...) at the editor.
const busTypeBody = [...catalog.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, p]) =>
  `  ${JSON.stringify(key)}: ${p.buses.map((b) => `'${b}'`).join(' | ')};`,
).join('\n');

const out = `${header}${infoBody}
};

/**
 * Sensor part tokens — one per supported sensor part, named vendor and part
 * ('sensirion_sht3xd' for the Sensirion SHT3xD). Pass to
 * \`new Sensor(SENSOR.<part>, I2C1.device(0x44))\`.
 */
export const SENSOR = {
${tokenBody}
} as const;

/** Sensor part token value (e.g. 'sensirion_sht3xd'). */
export type SensorToken = string;

/**
 * Sensor channel names ('AMBIENT_TEMP', 'HUMIDITY', …) — a string enum so
 * the editor offers CHAN members directly while typing inside
 * sensor.get(...). The member value equals its name.
 */
export enum CHAN {
${chanBody}
}

/** Channel name value (a CHAN member, see CHAN). */
export type SensorChannelName = string;

/**
 * Per-part channel unions — the narrowing surface for Sensor<P>.get():
 * new Sensor(SENSOR.sensirion_sht3xd, …).get( completes exactly this
 * part's channels and rejects the rest at the editor. Keyed by the SENSOR
 * token value (the underscored compatible).
 */
export type SensorChannelOf = {
${chanTypeBody}
};

/**
 * Per-part bus kinds — types the Sensor constructor's bus-device argument:
 * an SPI-only part rejects I2C0.device(...) at the editor, a dual-bus part
 * accepts either. Keyed by the SENSOR token value, same pass as the data
 * record, so the two cannot drift.
 */
export type SensorBusOf = {
${busTypeBody}
};
`;

writeFileSync(new URL('../packages/hal/src/sensor-catalog.generated.ts', import.meta.url), out, 'utf8');
console.log(`Wrote ${catalog.size} sensor parts, ${chanNames.length} channels (Zephyr ${version}).`);
if (collisions.length > 0) console.warn(`Dropped underscore-collisions: ${collisions.join(', ')}`);
