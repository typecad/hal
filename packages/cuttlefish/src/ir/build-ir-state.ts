import type { FunctionIR, ClassIR, EnumIR, InterfaceIR, TypeAliasIR, ExpressionIR } from "../api/index.js";
import type { PlatformStrategy } from "../api/shared/index.js";
import type { Diagnostic } from "../types.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { BoardConstants, getDefaultBoardConstants } from "./board-resolver.js";
// IrTypeScope replaces the three proxied globals (activeLocalTypes,
// activeGlobalTypes, activeClassFieldTypes) that previously lived on this
// module as createMapProxy exports. The scope lifecycle is managed here via
// the reset hooks (resetBuildState creates a fresh scope per file;
// resetFunctionScopeState re-seeds locals from classFields between functions).
// See symbol-types.ts for the full design.
import {
  createIrTypeScope,
  setCurrentIrTypeScope,
  getCurrentIrTypeScope,
  resetIrTypeScopeFunctionState,
} from "./symbol-types.js";
export type { IrTypeScope } from "./symbol-types.js";

export interface HALInstance {
  className: string;
  fieldValues: Map<string, string>;
  _spreadParamName?: string;
  [key: string]: unknown;
}

export interface RegisteredCallback {
  placeholderName: string;
  callbackIR: ExpressionIR & { kind: "callback" };
}

export type PointerTracker = Map<string, string>;

export class CompilationContext {
  topLevelClasses = new Map<string, ClassIR>();
  registerFieldMap = new Map<string, Map<string, { hi: number; lo: number; width: number }>>();

  hoistedNestedFunctions: FunctionIR[] = [];
  hoistedNestedClasses: ClassIR[] = [];
  hoistedNestedEnums: EnumIR[] = [];
  hoistedNestedInterfaces: InterfaceIR[] = [];
  hoistedNestedTypeAliases: TypeAliasIR[] = [];
  nestedFunctionAliases = new Map<string, string>();
  nestedClassAliases = new Map<string, string>();

  activeCArrayVars = new Set<string>();
  activeArrayLiteralVars = new Set<string>();
  activeStringVars = new Set<string>();
  mutableArrayVars = new Set<string>();
  arrayLiteralSizes = new Map<string, number>();
  filteredArrayLengthVars = new Map<string, string>();
  activeNamespaceNames = new Set<string>();
  topLevelClassNames = new Set<string>();
  // Names of top-level interfaces. Interfaces lower to C++ structs (value
  // types), so a variable of an interface type is a value — never a pointer,
  // never null. Tracked separately from topLevelClassNames (classes are always
  // reference types / pointers) so the null-comparison guard in
  // expression-to-ir can recognize an interface-typed value as a value type.
  topLevelInterfaceNames = new Set<string>();
  classTypeNames = new Set<string>();
  activeEnumNames = new Set<string>();
  activeStringEnumNames = new Set<string>();

  activePinUsage = new Map<string, { pinNumber: string; source: string }>();
  activePeripheralUsage = new Map<string, { instance: number; source: string }>();

  peripheralAliasMap = new Map<string, string>();
  pinAliasMap = new Map<string, string>();
  mcuPinForwardMap = new Map<string, string>();
  mcuPinReverseMap = new Map<string, string>();

  requiredIncludes = new Set<string>();
  registeredCallbacks: RegisteredCallback[] = [];

  _currentBoardConstants: BoardConstants | undefined = undefined;

  // The three type maps that used to live here (activeLocalTypes,
  // activeGlobalTypes, activeClassFieldTypes) now live on the IrTypeScope
  // managed in symbol-types.ts. They are NOT context-scoped: the IR build is
  // synchronous per file and the scope pointer is a module-local variable.
  // See symbol-types.ts for the full rationale.
  activeExtendsClass: string | undefined = undefined;
  contextId = Math.random().toString(36).slice(2, 8);

  halInstances = new Map<string, HALInstance>();
  /**
   * Top-level `const x = <receiver>.<method>(...)` alias declarations, recorded
   * as varName → receiver source text in a cheap up-front pass (no resolution).
   * `resolveHALReceiver` follows this lazily so a function that references `x`
   * resolves correctly even when declared before the `const x = ...`. This makes
   * HAL resolution order-independent (demo #34 Finding C). Only mode-setter
   * methods (asOutput/asInput/...) are recorded here — value-bearing reads are
   * excluded so they don't alias the pin (Finding B).
   */
  topLevelAliasReceivers = new Map<string, { receiver: string; method: string; args?: string[] }>();
  floatVariables = new Set<string>();
  snprintfCounter = 0;
  callbackPlaceholderCounter = 0;
  // BLE characteristic index counter — persists across separate Ble.server()
  // calls so a multi-characteristic server (one server() per char, the common
  // ble-demo pattern) gets unique sequential indices instead of every char
  // clobbering slot 0. Read by the server()/characteristic() resolver branches
  // in hal-parser.ts. Reset per file in hal-emitter.ts with the other counters.
  bleCharCounter = 0;
  activeStrategy: PlatformStrategy | null = null;

