import type { Diagnostic } from "../types";
import type { ProgramIR } from "./model";
import { analyzeInterruptSafety } from "./interrupt-analysis";
import { validateADCRange } from "./adc-range-validation";
import { createEmptyPeripheralUsage, type PeripheralUsage } from "./peripheral-usage";
import { validatePeripherals } from "./peripheral-validation";
import { validatePeripheralOwnership } from "./peripheral-ownership";
import { validatePeripheralPinConflicts } from "./peripheral-pin-conflict";
import { validatePinAliasConflicts } from "./pin-alias-conflict";
import { validatePinModeConfig } from "./pin-mode-validation";
import { validateUnsafePins } from "./pin-safety";
import { validatePulldownSupport } from "./pulldown-validation";
import { validatePWMTimerSharing } from "./pwm-timer-sharing";
import { validateTimer0PWMTimingConflict } from "./timer0-pwm-timing-conflict";
import { validateTryCatch } from "./try-catch-validation";
import { validateUnitSuspicion } from "./unit-suspicion-validation";
import { validateOwnership } from "./ownership-analysis";
import { validatePinCapabilities } from "./pin-capability-validation";

export function runProgramValidations(program: ProgramIR): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const peripheralUsage = (program.peripheralUsage as PeripheralUsage | undefined) ?? createEmptyPeripheralUsage();

  diagnostics.push(...validatePinCapabilities(program));
  diagnostics.push(...validatePeripherals(peripheralUsage, program.boardConstants));
  diagnostics.push(...validateUnsafePins(peripheralUsage, program.boardConstants));
  diagnostics.push(...validatePeripheralPinConflicts(peripheralUsage, program.boardConstants));
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
  diagnostics.push(...validateTryCatch(program, program.boardConstants));

  return diagnostics;
}