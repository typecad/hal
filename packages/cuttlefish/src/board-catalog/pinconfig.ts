// ---------------------------------------------------------------------------
// board-catalog/pinconfig.ts — parse the vendor `pinconfigs/*.yml` datasheet
// pin tables into normalized silicon routes.
//
// Atmel (SAM/SAM0) and Bouffalolab publish datasheet-complete pin-mux tables
// as YAML under their HAL module's `pinconfigs/` directory — the SAME files
// the vendors' own pinctrl generators consume. Each declares, per pin and per
// bonded package ("pincode"), the full list of alternate functions (ADC input
// channel, DAC output channel, timer/PWM channel, and the raw signal
// vocabulary). That is the authoritative "every pin + every function" source
// — no macro-name regexes, no generated-header churn.
//
// GigaDevice is deliberately NOT here: its board soc segment is the SERIES
// (gd32f450), not the part, so the package key this parser needs is absent
// from the soc name — the package-specific generated header (read by the
// dts-reader's dialect table) is the authoritative source for GD32.
//
// This module unifies the two grammars (they share a `series`/`pincode`/
// `pins` skeleton) and returns ADC routes in the raw harvest form the rest of
// the catalog already uses (source/channel/port/bit). DAC/PWM routes are
// deliberately NOT lowered yet — their overlay pinmux synthesis is per-family
// and still pending (tracked by the walker's coverage ledger, not shipped as
// false capability flags).
// ----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

/** A normalized ADC route from a pinconfig table (raw harvest form). */
export interface PinconfigAdcRoute {
  /** ADC controller nodelabel the route maps to ('adc0', 'adc1', 'adc'). */
  readonly source: string;
  /** Input channel number. */
  readonly channel: number;
  /** GPIO port letter ('A', …) or digit ('0' for a flat gpio0 controller). */
  readonly port: string;
  readonly bit: number;
  /** Pinmux token when the family's ADC needs a pad mux. Absent for families
   *  whose analog inputs need none (Atmel SAM, Bouffalolab). */
  readonly pinctrl?: string;
}

export interface PinconfigFacts {
  readonly adc: PinconfigAdcRoute[];
  /** DAC output routes (Atmel SAM — no pinmux group; the driver selects the
   *  output pad). */
  readonly dac?: PinconfigDacRoute[];
  /** PWM output routes (Atmel SAM tc/tcc waveform outputs — the WO pinmux
   *  macro is synthesized from the position+peripheral+signal triple). */
  readonly pwm?: PinconfigPwmRoute[];
  /** The pinconfig file that satisfied the board (provenance). */
  readonly file?: string;
}

/** A normalized DAC output route from a pinconfig table (raw harvest form). */
export interface PinconfigDacRoute {
  readonly source: string;
  readonly channel: number;
  readonly port: string;
  readonly bit: number;
}

/** A normalized PWM output route from a pinconfig table. `pinctrl` is the
 *  synthesized SAM pinmux macro token (`PA17E_TCC2_WO1`), which the board's
 *  pinctrl include chain defines via SAM_PINMUX. */
export interface PinconfigPwmRoute {
  readonly source: string;
  readonly channel: number;
  readonly port: string;
  readonly bit: number;
  readonly pinctrl: string;
}

/** List the *.yml files in a pinconfigs dir (undefined when absent). */
function listYml(dir: string): string[] | undefined {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.yml'));
  } catch {
    return undefined;
  }
}

// ── Atmel SAM / SAM0 ────────────────────────────────────────────────────────
// `periph:` is a list of `[position, peripheral, signal]` triples per pin.
// Analog inputs are `[b, adc0, ain15]` — no pad mux token (the SAM ADC driver
// samples by channel; the pad is analog by function selection).
// ----------------------------------------------------------------------------

