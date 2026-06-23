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
#define UI_TEXT_BUF 32   // single source of truth: UINode field + textFn size arg + snprintf bound

enum UINodeKind { NODE_FILL, NODE_TEXT, NODE_BUTTON, NODE_CHECK, NODE_RADIO, NODE_PROGRESS, NODE_RANGE, NODE_INPUT };
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
  int16_t lastTextWidth;
  // scroll
  uint8_t scrollable;   // 1 = children are offset by scrollY and clipped to this box
  int16_t scrollY;      // current scroll offset (children Y -= scrollY)
  int16_t contentHeight; // total height of children (for scrollbar ratio)
  uint8_t parent;       // 255 = root/no parent
  uint8_t subtreeEnd;   // exclusive pre-order end index
  int16_t rangeMin;     // for <range>: minimum value
  int16_t rangeMax;     // for <range>: maximum value
  int16_t maxlen;       // for <input>: max character length (0 = UI_TEXT_BUF)
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

static Adafruit_GFX* __ui_gfx = &__tc_display;
static GFXcanvas16* __ui_scroll_canvas = nullptr;

static inline GFXcanvas16* ui_get_scroll_canvas() {
  int16_t w = __tc_display.width();
  int16_t h = __tc_display.height();
  if (w <= 0 || h <= 0) return nullptr;
  if (!__ui_scroll_canvas || __ui_scroll_canvas->width() != w || __ui_scroll_canvas->height() != h) {
    delete __ui_scroll_canvas;
    __ui_scroll_canvas = new GFXcanvas16(w, h);
  }
  if (!__ui_scroll_canvas || !__ui_scroll_canvas->getBuffer()) return nullptr;
  return __ui_scroll_canvas;
}

static inline void ui_push_canvas_rect(GFXcanvas16* canvas, int16_t x, int16_t y, int16_t w, int16_t h) {
  if (!canvas || !canvas->getBuffer()) return;
  uint16_t* pixels = canvas->getBuffer();
  int16_t stride = canvas->width();
  __tc_display.startWrite();
  __tc_display.setAddrWindow(x, y, w, h);
  for (int16_t row = 0; row < h; row++) {
    __tc_display.writePixels(pixels + (int32_t)(y + row) * stride + x, w);
  }
  __tc_display.endWrite();
}

// Per-node dirty marker (called by press handlers and binding evaluation).
static inline void ui_mark_dirty(uint8_t nodeIdx) {
  __ui_nodes[nodeIdx].dirty = 1;
}

static inline void ui_mark_scroll_subtree_dirty(uint8_t scrollNode) {
  for (uint8_t c = scrollNode + 1; c < __ui_nodes[scrollNode].subtreeEnd; c++) {
    ui_mark_dirty(c);
  }
  ui_mark_dirty(scrollNode);
}

