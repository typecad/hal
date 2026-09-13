// ---------------------------------------------------------------------------
// board-facts.test.ts — the pure parser/resolver behind the TypeCAD
// extension's variable hovers. The module under test imports no 'vscode', so
// the monorepo suite exercises it directly; the provider glue in intel.ts is
// a thin shell over these two functions.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  parseBoardModule,
  parseBoardJson,
  resolveIdentifierHover,
  scanDecorations,
  isCodePosition,
} from '../../../packages/vscode-typecad-hal/src/board-facts';

// Shaped like a real generated module: doc'd pin, bare pin, alias, chained
// alias, doc'd bus, PWM-led virtual instance, and the class re-export line.
const BOARD_TS = [
  "export { Time, GPIO, abs } from '@typecad/hal/core';",
  "export { Watchdog, Store, File, Counter } from '@typecad/hal/core';",
  "export const PA0 = Pin.fromPort('PA0');",
  '/** PWM pwm2 ch1 · ADC adc1 ch0 · aliases: BUTTON */',
  "export const PA1 = Pin.fromPort('PA1');",
  "export const I2C0 = new I2CBus('I2C0');",
  '/** Board-wired I2C bus 1 (SDA=PB7, SCL=PB8). */',
  "export const I2C1 = new I2CBus('I2C1');",
  '/** Board PWM-driven LED (already constructed — call setDuty() to dim it). */',
  'export const PWMLED = new PWM(8192, { periodNs: 1000000 });',
  '/** On-board LED. */',
  'export const LED = PA0;',
  'export const L = LED;',
  'export const BUTTON = PA1;',
  '',
].join('\n');

const BOARD_JSON = JSON.stringify({
  version: 1,
  identifier: 'testpill/stm32f411xe',
  constants: {
    'zephyr.storage.offset': 507904,
    'zephyr.storage.size': 65536,
    'zephyr.storage.preexisting': false,
    'zephyr.hwtimer.controllers.0.nodeLabel': 'rtc',
    'zephyr.hwtimer.controllers.1.nodeLabel': 'tim2',
    'zephyr.wdt.nodeLabel': 'iwdg',
    'zephyr.console': 'usart1',
  },
});

const facts = parseBoardModule(BOARD_TS, BOARD_JSON);

describe('parseBoardModule', () => {
  it('captures pins with and without fact docs', () => {
    expect(facts.exports.get('PA0')).toEqual({ kind: 'pin', name: 'PA0' });
    expect(facts.exports.get('PA1')).toEqual({
      kind: 'pin',
      name: 'PA1',
      doc: 'PWM pwm2 ch1 · ADC adc1 ch0 · aliases: BUTTON',
    });
  });

  it('captures bus instances with their JSDoc', () => {
    expect(facts.exports.get('I2C1')).toEqual({
      kind: 'bus',
      label: 'I2C1',
      doc: 'Board-wired I2C bus 1 (SDA=PB7, SCL=PB8).',
    });
    expect(facts.exports.get('PWMLED')?.kind).toBe('bus');
    expect(facts.exports.get('I2C0')).toEqual({ kind: 'bus', label: 'I2C0' });
  });

  it('resolves aliases to the target pin, transitively', () => {
    expect(facts.exports.get('LED')).toEqual({ kind: 'pin', name: 'PA0' });
    expect(facts.exports.get('L')).toEqual({ kind: 'pin', name: 'PA0' });
  });

  it('collects the module class exports and the board.json facts', () => {
    expect(facts.classExports.has('Store')).toBe(true);
    expect(facts.classExports.has('Counter')).toBe(true);
    expect(facts.classExports.has('Time')).toBe(true);
    expect(facts.boardInfo?.storage).toEqual({ offsetBytes: 507904, sizeBytes: 65536, preexisting: false });
    expect(facts.boardInfo?.counters).toEqual(['rtc', 'tim2']);
    expect(facts.boardInfo?.watchdog).toBe('iwdg');
    expect(facts.boardInfo?.console).toBe('usart1');
  });

  it('parseBoardJson tolerates malformed JSON', () => {
    expect(parseBoardJson('{oops')).toEqual({ counters: [] });
  });
});

