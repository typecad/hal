import type { Diagnostic } from "../types.js";
import type { ProgramIR } from "../api/index.js";
import type { PlatformStrategy } from "../api/shared/index.js";
import { resolveStrategy } from "../platform/registry.js";
import { hasLoadedFramework, getLoadedFramework } from "../framework-registry.js";
import { analyzeInterruptSafety, inferVolatileForIsrSharedVars, detectReentrancyRisk } from "./interrupt-analysis.js";
import { validateADCRange } from "./adc-range-validation.js";
import { createEmptyPeripheralUsage, type PeripheralUsage } from "./peripheral-usage.js";
import { validatePeripherals } from "./peripheral-validation.js";
import { analyzeResources } from "./resource-analysis.js";
import { validatePeripheralOwnership } from "./peripheral-ownership.js";
import { validatePinAliasConflicts } from "./pin-alias-conflict.js";
import { validatePinModeConfig } from "./pin-mode-validation.js";
import { validateUnsafePins } from "./pin-safety.js";
import { validatePulldownSupport } from "./pulldown-validation.js";
import { validateTryCatch } from "./try-catch-validation.js";
import { validateMemoryBudget } from "./memory-budget-validation.js";
import { validateBlockingDelayInLoop } from "./timing-validation.js";
import { validateUnitSuspicion } from "./unit-suspicion-validation.js";
import { validateOwnership } from "./ownership-analysis.js";
import { validatePinCapabilities } from "./pin-capability-validation.js";
import { validateNetworkUsage } from "./network-validation.js";

export function runProgramValidations(program: ProgramIR, strategy?: PlatformStrategy): Diagnostic[] {
  const resolvedStrategy = strategy ?? (hasLoadedFramework() ? getLoadedFramework().strategy : resolveStrategy('generic'));
  const diagnostics: Diagnostic[] = [];
  const peripheralUsage = (program.peripheralUsage as PeripheralUsage | undefined) ?? createEmptyPeripheralUsage();

  diagnostics.push(...validatePinCapabilities(program));
  diagnostics.push(...validatePeripherals(peripheralUsage, program.boardConstants, program.fileName));
  diagnostics.push(...validateUnsafePins(peripheralUsage, program.boardConstants, program.fileName));
  diagnostics.push(...analyzeResources(program, resolvedStrategy));
  diagnostics.push(...validatePinAliasConflicts(peripheralUsage, program.boardConstants, program.fileName));
  diagnostics.push(...validatePulldownSupport(peripheralUsage, program.boardConstants, program.fileName));
  diagnostics.push(...analyzeInterruptSafety(program, peripheralUsage, resolvedStrategy.isrUnsafeOperations?.()));
  inferVolatileForIsrSharedVars(program, diagnostics);
  detectReentrancyRisk(program, diagnostics);
  diagnostics.push(...validateADCRange(program, program.boardConstants));
  diagnostics.push(...validateUnitSuspicion(program));
  diagnostics.push(...validatePinModeConfig(program));
  diagnostics.push(...validatePeripheralOwnership(program));
  diagnostics.push(...validateOwnership(program));
  diagnostics.push(...validateTryCatch(program, program.boardConstants, resolvedStrategy));
  diagnostics.push(...validateMemoryBudget(program, program.boardConstants));
  diagnostics.push(...validateBlockingDelayInLoop(program, resolvedStrategy));
  diagnostics.push(...validateNetworkUsage(program));

  return diagnostics;
}