import type { FunctionIR, ClassIR, EnumIR, InterfaceIR, TypeAliasIR, ExpressionIR } from "../api/index.js";
import type { HALOpIR } from "../api/shared/hal-op-ir.js";
import type { PlatformStrategy } from "../api/shared/index.js";
import type ts from "typescript";
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
  /**
   * The function name emit assigned this callback (`main_isr_N`), written
   * back by top-level-prep so post-emit consumers (the --diagnostics report)
   * can report real symbols instead of the __CALLBACK_N__ placeholder.
   */
  emittedName?: string;
}

export type PointerTracker = Map<string, string>;

export class CompilationContext {
  topLevelClasses = new Map<string, ClassIR>();
  registerFieldMap = new Map<string, Map<string, { hi: number; lo: number; width: number }>>();
  /** Top-level free-function name → return cppType, seeded across ALL files
   *  of the transpile graph by transpile.ts's Phase 0 pre-scan. The IR-time
   *  snprintf ladder consults it so `${fn(x)}` picks the specifier for the
   *  function's actual return type (a const char* return printed its POINTER
   *  through the %d default). */
  crossModuleFunctionReturns = new Map<string, string>();

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
  /** Set when any `??` lowered to cuttlefish_nullish — the shim gate reads it
   *  in addition to the textual scan (order-proof nullish helper emission). */
  nullishHelperSeen = false;
  /** Active variant-narrowing: varName -> narrowed arm C++ type. Set while a
   *  then-branch of `if (typeof x === 'lit')` lowers over a variant-typed x;
   *  identifier and member accesses on x lower through std::get<Arm>(x). */
  variantNarrowing = new Map<string, string>();
  arrayLiteralSizes = new Map<string, number>();
  // Static push/unshift site count per array var (for StaticArray capacity
  // sizing) — file-scoped like mutableArrayVars. A var pushed from inside a
  // loop body or callback is ALSO in unboundedArrayVars: its push count is a
  // per-iteration count, not a total, so the capacity cannot be sized from
  // it (the promotion must fall back to std::vector where the target has it).
  arrayPushCounts = new Map<string, number>();
  unboundedArrayVars = new Set<string>();
  // Array-literal vars declared at MODULE scope. A module array is a
  // cross-call accumulator (any function may run any number of times), so
  // its growth is never statically bounded — it lowers to std::vector where
  // the target has one, never to a sized __tc_StaticArray. File-scoped.
  moduleArrayLiteralVars = new Set<string>();
  // Array vars that receive a mutating array-method call (.push/.fill/...)
  // from INSIDE a function body (as opposed to module top level). For a
  // module-level array literal this is the signal that its declaration will
  // NOT promote to StaticArray: function bodies prescan after the module
  // statement list processes, so the declaration never sees the mutation
  // and stays std::vector. File-scoped.
  functionScopeMutatedArrays = new Set<string>();
  // Loop variables bound by a for-of over a std::map (`for (const e of m)`).
  // Each iteration element is a std::pair — `e[0]`/`e[1]` lower to
  // `.first`/`.second`. Function-scoped (cleared per function like the other
  // active* sets) — the for-of lowering registers the name before the body
  // lowers, and the element-access lowering consults the set.
  mapEntryVarNames = new Set<string>();
  filteredArrayLengthVars = new Map<string, string>();
  activeNamespaceNames = new Set<string>();
  topLevelClassNames = new Set<string>();
  // Names of top-level interfaces. Interfaces lower to C++ structs (value
  // types), so a variable of an interface type is a value — never a pointer,
  // never null. Tracked separately from topLevelClassNames (classes are always
  // reference types / pointers) so the null-comparison guard in
  // expression-to-ir can recognize an interface-typed value as a value type.
  topLevelInterfaceNames = new Set<string>();
  /** Type aliases of object-literal types (`type Reading = { mv: number }`) —
   *  they lower to CONCRETE value structs (unlike interfaces, which are
   *  abstract and pointer-typed). Consumed by the null-comparison guard: a
   *  local of such a type is a value and never null. */
  objectTypeAliasNames = new Set<string>();
  classTypeNames = new Set<string>();
  activeEnumNames = new Set<string>();
  /** Type-parameter names of the function whose body is currently lowering —
   *  the struct-equality gate consults this so a generic's `T` is never
   *  mistaken for a user struct (v < lo fired struct-equality-unsupported). */
  activeFunctionTypeParams = new Set<string>();
  // Every user-declared VARIABLE name in the current file (top-level, function
  // locals, parameters) — pre-scanned before lowering so reserved-name
  // escaping applies to references regardless of lowering order.
  userDeclaredVarNames = new Set<string>();
  activeStringEnumNames = new Set<string>();

