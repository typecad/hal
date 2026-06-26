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
view {
  display: flex;
  flex-direction: column;
}
button {
  padding: 6px 12px;
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
`;

let UA_RULES: CSSRule[] | null = null;

/** Get the parsed UA default rules. Lazily computed, cached. */
export function getUARules(): CSSRule[] {
  if (!UA_RULES) UA_RULES = parseCss(UA_CSS);
  return UA_RULES;
}
