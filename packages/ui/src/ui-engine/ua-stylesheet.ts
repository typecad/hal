// ---------------------------------------------------------------------------
// UA (User-Agent) default stylesheet.
// Applied before user CSS so elements have sensible built-in behavior without
// requiring explicit CSS. User CSS overrides (cascade: last-wins).
//
// This stylesheet owns the generic "app chrome" every screen-based app needs:
// screen scaffolding, the header bar, section captions, buttons/inputs/lists,
// and the on-screen keyboard. Every visual choice is expressed through var()
// tokens (with fallbacks), so a theme is just a `:root { --xxx: ... }`
// palette — no per-project element CSS required. Changing the variables is
// enough to re-theme an entire app.
// ---------------------------------------------------------------------------

import { parseCss, substituteVarsInRules, getRegisteredThemeVars, getRegisteredThemeVarsVersion } from "./css-parser.js";
import type { CSSRule } from "./css-parser.js";

const UA_CSS = `
/* Browser-like light defaults: dark text on a near-white background.
   A dark theme overrides these via user CSS (e.g. screen { color: #f0f0f0;
   background: #1a1a1a }). Without these, screen fg defaults to white
   (0xFFFF at the model level), making text invisible on light backgrounds. */
screen {
  display: flex;
  flex-direction: column;
  color: var(--foreground, #1a1a1a);
  background: var(--background, #ffffff);
  /* The theme font propagates to every text node via inheritance; a theme
     that doesn't define --font-family keeps the built-in font. */
  font-family: var(--font-family);
  gap: 8px;
  padding: 10px;
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
  background: var(--background, #ffffff);
}
/* Header bar (back link + title). flex-direction:row is the expected layout;
   without it the back link and title stack vertically. */
.screenHeader {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border, #d4d4d0);
  background: var(--card, #ffffff);
  padding: 8px 10px;
  border-radius: var(--radius, 0px);
  box-shadow: var(--shadow, none);
}
.backLink {
  font-size: 16px;
}
.screenTitle {
  color: var(--foreground, #1a1a1a);
  font-family: var(--font-family);
  font-size: 20px;
  font-weight: bold;
}
/* Standard content panel — the card-style section every screen-based app
   groups content into. Set only the tokens; alignment/gap that differ per
   screen are small per-section rules or overrides. Projects with a fixed
   content column width set --content-width once instead of repeating it on
   every section. */
.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: var(--content-width, auto);
  background: var(--card, #ffffff);
  border: 1px solid var(--border, #d4d4d0);
  padding: 8px;
  border-radius: var(--radius, 0px);
  box-shadow: var(--shadow, none);
}
/* Rules apply source-order last-wins with no specificity, so every derived
   rule below (nav, nav button, .press, .formPanel) MUST come after the
   element default it refines (e.g. button) or the element rule would win. */
.formRow {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.formStack {
  align-items: flex-start;
  gap: 5px;
}
.formPill {
  color: var(--foreground, #1a1a1a);
  background: var(--muted, #f0f0eb);
  border: 1px solid var(--border, #d4d4d0);
  border-radius: 5px;
  padding: 3px 7px;
  font-size: 13px;
}
.formStatus {
  color: var(--muted-foreground, #737373);
  font-size: 13px;
}
/* Section captions (the h3-style labels above demo groups). Non-bold: the
   runtime bumps textSize for bold text (roughly doubling per-char advance),
   which wraps multi-word captions to 3 lines. Normal weight keeps them
   readable. Users can override with font-weight:bold if needed. */
.demoLabel {
  color: var(--muted-foreground, #737373);
  font-size: 14px;
  font-weight: normal;
}
.demoCap {
  color: var(--muted-foreground, #737373);
  font-size: 13px;
}
button {
  padding: 10px 16px;
  border: 1px solid var(--border, #d4d4d0);
  min-height: 48px;
  text-align: center;
  background: var(--primary, #2563eb);
  color: var(--primary-foreground, #ffffff);
  font-family: var(--font-family);
  font-size: 18px;
  border-radius: var(--radius, 0px);
  box-shadow: var(--shadow, none);
}
button:pressed {
  background: var(--accent, #0d9488);
  color: var(--accent-foreground, #ffffff);
}
/* Home/landing menu: a <nav> is a column of full-width menu buttons. */
nav {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  width: var(--content-width, auto);
}
nav button {
  display: flex;
  flex-direction: row;
  align-items: center;
  color: var(--accent, #0d9488);
  text-align: left;
  background: var(--card, #ffffff);
  padding: 6px 10px;
}
/* 3D press-down button (opt-in .press): a solid vertical lip that flattens
   and drops the button flush on :pressed — the neobrutalism effect. The lip
   color is themeable via --btn-lip. */
.press {
  box-shadow: 0 3px 0 var(--btn-lip, #0b0d10);
  transition: background 120ms;
}
.press:pressed {
  transform: translate(0, 3px);
  box-shadow: 0 0 0 var(--btn-lip, #0b0d10);
}
/* Form layout primitives — the standard row/stack/pill/status scaffolding
   for forms screens (labels, inputs, and live status lines). */
.formPanel {
  align-items: stretch;
  gap: 7px;
}
input {
  padding: 8px;
  border: 1px solid var(--input, #d4d4d0);
  background: var(--card, #ffffff);
  color: var(--foreground, #1a1a1a);
  border-radius: var(--radius, 0px);
}
select {
  padding: 10px 12px;
  border: 1px solid var(--border, #d4d4d0);
  min-height: 48px;
  color: var(--accent, #0d9488);
  background: var(--muted, #f0f0eb);
  border-radius: var(--radius, 0px);
  font-size: 18px;
  text-decoration: underline;
}
check, radio {
  min-height: 48px;
  color: var(--foreground, #1a1a1a);
  font-size: 18px;
}
range {
  height: 40px;
}
list {
  overflow: scroll;
  flex-grow: 1;
  background: var(--card, #ffffff);
  border: 1px solid var(--border, #d4d4d0);
  border-radius: var(--radius, 0px);
}
a {
  color: var(--accent, #0d9488);
  text-decoration: underline;
}
label {
  text-align: left;
}
/* h3 is non-bold by default: the runtime bumps textSize for bold text
   (roughly doubling per-char advance), which wraps multi-word captions
   like "width / height / min / max" to 3 lines. Normal weight keeps
   them readable. Users can override with font-weight:bold if needed. */
h1 { font-size: 24px; font-weight: bold; color: var(--foreground, #1a1a1a); font-family: var(--font-family); }
h2 { font-size: 20px; font-weight: bold; color: var(--foreground, #1a1a1a); font-family: var(--font-family); }
h3 { font-size: 18px; font-weight: normal; color: var(--muted-foreground, #737373); }
h4 { font-size: 16px; font-weight: bold; }
h5 { font-size: 14px; }
h6 { font-size: 12px; }
p { font-size: 16px; }
/* Keyboard structural + theme defaults (the OSK is runtime-generated, not
   user-authored HTML). Border keeps keys visually separated. */
.ui-key {
  border: 1px solid var(--border, #d4d4d0);
  background: var(--card, #ffffff);
  color: var(--foreground, #1a1a1a);
}
.ui-key-ok {
  background: var(--primary, #2563eb);
  color: var(--primary-foreground, #ffffff);
}
.ui-key-del {
  background: var(--destructive, #dc2626);
  color: var(--destructive-foreground, #ffffff);
}
.ui-key-page {
  background: var(--accent, #0d9488);
  color: var(--accent-foreground, #ffffff);
}
.ui-keyboard {
  background: var(--muted, #f0f0eb);
}
`;

let UA_RULES: CSSRule[] | null = null;
// Substituted rules are cached per registered-variable version so repeated
// resolveStyles() calls (one per screen) don't re-run substitution.
let UA_CACHE: { version: number; rules: CSSRule[] } | null = null;

/** Get the parsed UA default rules, with var(--x) references resolved against
 *  the theme variables registered by the user-CSS parse. Lazily computed. */
export function getUARules(): CSSRule[] {
  // resolveVars:false keeps the var(--x) references literal in the cached
  // parse; they are substituted against the theme variables below.
  if (!UA_RULES) UA_RULES = parseCss(UA_CSS, undefined, { resolveVars: false });
  const version = getRegisteredThemeVarsVersion();
  if (UA_CACHE && UA_CACHE.version === version) return UA_CACHE.rules;
  // Clone so substitution never mutates the cached parse.
  const rules = substituteVarsInRules(
    UA_RULES.map((r) => ({ selector: r.selector, properties: { ...r.properties } })),
    getRegisteredThemeVars(),
  );
  UA_CACHE = { version, rules };
  return rules;
}