  activePinUsage = new Map<string, { pinNumber: string; source: string }>();
  activePeripheralUsage = new Map<string, { instance: number; source: string }>();

  peripheralAliasMap = new Map<string, string>();
  pinAliasMap = new Map<string, string>();
  mcuPinForwardMap = new Map<string, string>();
  mcuPinReverseMap = new Map<string, string>();

  requiredIncludes = new Set<string>();
  registeredCallbacks: RegisteredCallback[] = [];

  /**
   * Free functions passed BY NAME as interrupt handlers (e.g.
   * `pin.onInterrupt(GPIO.INT_EDGE_RISING, isr)`). A named handler produces no
   * callback IR node — the C lowering accepts the bare function name — so the
   * interrupt-safety analysis would otherwise never see its body. Flows onto
   * ProgramIR.isrHandlerFunctions at the end of the build.
   */
  isrHandlerFunctions = new Set<string>();

  _currentBoardConstants: BoardConstants | undefined = undefined;

  // The three type maps that used to live here (activeLocalTypes,
  // activeGlobalTypes, activeClassFieldTypes) now live on the IrTypeScope
  // managed in symbol-types.ts. They are NOT context-scoped: the IR build is
  // synchronous per file and the scope pointer is a module-local variable.
  // See symbol-types.ts for the full rationale.
  activeExtendsClass: string | undefined = undefined;
  /** Bare name of the class whose members are currently being lowered —
   *  set by classDeclarationToIR for the whole member loop so `this.prop`
   *  accesses can resolve the enclosing class's getters. */
  activeClassName: string | undefined = undefined;
  contextId = Math.random().toString(36).slice(2, 8);

  /** Statement-list-scoped: int-literal-initialized, unannotated locals that
   *  a later `+=`/`=` assigns a double RHS (JS numbers are f64; keeping the
   *  inferred int truncated every accumulation step). Populated by the
   *  numeric-widening prescan in statement-to-ir; consumed by the var-decl
   *  lowering. */
  doubleWidenedVars = new Set<string>();

  /** File-scoped snapshot of the current file's type-alias → type-node map
   *  (the threaded map is per-function; IR-side consumers that classify
   *  struct-field reads — the HAL snprintf ladder — read this snapshot).
   *  Set by buildProgramIR right after the threaded map is created. */
  typeAliasNodes = new Map<string, unknown>();

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
  /**
   * >0 while lowering a CONDITION position (if/while/for/do condition, `!`
   * operand, ternary condition). JS `&&`/`||` return their OPERANDS, but in a
   * condition position only truthiness matters — the C++ `&&`/`||` pass
   * through unchanged there (short-circuit intact). In VALUE position the
   * binary lowering rewrites `a || b` to the ternary `(a) ? (a) : (b)` so the
   * result is the operand, not a bool. Double-eval of the left operand mirrors
   * the documented Math.max ternary trade-off.
   */
  conditionContextDepth = 0;
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