  restParamFunctions = new Map<string, string>();

  /**
   * Diagnostics sink for the current file build. Populated by buildProgramIR
   * with the same array returned in ProgramIR.diagnostics, so diagnostics
   * pushed from deep in IR lowering (e.g. renderExprAsText's fallback paths)
   * flow into the fatal-gate check in transpile.ts without that diagnostic
   * array having to be threaded through ~80 call sites. May be empty before
   * buildProgramIR assigns it; callers must null-check.
   */
  diagnostics: Diagnostic[] = [];

  /**
   * Module-level free-function return types for the file currently being
   * lowered. Populated by buildProgramIR so UI callbacks / timers can resolve
   * helper return types. Cleared in resetBuildState.
   */
  activeFunctionReturnTypes = new Map<string, string>();
}

/**
 * AsyncLocalStorage for context isolation across parallel transpilations.
 * When no store is active (e.g. in tests or non-async code paths), the
 * globalDefaultContext is used as fallback.
 *
 * IMPORTANT: `resetBuildState()` must be called between transpilations to
 * clear the globalDefaultContext. In watch mode, this is done automatically
 * at the start of each `transpileFile()` call.
 */
export const contextStorage = new AsyncLocalStorage<CompilationContext>();

const globalDefaultContext = new CompilationContext();

export function getContext(): CompilationContext {
  return contextStorage.getStore() || globalDefaultContext;
}

// 3. Helper Proxy creators
function createMapProxy<K, V>(getContextKey: (ctx: CompilationContext) => Map<K, V>): Map<K, V> {
  return new Proxy(new Map<K, V>(), {
    get(target, prop) {
      const actual = getContextKey(getContext());
      const value = Reflect.get(actual, prop, actual);
      return typeof value === 'function' ? value.bind(actual) : value;
    },
    set(target, prop, value) {
      const actual = getContextKey(getContext());
      return Reflect.set(actual, prop, value, actual);
    }
  });
}

function createSetProxy<T>(getContextKey: (ctx: CompilationContext) => Set<T>): Set<T> {
  return new Proxy(new Set<T>(), {
    get(target, prop) {
      const actual = getContextKey(getContext());
      const value = Reflect.get(actual, prop, actual);
      return typeof value === 'function' ? value.bind(actual) : value;
    },
    set(target, prop, value) {
      const actual = getContextKey(getContext());
      return Reflect.set(actual, prop, value, actual);
    }
  });
}

function createArrayProxy<T>(getContextKey: (ctx: CompilationContext) => T[]): T[] {
  return new Proxy([] as T[], {
    get(target, prop) {
      const actual = getContextKey(getContext());
      const value = Reflect.get(actual, prop, actual);
      return typeof value === 'function' ? value.bind(actual) : value;
    },
    set(target, prop, value) {
      const actual = getContextKey(getContext());
      return Reflect.set(actual, prop, value, actual);
    },
    ownKeys(target) {
      return Reflect.ownKeys(getContextKey(getContext()));
    },
    getOwnPropertyDescriptor(target, prop) {
      return Reflect.getOwnPropertyDescriptor(getContextKey(getContext()), prop);
    }
  }) as T[];
}

// 4. Export proxies matching the original module API
export const topLevelClasses = createMapProxy(ctx => ctx.topLevelClasses);
export const registerFieldMap = createMapProxy(ctx => ctx.registerFieldMap);
export const halInstances = createMapProxy(ctx => ctx.halInstances);
export const topLevelAliasReceivers = createMapProxy(ctx => ctx.topLevelAliasReceivers);
export const floatVariables = createSetProxy(ctx => ctx.floatVariables);

export const hoistedNestedFunctions = createArrayProxy(ctx => ctx.hoistedNestedFunctions);
export const hoistedNestedClasses = createArrayProxy(ctx => ctx.hoistedNestedClasses);
export const hoistedNestedEnums = createArrayProxy(ctx => ctx.hoistedNestedEnums);
export const hoistedNestedInterfaces = createArrayProxy(ctx => ctx.hoistedNestedInterfaces);
export const hoistedNestedTypeAliases = createArrayProxy(ctx => ctx.hoistedNestedTypeAliases);
export const nestedFunctionAliases = createMapProxy(ctx => ctx.nestedFunctionAliases);
export const nestedClassAliases = createMapProxy(ctx => ctx.nestedClassAliases);

