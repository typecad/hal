// Host probe 2: the demo's MAIN screen — header card + overflowing scroll
// body — to reproduce stale scroll content painted outside the viewport
// (bars in the header and at the very bottom).
#include "probe_stubs.h"

void ui_poll_touch() {}

#include "ui_runtime.h"

// 0 screen fill, 1 header card (distinct bg 0x39e7), 2-3 header texts,
// 4 scrollBody (10,113,460,197) contentHeight 1020, 5..12 buttons
// (0x2945) at 56px pitch inside the scroll column.
UINode __ui_nodes[] = {
  { .box={0,0,480,320}, .bg=0x18c3, .fg=0xe71c, .kind=NODE_FILL, .text=nullptr, .hasBg=1, .textSize=2, .lineHeight=21, .borderColor=0xe71c, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x18c3, .parent=65535, .subtreeEnd=13, .screenId=0, .drawerSide=-1, .flowAxis=1 },
  { .box={10,10,460,103}, .bg=0x39e7, .fg=0xe71c, .kind=NODE_FILL, .text=nullptr, .hasBg=1, .textSize=2, .lineHeight=21, .borderColor=0x4a49, .borderStyle=1, .borderWidth=1, .borderTopWidth=1, .borderRightWidth=1, .borderBottomWidth=1, .borderLeftWidth=1, .paddingTop=10, .paddingRight=10, .paddingBottom=10, .paddingLeft=10, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x18c3, .parent=0, .subtreeEnd=4, .screenId=0, .drawerSide=-1, .flowAxis=1 },
  { .box={173,29,133,28}, .bg=0x0000, .fg=0xe71c, .kind=NODE_TEXT, .text="shadcn kit", .hasBg=0, .textSize=3, .lineHeight=28, .fontAntialias=0, .borderColor=0xe71c, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x39e7, .parent=1, .subtreeEnd=3, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={81,75,318,19}, .bg=0x0000, .fg=0xa514, .kind=NODE_TEXT, .text="component gallery", .hasBg=0, .textSize=2, .lineHeight=19, .fontAntialias=0, .borderColor=0xa514, .outlineColor=0xa514, .visible=1, .opacity=100, .clearColor=0x39e7, .parent=1, .subtreeEnd=4, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={10,113,460,197}, .bg=0x0000, .fg=0xe71c, .kind=NODE_FILL, .text=nullptr, .hasBg=0, .textSize=2, .lineHeight=21, .borderColor=0xe71c, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x18c3, .scrollable=1, .contentHeight=1020, .parent=0, .subtreeEnd=13, .screenId=0, .drawerSide=-1, .flowAxis=1, .flowGap=8 },
  { .box={10,113,452,48}, .bg=0x2945, .fg=0xe71c, .kind=NODE_BUTTON, .text="Button", .hasBg=1, .textSize=2, .lineHeight=21, .fontAntialias=0, .borderColor=0x4a49, .borderStyle=1, .borderWidth=1, .borderTopWidth=1, .borderRightWidth=1, .borderBottomWidth=1, .borderLeftWidth=1, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x18c3, .parent=4, .subtreeEnd=6, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={10,169,452,48}, .bg=0x2945, .fg=0xe71c, .kind=NODE_BUTTON, .text="Badge", .hasBg=1, .textSize=2, .lineHeight=21, .fontAntialias=0, .borderColor=0x4a49, .borderStyle=1, .borderWidth=1, .borderTopWidth=1, .borderRightWidth=1, .borderBottomWidth=1, .borderLeftWidth=1, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x18c3, .parent=4, .subtreeEnd=7, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={10,225,452,48}, .bg=0x2945, .fg=0xe71c, .kind=NODE_BUTTON, .text="Card", .hasBg=1, .textSize=2, .lineHeight=21, .fontAntialias=0, .borderColor=0x4a49, .borderStyle=1, .borderWidth=1, .borderTopWidth=1, .borderRightWidth=1, .borderBottomWidth=1, .borderLeftWidth=1, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x18c3, .parent=4, .subtreeEnd=8, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={10,281,452,48}, .bg=0x2945, .fg=0xe71c, .kind=NODE_BUTTON, .text="Form", .hasBg=1, .textSize=2, .lineHeight=21, .fontAntialias=0, .borderColor=0x4a49, .borderStyle=1, .borderWidth=1, .borderTopWidth=1, .borderRightWidth=1, .borderBottomWidth=1, .borderLeftWidth=1, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x18c3, .parent=4, .subtreeEnd=9, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={10,337,452,48}, .bg=0x2945, .fg=0xe71c, .kind=NODE_BUTTON, .text="Alert", .hasBg=1, .textSize=2, .lineHeight=21, .fontAntialias=0, .borderColor=0x4a49, .borderStyle=1, .borderWidth=1, .borderTopWidth=1, .borderRightWidth=1, .borderBottomWidth=1, .borderLeftWidth=1, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x18c3, .parent=4, .subtreeEnd=10, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={10,393,452,48}, .bg=0x2945, .fg=0xe71c, .kind=NODE_BUTTON, .text="Progress", .hasBg=1, .textSize=2, .lineHeight=21, .fontAntialias=0, .borderColor=0x4a49, .borderStyle=1, .borderWidth=1, .borderTopWidth=1, .borderRightWidth=1, .borderBottomWidth=1, .borderLeftWidth=1, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x18c3, .parent=4, .subtreeEnd=11, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={10,449,452,48}, .bg=0x2945, .fg=0xe71c, .kind=NODE_BUTTON, .text="Table", .hasBg=1, .textSize=2, .lineHeight=21, .fontAntialias=0, .borderColor=0x4a49, .borderStyle=1, .borderWidth=1, .borderTopWidth=1, .borderRightWidth=1, .borderBottomWidth=1, .borderLeftWidth=1, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x18c3, .parent=4, .subtreeEnd=12, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={10,505,452,48}, .bg=0x2945, .fg=0xe71c, .kind=NODE_BUTTON, .text="Dialog", .hasBg=1, .textSize=2, .lineHeight=21, .fontAntialias=0, .borderColor=0x4a49, .borderStyle=1, .borderWidth=1, .borderTopWidth=1, .borderRightWidth=1, .borderBottomWidth=1, .borderLeftWidth=1, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x18c3, .parent=4, .subtreeEnd=13, .screenId=0, .drawerSide=-1, .flowAxis=0 },
};
const uint16_t __ui_node_count = 13;

