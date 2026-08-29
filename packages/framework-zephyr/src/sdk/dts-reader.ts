// ---------------------------------------------------------------------------
// dts-reader.ts — tolerant Zephyr board-devicetree reader
//
// Extracts the BOARD-LEVEL facts the generated board module needs from a
// board's own DTS files: aliases, the chosen console, gpio-leds / gpio-keys
// children (LED/BUTTON devicetree specs), and connector nexus gpio-maps
// (arduino-header-r3, seeed,xiao-gpio). Silicon facts (ADC channel maps, PWM
// channel counts) are NOT here — they never live in devicetree; they are the
// curated soc descriptors in ../chips/soc/.
//
// DELIBERATELY NOT a devicetree compiler. The reader follows only the
// board's LOCAL include chain (relative *.dtsi and in-tree <...> includes it
// can resolve), and treats C macros it cannot expand as opaque flag tokens
// (`GPIO_ACTIVE_LOW` stays the literal text). It does not resolve phandles
// beyond &label capture, does not evaluate expressions, and ignores every
// property it has no consumer for. Boards whose interesting nodes live in
// deeper SoC includes simply yield fewer facts — the generator's tiering
// handles that honestly.
//
// Used by scripts/gen-zephyr-board-data.mjs at repo-build time against the
// pinned Zephyr tree; never runs in user builds.
// ----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

/** A GPIO reference inside the devicetree: controller nodelabel + pin + flags. */
export interface DtsGpioRef {
  /** Controller nodelabel, e.g. 'gpioa', 'gpio0'. */
  readonly controller: string;
  /** Pin number within the controller. */
  readonly pin: number;
  /** Raw flag tokens as written (macros stay opaque): ['GPIO_ACTIVE_LOW', 'GPIO_PULL_UP']. */
  readonly flags: readonly string[];
}

/** A gpio-leds / gpio-keys child with its devicetree alias when aliased. */
export interface DtsGpioNode extends DtsGpioRef {
  /** Node's own nodelabel, e.g. 'user_led', 'button0'. */
  readonly nodelabel: string;
  /** Devicetree alias pointing here, e.g. 'led0', 'sw0' (from the aliases node). */
  readonly alias?: string;
}

/** A connector nexus (e.g. the XIAO's D0–D10 gpio-map). */
export interface DtsConnector {
  /** Connector nodelabel, e.g. 'xiao_d', 'arduino_header_d'. */
  readonly nodelabel: string;
  /** Compatible string, e.g. 'seeed,xiao-gpio', 'arduino-header-r3'. */
  readonly compatible?: string;
  /** Silkscreen-ish label (from the map's trailing comments) → ref. */
  readonly pins: Readonly<Record<string, DtsGpioRef>>;
}

/** Everything the reader could extract from one board DTS (post local includes). */
export interface DtsBoardFacts {
  /** alias name → nodelabel ('led0' → 'user_led', 'sw0' → 'button0'). */
  readonly aliases: Readonly<Record<string, string>>;
  /** chosen property → nodelabel ('zephyr,console' → 'uart0'). */
  readonly chosen: Readonly<Record<string, string>>;
  /** gpio-leds children. */
  readonly leds: readonly DtsGpioNode[];
  /** gpio-keys children. */
  readonly buttons: readonly DtsGpioNode[];
  /** Connector nexus maps. */
  readonly connectors: readonly DtsConnector[];
  /** Addressable user LED (worldsemi,ws2812-*): the pad driving the pixel.
   *  NOT a gpio-leds node — consumers must treat it as a plain GPIO LED
   *  (no led0 devicetree spec), same as a curated board override. */
  readonly stripLed?: DtsGpioRef;
  /** PWM-driven LEDs (pwm-leds children), in board order. `alias` is the
   *  devicetree alias ('pwm-led0') — the addressable form; non-aliased
   *  channels carry their controller+channel only. */
  readonly pwmLeds: readonly DtsPwmLed[];
  /** The board's USB device wiring: 'enabled' when the DTS turns the device
   *  controller on (zephyr_udc0/&usbd status okay), 'disabled' when it
   *  explicitly turns it off, undefined when the DTS is silent (the app
   *  overlay may still compose a CDC device). */
  readonly usbDevice?: 'enabled' | 'disabled';
}

