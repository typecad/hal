import type { FunctionIR, ClassIR, EnumIR, InterfaceIR, TypeAliasIR, ExpressionIR } from "@typehal/core";

// Module-level map of top-level class names to their IR for static method return type lookup.
export const topLevelClasses = new Map<string, ClassIR>();

// Track variables that are pointers (from 'new' expressions)
// Maps variable name → class name (e.g., "b" → "Builder")
export type PointerTracker = Map<string, string>;

// Pin factory function names that should be constant-folded to the pin number
export const PIN_FACTORY_FUNCTIONS = new Set([
  "createDigitalPin",
  "createPWMPin",
  "createAnalogPin",
  "createInterruptPin",
]);

// Helper functions that should be constant-folded to their first argument
export const CONSTANT_FOLD_FUNCTIONS = new Set<string>([]);

// Maps typed array constructor names to their C++ element types.
// Used for: new expression handling, collectPointerVars, and function-level tracking.
export const TYPED_ARRAY_ELEMENT_MAP: Record<string, string> = {
  Uint8Array:  "uint8_t",
  Int8Array:   "int8_t",
  Uint16Array: "uint16_t",
  Int16Array:  "int16_t",
  Uint32Array: "uint32_t",
  Int32Array:  "int32_t",
  Float32Array: "float",
  Float64Array: "double",
};

/** Module-level register field map, populated during buildProgramIR. */
export const registerFieldMap = new Map<string, Map<string, { hi: number; lo: number; width: number }>>();

// Module-level accumulators for nested function/class hoisting.
// These are reset at the start of each buildProgramIR() call.
export const hoistedNestedFunctions: FunctionIR[] = [];
export const hoistedNestedClasses: ClassIR[] = [];
export const hoistedNestedEnums: EnumIR[] = [];
export const hoistedNestedInterfaces: InterfaceIR[] = [];
export const hoistedNestedTypeAliases: TypeAliasIR[] = [];
export const nestedFunctionAliases = new Map<string, string>();
export const nestedClassAliases = new Map<string, string>();

// Module-level C-array variable tracker for the current buildProgramIR invocation.
// Tracks variable names initialized with new Uint8Array([...]) (or similar typed array
// constructors) that transpile to C arrays rather than pointers. For these variables,
// .length should become sizeof(arr)/sizeof(arr[0]) instead of arr.size().
export const activeCArrayVars = new Set<string>();

// Module-level array literal tracker for the current buildProgramIR invocation.
// Tracks variable names initialized from array literals or spread arrays.
// For these variables, .length should become sizeof(...)/sizeof(...[0]).
export const activeArrayLiteralVars = new Set<string>();

// Module-level string variable tracker for the current buildProgramIR invocation.
// Tracks variable names whose inferred type is C-style string pointers.
// For these variables, .length should become strlen() instead of .size().
export const activeStringVars = new Set<string>();

// Track array variables that need StaticArray (push, pop, indexOf).
export const mutableArrayVars = new Set<string>();

// Track array literal sizes: variable name → element count.
export const arrayLiteralSizes = new Map<string, number>();

// Track filter result length counters: array name → length counter var name.
export const filteredArrayLengthVars = new Map<string, string>();

// Module-level namespace name tracker for the current buildProgramIR invocation.
// Tracks namespace identifiers so property access like Foo.bar renders as Foo::bar.
export const activeNamespaceNames = new Set<string>();

// Module-level set of top-level class names for the current buildProgramIR invocation.
// Used to emit :: for static method calls on top-level classes (not just hoisted nested ones).
export const topLevelClassNames = new Set<string>();

export const activeEnumNames = new Set<string>();
export const activePinUsage = new Map<string, { pinNumber: string; source: string }>();
export const activePeripheralUsage = new Map<string, { instance: number; source: string }>();

// Board-specific peripheral and pin alias mappings (populated from BoardConstants)
export const peripheralAliasMap = new Map<string, string>();
export const pinAliasMap = new Map<string, string>();

// Module-level set of library includes required by inline evaluators (e.g., "<SPI.h>", "<Wire.h>").
export const requiredIncludes = new Set<string>();

