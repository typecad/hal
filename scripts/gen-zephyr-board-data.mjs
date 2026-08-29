// ---------------------------------------------------------------------------
// gen-zephyr-board-data.mjs — the Zephyr board data pack generator.
//
// Walks the pinned Zephyr tree's boards/ directory, and for every board
// variant yaml that carries an `identifier:` (the qualified west build
// target) and a same-basename .dts, extracts the board-level facts with
// framework-zephyr's tolerant dts-reader. Emits:
//
//   packages/cuttlefish/src/create/board-catalog.generated.ts
//
// One record per board VARIANT (identifier), keyed by the identifier. Pinned
// to the Zephyr revision of the local workspace — regenerate explicitly:
//
//   node scripts/gen-zephyr-board-data.mjs [zephyr-workspace]
//      (default: ~/zephyrproject; the tree at <workspace>/zephyr)
//
// Silicon facts (ADC channels, PWM matrices) are NOT extracted — they never
// live in devicetree. They are the curated chips/soc/ descriptors.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const workspace = process.argv[2] ?? path.join(os.homedir(), 'zephyrproject');
const zephyr = path.join(workspace, 'zephyr');
const boardsRoot = path.join(zephyr, 'boards');

const { readBoardDts } = require('../packages/framework-zephyr/dist/sdk/dts-reader.js');

if (!fs.existsSync(boardsRoot)) {
  console.error(`no boards/ at ${boardsRoot} — pass the workspace path as argv[2]`);
  process.exit(1);
}

/** Cut an inline `# comment` — safe inside quoted values (variant yamls
 *  carry them, e.g. ai_m61_32s_kit's revision note). */
function stripYamlComment(value) {
  const q = value[0];
  if (q === '"' || q === "'") {
    const end = value.indexOf(q, 1);
    return end > 0 ? value.slice(0, end + 1) : value;
  }
  const hash = value.indexOf(' #');
  return hash >= 0 ? value.slice(0, hash) : value;
}

/** Minimal line yaml reads (identifier:, name:) — full yaml not needed. */
function yamlField(file, field) {
  const m = fs.readFileSync(file, 'utf8').match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return m ? stripYamlComment(m[1]).trim() : undefined;
}

/** board.yml soc names (single-soc boards may carry UNQUALIFIED variant
 *  identifiers — the soc segment comes from here). Only the `socs:` list
 *  entries (`- name: <soc>`) count; the board's own `name:` key does not. */
function boardYmlSocs(dir) {
  const yml = path.join(dir, 'board.yml');
  if (!fs.existsSync(yml)) return [];
  const text = fs.readFileSync(yml, 'utf8');
  // The socs block ends at the variants: key (its '- name:' entries are
  // variant names, not socs).
  const afterSocs = text.slice(text.indexOf('socs:'));
  const socsBlock = afterSocs.slice(0, afterSocs.indexOf('variants:') > 0 ? afterSocs.indexOf('variants:') : undefined);
  return socsBlock
    .split('\n')
    .filter((l) => l.trim().startsWith('- name:'))
    .map((l) => stripYamlComment(l.split('name:')[1]).trim())
    .filter(Boolean);
}

const records = [];
let variants = 0, withFacts = 0, failures = 0;

/**
 * west runner → probe-method metadata. Ids match the curated soc tables
 * ('stlink', 'dfu', 'jlink', 'bossac', …) so `zephyr.probe` values stay
 * stable across tiers. Runners outside this map are skipped (under-promise:
 * the debug artifacts drive openocd/jlink servers only).
 */
