// ---------------------------------------------------------------------------
// dts-reader.ts — tolerant Zephyr board-devicetree reader
//
// Extracts the BOARD-LEVEL facts the generated board module needs from a
// board's own DTS files: aliases, the chosen console, gpio-leds / gpio-keys
// children (LED/BUTTON devicetree specs), connector nexus gpio-maps
// (arduino-header-r3, seeed,xiao-gpio), buses, USB wiring, watchdog,
// flash/storage and counters. Silicon pinctrl routes (STM32 tim/adc/dac
// *-pinctrl.dtsi) are harvested here in RAW form — the manifest generator
// maps them to global pins and carries the family conventions for SoCs whose
// silicon data is not in devicetree (ESP32 C headers, nRF SAADC AIN tables).
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
// Used by the catalog walker: `typecad-hal board sync` at user-sync time
// against the installed Zephyr tree (and by the fixture-tree walker tests).
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
  /** Wired analog channels from connector io-channel-maps, joined to pads
   *  through the connectors' gpio-maps (the DKs' A0-A5 ↔ AIN wiring). */
  readonly connectorAdc: readonly { source: string; channel: number; controller: string; pin: number }[];
  /** Name↔pinmux-value disagreement warnings from the pinctrl harvest —
   *  each names a route that was DROPPED as untrustworthy. Surfaced through
   *  the catalog record so board-module generation can report them. */
  readonly pinctrlWarnings?: readonly string[];
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
  /** The USB device controller nodelabel backing usbDevice ('zephyr_udc0',
   *  or the board's own label for &usbd). */
  readonly usbController?: string;
  /** Bus controller nodelabels the board DTS wires up (&i2c0/&spi2/&usart1
   *  status-okay overrides; &ref blocks). Board-level facts only — a bus
   *  enabled solely in the SoC dtsi is invisible here, by design. */
  readonly buses: {
    readonly i2c: readonly string[];
    readonly spi: readonly string[];
    readonly uart: readonly string[];
  };
  /** Silicon PWM routes from the SoC pinctrl files the board's include
   *  chain reaches (STM32 vendor HAL ships per-soc *-pinctrl.dtsi with
   *  `tim4_ch1_pb6`-style nodes). Empty for SoCs whose pinctrl data lives
   *  elsewhere (Atmel C headers) or whose PWM is a matrix (ESP32 LEDC) —
   *  those are family conventions in the manifest generator. */
  readonly pwmPins: readonly DtsPwmPin[];
  /** Silicon analog-input routes from the SoC pinctrl files (STM32
   *  `adc1_in1_pa1`-style nodes). Same raw-harvest contract as pwmPins. */
  readonly adcPins: readonly DtsAdcPin[];
  /** Silicon analog-output routes from the SoC pinctrl files (STM32
   *  `dac1_out1_pa4`-style nodes). Same raw-harvest contract as pwmPins. */
  readonly dacPins: readonly DtsDacPin[];
  /** SoC-level ADC/DAC device nodelabels found in the include chain
   *  (adc1:/dac1: device nodes). Pinctrl routes whose source device is
   *  absent here are dropped by the manifest generator — a route for an
   *  undeclared device would emit DEVICE_DT_GET against nothing. */
  readonly analogDevices: readonly string[];
  /** SoC-level watchdog node reached through the include chain (compatible
   *  `*-watchdog`), for boards whose own DTS writes no watchdog0 alias —
   *  the hardware exists on nearly every SoC; the alias is authorial habit.
   *  Board-level watchdog0 alias wins over this. */
  readonly wdtSocNode?: string;
  /** ESP32 LEDC matrix controller nodelabel ('ledc0'), when the include
   *  chain declares one. */
  readonly ledcNode?: string;
  /** Labeled PWM controller device nodes in the include chain (nRF's
   *  psel-routed `pwm0`..`pwm3` — any GPIO pad can carry any of a
   *  peripheral's channels: the matrix the manifest generator synthesizes
   *  from, like the ESP32 LEDC). Sorted. */
  readonly pwmNodes?: readonly string[];
  /** Flash size in KB (the largest flash@ reg DT_SIZE_K across the include
   *  chain — the variant dtsi overrides the SoC default). Feeds the storage
   *  partition synthesis. */
  readonly flashKb?: number;
  /** True when the board's own chain already defines a storage_partition
   *  label — synthesis must not redeclare it (west errors on a doubly
   *  defined node). */
  readonly hasStoragePartition?: boolean;
  /** The board's own storage_partition reg, when the chain defines one —
   *  offset/size in bytes. Boards that ship the partition (ESP32 AMP layout)
   *  carry their real facts instead of a synthesized region; the overlay
   *  only writes the /chosen pointer for them, never a redeclaration. */
  readonly storageReg?: { offsetBytes: number; sizeBytes: number };
  /** Counter-capable devices reached through the include chain, in source
   *  order. Two forms: a labeled node whose compatible IS a counter
   *  (nRF `rtc1:` nordic,nrf-rtc; STM32 `rtc:` st,stm32-rtc — the counter
   *  driver binds the node itself), or an unlabeled `counter {}` child
   *  under a labeled timer parent (ESP32 timer0-2, Ambiq) — the manifest
   *  generator assigns those labels in the generated overlay. */
  readonly counterNodes: readonly DtsCounterNode[];
  /** GPIO controller device nodes (gpio-controller property) from the SoC
   *  dtsi include chain — the full port inventory, not just the ports the
   *  board's own facts name. Sorted by nodelabel. */
  readonly gpioControllers: readonly DtsGpioController[];
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

/** A silicon PWM route harvested from an SoC pinctrl file: a timer channel
 *  reachable on a specific pad, e.g. STM32 `tim4_ch1_pb6` (TIM4 CH1 on PB6).
 *  RAW — ports/bits as the pinctrl file states them; the board manifest
 *  generator maps them to global pin numbers using its derived controller
 *  table and applies the family's nodelabel conventions (tim4 → pwm4). */
