"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadArduinoCliMetadata = loadArduinoCliMetadata;
const node_child_process_1 = require("node:child_process");
function toArchitectureFromFqbn(fqbn) {
    if (!fqbn) {
        return undefined;
    }
    const parts = fqbn.split(":");
    return parts.length >= 2 ? parts[1].toLowerCase() : undefined;
}
function parsePinMap(value) {
    const pins = {};
    if (Array.isArray(value)) {
        for (const item of value) {
            if (!item || typeof item !== "object") {
                continue;
            }
            const candidate = item;
            const name = typeof candidate.name === "string" ? candidate.name : undefined;
            const numeric = typeof candidate.value === "number"
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
        for (const [name, raw] of Object.entries(value)) {
            if (typeof raw === "number") {
                pins[name] = raw;
            }
            else if (typeof raw === "string" && !Number.isNaN(Number(raw))) {
                pins[name] = Number(raw);
            }
        }
    }
    return pins;
}
function parseStringSet(value) {
    if (!Array.isArray(value)) {
        return new Set();
    }
    return new Set(value
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0));
}
function normalizeMetadata(raw, context) {
    const object = raw && typeof raw === "object" ? raw : {};
    const architecture = (typeof object.architecture === "string" ? object.architecture.toLowerCase() : undefined) ??
        (typeof object.arch === "string" ? object.arch.toLowerCase() : undefined) ??
        toArchitectureFromFqbn(context?.fqbn);
    const pins = {
        ...parsePinMap(object.pins),
        ...parsePinMap(object.pinMappings),
    };
    const builtinFunctions = new Set([
        ...parseStringSet(object.builtinFunctions),
        ...parseStringSet(object.functions),
    ]);
    const builtinGlobals = new Set([
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
function tryArduinoCliProbe(context) {
    if (!context?.fqbn) {
        return {};
    }
    const cmd = (0, node_child_process_1.spawnSync)("arduino-cli", ["board", "details", "--fqbn", context.fqbn, "--format", "json"], {
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
        return { raw: JSON.parse(cmd.stdout) };
    }
    catch {
        return {
            diagnostic: {
                severity: "warning",
                code: "TS2CPP_ARDUINO_CLI_PARSE_FAILED",
                message: "arduino-cli output could not be parsed as JSON; using static profile fallbacks.",
            },
        };
    }
}
function loadArduinoCliMetadata(context) {
    const diagnostics = [];
    const probe = tryArduinoCliProbe(context);
    if (probe.diagnostic) {
        diagnostics.push(probe.diagnostic);
    }
    if (probe.raw) {
        return {
            metadata: normalizeMetadata(probe.raw, context),
            diagnostics,
        };
    }
    return { diagnostics };
}
//# sourceMappingURL=arduino-cli-metadata.js.map