static inline uint8_t ui_apply_scroll_delta(int8_t scrollNode, int16_t dy) {
  if (scrollNode < 0) return 0;
  int16_t maxScroll = __ui_nodes[scrollNode].contentHeight - __ui_nodes[scrollNode].box.h;
  int16_t prevScrollY = __ui_nodes[scrollNode].scrollY;
  int16_t nextScrollY = constrain(prevScrollY - dy, 0, maxScroll);
  if (nextScrollY == prevScrollY) return 0;
  __ui_nodes[scrollNode].scrollY = nextScrollY;
  ui_mark_scroll_subtree_dirty((uint8_t)scrollNode);
  return 1;
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
    if (__ui_nodes[i].kind == NODE_PROGRESS || __ui_nodes[i].kind == NODE_RANGE) {
      __ui_nodes[i].lastTextWidth = -1;
    }
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
static int8_t __ui_range_node = -1;      // range slider being dragged
static int16_t __ui_scroll_pending_dy = 0;
static uint32_t __ui_last_scroll_draw_time = 0;
// Keyboard overlay state (defined in full in the keyboard subsystem block below;
// forward-declared here because ui_touch_up/ui_handle_touch reference them).
#define UI_KB_MAX 40
#define UI_KB_HOLD_MS 600
#define UI_KB_REPEAT_MS 100
struct UIKey { char ch; uint8_t special; };  // special: 0=char,1=shift,2=bs,3=ok,4=page
static UIRect  __ui_kb_box;
static uint8_t __ui_kb_visible = 0;
static uint8_t __ui_kb_bs_held = 0;
static uint8_t __ui_kb_dirty = 0;     // 1 = keyboard needs redraw this frame
static int16_t __ui_last_touch_x = 0;
static int16_t __ui_last_touch_y = 0;
// Keyboard function forward declarations (defined in the subsystem block below;
// needed because ui_touch_down/up/handle_touch reference them, AND to suppress
// Arduino's auto-prototyper which would inject prototypes before UIRect is defined).
static inline void ui_kb_insert(char c);
static inline void ui_kb_delete();
static inline void ui_kb_open(uint8_t nodeIdx, uint8_t inputPosition);
static inline void ui_kb_close();
static inline void ui_kb_tick(uint32_t now);
static inline void ui_kb_handle_touch(int16_t tx, int16_t ty);
static inline void ui_kb_handle_tap(int16_t tx, int16_t ty);
static inline void ui_kb_key_rect(uint8_t idx, UIRect* out);
static inline void ui_kb_draw();
static inline void ui_kb_compute_box();
#define UI_TOUCH_DEBOUNCE_MS 50
#define UI_TOUCH_HOLD_MS 600
#define UI_DRAG_THRESHOLD 10
#define UI_SCROLL_FRAME_MS 33
#define UI_SCROLL_STEP_PX 2

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
      // Skip nodes without any click handler — they're containers, not targets.
      // Exceptions: NODE_RANGE (horizontal drag) and NODE_INPUT (opens keyboard)
      // are always interactive.
      if (__ui_nodes[i].kind == NODE_RANGE || __ui_nodes[i].kind == NODE_INPUT) {
        return i;
      }
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
  __ui_scroll_pending_dy = 0;
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
    // Track range nodes for horizontal drag
    if (__ui_nodes[node].kind == NODE_RANGE) {
      __ui_range_node = node;
      // Immediately set value from touch position
      int16_t rMin = __ui_nodes[node].rangeMin;
      int16_t rMax = __ui_nodes[node].rangeMax;
      int16_t range = rMax - rMin;
      if (range <= 0) range = 100;
      int16_t relX = tx - __ui_nodes[node].box.x - 4;
      int16_t usable = __ui_nodes[node].box.w - 8;
      if (usable <= 0) usable = 1;
      __ui_nodes[node].value = rMin + ((int32_t)relX * range) / usable;
      __ui_nodes[node].value = constrain(__ui_nodes[node].value, rMin, rMax);
      ui_mark_dirty(node);
    }
    // Open the on-screen keyboard when an input is tapped (and not already open).
    if (__ui_nodes[node].kind == NODE_INPUT && !__ui_kb_visible) {
      // Resolve the input's position in the loader dispatch table by scanning
      // for the Nth NODE_INPUT. (The loader table is indexed by input order.)
      uint8_t inputPos = 0;
      for (int16_t j = 0; j < node; j++) {
        if (__ui_nodes[j].kind == NODE_INPUT) inputPos++;
      }
      ui_kb_open((uint8_t)node, inputPos);
    }
    ui_mark_dirty(node);
  }
}

// Touch up: called when touch is released. Determines click vs hold.
static void ui_touch_up() {
  // Modal keyboard: route tap-up to the keyboard; swallow normal click logic.
  if (__ui_kb_visible) {
    ui_kb_handle_tap(__ui_last_touch_x, __ui_last_touch_y);
    __ui_kb_bs_held = 0;
    __ui_touch_state = 0;
    __ui_last_touch_time = millis();
    return;
  }
  uint32_t elapsed = millis() - __ui_touch_down_time;
  if (__ui_scroll_node >= 0 && __ui_scroll_pending_dy != 0) {
    if (ui_apply_scroll_delta(__ui_scroll_node, __ui_scroll_pending_dy)) {
      __ui_last_scroll_draw_time = millis();
    }
    __ui_scroll_pending_dy = 0;
  }
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
  __ui_range_node = -1;
  __ui_scroll_pending_dy = 0;
}

