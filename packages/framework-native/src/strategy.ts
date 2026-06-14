// ---------------------------------------------------------------------------
// NativeStrategy — standard C++ target for portable Windows/Linux executables
//
// Outputs standard C++ with main(), std::cout, std::string, and std::thread-
// based async. No hardware or Arduino dependencies.
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
} from '@typecad/cuttlefish/api/shared';
import { DEFAULT_STDLIB_SUPPORT, applyStringMethodRewrites } from '@typecad/cuttlefish/api/shared';

export class NativeStrategy implements PlatformStrategy {
  readonly id = 'native';

  // ── Profile ─────────────────────────────────────────────────────────────

  forcedIncludes(): string[] {
    // <cstdint> is needed because DIRECT_CPP_TYPE_MAP (type-resolution.ts)
    // passes int32_t/uint8_t/etc. through verbatim, and the native default
    // include set doesn't otherwise pull in their definitions.
    return ['<cctype>', '<cstdint>'];
  }

  symbolAliases(): Record<string, string> {
    return {};
  }

  shimLines(): string[] {
    return [
      '#ifndef CUTTLEFISH_UNDEFINED',
      '#define CUTTLEFISH_UNDEFINED 0',
      '#endif',
      'template<typename T> inline bool cuttlefish_is_nullish(const T& v) { return false; }',
      'inline bool cuttlefish_is_nullish(long long v) { return v == CUTTLEFISH_UNDEFINED; }',
      'inline bool cuttlefish_is_nullish(int v) { return v == CUTTLEFISH_UNDEFINED; }',
      'inline bool cuttlefish_is_nullish(double v) { return v == (double)CUTTLEFISH_UNDEFINED; }',
      'inline bool cuttlefish_is_nullish(bool v) { return v == false; }',
      'template<typename T> inline bool cuttlefish_is_nullish(T* v) { return v == nullptr; }',
      'template<typename T> inline bool cuttlefish_exists(const T& v) { return !cuttlefish_is_nullish(v); }',
      'template<typename T, typename U> inline T cuttlefish_nullish(const T& a, U b) { return !cuttlefish_is_nullish(a) ? a : (T)b; }',
      'namespace Date { inline long now() { auto t = std::chrono::system_clock::now(); return (long)std::chrono::duration_cast<std::chrono::milliseconds>(t.time_since_epoch()).count(); } }',
      'inline unsigned long millis() { return (unsigned long)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count(); }',
    ];
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

  defaultNumericType(): string { return 'long long'; }

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
    while (prev !== v) {
      prev = v;
      v = v.replace(/\bundefined\b/g, 'CUTTLEFISH_UNDEFINED');
      v = v.replace(/\bnull\b/g, 'CUTTLEFISH_UNDEFINED');
      v = v.replace(/Date\.now\(\)/g, 'Date::now()');
      // String-method lowering is shared across all targets (fixes the
      // receiver-duplication bug the old per-strategy regex table had for
      // substring/slice/charCodeAt). Native uses the standard __tc_* helpers,
      // except startsWith which maps to std::string::rfind.
      v = applyStringMethodRewrites(v, {
        special: {
          startsWith: (recv, args) => `(${recv}.rfind(${args[0]}, 0) == 0)`,
        },
      });
      v = v.replace(new RegExp(`([\\w.]+)\\.slice\\(\\)`), 'std::vector<typename std::decay<decltype($1)>::type>($1.begin(), $1.end())');
      v = v.replace(new RegExp(`${'([A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*)'}\\.reverse\\(\\)`, 'g'), '__tc_reverse($1)');
      v = v.replace(/(\w+)\.push\(([^)]+)\)/g, '$1.push_back($2)');
      v = v.replace(/sizeof\s*\(\s*(\w+)\s*\)\s*\/\s*sizeof\s*\(\s*\1\s*\[(\d+)\]\s*\)/g, '$1.size()');
      v = v.replace(/(\w+)\.length\b(?:\(\))?/g, '$1.size()');
      v = v.replace(/(\w+)\.shift\(\)/g, '__tc_shift($1)');
      v = v.replace(/(\w+)\.pop\(\)/g, '__tc_pop($1)');
      // unshift: single-arg only — multi-arg unshift(a,b,c) is rare and not handled by polyfill
      v = v.replace(/(\w+)\.unshift\(([^)]+)\)/g, '__tc_unshift($1, $2)');
      v = v.replace(/(\w+)\.sort\((.+)\)/g, '__tc_sort_fn($1, $2)');
      v = v.replace(/(\w+)\.sort\(\)/g, '__tc_sort($1)');
      v = v.replace(/(\w+)\.fill\(([^,]+),\s*([^,]+),\s*([^)]+)\)/g, '__tc_fill3($1, $2, $3, $4)');
      v = v.replace(/(\w+)\.fill\(([^)]+)\)/g, '__tc_fill($1, $2)');
      v = v.replace(/(\w+)\.concat\(([^)]+)\)/g, '__tc_concat($1, $2)');
      v = v.replace(/(\w+)\.splice\(([^,]+),\s*([^)]+)\)/g, '__tc_splice2($1, $2, $3)');
      v = v.replace(/(\w+)\.splice\(([^)]+)\)/g, '__tc_splice1($1, $2)');
      v = v.replace(/(\w+)\.filter\(([^)]+)\)/g, '__tc_filter($1, $2)');
      v = v.replace(/(\w+)\.map\(([^)]+)\)/g, '__tc_map($1, $2)');
      v = v.replace(/(\w+)\.reduce\(([^,]+),\s*([^)]+)\)/g, '__tc_reduce($1, $2, $3)');
      v = v.replace(/(\w+)\.reduce\(([^)]+)\)/g, '__tc_reduce_no_init($1, $2)');
      v = v.replace(/(\w+)\.find\(([^)]+)\)/g, '__tc_find($1, $2)');
      v = v.replace(/(\w+)\.findIndex\(([^)]+)\)/g, '__tc_findIndex($1, $2)');
      v = v.replace(/(\w+)\.every\(([^)]+)\)/g, '__tc_every($1, $2)');
      v = v.replace(/(\w+)\.some\(([^)]+)\)/g, '__tc_some($1, $2)');
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

  renderThrow(valueExpr: string): string {
    return `throw ${valueExpr};`;
  }

  isConsoleCall(callee: string): boolean {
    return callee.startsWith("console.");
  }

  transformConsoleCall(method: string, renderedArgs: string, forHeader: boolean): string {
    const semi = forHeader ? '' : ';';
    const empty = !renderedArgs || renderedArgs.trim() === '';
    switch (method) {
      case 'log':
      case 'info':
      case 'debug':
        return empty
          ? `std::cout << std::endl${semi}`
          : `std::cout << ${renderedArgs} << std::endl${semi}`;
      case 'error':
        return empty
          ? `std::cerr << "[ERROR] " << std::endl${semi}`
          : `std::cerr << "[ERROR] " << ${renderedArgs} << std::endl${semi}`;
      case 'warn':
        return empty
          ? `std::cerr << "[WARN] " << std::endl${semi}`
          : `std::cerr << "[WARN] " << ${renderedArgs} << std::endl${semi}`;
      case 'readLine':
      case 'readCharacter':
        return this.transformConsoleExpression(method, renderedArgs) + semi;
      default:
        return empty
          ? `std::cout << std::endl${semi}`
          : `std::cout << ${renderedArgs} << std::endl${semi}`;
    }
  }

  transformConsoleExpression(method: string, _renderedArgs: string): string | undefined {
    switch (method) {
      case 'readLine':
        return '([]() -> std::string { std::string s; std::getline(std::cin, s); return s; })()';
      case 'readCharacter':
        return '([&]() -> char { std::cout << "> " << std::flush; return std::cin.get(); })()';
      default:
        return undefined;
    }
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

  apiReservedEnumNames(): ReadonlySet<string> {
    return new Set<string>();
  }

  apiReservedEnumGuard(): string {
    return '';
  }

  ambientTypeDeclarations(): string[] {
    return [
      "",
      "  // Console input methods",
      "  interface Console {",
      "    readLine(): string;",
      "    readCharacter(): string;",
      "  }",
    ];
  }

  // ── Includes ────────────────────────────────────────────────────────────

  needsIostream(): boolean { return true; }
  needsStdString(): boolean { return true; }
  needsStdVector(): boolean { return true; }
  needsStdExcept(): boolean { return true; }
  needsStdFunction(): boolean { return true; }
  mathHeader(): string { return '<cmath>'; }
  needsVectorOverload(): boolean { return true; }
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
    return 'millis()';
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

  generateNativePolyfills(): RuntimePolyfillIR[] {
    return [
      {
        kind: 'polyfill',
        id: 'string_methods',
        domain: 'standard' as const,
        requiredIncludes: ['<sstream>'],
        forwardDeclarations: [],
        helperStructs: [],
        helperFunctions: [
          // ── Core string methods (existing) ─────────────────────────────
          'inline std::string __tc_toUpperCase(const std::string& s) { std::string r = s; for (auto& c : r) c = (char)toupper((unsigned char)c); return r; }',
          'inline std::string __tc_toLowerCase(const std::string& s) { std::string r = s; for (auto& c : r) c = (char)tolower((unsigned char)c); return r; }',
          'inline std::string __tc_trim(const std::string& s) { size_t start = s.find_first_not_of(" \\t\\n\\r"); if (start == std::string::npos) return ""; size_t end = s.find_last_not_of(" \\t\\n\\r"); return s.substr(start, end - start + 1); }',
          'inline std::string __tc_substring2(const std::string& s, int start, int end) { return s.substr(start, end - start); }',
          'inline std::string __tc_substring1(const std::string& s, int start) { return s.substr(start); }',
          'inline std::string __tc_replace(const std::string& s, const std::string& old, const std::string& repl) { std::string r = s; size_t pos = 0; while ((pos = r.find(old, pos)) != std::string::npos) { r.replace(pos, old.length(), repl); pos += repl.length(); } return r; }',
          'inline std::string __tc_charAt(const std::string& s, int idx) { return std::string(1, s[idx]); }',
          'inline int __tc_charCodeAt(const std::string& s, int idx) { return (int)(unsigned char)s[idx]; }',
          'inline std::vector<std::string> __tc_split(const std::string& s, const std::string& delim) { std::vector<std::string> parts; if (delim.empty()) { for (char c : s) parts.push_back(std::string(1, c)); return parts; } size_t start = 0, end; while ((end = s.find(delim, start)) != std::string::npos) { parts.push_back(s.substr(start, end - start)); start = end + delim.length(); } parts.push_back(s.substr(start)); return parts; }',
          // ── Extended string methods (Phase 1) ──────────────────────────
          'inline bool __tc_endsWith(const std::string& s, const std::string& suffix) { if (suffix.size() > s.size()) return false; return s.compare(s.size() - suffix.size(), suffix.size(), suffix) == 0; }',
          'inline int __tc_lastIndexOf(const std::string& s, const std::string& search) { size_t pos = s.rfind(search); return pos != std::string::npos ? (int)pos : -1; }',
          'inline std::string __tc_padStart(const std::string& s, int len, const std::string& fill) { if ((int)s.size() >= len) return s; std::string result; int padLen = len - (int)s.size(); for (int i = 0; i < padLen; i++) result += fill[i % (int)fill.size()]; return result + s; }',
          'inline std::string __tc_padStart_default(const std::string& s, int len) { return __tc_padStart(s, len, " "); }',
          'inline std::string __tc_padEnd(const std::string& s, int len, const std::string& fill) { if ((int)s.size() >= len) return s; std::string result = s; int padLen = len - (int)s.size(); for (int i = 0; i < padLen; i++) result += fill[i % (int)fill.size()]; return result; }',
          'inline std::string __tc_padEnd_default(const std::string& s, int len) { return __tc_padEnd(s, len, " "); }',
          'inline std::string __tc_repeat(const std::string& s, int count) { std::string result; for (int i = 0; i < count; i++) result += s; return result; }',
          // ── Overloaded includes/indexOf for std::string ────────────────
          'inline bool __tc_includes(const std::string& s, const std::string& search) { return s.find(search) != std::string::npos; }',
          'inline int __tc_indexOf(const std::string& s, const std::string& search) { size_t pos = s.find(search); return pos != std::string::npos ? (int)pos : -1; }',
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
        requiredIncludes: ['<thread>', '<chrono>', '<future>'],
        forwardDeclarations: [],
        helperStructs: [],
        helperFunctions: [
          'int __tc_setTimeout(std::function<void()> cb, long long ms) { auto f = std::async(std::launch::async, [cb, ms]() { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); cb(); }); (void)f; return 1; }',
          'int __tc_setInterval(std::function<void()> cb, long long ms) { auto f = std::async(std::launch::async, [cb, ms]() { while (true) { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); cb(); } }); (void)f; return 1; }',
          'void __tc_clearInterval(int id) { /* not implemented in native yet */ }',
          'void __tc_clearTimeout(int id) { /* not implemented in native yet */ }',
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
        requiredIncludes: ['<algorithm>', '<map>'],
        forwardDeclarations: [],
        helperStructs: [],
        helperFunctions: [
          // ── Core array methods (existing) ───────────────────────────────
          'template<typename T> std::string __tc_join(const std::vector<T>& v, const std::string& delim) { std::ostringstream oss; for (size_t i = 0; i < v.size(); i++) { if (i > 0) oss << delim; oss << v[i]; } return oss.str(); }',
          'template<typename T> std::vector<T> __tc_slice2(const std::vector<T>& v, int start, int end) { if (end > (int)v.size()) end = (int)v.size(); return std::vector<T>(v.begin() + start, v.begin() + end); }',
          'template<typename T> std::vector<T> __tc_slice1(const std::vector<T>& v, int start) { return std::vector<T>(v.begin() + start, v.end()); }',
          'template<typename T> std::vector<T> __tc_reverse(std::vector<T> v) { std::reverse(v.begin(), v.end()); return v; }',
          // ── Overloaded includes/indexOf for std::vector ─────────────────
          'template<typename T> bool __tc_includes(const std::vector<T>& v, const T& val) { return std::find(v.begin(), v.end(), val) != v.end(); }',
          'template<typename T> int __tc_indexOf(const std::vector<T>& v, const T& val) { auto it = std::find(v.begin(), v.end(), val); return it != v.end() ? (int)(it - v.begin()) : -1; }',
          // ── Array mutation methods (Phase 1) ────────────────────────────
          'template<typename T> T __tc_shift(std::vector<T>& v) { T val = v.front(); v.erase(v.begin()); return val; }',
          'template<typename T> T __tc_pop(std::vector<T>& v) { T val = v.back(); v.pop_back(); return val; }',
          'template<typename T> void __tc_unshift(std::vector<T>& v, const T& val) { v.insert(v.begin(), val); }',
          'template<typename T> void __tc_sort(std::vector<T>& v) { std::sort(v.begin(), v.end()); }',
          'template<typename T, typename F> void __tc_sort_fn(std::vector<T>& v, F comp) { std::sort(v.begin(), v.end(), comp); }',
          'template<typename T> void __tc_fill(std::vector<T>& v, const T& val) { std::fill(v.begin(), v.end(), val); }',
          'template<typename T> void __tc_fill3(std::vector<T>& v, const T& val, int start, int end) { if (end > (int)v.size()) end = (int)v.size(); std::fill(v.begin() + start, v.begin() + end, val); }',
          'template<typename T> std::vector<T> __tc_concat(const std::vector<T>& a, const std::vector<T>& b) { std::vector<T> result = a; result.insert(result.end(), b.begin(), b.end()); return result; }',
          'template<typename T> std::vector<T> __tc_splice1(std::vector<T>& v, int start) { std::vector<T> removed(v.begin() + start, v.end()); v.erase(v.begin() + start, v.end()); return removed; }',
          'template<typename T> std::vector<T> __tc_splice2(std::vector<T>& v, int start, int deleteCount) { int end = start + deleteCount; if (end > (int)v.size()) end = (int)v.size(); std::vector<T> removed(v.begin() + start, v.begin() + end); v.erase(v.begin() + start, v.begin() + end); return removed; }',
          // ── Array functional methods (Phase 1) ──────────────────────────
          'template<typename T, typename F> std::vector<T> __tc_filter(const std::vector<T>& v, F pred) { std::vector<T> result; for (const auto& x : v) if (pred(x)) result.push_back(x); return result; }',
          'template<typename T, typename F> auto __tc_map(const std::vector<T>& v, F fn) -> std::vector<decltype(fn(v[0]))> { using R = decltype(fn(v[0])); std::vector<R> result; result.reserve(v.size()); for (const auto& x : v) result.push_back(fn(x)); return result; }',
          'template<typename T, typename U, typename F> auto __tc_reduce(const std::vector<T>& v, F fn, U init) -> U { U acc = init; for (const auto& x : v) acc = fn(acc, x); return acc; }',
          'template<typename T, typename F> T __tc_reduce_no_init(std::vector<T>& v, F fn) { T acc = v[0]; for (size_t i = 1; i < v.size(); i++) acc = fn(acc, v[i]); return acc; }',
          'template<typename T, typename F> T __tc_find(const std::vector<T>& v, F pred) { for (const auto& x : v) if (pred(x)) return x; return T(); }',
          'template<typename T, typename F> int __tc_findIndex(const std::vector<T>& v, F pred) { for (int i = 0; i < (int)v.size(); i++) if (pred(v[i])) return i; return -1; }',
          'template<typename T, typename F> bool __tc_every(const std::vector<T>& v, F pred) { for (const auto& x : v) if (!pred(x)) return false; return true; }',
          'template<typename T, typename F> bool __tc_some(const std::vector<T>& v, F pred) { for (const auto& x : v) if (pred(x)) return true; return false; }',
          // ── Map helper methods (Object.keys/values/entries) ──────────────
          'template<typename K, typename V> std::vector<K> __tc_mapKeys(const std::map<K, V>& m) { std::vector<K> keys; for (const auto& p : m) keys.push_back(p.first); return keys; }',
          'template<typename K, typename V> std::vector<V> __tc_mapValues(const std::map<K, V>& m) { std::vector<V> vals; for (const auto& p : m) vals.push_back(p.second); return vals; }',
          'template<typename K, typename V> std::vector<std::pair<K, V>> __tc_mapEntries(const std::map<K, V>& m) { std::vector<std::pair<K, V>> entries; for (const auto& p : m) entries.push_back(p); return entries; }',
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
  }
}