export const activeCArrayVars = createSetProxy(ctx => ctx.activeCArrayVars);
export const activeArrayLiteralVars = createSetProxy(ctx => ctx.activeArrayLiteralVars);
export const activeStringVars = createSetProxy(ctx => ctx.activeStringVars);
export const mutableArrayVars = createSetProxy(ctx => ctx.mutableArrayVars);
export const arrayLiteralSizes = createMapProxy(ctx => ctx.arrayLiteralSizes);
export const filteredArrayLengthVars = createMapProxy(ctx => ctx.filteredArrayLengthVars);
export const activeNamespaceNames = createSetProxy(ctx => ctx.activeNamespaceNames);
export const topLevelClassNames = createSetProxy(ctx => ctx.topLevelClassNames);
export const topLevelInterfaceNames = createSetProxy(ctx => ctx.topLevelInterfaceNames);
export const classTypeNames = createSetProxy(ctx => ctx.classTypeNames);
export const activeEnumNames = createSetProxy(ctx => ctx.activeEnumNames);
export const activeStringEnumNames = createSetProxy(ctx => ctx.activeStringEnumNames);

export const activePinUsage = createMapProxy(ctx => ctx.activePinUsage);
export const activePeripheralUsage = createMapProxy(ctx => ctx.activePeripheralUsage);

export const peripheralAliasMap = createMapProxy(ctx => ctx.peripheralAliasMap);
export const pinAliasMap = createMapProxy(ctx => ctx.pinAliasMap);
export const mcuPinForwardMap = createMapProxy(ctx => ctx.mcuPinForwardMap);
export const mcuPinReverseMap = createMapProxy(ctx => ctx.mcuPinReverseMap);

export const requiredIncludes = createSetProxy(ctx => ctx.requiredIncludes);
export const registeredCallbacks = createArrayProxy(ctx => ctx.registeredCallbacks);

// activeLocalTypes / activeGlobalTypes / activeClassFieldTypes were proxied
// globals; they now live on the IrTypeScope (symbol-types.ts). Callers that
// still reference these by name must migrate to getCurrentIrTypeScope().

export const discriminatedUnionVariantNames = new Map<string, string[]>();
export const restParamFunctions = createMapProxy(ctx => ctx.restParamFunctions);
export const activeFunctionReturnTypes = createMapProxy(ctx => ctx.activeFunctionReturnTypes);

export function getActiveExtendsClass(): string | undefined { return getContext().activeExtendsClass; }
export function setActiveExtendsClass(v: string | undefined): void { getContext().activeExtendsClass = v; }

// Static configurations
export const PIN_FACTORY_FUNCTIONS = new Set([
  "createDigitalPin",
  "createPWMPin",
  "createAnalogPin",
  "createInterruptPin",
]);

export const CONSTANT_FOLD_FUNCTIONS = new Set<string>([]);

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

// 5. Getter/Setter for BoardConstants
export function getCurrentBoardConstants(): BoardConstants { 
  return getContext()._currentBoardConstants || getDefaultBoardConstants(); 
}

export function setCurrentBoardConstants(v: BoardConstants | undefined) {
  const ctx = getContext();
  ctx._currentBoardConstants = v;
  if (v) {
    // Framework strategies that resolve per-program chip data (framework-zephyr's
    // prepareChip) must see the board constants at IR-build time: HAL method
    // bodies lower to C++ text during the build, before the emitter's
    // prepareChip call (emit/emitters/setup.ts) ever runs — without this, the
    // lowering resolves every op against the NO_BOARD_CHIP defaults.
    // Mirrors that duck-typed call.
    (ctx.activeStrategy as { prepareChip?: (program: unknown, ctx?: unknown) => void } | undefined)
      ?.prepareChip?.({ boardConstants: v }, undefined);

    // Populate peripheral aliases (e.g. UART0 -> Serial, I2C0 -> Wire)
    for (const [key, value] of v.entries()) {
      if (key.startsWith("peripherals.aliases.")) {
        const alias = key.slice("peripherals.aliases.".length);
        peripheralAliasMap.set(alias, String(value));
      }
    }

    // Populate pin aliases (e.g. D0 -> 0, A0 -> 14, LED -> 13)
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
        mcuPinForwardMap.set(name, num);
        mcuPinReverseMap.set(num, name);
        // Register an identifier-safe variant so that pins whose canonical
        // name is not a legal JS identifier (e.g. nRF52840 "P0.28") can be
        // imported under their underscore form (P0_28). See "Pin Naming
        // Conventions" in the root AGENTS.md.
        const identName = name.replace(/[.\s-]/g, "_");
        if (identName !== name) {
          pinAliasMap.set(identName, num);
        }
      }
    }

    // Board-module pin aliases (pins.aliases.<NAME> → pin name): the
    // generated board module exports LED/BUTTON (and silkscreen labels) as
    // aliases of datasheet-named pins. Map them through to numbers so
    // resolveHALReceiver treats them as Pin constants.
    for (const [key, value] of v.entries()) {
      const aliasMatch = key.match(/^pins\.aliases\.([A-Za-z_][A-Za-z0-9_]*)$/);
      if (aliasMatch && typeof value === 'string') {
        const num = mcuPinForwardMap.get(value);
        if (num !== undefined) {
          pinAliasMap.set(aliasMatch[1], num);
        }
      }
    }
  }
}

