// ---------------------------------------------------------------------------
// as-built.ts — harvest pin routes from a build's resolved zephyr.dts
//
// The third fact source: after any successful `west build`, the fully
// merged devicetree at <build>/zephyr/zephyr.dts contains the board's
// pinctrl nodes with LABELS verbatim — the stable name grammar
// (`adc1_in1_pa1`, `tim4_ch1_pb6`, `iomuxc_<pad>_adc1_in1`) — with the
// vendor macro values already expanded away. Parsing names only needs ONE
// grammar per shape, immune to vendor macro churn, and corrects a broken
// catalog harvest per-pin before the next build (the walker's macro-value
// grammars are the fragile half; this is the robust half).
//
// Scope is honest: only node-name families appear (STM32-style dtsi nodes
// and the i.MX RT label grammar with its in-band pad join). Header-matrix
// families (Kinetis/LPC/GD32 macro routing, ESP32/RP2 matrices) never
// exist as DT nodes — the walker + family tables remain their source.
// ----------------------------------------------------------------------------

export interface AsBuiltRoute {
  source: string;
  channel: number;
  port: string;
  bit: number;
  pinctrl: string;
}

export interface AsBuiltFacts {
  adc: AsBuiltRoute[];
  pwm: AsBuiltRoute[];
  dac: AsBuiltRoute[];
}

/** The .typecad-hal/as-built.json shape (machine-authored facts file). */
export interface AsBuiltFile {
  version: 1;
  board: string;
  generatedAt: string;
  routes: {
    adcPins: AsBuiltRoute[];
    pwmPins: AsBuiltRoute[];
    dacPins: AsBuiltRoute[];
  };
}

// STM32-style pinctrl dtsi labels (all spellings the walker knows):
// adc1_in1_pa1 / adc_in0_pa0 / adc1_inp16_pa0, tim4_ch1_pb6,
// dac1_out1_pa4. Labels appear verbatim in zephyr.dts
// (`adc1_in0_pa0: adc1_in0_pa0 {`). The `inn` negative inputs stay out —
// the thin HAL is single-ended. The F1 (AFIO) family uses `tim1_ch1_pwm_out_pa8`
// and `dac_out1_pa4` — separate grammars.
const ST_ADC = /^([a-z]*adc\d*_(?:in|inp)\d+_p([a-z])(\d+))$/;
const ST_PWM = /^(tim(\d+)_ch(\d+)_p([a-z])(\d+))$/;
const ST_PWM_F1 = /^(tim(\d+)_ch(\d+)_pwm_out_p([a-z])(\d+))$/;
const ST_DAC = /^(dac(\d+)_out(\d+)_p([a-z])(\d+))$/;
const ST_DAC_F1 = /^(dac_out(\d+)_p([a-z])(\d+))$/;
// i.MX RT labels: iomuxc_<pad>_adc1_in1 / iomuxc_<pad>_flexpwm2_pwma3,
// with the pad→GPIO join as sibling iomuxc_<pad>_gpio1_io12 labels. The NEW
// RT parts (rt11xx/rt116x/rt118x) use `…_flexpwm1_pwm0_a` (pwm<K>_<a|b> →
// A=0/B=1). Their ADC is the LPADC (`lpadc<N>`) and stays out — see
// dts-reader.ts.
const IMX_GPIO = /^iomuxc_([a-z0-9_]+)_gpio(\d+)_io(\d+)$/;
const IMX_ADC = /^iomuxc_([a-z0-9_]+)_adc(\d+)_in(\d+)$/;
const IMX_PWM = /^iomuxc_([a-z0-9_]+)_flexpwm(\d+)_pwm([ab])(\d+)$/;
const IMX_PWM2 = /^iomuxc_([a-z0-9_]+)_flexpwm(\d+)_pwm(\d+)_([ab])$/;

/**
 * Parse a resolved zephyr.dts into raw pin routes. Labels are matched as
 * whole tokens (`label:` or `label {`) — in dtc output every node carries
 * its labels inline before the node name.
 */
