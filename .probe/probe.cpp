// Host probe: drives the cuttlefish runtime header against a minimal
// replica of demo-shadcn's dialog screen to reproduce the "dialog paints
// only its title" hardware bug without hardware.
#include "probe_stubs.h"

void ui_poll_touch() {}

#include "ui_runtime.h"

// ── Node table: dialog screen replica ─────────────────────────────────────
// 0 screen fill, 1 scrollBody (not overflowing), 2 label, 3 open button,
// 4 dialog root (h=0, side 4), 5 scrim (z30), 6 card (z31), 7 title,
// 8 description, 9 btnRow, 10 cancel, 11 confirm.
static void probeOpenDialog() { ui_drawer_open(4); }
static void probeCloseDialog() { ui_drawer_close(4); }
static void probeOpenDrawer() { ui_drawer_open(13); }
static void probeCloseDrawer() { ui_drawer_close(13); }
static uint32_t probeDrawerTaps = 0;
// Mirrors ui.bind(echo, 'text', () => `taps inside: ${drawerTaps()}`):
// write the buffer, then mark the node dirty.
static void probeDrawerTap() {
  probeDrawerTaps++;
  char buf[32];
  snprintf(buf, sizeof(buf), "taps inside: %lu", static_cast<unsigned long>(probeDrawerTaps));
  strncpy(__ui_nodes[12].textBuffer, buf, UI_TEXT_BUF);
  __ui_nodes[12].textBuffer[UI_TEXT_BUF] = '\0';
  __ui_nodes[12].hasTextBinding = 1;
  ui_mark_dirty(12);
}

