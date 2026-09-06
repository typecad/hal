---
'@typecad/cuttlefish': major
'@typecad/hal': minor
---

Dead-code sweep after the boardgen migration — removes the machinery that only the deleted board/MCU packages ever exercised, and dedupes copy-paste artifacts. No behavior change for boardgen-era projects.

**@typecad/cuttlefish**:
- `resolveBoardConstants()` and the TypeScript AST board-definition walker (const tables, `*_CAPABILITIES`/`*_INSTANCES` flattening, peripheral pin-map encoding) are deleted. Board packages were the only producers of `.ts` `BoardDefinition` manifests; the generated `board.json` is the only board source, so IR building now calls `readGeneratedBoardConstants()` directly. `testing.ts` re-exports `readGeneratedBoardConstants` in its place.
- `tryResolveBoardDefFile()` no longer resolves relative `board-*/` directory imports — that layout died with the board packages. It now maps only the virtual `@typecad/board` specifier (and the config's board target, defensively) to the generated manifest.
- The `isHALSource` framework-subpath regex (`@typecad/framework-*/arduino|hal|gpio`) is gone — no framework package exports those subpaths. The legacy `@typecad/board-*` import prefix stays: old projects' imports keep resolving pin aliases against the project's generated board.
- Fixed two copy-paste tautologies (`specifier === '@typecad/ui' || specifier === '@typecad/ui'`).

**@typecad/hal** — the board-package instance-table family is deleted (`createHALInstances`, `i2cName`, `spiName`, `serialName`); boardgen inlines controller names into generated board modules, so nothing consumes them. `I2CBus`/`I2CDevice`, `SPIBus`/`SPIDevice`, and `SerialPort` (the parts generated board modules import) are untouched.

**Second pass:**
- `resolveNativeDisplayOp` and `api/shared/native-display-op-resolver.ts` are deleted — its only consumers (NativeAVRStrategy, Esp32Strategy) were removed with framework-arduino.
- The manual target/MCU registration API is deleted from the scaffold (`registerKnownTarget`, `registerKnownMcu`, the `@deprecated` `KNOWN_BOARDS`/`KnownBoard` aliases) — the board data pack replaced hand-registration. `KNOWN_TARGETS`/`KNOWN_MCUS` are untouched.
- Dead emit helpers removed: `buildSnprintfRenderResult` + `shouldUseSnprintfForString` (superseded by `statementNeedsSnprintf`/the live snprintf path), `normalizeKebabName`; `normalizeComment` and `toPascalCaseLocal` become file-private (they had leaked into the emit-utils barrel with zero external consumers).
- `chipForTarget` drops the unreachable per-board switch cases — the soc-keyed registry (`chipForSoc`) already resolves `xiao_ble`, `esp32s3_devkitc`, and `esp32_devkitc`; unknown targets still fall back to the XIAO BLE default.
- `dts-reader.ts` internals (`parseStatements`, `parseGpioMap`) are no longer exported; `parseStatements` consumers (gen-zephyr-board-data.mjs) go through `readBoardDts`.
- `@typecad/expect` drops the unused `Expectation`/`StringExpectation` type re-exports.
- Deliberately kept after verification: the shim-block strip in setup.ts (Zephyr's shim lines DO carry the `CUTTLEFISH_*_BEGIN/END` markers — it is a live backstop), `lowerHwtimer` (intentional unsupported-op gate with test coverage), `cppTypeForHalOp`, `KNOWN_FRAMEWORK_PACKAGES` (consumed by render:framework-coverage), `ARCH_SRAM_DEFAULTS` (generated board.json carries an `architecture` key), and safety's `asil-decorators.ts` (referenced by the package README).
