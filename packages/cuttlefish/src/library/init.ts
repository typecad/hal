// ---------------------------------------------------------------------------
// `typecad-hal library init` — scaffold a new typecad-hal library package.
//
// Generates everything a library author needs to reach a valid, publishable
// package: the typed API skeleton, the typecad-hal.library.json manifest,
// AUTOSAR C++14-compliant shim stubs, (for Zephyr) an overlay fragment, a
// README, and a starter compliance test. The scaffold is deliberately tiny —
// it must pass `typecad-hal library validate` the moment it lands.
//
// Prompts follow the create-wizard's readline pattern (no prompt dependency);
// flags override prompts, and --yes takes defaults for anything unanswered.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";
import { LIBRARY_CATEGORIES, libraryCategory, requiredLibraryKeywords, type LibraryCategory } from "./catalog.js";
import { FRAMEWORK_CATALOG } from "../create/framework-catalog.js";

export interface LibraryInitOptions {
  /** Full package name (e.g. '@acme/esp32-led-ring' or 'my-lib'). */
  name?: string;
  /** Framework id from FRAMEWORK_CATALOG ('zephyr', 'native', ...). */
  framework?: string;
  /** Category id from LIBRARY_CATEGORIES. */
  category?: string;
  /** Comma-separated board-target prefixes (e.g. 'esp32s3_devkitc'). */
  targets?: string;
  /** Directory to scaffold into (default: ./<package basename>). */
  dir?: string;
  /** Skip prompts; take defaults for anything not provided by flags. */
  yes?: boolean;
}

export interface LibraryInitResult {
  packageDir: string;
  packageName: string;
  /** The library id (slug of the package basename). */
  id: string;
}

// ── Naming derivations ──────────────────────────────────────────────────────

/** Slug of a package basename: lowercase, runs of non-alphanumerics → '-'. */
export function libraryIdFromPackageName(packageName: string): string {
  const base = packageName.includes("/") ? packageName.split("/").pop()! : packageName;
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length === 0) {
    throw new Error(`Cannot derive a library id from '${packageName}'.`);
  }
  return slug;
}

/** '__tc_my_lib' for id 'my-lib' — a valid C++ identifier prefix. */
export function tokenBaseFromId(id: string): string {
  return id.replace(/-/g, "_");
}

function pascalCase(id: string): string {
  return id.split("-").filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("");
}

function camelCase(id: string): string {
  const pascal = pascalCase(id);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function isValidNpmName(name: string): boolean {
  // Conservative check: optional @scope/ + url-safe segments.
  return /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i.test(name);
}

// ── Prompts (the create-wizard pattern) ─────────────────────────────────────

type ReadlineInterface = ReturnType<typeof readline.createInterface>;

async function promptText(
  rl: ReadlineInterface,
  prompt: string,
  defaultValue?: string,
  validate?: (value: string) => string | null,
): Promise<string> {
  for (;;) {
    const suffix = defaultValue ? ` (${defaultValue})` : "";
    const answer = await rl.question(`${chalk.cyan("?")} ${prompt}${suffix}: `);
    const value = (answer.trim() || (defaultValue ?? "")).trim();
    if (validate) {
      const error = validate(value);
      if (error) {
        console.log(`  ${chalk.red("✗")} ${error}`);
        continue;
      }
    }
    return value;
  }
}

async function promptSelect(
  rl: ReadlineInterface,
  prompt: string,
  options: Array<{ label: string; value: string }>,
): Promise<string> {
  console.log(`${chalk.cyan("?")} ${prompt}:`);
  for (let i = 0; i < options.length; i++) {
    console.log(`  ${chalk.dim(`${i + 1})`)} ${options[i].label}`);
  }
  for (;;) {
    const answer = await rl.question(`  Enter number (1-${options.length}): `);
    const idx = parseInt(answer.trim(), 10) - 1;
    if (idx >= 0 && idx < options.length) {
      return options[idx].value;
    }
    console.log(`  ${chalk.red("✗")} Please enter a number between 1 and ${options.length}.`);
  }
}

// ── Templates ───────────────────────────────────────────────────────────────

interface ScaffoldModel {
  packageName: string;
  id: string;
  className: string;
  instanceName: string;
  tokenBase: string;
  framework: string;
  category: LibraryCategory;
  targets: string[];
  isZephyr: boolean;
}

