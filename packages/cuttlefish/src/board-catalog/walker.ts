// ---------------------------------------------------------------------------
// catalog-walker.ts — walk a Zephyr tree's boards/ and build the board data
// catalog (records + provenance).
//
// For every board variant yaml that carries an `identifier:` (the qualified
// west build target) and a same-basename .dts, extract the board-level facts
// with the tolerant dts-reader. One record per board VARIANT (identifier),
// keyed by the identifier.
//
// This is the ONE walker shared by the catalog producer:
//   - `typecad-hal board sync` regenerates the machine-local catalog
//     overlay from the user's own Zephyr tree, so board add/change/remove
//     tracks `west update` instead of cuttlefish releases. (There is no
//     compiled-in pack anymore — the overlay is the only catalog.)
//
// Silicon facts split by where the SoC's data lives: STM32-style per-pad
// pinctrl routes are harvested from the vendor HAL dtsi the board's include
// chain reaches (dts-reader.ts); ESP32's C-header matrices (LEDC channel×pad,
// SARADC) are shape-parsed from the tree here (harvestEspFamilyHeaders); and
// families whose silicon map has no in-tree source at all (nRF SAADC AIN
// pads) are synthesized in the manifest generator's family tables — never
// board-aware code here.
// ----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { readBoardDts } from './dts-reader.js';
import { harvestPinconfig } from './pinconfig.js';
import type { BoardDataEntry } from './types.js';
/** Provenance of a walked catalog — pins it to the exact tree it describes. */
export interface BoardCatalogProvenance {
  /** The Zephyr base directory the walk read (resolved). */
  readonly zephyrBase: string;
  /** VERSION file contents rendered 'MAJOR.MINOR.PATCH' (best-effort). */
  readonly version: string;
  /** Git HEAD of the tree when readable (best-effort; tarballs carry none). */
  readonly gitHead?: string;
  /** Boards-dir mtime (epoch ms) — the fallback change signal for git-less trees. */
  readonly boardsMtimeMs: number;
  /** ISO timestamp of the walk. */
  readonly generatedAt: string;
  /** Variant count, carried for quick display without loading `boards`. */
  readonly variants: number;
}

/** A completed walk: records in boards/ directory order + provenance. */
export interface BoardCatalogWalkResult {
  readonly boards: Readonly<Record<string, BoardDataEntry>>;
  readonly provenance: BoardCatalogProvenance;
  readonly stats: {
    readonly variants: number;
    readonly withFacts: number;
    readonly failures: number;
    /** Variant yamls that carried an identifier but resolved to no .dts at
     *  all (even through the shared-base fallback) — silently invisible in
     *  the catalog; surfaced so a tree shape change can't hide boards. */
    readonly droppedYamls: number;
    /** Coverage ledger aggregated across the walk: per capability, how many
     *  boards were satisfied by each silicon source. The drift guard for the
     *  "100% board/soc knowledge" goal — a family with a source in-tree but
     *  zero boards covered by it is a regression. */
    readonly coverage: {
      readonly adc: Readonly<Record<string, number>>;
      readonly pwm: Readonly<Record<string, number>>;
      readonly dac: Readonly<Record<string, number>>;
    };
  };
}

/** Cut an inline `# comment` — safe inside quoted values (variant yamls
 *  carry them, e.g. ai_m61_32s_kit's revision note). */
function stripYamlComment(value: string): string {
  const q = value[0];
  if (q === '"' || q === "'") {
    const end = value.indexOf(q, 1);
    return end > 0 ? value.slice(0, end + 1) : value;
  }
  const hash = value.indexOf(' #');
  return hash >= 0 ? value.slice(0, hash) : value;
}

/** Minimal line yaml reads (identifier:, name:) — full yaml not needed. */
function yamlField(file: string, field: string): string | undefined {
  const m = fs.readFileSync(file, 'utf8').match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return m ? stripYamlComment(m[1]).trim() : undefined;
}

/** board.yml soc lookup, both formats Zephyr ships:
 *  - legacy single-board (`board:` / top-level `socs:`): every soc listed
 *    under the socs: block → `uniqueSocs`;
 *  - multi-board directories (top-level `boards:` list — lyra_24_dvk,
 *    lyra_dvk, …): each entry carries its own socs; single-soc entries map
 *    board name → soc in `byName`. Multi-soc entries stay unmapped (their
 *    variant yamls carry qualified identifiers).
 *  `boardNames` lists every declared board name (the `boards:` entries and
 *  the legacy `board:` name) — the CONFIG_BOARD_<X> stem a variant's
 *  board.cmake guards its runner args with. */
export interface BoardYmlSocIndex {
  readonly byName: ReadonlyMap<string, string>;
  readonly uniqueSocs: readonly string[];
  readonly boardNames: readonly string[];
}

