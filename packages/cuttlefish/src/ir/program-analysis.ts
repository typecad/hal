/**
 * Combined program analysis - single-pass detection of multiple features.
 * 
 * Instead of traversing the IR multiple times for different checks
 * (hasConsoleCalls, hasArrayInObjectLiteral, hasThrowStatements, etc.),
 * this module performs all checks in a single traversal.
 */

import { ProgramIR, StatementIR, ExpressionIR, PlatformStrategy, Diagnostic } from "../api/index.js";
import { POLYFILL_HELPER_MAP } from "../api/shared/index.js";
import { parseCppType } from "../api/shared/cpp-type-ir.js";
import { analyzeResources } from "./resource-analysis.js";
import { loweredConsoleInCallback } from "./transformers/ui-callback-lowering.js";
import { watchPinSpecs, clickHandlers } from "./transformers/ui-call-resolver.js";
import { canvasBindings } from "./transformers/canvas-lowering.js";
import { getInputBindings, getListBindings } from "./transformers/ui-reactive.js";

export interface ProgramAnalysisResult {
  hasConsoleCalls: boolean;
  hasArrayInObjectLiteral: boolean;
  hasThrowStatements: boolean;
  hasStdMathCalls: boolean;
  usesVectorTypes: boolean;
  usesStdString: boolean;
  usesStdFunction: boolean;
  declaredTypes: string[];
  usedPolyfillHelpers: Set<string>;
  usesStringConversion: boolean;
  usesDateNow: boolean;
  usesMillis: boolean;
  usesNullish: boolean;
  /** True when this file actually emits a cuttlefish_nullish/exists/is_nullish CALL
   *  (e.g. from a `??` lowering), as opposed to just referencing the
   *  CUTTLEFISH_UNDEFINED macro via a `null`/`undefined` literal. Used to decide
   *  whether non-entry headers need the full nullish shim block. */
  usesNullishHelper: boolean;
  usesNum: boolean;
  usesTiming: boolean;
  usesWDT: boolean;
  usesStrPtr: boolean;
  // Native AVR peripheral usage — framework-avr gates its UART/SPI/TWI/
  // EEPROM/tone driver shims on these (mirroring how framework-arduino gates
  // __tc_Num/__tc_WDT on usesNum/usesWDT). Detected from HAL-op operation
  // names + lowered callee/raw-code references so usage that flows through
  // the HAL resolver (SPI0.begin() → spi.begin hal-op) is still seen.
  usesUart: boolean;
  usesSPI: boolean;
  usesI2C: boolean;
  usesEEPROM: boolean;
  usesTone: boolean;
  /** map()/constrain() Arduino-API calls. framework-avr gates its native
   *  _native_map/_native_constrain helpers on these (they're dead code
   *  otherwise — no other internal caller references them). */
  usesMap: boolean;
  usesConstrain: boolean;
  /** Comprehensive timing gate for the native millis() Timer0 ISR on AVR.
   *  True when the program directly uses millis/delay/micros, OR has hidden
   *  consumers of the soft clock: setInterval/setTimeout (timerCallCount),
   *  async functions (the runtime polls millis), or a mounted UI (per-frame
   *  tick injected by the emitter, not present in user source). */
  usesNativeTiming: boolean;
  hasSerialBegin: boolean;
  hasGenerators: boolean;
  usesStdMap: boolean;
  /** Number of setInterval/setTimeout call sites in the program. Used to size
   *  __tc_TimerRuntime::MAX_TIMERS to the observed count (floor 1) rather than
   *  a blind constant, so a one-timer program links one slot, not eight. */
  timerCallCount: number;
  /** ESP32 peripheral usage — framework-esp32 gates its IDF driver blocks and
   *  forced includes on these. Detected from HAL-op operation names, the same
   *  way usesUart/usesSPI/usesI2C are. Other frameworks have no CUTTLEFISH_*
   *  blocks with these marker names so the setup.ts filters are no-ops there. */
  usesGPIO: boolean;
  usesPWM: boolean;
  usesRmt: boolean;
  usesADC: boolean;
  usesDAC: boolean;
  usesPower: boolean;
  usesWdt: boolean;
  usesInterrupts: boolean;
  usesPulse: boolean;
  usesShift: boolean;
  /** WiFi / HTTP / BLE usage — framework-esp32 gates the __tc_wifi/__tc_http/
   *  __tc_ble runtime shims and their esp_wifi/esp_http_client/nimble includes
   *  on these. Detected from wifi.* / http.* / ble.* HAL-op operation names. */
  usesWifi: boolean;
  usesHttp: boolean;
  usesBle: boolean;
  /** Preferences (NVS) usage — framework-esp32 gates the __tc_prefs runtime shim
   *  and its nvs_flash/nvs includes on this. Detected from preferences.* ops. */
  usesPreferences: boolean;
}

