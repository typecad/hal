// ---------------------------------------------------------------------------
// Peripheral Usage Analysis
//
// Analyzes the IR to detect which hardware peripherals are used.
// This enables compile-time initialization optimization.
// ---------------------------------------------------------------------------

import { ProgramIR, StatementIR, ExpressionIR, CallExpressionIR, VariableDeclarationIR, AssignmentIR, ForOfIR, ForInIR, SwitchIR, CaseIR, TryIR } from './model';

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
function parsePinNumber(receiver: string): number | null {
  if (receiver === 'LED') return 13;
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

  // Track all pin usage for unsafe pin validation
  // Include digital, pwm, analog-input, and interrupt pins
  if (receiverKind && ['digital', 'pwm', 'analog-input', 'interrupt'].includes(receiverKind)) {
    usage.pinsUsed.add(receiver);
  }

  // Check for pin mode configuration
  if (method === 'config.output' || method === 'config.output.initial') {
    if (pinNumber !== null) {
      usage.outputPins.add(pinNumber);
    }
    return;
  }
  
  if (method === 'config.input.float') {
    if (pinNumber !== null) {
      usage.inputPins.add(pinNumber);
    }
    return;
  }
  
  if (method === 'config.input.pullup') {
    if (pinNumber !== null) {
      usage.inputPullupPins.add(pinNumber);
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
  
  // Check for PWM writes
  if (receiverKind === 'pwm' && (method === 'write' || method === 'setDutyCycle')) {
    usage.pwm = true;
    const pinMatch = receiver.match(/^D(\d+)$/);
    if (pinMatch) {
      usage.pwmPinsUsed.add(parseInt(pinMatch[1], 10));
    }
    return;
  }
  
  // Check for digital pin methods on interrupt-capable pins
  if (method === 'attachInterrupt' || method === 'detachInterrupt') {
    usage.externalInterrupts = true;
    return;
  }
  
  // Check for I2C bus usage (I2C0, I2C1, I2C2, etc.)
  if (receiverKind === 'i2c' || /^I2C\d+$/.test(receiver)) {
    usage.i2c = true;
    const match = receiver.match(/^I2C(\d+)$/);
    if (match) {
      usage.i2cInstancesUsed.add(parseInt(match[1], 10));
    }
    return;
  }
  
  // Check for SPI bus usage (SPI0, SPI1, SPI2, etc.)
  if (receiverKind === 'spi' || /^SPI\d+$/.test(receiver)) {
    usage.spi = true;
    const match = receiver.match(/^SPI(\d+)$/);
    if (match) {
      usage.spiInstancesUsed.add(parseInt(match[1], 10));
    }
    return;
  }
  
  // Check for Serial/UART usage (Serial, Serial1, Serial2 or UART0, UART1, UART2)
  if (receiver === 'Serial' || /^Serial\d*$/.test(receiver) || receiverKind === 'serial' || /^UART\d+$/.test(receiver)) {
    usage.uart = true;
    // Handle Serial, Serial1, Serial2
    const serialMatch = receiver.match(/^Serial(\d*)$/);
    if (serialMatch) {
      const num = serialMatch[1] === '' ? 0 : parseInt(serialMatch[1], 10);
      usage.uartInstancesUsed.add(num);
    }
    // Handle UART0, UART1, UART2
    const uartMatch = receiver.match(/^UART(\d+)$/);
    if (uartMatch) {
      usage.uartInstancesUsed.add(parseInt(uartMatch[1], 10));
    }
    return;
  }
}