/** Read board.yml's board→soc index (see BoardYmlSocIndex). */
export function boardYmlSocIndex(dir: string): BoardYmlSocIndex {
  const yml = path.join(dir, 'board.yml');
  if (!fs.existsSync(yml)) return { byName: new Map(), uniqueSocs: [], boardNames: [] };
  const byName = new Map<string, string>();
  const uniqueSocs: string[] = [];
  const boardNames: string[] = [];
  let inBoardsList = false; // top-level `boards:` present (multi-board format)
  let currentBoard: string | undefined;
  let currentSocs: string[] = []; // socs collected for currentBoard
  // A key line with its indent, innermost last. A `- name:` list entry is
  // owned by the topmost key at an indent ≤ the entry's — the tree's
  // board.ymls are not indent-consistent (xiao_ble puts soc entries at the
  // same indent as the socs: key, lyra nests them two deeper), so the
  // enclosing KEY, not the indentation depth, decides ownership.
  const keyStack: Array<{ indent: number; key: string }> = [];
  const flushEntry = (): void => {
    // Only single-soc entries map board name → soc: multi-soc entries need
    // qualified identifiers in their variant yamls.
    if (currentBoard && currentSocs.length === 1) byName.set(currentBoard, currentSocs[0]);
  };
  for (const rawLine of fs.readFileSync(yml, 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const entry = trimmed.match(/^- name:\s*(.+)$/);
    const key = trimmed.match(/^([\w.-]+):(?:\s|$)/);
    if (key) {
      while (keyStack.length > 0 && keyStack[keyStack.length - 1]!.indent > indent) keyStack.pop();
      keyStack.push({ indent, key: key[1] });
      if (indent === 0 && key[1] === 'boards') inBoardsList = true;
      continue;
    }
    // Legacy single-board header: `board: xiao_ble` (value on the key line).
    if (indent === 0) {
      const legacyBoard = trimmed.match(/^board:\s*(\S.*)$/);
      if (legacyBoard) boardNames.push(stripYamlComment(legacyBoard[1]).trim());
    }
    if (entry) {
      const name = stripYamlComment(entry[1]).trim();
      if (!name) continue;
      // Innermost enclosing key that owns a list at this entry's indent.
      let owner: { indent: number; key: string } | undefined;
      for (let i = keyStack.length - 1; i >= 0; i--) {
        if (keyStack[i]!.indent <= indent) {
          owner = keyStack[i];
          break;
        }
      }
      if (owner?.key === 'boards') {
        // A board entry under boards: — its socs follow under its own
        // socs: key.
        flushEntry();
        currentBoard = name;
        currentSocs = [];
        boardNames.push(name);
      } else if (owner?.key === 'socs') {
        if (inBoardsList) currentSocs.push(name);
        else uniqueSocs.push(name);
      }
      // Every other list (variants:, …) is not ours.
    }
  }
  flushEntry();
  return { byName, uniqueSocs, boardNames };
}

/**
 * west runner → probe-method metadata. Ids match the curated soc tables
 * ('stlink', 'dfu', 'jlink', 'bossac', …) so `zephyr.probe` values stay
 * stable across tiers; runners with no curated counterpart use their west
 * runner name as the id (stm32cubeprogrammer, uf2, …). Flash-only tools
 * carry debug: false (a bootloader is not a debugger — the debug path
 * rejects them, resolveProbeMethod enforces it). Simulation-only runners
 * (renode, simics) and debug-server helpers (stlink_gdbserver, trace32)
 * stay unmapped — cuttlefish flashes real hardware.
 */
const RUNNER_METHODS: Record<string, { id: string; description: string; debug: boolean }> = {
  'openocd': { id: 'openocd', description: 'Any SWD/JTAG probe openocd supports', debug: true },
  // Vendor-flavored openocd runner includes — the same openocd runner with
  // vendor defaults (ST: onboard ST-Link; nRF5: nRF tap config). Without
  // these, every ST board (118 in the tree) lost its primary probe method.
  'openocd-stm32': { id: 'openocd', description: 'ST-Link onboard or any SWD probe openocd supports', debug: true },
  'openocd-nrf5': { id: 'openocd', description: 'Any SWD/JTAG probe openocd supports (nRF5 defaults)', debug: true },
  'jlink': { id: 'jlink', description: 'J-Link probe (SWD)', debug: true },
  'dfu-util': { id: 'dfu', description: 'Built-in USB DFU bootloader: hold BOOT0, tap reset (no debug)', debug: false },
  'pyocd': { id: 'pyocd', description: 'Any CMSIS-DAP probe via pyOCD (no debug)', debug: false },
  'blackmagicprobe': { id: 'blackmagicprobe', description: 'Black Magic Probe (no debug)', debug: false },
  'stm32flash': { id: 'stm32flash', description: 'Built-in UART bootloader (no debug)', debug: false },
  'bossac': { id: 'bossac', description: 'Built-in USB bootloader: double-tap reset (no debug)', debug: false },
  'nrfjprog': { id: 'nrfjprog', description: 'Segger nRF command-line flasher (no debug)', debug: false },
  'esptool': { id: 'esptool', description: 'Espressif ROM bootloader over USB-serial (no debug)', debug: false },
  // The ESP32 family's include name for the esptool runner.
  'esp32': { id: 'esptool', description: 'Espressif ROM bootloader over USB-serial (no debug)', debug: false },
  'linkserver': { id: 'linkserver', description: 'NXP LinkServer (no debug)', debug: false },
  'ezflashcli': { id: 'ezflashcli', description: 'Renesas EZ flash CLI (no debug)', debug: false },
  'stm32cubeprogrammer': { id: 'stm32cubeprogrammer', description: 'STM32CubeProgrammer CLI via ST-Link (no debug)', debug: false },
  'nrfutil': { id: 'nrfutil', description: 'nrfutil device — Nordic USB DFU / serial bootloader (no debug)', debug: false },
  'uf2': { id: 'uf2', description: 'UF2 bootloader: copy the firmware file (no debug)', debug: false },
  'silabs_commander': { id: 'silabs_commander', description: 'Simplicity Commander CLI (no debug)', debug: false },
  'probe-rs': { id: 'probe-rs', description: 'probe-rs flasher (no debug)', debug: false },
  'rfp': { id: 'rfp', description: 'Renesas Flash Programmer CLI (no debug)', debug: false },
  'bflb_mcu_tool': { id: 'bflb_mcu_tool', description: 'BouffaloLab bflb_mcu_tool (no debug)', debug: false },
  'xsdb': { id: 'xsdb', description: 'Xilinx xsdb flasher (no debug)', debug: false },
  'wchisp': { id: 'wchisp', description: 'WCH ISP bootloader (no debug)', debug: false },
  'spsdk': { id: 'spsdk', description: 'NXP SPSDK blhost (no debug)', debug: false },
  'minichlink': { id: 'minichlink', description: 'minichlink (WCH CH32, no debug)', debug: false },
  'mdb-hw': { id: 'mdb-hw', description: 'Synopsys MetaWare Debugger, hardware target (no debug)', debug: false },
  'wlink': { id: 'wlink', description: 'WCH-Link probe (no debug)', debug: false },
  'gd32isp': { id: 'gd32isp', description: 'GD32 UART ISP bootloader (no debug)', debug: false },
  'sftool': { id: 'sftool', description: 'SiFli sftool (no debug)', debug: false },
  'teensy': { id: 'teensy', description: 'Teensy loader (no debug)', debug: false },
  'nulink': { id: 'nulink', description: 'Nuvoton NuLink (no debug)', debug: false },
};

/** The mutable builder shape of one probe method (records are readonly). */
interface MutableProbeMethod {
  id: string;
  description: string;
  runner: string;
  args?: string[];
  debug?: boolean;
  debugInterface?: 'swd' | 'jtag';
  debugDevice?: string;
  debugCfg?: string[];
}

/**
 * Probe methods from the board's own board.cmake (shared by all variants in
 * the dir): the include order is west's runner preference (first include =
 * default runner — dfu-util first on the blackpill, which is why an
 * unconfigured `west flash` uses DFU). The openocd method carries the
 * board's support/openocd.cfg verbatim (interface + target + quirks) so the
 * VS Code debug artifacts source the board-tested config.
 */
/** One board_runner_args occurrence with its enclosing CMake conditions
 *  (innermost last; empty condition = unconditional). */
interface RunnerArgsOccurrence {
  readonly conds: readonly string[];
  readonly args: readonly string[];
}

/** One runner include with its enclosing conditions. */
interface RunnerIncludeOccurrence {
  readonly name: string;
  readonly conds: readonly string[];
}

/** Everything one scan of board.cmake yields. */
interface BoardCmakeScan {
  readonly runnerArgs: Map<string, RunnerArgsOccurrence[]>;
  readonly includes: readonly RunnerIncludeOccurrence[];
}

/**
 * Scan board.cmake line-by-line tracking if/elseif/else/endif, recording
 * every board_runner_args occurrence and every runner include with its
 * condition stack. Variant selection happens later (pickArgs /
 * activeRunners) — a dir shared by several boards guards each variant's
 * runner args behind its own CONFIG_BOARD_<ID>, and boards guard whole
 * RUNNERS behind core-specific configs (variscite's jlink sits inside
 * if(CONFIG_SOC_MIMX8ML8_M7): the A53 target has no jlink at all).
 * Args containing CMake variable references (${CONFIG_SOC}, …) only
 * resolve inside the build — carried verbatim they would poison a real
 * `west flash` invocation, so they are dropped at capture.
 */
function scanBoardCmake(text: string): BoardCmakeScan {
  const runnerArgs = new Map<string, RunnerArgsOccurrence[]>();
  const includes: RunnerIncludeOccurrence[] = [];
  const conds: string[] = [];
  for (const line of text.split('\n')) {
    const branch = line.match(/^\s*(if|elseif|else|endif)\b\s*\(?\s*(.*?)\s*\)?\s*$/);
    if (branch) {
      const kw = branch[1];
      const cond = kw === 'else' ? '' : branch[2];
      if (kw === 'if') conds.push(cond);
      else if (kw === 'elseif') conds[conds.length - 1] = cond;
      else if (kw === 'else') conds[conds.length - 1] = '';
      else if (kw === 'endif') conds.pop();
      continue;
    }
    const argsM = line.match(/^\s*board_runner_args\(([\w.-]+)\s+(.*)\)\s*$/);
    if (argsM) {
      const args = [...argsM[2].matchAll(/"([^"]*)"/g)].map((q) => q[1]).filter((q) => !q.includes('${'));
      const list = runnerArgs.get(argsM[1]) ?? [];
      list.push({ conds: [...conds], args });
      runnerArgs.set(argsM[1], list);
      continue;
    }
    const incM = line.match(/^\s*include\(\$\{ZEPHYR_BASE\}\/boards\/common\/([\w.-]+)\.board\.cmake\)/);
    if (incM) includes.push({ name: incM[1], conds: [...conds] });
  }
  return { runnerArgs, includes };
}

/**
 * Does one condition line apply to THIS target? Empty = always. A
 * CONFIG_BOARD stem must match on a token boundary (a prefix must not
 * match a longer board name); a CONFIG_SOC_<soc> guard matches any
 * variant of that soc, and CONFIG_SOC_<soc>_<X> matches variants whose
 * qualifiers include X.
 */
function conditionMatchesTarget(cond: string, boardConfigs: readonly string[], soc: string | undefined, quals: readonly string[]): boolean {
  if (!cond) return true;
  const cu = cond.toUpperCase();
  for (const cfg of boardConfigs) {
    if (new RegExp(`CONFIG_BOARD_${cfg}(?![A-Za-z0-9_])`).test(cu)) return true;
  }
  if (soc) {
    const socUpper = soc.toUpperCase();
    if (new RegExp(`CONFIG_SOC_${socUpper}(?![A-Za-z0-9_])`).test(cu)) return true;
    if (quals.some((q) => cu.includes(`_${q.toUpperCase()}`)) && cu.includes(`CONFIG_SOC_${socUpper}`)) return true;
  }
  return false;
}

/**
 * Pick the occurrence for one variant. Priority:
 *   1. a condition naming one of this target's CONFIG_BOARD_<name> tokens
 *      (both Zephyr naming shapes: the board.yml entry name — duo_board_b —
 *      and the full underscored target — raytac's …_NRF5340_CPUNET), matched
 *      with a token boundary so CONFIG_BOARD_IMX8MM_EVK does not match
 *      …_EVK_MIMX8MM6_M4;
 *   2. a CONFIG_SOC_<soc>_… condition mentioning one of the target's
 *      qualifier tokens (imx8mm guards its A53 args that way);
 *   3. an unconditional occurrence;
 *   4. the first (documented fallback).
 */
function pickArgs(
  list: readonly RunnerArgsOccurrence[],
  boardConfigs: readonly string[],
  soc: string | undefined,
  quals: readonly string[],
): readonly string[] {
  for (const cfg of boardConfigs) {
    const boardGuarded = list.find((o) => o.conds.some((c) => conditionMatchesTarget(c, [cfg], undefined, [])));
    if (boardGuarded) return boardGuarded.args;
  }
  if (soc && quals.length > 0) {
    const socGuarded = list.find((o) =>
      o.conds.some((c) => c && conditionMatchesTarget(c, [], soc, quals) && /CONFIG_SOC_/i.test(c)),
    );
    if (socGuarded) return socGuarded.args;
  }
  const plain = list.find((o) => o.conds.length === 0 || o.conds.every((c) => c === ''));
  if (plain) return plain.args;
  return list[0]?.args ?? [];
}

/** How the caller pins runner args to ONE variant of a shared board dir. */
export interface VariantPin {
  /** CONFIG_BOARD stems to try in order: the board.yml entry name this
   *  target belongs to, then the full underscored target name. */
  readonly boardConfigs?: readonly string[];
  /** The target's soc segment ('nrf5340'). */
  readonly soc?: string;
  /** Qualifier segments after the soc ('cpunet', ['a53','smp']). */
  readonly quals?: readonly string[];
}

export function boardProbeMethods(dir: string, variant?: VariantPin): BoardDataEntry['probeMethods'] {
  const cmake = path.join(dir, 'board.cmake');
  if (!fs.existsSync(cmake)) return undefined;
  const text = fs.readFileSync(cmake, 'utf8');
  const scan = scanBoardCmake(text);
  const boardConfigs = variant?.boardConfigs ?? [];
  const soc = variant?.soc;
  const quals = variant?.quals ?? [];
  // Active runners for THIS variant: unconditional includes always apply;
  // guarded includes apply only when their condition names this target
  // (variscite's jlink is inside if(CONFIG_SOC_…_M7) — the A53 target has
  // no jlink at all, and offering it would flash the wrong core). Only
  // ~24 files in the tree guard every include; a target matching none of
  // a file's guards honestly gets no probe methods.
  let includeNames = scan.includes.map((i) => i.name);
  const anyGuarded = scan.includes.some((i) => i.conds.length > 0 && i.conds.some((c) => c !== ''));
  if (anyGuarded) {
    const active = new Set<string>();
    for (const inc of scan.includes) {
      if (inc.conds.length === 0 || inc.conds.every((c) => c === '')) active.add(inc.name);
      else if (inc.conds.some((c) => conditionMatchesTarget(c, boardConfigs, soc, quals))) active.add(inc.name);
    }
    includeNames = [...active];
  }
  // First include = west's default runner (preserve scan order).
  const runners = [...new Set(includeNames)];
  if (runners.length === 0) return undefined;
  let cfgLines: string[] | null = null;
  const cfgPath = path.join(dir, 'support', 'openocd.cfg');
  if (fs.existsSync(cfgPath)) {
    cfgLines = fs.readFileSync(cfgPath, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'));
  }
  const methods: MutableProbeMethod[] = [];
  for (const runner of runners) {
    // The vendor-flavored openocd includes get the same cfg treatment as
    // plain openocd (stlink interface detection + debugCfg attach).
    if (runner === 'openocd' || runner === 'openocd-stm32' || runner === 'openocd-nrf5') {
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
    // Per-variant args: the occurrence whose CONFIG_BOARD / CONFIG_SOC
    // guard names THIS variant wins (pickArgs).
    const args = pickArgs(scan.runnerArgs.get(runner) ?? [], boardConfigs, soc, quals);
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
    methods.push({ ...meta, runner, ...(args.length > 0 ? { args: [...args] } : {}) });
  }
  // Dedupe by method id: vendor-flavored includes can coexist with the
  // plain one (openocd + openocd-stm32) — one method per id, first wins.
  const seen = new Set<string>();
  const unique = methods.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  return unique.length > 0 ? (unique as BoardDataEntry['probeMethods']) : undefined;
}

/** VERSION file → 'MAJOR.MINOR.PATCH' ('' when unreadable). */
export function zephyrVersionOf(zephyrBase: string): string {
  try {
    const text = fs.readFileSync(path.join(zephyrBase, 'VERSION'), 'utf8');
    const m = text.match(/VERSION_MAJOR\s*=\s*(\d+)[\s\S]*?VERSION_MINOR\s*=\s*(\d+)/);
    if (!m) return '';
    const patch = text.match(/PATCHLEVEL\s*=\s*(\d+)/);
    return patch ? `${m[1]}.${m[2]}.${patch[1]}` : `${m[1]}.${m[2]}`;
  } catch {
    return '';
  }
}

/**
 * Git HEAD of the tree, read straight off the filesystem (no git spawn —
 * sync runs where git may be absent). Handles the plain clone (.git dir,
 * HEAD → ref → loose ref or packed-refs) and the worktree/submodule form
 * (.git file pointing at a gitdir). Best-effort: undefined when unreadable.
 */
export function gitHeadOf(zephyrBase: string): string | undefined {
  try {
    const dotGit = path.join(zephyrBase, '.git');
    let gitDir = dotGit;
    const st = fs.statSync(dotGit);
    if (st.isFile()) {
      const text = fs.readFileSync(dotGit, 'utf8');
      const m = text.match(/gitdir:\s*(.+)/);
      if (!m) return undefined;
      const dir = m[1].trim();
      gitDir = path.isAbsolute(dir) ? dir : path.resolve(zephyrBase, dir);
    }
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head || undefined;
    const ref = head.slice(5).trim();
    const refFile = path.join(gitDir, ref);
    if (fs.existsSync(refFile)) return fs.readFileSync(refFile, 'utf8').trim() || undefined;
    const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
    const m = packed.match(new RegExp(`^([0-9a-f]{40,}) ${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    return m ? m[1] : undefined;
  } catch {
    return undefined;
  }
}

/** Every build target a board.yml declares, with the naming facts the
 *  synthesizer needs (board.yml-driven dirs ship NO per-variant yamls —
 *  nucleo_n657x0_q's sb target exists only as a board.yml entry). */
export interface BoardYmlTarget {
  readonly identifier: string;
  /** The board entry name the target belongs to (CONFIG_BOARD stem). */
  readonly boardName: string;
  readonly soc?: string;
  /** Variant chain segments after the soc ('sb', ['a53','smp']). */
  readonly chain: readonly string[];
  readonly fullName?: string;
  readonly vendor?: string;
}

/**
 * Parse board.yml into its declared build targets, both shapes:
 * multi-board (`boards:` list) and legacy (`board:` block), with socs and
 * (nested) variants. Variant chains accumulate through nesting levels
 * (board/soc/v1/v2).
 */
export function boardYmlTargets(dir: string): BoardYmlTarget[] {
  const yml = path.join(dir, 'board.yml');
  if (!fs.existsSync(yml)) return [];
  const targets: BoardYmlTarget[] = [];
  type BoardCtx = { name: string; fullName?: string; vendor?: string; socs: Map<string, string[][]> };
  const boards: BoardCtx[] = [];
  let board: BoardCtx | undefined;
  let soc: { name: string; chains: string[][] } | undefined;
  const keyStack: Array<{ indent: number; key: string }> = [];
  const chainBases: string[][] = [];
  let chain: string[] = [];

  const flushSoc = (): void => {
    if (board && soc) {
      board.socs.set(soc.name, soc.chains);
      soc = undefined;
      chain = [];
      chainBases.length = 0;
    }
  };
  const flushBoard = (): void => {
    flushSoc();
    board = undefined;
  };

  for (const rawLine of fs.readFileSync(yml, 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const entry = trimmed.match(/^- name:\s*(.+)$/);
    const key = trimmed.match(/^([\w.-]+):(?:\s+(.*))?$/);
    if (key && !trimmed.startsWith('-')) {
      while (keyStack.length > 0 && keyStack[keyStack.length - 1]!.indent > indent) keyStack.pop();
      const k = key[1];
      const v = (key[2] ?? '').trim();
      if (indent === 0 && k === 'boards') {
        flushBoard();
      } else if (indent === 0 && k === 'board' && v) {
        // Legacy inline form: board: xiao_ble
        flushBoard();
        board = { name: stripYamlComment(v).trim(), socs: new Map() };
        boards.push(board);
      } else if (k === 'variants') {
        // Chains under this level accumulate from the enclosing chain.
        chainBases.push([...chain]);
      } else if ((k === 'name' || k === 'full_name' || k === 'vendor') && v) {
        const val = stripYamlComment(v).trim();
        // A name: under a legacy board: block names the board.
        if (k === 'name' && !board && keyStack.some((s) => s.key === 'board')) {
          board = { name: val, socs: new Map() };
          boards.push(board);
        } else if (k !== 'name' && board && !soc) {
          if (k === 'full_name') board.fullName = val;
          if (k === 'vendor') board.vendor = val;
        }
      }
      keyStack.push({ indent, key: k });
      continue;
    }
    if (entry) {
      const name = stripYamlComment(entry[1]).trim().replace(/^['"]|['"]$/g, '');
      if (!name) continue;
      let owner: string | undefined;
      for (let i = keyStack.length - 1; i >= 0; i--) {
        if (keyStack[i]!.indent <= indent) {
          owner = keyStack[i]!.key;
          break;
        }
      }
      if (owner === 'boards') {
        flushBoard();
        board = { name, socs: new Map() };
        boards.push(board);
      } else if (owner === 'socs') {
        flushSoc();
        soc = { name, chains: [] };
      } else if (owner === 'variants') {
        const base = chainBases[chainBases.length - 1] ?? [];
        chain = [...base, name];
        soc?.chains.push([...chain]);
      }
    }
  }
  flushBoard();

  for (const b of boards) {
    for (const [socName, chains] of b.socs) {
      targets.push({ identifier: `${b.name}/${socName}`, boardName: b.name, soc: socName, chain: [], ...(b.fullName ? { fullName: b.fullName } : {}), ...(b.vendor ? { vendor: b.vendor } : {}) });
      for (const c of chains) {
        targets.push({ identifier: [b.name, socName, ...c].join('/'), boardName: b.name, soc: socName, chain: c, ...(b.fullName ? { fullName: b.fullName } : {}), ...(b.vendor ? { vendor: b.vendor } : {}) });
      }
    }
  }
  return targets;
}

/** Compose the catalog record from one DTS's extracted facts. The canonical
 *  LED/button picks follow the DEVICETREE numbering, not child order: led0
 *  when aliased (mm_swiftio declares led0 = green_led as the SECOND child —
 *  picking the first aliased child made the manifest's LED0 contradict the
 *  devicetree's led0). Same for sw0. Extras then carry the remaining
 *  aliased nodes and the LED<N>/BUTTON<N> indices line up with dtSpec
 *  numbering. */

// ── ESP32 family header harvest ────────────────────────────────────────────
// ESP32 SoCs publish their silicon matrices as C headers, not pinctrl dtsi:
// the LEDC channel×pad macros in <zephyr>/include/zephyr/dt-bindings/pinctrl/
// <soc>-pinctrl.h (LEDC_CH<ch>_GPIO<pin> — every pair) and the SARADC map in
// the HAL module's components/soc/<soc>/include/soc/adc_channel.h
// (ADC<unit>_GPIO<pad>_CHANNEL <ch>). Both are shape-parsed; the file paths
// key on the target's soc segment (a data convention, like the letter-port
// families), never on board names.
function harvestEspFamilyHeaders(
  identifier: string,
  facts: ReturnType<typeof readBoardDts>,
  zephyrBase: string,
  westRoot: string,
): { pwmMatrix?: { controller: string; channelCount: number; pads: number[] }; espAdc?: { source: string; pad: number; channel: number }[] } {
  const soc = identifier.split('/')[1];
  if (!soc || !/^(esp32|esp32c)/.test(soc)) return {};
  const out: ReturnType<typeof harvestEspFamilyHeaders> = {};
  try {
    const pinH = path.join(zephyrBase, 'include', 'zephyr', 'dt-bindings', 'pinctrl', soc + '-pinctrl.h');
    if (fs.existsSync(pinH)) {
      const src = fs.readFileSync(pinH, 'utf8');
      const pads = new Set<number>();
      let maxCh = -1;
      for (const m of src.matchAll(/#define LEDC_CH(\d+)_GPIO(\d+)\b/g)) {
        pads.add(Number(m[2]));
        maxCh = Math.max(maxCh, Number(m[1]));
      }
      if (pads.size > 0 && maxCh >= 0) {
        out.pwmMatrix = { controller: facts.ledcNode ?? 'ledc0', channelCount: maxCh + 1, pads: [...pads].sort((a, b) => a - b) };
      }
    }
  } catch { /* header absent — no matrix facts */ }
  try {
    const adcH = path.join(westRoot, 'modules', 'hal', 'espressif', 'components', 'soc', soc, 'include', 'soc', 'adc_channel.h');
    if (fs.existsSync(adcH)) {
      const src = fs.readFileSync(adcH, 'utf8');
      const routes: { source: string; pad: number; channel: number }[] = [];
      for (const m of src.matchAll(/#define ADC(\d+)_GPIO(\d+)_CHANNEL\s+(\d+)/g)) {
        // DT nodelabels: adc0 carries unit 1, adc1 unit 2.
        routes.push({ source: 'adc' + (Number(m[1]) - 1), pad: Number(m[2]), channel: Number(m[3]) });
      }
      if (routes.length > 0) out.espAdc = routes;
    }
  } catch { /* header absent — no adc facts */ }
  return out;
}

// ── RP2 header matrices ─────────────────────────────────────────────────────
// The RP2040/RP2350 publish their silicon routing as pinmux macros in
// include/zephyr/dt-bindings/pinctrl/rpi-pico-*-pinctrl.h: the ADC map
// (ADC_CH<n>_P<pad>, in the SoC headers — channels 0-3 = P26-P29 on BOTH
// SoCs) and the PWM slice map (PWM_<slice><A|B>_P<pad>, in the shared
// common header — every GPIO is PWM-capable, slice = pad/2, A/B = pad%2).
// The macro token IS the overlay's pinmux payload: the RP2 ADC and PWM
// drivers both apply pinctrl, so routes carry it for group synthesis.
function rp2PinctrlHeaderFile(soc: string): string[] | undefined {
  if (soc === 'rp2040') return ['rpi-pico-rp2040-pinctrl.h', 'rpi-pico-pinctrl-common.h'];
  if (soc === 'rp2350a') return ['rpi-pico-rp2350a-pinctrl.h', 'rpi-pico-pinctrl-common.h'];
  if (soc === 'rp2350b') return ['rpi-pico-rp2350b-pinctrl.h', 'rpi-pico-pinctrl-common.h'];
  return undefined;
}

function harvestRp2PinctrlHeaders(
  identifier: string,
  zephyrBase: string,
): { padAdc?: { source: string; channel: number; pad: number; pinctrl: string }[]; padPwm?: { source: string; channel: number; pad: number; pinctrl: string }[] } {
  const soc = identifier.split('/')[1];
  const files = soc ? rp2PinctrlHeaderFile(soc) : undefined;
  if (!files) return {};
  const adc = new Map<string, { source: string; channel: number; pad: number; pinctrl: string }>();
  const pwm = new Map<string, { source: string; channel: number; pad: number; pinctrl: string }>();
  for (const f of files) {
    let src: string;
    try {
      src = fs.readFileSync(path.join(zephyrBase, 'include', 'zephyr', 'dt-bindings', 'pinctrl', f), 'utf8');
    } catch {
      continue;
    }
    for (const m of src.matchAll(/#define (ADC_CH(\d+)_P(\d+))\b/g)) {
      adc.set(m[1], { source: 'adc', channel: Number(m[2]), pad: Number(m[3]), pinctrl: m[1] });
    }
    for (const m of src.matchAll(/#define (PWM_(\d+)([AB])_P(\d+))\b/g)) {
      // The pwm-rp2 driver decodes its channel cell as slice*2 + (B?1:0).
      pwm.set(m[1], { source: 'pwm', channel: Number(m[2]) * 2 + (m[3] === 'B' ? 1 : 0), pad: Number(m[4]), pinctrl: m[1] });
    }
  }
  return {
    ...(adc.size > 0 ? { padAdc: [...adc.values()].sort((a, b) => a.channel - b.channel) } : {}),
    ...(pwm.size > 0 ? { padPwm: [...pwm.values()].sort((a, b) => a.pad - b.pad) } : {}),
  };
}

// ── Vendor pinconfig YAMLs (GD32 / Atmel / Bouffalolab) ─────────────────────
// The datasheet-sourced pin tables under each HAL module's `pinconfigs/`
// directory — see board-catalog/pinconfig.ts. ADC + (Atmel) DAC routes for
// now; the walker's coverage ledger records the families whose PWM pinmux
// synthesis is still pending instead of shipping false capability flags.
function composeRecord(base: BoardDataEntry, facts: ReturnType<typeof readBoardDts>, zephyrBase: string, westRoot: string): { record: BoardDataEntry; hasFacts: boolean } {
  const esp = harvestEspFamilyHeaders(base.identifier, facts, zephyrBase, westRoot);
  const rp2 = harvestRp2PinctrlHeaders(base.identifier, zephyrBase);
  const pinconfig = harvestPinconfig(base.identifier, westRoot);
  const adcRoutes = [...facts.adcPins, ...(pinconfig?.adc ?? [])];
  // SAM DAC needs no pinmux group (the driver selects the output pad), so the
  // pinconfig DAC route carries no pinctrl token — an empty token keeps it out
  // of the overlay's pinctrl-0 emission, exactly like the ESP32 DAC synthesis.
  const dacRoutes = [...facts.dacPins, ...(pinconfig?.dac ?? []).map((d) => ({ ...d, pinctrl: '' }))];
  // SAM PWM routes carry the synthesized WO pinmux macro token (pinctrl), so
  // they join the pwmPins pipeline verbatim — the overlay synthesizes the
  // pad group from the macro like any other macro-form route.
  const pwmRoutes = [...facts.pwmPins, ...(pinconfig?.pwm ?? [])];
  const led = facts.leds.find((l) => l.alias === 'led0') ?? facts.leds.find((l) => l.alias);
  const button = facts.buttons.find((b) => b.alias === 'sw0') ?? facts.buttons.find((b) => b.alias);
  const rec: Record<string, unknown> = {
    ...base,
    console: facts.chosen['zephyr,console'],
    // Addressable user LED (ws2812) only when no gpio-leds LED exists —
    // a board with both keeps its devicetree-chosen led0.
    ...(facts.stripLed && !led ? { stripLed: { controller: facts.stripLed.controller, pin: facts.stripLed.pin } } : {}),
    ...(facts.usbDevice ? { usbDevice: facts.usbDevice } : {}),
    ...(facts.usbController ? { usbController: facts.usbController } : {}),
    // Board-level watchdog0 alias wins; boards that never wrote one fall
    // back to the SoC-level watchdog node (nearly every SoC ships IWDG —
    // the alias is authorial habit, not a hardware difference).
    ...(facts.aliases['watchdog0'] || facts.wdtSocNode
      ? { wdtNodeLabel: facts.aliases['watchdog0'] ?? facts.wdtSocNode }
      : {}),
    ...(facts.buses.i2c.length > 0 || facts.buses.spi.length > 0 || facts.buses.uart.length > 0
      ? { buses: facts.buses }
      : {}),
    ...(facts.pwmLeds.length > 0
      ? { pwmLeds: facts.pwmLeds.map((p) => ({
          ...(p.alias ? { alias: p.alias } : {}),
          controller: p.controller, channel: p.channel,
          ...(p.periodNs != null ? { periodNs: p.periodNs } : {}),
          ...(p.flags && p.flags.length > 0 ? { flags: [...p.flags] } : {}),
        })) }
      : {}),
    // Silicon PWM/analog routes harvested from the SoC pinctrl files in the
    // board's include chain (raw port/bit form — the manifest generator maps
    // to global pin numbers and applies nodelabel conventions).
    ...(pwmRoutes.length > 0 ? { pwmPins: pwmRoutes } : {}),
    ...(adcRoutes.length > 0 ? { adcPins: adcRoutes } : {}),
    ...(dacRoutes.length > 0 ? { dacPins: dacRoutes } : {}),
    ...(facts.analogDevices.length > 0 ? { analogDevices: facts.analogDevices } : {}),
    ...(esp.pwmMatrix ? { pwmMatrix: esp.pwmMatrix } : {}),
    ...(facts.pwmNodes && facts.pwmNodes.length > 0 ? { pwmNodes: facts.pwmNodes } : {}),
    ...(rp2.padAdc ? { padAdc: rp2.padAdc } : {}),
    ...(rp2.padPwm ? { padPwm: rp2.padPwm } : {}),
    ...(facts.connectorAdc.length > 0 ? { connectorAdc: facts.connectorAdc } : {}),
    ...(facts.pinctrlWarnings && facts.pinctrlWarnings.length > 0 ? { pinctrlWarnings: facts.pinctrlWarnings } : {}),
    ...(facts.flashKb ? { flashKb: facts.flashKb } : {}),
    ...(facts.hasStoragePartition ? { hasStoragePartition: true } : {}),
    ...(facts.storageReg ? { storageReg: facts.storageReg } : {}),
    ...(facts.counterNodes.length > 0 ? { counterNodes: facts.counterNodes } : {}),
    ...(facts.gpioControllers.length > 0 ? { gpioControllers: facts.gpioControllers } : {}),
    ...(esp.espAdc ? { espAdc: esp.espAdc } : {}),
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
  for (const k of ['extraLeds', 'extraButtons']) if ((rec[k] as unknown[] | undefined)?.length === 0) delete rec[k];
  // Coverage ledger: which source satisfied each capability (see
  // BoardDataEntry.siliconSources). nRF SAADC's pad map is synthesized in
  // boardgen (family table) — the walker records pwmNodes (the nRF psel
  // matrix) as 'family'; SAADC itself is only boardgen-visible.
  const siliconSources: { adc?: 'pinctrl' | 'pinconfig' | 'header' | 'family' | 'connector'; pwm?: 'pinctrl' | 'pinconfig' | 'header' | 'family'; dac?: 'pinctrl' | 'pinconfig' } = {};
  if (pinconfig?.adc.length) siliconSources.adc = 'pinconfig';
  else if (facts.adcPins.length) siliconSources.adc = 'pinctrl';
  else if (esp.espAdc?.length) siliconSources.adc = 'header';
  else if (rp2.padAdc?.length) siliconSources.adc = 'header';
  else if (facts.connectorAdc.length) siliconSources.adc = 'connector';
  if (facts.pwmPins.length) siliconSources.pwm = 'pinctrl';
  else if (pinconfig?.pwm?.length) siliconSources.pwm = 'pinconfig';
  else if (esp.pwmMatrix) siliconSources.pwm = 'header';
  else if (rp2.padPwm?.length) siliconSources.pwm = 'header';
  else if (facts.pwmNodes?.length) siliconSources.pwm = 'family';
  if (facts.dacPins.length) siliconSources.dac = 'pinctrl';
  else if (pinconfig?.dac?.length) siliconSources.dac = 'pinconfig';
  if (Object.keys(siliconSources).length > 0) rec.siliconSources = siliconSources;
  const hasFacts = Boolean(rec.console || rec.led || rec.button || rec.connectors);
  return { record: rec as unknown as BoardDataEntry, hasFacts };
}

/** Probe-method pin for one identifier (CONFIG_BOARD stems + soc quals). */
function variantPinFor(identifier: string, socIndex: BoardYmlSocIndex): VariantPin {
  const parts = identifier.split('/');
  const underscored = identifier.replace(/\//g, '_');
  const entry = socIndex.boardNames.find((n) => identifier === n || identifier.startsWith(n + '/'));
  return {
    boardConfigs: [...new Set([...(entry ? [entry] : []), underscored])]
      .map((n) => n.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()),
    ...(parts[1] ? { soc: parts[1] } : {}),
    ...(parts.length > 2 ? { quals: parts.slice(2) } : {}),
  };
}

/** Candidate .dts files for one identifier, best match first: the yaml's own
 *  basename, then progressively de-qualified shared forms — an @revision
 *  qualifier is stripped (nrf9160dk@0.7.0/nrf9160 → nrf9160dk/nrf9160) and
 *  trailing segments are dropped one at a time (…/nrf9160/ns shares the base
 *  nrf9160dk_nrf9160.dts). Boards that ship ONLY revision-qualified yamls
 *  (nrf9160dk) reach their base dts exclusively through these fallbacks. */
function dtsCandidatesFor(dir: string, identifier: string, yamlBase?: string): string[] {
  const out: string[] = [];
  if (yamlBase) out.push(path.join(dir, yamlBase + '.dts'));
  const segments = identifier.split('/');
  segments[0] = segments[0].split('@')[0];
  for (let n = segments.length; n >= 1; n--) {
    const c = path.join(dir, segments.slice(0, n).join('_') + '.dts');
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * Board-dir overlays (user-facing `<board>*.overlay` files) document the
 * analog header wiring the base DTS leaves out — Renesas RA boards carry
 * BOTH the connector gpio-map and the io-channel-map ONLY there (joined by
 * the shared child-spec token, e.g. ARDUINO_HEADER_R3_A0). Same trust level
 * as the DK dtsi maps: board-authored wiring. Two joins: the overlay's own
 * gpio-map (token → pad), then the base-DTS connectors' labels (comment
 * token first, Arduino `A<idx>` position convention for numeric specs).
 */
function overlayConnectorAdc(
  dir: string,
  files: readonly string[],
  connectors: ReturnType<typeof readBoardDts>['connectors'],
): { source: string; channel: number; controller: string; pin: number }[] {
  const out: { source: string; channel: number; controller: string; pin: number }[] = [];
  for (const f of files) {
    if (!f.endsWith('.overlay')) continue;
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, f), 'utf8');
    } catch {
      continue;
    }
    const map = text.match(/io-channel-map\s*=([^;]*);/s);
    if (!map) continue;
    // The overlay's own gpio-map: <child-spec 0 &ctrl PIN flags> → pad.
    // Child specs are tokens (macros like ARDUINO_HEADER_R3_A0 or indexes).
    const overlayPads = new Map<string, { controller: string; pin: number }>();
    const gpiomap = text.match(/gpio-map\s*=([^;]*);/s);
    if (gpiomap) {
      for (const g of gpiomap[1]!.matchAll(/<([\w]+)\s+\d+\s+&([\w,-]+)\s+(\d+)\s+\d+>/g)) {
        if (!overlayPads.has(g[1]!)) overlayPads.set(g[1]!, { controller: g[2]!, pin: Number(g[3]) });
      }
    }
    for (const m of map[1]!.matchAll(/<([\w]+)\s+&([\w,-]+)\s+(\d+)\s*>[\s]*(?:\/\*\s*([A-Za-z_][\w-]*)?[^*]*\*\/)?/g)) {
      const channel = Number(m[3]);
      if (!Number.isFinite(channel)) continue;
      const token = m[1]!;
      // Join 1: the same token in the overlay's gpio-map.
      const pad = overlayPads.get(token);
      if (pad) {
        out.push({ source: m[2]!, channel, controller: pad.controller, pin: pad.pin });
        continue;
      }
      // Join 2: base-DTS connector labels — the comment's first token, else
      // the Arduino uno-adc position convention (numeric index N = A<N>).
      const idx = Number(token);
      const labels = [
        ...(m[4] ? [m[4]] : []),
        ...(Number.isInteger(idx) && idx >= 0 && idx <= 7 ? [`A${idx}`] : []),
      ];
      for (const c of connectors) {
        for (const label of labels) {
          const ref = c.pins[label];
          if (ref) {
            out.push({ source: m[2]!, channel, controller: ref.controller, pin: ref.pin });
            break;
          }
        }
      }
    }
  }
  return out;
}

/**
 * Walk `<zephyrBase>/boards` and extract one record per board variant.
 * Reader failures degrade to the base record (identifier/name/vendor/dts +
 * probe methods) — a board whose DTS defeats the reader still resolves, it
 * just carries no pin facts.
 */
// Extraction revision history (GENERATOR_REV lives in store.ts):
//   1 initial; 2 multi-board board.yml + first-wins runner args + comma
//   labels; 3 vendor runner aliases; 4 comment-before-property; 5 duplicate
//   runner dedupe; 6 full flasher coverage + macro-arg filter; 7 per-variant
//   guard selection; 8 board.yml-synthesized targets; 9 bus/usb/wdt facts +
//   the move into cuttlefish (the compiled-in pack is gone); 10 silicon
//   pinctrl harvest (STM32 tim/adc routes via module dts roots); 11 dac
//   routes + SoC-level watchdog fallback + zephyr arch dts roots; 12
//   pinconfigs YAML ADC + gpio-controller inventory + siliconSources ledger.

export function walkBoardCatalog(zephyrBase: string): BoardCatalogWalkResult {
  const boardsRoot = path.join(zephyrBase, 'boards');
  if (!fs.existsSync(boardsRoot)) {
    throw new Error(`no boards/ directory at ${boardsRoot} — not a Zephyr tree?`);
  }
  // Vendor HAL module dts roots (Zephyr's MODULE_DTS_ROOTS, mirrored): the
  // west workspace keeps modules/ beside the zephyr checkout, and the STM32
  // pinctrl dtsi the board DTS includes (<st/f4/…-pinctrl.dtsi>) resolves
  // from modules/hal/stm32/dts. Discovered, not hardcoded — a tree without
  // modules simply yields no silicon pinctrl facts.
  const westRoot = path.dirname(zephyrBase);
  const moduleDtsRoots: string[] = [];
  const discoverDtsRoots = (parent: string): void => {
    try {
      for (const d of fs.readdirSync(parent, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const candidate = path.join(parent, d.name, 'dts');
        if (fs.existsSync(candidate)) moduleDtsRoots.push(candidate);
        // Zephyr module dts roots also expose `include/` for angle includes
        // (`<dt-bindings/pinctrl/…>` — GigaDevice ships its per-part pinctrl
        // headers there, not under dts/).
        const includeRoot = path.join(parent, d.name, 'include');
        if (fs.existsSync(path.join(includeRoot, 'dt-bindings'))) moduleDtsRoots.push(includeRoot);
      }
    } catch {
      // no such parent — plain zephyr checkout without a west workspace
    }
  };
  discoverDtsRoots(path.join(westRoot, 'modules'));
  discoverDtsRoots(path.join(westRoot, 'modules', 'hal'));
  // The zephyr tree's own arch dts roots (dts/arm, dts/xtensa, …): board
  // DTS files include their SoC dtsi through them (`<st/f4/…Xe.dtsi>`),
  // which is where SoC-level nodes (the STM32 iwdg watchdog) live.
  try {
    const dtsRoot = path.join(zephyrBase, 'dts');
    for (const d of fs.readdirSync(dtsRoot, { withFileTypes: true })) {
      if (d.isDirectory()) moduleDtsRoots.push(path.join(dtsRoot, d.name));
    }
  } catch {
    // no dts/ dir — not a full checkout
  }

  const records: BoardDataEntry[] = [];
  let variants = 0, withFacts = 0, failures = 0, droppedYamls = 0;

  const vendors = fs.readdirSync(boardsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const vendorDir of vendors) {
    const boardDirs = fs.readdirSync(path.join(boardsRoot, vendorDir.name), { withFileTypes: true })
      .filter((d) => d.isDirectory());
    for (const boardDir of boardDirs) {
      const dir = path.join(boardsRoot, vendorDir.name, boardDir.name);
      const files = fs.readdirSync(dir);
      const socIndex = boardYmlSocIndex(dir);
      const seenIds = new Set<string>();
      for (const f of files) {
        if (!f.endsWith('.yaml') || f === 'board.yml') continue;
        const raw = yamlField(path.join(dir, f), 'identifier');
        if (!raw) continue;
        // Qualify: bare identifiers take the soc segment from board.yml —
        // their own entry's soc in multi-board dirs, the sole soc in
        // single-board dirs.
        const identifier = raw.includes('/')
          ? raw
          : (() => {
              const soc = socIndex.byName.get(raw)
                ?? (socIndex.uniqueSocs.length === 1 ? socIndex.uniqueSocs[0] : null);
              return soc ? `${raw}/${soc}` : null;
            })();
        if (!identifier || seenIds.has(identifier)) continue;
        // Resolve the dts BEFORE claiming the identifier: a yaml whose
        // same-basename dts is missing falls back to the board's shared base
        // dts (revision-qualified yamls — nrf9160dk ships only
        // *_0_14_0.yaml over nrf9160dk_nrf9160.dts). Marking seenIds first
        // made such yamls vanish AND blocked the board.yml synthesis pass
        // from covering the identifier — whole boards (nrf9160dk, the
        // mt81xx ADSP targets) dropped out of the catalog silently.
        const dtsFile = dtsCandidatesFor(dir, identifier, f.replace(/\.yaml$/, ''))
          .find((p) => fs.existsSync(p));
        if (!dtsFile) {
          droppedYamls++;
          continue;
        }
        variants++;
        seenIds.add(identifier);
        // Per-variant: runner args are selected by the variant's own
        // CONFIG_BOARD guard, so this must run per yaml, not per dir.
        const probeMethods = boardProbeMethods(dir, variantPinFor(identifier, socIndex));
        const base: BoardDataEntry = {
          identifier,
          name: yamlField(path.join(dir, f), 'name') ?? identifier,
          vendor: vendorDir.name,
          dts: path.basename(dtsFile),
          ...(probeMethods ? { probeMethods } : {}),
        };
        try {
          let facts = readBoardDts(dtsFile, { zephyrBoardsRoot: boardsRoot, moduleDtsRoots });
          {
            // Overlay wiring appended, deduped by (source, channel, pad) —
            // sibling variant overlays (uno_r4 minima/wifi) repeat entries.
            const seen = new Set(facts.connectorAdc.map((r) => `${r.source}:${r.channel}:${r.controller}.${r.pin}`));
            const extra = overlayConnectorAdc(dir, files, facts.connectors)
              .filter((r) => !seen.has(`${r.source}:${r.channel}:${r.controller}.${r.pin}`));
            facts = { ...facts, connectorAdc: [...facts.connectorAdc, ...extra] };
          }
          const { record, hasFacts } = composeRecord(base, facts, zephyrBase, westRoot);
          if (hasFacts) withFacts++;
          records.push(record);
        } catch (err) {
          failures++;
          if (failures <= 5) console.error(`reader failed on ${identifier}: ${(err as Error).message}`);
          records.push(base);
        }
      }
      // Synthesis pass: board.yml-driven dirs ship NO per-variant yamls —
      // nucleo_n657x0_q's `sb` target exists only as a board.yml entry.
      // Emit every declared target the yaml flow did not already cover.
      for (const t of boardYmlTargets(dir)) {
        if (seenIds.has(t.identifier)) continue;
        // No yamlBase preference here — the MOST qualified candidate must
        // win (Zephyr's own variant dts chain: board_soc_variant → board_soc
        // → board); the chain's tail covers the boardName fallback.
        const dtsFile = dtsCandidatesFor(dir, t.identifier)
          .find((p) => fs.existsSync(p));
        if (!dtsFile) continue;
        seenIds.add(t.identifier);
        variants++;
        const probeMethods = boardProbeMethods(dir, variantPinFor(t.identifier, socIndex));
        const base: BoardDataEntry = {
          identifier: t.identifier,
          name: t.fullName ?? t.identifier,
          vendor: t.vendor ?? vendorDir.name,
          dts: path.basename(dtsFile),
          ...(probeMethods ? { probeMethods } : {}),
        };
        try {
          let facts = readBoardDts(dtsFile, { zephyrBoardsRoot: boardsRoot, moduleDtsRoots });
          {
            // Overlay wiring appended, deduped by (source, channel, pad) —
            // sibling variant overlays (uno_r4 minima/wifi) repeat entries.
            const seen = new Set(facts.connectorAdc.map((r) => `${r.source}:${r.channel}:${r.controller}.${r.pin}`));
            const extra = overlayConnectorAdc(dir, files, facts.connectors)
              .filter((r) => !seen.has(`${r.source}:${r.channel}:${r.controller}.${r.pin}`));
            facts = { ...facts, connectorAdc: [...facts.connectorAdc, ...extra] };
          }
          const { record, hasFacts } = composeRecord(base, facts, zephyrBase, westRoot);
          if (hasFacts) withFacts++;
          records.push(record);
        } catch (err) {
          failures++;
          if (failures <= 5) console.error(`reader failed on ${t.identifier}: ${(err as Error).message}`);
          records.push(base);
        }
      }
    }
  }

  const coverage = {
    adc: {} as Record<string, number>,
    pwm: {} as Record<string, number>,
    dac: {} as Record<string, number>,
  };
  for (const r of records) {
    for (const cap of ['adc', 'pwm', 'dac'] as const) {
      const src = r.siliconSources?.[cap];
      if (src) coverage[cap][src] = (coverage[cap][src] ?? 0) + 1;
    }
  }
  return {
    boards: Object.fromEntries(records.map((r) => [r.identifier, r])),
    provenance: {
      zephyrBase: path.resolve(zephyrBase),
      version: zephyrVersionOf(zephyrBase),
      ...(gitHeadOf(zephyrBase) ? { gitHead: gitHeadOf(zephyrBase) } : {}),
      boardsMtimeMs: fs.statSync(boardsRoot).mtimeMs,
      generatedAt: new Date().toISOString(),
      variants: records.length,
    },
    stats: { variants, withFacts, failures, droppedYamls, coverage },
  };
}

// ---------------------------------------------------------------------------
// SoC-level facts from the installed tree — contract/custom-board support.
// A custom PCB has no Zephyr board record, but its SoC's dtsi lives in the
// installed tree and declares the soc's bus controllers (i2c0, usart1, ...).
// ---------------------------------------------------------------------------

/** Bus controller labels declared by the SoC's dtsi files in the installed
 *  tree, classified by family. Best-effort: matches dts/dtsi files whose
 *  name contains the soc name (a soc stem like 'stm32f411' matches
 *  'stm32f411xe.dtsi'), plus same-dir includes. */
export function socBusLabelsFromTree(zephyrBase: string, soc: string): {
  i2c: string[];
  spi: string[];
  uart: string[];
} {
  const buses: { i2c: string[]; spi: string[]; uart: string[] } = { i2c: [], spi: [], uart: [] };
  const dtsRoot = path.join(zephyrBase, 'dts');
  if (!fs.existsSync(dtsRoot)) return buses;
  const socLower = soc.toLowerCase();
  // Family-prefix stems: a soc's buses often live in a SHARED family dtsi
  // (stm32f411xe → stm32f4.dtsi declares usart1/i2c1), so match progressively
  // shorter prefixes of the soc name, down to 5 chars.
  const stems = new Set<string>();
  for (let len = socLower.length; len >= 5; len--) stems.add(socLower.slice(0, len));
  // Weight = filename length: a shared family dtsi (stm32f4.dtsi) is
  // shorter than per-variant extras (stm32f410.dtsi adds lpuart1), so base
  // buses sort before variant extras. Then declaration order within a file
  // — UART0 lands on usart1 (the STM32 console mux), not whatever
  // alphabetical order picks.
  type Labeled = { label: string; weight: number; order: number };
  const labeled: { i2c: Labeled[]; spi: Labeled[]; uart: Labeled[] } = { i2c: [], spi: [], uart: [] };
  let order = 0;
  const seenFiles = new Set<string>();
  const scan = (dir: string, depth: number): void => {
    if (depth > 4) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { scan(full, depth + 1); continue; }
      if (!/\.dtsi?$/.test(entry.name)) continue;
      const nameLower = entry.name.toLowerCase();
      const matches = [...stems].some((s) => nameLower.includes(s));
      if (!matches || seenFiles.has(full)) continue;
      seenFiles.add(full);
      const weight = nameLower.length;
      let text: string;
      try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      const grab = (re: RegExp, family: 'i2c' | 'spi' | 'uart'): void => {
        for (const m of text.matchAll(re)) {
          if (!m[1]) continue;
          labeled[family].push({ label: m[1], weight, order: order++ });
        }
      };
      grab(/([a-z0-9_]+):\s*(?:i2c|twi)@/g, 'i2c');
      grab(/([a-z0-9_]+):\s*(?:spi|ssp)@/g, 'spi');
      // 'serial@' — STM32 names its usart nodes serial@<addr>.
      grab(/([a-z0-9_]+):\s*(?:uart|usart|eusart|serial)@/g, 'uart');
    }
  };
  scan(dtsRoot, 0);
  // Drop flash-controller aliases (octospi/xspi/quadspi/subghzspi are
  // XIP/flash buses, not user SPI) and the usb-serial console pseudo-node.
  const notFlash = (label: string): boolean => !/^(octospi|xspi|quadspi|subghzspi)/.test(label);
  const notUsbSerial = (label: string): boolean => label !== 'usb_serial';
  const finalize = (family: 'i2c' | 'spi' | 'uart'): string[] => {
    const seen = new Set<string>();
    return labeled[family]
      .filter((e) => notFlash(e.label) && notUsbSerial(e.label))
      .sort((a, b) => (a.weight - b.weight) || (a.order - b.order))
      .filter((e) => (seen.has(e.label) ? false : (seen.add(e.label), true)))
      .map((e) => e.label);
  };
  buses.i2c = finalize('i2c');
  buses.spi = finalize('spi');
  buses.uart = finalize('uart');
  return buses;
}