/** A pwm-leds child: one PWM-driven LED channel. */
export interface DtsPwmLed {
  /** Devicetree alias ('pwm-led0') when aliased — the DT_ALIAS addressing form. */
  readonly alias?: string;
  /** PWM controller nodelabel ('pwm1'). */
  readonly controller: string;
  readonly channel: number;
  /** Period cell from the pwms property, when present. */
  readonly periodNs?: number;
  /** Flag tokens (PWM_POLARITY_INVERTED, …). Macro expressions like
   *  PWM_MSEC(20) are period shorthand — never flags. */
  readonly flags?: readonly string[];
}

// ── include resolution ─────────────────────────────────────────────────────

interface IncludeRoots {
  /** Extra roots for resolving <...> includes (e.g. the zephyr tree's boards/). */
  readonly angle: readonly string[];
}

function resolveInclude(spec: string, fromFile: string, roots: IncludeRoots): string | undefined {
  // Strip the wrapper: <...> or "..."
  const inner = spec.slice(1, -1);
  // Quoted includes are relative to the including file.
  if (!spec.startsWith('<')) {
    const p = path.resolve(path.dirname(fromFile), inner);
    return fs.existsSync(p) ? p : undefined;
  }
  // Board files use ../boards/common/... relative includes and bare filenames
  // resolved against the boards tree; try the file's own dir first, then the
  // configured angle roots.
  const local = path.resolve(path.dirname(fromFile), inner);
  if (fs.existsSync(local)) return local;
  for (const root of roots.angle) {
    const p = path.resolve(root, inner);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

/** Strip block/line comments, keeping one attachment channel for gpio-map labels. */
function stripCommentsKeepMarkers(src: string): string {
  // Replace comment bodies but KEEP a marker: /* D0 */ → ⟨D0⟩ inline, so the
  // gpio-map parser can pick silkscreen labels out of the cell stream.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => '⟨' + m.slice(2, -2).trim() + '⟩')
    .replace(/\/\/[^\n]*/g, '');
}

// ── node model ─────────────────────────────────────────────────────────────

interface DtsNode {
  labels: string[];
  name: string;
  /** Raw property text after '=' (unterminated tokens kept verbatim). */
  props: Map<string, string>;
  children: Map<string, DtsNode>;
  /** Trailing label marker (⟨D0⟩) captured on the most recent line — used
   *  only by the gpio-map parser via line context. */
  parent?: DtsNode;
}

function emptyNode(name: string, parent?: DtsNode): DtsNode {
  return { labels: [], name, props: new Map(), children: new Map(), parent };
}

/** Statement scanner: emits node headers (at every '{'), property
 *  statements ('a = <...>' at their owning depth), and node closes ('}')
 *  in source order, building the node tree with &label override merges. */
function parseStatements(src: string): { root: DtsNode; byLabel: Map<string, DtsNode> } {
  const root = emptyNode('/');
  const byLabel = new Map<string, DtsNode>();
  const stack: DtsNode[] = [root];
  let depth = 0;
  let start = 0;

  const emit = (kind: 'hdr' | 'prop' | 'end', text: string) => {
    if (kind === 'end') {
      if (stack.length > 1) stack.pop();
      return;
    }
    const t = text.trim().replace(/^[\r\n\t ]+/, '');
    if (!t) return;
    const top = stack[stack.length - 1];

    if (kind === 'hdr') {
      const refHeader = t.match(/^&([\w-]+)\s*\{?$/);
      if (refHeader) {
        let n = byLabel.get(refHeader[1]);
        if (!n) {
          n = emptyNode('&' + refHeader[1], top);
          byLabel.set(refHeader[1], n);
          // Attach to the synthetic tree so subtree walkers (connectors,
          // gpio nodes, led strips, bus pinctrl) see &ref blocks — the SoC
          // dtsi that parents them is not part of the local include chain.
          top.children.set(n.name, n);
        }
        stack.push(n);
        return;
      }
      // Header text may carry trailing debris from prior statements (the
      // scanner slices from after the previous ';'/'}'), so isolate the LAST
      // node-header line: [label:] name[@unit]
      const headerLine = t.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean).pop() ?? t;
      const parts = headerLine.split(':').map((s) => s.trim()).filter(Boolean);
      const name = parts.length > 0 ? parts[parts.length - 1] : 'anon';
      const labels = parts.slice(0, -1);
      let node = top.children.get(name);
      if (!node) {
        node = emptyNode(name, top);
        top.children.set(name, node);
      }
      for (const l of labels) {
        if (!node.labels.includes(l)) node.labels.push(l);
        byLabel.set(l, node);
      }
      stack.push(node);
      return;
    }

    // property
    const prop = t.match(/^([\w,#@-]+)\s*=\s*([\s\S]*?)\s*;?$/);
    if (prop && top !== root) {
      top.props.set(prop[1], prop[2].replace(/;$/, ''));
      return;
    }
    const bare = t.match(/^([\w,#@-]+)\s*;?$/);
    if (bare && top !== root) top.props.set(bare[1], '');
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') {
      const stmt = src.slice(start, i);
      emit('hdr', stmt);
      depth++;
      start = i + 1;
    } else if (ch === '}') {
      const inner = src.slice(start, i).trim();
      if (inner) emit('prop', inner);
      emit('end', '');
      if (depth > 0) depth--;
      start = i + 1;
    } else if (ch === ';') {
      const stmt = src.slice(start, i);
      if (depth > 0) emit('prop', stmt);
      start = i + 1;
    }
    i++;
  }
  return { root, byLabel };
}

// ── cell parsing ───────────────────────────────────────────────────────────

/** Parse a property value like `<&gpioa 5 GPIO_ACTIVE_LOW>` into tokens. */
function parseCells(value: string): string[] {
  return value
    // Angle-bracket cell wrappers are punctuation, not content.
    .replace(/[<>]/g, ' ')
    // Comment markers may carry multi-word labels ('D14 / A0') — shield
    // their internal whitespace from the split, restore after.
    .replace(/⟨[^⟩]*⟩/g, (m) => ' ' + m.replace(/\s+/g, '\x1f') + ' ')
    .split(/[\s,]+/)
    .map((s) => s.trim().replace(/\x1f/g, ' '))
    .filter(Boolean);
}

/** A gpio-map entry: child specifier + pad + (&ctrl pin flags…). */
interface GpioMapEntry {
  childSpecifier: number;
  label?: string;
  /** Additional silkscreen names from the same comment (e.g. 'D14 / A0'
   *  carries both the digital and the analog name for the pad). */
  altLabels?: string[];
  ref: DtsGpioRef;
}

function parseGpioMap(value: string, parentCells: number): GpioMapEntry[] {
  const toks = parseCells(value);
  const entries: GpioMapEntry[] = [];
  let i = 0;
  let pendingLabel: string | undefined;
  const splitNames = (raw: string): string[] =>
    raw.split('/').map((s) => s.trim()).filter((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s));
  while (i < toks.length) {
    // Sweep up any ⟨label⟩ markers preceding the numeric entry.
    while (i < toks.length && toks[i].startsWith('⟨')) {
      const inner = toks[i].slice(1, -1).trim();
      if (inner) pendingLabel = inner;
      i++;
    }
    const spec = toks[i];
    if (spec === undefined) break;
    let childSpec = Number(spec);
    // Macro child specifiers (the nano header's ARDUINO_NANO_HEADER_D14):
    // the numeric suffix is the specifier, the alphabetic suffix carries the
    // silkscreen name when no comment label exists.
    let macroLabel: string | undefined;
    if (!Number.isFinite(childSpec)) {
      // Multi-word macros (ARDUINO_NANO_HEADER_D14): the LAST underscore
      // splits the prefix from the <letters><digits> silkscreen suffix.
      const m = spec.match(/^([A-Za-z][A-Za-z0-9_]*)_([A-Za-z]+)(\d+)$/);
      if (m) {
        childSpec = Number(m[3]);
        macroLabel = `${m[2]}${m[3]}`;
      } else {
        i++;
        continue;
      }
    }
    // child-spec, pad, then &ctrl
    const ctrl = toks[i + 2];
    if (ctrl === undefined || !ctrl.startsWith('&')) { i++; continue; }
    const pin = Number(toks[i + 3]);
    // Macro/expression pins (RTIO routing etc.) cannot be placed on the HAL
    // pin map — skip the entry, keep scanning.
    if (!Number.isFinite(pin)) { i++; continue; }
    const flags: string[] = [];
    for (let f = i + 4; f < i + 3 + parentCells + 1 && f < toks.length; f++) {
      const t = toks[f];
      if (t.startsWith('&') || Number.isFinite(Number(t))) break;
      if (!t.startsWith('⟨')) flags.push(t);
    }
    // A comment can name one pad twice ('D14 / A0' — the digital and analog
    // silkscreen of the same pad): first name is the primary label, the rest
    // ride as altLabels.
    const names = pendingLabel ? splitNames(pendingLabel) : [];
    const label = names[0] ?? macroLabel;
    const altLabels = names.slice(1);
    entries.push({
      childSpecifier: childSpec,
      ...(label ? { label } : {}),
      ...(altLabels.length > 0 ? { altLabels } : {}),
      ref: { controller: ctrl.slice(1), pin, flags },
    });
    pendingLabel = undefined;
    // advance: spec + pad + &ctrl + parentCells numbers
    i = i + 3 + parentCells;
    // sweep trailing markers before the next entry
    while (i < toks.length && toks[i].startsWith('⟨')) {
      const inner = toks[i].slice(1, -1).trim();
      if (inner && entries.length > 0) {
        const trailing = splitNames(inner);
        const last = entries[entries.length - 1];
        if (trailing.length > 0 && !last.label) last.label = trailing[0];
        if (trailing.length > 1) last.altLabels = [...(last.altLabels ?? []), ...trailing.slice(1)];
      }
      i++;
    }
  }
  return entries;
}

// ── board facts extraction ─────────────────────────────────────────────────

function gpioRefFromProp(value: string): DtsGpioRef | undefined {
  const toks = parseCells(value);
  // Expect: &ctrl pin [flags...]
  if (toks.length < 2 || !toks[0].startsWith('&')) return undefined;
  const pin = Number(toks[1]);
  if (!Number.isFinite(pin)) return undefined;
  // Normalize flag tokens: strip grouping parens, drop '|' separators.
  const flags = toks
    .slice(2)
    .filter((t) => !t.startsWith('⟨') && t !== '|')
    .map((t) => t.replace(/[()]/g, ''))
    .filter(Boolean);
  return { controller: toks[0].slice(1), pin, flags };
}

/**
 * Read one board DTS file (following its local include chain) and extract
 * the board-level facts. `zephyrBoardsRoot` (e.g. <zephyr>/boards) resolves
 * `<../boards/common/...>` style includes.
 */
export function readBoardDts(
  dtsPath: string,
  opts: { zephyrBoardsRoot?: string } = {},
): DtsBoardFacts {
  const roots: IncludeRoots = { angle: opts.zephyrBoardsRoot ? [opts.zephyrBoardsRoot] : [] };
  const seen = new Set<string>();
  let text = '';

  const absorb = (file: string) => {
    const real = path.resolve(file);
    if (seen.has(real)) return;
    seen.add(real);
    const src = fs.readFileSync(real, 'utf8');
    // Expand includes textualy (depth bounded by `seen`).
    const includeRe = /#include\s+([<"][^>"]+[>"])/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let out = '';
    while ((m = includeRe.exec(src))) {
      out += src.slice(last, m.index);
      const resolved = resolveInclude(m[1], real, roots);
      if (resolved) absorb(resolved);
      last = includeRe.lastIndex;
    }
    out += src.slice(last);
    text += out + '\n';
  };
  absorb(dtsPath);

  const { root: syntheticRoot, byLabel } = parseStatements(stripCommentsKeepMarkers(text));

  // The DTS root ('/ { ... }') is a child of the synthetic outer node —
  // resolve it so board-level nodes (aliases/chosen/leds/gpio_keys/&) sit at
  // the depth the extractors expect.
  const root = syntheticRoot.children.get('/') ?? syntheticRoot;

  // aliases {} and chosen {} — phandle-ref properties
  const aliases: Record<string, string> = {};
  const chosen: Record<string, string> = {};
  for (const name of ['aliases', 'chosen']) {
    const node = root.children.get(name);
    if (!node) continue;
    for (const [k, v] of node.props) {
      const ref = v.match(/^&([\w,-]+)$/);
      if (ref) {
        if (name === 'aliases') aliases[k] = ref[1];
        else chosen[k] = ref[1];
      }
    }
  }

  // gpio-leds / gpio-keys children (match on compatible OR node name)
  const leds: DtsGpioNode[] = [];
  const buttons: DtsGpioNode[] = [];
  const collectGpioNodes = (node: DtsNode) => {
    const compat = node.props.get('compatible') ?? '';
    const isLeds = compat.includes('gpio-leds');
    const isKeys = compat.includes('gpio-keys');
    if (isLeds || isKeys) {
      // A label can be aliased several times (led0 + mcuboot-led0); collect
      // ALL aliases per label, then prefer the canonical led<N>/sw<N> form.
      const aliasesByLabel = new Map<string, string[]>();
      for (const [alias, label] of Object.entries(aliases)) {
        const list = aliasesByLabel.get(label) ?? [];
        list.push(alias);
        aliasesByLabel.set(label, list);
      }
      for (const child of node.children.values()) {
        const ref = gpioRefFromProp(child.props.get('gpios') ?? '');
        if (!ref) continue;
        const nodelabel = child.labels[0] ?? child.name;
        const aliasCandidates = child.labels.flatMap((l) => aliasesByLabel.get(l) ?? []);
        const alias = aliasCandidates.find((a) => /^(led|sw|button)[0-9]*$/.test(a)) ?? aliasCandidates[0];
        const entry: DtsGpioNode = {
          ...ref,
          nodelabel,
          alias,
        };
        (isLeds ? leds : buttons).push(entry);
      }
      return; // do not recurse into a leds/keys container
    }
    for (const child of node.children.values()) collectGpioNodes(child);
  };
  collectGpioNodes(root);

  // Connector nexus nodes: any node with a gpio-map property
  const connectors: DtsConnector[] = [];
  const findConnectors = (node: DtsNode) => {
    const map = node.props.get('gpio-map');
    if (map) {
      const cells = Number(node.props.get('#gpio-cells')?.replace(/[<>]/g, '') ?? '2');
      const parentCells = Number.isFinite(cells) && cells > 0 ? cells : 2;
      const entries = parseGpioMap(map, parentCells);
      // The LAST entry's trailing /* label */ comment can land after the
      // property's terminating ';' — its marker never enters the value. When
      // labeled siblings share a prefix+number pattern (D0…D9), extend it to
      // the unlabeled tail entry (D10) instead of falling back to p<N>.
      const labeled = entries.filter((e) => e.label);
      const pattern = labeled.length >= 2
        ? (() => {
            const m = labeled[0].label!.match(/^([A-Za-z]+)([0-9]+)$/);
            if (!m) return undefined;
            const prefix = m[1];
            const consistent = labeled.every((e) =>
              e.label!.startsWith(prefix) && Number(e.label!.slice(prefix.length)) === e.childSpecifier);
            return consistent ? prefix : undefined;
          })()
        : undefined;
      const pins: Record<string, DtsGpioRef> = {};
      for (const e of entries) {
        const label = e.label ?? (pattern ? `${pattern}${e.childSpecifier}` : `p${e.childSpecifier}`);
        pins[label] = e.ref;
        for (const alt of e.altLabels ?? []) pins[alt] = e.ref;
      }
      // Complete the analog run when the FINAL entry's comment lands after
      // the property's ';' (its marker never enters the value): the header's
      // D/A pairing increments in lockstep (D14/A0 … D21/A7), so a consistent
      // D−A offset observed on the captured entries extends to the tail.
      const observed = entries.filter((e) => {
        const d = e.label?.match(/^D(\d+)$/);
        return d && e.altLabels?.some((a) => /^A\d+$/.test(a));
      });
      if (observed.length >= 2) {
        const offsetOf = (e: (typeof observed)[number]) =>
          Number(e.label!.slice(1)) - Number(e.altLabels!.find((a) => /^A\d+$/.test(a))!.slice(1));
        const offset = offsetOf(observed[0]);
        if (observed.every((e) => offsetOf(e) === offset)) {
          for (const e of entries) {
            const d = e.label?.match(/^D(\d+)$/);
            if (!d || e.altLabels?.some((a) => /^A\d+$/.test(a))) continue;
            // Only positive A indices within the observed run — D0…D13 sit
            // below the analog block (offset would go negative).
            const aIdx = Number(d[1]) - offset;
            if (aIdx < 0) continue;
            if (!pins[`A${aIdx}`]) pins[`A${aIdx}`] = e.ref;
          }
        }
      }
      connectors.push({
        nodelabel: node.labels[0] ?? node.name,
        compatible: (node.props.get('compatible') ?? '').replace(/"/g, '') || undefined,
        pins,
      });
    }
    for (const child of node.children.values()) findConnectors(child);
  };
  findConnectors(root);

  // Addressable user LED (worldsemi,ws2812-*). Three wiring forms in the
  // tree: the RP2040 PIO variant nests a plain `gpios = <&ctrl pin …>` node;
  // the SPI/I2S variants sit on a bus whose pinctrl names the data pad in
  // the macro itself (SPIM3_MOSI_GPIO33, I2S0_O_SD_GPIO48 — the OUTPUT SD
  // is the data line; I_SD is capture, wrong direction). Walks the
  // SYNTHETIC root: the strips ride &ref blocks (siblings of the board's
  // `/ {}` node), which the resolved root's walkers never see.
  const stripLed = findStripLed(syntheticRoot, byLabel);

  // PWM-driven LEDs (pwm-leds children): `pwms = <&pwmN channel [period]
  // [flags]>`. Only aliased children are addressable by the PWM lowering
  // (DT_ALIAS(pwm_led0)); carry the alias through.
  const reverseAlias = new Map<string, string>();
  for (const [name, label] of Object.entries(aliases)) reverseAlias.set(label, name);
  const pwmLeds: DtsPwmLed[] = [];
  for (const ledsNode of root.children.values()) {
    if ((ledsNode.props.get('compatible') ?? '').replace(/"/g, '') !== 'pwm-leds') continue;
    for (const child of ledsNode.children.values()) {
      const pwms = child.props.get('pwms');
      if (!pwms) continue;
      const toks = parseCells(pwms);
      if (toks.length < 2 || !toks[0].startsWith('&')) continue;
      const channel = Number(toks[1]);
      if (!Number.isFinite(channel)) continue;
      const period = Number(toks[2]);
      const flags: string[] = toks.slice(Number.isFinite(period) ? 3 : 2)
        .filter((t) => !t.startsWith('⟨') && !Number.isFinite(Number(t)) && !/[()]/.test(t));
      const led: DtsPwmLed = {
        controller: toks[0].slice(1),
        channel,
        ...(Number.isFinite(period) ? { periodNs: period } : {}),
        ...(flags.length > 0 ? { flags } : {}),
        ...(child.labels[0] && reverseAlias.has(child.labels[0]) ? { alias: reverseAlias.get(child.labels[0]) } : {}),
      };
      pwmLeds.push(led);
    }
  }

  // USB device wiring: the board's &usbd / zephyr_udc0 node status. The
  // label form (`zephyr_udc0: &usbd { … }`) attaches under both names.
  let usbDevice: 'enabled' | 'disabled' | undefined;
  for (const key of ['usbd', 'zephyr_udc0']) {
    const n = byLabel.get(key);
    if (!n) continue;
    const status = n.props.get('status');
    if (status === '"okay"') usbDevice = 'enabled';
    else if (status === '"disabled"' && usbDevice === undefined) usbDevice = 'disabled';
  }

  void byLabel; // (labels already captured during parse)
  return { aliases, chosen, leds, buttons, connectors, pwmLeds, ...(stripLed ? { stripLed } : {}), ...(usbDevice ? { usbDevice } : {}) };
}

/** First `gpios` property in a subtree (the PIO strip nests it one level down). */
function gpiosInSubtree(node: DtsNode): DtsGpioRef | undefined {
  const own = node.props.get('gpios');
  if (own) {
    const ref = gpioRefFromProp(own);
    if (ref) return ref;
  }
  for (const child of node.children.values()) {
    const ref = gpiosInSubtree(child);
    if (ref) return ref;
  }
  return undefined;
}

/** All pinmux property text in a pinctrl group subtree. */
function pinmuxTextIn(node: DtsNode, out: string[] = []): string[] {
  const pm = node.props.get('pinmux');
  if (pm) out.push(pm);
  for (const child of node.children.values()) pinmuxTextIn(child, out);
  return out;
}

function findStripLed(root: DtsNode, byLabel: Map<string, DtsNode>): DtsGpioRef | undefined {
  let found: DtsGpioRef | undefined;
  const walk = (node: DtsNode) => {
    const compat = node.props.get('compatible') ?? '';
    if (compat.includes('worldsemi,ws2812') && !found) {
      found = stripRefOf(node, byLabel);
    }
    for (const child of node.children.values()) walk(child);
  };
  walk(root);
  return found;
}

function stripRefOf(node: DtsNode, byLabel: Map<string, DtsNode>): DtsGpioRef | undefined {
  // PIO form: a descendant carries the pad as a plain gpio ref.
  const direct = gpiosInSubtree(node);
  if (direct) return direct;
  // SPI/I2S forms: the enclosing bus's default pinctrl group names the
  // data pad in its pinmux macro. Every ws2812-spi/i2s board in the tree is
  // ESP32-family, whose controllers are the 32-pin gpio0/gpio1 pair.
  const bus = node.parent;
  const pcLabel = bus?.props.get('pinctrl-0')?.match(/&([\w-]+)/)?.[1];
  const pinctrl = pcLabel ? byLabel.get(pcLabel) : undefined;
  if (!pinctrl) return undefined;
  const text = pinmuxTextIn(pinctrl).join(' ');
  const m = text.match(/MOSI_GPIO(\d+)|I2S\d*_O_SD_GPIO(\d+)/);
  const global = m ? Number(m[1] ?? m[2]) : undefined;
  if (global == null) return undefined;
  return global < 32
    ? { controller: 'gpio0', pin: global, flags: [] }
    : { controller: 'gpio1', pin: global - 32, flags: [] };
}
