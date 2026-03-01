"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveArduinoProfile = resolveArduinoProfile;
const arduino_cli_metadata_1 = require("./arduino-cli-metadata");
const PROFILE_VARIANTS = [
    { architecture: "avr", forcedIncludes: ["<Arduino.h>"] },
    { architecture: "esp32", forcedIncludes: ["<Arduino.h>"] },
    { architecture: "samd", forcedIncludes: ["<Arduino.h>"] },
    { architecture: "rp2040", forcedIncludes: ["<Arduino.h>"] },
];
const DEFAULT_PROFILE = {
    architecture: "default",
    forcedIncludes: ["<Arduino.h>"],
};
const CAPABILITY_TABLE = [
    {
        architecture: "avr",
        builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "delay", "millis", "micros"]),
        builtinGlobals: new Set(["HIGH", "LOW", "A0", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
        fallbackPins: { A0: 14 },
    },
    {
        architecture: "esp32",
        builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "delay", "millis", "micros"]),
        builtinGlobals: new Set(["HIGH", "LOW", "A0", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
        fallbackPins: { A0: 36 },
    },
    {
        architecture: "samd",
        builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "delay", "millis", "micros"]),
        builtinGlobals: new Set(["HIGH", "LOW", "A0", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
        fallbackPins: { A0: 14 },
    },
    {
        architecture: "rp2040",
        builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "delay", "millis", "micros"]),
        builtinGlobals: new Set(["HIGH", "LOW", "A0", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
        fallbackPins: { A0: 26 },
    },
];
const DEFAULT_CAPABILITIES = {
    architecture: "default",
    builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "delay", "millis", "micros"]),
    builtinGlobals: new Set(["HIGH", "LOW", "A0", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
    fallbackPins: { A0: 0 },
};
const FQBN_PIN_OVERRIDES = [
    { fqbnIncludes: "arduino:avr:uno", pins: { A0: 14 } },
    { fqbnIncludes: "arduino:avr:nano", pins: { A0: 14 } },
    { fqbnIncludes: "arduino:avr:mega", pins: { A0: 54 } },
    { fqbnIncludes: "arduino:samd:mkrzero", pins: { A0: 15 } },
    { fqbnIncludes: "esp32:esp32:", pins: { A0: 36 } },
    { fqbnIncludes: "rp2040:rp2040:", pins: { A0: 26 } },
];
function walkStatements(statements, onStatement) {
    for (const statement of statements) {
        onStatement(statement);
        if (statement.kind === "while") {
            walkStatements(statement.body, onStatement);
        }
    }
}
function collectUsedIdentifiers(program) {
    const used = new Set();
    function collectExpression(expr) {
        if (!expr) {
            return;
        }
        if (expr.kind === "identifier") {
            used.add(expr.value);
            return;
        }
        if (expr.kind === "raw") {
            for (const token of expr.value.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
                used.add(token);
            }
        }
    }
    const collectFromStatement = (statement) => {
        if (statement.kind === "call") {
            const root = statement.callee.split(".")[0];
            if (root) {
                used.add(root);
            }
            for (const arg of statement.args) {
                collectExpression(arg);
            }
            return;
        }
        if (statement.kind === "assign") {
            used.add(statement.target);
            collectExpression(statement.value);
            return;
        }
        if (statement.kind === "update") {
            used.add(statement.target);
            return;
        }
        if (statement.kind === "var_decl") {
            collectExpression(statement.initializer);
            return;
        }
        if (statement.kind === "return") {
            collectExpression(statement.value);
            return;
        }
        if (statement.kind === "while") {
            collectExpression(statement.condition);
        }
    };
    walkStatements(program.topLevelStatements, collectFromStatement);
    for (const fn of program.functions) {
        walkStatements(fn.statements, collectFromStatement);
    }
    return used;
}
function collectCalledFunctions(program) {
    const called = new Set();
    const collectFromStatement = (statement) => {
        if (statement.kind === "call") {
            if (!statement.callee.includes(".")) {
                called.add(statement.callee);
            }
            return;
        }
        if (statement.kind === "while") {
            return;
        }
    };
    walkStatements(program.topLevelStatements, collectFromStatement);
    for (const fn of program.functions) {
        walkStatements(fn.statements, collectFromStatement);
    }
    return called;
}
function collectTopLevelDeclarations(program) {
    const declared = new Set();
    for (const statement of program.topLevelStatements) {
        if (statement.kind === "var_decl") {
            declared.add(statement.name);
        }
    }
    for (const fn of program.functions) {
        declared.add(fn.originalName);
    }
    return declared;
}
function toArchitectureFromFqbn(fqbn) {
    if (!fqbn) {
        return undefined;
    }
    const parts = fqbn.split(":");
    return parts.length >= 2 ? parts[1].toLowerCase() : undefined;
}
function resolveVariant(context) {
    const architecture = toArchitectureFromFqbn(context?.fqbn);
    if (!architecture) {
        return DEFAULT_PROFILE;
    }
    return PROFILE_VARIANTS.find((item) => item.architecture === architecture) ?? DEFAULT_PROFILE;
}
function resolveCapabilities(context) {
    const architecture = toArchitectureFromFqbn(context?.fqbn);
    if (!architecture) {
        return DEFAULT_CAPABILITIES;
    }
    return CAPABILITY_TABLE.find((item) => item.architecture === architecture) ?? DEFAULT_CAPABILITIES;
}
function mergeCapabilities(base, metadata) {
    if (!metadata) {
        return base;
    }
    return {
        architecture: metadata.architecture ?? base.architecture,
        builtinFunctions: new Set([...base.builtinFunctions, ...metadata.builtinFunctions]),
        builtinGlobals: new Set([...base.builtinGlobals, ...metadata.builtinGlobals]),
        fallbackPins: {
            A0: metadata.pins.A0 ?? base.fallbackPins.A0,
        },
    };
}
function resolveA0Fallback(context, capabilities, metadata) {
    if (metadata?.pins.A0 !== undefined) {
        return metadata.pins.A0;
    }
    const fqbn = context?.fqbn?.toLowerCase() ?? "";
    if (fqbn) {
        const override = FQBN_PIN_OVERRIDES.find((item) => fqbn.includes(item.fqbnIncludes.toLowerCase()));
        if (override?.pins.A0 !== undefined) {
            return override.pins.A0;
        }
    }
    return capabilities.fallbackPins.A0 ?? 0;
}
function resolveArduinoProfile(program, platformContext) {
    const context = platformContext?.arduino;
    const metadataResult = (0, arduino_cli_metadata_1.loadArduinoCliMetadata)(context);
    const variant = resolveVariant(context);
    const capabilities = mergeCapabilities(resolveCapabilities(context), metadataResult.metadata);
    const diagnostics = [...metadataResult.diagnostics];
    const used = collectUsedIdentifiers(program);
    const calledFunctions = collectCalledFunctions(program);
    const declared = collectTopLevelDeclarations(program);
    const shimLines = [];
    for (const functionName of calledFunctions) {
        if (declared.has(functionName)) {
            continue;
        }
        if (!capabilities.builtinFunctions.has(functionName)) {
            diagnostics.push({
                severity: "warning",
                code: "TS2CPP_ARDUINO_FUNC_UNKNOWN",
                message: `Function '${functionName}' is not in the known Arduino built-in function set for architecture '${capabilities.architecture}'.`,
            });
        }
    }
    for (const identifier of used) {
        if (declared.has(identifier)) {
            continue;
        }
        if (identifier === "HIGH" ||
            identifier === "LOW" ||
            identifier === "A0" ||
            identifier === "INPUT" ||
            identifier === "OUTPUT" ||
            identifier === "INPUT_PULLUP" ||
            identifier === "Serial") {
            if (!capabilities.builtinGlobals.has(identifier)) {
                diagnostics.push({
                    severity: "warning",
                    code: "TS2CPP_ARDUINO_GLOBAL_UNKNOWN",
                    message: `Global '${identifier}' is not in the known Arduino built-in set for architecture '${capabilities.architecture}'.`,
                });
            }
        }
    }
    const needsHigh = used.has("HIGH") && !declared.has("HIGH") && !capabilities.builtinGlobals.has("HIGH");
    const needsLow = used.has("LOW") && !declared.has("LOW") && !capabilities.builtinGlobals.has("LOW");
    const needsA0 = used.has("A0") && !declared.has("A0") && !capabilities.builtinGlobals.has("A0");
    if (needsHigh) {
        shimLines.push("#ifndef HIGH", "#define HIGH 0x1", "#endif");
        diagnostics.push({
            severity: "warning",
            code: "TS2CPP_ARDUINO_SHIM_HIGH",
            message: "Injected fallback HIGH shim. Verify platform-specific value if your core overrides it.",
        });
    }
    if (needsLow) {
        shimLines.push("#ifndef LOW", "#define LOW 0x0", "#endif");
        diagnostics.push({
            severity: "warning",
            code: "TS2CPP_ARDUINO_SHIM_LOW",
            message: "Injected fallback LOW shim. Verify platform-specific value if your core overrides it.",
        });
    }
    if (needsA0) {
        const a0Fallback = resolveA0Fallback(context, capabilities, metadataResult.metadata);
        shimLines.push("#ifndef A0", `#define A0 ${a0Fallback}`, "#endif");
        diagnostics.push({
            severity: "warning",
            code: "TS2CPP_ARDUINO_SHIM_A0",
            message: `Injected fallback A0 shim as '${a0Fallback}'. Board-specific analog pin mapping may differ; set --fqbn for accurate pin mapping.`,
        });
    }
    return {
        forcedIncludes: variant.forcedIncludes,
        symbolAliases: {
            ...(variant.symbolAliases ?? {}),
        },
        shimLines,
        diagnostics,
    };
}
//# sourceMappingURL=arduino-profile.js.map