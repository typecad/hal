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
    const baseLines = [
      '// cuttlefish runtime shim. Wrapped in a single include guard so the',
      '// block is safe to emit into multiple headers and .cpp files within',
      '// one translation unit (a .cpp may #include several headers that each',
      '// carry the shim, e.g. when a class method body uses `??` which lowers',
      '// to cuttlefish_nullish(...)). The guard ensures the definitions are',
      '// seen exactly once per TU.',
      '#ifndef CUTTLEFISH_SHIM_DEFINED',
      '#define CUTTLEFISH_SHIM_DEFINED',
      '#ifndef CUTTLEFISH_UNDEFINED',
      '#define CUTTLEFISH_UNDEFINED 0',
      '#endif',
      'template<typename T> inline bool cuttlefish_is_nullish(const T& v) { return false; }',
      'inline bool cuttlefish_is_nullish(long long v) { return v == CUTTLEFISH_UNDEFINED; }',
      'inline bool cuttlefish_is_nullish(int v) { return v == CUTTLEFISH_UNDEFINED; }',
      'inline bool cuttlefish_is_nullish(double v) { return v == static_cast<double>(CUTTLEFISH_UNDEFINED); }',
      'inline bool cuttlefish_is_nullish(bool v) { return v == false; }',
      'template<typename T> inline bool cuttlefish_is_nullish(T* v) { return v == nullptr; }',
      'template<typename T> inline bool cuttlefish_exists(const T& v) { return !cuttlefish_is_nullish(v); }',
      'template<typename T, typename U> inline T cuttlefish_nullish(const T& a, U b) { return !cuttlefish_is_nullish(a) ? a : (T)b; }',
      'namespace Date { inline long now() { auto t = std::chrono::system_clock::now(); return static_cast<long>(std::chrono::duration_cast<std::chrono::milliseconds>(t.time_since_epoch()).count()); } }',
      'inline uint32_t __tc_now_ms(void) { return static_cast<uint32_t>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count()); }',
    ];
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
    const polyfills: RuntimePolyfillIR[] = [
      {
        kind: 'polyfill',
        id: 'string_methods',
        domain: 'standard' as const,
        requiredIncludes: ['<sstream>'],
        forwardDeclarations: [],
        helperStructs: [],
        helperFunctions: [
          // ── Core string methods (existing) ─────────────────────────────
          'inline std::string __tc_toUpperCase(const std::string& s) { std::string r = s; for (auto& c : r) c = static_cast<char>(toupper(static_cast<unsigned char>(c))); return r; }',
          'inline std::string __tc_toLowerCase(const std::string& s) { std::string r = s; for (auto& c : r) c = static_cast<char>(tolower(static_cast<unsigned char>(c))); return r; }',
          'inline std::string __tc_trim(const std::string& s) { size_t start = s.find_first_not_of(" \\t\\n\\r"); if (start == std::string::npos) return ""; size_t end = s.find_last_not_of(" \\t\\n\\r"); return s.substr(start, end - start + 1); }',
          'inline std::string __tc_substring2(const std::string& s, int start, int end) { return s.substr(start, end - start); }',
          'inline std::string __tc_substring1(const std::string& s, int start) { return s.substr(start); }',
          'inline std::string __tc_replace(const std::string& s, const std::string& old, const std::string& repl) { std::string r = s; size_t pos = 0; while ((pos = r.find(old, pos)) != std::string::npos) { r.replace(pos, old.length(), repl); pos += repl.length(); } return r; }',
          'inline std::string __tc_charAt(const std::string& s, int idx) { return std::string(1, s[idx]); }',
          'inline int __tc_charCodeAt(const std::string& s, int idx) { return static_cast<int>(static_cast<unsigned char>(s[idx])); }',
          'inline std::vector<std::string> __tc_split(const std::string& s, const std::string& delim) { std::vector<std::string> parts; if (delim.empty()) { for (char c : s) parts.push_back(std::string(1, c)); return parts; } size_t start = 0, end; while ((end = s.find(delim, start)) != std::string::npos) { parts.push_back(s.substr(start, end - start)); start = end + delim.length(); } parts.push_back(s.substr(start)); return parts; }',
          // ── Extended string methods (Phase 1) ──────────────────────────
          'inline bool __tc_endsWith(const std::string& s, const std::string& suffix) { if (suffix.size() > s.size()) return false; return s.compare(s.size() - suffix.size(), suffix.size(), suffix) == 0; }',
          'inline int __tc_lastIndexOf(const std::string& s, const std::string& search) { size_t pos = s.rfind(search); return pos != std::string::npos ? static_cast<int>(pos) : -1; }',
          'inline std::string __tc_padStart(const std::string& s, int len, const std::string& fill) { if (static_cast<int>(s.size()) >= len) return s; std::string result; int padLen = len - static_cast<int>(s.size()); for (int i = 0; i < padLen; i++) result += fill[i % static_cast<int>(fill.size())]; return result + s; }',
          'inline std::string __tc_padStart_default(const std::string& s, int len) { return __tc_padStart(s, len, " "); }',
          'inline std::string __tc_padEnd(const std::string& s, int len, const std::string& fill) { if (static_cast<int>(s.size()) >= len) return s; std::string result = s; int padLen = len - static_cast<int>(s.size()); for (int i = 0; i < padLen; i++) result += fill[i % static_cast<int>(fill.size())]; return result; }',
          'inline std::string __tc_padEnd_default(const std::string& s, int len) { return __tc_padEnd(s, len, " "); }',
          'inline std::string __tc_repeat(const std::string& s, int count) { std::string result; for (int i = 0; i < count; i++) result += s; return result; }',
          // ── Overloaded includes/indexOf for std::string ────────────────
          'inline bool __tc_includes(const std::string& s, const std::string& search) { return s.find(search) != std::string::npos; }',
          'inline int __tc_indexOf(const std::string& s, const std::string& search) { size_t pos = s.find(search); return pos != std::string::npos ? static_cast<int>(pos) : -1; }',
          // ── String slice overloads ──────────────────────────────────────
          'inline std::string __tc_slice2(const std::string& s, int start, int end) { return s.substr(start, end - start); }',
          'inline std::string __tc_slice1(const std::string& s, int start) { return s.substr(start); }',
        ],
        shimMacros: [],
        dependencies: [],
      },
      {
        kind: 'polyfill',
        id: 'timer_methods',
        domain: 'standard' as const,
        // <atomic> for the cancel flag, <map>+<memory> for the handle store.
        // <future> kept for any caller that still threads a detached policy.
        requiredIncludes: ['<thread>', '<chrono>', '<future>', '<atomic>', '<map>', '<memory>'],
        forwardDeclarations: [],
        helperStructs: [],
        helperFunctions: [
          // Cancellable timer handles. The old shims launched a detached
          // std::async (`(void)f;`) whose `while(true)` ignored clear* —
          // cancelled timers kept firing and the futures leaked. Timers are a
          // language feature on native (not hardware), so they must actually
          // cancel: each handle owns an atomic cancel flag its worker thread
          // checks each iteration; clear* sets the flag. Leaked handles at
          // process exit are fine (the OS reclaims threads); the fix is about
          // correctness (a cleared timer stops firing) and bounded growth.
          'struct __tc_timer_handle { std::atomic<bool> cancelled{false}; std::thread worker; };',
          'static std::map<int, std::shared_ptr<__tc_timer_handle>>& __tc_timers() { static std::map<int, std::shared_ptr<__tc_timer_handle>> m; return m; }',
          'static int __tc_next_timer_id = 1;',
          'static int __tc_start_timer(std::function<void()> cb, long long ms, bool repeat) { int id = __tc_next_timer_id++; auto h = std::make_shared<__tc_timer_handle>(); h->worker = std::thread([h, cb, ms, repeat]() { if (repeat) { while (!h->cancelled.load()) { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); if (h->cancelled.load()) break; cb(); } } else { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); if (!h->cancelled.load()) cb(); } }); h->worker.detach(); __tc_timers()[id] = h; return id; }',
          'int __tc_setTimeout(std::function<void()> cb, long long ms) { return __tc_start_timer(cb, ms, false); }',
          'int __tc_setInterval(std::function<void()> cb, long long ms) { return __tc_start_timer(cb, ms, true); }',
          'void __tc_clearInterval(int id) { auto it = __tc_timers().find(id); if (it != __tc_timers().end()) { it->second->cancelled.store(true); __tc_timers().erase(it); } }',
          'void __tc_clearTimeout(int id) { __tc_clearInterval(id); }',
        ],
        shimMacros: [],
        dependencies: [],
      },
      {
        kind: 'polyfill',
        id: 'math_methods',
        domain: 'standard' as const,
        requiredIncludes: ['<cstdlib>', '<random>', '<iomanip>', '<sstream>'],
        forwardDeclarations: [],
        helperStructs: [],
        helperFunctions: [
          'inline double __tc_random() { static std::mt19937 gen(std::random_device{}()); static std::uniform_real_distribution<double> dist(0.0, 1.0); return dist(gen); }',
          'inline std::string __tc_toFixed(double val, int digits) { std::ostringstream oss; oss << std::fixed << std::setprecision(digits) << val; return oss.str(); }',
        ],
        shimMacros: [],
        dependencies: [],
      },
      {
        kind: 'polyfill',
        id: 'array_methods',
        domain: 'standard' as const,
        // `<sstream>` is required by `__tc_join` below (it builds the joined
        // string through a `std::ostringstream`). A project that uses `.join`
        // WITHOUT also pulling in `__tc_toFixed`/`__tc_random` (whose
        // `math_methods` block is what previously transitively included
        // `<sstream>`) emitted the `__tc_join` template with no `<sstream>`
        // → g++ "std::ostringstream has incomplete type". Declaring the include
        // on THIS block makes `.join` self-contained. Demo #32 Finding B.
        requiredIncludes: ['<algorithm>', '<map>', '<sstream>'],
        forwardDeclarations: [],
        helperStructs: [],
        helperFunctions: [
          // ── Core array methods (existing) ───────────────────────────────
          'template<typename T> std::string __tc_join(const std::vector<T>& v, const std::string& delim) { std::ostringstream oss; for (size_t i = 0; i < v.size(); i++) { if (i > 0) oss << delim; oss << v[i]; } return oss.str(); }',
          'template<typename T> std::vector<T> __tc_slice2(const std::vector<T>& v, int start, int end) { if (end > static_cast<int>(v.size())) end = static_cast<int>(v.size()); return std::vector<T>(v.begin() + start, v.begin() + end); }',
          'template<typename T> std::vector<T> __tc_slice1(const std::vector<T>& v, int start) { return std::vector<T>(v.begin() + start, v.end()); }',
          'template<typename T> std::vector<T> __tc_reverse(std::vector<T> v) { std::reverse(v.begin(), v.end()); return v; }',
          // ── Overloaded includes/indexOf for std::vector ─────────────────
          'template<typename T> bool __tc_includes(const std::vector<T>& v, const T& val) { return std::find(v.begin(), v.end(), val) != v.end(); }',
          'template<typename T> int __tc_indexOf(const std::vector<T>& v, const T& val) { auto it = std::find(v.begin(), v.end(), val); return it != v.end() ? static_cast<int>(it - v.begin()) : -1; }',
          // ── Array mutation methods (Phase 1) ────────────────────────────
          'template<typename T> T __tc_shift(std::vector<T>& v) { T val = v.front(); v.erase(v.begin()); return val; }',
          'template<typename T> T __tc_pop(std::vector<T>& v) { T val = v.back(); v.pop_back(); return val; }',
          'template<typename T> void __tc_unshift(std::vector<T>& v, const T& val) { v.insert(v.begin(), val); }',
          'template<typename T> void __tc_sort(std::vector<T>& v) { std::sort(v.begin(), v.end()); }',
          'template<typename T, typename F> void __tc_sort_fn(std::vector<T>& v, F comp) { std::sort(v.begin(), v.end(), [&v, comp](const typename std::vector<T>::value_type& a, const typename std::vector<T>::value_type& b) { return comp(a, b) < 0; }); }',
          'template<typename T> void __tc_fill(std::vector<T>& v, const T& val) { std::fill(v.begin(), v.end(), val); }',
          'template<typename T> void __tc_fill3(std::vector<T>& v, const T& val, int start, int end) { if (end > static_cast<int>(v.size())) end = static_cast<int>(v.size()); std::fill(v.begin() + start, v.begin() + end, val); }',
          'template<typename T> std::vector<T> __tc_concat(const std::vector<T>& a, const std::vector<T>& b) { std::vector<T> result = a; result.insert(result.end(), b.begin(), b.end()); return result; }',
          'template<typename T> std::vector<T> __tc_splice1(std::vector<T>& v, int start) { std::vector<T> removed(v.begin() + start, v.end()); v.erase(v.begin() + start, v.end()); return removed; }',
          'template<typename T> std::vector<T> __tc_splice2(std::vector<T>& v, int start, int deleteCount) { int end = start + deleteCount; if (end > static_cast<int>(v.size())) end = static_cast<int>(v.size()); std::vector<T> removed(v.begin() + start, v.begin() + end); v.erase(v.begin() + start, v.begin() + end); return removed; }',
          // ── Array functional methods (Phase 1) ──────────────────────────
          'template<typename T, typename F> std::vector<T> __tc_filter(const std::vector<T>& v, F pred) { std::vector<T> result; for (const auto& x : v) if (pred(x)) result.push_back(x); return result; }',
          'template<typename T, typename F> auto __tc_map(const std::vector<T>& v, F fn) -> std::vector<decltype(fn(v[0]))> { using R = decltype(fn(v[0])); std::vector<R> result; result.reserve(v.size()); for (const auto& x : v) result.push_back(fn(x)); return result; }',
          'template<typename T, typename U, typename F> auto __tc_reduce(const std::vector<T>& v, F fn, U init) -> U { U acc = init; for (const auto& x : v) acc = fn(acc, x); return acc; }',
          'template<typename T, typename F> T __tc_reduce_no_init(std::vector<T>& v, F fn) { T acc = v[0]; for (size_t i = 1; i < v.size(); i++) acc = fn(acc, v[i]); return acc; }',
          'template<typename T, typename F> T __tc_find(const std::vector<T>& v, F pred) { for (const auto& x : v) if (pred(x)) return x; return T(); }',
          'template<typename T, typename F> int __tc_findIndex(const std::vector<T>& v, F pred) { for (int i = 0; i < static_cast<int>(v.size()); i++) if (pred(v[i])) return i; return -1; }',
          'template<typename T, typename F> bool __tc_every(const std::vector<T>& v, F pred) { for (const auto& x : v) if (!pred(x)) return false; return true; }',
          'template<typename T, typename F> bool __tc_some(const std::vector<T>& v, F pred) { for (const auto& x : v) if (pred(x)) return true; return false; }',
          // ── Map helper methods (Object.keys/values/entries) ──────────────
          'template<typename K, typename V> std::vector<K> __tc_mapKeys(const std::map<K, V>& m) { std::vector<K> keys; for (const auto& p : m) keys.push_back(p.first); return keys; }',
          'template<typename K, typename V> std::vector<V> __tc_mapValues(const std::map<K, V>& m) { std::vector<V> vals; for (const auto& p : m) vals.push_back(p.second); return vals; }',
          'template<typename K, typename V> std::vector<std::pair<K, V>> __tc_mapEntries(const std::map<K, V>& m) { std::vector<std::pair<K, V>> entries; for (const auto& p : m) entries.push_back(p); return entries; }',
          // ── Set helper methods (Set.values()/keys()/entries()) ───────────
          // Set.values()/keys() both yield the elements; entries() yields
          // pair<elem,elem>. (demo #15 fix A)
          'template<typename T> std::vector<T> __tc_setValues(const std::set<T>& s) { std::vector<T> vals; for (const auto& x : s) vals.push_back(x); return vals; }',
          'template<typename T> std::vector<std::pair<T, T>> __tc_setEntries(const std::set<T>& s) { std::vector<std::pair<T, T>> entries; for (const auto& x : s) entries.push_back({x, x}); return entries; }',
          // ── Object.fromEntries helper ───────────────────────────────
          'template<typename K, typename V> std::map<K, V> __tc_fromEntries(const std::vector<std::pair<K, V>>& entries) { std::map<K, V> result; for (const auto& p : entries) result[p.first] = p.second; return result; }',
          // ── JSON helpers ─────────────────────────────────────────────
          'inline std::string __tc_jsonStringify(const std::string& s) { return s; }',
          'template<typename T> std::string __tc_jsonStringify(const T& v) { return std::to_string(v); }',
          'inline std::string __tc_jsonParse(const std::string& s) { return s; }',
        ],
        shimMacros: [],
        dependencies: [],
      },
    ];
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

  colorFormat(): "rgb565" | "rgb666" | "rgb888" | "mono" {
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
