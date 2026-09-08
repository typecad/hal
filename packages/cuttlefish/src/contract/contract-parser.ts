// ---------------------------------------------------------------------------
// Contract parser — reads a TypeCAD hardware contract (*.contract.json)
//
// A contract is produced by the sister project typecad.net (TypeScript +
// KiCAD). It describes the physical connections of an MCU on a designed PCB:
// which pins are wired, to what nets, and which peripherals (I2C/SPI/UART)
// are available. This module parses that file and narrows it against an MCU
// package's TypeCADManifest to find the concrete MCU pin/peripheral names
// that the firmware is allowed to touch.
//
// The matched names feed board-generator.ts, which writes a narrowed
// `.typecad-hal/board.ts` so that `import { ... } from '@typecad/hal'`
// exposes only the pins the actual PCB has wired — a pin used elsewhere on
// the board becomes a compile error in the firmware.
//
// Zod is used (rather than a plain JSON.parse + cast) because the contract is
// a cross-project interchange format: it crosses a trust boundary from a
// different codebase (typecad.net) with its own release cadence. Precise
// validation at this boundary turns silent "board generated with no pins"
// failures into clear "expected boolean, received string at
// availablePeripherals.i2c" errors. zod is already a runtime dependency of
// cuttlefish (config-schema.ts).
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Contract schema — the authoritative shape of a *.contract.json file.
//
// The types exported below (HwContract, ContractPin, ...) are DERIVED from
// this schema via z.infer, so the runtime validation and the compile-time
// type cannot drift. This mirrors the shape produced by
// typeCAD/@typecad/typecad/src/contract.ts; the schema is the local source of
// truth so cuttlefish pins to a stable contract format regardless of
// typecad.net's internal evolution.
// ---------------------------------------------------------------------------

/** Contract schema version. Only 1 is currently defined. */
export const CONTRACT_VERSION = 1 as const;

/**
 * An external component on the same net as an MCU pin. Validated LENIENTLY:
 * cuttlefish does not act on component metadata, so we only require the fields
 * the firmware toolchain reads (reference + dnp) and accept unknown extras
 * (voltage, wattage, tolerance, ...) without rejecting the contract. This
 * keeps cuttlefish forward-compatible with typecad.net adding component fields.
 */
const ContractComponentSchema = z.object({
  reference: z.string(),
  dnp: z.boolean(),
}).passthrough();

/**
 * Info about a single connected MCU pin. The fields cuttlefish consumes
 * (pinName, pinType, net) are required; boardName is optional (present only
 * when typecad.net's Component.typehal map was set).
 */
const ContractPinSchema = z.object({
  pinName: z.string(),
  pinType: z.string(),
  boardName: z.string().optional(),
  net: z.string(),
  externalComponents: z.array(ContractComponentSchema).default([]),
}).strict();

/** Which peripheral buses have all their required pins wired. */
const AvailablePeripheralsSchema = z.object({
  i2c: z.boolean(),
  spi: z.boolean(),
  uart: z.boolean(),
}).strict();

/** MCU identifying metadata. Only `symbol` is load-bearing for cuttlefish. */
const ContractMcuSchema = z.object({
  symbol: z.string(),
}).passthrough();

/**
 * The top-level contract object. `.strict()` so a future v2 contract with new
 * top-level keys is rejected clearly (complementing the version check) rather
 * than silently accepted with the new fields dropped.
 */
export const HwContractSchema = z.object({
  version: z.literal(CONTRACT_VERSION),
  mcu: ContractMcuSchema,
  connectedPins: z.record(z.string(), ContractPinSchema),
  availablePeripherals: AvailablePeripheralsSchema,
}).strict();

// ---------------------------------------------------------------------------
// Derived types — the compile-time shape, derived from the runtime schema so
// validation and types can never disagree.
// ---------------------------------------------------------------------------

export type ContractComponent = z.infer<typeof ContractComponentSchema>;
export type ContractPin = z.infer<typeof ContractPinSchema>;
export type AvailablePeripherals = z.infer<typeof AvailablePeripheralsSchema>;
export type HwContract = z.infer<typeof HwContractSchema>;

// ---------------------------------------------------------------------------
// KiCAD electrical-type and net-name tables for power-pin exclusion.
// ---------------------------------------------------------------------------

/** KiCAD pin types that are not user GPIO and must not be re-exported as digital pins. */
const NON_GPIO_PIN_TYPES = new Set([
  'power_in',
  'power_out',
  'passive', // typically decoupling/nc ties
]);

