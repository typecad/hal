import type { StatementIR } from "../../api/index.js";
import type { EmitterContext } from "./emitter-context.js";
import { entryHasUI } from "../../ui-hook.js";
import { uiPressBindings, watchPinSpecs } from "../../ir/transformers/ui-call-resolver.js";
import { getDisplayProfile } from "../../stores/display-profile-store.js";

function isDisplayInitStatement(statement: StatementIR): boolean {
  return statement.kind === "hal-op" && statement.operation.operation === "display.init";
}

export function synthesizeEntrypoints(ctx: EmitterContext): void {
  const { program, strategy, isEntryFile, mappedFunctions } = ctx;
  const entrypointFunctionName = strategy.entrypointFunctionName();

  // Merge top-level executables into the entrypoint function
  if (isEntryFile && ctx.filteredTopLevelExecutables.length > 0) {
    const epName = entrypointFunctionName;
    const existingEp = mappedFunctions.find(fn => fn.name === epName);

    const setupInitLines = strategy.setupInitCode?.(program, ctx.options.platformContext) ?? [];
    const setupInitStmts: StatementIR[] = setupInitLines.map(line => ({
      kind: "call" as const,
      callee: `__RAW_STMT__${line}`,
      args: [],
      sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
    }));

    const displayInitStmts: StatementIR[] = [];
    const topLevelExecutableStmts = ctx.filteredTopLevelExecutables.filter((statement) => {
      if (isDisplayInitStatement(statement)) {
        displayInitStmts.push(statement);
        return false;
      }
      return true;
    });

    // UI hardware/runtime setup. Only emitted when a UI is mounted.
    const uiSetupStmts: StatementIR[] = [];
    if (entryHasUI()) {
      // Touch controller begin (if touch is configured). Hardware setup runs
      // before ui_init() so the first frame starts from a fully initialized
      // display/touch stack.
      const tProfile = getDisplayProfile();
      if (tProfile.touch) {
        uiSetupStmts.push(
          { kind: "call" as const, callee: `__RAW_STMT__touch_init();`, args: [],
            sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 } },
        );
      }
      // ISR-based press/release wiring (legacy) + pin-watchers (ui.watchPin).
      // These are GPIO-hardware APIs: pinMode/attachInterrupt/digitalPinToInterrupt
      // are Arduino core symbols, and ui_poll_inputs reads pins via digitalRead.
      // On a host target with no GPIO (SDL native: strategy.modelsGpio()===false)
      // they have no equivalent — emitting them yields undefined symbols or a
      // silent no-op. Gate on modelsGpio and surface a clear diagnostic instead.
      const modelsGpio = strategy.modelsGpio?.() ?? true;
      const pressBindings = uiPressBindings();
      const pinWatchers = watchPinSpecs();
      if (!modelsGpio && (pressBindings.length > 0 || pinWatchers.length > 0)) {
        const which = pressBindings.length > 0 && pinWatchers.length > 0
          ? "ui.press and ui.watchPin"
          : pressBindings.length > 0 ? "ui.press" : "ui.watchPin";
        ctx.emitDiagnostics.push({
          severity: "error",
          code: "gpio-unsupported-on-target",
          message: `${which} require GPIO hardware, which this target (${ctx.options.target}) does not model. Use the browser preview to exercise pin-driven UI, or target a framework that models GPIO pins.`,
          source: program.fileName,
        } as never);
      }
      if (modelsGpio) {
        for (const pb of pressBindings) {
          const mode = pb.edge === "press" ? "FALLING" : "RISING";
          uiSetupStmts.push(
            { kind: "call" as const, callee: `__RAW_STMT__pinMode(${pb.pin}, INPUT_PULLUP);`, args: [],
              sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 } },
            { kind: "call" as const, callee: `__RAW_STMT__attachInterrupt(digitalPinToInterrupt(${pb.pin}), ${pb.handlerName}, ${mode});`, args: [],
              sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 } },
          );
        }
        // Pin-watchers (from ui.watchPin): set pin mode so ui_poll_inputs can read it
        for (const wp of pinWatchers) {
          uiSetupStmts.push(
            { kind: "call" as const, callee: `__RAW_STMT__pinMode(${wp.pin}, INPUT_PULLUP);`, args: [],
              sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 } },
          );
        }
      }
      // Initial draw: mark all UI nodes dirty so the first ui_tick renders.
      uiSetupStmts.push(
        { kind: "call" as const, callee: `__RAW_STMT__ui_init();`, args: [],
          sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 } },
      );
    }

    const allSetupInitStmts = [...setupInitStmts, ...displayInitStmts, ...uiSetupStmts];

    if (existingEp) {
      existingEp.statements = [...allSetupInitStmts, ...topLevelExecutableStmts, ...existingEp.statements];
    } else {
      const isMain = epName === "main";
      // Route through mapReturnType so platform strategies can special-case the
      // entrypoint signature (e.g. NativeStrategy keeps main → int instead of
      // normalizing int → long long). The emitted return type is then treated
      // as final by mapReturnTypeForEmit (no re-normalisation).
      const mapReturnType = (fnName: string, tsType: string) => ctx.statementRenderer.mapReturnType(fnName, tsType);
      const returnType = mapReturnType(epName, isMain ? "int" : "void");
      const stmts: StatementIR[] = isMain
        ? [...allSetupInitStmts, ...topLevelExecutableStmts, { kind: "return" as const, sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, value: { kind: "number" as const, value: 0 } } as StatementIR]
        : [...allSetupInitStmts, ...topLevelExecutableStmts];
      const insertFn = {
        name: epName,
        originalName: epName,
        returnType,
        sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        leadingComments: [`// Auto-generated ${epName}() for top-level statements`],
        trailingComments: undefined,
        parameters: [],
        isAsync: false,
        typeParameters: undefined,
        typeParameterConstraints: undefined,
        isReadonlyReturnType: false,
        statements: stmts,
      };
      if (isMain) {
        mappedFunctions.push(insertFn);
      } else {
        mappedFunctions.unshift(insertFn);
      }
    }
  }

  // Ensure the entrypoint function exists even when all executables were filtered
  if (isEntryFile && !mappedFunctions.some((fn) => fn.name === entrypointFunctionName)) {
    const isMain = entrypointFunctionName === "main";
    const mapReturnType = (fnName: string, tsType: string) => ctx.statementRenderer.mapReturnType(fnName, tsType);
    const returnType = mapReturnType(entrypointFunctionName, isMain ? "int" : "void");
    const stmts: StatementIR[] = isMain
      ? [{ kind: "return" as const, sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, value: { kind: "number" as const, value: 0 } } as StatementIR]
      : [];
    const insertFn = {
      name: entrypointFunctionName,
      returnType,
      sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      leadingComments: undefined,
      trailingComments: undefined,
      parameters: [],
      isAsync: false,
      typeParameters: undefined,
      typeParameterConstraints: undefined,
      isReadonlyReturnType: false,
      statements: stmts,
    };
    if (isMain) {
      mappedFunctions.push(insertFn);
    } else {
      mappedFunctions.unshift(insertFn);
    }
  }

  // Some platforms require a loop function even if empty
  if (isEntryFile && strategy.requiresLoopFunction() && !mappedFunctions.some((fn) => fn.name === "loop")) {
    mappedFunctions.push({
      name: "loop",
      returnType: "void",
      sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      leadingComments: ctx.hasAsyncRuntime ? ["// Auto-generated loop() for async microtask pumping"] : undefined,
      trailingComments: undefined,
      parameters: [],
      isAsync: false,
      typeParameters: undefined,
      typeParameterConstraints: undefined,
      isReadonlyReturnType: false,
      statements: [],
    });
  }

  // Only generate main() for entry files when there's no loop-based strategy
  if (isEntryFile && ctx.hasAsyncRuntime && !strategy.requiresLoopFunction() && !mappedFunctions.some((fn) => fn.name === "main")) {
    const mapReturnType = (fnName: string, tsType: string) => ctx.statementRenderer.mapReturnType(fnName, tsType);
    mappedFunctions.push({
      name: "main",
      returnType: mapReturnType("main", "int"),
      sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      leadingComments: ["// Auto-generated main() for async microtask pumping"],
      trailingComments: undefined,
      parameters: [],
      isAsync: false,
      typeParameters: undefined,
      typeParameterConstraints: undefined,
      isReadonlyReturnType: false,
      statements: [{ kind: "return", sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, value: { kind: "number", value: 0 } }],
    });
  }
}
