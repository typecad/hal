# TypeScript to C++ Transpiler (MVP)

AST-based Node/npm tool that transpiles TypeScript input into C++ output.

## Commands

- `npm run build` – compile CLI.
- `npm run transpile -- <input.ts> [options]` – transpile TypeScript into C++.
- `npm run gen-libdefs -- <input.ts>` – auto-generate library include/symbol metadata stubs (`*.libdef.json`) in the source folder.
- `npm run map-error -- <map-file-or-generated-file> --line <n> [--column <n>] [--message <text>]` – map C++ error location back to TS.

## Transpile options

- `--emit cpp|split` (default: `split`)
- `--out-dir <directory>` (also accepts `--outDir`, treated as output base; artifacts are emitted to `<directory>/.build`)
- `--target generic|arduino` (default: `generic`)
- `--emit-maps true|false` (default: `true`, writes `.tscppmap.json` sidecars)
- `--arduino-arch <avr|esp32|samd|rp2040|...>` (Arduino target profile selection)
- `--fqbn <package:arch:board>` (optional board/package context)
- `--arduino-core <core>` and `--arduino-variant <variant>` (optional core-specific context)
- `--arduino-cli-json <path>` (optional normalized Arduino metadata JSON override)
- `--compile-arduino true|false|strict` (default: `false`, runs `arduino-cli compile` after transpile)

## Example

```bash
npm run build
npm run transpile -- example/example.ts --emit split --target arduino --arduino-arch avr --fqbn arduino:avr:uno --compile-arduino true
```

Outputs:
- `example/.build/example.ino`
- `example/.build/example.ino.tscppmap.json`
- `example/.build/arduino.d.ts`

## Editor DX for Arduino examples

To avoid red squiggles in `example/example.ts` for Arduino globals like `A0`, `HIGH`, `pinMode`, or `Wire`:

1. Transpile with Arduino target (this auto-generates `./.build/arduino.d.ts` using the same `gen-types` pipeline):

```bash
node dist/cli.js transpile .\example\example.ts --emit split --target arduino --arduino-arch avr --fqbn arduino:avr:uno
```

2. (Optional/manual) Generate declarations directly with:

```bash
node dist/cli.js gen-types --arduino-arch avr --outDir example
```

3. Keep `example/tsconfig.json` present (it includes `example.ts` + `.build/arduino.d.ts` for VS Code TypeScript IntelliSense).

This gives the editor a dedicated TypeScript project for sketches without affecting the transpiler build config.

## Mapping compiler errors

Example:

```bash
npm run map-error -- example/.build/example.ino.tscppmap.json -- --line 5 --column 10 --message "error: ..."
```

This prints the mapped TypeScript location and node kind for faster debugging.

## Library definitions

Use `gen-libdefs` to create starter metadata files in the same folder as your source file:
- `<module>.libdef.json` include + symbol mapping metadata

These are consumed during transpilation to map TS imports to C++ headers (for example, `Wire` -> `<Wire.h>`). Arduino framework typings are generated into `.build/arduino.d.ts` and no longer rely on `export const X: any` source stubs.

`*.libdef.json` also supports optional conditional variants for platform-specific mappings:

```json
{
	"module": "wire",
	"include": "<Wire.h>",
	"symbols": { "Wire": "Wire" },
	"variants": [
		{
			"when": { "target": "arduino", "architecture": "esp32" },
			"include": "<Wire.h>",
			"symbols": { "Wire": "Wire" }
		}
	]
}
```

## Arduino profile behavior

- For `--target arduino`, the emitter injects `#include <Arduino.h>` via profile resolution.
- For `--target arduino`, source output is emitted as `.ino` (Arduino sketch format).
- `--emit split` is ignored for Arduino target; a single sketch file is generated to avoid `setup/loop` linkage conflicts.
- Arduino transpile automatically removes stale generated artifacts in the output folder (`.ino`, `.h`, `.cpp`, and `.tscppmap.json`) except the current sketch output, to prevent duplicate symbol and stale-output compile issues.
- If architecture is omitted, a warning is emitted and default profile fallback is used.
- For unresolved built-ins like `HIGH`, `LOW`, `A0`, fallback conditional shims are emitted with warnings.
- `A0` fallback is architecture-aware and can be refined by `--fqbn` for known board patterns (for example AVR Uno vs Mega).
- Per-architecture capability tables validate common Arduino built-ins (`pinMode`, `digitalWrite`, `analogRead`, `delay`, `Serial`) and emit warnings for unknown symbols/functions.
- Metadata precedence for Arduino context: `--arduino-cli-json` > live `arduino-cli board details` probe (if available) > built-in architecture tables > generic fallbacks.
- With `--compile-arduino true`, compile diagnostics are mapped back to TypeScript using generated source maps and printed as `path(line,column): error ...`.
- With `--compile-arduino strict`, only mapped TypeScript diagnostics are printed on compile failures (raw compiler dump is suppressed).

Optional normalized metadata file shape:

```json
{
	"architecture": "avr",
	"pins": { "A0": 54 },
	"builtinFunctions": ["pinMode", "digitalWrite", "analogRead", "delay"],
	"builtinGlobals": ["HIGH", "LOW", "A0", "OUTPUT", "INPUT", "Serial"]
}
```
