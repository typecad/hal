// ---------------------------------------------------------------------------
// capture-layout.mjs — computed-layout capture prototype
//
// Renders the demo-ui HTML+CSS in headless Chrome at 240×320, extracts each
// element's computed box + colors + text via the DevTools Protocol, and emits
// the UINode table that lowerUIToCpp would produce — but from Chrome's layout
// instead of the hand-rolled BlockLayoutEngine.
//
// Run: node demo-ui/scripts/capture-layout.mjs
// ---------------------------------------------------------------------------

import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demoDir = path.resolve(__dirname, "..");

// Read the demo's source files
const html = fs.readFileSync(path.join(demoDir, "src", "hello.ui.html"), "utf8");
const css = fs.readFileSync(path.join(demoDir, "src", "hello.ui.css"), "utf8");

// The HTML parser subset uses <screen> as root; Chrome needs <body>. Wrap it.
// Map the custom tags to real HTML elements with matching classes so the CSS
// selectors (element, #id, .class) still apply. The :pressed pseudo-state maps
// to :active (Chrome's equivalent).
const styledHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  /* Reset: no margins, no scrollbars, fixed 240x320 canvas */
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 240px; height: 320px; overflow: hidden; }
  /* The .ui.css rules, translated for Chrome:
     - screen → body
     - :pressed → :active (Chrome's mouse-down pseudo-class)
     - font: 8x16 → font-size (Chrome needs real CSS font syntax)
     - transition: background Nms → transition: background Ns (ms→s) */
  ${css
    .replace(/(^|\s)screen\s*{/g, "$1body {")
    .replace(/:pressed/g, ":active")
    .replace(/font:\s*8x16\s*;/g, "font-size: 16px; font-family: monospace;")
    .replace(/transition:\s*background\s+(\d+)ms\s*;/g, "transition: background $1ms;")
    // Add px units to unitless numeric values (padding, margin, width, height)
    .replace(/(padding|margin|width|height):\s*(\d+)\s*;/g, "$1: $2px;")}
</style>
</head><body>
${html
  .replace(/<screen>/, "")
  .replace(/<\/screen>/, "")
  .replace(/<text id="([^"]*)">([^<]*)<\/text>/g, '<div id="$1" style="display:block">$2</div>')
  .replace(/<button id="([^"]*)">([^<]*)<\/button>/g, '<div id="$1" style="display:block">$2</div>')
  .replace(/<view /g, '<div ')
  .replace(/<\/view>/g, "</div>")}
</body></html>`;

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 240, height: 320, deviceScaleFactor: 1 });
  await page.setContent(styledHtml, { waitUntil: "networkidle0" });

  // Extract computed layout + styles for every element with an id
  const nodes = await page.evaluate(() => {
    const elements = document.querySelectorAll("[id]");
    const results = [];
    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      results.push({
        id: el.id,
        tag: el.className.includes("btn-el") ? "button"
           : el.className.includes("text-el") ? "text"
           : el.className.includes("view-el") ? "view" : "unknown",
        text: el.textContent.trim(),
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        bg: style.backgroundColor,
        color: style.color,
        paddingTop: parseInt(style.paddingTop) || 0,
      });
    }
    // Also capture the body (screen) as index 0
    const body = document.body;
    const bodyRect = body.getBoundingClientRect();
    const bodyStyle = window.getComputedStyle(body);
    results.unshift({
      id: "__screen__",
      tag: "screen",
      text: "",
      x: 0,
      y: 0,
      w: Math.round(bodyRect.width),
      h: Math.round(bodyRect.height),
      bg: bodyStyle.backgroundColor,
      color: bodyStyle.color,
      paddingTop: parseInt(bodyStyle.paddingTop) || 0,
    });
    return results;
  });

  await browser.close();

  // Emit the UINode table
  console.log("\n=== Computed Layout Capture (Chrome DevTools) ===\n");
  console.log("Viewport: 240×320\n");

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const rgb565 = (css) => {
      if (!css || css === "rgba(0, 0, 0, 0)") return 0;
      const m = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (!m) return 0;
      const [r, g, b] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
      return "0x" + (((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3)).toString(16).padStart(4, "0");
    };
    console.log(`  [${i}] ${n.tag}${n.id !== "__screen__" ? ` id="${n.id}"` : ""}`);
    console.log(`      box:   {x:${n.x}, y:${n.y}, w:${n.w}, h:${n.h}}`);
    console.log(`      bg:    ${n.bg} → ${rgb565(n.bg)}`);
    console.log(`      fg:    ${n.color} → ${rgb565(n.color)}`);
    if (n.text) console.log(`      text:  "${n.text}"`);
    console.log(`      pad:   ${n.paddingTop}px`);
    console.log();
  }

  // Emit the C++ UINode table for comparison
  console.log("=== Emitted C++ UINode Table (from Chrome layout) ===\n");
  const kind = (tag) => tag === "screen" || tag === "view" ? "NODE_FILL"
    : tag === "button" ? "NODE_BUTTON" : "NODE_TEXT";
  const lines = nodes.map((n) => {
    const rgb = (css) => {
      if (!css || css === "rgba(0, 0, 0, 0)") return "0x0000";
      const m = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (!m) return "0x0000";
      const [r, g, b] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
      return "0x" + (((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3)).toString(16).padStart(4, "0");
    };
    const text = n.text ? `"${n.text}"` : "nullptr";
    return `  { .box={${n.x},${n.y},${n.w},${n.h}}, .bg=${rgb(n.bg)}, .fg=${rgb(n.color)}, .kind=${kind(n.tag)}, .text=${text}, .font=nullptr },`;
  });
  console.log("UINode __ui_nodes[] = {");
  console.log(lines.join("\n"));
  console.log("};");
}

main().catch(console.error);
