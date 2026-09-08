// ---------------------------------------------------------------------------
// Framework manifest schema
//
// Single source of truth for "what a framework is." A zod schema defines the
// contract; the FrameworkManifest type is inferred from it so there is no
// drift between runtime validation and static types. Each field maps to a real
// code artifact (PlatformStrategy method, LoadedFramework export, file path).
//
// Per-package `framework.manifest.ts` files call defineFrameworkManifest() to
// declare their coverage. The validator in validate-framework-manifest.ts
// cross-checks each claim against the loaded strategy/toolchain.
// ---------------------------------------------------------------------------

import { z } from 'zod';

// Core HAL categories that EVERY framework MUST declare coverage for (the
// universal embedded surface: digital/analog I/O, comms buses, timing, power,
// watchdog). These keys are required in every manifest's `hal` block.
//
// Extended categories — `rmt`, `ble`, `preferences`, `random`, `fs`, `mqtt`,
// `mdns`, `ota`, etc. — are OPTIONAL: a framework declares them only if it
// lowers them. The HalCoverageSchema below uses `.catchall()` so declared
// extended categories survive zod parsing (they used to be silently stripped,
// which made esp32's ble/rmt/preferences manifest blocks dead data) and get
// validated by the manifest validator like any core category. A framework that
// does not lower an extended category simply omits it.
const HAL_CATEGORIES = [
  'gpio', 'pwm', 'adc', 'dac', 'interrupts', 'timing',
  'i2c', 'spi', 'uart', 'board', 'wdt', 'wifi', 'http',
  'mqtt', 'display',
] as const;

export type HalCategory = typeof HAL_CATEGORIES[number];

const OpStatus = z.enum(['supported', 'stub', 'unsupported', 'probe-inconclusive', 'polyfill']);

const HalCategorySchema = z.object({
  supported: z.boolean(),
  unsupportedReason: z.string().optional(),
  ops: z.record(z.string(), OpStatus),
  partialCoverage: z.boolean().default(false),
});

const DisplayCategorySchema = HalCategorySchema.extend({
  drivers: z.array(z.string()),
  colorFormat: z.enum(['rgb565', 'mono']).nullable(),
});

const HalCoverageSchema = z.object(
  Object.fromEntries(
    HAL_CATEGORIES.map((c) => [
      c,
      c === 'display' ? DisplayCategorySchema : HalCategorySchema,
    ]),
  ),
).extend({
  raw: z.object({ supported: z.boolean() }).default({ supported: true }),
  // catchall: extended categories (rmt, ble, preferences, random, fs, mqtt,
  // mdns, ota, ...) declared by a framework that lowers them. Without this,
  // zod's default object parsing silently strips unknown keys, so a manifest's
  // `ble:` / `rmt:` / `preferences:` / `random:` blocks never reached the
  // validator or consumers. The catchall validates them with the same shape as
  // core categories (HalCategorySchema) and preserves them on the parsed
  // object. Frameworks that don't lower an extended category simply omit it.
  // `raw` is excluded — it is the escape hatch, not a HAL category.
}).catchall(HalCategorySchema);

const EntrypointSchema = z.object({
  entrypointFunctionName: z.string(),
  requiresLoopFunction: z.boolean(),
  sourceExtension: z.enum(['ino', 'cc', 'cpp', 'h']),
  overrideBaseName: z.string().optional(),
  outputSubdirectory: z.string().optional(),
  generateHeaderFile: z.boolean(),
  customBridgeShim: z.string().optional(),
});

const ProfileSchema = z.object({
  targets: z.array(z.string()),
  forcedIncludes: z.array(z.string()),
  symbolAliases: z.record(z.string(), z.string()),
});

const PolyfillCoverageSchema = z.object({
  emitted: z.array(z.object({
    id: z.string(),
    domain: z.string(),
    notes: z.string().optional(),
  })),
  suppressed: z.array(z.object({
    id: z.string(),
    reason: z.string(),
  })),
});

const ToolchainCoverageSchema = z.object({
  backend: z.string(),
  operations: z.object({
    prepare: z.boolean(),
    compile: z.boolean(),
    upload: z.boolean(),
    monitor: z.boolean(),
    debug: z.boolean().optional(),
  }),
  reexportedFrom: z.string().optional(),
});

const LibraryResolutionSchema = z.object({
  isFrameworkLibraryImport: z.boolean(),
  getFrameworkLibraryHeaderName: z.boolean(),
  buildClassNameMap: z.boolean(),
  tryGenerateLibDecl: z.boolean(),
  reexportedFrom: z.string().optional(),
});