export function parseZephyrDts(text: string): AsBuiltFacts {
  const facts: AsBuiltFacts = { adc: [], pwm: [], dac: [] };
  const imxPadToGpio = new Map<string, { port: string; bit: number }>();
  const seen = new Set<string>();
  // Every label occurrence: `label:` (label before node) — zephyr.dts
  // renders `label: nodename {`, INDENTED with tabs. Whole-token labels.
  for (const m of text.matchAll(/^\s*([a-z][a-z0-9_]*):\s/gm)) {
    const label = m[1]!;
    if (seen.has(label)) continue;
    let g: RegExpMatchArray | null;
    if ((g = label.match(ST_ADC))) {
      seen.add(label);
      // Source: the unit prefix from the name — `adc1_in1…` → adc1, the
      // single-unit spelling `adc_in0…` → adc.
      const unit = label.match(/^([a-z]+?\d*)_in/);
      facts.adc.push({
        source: unit ? unit[1]! : 'adc',
        channel: Number(label.match(/_(?:in|inp)(\d+)_/)![1]),
        port: g[2]!.toUpperCase(),
        bit: Number(g[3]),
        pinctrl: label,
      });
    } else if ((g = label.match(ST_PWM))) {
      seen.add(label);
      facts.pwm.push({
        source: `tim${g[2]}`,
        channel: Number(g[3]),
        port: g[4]!.toUpperCase(),
        bit: Number(g[5]),
        pinctrl: label,
      });
    } else if ((g = label.match(ST_PWM_F1))) {
      seen.add(label);
      facts.pwm.push({
        source: `tim${g[2]}`,
        channel: Number(g[3]),
        port: g[4]!.toUpperCase(),
        bit: Number(g[5]),
        pinctrl: label,
      });
    } else if ((g = label.match(ST_DAC))) {
      seen.add(label);
      facts.dac.push({
        source: `dac${g[2]}`,
        channel: Number(g[3]),
        port: g[4]!.toUpperCase(),
        bit: Number(g[5]),
        pinctrl: label,
      });
    } else if ((g = label.match(ST_DAC_F1))) {
      seen.add(label);
      facts.dac.push({
        source: 'dac1',
        channel: Number(g[2]),
        port: g[3]!.toUpperCase(),
        bit: Number(g[4]),
        pinctrl: label,
      });
    } else if ((g = label.match(IMX_GPIO))) {
      seen.add(label);
      if (!imxPadToGpio.has(g[1]!)) imxPadToGpio.set(g[1]!, { port: g[2]!, bit: Number(g[3]) });
    }
  }
  // i.MX routes resolve after the join map is complete.
  for (const m of text.matchAll(/^\s*([a-z][a-z0-9_]*):\s/gm)) {
    const label = m[1]!;
    let g: RegExpMatchArray | null;
    if ((g = label.match(IMX_ADC))) {
      const gpio = imxPadToGpio.get(g[1]!);
      if (!gpio || seen.has(label)) continue;
      seen.add(label);
      facts.adc.push({
        source: `adc${g[2]}`,
        channel: Number(g[3]),
        port: gpio.port,
        bit: gpio.bit,
        pinctrl: label,
      });
    } else if ((g = label.match(IMX_PWM))) {
      const gpio = imxPadToGpio.get(g[1]!);
      if (!gpio || seen.has(label)) continue;
      seen.add(label);
      facts.pwm.push({
        source: `flexpwm${g[2]}_pwm${g[4]}`,
        channel: g[3] === 'b' ? 1 : 0,
        port: gpio.port,
        bit: gpio.bit,
        pinctrl: label,
      });
    } else if ((g = label.match(IMX_PWM2))) {
      const gpio = imxPadToGpio.get(g[1]!);
      if (!gpio || seen.has(label)) continue;
      seen.add(label);
      facts.pwm.push({
        source: `flexpwm${g[2]}_pwm${g[3]}`,
        channel: g[4] === 'b' ? 1 : 0,
        port: gpio.port,
        bit: gpio.bit,
        pinctrl: label,
      });
    }
  }
  return facts;
}

/** Parse + shape-validate .typecad-hal/as-built.json; errors name the file. */
export function parseAsBuiltJson(text: string, source = '.typecad-hal/as-built.json'): AsBuiltFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${source} is not valid JSON: ${(err as Error).message}`);
  }
  const file = parsed as AsBuiltFile;
  if (!file || typeof file !== 'object' || file.version !== 1 || typeof file.board !== 'string'
      || !file.routes || !Array.isArray(file.routes.adcPins) || !Array.isArray(file.routes.pwmPins)) {
    throw new Error(`${source} must carry version 1, a board target, and routes.{adcPins,pwmPins}.`);
  }
  return file;
}

/** Serialize the as-built snapshot (deterministic field order). */
export function asBuiltJson(board: string, facts: AsBuiltFacts): string {
  const byPin = (a: AsBuiltRoute, b: AsBuiltRoute) =>
    a.port.localeCompare(b.port) || a.bit - b.bit || a.channel - b.channel;
  return JSON.stringify({
    version: 1,
    board,
    generatedAt: new Date().toISOString(),
    routes: {
      adcPins: [...facts.adc].sort(byPin),
      pwmPins: [...facts.pwm].sort(byPin),
      dacPins: [...facts.dac].sort(byPin),
    },
  }, null, 1);
}
