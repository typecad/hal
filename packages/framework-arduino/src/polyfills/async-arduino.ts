import type { PolyfillDefinition, PolyfillContext, PolyfillNeed, RuntimePolyfillIR, ProgramIR, StatementIR, ExpressionIR, SourceSpan } from "@typecode/core/shared";
import { getStdLibSupport } from "@typecode/core/shared";

export const arduinoAsyncPolyfill: PolyfillDefinition = {
  id: "async_arduino",
  name: "Arduino Async/Await",
  description: "Transforms async/await into cooperative state machines",
  domains: ["arduino", "standard", "embedded"],

  detect(program: ProgramIR, context: PolyfillContext): PolyfillNeed[] {
    const needs: PolyfillNeed[] = [];
    let requiresRuntime = false;

    for (const fn of program.functions) {
      if (fn.isAsync) {
        requiresRuntime = true;
        const awaitPoints = findAwaitPoints(fn.statements);
        needs.push({
          id: `async_${fn.originalName}`,
          sourceSpan: fn.sourceSpan,
          details: {
            functionName: fn.originalName,
            awaitCount: awaitPoints.length,
            awaitPoints,
            returnType: fn.returnType,
            parameters: fn.parameters,
            statements: fn.statements,
          },
        });
      }
    }

    if (context.usedIdentifiers.has("Promise") || context.usedIdentifiers.has("Promise.resolve") || context.usedIdentifiers.has("Promise.reject")) {
      requiresRuntime = true;
    }

    if (requiresRuntime) {
      const rootSpan = program.functions[0]?.sourceSpan ?? {
        filePath: program.fileName,
        startOffset: 0,
        endOffset: 0,
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 1,
      };
      needs.push({
        id: "async_runtime",
        sourceSpan: rootSpan,
        details: {
          runtimeOnly: true,
        },
      });
    }

    return needs;
  },

  generate(needs: PolyfillNeed[], context: PolyfillContext): RuntimePolyfillIR {
    // Only generate the cooperative runtime infrastructure here.
    // State machine classes for each async function are emitted by cpp-emitter.ts,
    // which has access to renderStatement and board constants.
    const asyncTaskVars: string[] = [];
    for (const need of needs) {
      if (need.id === "async_runtime") {
        continue;
      }
      const { functionName } = need.details;
      asyncTaskVars.push(`${functionName}Task`);
    }

    // AVR (and other bare-metal targets without the C++ stdlib) cannot use
    // <functional>, <vector>, <utility>, or <string>.  For those targets we
    // emit only the state-machine skeletons (done by cpp-emitter.ts) and skip
    // the Promise/MicrotaskQueue runtime entirely.
    const stdlib = getStdLibSupport(context.architecture);
    const hasPromiseRuntime = stdlib.hasVector && stdlib.hasString;

    return {
      kind: "polyfill",
      id: "async_arduino",
      domain: context.target === "arduino" ? "arduino" : "standard",
      requiredIncludes: hasPromiseRuntime
        ? ["<functional>", "<vector>", "<utility>", "<string>"]
        : [],
      forwardDeclarations: [],
      helperStructs: hasPromiseRuntime ? [generatePromiseRuntime(context)] : [],
      helperFunctions: [],
      shimMacros: [],
      dependencies: [],
      asyncTaskVars,
      hasPromiseRuntime,
    };
  },
};

interface AwaitPoint {
  sourceSpan: SourceSpan;
  statementIndex: number;
  delayValue?: number; // If it's a delay() call
}

export function findAwaitPoints(statements: StatementIR[]): AwaitPoint[] {
  const points: AwaitPoint[] = [];
  
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    points.push(...extractAwaitFromStatement(stmt, i));
  }
  
  return points;
}

