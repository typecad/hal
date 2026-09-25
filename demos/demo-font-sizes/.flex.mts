import { parseCss } from "file:///C:/typecad/hal/packages/ui/src/ui-engine/css-parser.ts";
import { parseHtmlWithKeyboards } from "file:///C:/typecad/hal/packages/ui/src/ui-engine/html-parser.ts";
import { resolveStyles } from "file:///C:/typecad/hal/packages/ui/src/ui-engine/style-resolver.ts";
import { measure } from "file:///C:/typecad/hal/packages/ui/src/ui-engine/layout-engine.ts";
import { selectEngine } from "file:///C:/typecad/hal/packages/ui/src/ui-engine/select-engine.ts";
import { assetTextWidth } from "file:///C:/typecad/hal/packages/ui/src/ui-engine/font-assets.ts";
const css = `#row { display: flex; flex-direction: row; align-items: center; padding: 1px 3px; height: 22px; }
#t { font-size: 17px; height: 22px; white-space: nowrap; }`;
const rules = parseCss(css);
const [screen] = parseHtmlWithKeyboards(`<screen><view id="row"><text id="t">17 Ag Rg 47%</text></view></screen>`).screens.map((s: never) => resolveStyles(s, rules));
const engine = selectEngine(screen);
console.log("engine:", engine.constructor.name);
const boxes = engine.arrange(screen, { x: 0, y: 0, w: 128, h: 64 }, measure);
boxes.forEach((b, i) => console.log(i, JSON.stringify(b)));
process.exit(0);
