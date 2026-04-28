/**
 * Function Emitter for C++ code emission.
 * Handles rendering of functions and callbacks.
 * Extracted from cpp-emitter.ts
 */

import type { StatementIR, ExpressionIR } from "../ir/model";
import type { PlatformStrategy } from "../platform/platform-strategy";
import type { BoardConstants } from "../ir/board-resolver";
import { StatementRenderer } from "./statement-renderer";
import { ExpressionRenderer } from "./expression-renderer";
import { emitCommentLines } from "./utils";

/**
 * Context for function emission.
 */
export interface FunctionEmitterContext {
  /** The platform strategy */
  strategy: PlatformStrategy;
  /** Board constants */
  boardConstants?: BoardConstants;
  /** Arduino class name map */
  arduinoClassNameMap?: Map<string, string>;
  /** Enum names for scoped access */
  enumNames: Set<string>;
  /** Large enum names */
  largeEnumNames: Set<string>;
  /** Function return types */
  knownFunctionReturnTypes: Map<string, string>;
  /** Pointer variable types */
  pointerVarTypes?: Map<string, string>;
  /** Pointer struct fields */
  pointerStructFields?: Set<string>;
}

/**
 * Function definition for emission.
 */
export interface FunctionDefForEmit {
  name: string;
  originalName?: string;
  returnType: string;
  parameters: Array<{ name: string; cppType: string; defaultValue?: any }>;
  statements: StatementIR[];
  isAsync?: boolean;
  leadingComments?: string[];
  trailingComments?: string[];
  sourceSpan?: any;
}

/**
 * Callback function definition for emission.
 */
export interface CallbackDefForEmit {
  name: string;
  params: string[];
  statements: StatementIR[];
  debounceMs?: number;
}

/**
 * Handles emission of C++ functions and callbacks.
 */
export class FunctionEmitter {
  private readonly strategy: PlatformStrategy;
  private readonly statementRenderer: StatementRenderer;
  private readonly expressionRenderer: ExpressionRenderer;
  private readonly knownFunctionReturnTypes: Map<string, string>;
  private readonly pointerVarTypes?: Map<string, string>;

  constructor(context: FunctionEmitterContext) {
    this.strategy = context.strategy;
    this.knownFunctionReturnTypes = context.knownFunctionReturnTypes;
    this.pointerVarTypes = context.pointerVarTypes;

    this.expressionRenderer = new ExpressionRenderer({
      strategy: context.strategy,
      boardConstants: context.boardConstants,
      arduinoClassNameMap: context.arduinoClassNameMap,
      enumNames: context.enumNames,
      largeEnumNames: context.largeEnumNames,
      knownFunctionReturnTypes: context.knownFunctionReturnTypes,
      pointerVarTypes: context.pointerVarTypes,
    });

    this.statementRenderer = new StatementRenderer({
      strategy: context.strategy,
      boardConstants: context.boardConstants,
      arduinoClassNameMap: context.arduinoClassNameMap,
      enumNames: context.enumNames,
      largeEnumNames: context.largeEnumNames,
      knownFunctionReturnTypes: context.knownFunctionReturnTypes,
      pointerVarTypes: context.pointerVarTypes,
      pointerStructFields: context.pointerStructFields,
    });
  }

  /**
   * Gets the statement renderer for nested statement rendering.
   */
  getStatementRenderer(): StatementRenderer {
    return this.statementRenderer;
  }

  /**
   * Gets the expression renderer.
   */
  getExpressionRenderer(): ExpressionRenderer {
    return this.expressionRenderer;
  }

  /**
   * Renders a function declaration (for header files).
   */
  renderFunctionDeclaration(
    fn: FunctionDefForEmit,
    appendLine: (line: string) => void
  ): void {
    emitCommentLines(fn.leadingComments, "", (line) => appendLine(line));

    const params = this.statementRenderer.renderParameters(fn.parameters);
    const returnType = this.strategy.normalizeCppType(fn.returnType);

    appendLine(`${returnType} ${fn.name}(${params});`);

    emitCommentLines(fn.trailingComments, "", (line) => appendLine(line));
  }

  /**
   * Renders a function definition.
   */
  renderFunction(
    fn: FunctionDefForEmit,
    appendLine: (line: string) => void,
    renderNestedStatement: (stmt: StatementIR, indent: string) => void,
    options: {
      /** Whether to inject microtask pumping */
      hasPromiseRuntime?: boolean;
      /** Async driver function name */
      asyncDriverFn?: string;
      /** Whether this is async with runtime */
      isAsyncWithRuntime?: boolean;
      /** Async task variable names for loop injection */
      asyncTaskNames?: string[];
    } = {}
  ): void {
    const params = this.statementRenderer.renderParameters(fn.parameters);
    const returnType = this.strategy.normalizeCppType(fn.returnType);

    emitCommentLines(fn.leadingComments, "", (line) => appendLine(line));
    appendLine(`${returnType} ${fn.name}(${params}) {`);

    // Inject microtask pumping into the async driver function
    if (options.hasPromiseRuntime && fn.name === options.asyncDriverFn) {
      appendLine("  typehal_pump_microtasks();");
    }

    // Async tasks are driven by their state machine; don't emit the blocking body
    if (fn.isAsync && options.isAsyncWithRuntime) {
      appendLine(`  // driven as cooperative task in ${options.asyncDriverFn}()`);
    } else {
      for (const statement of fn.statements) {
        renderNestedStatement(statement, "  ");
      }
    }

    // Drive async state machines in the loop function
    if (options.hasPromiseRuntime && fn.name === options.asyncDriverFn && options.asyncTaskNames) {
      const injectionLines = this.strategy.asyncLoopInjection(options.asyncTaskNames, true);
      for (const line of injectionLines) {
        appendLine(`  ${line}`);
      }
    }

    appendLine("}");
    emitCommentLines(fn.trailingComments, "", (line) => appendLine(line));
    appendLine("");
  }

  /**
   * Renders a callback function (e.g., interrupt handler).
   */
  renderCallback(
    callback: CallbackDefForEmit,
    appendLine: (line: string) => void,
    renderNestedStatement: (stmt: StatementIR, indent: string) => void
  ): void {
    // If debounce is configured, emit debounce wrapper
    if (callback.debounceMs !== undefined && callback.debounceMs > 0) {
      appendLine(`volatile unsigned long ${callback.name}_lastTime = 0;`);
      appendLine(`const unsigned long ${callback.name}_debounce = ${callback.debounceMs};`);
      appendLine("");
    }

    const params = callback.params.join(", ");
    appendLine(`void ${callback.name}(${params}) {`);

    // Add debounce check if configured
    if (callback.debounceMs !== undefined && callback.debounceMs > 0) {
      appendLine(`  volatile unsigned long now = ${this.strategy.currentTimeMillis()};`);
      appendLine(`  if (now - ${callback.name}_lastTime < ${callback.name}_debounce) return;`);
      appendLine(`  ${callback.name}_lastTime = now;`);
    }

    for (const stmt of callback.statements) {
      renderNestedStatement(stmt, "  ");
    }

    appendLine("}");
    appendLine("");
  }

  /**
   * Renders multiple callback functions.
   */
  renderCallbacks(
    callbacks: CallbackDefForEmit[],
    appendLine: (line: string) => void,
    renderNestedStatement: (stmt: StatementIR, indent: string) => void
  ): void {
    for (const callback of callbacks) {
      this.renderCallback(callback, appendLine, renderNestedStatement);
    }
  }
}