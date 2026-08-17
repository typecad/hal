// shadcn kit: @import expansion, the shipped preset's parse cleanliness, and
// the `cuttlefish add` scaffold command.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandCssImports } from "@typecad/ui/ui-engine/css-imports";
import { parseCss, parseKeyframes } from "@typecad/ui/ui-engine/css-parser";
import { parseColor } from "@typecad/ui/ui-engine/color";
import { setThemeClass } from "@typecad/cuttlefish/stores/theme-store";
import type { Diagnostic } from "@typecad/cuttlefish/api/shared";
import { resolveStyles } from "@typecad/ui/ui-engine/style-resolver";
import { parseHtml } from "@typecad/ui/ui-engine/html-parser";
import { runAddPreset } from "../../../packages/cuttlefish/src/add-preset";
import { parseCommandLine } from "../../../packages/cuttlefish/src/utils/cli";

let tmp: string;

const presetPath = path.resolve(__dirname, "../../../packages/cuttlefish/assets/shadcn/shadcn.css");

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cf-shadcn-"));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("@import expansion", () => {
  it("inlines local relative imports, recursively", () => {
    fs.writeFileSync(path.join(tmp, "b.css"), `.fromB { color: #00ff00; }\n@import "./nested/d.css";`);
    fs.mkdirSync(path.join(tmp, "nested"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "nested/d.css"), `.fromD { color: #0000ff; }`);
    const css = `@import "./b.css";\n.root { color: #ff0000; }`;
    const expanded = expandCssImports(css, tmp);
    expect(expanded).toContain(".fromB");
    expect(expanded).toContain(".fromD");
    expect(expanded).toContain(".root");
    expect(expanded).not.toContain("@import \"./b.css\"");
  });

  it("guards against import cycles", () => {
    fs.writeFileSync(path.join(tmp, "x.css"), `@import "./y.css";\n.x { color: #111111; }`);
    fs.writeFileSync(path.join(tmp, "y.css"), `@import "./x.css";\n.y { color: #222222; }`);
    const expanded = expandCssImports(`@import "./x.css";`, tmp);
    expect(expanded).toContain(".x");
    expect(expanded).toContain(".y");
  });

  it("leaves remote and unreadable imports for the parser's warning path", () => {
    const css = [
      `@import "https://cdn.example.com/x.css";`,
      `@import "./does-not-exist.css";`,
      `.a { color: #333333; }`,
    ].join("\n");
    const expanded = expandCssImports(css, tmp);
    expect(expanded).toContain("https://cdn.example.com/x.css");
    expect(expanded).toContain("./does-not-exist.css");
    expect(expanded).toContain(".a");
  });
});

describe("shadcn preset asset", () => {
  it("parses with zero warnings (only supported properties)", () => {
    const text = fs.readFileSync(presetPath, "utf-8");
    const diags: Diagnostic[] = [];
    const rules = parseCss(text, diags);
    expect(diags).toEqual([]);
    expect(rules.length).toBeGreaterThan(20);
  });

  it("defines the token sets and core recipes", () => {
    const text = fs.readFileSync(presetPath, "utf-8");
    const rules = parseCss(text);
    const selectors = rules.map((r) => r.selector.compounds.flat().map((s) => ("name" in s ? s.name : "")).join("")).join("|");
    // .avatar is intentionally NOT a rule: images render rectangular (no
    // rounded clipping), and a border just drew over the image — the kit
    // documents <img> as the plain avatar element.
    for (const cls of ["btn", "btn-primary", "btn-ghost", "badge", "card", "card-title", "input", "alert", "alert-destructive", "skeleton", "separator", "progress", "switch"]) {
      expect(selectors).toContain(cls);
    }
    expect(parseKeyframes(text).map((k) => k.name)).toContain("ui-skeleton-pulse");
  });

  it("applies recipe classes to native elements through the cascade", () => {
    const text = fs.readFileSync(presetPath, "utf-8");
    const styled = resolveStyles(
      parseHtml(`<screen><button id="b" class="btn btn-primary">Save</button><view id="c" class="card"><text class="card-title">T</text></view></screen>`),
      parseCss(text),
    );
    // var() tokens substitute at resolve time — recipes land as concrete values.
    expect(styled.children[0].style.background).toBe("#18181b");
    expect(styled.children[0].style.borderRadius).toBe("8px");
    expect(styled.children[1].style.padding).toBe("16px");
    expect(styled.children[1].children[0].style.fontWeight).toBe("bold");
  });
});