export interface DtsPwmPin {
  /** Pinctrl-source peripheral name, e.g. 'tim4'. */
  readonly source: string;
  /** Channel number within the peripheral. */
  readonly channel: number;
  /** GPIO port letter as written ('A', 'B', …). */
  readonly port: string;
  /** Pad bit within the port. */
  readonly bit: number;
  /** The pinctrl node's own name — the token the generated overlay composes
   *  `pinctrl-0 = <&name>` references from ('tim4_ch1_pb6'). */
  readonly pinctrl: string;
}

/** A silicon analog-input route harvested from an SoC pinctrl file, e.g.
 *  STM32 `adc1_in1_pa1` (ADC1 channel 1 on PA1). RAW, like DtsPwmPin. */
export interface DtsAdcPin {
  /** ADC controller name as written, e.g. 'adc1'. */
  readonly source: string;
  /** Input channel number. */
  readonly channel: number;
  readonly port: string;
  readonly bit: number;
  readonly pinctrl: string;
}

/** A silicon analog-OUTPUT route harvested from an SoC pinctrl file, e.g.
 *  STM32 `dac1_out1_pa4` (DAC1 channel 1 on PA4). RAW, like DtsPwmPin. */
export interface DtsDacPin {
  /** DAC controller name as written, e.g. 'dac1' — the DT nodelabel on
   *  STM32 (dac1: dac@40007400), so it maps straight to the device spec. */
  readonly source: string;
  /** Output channel number. */
  readonly channel: number;
  readonly port: string;
  readonly bit: number;
  readonly pinctrl: string;
}

/** A counter-capable device node from the include chain. */
export interface DtsCounterNode {
  /** The counter binding's compatible (e.g. 'nordic,nrf-rtc',
   *  'espressif,esp32-counter') — identifies the driver. */
  readonly compatible: string;
  /** Labeled-self form: the node's own nodelabel (nRF rtc1, STM32 rtc).
   *  Undefined in the child form. */
  readonly nodeLabel?: string;
  /** Child form: the labeled TIMER PARENT's nodelabel (ESP32 timer0) — the
   *  counter device is an unlabeled `counter {}` child; the overlay defines
   *  the label there. Undefined in the self form. */
  readonly parentLabel?: string;
}

/** A GPIO controller device node reached through the include chain (a node
 *  carrying the universal `gpio-controller` property). This is the SoC's
 *  FULL port inventory — the board's own facts only name the ports it
 *  happens to wire, so without this the pin sweep systematically
 *  under-reports a board's pads. `ngpios` carries the declared width when
 *  the dtsi states one (nRF, Atmel, …); families that omit it (STM32) rely
 *  on the derived port-width conventions. */