// Module-level registry of callbacks registered via the callback() directive in HAL method bodies.
export interface RegisteredCallback {
  placeholderName: string;
  callbackIR: ExpressionIR & { kind: "callback" };
}
export const registeredCallbacks: RegisteredCallback[] = [];

import { BoardConstants, getDefaultBoardConstants } from "./board-resolver";

// Module-level board constants for the current buildProgramIR invocation.
// Resolved from the board package before IR building starts, so HAL resolver can access it.
let _currentBoardConstants: BoardConstants | undefined;
export function getCurrentBoardConstants(): BoardConstants { 
  return _currentBoardConstants || getDefaultBoardConstants(); 
}
export function setCurrentBoardConstants(v: BoardConstants | undefined) { 
  _currentBoardConstants = v; 
  if (v) {
    // Populate peripheral aliases (e.g. UART0 -> Serial, I2C0 -> Wire)
    for (const [key, value] of v.entries()) {
      if (key.startsWith("peripherals.aliases.")) {
        const alias = key.slice("peripherals.aliases.".length);
        peripheralAliasMap.set(alias, String(value));
      }
    }

    // Populate pin aliases (e.g. D0 -> 0, A0 -> 14, LED -> 13)
    // We look for name/number pairs in pins.all.N.*
    const pinNames = new Map<number, string>();
    const pinNumbers = new Map<number, string>();

    for (const [key, value] of v.entries()) {
      const nameMatch = key.match(/^pins\.all\.(\d+)\.name$/);
      if (nameMatch) {
        pinNames.set(parseInt(nameMatch[1]), String(value));
        continue;
      }
      const numMatch = key.match(/^pins\.all\.(\d+)\.number$/);
      if (numMatch) {
        pinNumbers.set(parseInt(numMatch[1]), String(value));
        continue;
      }
      // Also handle direct aliases if any (e.g. pins.led -> 13)
      const directMatch = key.match(/^pins\.([a-z_][a-z0-9_]*)$/);
      if (directMatch && typeof value !== 'object') {
        const pinName = directMatch[1].toUpperCase();
        if (pinName !== 'ALL' && pinName !== 'DIGITAL' && pinName !== 'ANALOG' && pinName !== 'PWM' && pinName !== 'UNSAFE' && pinName !== 'I2C' && pinName !== 'SPI' && pinName !== 'UART') {
          pinAliasMap.set(pinName, String(value));
        }
      }
    }

    for (const [idx, name] of pinNames) {
      const num = pinNumbers.get(idx);
      if (num !== undefined) {
        pinAliasMap.set(name, num);
      }
    }
  }
}

// Module-level local variable type tracker for typeof resolution.
// Maps variable name → inferred C++ type string (e.g., "int", "std::string").
export const activeLocalTypes = new Map<string, string>();

// Module-level global variable type tracker (persists across function boundaries).
export const activeGlobalTypes = new Map<string, string>();

export function resetBuildState(): void {
  hoistedNestedFunctions.length = 0;
  hoistedNestedClasses.length = 0;
  hoistedNestedEnums.length = 0;
  hoistedNestedInterfaces.length = 0;
  hoistedNestedTypeAliases.length = 0;
  nestedFunctionAliases.clear();
  nestedClassAliases.clear();
  resetFunctionScopeState();
  activeNamespaceNames.clear();
  topLevelClassNames.clear();
  activeEnumNames.clear();
  topLevelClasses.clear();
  activeGlobalTypes.clear();
  peripheralAliasMap.clear();
  pinAliasMap.clear();
  activePinUsage.clear();
  activePeripheralUsage.clear();
  requiredIncludes.clear();
  registeredCallbacks.length = 0;
  _currentBoardConstants = undefined;
}

/** Clear state that should be scoped to a single function body. */
export function resetFunctionScopeState(): void {
  activeCArrayVars.clear();
  activeArrayLiteralVars.clear();
  activeStringVars.clear();
  mutableArrayVars.clear();
  arrayLiteralSizes.clear();
  filteredArrayLengthVars.clear();
  activeLocalTypes.clear();
}