  /**
   * Sink for HAL ops resolved to C++ text while building THIS file's IR (the
   * template-inlining seams — see markHalOpResolved). Assigned by
   * buildProgramIR before any statement lowering and lifted onto
   * ProgramIR.resolvedHalOps at the end of the build, so per-file scans
   * (framework shims) see inlined ops without touching module-global state
   * (which would split across src/dist module instances under test). Null
   * outside a build (render-time resolutions are for ops that exist as IR
   * nodes — they don't need the sink).
   */
  resolvedHalOpsSink: HALOpIR[] | null = null;
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

/** Condition positions keep C++ `&&`/`||` (short-circuit, bool result is fine). */
export function enterConditionContext(): void {
  getContext().conditionContextDepth++;
}
export function exitConditionContext(): void {
  getContext().conditionContextDepth--;
}
export function inConditionContext(): boolean {
  return getContext().conditionContextDepth > 0;
}

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
export const crossModuleFunctionReturns = createMapProxy(ctx => ctx.crossModuleFunctionReturns);
export const registerFieldMap = createMapProxy(ctx => ctx.registerFieldMap);
export const halInstances = createMapProxy(ctx => ctx.halInstances);
export const topLevelAliasReceivers = createMapProxy(ctx => ctx.topLevelAliasReceivers);

/** Cross-module import aliases: LOCAL name -> SOURCE (exported) name.
 *  `import { runHelper as rh }` registers rh -> runHelper so call sites and
 *  reachability key on the exported definition's name. Reset per file. */
export const importNameAliases = new Map<string, string>();
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
export const arrayPushCounts = createMapProxy(ctx => ctx.arrayPushCounts);
export const unboundedArrayVars = createSetProxy(ctx => ctx.unboundedArrayVars);
export const moduleArrayLiteralVars = createSetProxy(ctx => ctx.moduleArrayLiteralVars);
export const functionScopeMutatedArrays = createSetProxy(ctx => ctx.functionScopeMutatedArrays);
export const mapEntryVarNames = createSetProxy(ctx => ctx.mapEntryVarNames);
export const filteredArrayLengthVars = createMapProxy(ctx => ctx.filteredArrayLengthVars);
export const activeNamespaceNames = createSetProxy(ctx => ctx.activeNamespaceNames);
export const topLevelClassNames = createSetProxy(ctx => ctx.topLevelClassNames);
export const topLevelInterfaceNames = createSetProxy(ctx => ctx.topLevelInterfaceNames);
export const objectTypeAliasNames = createSetProxy(ctx => ctx.objectTypeAliasNames);
export const classTypeNames = createSetProxy(ctx => ctx.classTypeNames);
export const activeEnumNames = createSetProxy(ctx => ctx.activeEnumNames);
export const activeFunctionTypeParams = createSetProxy(ctx => ctx.activeFunctionTypeParams);
export const userDeclaredVarNames = createSetProxy(ctx => ctx.userDeclaredVarNames);
export const activeStringEnumNames = createSetProxy(ctx => ctx.activeStringEnumNames);

export const activePinUsage = createMapProxy(ctx => ctx.activePinUsage);
export const activePeripheralUsage = createMapProxy(ctx => ctx.activePeripheralUsage);

export const peripheralAliasMap = createMapProxy(ctx => ctx.peripheralAliasMap);
export const pinAliasMap = createMapProxy(ctx => ctx.pinAliasMap);
export const mcuPinForwardMap = createMapProxy(ctx => ctx.mcuPinForwardMap);
export const mcuPinReverseMap = createMapProxy(ctx => ctx.mcuPinReverseMap);

export const requiredIncludes = createSetProxy(ctx => ctx.requiredIncludes);
export const registeredCallbacks = createArrayProxy(ctx => ctx.registeredCallbacks);
export const isrHandlerFunctions = createSetProxy(ctx => ctx.isrHandlerFunctions);

// activeLocalTypes / activeGlobalTypes / activeClassFieldTypes were proxied
// globals; they now live on the IrTypeScope (symbol-types.ts). Callers that
// still reference these by name must migrate to getCurrentIrTypeScope().

export const discriminatedUnionVariantNames = new Map<string, string[]>();

/**
 * Depth counter for expressions lowered as the direct operand of a `throw`.
 * `throw new Error(...)` lowers to cuttlefish_halt on no-exception targets
 * (the Error object is never constructed), so the new-Error VALUE diagnostic
 * must not fire while inside one.
 */
export let throwExpressionDepth = 0;
export function enterThrowExpression(): void { throwExpressionDepth += 1; }
export function exitThrowExpression(): void { throwExpressionDepth -= 1; }
export const restParamFunctions = createMapProxy(ctx => ctx.restParamFunctions);
export const activeFunctionReturnTypes = createMapProxy(ctx => ctx.activeFunctionReturnTypes);
export const doubleWidenedVars = createSetProxy(ctx => ctx.doubleWidenedVars);
export const typeAliasNodes = {
  clear(): void { getContext().typeAliasNodes.clear(); },
  get(name: string): unknown | undefined { return getContext().typeAliasNodes.get(name); },
  /** A real Map copy — typeNodeToCppType wants a genuine Map<string, ts.TypeNode>. */
  snapshot(): Map<string, ts.TypeNode> { return new Map(getContext().typeAliasNodes as Map<string, ts.TypeNode>); },
};

export function getActiveExtendsClass(): string | undefined { return getContext().activeExtendsClass; }
export function getActiveClassName(): string | undefined { return getContext().activeClassName; }
export function setActiveClassName(v: string | undefined): void { getContext().activeClassName = v; }
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
  importNameAliases.clear();
  (getContext() as unknown as { nullishHelperSeen: boolean }).nullishHelperSeen = false;
  (getContext() as unknown as { variantNarrowing: Map<string, string> }).variantNarrowing.clear();
  nestedClassAliases.clear();
  resetFunctionScopeState();
  activeNamespaceNames.clear();
  topLevelClassNames.clear();
  topLevelInterfaceNames.clear();
  objectTypeAliasNames.clear();
  typeAliasNodes.clear();
  classTypeNames.clear();
  activeEnumNames.clear();
  activeFunctionTypeParams.clear();
  activeStringEnumNames.clear();
  topLevelClasses.clear();
  crossModuleFunctionReturns.clear();
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
  isrHandlerFunctions.clear();
  discriminatedUnionVariantNames.clear();
  restParamFunctions.clear();
  activeFunctionReturnTypes.clear();
  getContext()._currentBoardConstants = undefined;
  // Detach the per-file resolved-op sink: ops resolved after this file's build
  // finished (emit-time routing, whose ops exist as IR nodes anyway) must not
  // append to the array already lifted onto the previous ProgramIR.
  getContext().resolvedHalOpsSink = null;
}

