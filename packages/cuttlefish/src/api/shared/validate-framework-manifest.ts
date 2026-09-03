// ---------------------------------------------------------------------------
// Framework manifest validator
//
// Cross-checks each manifest claim against the loaded PlatformStrategy,
// Toolchain, and module exports. Errors are plain data (not thrown) so the
// validator can be called from tests, a future CLI, or agents reading errors
// programmatically.
//
// Categories A-H are documented in docs/framework-manifest-error-codes.md.
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { PlatformStrategy } from './platform-strategy.js';
import type { FrameworkToolchain } from '../../framework-registry.js';
import type { FrameworkManifest } from './framework-manifest.js';
import { POLYFILL_BACKED_OPS } from './framework-manifest.js';
import { HAL_OPERATION_KINDS } from './hal-op-ir.js';
import { DISPLAY_OPERATION_KINDS } from './display-op-ir.js';
import type { HALOpIR } from './hal-op-ir.js';
import type { DisplayHALOp } from './display-op-ir.js';

export interface ManifestValidationContext {
  strategy: PlatformStrategy;
  toolchain?: FrameworkToolchain;
  moduleExports: Record<string, unknown>;
  packageRoot: string;
  repoTestsDir: string;
}

export interface ManifestValidationError {
  code: string;
  path: string;
  message: string;
  subject?: string;
}

export interface ManifestValidationWarning {
  code: string;
  path: string;
  message: string;
  subject?: string;
}

export interface ManifestValidationResult {
  valid: boolean;
  errors: ManifestValidationError[];
  warnings: ManifestValidationWarning[];
}

class Accumulator {
  readonly errors: ManifestValidationError[] = [];
  readonly warnings: ManifestValidationWarning[] = [];

  error(code: string, path: string, message: string, subject?: string): void {
    this.errors.push({ code, path, message, subject });
  }

  warning(code: string, path: string, message: string, subject?: string): void {
    this.warnings.push({ code, path, message, subject });
  }
}

// Map each HAL category to the prefix its op kinds share.
const CATEGORY_PREFIXES: Record<string, string[]> = {
  gpio: ['gpio.'],
  pwm: ['pwm.'],
  adc: ['adc.'],
  dac: ['dac.'],
  interrupts: ['interrupt.'],
  timing: ['timing.'],
  i2c: ['i2c.'],
  spi: ['spi.'],
  uart: ['uart.'],
  board: ['board.'],
  wdt: ['wdt.'],
  wifi: ['wifi.'],
  http: ['http.'],
  display: ['display.'],
  preferences: ['preferences.'],
  ble: ['ble.'],
  random: ['random.'],
  fs: ['fs.'],
  mqtt: ['mqtt.'],
  // Unimplemented-but-recognized categories: each framework may declare these
  // as unsupported in its manifest so the coverage matrix records them as a
  // roadmap. The validator probes the resolver and confirms it does NOT lower
  // them (consistent with the 'unsupported' status).
  i2s: ['i2s.'],
  twai: ['twai.'],
  usb: ['usb.'],
  eth: ['eth.'],
  // snprintf raw-escape: recognized category; declared unsupported by
  // frameworks that don't special-case it.
  snprintf: ['snprintf.'],
};

function opKindsForCategory(category: string): string[] {
  const prefixes = CATEGORY_PREFIXES[category] ?? [];
  const all = [...HAL_OPERATION_KINDS, ...DISPLAY_OPERATION_KINDS];
  return all.filter((k) => prefixes.some((p) => k.startsWith(p)));
}