export interface DtsGpioController {
  readonly nodelabel: string;
  readonly ngpios?: number;
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
 *  in source order, building the node tree with &label override merges.
 *  `refOverrides` records every label an `&label { }` block targeted —
 *  with SoC dtsis absorbed, an override merges into the real labeled node
 *  instead of creating a synthetic '&label' one, so this set is the only
 *  way to tell "the board overrode this node" from "the SoC defines it". */
function parseStatements(src: string): { root: DtsNode; byLabel: Map<string, DtsNode>; refOverrides: Set<string> } {
  const root = emptyNode('/');
  const byLabel = new Map<string, DtsNode>();
  const refOverrides = new Set<string>();
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
        refOverrides.add(refHeader[1]);
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
    // Leading comment markers (a comment line above a property, inside the
    // same node — 96b_nitrogen's `/* gpio flags need validation */` before
    // button0's gpios) must not hide the property: the anchored match would
    // fail and the node would silently lose its facts. Strip them first;
    // markers INSIDE a value stay (gpio-map silkscreen labels).
    const stripped = t.replace(/^(?:⟨[^⟩]*⟩\s*)+/, '');
    const prop = stripped.match(/^([\w,#@-]+)\s*=\s*([\s\S]*?)\s*;?$/);
    if (prop && top !== root) {
      top.props.set(prop[1], prop[2].replace(/;$/, ''));
      return;
    }
    const bare = stripped.match(/^([\w,#@-]+)\s*;?$/);
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
  return { root, byLabel, refOverrides };
}

// ── cell parsing ───────────────────────────────────────────────────────────

/** Parse a property value like `<&gpioa 5 GPIO_ACTIVE_LOW>` into tokens. */
function parseCells(value: string): string[] {
  return value
    // Angle-bracket cell wrappers are punctuation, not content.
    .replace(/[<>]/g, ' ')
    // Comment markers may carry multi-word labels ('D14 / A0', 'Pin 1,
    // LEDK') — shield their internal whitespace AND commas from the split,
    // restoring each to its own character afterwards (collapsing a comma
    // to a space would hide it from the label splitter, and an unshielded
    // comma tore the marker apart mid-token — '⟨Pin 1' + 'LEDK⟩' — whose
    // truncated form minted garbage labels like 'Pin').
    .replace(/⟨[^⟩]*⟩/g, (m) => ' ' + m.replace(/,/g, '\x1f').replace(/\s+/g, '\x1e') + ' ')
    .split(/[\s,]+/)
    .map((s) => s.trim().replace(/\x1f/g, ',').replace(/\x1e/g, ' '))
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
    // '/' separates co-names of one pad ('D14 / A0'); ',' separates a pin
    // number from its net name ('Pin 1, LEDK' → 'LEDK'). Whitespace is NOT
    // a separator — 'Pin 1' must not collapse to 'Pin'.
    raw.split(/[\/,]/).map((s) => s.trim()).filter((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s));
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

// ── silicon pinctrl harvest ────────────────────────────────────────────────
// Per-family route grammars live in the PINCTRL_DIALECTS table below (each
// name/macro token encodes the complete route — source/channel/port/bit).
// The name↔value cross-check in lintNameValueAgreement covers each family's
// VALUE grammar (the pinmux macro's port/bit tuple).

// Labeled PWM controller device nodes (nRF `pwm0: pwm@4001c000` — any GPIO
// pad can carry any of a peripheral's four psel-routed channels, the matrix
// the manifest generator synthesizes from). ESP's ledc0 keeps its own
// LEDC_NODE_RE; STM32's pwm children are label-less and never match.
const PWM_NODE_RE = /(pwm\d+):\s*pwm@[0-9a-f]+\s*\{/g;

// ── NXP i.MX RT pinctrl dtsi (node-name shape, STM32's form) ───────────────
// `iomuxc_<pad>_adc1_in1: …` — the pad-to-GPIO join is in-band: every pad
// also declares `iomuxc_<pad>_gpio<port>_io<pin>`. FlexPWM routes the two
// subchannel outputs (`pwma`/`pwmb`, channel 0/1 of the DT child
// `flexpwm<N>_pwm<K>`); the complementary `pwmx` is skipped. This family is
// NOT in PINCTRL_DIALECTS — its routes resolve through a two-phase join.
//
// Two FlexPWM node-name conventions exist across the RT parts (both
// harvested): the classic rt10xx `…_flexpwm2_pwma3`, and the newer
// rt11xx/rt116x/rt118x `…_flexpwm1_pwm0_a` (pwm<K>_<a|b>, A→0/B→1; the `_x`
// complementary stays out, mirroring `pwmx`). The newer parts' ADC is the
// LPADC (`lpadc<N>`) — a different driver with a differential `ch<N>a|b`
// input-pair channel model — and stays OUT like the LPC55 lpadc, pending a
// dedicated channel-model gate.
const IMX_GPIO_JOIN_RE = /iomuxc_([a-z0-9_]+)_gpio(\d+)_io(\d+):/g;
const IMX_ADC_RE = /(iomuxc_[a-z0-9_]+_adc(\d+)_in(\d+)):\s*\w+\s*\{[^}]*?pinmux/g;
const IMX_PWM_RE = /(iomuxc_[a-z0-9_]+_flexpwm(\d+)_pwm([ab])(\d+)):\s*\w+\s*\{[^}]*?pinmux/g;
const IMX_PWM2_RE = /(iomuxc_[a-z0-9_]+_flexpwm(\d+)_pwm(\d+)_([ab])):\s*\w+\s*\{[^}]*?pinmux/g;

/** A self-contained pinctrl dialect: a route grammar whose name/macro token
 *  encodes the complete route (source/channel/port/bit) with no cross-node
 *  join. Adding a family = adding one entry here (the name↔value cross-check
 *  in lintNameValueAgreement covers the value grammar). The i.MX RT family is
 *  NOT in this table — its routes resolve through an in-band pad→GPIO join
 *  (handled separately below). */
interface PinctrlDialect {
  readonly kind: 'pwm' | 'adc' | 'dac';
  readonly re: RegExp;
  readonly token: (m: RegExpMatchArray) => string;
  readonly source: (m: RegExpMatchArray) => string;
  readonly channel: (m: RegExpMatchArray) => number;
  readonly port: (m: RegExpMatchArray) => string;
  readonly bit: (m: RegExpMatchArray) => number;
}

const PWM = 'pwm' as const;
const ADC = 'adc' as const;
const DAC = 'dac' as const;

/** The self-contained route grammars, one per family×function. */
const PINCTRL_DIALECTS: readonly PinctrlDialect[] = [
  // STM32 vendor-HAL pinctrl dtsi node shape (all SoC families):
  //   /omit-if-no-ref/ tim4_ch1_pb6: tim4_ch1_pb6 { pinmux = <STM32_PINMUX('B', 6, AF2)>; };
  // The node NAME is captured verbatim (the overlay reference); the pinmux
  // macro carries the authoritative port/bit for the cross-check. The F1
  // family (AFIO model) spells the macro STM32F1_PINMUX — covered by the
  // optional F<unit> in the value grammar.
  { kind: PWM, re: /\/omit-if-no-ref\/?\s+(tim(\d+)_ch(\d+)_p[a-z]\d+):\s*\w+\s*\{[^}]*?pinmux\s*=\s*<STM32(?:F\d+)?_PINMUX\('([A-Z])',\s*(\d+)/g, token: (m) => m[1]!, source: (m) => `tim${m[2]}`, channel: (m) => Number(m[3]), port: (m) => m[4]!, bit: (m) => Number(m[5]) },
  // STM32F1 (AFIO) PWM output — `tim1_ch1_pwm_out_pa8`. The `_pwm_in_`
  // (input capture), `_remapN_` (AFIO remap) and `_n` (complementary)
  // spellings are excluded by the token grammar, mirroring the pwmx/inn rules.
  { kind: PWM, re: /\/omit-if-no-ref\/?\s+(tim(\d+)_ch(\d+)_pwm_out_p[a-z]\d+):\s*\w+\s*\{[^}]*?pinmux\s*=\s*<STM32F?\d*_PINMUX\('([A-Z])',\s*(\d+)/g, token: (m) => m[1]!, source: (m) => `tim${m[2]}`, channel: (m) => Number(m[3]), port: (m) => m[4]!, bit: (m) => Number(m[5]) },
  // NXP Kinetis per-part header macros: FTM0_CH5_PTA0 (FTM = the pwm DT label).
  { kind: PWM, re: /#define FTM(\d+)_CH(\d+)_PT([A-Z])(\d+)\b/g, token: (m) => `FTM${m[1]}_CH${m[2]}_PT${m[3]}${m[4]}`, source: (m) => `ftm${m[1]}`, channel: (m) => Number(m[2]), port: (m) => m[3]!, bit: (m) => Number(m[4]) },
  // NXP LPC55 CTIMER match outputs (`ctimerN` = the DT label; MATCHn = ch n).
  { kind: PWM, re: /#define CTIMER(\d+)_MATCH(\d+)_PIO(\d+)_(\d+)\b/g, token: (m) => `CTIMER${m[1]}_MATCH${m[2]}_PIO${m[3]}_${m[4]}`, source: (m) => `ctimer${m[1]}`, channel: (m) => Number(m[2]), port: (m) => m[3]!, bit: (m) => Number(m[4]) },
  // GigaDevice GD32 TIMER macros (TIMER N is the DT timer label verbatim).
  { kind: PWM, re: /#define TIMER(\d+)_CH(\d+)_P([A-Z])(\d+)\b/g, token: (m) => `TIMER${m[1]}_CH${m[2]}_P${m[3]}${m[4]}`, source: (m) => `timer${m[1]}`, channel: (m) => Number(m[2]), port: (m) => m[3]!, bit: (m) => Number(m[4]) },
  // GigaDevice GD32 ADC — the header macros are package-specific (the board's
  // include chain reaches its own part's header), so the header is the
  // authoritative source, not the pinconfig YAML (whose package key is absent
  // from the GD32 soc segment). All unit spellings: ADC_IN (digitless),
  // ADC0/1/2_IN (single unit), ADC01_IN / ADC012_IN (shared — primary adc0).
  { kind: ADC, re: /#define ADC(\d*)_IN(\d+)_P([A-Z])(\d+)\b/g, token: (m) => `ADC${m[1]}_IN${m[2]}_P${m[3]}${m[4]}`, source: (m) => `adc${m[1] ? m[1][0] : ''}`, channel: (m) => Number(m[2]), port: (m) => m[3]!, bit: (m) => Number(m[4]) },
  // STM32 ADC — three vendor spellings: adc1_in1_pa1 (multi-unit),
  // adc_in0_pa0 (single-unit, no unit digit), adc1_inp16_pa0 (H7 positive).
  { kind: ADC, re: /\/omit-if-no-ref\/?\s+(adc(\d*)_(?:in|inp)(\d+)_p[a-z]\d+):\s*\w+\s*\{[^}]*?pinmux\s*=\s*<STM32(?:F\d+)?_PINMUX\('([A-Z])',\s*(\d+)/g, token: (m) => m[1]!, source: (m) => `adc${m[2]}`, channel: (m) => Number(m[3]), port: (m) => m[4]!, bit: (m) => Number(m[5]) },
  // NXP Kinetis ADC16 single-ended (source `adcN` = the DT label).
  { kind: ADC, re: /#define ADC(\d+)_SE(\d+)_PT([A-Z])(\d+)\b/g, token: (m) => `ADC${m[1]}_SE${m[2]}_PT${m[3]}${m[4]}`, source: (m) => `adc${m[1]}`, channel: (m) => Number(m[2]), port: (m) => m[3]!, bit: (m) => Number(m[4]) },
  // STM32 DAC — dac1_out1_pa4 (the pinctrl source IS the DT nodelabel).
  { kind: DAC, re: /\/omit-if-no-ref\/?\s+(dac(\d+)_out(\d+)_p[a-z]\d+):\s*\w+\s*\{[^}]*?pinmux\s*=\s*<STM32(?:F\d+)?_PINMUX\('([A-Z])',\s*(\d+)/g, token: (m) => m[1]!, source: (m) => `dac${m[2]}`, channel: (m) => Number(m[3]), port: (m) => m[4]!, bit: (m) => Number(m[5]) },
  // STM32F1 (AFIO) DAC — `dac_out1_pa4` (digitless unit in the name, like the
  // F1 ADC; the DT nodelabel is the conventional dac1).
  { kind: DAC, re: /\/omit-if-no-ref\/?\s+(dac_out(\d+)_p[a-z]\d+):\s*\w+\s*\{[^}]*?pinmux\s*=\s*<STM32F?\d*_PINMUX\('([A-Z])',\s*(\d+)/g, token: (m) => m[1]!, source: (m) => 'dac1', channel: (m) => Number(m[2]), port: (m) => m[3]!, bit: (m) => Number(m[4]) },
];

/** Harvest silicon routes from one pinctrl source text. Families by source
 *  shape: STM32/GD32/Kinetis/LPC C-header macros + i.MX RT dtsi node names;
 *  other families contribute nothing yet — see the family-convention notes
 *  in the manifest generator. Deduplicates by pinctrl node name / macro. */
function harvestPinctrlPins(
  src: string,
  pwm: Map<string, DtsPwmPin>,
  adc: Map<string, DtsAdcPin>,
  dac: Map<string, DtsDacPin>,
): void {
  const target = { pwm, adc, dac } as const;
  for (const d of PINCTRL_DIALECTS) {
    d.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = d.re.exec(src))) {
      const token = d.token(m);
      const map = target[d.kind] as Map<string, { source: string; channel: number; port: string; bit: number; pinctrl: string }>;
      if (map.has(token)) continue;
      map.set(token, {
        source: d.source(m),
        channel: d.channel(m),
        port: d.port(m),
        bit: d.bit(m),
        pinctrl: token,
      });
    }
  }
  // ── NXP i.MX RT pinctrl dtsi (node-name shape) ──────────────────────────
  // `iomuxc_<pad>_adc1_in1: …` — the pad-to-GPIO join is in-band: every pad
  // also declares `iomuxc_<pad>_gpio<port>_io<pin>`. FlexPWM routes the two
  // subchannel outputs (`pwma`/`pwmb`, channel 0/1 of the DT child
  // `flexpwm<N>_pwm<K>`); the complementary `pwmx` is skipped. The join map
  // is built first, then the routes resolve against it.
  const imxPadToGpio = new Map<string, { port: string; bit: number }>();
  IMX_GPIO_JOIN_RE.lastIndex = 0;
  let jm: RegExpExecArray | null;
  while ((jm = IMX_GPIO_JOIN_RE.exec(src))) {
    if (!imxPadToGpio.has(jm[1]!)) imxPadToGpio.set(jm[1]!, { port: jm[2]!, bit: Number(jm[3]) });
  }
  IMX_PWM_RE.lastIndex = 0;
  while ((jm = IMX_PWM_RE.exec(src))) {
    const pad = jm[1]!.replace(/^iomuxc_/, '').replace(/_flexpwm\d+_pwm[ab]\d+$/, '');
    const gpio = imxPadToGpio.get(pad);
    if (!gpio || pwm.has(jm[1]!)) continue;
    pwm.set(jm[1]!, {
      source: `flexpwm${jm[2]}_pwm${jm[4]}`,
      channel: jm[3] === 'b' ? 1 : 0,
      port: gpio.port,
      bit: gpio.bit,
      pinctrl: jm[1]!,
    });
  }
  // NEW FlexPWM spelling: `…_flexpwm1_pwm0_a` (pwm<K>_<a|b>, channel a=0/b=1).
  IMX_PWM2_RE.lastIndex = 0;
  while ((jm = IMX_PWM2_RE.exec(src))) {
    const pad = jm[1]!.replace(/^iomuxc_/, '').replace(/_flexpwm\d+_pwm\d+_[ab]$/, '');
    const gpio = imxPadToGpio.get(pad);
    if (!gpio || pwm.has(jm[1]!)) continue;
    pwm.set(jm[1]!, {
      source: `flexpwm${jm[2]}_pwm${jm[3]}`,
      channel: jm[4] === 'b' ? 1 : 0,
      port: gpio.port,
      bit: gpio.bit,
      pinctrl: jm[1]!,
    });
  }
  IMX_ADC_RE.lastIndex = 0;
  while ((jm = IMX_ADC_RE.exec(src))) {
    const pad = jm[1]!.replace(/^iomuxc_/, '').replace(/_adc\d+_in\d+$/, '');
    const gpio = imxPadToGpio.get(pad);
    if (!gpio || adc.has(jm[1]!)) continue;
    adc.set(jm[1]!, {
      source: `adc${jm[2]}`,
      channel: Number(jm[3]),
      port: gpio.port,
      bit: gpio.bit,
      pinctrl: jm[1]!,
    });
  }
}

/**
 * Cross-validate every harvested route's NAME against its pinmux VALUE —
 * both encode port/bit, independently (the name grammar and the macro's
 * argument tuple). A disagreement means either a harvest regex bug or an
 * upstream typo, and the route IS dropped: a silently-wrong fact is worse
 * than a missing one. Per-family value extractors; a route whose value form
 * is unknown is left unchecked (tolerant — the harvest stands).
 */
function lintNameValueAgreement(
  src: string,
  pwm: Map<string, DtsPwmPin>,
  adc: Map<string, DtsAdcPin>,
  dac: Map<string, DtsDacPin>,
): string[] {
  const warnings: string[] = [];
  // The port/bit each family's NAME grammar encodes as its trailing pad
  // (STM32 `…_pa1`; Kinetis `…_PTB0`; LPC `…_PIO0_10`; GD32 `…_PA0`).
  const namePad = (name: string): { port: string; bit: number } | undefined => {
    let m = name.match(/_p([a-z])(\d+)$/);
    if (m) return { port: m[1]!.toUpperCase(), bit: Number(m[2]) };
    m = name.match(/_PT([A-Z])(\d+)$/);
    if (m) return { port: m[1]!, bit: Number(m[2]) };
    m = name.match(/_PIO(\d+)_(\d+)$/);
    if (m) return { port: m[1]!, bit: Number(m[2]) };
    m = name.match(/_P([A-Z])(\d+)$/);
    if (m) return { port: m[1]!, bit: Number(m[2]) };
    return undefined;
  };
  // The port/bit each family's VALUE macro carries. The value text sits
  // within a small window after the name (same line for STM32/Kinetis/LPC,
  // a backslash continuation for GD32).
  const valuePad = (after: string): { port: string; bit: number } | undefined => {
    let m = after.match(/STM32(?:F\d+)?_PINMUX\('([A-Z])',\s*(\d+)/);
    if (m) return { port: m[1]!, bit: Number(m[2]) };
    m = after.match(/KINETIS_MUX\('([A-Z])',\s*(\d+)/);
    if (m) return { port: m[1]!, bit: Number(m[2]) };
    m = after.match(/GD32_PINMUX_AFIO\('([A-Z])',\s*(\d+)/);
    if (m) return { port: m[1]!, bit: Number(m[2]) };
    // IOCON_MUX(pin, type, func) — the GLOBAL pin index across LPC's 32-wide
    // ports (PIO1_0 = 32), decoded back to port/bit.
    m = after.match(/IOCON_MUX\((\d+),/);
    if (m) {
      const g = Number(m[1]);
      return { port: String(Math.floor(g / 32)), bit: g % 32 };
    }
    return undefined;
  };
  const check = (name: string, route: { port: string; bit: number }): boolean => {
    const byName = namePad(name);
    if (!byName) return false;
    // Word-boundary occurrence: a plain indexOf would prefix-match a longer
    // sibling (tim1_ch1_pb1 inside tim1_ch1_pb15) and cross-check the wrong
    // node's macro. Dtsi labels carry `name:`; header macros `name `.
    const re = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[:\\s]`);
    const hit = re.exec(src);
    if (!hit) return false;
    const idx = hit.index;
    // The value window must not cross into the NEXT definition (header
    // `#define` or dtsi `/omit-if-no-ref/` node) — a foreign macro later in
    // the window would cross-check against the wrong route. GD32's value
    // sits on a backslash continuation line, inside the same boundary.
    const raw = src.slice(idx, idx + 240);
    let end = raw.length;
    const nextDefine = raw.indexOf('\n#define', 1);
    if (nextDefine > 0) end = Math.min(end, nextDefine);
    const nextNode = raw.indexOf('/omit-if-no-ref', 8);
    if (nextNode > 0) end = Math.min(end, nextNode);
    const byValue = valuePad(raw.slice(0, end));
    if (!byValue) return false;
    const portOk = byValue.port === byName.port;
    if (!portOk || byValue.bit !== byName.bit) {
      warnings.push(
        `pinctrl '${name}': name says ${byName.port}${byName.bit} but its pinmux value says ` +
        `${byValue.port}${byValue.bit} — route dropped as untrustworthy (harvest bug or upstream typo).`,
      );
      return true;
    }
    return false;
  };
  for (const [name, r] of [...pwm]) if (check(name, r)) pwm.delete(name);
  for (const [name, r] of [...adc]) if (check(name, r)) adc.delete(name);
  for (const [name, r] of [...dac]) if (check(name, r)) dac.delete(name);
  return warnings;
}

// A watchdog device node anywhere in the include chain (SoC dtsi shape:
// `iwdg: watchdog@40003000 { compatible = "st,stm32-watchdog"; }` — nRF
// `wdt0: watchdog@40010200 { compatible = "nordic,nrf-watchdog"; }`). The
// nodelabel is the fact; compatible confirms it is a watchdog.
const WDT_NODE_RE = /(\w+):\s*watchdog@[0-9a-f]+\s*\{[^}]*?compatible\s*=\s*"([-\w,]*watchdog[-\w,]*)"/g;

// ESP32 LEDC matrix controller node (esp32s3_common.dtsi:
// ledc0: ledc@60019000 { compatible = "espressif,esp32-ledc"; }).
const LEDC_NODE_RE = /(ledc\d+):\s*ledc@[0-9a-f]+\s*\{/g;

// Flash node size (flash0: flash@8000000 { reg = <0x08000000 DT_SIZE_K(512)>; }).
const FLASH_KB_RE = /flash\d*:\s*flash@[0-9a-f]+\s*\{[^}]*?DT_SIZE_([KM])\((\d+)\)/g;
// Variant-module &-override form (Espressif): `&flash0 { reg = <0x0 DT_SIZE_M(8)>; }`
const FLASH_OVERRIDE_KB_RE = /&flash\d*\s*\{[^}]*?reg\s*=\s*<[^>]*?DT_SIZE_([KM])\((\d+)\)>/g;

// Counter-capable devices. The Zephyr counter driver binds either a labeled
// node whose compatible IS a counter (nRF `rtc1: rtc@… nordic,nrf-rtc`;
// STM32 `rtc: rtc@… st,stm32-rtc` — the RTC bindings carry counter drivers)
// or an unlabeled `counter { compatible = "…-counter" }` child under a
// labeled timer parent (ESP32 timer0-2, Ambiq, STM32 timer counters).
// COUNTER_COMPATS mirrors dts/bindings/counter/* plus the two rtc compatibles
// with counter drivers (they live under bindings/rtc).
const COUNTER_COMPATS = new Set([
  'nordic,nrf-rtc', 'st,stm32-rtc',
]);
// Child form: (parent label): …timer-ish node… { … counter { compatible = "X" … } }
const COUNTER_CHILD_RE =
  /(\w+):\s*(?:counter|timer|rtc)@[0-9a-f]+\s*\{(?:[^{}]|\{[^{}]*\})*?\bcounter\s*\{(?:[^{}]|\{[^{}]*\})*?compatible\s*=\s*"([-\w,]+)"/g;
// Self form: (label): node@… { … compatible = "X" … } where X ∈ COUNTER_COMPATS
const COUNTER_SELF_RE =
  /(\w+):\s*(?:rtc|counter|timer)@[0-9a-f]+\s*\{[^}]*?compatible\s*=\s*"([-\w,]+)"/g;

/** Harvest counter nodes from the merged include-chain text. */
function harvestCounterNodes(text: string): DtsCounterNode[] {
  const out: DtsCounterNode[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  COUNTER_CHILD_RE.lastIndex = 0;
  while ((m = COUNTER_CHILD_RE.exec(text))) {
    const key = `child:${m[1]}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ compatible: m[2], parentLabel: m[1] });
    }
  }
  COUNTER_SELF_RE.lastIndex = 0;
  while ((m = COUNTER_SELF_RE.exec(text))) {
    if (!COUNTER_COMPATS.has(m[2])) continue;
    const key = `self:${m[1]}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ compatible: m[2], nodeLabel: m[1] });
    }
  }
  return out;
}

/**
 * Read one board DTS file (following its local include chain) and extract
 * the board-level facts. `zephyrBoardsRoot` (e.g. <zephyr>/boards) resolves
 * `<../boards/common/...>` style includes; `moduleDtsRoots` resolve the
 * vendor HAL modules' pinctrl dtsi (`<st/f4/...-pinctrl.dtsi>` lives under
 * modules/hal/stm32/dts — Zephyr's MODULE_DTS_ROOTS, mirrored here).
 */
export function readBoardDts(
  dtsPath: string,
  opts: { zephyrBoardsRoot?: string; moduleDtsRoots?: readonly string[] } = {},
): DtsBoardFacts {
  const roots: IncludeRoots = {
    angle: [...(opts.moduleDtsRoots ?? []), ...(opts.zephyrBoardsRoot ? [opts.zephyrBoardsRoot] : [])],
  };
  const seen = new Set<string>();
  const pwmPins = new Map<string, DtsPwmPin>();
  const adcPins = new Map<string, DtsAdcPin>();
  const dacPins = new Map<string, DtsDacPin>();
  const pinctrlWarnings: string[] = [];
  let wdtSocNode: string | undefined;
  let ledcNode: string | undefined;
  let flashKb: number | undefined;
  let hasStoragePartition: boolean | undefined;
  let storageReg: { offsetBytes: number; sizeBytes: number } | undefined;
  let text = '';

  const absorb = (file: string) => {
    const real = path.resolve(file);
    if (seen.has(real)) return;
    seen.add(real);
    const src = fs.readFileSync(real, 'utf8');
    // Silicon routes ride the pinctrl dtsi files pulled in by the board's
    // include chain — harvested from every absorbed file (harmless no-op on
    // files whose grammars don't match).
    harvestPinctrlPins(src, pwmPins, adcPins, dacPins);
    pinctrlWarnings.push(...lintNameValueAgreement(src, pwmPins, adcPins, dacPins));
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

  // SoC-level watchdog node: first watchdog-compatible node in the include
  // chain (a board-level watchdog0 alias, checked by the walker, wins).
  WDT_NODE_RE.lastIndex = 0;
  const wdtMatch = WDT_NODE_RE.exec(text);
  if (wdtMatch) wdtSocNode = wdtMatch[1];

  // SoC-level ADC/DAC device nodelabels (adc1:/dac1: device nodes). The
  // pinctrl files sometimes carry routes for peripherals the SoC dtsi never
  // declares (L4S5: dac1_out1_pa4 exists, no dac1 device) — routes for an
  // undeclared device are dropped by the manifest generator.
  const analogDevices = new Set<string>();
  // Digitless labels included: samd2x names its single controller `adc:`
  // (the pinconfigs YAML's source spelling) — without it in analogDevices,
  // the non-empty cross-check dropped every Atmel route. The label — not the
  // node name — is the semantic signal, so non-standard node names
  // (`gau_adc0`, `eadc`, `adc_etc`) are accepted; the label grammar covers
  // every ADC/DAC device naming in the tree: adc\d* / dac\d* (classic),
  // lpadc\d* (NXP LPADC), eadc\d* (Nuvoton), sadc\d* (Renesas/various), and
  // the underscore forms adc_\d+ / dac_\d+ (NXP MCX).
  const DEV_RE = /\b((?:lpadc|eadc|sadc|adc|dac)\d*|(?:adc|dac)_\d+):\s*\w+@[0-9a-f]+\s*\{/g;
  let dm: RegExpExecArray | null;
  while ((dm = DEV_RE.exec(text))) analogDevices.add(dm[1]);

  // ESP32 LEDC matrix controller node (any SoC dtsi in the chain declaring
  // one — esp32s3_common.dtsi's ledc0).
  LEDC_NODE_RE.lastIndex = 0;
  const ledcMatch = LEDC_NODE_RE.exec(text);
  if (ledcMatch) ledcNode = ledcMatch[1];

  // Labeled PWM controller nodes (nRF's psel-routed matrix peripherals).
  const pwmNodes = new Set<string>();
  let pm: RegExpExecArray | null;
  PWM_NODE_RE.lastIndex = 0;
  while ((pm = PWM_NODE_RE.exec(text))) pwmNodes.add(pm[1]);

  // Flash size (largest reg across the chain — the package variant dtsi
  // overrides the SoC base with the real size). Two spellings: the SoC form
  // `flash0: flash@... { reg = <... DT_SIZE_K(n)>; }` and the variant
  // &-override `&flash0 { reg = <0x0 DT_SIZE_M(n)>; }` (Espressif WROOM
  // modules). DT_SIZE_M carries megabytes.
  for (const re of [FLASH_KB_RE, FLASH_OVERRIDE_KB_RE]) {
    re.lastIndex = 0;
    let fm: RegExpExecArray | null;
    while ((fm = re.exec(text))) {
      // Group 1 is the DT_SIZE_ unit, group 2 the magnitude.
      const kb = fm[1] === 'M' ? Number(fm[2]) * 1024 : Number(fm[2]);
      if (!flashKb || kb > flashKb) flashKb = kb;
    }
  }
  hasStoragePartition = /storage_partitions*:/.test(text);
  // The board's own storage_partition reg (offset + size), when shipped —
  // ESP32's AMP partition layout defines one; those boards carry their real
  // facts instead of a synthesized region.
  const sm = /storage_partitions*:\s*partition@[0-9a-f]+\s*\{[^}]*?reg\s*=\s*<0x([0-9a-f]+)\s+DT_SIZE_([KM])\((\d+)\)>/s.exec(text);
  if (sm) {
    const sizeKb = sm[2] === 'M' ? Number(sm[3]) * 1024 : Number(sm[3]);
    storageReg = { offsetBytes: parseInt(sm[1], 16), sizeBytes: sizeKb * 1024 };
  }
  const counterNodes = harvestCounterNodes(text);

  const { root: syntheticRoot, byLabel, refOverrides } = parseStatements(stripCommentsKeepMarkers(text));

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

  // GPIO controller inventory: every labeled node with the universal
  // `gpio-controller` property. The SoC dtsi (absorbed) declares the FULL
  // port list; the board's facts only name the ports it wires. `ngpios`
  // carries the width when the dtsi states one.
  const gpioControllers: DtsGpioController[] = [];
  for (const [label, node] of byLabel) {
    if (!node.props.has('gpio-controller')) continue;
    const ngpiosRaw = node.props.get('ngpios');
    const ngpios = ngpiosRaw !== undefined ? Number(ngpiosRaw.replace(/[<>]/g, '')) : undefined;
    gpioControllers.push({
      nodelabel: node.name.startsWith('&') ? node.name.slice(1) : label,
      ...(ngpios !== undefined && Number.isFinite(ngpios) ? { ngpios } : {}),
    });
  }
  gpioControllers.sort((a, b) => a.nodelabel.localeCompare(b.nodelabel));

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

  // Connector io-channel-maps (the DKs' arduino,uno-adc nodes): entries
  // `<idx &adc ch>` name the channel a CONNECTOR pin is wired to; the
  // trailing /* A0 … */ comment names the pin. Joined against the gpio-map
  // pins of the board's connectors by that label — board-authored wiring
  // truth for SoCs whose silicon map has no other in-tree source.
  const connectorAdc: { source: string; channel: number; controller: string; pin: number }[] = [];
  const ioEntries: { label?: string; source: string; channel: number }[] = [];
  const findIoChannels = (node: DtsNode): void => {
    const map = node.props.get('io-channel-map');
    if (map) {
      // Labels ride the ⟨…⟩ comment markers (stripCommentsKeepMarkers) —
      // the same channel the gpio-map parser reads silkscreen from. A `,`
      // (mid-list) or `;` (last entry) may sit between the cell and its
      // marker.
      for (const m of map.matchAll(/<(\d+)\s+&([\w,-]+)\s+(\d+)\s*>[\s;,]*(?:⟨([A-Za-z_][\w-]*)?[^⟩]*⟩)?/g)) {
        const channel = Number(m[3]);
        if (!Number.isFinite(channel)) continue;
        ioEntries.push({ ...(m[4] ? { label: m[4] } : {}), source: m[2], channel });
      }
    }
    for (const child of node.children.values()) findIoChannels(child);
  };
  findIoChannels(root);
  for (const io of ioEntries) {
    if (!io.label) continue; // unlabeled entries can't be joined to a pad
    for (const c of connectors) {
      const ref = c.pins[io.label];
      if (ref) {
        connectorAdc.push({ source: io.source, channel: io.channel, controller: ref.controller, pin: ref.pin });
        break;
      }
    }
  }

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
  let usbController: string | undefined;
  for (const key of ['zephyr_udc0', 'usbd']) {
    const n = byLabel.get(key);
    if (!n) continue;
    const status = n.props.get('status');
    if (status === '"okay"') {
      usbDevice = 'enabled';
      usbController = key;
      break;
    }
    if (status === '"disabled"' && usbDevice === undefined) usbDevice = 'disabled';
  }

  // Bus controller nodelabels the board wires up: &ref blocks whose status
  // is okay (or that carry no status override but configure the bus — the
  // app overlay decides enablement; cuttlefish's own overlay writes it).
  // Classified by nodelabel — bus node names are vendor-stable (i2c0,
  // spi2, usart0, eusart1, lpuart1, …).
  const buses: { i2c: string[]; spi: string[]; uart: string[] } = { i2c: [], spi: [], uart: [] };
  // Multi-function bus blocks whose nodelabel carries no function (Atmel SAM
  // sercomN: the SAME controller can be I2C, SPI, or UART) are classified by
  // their compatible (atmel,sam0-i2c / atmel,sam0-spi / atmel,sam0-uart).
  const classifyBus = (label: string, compatible: string): 'i2c' | 'spi' | 'uart' | undefined => {
    if (/^i2c|^twi/.test(label)) return 'i2c';
    if (/^spi|^ssp/.test(label)) return 'spi';
    if (/uart|usart/.test(label)) return 'uart';
    const compat = compatible.replace(/^"|"$/g, '');
    if (/-i2c$|,twi$/.test(compat)) return 'i2c';
    if (/-spi$/.test(compat)) return 'spi';
    if (/-uart$|-usart$/.test(compat)) return 'uart';
    return undefined;
  };
  // Only labels the DTS OVERRODE with an &ref block count (`xiao_i2c: &i2c1
  // { … }` → nodelabel 'i2c1'). With SoC dtsis absorbed, an override merges
  // into the SoC's real labeled node (no synthetic '&i2c1' name), so the
  // refOverrides set — not the node's name — carries the signal. Pinctrl
  // groups ('i2c0_default') never appear in it; _default/_sleep is belt and
  // braces.
  const seenBuses = new Set<string>();
  for (const [label, node] of byLabel) {
    if (!refOverrides.has(label)) continue;
    if (label === 'usbd' || /_(default|sleep)$/.test(label)) continue;
    const nodelabel = node.name.startsWith('&') ? node.name.slice(1) : label;
    const kind = classifyBus(nodelabel, node.props.get('compatible') ?? '');
    if (!kind || seenBuses.has(nodelabel)) continue;
    const status = node.props.get('status');
    if (status === '"disabled"') continue;
    seenBuses.add(nodelabel);
    buses[kind].push(nodelabel);
  }
  for (const kind of ['i2c', 'spi', 'uart'] as const) buses[kind].sort();

  void byLabel; // (labels already captured during parse)
  return {
    aliases, chosen, leds, buttons, connectors, connectorAdc, pwmLeds, buses,
    ...(pinctrlWarnings.length > 0 ? { pinctrlWarnings } : {}),
    pwmPins: [...pwmPins.values()],
    adcPins: [...adcPins.values()],
    dacPins: [...dacPins.values()],
    analogDevices: [...analogDevices],
    ...(wdtSocNode ? { wdtSocNode } : {}),
    ...(ledcNode ? { ledcNode } : {}),
    ...(pwmNodes.size > 0 ? { pwmNodes: [...pwmNodes].sort() } : {}),
    ...(flashKb ? { flashKb } : {}),
    ...(hasStoragePartition ? { hasStoragePartition } : {}),
    ...(storageReg ? { storageReg } : {}),
    counterNodes,
    gpioControllers,
    ...(stripLed ? { stripLed } : {}),
    ...(usbDevice ? { usbDevice } : {}),
    ...(usbController ? { usbController } : {}),
  };
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
