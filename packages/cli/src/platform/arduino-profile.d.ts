import { ProgramIR } from "../ir/model";
import { Diagnostic, PlatformContext } from "../types";
export interface ResolvedArduinoProfile {
    forcedIncludes: string[];
    symbolAliases: Record<string, string>;
    shimLines: string[];
    diagnostics: Diagnostic[];
}
export declare function resolveArduinoProfile(program: ProgramIR, platformContext?: PlatformContext): ResolvedArduinoProfile;
//# sourceMappingURL=arduino-profile.d.ts.map