void (*const __ui_click_handlers[13])() = {};
void (*const __ui_hold_handlers[1])() = { nullptr };
void (*const __ui_release_handlers[1])() = { nullptr };
void (*__ui_rangechange_handlers[1])() = { nullptr };
const uint16_t __ui_click_handler_count = 0;
const uint16_t __ui_hold_handler_count = 0;
const uint16_t __ui_release_handler_count = 0;
const uint16_t __ui_rangechange_handler_count = 0;

UITransition __ui_trans[1] = {};
UIBinding __ui_bindings[1] = {};
const UIFontFace __ui_font_faces[1] = {};
UIRichRun __ui_runs[1] = {};
UIRichSeg __ui_rich_segs[1] = {};
UIRichLine __ui_rich_lines[1] = {};
const uint16_t __ui_trans_count = 0;
const uint16_t __ui_binding_count = 0;
const uint16_t __ui_run_count = 0;
const uint16_t __ui_rich_seg_count = 0;
const uint16_t __ui_rich_line_count = 0;
const uint16_t __ui_font_face_count = 0;
const uint16_t __ui_screen_count = 1;
const UIImage __ui_images[1] = {};
const uint16_t __ui_image_count = 0;
const UIKeyframeSet __ui_keyframe_sets[1] = {};
const uint16_t __ui_keyframe_set_count = 0;
UIAnimation __ui_anims[1] = {};
const uint16_t __ui_anim_count = 0;
UIListBinding __ui_list_bindings[1] = {};
const uint16_t __ui_list_binding_count = 0;
UICanvasBinding __ui_canvas_bindings[1] = {};
const uint16_t __ui_canvas_binding_count = 0;
UIInputBinding __ui_input_bindings[1] = {};
const uint16_t __ui_input_binding_count = 0;
UIPinWatch __ui_pin_watches[1] = {};
const uint16_t __ui_pin_watch_count = 0;
UIRadioGroup __ui_radio_groups[1] = {};
const uint16_t __ui_radio_group_count = 0;
void (*__ui_kb_loaders[1])() = { nullptr };
const uint16_t __ui_kb_loader_count = 0;