// Called each frame from ui_poll_touch when touch is detected.
// Implements debounce + the down/hold/up/click state machine.
static inline void ui_handle_touch(int16_t tx, int16_t ty) {
  uint32_t now = millis();
  // Track last touch coords for tap-up routing.
  __ui_last_touch_x = tx;
  __ui_last_touch_y = ty;

  // Modal keyboard: if visible, route touch to the keyboard only.
  if (__ui_kb_visible) {
    // Only process the down-edge for key actions (insert/delete-on-down).
    // Repeat is handled by ui_kb_tick; release by ui_touch_up → ui_kb_handle_tap.
    if (__ui_touch_state == 0) {
      __ui_touch_state = 1;
      __ui_touch_down_time = now;
      if (tx >= __ui_kb_box.x && tx < __ui_kb_box.x + __ui_kb_box.w &&
          ty >= __ui_kb_box.y && ty < __ui_kb_box.y + __ui_kb_box.h) {
        ui_kb_handle_touch(tx, ty);
      }
    } else {
      // Held: run auto-repeat (backspace).
      ui_kb_tick(now);
    }
    __ui_last_touch_time = now;
    return;  // swallow all other touches while modal
  }

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
    // Range slider: update value from horizontal touch position
    if (__ui_range_node >= 0) {
      int16_t rMin = __ui_nodes[__ui_range_node].rangeMin;
      int16_t rMax = __ui_nodes[__ui_range_node].rangeMax;
      int16_t range = rMax - rMin;
      if (range <= 0) range = 100;
      int16_t relX = tx - __ui_nodes[__ui_range_node].box.x - 4;
      int16_t usable = __ui_nodes[__ui_range_node].box.w - 8;
      if (usable <= 0) usable = 1;
      int16_t newVal = rMin + ((int32_t)relX * range) / usable;
      newVal = constrain(newVal, rMin, rMax);
      if (newVal != __ui_nodes[__ui_range_node].value) {
        __ui_nodes[__ui_range_node].value = newVal;
        ui_mark_dirty(__ui_range_node);
      }
    }
    if (__ui_is_dragging && __ui_scroll_node >= 0) {
      // Scroll: accumulate small touch deltas and redraw at a bounded cadence.
      // A full scroll viewport transfer is comparatively expensive on SPI TFTs;
      // coalescing jittery samples avoids visible flash from over-updating.
      int16_t dy = ty - __ui_drag_start_y;
      __ui_drag_start_y = ty;
      __ui_scroll_pending_dy += dy;
      if (abs(__ui_scroll_pending_dy) >= UI_SCROLL_STEP_PX &&
          now - __ui_last_scroll_draw_time >= UI_SCROLL_FRAME_MS) {
        ui_apply_scroll_delta(__ui_scroll_node, __ui_scroll_pending_dy);
        __ui_scroll_pending_dy = 0;
        __ui_last_scroll_draw_time = now;
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
// Forward decl: the keyboard overlay is defined below but drawn at the end.
// (ui_kb_draw and ui_kb_handle_tap forward declarations are near the touch
// state machine, above.)
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
  // Skip the node draw pass while the keyboard overlay is visible — its opaque
  // background covers everything underneath, so redrawing app nodes wastes SPI
  // bandwidth and causes flashing. Nodes redraw once when the keyboard closes
  // (ui_kb_close marks the edited input dirty; ui_kb_open had marked all dirty
  // on open so they're stale-but-covered while the keyboard is up).
  if (__ui_kb_visible) {
    // Still evaluate bindings + transitions above, but only redraw the keyboard
    // when something changed (open, key press, delete repeat, shift, page swap).
    if (__ui_kb_dirty) {
      ui_kb_draw();
      __ui_kb_dirty = 0;
    }
    return;
  }
  // First: if any scrollable container has dirty children, clear its viewport
  // with the background to prevent tearing (old content remains without this).
  int8_t bufferedScrollNode = -1;
  GFXcanvas16* bufferedScrollCanvas = nullptr;
  for (uint8_t s = 0; s < __ui_node_count; s++) {
    if (!__ui_nodes[s].scrollable || !__ui_nodes[s].visible) continue;
    if (__ui_nodes[s].contentHeight <= __ui_nodes[s].box.h) continue;
    // The scroll container is marked dirty only when the scroll offset changes
    // or during first draw. Ordinary dirty descendants can repaint in place.
    if (__ui_nodes[s].dirty) {
      for (uint8_t c = s; c < __ui_nodes[s].subtreeEnd; c++) {
        ui_mark_dirty(c);
        // Reset incremental redraw state for progress bars and range sliders so
        // they fully redraw after the viewport is cleared (otherwise only the
        // delta draws, leaving ghost artifacts). Progress/range use -1 as a
        // "never drawn" sentinel because fillW=0 is a valid value.
        if (__ui_nodes[c].kind == NODE_PROGRESS) __ui_nodes[c].lastTextWidth = -1;
        else if (__ui_nodes[c].kind == NODE_RANGE) __ui_nodes[c].lastTextWidth = -1;
      }
      if (bufferedScrollNode < 0) {
        bufferedScrollCanvas = ui_get_scroll_canvas();
        if (bufferedScrollCanvas) {
          bufferedScrollNode = (int8_t)s;
          bufferedScrollCanvas->fillRect(__ui_nodes[s].box.x, __ui_nodes[s].box.y,
            __ui_nodes[s].box.w, __ui_nodes[s].box.h,
            __ui_nodes[s].hasBg ? __ui_nodes[s].bg : __ui_nodes[s].clearColor);
          continue;
        }
      }
      // Clear the viewport with the container's background (or parent's clear color)
      __ui_gfx->fillRect(__ui_nodes[s].box.x, __ui_nodes[s].box.y, __ui_nodes[s].box.w, __ui_nodes[s].box.h,
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
    if (bufferedScrollNode >= 0 && i >= (uint8_t)bufferedScrollNode && i < __ui_nodes[bufferedScrollNode].subtreeEnd) {
      __ui_gfx = bufferedScrollCanvas;
    } else {
      __ui_gfx = &__tc_display;
    }
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
          __ui_gfx->fillRect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].bg);
        if (__ui_nodes[i].borderStyle == 1) {
          uint16_t bColor = __ui_nodes[i].borderColor ? __ui_nodes[i].borderColor : __ui_nodes[i].fg;
          __ui_gfx->drawRect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, bColor);
        }
        break;
      case NODE_TEXT:
        {
          uint16_t clearW = __ui_nodes[i].box.w;
          if (__ui_nodes[i].lastTextWidth > 0 && __ui_nodes[i].lastTextWidth > (int16_t)clearW) {
            clearW = (uint16_t)__ui_nodes[i].lastTextWidth;
          }
          __ui_gfx->fillRect(__ui_nodes[i].box.x, drawY, clearW, __ui_nodes[i].box.h,
            __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
          __ui_nodes[i].lastTextWidth = tw;
        }
        __ui_gfx->setCursor(textX, drawY);
        __ui_gfx->setTextColor(__ui_nodes[i].fg);
        __ui_gfx->setTextSize(2);
        __ui_gfx->print(displayText);
        if (__ui_nodes[i].underline)
          __ui_gfx->drawFastHLine(textX, drawY + 15, tw, __ui_nodes[i].fg);
        break;
      case NODE_BUTTON:
        if (__ui_nodes[i].hasBg)
          __ui_gfx->fillRect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].bg);
        if (__ui_nodes[i].borderStyle == 1) {
          __ui_gfx->drawRect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, bColor);
        } else if (__ui_nodes[i].borderStyle == 2) {
          for (int16_t dx = 0; dx < __ui_nodes[i].box.w; dx += 8)
            __ui_gfx->drawFastHLine(__ui_nodes[i].box.x + dx, drawY, 4, bColor);
          for (int16_t dx = 0; dx < __ui_nodes[i].box.w; dx += 8)
            __ui_gfx->drawFastHLine(__ui_nodes[i].box.x + dx, drawY + __ui_nodes[i].box.h - 1, 4, bColor);
          for (int16_t dy = 0; dy < __ui_nodes[i].box.h; dy += 8)
            __ui_gfx->drawFastVLine(__ui_nodes[i].box.x, drawY + dy, 4, bColor);
          for (int16_t dy = 0; dy < __ui_nodes[i].box.h; dy += 8)
            __ui_gfx->drawFastVLine(__ui_nodes[i].box.x + __ui_nodes[i].box.w - 1, drawY + dy, 4, bColor);
        }
        __ui_gfx->setCursor(
          __ui_nodes[i].box.x + (__ui_nodes[i].box.w - tw) / 2,
          drawY + (__ui_nodes[i].box.h - 16) / 2);
        __ui_gfx->setTextColor(__ui_nodes[i].fg);
        __ui_gfx->setTextSize(2);
        __ui_gfx->print(displayText);
        break;
      case NODE_CHECK:
        {
          uint16_t clearW = __ui_nodes[i].box.w;
          if (__ui_nodes[i].lastTextWidth > 0 && __ui_nodes[i].lastTextWidth > (int16_t)clearW) {
            clearW = (uint16_t)__ui_nodes[i].lastTextWidth;
          }
          __ui_gfx->fillRect(__ui_nodes[i].box.x, drawY, clearW, __ui_nodes[i].box.h,
            __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
          __ui_nodes[i].lastTextWidth = tw;
        }
        {
          int16_t cbX = __ui_nodes[i].box.x;
          int16_t cbY = drawY;
          if (__ui_nodes[i].value) {
            __ui_gfx->fillRect(cbX, cbY, 16, 16, __ui_nodes[i].fg);
            uint16_t inv = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
            __ui_gfx->drawLine(cbX + 3, cbY + 8, cbX + 7, cbY + 12, inv);
            __ui_gfx->drawLine(cbX + 4, cbY + 8, cbX + 8, cbY + 12, inv);
            __ui_gfx->drawLine(cbX + 3, cbY + 9, cbX + 7, cbY + 13, inv);
            __ui_gfx->drawLine(cbX + 7, cbY + 12, cbX + 13, cbY + 4, inv);
            __ui_gfx->drawLine(cbX + 8, cbY + 12, cbX + 14, cbY + 4, inv);
            __ui_gfx->drawLine(cbX + 7, cbY + 13, cbX + 13, cbY + 5, inv);
          } else {
            __ui_gfx->drawRect(cbX, cbY, 16, 16, __ui_nodes[i].fg);
          }
        }
        __ui_gfx->setCursor(__ui_nodes[i].box.x + 22, drawY);
        __ui_gfx->setTextColor(__ui_nodes[i].fg);
        __ui_gfx->setTextSize(2);
        __ui_gfx->print(displayText);
        break;
      case NODE_RADIO:
        {
          uint16_t clearW = __ui_nodes[i].box.w;
          if (__ui_nodes[i].lastTextWidth > 0 && __ui_nodes[i].lastTextWidth > (int16_t)clearW) {
            clearW = (uint16_t)__ui_nodes[i].lastTextWidth;
          }
          __ui_gfx->fillRect(__ui_nodes[i].box.x, drawY, clearW, __ui_nodes[i].box.h,
            __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
          __ui_nodes[i].lastTextWidth = tw;
          int16_t cbX = __ui_nodes[i].box.x;
          int16_t cbY = drawY;
          if (__ui_nodes[i].value) {
            __ui_gfx->fillCircle(cbX + 8, cbY + 8, 7, __ui_nodes[i].fg);
            __ui_gfx->fillCircle(cbX + 8, cbY + 8, 3, __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
          } else {
            __ui_gfx->drawCircle(cbX + 8, cbY + 8, 7, __ui_nodes[i].fg);
          }
        }
        __ui_gfx->setCursor(__ui_nodes[i].box.x + 22, drawY);
        __ui_gfx->setTextColor(__ui_nodes[i].fg);
        __ui_gfx->setTextSize(2);
        __ui_gfx->print(displayText);
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

          // On first draw (lastTextWidth < 0), draw everything.
          // Otherwise incremental: only update the changed portion.
          uint8_t pct = constrain(__ui_nodes[i].value, 0, 100);
          int16_t fillW = ((int32_t)(bw - 2) * pct) / 100;
          int16_t prevW = __ui_nodes[i].lastTextWidth; // reused as previous fill width

          if (prevW < 0) {
            // Full redraw: outline + background + fill
            __ui_gfx->drawRect(bx, by, bw, bh, fgCol);
            __ui_gfx->fillRect(bx + 1, by + 1, bw - 2, bh - 2, bgCol);
            if (fillW > 0) {
              __ui_gfx->fillRect(bx + 1, by + 1, fillW, bh - 2, fgCol);
            }
          } else if (fillW > prevW) {
            // Value increased: draw new fill segment on top (no clear needed)
            __ui_gfx->fillRect(bx + 1 + prevW, by + 1, fillW - prevW, bh - 2, fgCol);
          } else if (fillW < prevW) {
            // Value decreased: clear the removed portion
            __ui_gfx->fillRect(bx + 1 + fillW, by + 1, prevW - fillW, bh - 2, bgCol);
          }
          // Remember current fill width for next incremental update
          __ui_nodes[i].lastTextWidth = fillW;
        }
        break;
      case NODE_RANGE:
        // Range slider: horizontal track + draggable thumb.
        // Incremental redraw (like NODE_PROGRESS): lastTextWidth holds the
        // previous fill width. We erase the delta region between old and new
        // thumb positions with the background, then redraw the track portion
        // and the new thumb — so dragging backward doesn't leave ghost thumbs.
        {
          int16_t bx = __ui_nodes[i].box.x;
          int16_t by = drawY;
          int16_t bw = __ui_nodes[i].box.w;
          int16_t bh = __ui_nodes[i].box.h;
          uint16_t fgCol = __ui_nodes[i].fg;
          uint16_t bgCol = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
          uint16_t dimFg = ((fgCol >> 1) & 0x7BEF);

          int16_t trackY = by + bh / 2;
          int16_t rMin = __ui_nodes[i].rangeMin;
          int16_t rMax = __ui_nodes[i].rangeMax;
          int16_t range = rMax - rMin;
          if (range <= 0) range = 100;
          int16_t pct = constrain(__ui_nodes[i].value, rMin, rMax) - rMin;
          int16_t fillW = ((int32_t)(bw - 8) * pct) / range;
          // lastTextWidth carries the previous fill width, or -1 if this node
          // has never been drawn (fillW=0 at value=min is a valid thumb pos).
          int16_t prevFillW = __ui_nodes[i].lastTextWidth;
          int16_t newThumbX = bx + 4 + fillW - 3;

          if (prevFillW < 0) {
            // First draw: redraw the whole track + fill from scratch.
            __ui_gfx->drawFastHLine(bx, trackY, bw, dimFg);
            __ui_gfx->drawFastHLine(bx + 4, trackY, fillW, fgCol);
          } else {
            // Incremental: wipe the strip between the old and new thumb
            // positions (whichever extends further on each side), then restore
            // the track line. This is symmetric — old thumbs disappear whether
            // the drag moves forward or backward.
            int16_t prevThumbX = bx + 4 + prevFillW - 3;
            int16_t left = prevThumbX < newThumbX ? prevThumbX : newThumbX;
            int16_t right = prevThumbX + 6 > newThumbX + 6 ? prevThumbX + 6 : newThumbX + 6;
            if (left < bx) left = bx;
            if (right > bx + bw) right = bx + bw;
            // Erase the thumb band (10px tall) to background.
            __ui_gfx->fillRect(left, trackY - 5, right - left, 10, bgCol);
            // Restore the track line over the wiped strip: bright up to the
            // current fill end, dim beyond it.
            int16_t fillEnd = bx + 4 + fillW;
            if (right <= fillEnd) {
              __ui_gfx->drawFastHLine(left, trackY, right - left, fgCol);
            } else if (left >= fillEnd) {
              __ui_gfx->drawFastHLine(left, trackY, right - left, dimFg);
            } else {
              __ui_gfx->drawFastHLine(left, trackY, fillEnd - left, fgCol);
              __ui_gfx->drawFastHLine(fillEnd, trackY, right - fillEnd, dimFg);
            }
          }

          // Thumb: small filled rectangle at the current position.
          if (newThumbX < bx + 1) newThumbX = bx + 1;
          if (newThumbX > bx + bw - 7) newThumbX = bx + bw - 7;
          __ui_gfx->fillRect(newThumbX, trackY - 5, 6, 10, fgCol);

          // Remember current fill width for the next incremental update.
          __ui_nodes[i].lastTextWidth = fillW;
        }
        break;
      case NODE_INPUT:
        // Input field: bordered rect + current text (or placeholder).
        {
          int16_t bx = __ui_nodes[i].box.x;
          int16_t by = drawY;
          int16_t bw = __ui_nodes[i].box.w;
          int16_t bh = __ui_nodes[i].box.h;
          uint16_t fgCol = __ui_nodes[i].fg;
          uint16_t bgCol = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
          __tc_display.fillRect(bx, by, bw, bh, bgCol);
          __tc_display.drawRect(bx, by, bw, bh, fgCol);
          // Show textBuffer content (or the static text/placeholder).
          const char* disp = (__ui_nodes[i].textBuffer[0] != 0)
            ? __ui_nodes[i].textBuffer
            : (__ui_nodes[i].text ? __ui_nodes[i].text : "");
          __tc_display.setCursor(bx + 4, by + (bh - 16) / 2);
          __tc_display.setTextColor(fgCol, bgCol);
          __tc_display.setTextSize(2);
          __tc_display.print(disp);
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
    uint8_t scrollbarBuffered = bufferedScrollNode >= 0 && bufferedScrollCanvas && i == (uint8_t)bufferedScrollNode;
    if (scrollbarBuffered) {
      __ui_gfx = bufferedScrollCanvas;
    } else {
      __ui_gfx = &__tc_display;
    }
    int16_t tx = __ui_nodes[i].box.x + __ui_nodes[i].box.w - 4;
    int16_t ty = __ui_nodes[i].box.y;
    int16_t th = __ui_nodes[i].box.h;
    __ui_nodes[i].scrollY = constrain(__ui_nodes[i].scrollY, 0, __ui_nodes[i].contentHeight - th);
    uint16_t thumbH = (uint32_t)th * th / __ui_nodes[i].contentHeight;
    if (thumbH < 8) thumbH = 8;
    int16_t maxScroll = __ui_nodes[i].contentHeight - th;
    uint16_t thumbY = ty + (uint32_t)(th - thumbH) * __ui_nodes[i].scrollY / (maxScroll > 0 ? maxScroll : 1);
    uint16_t dimFg = ((__ui_nodes[i].fg >> 1) & 0x7BEF);

    if (scrollbarBuffered || __ui_scrollbar_prevY[i] == 0) {
      __ui_gfx->fillRect(tx, ty, 3, th, dimFg);
      __ui_gfx->fillRect(tx, thumbY, 3, thumbH, __ui_nodes[i].fg);
    } else {
      int16_t prevThumbY = __ui_scrollbar_prevY[i];
      if (thumbY != prevThumbY) {
        __ui_gfx->fillRect(tx, prevThumbY, 3, thumbH, dimFg);
        __ui_gfx->fillRect(tx, thumbY, 3, thumbH, __ui_nodes[i].fg);
      }
    }
    __ui_scrollbar_prevY[i] = thumbY;
  }
  __ui_gfx = &__tc_display;
  if (bufferedScrollNode >= 0 && bufferedScrollCanvas) {
    ui_push_canvas_rect(bufferedScrollCanvas,
      __ui_nodes[bufferedScrollNode].box.x,
      __ui_nodes[bufferedScrollNode].box.y,
      __ui_nodes[bufferedScrollNode].box.w,
      __ui_nodes[bufferedScrollNode].box.h);
  }
  // ③ Flush — ILI9341 is immediate, no separate flush needed.
  // (Keyboard overlay is drawn earlier via the early-return in ui_tick when
  // __ui_kb_visible — the node draw pass is skipped entirely while modal.)
}

// ── On-screen keyboard subsystem ───────────────────────────────────────────
// (UIKey struct, UI_KB_* defines, __ui_kb_box, __ui_kb_visible, __ui_kb_bs_held,
//  __ui_last_touch_x/y are declared earlier near the touch state machine so
//  the touch functions can reference them.)

// Populated by the per-keyboard loader function (emitted by the lowering).
static UIKey   __ui_kb_keys[UI_KB_MAX];
static uint8_t __ui_kb_keyCount;
static uint8_t __ui_kb_rows;
static uint8_t __ui_kb_cols;
static char    __ui_kb_buffer[UI_TEXT_BUF + 1];
static uint8_t __ui_kb_len;
static uint8_t __ui_kb_maxlen;
static uint8_t __ui_kb_shift;
// __ui_kb_visible, __ui_kb_bs_held, __ui_last_touch_x/y are forward-declared
// earlier (near the touch state machine) because ui_touch_up references them.
static int8_t  __ui_kb_target;       // node index of input being edited (-1 = none)
static uint32_t __ui_kb_bs_repeat;   // last auto-repeat deletion time
// __ui_kb_dirty is forward-declared earlier (near the touch state machine).
static void    (*__ui_kb_onchange)();
// Dispatch table: one loader per input node. Indexed by input position.
extern void (*__ui_kb_loaders[])();
extern const uint8_t __ui_kb_loader_count;

// Insert a character into the buffer (if space permits).
static inline void ui_kb_insert(char c) {
  if (__ui_kb_maxlen > 0 && __ui_kb_len >= __ui_kb_maxlen) return;
  if (__ui_kb_len >= UI_TEXT_BUF) return;
  __ui_kb_buffer[__ui_kb_len++] = c;
  __ui_kb_buffer[__ui_kb_len] = 0;
}

// Delete one character from the buffer.
static inline void ui_kb_delete() {
  if (__ui_kb_len == 0) return;
  __ui_kb_buffer[--__ui_kb_len] = 0;
}

// Compute the keyboard box on open from display dimensions + grid shape.
// Alpha (wide grid) docks to the bottom 75%; number (narrow grid) centers at 60%.
// Uses the display profile dimensions if available, else 320×240.
#ifndef __ui_display_w
#define __ui_display_w 320
#endif
#ifndef __ui_display_h
#define __ui_display_h 240
#endif
static inline void ui_kb_compute_box() {
  uint8_t isNumber = (__ui_kb_cols <= 4);
  uint16_t h = isNumber ? (__ui_display_h * 60 / 100) : (__ui_display_h * 75 / 100);
  __ui_kb_box.w = isNumber ? (__ui_display_w * 50 / 100) : __ui_display_w;
  __ui_kb_box.h = h;
  __ui_kb_box.x = isNumber ? (__ui_display_w - __ui_kb_box.w) / 2 : 0;
  __ui_kb_box.y = __ui_display_h - h;
}

// Open the keyboard for an input node.
static inline void ui_kb_open(uint8_t nodeIdx, uint8_t inputPosition) {
  __ui_kb_target = (int8_t)nodeIdx;
  strncpy(__ui_kb_buffer, __ui_nodes[nodeIdx].textBuffer, UI_TEXT_BUF);
  __ui_kb_buffer[UI_TEXT_BUF] = 0;
  __ui_kb_len = strlen(__ui_kb_buffer);
  uint16_t ml = __ui_nodes[nodeIdx].maxlen;
  __ui_kb_maxlen = (ml > 0 && ml <= UI_TEXT_BUF) ? (uint8_t)ml : UI_TEXT_BUF;
  __ui_kb_shift = 0;
  __ui_kb_bs_held = 0;
  // Load the key set via the dispatch table.
  if (inputPosition < __ui_kb_loader_count) __ui_kb_loaders[inputPosition]();
  __ui_kb_set_onchange();
  ui_kb_compute_box();
  __ui_kb_visible = 1;
  __ui_kb_dirty = 1;  // redraw on the first visible frame
  // Mark the whole tree dirty so the app fully redraws when the keyboard closes.
  for (uint8_t i = 0; i < __ui_node_count; i++) __ui_nodes[i].dirty = 1;
}

// Close the keyboard: commit buffer back to the input node.
static inline void ui_kb_close() {
  if (__ui_kb_target >= 0) {
    strncpy(__ui_nodes[__ui_kb_target].textBuffer, __ui_kb_buffer, UI_TEXT_BUF);
    __ui_nodes[__ui_kb_target].textBuffer[UI_TEXT_BUF] = 0;
    if (__ui_kb_onchange) __ui_kb_onchange();
  }
  __ui_kb_visible = 0;
  __ui_kb_target = -1;
  __ui_kb_bs_held = 0;
  // Mark the whole tree dirty so the app fully redraws after the keyboard
  // overlay is removed (the draw pass was skipped while the keyboard was up).
  for (uint8_t i = 0; i < __ui_node_count; i++) __ui_nodes[i].dirty = 1;
}

// Compute a key's rect from its index, given the grid + box.
static inline void ui_kb_key_rect(uint8_t idx, UIRect* out) {
  uint8_t col = idx % __ui_kb_cols;
  uint8_t row = idx / __ui_kb_cols;
  out->x = __ui_kb_box.x + (int16_t)col * __ui_kb_box.w / __ui_kb_cols;
  out->y = __ui_kb_box.y + (int16_t)row * __ui_kb_box.h / __ui_kb_rows;
  out->w = __ui_kb_box.w / __ui_kb_cols;
  out->h = __ui_kb_box.h / __ui_kb_rows;
}

// Handle a touch-down inside the keyboard box. tx,ty are display coords.
// Handle a touch-down inside the keyboard box. Only fires on the initial
// down edge (tracked by __ui_touch_state in the modal path), NOT every poll.
static inline void ui_kb_handle_touch(int16_t tx, int16_t ty) {
  for (uint8_t i = 0; i < __ui_kb_keyCount; i++) {
    UIKey k = __ui_kb_keys[i];
    if (k.special == 255) continue;  // padding cell, skip
    UIRect r;
    ui_kb_key_rect(i, &r);
    if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) {
      if (k.special == 2) {
        // backspace: delete once now, arm auto-repeat via ui_kb_tick.
        __ui_kb_bs_held = 1;
        __ui_kb_bs_repeat = millis();
        ui_kb_delete();
        __ui_kb_dirty = 1;
      }
      return;  // only one key per touch
    }
  }
}

// Called each frame while the keyboard is visible + a touch is held.
// Handles ⌫ auto-repeat.
static inline void ui_kb_tick(uint32_t now) {
  if (!__ui_kb_bs_held) return;
  if (now - __ui_kb_bs_repeat >= UI_KB_REPEAT_MS) {
    ui_kb_delete();
    __ui_kb_bs_repeat = now;
    __ui_kb_dirty = 1;
  }
}

// Handle a tap (touch-up) on a keyboard key. tx,ty are display coords.
// Fires the per-key action: char insert, shift toggle, page-swap, or OK close.
// (Backspace deletion happens on touch-down + auto-repeat; nothing here for it.)
static inline void ui_kb_handle_tap(int16_t tx, int16_t ty) {
  for (uint8_t i = 0; i < __ui_kb_keyCount; i++) {
    UIKey k = __ui_kb_keys[i];
    if (k.special == 255) continue;  // padding cell, skip
    UIRect r;
    ui_kb_key_rect(i, &r);
    if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) {
      switch (k.special) {
        case 0: {  // char
          char c = k.ch;
          if (__ui_kb_shift && c >= 'a' && c <= 'z') c -= 32;
          ui_kb_insert(c);
          __ui_kb_shift = 0;  // shift resets after one char
          __ui_kb_dirty = 1;
          break;
        }
        case 1:  // shift toggle
          __ui_kb_shift = !__ui_kb_shift;
          __ui_kb_dirty = 1;
          break;
        case 2:  // backspace: handled on down + repeat; nothing on tap-up
          break;
        case 3:  // OK
          ui_kb_close();
          break;
        case 4: {  // page-swap (123 → numeric, ABC → alpha)
          extern void __ui_kb_load_default_alpha();
          extern void __ui_kb_load_default_number();
          if (__ui_kb_cols <= 4) __ui_kb_load_default_alpha();
          else __ui_kb_load_default_number();
          ui_kb_compute_box();
          __ui_kb_dirty = 1;
          break;
        }
      }
      return;  // only one key per tap
    }
  }
}

