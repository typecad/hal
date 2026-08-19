import io
import re

# ── types.ts: drop AddCommandOptions + ThemeCommandOptions ─────────────────
p = 'packages/cuttlefish/src/types.ts'
s = io.open(p, encoding='utf-8').read()
old = '''export interface AddCommandOptions {
  command: "add";
  /** Preset id (e.g. "shadcn"). */
  preset: string;
  /** Overwrite an existing destination file. */
  force: boolean;
  /** Project root (cwd when invoked from the project directory). */
  projectRoot: string;
  /** shadcn preset: included theme whose tokens are merged into the copied
   *  stylesheet (see assets/shadcn/themes/). */
  theme?: string;
}

export interface ThemeCommandOptions {
  command: "theme";
  /** Theme name; omitted lists the available themes. */
  name?: string;
  /** Project root (cwd when invoked from the project directory). */
  projectRoot: string;
}

'''
assert s.count(old) == 1, 'types options'
s = s.replace(old, '')
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('types.ts: command option interfaces removed')

# ── utils/cli.ts: parse branches, signature, help lines, import ─────────────
p = 'packages/cuttlefish/src/utils/cli.ts'
s = io.open(p, encoding='utf-8').read()
crlf = '\r\n' in io.open(p, encoding='utf-8', newline='').read()
s = s.replace('\r\n', '\n')

# add + theme parse branches (contiguous in the file? add first, theme right after)
i = s.find('  if (firstArg === "add") {')
assert i > 0
j = s.find('  if (firstArg === "theme") {')
assert j > i
k = s.find('\n  }\n', j)
assert k > j
# the theme branch closes at the first closing; find its end by brace matching textually:
end_theme = s.find('  }\n', s.find('projectRoot: process.cwd(),', j))
assert end_theme > 0
s = s[:i] + s[end_theme + 4:]

old = 'export function parseCommandLine(argv: string[]): CommandLineOptions | CreateCommandOptions | BoardAddCommandOptions | AddCommandOptions | ThemeCommandOptions | "help" {'
new = 'export function parseCommandLine(argv: string[]): CommandLineOptions | CreateCommandOptions | BoardAddCommandOptions | "help" {'
assert s.count(old) == 1, 'signature'
s = s.replace(old, new)

old = 'import { CommandLineOptions, CreateCommandOptions, BoardAddCommandOptions, AddCommandOptions, ThemeCommandOptions, EmitMode, PlatformContext, TargetProfile, TreeShakingOptions } from "../types.js";'
new = 'import { CommandLineOptions, CreateCommandOptions, BoardAddCommandOptions, EmitMode, PlatformContext, TargetProfile, TreeShakingOptions } from "../types.js";'
assert s.count(old) == 1, 'types import'
s = s.replace(old, new)

old = 'import { listAddPresets } from "../add-preset.js";\n'
assert s.count(old) == 1
s = s.replace(old, '')

# help lines
old = '''  console.log(`  cuttlefish add <preset> [--force] [--theme <name>]   Copy a preset asset into src/ (yours to edit):`);
  console.log(`${listAddPresets()}`);
  console.log(`  cuttlefish theme [name]              List included shadcn themes, or swap the token`);
  console.log(chalk.gray(`                                        blocks of this project's src/styles/shadcn.css`));
'''
assert s.count(old) == 1, 'help lines'
s = s.replace(old, '')

io.open(p, 'w', encoding='utf-8', newline='').write(s.replace('\n', '\r\n') if crlf else s)
print('utils/cli.ts: add/theme branches, signature, help removed')

# ── cli.ts: handlers + dispatch + type import ───────────────────────────────
p = 'packages/cuttlefish/src/cli.ts'
s = io.open(p, encoding='utf-8').read()

i = s.find('async function handleAddPreset(options: AddCommandOptions): Promise<void> {')
assert i > 0
j = s.find('async function handleTheme(options: ThemeCommandOptions): Promise<void> {')
assert j > i
# end of handleTheme: next top-level 'async function' or 'function' after it
k = s.find('\nasync function ', j + 10)
assert k > j
s = s[:i] + s[k + 1:]

old = '''    if (options.command === "add") {
      await handleAddPreset(options);
      return;
    }

    if (options.command === "theme") {
      await handleTheme(options);
      return;
    }

'''
assert s.count(old) == 1, 'dispatch'
s = s.replace(old, '')

old = 'import type { AddCommandOptions, ThemeCommandOptions }'
if old in s:
    s = s.replace(old + ' from "./types.js";\n', '')
else:
    m = re.search(r'import type \{([^}]*)\} from "\./types\.js";', s)
    assert m and 'AddCommandOptions' in m.group(1), 'type import in cli.ts'
    inner = m.group(1).replace('AddCommandOptions', '').replace('ThemeCommandOptions', '').replace(' ,', '').replace(', ,', ',').replace('{ ,', '{').strip()
    s = s.replace(m.group(0), 'import type { ' + inner + ' } from "./types.js";')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('cli.ts: handlers + dispatch removed')

# ── package.json exports ────────────────────────────────────────────────────
p = 'packages/cuttlefish/package.json'
s = io.open(p, encoding='utf-8').read()
old = ''',
    "./theme-tokens": {
      "types": "./dist/theme-tokens.d.ts",
      "default": "./dist/theme-tokens.js"
    },
    "./add-preset": {
      "types": "./dist/add-preset.d.ts",
      "default": "./dist/add-preset.js"
    }'''
assert s.count(old) == 1, 'exports'
s = s.replace(old, '')
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('package.json: exports removed')