// 6. State management hooks
export function resetBuildState(): void {
  hoistedNestedFunctions.length = 0;
  hoistedNestedClasses.length = 0;
  hoistedNestedEnums.length = 0;
  hoistedNestedInterfaces.length = 0;
  hoistedNestedTypeAliases.length = 0;
  nestedFunctionAliases.clear();
  topLevelAliasReceivers.clear();
  nestedClassAliases.clear();
  resetFunctionScopeState();
  activeNamespaceNames.clear();
  topLevelClassNames.clear();
  topLevelInterfaceNames.clear();
  classTypeNames.clear();
  activeEnumNames.clear();
  activeStringEnumNames.clear();
  topLevelClasses.clear();
  // Start a fresh IrTypeScope for this file. The old activeGlobalTypes was a
  // file-scoped map cleared here; activeLocalTypes/activeClassFieldTypes were
  // function/class-scoped and cleared in resetFunctionScopeState. Creating a
  // new scope object clears all three at once and re-binds the current scope.
  setCurrentIrTypeScope(createIrTypeScope());
  peripheralAliasMap.clear();
  pinAliasMap.clear();
  mcuPinForwardMap.clear();
  mcuPinReverseMap.clear();
  activePinUsage.clear();
  activePeripheralUsage.clear();
  requiredIncludes.clear();
  registeredCallbacks.length = 0;
  discriminatedUnionVariantNames.clear();
  restParamFunctions.clear();
  activeFunctionReturnTypes.clear();
  getContext()._currentBoardConstants = undefined;
}

// ── Transpile-resolved HAL ops ──────────────────────────────────────────────
// HAL ops the transpiler resolves to C++ TEXT while inlining one HAL method
// inside another (e.g. `sense.readMillivolts()` in the argument of
// `USB0.writeLine(...)`) never appear as hal-op/hal-expr IR nodes, so the
// statement walk in program-analysis can't see them. routeHALOp and
// resolveHALExprToText record every op they successfully resolve here, and
// analyzeProgram merges these names into the peripheral usage flags.
// Deliberately NOT cleared by
// resetBuildState (per-file): the ops resolve while building whichever file
// inlines them, and analyzeProgram runs later, at emit. resetTranspileResolvedHalOps
// clears it once per transpile run.
const transpileResolvedHalOps = new Set<string>();
export function markHalOpResolved(opName: string): void {
  transpileResolvedHalOps.add(opName);
}
export function getTranspileResolvedHalOps(): ReadonlySet<string> {
  return transpileResolvedHalOps;
}
export function resetTranspileResolvedHalOps(): void {
  transpileResolvedHalOps.clear();
}

export function resetFunctionScopeState(): void {
  activeCArrayVars.clear();
  activeArrayLiteralVars.clear();
  activeStringVars.clear();
  mutableArrayVars.clear();
  arrayLiteralSizes.clear();
  filteredArrayLengthVars.clear();
  // Clear the function-scoped portion of the current IrTypeScope (locals) and
  // re-seed it from classFields so `this->field` lookups keep resolving in the
  // next method. Mirrors the old behavior where resetFunctionScopeState copied
  // activeClassFieldTypes into activeLocalTypes. globals/classFields survive
  // (they are file-scoped, not function-scoped).
  const scope = getCurrentIrTypeScope();
  if (scope) {
    resetIrTypeScopeFunctionState(scope);
  }
  getContext().activeExtendsClass = undefined;
}
