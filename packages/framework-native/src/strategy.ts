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
  TypecodeReceiverKind,
  RuntimePolyfillIR,
} from '@typecode/core/shared';

export class NativeStrategy implements PlatformStrategy {
  readonly id = 'native';

  // ── Profile ─────────────────────────────────────────────────────────────

  forcedIncludes(): string[] {
    return ['<thread>', '<chrono>', '<future>', '<algorithm>', '<sstream>'];
  }

  symbolAliases(): Record<string, string> {
    return {};
  }

  shimLines(): string[] {
    return [
      // Overloaded String() conversion functions to replace Arduino String() constructor.
      // The emitter wraps non-string concat parts in String(), so we need overloads
      // for all types the emitter might pass.
      'inline std::string String(const std::string& s) { return s; }',
      'inline std::string String(const char* s) { return std::string(s); }',
      'inline std::string String(int v) { return std::to_string(v); }',
      'inline std::string String(long v) { return std::to_string(v); }',
      'inline std::string String(long long v) { return std::to_string(v); }',
      'inline std::string String(double v) { return std::to_string(v); }',
      'inline std::string String(bool v) { return v ? std::string("true") : std::string("false"); }',
      // Date.now() polyfill — returns milliseconds since epoch
      'namespace Date { inline long now() { auto t = std::chrono::system_clock::now(); return (long)std::chrono::duration_cast<std::chrono::milliseconds>(t.time_since_epoch()).count(); } }',
      // millis() polyfill for async state machine timing
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
    if (typeName === 'auto') return 'int';
    // JavaScript number is 64-bit float — map to 64-bit integer to avoid overflow
    if (typeName === 'int') return 'long long';
    // JavaScript number fractional precision needs double, not float
    if (typeName === 'float') return 'double';
    return typeName;
  }

  defaultNumericType(): string { return 'long long'; }

  mapReturnType(functionName: string, returnType: string): string {
    if (functionName === 'setup' || functionName === 'loop') return 'void';
    if (functionName === 'main') return 'int';
    return this.normalizeCppType(returnType);
  }

  mapFunctionName(originalName: string): string {
    if (originalName === '__arduino_setup__') return 'setup';
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
    // String method transforms using std::string helpers
    v = v.replace(/(\w+)\.toUpperCase\(\)/g, '__tc_toUpperCase($1)');
    v = v.replace(/(\w+)\.toLowerCase\(\)/g, '__tc_toLowerCase($1)');
    v = v.replace(/(\w+)\.trim\(\)/g, '__tc_trim($1)');
    v = v.replace(/(\w+)\.includes\(([^)]+)\)/g, '($1.find($2) != std::string::npos)');
    v = v.replace(/(\w+)\.startsWith\(([^)]+)\)/g, '($1.rfind($2, 0) == 0)');
    // substring with two args must come before single-arg version
    v = v.replace(/(\w+)\.substring\(([^,]+),\s*([^)]+)\)/g, '__tc_substring2($1, $2, $3)');
    v = v.replace(/(\w+)\.substring\(([^)]+)\)/g, '__tc_substring1($1, $2)');
    v = v.replace(/(\w+)\.replace\(([^,]+),\s*([^)]+)\)/g, '__tc_replace($1, $2, $3)');
    v = v.replace(/(\w+)\.charAt\(([^)]+)\)/g, '__tc_charAt($1, $2)');
    v = v.replace(/(\w+)\.charCodeAt\(([^)]+)\)/g, '__tc_charCodeAt($1, $2)');
    v = v.replace(/(\w+)\.indexOf\(([^)]+)\)/g, '(int)$1.find($2)');
    // String.split(delim) → returns std::vector<std::string>
    v = v.replace(/(\w+)\.split\(([^)]+)\)/g, '__tc_split($1, $2)');
    // Array.join(delim) → concatenates vector with delimiter
    v = v.replace(/(\w+)\.join\(([^)]+)\)/g, '__tc_join($1, $2)');
    // Array.slice(start, end) and slice(start)
    v = v.replace(/(\w+)\.slice\(([^,]+),\s*([^)]+)\)/g, '__tc_slice2($1, $2, $3)');
    v = v.replace(/(\w+)\.slice\(([^)]+)\)/g, '__tc_slice1($1, $2)');
    // String/Array reverse
    v = v.replace(/(\w+)\.reverse\(\)/g, '__tc_reverse($1)');
    // String.slice for strings — same as substring
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

  tryRenderTypecodeCall(): string | undefined {
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

  asyncLoopInjection(taskVarNames: string[], hasPromiseRuntime: boolean): string[] {
    const lines: string[] = [];
    if (taskVarNames.length > 0 || hasPromiseRuntime) {
      lines.push('std::async(std::launch::async, [&]() {');
      lines.push('  while (true) {');
      for (const n of taskVarNames) {
        lines.push(`    ${n}.run();`);
      }
      if (hasPromiseRuntime) {
        lines.push('    typecode_pump_microtasks();');
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

  // ── Native polyfills ────────────────────────────────────────────────────

  nativePolyfills(): Set<string> {
    return new Set(['string_methods', 'timer_methods', 'array_methods']);
  }

  generateNativePolyfills(): RuntimePolyfillIR[] {
    return [
      {
        kind: 'polyfill',
        id: 'string_methods',
        domain: 'standard' as const,
        requiredIncludes: [],
        forwardDeclarations: [],
        helperStructs: [],
        helperFunctions: [
          'std::string __tc_toUpperCase(const std::string& s) { std::string r = s; for (auto& c : r) c = (char)toupper((unsigned char)c); return r; }',
          'std::string __tc_toLowerCase(const std::string& s) { std::string r = s; for (auto& c : r) c = (char)tolower((unsigned char)c); return r; }',
          'std::string __tc_trim(const std::string& s) { size_t start = s.find_first_not_of(" \\t\\n\\r"); if (start == std::string::npos) return ""; size_t end = s.find_last_not_of(" \\t\\n\\r"); return s.substr(start, end - start + 1); }',
          'std::string __tc_substring2(const std::string& s, int start, int end) { return s.substr(start, end - start); }',
          'std::string __tc_substring1(const std::string& s, int start) { return s.substr(start); }',
          'std::string __tc_replace(const std::string& s, const std::string& old, const std::string& repl) { std::string r = s; size_t pos = 0; while ((pos = r.find(old, pos)) != std::string::npos) { r.replace(pos, old.length(), repl); pos += repl.length(); } return r; }',
          'std::string __tc_charAt(const std::string& s, int idx) { return std::string(1, s[idx]); }',
          'int __tc_charCodeAt(const std::string& s, int idx) { return (int)(unsigned char)s[idx]; }',
          'std::vector<std::string> __tc_split(const std::string& s, const std::string& delim) { std::vector<std::string> parts; if (delim.empty()) { for (char c : s) parts.push_back(std::string(1, c)); return parts; } size_t start = 0, end; while ((end = s.find(delim, start)) != std::string::npos) { parts.push_back(s.substr(start, end - start)); start = end + delim.length(); } parts.push_back(s.substr(start)); return parts; }',
        ],
        shimMacros: [],
        dependencies: [],
      },
      {
        kind: 'polyfill',
        id: 'timer_methods',
        domain: 'standard' as const,
        requiredIncludes: [],
        forwardDeclarations: [],
        helperStructs: [],
        helperFunctions: [
          'void __tc_setTimeout(std::function<void()> cb, long long ms) { auto f = std::async(std::launch::async, [cb, ms]() { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); cb(); }); (void)f; }',
          'void __tc_setInterval(std::function<void()> cb, long long ms) { auto f = std::async(std::launch::async, [cb, ms]() { while (true) { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); cb(); } }); (void)f; }',
        ],
        shimMacros: [],
        dependencies: [],
      },
      {
        kind: 'polyfill',
        id: 'array_methods',
        domain: 'standard' as const,
        requiredIncludes: [],
        forwardDeclarations: [],
        helperStructs: [],
        helperFunctions: [
          'template<typename T> std::string __tc_join(const std::vector<T>& v, const std::string& delim) { std::ostringstream oss; for (size_t i = 0; i < v.size(); i++) { if (i > 0) oss << delim; oss << v[i]; } return oss.str(); }',
          'template<typename T> std::vector<T> __tc_slice2(const std::vector<T>& v, int start, int end) { if (end > (int)v.size()) end = (int)v.size(); return std::vector<T>(v.begin() + start, v.begin() + end); }',
          'template<typename T> std::vector<T> __tc_slice1(const std::vector<T>& v, int start) { return std::vector<T>(v.begin() + start, v.end()); }',
          'template<typename T> std::vector<T> __tc_reverse(std::vector<T> v) { std::reverse(v.begin(), v.end()); return v; }',
        ],
        shimMacros: [],
        dependencies: [],
      },
    ];
  }
}
