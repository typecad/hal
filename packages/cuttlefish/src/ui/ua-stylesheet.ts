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
button {
  padding: 4px 10px;
  border: 1px solid;
  text-align: center;
}
input {
  padding: 4px 8px;
  border: 1px solid;
  min-height: 20px;
}
select {
  min-height: 20px;
}
range {
  min-height: 20px;
}
progress {
  min-height: 12px;
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
h1 { font-size: 24px; font-weight: bold; }
h2 { font-size: 20px; font-weight: bold; }
h3 { font-size: 18px; font-weight: bold; }
h4 { font-size: 16px; font-weight: bold; }
h5 { font-size: 14px; }
h6 { font-size: 12px; }
p { font-size: 16px; }
`;

let UA_RULES: CSSRule[] | null = null;

/** Get the parsed UA default rules. Lazily computed, cached. */
export function getUARules(): CSSRule[] {
  if (!UA_RULES) UA_RULES = parseCss(UA_CSS);
  return UA_RULES;
}
