// ---------------------------------------------------------------------------
// Arduino CLI metadata loader
//
// Loads board metadata from arduino-cli when available.
// Uses disk caching to avoid repeated slow arduino-cli calls.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Diagnostic } from "@typehal/core/shared";
import type { ArduinoPlatformContext } from "./strategy";

// ---------------------------------------------------------------------------
// Disk cache for arduino-cli metadata
// ---------------------------------------------------------------------------

const CACHE_DIR = path.join(os.homedir(), ".typehal", "cache");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedMetadata {
  fqbn: string;
  metadata: {
    architecture?: string;
    pins: Record<string, number>;
    builtinFunctions: string[];  // Serialized as array
    builtinGlobals: string[];    // Serialized as array
  };
  timestamp: number;
}

function getCachePath(fqbn: string): string {
  const safeFqbn = fqbn.replace(/[:/\\]/g, "_");
  return path.join(CACHE_DIR, `arduino-cli-${safeFqbn}.json`);
}

function loadCachedMetadata(fqbn: string): ArduinoCliMetadata | null {
  try {
    const cachePath = getCachePath(fqbn);
    if (!fs.existsSync(cachePath)) return null;

    const cached: CachedMetadata = JSON.parse(fs.readFileSync(cachePath, "utf8"));

    // Check TTL
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
      return null; // Expired
    }

    // Convert arrays back to Sets
    return {
      architecture: cached.metadata.architecture,
      pins: cached.metadata.pins,
      builtinFunctions: new Set(cached.metadata.builtinFunctions),
      builtinGlobals: new Set(cached.metadata.builtinGlobals),
    };
  } catch {
    return null;
  }
}

function saveCachedMetadata(fqbn: string, metadata: ArduinoCliMetadata): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const cached: CachedMetadata = {
      fqbn,
      metadata: {
        architecture: metadata.architecture,
        pins: metadata.pins,
        builtinFunctions: [...metadata.builtinFunctions],  // Convert Set to array
        builtinGlobals: [...metadata.builtinGlobals],      // Convert Set to array
      },
      timestamp: Date.now(),
    };
    fs.writeFileSync(getCachePath(fqbn), JSON.stringify(cached));
  } catch {
    // Ignore cache write errors
  }
}

// ---------------------------------------------------------------------------
// Arduino CLI probing
// ---------------------------------------------------------------------------

/**
 * Extract architecture from FQBN string.
 * FQBN format: vendor:arch:board[:menu=options]
 * e.g., "arduino:avr:uno" -> "avr"
 */
function toArchitectureFromFqbn(fqbn?: string): string | undefined {
  if (!fqbn) return undefined;
  const parts = fqbn.split(":");
  return parts.length >= 2 ? parts[1] : undefined;
}

export interface ArduinoCliMetadata {
  architecture?: string;
  pins: Record<string, number>;
  builtinFunctions: Set<string>;
  builtinGlobals: Set<string>;
}

function parsePinMap(value: unknown): Record<string, number> {
  const pins: Record<string, number> = {};

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const candidate = item as Record<string, unknown>;
      const name = typeof candidate.name === "string" ? candidate.name : undefined;
      const numeric =
        typeof candidate.value === "number"
          ? candidate.value
          : typeof candidate.value === "string" && !Number.isNaN(Number(candidate.value))
            ? Number(candidate.value)
            : undefined;
      if (name && numeric !== undefined) {
        pins[name] = numeric;
      }
    }
    return pins;
  }

  if (value && typeof value === "object") {
    for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
      if (typeof raw === "number") {
        pins[name] = raw;
      } else if (typeof raw === "string" && !Number.isNaN(Number(raw))) {
        pins[name] = Number(raw);
      }
    }
  }

  return pins;
}

function parseStringSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    return new Set<string>();
  }

  return new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
}

function normalizeMetadata(raw: unknown, context?: ArduinoPlatformContext): ArduinoCliMetadata {
  const object = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const architecture =
    (typeof object.architecture === "string" ? object.architecture.toLowerCase() : undefined) ??
    (typeof object.arch === "string" ? object.arch.toLowerCase() : undefined) ??
    toArchitectureFromFqbn(context?.fqbn);

  const pins = {
    ...parsePinMap(object.pins),
    ...parsePinMap(object.pinMappings),
  };

  const builtinFunctions = new Set<string>([
    ...parseStringSet(object.builtinFunctions),
    ...parseStringSet(object.functions),
  ]);

  const builtinGlobals = new Set<string>([
    ...parseStringSet(object.builtinGlobals),
    ...parseStringSet(object.globals),
  ]);

  return {
    architecture,
    pins,
    builtinFunctions,
    builtinGlobals,
  };
}

function tryArduinoCliProbe(context?: ArduinoPlatformContext): { raw?: unknown; diagnostic?: Diagnostic } {
  if (!context?.fqbn) {
    return {};
  }

  const cmd = spawnSync("arduino-cli", ["board", "details", "--fqbn", context.fqbn, "--format", "json"], {
    encoding: "utf8",
    timeout: 10000,
  });

  if (cmd.error || cmd.status !== 0) {
    return {
      diagnostic: {
        severity: "warning",
        code: "TS2CPP_ARDUINO_CLI_PROBE_FAILED",
        message: "Could not query arduino-cli board metadata; using static profile fallbacks.",
      },
    };
  }

  try {
    return { raw: JSON.parse(cmd.stdout) as unknown };
  } catch {
    return {
      diagnostic: {
        severity: "warning",
        code: "TS2CPP_ARDUINO_CLI_PARSE_FAILED",
        message: "arduino-cli output could not be parsed as JSON; using static profile fallbacks.",
      },
    };
  }
}

export function loadArduinoCliMetadata(context?: ArduinoPlatformContext): {
  metadata?: ArduinoCliMetadata;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const fqbn = context?.fqbn;

  if (!fqbn) {
    return { diagnostics };
  }

  // Try disk cache first
  const cached = loadCachedMetadata(fqbn);
  if (cached) {
    return { metadata: cached, diagnostics };
  }

  // Cache miss - probe arduino-cli
  const probe = tryArduinoCliProbe(context);
  if (probe.diagnostic) {
    diagnostics.push(probe.diagnostic);
  }

  if (probe.raw) {
    const metadata = normalizeMetadata(probe.raw, context);
    // Save to disk cache for future sessions
    saveCachedMetadata(fqbn, metadata);
    return { metadata, diagnostics };
  }

  return { diagnostics };
}