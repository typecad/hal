#!/usr/bin/env node
// ---------------------------------------------------------------------------
// gen-zephyr-hal-tokens.mjs — generate the thin-HAL token tables from the
// pinned Zephyr tree's own headers.
//
//   node scripts/gen-zephyr-hal-tokens.mjs [zephyr-base]
//     (default base: the west workspace at ~/zephyrproject/zephyr)
//
// Emits packages/hal/src/zephyr-tokens.generated.ts:
//   ZEPHYR_ADC_GAINS       enum adc_gain suffixes        (include/zephyr/drivers/adc.h)
//   ZEPHYR_ADC_REFERENCES  enum adc_reference suffixes   (same)
//   ZEPHYR_GPIO_FLAGS      config-flag name set          (drivers/gpio.h + dt-bindings/gpio/gpio.h)
//   ZEPHYR_GPIO_INTS       interrupt-config name set     (drivers/gpio.h)
//
// The class statics (ADC.GAIN_*, GPIO.OUTPUT, …) stay hand-declared
// for editor typing — tests/packages/hal/token-sync.test.ts asserts the
// declared sets equal these generated ones, so a Zephyr revision that adds
// or renames a token fails CI until the class is updated. The lowerings'
// token→macro maps derive from these lists directly (no hand copies).
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2]
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', 'zephyrproject', 'zephyr');
const read = (p) => fs.readFileSync(path.join(base, p), 'utf-8');

const versionFile = read('VERSION');
const version = ['VERSION_MAJOR', 'VERSION_MINOR', 'PATCHLEVEL']
  .map((k) => versionFile.match(new RegExp(`${k} = (\\d+)`))?.[1])
  .join('.');

const adcH = read('include/zephyr/drivers/adc.h');
const gpioDrvH = read('include/zephyr/drivers/gpio.h');
const gpioDtH = read('include/zephyr/dt-bindings/gpio/gpio.h');

function enumNames(header, enumName, prefix) {
  const body = header.match(new RegExp(`enum\\s+${enumName}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? '';
  return [...body.matchAll(new RegExp(`\\b${prefix}_(\\w+)\\b`, 'g'))]
    .map((m) => m[1])
    .filter((v, i, a) => a.indexOf(v) === i);
}

const gains = enumNames(adcH, 'adc_gain', 'ADC_GAIN');
const refs = enumNames(adcH, 'adc_reference', 'ADC_REF');
if (gains.length < 5 || refs.length < 3) {
  console.error(`parse failed: gains=${gains.length} refs=${refs.length} — header format changed?`);
  process.exit(1);
}

const defineExists = (src, name) => new RegExp(`^#define\\s+${name}\\b`, 'm').test(src);
const gpioFlagNames = [
  'INPUT', 'OUTPUT', 'OUTPUT_INIT_LOW', 'OUTPUT_INIT_HIGH',
  'PULL_UP', 'PULL_DOWN', 'OPEN_DRAIN', 'OPEN_SOURCE', 'DISCONNECTED',
].filter((n) => defineExists(gpioDrvH, `GPIO_${n}`) || defineExists(gpioDtH, `GPIO_${n}`));
const gpioIntNames = [
  'INT_DISABLE', 'INT_EDGE_RISING', 'INT_EDGE_FALLING', 'INT_EDGE_BOTH',
  'INT_LEVEL_LOW', 'INT_LEVEL_HIGH',
].filter((n) => defineExists(gpioDrvH, `GPIO_${n}`));
if (gpioFlagNames.length < 6 || gpioIntNames.length < 4) {
  console.error(`parse failed: flags=${gpioFlagNames.length} ints=${gpioIntNames.length}`);
  process.exit(1);
}

const out = `// ---------------------------------------------------------------------------
// zephyr-tokens.generated.ts — the thin-HAL token name sets
//
// GENERATED FILE — do not edit by hand. Regenerate against the pinned
// workspace with:
//
//   node scripts/gen-zephyr-hal-tokens.mjs <zephyr-base>
//
// Derived from Zephyr ${version}: enum adc_gain / enum adc_reference
// (include/zephyr/drivers/adc.h), the GPIO config flags (drivers/gpio.h +
// dt-bindings/gpio/gpio.h), and the GPIO_INT_* interrupt configurations
// (drivers/gpio.h). ${gains.length} gains, ${refs.length} references,
// ${gpioFlagNames.length} flags, ${gpioIntNames.length} interrupt configs.
//
// The class statics stay hand-declared for editor typing; the token-sync
// test asserts they match these sets. The lowerings build their
// token→macro maps from these lists — names only; values never cross to C++.
// ---------------------------------------------------------------------------

/** enum adc_gain suffixes — ADC.GAIN_<name> ↔ ADC_GAIN_<name>. */
export const ZEPHYR_ADC_GAINS: readonly string[] = [
${gains.map((g) => `  '${g}',`).join('\n')}
];

/** enum adc_reference suffixes — ADC.REF_<name> ↔ ADC_REF_<name>. */
export const ZEPHYR_ADC_REFERENCES: readonly string[] = [
${refs.map((r) => `  '${r}',`).join('\n')}
];

/** GPIO config flag names — GPIO.<name> ↔ GPIO_<name>. */
export const ZEPHYR_GPIO_FLAGS: readonly string[] = [
${gpioFlagNames.map((f) => `  '${f}',`).join('\n')}
];

/** GPIO interrupt configuration names — GPIO.INT_<name> ↔ GPIO_INT_<name>. */
export const ZEPHYR_GPIO_INTS: readonly string[] = [
${gpioIntNames.map((f) => `  '${f}',`).join('\n')}
];
`;

const outPath = path.resolve('packages/hal/src/zephyr-tokens.generated.ts');
fs.writeFileSync(outPath, out);
console.log(`wrote ${path.relative(process.cwd(), outPath)} from Zephyr ${version}`);
console.log(`  gains: ${gains.join(', ')}`);
console.log(`  refs: ${refs.join(', ')}`);
console.log(`  flags: ${gpioFlagNames.join(', ')}`);
console.log(`  ints: ${gpioIntNames.join(', ')}`);
