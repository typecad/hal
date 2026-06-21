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
  uint16_t bg;       // resolved color (rgb565 or 0/1 mono)
  uint16_t fg;
  UINodeKind kind;
  const char* text;
  const uint8_t* font;
  // runtime slot
  uint8_t dirty;
  uint8_t pressed;
};
struct UITransition {
  uint8_t node;
  UIProperty prop;
  uint16_t durationMs;
  // runtime
  uint16_t elapsed;
  uint16_t prevValue;
  uint16_t targetValue;
  uint8_t  active;
};
struct UIBinding {
  uint8_t node;
  UIProperty prop;
  uint16_t (*fn)(void);
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

// Arm transitions on a node toward the given target. Used by press/release.
static inline void ui_arm_transitions(uint8_t nodeIdx, uint16_t target) {
  for (uint8_t i = 0; i < __ui_trans_count; i++) {
    if (__ui_trans[i].node == nodeIdx) {
      __ui_trans[i].prevValue = __ui_nodes[nodeIdx].bg;
      __ui_trans[i].targetValue = target;
      __ui_trans[i].elapsed = 0;
      __ui_trans[i].active = 1;
    }
  }
}

// Initial draw: mark all nodes dirty so the first ui_tick renders everything.
// Called once in setup() before the loop begins.
static inline void ui_init(void) {
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    __ui_nodes[i].dirty = 1;
  }
}

// Press / release entry points that node.onPress(pin) lowers to.
// On press, :pressed style values become the transition target; on release,
// the base values become the target (interrupt-and-re-lerp from current).
static inline void ui_on_press(uint8_t nodeIdx) {
  __ui_nodes[nodeIdx].pressed = 1;
  ui_mark_dirty(nodeIdx);
}
static inline void ui_on_release(uint8_t nodeIdx) {
  __ui_nodes[nodeIdx].pressed = 0;
  ui_mark_dirty(nodeIdx);
}

// Per-frame driver. The host async/loop pump calls this each tick (~16ms).
// Phase 0: evaluate bindings (mark nodes dirty when values change).
// Phase 1: advance transitions. Phase 2: draw dirty nodes to __tc_display.
// Phase 3: flush (no-op for ILI9341 — draws are immediate).
static inline void ui_tick(uint16_t deltaMs) {
  // ⓪ Evaluate bindings: call each binding's fn, compare to the node's
  // current property value, mark dirty if changed.
  for (uint8_t i = 0; i < __ui_binding_count; i++) {
    uint16_t newVal = __ui_bindings[i].fn();
    uint16_t* target = (__ui_bindings[i].prop == PROP_BG) ? &__ui_nodes[__ui_bindings[i].node].bg
                  : (__ui_bindings[i].prop == PROP_FG) ? &__ui_nodes[__ui_bindings[i].node].fg
                  : &__ui_nodes[__ui_bindings[i].node].bg;
    if (newVal != *target) {
      *target = newVal;
      ui_mark_dirty(__ui_bindings[i].node);
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
    switch (__ui_nodes[i].kind) {
      case NODE_FILL:
        __tc_display.fillRect(__ui_nodes[i].box.x, __ui_nodes[i].box.y, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].bg);
        break;
      case NODE_TEXT:
        __tc_display.fillRect(__ui_nodes[i].box.x, __ui_nodes[i].box.y, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].bg);
        __tc_display.setCursor(__ui_nodes[i].box.x, __ui_nodes[i].box.y);
        __tc_display.setTextColor(__ui_nodes[i].fg);
        __tc_display.setTextSize(2);
        __tc_display.print(__ui_nodes[i].text);
        break;
      case NODE_BUTTON:
        // Fill background, draw a border, center the text.
        __tc_display.fillRect(__ui_nodes[i].box.x, __ui_nodes[i].box.y, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].bg);
        __tc_display.drawRect(__ui_nodes[i].box.x, __ui_nodes[i].box.y, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].fg);
        // Center text: approximate text width as strlen * 6px * textSize, height as 8px * textSize.
        __tc_display.setCursor(
          __ui_nodes[i].box.x + (__ui_nodes[i].box.w - 12) / 2,
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
