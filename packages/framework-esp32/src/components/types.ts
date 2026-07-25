import path from 'node:path';

/** PSRAM mode. `'opi'` = octal (ESP32-S3 N8R8/N16R8), `'quad'` = quad SPI. */
export type PsramMode = 'opi' | 'quad';

/**
 * SDMMC slot pin assignment for the FS (SD card) HAL. When omitted, the FS
 * lowering uses ESP-IDF's `SDMMC_SLOT_CONFIG_DEFAULT()`, which reads the
 * chip's Kconfig defaults (classic ESP32: CLK=14, CMD=15, D0=2, D1=4; S3
 * differs). Provide this to route the SDMMC slot to your board's wiring
 * without editing sdkconfig or calling idf.py menuconfig.
 *
 * `width` selects the bus width: `1` (default) uses CLK/CMD/D0; `4` adds
 * D1/D2/D3. Only the pins you set are overridden; unset pins keep defaults.
 */
export interface SdmmcSlotConfig {
  /** GPIO for the slot clock line (SDMMC slot CLK). */
  clk?: number;
  /** GPIO for the slot command line (SDMMC slot CMD). */
  cmd?: number;
  /** GPIO for data line 0 (SDMMC slot D0). */
  d0?: number;
  /** GPIO for data line 1 (SDMMC slot D1) — 4-bit bus only. */
  d1?: number;
  /** GPIO for data line 2 (SDMMC slot D2) — 4-bit bus only. */
  d2?: number;
  /** GPIO for data line 3 (SDMMC slot D3) — 4-bit bus only. */
  d3?: number;
  /** Bus width: 1 (default) or 4. 4-bit requires d1/d2/d3. */
  width?: 1 | 4;
}

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
  /**
   * SDMMC slot pin assignment for the FS (SD card) HAL. Omit to use ESP-IDF's
   * `SDMMC_SLOT_CONFIG_DEFAULT()` (the chip's Kconfig pin defaults). See
   * {@link SdmmcSlotConfig}.
   */
  sdmmc?: SdmmcSlotConfig;
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
  /** Resolved SDMMC slot config (`null` when absent → use IDF defaults). */
  sdmmc: SdmmcSlotConfig | null;
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

  const sdmmcRaw = (frameworkConfig as Esp32FrameworkData | undefined)?.sdmmc;
  let sdmmc: SdmmcSlotConfig | null = null;
  if (sdmmcRaw !== undefined) {
    if (!sdmmcRaw || typeof sdmmcRaw !== 'object') {
      throw new Error('frameworkData.sdmmc must be an object (SdmmcSlotConfig) when provided.');
    }
    const pinFields: Array<keyof SdmmcSlotConfig> = ['clk', 'cmd', 'd0', 'd1', 'd2', 'd3'];
    const resolved: SdmmcSlotConfig = {};
    for (const f of pinFields) {
      const v = (sdmmcRaw as Record<string, unknown>)[f as string];
      if (v === undefined) continue;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 48) {
        throw new Error(`frameworkData.sdmmc.${f} must be an integer GPIO number 0..48 (got ${JSON.stringify(v)}).`);
      }
      (resolved as Record<string, unknown>)[f as string] = v;
    }
    const w = (sdmmcRaw as Record<string, unknown>).width;
    if (w !== undefined) {
      if (w !== 1 && w !== 4) {
        throw new Error(`frameworkData.sdmmc.width must be 1 or 4 (got ${JSON.stringify(w)}).`);
      }
      resolved.width = w as 1 | 4;
    }
    sdmmc = resolved;
  }

  return { managed, local, builtin, psram, sdmmc };
}
