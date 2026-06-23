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
#define UI_TEXT_BUF 16   // single source of truth: UINode field + textFn size arg + snprintf bound

enum UINodeKind { NODE_FILL, NODE_TEXT, NODE_BUTTON, NODE_CHECK, NODE_RADIO, NODE_PROGRESS };
enum UIProperty { PROP_BG, PROP_FG, PROP_TEXT, PROP_VISIBLE, PROP_BORDER_COLOR };

struct UIRect { int16_t x, y, w, h; };
struct UINode {
  UIRect box;
  uint16_t bg;
  uint16_t fg;
  UINodeKind kind;
  const char* text;
  char textBuffer[UI_TEXT_BUF]; // dynamic text — read only when hasTextBinding == 1
  uint8_t hasTextBinding;       // set by ui_init when a PROP_TEXT binding targets this node
  const uint8_t* font;
  uint8_t hasBg;
  uint8_t textAlign;    // 0=left, 1=center, 2=right
  uint16_t borderColor; // resolved color for the border (0 = use fg)
  uint8_t borderStyle;  // 0=none, 1=solid, 2=dashed
  uint8_t underline;    // 0=none, 1=underline
  uint8_t visible;      // 0=hidden, 1=visible
  uint16_t clearColor;  // ancestor's background — used to wipe transparent text before redraw
  uint16_t lastTextWidth;
  // scroll
  uint8_t scrollable;   // 1 = children are offset by scrollY and clipped to this box
  int16_t scrollY;      // current scroll offset (children Y -= scrollY)
  int16_t contentHeight; // total height of children (for scrollbar ratio)
  uint8_t parent;       // 255 = root/no parent
  uint8_t subtreeEnd;   // exclusive pre-order end index
  // runtime slot
  uint8_t dirty;
  int16_t value;  // unified element state
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
  void (*textFn)(char* buf, uint8_t size); // for text bindings (PROP_TEXT): fills buf
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

#define UI_NO_PARENT 255

// Per-node dirty marker (called by press handlers and binding evaluation).
static inline void ui_mark_dirty(uint8_t nodeIdx) {
  __ui_nodes[nodeIdx].dirty = 1;
}

static inline int16_t ui_draw_y_for_node(uint8_t nodeIdx) {
  int16_t y = __ui_nodes[nodeIdx].box.y;
  uint8_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (__ui_nodes[p].scrollable) y -= __ui_nodes[p].scrollY;
    p = __ui_nodes[p].parent;
  }
  return y;
}

static inline uint8_t ui_is_clipped_by_scroll(uint8_t nodeIdx, int16_t drawY) {
  uint8_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (__ui_nodes[p].scrollable) {
      if (__ui_nodes[nodeIdx].box.x < __ui_nodes[p].box.x ||
          __ui_nodes[nodeIdx].box.x + __ui_nodes[nodeIdx].box.w > __ui_nodes[p].box.x + __ui_nodes[p].box.w ||
          drawY < __ui_nodes[p].box.y ||
          drawY + __ui_nodes[nodeIdx].box.h > __ui_nodes[p].box.y + __ui_nodes[p].box.h) {
        return 1;
      }
    }
    p = __ui_nodes[p].parent;
  }
  return 0;
}