// Nodes 12-18: the demo's drawer screen — echo text, "Open drawer" button,
// drawer root (16,136,448,168 z10 side 0), title, description, btnRow,
// "Tap me" and "Close" buttons. Same scrollBody (node 1) as the dialog.
UINode __ui_nodes[] = {
  { .box={0,0,480,320}, .bg=0x18c3, .fg=0xe71c, .kind=NODE_FILL, .text=nullptr, .hasBg=1, .textSize=2, .lineHeight=21, .borderColor=0xe71c, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x18c3, .parent=65535, .subtreeEnd=20, .screenId=0, .drawerSide=-1, .flowAxis=1 },
  { .box={10,70,460,240}, .bg=0x0000, .fg=0xe71c, .kind=NODE_FILL, .text=nullptr, .hasBg=0, .textSize=2, .lineHeight=21, .borderColor=0xe71c, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x18c3, .scrollable=1, .contentHeight=240, .parent=0, .subtreeEnd=20, .screenId=0, .drawerSide=-1, .flowAxis=1, .flowGap=10 },
  { .box={10,70,200,24}, .bg=0x0000, .fg=0xe71c, .kind=NODE_TEXT, .text="Dialog", .hasBg=0, .textSize=2, .lineHeight=21, .fontAntialias=0, .borderColor=0xe71c, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x18c3, .parent=1, .subtreeEnd=3, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={10,104,452,48}, .bg=0x2945, .fg=0xe71c, .kind=NODE_BUTTON, .text="Open dialog", .hasBg=1, .textSize=2, .lineHeight=21, .fontAntialias=0, .borderColor=0x4a49, .borderStyle=1, .borderWidth=1, .borderTopWidth=1, .borderRightWidth=1, .borderBottomWidth=1, .borderLeftWidth=1, .paddingTop=10, .paddingRight=12, .paddingBottom=10, .paddingLeft=12, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x18c3, .parent=1, .subtreeEnd=4, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={10,276,452,0}, .bg=0x0000, .fg=0xe71c, .kind=NODE_FILL, .text=nullptr, .hasBg=0, .textSize=2, .lineHeight=21, .borderColor=0xe71c, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x18c3, .parent=1, .subtreeEnd=12, .screenId=0, .drawerSide=4, .flowAxis=1 },
  { .box={10,70,460,240}, .bg=0x1082, .fg=0xe71c, .kind=NODE_FILL, .text=nullptr, .hasBg=1, .textSize=2, .lineHeight=21, .borderColor=0xe71c, .outlineColor=0xe71c, .zIndex=30, .visible=1, .opacity=100, .clearColor=0x18c3, .parent=4, .subtreeEnd=6, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={34,134,412,143}, .bg=0x2945, .fg=0xe71c, .kind=NODE_FILL, .text=nullptr, .hasBg=1, .textSize=2, .lineHeight=21, .borderColor=0x4a49, .borderStyle=1, .borderWidth=1, .borderTopWidth=1, .borderRightWidth=1, .borderBottomWidth=1, .borderLeftWidth=1, .borderRadius=8, .paddingTop=24, .paddingRight=24, .paddingBottom=24, .paddingLeft=24, .outlineColor=0xe71c, .zIndex=31, .visible=1, .opacity=100, .clearColor=0x18c3, .parent=4, .subtreeEnd=12, .screenId=0, .drawerSide=-1, .flowAxis=1, .flowGap=8 },
  { .box={58,158,364,28}, .bg=0x0000, .fg=0xe71c, .kind=NODE_TEXT, .text="Are you sure?", .hasBg=0, .textSize=3, .lineHeight=28, .fontAntialias=0, .borderColor=0xe71c, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x2945, .parent=6, .subtreeEnd=8, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={58,190,364,38}, .bg=0x0000, .fg=0xa514, .kind=NODE_TEXT, .text="This action cannot be undone", .hasBg=0, .textSize=2, .lineHeight=19, .fontAntialias=0, .borderColor=0xa514, .outlineColor=0xa514, .visible=1, .opacity=100, .clearColor=0x2945, .parent=6, .subtreeEnd=9, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={58,225,364,40}, .bg=0x0000, .fg=0xe71c, .kind=NODE_FILL, .text=nullptr, .hasBg=0, .textSize=2, .lineHeight=21, .borderColor=0xe71c, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x2945, .parent=6, .subtreeEnd=12, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={166,225,120,40}, .bg=0x2945, .fg=0xe71c, .kind=NODE_BUTTON, .text="Cancel", .hasBg=1, .textSize=2, .lineHeight=21, .fontAntialias=0, .borderColor=0x4a49, .borderStyle=1, .borderWidth=1, .borderTopWidth=1, .borderRightWidth=1, .borderBottomWidth=1, .borderLeftWidth=1, .borderRadius=8, .paddingTop=8, .paddingRight=12, .paddingBottom=8, .paddingLeft=12, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x2945, .parent=9, .subtreeEnd=11, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={302,225,120,40}, .bg=0xe1c6, .fg=0x0000, .kind=NODE_BUTTON, .text="Confirm", .hasBg=1, .textSize=2, .lineHeight=21, .fontAntialias=0, .borderColor=0xe1c6, .borderStyle=1, .borderWidth=1, .borderTopWidth=1, .borderRightWidth=1, .borderBottomWidth=1, .borderLeftWidth=1, .borderRadius=8, .paddingTop=8, .paddingRight=12, .paddingBottom=8, .paddingLeft=12, .outlineColor=0xe1c6, .visible=1, .opacity=100, .clearColor=0x2945, .parent=9, .subtreeEnd=12, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={10,164,452,19}, .bg=0x0000, .fg=0xa514, .kind=NODE_TEXT, .text="taps inside: 0", .hasBg=0, .textSize=2, .lineHeight=19, .fontAntialias=0, .borderColor=0xa514, .outlineColor=0xa514, .visible=1, .opacity=100, .clearColor=0x18c3, .parent=1, .subtreeEnd=13, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={16,136,448,168}, .bg=0x39e7, .fg=0xe71c, .kind=NODE_FILL, .text=nullptr, .hasBg=1, .textSize=2, .lineHeight=21, .borderColor=0x4a49, .borderStyle=1, .borderWidth=1, .borderTopWidth=1, .borderRightWidth=1, .borderBottomWidth=1, .borderLeftWidth=1, .borderRadius=8, .paddingTop=12, .paddingRight=12, .paddingBottom=12, .paddingLeft=12, .outlineColor=0xe71c, .zIndex=10, .visible=1, .opacity=100, .clearColor=0x39e7, .parent=1, .subtreeEnd=19, .screenId=0, .drawerSide=0, .flowAxis=1, .flowGap=10 },
  { .box={28,148,424,28}, .bg=0x0000, .fg=0xe71c, .kind=NODE_TEXT, .text="Drawer title", .hasBg=0, .textSize=3, .lineHeight=28, .fontAntialias=0, .borderColor=0xe71c, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x39e7, .parent=13, .subtreeEnd=15, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={28,182,424,56}, .bg=0x0000, .fg=0xa514, .kind=NODE_TEXT, .text="Content slides in from the bottom edge", .hasBg=0, .textSize=2, .lineHeight=19, .fontAntialias=0, .borderColor=0xa514, .outlineColor=0xa514, .visible=1, .opacity=100, .clearColor=0x39e7, .parent=13, .subtreeEnd=16, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={28,248,424,44}, .bg=0x0000, .fg=0xe71c, .kind=NODE_FILL, .text=nullptr, .hasBg=0, .textSize=2, .lineHeight=21, .borderColor=0xe71c, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x39e7, .parent=13, .subtreeEnd=19, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={160,250,120,40}, .bg=0x2945, .fg=0xe71c, .kind=NODE_BUTTON, .text="Tap me", .hasBg=1, .textSize=2, .lineHeight=21, .fontAntialias=0, .borderColor=0x4a49, .borderStyle=1, .borderWidth=1, .borderTopWidth=1, .borderRightWidth=1, .borderBottomWidth=1, .borderLeftWidth=1, .borderRadius=8, .paddingTop=8, .paddingRight=12, .paddingBottom=8, .paddingLeft=12, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x39e7, .parent=16, .subtreeEnd=18, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={300,250,120,40}, .bg=0x4a49, .fg=0xe71c, .kind=NODE_BUTTON, .text="Close", .hasBg=1, .textSize=2, .lineHeight=21, .fontAntialias=0, .borderColor=0x4a49, .borderStyle=1, .borderWidth=1, .borderTopWidth=1, .borderRightWidth=1, .borderBottomWidth=1, .borderLeftWidth=1, .borderRadius=8, .paddingTop=8, .paddingRight=12, .paddingBottom=8, .paddingLeft=12, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x39e7, .parent=16, .subtreeEnd=19, .screenId=0, .drawerSide=-1, .flowAxis=0 },
  { .box={10,196,452,48}, .bg=0x2945, .fg=0xe71c, .kind=NODE_BUTTON, .text="Open drawer", .hasBg=1, .textSize=2, .lineHeight=21, .fontAntialias=0, .borderColor=0x4a49, .borderStyle=1, .borderWidth=1, .borderTopWidth=1, .borderRightWidth=1, .borderBottomWidth=1, .borderLeftWidth=1, .paddingTop=10, .paddingRight=12, .paddingBottom=10, .paddingLeft=12, .outlineColor=0xe71c, .visible=1, .opacity=100, .clearColor=0x18c3, .parent=1, .subtreeEnd=20, .screenId=0, .drawerSide=-1, .flowAxis=0 },
};
const uint16_t __ui_node_count = 20;

