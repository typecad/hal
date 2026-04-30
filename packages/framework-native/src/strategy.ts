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
  TypehalReceiverKind,
  RuntimePolyfillIR,
  StdLibSupport,
} from '@typehal/core/shared';
import { DEFAULT_STDLIB_SUPPORT } from '@typehal/core/shared';

export class NativeStrategy implements PlatformStrategy {
  readonly id = 'native';

  // ── Profile ─────────────────────────────────────────────────────────────

  forcedIncludes(): string[] {
    return [];
  }

  symbolAliases(): Record<string, string> {
    return {};
  }

  shimLines(): string[] {
    return [
      'inline std::string String(const std::string& s) { return s; }',
      'inline std::string String(const char* s) { return std::string(s); }',
      'inline std::string String(int v) { return std::to_string(v); }',
      'inline std::string String(long v) { return std::to_string(v); }',
      'inline std::string String(long long v) { return std::to_string(v); }',
      'inline std::string String(double v) { return std::to_string(v); }',
      'inline std::string String(bool v) { return v ? std::string("true") : std::string("false"); }',
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
    return typeName;
  }

  defaultNumericType(): string { return 'long long'; }

  mapReturnType(functionName: string, returnType: string): string {
    if (functionName === 'main') return 'int';
    return this.normalizeCppType(returnType);
  }

  mapFunctionName(originalName: string): string {
    if (originalName === '__typehal_entrypoint__') return 'main';
    return originalName;
  }

  // ── Expression rendering ────────────────────────────────────────────────

  normalizeRawExpression(value: string): string {
    let v = value;
    // Namespace-qualified calls: Date.now() → Date::now()
    v = v.replace(/Date\.now\(\)/g, 'Date::now()');
    // Timers: setTimeout/setInterval → polyfill helpers
    v = v.replace(/setTimeout\(([^,]+),\s*([^)]+)\)/g, '__tc_setTimeout($1, $2)');
    v = v.replace(/setInterval\(([^,]+),\s*([^)]+)\)/g, '__tc_setInterval($1, $2)');
    v = v.replace(/clearTimeout\(([^)]+)\)/g, '__tc_clearTimeout($1)');
    v = v.replace(/clearInterval\(([^)]+)\)/g, '__tc_clearInterval($1)');
    // String method transforms using std::string helpers
    v = v.replace(/(\w+)\.toUpperCase\(\)/g, '__tc_toUpperCase($1)');
    v = v.replace(/(\w+)\.toLowerCase\(\)/g, '__tc_toLowerCase($1)');
    v = v.replace(/(\w+)\.trim\(\)/g, '__tc_trim($1)');
    v = v.replace(/(\w+)\.startsWith\(([^)]+)\)/g, '($1.rfind($2, 0) == 0)');
    v = v.replace(/(\w+)\.endsWith\(([^)]+)\)/g, '__tc_endsWith($1, $2)');
    // substring with two args must come before single-arg version
    v = v.replace(/(\w+)\.substring\(([^,]+),\s*([^)]+)\)/g, '__tc_substring2($1, $2, $3)');
    v = v.replace(/(\w+)\.substring\(([^)]+)\)/g, '__tc_substring1($1, $2)');
    v = v.replace(/(\w+)\.replace\(([^,]+),\s*([^)]+)\)/g, '__tc_replace($1, $2, $3)');
    v = v.replace(/(\w+)\.charAt\(([^)]+)\)/g, '__tc_charAt($1, $2)');
    v = v.replace(/(\w+)\.charCodeAt\(([^)]+)\)/g, '__tc_charCodeAt($1, $2)');
    // includes/indexOf — overloaded for both std::string and std::vector<T>
    v = v.replace(/(\w+)\.includes\(([^)]+)\)/g, '__tc_includes($1, $2)');
    v = v.replace(/(\w+)\.indexOf\(([^)]+)\)/g, '__tc_indexOf($1, $2)');
    v = v.replace(/(\w+)\.lastIndexOf\(([^)]+)\)/g, '__tc_lastIndexOf($1, $2)');
    // padStart/padEnd with fill string must come before single-arg versions
    v = v.replace(/(\w+)\.padStart\(([^,]+),\s*([^)]+)\)/g, '__tc_padStart($1, $2, $3)');
    v = v.replace(/(\w+)\.padStart\(([^)]+)\)/g, '__tc_padStart_default($1, $2)');
    v = v.replace(/(\w+)\.padEnd\(([^,]+),\s*([^)]+)\)/g, '__tc_padEnd($1, $2, $3)');
    v = v.replace(/(\w+)\.padEnd\(([^)]+)\)/g, '__tc_padEnd_default($1, $2)');
    v = v.replace(/(\w+)\.repeat\(([^)]+)\)/g, '__tc_repeat($1, $2)');
    // String.split(delim) → returns std::vector<std::string>
    v = v.replace(/(\w+)\.split\(([^)]+)\)/g, '__tc_split($1, $2)');
    // Array.join(delim) → concatenates vector with delimiter
    v = v.replace(/(\w+)\.join\(([^)]+)\)/g, '__tc_join($1, $2)');
    // Array.slice(start, end) and slice(start)
    v = v.replace(/(\w+)\.slice\(([^,]+),\s*([^)]+)\)/g, '__tc_slice2($1, $2, $3)');
    v = v.replace(/(\w+)\.slice\(([^)]+)\)/g, '__tc_slice1($1, $2)');
    // String/Array reverse
    v = v.replace(/(\w+)\.reverse\(\)/g, '__tc_reverse($1)');
    // Array mutation methods
    v = v.replace(/(\w+)\.shift\(\)/g, '__tc_shift($1)');
    v = v.replace(/(\w+)\.pop\(\)/g, '__tc_pop($1)');
    v = v.replace(/(\w+)\.unshift\(([^)]+)\)/g, '__tc_unshift($1, $2)');
    // sort with comparator must come before sort()
    v = v.replace(/(\w+)\.sort\(([^)]+)\)/g, '__tc_sort_fn($1, $2)');
    v = v.replace(/(\w+)\.sort\(\)/g, '__tc_sort($1)');
    // fill with range must come before fill with value only
    v = v.replace(/(\w+)\.fill\(([^,]+),\s*([^,]+),\s*([^)]+)\)/g, '__tc_fill3($1, $2, $3, $4)');
    v = v.replace(/(\w+)\.fill\(([^)]+)\)/g, '__tc_fill($1, $2)');
    v = v.replace(/(\w+)\.concat\(([^)]+)\)/g, '__tc_concat($1, $2)');
    // splice with deleteCount must come before splice with start only
    v = v.replace(/(\w+)\.splice\(([^,]+),\s*([^)]+)\)/g, '__tc_splice2($1, $2, $3)');
    v = v.replace(/(\w+)\.splice\(([^)]+)\)/g, '__tc_splice1($1, $2)');
    // Array functional methods — note: inline arrow functions need IR-level
    // support for full lambda translation; named function references work directly
    v = v.replace(/(\w+)\.filter\(([^)]+)\)/g, '__tc_filter($1, $2)');
    v = v.replace(/(\w+)\.map\(([^)]+)\)/g, '__tc_map($1, $2)');
    // reduce with initial value must come before reduce without
    v = v.replace(/(\w+)\.reduce\(([^,]+),\s*([^)]+)\)/g, '__tc_reduce($1, $2, $3)');
    v = v.replace(/(\w+)\.reduce\(([^)]+)\)/g, '__tc_reduce_no_init($1, $2)');
    v = v.replace(/(\w+)\.find\(([^)]+)\)/g, '__tc_find($1, $2)');
    v = v.replace(/(\w+)\.findIndex\(([^)]+)\)/g, '__tc_findIndex($1, $2)');
    v = v.replace(/(\w+)\.every\(([^)]+)\)/g, '__tc_every($1, $2)');
    v = v.replace(/(\w+)\.some\(([^)]+)\)/g, '__tc_some($1, $2)');
    return v;
  }

  nullValue(): string {
    return '0';
  }

  wrapStringConcat(): string | undefined {
    return undefined;
  }

  useSnprintfForStrings(): boolean {
    return false;
  }

  renameEnumMember(_enumName: string, memberName: string): string {
    return memberName;
  }

  enumCastType(): string | undefined {
    return undefined;
  }

  tryRenderTypehalCall(): string | undefined {
    return undefined;
  }

  renderBoardDefinitionAccess(): string | undefined {
    return undefined;
  }

  // ── Statement rendering ─────────────────────────────────────────────────

  tryRenderCallStatement(): string | undefined {
    return undefined;
  }

  renderThrow(valueExpr: string): string {
    return `throw ${valueExpr};`;
  }

  transformConsoleCall(method: string, renderedArgs: string, forHeader: boolean): string {
    const semi = forHeader ? '' : ';';
    switch (method) {
      case 'log':
      case 'info':
      case 'debug':
        return `std::cout << ${renderedArgs} << std::endl${semi}`;
      case 'error':
        return `std::cerr << "[ERROR] " << ${renderedArgs} << std::endl${semi}`;
      case 'warn':
        return `std::cerr << "[WARN] " << ${renderedArgs} << std::endl${semi}`;
      default:
        return `std::cout << ${renderedArgs} << std::endl${semi}`;
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

  asyncLoopInjection(taskVarNames: string[], hasPromiseRuntime: boolean, _hasTimers: boolean): string[] {
    const lines: string[] = [];
    if (taskVarNames.length > 0 || hasPromiseRuntime) {
      lines.push('std::async(std::launch::async, [&]() {');
      lines.push('  while (true) {');
      for (const n of taskVarNames) {
        lines.push(`    ${n}.run();`);
      }
      if (hasPromiseRuntime) {
        lines.push('    typehal_pump_microtasks();');
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
    return new Set(['console', 'string_methods', 'timer_methods', 'array_methods']);
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
          'std::string __tc_toUpperCase(const std::string& s) { std::string r = s; for (auto& c : r) c = (char)toupper((unsigned char)c); return r; }',
          'std::string __tc_toLowerCase(const std::string& s) { std::string r = s; for (auto& c : r) c = (char)tolower((unsigned char)c); return r; }',
          'std::string __tc_trim(const std::string& s) { size_t start = s.find_first_not_of(" \\t\\n\\r"); if (start == std::string::npos) return ""; size_t end = s.find_last_not_of(" \\t\\n\\r"); return s.substr(start, end - start + 1); }',
          'std::string __tc_substring2(const std::string& s, int start, int end) { return s.substr(start, end - start); }',
          'std::string __tc_substring1(const std::string& s, int start) { return s.substr(start); }',
          'std::string __tc_replace(const std::string& s, const std::string& old, const std::string& repl) { std::string r = s; size_t pos = 0; while ((pos = r.find(old, pos)) != std::string::npos) { r.replace(pos, old.length(), repl); pos += repl.length(); } return r; }',
          'std::string __tc_charAt(const std::string& s, int idx) { return std::string(1, s[idx]); }',
          'int __tc_charCodeAt(const std::string& s, int idx) { return (int)(unsigned char)s[idx]; }',
          'std::vector<std::string> __tc_split(const std::string& s, const std::string& delim) { std::vector<std::string> parts; if (delim.empty()) { for (char c : s) parts.push_back(std::string(1, c)); return parts; } size_t start = 0, end; while ((end = s.find(delim, start)) != std::string::npos) { parts.push_back(s.substr(start, end - start)); start = end + delim.length(); } parts.push_back(s.substr(start)); return parts; }',
          // ── Extended string methods (Phase 1) ──────────────────────────
          'bool __tc_endsWith(const std::string& s, const std::string& suffix) { if (suffix.size() > s.size()) return false; return s.compare(s.size() - suffix.size(), suffix.size(), suffix) == 0; }',
          'int __tc_lastIndexOf(const std::string& s, const std::string& search) { size_t pos = s.rfind(search); return pos != std::string::npos ? (int)pos : -1; }',
          'std::string __tc_padStart(const std::string& s, int len, const std::string& fill) { if ((int)s.size() >= len) return s; std::string result; int padLen = len - (int)s.size(); for (int i = 0; i < padLen; i++) result += fill[i % (int)fill.size()]; return result + s; }',
          'std::string __tc_padStart_default(const std::string& s, int len) { return __tc_padStart(s, len, " "); }',
          'std::string __tc_padEnd(const std::string& s, int len, const std::string& fill) { if ((int)s.size() >= len) return s; std::string result = s; int padLen = len - (int)s.size(); for (int i = 0; i < padLen; i++) result += fill[i % (int)fill.size()]; return result; }',
          'std::string __tc_padEnd_default(const std::string& s, int len) { return __tc_padEnd(s, len, " "); }',
          'std::string __tc_repeat(const std::string& s, int count) { std::string result; for (int i = 0; i < count; i++) result += s; return result; }',
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
        id: 'array_methods',
        domain: 'standard' as const,
        requiredIncludes: ['<algorithm>'],
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
        ],
        shimMacros: [],
        dependencies: [],
      },
    ];
  }
}