const RUNNER_METHODS = {
  'openocd': { id: 'openocd', description: 'Any SWD/JTAG probe openocd supports', debug: true },
  'jlink': { id: 'jlink', description: 'J-Link probe (SWD)', debug: true },
  'dfu-util': { id: 'dfu', description: 'Built-in USB DFU bootloader: hold BOOT0, tap reset (no debug)', debug: false },
  'pyocd': { id: 'pyocd', description: 'Any CMSIS-DAP probe via pyOCD (no debug)', debug: false },
  'blackmagicprobe': { id: 'blackmagicprobe', description: 'Black Magic Probe (no debug)', debug: false },
  'stm32flash': { id: 'stm32flash', description: 'Built-in UART bootloader (no debug)', debug: false },
  'bossac': { id: 'bossac', description: 'Built-in USB bootloader: double-tap reset (no debug)', debug: false },
  'nrfjprog': { id: 'nrfjprog', description: 'Segger nRF command-line flasher (no debug)', debug: false },
  'esptool': { id: 'esptool', description: 'Espressif ROM bootloader over USB-serial (no debug)', debug: false },
  'linkserver': { id: 'linkserver', description: 'NXP LinkServer (no debug)', debug: false },
  'ezflashcli': { id: 'ezflashcli', description: 'Renesas EZ flash CLI (no debug)', debug: false },
};

/**
 * Probe methods from the board's own board.cmake (shared by all variants in
 * the dir): the include order is west's runner preference (first include =
 * default runner — dfu-util first on the blackpill, which is why an
 * unconfigured `west flash` uses DFU). The openocd method carries the
 * board's support/openocd.cfg verbatim (interface + target + quirks) so the
 * VS Code debug artifacts source the board-tested config.
 */
