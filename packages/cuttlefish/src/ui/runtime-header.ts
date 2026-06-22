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

enum UINodeKind { NODE_FILL, NODE_TEXT, NODE_BUTTON, NODE_CHECK };
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
  // runtime slot
  uint8_t dirty;
  int16_t value;  // unified element state: check=0/1, button=0/1, select=0..N, text=number
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

// Per-node dirty marker (called by press handlers and binding evaluation).
static inline void ui_mark_dirty(uint8_t nodeIdx) {
  __ui_nodes[nodeIdx].dirty = 1;
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
// ClickHandler typedef + extern tables (defined by the emit layer at file scope)
extern void (*__ui_click_handlers[])();
extern void (*__ui_hold_handlers[])();
extern void (*__ui_release_handlers[])();
extern const uint8_t __ui_click_handler_count;

// Touch state machine: tracks down → hold → up → click lifecycle
static uint8_t __ui_touch_state = 0;  // 0=idle, 1=down, 2=holding
static int8_t __ui_touch_node = -1;   // which node is being touched (-1=none)
static uint32_t __ui_touch_down_time = 0;  // millis() when touch started
static uint32_t __ui_last_touch_time = 0;  // for debounce
#define UI_TOUCH_DEBOUNCE_MS 50     // ignore touches within this window
#define UI_TOUCH_HOLD_MS 600        // hold threshold

// Hit-test a touch point against all visible nodes (topmost first).
// Returns the node index of the topmost node that BOTH contains the point
// AND has a click handler registered. Returns -1 if none.
static int8_t ui_hit_test(int16_t tx, int16_t ty) {
  for (int8_t i = __ui_node_count - 1; i >= 0; i--) {
    if (!__ui_nodes[i].visible) continue;
    if (tx >= __ui_nodes[i].box.x && tx < __ui_nodes[i].box.x + __ui_nodes[i].box.w &&
        ty >= __ui_nodes[i].box.y && ty < __ui_nodes[i].box.y + __ui_nodes[i].box.h) {
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
  if (node >= 0) {
    __ui_nodes[node].value = 1;  // visual pressed feedback
    ui_mark_dirty(node);
  }
}

// Touch up: called when touch is released. Determines click vs hold.
static void ui_touch_up() {
  uint32_t elapsed = millis() - __ui_touch_down_time;
  if (__ui_touch_node >= 0) {
    // Release: clear pressed state
    __ui_nodes[__ui_touch_node].value = 0;
    ui_mark_dirty(__ui_touch_node);
    // Click (short tap) or hold (long press)
    if (elapsed < UI_TOUCH_HOLD_MS) {
      ui_dispatch(__ui_click_handlers, __ui_click_handler_count, __ui_touch_node);
    }
    ui_dispatch(__ui_release_handlers, __ui_click_handler_count, __ui_touch_node);
  }
  __ui_touch_state = 0;
  __ui_touch_node = -1;
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
    // Already touching: check for hold transition
    if (__ui_touch_state == 1 && __ui_touch_node >= 0) {
      if (now - __ui_touch_down_time >= UI_TOUCH_HOLD_MS) {
        __ui_touch_state = 2;  // holding
        ui_dispatch(__ui_hold_handlers, __ui_click_handler_count, __ui_touch_node);
      }
    }
    // Update touch position (for drag support in the future)
  }
  __ui_last_touch_time = now;
}

// Called each frame when no touch is detected.
static inline void ui_handle_no_touch() {
  if (__ui_touch_state != 0) {
    // Require a minimum gap since last touch activity before registering release.
    // Prevents crash from rapid touch/no-touch flicker on resistive screens.
    if (millis() - __ui_last_touch_time < UI_TOUCH_DEBOUNCE_MS) return;
    ui_touch_up();
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
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    if (!__ui_nodes[i].dirty) continue;
    if (!__ui_nodes[i].visible) continue;  // visibility: hidden → skip entirely
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
        // Fill background if set; transparent containers let the parent show through.
        if (__ui_nodes[i].hasBg)
          __tc_display.fillRect(__ui_nodes[i].box.x, __ui_nodes[i].box.y, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].bg);
        // Draw border if set (views can have borders without backgrounds).
        if (__ui_nodes[i].borderStyle == 1) {
          uint16_t bColor = __ui_nodes[i].borderColor ? __ui_nodes[i].borderColor : __ui_nodes[i].fg;
          __tc_display.drawRect(__ui_nodes[i].box.x, __ui_nodes[i].box.y, __ui_nodes[i].box.w, __ui_nodes[i].box.h, bColor);
        }
        break;
      case NODE_TEXT:
        // Clear the text area before drawing to prevent ghosting.
        // Wipe max(box.w, lastTextWidth) to cover the previous render even
        // if the new text is shorter (e.g. "10" → "9").
        {
          uint16_t clearW = __ui_nodes[i].box.w;
          if (__ui_nodes[i].lastTextWidth > clearW) clearW = __ui_nodes[i].lastTextWidth;
          __tc_display.fillRect(__ui_nodes[i].box.x, __ui_nodes[i].box.y, clearW, __ui_nodes[i].box.h,
            __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
          __ui_nodes[i].lastTextWidth = tw;
        }
        __tc_display.setCursor(textX, __ui_nodes[i].box.y);
        __tc_display.setTextColor(__ui_nodes[i].fg);
        __tc_display.setTextSize(2);
        __tc_display.print(displayText);
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
        __tc_display.print(displayText);
        break;
      case NODE_CHECK:
        // Checkbox: a 16×16 square + label text to the right.
        // Clear the area first (prevents ghosting).
        {
          uint16_t clearW = __ui_nodes[i].box.w;
          if (__ui_nodes[i].lastTextWidth > clearW) clearW = __ui_nodes[i].lastTextWidth;
          __tc_display.fillRect(__ui_nodes[i].box.x, __ui_nodes[i].box.y, clearW, __ui_nodes[i].box.h,
            __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
          __ui_nodes[i].lastTextWidth = tw;
        }
        // Draw the checkbox square (16×16 at the left edge of the box).
        {
          int16_t cbX = __ui_nodes[i].box.x;
          int16_t cbY = __ui_nodes[i].box.y;
          if (__ui_nodes[i].value) {
            // Checked: filled square + checkmark (3px thick for visibility)
            __tc_display.fillRect(cbX, cbY, 16, 16, __ui_nodes[i].fg);
            uint16_t inv = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
            // Left stroke of the V: 3 parallel lines
            __tc_display.drawLine(cbX + 3, cbY + 8, cbX + 7, cbY + 12, inv);
            __tc_display.drawLine(cbX + 4, cbY + 8, cbX + 8, cbY + 12, inv);
            __tc_display.drawLine(cbX + 3, cbY + 9, cbX + 7, cbY + 13, inv);
            // Right stroke of the V: 3 parallel lines
            __tc_display.drawLine(cbX + 7, cbY + 12, cbX + 13, cbY + 4, inv);
            __tc_display.drawLine(cbX + 8, cbY + 12, cbX + 14, cbY + 4, inv);
            __tc_display.drawLine(cbX + 7, cbY + 13, cbX + 13, cbY + 5, inv);
          } else {
            // Unchecked: outline square
            __tc_display.drawRect(cbX, cbY, 16, 16, __ui_nodes[i].fg);
          }
        }
        // Label text to the right of the checkbox.
        __tc_display.setCursor(__ui_nodes[i].box.x + 22, __ui_nodes[i].box.y);
        __tc_display.setTextColor(__ui_nodes[i].fg);
        __tc_display.setTextSize(2);
        __tc_display.print(displayText);
        break;
    }
    __ui_nodes[i].dirty = 0;
  }
  // ③ Flush — ILI9341 is immediate, no separate flush needed.
}

#endif
`;
}
