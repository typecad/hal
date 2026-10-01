// ---------------------------------------------------------------------------
// Hosted shim + polyfill texts — the STL-backed runtime surface shared by the
// native and generic (fallback) strategies.
//
// Both strategies lower string/array methods structurally to `__tc_*` helpers
// and `??`/`?.` to `cuttlefish_nullish(...)` (see ir/transformers/array-methods
// and ir/expression-to-ir), so BOTH must ship the defining shim/polyfill
// blocks — GenericStrategy used to return none, and every string method,
// array literal, or `??` on the generic target referenced an undefined symbol.
// filterPolyfillHelpers tree-shakes the polyfill blocks per program, so
// sharing the full table costs nothing for programs that use none of it.
// ---------------------------------------------------------------------------

import type { RuntimePolyfillIR } from "../../api/shared/index.js";

/**
 * The core runtime shim: CUTTLEFISH_UNDEFINED, the nullish helper family,
 * Date::now, and the monotonic ms clock. Wrapped in CUTTLEFISH_SHIM_DEFINED so
 * it is safe to emit into multiple headers/.cpp of one TU. Callers append
 * platform-specific entries and the closing #endif.
 */
export function hostedCoreShimLines(): string[] {
  return [
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
}

/**
 * The STL-backed polyfill blocks (string/array/timer/math methods). The
 * per-strategy async_runtime polyfill is appended by each strategy — it is
 * config-dependent (queue capacity, waitForPinEdge), not shared text.
 */
export function hostedPolyfillIRs(): RuntimePolyfillIR[] {
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
          'inline bool __tc_startsWith(const std::string& s, const std::string& prefix) { if (prefix.size() > s.size()) return false; return s.compare(0, prefix.size(), prefix) == 0; }',
          'inline int __tc_lastIndexOf(const std::string& s, const std::string& search) { size_t pos = s.rfind(search); return pos != std::string::npos ? static_cast<int>(pos) : -1; }',
          'inline std::string __tc_padStart(const std::string& s, int len, const std::string& fill) { if (static_cast<int>(s.size()) >= len) return s; std::string result; int padLen = len - static_cast<int>(s.size()); for (int i = 0; i < padLen; i++) result += fill[i % static_cast<int>(fill.size())]; return result + s; }',
          'inline std::string __tc_padStart_default(const std::string& s, int len) { return __tc_padStart(s, len, " "); }',
          'inline std::string __tc_padEnd(const std::string& s, int len, const std::string& fill) { if (static_cast<int>(s.size()) >= len) return s; std::string result = s; int padLen = len - static_cast<int>(s.size()); for (int i = 0; i < padLen; i++) result += fill[i % static_cast<int>(fill.size())]; return result; }',
          'inline std::string __tc_padEnd_default(const std::string& s, int len) { return __tc_padEnd(s, len, " "); }',
          'inline std::string __tc_repeat(const std::string& s, int count) { std::string result; for (int i = 0; i < count; i++) result += s; return result; }',
          // ── Overloaded includes/indexOf for std::string ────────────────
          'inline bool __tc_includes(const std::string& s, const std::string& search) { return s.find(search) != std::string::npos; }',
          'inline int __tc_indexOf(const std::string& s, const std::string& search) { size_t pos = s.find(search); return pos != std::string::npos ? static_cast<int>(pos) : -1; }',
          // ── Number.toString(radix) — hex/octal/decimal via snprintf ─────
          'inline const char* __tc_num_radix(long long v, int radix) { static char buf[72]; if (radix == 16) { snprintf(buf, sizeof(buf), "%llx", v); } else if (radix == 8) { snprintf(buf, sizeof(buf), "%llo", v); } else { snprintf(buf, sizeof(buf), "%lld", v); } return buf; }',
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
        requiredIncludes: ['<algorithm>', '<map>', '<sstream>', '<vector>'],
        forwardDeclarations: [],
        helperStructs: [],
        helperFunctions: [
          // ── Core array methods (existing) ───────────────────────────────
          'template<typename T> std::string __tc_join(const std::vector<T>& v, const std::string& delim) { std::ostringstream oss; for (size_t i = 0; i < v.size(); i++) { if (i > 0) oss << delim; oss << v[i]; } return oss.str(); }',
          // JS String(v) for a template interpolation flattened at IR time
          // (`${x}` as a map key). %.15g matches JS shortest-repr closely
          // (integers bare, fraction without trailing zeros).
          'inline std::string __tc_numToStr_js(double v) { char b[32]; (void)snprintf(b, sizeof(b), "%.15g", v); return std::string(b); }',
          'template<typename T> std::vector<T> __tc_slice2(const std::vector<T>& v, int start, int end) { if (end > static_cast<int>(v.size())) end = static_cast<int>(v.size()); return std::vector<T>(v.begin() + start, v.begin() + end); }',
          'template<typename T> std::vector<T> __tc_slice1(const std::vector<T>& v, int start) { return std::vector<T>(v.begin() + start, v.end()); }',
          'template<typename T> void __tc_reverse(std::vector<T>& v) { std::reverse(v.begin(), v.end()); }', // in-place: the statement form (a1.reverse();) must mutate — a by-value copy was silently discarded
          'template<typename T> std::vector<T> __tc_reverse_copy(const std::vector<T>& v) { std::vector<T> out = v; std::reverse(out.begin(), out.end()); return out; }',
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
          'template<typename T> T __tc_max_vec(const std::vector<T>& v) { T m = v[0]; for (size_t i = 1; i < v.size(); i++) if (v[i] > m) m = v[i]; return m; }',
          'template<typename T> T __tc_min_vec(const std::vector<T>& v) { T m = v[0]; for (size_t i = 1; i < v.size(); i++) if (v[i] < m) m = v[i]; return m; }',
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
}
