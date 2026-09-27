// ---------------------------------------------------------------------------
// NativeStrategy — standard C++ target for portable Windows/Linux executables
//
// Outputs standard C++ with main(), std::string, and std::thread-
// based async. No hardware or Arduino dependencies.
//
// EMIT BOUNDARY: This file is a canonical entry point of the framework strategy
// surface (B) — its main()/stdout scaffold bytes land in user executables.
// The emitted bytes are covered by the TypeCAD Runtime Exception (see
// RUNTIME_EXCEPTION.md at the repository root) and are not subject to the
// license of this tool source.
// ---------------------------------------------------------------------------

import type {
  PlatformStrategy,
  ExpressionIR,
  ProgramIR,
  Diagnostic,
  PlatformContext,
  BoardConstants,
  RuntimePolyfillIR,
  StdLibSupport,
  AsyncRuntimeConfig,
  GraphicsCapacity,
  DisplayHALOp,
} from '../../api/shared/index.js';
import { DEFAULT_STDLIB_SUPPORT, generateStaticAsyncRuntime } from '../../api/shared/index.js';
import { programUsesSafety } from '../../api/index.js';
import { hostedCoreShimLines, hostedPolyfillIRs } from "./hosted-shim.js";
import { resolveTerminalPreviewOp } from './graphics/terminal-preview.js';

export class NativeStrategy implements PlatformStrategy {
  readonly id = 'native';

  // ── Profile ─────────────────────────────────────────────────────────────

  forcedIncludes(program: ProgramIR, ctx?: PlatformContext): string[] {
    // <cstdint>, <cctype>, and <chrono> are universal: type-resolution passes
    // int32_t/uint8_t/etc. through verbatim, char classification is broadly
    // used, and the shim unconditionally emits Date.now()/millis() definitions
    // that reference std::chrono (see shimLines). The remaining headers are
    // gated on usage analysis so a native program that doesn't touch
    // std::vector / etc. doesn't pull them in. When ctx.analysis is absent
    // (capability queries, manifest validation), the gates default open to
    // preserve existing behavior in those paths.
    const inc: string[] = ['<cctype>', '<cstdint>', '<chrono>'];
    const a = (ctx as any)?.analysis;
    const uses = (f: string): boolean => a ? !!a[f] : true;
    if (uses('usesVectorTypes')) inc.push('<vector>');
    if (uses('usesStdMap')) inc.push('<map>');
    if (uses('usesSet')) inc.push('<set>');
    if (uses('usesAlgorithm')) inc.push('<algorithm>');
    if (uses('usesCstdio')) inc.push('<cstdio>');
    return inc;
  }

  symbolAliases(): Record<string, string> {
    return {};
  }

  shimLines(program: ProgramIR, ctx?: PlatformContext): string[] {
    const a = (ctx as any)?.analysis;
    const uses = (f: string): boolean => a ? !!a[f] : true;
    const baseLines = hostedCoreShimLines();
    // Arduino-compat polyfills (pin reads, constrain, map) — emit only when the
    // program (or a mounted UI) actually references them. The UI runtime references
    // digitalRead/HIGH/LOW, so emit them when GPIO is in use too. Default open
    // when ctx.analysis is absent (capability queries).
    if (uses('usesDigitalRead') || uses('usesGPIO')) {
      baseLines.push(
        '#ifndef HIGH', '#define HIGH 1', '#endif',
        '#ifndef LOW', '#define LOW 0', '#endif',
        '#ifndef PROGMEM', '#define PROGMEM', '#endif',
        'inline int digitalRead(int) { return LOW; }',
      );
    }
    if (uses('usesMap')) {
      baseLines.push('inline long map(long x, long in_min, long in_max, long out_min, long out_max) { return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min; }');
    }
    if (uses('usesConstrain')) {
      baseLines.push('inline long constrain(long x, long a, long b) { return x < a ? a : (x > b ? b : x); }');
    }
    baseLines.push('#endif // CUTTLEFISH_SHIM_DEFINED');
    // Safety: emit the __tc_gpio_read / __tc_delay_us shims when the program
    // uses @typecad/safety. Native target stubs GPIO read (the SDL simulator
    // doesn't model real digital input levels) and the microsecond delay
    // (no real timing source); returns 0 (LOW) / no-op. Real native demos
    // that exercise safe.read would need their own input source wired in here.
    if (program && programUsesSafety(program)) {
      baseLines.push(
        'inline int __tc_gpio_read(uint32_t pin) { return 0; }',
        'inline void __tc_gpio_write(uint32_t pin, uint32_t value) { (void)pin; (void)value; }',
        '#ifndef __TC_DELAY_US_DEFINED',
        '#define __TC_DELAY_US_DEFINED',
        'inline void __tc_delay_us(uint32_t us) { (void)us; }',
        '#endif',
      );
    }
    return baseLines;
  }