function renderPackageJson(m: ScaffoldModel): string {
  return JSON.stringify(
    {
      name: m.packageName,
      version: "1.0.0",
      description: `${m.category.label} library for cuttlefish (${m.framework} framework)`,
      type: "module",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      files: ["dist", "src", "shims", "typecad-hal.library.json"],
      scripts: {
        build: "tsc",
        prepublishOnly: "npm run build",
      },
      license: "MIT",
      keywords: [
        "cuttlefish",
        ...requiredLibraryKeywords(m.category.id),
        m.framework,
        ...m.id.split("-"),
      ],
      engines: { node: ">=18" },
      sideEffects: false,
      exports: {
        ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
        "./package.json": "./package.json",
      },
      devDependencies: {
        "@typecad/cuttlefish": "*",
        vitest: "^4.0.0",
      },
    },
    null,
    2,
  ) + "\n";
}

function renderTsconfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        composite: true,
        target: "ES2021",
        module: "Node16",
        moduleResolution: "Node16",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        declaration: true,
        declarationMap: false,
        sourceMap: false,
        rootDir: "src",
        outDir: "dist",
      },
      include: ["src/**/*.ts"],
    },
    null,
    2,
  ) + "\n";
}

function renderApi(m: ScaffoldModel): string {
  return `// ---------------------------------------------------------------------------
// ${m.packageName} — typecad-hal library package (${m.category.label.toLowerCase()}).
//
// This file is the typed API contract: it is never executed. The cuttlefish
// transpiler lowers the import to the shim header (shims/__tc_${m.tokenBase}.h),
// and calls on the exported instance render verbatim into the generated C++.
// Two rules keep that contract intact:
//
//   1. Method names are load-bearing. The C++ class in the shim must define
//      exactly these names — 'rgbLed'-style call sites appear in the C++ as-is.
//   2. Export a singleton instance, not a constructor. A bare 'new' in user
//      code renders as a C++ heap allocation, which the AUTOSAR C++14 rules
//      the shims follow forbid.
// ---------------------------------------------------------------------------

/**
 * ${m.category.description} (${m.category.examples}).
 */
export class ${m.className} {
  /**
   * Prepare the hardware. Call once from setup(). The stub in the shim is a
   * no-op — replace it with your initialization code.
   */
  begin(): this {
    return this;
  }

  // Add your API here. Every method needs a matching member on the C++ class.
}

/** The instance to use — a preconstructed singleton (see rule 2 above). */
export const ${m.instanceName}: ${m.className} = new ${m.className}();
`;
}

function renderManifest(m: ScaffoldModel): string {
  const manifest: Record<string, unknown> = {
    id: m.id,
    module: m.packageName,
    framework: m.framework,
    include: `"__tc_${m.tokenBase}.h"`,
    gateToken: `__tc_${m.tokenBase}`,
    shims: [
      { path: `shims/__tc_${m.tokenBase}.h`, outName: `__tc_${m.tokenBase}.h` },
      { path: `shims/__tc_${m.tokenBase}.cpp`, outName: `__tc_${m.tokenBase}.cpp` },
    ],
  };
  if (m.targets.length > 0) {
    manifest.targets = m.targets;
  }
  if (m.isZephyr) {
    manifest.kconfig = ["# TODO: the CONFIG_ lines your library needs, e.g. CONFIG_LED_STRIP=y"];
    manifest.overlay = `shims/${m.id}.overlay`;
  }
  return JSON.stringify(manifest, null, 2) + "\n";
}

function renderShimHeader(m: ScaffoldModel): string {
  return `// ---------------------------------------------------------------------------
// __tc_${m.tokenBase}.h — ${m.packageName} shim.
//
// The implementation behind the TypeScript API in src/index.ts. Calls on the
// exported instance render verbatim, so the class name, the instance name,
// and the method names must match src/index.ts exactly.
//
// AUTOSAR C++14 by construction: fixed-width integers, static_cast only (no
// C-style casts), no heap, 'final' on the leaf class. The generated
// application's compliance check runs over these bytes.
// ---------------------------------------------------------------------------

#ifndef TC_${m.tokenBase.toUpperCase()}_H_
#define TC_${m.tokenBase.toUpperCase()}_H_

#include <cstdint>
${m.isZephyr ? "#include <zephyr/kernel.h>\n" : ""}class ${m.className} final
{
public:
  ${m.className}& begin();

private:
  bool initialized_ = false;
};

extern ${m.className} ${m.instanceName};

#endif  // TC_${m.tokenBase.toUpperCase()}_H_
`;
}

