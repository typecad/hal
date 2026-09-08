/**
 * Combined program analysis - single-pass detection of multiple features.
 *
 * Instead of traversing the IR multiple times for different checks
 * (hasArrayInObjectLiteral, hasThrowStatements, etc.),
 * this module performs all checks in a single traversal.
 */

import { ProgramIR, StatementIR, ExpressionIR, PlatformStrategy, Diagnostic } from "../api/index.js";
import { POLYFILL_HELPER_MAP } from "../api/shared/index.js";
import { parseCppType } from "../api/shared/cpp-type-ir.js";
import { analyzeResources } from "./resource-analysis.js";
import { watchPinSpecs, clickHandlers } from "./transformers/ui-call-resolver.js";
import { canvasBindings } from "./transformers/canvas-lowering.js";
import { getInputBindings, getListBindings } from "./transformers/ui-reactive.js";
import { getTranspileResolvedHalOps } from "./build-ir-state.js";

/**
 * Map one HAL op name onto the peripheral usage flags its lowering requires.
 * Called from three places: the hal-expr expression case, the hal-op statement
 * case, and analyzeProgram's merge of transpile-resolved ops (ops baked into
 * another HAL method's emit lines never appear as IR nodes, so without the
 * merge their peripheral's init block + include were dropped — e.g.
 * `sense.readMillivolts()` inside `USB0.writeLine(...)` compiled against a
 * missing adc.h). Keep in sync with the per-strategy gating in the frameworks.
 */
function applyHalOpUsageFlags(
  opName: string,
  result: Pick<
    ProgramAnalysisResult,
    | 'usesGPIO' | 'usesDisplay' | 'usesDigitalRead' | 'usesPWM' | 'usesRmt'
    | 'usesADC' | 'usesDAC' | 'usesWdt' | 'usesSPI' | 'usesI2C' | 'usesUart' | 'usesUsb'
    | 'usedPolyfillHelpers'
    | 'usesInterrupts' | 'usesPulse' | 'usesShift'
    | 'usesWifi' | 'usesWifiConnect' | 'usesWifiConnectBlocking' | 'usesWifiScan'
    | 'usesWifiQuery' | 'usesWifiConfig'
    | 'usesHttp' | 'usesBle' | 'usesPreferences' | 'usesRandom' | 'usesFS'
    | 'usesMdns' | 'usesMqtt' | 'usesOta' | 'usesTemp' | 'usesSensor'
    | 'usesHwtimer' | 'usesCapacitive'
  >,
): void {
  if (opName.startsWith("display.")) {
    result.usesGPIO = true;
    result.usesDisplay = true;
  }
  if (opName.startsWith("gpio."))      result.usesGPIO = true;
  if (opName === "gpio.read") result.usesDigitalRead = true;
  if (opName.startsWith("pwm."))       result.usesPWM = true;
  if (opName.startsWith("rmt."))       result.usesRmt = true;
  if (opName.startsWith("adc."))       result.usesADC = true;
  if (opName.startsWith("dac."))       result.usesDAC = true;
  if (opName.startsWith("wdt."))       result.usesWdt = true;
  if (opName.startsWith("spi."))       result.usesSPI = true;
  if (opName.startsWith("i2c."))       result.usesI2C = true;
  if (opName.startsWith("uart."))      result.usesUart = true;
  if (opName.startsWith("usb."))       result.usesUsb = true;
  // Safety HAL ops (@typecad/safety) — map each op to the __tc_safety_*
  // polyfill helper it triggers, so the mode-table and voter polyfills
  // survive tree-shaking when actually used. Matches the resolveSafetyOp
  // output naming. Cast through string because the HALOpIR operation union is
  // closed and doesn't include safety.* ops (those are owned by the optional
  // @typecad/safety package).
  const safetyOpName = opName as string;
  if (safetyOpName === "safety.record_pin_mode") {
    result.usedPolyfillHelpers.add("__tc_safety_record_pin_mode");
  }
  if (safetyOpName === "safety.read_safe") {
    result.usedPolyfillHelpers.add("__tc_safety_read_safe");
  }
  if (safetyOpName === "safety.write_verify") {
    result.usedPolyfillHelpers.add("__tc_safety_write_verify");
  }
  if (opName.startsWith("interrupt.")) result.usesInterrupts = true;
  if (opName.startsWith("pulse."))     result.usesPulse = true;
  if (opName.startsWith("shift."))     result.usesShift = true;
  if (opName.startsWith("wifi.")) {
    result.usesWifi = true;
    if (opName === "wifi.join" || opName === "wifi.connect_start" || opName === "wifi.disconnect") {
      result.usesWifiConnect = true;
      if (opName === "wifi.join") result.usesWifiConnectBlocking = true;
    }
    else if (opName.startsWith("wifi.scan")) result.usesWifiScan = true;
    else if (opName === "wifi.is_connected" || opName === "wifi.local_ip" || opName === "wifi.rssi" || opName === "wifi.mac") result.usesWifiQuery = true;
    else if (opName === "wifi.on_event") result.usesWifiConfig = true;
  }
  if (opName.startsWith("http."))      result.usesHttp = true;
  if (opName.startsWith("ble."))       result.usesBle = true;
  if (opName.startsWith("preferences.")) result.usesPreferences = true;
  if (opName.startsWith("random."))    result.usesRandom = true;
  if (opName.startsWith("fs."))        result.usesFS = true;
  if (opName.startsWith("mdns."))      result.usesMdns = true;
  if (opName.startsWith("mqtt."))      result.usesMqtt = true;
  if (opName.startsWith("ota."))       result.usesOta = true;
  if (opName.startsWith("temp."))      result.usesTemp = true;
  if (opName.startsWith("sensor."))    result.usesSensor = true;
  if (opName.startsWith("hwtimer.") || opName.startsWith("counter."))   result.usesHwtimer = true;
  if (opName.startsWith("capacitive.")) result.usesCapacitive = true;
}

