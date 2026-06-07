import type { FunctionIR, ClassIR, EnumIR, InterfaceIR, TypeAliasIR, ExpressionIR } from "../api";
import { AsyncLocalStorage } from "node:async_hooks";
import { BoardConstants, getDefaultBoardConstants } from "./board-resolver";

// Registered callback structure
export interface RegisteredCallback {
  placeholderName: string;
  callbackIR: ExpressionIR & { kind: "callback" };
}

export type PointerTracker = Map<string, string>;

let globalDefaultContextRef: CompilationContext | undefined;

// 1. Define the Context class containing all former module-level mutable states.
export class CompilationContext {
  topLevelClasses = new Map<string, ClassIR>();
  registerFieldMap = new Map<string, Map<string, { hi: number; lo: number; width: number }>>();
  
  // Hoisted structures
  hoistedNestedFunctions: FunctionIR[] = [];
  hoistedNestedClasses: ClassIR[] = [];
  hoistedNestedEnums: EnumIR[] = [];
  hoistedNestedInterfaces: InterfaceIR[] = [];
  hoistedNestedTypeAliases: TypeAliasIR[] = [];
  nestedFunctionAliases = new Map<string, string>();
  nestedClassAliases = new Map<string, string>();
  
  // Active trackers for transpilation
  activeCArrayVars = new Set<string>();
  activeArrayLiteralVars = new Set<string>();
  activeStringVars = new Set<string>();
  mutableArrayVars = new Set<string>();
  arrayLiteralSizes = new Map<string, number>();
  filteredArrayLengthVars = new Map<string, string>();
  activeNamespaceNames = new Set<string>();
  topLevelClassNames = new Set<string>();
  activeEnumNames = new Set<string>();
  
  activePinUsage = new Map<string, { pinNumber: string; source: string }>();
  activePeripheralUsage = new Map<string, { instance: number; source: string }>();
  
  // Board configuration maps
  peripheralAliasMap = new Map<string, string>();
  pinAliasMap = new Map<string, string>();
  mcuPinForwardMap = new Map<string, string>();
  mcuPinReverseMap = new Map<string, string>();
  
  requiredIncludes = new Set<string>();
  registeredCallbacks: RegisteredCallback[] = [];
  
  _currentBoardConstants: BoardConstants | undefined = undefined;
  
  activeLocalTypes = new Map<string, string>();
  activeGlobalTypes = new Map<string, string>();
  activeClassFieldTypes = new Map<string, string>();
  activeExtendsClass: string | undefined = undefined;
  contextId = Math.random().toString(36).slice(2, 8);
  
  // HAL Resolver specific state (moved here for safe parallelization)
  halInstances = new Map<string, any>(); // typed as Map<string, HALInstance> in resolver
  floatVariables = new Set<string>();
  snprintfCounter = 0;
  callbackPlaceholderCounter = 0;
  activeStrategy: any | null = null; // PlatformStrategy | null
}

// 2. Setup AsyncLocalStorage
export const contextStorage = new AsyncLocalStorage<CompilationContext>();

const globalDefaultContext = new CompilationContext();
globalDefaultContextRef = globalDefaultContext;

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
export const activeEnumNames = createSetProxy(ctx => ctx.activeEnumNames);

export const activePinUsage = createMapProxy(ctx => ctx.activePinUsage);
export const activePeripheralUsage = createMapProxy(ctx => ctx.activePeripheralUsage);

export const peripheralAliasMap = createMapProxy(ctx => ctx.peripheralAliasMap);
export const pinAliasMap = createMapProxy(ctx => ctx.pinAliasMap);
export const mcuPinForwardMap = createMapProxy(ctx => ctx.mcuPinForwardMap);
export const mcuPinReverseMap = createMapProxy(ctx => ctx.mcuPinReverseMap);

export const requiredIncludes = createSetProxy(ctx => ctx.requiredIncludes);
export const registeredCallbacks = createArrayProxy(ctx => ctx.registeredCallbacks);

export const activeLocalTypes = createMapProxy(ctx => ctx.activeLocalTypes);
export const activeGlobalTypes = createMapProxy(ctx => ctx.activeGlobalTypes);
export const activeClassFieldTypes = createMapProxy(ctx => ctx.activeClassFieldTypes);

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
  nestedClassAliases.clear();
  resetFunctionScopeState();
  activeNamespaceNames.clear();
  topLevelClassNames.clear();
  activeEnumNames.clear();
  topLevelClasses.clear();
  activeGlobalTypes.clear();
  peripheralAliasMap.clear();
  pinAliasMap.clear();
  mcuPinForwardMap.clear();
  mcuPinReverseMap.clear();
  activePinUsage.clear();
  activePeripheralUsage.clear();
  requiredIncludes.clear();
  registeredCallbacks.length = 0;
  getContext()._currentBoardConstants = undefined;
}

export function resetFunctionScopeState(): void {
  activeCArrayVars.clear();
  activeArrayLiteralVars.clear();
  activeStringVars.clear();
  mutableArrayVars.clear();
  arrayLiteralSizes.clear();
  filteredArrayLengthVars.clear();
  activeLocalTypes.clear();
  for (const [key, value] of activeClassFieldTypes) {
    activeLocalTypes.set(key, value);
  }
  getContext().activeExtendsClass = undefined;
}