// Minimal valid payloads for op kinds whose resolver requires more than just
// the operation discriminator. The default probe (just `{ operation: kind }`)
// works for most ops; this map fills in the smallest payload that lets the
// resolver run without throwing on missing-arg validation.
//
// Templates must be the MINIMAL payload the resolver needs — enough to prove
// the framework handles the op, not to produce semantically correct output.
// Keep entries scoped to fields the resolver actually destructures.
const OP_PROBE_PAYLOADS: Readonly<Record<string, object>> = {
  // i2c.write_bytes requires bus + bytes (resolver iterates bytes).
  'i2c.write_bytes': { bus: 'i2c0', address: 0x50, bytes: [0x00, 0x01] },
  // usb.* require port (+ value/format where the resolver renders them).
  'usb.begin': { port: 'USB0' },
  'usb.print': { port: 'USB0', value: '"x"' },
  'usb.println': { port: 'USB0', value: '"x"' },
  'usb.write': { port: 'USB0', data: '"x"' },
  'usb.printf': { port: 'USB0', format: '%d', args: ['x'] },
  // adc.read / adc.read_voltage require pin.
  'adc.read': { pin: 0 },
  'adc.read_voltage': { pin: 0 },
  // dac.write requires pin + value. Use pin 25 (a valid DAC pin on ESP32;
  // pin 0 throws "not a DAC pin" on ESP32 and Arduino maps it to a
  // non-DAC pin too).
  'dac.write': { pin: 25, value: 128 },
  // display.* require coordinates/color (still inconclusive without driver
  // context — included so future driver-aware probes can build on them).
  'display.fill_rect': { x: 0, y: 0, w: 10, h: 10, color: 0xffff },
  'display.draw_text': { x: 0, y: 0, text: 'x', font: '8x16', color: 0xffff },
  'display.draw_rect': { x: 0, y: 0, w: 10, h: 10, color: 0xffff },
  'display.flush': { rects: [{ x: 0, y: 0, w: 10, h: 10 }] },
  // fs.* require a path (and content for write_text).
  'fs.read_text': { path: '/sdcard/x.txt' },
  'fs.write_text': { path: '/sdcard/x.txt', content: 'hi' },
  'fs.exists': { path: '/sdcard/x.txt' },
  'fs.remove': { path: '/sdcard/x.txt' },
  // random.range requires min/max.
  'random.range': { min: 0, max: 10 },
  // mqtt.connect requires brokerUri/clientId; mqtt.publish requires topic/data.
  'mqtt.connect': { brokerUri: 'mqtt://b', clientId: 'c' },
  'mqtt.on_message': { handler: 'cb' },
  'mqtt.subscribe': { topic: 't' },
  'mqtt.publish': { topic: 't', data: 'd' },
  // wifi.on_event requires an event + handler. Probe with 'connect'.
  // Without a payload the probe sends event=undefined and a 'supported'
  // declaration would false-fail as "resolver returned undefined".
  'wifi.on_event': { event: 'connect', handler: 'cb' },
  // capacitive.read requires pin.
  // sensor.* resolve their part against the generated catalog (hal's
  // sensor-catalog.generated.ts) — sensirion_sht3xd is the stable probe part
  // (in-tree since 2.x; the catalog regeneration checklist covers its removal).
  'sensor.fetch': { part: 'sensirion_sht3xd', bus: 'I2C0', address: 0x44 },
  'sensor.get': { part: 'sensirion_sht3xd', bus: 'I2C0', address: 0x44, chan: 'AMBIENT_TEMP' },
};

// Builds a HALOpIR probe. Uses OP_PROBE_PAYLOADS when available so resolvers
// that destructure required fields don't throw on the probe itself.
function buildHalProbe(opKind: string): HALOpIR {
  const payload = OP_PROBE_PAYLOADS[opKind];
  return { operation: opKind, ...(payload ?? {}) } as unknown as HALOpIR;
}

function buildDisplayProbe(opKind: string): DisplayHALOp {
  const payload = OP_PROBE_PAYLOADS[opKind];
  return { operation: opKind, ...(payload ?? {}) } as unknown as DisplayHALOp;
}

type OpResolutionResult = 'code' | 'expression' | 'undefined' | 'thrown';