/** Net names that indicate a power/ground rail, not a signal. */
const POWER_NET_NAMES = new Set(['VCC', 'GND', 'VDD', 'VSS', '+3V3', '+5V', 'AVCC', 'AREF']);

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Reformats a ZodError into a single readable, path-annotated message.
 * Zod's default .message is a JSON blob; users want "at availablePeripherals.i2c:
 * expected boolean, received string".
 */
function formatZodError(err: z.ZodError, contractPath: string): string {
  const issues = err.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `  at ${path}: ${issue.message}`;
  });
  return `Contract ${contractPath} failed validation:\n${issues.join('\n')}`;
}

/**
 * Parses a TypeCAD contract file.
 *
 * The version is checked first as a fast path so a v2 (or later) contract
 * fails with "unsupported version, update cuttlefish" rather than a cascade
 * of field-mismatch errors. After the version check, the full schema is
 * applied for precise per-field validation.
 *
 * @throws on an unreadable file, invalid JSON, unsupported version, or
 *   schema-validation failure (with a path-annotated message).
 */
export function parseContractFile(contractPath: string): HwContract {
  let content: string;
  try {
    content = fs.readFileSync(contractPath, 'utf-8');
  } catch (err) {
    throw new Error(`Could not read contract file at ${contractPath}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Contract file ${contractPath} is not valid JSON: ${(err as Error).message}`);
  }

  // Fast path: reject an unsupported version before the full schema runs, so
  // the error names the real problem rather than listing every field that
  // differs from v1.
  const version = (parsed as { version?: unknown })?.version;
  if (version !== CONTRACT_VERSION) {
    throw new Error(
      `Unsupported contract version in ${contractPath}: expected ${CONTRACT_VERSION}, got ${String(version)}. ` +
        `This may be a newer contract format; update @typecad/cuttlefish.`,
    );
  }

  // Full schema validation.
  try {
    return HwContractSchema.parse(parsed);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(formatZodError(err, contractPath));
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Matching — narrows the contract against an MCU package's manifest.
// ---------------------------------------------------------------------------

/**
 * Returns true if a contract pin represents a power/ground/decoupling connection
 * rather than a usable GPIO. Such pins must not be re-exported as digital pins.
 */
function isPowerPin(pin: ContractPin): boolean {
  if (NON_GPIO_PIN_TYPES.has(pin.pinType)) return true;
  if (POWER_NET_NAMES.has(pin.net)) return true;
  // KiCAD auto-generated nets like "net6" are signal nets; named power rails are not.
  return false;
}

/**
 * Matches contract pins to canonical MCU pin names (e.g. 'PB5', 'PC4').
 *
 * Strategy (boardName-first, substring fallback):
 *   1. If the contract pin carries a `boardName` (populated by typecad.net when
 *      Component.typehal was set) and that name appears in mcuPinNames, use it
 *      directly — it is the user-validated mapping.
 *   2. Otherwise, substring-match the KiCAD `pinName` against mcuPinNames
 *      (e.g. "XTAL1/PB6" contains "PB6"). This covers contracts emitted without
 *      a typehal map.
 *
 * Power/ground pins are excluded. The result is de-duplicated.
 */
export function matchConnectedPins(contract: HwContract, mcuPinNames: readonly string[]): string[] {
  const mcuSet = new Set(mcuPinNames);
  const matched = new Set<string>();

  for (const pin of Object.values(contract.connectedPins)) {
    if (isPowerPin(pin)) continue;

    // (1) boardName-first: explicit, firmware-friendly mapping.
    if (pin.boardName && mcuSet.has(pin.boardName)) {
      matched.add(pin.boardName);
      continue;
    }

    // (2) substring fallback: the MCU port name appears inside the KiCAD pin name.
    // Compound KiCAD names like "XTAL1/PB6" or "~{RESET}/PC6" are split on "/"
    // and each segment is checked so we don't false-match on a prefix.
    const segments = pin.pinName.replace(/[~{}]/g, '').split(/[/-]/);
    for (const mcuPin of mcuPinNames) {
      if (segments.includes(mcuPin)) {
        matched.add(mcuPin);
        break;
      }
    }
  }

  return Array.from(matched);
}

/**
 * Selects which MCU peripheral instance names to re-export based on the
 * contract's availablePeripherals. If the contract says SPI isn't wired,
 * SPI0 (and friends) is dropped from the narrowed board — so `SPI0.begin()`
 * becomes a compile error on a board whose PCB doesn't route SPI.
 */
export function selectPeripherals(
  contract: HwContract,
  mcuPeripheralNames: readonly string[],
): string[] {
  const avail = contract.availablePeripherals ?? { i2c: false, spi: false, uart: false };
  return mcuPeripheralNames.filter((name) => {
    // Match instance-family prefixes: I2C0/I2C1 → "i2c", SPI0/SPI1 → "spi", UART0 → "uart".
    if (/^I2C\d/.test(name)) return avail.i2c;
    if (/^SPI\d/.test(name)) return avail.spi;
    if (/^UART\d/.test(name)) return avail.uart;
    // Unknown peripheral families are preserved (don't silently drop something we don't recognize).
    return true;
  });
}

/**
 * The canonical MCU pad names the contract declares wired — boardName when
 * typecad.net carried a mapping, else the KiCAD pin-name segment that looks
 * like a datasheet pad (PA5, PB6, P0.28, GPIO9). De-duplicated, order
 * preserved. This replaces the old soc-manifest pinNames source: under
 * SDK-as-truth the contract itself declares the wired pads.
 */
export function contractPinNames(contract: HwContract): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const pin of Object.values(contract.connectedPins)) {
    if (isPowerPin(pin)) continue;
    if (pin.boardName && !seen.has(pin.boardName)) {
      seen.add(pin.boardName);
      out.push(pin.boardName);
      continue;
    }
    const segments = pin.pinName.replace(/[~{}]/g, '').split(/[/-]/);
    const padLike = segments.find((seg) => /^(?:P[A-Za-z]\d|P\d\.\d{1,2}|GPIO\d{1,2}|GP\d{1,2})$/i.test(seg));
    if (padLike && !seen.has(padLike.toUpperCase())) {
      seen.add(padLike.toUpperCase());
      out.push(padLike.toUpperCase());
    }
  }
  return out;
}

