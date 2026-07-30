// Re-export the host-owned hook contract. The safety package imports ONLY
// this type from cuttlefish (mirrors how @typecad/ui imports
// @typecad/cuttlefish/ui-hook).
export type { TranspilerSafetyHook, SafetyTransformContext } from "@typecad/cuttlefish/safety-hook-types";