describe('resolveIdentifierHover (variable bindings)', () => {
  const doc = [
    "import { PA1, LED, I2C1, PWMLED, GPIO } from '@typecad/hal';",
    'const adc = new ADC(PA1);',
    'const dim = new PWM(PA1, { periodNs: 20000000 });',
    'const sense = PA1;',
    'const lamp = LED;',
    'const therm = I2C1.device(0x48);',
    'const plain = compute(5);',
    'const flag = GPIO.OUTPUT;',
    // Semicolon-less declarations (the scaffold/demo style) resolve too.
    'const adcNs = new ADC(PA1)',
    'const senseNs = PA1',
    '',
  ].join('\n');

  it('shows the constructed class with its pin facts', () => {
    const hover = resolveIdentifierHover(doc, facts, 'adc')!;
    expect(hover.title).toBe('ADC — on PA1');
    expect(hover.detail).toContain('ADC adc1 ch0');
  });

  it('resolves semicolon-less declarations', () => {
    expect(resolveIdentifierHover(doc, facts, 'adcNs')?.title).toBe('ADC — on PA1');
    expect(resolveIdentifierHover(doc, facts, 'senseNs')?.title).toBe('PA1 — pin alias of PA1');
  });

  it('finds pin args among non-pin arguments', () => {
    const hover = resolveIdentifierHover(doc, facts, 'dim')!;
    expect(hover.title).toBe('PWM — on PA1');
    expect(hover.detail).toContain('PWM pwm2 ch1');
  });

  it('resolves pin-alias variables', () => {
    expect(resolveIdentifierHover(doc, facts, 'sense')?.title).toBe('PA1 — pin alias of PA1');
    expect(resolveIdentifierHover(doc, facts, 'lamp')?.title).toBe('PA0 — pin alias of LED');
  });

  it('resolves devices constructed on a board bus', () => {
    const hover = resolveIdentifierHover(doc, facts, 'therm')!;
    expect(hover.title).toBe('I2C1 — board bus');
    expect(hover.detail).toContain('SDA=PB7');
  });

  it('returns undefined for bindings without hardware facts', () => {
    expect(resolveIdentifierHover(doc, facts, 'plain')).toBeUndefined();
    expect(resolveIdentifierHover(doc, facts, 'flag')).toBeUndefined();
    expect(resolveIdentifierHover(doc, facts, 'notDeclared')).toBeUndefined();
  });
});

describe('resolveIdentifierHover (class, sensor, and program facts)', () => {
  it('shows storage facts for Store/File when the board module exports them', () => {
    const hover = resolveIdentifierHover('const cfg = new Store(1);', facts, 'Store')!;
    expect(hover.title).toBe('Store — persistent storage');
    expect(hover.detail).toContain('64 KB at flash offset 0x7c000');
    expect(hover.detail).toContain('synthesized at flash top');
    expect(resolveIdentifierHover('x', facts, 'File')?.title).toBe('File — persistent storage');
  });

  it('lists free hardware counters and the watchdog fact', () => {
    expect(resolveIdentifierHover('x', facts, 'Counter')?.detail).toBe('2 free: rtc, tim2');
    expect(resolveIdentifierHover('x', facts, 'Watchdog')?.detail).toBe(
      'Wired on this board — resets the board on timeout unless fed.',
    );
  });

  it('stays silent for classes the board module does not export', () => {
    const bare = parseBoardModule("export { Time } from '@typecad/hal/core';");
    expect(resolveIdentifierHover('x', bare, 'Store')).toBeUndefined();
  });

  it('resolves sensor catalog tokens', () => {
    const sensors = {
      bme688: {
        compatible: 'bosch,bme688',
        buses: ['i2c', 'spi'],
        description: 'BME688 environmental sensor',
        channels: ['TEMPERATURE', 'HUMIDITY', 'PRESSURE'],
      },
    };
    const hover = resolveIdentifierHover(
      "const env = new Sensor(SENSOR('bme688'));",
      facts,
      'bme688',
      { sensors },
    )!;
    expect(hover.title).toBe("SENSOR('bme688')");
    expect(hover.detail).toContain('bosch,bme688');
    expect(hover.detail).toContain('TEMPERATURE');
    // Without the catalog loaded, the token falls through to tsserver.
    expect(resolveIdentifierHover("SENSOR('bme688')", facts, 'bme688')).toBeUndefined();
  });

  it('joins the program pin usage into pin hovers', () => {
    const programPinUsage = [
      { pinName: 'PA1', mode: 'input', peripheralRole: 'dimmer-sense' },
    ];
    // Direct board export: only the program line is added (tsserver owns
    // the static facts) — and nothing when the program does not use it.
    const direct = resolveIdentifierHover('f(PA1)', facts, 'PA1', { programPinUsage })!;
    expect(direct.title).toBe('In this project');
    expect(direct.detail).toBe('In this project: input (dimmer-sense)');
    expect(resolveIdentifierHover('f(PA0)', facts, 'PA0', { programPinUsage })).toBeUndefined();

    // Constructions and aliases append the usage beneath the board facts.
    const doc = 'const adc = new ADC(PA1);\nconst s = PA1;';
    expect(resolveIdentifierHover(doc, facts, 'adc', { programPinUsage })?.detail).toContain('In this project: input (dimmer-sense)');
    expect(resolveIdentifierHover(doc, facts, 's', { programPinUsage })?.detail).toContain('In this project: input');
  });
});

