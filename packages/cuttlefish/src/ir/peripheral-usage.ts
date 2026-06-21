// ---------------------------------------------------------------------------
// Peripheral Usage Analysis
//
// Analyzes the IR to detect which hardware peripherals are used.
// This enables compile-time initialization optimization.
// ---------------------------------------------------------------------------

import type { ProgramIR, StatementIR, ExpressionIR, HALOpIR } from '../api/index.js';

/**
 * Tracks which hardware peripherals are used in the program.
 */
export interface PeripheralUsage {
  /** ADC is used (analogRead on A0-A5) */
  adc: boolean;
  /** PWM is used (analogWrite on D3, D5, D6, D9, D10, D11) */
  pwm: boolean;
  /** External interrupts are used (attachInterrupt on D2, D3) */
  externalInterrupts: boolean;
  /** Timer0-based timing is used (millis, micros) */
  timer0: boolean;
  /** I2C bus is used */
  i2c: boolean;
  /** SPI bus is used */
  spi: boolean;
  /** UART/Serial is used */
  uart: boolean;
  /** Specific PWM pins used (for targeted timer initialization) */
  pwmPinsUsed: Set<number>;
  /** Specific ADC channels used */
  adcChannelsUsed: Set<number>;
  /** Pins configured as output (for batch DDR initialization) */
  outputPins: Set<number>;
  /** Pins configured as input with pullup */
  inputPullupPins: Set<number>;
  /** Pins configured as input (no pullup) */
  inputPins: Set<number>;
  /** Pins configured as input with pulldown */
  inputPulldownPins: Set<number>;
  /** Specific I2C bus instances used (0 for I2C0, 1 for I2C1, etc.) */
  i2cInstancesUsed: Set<number>;
  /** Specific SPI bus instances used (0 for SPI0, 1 for SPI1, etc.) */
  spiInstancesUsed: Set<number>;
  /** Specific UART instances used (0 for UART0/Serial, 1 for UART1/Serial1, etc.) */
  uartInstancesUsed: Set<number>;
  /** All pin names used (for unsafe pin validation) */
  pinsUsed: Set<string>;
  /** Specific pins used for external interrupts */
  interruptPinsUsed: Set<number>;
}

/**
 * Create an empty PeripheralUsage object.
 */
export function createEmptyPeripheralUsage(): PeripheralUsage {
  return {
    adc: false,
    pwm: false,
    externalInterrupts: false,
    timer0: false,
    i2c: false,
    spi: false,
    uart: false,
    pwmPinsUsed: new Set(),
    adcChannelsUsed: new Set(),
    outputPins: new Set(),
    inputPullupPins: new Set(),
    inputPins: new Set(),
    inputPulldownPins: new Set(),
    i2cInstancesUsed: new Set(),
    spiInstancesUsed: new Set(),
    uartInstancesUsed: new Set(),
    pinsUsed: new Set(),
    interruptPinsUsed: new Set(),
  };
}

/**
 * Analyze a program's IR to detect peripheral usage.
 */
export function analyzePeripheralUsage(program: ProgramIR): PeripheralUsage {
  const usage = createEmptyPeripheralUsage();

  if (!program || typeof program !== 'object') {
    return usage;
  }

  try {
    if (program.topLevelStatements && Array.isArray(program.topLevelStatements)) {
      analyzeStatements(program.topLevelStatements, usage);
    }

    if (program.functions && Array.isArray(program.functions)) {
      for (const fn of program.functions) {
        if (fn && fn.statements && Array.isArray(fn.statements)) {
          analyzeStatements(fn.statements, usage);
        }
      }
    }

    if (program.classes && Array.isArray(program.classes)) {
      for (const cls of program.classes) {
        if (cls.methods && Array.isArray(cls.methods)) {
          for (const method of cls.methods) {
            if (method && method.statements && Array.isArray(method.statements)) {
              analyzeStatements(method.statements, usage);
            }
          }
        }
        if (cls.constructor && cls.constructor.statements && Array.isArray(cls.constructor.statements)) {
          analyzeStatements(cls.constructor.statements, usage);
        }
      }
    }
  } catch (_e) {
    // If analysis fails, return empty usage (safe fallback)
  }

  return usage;
}