/** One wired pad: the MCU datasheet name plus an optional functional alias. */
export interface ContractPad {
  /** Datasheet-form pad name (PA9, P0.28, GP25) — what boardgen can place. */
  mcuName: string;
  /** Functional name from the schematic (TX, RX, LED) when boardName is not
   *  itself a pad name. Exported as an alias pointing at the pad. */
  alias?: string;
}

/** A pad-form name in any supported family notation. */
function isPadName(name: string): boolean {
  return /^(?:P[A-Pa-p]\d{1,2}|P\d\.\d{1,2}|GPIO\d{1,2}|GP\d{1,2})$/.test(name.trim());
}

/**
 * The wired pads of the contract, as MCU datasheet names plus optional
 * functional aliases. For each non-power pin: boardName is preferred when
 * it is itself pad-form (PA9); otherwise the KiCAD pin-name segments are
 * searched for a pad-form name ("XTAL1/PB6" → PB6). When boardName is set
 * but NOT pad-form (TX, LED), it rides along as the pad's alias.
 *
 * This replaces the old soc-manifest pinNames source: under SDK-as-truth
 * the contract declares the wired pads itself.
 */
export function contractPads(contract: HwContract): ContractPad[] {
  const out: ContractPad[] = [];
  const seen = new Set<string>();
  for (const pin of Object.values(contract.connectedPins)) {
    if (isPowerPin(pin)) continue;
    let pad: string | undefined;
    let alias: string | undefined;
    if (pin.boardName && isPadName(pin.boardName)) {
      pad = pin.boardName.toUpperCase().replace(/^P([AP]) (\d{1,2})$/, 'P$1.$2');
    }
    if (!pad) {
      const segments = pin.pinName.replace(/[~{}]/g, '').split(/[/-]/);
      pad = segments.find((seg) => isPadName(seg));
    }
    if (!pad) continue;
    pad = pad.toUpperCase();
    if (pin.boardName && pin.boardName !== pad) alias = pin.boardName;
    if (seen.has(pad)) {
      // Same pad, new functional alias — keep the alias on the existing pad
      // (a pad can be exported under two names).
      if (alias) {
        const existing = out.find((p) => p.mcuName === pad);
        if (existing && !existing.alias) existing.alias = alias;
      }
      continue;
    }
    seen.add(pad);
    out.push({ mcuName: pad, ...(alias ? { alias } : {}) });
  }
  return out;
}
