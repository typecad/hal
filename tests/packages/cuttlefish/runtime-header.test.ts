import { describe, it, expect } from "vitest";
import { emitRuntimeHeader } from "@typecad/cuttlefish/ui/runtime-header";

describe("C++ reactive runtime header", () => {
  const header = emitRuntimeHeader();

  it("declares the UINode, UITransition, and UIBinding structs", () => {
    expect(header).toMatch(/struct\s+UINode/);
    expect(header).toMatch(/struct\s+UITransition/);
    expect(header).toMatch(/struct\s+UIBinding/);
  });

  it("declares ui_mark_dirty for marking nodes dirty", () => {
    expect(header).toContain("ui_mark_dirty");
  });

  it("declares the per-frame ui_tick driver", () => {
    expect(header).toContain("ui_tick");
  });

  it("contains a color lerp helper for transitions", () => {
    expect(header).toContain("lerp_color");
  });

  it("contains press/release entry points", () => {
    expect(header).toContain("ui_on_press");
    expect(header).toContain("ui_on_release");
  });

  it("declares the draw dispatch (NODE_FILL / NODE_TEXT)", () => {
    expect(header).toContain("NODE_FILL");
    expect(header).toContain("NODE_TEXT");
  });

  it("is wrapped in an include guard", () => {
    expect(header).toMatch(/#ifndef\s+__TC_UI_RUNTIME/);
    expect(header).toMatch(/#define\s+__TC_UI_RUNTIME/);
    expect(header).toContain("#endif");
  });

  it("defines UI_TEXT_BUF as 32", () => {
    expect(header).toMatch(/#define\s+UI_TEXT_BUF\s+32/);
  });

  it("UINode has a mutable textBuffer and hasTextBinding field", () => {
    expect(header).toMatch(/char\s+textBuffer\[UI_TEXT_BUF\]/);
    expect(header).toMatch(/uint8_t\s+hasTextBinding/);
  });

  it("UIBinding textFn signature is void fill-style (char*, uint8_t)", () => {
    expect(header).toMatch(/void\s+\(\*textFn\)\(char\*\s*buf,\s*uint8_t\s*size\)/);
  });

  it("ui_init seeds textBuffer from the flash literal for PROP_TEXT bindings", () => {
    // ui_init must: set hasTextBinding=1, strncpy text→textBuffer, NUL-terminate.
    expect(header).toMatch(/ui_init[\s\S]*hasTextBinding\s*=\s*1/);
    expect(header).toMatch(/ui_init[\s\S]*strncpy\(\s*__ui_nodes\[n\]\.textBuffer,\s*__ui_nodes\[n\]\.text,\s*UI_TEXT_BUF\s*-\s*1\s*\)/);
    expect(header).toMatch(/ui_init[\s\S]*textBuffer\[UI_TEXT_BUF\s*-\s*1\]\s*=\s*'\\0'/);
  });

  it("ui_tick text-binding dispatch compares by content (strcmp), not pointer", () => {
    // Must: save oldBuf, call textFn(buf,size), strcmp to decide dirty.
    expect(header).toMatch(/char\s+oldBuf\[UI_TEXT_BUF\]/);
    expect(header).toMatch(/strcpy\(\s*oldBuf,\s*__ui_nodes\[.*?\]\.textBuffer\s*\)/);
    expect(header).toMatch(/textFn\(\s*__ui_nodes\[.*?\]\.textBuffer,\s*UI_TEXT_BUF\s*\)/);
    expect(header).toMatch(/strcmp\(\s*oldBuf,\s*__ui_nodes\[.*?\]\.textBuffer\s*\)\s*!=\s*0/);
  });

  it("draw dispatch selects displayText by hasTextBinding (textBuffer vs text)", () => {
    // The dirty-node loop must declare a displayText local and read from it.
    expect(header).toMatch(/const char\*\s+displayText\s*=\s*__ui_nodes\[i\]\.hasTextBinding\s*\?\s*__ui_nodes\[i\]\.textBuffer\s*:\s*__ui_nodes\[i\]\.text/);
    // And the text draw must use displayText, not __ui_nodes[i].text.
    expect(header).toMatch(/ui_draw_text\(\s*displayText/);
  });

  it("uses tree metadata for scroll ownership", () => {
    expect(header).toMatch(/uint8_t\s+parent/);
    expect(header).toMatch(/uint8_t\s+subtreeEnd/);
    expect(header).toContain("ui_draw_y_for_node");
    expect(header).toMatch(/c\s*=\s*scrollNode\s*\+\s*1;\s*c\s*<\s*__ui_nodes\[scrollNode\]\.subtreeEnd/);
    expect(header).toMatch(/ui_mark_scroll_subtree_dirty\(\(uint8_t\)scrollNode\)/);
  });

  it("only clears a scroll viewport when the scroll container itself is dirty", () => {
    expect(header).not.toContain("hasDirtyChild");
    expect(header).toMatch(/if\s*\(__ui_nodes\[s\]\.dirty\)\s*\{\s*for\s*\(uint8_t\s+c\s*=\s*s;\s*c\s*<\s*__ui_nodes\[s\]\.subtreeEnd;\s*c\+\+\)\s*\{\s*ui_mark_dirty\(c\);/);
  });

  it("draws scrollbars only when their container was dirty", () => {
    expect(header).toMatch(/uint8_t\s+scrollbarDirty\[256\]\s*=\s*\{0\}/);
    expect(header).toMatch(/if\s*\(!scrollbarDirty\[i\]\)\s*continue/);
  });

  it("does not dirty a scroll subtree when drag motion does not change scrollY", () => {
    expect(header).toContain("ui_apply_scroll_delta");
    expect(header).toMatch(/if\s*\(nextScrollY\s*==\s*prevScrollY\)\s*return\s+0/);
  });

  it("buffers scroll viewport redraws before pushing them to hardware", () => {
    expect(header).toContain("GFXcanvas16* __ui_scroll_canvas");
    expect(header).toContain("ui_get_scroll_canvas");
    expect(header).toContain("ui_push_canvas_rect");
    expect(header).toMatch(/bufferedScrollCanvas->fillRect/);
    expect(header).toMatch(/__ui_gfx\s*=\s*bufferedScrollCanvas/);
    expect(header).toMatch(/ui_push_canvas_rect\(bufferedScrollCanvas,[\s\S]*__ui_nodes\[bufferedScrollNode\]\.box\.x/);
    expect(header).toMatch(/uint8_t\s+scrollbarBuffered/);
    expect(header).toMatch(/scrollbarBuffered\s*\|\|\s*__ui_scrollbar_prevY\[i\]\s*==\s*0/);
  });

  it("coalesces scroll drag redraws to reduce SPI viewport pushes", () => {
    expect(header).toMatch(/#define\s+UI_SCROLL_FRAME_MS\s+33/);
    expect(header).toMatch(/#define\s+UI_SCROLL_STEP_PX\s+2/);
    expect(header).toContain("__ui_scroll_pending_dy");
    expect(header).toMatch(/abs\(__ui_scroll_pending_dy\)\s*>=\s*UI_SCROLL_STEP_PX/);
    expect(header).toMatch(/now\s*-\s*__ui_last_scroll_draw_time\s*>=\s*UI_SCROLL_FRAME_MS/);
    expect(header).toMatch(/ui_apply_scroll_delta\(__ui_scroll_node,\s*__ui_scroll_pending_dy\)/);
  });

  it("flushes the last pending scroll delta when touch ends", () => {
    expect(header).toMatch(/ui_touch_up\(\)[\s\S]*__ui_scroll_pending_dy\s*!=\s*0/);
    expect(header).toMatch(/ui_touch_up\(\)[\s\S]*ui_apply_scroll_delta\(__ui_scroll_node,\s*__ui_scroll_pending_dy\)/);
  });

  it("clips partially visible scroll children instead of drawing into siblings", () => {
    expect(header).toMatch(/drawY\s*<\s*__ui_nodes\[p\]\.box\.y/);
    expect(header).toMatch(/drawY\s*\+\s*__ui_nodes\[nodeIdx\]\.box\.h\s*>\s*__ui_nodes\[p\]\.box\.y\s*\+\s*__ui_nodes\[p\]\.box\.h/);
  });

  it("declares NODE_INPUT in the UINodeKind enum", () => {
    expect(header).toMatch(/NODE_RANGE,\s*NODE_INPUT/);
  });

  it("UINode has a maxlen field", () => {
    expect(header).toMatch(/int16_t\s+maxlen/);
  });

  it("declares the keyboard subsystem structs and globals", () => {
    expect(header).toMatch(/struct\s+UIKey\s*\{\s*char\s+ch;\s*uint8_t\s+special;\s*\}/);
    expect(header).toMatch(/#define\s+UI_KB_MAX\s+48/);
    expect(header).toContain("__ui_kb_keys");
    expect(header).toContain("__ui_kb_buffer");
    expect(header).toContain("__ui_kb_visible");
    expect(header).toContain("__ui_kb_target");
  });

  it("declares ui_kb_open, ui_kb_close, ui_kb_handle_touch", () => {
    expect(header).toContain("ui_kb_open");
    expect(header).toContain("ui_kb_close");
    expect(header).toContain("ui_kb_handle_touch");
  });

  it("draws the keyboard overlay when visible", () => {
    expect(header).toContain("ui_kb_draw");
    expect(header).toMatch(/if\s*\(__ui_kb_visible\)[\s\S]*ui_kb_draw/);
  });

  it("routes touch to the keyboard when visible and inside the box", () => {
    expect(header).toMatch(/__ui_kb_visible[\s\S]*ui_kb_handle_touch/);
  });

  it("opens the keyboard when a NODE_INPUT is tapped", () => {
    expect(header).toMatch(/kind\s*==\s*NODE_INPUT[\s\S]*ui_kb_open/);
  });

  it("draws NODE_INPUT as a bordered field showing textBuffer", () => {
    expect(header).toMatch(/case\s+NODE_INPUT:/);
    expect(header).toMatch(/NODE_INPUT[\s\S]*drawRect/);
  });

  it("keyboard key actions: insert, shift toggle, page-swap, ok close", () => {
    expect(header).toContain("ui_kb_insert");
    expect(header).toContain("ui_kb_handle_tap");
    expect(header).toMatch(/case\s+1:[\s\S]*__ui_kb_shift/);
    expect(header).toMatch(/case\s+3:[\s\S]*ui_kb_close/);
    expect(header).toMatch(/case\s+4:[\s\S]*load_default/);
  });
});