static int countColor(uint16_t c, int16_t x0, int16_t y0, int16_t x1, int16_t y1) {
  CuttlefishDisplayTarget* d = probeHostDisplay();
  int n = 0;
  for (int16_t y = y0; y < y1; y++)
    for (int16_t x = x0; x < x1; x++)
      if (d->getPx(x, y) == c) n++;
  return n;
}

static void dumpScroll(const char* label) {
  printf("== %s ==\n", label);
  printf("scrollY=%d\n", __ui_nodes[4].scrollY);
  // The header card is 0x39e7; button faces are 0x2945. Buttons may never
  // appear above the viewport top (y<113) or below it (y>=310).
  printf("stale btn px rows 0..112   : %d\n", countColor(0x2945, 0, 0, 480, 113));
  printf("stale btn px rows 311..319 : %d\n", countColor(0x2945, 0, 311, 480, 320));
  printf("btn px inside viewport     : %d\n", countColor(0x2945, 10, 113, 470, 310));
  printf("header card px (0x39e7)    : %d\n", countColor(0x39e7, 10, 10, 470, 113));
  printf("header black px (0x0000)   : %d\n", countColor(0x0000, 10, 10, 470, 113));
  printf("screen bg px (0x18c3) hdr  : %d\n", countColor(0x18c3, 10, 10, 470, 113));
}

int main() {
  ui_init();
  for (int i = 0; i < 6; i++) { ui_tick(16); probeAdvanceMillis(16); }
  dumpScroll("BASELINE (scrollY 0)");

  // Drag-scroll down ~200px: press at (240,200), move up in 10px steps.
  __ui_last_touch_x = 240; __ui_last_touch_y = 200;
  ui_handle_touch(240, 200);
  probeAdvanceMillis(20);
  for (int step = 1; step <= 20; step++) {
    ui_handle_touch(240, static_cast<int16_t>(200 - step * 10));
    probeAdvanceMillis(16);
    ui_tick(16);
  }
  __ui_last_touch_x = 240; __ui_last_touch_y = 0;
  ui_handle_touch(240, 0);  // release
  probeAdvanceMillis(20);
  for (int i = 0; i < 30; i++) { ui_tick(16); probeAdvanceMillis(16); }  // settle
  dumpScroll("AFTER SCROLL DOWN");

  // Drag back up to the top.
  __ui_last_touch_x = 240; __ui_last_touch_y = 100;
  ui_handle_touch(240, 100);
  probeAdvanceMillis(20);
  for (int step = 1; step <= 20; step++) {
    ui_handle_touch(240, static_cast<int16_t>(100 + step * 10));
    probeAdvanceMillis(16);
    ui_tick(16);
  }
  __ui_last_touch_x = 240; __ui_last_touch_y = 300;
  ui_handle_touch(240, 300);
  probeAdvanceMillis(20);
  for (int i = 0; i < 30; i++) { ui_tick(16); probeAdvanceMillis(16); }
  dumpScroll("AFTER SCROLL BACK UP");
  return 0;
}
