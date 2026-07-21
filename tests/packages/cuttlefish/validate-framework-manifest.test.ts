import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  validateFrameworkManifest,
  FrameworkManifestSchema,
  HAL_OPERATION_KINDS,
  DISPLAY_OPERATION_KINDS,
} from '@typecad/cuttlefish/api/shared';
import type {
  PlatformStrategy,
  FrameworkManifest,
} from '@typecad/cuttlefish/api/shared';

// A minimal stub strategy: all methods return safe defaults. Each test
// overrides specific methods.
function makeStubStrategy(overrides: Partial<PlatformStrategy> = {}): PlatformStrategy {
  return {
    id: 'stub',
    entrypointFunctionName: () => 'setup',
    requiresLoopFunction: () => true,
    sourceExtension: () => 'ino',
    generateHeaderFile: () => false,
    normalizeCppType: (t: string) => t,
    mapReturnType: (_n: string, t: string) => t,
    isStringLikeType: () => false,
    isPointerType: () => false,
    mapFunctionName: (n: string) => n,
    renameEnumMember: (_e: string, m: string) => m,
    enumCastType: () => undefined,
    defaultNumericType: () => 'int',
    getStdLibSupport: () => ({
      hasVector: true, hasString: true, hasIostream: true,
      hasExceptions: true, hasRTTI: true,
      recommendedArrayImpl: 'std_vector' as const,
      recommendedStringImpl: 'std_string' as const,
    }),
    mathHeader: () => '<Arduino.h>',
    needsStdString: () => true,
    needsStdVector: () => true,
    needsIostream: () => true,
    needsStdFunction: () => true,
    ...overrides,
  } as unknown as PlatformStrategy;
}

// Build a default-unsupported HAL block covering every required category.
// Tests override specific categories as needed.
function makeDefaultHal(): Record<string, unknown> {
  const all = [...HAL_OPERATION_KINDS, ...DISPLAY_OPERATION_KINDS];
  const byCategory: Record<string, Record<string, 'unsupported'>> = {};
  for (const kind of all) {
    const cat = kind.split('.')[0];
    // 'interrupt.attach' → 'interrupts' (plural alias used by the schema)
    const schemaCat = cat === 'interrupt' ? 'interrupts' : cat;
    byCategory[schemaCat] = byCategory[schemaCat] ?? {};
    byCategory[schemaCat][kind] = 'unsupported';
  }
  const result: Record<string, unknown> = {};
  for (const [cat, ops] of Object.entries(byCategory)) {
    if (cat === 'display') {
      result[cat] = {
        supported: false,
        unsupportedReason: 'default',
        drivers: [],
        colorFormat: null,
        ops,
      };
    } else {
      result[cat] = {
        supported: false,
        unsupportedReason: 'default',
        ops,
      };
    }
  }
  result.raw = { supported: true };
  return result;
}

function makeMinimalManifest(): FrameworkManifest {
  return FrameworkManifestSchema.parse({
    schemaVersion: 1,
    frameworkId: 'stub',
    packageName: '@typecad/framework-stub',
    canonical: false,
    displayName: 'Stub',
    description: 'stub',
    implementationMode: 'from-scratch',
    entrypoint: {
      entrypointFunctionName: 'setup',
      requiresLoopFunction: true,
      sourceExtension: 'ino',
      generateHeaderFile: false,
    },
    profile: { targets: [], forcedIncludes: [], symbolAliases: {} },
    hal: makeDefaultHal(),
    polyfills: { emitted: [], suppressed: [] },
    toolchain: {
      backend: 'stub',
      operations: { prepare: false, compile: true, upload: false, monitor: false },
    },
    typeEmission: {
      normalizeCppType: true,
      mathHeader: '<Arduino.h>',
      needsStdString: true,
      needsStdVector: true,
      needsIostream: true,
      needsStdFunction: true,
      stdlibSupport: {
        hasVector: true, hasString: true, hasIostream: true,
        hasExceptions: true, hasRTTI: true,
        recommendedArrayImpl: 'std_vector',
        recommendedStringImpl: 'std_string',
      },
    },
    ambientTypes: [],
    conformance: { hardwareTestGroups: [], halResolutionTests: [] },
  });
}

