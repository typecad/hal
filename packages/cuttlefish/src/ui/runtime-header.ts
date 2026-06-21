// ---------------------------------------------------------------------------
// C++ reactive runtime header — the driver code that walks the node/binding/
// transition tables each frame.
//
// This is emitted once per translation unit (guarded) so the static tables
// produced by the lowering transformer have something to drive them. It
// implements the three-phase frame from spec §7:
//   1. Advance transitions (lerp toward target)
//   2. Draw traversal (dirty nodes only)
//   3. Flush dirty rects
//
// Plus the press/release entry points that node.onPress(pin) lowers to.
// ---------------------------------------------------------------------------

export function emitRuntimeHeader(): string {
  return `
// ── TypeHAL UI runtime (emit once per TU) ──────────────────────────────────
#ifndef __TC_UI_RUNTIME
#define __TC_UI_RUNTIME
#include <stdint.h>

enum UINodeKind { NODE_FILL, NODE_TEXT, NODE_BUTTON };
enum UIProperty { PROP_BG, PROP_FG, PROP_TEXT, PROP_VISIBLE };

struct UIRect { int16_t x, y, w, h; };
struct UINode {
  UIRect box;
  uint16_t bg;
  uint16_t fg;
  UINodeKind kind;
  const char* text;
  const uint8_t* font;
  uint8_t hasBg;
  uint8_t textAlign;    // 0=left, 1=center, 2=right
  uint16_t borderColor; // resolved color for the border (0 = use fg)
  uint8_t borderStyle;  // 0=none, 1=solid, 2=dashed
  uint8_t underline;    // 0=none, 1=underline
  uint8_t visible;      // 0=hidden, 1=visible
  // runtime slot
  uint8_t dirty;
  uint8_t pressed;
};
struct UITransition {
  uint8_t node;
  UIProperty prop;
  uint16_t durationMs;
  // The :pressed and base-state target colors. ui_on_press arms toward
  // pressedTarget; ui_on_release arms toward baseTarget.
  uint16_t pressedTarget;
  uint16_t baseTarget;
  // runtime
  uint16_t elapsed;
  uint16_t prevValue;
  uint16_t targetValue;
  uint8_t  active;
};
struct UIBinding {
  uint8_t node;
  UIProperty prop;
  uint16_t (*fn)(void);       // for color/numeric bindings
  const char* (*textFn)(void); // for text bindings (PROP_TEXT)
};

// Color lerp for transitions (rgb565). For mono, this collapses to a snap.
static inline uint16_t lerp_color(uint16_t a, uint16_t b, uint8_t k100) {
  if (k100 >= 100) return b;
  uint8_t ar = (a >> 11) & 0x1f, ag = (a >> 5) & 0x3f, ab = a & 0x1f;
  uint8_t br = (b >> 11) & 0x1f, bg = (b >> 5) & 0x3f, bb = b & 0x1f;
  uint8_t r = ar + (uint8_t)(((uint16_t)(br - ar) * k100) / 100);
  uint8_t g = ag + (uint8_t)(((uint16_t)(bg - ag) * k100) / 100);
  uint8_t bl = ab + (uint8_t)(((uint16_t)(bb - ab) * k100) / 100);
  return ((uint16_t)(r & 0x1f) << 11) | ((uint16_t)(g & 0x3f) << 5) | (uint16_t)(bl & 0x1f);
}

// Declared by the lowering output (the tables). Matches the mutable (non-const)
// definitions: ui_tick updates node bg/dirty and transition elapsed/active.
extern UINode __ui_nodes[];
extern UITransition __ui_trans[];
extern UIBinding __ui_bindings[];
extern const uint8_t __ui_node_count;
extern const uint8_t __ui_trans_count;
extern const uint8_t __ui_binding_count;

// Per-node dirty marker (called by press handlers and binding evaluation).
static inline void ui_mark_dirty(uint8_t nodeIdx) {
  __ui_nodes[nodeIdx].dirty = 1;
}

// Initial draw: mark all nodes dirty so the first ui_tick renders everything.
// Called once in setup() before the loop begins.
static inline void ui_init(void) {
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    __ui_nodes[i].dirty = 1;
  }
}

// Debounce: ignore press/release events within 50ms of the last edge.
// Mechanical switches bounce (multiple edges in ~5-20ms); without this, the
// transition gets armed/interrupted dozens of times per physical press.
static volatile uint32_t __ui_last_edge_time = 0;
#define UI_DEBOUNCE_MS 50

// Press / release entry points that node.onPress(pin) lowers to.
// On press, arm transitions toward the :pressed target color; on release,
// arm them back toward the base color (interrupt-and-re-lerp from current).
static inline void ui_on_press(uint8_t nodeIdx) {
  uint32_t now = millis();
  if (now - __ui_last_edge_time < UI_DEBOUNCE_MS) return;
  __ui_last_edge_time = now;
  __ui_nodes[nodeIdx].pressed = 1;
  ui_mark_dirty(nodeIdx);
  for (uint8_t i = 0; i < __ui_trans_count; i++) {
    if (__ui_trans[i].node == nodeIdx) {
      __ui_trans[i].prevValue = __ui_nodes[nodeIdx].bg;
      __ui_trans[i].targetValue = __ui_trans[i].pressedTarget;
      __ui_trans[i].elapsed = 0;
      __ui_trans[i].active = 1;
    }
  }
}
static inline void ui_on_release(uint8_t nodeIdx) {
  uint32_t now = millis();
  if (now - __ui_last_edge_time < UI_DEBOUNCE_MS) return;
  __ui_last_edge_time = now;
  __ui_nodes[nodeIdx].pressed = 0;
  ui_mark_dirty(nodeIdx);
  for (uint8_t i = 0; i < __ui_trans_count; i++) {
    if (__ui_trans[i].node == nodeIdx) {
      __ui_trans[i].prevValue = __ui_nodes[nodeIdx].bg;
      __ui_trans[i].targetValue = __ui_trans[i].baseTarget;
      __ui_trans[i].elapsed = 0;
      __ui_trans[i].active = 1;
    }
  }
}

// Pin-watch callback type: void fn(void)
typedef void (*PinWatchCallback)(void);

struct UIPinWatch {
  uint8_t pin;
  uint8_t lastState;   // for edge detection
  PinWatchCallback cb; // fires on falling edge
};

// Populated by the emit layer from ui.watchPin() calls.
extern UIPinWatch __ui_pin_watches[];
extern const uint8_t __ui_pin_watch_count;

// Poll all configured pin-watchers. Called at the start of ui_tick each frame.
// Detects falling edges with natural debounce from the ~16ms frame rate.
static inline void ui_poll_inputs() {
  for (uint8_t i = 0; i < __ui_pin_watch_count; i++) {
    uint8_t val = digitalRead(__ui_pin_watches[i].pin);
    if (val == LOW && __ui_pin_watches[i].lastState == HIGH) {
      if (__ui_pin_watches[i].cb) __ui_pin_watches[i].cb();
    }
    __ui_pin_watches[i].lastState = val;
  }
}

// Per-frame driver. The host async/loop pump calls this each tick (~16ms).
// Phase -1: poll input pins (edge detection + callbacks).
// Phase 0: evaluate bindings (mark nodes dirty when values change).
// Phase 1: advance transitions. Phase 2: draw dirty nodes to __tc_display.
static inline void ui_tick(uint16_t deltaMs) {
  // ⓪' Poll inputs first
  ui_poll_inputs();
  // ⓪ Evaluate bindings: call each binding's fn, compare to the node's
  // current property value, mark dirty if changed.
  for (uint8_t i = 0; i < __ui_binding_count; i++) {
    if (__ui_bindings[i].prop == PROP_TEXT && __ui_bindings[i].textFn) {
      // Text binding: compare string pointers (re-render if changed)
      const char* newText = __ui_bindings[i].textFn();
      if (newText != __ui_nodes[__ui_bindings[i].node].text) {
        __ui_nodes[__ui_bindings[i].node].text = newText;
        ui_mark_dirty(__ui_bindings[i].node);
      }
    } else if (__ui_bindings[i].fn) {
      // Color/numeric binding
      uint16_t newVal = __ui_bindings[i].fn();
      uint16_t* target = (__ui_bindings[i].prop == PROP_BG) ? &__ui_nodes[__ui_bindings[i].node].bg
                    : (__ui_bindings[i].prop == PROP_FG) ? &__ui_nodes[__ui_bindings[i].node].fg
                    : &__ui_nodes[__ui_bindings[i].node].bg;
      if (newVal != *target) {
        *target = newVal;
        ui_mark_dirty(__ui_bindings[i].node);
      }
    }
  }
  // ① Advance transitions.
  for (uint8_t i = 0; i < __ui_trans_count; i++) {
    if (!__ui_trans[i].active) continue;
    __ui_trans[i].elapsed += deltaMs;
    uint16_t k = (uint16_t)((uint32_t)__ui_trans[i].elapsed * 100 / __ui_trans[i].durationMs);
    uint16_t v = lerp_color(__ui_trans[i].prevValue, __ui_trans[i].targetValue, (uint8_t)k);
    __ui_nodes[__ui_trans[i].node].bg = v;
    ui_mark_dirty(__ui_trans[i].node);
    if (k >= 100) __ui_trans[i].active = 0;
  }
  // ② Draw dirty nodes directly to the display object.
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    if (!__ui_nodes[i].dirty) continue;
    if (!__ui_nodes[i].visible) continue;  // visibility: hidden → skip entirely
    // Compute text width helper (used by text-align and button centering).
    uint16_t tw = 0;
    if (__ui_nodes[i].text) {
      for (const char* p = __ui_nodes[i].text; *p; p++) tw += 12;
    }
    // Compute x offset based on text-align (0=left, 1=center, 2=right).
    int16_t textX = __ui_nodes[i].box.x;
    if (__ui_nodes[i].textAlign == 1) textX = __ui_nodes[i].box.x + (__ui_nodes[i].box.w - tw) / 2;
    else if (__ui_nodes[i].textAlign == 2) textX = __ui_nodes[i].box.x + __ui_nodes[i].box.w - tw;
    // Border color: use borderColor if set, otherwise fg.
    uint16_t bColor = __ui_nodes[i].borderColor ? __ui_nodes[i].borderColor : __ui_nodes[i].fg;
    switch (__ui_nodes[i].kind) {
      case NODE_FILL:
        __tc_display.fillRect(__ui_nodes[i].box.x, __ui_nodes[i].box.y, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].bg);
        break;
      case NODE_TEXT:
        if (__ui_nodes[i].hasBg)
          __tc_display.fillRect(__ui_nodes[i].box.x, __ui_nodes[i].box.y, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].bg);
        __tc_display.setCursor(textX, __ui_nodes[i].box.y);
        __tc_display.setTextColor(__ui_nodes[i].fg);
        __tc_display.setTextSize(2);
        __tc_display.print(__ui_nodes[i].text);
        // Underline: drawFastHLine below the text baseline.
        if (__ui_nodes[i].underline)
          __tc_display.drawFastHLine(textX, __ui_nodes[i].box.y + 15, tw, __ui_nodes[i].fg);
        break;
      case NODE_BUTTON:
        // Fill background (if set)
        if (__ui_nodes[i].hasBg)
          __tc_display.fillRect(__ui_nodes[i].box.x, __ui_nodes[i].box.y, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].bg);
        // Border: respect borderStyle (0=none, 1=solid, 2=dashed)
        if (__ui_nodes[i].borderStyle == 1) {
          __tc_display.drawRect(__ui_nodes[i].box.x, __ui_nodes[i].box.y, __ui_nodes[i].box.w, __ui_nodes[i].box.h, bColor);
        } else if (__ui_nodes[i].borderStyle == 2) {
          // Dashed: approximate with 4px segments on each edge
          for (int16_t dx = 0; dx < __ui_nodes[i].box.w; dx += 8)
            __tc_display.drawFastHLine(__ui_nodes[i].box.x + dx, __ui_nodes[i].box.y, 4, bColor);
          for (int16_t dx = 0; dx < __ui_nodes[i].box.w; dx += 8)
            __tc_display.drawFastHLine(__ui_nodes[i].box.x + dx, __ui_nodes[i].box.y + __ui_nodes[i].box.h - 1, 4, bColor);
          for (int16_t dy = 0; dy < __ui_nodes[i].box.h; dy += 8)
            __tc_display.drawFastVLine(__ui_nodes[i].box.x, __ui_nodes[i].box.y + dy, 4, bColor);
          for (int16_t dy = 0; dy < __ui_nodes[i].box.h; dy += 8)
            __tc_display.drawFastVLine(__ui_nodes[i].box.x + __ui_nodes[i].box.w - 1, __ui_nodes[i].box.y + dy, 4, bColor);
        }
        // Center text (buttons always center regardless of textAlign)
        __tc_display.setCursor(
          __ui_nodes[i].box.x + (__ui_nodes[i].box.w - tw) / 2,
          __ui_nodes[i].box.y + (__ui_nodes[i].box.h - 16) / 2);
        __tc_display.setTextColor(__ui_nodes[i].fg);
        __tc_display.setTextSize(2);
        __tc_display.print(__ui_nodes[i].text);
        break;
    }
    __ui_nodes[i].dirty = 0;
  }
  // ③ Flush — ILI9341 is immediate, no separate flush needed.
}

#endif
`;
}
