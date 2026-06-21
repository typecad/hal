import type { Diagnostic } from "../types.js";
import type { ProgramIR } from "../api/index.js";
import type { PlatformStrategy } from "../api/shared/index.js";
import { resolveStrategy } from "../platform/registry.js";
import { hasLoadedFramework, getLoadedFramework } from "../framework-registry.js";
import { analyzeInterruptSafety } from "./interrupt-analysis.js";
import { validateADCRange } from "./adc-range-validation.js";
import { createEmptyPeripheralUsage, type PeripheralUsage } from "./peripheral-usage.js";
import { validatePeripherals } from "./peripheral-validation.js";
import { analyzeResources } from "./resource-analysis.js";
import { validatePeripheralOwnership } from "./peripheral-ownership.js";
import { validatePinAliasConflicts } from "./pin-alias-conflict.js";
import { validatePinModeConfig } from "./pin-mode-validation.js";
import { validateUnsafePins } from "./pin-safety.js";
import { validatePulldownSupport } from "./pulldown-validation.js";
import { validatePWMTimerSharing } from "./pwm-timer-sharing.js";
import { validateTimer0PWMTimingConflict } from "./timer0-pwm-timing-conflict.js";
import { validateTryCatch } from "./try-catch-validation.js";
import { validateHeapArrayUsage } from "./heap-array-validation.js";
import { validateUnitSuspicion } from "./unit-suspicion-validation.js";
import { validateOwnership } from "./ownership-analysis.js";
import { validatePinCapabilities } from "./pin-capability-validation.js";

export function runProgramValidations(program: ProgramIR, strategy?: PlatformStrategy): Diagnostic[] {
  const resolvedStrategy = strategy ?? (hasLoadedFramework() ? getLoadedFramework().strategy : resolveStrategy('generic'));
  const diagnostics: Diagnostic[] = [];
  const peripheralUsage = (program.peripheralUsage as PeripheralUsage | undefined) ?? createEmptyPeripheralUsage();

  diagnostics.push(...validatePinCapabilities(program));
  diagnostics.push(...validatePeripherals(peripheralUsage, program.boardConstants));
  diagnostics.push(...validateUnsafePins(peripheralUsage, program.boardConstants));
  diagnostics.push(...analyzeResources(program, resolvedStrategy));
  diagnostics.push(...validatePinAliasConflicts(peripheralUsage, program.boardConstants));
  diagnostics.push(...validatePWMTimerSharing(peripheralUsage, program.boardConstants));
  diagnostics.push(...validateTimer0PWMTimingConflict(peripheralUsage, program.boardConstants));
  diagnostics.push(...validatePulldownSupport(peripheralUsage, program.boardConstants));
  diagnostics.push(...analyzeInterruptSafety(program, peripheralUsage));
  diagnostics.push(...validateADCRange(program, program.boardConstants));
  diagnostics.push(...validateUnitSuspicion(program));
  diagnostics.push(...validatePinModeConfig(program));
  diagnostics.push(...validatePeripheralOwnership(program));
  diagnostics.push(...validateOwnership(program));
  diagnostics.push(...validateTryCatch(program, program.boardConstants, resolvedStrategy));
  diagnostics.push(...validateHeapArrayUsage(program, program.boardConstants, resolvedStrategy));

  return diagnostics;
}