describe("cuttlefish add shadcn", () => {
  it("parses the add command shape", () => {
    const opts = parseCommandLine(["node", "cuttlefish.js", "add", "shadcn"]);
    expect(opts).toMatchObject({ command: "add", preset: "shadcn", force: false });
    const forced = parseCommandLine(["node", "cuttlefish.js", "add", "shadcn", "--force"]);
    expect(forced).toMatchObject({ command: "add", force: true });
    expect(() => parseCommandLine(["node", "cuttlefish.js", "add"])).toThrow(/Usage: cuttlefish add/);
  });

  it("copies the preset into src/styles without clobbering", () => {
    const projectRoot = path.join(tmp, "proj");
    fs.mkdirSync(projectRoot, { recursive: true });

    runAddPreset({ command: "add", preset: "shadcn", force: false, projectRoot });
    const dest = path.join(projectRoot, "src/styles/shadcn.css");
    expect(fs.existsSync(dest)).toBe(true);
    const source = fs.readFileSync(path.resolve(__dirname, "../../../packages/cuttlefish/assets/shadcn/shadcn.css"), "utf-8");
    expect(fs.readFileSync(dest, "utf-8")).toBe(source);

    // Second run without --force refuses; with --force overwrites.
    expect(() => runAddPreset({ command: "add", preset: "shadcn", force: false, projectRoot })).toThrow(/already exists/);
    fs.writeFileSync(dest, "// edited");
    runAddPreset({ command: "add", preset: "shadcn", force: true, projectRoot });
    expect(fs.readFileSync(dest, "utf-8")).toBe(source);
  });

  it("rejects unknown presets with the available list", () => {
    expect(() => runAddPreset({ command: "add", preset: "nope", force: false, projectRoot: tmp })).toThrow(/Unknown preset .*shadcn/s);
  });
});

