import { ArduinoPlatformContext, Diagnostic } from "../types";
export interface ArduinoCliMetadata {
    architecture?: string;
    pins: Record<string, number>;
    builtinFunctions: Set<string>;
    builtinGlobals: Set<string>;
}
export declare function loadArduinoCliMetadata(context?: ArduinoPlatformContext): {
    metadata?: ArduinoCliMetadata;
    diagnostics: Diagnostic[];
};
//# sourceMappingURL=arduino-cli-metadata.d.ts.map