// Initial draw: mark all nodes dirty so the first ui_tick renders everything.
// Called once in setup() before the loop begins.
// Also seed each text-bound node's buffer from its flash literal so the first
// strcmp in ui_tick has a valid baseline (no spurious redraw on frame 1).
static inline void ui_init(void) {
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    __ui_nodes[i].dirty = 1;
  }
  for (uint8_t i = 0; i < __ui_binding_count; i++) {
    if (__ui_bindings[i].prop == PROP_TEXT && __ui_bindings[i].textFn) {
      uint8_t n = __ui_bindings[i].node;
      __ui_nodes[n].hasTextBinding = 1;
      strncpy(__ui_nodes[n].textBuffer, __ui_nodes[n].text, UI_TEXT_BUF - 1);
      __ui_nodes[n].textBuffer[UI_TEXT_BUF - 1] = '\\0';
    }
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
  __ui_nodes[nodeIdx].value = 1;
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
  __ui_nodes[nodeIdx].value = 0;
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

// ── Touch hit-testing + click dispatch ─────────────────────────────────────
// Radio groups for mutual exclusion
struct UIRadioGroup {
  uint8_t nodeIndices[8];
  uint8_t count;
};
extern UIRadioGroup __ui_radio_groups[];
extern const uint8_t __ui_radio_group_count;

// Forward-declare the click handler type + tables (defined by the emit layer).
extern void (*__ui_click_handlers[])();
extern void (*__ui_hold_handlers[])();
extern void (*__ui_release_handlers[])();
extern const uint8_t __ui_click_handler_count;

// Touch state machine: tracks down → hold → up → click lifecycle
static uint8_t __ui_touch_state = 0;  // 0=idle, 1=down, 2=holding
static int8_t __ui_touch_node = -1;   // which node is being touched (-1=none)
static uint32_t __ui_touch_down_time = 0;  // millis() when touch started
static uint32_t __ui_last_touch_time = 0;  // for debounce (updated on touch down only)
static uint32_t __ui_last_release_time = 0;  // for release debounce
static int16_t __ui_drag_start_x = 0;
static int16_t __ui_drag_start_y = 0;
static uint8_t __ui_is_dragging = 0;     // 1 once movement exceeds threshold
static int8_t __ui_scroll_node = -1;     // scrollable container being dragged
#define UI_TOUCH_DEBOUNCE_MS 50
#define UI_TOUCH_HOLD_MS 600
#define UI_DRAG_THRESHOLD 10

// Hit-test a touch point against all visible nodes (topmost first).
// Returns the node index of the topmost node that BOTH contains the point
// AND has a click handler registered. Returns -1 if none.
static int8_t ui_hit_test(int16_t tx, int16_t ty) {
  for (int8_t i = __ui_node_count - 1; i >= 0; i--) {
    if (!__ui_nodes[i].visible) continue;
    int16_t drawY = ui_draw_y_for_node((uint8_t)i);
    if (ui_is_clipped_by_scroll((uint8_t)i, drawY)) continue;
    if (tx >= __ui_nodes[i].box.x && tx < __ui_nodes[i].box.x + __ui_nodes[i].box.w &&
        ty >= drawY && ty < drawY + __ui_nodes[i].box.h) {
      // Skip nodes without any click handler — they're containers, not targets
      if ((uint8_t)i < __ui_click_handler_count &&
          (__ui_click_handlers[i] || __ui_hold_handlers[i] || __ui_release_handlers[i])) {
        return i;
      }
    }
  }
  return -1;
}

// Dispatch a handler from the given table if registered for the node.
static void ui_dispatch(void (**table)(), uint8_t count, int8_t node) {
  if (node >= 0 && (uint8_t)node < count && table[node]) {
    table[node]();
  }
}

// Touch down: called when screen is first touched.
static void ui_touch_down(int16_t tx, int16_t ty) {
  int8_t node = ui_hit_test(tx, ty);
  __ui_touch_node = node;
  __ui_touch_state = 1;
  __ui_touch_down_time = millis();
  __ui_drag_start_x = tx;
  __ui_drag_start_y = ty;
  __ui_is_dragging = 0;
  __ui_scroll_node = -1;
  // Check if the touch is inside a scrollable container
  for (int8_t i = __ui_node_count - 1; i >= 0; i--) {
    if (!__ui_nodes[i].scrollable || !__ui_nodes[i].visible) continue;
    if (tx >= __ui_nodes[i].box.x && tx < __ui_nodes[i].box.x + __ui_nodes[i].box.w &&
        ty >= __ui_nodes[i].box.y && ty < __ui_nodes[i].box.y + __ui_nodes[i].box.h) {
      if (__ui_nodes[i].contentHeight > __ui_nodes[i].box.h) {
        __ui_scroll_node = i;
        break;
      }
    }
  }
  if (node >= 0) {
    if (__ui_nodes[node].kind == NODE_BUTTON) {
      __ui_nodes[node].value = 1;
    }
    ui_mark_dirty(node);
  }
}

// Touch up: called when touch is released. Determines click vs hold.
static void ui_touch_up() {
  uint32_t elapsed = millis() - __ui_touch_down_time;
  if (__ui_touch_node >= 0 && !__ui_is_dragging) {
    int8_t clickedNode = __ui_touch_node;
    if (elapsed < UI_TOUCH_HOLD_MS) {
      ui_dispatch(__ui_click_handlers, __ui_click_handler_count, __ui_touch_node);
    }
    ui_dispatch(__ui_release_handlers, __ui_click_handler_count, __ui_touch_node);
    if (__ui_nodes[clickedNode].kind == NODE_BUTTON) {
      __ui_nodes[clickedNode].value = 0;
    }
    ui_mark_dirty(clickedNode);
  }
  __ui_touch_state = 0;
  __ui_touch_node = -1;
  __ui_is_dragging = 0;
  __ui_scroll_node = -1;
}

// Called each frame from ui_poll_touch when touch is detected.
// Implements debounce + the down/hold/up/click state machine.
static inline void ui_handle_touch(int16_t tx, int16_t ty) {
  uint32_t now = millis();

  if (__ui_touch_state == 0) {
    // Idle: check debounce, then start touch
    if (now - __ui_last_touch_time < UI_TOUCH_DEBOUNCE_MS) return;
    ui_touch_down(tx, ty);
  } else {
    // Already touching: check for drag or hold
    if (!__ui_is_dragging && __ui_scroll_node >= 0) {
      // Check if movement exceeds drag threshold
      int16_t dy = ty - __ui_drag_start_y;
      if (abs(dy) >= UI_DRAG_THRESHOLD) {
        __ui_is_dragging = 1;
      }
    }
    if (__ui_is_dragging && __ui_scroll_node >= 0) {
      // Scroll: move content by the delta from last frame
      int16_t dy = ty - __ui_drag_start_y;
      __ui_drag_start_y = ty;
      int16_t maxScroll = __ui_nodes[__ui_scroll_node].contentHeight - __ui_nodes[__ui_scroll_node].box.h;
      int16_t prevScrollY = __ui_nodes[__ui_scroll_node].scrollY;
      int16_t nextScrollY = constrain(prevScrollY - dy, 0, maxScroll);
      if (nextScrollY != prevScrollY) {
        __ui_nodes[__ui_scroll_node].scrollY = nextScrollY;
        // Mark only descendants dirty; overlapping siblings are not scroll content.
        for (uint8_t c = (uint8_t)__ui_scroll_node + 1; c < __ui_nodes[__ui_scroll_node].subtreeEnd; c++) {
          ui_mark_dirty(c);
        }
        ui_mark_dirty(__ui_scroll_node);
      }
    }
    if (__ui_touch_state == 1 && __ui_touch_node >= 0 && !__ui_is_dragging) {
      if (now - __ui_touch_down_time >= UI_TOUCH_HOLD_MS) {
        __ui_touch_state = 2;
        ui_dispatch(__ui_hold_handlers, __ui_click_handler_count, __ui_touch_node);
      }
    }
  }
  __ui_last_touch_time = now;
}

// Called each frame when no touch is detected.
static inline void ui_handle_no_touch() {
  if (__ui_touch_state != 0) {
    // Debounce: require a gap since the last release before processing another.
    // This prevents crash from rapid touch/no-touch flicker on resistive screens.
    if (millis() - __ui_last_release_time < UI_TOUCH_DEBOUNCE_MS) return;
    ui_touch_up();
    __ui_last_release_time = millis();
  }
}

// Per-frame driver. The host async/loop pump calls this each tick (~16ms).
// Phase -2: poll touch (if configured). Phase -1: poll input pins.
// Phase 0: evaluate bindings. Phase 1: transitions. Phase 2: draw.
static inline void ui_tick(uint16_t deltaMs) {
  // Touch poll — runs if touch is configured (defined by the emit layer)
  ui_poll_touch();
  // ⓪' Poll GPIO inputs
  ui_poll_inputs();
  // ⓪ Evaluate bindings: call each binding's fn, compare to the node's
  // current property value, mark dirty if changed.
  for (uint8_t i = 0; i < __ui_binding_count; i++) {
    if (__ui_bindings[i].prop == PROP_TEXT && __ui_bindings[i].textFn) {
      // Text binding: fill the node's buffer, compare content, mark dirty if changed.
      uint8_t n = __ui_bindings[i].node;
      char oldBuf[UI_TEXT_BUF];
      strcpy(oldBuf, __ui_nodes[n].textBuffer);
      __ui_bindings[i].textFn(__ui_nodes[n].textBuffer, UI_TEXT_BUF);
      if (strcmp(oldBuf, __ui_nodes[n].textBuffer) != 0) {
        ui_mark_dirty(n);
      }
    } else if (__ui_bindings[i].fn) {
      // Color/numeric binding
      uint16_t newVal = __ui_bindings[i].fn();
      uint16_t* target = (__ui_bindings[i].prop == PROP_BG) ? &__ui_nodes[__ui_bindings[i].node].bg
                    : (__ui_bindings[i].prop == PROP_FG) ? &__ui_nodes[__ui_bindings[i].node].fg
                    : (__ui_bindings[i].prop == PROP_BORDER_COLOR) ? &__ui_nodes[__ui_bindings[i].node].borderColor
                    : &__ui_nodes[__ui_bindings[i].node].bg;
      if (newVal != *target) {
        *target = newVal;
        // When a background binding writes a new color, ensure hasBg is set
        // so the draw dispatch actually fills (the node may have started
        // transparent but now has a runtime-assigned background).
        if (__ui_bindings[i].prop == PROP_BG) __ui_nodes[__ui_bindings[i].node].hasBg = 1;
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
  // First: if any scrollable container has dirty children, clear its viewport
  // with the background to prevent tearing (old content remains without this).
  for (uint8_t s = 0; s < __ui_node_count; s++) {
    if (!__ui_nodes[s].scrollable || !__ui_nodes[s].visible) continue;
    if (__ui_nodes[s].contentHeight <= __ui_nodes[s].box.h) continue;
    // The scroll container is marked dirty only when the scroll offset changes
    // or during first draw. Ordinary dirty descendants can repaint in place.
    if (__ui_nodes[s].dirty) {
      for (uint8_t c = s; c < __ui_nodes[s].subtreeEnd; c++) {
        ui_mark_dirty(c);
        // Reset incremental redraw state for progress bars so they fully redraw
        // after the viewport is cleared (otherwise only the delta draws).
        if (__ui_nodes[c].kind == NODE_PROGRESS) __ui_nodes[c].lastTextWidth = 0;
      }
      // Clear the viewport with the container's background (or parent's clear color)
      __tc_display.fillRect(__ui_nodes[s].box.x, __ui_nodes[s].box.y, __ui_nodes[s].box.w, __ui_nodes[s].box.h,
        __ui_nodes[s].hasBg ? __ui_nodes[s].bg : __ui_nodes[s].clearColor);
    }
  }
  uint8_t scrollbarDirty[256] = {0};
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    if (__ui_nodes[i].scrollable && __ui_nodes[i].dirty) scrollbarDirty[i] = 1;
  }
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    if (!__ui_nodes[i].dirty) continue;
    if (!__ui_nodes[i].visible) continue;
    int16_t drawY = ui_draw_y_for_node(i);
    if (ui_is_clipped_by_scroll(i, drawY)) { __ui_nodes[i].dirty = 0; continue; }

    // Source selection: text-bound nodes show their dynamic buffer; others show
    // the immutable flash literal.
    const char* displayText = __ui_nodes[i].hasTextBinding
      ? __ui_nodes[i].textBuffer
      : __ui_nodes[i].text;
    // Compute text width helper (used by text-align and button centering).
    uint16_t tw = 0;
    if (displayText) {
      for (const char* p = displayText; *p; p++) tw += 12;
    }
    // Compute x offset based on text-align (0=left, 1=center, 2=right).
    int16_t textX = __ui_nodes[i].box.x;
    if (__ui_nodes[i].textAlign == 1) textX = __ui_nodes[i].box.x + (__ui_nodes[i].box.w - tw) / 2;
    else if (__ui_nodes[i].textAlign == 2) textX = __ui_nodes[i].box.x + __ui_nodes[i].box.w - tw;
    // Border color: use borderColor if set, otherwise fg.
    uint16_t bColor = __ui_nodes[i].borderColor ? __ui_nodes[i].borderColor : __ui_nodes[i].fg;
    switch (__ui_nodes[i].kind) {
      case NODE_FILL:
        if (__ui_nodes[i].hasBg)
          __tc_display.fillRect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].bg);
        if (__ui_nodes[i].borderStyle == 1) {
          uint16_t bColor = __ui_nodes[i].borderColor ? __ui_nodes[i].borderColor : __ui_nodes[i].fg;
          __tc_display.drawRect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, bColor);
        }
        break;
      case NODE_TEXT:
        {
          uint16_t clearW = __ui_nodes[i].box.w;
          if (__ui_nodes[i].lastTextWidth > clearW) clearW = __ui_nodes[i].lastTextWidth;
          __tc_display.fillRect(__ui_nodes[i].box.x, drawY, clearW, __ui_nodes[i].box.h,
            __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
          __ui_nodes[i].lastTextWidth = tw;
        }
        __tc_display.setCursor(textX, drawY);
        __tc_display.setTextColor(__ui_nodes[i].fg);
        __tc_display.setTextSize(2);
        __tc_display.print(displayText);
        if (__ui_nodes[i].underline)
          __tc_display.drawFastHLine(textX, drawY + 15, tw, __ui_nodes[i].fg);
        break;
      case NODE_BUTTON:
        if (__ui_nodes[i].hasBg)
          __tc_display.fillRect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].bg);
        if (__ui_nodes[i].borderStyle == 1) {
          __tc_display.drawRect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, bColor);
        } else if (__ui_nodes[i].borderStyle == 2) {
          for (int16_t dx = 0; dx < __ui_nodes[i].box.w; dx += 8)
            __tc_display.drawFastHLine(__ui_nodes[i].box.x + dx, drawY, 4, bColor);
          for (int16_t dx = 0; dx < __ui_nodes[i].box.w; dx += 8)
            __tc_display.drawFastHLine(__ui_nodes[i].box.x + dx, drawY + __ui_nodes[i].box.h - 1, 4, bColor);
          for (int16_t dy = 0; dy < __ui_nodes[i].box.h; dy += 8)
            __tc_display.drawFastVLine(__ui_nodes[i].box.x, drawY + dy, 4, bColor);
          for (int16_t dy = 0; dy < __ui_nodes[i].box.h; dy += 8)
            __tc_display.drawFastVLine(__ui_nodes[i].box.x + __ui_nodes[i].box.w - 1, drawY + dy, 4, bColor);
        }
        __tc_display.setCursor(
          __ui_nodes[i].box.x + (__ui_nodes[i].box.w - tw) / 2,
          drawY + (__ui_nodes[i].box.h - 16) / 2);
        __tc_display.setTextColor(__ui_nodes[i].fg);
        __tc_display.setTextSize(2);
        __tc_display.print(displayText);
        break;
      case NODE_CHECK:
        {
          uint16_t clearW = __ui_nodes[i].box.w;
          if (__ui_nodes[i].lastTextWidth > clearW) clearW = __ui_nodes[i].lastTextWidth;
          __tc_display.fillRect(__ui_nodes[i].box.x, drawY, clearW, __ui_nodes[i].box.h,
            __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
          __ui_nodes[i].lastTextWidth = tw;
        }
        {
          int16_t cbX = __ui_nodes[i].box.x;
          int16_t cbY = drawY;
          if (__ui_nodes[i].value) {
            __tc_display.fillRect(cbX, cbY, 16, 16, __ui_nodes[i].fg);
            uint16_t inv = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
            __tc_display.drawLine(cbX + 3, cbY + 8, cbX + 7, cbY + 12, inv);
            __tc_display.drawLine(cbX + 4, cbY + 8, cbX + 8, cbY + 12, inv);
            __tc_display.drawLine(cbX + 3, cbY + 9, cbX + 7, cbY + 13, inv);
            __tc_display.drawLine(cbX + 7, cbY + 12, cbX + 13, cbY + 4, inv);
            __tc_display.drawLine(cbX + 8, cbY + 12, cbX + 14, cbY + 4, inv);
            __tc_display.drawLine(cbX + 7, cbY + 13, cbX + 13, cbY + 5, inv);
          } else {
            __tc_display.drawRect(cbX, cbY, 16, 16, __ui_nodes[i].fg);
          }
        }
        __tc_display.setCursor(__ui_nodes[i].box.x + 22, drawY);
        __tc_display.setTextColor(__ui_nodes[i].fg);
        __tc_display.setTextSize(2);
        __tc_display.print(displayText);
        break;
      case NODE_RADIO:
        {
          uint16_t clearW = __ui_nodes[i].box.w;
          if (__ui_nodes[i].lastTextWidth > clearW) clearW = __ui_nodes[i].lastTextWidth;
          __tc_display.fillRect(__ui_nodes[i].box.x, drawY, clearW, __ui_nodes[i].box.h,
            __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
          __ui_nodes[i].lastTextWidth = tw;
          int16_t cbX = __ui_nodes[i].box.x;
          int16_t cbY = drawY;
          if (__ui_nodes[i].value) {
            __tc_display.fillCircle(cbX + 8, cbY + 8, 7, __ui_nodes[i].fg);
            __tc_display.fillCircle(cbX + 8, cbY + 8, 3, __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
          } else {
            __tc_display.drawCircle(cbX + 8, cbY + 8, 7, __ui_nodes[i].fg);
          }
        }
        __tc_display.setCursor(__ui_nodes[i].box.x + 22, drawY);
        __tc_display.setTextColor(__ui_nodes[i].fg);
        __tc_display.setTextSize(2);
        __tc_display.print(displayText);
        break;
      case NODE_PROGRESS:
        // Progress bar: outline track + filled portion based on .value (0-100).
        // Incremental redraw — only draws/clears the delta to avoid flashing.
        {
          int16_t bx = __ui_nodes[i].box.x;
          int16_t by = drawY;
          int16_t bw = __ui_nodes[i].box.w;
          int16_t bh = __ui_nodes[i].box.h;
          uint16_t bgCol = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
          uint16_t fgCol = __ui_nodes[i].fg;

          // On first draw (lastTextWidth==0 and dirty from init), draw everything.
          // Otherwise incremental: only update the changed portion.
          uint8_t pct = constrain(__ui_nodes[i].value, 0, 100);
          int16_t fillW = ((int32_t)(bw - 2) * pct) / 100;
          int16_t prevW = __ui_nodes[i].lastTextWidth; // reused as previous fill width

          if (prevW == 0) {
            // Full redraw: outline + background + fill
            __tc_display.drawRect(bx, by, bw, bh, fgCol);
            __tc_display.fillRect(bx + 1, by + 1, bw - 2, bh - 2, bgCol);
            if (fillW > 0) {
              __tc_display.fillRect(bx + 1, by + 1, fillW, bh - 2, fgCol);
            }
          } else if (fillW > prevW) {
            // Value increased: draw new fill segment on top (no clear needed)
            __tc_display.fillRect(bx + 1 + prevW, by + 1, fillW - prevW, bh - 2, fgCol);
          } else if (fillW < prevW) {
            // Value decreased: clear the removed portion
            __tc_display.fillRect(bx + 1 + fillW, by + 1, prevW - fillW, bh - 2, bgCol);
          }
          // Remember current fill width for next incremental update
          __ui_nodes[i].lastTextWidth = fillW;
        }
        break;
    }
    __ui_nodes[i].dirty = 0;
  }
  // ②b Draw scrollbars for scrollable containers that are dirty.
  // Incremental: only clear the old thumb position and draw the new one.
  // Uses a static array (not .value) to track previous thumb Y per node.
  static int16_t __ui_scrollbar_prevY[16] = {0};
  for (uint8_t i = 0; i < __ui_node_count && i < 16; i++) {
    if (!__ui_nodes[i].scrollable) continue;
    if (!scrollbarDirty[i]) continue;
    if (__ui_nodes[i].contentHeight <= __ui_nodes[i].box.h) continue;
    int16_t tx = __ui_nodes[i].box.x + __ui_nodes[i].box.w - 4;
    int16_t ty = __ui_nodes[i].box.y;
    int16_t th = __ui_nodes[i].box.h;
    __ui_nodes[i].scrollY = constrain(__ui_nodes[i].scrollY, 0, __ui_nodes[i].contentHeight - th);
    uint16_t thumbH = (uint32_t)th * th / __ui_nodes[i].contentHeight;
    if (thumbH < 8) thumbH = 8;
    int16_t maxScroll = __ui_nodes[i].contentHeight - th;
    uint16_t thumbY = ty + (uint32_t)(th - thumbH) * __ui_nodes[i].scrollY / (maxScroll > 0 ? maxScroll : 1);
    uint16_t dimFg = ((__ui_nodes[i].fg >> 1) & 0x7BEF);

    if (__ui_scrollbar_prevY[i] == 0) {
      __tc_display.fillRect(tx, ty, 3, th, dimFg);
      __tc_display.fillRect(tx, thumbY, 3, thumbH, __ui_nodes[i].fg);
    } else {
      int16_t prevThumbY = __ui_scrollbar_prevY[i];
      if (thumbY != prevThumbY) {
        __tc_display.fillRect(tx, prevThumbY, 3, thumbH, dimFg);
        __tc_display.fillRect(tx, thumbY, 3, thumbH, __ui_nodes[i].fg);
      }
    }
    __ui_scrollbar_prevY[i] = thumbY;
  }
  // ③ Flush — ILI9341 is immediate, no separate flush needed.
}

#endif
`;
}
