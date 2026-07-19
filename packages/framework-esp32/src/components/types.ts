import path from 'node:path';

/** User-facing shape of cuttlefish.config.ts → frameworkData for ESP-IDF. */
export interface Esp32FrameworkData {
  target?: 'esp32' | 'esp32s3' | 'esp32c3' | 'esp32c6';
  components?: {
    /** Registry name → version spec. Mirrors idf_component.yml dependencies. */
    managed?: Record<string, string>;
    /** Local component directories. Resolved relative to projectRoot. */
    local?: string[];
  };
}

/** Resolved, validated components payload, used by scaffold and compile. */
export interface ScaffoldComponents {
  managed: Record<string, string>;
  local: string[];
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

  return { managed, local };
}