function extractAwaitFromStatement(stmt: StatementIR, statementIndex: number): AwaitPoint[] {
  const points: AwaitPoint[] = [];

  const addAwaitPointsFromExpression = (expr: ExpressionIR | undefined): void => {
    if (!expr) {
      return;
    }
    points.push(...extractAwaitFromExpression(expr, stmt.sourceSpan, statementIndex));
  };

  if (stmt.kind === "call") {
    // If the call was originally `await call()`, it IS the await point itself.
    if ((stmt as any).isAwaited) {
      points.push({ sourceSpan: stmt.sourceSpan, statementIndex });
      return points;
    }
    for (const arg of stmt.args) {
      addAwaitPointsFromExpression(arg);
    }
  }

  if (stmt.kind === "var_decl") {
    addAwaitPointsFromExpression(stmt.initializer);
  }

  if (stmt.kind === "assign") {
    addAwaitPointsFromExpression(stmt.value);
  }

  if (stmt.kind === "return") {
    addAwaitPointsFromExpression(stmt.value);
  }

  if (stmt.kind === "while" || stmt.kind === "do_while") {
    addAwaitPointsFromExpression(stmt.condition);
  }

  if (stmt.kind === "if") {
    addAwaitPointsFromExpression(stmt.condition);
  }

  if (stmt.kind === "for") {
    if (stmt.initializer) {
      points.push(...extractAwaitFromStatement(stmt.initializer, statementIndex));
    }
    addAwaitPointsFromExpression(stmt.condition);
    if (stmt.increment) {
      points.push(...extractAwaitFromStatement(stmt.increment, statementIndex));
    }
  }

  if (stmt.kind === "for_of") {
    points.push(...extractAwaitFromStatement(stmt.variable, statementIndex));
    addAwaitPointsFromExpression(stmt.iterable);
  }

  if (stmt.kind === "for_in") {
    points.push(...extractAwaitFromStatement(stmt.variable, statementIndex));
    addAwaitPointsFromExpression(stmt.object);
  }

  if (stmt.kind === "switch") {
    addAwaitPointsFromExpression(stmt.expression);
    for (const caseClause of stmt.cases) {
      addAwaitPointsFromExpression(caseClause.value);
    }
  }

  if (stmt.kind === "throw") {
    addAwaitPointsFromExpression(stmt.value);
  }

  // Check while loops
  if (stmt.kind === "while") {
    for (let i = 0; i < stmt.body.length; i++) {
      points.push(...extractAwaitFromStatement(stmt.body[i], i));
    }
  }

  // Check for loops
  if (stmt.kind === "for" || stmt.kind === "for_of" || stmt.kind === "for_in") {
    for (let i = 0; i < stmt.body.length; i++) {
      points.push(...extractAwaitFromStatement(stmt.body[i], i));
    }
  }

  // Check if statements
  if (stmt.kind === "if") {
    for (let i = 0; i < stmt.thenBranch.length; i++) {
      points.push(...extractAwaitFromStatement(stmt.thenBranch[i], i));
    }
    if (stmt.elseBranch) {
      for (let i = 0; i < stmt.elseBranch.length; i++) {
        points.push(...extractAwaitFromStatement(stmt.elseBranch[i], i));
      }
    }
  }

  if (stmt.kind === "switch") {
    for (const caseClause of stmt.cases) {
      for (let i = 0; i < caseClause.body.length; i++) {
        points.push(...extractAwaitFromStatement(caseClause.body[i], i));
      }
    }
  }

  if (stmt.kind === "try") {
    for (let i = 0; i < stmt.tryBlock.length; i++) {
      points.push(...extractAwaitFromStatement(stmt.tryBlock[i], i));
    }
    if (stmt.catchBlock) {
      for (let i = 0; i < stmt.catchBlock.length; i++) {
        points.push(...extractAwaitFromStatement(stmt.catchBlock[i], i));
      }
    }
  }

  return points;
}

function extractAwaitFromExpression(expr: ExpressionIR, sourceSpan: SourceSpan, statementIndex: number): AwaitPoint[] {
  const points: AwaitPoint[] = [];

  if (expr.kind === "await") {
    points.push({
      sourceSpan,
      statementIndex,
    });
    points.push(...extractAwaitFromExpression(expr.value, sourceSpan, statementIndex));
    return points;
  }

  if (expr.kind === "ternary") {
    points.push(...extractAwaitFromExpression(expr.condition, sourceSpan, statementIndex));
    points.push(...extractAwaitFromExpression(expr.whenTrue, sourceSpan, statementIndex));
    points.push(...extractAwaitFromExpression(expr.whenFalse, sourceSpan, statementIndex));
    return points;
  }

  if (expr.kind === "array") {
    for (const element of expr.elements) {
      points.push(...extractAwaitFromExpression(element, sourceSpan, statementIndex));
    }
    return points;
  }

  if (expr.kind === "object") {
    for (const field of expr.fields) {
      points.push(...extractAwaitFromExpression(field.value, sourceSpan, statementIndex));
    }
    return points;
  }

  if (expr.kind === "instanceof") {
    points.push(...extractAwaitFromExpression(expr.object, sourceSpan, statementIndex));
    return points;
  }

  if (expr.kind === "spread_array") {
    points.push(...extractAwaitFromExpression(expr.spreadExpr, sourceSpan, statementIndex));
    for (const element of expr.additionalElements) {
      points.push(...extractAwaitFromExpression(element, sourceSpan, statementIndex));
    }
  }

  return points;
}

interface StateMachineResult {
  classDef: string;
  instanceDecl: string;
}

