import path from 'node:path';

/** PSRAM mode. `'opi'` = octal (ESP32-S3 N8R8/N16R8), `'quad'` = quad SPI. */
export type PsramMode = 'opi' | 'quad';

/** User-facing shape of cuttlefish.config.ts → frameworkData for ESP-IDF. */
export interface Esp32FrameworkData {
  target?: 'esp32' | 'esp32s3' | 'esp32c3' | 'esp32c6';
  /**
   * Enable PSRAM (external SPI RAM). Emits the appropriate CONFIG_SPIRAM*
   * lines into sdkconfig.defaults.
   *   - `'opi'`  → Octal PSRAM (ESP32-S3 N8R8/N16R8 modules; 80 MHz)
   *   - `'quad'` → Quad SPI PSRAM (ESP32 classic, ESP32-S2, some S3; 40 MHz)
   *   - `false`/absent → no PSRAM (default; today's behavior)
   *
   * Mirrors the Arduino FQBN `PSRAM=opi` option for the IDF path. Only
   * `esp32`, `esp32s3`, and `esp32c6` have PSRAM-capable variants; for other
   * targets the setting is ignored with a build-time warning.
   */
  psram?: PsramMode | false;
  components?: {
    /**
     * Registry name → version spec. Mirrors idf_component.yml dependencies.
     * Resolved via `idf.py reconfigure`, which fetches them into
     * managed_components/. Example: `{'espressif/esp-now': '^2.5'}`.
     */
    managed?: Record<string, string>;
    /**
     * Local component directories. Resolved relative to projectRoot and
     * emitted as EXTRA_COMPONENT_DIRS. Example: ['./components/my_sensor'].
     */
    local?: string[];
    /**
     * ESP-IDF built-in component names (the ones that ship with ESP-IDF
     * itself, under $IDF_PATH/components/<name>/). NOT on the Component
     * Registry — they don't go in idf_component.yml and don't need
     * reconfigure. gen-decls reads their headers directly from the IDF
     * install. Example: ['esp_wifi', 'esp_netif', 'nvs_flash'].
     */
    builtin?: string[];
  };
}

/** Resolved, validated components payload, used by scaffold and compile. */
export interface ScaffoldComponents {
  managed: Record<string, string>;
  local: string[];
  builtin: string[];
  /** Resolved PSRAM mode (`false` when absent or explicitly disabled). */
  psram: PsramMode | false;
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object') return false;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof k !== 'string' || typeof val !== 'string') return false;
  }
  return true;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Read `components` out of the frameworkConfig (populated from
 * frameworkData by the cuttlefish config-loader) and resolve local paths
 * against projectRoot (the directory holding cuttlefish.config.ts).
 *
 * Built-in components are passed through as-is — their headers are resolved
 * against $IDF_PATH at gen-decls time, not here.
 *
 * Throws on malformed shapes so misconfiguration surfaces at build start,
 * not deep in idf.py.
 */
export function resolveComponents(
  frameworkConfig: Record<string, unknown> | undefined,
  projectRoot: string,
): ScaffoldComponents {
  const components = (frameworkConfig as Esp32FrameworkData | undefined)?.components;

  const managedRaw = components?.managed;
  if (managedRaw !== undefined && !isStringRecord(managedRaw)) {
    throw new Error(
      "frameworkData.components.managed must be a Record<string, string> (registry name → version).",
    );
  }
  const managed = { ...(managedRaw ?? {}) };

  const localRaw = components?.local;
  if (localRaw !== undefined && !isStringArray(localRaw)) {
    throw new Error(
      "frameworkData.components.local must be a string[] of component directories.",
    );
  }
  const local = (localRaw ?? []).map((p) =>
    path.isAbsolute(p) ? p : path.resolve(projectRoot, p),
  );

  const builtinRaw = components?.builtin;
  if (builtinRaw !== undefined && !isStringArray(builtinRaw)) {
    throw new Error(
      "frameworkData.components.builtin must be a string[] of ESP-IDF built-in component names.",
    );
  }
  const builtin = [...(builtinRaw ?? [])];

  const psramRaw = (frameworkConfig as Esp32FrameworkData | undefined)?.psram;
  if (psramRaw !== undefined && psramRaw !== false && psramRaw !== 'opi' && psramRaw !== 'quad') {
    throw new Error(
      `frameworkData.psram must be 'opi', 'quad', or false (got ${JSON.stringify(psramRaw)}).`,
    );
  }
  const psram = psramRaw ?? false;

  return { managed, local, builtin, psram };
}