// Draw the keyboard overlay. Called from ui_tick after the normal node pass.
static inline void ui_kb_draw() {
  // Opaque background over the keyboard box.
  __tc_display.fillRect(__ui_kb_box.x, __ui_kb_box.y, __ui_kb_box.w, __ui_kb_box.h, 0x0000);
  // Text display row (top of box): show buffer + cursor.
  __tc_display.setCursor(__ui_kb_box.x + 4, __ui_kb_box.y + 2);
  __tc_display.setTextColor(0xFFFF, 0x0000);
  __tc_display.setTextSize(2);
  __tc_display.print(__ui_kb_buffer);
  __tc_display.print("_");  // cursor

  // Keys: one rect per key, label centered-ish.
  for (uint8_t i = 0; i < __ui_kb_keyCount; i++) {
    UIKey k = __ui_kb_keys[i];
    if (k.special == 255) continue;  // padding cell, skip
    UIRect r;
    ui_kb_key_rect(i, &r);
    uint16_t bg = 0x4208;   // dark gray
    uint16_t fg = 0xFFFF;   // white
    if (k.special == 3) { bg = 0x2641; fg = 0xFFFF; }              // OK — blue accent
    if (k.special == 1 && __ui_kb_shift) { bg = 0xBDF7; }          // shift active — highlight
    __tc_display.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, bg);
    __tc_display.drawRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, fg);
    // Derive the label: special keys get fixed multi-char strings; char keys
    // use k.ch (capitalized if shift active).
    __tc_display.setCursor(r.x + 4, r.y + r.h / 2 - 4);
    __tc_display.setTextColor(fg, bg);
    __tc_display.setTextSize(1);
    switch (k.special) {
      case 1:  __tc_display.print(__ui_kb_shift ? "SHIFT*" : "shift"); break;
      case 2:  __tc_display.print("DEL"); break;
      case 3:  __tc_display.print("OK"); break;
      case 4:  __tc_display.print(__ui_kb_cols <= 4 ? "ABC" : "123"); break;
      default: {
        char label[2] = { k.ch, 0 };
        if (__ui_kb_shift && k.ch >= 'a' && k.ch <= 'z') label[0] = k.ch - 32;
        __tc_display.print(label);
        break;
      }
    }
  }
}

#endif
`;
}