function boardProbeMethods(dir) {
  const cmake = path.join(dir, 'board.cmake');
  if (!fs.existsSync(cmake)) return undefined;
  const text = fs.readFileSync(cmake, 'utf8');
  const runners = [...text.matchAll(/include\(\$\{ZEPHYR_BASE\}\/boards\/common\/([\w.-]+)\.board\.cmake\)/g)].map((m) => m[1]);
  if (runners.length === 0) return undefined;
  const argsOf = new Map();
  for (const m of text.matchAll(/board_runner_args\(([\w.-]+)((?:\s+"[^"]*")*)\)/g)) {
    argsOf.set(m[1], [...m[2].matchAll(/"([^"]*)"/g)].map((q) => q[1]));
  }
  let cfgLines = null;
  const cfgPath = path.join(dir, 'support', 'openocd.cfg');
  if (fs.existsSync(cfgPath)) {
    cfgLines = fs.readFileSync(cfgPath, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'));
  }
  const methods = [];
  for (const runner of runners) {
    if (runner === 'openocd') {
      // An ST-Link interface cfg means the method is really 'stlink' — the
      // curated-table id users know. debugCfg carries the whole cfg file,
      // original line order (source/transport/events), comma-free join is
      // not assumed by the consumer.
      const isStlink = cfgLines?.some((l) => l.includes('interface/stlink')) ?? false;
      methods.push({
        id: isStlink ? 'stlink' : 'openocd',
        description: isStlink
          ? 'ST-Link or any SWD probe openocd supports (no BOOT0 needed) — also debugs'
          : 'Any SWD/JTAG probe openocd supports — also debugs',
        runner,
        debug: true,
        ...(cfgLines ? { debugCfg: cfgLines } : {}),
      });
      continue;
    }
    const meta = RUNNER_METHODS[runner];
    if (!meta) continue;
    const args = argsOf.get(runner) ?? [];
    if (runner === 'jlink') {
      const device = args.find((a) => a.startsWith('--device='));
      methods.push({
        id: 'jlink',
        description: 'J-Link probe (SWD) — also debugs',
        runner,
        debug: true,
        ...(device ? { debugDevice: device.slice('--device='.length) } : {}),
      });
      continue;
    }
    methods.push({ ...meta, runner, ...(args.length > 0 ? { args } : {}) });
  }
  return methods.length > 0 ? methods : undefined;
}

const vendors = fs.readdirSync(boardsRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory());

for (const vendorDir of vendors) {
  const boardDirs = fs.readdirSync(path.join(boardsRoot, vendorDir.name), { withFileTypes: true })
    .filter((d) => d.isDirectory());
  for (const boardDir of boardDirs) {
    const dir = path.join(boardsRoot, vendorDir.name, boardDir.name);
    const files = fs.readdirSync(dir);
    const socs = boardYmlSocs(dir);
    const probeMethods = boardProbeMethods(dir);
    for (const f of files) {
      if (!f.endsWith('.yaml') || f === 'board.yml') continue;
      const raw = yamlField(path.join(dir, f), 'identifier');
      if (!raw) continue;
      // Qualify: single-soc boards carry bare identifiers; the soc segment
      // comes from board.yml.
      const identifier = raw.includes('/') ? raw
        : socs.length === 1 ? `${raw}/${socs[0]}`
        : null;
      if (!identifier) continue;
      variants++;
      const dtsBase = f.replace(/\.yaml$/, '');
      const dtsFile = path.join(dir, dtsBase + '.dts');
      if (!fs.existsSync(dtsFile)) continue;
      const base = {
        identifier,
        name: yamlField(path.join(dir, f), 'name') ?? identifier,
        vendor: vendorDir.name,
        dts: dtsBase + '.dts',
        ...(probeMethods ? { probeMethods } : {}),
      };
      try {
        const facts = readBoardDts(dtsFile, { zephyrBoardsRoot: boardsRoot });
        const led = facts.leds.find((l) => l.alias);
        const button = facts.buttons.find((b) => b.alias);
        const rec = {
          ...base,
          console: facts.chosen['zephyr,console'],
          // Addressable user LED (ws2812) only when no gpio-leds LED exists —
          // a board with both keeps its devicetree-chosen led0.
          ...(facts.stripLed && !led ? { stripLed: { controller: facts.stripLed.controller, pin: facts.stripLed.pin } } : {}),
          ...(facts.usbDevice ? { usbDevice: facts.usbDevice } : {}),
          ...(facts.pwmLeds.length > 0
            ? { pwmLeds: facts.pwmLeds.map((p) => ({
                ...(p.alias ? { alias: p.alias } : {}),
                controller: p.controller, channel: p.channel,
                ...(p.periodNs != null ? { periodNs: p.periodNs } : {}),
                ...(p.flags && p.flags.length > 0 ? { flags: [...p.flags] } : {}),
              })) }
            : {}),
          ...(led ? { led: { dtSpec: led.alias, controller: led.controller, pin: led.pin, flags: led.flags } } : {}),
          ...(button ? { button: { dtSpec: button.alias, controller: button.controller, pin: button.pin, flags: button.flags } } : {}),
          ...(facts.leds.length > 1 || facts.buttons.length > 1
            ? {
                extraLeds: facts.leds.filter((l) => l !== led && l.alias).map((l) => ({ dtSpec: l.alias, controller: l.controller, pin: l.pin, flags: l.flags })),
                extraButtons: facts.buttons.filter((b) => b !== button && b.alias).map((b) => ({ dtSpec: b.alias, controller: b.controller, pin: b.pin, flags: b.flags })),
              }
            : {}),
          ...(facts.connectors.filter((c) => Object.keys(c.pins).length > 0).length > 0
            ? { connectors: facts.connectors.filter((c) => Object.keys(c.pins).length > 0).map((c) => ({ nodelabel: c.nodelabel, compatible: c.compatible, pins: c.pins })) }
            : {}),
        };
        // prune empty arrays
        for (const k of ['extraLeds', 'extraButtons']) if (rec[k]?.length === 0) delete rec[k];
        if (rec.console || rec.led || rec.button || rec.connectors) withFacts++;
        records.push(rec);
      } catch (err) {
        failures++;
        if (failures <= 5) console.error(`reader failed on ${identifier}: ${err.message}`);
        records.push(base);
      }
    }
  }
}

const out = `// GENERATED FILE -- do not edit by hand. Regenerate against the pinned
// Zephyr workspace with:
//
//   node scripts/gen-zephyr-board-data.mjs <workspace>
//
// One record per board VARIANT, keyed by the qualified build target (the
// variant yaml's identifier). Facts are extracted from each variant's own
// DTS by the tolerant reader (src/sdk/dts-reader.ts): the LED/BUTTON
// devicetree specs, the console controller, and any connector gpio-maps.
// Silicon facts (ADC/PWM) live in ../chips/soc/, never here.
// ${variants} variants, ${withFacts} with extractable facts, ${failures} reader failures.
// Zephyr ${(fs.readFileSync(path.join(zephyr, 'VERSION'), 'utf8').match(/VERSION_MAJOR\s*=\s*(\d+)[\s\S]*?VERSION_MINOR\s*=\s*(\d+)/) ?? []).slice(1).join('.') || '?'}

export interface BoardDataEntry {
  /** Qualified west build target (the variant yaml identifier). */
  readonly identifier: string;
  /** Human board name. */
  readonly name: string;
  /** Vendor directory name. */
  readonly vendor: string;
  /** The variant DTS file this was extracted from. */
  readonly dts: string;
  /** Console controller nodelabel (the chosen zephyr,console). */
  readonly console?: string;
  /** Addressable user LED (worldsemi,ws2812-*): the pad driving the pixel.
   *  A plain-GPIO LED — no led0 devicetree spec (the pixel is not a
   *  gpio-leds node). Present only when the board has no gpio-leds LED. */
  readonly stripLed?: { readonly controller: string; readonly pin: number };
  /** PWM-driven LEDs (pwm-leds children) in board order. The alias is the
   *  devicetree alias ('pwm-led0') — the DT_ALIAS-addressable form the PWM
   *  lowering needs; non-aliased channels are carried for reference. */
  readonly pwmLeds?: readonly {
    readonly alias?: string;
    readonly controller: string;
    readonly channel: number;
    readonly periodNs?: number;
    readonly flags?: readonly string[];
  }[];
  /** The board's USB device wiring: 'enabled' (DTS turns the device
   *  controller on), 'disabled' (explicitly off — suppress the USB0
   *  export), undefined (silent; the app overlay may still compose CDC). */
  readonly usbDevice?: 'enabled' | 'disabled';
  /** Probe/flash methods from the board's board.cmake (west runners, in the
   *  board's include order — first = west's default runner). */
  readonly probeMethods?: readonly {
    readonly id: string;
    readonly description: string;
    readonly runner: string;
    readonly args?: readonly string[];
    readonly debug?: boolean;
    readonly debugInterface?: 'swd' | 'jtag';
    readonly debugDevice?: string;
    /** The board's support/openocd.cfg, verbatim lines in file order. */
    readonly debugCfg?: readonly string[];
  }[];
  /** The canonical aliased LED (led0). */
  readonly led?: { readonly dtSpec: string; readonly controller: string; readonly pin: number; readonly flags: readonly string[] };
  /** The canonical aliased button (sw0). */
  readonly button?: { readonly dtSpec: string; readonly controller: string; readonly pin: number; readonly flags: readonly string[] };
  /** Additional aliased LEDs/buttons beyond the canonical ones. */
  readonly extraLeds?: readonly { readonly dtSpec: string; readonly controller: string; readonly pin: number; readonly flags: readonly string[] }[];
  readonly extraButtons?: readonly { readonly dtSpec: string; readonly controller: string; readonly pin: number; readonly flags: readonly string[] }[];
  /** Connector gpio-maps (arduino headers, XIAO edge connector, ...). */
  readonly connectors?: readonly { readonly nodelabel: string; readonly compatible?: string; readonly pins: Readonly<Record<string, { readonly controller: string; readonly pin: number; readonly flags: readonly string[] }>> }[];
}

export const BOARD_DATA: Readonly<Record<string, BoardDataEntry>> = ${JSON.stringify(Object.fromEntries(records.map((r) => [r.identifier, r])), null, 1)};
`;

const outPath = path.join(root, 'packages/cuttlefish/src/create/board-catalog.generated.ts');
fs.writeFileSync(outPath, out);
console.log(`wrote ${outPath}`);
console.log(`variants: ${variants}, with facts: ${withFacts}, failures: ${failures}`);
