import type { RuleEntry } from "./types.js";

/**
 * Curated AUTOSAR C++14 rule subset enforced by the cuttlefish compliance
 * module. ~50 rules: 39 [C] (enforce-by-construction) and 11 [D] (deviation).
 *
 * Detection regexes are deliberately conservative: prefer false-negatives
 * over false-positives, because a false positive aborts builds in strict
 * mode. The renderer is the primary enforcement; the self-check is the
 * secondary net.
 *
 * See docs/superpowers/specs/2026-07-26-autosar-compliance-design.md §
 * "Curated rule subset".
 */
export const RULES: readonly RuleEntry[] = [
  // ── A. Preprocessor & macros ──────────────────────────────────────────
  { id: "A16-0-1", title: "No #include of unused header", severity: "required", category: "C", enabled: true },
  { id: "A16-0-3", title: "No #include inside namespace", severity: "required", category: "C",
    detect: /^\s*namespace\s+\w+\s*\{[^}]*#include/m, enabled: true },
  { id: "A16-0-4", title: "No #define inside another #define", severity: "required", category: "C", enabled: true },
  { id: "A16-0-5", title: "Header file path unambiguous", severity: "required", category: "C", enabled: true },
  { id: "A16-0-8", title: "#include not used for textual inclusion of code", severity: "required", category: "D", enabled: true },
  { id: "A16-7-1", title: "Header guards via #pragma once", severity: "required", category: "C",
    detect: /#ifndef\s+\w+_H\s*$/,
    exempt: /#pragma once/,
    enabled: true },

  // ── B. Type safety & conversions ──────────────────────────────────────
  { id: "M5-0-3", title: "Implicit narrowing conversion forbidden", severity: "required", category: "C", enabled: true },
  { id: "M5-0-7", title: "C-style cast shall not be used", severity: "required", category: "C",
    detect: /(^|[^:\w.])\(\s*(?:uint\d+_t|int\d+_t|int|char|double|float|bool|size_t|long|short|unsigned\s+\w+)\s*\)\s*[a-zA-Z_(]/,
    exempt: /static_cast|dynamic_cast|reinterpret_cast|const_cast/,
    enabled: true },
  { id: "M5-0-10", title: "No reinterpret_cast", severity: "required", category: "D",
    detect: /reinterpret_cast</, enabled: true,
    knownPatterns: [
      {
        // freeHeap() on AVR exposes no numeric API — avr-libc publishes the
        // heap boundary as the linker symbols __heap_start (int) and __brkval
        // (int*). Computing the free byte count requires subtracting two
        // addresses, which is only expressible as a pointer→integer cast.
        // This is the canonical AUTOSAR category-D "unavoidable platform
        // constraint" deviation. ESP32 uses ESP.getFreeHeap() and needs no
        // cast; this pattern matches only the AVR idiom.
        detect: /reinterpret_cast<size_t>\(&(v|__heap_start)\)|reinterpret_cast<size_t>\(__brkval\)/,
        justification: "AVR freeHeap() measures the gap between the stack and heap via the avr-libc __heap_start/__brkval linker symbols; pointer-to-integer conversion is the only way to compute a byte distance between two addresses on a target with no numeric free-heap API.",
        kind: "polyfill",
      },
      {
        // framework-zephyr BLE lowering: characteristic read handlers are TS
        // functions with heterogeneous inferred return types (const char*,
        // double), but the GATT attribute table registers one C callback for
        // every characteristic. Handlers are stored in a fixed-size void*
        // table (__tc_ble.on_read[]) and the characteristic index rides in
        // bt_gatt_attr::user_data; the dispatcher casts back to the concrete
        // signature per the char's type field. C++14 has no type-safe way to
        // store or invoke heterogeneous signatures through one type-erased
        // slot. Marker-based: every site references the table or its index
        // channel.
        detect: /__tc_ble\.on_read|__tc_ble_attrs|attr->user_data/,
        justification: "framework-zephyr BLE lowering stores heterogeneously-typed read handlers in a void* table (__tc_ble.on_read[]) keyed by bt_gatt_attr::user_data; C++14 offers no type-safe mechanism to store or invoke mixed signatures through one type-erased slot, so the store/dispatch sites must reinterpret_cast.",
        kind: "polyfill",
      },
      {
        // Zephyr C APIs take byte buffers as uint8_t*/void* (bt_data.data,
        // mqtt_utf8.utf8, MQTT payload.data, spi_buf.buf, i2c_read tx/rx)
        // while cuttlefish lowers TS buffers and strings to char*/uint8_t
        // arrays. The pointer reinterpretation happens exactly at the C API
        // boundary in the framework shims (ble/mqtt/i2c/spi lowerings).
        detect: /reinterpret_cast<(?:const )?uint8_t\*>|\.buf = reinterpret_cast<void\*>/,
        justification: "Zephyr's C APIs (bt_data, mqtt_utf8, MQTT payload, spi_buf, i2c_read) accept byte buffers as uint8_t*/void* while the transpiler lowers TS buffers/strings to char*/uint8_t arrays; reinterpret_cast at the API boundary is the only way to pass the lowered buffer.",
        kind: "polyfill",
      },
      {
        // Raw register declarations (framework-native and MCU register
        // exports) map a literal address to a volatile uint32_t* MMIO
        // pointer. C++14 has no standard integer→pointer conversion other
        // than reinterpret_cast.
        detect: /reinterpret_cast<volatile uint32_t\*>/,
        justification: "MMIO register declarations convert a literal address to a volatile uint32_t* pointer; reinterpret_cast is the only standard C++14 integer-to-pointer conversion.",
        kind: "other",
      },
    ],
  },
  { id: "M5-2-8", title: "No pointer arithmetic out of bounds", severity: "required", category: "C", enabled: true },
  { id: "A5-2-2", title: "No static_cast downcast of polymorphic type", severity: "required", category: "C", enabled: true },
  { id: "M5-3-2", title: "No bitwise ops on signed narrow types", severity: "required", category: "C", enabled: true,
    knownPatterns: [
      {
        detect: /<<\s*8|>>\s*\d/,
        justification: "Display color packing (RGB565/RGB888) requires bitwise shifts on narrow types; restructuring would change pixel layout.",
        kind: "ts-literal",
      },
    ],
  },
  { id: "A5-3-2", title: "No bitwise assignment on signed narrow types", severity: "required", category: "C", enabled: true },
  { id: "A7-1-1", title: "const on objects that are not modified", severity: "required", category: "C", enabled: true },
  { id: "A7-1-5", title: "auto only for function returns, non-fundamental types, generic lambdas, trailing return types", severity: "required", category: "C",
    detect: /\bauto\b/, enabled: true,
    knownPatterns: [
      {
        // A7-1-5 permits auto for: (1) function call return types,
        // (2) non-fundamental type initializers, (3) generic lambda params,
        // (4) trailing return type syntax. The self-check can't distinguish
        // these from first principles, so we record a deviation for every
        // auto usage. The renderer separately avoids auto for fundamental
        // types (numbers) under --autosar by substituting int32_t/float/etc.
        detect: /\bauto\b/,
        justification: "auto is used for function return types (case 1) and non-fundamental types (case 2) as permitted by A7-1-5; fundamental-type auto is substituted to explicit fixed-width types by the renderer.",
        kind: "other",
      },
    ],
  },
  { id: "A7-1-6", title: "No typedef outside a function -> use using alias", severity: "required", category: "C",
    detect: /\btypedef\b/, exempt: /\busing\b/, enabled: true,
    knownPatterns: [
      {
        detect: /\btypedef\b/,
        justification: "ESP32 BLE/WiFi callback APIs and async runtimes require C-style function-pointer typedefs for framework interop.",
        kind: "freestanding-function",
      },
    ],
  },
  { id: "A7-2-1", title: "Enumerators use scoped enums (enum class)", severity: "required", category: "C",
    detect: /\benum\s+(?!class\b|struct\b)\w+/, enabled: true,
    knownPatterns: [
      {
        detect: /\benum\s+(?:UINodeKind|UIProperty)\b/,
        justification: "UI runtime internal enums (UINodeKind, UIProperty) use unscoped form for C ABI compatibility; converting to enum class would require updating 58 references across the runtime header.",
        kind: "other",
      },
    ],
  },

  // ── C. Memory & objects ───────────────────────────────────────────────
  { id: "A18-0-1", title: "<cstring> over C headers", severity: "required", category: "C",
    detect: /#include\s+<string\.h>/, enabled: true },
  { id: "A18-5-8", title: "No new/delete on plain objects", severity: "required", category: "D",
    detect: /\bnew\s+(?:[A-Z_]|\()|\bdelete\s+(?:\w+\s*\[|\w)/, enabled: true,
    knownPatterns: [
      {
        detect: /\bnew\s+\(|new\s+\(std::nothrow\)|new\s+\(ps_malloc|new\s+(?:Cuttlefish|GFX|Sdl)/,
        justification: "UI runtime allocates canvas buffers and draw-order arrays on the heap via new/new(std::nothrow); no stack alternative exists for dynamic-size buffers on embedded targets.",
        kind: "raw-array",
      },
      {
        detect: /\bdelete\s+\w/,
        justification: "UI runtime frees heap-allocated canvas buffers via delete; matches the new(std::nothrow) allocation.",
        kind: "raw-array",
      },
    ],
  },
  { id: "A18-5-10", title: "No malloc/calloc/realloc/free (C dynamic memory family)", severity: "required", category: "C",
    detect: /\b(?:ps_)?(?:malloc|calloc|realloc|free)\s*\(/, enabled: true,
    knownPatterns: [
      {
        // Offscreen canvas allocation (CuttlefishCanvas16/CuttlefishCanvasMono
        // object + pixel buffer). On targets built with
        // CONFIG_REQUIRES_FULL_LIBCPP but without CONFIG_CPP_EXCEPTIONS (e.g.
        // Zephyr ESP32 display builds), C++ `operator new` throws
        // std::bad_alloc on OOM, and the `new (std::nothrow)` wrapper's
        // internal catch cannot unwind without the EH runtime — it falls
        // through to std::terminate → abort on the first allocation failure.
        // malloc returns NULL on OOM with no exception path, which the
        // runtime's existing canvas-null-checks degrade gracefully. This is
        // the canonical category-C "platform library constraint" deviation:
        // the alternative (operator new) is the very thing that crashes. The
        // object is placement-constructed on the malloc'd memory and freed via
        // an explicit dtor + free, so the vtable/lifetime are correct.
        // ps_malloc is the ESP32 PSRAM variant of the same constraint.
        detect: /(?:ps_)?malloc\s*\(/,
        justification: "Canvas object/buffer allocation on full-libcpp-without-exceptions targets; malloc (or ESP32 ps_malloc) avoids the operator-new std::bad_alloc → std::terminate → abort path. OOM returns NULL and the runtime degrades gracefully.",
        kind: "ts-literal",
      },
      {
        // Offscreen canvas teardown, the release side of the allocations
        // above (canvas objects and their malloc'd/ps_malloc'd pixel
        // buffers). On Arduino cores operator new is malloc-backed and
        // free() releases both SRAM and PSRAM objects via the ESP32 unified
        // heap, so dtor + free() is the correct teardown for every canvas
        // allocation path — `delete` would be UB on the placement-new PSRAM
        // object. Only these named canvas/buffer releases are deviations;
        // any other free() stays an unrecorded violation.
        detect: /\bfree\s*\(\s*(?:canvas|buffer_|psramBuf)\s*\)/,
        justification: "Canvas teardown on targets whose operator new is malloc-backed (Arduino cores, ESP32 unified heap): the object was placement-constructed or allocation-path-compatible, so dtor + free() is the only well-defined release; delete would be UB on placement-new PSRAM objects.",
        kind: "raw-array",
      },
    ],
  },
  { id: "A27-0-4", title: "No function returning std::move of local", severity: "required", category: "C",
    detect: /return\s+std::move\s*\(/, enabled: true },
  { id: "M5-2-9", title: "No copy of volatile std::atomic", severity: "required", category: "C", enabled: true },

  // ── D. Functions & interfaces ─────────────────────────────────────────
  { id: "A8-4-2", title: "Forward-declare parameters before use", severity: "required", category: "C", enabled: true },
  { id: "A8-4-10", title: "Single return per function", severity: "advisory", category: "D", enabled: true },
  { id: "M3-2-1", title: "All static-storage objects const-initialized", severity: "required", category: "D", enabled: true },
  { id: "M3-2-3", title: "No aggregate inits the compiler can't order statically", severity: "required", category: "C", enabled: true },
  { id: "M3-2-4", title: "No non-trivial init at static storage", severity: "required", category: "D", enabled: true },
  { id: "A3-1-1", title: "final on leaf classes", severity: "required", category: "C", enabled: true },
  { id: "A3-1-5", title: "All virtual methods have override or final", severity: "required", category: "C", enabled: true },
  { id: "A10-3-1", title: "No function hiding in derived classes", severity: "required", category: "C", enabled: true },
  { id: "A8-4-7", title: "One definition of an inline function", severity: "required", category: "C", enabled: true },

  // ── E. Control flow & exceptions ──────────────────────────────────────
  { id: "A5-1-1", title: "No recursion", severity: "required", category: "C", enabled: true },
  { id: "A15-0-2", title: "noexcept on functions that can't throw", severity: "advisory", category: "C", enabled: true,
    knownPatterns: [
      {
        detect: /\bnoexcept\b/,
        justification: "noexcept annotation requires whole-function throw analysis (Phase 5); recorded as advisory deviation until then.",
        kind: "other",
      },
    ],
  },
  { id: "A15-5-1", title: "Destructors must not throw", severity: "required", category: "C", enabled: true },
  { id: "M15-1-3", title: "No throw expressions; no try/catch", severity: "required", category: "D",
    detect: /\bthrow\b|\btry\s*\{|\bcatch\s*\(/, enabled: true },
  { id: "A7-5-1", title: "[[fallthrough]] required where switch falls through", severity: "required", category: "C", enabled: true },
  { id: "M6-2-1", title: "switch must have default", severity: "required", category: "C", enabled: true },
  { id: "M6-4-3", title: "for condition guarded against finite iteration", severity: "required", category: "C", enabled: true },
  { id: "A6-5-1", title: "for/while have single loop variable", severity: "required", category: "C", enabled: true },

  // ── F. Literal & style ────────────────────────────────────────────────
  { id: "A2-10-5", title: "Identifier reuse across scopes limited", severity: "advisory", category: "C", enabled: true },
  { id: "A2-13-1", title: "Only hex literals are bitwise", severity: "required", category: "D", enabled: true },
  { id: "A3-9-1", title: "Fixed-width integers (uint32_t not unsigned int)", severity: "required", category: "C", enabled: true },
  { id: "M4-5-1", title: "No magic numbers; named constants", severity: "advisory", category: "D", enabled: true },
  { id: "A18-1-1", title: "C-style arrays -> std::array", severity: "required", category: "D", enabled: true },
  { id: "A8-4-4", title: "No goto", severity: "required", category: "C",
    detect: /\bgoto\s+\w+;/, enabled: true },
  { id: "A7-1-2", title: "No register keyword", severity: "required", category: "C",
    detect: /(?<![A-Za-z0-9_])register\s+(?:int|char|short|long|unsigned|float|double|bool|void|uint\d+_t|int\d+_t|size_t|auto)/, enabled: true },

  // ── G. Source organization ────────────────────────────────────────────
  { id: "A3-3-2", title: "No unreachable code", severity: "required", category: "C", enabled: true },
  { id: "A0-1-1", title: "No unused variables/functions", severity: "required", category: "C", enabled: true },
  { id: "A2-11-1", title: "No identifier is simultaneously typedef and another entity", severity: "required", category: "C", enabled: true },
  { id: "M0-1-2", title: "No value-convertible dead code", severity: "required", category: "C", enabled: true },
  { id: "A7-3-1", title: "No public/protected mutable non-static members", severity: "required", category: "D", enabled: true },
];

export function getRule(id: string): RuleEntry | undefined {
  return RULES.find((r) => r.id === id);
}

export function rulesByCategory(category: "C" | "D"): readonly RuleEntry[] {
  return RULES.filter((r) => r.category === category);
}