export interface ProgramAnalysisResult {
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
  /** True when the program references millis()/micros() directly — WITHOUT the
   *  delay() conflation usesMillis carries (framework-avr needs delay to keep
   *  the native timing ISR alive, but frameworks whose delay() lowers straight
   *  to a native sleep — e.g. Zephyr's k_msleep — must not treat a delay-only
   *  program as a millis() consumer). */
  usesWallClock: boolean;
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
  // tone driver shims on these (mirroring how framework-arduino gates
  // __tc_Num/__tc_WDT on usesNum/usesWDT). Detected from HAL-op operation
  // names + lowered callee/raw-code references so usage that flows through
  // the HAL resolver (SPI0.begin() → spi.begin hal-op) is still seen.
  usesUart: boolean;
  /** USB CDC-ACM serial port used (usb.* hal-ops) */
  usesUsb: boolean;
  usesSPI: boolean;
  usesI2C: boolean;
  /** map()/constrain() Arduino-API calls. framework-avr gates its native
   *  _native_map/_native_constrain helpers on these (they're dead code
   *  otherwise — no other internal caller references them). */
  usesMap: boolean;
  usesConstrain: boolean;
  /** Comprehensive timing gate for the native millis() Timer0 ISR on AVR.
   *  True when the program directly uses millis/delay/micros, OR has hidden
   *  consumers of the soft clock: async functions (the runtime polls
   *  millis), or a mounted UI (per-frame tick injected by the emitter,
   *  not present in user source). */
  usesNativeTiming: boolean;
  hasSerialBegin: boolean;
  hasGenerators: boolean;
  usesStdMap: boolean;
  /** True when any function is declared `async` — the async runtime polls
   *  millis() every pump even when no timing call appears in user source
   *  (Async.sleep lowers to a raw hal-op the text scanners can't see). */
  hasAsync: boolean;
  /** ESP32 peripheral usage — framework-esp32 gates its IDF driver blocks and
   *  forced includes on these. Detected from HAL-op operation names, the same
   *  way usesUart/usesSPI/usesI2C are. Other frameworks have no CUTTLEFISH_*
   *  blocks with these marker names so the setup.ts filters are no-ops there. */
  usesGPIO: boolean;
  usesPWM: boolean;
  usesRmt: boolean;
  usesADC: boolean;
  usesDAC: boolean;
  usesWdt: boolean;
  usesInterrupts: boolean;
  usesPulse: boolean;
  usesShift: boolean;
  /** WiFi / HTTP / BLE usage — framework-esp32 gates the __tc_wifi/__tc_http/
   *  __tc_ble runtime shims and their esp_wifi/esp_http_client/nimble includes
   *  on these. Detected from wifi.* / http.* / ble.* HAL-op operation names. */
  usesWifi: boolean;
  /** Fine-grained WiFi sub-feature tracking — gates individual shim sub-blocks
   *  so that unused static helper functions don't trigger -Wunused-function. */
  usesWifiConnect: boolean;
  usesWifiConnectBlocking: boolean;
  usesWifiQuery: boolean;
  usesWifiScan: boolean;
  usesWifiConfig: boolean;
  usesHttp: boolean;
  usesBle: boolean;
  /** Preferences (NVS) usage — framework-esp32 gates the __tc_prefs runtime shim
   *  and its nvs_flash/nvs includes on this. Detected from preferences.* ops. */
  usesPreferences: boolean;
  /** Random usage — frameworks gate their PRNG runtime/include on this
   *  (e.g. framework-esp32 includes <esp_random.h>). Detected from random.* ops. */
  usesRandom: boolean;
  /** FS (filesystem) usage — frameworks gate their VFS/SD runtime shim on this.
   *  Detected from fs.* ops. */
  usesFS: boolean;
  /** mDNS usage — frameworks gate the esp_mdns runtime/include on this. */
  usesMdns: boolean;
  /** MQTT usage — frameworks gate the esp_mqtt runtime/include on this. */
  usesMqtt: boolean;
  /** OTA usage — frameworks gate the esp_https_ota runtime/include on this. */
  usesOta: boolean;
  /** Temperature (die temp) usage. Detected from temp.* ops. */
  usesTemp: boolean;
  /** DT-bound sensor parts (sensor.* ops, hal/sensor.ts) */
  usesSensor: boolean;
  /** Hardware timer (GPTimer) usage. Detected from hwtimer.* ops. */
  usesHwtimer: boolean;
  /** Capacitive touch pins usage. Detected from capacitive.* ops. */
  usesCapacitive: boolean;
  /** Native/desktop: std::set usage (gates <set>). */
  usesSet: boolean;
  /** Native/desktop: std::algorithm usage (std::sort/find/transform etc., gates <algorithm>). */
  usesAlgorithm: boolean;
  /** Native/desktop: cstdio usage (printf/fprintf/snprintf, gates <cstdio>). */
  usesCstdio: boolean;
  /** digitalRead() in lowered raw text or gpio.read hal-op (gates the native digitalRead shim). */
  usesDigitalRead: boolean;
  /** display.* hal-op present, or a UI is mounted (replaces ad-hoc programUsesDisplay walks). */
  usesDisplay: boolean;
  /** cuttlefish_halt() in lowered raw text (gates the cuttlefish_halt macro polyfill). */
  usesHalt: boolean;
}