// Regex for std:: math calls
const MATH_PATTERN = /\bstd::(floor|ceil|round|trunc|sqrt|pow|sin|cos|tan|asin|acos|atan|abs|max|min)\b/;

/**
 * Analyze an expression for all features in a single pass.
 */
function analyzeExpression(
  expr: ExpressionIR,
  result: Pick<ProgramAnalysisResult, 'hasConsoleCalls' | 'hasStdMathCalls' | 'usesVectorTypes' | 'usesStdString' | 'usesStdFunction' | 'declaredTypes' | 'usedPolyfillHelpers' | 'usesStringConversion' | 'usesDateNow' | 'usesMillis' | 'usesNullish' | 'usesNullishHelper' | 'usesNum' | 'usesTiming' | 'usesWDT' | 'usesStrPtr' | 'timerCallCount' | 'usesUart' | 'usesSPI' | 'usesI2C' | 'usesEEPROM' | 'usesTone' | 'usesMap' | 'usesConstrain' | 'usesGPIO' | 'usesPWM' | 'usesRmt' | 'usesADC' | 'usesDAC' | 'usesPower' | 'usesWdt' | 'usesInterrupts' | 'usesPulse' | 'usesShift' | 'usesWifi' | 'usesHttp' | 'usesBle' | 'usesPreferences'>,
  strategy: PlatformStrategy
): void {
  if (!expr || typeof expr !== 'object' || !expr.kind) {
    return;
  }

  switch (expr.kind) {
    case "raw":
      if (MATH_PATTERN.test(expr.value)) {
        result.hasStdMathCalls = true;
      }
      for (const [pattern, helperNames] of Object.entries(POLYFILL_HELPER_MAP)) {
        if (expr.value.includes(pattern)) {
          for (const name of helperNames) {
            result.usedPolyfillHelpers.add(name);
          }
        }
        // Also check for already-lowered __tc_ names
        for (const name of helperNames) {
          if (expr.value.includes(name)) {
            result.usedPolyfillHelpers.add(name);
          }
        }
      }
      if (/\bString\s*\(/.test(expr.value)) {
        result.usesStringConversion = true;
      }
      if (/Date\.now\s*\(/.test(expr.value) || /Date::now\s*\(/.test(expr.value)) {
        result.usesDateNow = true;
      }
      if (/\bmillis\s*\(/.test(expr.value)) {
        result.usesMillis = true;
      }
      if (expr.value.includes('cuttlefish_nullish(') || expr.value.includes('cuttlefish_exists(') || expr.value.includes('cuttlefish_is_nullish(')) {
        result.usesNullish = true;
        result.usesNullishHelper = true;
      }
      if (/\bNum\b/.test(expr.value)) {
        result.usesNum = true;
      }
      if (/\bTiming\b/.test(expr.value)) {
        result.usesTiming = true;
      }
      if (/\bWDT\b/.test(expr.value)) {
        result.usesWDT = true;
      }
      if (expr.value.includes('__tc_str_ptr')) {
        result.usesStrPtr = true;
      }
      break;

    case "method-call":
      if (strategy.isConsoleCall(expr.callee)) {
        result.hasConsoleCalls = true;
      }
      if (/\bmillis\b/.test(expr.callee) || /\bdelay\b/.test(expr.callee) || /\bmicros\b/.test(expr.callee)) {
        result.usesMillis = true;
      }
      if (expr.callee === "Date.now" || expr.callee === "Date::now") {
        result.usesDateNow = true;
      }
      if (expr.callee === "String") {
        result.usesStringConversion = true;
      }
      if (MATH_PATTERN.test(expr.callee)) {
        result.hasStdMathCalls = true;
      }
      for (const [pattern, helperNames] of Object.entries(POLYFILL_HELPER_MAP)) {
        const methodName = pattern.startsWith('.') ? pattern.slice(1, -1) : pattern.slice(0, -1);
        if (expr.callee.includes(pattern) || expr.callee.endsWith("." + methodName) || expr.callee === methodName) {
          for (const name of helperNames) {
            result.usedPolyfillHelpers.add(name);
          }
        }
        for (const name of helperNames) {
          if (expr.callee.includes(name)) {
            result.usedPolyfillHelpers.add(name);
          }
        }
      }
      if (expr.callee.startsWith("Num.") || expr.callee === "Num") {
        result.usesNum = true;
      }
      if (expr.callee.startsWith("Timing.") || expr.callee === "Timing") {
        result.usesTiming = true;
      }
      if (expr.callee.startsWith("WDT.") || expr.callee === "WDT") {
        result.usesWDT = true;
      }
      // Native AVR peripheral usage from namespace-prefixed method calls
      // (Serial.* / SPI.* / Wire.* / EEPROM.*). The HAL resolver lowers these
      // to structured hal-ops (detected in analyzeStatement) OR to bare
      // lowered calls; these checks cover the pre-lowering and direct forms.
      if (expr.callee.startsWith("Serial.") || expr.callee === "Serial") {
        result.usesUart = true;
      }
      if (expr.callee.startsWith("SPI.") || expr.callee === "SPI") {
        result.usesSPI = true;
      }
      if (expr.callee.startsWith("Wire.") || expr.callee === "Wire") {
        result.usesI2C = true;
      }
      if (expr.callee.startsWith("EEPROM.") || expr.callee === "EEPROM") {
        result.usesEEPROM = true;
      }
      // map()/constrain() Arduino-API calls appear as method-call exprs
      // (callee "map"/"constrain"). framework-avr lowers these to _native_map/
      // _native_constrain via symbol aliases, so the helpers are dead code
      // unless the program actually calls them.
      if (expr.callee === "map") result.usesMap = true;
      if (expr.callee === "constrain") result.usesConstrain = true;
      // Count setInterval/setTimeout call sites (post-rename callee names) so
      // __tc_TimerRuntime::MAX_TIMERS can be sized to the observed count.
      if (expr.callee === "__tc_setInterval" || expr.callee === "__tc_setTimeout"
        || expr.callee === "setInterval" || expr.callee === "setTimeout") {
        result.timerCallCount++;
      }
      for (const arg of expr.args) {
        analyzeExpression(arg, result, strategy);
      }
      break;

    case "identifier":
      // expression-to-ir lowers the TS `null` literal to the "nullptr" sentinel
      // (routed through nullValue() at render time, which yields CUTTLEFISH_UNDEFINED
      // on native/arduino). Include it so usesNullish triggers the defining shim.
      if (expr.value === "null" || expr.value === "undefined" || expr.value === "nullptr" || expr.value === "CUTTLEFISH_UNDEFINED") {
        result.usesNullish = true;
      }
      break;

    case "string":
      for (const [pattern, helperNames] of Object.entries(POLYFILL_HELPER_MAP)) {
        if (expr.value.includes(pattern)) {
          for (const name of helperNames) {
            result.usedPolyfillHelpers.add(name);
          }
        }
        // Also check for already-lowered __tc_ names (e.g. in __EMIT__ calls from HAL resolver)
        for (const name of helperNames) {
          if (expr.value.includes(name)) {
            result.usedPolyfillHelpers.add(name);
          }
        }
      }
      break;

    case "array":
      result.usesVectorTypes = true;
      for (const element of expr.elements) {
        analyzeExpression(element, result, strategy);
      }
      break;

    case "object":
      for (const field of expr.fields) {
        analyzeExpression(field.value, result, strategy);
      }
      break;

    case "ternary":
      analyzeExpression(expr.condition, result, strategy);
      analyzeExpression(expr.whenTrue, result, strategy);
      analyzeExpression(expr.whenFalse, result, strategy);
      break;

    case "await":
      analyzeExpression(expr.value, result, strategy);
      break;

    case "instanceof":
      analyzeExpression(expr.object, result, strategy);
      break;

    case "spread_array":
      analyzeExpression(expr.spreadExpr, result, strategy);
      for (const element of expr.additionalElements) {
        analyzeExpression(element, result, strategy);
      }
      break;

    case "binary":
      if (expr.operator === "**") {
        result.hasStdMathCalls = true;
      }
      analyzeExpression(expr.left, result, strategy);
      analyzeExpression(expr.right, result, strategy);
      break;

    case "unary":
      analyzeExpression(expr.operand, result, strategy);
      break;

    case "property-access":
      analyzeExpression(expr.object, result, strategy);
      break;

    case "element-access":
      analyzeExpression(expr.object, result, strategy);
      analyzeExpression(expr.index, result, strategy);
      break;

    case "string_concat":
    case "template_string":
      result.usesStringConversion = true;
      if (expr.kind === "string_concat") {
        for (const part of expr.parts) {
          analyzeExpression(part, result, strategy);
        }
      } else {
        analyzeExpression(expr.expression, result, strategy);
      }
      break;

    case "hal-expr":
      // Value-position HAL ops (e.g. `const ip = WiFi.localIP()` lowers to a
      // hal-expr initializer) never pass through the statement-level hal-op
      // detection above, so mirror the wifi./http. flag detection here. These
      // gate the framework-esp32 __tc_wifi/__tc_http runtime shims.
      if (expr.operation && typeof expr.operation.operation === "string") {
        const opName = expr.operation.operation;
        if (opName.startsWith("wifi.")) result.usesWifi = true;
        if (opName.startsWith("http.")) result.usesHttp = true;
        if (opName.startsWith("ble.")) result.usesBle = true;
        if (opName.startsWith("preferences.")) result.usesPreferences = true;
      }
      break;
  }
}

/**
 * Analyze a statement for all features in a single pass.
 */
function analyzeStatement(
  statement: StatementIR,
  result: ProgramAnalysisResult,
  strategy: PlatformStrategy
): void {
  if (!statement || typeof statement !== 'object' || !statement.kind) {
    return;
  }

  switch (statement.kind) {
    case "call":
      if (strategy.isConsoleCall(statement.callee)) {
        result.hasConsoleCalls = true;
      }
      if (statement.callee === "Serial.begin" || statement.callee.endsWith(".begin")) {
        result.hasSerialBegin = true;
      }
      if (statement.callee === "String") {
        result.usesStringConversion = true;
      }
      if (statement.callee === "Date.now" || statement.callee === "Date::now") {
        result.usesDateNow = true;
      }
      if (statement.callee === "millis" || statement.callee === "delay") {
        result.usesMillis = true;
      }
      // Awaited HAL wait markers become async state-machine poll states that
      // arm deadlines via currentTimeMillis().
      if (statement.callee === "__WIFI_WAIT__" || statement.callee === "__HTTP_WAIT__" || statement.callee === "__HAL_WAIT__") {
        result.usesMillis = true;
      }
      // Namespace-qualified polyfill entry points used as bare call statements
      // (e.g. `Timing.delay(5);`). The expression-level analyzer (case
      // "method-call") already checks these prefixes, but a statement-form call
      // never becomes a method-call expression — it stays a `call` statement —
      // so without these mirrors `usesTiming`/`usesNum`/`usesWDT` stayed false
      // and the defining shim was filtered out (avr-g++: "'Timing' was not
      // declared in this scope"). Demo #30 Finding A.
      if (statement.callee.startsWith("Timing.") || statement.callee === "Timing") {
        result.usesTiming = true;
      }
      if (statement.callee.startsWith("Num.") || statement.callee === "Num") {
        result.usesNum = true;
      }
      if (statement.callee.startsWith("WDT.") || statement.callee === "WDT") {
        result.usesWDT = true;
      }
      // Native AVR peripheral usage from statement-form calls. tone()/noTone()
      // are bare Arduino-API calls; console.* / Serial.* drive UART; the
      // namespace prefixes mirror the method-call checks above.
      if (statement.callee === "tone" || statement.callee === "noTone") {
        result.usesTone = true;
      }
      // console.* is NOT UART: on ESP-IDF it lowers to printf, on Arduino to
      // Serial via hasConsoleCalls. Only real UART HAL / Serial peripheral
      // usage should gate the uart shim (avoids unused __tc_uart*_init).
      if (statement.callee.startsWith("_uart_")) {
        result.usesUart = true;
      }
      if (statement.callee.startsWith("Serial.") || statement.callee === "Serial") {
        result.usesUart = true;
      }
      if (statement.callee.startsWith("SPI.") || statement.callee === "SPI") {
        result.usesSPI = true;
      }
      if (statement.callee.startsWith("Wire.") || statement.callee === "Wire") {
        result.usesI2C = true;
      }
      if (statement.callee.startsWith("EEPROM.") || statement.callee === "EEPROM") {
        result.usesEEPROM = true;
      }
      // Statement-form map()/constrain() mirror the method-call checks above.
      if (statement.callee === "map") result.usesMap = true;
      if (statement.callee === "constrain") result.usesConstrain = true;
      // The HAL resolver lowers WDT.*/Timing.* namespace calls to bare AVR
      // library functions (WDT.reset() → wdt_reset(), Timing.delay() → delay(),
      // Timing.millis() → millis()). When that happens the `WDT.`/`Timing.`
      // prefix is gone, so the namespace checks above miss it and the defining
      // shim gets filtered out (avr-g++: "'wdt_reset' was not declared in this
      // scope"). Detect the lowered names directly. Demo #32 Finding A.
      if (statement.callee === "wdt_reset" || statement.callee === "wdt_enable" || statement.callee === "wdt_disable") {
        result.usesWDT = true;
      }
      for (const [pattern, helperNames] of Object.entries(POLYFILL_HELPER_MAP)) {
        const methodName = pattern.startsWith('.') ? pattern.slice(1, -1) : pattern.slice(0, -1);
        if (statement.callee === methodName || statement.callee.endsWith("." + methodName)) {
          for (const name of helperNames) {
            result.usedPolyfillHelpers.add(name);
          }
        }
        // Also detect already-lowered __tc_* helper calls — including raw-statement
        // wrappers (`__RAW_STMT____tc_pop(...)`) produced by the structural
        // vector-method lowering in call-statement.ts. Without this, a statement
        // form like `arr.pop();` (lowered to `__RAW_STMT____tc_pop(arr)`) wouldn't
        // register the polyfill, and the helper definition would be filtered out.
        for (const name of helperNames) {
          if (statement.callee.includes(name)) {
            result.usedPolyfillHelpers.add(name);
          }
        }
      }
      for (const arg of statement.args) {
        analyzeExpression(arg, result, strategy);
      }
      break;

    case "var_decl":
      result.declaredTypes.push(statement.cppType);
      if (parseCppType(statement.cppType).kind === "strPtr") {
        result.usesStrPtr = true;
      }
      if (statement.initializer) {
        analyzeExpression(statement.initializer, result, strategy);
        // Check for array in object literal
        if (statement.initializer.kind === "array") {
          result.hasArrayInObjectLiteral = true;
        }
      }
      break;

    case "assign":
      analyzeExpression(statement.value, result, strategy);
      break;

    case "return":
      if (statement.value) {
        analyzeExpression(statement.value, result, strategy);
      }
      break;

    case "throw":
      result.hasThrowStatements = true;
      analyzeExpression(statement.value, result, strategy);
      break;

    case "while":
    case "do_while":
      analyzeExpression(statement.condition, result, strategy);
      for (const nested of statement.body) {
        analyzeStatement(nested, result, strategy);
      }
      break;

    case "if":
      analyzeExpression(statement.condition, result, strategy);
      for (const nested of statement.thenBranch) {
        analyzeStatement(nested, result, strategy);
      }
      for (const nested of statement.elseBranch ?? []) {
        analyzeStatement(nested, result, strategy);
      }
      break;

    case "for":
      if (statement.initializer) {
        analyzeStatement(statement.initializer, result, strategy);
      }
      if (statement.condition) {
        analyzeExpression(statement.condition, result, strategy);
      }
      if (statement.increment) {
        analyzeStatement(statement.increment, result, strategy);
      }
      for (const nested of statement.body) {
        analyzeStatement(nested, result, strategy);
      }
      break;

    case "for_of":
      analyzeStatement(statement.variable, result, strategy);
      analyzeExpression(statement.iterable, result, strategy);
      for (const nested of statement.body) {
        analyzeStatement(nested, result, strategy);
      }
      break;

    case "for_in":
      analyzeStatement(statement.variable, result, strategy);
      analyzeExpression(statement.object, result, strategy);
      for (const nested of statement.body) {
        analyzeStatement(nested, result, strategy);
      }
      break;

    case "switch":
      analyzeExpression(statement.expression, result, strategy);
      for (const caseClause of statement.cases) {
        if (caseClause.value) {
          analyzeExpression(caseClause.value, result, strategy);
        }
        for (const nested of caseClause.body) {
          analyzeStatement(nested, result, strategy);
        }
      }
      break;

    case "try":
      for (const nested of statement.tryBlock) {
        analyzeStatement(nested, result, strategy);
      }
      for (const nested of statement.catchBlock ?? []) {
        analyzeStatement(nested, result, strategy);
      }
      for (const nested of statement.finallyBlock ?? []) {
        analyzeStatement(nested, result, strategy);
      }
      break;

    case "hal-op":
      // Structured HAL ops carry a typed operation name (e.g. "spi.begin",
      // "i2c.read_byte", "tone.play", "uart.write") rather than raw code.
      // Detect peripheral usage here so framework-avr's driver shims can be
      // gated on actual use. Without this, SPI0.begin() → spi.begin hal-op
      // would be invisible (no raw code to scan) and the SPI driver would
      // always be emitted. Same blind spot the wdt.* fix below the raw-code
      // block addresses for the watchdog.
      if (statement.operation && typeof statement.operation.operation === "string") {
        const opName = statement.operation.operation;
        if (opName.startsWith("spi.")) result.usesSPI = true;
        if (opName.startsWith("i2c.")) result.usesI2C = true;
        if (opName.startsWith("tone.")) result.usesTone = true;
        if (opName.startsWith("uart.")) result.usesUart = true;
        // Display HAL ops (display.init from ui.mount, display.flush per frame)
        // always imply GPIO usage (CS/DC/RST pins). Native SPI/I2C display
        // adapters emit their own transport #includes (driver/spi_master.h,
        // driver/i2c_master.h) — we don't force usesSPI/usesI2C here because
        // that would pull headers even for non-display SPI/I2C code, and the
        // display's transport type can't be determined from the op alone.
        if (opName.startsWith("display.")) {
          result.usesGPIO = true;
        }
        // ESP32 peripheral usage — framework-esp32 gates IDF driver blocks
        // and forced includes on these. No-op for other frameworks (their
        // shimLines emit no CUTTLEFISH_* blocks with these marker names).
        if (opName.startsWith("gpio."))      result.usesGPIO = true;
        if (opName.startsWith("pwm."))       result.usesPWM = true;
        if (opName.startsWith("rmt."))       result.usesRmt = true;
        if (opName.startsWith("adc."))       result.usesADC = true;
        if (opName.startsWith("dac."))       result.usesDAC = true;
        if (opName.startsWith("power."))     result.usesPower = true;
        if (opName.startsWith("wdt."))       result.usesWdt = true;
        if (opName.startsWith("interrupt.")) result.usesInterrupts = true;
        if (opName.startsWith("pulse."))     result.usesPulse = true;
        if (opName.startsWith("shift."))     result.usesShift = true;
        if (opName.startsWith("wifi."))      result.usesWifi = true;
        if (opName.startsWith("http."))      result.usesHttp = true;
        if (opName.startsWith("ble."))       result.usesBle = true;
        if (opName.startsWith("preferences.")) result.usesPreferences = true;
        // Timing HAL ops (timing.delay/millis/micros) carry a typed operation
        // name, not raw code, so the regex scans below miss them. Mirror the
        // raw-code timing detection here so usesMillis/usesTiming (and thus
        // usesNativeTiming) fire for `delay()`/`millis()` on AVR.
        if (opName === "timing.delay" || opName === "timing.delay_microseconds"
          || opName === "timing.millis" || opName === "timing.micros") {
          result.usesTiming = true;
          result.usesMillis = true;
        }
      }
      // Scan raw C++ code in HAL ops for polyfill helper usage
      if (statement.operation && statement.operation.operation === "raw" && typeof statement.operation.code === "string") {
        const code = statement.operation.code;
        for (const [pattern, helperNames] of Object.entries(POLYFILL_HELPER_MAP)) {
          if (code.includes(pattern)) {
            for (const name of helperNames) {
              result.usedPolyfillHelpers.add(name);
            }
          }
          for (const name of helperNames) {
            if (code.includes(name)) {
              result.usedPolyfillHelpers.add(name);
            }
          }
        }
        // The HAL resolver lowers WDT.*/Timing.* namespace calls to bare AVR
        // library functions inside hal-op raw code (WDT.reset() → wdt_reset(),
        // Timing.delay() → delay()). The namespace prefix is gone, so detect
        // the lowered names to keep the defining shim/include alive.
        // Demo #32 Finding B.
        if (/\bwdt_(reset|enable|disable)\b/.test(code)) {
          result.usesWDT = true;
        }
        if (/\b(millis|micros|delay|delayMicroseconds)\s*\(/.test(code)) {
          result.usesTiming = true;
          result.usesMillis = true;
        }
        // Native AVR peripheral usage inside raw hal-op code (e.g. the
        // EEPROM namespace lowers to `EEPROM.write(...)` in a raw hal-op;
        // Serial/SPI/Wire may appear as lowered library calls too).
        if (/\bEEPROM\b/.test(code) || /\beeprom_(read|write|update)_byte\b/.test(code)) {
          result.usesEEPROM = true;
        }
        if (/\bSerial\b/.test(code)) {
          result.usesUart = true;
        }
        if (/\bSPI\b/.test(code)) {
          result.usesSPI = true;
        }
        if (/\bWire\b/.test(code)) {
          result.usesI2C = true;
        }
      }
      break;

    case "update":
      // update statements just increment/decrement a variable
      break;

    case "break":
    case "continue":
      // no expressions to analyze
      break;

    case "super_call":
      for (const arg of statement.args) {
        analyzeExpression(arg, result, strategy);
      }
      break;

    case "labeled":
    case "block":
      const body = statement.kind === "labeled" ? statement.body : statement.body;
      for (const nested of body) {
        analyzeStatement(nested, result, strategy);
      }
      break;
  }
}


/**
 * Analyze a program IR in a single pass to detect all features.
 * This replaces multiple separate traversals with one combined traversal.
 */
export function analyzeProgram(program: ProgramIR, strategy: PlatformStrategy): ProgramAnalysisResult {
  const result: ProgramAnalysisResult = {
    hasConsoleCalls: false,
    hasArrayInObjectLiteral: false,
    hasThrowStatements: false,
    hasStdMathCalls: false,
    usesVectorTypes: false,
    usesStdString: false,
    usesStdFunction: false,
    declaredTypes: [],
    usedPolyfillHelpers: new Set(),
    usesStringConversion: false,
    usesDateNow: false,
    usesMillis: false,
    usesNullish: false,
    usesNullishHelper: false,
    usesNum: false,
    usesTiming: false,
    usesWDT: false,
    usesStrPtr: false,
    usesUart: false,
    usesSPI: false,
    usesI2C: false,
    usesEEPROM: false,
    usesTone: false,
    usesMap: false,
    usesConstrain: false,
    usesNativeTiming: false,
    hasSerialBegin: false,
    hasGenerators: false,
    usesStdMap: false,
    timerCallCount: 0,
    usesGPIO: false,
    usesPWM: false,
    usesRmt: false,
    usesADC: false,
    usesDAC: false,
    usesPower: false,
    usesWdt: false,
    usesInterrupts: false,
    usesPulse: false,
    usesShift: false,
    usesWifi: false,
    usesHttp: false,
    usesBle: false,
    usesPreferences: false,
  };

  // Analyze type aliases
  for (const typeAlias of program.typeAliases) {
    result.declaredTypes.push(typeAlias.cppType);
    if (typeAlias.structFields) {
      for (const field of typeAlias.structFields) {
        result.declaredTypes.push(field.cppType);
      }
    }
    if (typeAlias.variantStructs) {
      for (const variant of typeAlias.variantStructs) {
        for (const field of variant.fields) {
          result.declaredTypes.push(field.cppType);
        }
      }
    }
  }

  // Analyze interfaces for field types and index signatures
  for (const iface of program.interfaces) {
    for (const field of iface.fields) {
      result.declaredTypes.push(field.cppType);
    }
    if (iface.indexSignature) {
      result.usesStdMap = true;
      result.declaredTypes.push(iface.indexSignature.keyType);
      result.declaredTypes.push(iface.indexSignature.valueType);
    }
  }

  // Analyze functions
  for (const fn of program.functions) {
    if (fn.isGenerator) result.hasGenerators = true;
    result.declaredTypes.push(fn.returnType);
    for (const parameter of fn.parameters) {
      result.declaredTypes.push(parameter.cppType);
    }
    for (const statement of fn.statements) {
      analyzeStatement(statement, result, strategy);
    }
  }

  // Analyze top-level statements
  for (const statement of program.topLevelStatements) {
    analyzeStatement(statement, result, strategy);
  }

  // Analyze classes
  for (const classDef of program.classes) {
    for (const field of classDef.fields) {
      result.declaredTypes.push(field.cppType);
      if (field.initializer) {
        analyzeExpression(field.initializer, result, strategy);
        if (field.initializer.kind === "array") {
          result.hasArrayInObjectLiteral = true;
        }
      }
    }
    for (const method of classDef.methods) {
      result.declaredTypes.push(method.returnType);
      for (const parameter of method.parameters) {
        result.declaredTypes.push(parameter.cppType);
      }
      for (const statement of method.statements) {
        analyzeStatement(statement, result, strategy);
      }
    }
    if (classDef.constructor) {
      for (const parameter of classDef.constructor.parameters) {
        result.declaredTypes.push(parameter.cppType);
      }
      for (const statement of classDef.constructor.statements) {
        analyzeStatement(statement, result, strategy);
      }
    }
  }

  // Post-process declared types to detect std:: usage
  for (const typeName of result.declaredTypes) {
    if (typeName.includes("std::vector<")) {
      result.usesVectorTypes = true;
    }
    if (strategy.needsStdVector() && typeName.includes("__tc_StaticArray<")) {
      result.usesVectorTypes = true;
    }
    // Track __tc_StaticArray type usage on ALL targets so the defining
    // polyfill is retained by filterPolyfillHelpers (the struct's constructor
    // matches the helper-name regex but is never a user call site, so without
    // this the struct would be filtered out and `__tc_StaticArray<int,N>`
    // undeclared — avr-g++: "'__tc_StaticArray' was not declared"). Demo #23.
    if (typeName.includes("__tc_StaticArray<")) {
      result.usedPolyfillHelpers.add("__tc_StaticArray");
    }
    if (typeName.includes("std::string")) {
      result.usesStdString = true;
      // The Arduino/AVR strategy normalizes `std::string` → `__tc_str_ptr` at
      // emit time (Strategy.normalizeCppType). The `usesStrPtr` flag gates
      // emission of the `__tc_str_ptr` shim block, but the per-statement
      // detector at the `var_decl` arm compares the PRE-normalization cppType
      // (still `std::string`) against `parseCppType(...).kind === "strPtr"` —
      // which never matches, so a string-typed LOCAL/field/return that emits
      // as `__tc_str_ptr` silently drops its own shim and fails at g++ time
      // ("'__tc_str_ptr' does not name a type"). Resolving the type through
      // the strategy's normalizer here — the single broadest chokepoint over
      // every declared type (locals, fields, params, returns, aliases) — makes
      // the analysis agree with the emit path on every target. On native the
      // normalizer leaves `std::string` alone, so this is a no-op there.
      if (strategy.normalizeCppType("std::string") === "__tc_str_ptr") {
        result.usesStrPtr = true;
      }
    }
    if (typeName.includes("std::function<")) {
      result.usesStdFunction = true;
    }
    if (typeName.includes("std::map<")) {
      result.usesStdMap = true;
    }
  }

  // Analyze UI callback bodies that live outside program.functions
  // (onClick / watchPin / drawCanvas / bindInput / bindList). They now carry
  // StatementIR[] from the main lowerStatementList pipeline, so console /
  // helper usage is visible here the same way setInterval bodies are.
  for (const wp of watchPinSpecs()) {
    for (const stmt of wp.bodyStatements ?? []) analyzeStatement(stmt, result, strategy);
  }
  for (const ch of clickHandlers()) {
    for (const stmt of ch.bodyStatements ?? []) analyzeStatement(stmt, result, strategy);
  }
  for (const spec of canvasBindings()) {
    for (const stmt of spec.bodyStatements ?? []) analyzeStatement(stmt, result, strategy);
  }
  for (const spec of getInputBindings()) {
    for (const stmt of spec.bodyStatements ?? []) analyzeStatement(stmt, result, strategy);
  }
  for (const spec of getListBindings()) {
    for (const stmt of spec.countStatements ?? []) analyzeStatement(stmt, result, strategy);
    for (const stmt of spec.itemStatements ?? []) analyzeStatement(stmt, result, strategy);
    for (const stmt of spec.tapStatements ?? []) analyzeStatement(stmt, result, strategy);
  }

  // Console calls lowered inside leftover string-baked UI callbacks are baked
  // into callbackBody strings, not IR nodes, so the statement walk above can't
  // see them. Consult the flag recorded during lowering so hasConsoleCalls
  // reflects them — this is what gates auto-injected Serial.begin(baud) and
  // <iostream>.
  if (loweredConsoleInCallback()) {
    result.hasConsoleCalls = true;
  }

  // Derive the comprehensive native-timing gate for the AVR millis() Timer0
  // ISR. The ISR is needed whenever the program touches the soft clock
  // directly (millis/delay/micros) OR has a hidden consumer: setInterval/
  // setTimeout (the scheduler polls millis), or async functions (the runtime
  // polls millis). The per-frame UI tick is injected by the emitter, not
  // present in user source — the setup emitter ORs entryHasUI() in at the
  // consume site. Without this gate, every AVR program pulled in the Timer0
  // ISR even when it never uses timing.
  const hasAsync = program.functions.some(fn => fn.isAsync);
  result.usesNativeTiming = result.usesMillis
    || result.usesTiming
    || result.timerCallCount > 0
    || hasAsync;

  return result;
}