function harvestAtmel(soc: string, westRoot: string): PinconfigFacts | undefined {
  const dir = path.join(westRoot, 'modules', 'hal', 'atmel', 'pinconfigs');
  const files = listYml(dir);
  if (!files) return undefined;
  const socLower = soc.toLowerCase();
  for (const f of files) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, f), 'utf8');
    } catch {
      continue;
    }
    const seriesMatch = text.match(/^series:\s*\[([^\]]*)\]/m);
    if (!seriesMatch) continue;
    const series = seriesMatch[1]!.split(',').map((s) => s.trim()).filter(Boolean);
    // Series tokens encode the soc prefix either directly ('d51') or as a
    // placeholder with a trailing 'X' ('4eX', '3XX', '4lsX' — the OLD SAM
    // parts). A placeholder matches the bare prefix and its package letter is
    // the LAST character of the soc name (sam4e16e → 'e'), unlike the modern
    // parts whose package follows the series directly (samd51j19a → 'j').
    const prefixes: { prefix: string; placeholder: boolean }[] = [];
    for (const s of series) {
      const lower = s.toLowerCase();
      if (lower.includes('-')) {
        prefixes.push({ prefix: lower, placeholder: false });
        prefixes.push({ prefix: lower.split('-')[0]!, placeholder: false });
        continue;
      }
      if (lower.endsWith('x')) {
        const stripped = lower.replace(/x+$/, '');
        if (stripped) prefixes.push({ prefix: stripped, placeholder: true });
        prefixes.push({ prefix: lower, placeholder: true });
      } else {
        prefixes.push({ prefix: lower, placeholder: false });
      }
    }
    const matched = prefixes.find((p) => socLower.startsWith('sam' + p.prefix));
    if (!matched) continue;
    const pincode = matched.placeholder
      ? socLower.slice(-1)
      : socLower.slice(('sam' + matched.prefix).length).charAt(0);
    if (!/^[a-z]$/.test(pincode)) break;
    const routes: PinconfigAdcRoute[] = [];
    const dacRoutes: PinconfigDacRoute[] = [];
    const pwmRoutes: PinconfigPwmRoute[] = [];
    let pin: { name: string; codes: Set<string> } | undefined;
    for (const line of text.split('\n')) {
      // Atmel pin names are p<port><bits> (pa02, pa0 — the PIO prefix; the
      // old SAM parts use single-digit pads).
      const pinM = line.match(/^  p([a-z])(\d+):/);
      if (pinM) {
        pin = { name: pinM[1]! + pinM[2]!, codes: new Set() };
        continue;
      }
      if (!pin) continue;
      const codesM = line.match(/^ {4}pincodes:\s*\[([^\]]*)\]/);
      if (codesM) {
        for (const c of codesM[1]!.split(',').map((s) => s.trim()).filter(Boolean)) pin.codes.add(c);
        continue;
      }
      const perM = line.match(/^ {6}- \[([a-z]),\s*(\w+),\s*(\w+)(?:,\s*\[[^\]]*\])?\]/);
      // 'adc' (d2x/3x single controller), 'adc0'/'adc1' (d5x). The signal is
      // `ain<N>` on the SAM0/SAMD parts and `ad<N>` on the older SAM parts.
      // `adc_dac` (reference outputs) and the AFEC/ADCIFE front-ends
      // (`afec0`/`adcife`) are NOT input routes on the standard adc driver.
      if (perM && pin.codes.has(pincode) && /^adc\d*$/.test(perM[2]!)) {
        const ain = perM[3]!.match(/^ain(\d+)$/) ?? perM[3]!.match(/^ad(\d+)$/);
        if (ain) {
          routes.push({
            source: perM[2]!,
            channel: Number(ain[1]),
            port: pin.name[0]!.toUpperCase(),
            bit: Number(pin.name.slice(1)),
          });
        }
      }
      // DAC output: `[b, dac, vout<N>]` (and the digitless `vout` on the
      // single-channel parts). The YAML peripheral is `dac` but the DT
      // nodelabel is `dac0` (samd2x/samd5x/… declare dac0: dac@…), so the
      // source is normalized to dac0 to survive the analogDevices cross-check.
      // No pinmux group — the sam0-dac driver selects the output pad.
      if (perM && pin.codes.has(pincode) && perM[2] === 'dac') {
        const vout = perM[3]!.match(/^vout(\d+)$/) ?? (perM[3] === 'vout' ? [null, '0'] : null);
        if (vout) {
          dacRoutes.push({
            source: 'dac0',
            channel: Number(vout[1] ?? 0),
            port: pin.name[0]!.toUpperCase(),
            bit: Number(pin.name.slice(1)),
          });
        }
      }
      // PWM waveform output: `[e, tcc2, wo1]` — the position letter +
      // peripheral + signal synthesize the SAM pinmux macro token the board's
      // pinctrl chain defines (`P<port><bit><pos>_<PERIPH>_<SIG>` →
      // `PA17E_TCC2_WO1`). The source is the DT nodelabel verbatim (`tcc2`).
      if (perM && pin.codes.has(pincode) && /^(tcc|tc)\d+$/.test(perM[2]!)) {
        const wo = perM[3]!.match(/^wo(\d+)$/);
        if (wo) {
          const port = pin.name[0]!.toUpperCase();
          // The macro token uses the NUMERIC pad (no leading zero — pa02 →
          // PA2E_TCC2_WO1, pa17 → PA17E_TCC2_WO1).
          const bit = Number(pin.name.slice(1));
          pwmRoutes.push({
            source: perM[2]!,
            channel: Number(wo[1]),
            port,
            bit,
            pinctrl: `P${port}${bit}${perM[1]!.toUpperCase()}_${perM[2]!.toUpperCase()}_${perM[3]!.toUpperCase()}`,
          });
        }
      }
    }
    if (routes.length > 0 || dacRoutes.length > 0 || pwmRoutes.length > 0) {
      routes.sort((a, b) => a.source.localeCompare(b.source, undefined, { numeric: true }) || a.channel - b.channel);
      dacRoutes.sort((a, b) => a.channel - b.channel);
      pwmRoutes.sort((a, b) => a.source.localeCompare(b.source, undefined, { numeric: true }) || a.channel - b.channel);
      return {
        adc: routes,
        ...(dacRoutes.length > 0 ? { dac: dacRoutes } : {}),
        ...(pwmRoutes.length > 0 ? { pwm: pwmRoutes } : {}),
        file: f,
      };
    }
    break;
  }
  return undefined;
}