  profileDiagnostics(): Diagnostic[] {
    return [];
  }

  // ── File shape ──────────────────────────────────────────────────────────

  sourceExtension(): string {
    return 'cpp';
  }

  entrypointFunctionName(): string {
    return 'main';
  }

  requiresLoopFunction(): boolean {
    return false;
  }

  overrideBaseName(originalBaseName: string): string {
    return originalBaseName;
  }

  effectiveEmitMode(requestedMode: string): string {
    return requestedMode;
  }

  // ── Type normalisation ──────────────────────────────────────────────────

  normalizeCppType(typeName: string): string {
    // Preserve auto — C++ compiler deduces the correct type (critical for template returns)
    if (typeName === 'auto') return 'auto';
    // JavaScript number is 64-bit — map to long long to avoid overflow
    if (typeName === 'int') return 'long long';
    // JavaScript number fractional precision needs double, not float
    if (typeName === 'float') return 'double';
    // Map StaticArray back to its alias name (handled by pipeline typedef)
    if (typeName.startsWith("__tc_StaticArray")) {
      const match = typeName.match(/^__tc_StaticArray<(.+),\s*\d+>$/);
      if (match) return `std::vector<${match[1]}>`;
      return typeName.replace("__tc_StaticArray", "StaticArray");
    }
    return typeName;
  }

  defaultNumericType(compliance?: { isBanned(ruleId: string): boolean }): string {
    return compliance?.isBanned("A3-9-1") ? 'int64_t' : 'long long';
  }

  mapReturnType(functionName: string, returnType: string): string {
    if (functionName === 'main') return 'int';
    return this.normalizeCppType(returnType);
  }

  isStringLikeType(cppType: string): boolean {
    return cppType === "std::string" || cppType === "const char*" || cppType === "char*";
  }

  isPointerType(cppType: string): boolean {
    return cppType.endsWith("*");
  }

  mapFunctionName(originalName: string): string {
    if (originalName === '__cuttlefish_entrypoint__') return 'main';
    return originalName;
  }

  // ── Expression rendering ────────────────────────────────────────────────

