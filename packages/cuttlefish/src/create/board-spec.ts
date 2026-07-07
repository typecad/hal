// ---------------------------------------------------------------------------
// board-spec.ts — Zod schema + types for the .jsonc chip spec consumed by
// `cuttlefish board add`. The spec is a human-authored description of the
// silicon + board; the codegen transforms it into package source files.
// ---------------------------------------------------------------------------

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Comment stripper — .jsonc → JSON. Strips // line comments and /* */ blocks
// while respecting string literals (a // inside a string is not a comment).
// ---------------------------------------------------------------------------

export function stripJsonc(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    // String literal — copy verbatim until closing quote
    if (ch === '"') {
      result += ch;
      i++;
      while (i < text.length) {
        result += text[i];
        if (text[i] === '\\' && i + 1 < text.length) {
          result += text[i + 1];
          i += 2;
          continue;
        }
        if (text[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }
    // Line comment // ... \n
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    // Block comment /* ... */
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    result += ch;
    i++;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const PinFunctionSchema = z.object({
  type: z.enum(['i2c', 'spi', 'uart', 'adc', 'dac', 'pwm', 'touch', 'usb']),
  instance: z.number().int(),
  role: z.string(),
}).strict();

const PinSpecSchema = z.object({
  gpio: z.number().int(),
  capabilities: z.enum([
    'FULL_GPIO', 'FULL_GPIO_ANALOG', 'FULL_GPIO_TOUCH',
    'FULL_GPIO_ANALOG_TOUCH', 'FULL_GPIO_DAC', 'INPUT_ONLY',
  ]),
  functions: z.array(PinFunctionSchema).optional(),
  alt: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  unsafe: z.boolean().optional(),
  notes: z.string().optional(),
  onboardLed: z.boolean().optional(),
}).strict();

const PeripheralInstanceSchema = z.object({
  instance: z.number().int(),
  defaultPins: z.record(z.string(), z.string()),
  alternatePins: z.record(z.string(), z.array(z.string())).optional(),
}).strict();

const AdcSchema = z.object({
  instance: z.number().int(),
  channels: z.number().int(),
  resolution: z.number().int(),
  referenceVoltage: z.number(),
  maxValue: z.number().int(),
  referenceVoltages: z.record(z.string(), z.number()).optional(),
}).strict();

const BusPinMapSchema = z.record(z.string(), z.object({
  sda: z.string().optional(),
  scl: z.string().optional(),
  mosi: z.string().optional(),
  miso: z.string().optional(),
  sck: z.string().optional(),
  cs: z.string().optional(),
  tx: z.string().optional(),
  rx: z.string().optional(),
}).strict());

// ---------------------------------------------------------------------------
// Top-level spec schema
// ---------------------------------------------------------------------------

export const BoardSpecSchema = z.object({
  // Identity
  architecture: z.string().min(1),
  mcuId: z.string().min(1),
  mcuName: z.string().min(1),
  boardId: z.string().min(1),
  boardName: z.string().min(1),
  vendor: z.string().min(1),
  description: z.string().optional(),

  // Build
  clockSpeed: z.number().int(),
  fqbn: z.string().min(1),
  platformioTarget: z.string().min(1),
  arduinoDefine: z.string().min(1),

  // Memory (module-level; silicon memory is derived)
  moduleFlash: z.number().int().nullable(),
  externalRam: z.number().int().nullable(),

  // GPIO range
  gpioRange: z.tuple([z.number().int(), z.number().int()]),
  excludedGpio: z.array(z.number().int()),

  // Pin data
  pins: z.array(PinSpecSchema),
  unsafe: z.array(z.string()),
  analog: z.array(z.string()),

  // Bus maps
  i2c: BusPinMapSchema,
  spi: BusPinMapSchema,
  uart: BusPinMapSchema,

  // Peripherals
  peripheralInstances: z.object({
    i2c: z.array(PeripheralInstanceSchema),
    spi: z.array(PeripheralInstanceSchema),
    uart: z.array(PeripheralInstanceSchema),
  }).strict(),
  adc: z.array(AdcSchema),
  pwm: z.object({
    channels: z.number().int(),
    resolution: z.number().int(),
    maxFrequency: z.number().int(),
  }).strict(),
  touch: z.object({
    channels: z.number().int(),
    pins: z.array(z.string()),
  }).nullable().optional(),
  timers: z.array(z.object({
    instance: z.number().int(),
    type: z.enum(['general', 'high_speed', 'rtc', 'sys']),
    bits: z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64)]),
    features: z.array(z.enum(['pwm', 'capture', 'compare', 'interrupt', 'dma'])).optional(),
  }).strict()),

  // Connectivity
  wifi: z.object({
    type: z.enum(['wifi', 'wifi6']),
    supportsStation: z.boolean(),
    supportsAp: z.boolean(),
  }).strict(),
  bluetooth: z.object({
    type: z.enum(['classic', 'ble', 'dual']),
    version: z.string(),
  }).strict(),
  usb: z.object({
    type: z.enum(['device', 'host', 'otg']),
    vid: z.string(),
    pid: z.string(),
  }).strict(),

  // Features
  features: z.object({
    multicore: z.boolean(),
    coreCount: z.number().int(),
    deepSleep: z.boolean(),
    watchdog: z.boolean(),
    externalInterrupts: z.boolean(),
    hardwareRng: z.boolean(),
    fpu: z.boolean(),
  }).strict(),

  // Silicon memory
  memory: z.object({
    flash: z.number().int(),
    sram: z.number().int(),
    eeprom: z.number().int(),
    externalRam: z.number().int().optional(),
    rtcMemory: z.number().int().optional(),
  }).strict(),
}).strict();

export type BoardSpec = z.infer<typeof BoardSpecSchema>;

// ---------------------------------------------------------------------------
// Parse + validate a .jsonc string
// ---------------------------------------------------------------------------

export function parseBoardSpec(jsoncText: string): BoardSpec {
  const jsonText = stripJsonc(jsoncText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`Invalid JSON in spec file: ${(e as Error).message}`);
  }
  return BoardSpecSchema.parse(parsed);
}

export function safeParseBoardSpec(jsoncText: string):
  | { success: true; spec: BoardSpec }
  | { success: false; errors: string[] } {
  try {
    const spec = parseBoardSpec(jsoncText);
    return { success: true, spec };
  } catch (e) {
    if (e instanceof z.ZodError) {
      const errors = e.issues.map(issue => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      });
      return { success: false, errors };
    }
    return { success: false, errors: [(e as Error).message] };
  }
}