void (*const __ui_click_handlers[20])() = {
  nullptr, nullptr, nullptr, probeOpenDialog, nullptr, nullptr,
  nullptr, nullptr, nullptr, nullptr, nullptr, probeCloseDialog,
  nullptr,                        // 12 echo text
  nullptr,                        // 13 drawer root
  nullptr, nullptr, nullptr,      // 14 title, 15 desc, 16 btnRow
  probeDrawerTap,                 // 17 Tap me
  probeCloseDrawer,               // 18 Close
  probeOpenDrawer,                // 19 Open drawer
};
void (*const __ui_hold_handlers[1])() = { nullptr };
void (*const __ui_release_handlers[1])() = { nullptr };
void (*__ui_rangechange_handlers[1])() = { nullptr };
const uint16_t __ui_click_handler_count = 20;
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

// ── Dump helpers ───────────────────────────────────────────────────────────
static int countColor(uint16_t c, int16_t x0, int16_t y0, int16_t x1, int16_t y1) {
  CuttlefishDisplayTarget* d = probeHostDisplay();
  int n = 0;
  for (int16_t y = y0; y < y1; y++)
    for (int16_t x = x0; x < x1; x++)
      if (d->getPx(x, y) == c) n++;
  return n;
}

static void dumpDrawer(const char* label) {
  printf("== %s ==\n", label);
  printf("panel px (0x39e7) in drawer box : %d\n", countColor(0x39e7, 16, 136, 464, 304));
  printf("title fg px in title box        : %d\n", countColor(0xe71c, 28, 148, 452, 176));
  printf("desc fg px in desc box          : %d\n", countColor(0xa514, 28, 182, 452, 238));
  printf("tapme bg px (0x2945) in btn box : %d\n", countColor(0x2945, 160, 250, 280, 290));
  printf("close bg px (0x4a49) in btn box : %d\n", countColor(0x4a49, 300, 250, 420, 290));
  printf("peek px (0x39e7) rows 300..319  : %d\n", countColor(0x39e7, 0, 300, 480, 320));
}
static void dumpState(const char* label) {
  printf("== %s ==\n", label);
  printf("scrim px (0x1082) whole screen : %d\n", countColor(0x1082, 0, 0, 480, 320));
  printf("card  px (0x2945) in card box  : %d\n", countColor(0x2945, 34, 134, 446, 277));
  printf("title non-card px in title box : %d\n",
    (346 - 134 > 0) ? ([&] {
      CuttlefishDisplayTarget* d = probeHostDisplay();
      int n = 0;
      for (int16_t y = 158; y < 186; y++)
        for (int16_t x = 58; x < 422; x++)
          if (d->getPx(x, y) != 0x2945 && d->getPx(x, y) != 0x1082) n++;
      return n;
    })() : 0);
  printf("desc   non-card px in desc box : %d\n", [&] {
    CuttlefishDisplayTarget* d = probeHostDisplay();
    int n = 0;
    for (int16_t y = 190; y < 228; y++)
      for (int16_t x = 58; x < 422; x++)
        if (d->getPx(x, y) != 0x2945 && d->getPx(x, y) != 0x1082) n++;
    return n;
  }());
  printf("confirm px (0xe1c6) in btn box : %d\n", countColor(0xe1c6, 302, 225, 422, 265));
  {
    CuttlefishDisplayTarget* d = probeHostDisplay();
    uint32_t card = 0, scrim = 0, fg = 0, screenbg = 0, other = 0, cancelBg = 0;
    for (int16_t y = 150; y < 270; y++) {
      for (int16_t x = 50; x < 440; x++) {
        uint16_t p = d->getPx(x, y);
        if (p == 0x2945) card++;
        else if (p == 0x1082) scrim++;
        else if (p == 0xe71c || p == 0xa514) fg++;
        else if (p == 0x18c3) screenbg++;
        else if (p == 0xe1c6) cancelBg++;
        else other++;
      }
    }
    printf("hist y150-270: card=%u scrim=%u textfg=%u screenbg=%u primaryBtn=%u other=%u\n",
      card, scrim, fg, screenbg, cancelBg, other);
  }
  {
    CuttlefishDisplayTarget* d = probeHostDisplay();
    printf("row y=160 x=58..108:");
    for (int16_t x = 58; x < 108; x++) printf(" %04x", d->getPx(x, 160));
    printf("\n");
    printf("row y=240 x=300..340:");
    for (int16_t x = 300; x < 340; x++) printf(" %04x", d->getPx(x, 240));
    printf("\n");
  }
  printf("sample (240,100)=%04x (240,200)=%04x (360,245)=%04x\n",
    probeHostDisplay()->getPx(240, 100),
    probeHostDisplay()->getPx(240, 200),
    probeHostDisplay()->getPx(360, 245));
}