function generateStateMachineClass(
  functionName: string,
  statements: StatementIR[],
  awaitPoints: AwaitPoint[],
  parameters: any[],
  returnType: string,
  context: PolyfillContext
): StateMachineResult {
  const className = `${toPascalCase(functionName)}Task`;
  
  // Generate state enum
  const stateCount = Math.max(1, awaitPoints.length + 1);
  const stateNames: string[] = [];
  for (let i = 0; i < stateCount; i++) {
    stateNames.push(`STATE_${i}`);
  }

  // For now, generate a simple state machine template
  // A full implementation would analyze the actual await points
  const classDef = `
// Polyfill: Async state machine for ${functionName}
class ${className} {
public:
  enum State { ${stateNames.join(", ")} };
  
  ${className}() : _state(STATE_0), _waitUntil(0) {}
  
  void run() {
    switch (_state) {
      case STATE_0:
        // Initial state - call the synchronous portion
        // Full implementation would split the function at await points
        _state = STATE_${stateCount - 1};
        break;
      
      ${generateIntermediateStates(awaitPoints)}
      
      case STATE_${stateCount - 1}:
        // Completed state
        break;
    }
  }
  
  bool isComplete() const { return _state == STATE_${stateCount - 1}; }
  void reset() { _state = STATE_0; _waitUntil = 0; }
  
private:
  State _state;
  unsigned long _waitUntil;
};
`;

  const instanceDecl = `${className} ${functionName}Task;`;

  return { classDef, instanceDecl };
}

function generateIntermediateStates(awaitPoints: AwaitPoint[]): string {
  // Generate stub states for intermediate await points
  const states: string[] = [];
  
  for (let i = 1; i < awaitPoints.length + 1 && i < 10; i++) {
    states.push(`
      case STATE_${i}:
        // Wait for condition or time
        if (millis() >= _waitUntil) {
          _state = STATE_${i + 1};
        }
        break;
`);
  }
  
  return states.join("");
}

function toPascalCase(str: string): string {
  return str
    .split(/[_\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

function generatePromiseRuntime(context: PolyfillContext): string {
  const queueCapacity = context.target === "arduino" ? 32 : 256;
  return `
// Polyfill: cooperative microtask queue + minimal Promise runtime
namespace typecode_async {
  using Microtask = std::function<void()>;

  class MicrotaskQueue {
  public:
    static MicrotaskQueue& instance() {
      static MicrotaskQueue queue;
      return queue;
    }

    bool enqueue(Microtask task) {
      if (_queue.size() >= ${queueCapacity}) {
        return false;
      }
      _queue.push_back(std::move(task));
      return true;
    }

    void pump() {
      const size_t total = _queue.size();
      for (size_t i = 0; i < total; ++i) {
        Microtask task = std::move(_queue[i]);
        task();
      }
      if (total > 0) {
        _queue.erase(_queue.begin(), _queue.begin() + static_cast<long long>(total));
      }
    }

  private:
    std::vector<Microtask> _queue;
  };

  inline void enqueueMicrotask(Microtask task) {
    MicrotaskQueue::instance().enqueue(std::move(task));
  }

  inline void pumpMicrotasks() {
    MicrotaskQueue::instance().pump();
  }

  template <typename T>
  class Promise {
  public:
    enum class State { Pending, Fulfilled, Rejected };

    Promise() : _state(State::Pending), _value{}, _error{} {}

    explicit Promise(std::function<void(std::function<void(const T&)>, std::function<void(const std::string&)>)> executor)
      : _state(State::Pending), _value{}, _error{} {
      executor(
        [this](const T& value) { this->resolve(value); },
        [this](const std::string& error) { this->reject(error); }
      );
    }

    static Promise<T> resolveValue(const T& value) {
      Promise<T> promise;
      promise.resolve(value);
      return promise;
    }

    static Promise<T> rejectValue(const std::string& error) {
      Promise<T> promise;
      promise.reject(error);
      return promise;
    }

    void resolve(const T& value) {
      if (_state != State::Pending) {
        return;
      }
      _state = State::Fulfilled;
      _value = value;
      auto callbacks = _onFulfilled;
      enqueueMicrotask([callbacks, value]() mutable {
        for (auto& callback : callbacks) {
          callback(value);
        }
      });
    }

    void reject(const std::string& error) {
      if (_state != State::Pending) {
        return;
      }
      _state = State::Rejected;
      _error = error;
      auto callbacks = _onRejected;
      enqueueMicrotask([callbacks, error]() mutable {
        for (auto& callback : callbacks) {
          callback(error);
        }
      });
    }

    Promise<T>& then(std::function<void(const T&)> onFulfilled) {
      if (_state == State::Fulfilled) {
        const T value = _value;
        enqueueMicrotask([onFulfilled, value]() mutable { onFulfilled(value); });
      } else if (_state == State::Pending) {
        _onFulfilled.push_back(std::move(onFulfilled));
      }
      return *this;
    }

    Promise<T>& catchError(std::function<void(const std::string&)> onRejected) {
      if (_state == State::Rejected) {
        const std::string error = _error;
        enqueueMicrotask([onRejected, error]() mutable { onRejected(error); });
      } else if (_state == State::Pending) {
        _onRejected.push_back(std::move(onRejected));
      }
      return *this;
    }

  private:
    State _state;
    T _value;
    std::string _error;
    std::vector<std::function<void(const T&)>> _onFulfilled;
    std::vector<std::function<void(const std::string&)>> _onRejected;
  };
}

inline void typecode_pump_microtasks() {
  typecode_async::pumpMicrotasks();
}
`;
}