describe('validateFrameworkManifest — scaffolding', () => {
  it('returns a valid result with empty errors for a stub strategy', () => {
    const result = validateFrameworkManifest(makeMinimalManifest(), {
      strategy: makeStubStrategy(),
      moduleExports: {},
      packageRoot: '/nonexistent',
      repoTestsDir: '/nonexistent',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('validateFrameworkManifest — identity', () => {
  it('errors when strategy.id does not match frameworkId and no inheritsStrategyId', () => {
    const manifest = makeMinimalManifest();
    manifest.frameworkId = 'esp32';
    const result = validateFrameworkManifest(manifest, {
      strategy: makeStubStrategy({ id: 'arduino' } as Partial<PlatformStrategy>),
      moduleExports: {},
      packageRoot: '/x',
      repoTestsDir: '/x',
    });
    expect(result.errors.map((e) => e.code)).toContain('identity/id-mismatch');
  });

  it('passes when inheritsStrategyId matches strategy.id', () => {
    const manifest = makeMinimalManifest();
    manifest.frameworkId = 'esp32';
    manifest.inheritsStrategyId = 'arduino';
    const result = validateFrameworkManifest(manifest, {
      strategy: makeStubStrategy({ id: 'arduino' } as Partial<PlatformStrategy>),
      moduleExports: {},
      packageRoot: '/x',
      repoTestsDir: '/x',
    });
    expect(result.errors.map((e) => e.code)).not.toContain('identity/id-mismatch');
  });
});

describe('validateFrameworkManifest — entrypoint', () => {
  it('errors when entrypointFunctionName disagrees with strategy', () => {
    const manifest = makeMinimalManifest();
    manifest.entrypoint.entrypointFunctionName = 'app_main';
    const result = validateFrameworkManifest(manifest, {
      strategy: makeStubStrategy({ entrypointFunctionName: () => 'setup' } as Partial<PlatformStrategy>),
      moduleExports: {},
      packageRoot: '/x',
      repoTestsDir: '/x',
    });
    expect(result.errors.map((e) => e.code)).toContain('entrypoint/entrypointFunctionName/mismatch');
  });

  it('errors when sourceExtension disagrees with strategy', () => {
    const manifest = makeMinimalManifest();
    manifest.entrypoint.sourceExtension = 'cc';
    const result = validateFrameworkManifest(manifest, {
      strategy: makeStubStrategy({ sourceExtension: () => 'ino' } as Partial<PlatformStrategy>),
      moduleExports: {},
      packageRoot: '/x',
      repoTestsDir: '/x',
    });
    expect(result.errors.map((e) => e.code)).toContain('entrypoint/sourceExtension/mismatch');
  });
});

describe('validateFrameworkManifest — HAL coverage', () => {
  it('errors when category declared supported but resolveHALOperation returns undefined', () => {
    const manifest = makeMinimalManifest();
    manifest.hal.gpio = {
      supported: true,
      ops: Object.fromEntries(
        HAL_OPERATION_KINDS.filter((k) => k.startsWith('gpio.')).map((k) => [k, 'supported']),
      ),
    };
    const strategy = makeStubStrategy({
      resolveHALOperation: () => undefined,
    } as Partial<PlatformStrategy>);
    const result = validateFrameworkManifest(manifest, {
      strategy, moduleExports: {}, packageRoot: '/x', repoTestsDir: '/x',
    });
    expect(result.errors.map((e) => e.code))
      .toContain('hal/gpio/declared-supported-but-undefined');
  });

  it('errors when op kind missing from manifest ops record', () => {
    const manifest = makeMinimalManifest();
    const ops = Object.fromEntries(
      HAL_OPERATION_KINDS
        .filter((k) => k.startsWith('gpio.') && k !== 'gpio.toggle')
        .map((k) => [k, 'supported']),
    );
    manifest.hal.gpio = { supported: true, ops };
    const strategy = makeStubStrategy({
      resolveHALOperation: (op: { operation: string }) => ({ code: `// ${op.operation}` }),
    } as Partial<PlatformStrategy>);
    const result = validateFrameworkManifest(manifest, {
      strategy, moduleExports: {}, packageRoot: '/x', repoTestsDir: '/x',
    });
    expect(result.errors.map((e) => e.code))
      .toContain('hal/gpio/op/gpio.toggle/undeclared');
  });

  it('errors when unsupported category actually lowers code', () => {
    const manifest = makeMinimalManifest();
    manifest.hal.wifi = {
      supported: false,
      unsupportedReason: 'No WiFi hardware',
      ops: Object.fromEntries(
        HAL_OPERATION_KINDS.filter((k) => k.startsWith('wifi.')).map((k) => [k, 'unsupported']),
      ),
    };
    const strategy = makeStubStrategy({
      resolveHALOperation: () => ({ code: 'wifi_connect();' }),
    } as Partial<PlatformStrategy>);
    const result = validateFrameworkManifest(manifest, {
      strategy, moduleExports: {}, packageRoot: '/x', repoTestsDir: '/x',
    });
    expect(result.errors.map((e) => e.code))
      .toContain('hal/wifi/declared-unsupported-but-actually-lowers');
  });

  it('passes when stub returns code', () => {
    const manifest = makeMinimalManifest();
    manifest.hal.dac = {
      supported: false,
      partialCoverage: true,
      ops: { 'dac.write': 'stub' },
    };
    const strategy = makeStubStrategy({
      resolveHALOperation: () => ({ code: '/* no-op */' }),
    } as Partial<PlatformStrategy>);
    const result = validateFrameworkManifest(manifest, {
      strategy, moduleExports: {}, packageRoot: '/x', repoTestsDir: '/x',
    });
    expect(result.errors.map((e) => e.code))
      .not.toContain('hal/dac/declared-stub-but-emits-nothing');
  });
});

describe('validateFrameworkManifest — polyfills', () => {
  it('errors when emitted polyfill is not produced by generateNativePolyfills', () => {
    const manifest = makeMinimalManifest();
    manifest.polyfills.emitted = [{ id: 'string_methods', domain: 'standard' }];
    const strategy = makeStubStrategy({
      generateNativePolyfills: () => [],
      nativePolyfills: () => new Set<string>(),
    } as Partial<PlatformStrategy>);
    const result = validateFrameworkManifest(manifest, {
      strategy, moduleExports: {}, packageRoot: '/x', repoTestsDir: '/x',
    });
    expect(result.errors.map((e) => e.code))
      .toContain('polyfill/string_methods/declared-but-not-emitted');
  });

  it('errors when suppressed polyfill is emitted', () => {
    const manifest = makeMinimalManifest();
    manifest.polyfills.suppressed = [{ id: 'async_runtime', reason: 'No heap' }];
    const strategy = makeStubStrategy({
      generateNativePolyfills: () => [
        { kind: 'polyfill' as const, id: 'async_runtime', domain: 'standard',
          requiredIncludes: [], forwardDeclarations: [], helperStructs: [],
          helperFunctions: [], shimMacros: [], dependencies: [] },
      ],
    } as Partial<PlatformStrategy>);
    const result = validateFrameworkManifest(manifest, {
      strategy, moduleExports: {}, packageRoot: '/x', repoTestsDir: '/x',
    });
    expect(result.errors.map((e) => e.code))
      .toContain('polyfill/async_runtime/declared-suppressed-but-emitted');
  });
});

describe('validateFrameworkManifest — toolchain', () => {
  it('errors when compile is false (LoadedFramework requires it)', () => {
    const manifest = makeMinimalManifest();
    manifest.toolchain.operations.compile = false;
    const result = validateFrameworkManifest(manifest, {
      strategy: makeStubStrategy(),
      moduleExports: {},
      packageRoot: '/x',
      repoTestsDir: '/x',
    });
    expect(result.errors.map((e) => e.code)).toContain('toolchain/compile/required');
  });

  it('errors when operation declared true but missing on toolchain', () => {
    const manifest = makeMinimalManifest();
    manifest.toolchain.operations.upload = true;
    const result = validateFrameworkManifest(manifest, {
      strategy: makeStubStrategy(),
      toolchain: { compile: () => ({ success: true }) } as never,
      moduleExports: {},
      packageRoot: '/x',
      repoTestsDir: '/x',
    });
    expect(result.errors.map((e) => e.code))
      .toContain('toolchain/upload/declared-but-missing');
  });
});

describe('validateFrameworkManifest — library resolution', () => {
  it('errors when isFrameworkLibraryImport declared but not exported', () => {
    const manifest = makeMinimalManifest();
    manifest.libraryResolution = {
      isFrameworkLibraryImport: true,
      getFrameworkLibraryHeaderName: false,
      buildClassNameMap: false,
      tryGenerateLibDecl: false,
    };
    const result = validateFrameworkManifest(manifest, {
      strategy: makeStubStrategy(),
      moduleExports: {},
      packageRoot: '/x',
      repoTestsDir: '/x',
    });
    expect(result.errors.map((e) => e.code))
      .toContain('library-resolution/isFrameworkLibraryImport/declared-but-not-exported');
  });
});

describe('validateFrameworkManifest — type emission', () => {
  it('errors when stdlibSupport disagrees with getStdLibSupport', () => {
    const manifest = makeMinimalManifest();
    manifest.typeEmission.stdlibSupport.hasVector = false;
    const strategy = makeStubStrategy({
      getStdLibSupport: () => ({
        hasVector: true, hasString: true, hasIostream: true,
        hasExceptions: true, hasRTTI: true,
        recommendedArrayImpl: 'std_vector' as const,
        recommendedStringImpl: 'std_string' as const,
      }),
    } as Partial<PlatformStrategy>);
    const result = validateFrameworkManifest(manifest, {
      strategy, moduleExports: {}, packageRoot: '/x', repoTestsDir: '/x',
    });
    expect(result.errors.map((e) => e.code))
      .toContain('type-emission/stdlib-support-mismatch');
  });

  it('errors when mathHeader disagrees with strategy', () => {
    const manifest = makeMinimalManifest();
    manifest.typeEmission.mathHeader = 'none';
    const strategy = makeStubStrategy({ mathHeader: () => '<Arduino.h>' } as Partial<PlatformStrategy>);
    const result = validateFrameworkManifest(manifest, {
      strategy, moduleExports: {}, packageRoot: '/x', repoTestsDir: '/x',
    });
    expect(result.errors.map((e) => e.code))
      .toContain('type-emission/mathHeader/mismatch');
  });
});

describe('validateFrameworkManifest — conformance', () => {
  it('errors when hardwareTestGroups file does not exist', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-manifest-'));
    const manifest = makeMinimalManifest();
    manifest.conformance.hardwareTestGroups = ['01-basics'];
    const result = validateFrameworkManifest(manifest, {
      strategy: makeStubStrategy(),
      moduleExports: {},
      packageRoot: tmpRoot,
      repoTestsDir: tmpRoot,
    });
    expect(result.errors.map((e) => e.code))
      .toContain('conformance/hardware/01-basics/file-not-found');
  });

  it('passes when hardwareTestGroups file exists', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-manifest-'));
    fs.mkdirSync(path.join(tmpRoot, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'tests', '01-basics.test.ts'), '// stub');
    const manifest = makeMinimalManifest();
    manifest.conformance.hardwareTestGroups = ['01-basics'];
    const result = validateFrameworkManifest(manifest, {
      strategy: makeStubStrategy(),
      moduleExports: {},
      packageRoot: tmpRoot,
      repoTestsDir: tmpRoot,
    });
    expect(result.errors.map((e) => e.code))
      .not.toContain('conformance/hardware/01-basics/file-not-found');
  });
});

// Suppress unused-import warning for DISPLAY_OPERATION_KINDS — it's exported
// from the same barrel as HAL_OPERATION_KINDS and we want to assert both are
// available to consumers (the validator imports them internally).
void DISPLAY_OPERATION_KINDS;