function renderShimSource(m: ScaffoldModel): string {
  return `// ---------------------------------------------------------------------------
// __tc_${m.tokenBase}.cpp — ${m.packageName} shim implementation.
// See __tc_${m.tokenBase}.h for the contract. AUTOSAR C++14 compliant.
// ---------------------------------------------------------------------------

#include "__tc_${m.tokenBase}.h"

${m.className}& ${m.className}::begin()
{
  initialized_ = true;
  return *this;
}

${m.className} ${m.instanceName};
`;
}

function renderOverlay(m: ScaffoldModel): string {
  return `/*
 * ${m.id} — devicetree overlay fragment (${m.category.label.toLowerCase()}).
 *
 * Appended to the generated boards/<board>.overlay when this library's import
 * is used. Describe the hardware here: controllers, pins, binding properties.
 * When upstream Zephyr ships a sample overlay for your part, adapt it and
 * credit it in a comment.
 */

/ {
\t/* aliases { your-alias = &your_node; }; */
};
`;
}

function renderReadme(m: ScaffoldModel): string {
  return `# ${m.packageName}

A typecad-hal library package — ${m.category.label.toLowerCase()} (${m.category.description}),
for the **${m.framework}** framework${m.targets.length > 0 ? ` (targets: ${m.targets.join(", ")})` : ""}.

## Use it

\`\`\`ts
import { ${m.instanceName} } from '${m.packageName}';

${m.instanceName}.begin();
\`\`\`

## Carry the hardware facts

This library owns the facts so projects don't have to. Document, in this
README, everything a user would otherwise hunt through datasheets for:

- which board revisions and targets are supported (and which pins they use),
- which peripherals the library borrows (say so — a user may want them),
- wiring requirements (I2C address straps, level shifting, pull-ups).

## Authoring checklist

- Method names in src/index.ts match the C++ shim names exactly; calls render verbatim.
- Export a singleton instance, not a constructor.
- Shims pass \`typecad-hal library validate\` (AUTOSAR C++14, strict).
- \`typecad-hal.library.json\` declares framework${m.isZephyr ? ", kconfig, overlay" : ""} and the shim files.
- package.json keywords include the marker (\`typecad-hal-library\`) and category (\`cuttlefish-${m.category.id}\`) keywords.

Validate with \`typecad-hal library validate .\` from this directory.
`;
}

function renderStarterTest(m: ScaffoldModel): string {
  return `import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ComplianceContext, runSelfCheck } from "@typecad/cuttlefish/compliance";

// The shipped shim bytes must pass --autosar=strict, exactly like framework
// shims — the generated application's compliance check runs over them.

const here = dirname(fileURLToPath(import.meta.url));

describe("${m.packageName} shims under --autosar=strict", () => {
  it("__tc_${m.tokenBase}.h/.cpp produce no unrecorded AUTOSAR violations", () => {
    const header = readFileSync(join(here, "..", "shims", "__tc_${m.tokenBase}.h"), "utf8").split("\\n");
    const source = readFileSync(join(here, "..", "shims", "__tc_${m.tokenBase}.cpp"), "utf8").split("\\n");
    const ctx = new ComplianceContext("strict");
    const findings = runSelfCheck(ctx, source, header);
    expect(findings).toEqual([]);
  });
});
`;
}

// ── Scaffolding ─────────────────────────────────────────────────────────────