static void dumpDrawerSlots(const char* when) {
  printf("[drawer %s] slots=%u", when, __ui_drawer_slots);
  for (uint8_t s = 0; s < __ui_drawer_slots; s++) {
    printf(" | slot%u idx=%d open=%u prog=%u", s, __ui_drawer_idx[s], __ui_drawer_open[s], __ui_drawer_progress[s]);
  }
  printf("\n");
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    printf("  node%u kind=%d parent=%u box={%d,%d,%d,%d} z=%d side=%d dirty=%u vis=%u off=(%d,%d)\n",
      i, static_cast<int>(__ui_nodes[i].kind), __ui_nodes[i].parent,
      __ui_nodes[i].box.x, __ui_nodes[i].box.y, __ui_nodes[i].box.w, __ui_nodes[i].box.h,
      __ui_nodes[i].zIndex, __ui_nodes[i].drawerSide, __ui_nodes[i].dirty,
      ui_is_effectively_visible(i), __ui_nodes[i].transformOffsetX, __ui_nodes[i].transformOffsetY);
  }
}

int main() {
  extern uint32_t probeFillCalls, probePrintCalls, probeWritePixelsCalls, probeSetAddrWindowCalls;
  ui_init();
  dumpDrawer("after init");
  printf("hitTest(240,128) = %d (want 3)\n", ui_hit_test(240, 128));
  printf("[init] fill=%u print=%u wp=%u aw=%u\n", probeFillCalls, probePrintCalls, probeWritePixelsCalls, probeSetAddrWindowCalls);
  for (int i = 0; i < 6; i++) { ui_tick(16); probeAdvanceMillis(16); }
  printf("[6 ticks] fill=%u print=%u wp=%u aw=%u\n", probeFillCalls, probePrintCalls, probeWritePixelsCalls, probeSetAddrWindowCalls);
  dumpState("BASELINE (dialog closed)");

  // Tap the "Open dialog" button (node 3, box 10,104,452,48).
  __ui_last_touch_x = 240; __ui_last_touch_y = 128; ui_touch_down(240, 128);
  ui_touch_up();
  probeAdvanceMillis(20);
  ui_tick(16);
  printf("[px] after open tick: (61,158)=%04x (61,160)=%04x\n", probeHostDisplay()->getPx(61, 158), probeHostDisplay()->getPx(61, 160));
  dumpDrawerSlots("after open tick");
  dumpState("AFTER OPEN TICK 1");
  for (int i = 0; i < 6; i++) {
    ui_tick(16); probeAdvanceMillis(16);
    printf("[px] settle tick %d: (61,158)=%04x\n", i, probeHostDisplay()->getPx(61, 158));
  }
  printf("[open settle] fill=%u print=%u wp=%u aw=%u\n", probeFillCalls, probePrintCalls, probeWritePixelsCalls, probeSetAddrWindowCalls);
  dumpState("AFTER OPEN SETTLE");

  // Tap the (invisible?) Confirm button (node 11, box 302,225,120,40).
  __ui_last_touch_x = 360; __ui_last_touch_y = 245; ui_touch_down(360, 245);
  ui_touch_up();
  probeAdvanceMillis(20);
  ui_tick(16);
  dumpState("AFTER CONFIRM TAP");
  for (int i = 0; i < 6; i++) { ui_tick(16); probeAdvanceMillis(16); }
  printf("[close settle] fill=%u print=%u wp=%u aw=%u\n", probeFillCalls, probePrintCalls, probeWritePixelsCalls, probeSetAddrWindowCalls);
  dumpState("AFTER CLOSE SETTLE");

  // ── Drawer scenario (mirrors demo-shadcn's drawer screen) ──────────────
  // "Open drawer" button = node 19 (10,196,452,48).
  __ui_last_touch_x = 240; __ui_last_touch_y = 220; ui_touch_down(240, 220);
  ui_touch_up();
  probeAdvanceMillis(20);
  for (int i = 0; i < 14; i++) { ui_tick(16); probeAdvanceMillis(16); }
  dumpDrawer("DRAWER OPEN (settled)");

  printf("[dbg] hitTest(240,220)=%d (want 19)\n", ui_hit_test(240, 220));
  dumpDrawerSlots("after open drawer ticks");
  // "Tap me" = node 17 (160,250,120,40) — increments the echo binding.
  __ui_last_touch_x = 220; __ui_last_touch_y = 270; ui_touch_down(220, 270);
  {
    UIRect pr;
    uint8_t ok = ui_subtree_current_paint_rect(13, &pr);
    printf("[dbg] pre-touchup subtree rect ok=%u rect=(%d,%d,%d,%d) drawY13=%d\n",
      ok, pr.x, pr.y, pr.w, pr.h, ui_draw_y_for_node(13));
  }
  ui_touch_up();
  printf("[dbg] dirty right after touch_up:");
  for (uint16_t q = 0; q < __ui_node_count; q++) if (__ui_nodes[q].dirty) printf(" %u", q);
  printf("\n");
  probeAdvanceMillis(20);
  ui_tick(16);
  printf("[dbg] dirty after tick 1:");
  for (uint16_t q = 0; q < __ui_node_count; q++) if (__ui_nodes[q].dirty) printf(" %u", q);
  printf("\n");
  dumpDrawer("AFTER TAP ME (tick 1)");
  for (int i = 0; i < 6; i++) { ui_tick(16); probeAdvanceMillis(16); }
  dumpDrawerSlots("after tap me settled");
  dumpDrawer("AFTER TAP ME (settled)");

  // "Close" = node 18 (300,250,120,40).
  __ui_last_touch_x = 360; __ui_last_touch_y = 270; ui_touch_down(360, 270);
  ui_touch_up();
  probeAdvanceMillis(20);
  for (int i = 0; i < 14; i++) { ui_tick(16); probeAdvanceMillis(16); }
  dumpDrawer("AFTER CLOSE (peek check: rows 300..319)");
  return 0;
}