describe("stock shadcn themes paste in unmodified", () => {
  const MARKUP = `<screen><button id="b" class="btn btn-primary">Go</button><view id="c" class="card"><text class="card-title">T</text></view></screen>`;

  it("classic HSL-triplet theme (shadcn generator default)", () => {
    // Verbatim structure of a stock theme: bare "H S% L%" channel triplets.
    const theme = `
      :root {
        --primary: 240 5.9% 10%;
        --card: 0 0% 100%;
        --border: 240 5.9% 90%;
        --radius: 0.5rem;
      }
      .dark { --primary: 0 0% 98%; --card: 240 10% 3.9%; --border: 240 3.7% 15.9%; }
    `;
    const preset = fs.readFileSync(presetPath, "utf-8");
    // The pasted theme overrides the preset's tokens exactly as a user would
    // (same names, later in the cascade).
    const styled = resolveStyles(parseHtml(MARKUP), parseCss(preset + "\n" + theme));
    // 240 5.9% 10% is shadcn zinc-950 → #18181b.
    expect(styled.children[0].style.background).toBe("240 5.9% 10%");
    expect(parseColor("240 5.9% 10%")).toEqual({ r: 0x18, g: 0x18, b: 0x1b });
    // Radius token in rem flows through to the recipe.
    expect(styled.children[0].style.borderRadius).toBe("0.5rem");
  });

  it("Tailwind v4 era oklch theme", () => {
    const theme = `
      :root {
        --primary: oklch(0.21 0.006 285.885);
        --card: oklch(1 0 0);
        --border: oklch(0.92 0.004 286.32);
      }
    `;
    const preset = fs.readFileSync(presetPath, "utf-8");
    const styled = resolveStyles(parseHtml(MARKUP), parseCss(preset + "\n" + theme));
    expect(styled.children[0].style.background).toBe("oklch(0.21 0.006 285.885)");
    // oklch(0.21 0.006 285.885) is shadcn zinc-900 → #18181b.
    expect(parseColor("oklch(0.21 0.006 285.885)")).toEqual({ r: 0x18, g: 0x18, b: 0x1b });
  });

  it("hsl(var(--x)) consumption also works with triplet tokens", () => {
    const styled = resolveStyles(
      parseHtml(`<screen><view id="v">x</view></screen>`),
      parseCss(`:root { --primary: 222.2 47.4% 11.2%; } #v { background: hsl(var(--primary)); }`),
    );
    expect(styled.children[0].style.background).toBe("hsl(222.2 47.4% 11.2%)");
  });

  it("calc(var(--radius) - 2px) with a rem radius resolves to px, not rem", () => {
    const styled = resolveStyles(
      parseHtml(`<screen><view id="v">x</view></screen>`),
      parseCss(`:root { --radius: 0.5rem; } #v { border-radius: calc(var(--radius) - 2px); width: calc(0.625rem * 2); }`),
    );
    expect(styled.children[0].style.borderRadius).toBe("6px");
    expect(styled.children[0].style.width).toBe("20px");
  });

  it("a pasted theme drives every kit element through its role token", () => {
    // Distinctive triplet values so each assertion pins the exact token.
    const theme = `
      :root {
        --background: 1 1% 11%; --foreground: 2 2% 22%;
        --card: 3 3% 33%; --card-foreground: 4 4% 44%;
        --primary: 5 5% 55%; --primary-foreground: 6 6% 66%;
        --secondary: 7 7% 77%; --secondary-foreground: 8 8% 88%;
        --muted: 9 9% 99%; --muted-foreground: 10 10% 90%;
        --destructive: 13 13% 67%; --destructive-foreground: 14 14% 56%;
        --destructive-background: 15 15% 45%;
        --border: 16 16% 34%; --input: 17 17% 23%;
      }
    `;
    const preset = fs.readFileSync(presetPath, "utf-8");
    const styled = resolveStyles(parseHtml(`<screen>
      <button id="btnPrimary" class="btn btn-primary">P</button>
      <button id="btnSecondary" class="btn btn-secondary">S</button>
      <button id="btnOutline" class="btn btn-outline">O</button>
      <button id="btnDestructive" class="btn btn-destructive">D</button>
      <view id="card" class="card"><text class="card-title">T</text><text id="cardDesc" class="card-description">d</text></view>
      <text id="badge" class="badge">b</text>
      <text id="badgeSecondary" class="badge badge-secondary">bs</text>
      <input id="input" class="input"/>
      <view id="alert" class="alert"><text class="alert-title">a</text></view>
      <view id="alertDestructive" class="alert alert-destructive"><text class="alert-description">ad</text></view>
      <view id="skeleton" class="skeleton"/>
      <progress id="progress" class="progress" value="10"></progress>
      <hr id="separator" class="separator"/>
    </screen>`), parseCss(preset + "\n" + theme));

    const find = (node: { id?: string; children: unknown[] }, id: string): { id?: string; children: unknown[]; style: Record<string, string | undefined> } | undefined => {
      if (node.id === id) return node as { id?: string; children: unknown[]; style: Record<string, string | undefined> };
      for (const child of node.children) {
        const hit = find(child as { id?: string; children: unknown[] }, id);
        if (hit) return hit;
      }
      return undefined;
    };
    const el = (id: string) => find(styled, id)!.style;

    expect(el("btnPrimary").background).toBe("5 5% 55%");            // --primary
    expect(el("btnPrimary").color).toBe("6 6% 66%");                // --primary-foreground
    expect(el("btnSecondary").background).toBe("7 7% 77%");         // --secondary
    expect(el("btnSecondary").color).toBe("8 8% 88%");              // --secondary-foreground
    expect(el("btnOutline").background).toBe("1 1% 11%");           // --background
    expect(el("btnOutline").color).toBe("2 2% 22%");                // --foreground
    expect(el("btnOutline").borderColor).toBe("16 16% 34%");        // --border
    expect(el("btnDestructive").background).toBe("13 13% 67%");     // --destructive
    expect(el("btnDestructive").color).toBe("14 14% 56%");          // --destructive-foreground
    expect(el("card").background).toBe("3 3% 33%");                 // --card
    expect(el("card").color).toBe("4 4% 44%");                      // --card-foreground
    expect(el("card").borderColor).toBe("16 16% 34%");              // --border
    expect(el("cardDesc").color).toBe("10 10% 90%");                // --muted-foreground
    expect(el("badge").background).toBe("5 5% 55%");                // --primary
    expect(el("badge").color).toBe("6 6% 66%");                     // --primary-foreground
    expect(el("badgeSecondary").background).toBe("7 7% 77%");       // --secondary
    expect(el("badgeSecondary").color).toBe("8 8% 88%");            // --secondary-foreground
    expect(el("input").background).toBe("1 1% 11%");                // --background
    expect(el("input").borderColor).toBe("17 17% 23%");             // --input (not --border)
    expect(el("alert").background).toBe("1 1% 11%");                // --background
    expect(el("alert").borderColor).toBe("16 16% 34%");             // --border
    expect(el("alertDestructive").background).toBe("15 15% 45%");   // --destructive-background
    expect(el("alertDestructive").borderColor).toBe("13 13% 67%");  // --destructive
    expect(el("alertDestructive").color).toBe("13 13% 67%");        // --destructive
    expect(el("skeleton").background).toBe("9 9% 99%");             // --muted
    expect(el("progress").background).toBe("7 7% 77%");             // --secondary track
    expect(el("progress").color).toBe("5 5% 55%");                  // --primary fill
    expect(el("separator").background).toBe("16 16% 34%");          // --border
    // A token the pasted theme omits falls back to the preset's own value.
    expect(el("btnPrimary").borderRadius).toBe("8px");
  });

  it("a pasted .dark block flips the same elements", () => {
    const theme = `:root { --primary: 5 5% 55%; } .dark { --primary: 200 50% 50%; }`;
    const preset = fs.readFileSync(presetPath, "utf-8");
    setThemeClass("dark");
    const dark = resolveStyles(
      parseHtml(`<screen><button id="b" class="btn btn-primary">x</button></screen>`),
      parseCss(preset + "\n" + theme),
    );
    setThemeClass(null);
    expect(dark.children[0].style.background).toBe("200 50% 50%");
    const light = resolveStyles(
      parseHtml(`<screen><button id="b" class="btn btn-primary">x</button></screen>`),
      parseCss(preset + "\n" + theme),
    );
    expect(light.children[0].style.background).toBe("5 5% 55%");
  });
});
