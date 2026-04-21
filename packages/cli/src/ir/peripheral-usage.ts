// ---------------------------------------------------------------------------
// Peripheral Usage Analysis
//
// Analyzes the IR to detect which hardware peripherals are used.
// This enables compile-time initialization optimization.
// ---------------------------------------------------------------------------

import { ProgramIR, StatementIR, ExpressionIR, CallExpressionIR, VariableDeclarationIR, AssignmentIR, ForOfIR, ForInIR, SwitchIR, CaseIR, TryIR } from './model';
import { parsePeripheralInstance } from './peripheral-symbols';

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
 * Analyze a single statement for peripheral usage.
 */
function analyzeStatement(stmt: StatementIR, usage: PeripheralUsage): void {
  // Safety check
  if (!stmt || typeof stmt !== 'object' || !stmt.kind) {
    return;
  }

  try {
    switch (stmt.kind) {
    case 'typecode-call': {
      // Typecode call statements (pin.method() calls) at top level
      // console.log('[DEBUG] Found typecode-call statement:', stmt);
      analyzeTypecodeCall(stmt as any, usage);
      break;
    }

    case 'call': {
      // Call statements at top level - analyze args for nested peripheral calls
      const call = stmt as CallExpressionIR;
      markTimer0UsageFromText((call as any).callee, usage);
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
    
    // Check for typecode-call expressions (pin.method() calls)
    if (exprKind === 'typecode-call') {
      analyzeTypecodeCall(expr as any, usage);
      return;
    }

    if (exprKind === 'raw' && 'value' in expr) {
      markTimer0UsageFromText((expr as any).value, usage);
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

/**
 * Analyze a typecode-call expression for peripheral usage.
 * These are pin.method() calls like A0.read(), D9.write(128), etc.
 */
function analyzeTypecodeCall(expr: { receiver?: string; receiverKind?: string; method?: string; args?: ExpressionIR[] }, usage: PeripheralUsage): void {
  // Safety checks
  if (!expr || !expr.receiver || !expr.method) return;

  const { receiver, receiverKind, method } = expr;
  const pinNumber = parsePinNumber(receiver);
  const peripheralInstance = parsePeripheralInstance(receiver);

  // Track all pin usage for unsafe pin validation
  // Include digital, pwm, analog-input, and interrupt pins
  if (receiverKind && ['digital', 'pwm', 'analog-input', 'interrupt'].includes(receiverKind)) {
    usage.pinsUsed.add(receiver);
  }

  // Check for pin mode configuration (direct API: output, input, inputPullUp, inputPullDown)
  if (method === 'output' || method === 'config.output' || method === 'config.output.initial') {
    if (pinNumber !== null) {
      usage.outputPins.add(pinNumber);
    }
    return;
  }

  if (method === 'input' || method === 'config.input') {
    if (pinNumber !== null) {
      usage.inputPins.add(pinNumber);
    }
    return;
  }

  if (method === 'inputPullUp' || method === 'config.inputPullUp') {
    if (pinNumber !== null) {
      usage.inputPullupPins.add(pinNumber);
    }
    return;
  }

  if (method === 'inputPullDown' || method === 'config.inputPullDown') {
    if (pinNumber !== null) {
      usage.inputPulldownPins.add(pinNumber);
    }
    return;
  }
  
  // Check for analog input reads
  if (receiverKind === 'analog-input' && method === 'read') {
    usage.adc = true;
    const pinMatch = receiver.match(/^A(\d+)$/);
    if (pinMatch) {
      usage.adcChannelsUsed.add(parseInt(pinMatch[1], 10));
    }
    return;
  }
  
  // Check for PWM writes (new direct API: pwm(), old API: write/setDutyCycle)
  if (receiverKind === 'pwm' && (method === 'pwm' || method === 'write' || method === 'setDutyCycle')) {
    usage.pwm = true;
    if (pinNumber !== null) {
      usage.pwmPinsUsed.add(pinNumber);
    }
    return;
  }
  
  // Check for digital pin methods on interrupt-capable pins
  // New direct API: on.falling, on.rising, on.change, off.all
  // Old API: attachInterrupt, detachInterrupt
  if (method === 'attachInterrupt' || method === 'detachInterrupt' ||
      method === 'on.falling' || method === 'on.rising' || method === 'on.change' ||
      method === 'off.all') {
    usage.externalInterrupts = true;
    return;
  }
  
  // Check for I2C bus usage (I2C0, I2C1, I2C2, etc.)
  if (receiverKind === 'i2c' || peripheralInstance?.kind === 'i2c') {
    usage.i2c = true;
    if (peripheralInstance?.kind === 'i2c') {
      usage.i2cInstancesUsed.add(peripheralInstance.index);
    }
    return;
  }
  
  // Check for SPI bus usage (SPI0, SPI1, SPI2, etc.)
  if (receiverKind === 'spi' || peripheralInstance?.kind === 'spi') {
    usage.spi = true;
    if (peripheralInstance?.kind === 'spi') {
      usage.spiInstancesUsed.add(peripheralInstance.index);
    }
    return;
  }
  
  // Check for Serial/UART usage (Serial, Serial1, Serial2 or UART0, UART1, UART2)
  if (receiverKind === 'serial' || peripheralInstance?.kind === 'serial') {
    usage.uart = true;
    if (peripheralInstance?.kind === 'serial') {
      usage.uartInstancesUsed.add(peripheralInstance.index);
    }
    return;
  }
}