// ── Bouffalolab ─────────────────────────────────────────────────────────────
// Pins are global pads (`gpio0`…), `analog:` lists `[adc, [ch<N>]]` and the
// family/series fields name the SoC variants (`family: bl60x`, `series:
// [602, 604]` → bl602/bl604). Analog pads need no pinmux group (silicon-
// selected, like the ESP32 SARADC). Indentation varies between files (bl60x
// indents pins 2 spaces, bl61x/bl70x 4) — matched tolerant of depth.
// ----------------------------------------------------------------------------

function harvestBflb(soc: string, westRoot: string): PinconfigFacts | undefined {
  const dir = path.join(westRoot, 'modules', 'hal', 'bouffalolab', 'pinconfigs');
  const files = listYml(dir);
  if (!files) return undefined;
  const socLower = soc.toLowerCase();
  for (const f of files) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, f), 'utf8');
    } catch {
      continue;
    }
    const series = [...text.matchAll(/^series:\s*\[([^\]]*)\]/gm)]
      .flatMap((m) => m[1]!.split(',').map((s) => s.trim()).filter(Boolean));
    if (series.length === 0) continue;
    // The soc name starts with `bl` + a series entry (bl602c00q2i → bl602,
    // bl704l10q2i → bl704l, …) — the tail is package/flash detail.
    const suffix = series.find((s) => socLower.startsWith(('bl' + s).toLowerCase()));
    if (!suffix) continue;

    const routes: PinconfigAdcRoute[] = [];
    let pin: { bit: number; bonded: boolean } | undefined;
    let inAnalog = false;
    for (const rawLine of text.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      const pinM = line.match(/^\s+gpio(\d+):/);
      if (pinM) {
        pin = { bit: Number(pinM[1]), bonded: true };
        inAnalog = false;
        continue;
      }
      if (!pin) continue;
      // A new key at pin depth ends the analog block.
      if (inAnalog && /^\s+\w[\w-]*:/.test(line)) { inAnalog = false; }
      if (inAnalog) {
        const adc = line.match(/^\s*-\s*\[adc,\s*\[ch(\d+)\]\]/);
        if (adc && pin.bonded) {
          routes.push({ source: 'adc0', channel: Number(adc[1]), port: '0', bit: pin.bit });
        }
        continue;
      }
      const seriesM = line.match(/^\s+series:\s*\[([^\]]*)\]/);
      if (seriesM) {
        pin.bonded = seriesM[1]!.split(',').some((s) => s.trim() === suffix);
        continue;
      }
      if (/^\s+analog:/.test(line)) inAnalog = true;
    }
    if (routes.length > 0) {
      routes.sort((a, b) => a.channel - b.channel);
      return { adc: routes, file: f };
    }
  }
  return undefined;
}

/**
 * Harvest ADC routes from the vendor pinconfigs for the board's SoC. The
 * source is chosen by the soc segment — a data convention (like the
 * letter-port families), never a board name. Undefined for SoCs without a
 * pinconfig source.
 */
export function harvestPinconfig(identifier: string, westRoot: string): PinconfigFacts | undefined {
  const soc = identifier.split('/')[1];
  if (!soc) return undefined;
  const s = soc.toLowerCase();
  if (s.startsWith('sam')) return harvestAtmel(soc, westRoot);
  if (s.startsWith('bl')) return harvestBflb(soc, westRoot);
  return undefined;
}