function probeResolve(
  strategy: PlatformStrategy,
  opKind: string,
): OpResolutionResult {
  const isDisplay = opKind.startsWith('display.');
  try {
    const op = isDisplay ? buildDisplayProbe(opKind) : buildHalProbe(opKind);
    const result = isDisplay
      ? strategy.resolveDisplayOp?.(op as DisplayHALOp)
      : strategy.resolveHALOperation?.(op as HALOpIR);
    if (!result) return 'undefined';
    if (result.code !== undefined) return 'code';
    if (result.expression !== undefined) return 'expression';
    return 'undefined';
  } catch {
    return 'thrown';
  }
}

function statusFromResolution(res: OpResolutionResult): 'lowers' | 'no-emit' {
  return res === 'undefined' || res === 'thrown' ? 'no-emit' : 'lowers';
}

// ---------------------------------------------------------------------------
// Category A — identity
// ---------------------------------------------------------------------------

function validateIdentity(
  manifest: FrameworkManifest,
  ctx: ManifestValidationContext,
  acc: Accumulator,
): void {
  const strategyId = ctx.strategy.id;
  const matchesDirect = strategyId === manifest.frameworkId;
  const matchesInherited =
    manifest.inheritsStrategyId !== undefined &&
    manifest.inheritsStrategyId === strategyId;
  if (!matchesDirect && !matchesInherited) {
    acc.error(
      'identity/id-mismatch',
      'frameworkId',
      `manifest.frameworkId is "${manifest.frameworkId}" but strategy.id is "${strategyId}". ` +
        `Set strategy.id to match, or add "inheritsStrategyId: "${strategyId}"" to the manifest ` +
        `to document intentional id reuse.`,
      manifest.frameworkId,
    );
  }
}

// ---------------------------------------------------------------------------
// Category B — entrypoint
// ---------------------------------------------------------------------------