/**
 * Capability block for an optional subcommand the framework may own (e.g.
 * `typecad-hal doctor`, `typecad-hal licenses`). The manifest only declares
 * availability; the framework's runtime `doctor` / `licenses` exports provide
 * the implementation, and cuttlefish dispatches to them when present.
 */
const SubcommandCapabilitySchema = z.object({
  available: z.boolean(),
});

// Declared compatibility ranges for the framework's external dependencies
// (the toolchain it drives). Optional metadata — not a coverage claim, so the
// manifest validator does not cross-check it. Consumers read it to fail fast
// with a clear message when, e.g., the installed Zephyr is outside the range
// the framework was built/tested against. Ranges are simple comparators
// ('>=4.3 <5.0') parsed by the framework's own version check.
const CompatSchema = z.object({
  /** Supported Zephyr RTOS version range (framework-zephyr). */
  zephyr: z.string().optional(),
});

const StdLibSupportSchema = z.object({
  hasVector: z.boolean(),
  hasString: z.boolean(),
  hasIostream: z.boolean(),
  hasExceptions: z.boolean(),
  hasRTTI: z.boolean(),
  recommendedArrayImpl: z.enum(['std_vector', 'static_array']),
  recommendedStringImpl: z.enum(['std_string', 'static_string']),
});

const TypeEmissionSchema = z.object({
  normalizeCppType: z.boolean(),
  mathHeader: z.enum(['none', '<math.h>', '<Arduino.h>', '<cmath>']),
  needsStdString: z.boolean(),
  needsStdVector: z.boolean(),
  needsIostream: z.boolean(),
  needsStdFunction: z.boolean(),
  stdlibSupport: StdLibSupportSchema,
});

const ConformanceSchema = z.object({
  hardwareTestGroups: z.array(z.string()),
  halResolutionTests: z.array(z.string()),
});

export const FrameworkManifestSchema = z.object({
  schemaVersion: z.literal(1),
  frameworkId: z.string(),
  packageName: z.string(),
  canonical: z.boolean().default(false),
  displayName: z.string(),
  description: z.string(),
  basedOn: z.string().optional(),
  implementationMode: z.enum(['from-scratch', 'extends-canonical', 'extends-other']),
  inheritsStrategyId: z.string().optional(),
  entrypoint: EntrypointSchema,
  profile: ProfileSchema,
  hal: HalCoverageSchema,
  polyfills: PolyfillCoverageSchema,
  toolchain: ToolchainCoverageSchema,
  libraryResolution: LibraryResolutionSchema.optional(),
  typeEmission: TypeEmissionSchema,
  ambientTypes: z.array(z.string()),
  conformance: ConformanceSchema,
  // Optional subcommand capabilities owned by the framework. When declared
  // `{ available: true }`, the framework exports matching `doctor` / `licenses`
  // functions that cuttlefish dispatches the corresponding CLI subcommands to.
  doctor: SubcommandCapabilitySchema.optional(),
  licenses: SubcommandCapabilitySchema.optional(),
  compat: CompatSchema.optional(),
});

export type FrameworkManifest = z.infer<typeof FrameworkManifestSchema>;

/**
 * Authoritative map of HAL op kinds that are lowered via the polyfill system
 * rather than via `resolveHALOperation`. Keyed by op kind; value is the
 * polyfill id that backs it.
 *
 * The manifest validator uses this to verify `polyfill`-declared ops: if a
 * manifest declares an op as `polyfill`, the framework's `polyfills.emitted`
 * list must include the polyfill id named here.
 *
 * Keep in sync with the transpiler's lowering routes — when a new op kind
 * starts being routed via a polyfill instead of the HAL resolver, add it
 * here. The set is intentionally small and stable: polyfill-routed ops are
 * the exception, not the rule.
 */
export const POLYFILL_BACKED_OPS: Readonly<Record<string, string>> = {};

/**
 * Validates and returns a FrameworkManifest. Frameworks call this from their
 * `framework.manifest.ts` to get both static type-checking (the parameter type
 * is the inferred FrameworkManifest) and runtime validation (zod parse).
 * Bad manifests throw at module-load time.
 */
export function defineFrameworkManifest(input: unknown): FrameworkManifest {
  return FrameworkManifestSchema.parse(input);
}

export { HAL_CATEGORIES };
