import type { StatementIR } from "../../api";
import type { EmitterContext } from "./emitter-context";

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

    const allSetupInitStmts = [...setupInitStmts];

    if (existingEp) {
      existingEp.statements = [...allSetupInitStmts, ...ctx.filteredTopLevelExecutables, ...existingEp.statements];
    } else {
      const isMain = epName === "main";
      const returnType = isMain ? "int" : "void";
      const stmts: StatementIR[] = isMain
        ? [...allSetupInitStmts, ...ctx.filteredTopLevelExecutables, { kind: "return" as const, sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, value: { kind: "number" as const, value: 0 } } as StatementIR]
        : [...allSetupInitStmts, ...ctx.filteredTopLevelExecutables];
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