function markTimer0UsageFromText(text: string | undefined, usage: PeripheralUsage): void {
  if (!text) return;

  const normalized = text.replace(/\s+/g, '');
  if (
    normalized === 'delay' ||
    normalized === 'millis' ||
    normalized === 'micros' ||
    normalized === 'Board.delay' ||
    normalized === 'Board.millis' ||
    normalized === 'Board.micros' ||
    normalized.startsWith('delay(') ||
    normalized.startsWith('millis(') ||
    normalized.startsWith('micros(') ||
    normalized.startsWith('Board.delay(') ||
    normalized.startsWith('Board.millis(') ||
    normalized.startsWith('Board.micros(')
  ) {
    usage.timer0 = true;
  }
}

function analyzeStatements(statements: StatementIR[] | undefined, usage: PeripheralUsage): void {
  if (!statements || !Array.isArray(statements)) return;
  for (const stmt of statements) {
    if (stmt) analyzeStatement(stmt, usage);
  }
}

function trackPinNumberAsName(pinNum: number, usage: PeripheralUsage): void {
  usage.pinsUsed.add(`D${pinNum}`);
}

function analyzeEmitString(cpp: string, usage: PeripheralUsage): void {
  // pinMode(N, MODE) — track pin mode configuration and pin usage
  const pinModeMatch = cpp.match(/^pinMode\((\d+),\s*(\w+)\)/);
  if (pinModeMatch) {
    const pin = parseInt(pinModeMatch[1], 10);
    const mode = pinModeMatch[2];
    trackPinNumberAsName(pin, usage);
    if (mode === 'OUTPUT') {
      usage.outputPins.add(pin);
    } else if (mode === 'INPUT_PULLUP') {
      usage.inputPullupPins.add(pin);
    } else if (mode === 'INPUT') {
      usage.inputPins.add(pin);
    } else if (mode === 'INPUT_PULLDOWN') {
      usage.inputPulldownPins.add(pin);
    }
  }

  // analogWrite(N, ...) — PWM usage
  const analogWriteMatch = cpp.match(/^analogWrite\((\d+)/);
  if (analogWriteMatch) {
    const pin = parseInt(analogWriteMatch[1], 10);
    trackPinNumberAsName(pin, usage);
    usage.pwm = true;
    usage.pwmPinsUsed.add(pin);
  }

  // analogRead(A0), analogRead(A1), etc. — ADC usage
  const analogReadMatch = cpp.match(/analogRead\(([A](\d+)|\d+)\)/);
  if (analogReadMatch) {
    usage.adc = true;
    const channel = parseInt(analogReadMatch[2] ?? analogReadMatch[1], 10);
    if (!isNaN(channel)) {
      usage.adcChannelsUsed.add(channel);
    }
  }

  // digitalRead(N) — pin usage (extract pin number)
  const digitalReadMatch = cpp.match(/digitalRead\((\d+)\)/);
  if (digitalReadMatch) {
    trackPinNumberAsName(parseInt(digitalReadMatch[1], 10), usage);
  }

  // digitalWrite(N, ...) — pin usage
  const digitalWriteMatch = cpp.match(/digitalWrite\((\d+)/);
  if (digitalWriteMatch) {
    trackPinNumberAsName(parseInt(digitalWriteMatch[1], 10), usage);
  }

    // attachInterrupt(digitalPinToInterrupt(N), ...) — external interrupt
    const attachIntMatch = cpp.match(/attachInterrupt\(digitalPinToInterrupt\((\d+)\)/);
    if (attachIntMatch) {
        const pin = parseInt(attachIntMatch[1], 10);
        usage.interruptPinsUsed.add(pin);
        usage.externalInterrupts = true;
    } else if (cpp.startsWith('attachInterrupt(')) {
        usage.externalInterrupts = true;
    }

  // Wire.begin(), Wire1.begin() — I2C
  const i2cMatch = cpp.match(/^(Wire)(\d*)\.begin/);
  if (i2cMatch) {
    usage.i2c = true;
    const instance = i2cMatch[2] ? parseInt(i2cMatch[2], 10) : 0;
    usage.i2cInstancesUsed.add(instance);
  }

  // SPI.begin(), SPI1.begin() — SPI bus
  const spiMatch = cpp.match(/^SPI(\d*)\.begin/);
  if (spiMatch) {
    usage.spi = true;
    usage.spiInstancesUsed.add(spiMatch[1] ? parseInt(spiMatch[1], 10) : 0);
  }

  // Serial.begin(...), Serial1.begin(...) — UART
  const uartMatch = cpp.match(/^Serial(\d*)\.begin/);
  if (uartMatch) {
    usage.uart = true;
    usage.uartInstancesUsed.add(uartMatch[1] ? parseInt(uartMatch[1], 10) : 0);
  }

  // delay(), millis(), micros() — timer0
  markTimer0UsageFromText(cpp, usage);

  // tone(N, ...) — also implies PWM output
  const toneMatch = cpp.match(/^tone\((\d+)/);
  if (toneMatch) {
    usage.pwm = true;
    usage.pwmPinsUsed.add(parseInt(toneMatch[1], 10));
  }
}

function analyzeCalleeForPeripheralUsage(callee: string, usage: PeripheralUsage): void {
  if (!callee || typeof callee !== 'string') return;

  // Track all pin names found in the callee string (handles chains like D2.asInput().onFalling())
  const pinNames = callee.match(/\b(D\d+|A\d+|LED|SDA|SCL|MOSI|MISO|SCK|SS|TX|RX)\b/g);
  if (pinNames) {
    for (const pinName of pinNames) {
      usage.pinsUsed.add(pinName);
      const pinNum = parsePinNumber(pinName);
      if (pinNum !== null) {
        if (callee.includes('.asOutput') || callee.includes('.output')) usage.outputPins.add(pinNum);
        if (callee.includes('.asInputPullUp') || callee.includes('.inputPullUp')) usage.inputPullupPins.add(pinNum);
        if (callee.includes('.asInput')) usage.inputPins.add(pinNum);
        if (callee.includes('.inputPullDown')) usage.inputPulldownPins.add(pinNum);
        if (callee.includes('.pwm')) { usage.pwm = true; usage.pwmPinsUsed.add(pinNum); }
        if (callee.includes('.tone')) { usage.pwm = true; usage.pwmPinsUsed.add(pinNum); }
        if (callee.includes('.onFalling') || callee.includes('.onRising') || callee.includes('.onChange') ||
            callee.includes('.onLow') || callee.includes('.onHigh') || callee.includes('.attachInterrupt')) {
          usage.externalInterrupts = true;
          usage.interruptPinsUsed.add(pinNum);
        }

        if (callee.includes('.read') && pinName.startsWith('A')) {
          usage.adc = true;
          usage.adcChannelsUsed.add(pinNum - 14);
        }
      }
    }
  }

  // Bus method calls: Wire.begin, Serial.begin, SPI.begin
  const busMethodMatch = callee.match(/\b(Wire|SPI|Serial)(\d*)\.(\w+)\b/);
  if (busMethodMatch) {
    const busType = busMethodMatch[1];
    const instanceStr = busMethodMatch[2];
    const instance = instanceStr ? parseInt(instanceStr, 10) : 0;

    if (busType === 'Wire') {
      usage.i2c = true;
      usage.i2cInstancesUsed.add(instance);
    } else if (busType === 'SPI') {
      usage.spi = true;
      usage.spiInstancesUsed.add(instance);
    } else if (busType === 'Serial') {
      usage.uart = true;
      usage.uartInstancesUsed.add(instance);
    }
  }

  markTimer0UsageFromText(callee, usage);
}

/**
 * Extract the bus/UART instance number from a name like "Wire" → 0, "Wire1" → 1, "SPI" → 0, "Serial" → 0, "Serial1" → 1.
 */
function extractBusInstance(busOrPort: string, prefix: string): number {
  const rest = busOrPort.slice(prefix.length);
  return rest ? parseInt(rest, 10) : 0;
}

/**
 * Analyze a single HAL operation and record peripheral usage.
 */
function analyzeHALOp(op: HALOpIR, usage: PeripheralUsage): void {
  switch (op.operation) {
    // GPIO — pin mode configuration
    case 'gpio.set_mode': {
      trackPinNumberAsName(op.pin, usage);
      const mode = op.mode.toLowerCase();
      if (mode === 'output') {
        usage.outputPins.add(op.pin);
      } else if (mode === 'input_pullup') {
        usage.inputPullupPins.add(op.pin);
      } else if (mode === 'input_pulldown') {
        usage.inputPulldownPins.add(op.pin);
      } else if (mode === 'input') {
        usage.inputPins.add(op.pin);
      }
      break;
    }

    case 'gpio.write':
    case 'gpio.read':
    case 'gpio.toggle': {
      trackPinNumberAsName(op.pin, usage);
      break;
    }

    // PWM
    case 'pwm.write': {
      trackPinNumberAsName(op.pin, usage);
      usage.pwm = true;
      usage.pwmPinsUsed.add(op.pin);
      break;
    }

    case 'pwm.get_frequency':
    case 'pwm.get_resolution': {
      trackPinNumberAsName(op.pin, usage);
      break;
    }

    // ADC
    case 'adc.read':
    case 'adc.read_voltage': {
      usage.adc = true;
      usage.adcChannelsUsed.add(op.pin);
      break;
    }

    case 'adc.get_resolution':
    case 'adc.set_reference':
    case 'adc.get_reference':
      break;

    // DAC
    case 'dac.write': {
      trackPinNumberAsName(op.pin, usage);
      break;
    }

    // Interrupts
    case 'interrupt.attach': {
      trackPinNumberAsName(op.pin, usage);
      usage.externalInterrupts = true;
      usage.interruptPinsUsed.add(op.pin);
      break;
    }

    case 'interrupt.detach': {
      trackPinNumberAsName(op.pin, usage);
      break;
    }

    // Tone
    case 'tone.play': {
      usage.pwm = true;
      usage.pwmPinsUsed.add(op.pin);
      break;
    }

    case 'tone.stop': {
      trackPinNumberAsName(op.pin, usage);
      break;
    }

    // Timing
    case 'timing.delay':
    case 'timing.delay_microseconds':
    case 'timing.millis':
    case 'timing.micros': {
      usage.timer0 = true;
      break;
    }

    case 'timing.free_heap':
    case 'timing.set_interval':
    case 'timing.set_timeout':
    case 'timing.clear_interval':
    case 'timing.clear_timeout':
      break;

    // I2C
    case 'i2c.begin': {
      usage.i2c = true;
      usage.i2cInstancesUsed.add(extractBusInstance(op.bus, 'Wire'));
      break;
    }

    case 'i2c.end':
    case 'i2c.set_clock':
    case 'i2c.begin_transmission':
    case 'i2c.write':
    case 'i2c.end_transmission':
    case 'i2c.request_from':
    case 'i2c.available':
    case 'i2c.read':
    case 'i2c.recover': {
      usage.i2c = true;
      usage.i2cInstancesUsed.add(extractBusInstance(op.bus, 'Wire'));
      break;
    }

    // SPI
    case 'spi.begin': {
      usage.spi = true;
      usage.spiInstancesUsed.add(extractBusInstance(op.bus, 'SPI'));
      break;
    }

    case 'spi.end':
    case 'spi.transfer':
    case 'spi.begin_transaction':
    case 'spi.end_transaction':
    case 'spi.set_frequency':
    case 'spi.set_mode':
    case 'spi.set_bit_order': {
      usage.spi = true;
      usage.spiInstancesUsed.add(extractBusInstance(op.bus, 'SPI'));
      break;
    }

    case 'spi.cs_low':
    case 'spi.cs_high': {
      trackPinNumberAsName(op.pin, usage);
      break;
    }

    // UART
    case 'uart.begin': {
      usage.uart = true;
      usage.uartInstancesUsed.add(extractBusInstance(op.port, 'Serial'));
      break;
    }

    case 'uart.end':
    case 'uart.print':
    case 'uart.println':
    case 'uart.printf':
    case 'uart.write':
    case 'uart.read':
    case 'uart.peek':
    case 'uart.available':
    case 'uart.flush': {
      usage.uart = true;
      usage.uartInstancesUsed.add(extractBusInstance(op.port, 'Serial'));
      break;
    }

    // Pulse
    case 'pulse.in':
    case 'pulse.in_long': {
      trackPinNumberAsName(op.pin, usage);
      break;
    }

    // Shift
    case 'shift.out': {
      trackPinNumberAsName(op.dataPin, usage);
      trackPinNumberAsName(op.clockPin, usage);
      break;
    }

    case 'shift.in': {
      trackPinNumberAsName(op.dataPin, usage);
      trackPinNumberAsName(op.clockPin, usage);
      break;
    }

    // Board resolve, snprintf, raw — no peripheral tracking needed
    case 'board.resolve':
    case 'snprintf.emit':
    case 'raw':
      break;
  }
}

function analyzeStatement(stmt: StatementIR, usage: PeripheralUsage): void {
  if (!stmt || typeof stmt !== 'object' || !stmt.kind) {
    return;
  }

  try {
    switch (stmt.kind) {
    case 'call': {
      if (stmt.callee === '__EMIT__') {
        for (const arg of stmt.args) {
          if (arg.kind === 'string' && typeof arg.value === 'string') {
            analyzeEmitString(arg.value, usage);
          }
        }
      } else {
        analyzeCalleeForPeripheralUsage(stmt.callee, usage);
      }
      for (const arg of stmt.args) {
        analyzeExpression(arg, usage);
      }
      break;
    }

    case 'hal-op': {
      if (stmt.operation) {
        analyzeHALOp(stmt.operation, usage);
      }
      break;
    }

    case 'assign': {
      if (stmt.value) analyzeExpression(stmt.value, usage);
      break;
    }

    case 'var_decl': {
      if (stmt.initializer) {
        analyzeExpression(stmt.initializer, usage);
      }
      break;
    }

    case 'if': {
      if (stmt.condition) analyzeExpression(stmt.condition, usage);
      analyzeStatements(stmt.thenBranch, usage);
      if (stmt.elseBranch) analyzeStatements(stmt.elseBranch, usage);
      break;
    }

    case 'while':
    case 'do_while': {
      if (stmt.condition) analyzeExpression(stmt.condition, usage);
      analyzeStatements(stmt.body, usage);
      break;
    }

    case 'for': {
      if (stmt.initializer) analyzeStatement(stmt.initializer, usage);
      if (stmt.condition) analyzeExpression(stmt.condition, usage);
      if (stmt.increment) analyzeStatement(stmt.increment, usage);
      analyzeStatements(stmt.body, usage);
      break;
    }

    case 'for_of': {
      if (stmt.iterable) analyzeExpression(stmt.iterable, usage);
      analyzeStatements(stmt.body, usage);
      break;
    }

    case 'for_in': {
      if (stmt.object) analyzeExpression(stmt.object, usage);
      analyzeStatements(stmt.body, usage);
      break;
    }

    case 'return': {
      if (stmt.value) analyzeExpression(stmt.value, usage);
      break;
    }

    case 'switch': {
      if (stmt.expression) analyzeExpression(stmt.expression, usage);
      for (const caseClause of stmt.cases) {
        analyzeStatements(caseClause.body, usage);
      }
      break;
    }

    case 'try': {
      analyzeStatements(stmt.tryBlock, usage);
      if (stmt.catchBlock) analyzeStatements(stmt.catchBlock, usage);
      if (stmt.finallyBlock) analyzeStatements(stmt.finallyBlock, usage);
      break;
    }

    case 'throw': {
      if (stmt.value) analyzeExpression(stmt.value, usage);
      break;
    }

    case 'update':
    case 'break':
    case 'continue':
      break;

    case 'block':
    case 'labeled': {
      analyzeStatements(stmt.body, usage);
      break;
    }

    default:
      break;
    }
  } catch (_e) {
    // Silently ignore errors in statement analysis
  }
}

function analyzeExpression(expr: ExpressionIR | undefined, usage: PeripheralUsage): void {
  if (!expr) return;

  if (typeof expr !== 'object' || !expr.kind) return;

  try {
    switch (expr.kind) {
    case 'raw': {
      markTimer0UsageFromText(expr.value, usage);
      break;
    }

    case 'method-call': {
      analyzeCalleeForPeripheralUsage(expr.callee, usage);
      for (const arg of expr.args) {
        analyzeExpression(arg, usage);
      }
      break;
    }

    case 'binary': {
      analyzeExpression(expr.left, usage);
      analyzeExpression(expr.right, usage);
      break;
    }

    case 'unary': {
      analyzeExpression(expr.operand, usage);
      break;
    }

    case 'ternary': {
      analyzeExpression(expr.condition, usage);
      analyzeExpression(expr.whenTrue, usage);
      analyzeExpression(expr.whenFalse, usage);
      break;
    }

    case 'property-access': {
      analyzeExpression(expr.object, usage);
      break;
    }

    case 'array': {
      for (const elem of expr.elements) {
        analyzeExpression(elem, usage);
      }
      break;
    }

    case 'object': {
      for (const field of expr.fields) {
        analyzeExpression(field.value, usage);
      }
      break;
    }

    case 'await': {
      analyzeExpression(expr.value, usage);
      break;
    }

    case 'callback': {
      for (const s of expr.statements) {
        analyzeStatement(s, usage);
      }
      break;
    }

    case 'lambda': {
      for (const s of expr.body) {
        analyzeStatement(s, usage);
      }
      break;
    }

    case 'element-access': {
      analyzeExpression(expr.object, usage);
      analyzeExpression(expr.index, usage);
      break;
    }

    case 'string_concat': {
      for (const part of expr.parts) {
        analyzeExpression(part, usage);
      }
      break;
    }

    case 'template_string': {
      analyzeExpression(expr.expression, usage);
      break;
    }

    case 'spread_array': {
      analyzeExpression(expr.spreadExpr, usage);
      for (const el of expr.additionalElements) {
        analyzeExpression(el, usage);
      }
      break;
    }

    case 'instanceof': {
      analyzeExpression(expr.object, usage);
      break;
    }

    case 'paren': {
      analyzeExpression(expr.inner, usage);
      break;
    }

    case 'hal-expr': {
      if (expr.operation) {
        analyzeHALOp(expr.operation, usage);
      }
      break;
    }

    case 'number':
    case 'string':
    case 'boolean':
    case 'identifier':
      break;

    default:
      break;
    }
  } catch (_e) {
    // Silently ignore errors in expression analysis
  }
}

/**
 * Parse pin number from receiver string (D13 -> 13, A0 -> 14, LED -> 13)
 */
export function parsePinNumber(receiver: string): number | null {
  if (receiver === 'LED') return 13;
  if (receiver === 'SDA') return 18;
  if (receiver === 'SCL') return 19;
  if (receiver === 'MOSI') return 11;
  if (receiver === 'MISO') return 12;
  if (receiver === 'SCK') return 13;
  if (receiver === 'SS') return 10;
  if (receiver === 'TX') return 1;
  if (receiver === 'RX') return 0;
  if (receiver.startsWith('D')) {
    const num = parseInt(receiver.slice(1), 10);
    return isNaN(num) ? null : num;
  }
  if (receiver.startsWith('A')) {
    const num = parseInt(receiver.slice(1), 10);
    return isNaN(num) ? null : 14 + num;
  }
  return null;
}