function writeIfChanged(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

export async function runLibraryInit(options: LibraryInitOptions): Promise<LibraryInitResult> {
  const interactive = options.yes !== true;

  let packageName = options.name;
  let framework = options.framework;
  let categoryId = options.category;
  let targetsRaw = options.targets;

  const missing = packageName === undefined || framework === undefined || categoryId === undefined;
  if (interactive && missing) {
    const rl = readline.createInterface({ input, output });
    try {
      if (packageName === undefined) {
        packageName = await promptText(rl, "Package name (npm name, e.g. @acme/my-lib)", "my-lib", (v) =>
          isValidNpmName(v) ? null : "Not a valid npm package name.",
        );
      }
      if (framework === undefined) {
        framework = await promptSelect(
          rl,
          "Framework",
          FRAMEWORK_CATALOG.map((f) => ({ label: f.label, value: f.id })),
        );
      }
      if (categoryId === undefined) {
        categoryId = await promptSelect(
          rl,
          "Category",
          LIBRARY_CATEGORIES.map((c) => ({ label: `${c.label} — ${c.description}`, value: c.id })),
        );
      }
      if (targetsRaw === undefined) {
        targetsRaw = await promptText(
          rl,
          "Board targets (comma-separated build-target prefixes, empty for any)",
          "",
        );
      }
    } finally {
      rl.close();
    }
  }

  packageName = (packageName ?? "my-lib").trim();
  framework = (framework ?? "zephyr").trim();
  categoryId = (categoryId ?? "utility").trim();

  if (!isValidNpmName(packageName)) {
    throw new Error(`'${packageName}' is not a valid npm package name.`);
  }
  const frameworkEntry = FRAMEWORK_CATALOG.find((f) => f.id === framework);
  if (!frameworkEntry) {
    throw new Error(
      `Unknown framework '${framework}'. Known: ${FRAMEWORK_CATALOG.map((f) => f.id).join(", ")}.`,
    );
  }
  const category = libraryCategory(categoryId);
  if (!category) {
    throw new Error(
      `Unknown category '${categoryId}'. Known: ${LIBRARY_CATEGORIES.map((c) => c.id).join(", ")}.`,
    );
  }

  const id = libraryIdFromPackageName(packageName);
  const targets = (targetsRaw ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const model: ScaffoldModel = {
    packageName,
    id,
    className: pascalCase(id),
    instanceName: camelCase(id),
    tokenBase: tokenBaseFromId(id),
    framework,
    category,
    targets,
    isZephyr: framework === "zephyr",
  };

  const packageDir = path.resolve(options.dir ?? path.join(process.cwd(), id));
  if (fs.existsSync(packageDir) && fs.readdirSync(packageDir).length > 0) {
    throw new Error(`Directory ${packageDir} exists and is not empty.`);
  }

  writeIfChanged(path.join(packageDir, "package.json"), renderPackageJson(model));
  writeIfChanged(path.join(packageDir, "tsconfig.json"), renderTsconfig());
  writeIfChanged(path.join(packageDir, ".gitignore"), "node_modules/\ndist/\n");
  writeIfChanged(path.join(packageDir, "src", "index.ts"), renderApi(model));
  writeIfChanged(path.join(packageDir, "typecad-hal.library.json"), renderManifest(model));
  writeIfChanged(path.join(packageDir, "shims", `__tc_${model.tokenBase}.h`), renderShimHeader(model));
  writeIfChanged(path.join(packageDir, "shims", `__tc_${model.tokenBase}.cpp`), renderShimSource(model));
  if (model.isZephyr) {
    writeIfChanged(path.join(packageDir, "shims", `${id}.overlay`), renderOverlay(model));
  }
  writeIfChanged(path.join(packageDir, "README.md"), renderReadme(model));
  writeIfChanged(path.join(packageDir, "tests", "library.test.ts"), renderStarterTest(model));

  console.log(chalk.green("+") + ` Scaffolded ${chalk.white.bold(packageName)} in ${packageDir}`);
  console.log();
  console.log(`  Framework:  ${frameworkEntry.label}`);
  console.log(`  Category:   ${category.label} (keyword: typecad-hal-${category.id})`);
  console.log(`  Library id: ${id} (shim __tc_${model.tokenBase}.h, gate token __tc_${model.tokenBase})`);
  console.log();
  console.log("  Next steps:");
  console.log(`    1. Replace the stubs in shims/ with your implementation.`);
  console.log(`    2. Fill in typecad-hal.library.json${model.isZephyr ? " (kconfig + overlay)" : ""} as you go.`);
  console.log(`    3. Validate: npx typecad-hal library validate ${packageDir}`);
  console.log(`    4. Use it in a project: npm install <path-or-published-name>, then`);
  console.log(`       import { ${model.instanceName} } from '${packageName}';`);
  if (model.isZephyr) {
    console.log();
    console.log(chalk.dim("  Note: for Zephyr, document the peripherals your overlay borrows in the README."));
  }

  return { packageDir, packageName, id };
}