function validateEntrypoint(
  manifest: FrameworkManifest,
  ctx: ManifestValidationContext,
  acc: Accumulator,
): void {
  const ep = manifest.entrypoint;
  const strat = ctx.strategy;
  const checks: Array<[
    'entrypointFunctionName' | 'requiresLoopFunction' | 'sourceExtension' | 'generateHeaderFile',
    unknown,
    unknown,
  ]> = [
    ['entrypointFunctionName', ep.entrypointFunctionName, strat.entrypointFunctionName()],
    ['requiresLoopFunction', ep.requiresLoopFunction, strat.requiresLoopFunction()],
    ['sourceExtension', ep.sourceExtension, strat.sourceExtension(true, false)],
    ['generateHeaderFile', ep.generateHeaderFile, strat.generateHeaderFile()],
  ];
  for (const [field, declared, actual] of checks) {
    if (declared !== actual) {
      acc.error(
        `entrypoint/${field}/mismatch`,
        `entrypoint.${field}`,
        `manifest declares ${field}=${JSON.stringify(declared)} but strategy returns ${JSON.stringify(actual)}.`,
        field,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Category C — HAL coverage
// ---------------------------------------------------------------------------

function validateHalCoverage(
  manifest: FrameworkManifest,
  ctx: ManifestValidationContext,
  acc: Accumulator,
): void {
  for (const [category, declarationRaw] of Object.entries(manifest.hal)) {
    if (category === 'raw') continue;
    const declaration = declarationRaw as {
      supported: boolean;
      unsupportedReason?: string;
      ops: Record<string, 'supported' | 'stub' | 'unsupported' | 'probe-inconclusive' | 'polyfill'>;
      partialCoverage?: boolean;
    };
    const knownKinds = opKindsForCategory(category);

    // Check that every known op kind for this category appears in ops.
    for (const kind of knownKinds) {
      if (!(kind in declaration.ops)) {
        acc.error(
          `hal/${category}/op/${kind}/undeclared`,
          `hal.${category}.ops.${kind}`,
          `manifest.hal.${category}.ops is missing "${kind}". Add it with a status of supported/stub/unsupported.`,
          kind,
        );
      }
    }

    // Probe each declared op and cross-check status vs resolver behavior.
    for (const [kind, status] of Object.entries(declaration.ops)) {
      // 'probe-inconclusive' is an explicit acknowledgment that the minimal
      // probe (just an operation discriminator) cannot determine support —
      // typically because the resolver needs a valid pin/config payload.
      // The validator does not cross-check these; the renderer flags them
      // for manual review. This keeps the matrix honest without penalizing
      // frameworks for the probe's limitations.
      if (status === 'probe-inconclusive') continue;

      // 'polyfill' means the op is backed by a runtime polyfill, NOT by
      // resolveHALOperation. Verify the named polyfill exists in
      // POLYFILL_BACKED_OPS and is declared in polyfills.emitted.
      // No HAL probe — the resolver legitimately returns undefined for these.
      if (status === 'polyfill') {
        const expectedPolyfill = POLYFILL_BACKED_OPS[kind];
        if (!expectedPolyfill) {
          acc.error(
            `hal/${category}/op/${kind}/polyfill-not-recognized`,
            `hal.${category}.ops.${kind}`,
            `op "${kind}" declared "polyfill" but is not in POLYFILL_BACKED_OPS. Either add it to packages/cuttlefish/src/api/shared/framework-manifest.ts or use a different status.`,
            kind,
          );
          continue;
        }
        const emitted = manifest.polyfills.emitted.map((p) => p.id);
        if (!emitted.includes(expectedPolyfill)) {
          acc.error(
            `hal/${category}/op/${kind}/polyfill-not-declared`,
            `hal.${category}.ops.${kind}`,
            `op "${kind}" declared "polyfill" (backed by "${expectedPolyfill}") but "${expectedPolyfill}" is not in polyfills.emitted. Add it, or remove this op from the polyfill status.`,
            kind,
          );
        }
        continue;
      }

      const res = probeResolve(ctx.strategy, kind);
      const lowers = statusFromResolution(res) === 'lowers';

      if (status === 'supported' && !lowers) {
        acc.error(
          `hal/${category}/op/${kind}/status-mismatch`,
          `hal.${category}.ops.${kind}`,
          `op "${kind}" declared "supported" but resolver returned ${res}. Either implement the lowering or change the op status.`,
          kind,
        );
      } else if (status === 'stub' && !lowers) {
        acc.error(
          `hal/${category}/op/${kind}/status-mismatch`,
          `hal.${category}.ops.${kind}`,
          `op "${kind}" declared "stub" but resolver emitted nothing (${res}). Either emit something or change to "unsupported".`,
          kind,
        );
      } else if (status === 'unsupported' && lowers) {
        acc.error(
          `hal/${category}/op/${kind}/status-mismatch`,
          `hal.${category}.ops.${kind}`,
          `op "${kind}" declared "unsupported" but resolver actually lowers (${res}). Either mark it supported or remove the lowering.`,
          kind,
        );
      }
    }

    // Category-level summary check.
    if (declaration.supported) {
      // If every op is probe-inconclusive, we can't verify the supported
      // claim at all — skip rather than false-positive.
      const hasVerifiable = knownKinds.some(
        (k) => declaration.ops[k] !== 'probe-inconclusive',
      );
      if (hasVerifiable) {
        const anyLowersOrInconclusive = knownKinds.some((k) => {
          if (declaration.ops[k] === 'probe-inconclusive') return true;
          if (declaration.ops[k] === 'polyfill') return true;
          return statusFromResolution(probeResolve(ctx.strategy, k)) === 'lowers';
        });
        if (!anyLowersOrInconclusive) {
          acc.error(
            `hal/${category}/declared-supported-but-undefined`,
            `hal.${category}`,
            `manifest.hal.${category}.supported is true but resolver returns undefined for every verifiable op kind. Change supported to false with unsupportedReason, or implement the lowering.`,
            category,
          );
        }
      }
    } else {
      // supported: false. Ignore probe-inconclusive and polyfill ops when
      // checking "does it actually lower?" — polyfill ops legitimately
      // return undefined from the HAL resolver.
      const anyLowers = knownKinds.some((k) => {
        if (declaration.ops[k] === 'probe-inconclusive') return false;
        if (declaration.ops[k] === 'polyfill') return false;
        return statusFromResolution(probeResolve(ctx.strategy, k)) === 'lowers';
      });
      if (anyLowers) {
        acc.error(
          `hal/${category}/declared-unsupported-but-actually-lowers`,
          `hal.${category}`,
          `manifest.hal.${category}.supported is false but resolver lowers at least one verifiable op. Either mark supported: true or override the resolver to throw/return undefined.`,
          category,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Category C2 — HAL completeness
// ---------------------------------------------------------------------------

/**
 * Verify every known HAL category appears in manifest.hal. validateHalCoverage
 * only audits categories the manifest declares; a category omitted entirely is
 * invisible to it (and to the per-op check). This step closes that hole: each
 * category in CATEGORY_PREFIXES must be accounted for, even as unsupported.
 * `raw` is excluded — it is the schema-level escape hatch, not a real category,
 * and is not in CATEGORY_PREFIXES.
 */
function validateHalCompleteness(
  manifest: FrameworkManifest,
  _ctx: ManifestValidationContext,
  acc: Accumulator,
): void {
  const declared = new Set(Object.keys(manifest.hal));
  for (const category of Object.keys(CATEGORY_PREFIXES)) {
    if (!declared.has(category)) {
      acc.error(
        `hal/${category}/category-undeclared`,
        `manifest.hal.${category}`,
        `manifest.hal is missing the "${category}" category. Add a block declaring it (supported: true/false with ops, or unsupported with unsupportedReason).`,
        category,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Category D — polyfills
// ---------------------------------------------------------------------------

function validatePolyfills(
  manifest: FrameworkManifest,
  ctx: ManifestValidationContext,
  acc: Accumulator,
): void {
  const strat = ctx.strategy;
  // A polyfill is "produced" if either generateNativePolyfills OR
  // nativePolyfills mentions it. generateNativePolyfills filters by program
  // analysis (may omit polyfills not needed for the empty probe program);
  // nativePolyfills is the unconditional set the strategy handles natively.
  // Unioning both gives the true picture of what the strategy claims to emit.
  const produced = new Set<string>();
  try {
    const irs = strat.generateNativePolyfills?.(
      { kind: 'program', modules: [], classes: [], functions: [] } as never,
      undefined,
    ) ?? [];
    for (const ir of irs) produced.add(ir.id);
  } catch {
    // generateNativePolyfills may throw on synthetic input; that's fine.
  }
  try {
    const ids = strat.nativePolyfills?.() ?? new Set<string>();
    for (const id of ids) produced.add(id);
  } catch {
    // nativePolyfills is optional.
  }

  for (const declared of manifest.polyfills.emitted) {
    if (!produced.has(declared.id)) {
      acc.error(
        `polyfill/${declared.id}/declared-but-not-emitted`,
        `polyfills.emitted.${declared.id}`,
        `polyfill "${declared.id}" declared emitted but generateNativePolyfills/nativePolyfills did not produce it.`,
        declared.id,
      );
    }
  }
  for (const suppressed of manifest.polyfills.suppressed) {
    if (produced.has(suppressed.id)) {
      acc.error(
        `polyfill/${suppressed.id}/declared-suppressed-but-emitted`,
        `polyfills.suppressed.${suppressed.id}`,
        `polyfill "${suppressed.id}" declared suppressed but the strategy actually emits it.`,
        suppressed.id,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Category E — toolchain
// ---------------------------------------------------------------------------

function validateToolchain(
  manifest: FrameworkManifest,
  ctx: ManifestValidationContext,
  acc: Accumulator,
): void {
  const ops = manifest.toolchain.operations;
  if (!ops.compile) {
    acc.error(
      'toolchain/compile/required',
      'toolchain.operations.compile',
      'toolchain.operations.compile must be true (LoadedFramework contract requires a compile implementation).',
      'compile',
    );
  }
  const tc = ctx.toolchain;
  if (tc) {
    const checks: Array<['prepare' | 'compile' | 'upload' | 'monitor', boolean]> = [
      ['prepare', ops.prepare],
      ['compile', ops.compile],
      ['upload', ops.upload],
      ['monitor', ops.monitor],
    ];
    for (const [op, declared] of checks) {
      if (declared && typeof (tc as unknown as Record<string, unknown>)[op] !== 'function') {
        acc.error(
          `toolchain/${op}/declared-but-missing`,
          `toolchain.operations.${op}`,
          `operation "${op}" declared true but is not a function on the loaded Toolchain.`,
          op,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Category F — library resolution
// ---------------------------------------------------------------------------

function validateLibraryResolution(
  manifest: FrameworkManifest,
  ctx: ManifestValidationContext,
  acc: Accumulator,
): void {
  if (!manifest.libraryResolution) return;
  const lr = manifest.libraryResolution;
  const checks: Array<[
    'isFrameworkLibraryImport' | 'getFrameworkLibraryHeaderName' | 'buildClassNameMap' | 'tryGenerateLibDecl',
    boolean,
  ]> = [
    ['isFrameworkLibraryImport', lr.isFrameworkLibraryImport],
    ['getFrameworkLibraryHeaderName', lr.getFrameworkLibraryHeaderName],
    ['buildClassNameMap', lr.buildClassNameMap],
    ['tryGenerateLibDecl', lr.tryGenerateLibDecl],
  ];
  for (const [name, declared] of checks) {
    if (declared && typeof ctx.moduleExports[name] !== 'function') {
      acc.error(
        `library-resolution/${name}/declared-but-not-exported`,
        `libraryResolution.${name}`,
        `"${name}" declared true but not exported from the framework package index.`,
        name,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Category G — type emission
// ---------------------------------------------------------------------------

function validateTypeEmission(
  manifest: FrameworkManifest,
  ctx: ManifestValidationContext,
  acc: Accumulator,
): void {
  const te = manifest.typeEmission;
  const strat = ctx.strategy;

  const fieldChecks: Array<[
    'mathHeader' | 'needsStdString' | 'needsStdVector' | 'needsIostream' | 'needsStdFunction',
    unknown,
    unknown,
  ]> = [
    ['mathHeader', te.mathHeader, strat.mathHeader()],
    ['needsStdString', te.needsStdString, strat.needsStdString()],
    ['needsStdVector', te.needsStdVector, strat.needsStdVector()],
    ['needsIostream', te.needsIostream, strat.needsIostream()],
    ['needsStdFunction', te.needsStdFunction, strat.needsStdFunction()],
  ];
  for (const [field, declared, actual] of fieldChecks) {
    if (declared !== actual) {
      acc.error(
        `type-emission/${field}/mismatch`,
        `typeEmission.${field}`,
        `manifest declares ${field}=${JSON.stringify(declared)} but strategy returns ${JSON.stringify(actual)}.`,
        field,
      );
    }
  }

  const actualStdlib = strat.getStdLibSupport();
  const declaredStdlib = te.stdlibSupport;
  const stdlibEqual =
    actualStdlib.hasVector === declaredStdlib.hasVector &&
    actualStdlib.hasString === declaredStdlib.hasString &&
    actualStdlib.hasIostream === declaredStdlib.hasIostream &&
    actualStdlib.hasExceptions === declaredStdlib.hasExceptions &&
    actualStdlib.hasRTTI === declaredStdlib.hasRTTI &&
    actualStdlib.recommendedArrayImpl === declaredStdlib.recommendedArrayImpl &&
    actualStdlib.recommendedStringImpl === declaredStdlib.recommendedStringImpl;
  if (!stdlibEqual) {
    acc.error(
      'type-emission/stdlib-support-mismatch',
      'typeEmission.stdlibSupport',
      `manifest stdlibSupport does not match strategy.getStdLibSupport() return.`,
    );
  }

  // Ambient types
  const emittedAmbient = new Set<string>();
  try {
    const decls = strat.ambientTypeDeclarations?.() ?? [];
    for (const d of decls) {
      if (typeof d === 'string') {
        // Match all ambient declarations in the string: interface/type/class NAME
        // and const NAME: (Arduino/AVR/ESP32 emit `const Timing: {...}` etc.).
        const matches = [...d.matchAll(/\b(?:interface|type|class)\s+([A-Za-z_$][\w$]*)/g)];
        for (const m of matches) emittedAmbient.add(m[1]);
        const constMatches = [...d.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*:/g)];
        for (const m of constMatches) emittedAmbient.add(m[1]);
      } else if (d && typeof d === 'object' && 'name' in d) {
        emittedAmbient.add(String((d as Record<string, unknown>).name));
      }
    }
  } catch {
    // ambientTypeDeclarations is optional and may require a context.
  }
  for (const declared of manifest.ambientTypes) {
    if (!emittedAmbient.has(declared)) {
      acc.error(
        `ambient-types/${declared}/declared-but-not-emitted`,
        `ambientTypes.${declared}`,
        `ambient type "${declared}" declared but not found in ambientTypeDeclarations() output.`,
        declared,
      );
    }
  }
  for (const emitted of emittedAmbient) {
    if (!manifest.ambientTypes.includes(emitted)) {
      acc.warning(
        `ambient-types/${emitted}/emitted-but-undeclared`,
        'ambientTypes',
        `ambient type "${emitted}" emitted by strategy but not listed in manifest. Consider adding it.`,
        emitted,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Category H — conformance
// ---------------------------------------------------------------------------

function validateConformance(
  manifest: FrameworkManifest,
  ctx: ManifestValidationContext,
  acc: Accumulator,
): void {
  for (const group of manifest.conformance.hardwareTestGroups) {
    const filePath = path.join(ctx.packageRoot, 'tests', `${group}.test.ts`);
    if (!fs.existsSync(filePath)) {
      acc.error(
        `conformance/hardware/${group}/file-not-found`,
        `conformance.hardwareTestGroups.${group}`,
        `hardware test group "${group}" listed but ${filePath} does not exist.`,
        group,
      );
    }
  }
  for (const name of manifest.conformance.halResolutionTests) {
    // Test dir convention is tests/packages/<package-dir-name>/hal-resolution/.
    // Package dir name is the last segment of packageName (e.g.
    // "@typecad/framework-esp32" -> "framework-esp32"), not frameworkId.
    const packageDirName = manifest.packageName.split('/').pop() ?? manifest.frameworkId;
    const filePath = path.join(
      ctx.repoTestsDir,
      'packages',
      packageDirName,
      'hal-resolution',
      `${name}.test.ts`,
    );
    if (!fs.existsSync(filePath)) {
      acc.error(
        `conformance/hal/${name}/file-not-found`,
        `conformance.halResolutionTests.${name}`,
        `HAL resolution test "${name}" listed but ${filePath} does not exist.`,
        name,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function validateFrameworkManifest(
  manifest: FrameworkManifest,
  ctx: ManifestValidationContext,
): ManifestValidationResult {
  const acc = new Accumulator();

  validateIdentity(manifest, ctx, acc);
  validateEntrypoint(manifest, ctx, acc);
  validateHalCoverage(manifest, ctx, acc);
  validateHalCompleteness(manifest, ctx, acc);
  validatePolyfills(manifest, ctx, acc);
  validateToolchain(manifest, ctx, acc);
  validateLibraryResolution(manifest, ctx, acc);
  validateTypeEmission(manifest, ctx, acc);
  validateConformance(manifest, ctx, acc);

  return {
    valid: acc.errors.length === 0,
    errors: acc.errors,
    warnings: acc.warnings,
  };
}
