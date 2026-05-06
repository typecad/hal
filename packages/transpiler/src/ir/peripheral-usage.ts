// ---------------------------------------------------------------------------
// Peripheral Usage Analysis
//
// Analyzes the IR to detect which hardware peripherals are used.
// This enables compile-time initialization optimization.
// ---------------------------------------------------------------------------

import { ProgramIR, StatementIR, ExpressionIR, CallExpressionIR, VariableDeclarationIR, AssignmentIR, ForOfIR, ForInIR, SwitchIR, CaseIR, TryIR } from '@typehal/core';

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

  // Safety check - if no program or invalid structure, return empty
  if (!program || typeof program !== 'object') {
    return usage;
  }

  try {
    // Analyze all statements in the program
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
  } catch (e) {
    // If analysis fails, return empty usage (safe fallback)
    // Don't log to avoid noise in output
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

/**
 * Analyze statements for peripheral usage.
 */
function analyzeStatements(statements: StatementIR[] | undefined, usage: PeripheralUsage): void {
  if (!statements || !Array.isArray(statements)) return;
  for (const stmt of statements) {
    if (stmt) analyzeStatement(stmt, usage);
  }
}

/**
 * Record a pin number as a D-prefixed pin name in pinsUsed.
 * This allows validators (pin-safety, pin-alias-conflict, etc.) to detect
 * pin usage from __EMIT__ nodes that use numeric pin references.
 */
function trackPinNumberAsName(pinNum: number, usage: PeripheralUsage): void {
  usage.pinsUsed.add(`D${pinNum}`);
}

/**
 * Parse an __EMIT__ node's C++ string for peripheral usage patterns.
 */
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

/**
 * Analyze a callee string (e.g., "D13.read", "A0.read", "Wire.begin")
 * for peripheral usage patterns from non-__EMIT__ call nodes.
 */
function analyzeCalleeForPeripheralUsage(callee: string, usage: PeripheralUsage): void {
  if (!callee || typeof callee !== 'string') return;

  // Track all pin names found in the callee string (handles chains like D2.asInput().onFalling())
  const pinNames = callee.match(/\b(D\d+|A\d+|LED|SDA|SCL|MOSI|MISO|SCK|SS|TX|RX)\b/g);
  if (pinNames) {
    for (const pinName of pinNames) {
      usage.pinsUsed.add(pinName);
      const pinNum = parsePinNumber(pinName);
      if (pinNum !== null) {
        // Track mode based on method presence in the chain
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
        
        // ADC read: A0.read, etc.
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

  // Top-level timer0 functions: delay(), millis(), micros()
  markTimer0UsageFromText(callee, usage);
}

/**
 * Analyze a single statement for peripheral usage.
 */
function analyzeStatement(stmt: StatementIR, usage: PeripheralUsage): void {
  // Safety check
  if (!stmt || typeof stmt !== 'object' || !stmt.kind) {
    return;
  }

  try {
    switch (stmt.kind) {
    case 'call': {
      const call = stmt as CallExpressionIR;
      // Handle __EMIT__ nodes — parse the C++ string for peripheral patterns
      if ((call as any).callee === '__EMIT__') {
        if (call.args) {
          for (const arg of call.args) {
            if (arg && (arg as any).kind === 'string' && typeof (arg as any).value === 'string') {
              analyzeEmitString((arg as any).value, usage);
            }
          }
        }
      } else {
        // Regular call — analyze callee for peripheral usage
        analyzeCalleeForPeripheralUsage((call as any).callee, usage);
      }
      // Also analyze args for nested expressions
      if (call.args) {
        for (const arg of call.args) {
          if (arg) analyzeExpression(arg, usage);
        }
      }
      break;
    }

    case 'assign': {
      const assign = stmt as AssignmentIR;
      if (assign.value) analyzeExpression(assign.value, usage);
      break;
    }
    
    case 'var_decl': {
      const varDecl = stmt as VariableDeclarationIR;
      if (varDecl.initializer) {
        analyzeExpression(varDecl.initializer, usage);
      }
      break;
    }
    
    case 'if': {
      if (stmt.condition) analyzeExpression(stmt.condition, usage);
      if (stmt.thenBranch) analyzeStatements(stmt.thenBranch, usage);
      if (stmt.elseBranch) analyzeStatements(stmt.elseBranch, usage);
      break;
    }
    
    case 'while': {
      const whileStmt = stmt as any;
      if (whileStmt.condition) analyzeExpression(whileStmt.condition, usage);
      if (whileStmt.body && Array.isArray(whileStmt.body)) analyzeStatements(whileStmt.body, usage);
      break;
    }
    
    case 'do_while': {
      const doWhileStmt = stmt as any;
      if (doWhileStmt.condition) analyzeExpression(doWhileStmt.condition, usage);
      if (doWhileStmt.body && Array.isArray(doWhileStmt.body)) analyzeStatements(doWhileStmt.body, usage);
      break;
    }
    
    case 'for': {
      const forStmt = stmt as any;
      if (forStmt.initializer) analyzeStatement(forStmt.initializer, usage);
      if (forStmt.condition) analyzeExpression(forStmt.condition, usage);
      if (forStmt.increment) analyzeStatement(forStmt.increment, usage);
      if (forStmt.body && Array.isArray(forStmt.body)) analyzeStatements(forStmt.body, usage);
      break;
    }
    
    case 'for_of': {
      const forOf = stmt as any;
      if (forOf.iterable) analyzeExpression(forOf.iterable, usage);
      if (forOf.body && Array.isArray(forOf.body)) analyzeStatements(forOf.body, usage);
      break;
    }
    
    case 'for_in': {
      const forIn = stmt as any;
      if (forIn.object) analyzeExpression(forIn.object, usage);
      if (forIn.body && Array.isArray(forIn.body)) analyzeStatements(forIn.body, usage);
      break;
    }
    
    case 'return': {
      const retStmt = stmt as any;
      if (retStmt.value) analyzeExpression(retStmt.value, usage);
      break;
    }
    
    case 'switch': {
      const switchStmt = stmt as any;
      if (switchStmt.expression) analyzeExpression(switchStmt.expression, usage);
      if (switchStmt.cases && Array.isArray(switchStmt.cases)) {
        for (const caseClause of switchStmt.cases) {
          if (caseClause && (caseClause as any).body && Array.isArray((caseClause as any).body)) {
            analyzeStatements((caseClause as any).body, usage);
          }
        }
      }
      break;
    }
    
    case 'try': {
      const tryStmt = stmt as any;
      if (tryStmt.tryBlock && Array.isArray(tryStmt.tryBlock)) analyzeStatements(tryStmt.tryBlock, usage);
      if (tryStmt.catchBlock && Array.isArray(tryStmt.catchBlock)) analyzeStatements(tryStmt.catchBlock, usage);
      break;
    }
    
    case 'throw': {
      const throwStmt = stmt as any;
      if (throwStmt.value) analyzeExpression(throwStmt.value, usage);
      break;
    }
    
    case 'update':
      // Update statements don't involve peripheral calls
      break;

    case 'break':
    case 'continue':
      // Control flow statements don't involve peripherals
      break;

    case 'block': {
      const blockStmt = stmt as any;
      if (blockStmt.body && Array.isArray(blockStmt.body)) analyzeStatements(blockStmt.body, usage);
      break;
    }

    default:
      // Unknown statement kind - skip
      break;
    }
  } catch (e) {
    // Silently ignore errors in statement analysis
  }
}

/**
 * Analyze an expression for peripheral usage.
 */
function analyzeExpression(expr: ExpressionIR | undefined, usage: PeripheralUsage): void {
  if (!expr) return;
  
  // Safety check: ensure expr is an object with a kind property
  if (typeof expr !== 'object') return;
  if (!('kind' in expr)) return;
  if (!(expr as any).kind) return;
  
  try {
    const exprKind = (expr as any).kind;
    
    if (exprKind === 'raw' && 'value' in expr) {
      markTimer0UsageFromText((expr as any).value, usage);
    }

    // Structured method-call IR: check callee for peripheral usage
    if (exprKind === 'method-call' && 'callee' in expr) {
      analyzeCalleeForPeripheralUsage((expr as any).callee, usage);
    }
    
    // Recursively analyze nested expressions
    if ('args' in expr && Array.isArray((expr as any).args)) {
      for (const arg of (expr as any).args) {
        if (arg) analyzeExpression(arg, usage);
      }
    }
    
    // Check binary/unary expressions
    if (exprKind === 'binary' || exprKind === 'unary') {
      if ('left' in expr && (expr as any).left) analyzeExpression((expr as any).left, usage);
      if ('right' in expr && (expr as any).right) analyzeExpression((expr as any).right, usage);
      if ('operand' in expr && (expr as any).operand) analyzeExpression((expr as any).operand, usage);
    }
    
    // Check ternary expressions
    if (exprKind === 'ternary') {
      if ('condition' in expr && (expr as any).condition) analyzeExpression((expr as any).condition, usage);
      if ('consequent' in expr && (expr as any).consequent) analyzeExpression((expr as any).consequent, usage);
      if ('alternate' in expr && (expr as any).alternate) analyzeExpression((expr as any).alternate, usage);
    }
    
    // Check property access
    if (exprKind === 'property-access') {
      if ('object' in expr && (expr as any).object) analyzeExpression((expr as any).object, usage);
    }
    
    // Check array expressions
    if (exprKind === 'array') {
      if ('elements' in expr && Array.isArray((expr as any).elements)) {
        for (const elem of (expr as any).elements) {
          if (elem) analyzeExpression(elem, usage);
        }
      }
    }
    
    // Check object expressions
    if (exprKind === 'object') {
      if ('fields' in expr && Array.isArray((expr as any).fields)) {
        for (const field of (expr as any).fields) {
          if (field && field.value) analyzeExpression(field.value, usage);
        }
      }
    }
    
    // Check await expressions
    if (exprKind === 'await') {
      if ('value' in expr && (expr as any).value) analyzeExpression((expr as any).value, usage);
    }
  } catch (e) {
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