// Regex for std:: math calls
// Both the lowered form (std::<fn>) and the source form (Math.<fn>) — the
// analysis can see either depending on when expressions render.
const MATH_PATTERN = /\b(?:std::|Math\.)(floor|ceil|round|trunc|sqrt|pow|sin|cos|tan|asin|acos|atan|abs|max|min)\b/;

/**
 * Analyze an expression for all features in a single pass.
 */
function analyzeExpression(
  expr: ExpressionIR,
  result: Pick<ProgramAnalysisResult, 'hasStdMathCalls' | 'usesVectorTypes' | 'usesStdString' | 'usesStdFunction' | 'declaredTypes' | 'usedPolyfillHelpers' | 'usesStringConversion' | 'usesDateNow' | 'usesMillis' | 'usesWallClock' | 'usesNullish' | 'usesNullishHelper' | 'usesNum' | 'usesTiming' | 'usesWDT' | 'usesStrPtr' | 'usesUart' | 'usesUsb' | 'usesSPI' | 'usesI2C' | 'usesMap' | 'usesConstrain' | 'usesGPIO' | 'usesPWM' | 'usesRmt' | 'usesADC' | 'usesDAC' | 'usesWdt' | 'usesInterrupts' | 'usesPulse' | 'usesShift' | 'usesWifi' | 'usesWifiConnect' | 'usesWifiConnectBlocking' | 'usesWifiQuery' | 'usesWifiScan' | 'usesWifiConfig' | 'usesHttp' | 'usesBle' | 'usesPreferences' | 'usesRandom' | 'usesFS' | 'usesMdns' | 'usesMqtt' | 'usesOta' | 'usesTemp' | 'usesSensor' | 'usesHwtimer' | 'usesCapacitive' | 'usesSet' | 'usesAlgorithm' | 'usesCstdio' | 'usesDigitalRead' | 'usesDisplay' | 'usesHalt'>,
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
      if (/\bmillis\s*\(/.test(expr.value) || /\bmicros\s*\(/.test(expr.value)) {
        result.usesWallClock = true;
      }
      // Test-runner console helpers (the test-runner preprocessor injects
      // __tc_print/__tc_println calls into the source). Track them as polyfill
      // helpers so frameworks can gate their definitions (and <cstdio>) on use.
      if (expr.value.includes("__tc_println(")) {
        result.usedPolyfillHelpers.add("__tc_println");
      }
      if (expr.value.includes("__tc_print(")) {
        result.usedPolyfillHelpers.add("__tc_print");
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
      if (/std::set\s*</.test(expr.value)) {
        result.usesSet = true;
      }
      if (/std::(sort|find|transform|copy|fill|remove|count|reverse|accumulate)\s*\(/.test(expr.value)) {
        result.usesAlgorithm = true;
      }
      if (/\b(printf|fprintf|sprintf|snprintf)\s*\(/.test(expr.value)) {
        result.usesCstdio = true;
      }
      if (/\bdigitalRead\s*\(/.test(expr.value)) {
        result.usesDigitalRead = true;
      }
      if (/cuttlefish_halt\s*\(/.test(expr.value)) {
        result.usesHalt = true;
      }
      break;

    case "method-call":
      if (/\bmillis\b/.test(expr.callee) || /\bdelay\b/.test(expr.callee) || /\bmicros\b/.test(expr.callee)) {
        result.usesMillis = true;
      }
      if (/\bmillis\b/.test(expr.callee) || /\bmicros\b/.test(expr.callee)) {
        result.usesWallClock = true;
      }
      if (expr.callee === "__tc_print" || expr.callee === "__tc_println") {
        result.usedPolyfillHelpers.add(expr.callee);
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
      // (Serial.* / SPI.* / Wire.*). The HAL resolver lowers these
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
      // map()/constrain() Arduino-API calls appear as method-call exprs
      // (callee "map"/"constrain"). framework-avr lowers these to _native_map/
      // _native_constrain via symbol aliases, so the helpers are dead code
      // unless the program actually calls them.
      if (expr.callee === "map") result.usesMap = true;
      if (expr.callee === "constrain") result.usesConstrain = true;
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
      // Value-position HAL ops (e.g. `const v = D32.readAnalog()` lowers to an
      // adc.read hal-expr initializer; `const ip = WiFi.localIP()` to a wifi
      // hal-expr) never pass through the statement-level hal-op detection
      // below, so mirror the FULL peripheral-flag detection here. Without this,
      // a value-returning HAL op used in a var-init or expression context fails
      // to set its analysis flag — the framework then drops the matching init
      // block + forced includes (e.g. __tc_adc_read was emitted but the
      // CUTTLEFISH_ADC init block and adc_oneshot.h include were not). Both
      // this case and the hal-op statement case delegate to
      // applyHalOpUsageFlags, which also covers transpile-resolved ops.
      if (expr.operation && typeof expr.operation.operation === "string") {
        applyHalOpUsageFlags(expr.operation.operation, result);
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
      if (statement.callee === "millis") {
        result.usesWallClock = true;
      }
      // Awaited HAL wait markers become async state-machine poll states that
      // arm deadlines via currentTimeMillis().
      if (statement.callee === "__WIFI_WAIT__" || statement.callee === "__HTTP_WAIT__" || statement.callee === "__HAL_WAIT__") {
        result.usesMillis = true;
        result.usesWallClock = true;
      }
      if (statement.callee === "__tc_print" || statement.callee === "__tc_println") {
        result.usedPolyfillHelpers.add(statement.callee);
      }
      // emit()/rawCpp() statements (__EMIT__) carry verbatim C++ in string
      // args — the raw-text regex below never sees them (the arg is a string
      // IR node, not raw text). Scan them for the printf family so a debug
      // build (or any rawCpp'd stdio call) pulls in <cstdio>.
      if (statement.callee === "__EMIT__") {
        for (const arg of statement.args) {
          if (arg.kind === "string" && /\b(printf|fprintf|sprintf|snprintf|getchar|putchar|puts)\s*\(/.test(arg.value)) {
            result.usesCstdio = true;
          }
        }
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
      // Native AVR peripheral usage from statement-form calls. Serial.* drives
      // UART; the namespace prefixes mirror the method-call checks above.
      // Only real UART HAL / Serial peripheral usage should gate the uart shim
      // (avoids unused __tc_uart*_init).
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
        applyHalOpUsageFlags(statement.operation.operation, result);
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
        if (/\b(millis|micros)\s*\(/.test(code)) {
          result.usesWallClock = true;
        }
        if (code.includes("__tc_println(")) {
          result.usedPolyfillHelpers.add("__tc_println");
        }
        if (code.includes("__tc_print(")) {
          result.usedPolyfillHelpers.add("__tc_print");
        }
        // Native AVR peripheral usage inside raw hal-op code (Serial/SPI/Wire
        // may appear as lowered library calls).
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
    usesWallClock: false,
    usesNullish: false,
    usesNullishHelper: false,
    usesNum: false,
    usesTiming: false,
    usesWDT: false,
    usesStrPtr: false,
    usesUart: false,
    usesUsb: false,
    usesSPI: false,
    usesI2C: false,
    usesMap: false,
    usesConstrain: false,
    usesNativeTiming: false,
    hasSerialBegin: false,
    hasGenerators: false,
    usesStdMap: false,
    usesGPIO: false,
    usesPWM: false,
    usesRmt: false,
    usesADC: false,
    usesDAC: false,
    usesWdt: false,
    usesInterrupts: false,
    usesPulse: false,
    usesShift: false,
    usesWifi: false,
    usesWifiConnect: false,
    usesWifiConnectBlocking: false,
    usesWifiQuery: false,
    usesWifiScan: false,
    usesWifiConfig: false,
    usesHttp: false,
    usesBle: false,
    usesPreferences: false,
    usesRandom: false,
    usesFS: false,
    usesMdns: false,
    usesMqtt: false,
    usesOta: false,
    usesTemp: false,
    usesSensor: false,
    usesHwtimer: false,
    usesCapacitive: false,
    hasAsync: false,
    usesSet: false,
    usesAlgorithm: false,
    usesCstdio: false,
    usesDigitalRead: false,
    usesDisplay: false,
    usesHalt: false,
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
  // helper usage is visible here the same way nested-function bodies are.
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

  // HAL ops the transpiler resolved to C++ text while inlining one HAL method
  // inside another (e.g. `sense.readMillivolts()` in a USB0.writeLine template)
  // never appear as hal-op/hal-expr IR nodes, so the walks above can't see
  // them. The lowering seams record every op they resolve; merge their
  // peripheral flags here.
  for (const opName of getTranspileResolvedHalOps()) {
    applyHalOpUsageFlags(opName, result);
  }

  // Derive the comprehensive native-timing gate for the AVR millis() Timer0
  // ISR. The ISR is needed whenever the program touches the soft clock
  // directly (millis/delay/micros) OR has a hidden consumer: async functions
  // (the runtime polls millis). The per-frame UI tick is injected by the
  // emitter, not present in user source — the setup emitter ORs entryHasUI()
  // in at the consume site. Without this gate, every AVR program pulled in
  // the Timer0 ISR even when it never uses timing.
  const hasAsync = program.functions.some(fn => fn.isAsync);
  result.hasAsync = hasAsync;
  result.usesNativeTiming = result.usesMillis
    || result.usesTiming
    || hasAsync;

  return result;
}