describe('scanDecorations (after-line fact chips)', () => {
  it('chips construction lines with the resolved pin and its facts', () => {
    const doc = [
      "import { PA1, PA0, PA1 as BUTTON, I2C1 } from '@typecad/hal';",
      'const adc = new ADC(PA1);',
      'const bare = new GPIO(PA0, GPIO.OUTPUT);',
      'const therm = I2C1.device(0x48);',
      '// const commented = new ADC(PA1);',
      '',
    ].join('\n');
    const chips = scanDecorations(doc, facts);
    // Line 1: PA1 carries facts (name-first); line 2: PA0 is bare and the
    // code spells its name (nothing to add); line 3: the bus's pad map;
    // line 4 is a comment — skipped.
    expect(chips).toEqual([
      { line: 1, text: '⌁ PA1 · PWM pwm2 ch1 · ADC adc1 ch0 · aliases: BUTTON' },
      { line: 3, text: '⌁ Board-wired I2C bus 1 (SDA=PB7, SCL=PB8).' },
    ]);
  });

  it('resolves alias arguments to the datasheet pin, without echoing the alias', () => {
    // LED and L both alias PA0 (bare pin): the chip names PA0 even though
    // the code never spells it.
    const aliased = 'const led = new GPIO(LED, GPIO.OUTPUT);';
    expect(scanDecorations(aliased, facts)).toEqual([{ line: 0, text: '⌁ PA0' }]);
    // BUTTON aliases PA1, whose facts include "aliases: BUTTON" — the
    // self-echoing alias is stripped, the rest of the doc stays.
    const button = 'const btn = new GPIO(BUTTON, GPIO.INPUT);';
    expect(scanDecorations(button, facts)).toEqual([
      { line: 0, text: '⌁ PA1 · PWM pwm2 ch1 · ADC adc1 ch0' },
    ]);
  });

  it('truncates long chips and skips unknown identifiers', () => {
    const longDoc = 'const x = new ADC(PA1);';
    const [chip] = scanDecorations(longDoc, facts, 10);
    expect(chip.text.length).toBeLessThanOrEqual(10 + 2); // '⌁ ' + 10 chars
    expect(chip.text.endsWith('…')).toBe(true);
    expect(scanDecorations('const y = new ADC(UNKNOWN_PIN);', facts)).toEqual([]);
  });

  it('does not chip construction-like text inside strings or template literals', () => {
    const doc = [
      'const msg = "use new ADC(PA1) here";',
      'const tpl = `see new ADC(PA1) docs`;',
      'const live = `adc: ${new ADC(PA1).read()}`;',
      '',
    ].join('\n');
    const chips = scanDecorations(doc, facts);
    // Only the construction inside the live ${…} interpolation is code.
    expect(chips.map((c) => c.line)).toEqual([2]);
    expect(chips[0]!.text).toContain('PA1');
  });
});

describe('isCodePosition (word vs string/comment text)', () => {
  // The user-reported line: two "adc" words, one in the template's literal
  // part (text), one inside the interpolation (code).
  const line = 'USB0.writeLine(`adc: ${adc.readMillivolts()}`);';
  const textAdc = line.indexOf('adc:');
  const codeAdc = line.indexOf('${') + 2;

  it('discriminates the two adc words on the reported line', () => {
    expect(isCodePosition(line, textAdc)).toBe(false);
    expect(isCodePosition(line, codeAdc)).toBe(true);
  });

  it('classifies strings, comments, and nested templates', () => {
    expect(isCodePosition("const s = 'PA1';", 11)).toBe(false); // inside '…'
    expect(isCodePosition('const s = "it\'s PA1";', 15)).toBe(false); // escaped quote stays a string
    expect(isCodePosition('// pin PA1', 8)).toBe(false); // line comment
    expect(isCodePosition('/* pin\nPA1 */ x', 9)).toBe(false); // block comment across lines
    expect(isCodePosition('const x = { a: 1 };', 17)).toBe(true); // braces in code stay code
    // Nested templates: the inner template's literal part is text, its
    // interpolation is code again.
    const nested = 'const v = `a${`b${PA1}`}c`;';
    expect(isCodePosition(nested, nested.indexOf('b${') + 1)).toBe(false); // 'b' literal part
    expect(isCodePosition(nested, nested.indexOf('PA1'))).toBe(true);
    expect(isCodePosition(nested, nested.lastIndexOf('c`'))).toBe(false); // trailing literal part
  });
});