  normalizeRawExpression(value: string): string {
    let prev = '';
    let v = value;
    // NOTE: array/collection method lowering (`.push`/`.pop`/`.map`/`.filter`/
    // `.splice`/... → `__tc_*` helpers) and `.length` → `.size()` previously
    // lived here as RECV-regex rewrites over rendered C++ text. They have been
    // MOVED to structural IR-build-time lowering: array mutators in
    // `ir/transformers/array-methods.ts` `tryLowerArrayAndStringMethods`
    // (gated to hosted targets via `requiresLoopFunction()`), and `.length` in
    // `ir/expression-to-ir.ts` `resolveLengthProperty`. Both render the
    // receiver via `expressionToIR` so pointer/value access is already correct,
    // eliminating the RECV receiver-capture class of bug (demo #22 Finding A,
    // where `(\w+)` stopped at `>` and emitted `this->__tc_pop(ops)`).
    //
    // What remains here is genuinely text-level: literal→sentinel and
    // well-known free-function rewrites that don't depend on symbol resolution.
    while (prev !== v) {
      prev = v;
      v = v.replace(/\bundefined\b/g, 'CUTTLEFISH_UNDEFINED');
      v = v.replace(/\bnull\b/g, 'CUTTLEFISH_UNDEFINED');
      v = v.replace(/Date\.now\(\)/g, 'Date::now()');
      // String-method lowering now happens at IR-build time
      // (tryLowerArrayAndStringMethods in array-methods.ts, demo #27 Findings
      // D/E), so it handles every receiver shape (bare id / this.field /
      // obj.field / X[i]) structurally. The old text-level
      // `applyStringMethodRewrites` call is removed; its RECEIVER_PATTERN only
      // matched bare identifiers and `.member` chains, which left
      // `ALPHABET[i].toLowerCase()` verbatim and failed to register the
      // `__tc_toLowerCase` helper. The native `startsWith` → `rfind` special
      // case is preserved inside the structural lowering (lowerStringMethod).
      v = v.replace(/JSON\.stringify\(([^)]+)\)/g, '__tc_jsonStringify($1)');
      v = v.replace(/JSON\.parse\(([^)]+)\)/g, '__tc_jsonParse($1)');
    }
    return v;
  }

  nullValue(): string {
    return 'CUTTLEFISH_UNDEFINED';
  }

  wrapStringConcat(): string | undefined {
    return undefined;
  }

  wrapStringObject(value: string): string {
    // With useSnprintfForStrings() = true, concat flows through the snprintf
    // path and this fallback is rarely used. Keep std::to_string for safety,
    // but it must never receive an enum/class instance in practice.
    return `std::to_string(${value})`;
  }

  useSnprintfForStrings(): boolean {
    // Unify native with the Arduino/AVR snprintf path so string concatenation
    // handles enums/floats/objects correctly and never emits std::to_string
    // on non-arithmetic types. See inferFormatSpecifier for type handling.
    return true;
  }

  promoteDivisionToDouble(): boolean {
    return true;
  }

  renameEnumMember(_enumName: string, memberName: string): string {
    return memberName;
  }

  private _largeEnumNames = new Set<string>();

  setLargeEnumNames(names: ReadonlySet<string>): void {
    this._largeEnumNames = new Set(names);
  }

  enumCastType(enumName: string): string | undefined {
    return undefined;
  }

  renderBoardDefinitionAccess(): string | undefined {
    return undefined;
  }

  // ── Statement rendering ─────────────────────────────────────────────────

  /**
   * Native lowers array literals to std::vector (not __tc_StaticArray), so the
   * structural array-method lowering must use the std::vector/__tc_* helper form
   * (.push_back, __tc_pop) rather than the StaticArray wrapper's .push/.pop.
   * Embedded/generic targets promote literals to StaticArray and default to true.
   */
  promotesArrayLiteralsToStaticArray(): boolean {
    return false;
  }

  renderThrow(valueExpr: string): string {
    return `throw ${valueExpr};`;
  }

  objectFieldInitializer(): string | undefined {
    return undefined;
  }

  overrideClassFieldType(_fieldName: string, normalizedType: string): string {
    return normalizedType;
  }

  // ── Name guards ─────────────────────────────────────────────────────────

  reservedNames(): ReadonlySet<string> {
    return new Set<string>();
  }
  passthroughMacroNames(): ReadonlySet<string> {
    return new Set<string>();
  }

  apiReservedEnumNames(): ReadonlySet<string> {
    return new Set<string>();
  }

  apiReservedEnumGuard(): string {
    return '';
  }

  ambientTypeDeclarations(): string[] {
    return [
      "",
      "  // Host timers — real OS threads back these on the native (host) target",
      "  // only. Embedded targets have no JS-named timers: periodic work is a",
      "  // Thread.",
      "  declare function setInterval(handler: () => void, timeout?: number): number;",
      "  declare function setTimeout(handler: () => void, timeout?: number): number;",
      "  declare function clearInterval(id: number): void;",
      "  declare function clearTimeout(id: number): void;",
    ];
  }

  // ── Includes ────────────────────────────────────────────────────────────

  needsIostream(): boolean { return true; }
  needsStdString(): boolean { return true; }
  needsStdVector(): boolean { return true; }
  needsStdExcept(): boolean { return true; }
  needsStdFunction(): boolean { return true; }
  mathHeader(): string { return '<cmath>'; }
  cstringHeader(): string { return '<cstring>'; }
  needsLargeEnumUnderlying(): boolean { return false; }

  // ── Struct field handling ───────────────────────────────────────────────

  renameStructField(fieldName: string): string {
    return fieldName;
  }

  structFieldInitializer(): string | undefined {
    return undefined;
  }

  // ── Async — std::async background pump ──────────────────────────────────

  getAsyncRuntimeConfig(): AsyncRuntimeConfig {
    return {
      queueCapacity: 256,
      scheduler: "thread",
      waitForPinEdge: "stub",
      hasPromiseRuntime: true,
      hasTimers: true,
      requiredIncludes: ["<functional>", "<vector>", "<utility>", "<string>", "<thread>", "<chrono>", "<future>"],
    };
  }

  asyncLoopInjection(taskVarNames: string[], config: AsyncRuntimeConfig): string[];
  asyncLoopInjection(taskVarNames: string[], hasPromiseRuntime: boolean, hasTimers: boolean): string[];
  asyncLoopInjection(taskVarNames: string[], configOrBool: AsyncRuntimeConfig | boolean, hasTimers?: boolean): string[] {
    let hasPromiseRuntime: boolean;
    let hasTimersVal: boolean;
    if (typeof configOrBool === 'boolean') {
      hasPromiseRuntime = configOrBool;
      hasTimersVal = hasTimers ?? false;
    } else {
      hasPromiseRuntime = configOrBool.hasPromiseRuntime;
      hasTimersVal = configOrBool.hasTimers;
    }
    const lines: string[] = [];
    if (taskVarNames.length > 0 || hasPromiseRuntime) {
      lines.push('std::async(std::launch::async, [&]() {');
      lines.push('  while (true) {');
      for (const n of taskVarNames) {
        lines.push(`    ${n}.run();`);
      }
      if (hasPromiseRuntime) {
        lines.push('    cuttlefish_pump_microtasks();');
      }
      lines.push('    std::this_thread::sleep_for(std::chrono::milliseconds(1));');
      lines.push('  }');
      lines.push('});');
    }
    return lines;
  }

  asyncDriverFunctionName(): string {
    return 'main';
  }

  // ── Type aliases ────────────────────────────────────────────────────────

  shouldSkipTypeAlias(): boolean {
    return false;
  }

  // ── Diagnostics ─────────────────────────────────────────────────────────

  emitDiagnostics(): Diagnostic[] {
    return [];
  }

  currentTimeMillis(): string {
    return '__tc_now_ms()';
  }

  // ── Build configuration ──────────────────────────────────────────────────

  asyncQueueCapacity(): number { return 256; }
  outputSubdirectory(_baseName: string): string { return ".build"; }
  generateHeaderFile(): boolean { return true; }
  enumApiGuard(_enumName: string): { open: string; close: string } | undefined { return undefined; }
  getStdLibSupport(_architecture?: string): StdLibSupport { return DEFAULT_STDLIB_SUPPORT; }

  // ── Native polyfills ────────────────────────────────────────────────────

  nativePolyfills(): Set<string> {
    return new Set(['console', 'string_methods', 'timer_methods', 'array_methods', 'math_methods']);
  }

  generateNativePolyfills(program?: ProgramIR): RuntimePolyfillIR[] {
    const polyfills: RuntimePolyfillIR[] = [...hostedPolyfillIRs()];
    // Heap-free async runtime, mirroring the Zephyr strategy: the static
    // runtime needs no STL headers and polls the millis() shim the native
    // base shim defines unconditionally. Polyfill definitions emit before
    // shimLines, so forward-declare millis() for the runtime's timer bodies.
    if (program && program.functions.some((fn: any) => fn && fn.isAsync)) {
      polyfills.push({
        kind: 'polyfill',
        id: 'async_runtime',
        domain: 'embedded' as const,
        requiredIncludes: [],
        forwardDeclarations: ['uint32_t __tc_now_ms(void);'],
        helperStructs: [generateStaticAsyncRuntime(8, this.getAsyncRuntimeConfig().waitForPinEdge)],
        helperFunctions: [],
        shimMacros: [],
        dependencies: [],
        hasPromiseRuntime: true,
      } as RuntimePolyfillIR);
    }
    return polyfills;
  }

  // ── Graphics ───────────────────────────────────────────────────────────
  resolveDisplayOp(op: DisplayHALOp): { code?: string; expression?: string } | undefined {
    // The sdl driver has a real display adapter (SdlGfxTarget) that defines
    // display_init() etc., so route its display.init op to a real call instead
    // of the terminal-preview comment. Other ops (fill_rect/draw_text/flush)
    // are drawn by the reactive runtime through the HAL, not via DisplayHALOp,
    // so they stay as comments (harmless — the runtime drives the real draws).
    if (op.operation === "display.init" && op.driver === "sdl") {
      return { code: "display_init();" };
    }
    return resolveTerminalPreviewOp(op);
  }

  // SDL event loop: pump SDL events, tick the UI, present the framebuffer each
  // frame. Only active when a UI is mounted (the emitter's entryHasUI() gate),
  // so non-UI native programs stay single-shot. The preIteration body is emitted
  // into the same .cpp as the runtime header, so it can call ui_kb_* /
  // ui_apply_scroll_delta / ui_hit_test / __ui_kb_visible directly.
  hostEventLoop() {
    return {
      flagName: "sdl_running",
      continueCondition: "sdl_running",
      preIteration: [
        // Feature 3 — event-driven mouse: SDL_MOUSEBUTTONDOWN/MOTION/BUTTONUP
        // write to file-scope __sdl_mouse_* state that the SDL touch shim reads
        // (instead of polling SDL_GetMouseState every frame). The flags are
        // declared alongside the other __sdl_* globals in the SDL adapter.
        `SDL_Event __e; while (SDL_PollEvent(&__e)) {`,
        `  if (__e.type == SDL_QUIT) { sdl_running = false; }`,
        `  else if (__e.type == SDL_MOUSEBUTTONDOWN || __e.type == SDL_MOUSEBUTTONUP) {`,
        `    __sdl_mouse_down = (__e.type == SDL_MOUSEBUTTONDOWN && __e.button.button == SDL_BUTTON_LEFT) ? 1 : 0;`,
        `    __sdl_mouse_x = static_cast<int16_t>(__e.button.x);`,
        `    __sdl_mouse_y = static_cast<int16_t>(__e.button.y);`,
        `  } else if (__e.type == SDL_MOUSEMOTION) {`,
        `    __sdl_mouse_x = static_cast<int16_t>(__e.motion.x);`,
        `    __sdl_mouse_y = static_cast<int16_t>(__e.motion.y);`,
        `  }`,
        // Feature 1 — real keyboard text input: route keystrokes into the
        // on-screen keyboard buffer while it's visible, so a desktop user types
        // on their real keyboard instead of clicking the 6×4 grid. Start/stop
        // SDL text input to track visibility (also enables IME composition).
        `  else if (__e.type == SDL_TEXTINPUT) {`,
        `    if (__ui_kb_visible) { for (int __i = 0; __e.text.text[__i] != 0 && __i < 4; __i++) ui_kb_insert(__e.text.text[__i]); }`,
        `  } else if (__e.type == SDL_KEYDOWN && __ui_kb_visible) {`,
        `    if (__e.key.keysym.sym == SDLK_BACKSPACE) ui_kb_delete();`,
        `    else if (__e.key.keysym.sym == SDLK_RETURN || __e.key.keysym.sym == SDLK_KP_ENTER || __e.key.keysym.sym == SDLK_ESCAPE) ui_kb_close();`,
        `  }`,
        // Feature 2 — mouse-wheel scrolling: SDL_MOUSEWHEEL scrolls the
        // scrollable container under the cursor. Query the live mouse position
        // here (NOT __sdl_mouse_x/y — those only update on MOTION, so they go
        // stale when the user stops moving the mouse and just spins the wheel).
        // Use ui_scroll_node_at (the same scan the touch path uses) — the
        // hit-test + ancestor-walk approach misses when the cursor is over a
        // non-child node (text/sibling/padding), giving "works on some screens,
        // needs two attempts" behavior. Pass event.wheel.y through UNNEGATED:
        // ui_apply_scroll_delta does nextY = sy - dy, so wheel-down (-1) yields
        // dy=-40 → scrollY increases → scrolls toward bottom (the desktop
        // expectation). SDL already delivers the OS's natural-scroll direction,
        // so this respects the system preference with no extra setting needed.
        `  else if (__e.type == SDL_MOUSEWHEEL && !__ui_kb_visible) {`,
        `    int __wx, __wy; SDL_GetMouseState(&__wx, &__wy);`,
        // Scale window/logical coords to framebuffer coords (same as
        // touch_readRaw) so the hit-test lands on the right node in fullscreen,
        // where the window is larger than the fixed w_×h_ framebuffer.
        `    int __ww = 0, __wh = 0; SDL_GetWindowSize(__tc_display.win, &__ww, &__wh);`,
        `    if (__ww <= 0) __ww = display_width();`,
        `    if (__wh <= 0) __wh = display_height();`,
        `    int16_t __fx = static_cast<int16_t>(static_cast<int32_t>(__wx) * display_width() / __ww);`,
        `    int16_t __fy = static_cast<int16_t>(static_cast<int32_t>(__wy) * display_height() / __wh);`,
        `    int16_t __owner = ui_scroll_node_at(__fx, __fy);`,
        `    if (__owner >= 0) ui_apply_scroll_delta(__owner, static_cast<int16_t>(__e.wheel.y * 40));`,
        `  }`,
        `}`,
        // Track keyboard visibility with SDL text input so IME composition works
        // and the OS shows an on-screen cursor while typing. Self-corrects each
        // frame rather than hooking ui_kb_open/close (no cross-layer wiring).
        `if (__ui_kb_visible && !SDL_IsTextInputActive()) SDL_StartTextInput();`,
        `else if (!__ui_kb_visible && SDL_IsTextInputActive()) SDL_StopTextInput();`,
      ].join(" "),
      postIteration: "display_present();",
    };
  }

  supportedDisplayDrivers(): ReadonlySet<string> {
    // Only `sdl` has a registered display adapter (display-adapter.ts registers
    // st7796/ssd1680/ssd1309/sdl/ili9341). `native-preview` was a terminal-stub
    // concept that was never wired up as a real adapter — advertising it here
    // let mount validation pass and then crashed the transpile with
    // "No display adapter registered for driver native-preview". Drop it so the
    // standard "Unsupported display driver" error fires up front instead.
    return new Set(["sdl"]);
  }

  modelsGpio(): boolean {
    // The SDL desktop target has no GPIO pins. ui.watchPin / ui.press({pin})
    // are GPIO-hardware APIs with no native equivalent — the shim's digitalRead
    // returns constant LOW (so watchers never fire) and pinMode/attachInterrupt
    // are undefined (link failure). Returning false makes the entrypoint
    // synthesizer emit a clear transpile-time diagnostic instead of those.
    return false;
  }

  // ── Atomic HAL primitives (no GPIO on the native target) ──────────────────
  // These return documented no-op stubs so cuttlefish never emits a Wiring
  // token by name. The native target has no GPIO/timing hardware.
  readDigitalPin(_pin: string): string {
    return "/* gpio unavailable on native target */ 0";
  }
  readAnalogPin(_pin: string): string {
    return "/* adc unavailable on native target */ 0";
  }
  writeDigitalPin(_pin: string, _val: string): string {
    return "/* gpio unavailable on native target */";
  }
  setPinMode(_pin: string, _mode: string): string {
    return "/* gpio unavailable on native target */";
  }
  delayMs(_ms: string): string {
    return "/* delay unavailable on native target */";
  }
  delayMicroseconds(_us: string): string {
    return "/* delay unavailable on native target */";
  }
  halCallNames(): ReadonlySet<string> {
    return new Set<string>();
  }
  isHalCall(_name: string): boolean {
    return false;
  }
  analogReadCallNames(): ReadonlySet<string> {
    return new Set<string>();
  }

  colorFormat(): "rgb565" | "rgb666" | "rgb888" | "mono" | "gray8" {
    // Honor the resolved display profile's colorFormat so an rgb888 SDL target
    // lowers colors at full 888 precision (and emits UI_COLOR_DEPTH 888).
    // Defaults to rgb565 for non-display native programs (byte-identical).
    try {
      const { getDisplayProfile } = require('../../api/shared/index.js');
      const profile = getDisplayProfile?.();
      if (profile?.colorFormat) return profile.colorFormat as any;
    } catch {
      // getDisplayProfile not available (e.g. capability query before a build) → default.
    }
    return "rgb565";
  }

  graphicsCapacity(): GraphicsCapacity {
    return {
      maxNodes: Number.MAX_SAFE_INTEGER,
      maxBindings: Number.MAX_SAFE_INTEGER,
      maxActiveTransitions: Number.MAX_SAFE_INTEGER,
      nodeStorage: "flash",
    };
  }
}
