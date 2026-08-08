// ---------------------------------------------------------------------------
// UA (User-Agent) default stylesheet.
// Applied before user CSS so elements have sensible built-in behavior without
// requiring explicit CSS. User CSS overrides (cascade: last-wins).
// Minimal and embedded-oriented, not a browser clone.
// ---------------------------------------------------------------------------

import { parseCss } from "./css-parser.js";
import type { CSSRule } from "./css-parser.js";

const UA_CSS = `
screen {
  display: flex;
  flex-direction: column;
}
body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
view {
  display: flex;
  flex-direction: column;
}
/* Scrollable content area — the standard pattern for multi-screen apps.
   align-items:center + gap give readable card-style layouts out of the box. */
.scrollBody {
  overflow: scroll;
  flex: 1;
  align-items: center;
  gap: 10px;
}
/* Header bar (back link + title). flex-direction:row is the expected layout;
   without it the back link and title stack vertically. */
.screenHeader {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
button {
  padding: 10px 16px;
  border: 1px solid;
  min-height: 48px;
  text-align: center;
}
input {
  padding: 8px;
  border: 1px solid;
}
select {
  padding: 10px 12px;
  border: 1px solid;
  min-height: 48px;
}
check, radio {
  min-height: 48px;
}
range {
  height: 40px;
}
list {
  overflow: scroll;
  flex-grow: 1;
}
a {
  text-decoration: underline;
}
label {
  text-align: left;
}
/* h3 is non-bold by default: the runtime bumps textSize for bold text
   (roughly doubling per-char advance), which wraps multi-word captions
   like "width / height / min / max" to 3 lines. Normal weight keeps
   them readable. Users can override with font-weight:bold if needed. */
h1 { font-size: 24px; font-weight: bold; }
h2 { font-size: 20px; font-weight: bold; }
h3 { font-size: 18px; font-weight: normal; }
h4 { font-size: 16px; font-weight: bold; }
h5 { font-size: 14px; }
h6 { font-size: 12px; }
p { font-size: 16px; }
/* Keyboard structural defaults (the OSK is runtime-generated, not
   user-authored HTML). Border keeps keys visually separated. Colors
   are design choices left to user CSS. */
.ui-key {
  border: 1px solid;
}
`;

let UA_RULES: CSSRule[] | null = null;

/** Get the parsed UA default rules. Lazily computed, cached. */
export function getUARules(): CSSRule[] {
  if (!UA_RULES) UA_RULES = parseCss(UA_CSS);
  return UA_RULES;
}