// ── Transpile-resolved HAL ops ──────────────────────────────────────────────
// HAL ops the transpiler resolves to C++ TEXT while inlining one HAL method
// inside another (e.g. `sense.readMillivolts()` in the argument of
// `USB0.writeLine(...)`) never appear as hal-op/hal-expr IR nodes, so the
// statement walk in program-analysis can't see them. routeHALOp and
// resolveHALExprToText record every op they successfully resolve here — the
// full op NODE, not just its name — and analyzeProgram merges these into the
// peripheral usage flags, while analyzePeripheralUsage merges them into the
// per-program PeripheralUsage (pins/instances included).
// Deliberately NOT cleared by
// resetBuildState (per-file): the ops resolve while building whichever file
// inlines them, and analyzeProgram runs later, at emit. resetTranspileResolvedHalOps
// clears it once per transpile run.
const transpileResolvedHalOps: HALOpIR[] = [];
export function markHalOpResolved(op: HALOpIR): void {
  transpileResolvedHalOps.push(op);
  // Per-file sink: the op may never exist as an IR node of the file being
  // built, so record it on that file's program-to-be (ProgramIR.resolvedHalOps)
  // as well — see CompilationContext.resolvedHalOpsSink.
  getContext().resolvedHalOpsSink?.push(op);
}
export function getTranspileResolvedOpNodes(): HALOpIR[] {
  return [...transpileResolvedHalOps];
}
export function getTranspileResolvedHalOps(): ReadonlySet<string> {
  return new Set(transpileResolvedHalOps.map((op) => op.operation));
}
export function resetTranspileResolvedHalOps(): void {
  transpileResolvedHalOps.length = 0;
}

export function resetFunctionScopeState(): void {
  activeCArrayVars.clear();
  activeArrayLiteralVars.clear();
  activeStringVars.clear();
  mutableArrayVars.clear();
  arrayLiteralSizes.clear();
  filteredArrayLengthVars.clear();
  // mapEntryVarNames is function-scoped: a same-named loop var in another
  // function must not inherit pair semantics. (arrayPushCounts and
  // unboundedArrayVars are deliberately NOT cleared — they are file-level
  // sizing facts, and cross-function staleness only ever over-sizes or routes
  // to std::vector, both safe.)
  mapEntryVarNames.clear();
  // NOTE: doubleWidenedVars is deliberately NOT cleared here. It is managed
  // by the numeric-widening prescan's save/clear/restore discipline in
  // lowerStatementList — clearing in this reset (which runs at Phase 2.7,
  // BEFORE the prescan's save at 2.7b) made a nested branch lowering wipe
  // the OUTER list's findings after the save had already captured an empty
  // set.
  // Clear the function-scoped portion of the current IrTypeScope (locals) and
  // re-seed it from classFields so `this->field` lookups keep resolving in the
  // next method. Mirrors the old behavior where resetFunctionScopeState copied
  // activeClassFieldTypes into activeLocalTypes. globals/classFields survive
  // (they are file-scoped, not function-scoped).
  const scope = getCurrentIrTypeScope();
  if (scope) {
    resetIrTypeScopeFunctionState(scope);
  }
  // activeClassName / activeExtendsClass are deliberately NOT cleared here.
  // They are CLASS-member-scoped, not function-scoped: declaration-builders
  // sets them around each member body (and clears extends per member, name at
  // the class end). Clearing them in this reset used to wipe the values
  // between that set and the first lowered statement of every method body —
  // so `super.method()` / `super.prop` inside a method evaluated as "outside
  // of class method", and the `this.getter` accessor path read
  // getActiveClassName() === undefined (falling back to a plain field read).
  // Nested lowerStatementList calls (arrow callbacks inside a method) keep
  // the enclosing class visible, which is exactly JS `super` semantics.
}
