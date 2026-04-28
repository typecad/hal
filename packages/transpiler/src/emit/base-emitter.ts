/**
 * Base Emitter abstract class for C++ code emission.
 * Provides common emission logic with platform-specific extension points.
 * Extracted from cpp-emitter.ts
 */

import type { ProgramIR, StatementIR, FunctionIR, ClassIR, EnumIR } from "../ir/model";
import type { PlatformStrategy } from "../platform/platform-strategy";
import type { BoardConstants } from "../ir/board-resolver";
import type { ResolvedNpmPackage } from "../transpile";
// CppClass type is internal to arduino-libs - we use any for flexibility
import { StatementRenderer } from "./statement-renderer";
import {
  hasStdMathCalls,
  hasConsoleCalls,
  generateAsyncTaskClass,
  isTypecodeSDKImport,
  normalizeInclude,
  dedupe,
  resolveTranspiledModuleInclude,
  emitCommentLines,
} from "./utils";

/**
 * Context for C++ emission.
 */
export interface EmitterContext {
  /** The platform strategy for target-specific rendering */
  strategy: PlatformStrategy;
  /** Board constants for Board.definition.* access */
  boardConstants?: BoardConstants;
  /** Map of Arduino class simple names to fully qualified names */
  arduinoClassNameMap?: Map<string, string>;
  /** Map of source file paths to npm package info */
  npmPackages?: Map<string, ResolvedNpmPackage>;
  /** Arduino library classes */
  arduinoClasses?: Map<string, any>;
  /** Arduino library functions */
  arduinoFunctions?: Map<string, any>;
}

/**
 * Result of emitting a C++ file.
 */
export interface EmitResult {
  /** The C++ code */
  code: string;
  /** Required includes */
  includes: string[];
  /** Forward declarations needed */
  forwardDeclarations: string[];
}

/**
 * Base class for C++ emitters.
 * Provides common emission logic with platform-specific customization points.
 */
export abstract class BaseEmitter {
  protected readonly strategy: PlatformStrategy;
  protected readonly boardConstants?: BoardConstants;
  protected readonly arduinoClassNameMap?: Map<string, string>;
  protected readonly npmPackages?: Map<string, ResolvedNpmPackage>;
  protected readonly polyfills?: Map<string, PolyfillDefinition>;
  protected readonly arduinoClasses?: Map<string, any>;
  protected readonly arduinoFunctions?: Map<string, any>;

  // Collected during emission
  protected readonly enumNames = new Set<string>();
  protected readonly largeEnumNames = new Set<string>();
  protected readonly knownFunctionReturnTypes = new Map<string, string>();
  protected readonly globalPointerVarTypes = new Map<string, string>();
  protected readonly pointerStructFields = new Set<string>();
  protected readonly asyncTasks: Array<{ classDef: string; instanceDecl: string; taskVarName: string }> = [];

  constructor(context: EmitterContext) {
    this.strategy = context.strategy;
    this.boardConstants = context.boardConstants;
    this.arduinoClassNameMap = context.arduinoClassNameMap;
    this.npmPackages = context.npmPackages;
    this.polyfills = context.polyfills;
    this.arduinoClasses = context.arduinoClasses;
    this.arduinoFunctions = context.arduinoFunctions;
  }

  /**
   * Emits a complete C++ file from program IR.
   */
  abstract emit(program: ProgramIR, filePath: string): EmitResult;

  /**
   * Creates a statement renderer with the current context.
   */
  protected createStatementRenderer(pointerVarTypes?: Map<string, string>): StatementRenderer {
    return new StatementRenderer({
      strategy: this.strategy,
      boardConstants: this.boardConstants,
      arduinoClassNameMap: this.arduinoClassNameMap,
      enumNames: this.enumNames,
      largeEnumNames: this.largeEnumNames,
      knownFunctionReturnTypes: this.knownFunctionReturnTypes,
      pointerVarTypes: pointerVarTypes,
      pointerStructFields: this.pointerStructFields,
    });
  }

  /**
   * Collects type information from the program IR.
   */
  protected collectTypeInfo(program: ProgramIR): void {
    // Collect enum names
    for (const enumDef of program.enums) {
      this.enumNames.add(enumDef.name);
      // Check for large enum values
      for (const member of enumDef.members) {
        if (member.value !== undefined && (member.value > 32767 || member.value < -32768)) {
          this.largeEnumNames.add(enumDef.name);
          break;
        }
      }
    }

    // Collect function return types
    for (const func of program.functions) {
      if (func.returnType && func.originalName) {
        this.knownFunctionReturnTypes.set(func.originalName, func.returnType);
      }
    }

    // Collect class method return types
    for (const cls of program.classes) {
      for (const method of cls.methods) {
        if (method.returnType) {
          this.knownFunctionReturnTypes.set(`${cls.name}.${method.name}`, method.returnType);
        }
      }
    }

    // Collect pointer variable types from global variables
    for (const stmt of program.topLevelStatements) {
      if (stmt.kind === "var_decl" && stmt.cppType?.endsWith("*")) {
        this.globalPointerVarTypes.set(stmt.name, stmt.cppType);
      }
    }
  }

  /**
   * Renders function declarations for a header file.
   */
  protected renderFunctionDeclarations(functions: FunctionIR[], indent: string): string[] {
    const lines: string[] = [];
    const renderer = this.createStatementRenderer();

    for (const func of functions) {
      // Skip async functions in headers (they become classes)
      if (func.isAsync) continue;

      emitCommentLines(func.leadingComments, indent, (line) => lines.push(line));

      const params = renderer.renderParameters(func.parameters);
      const returnType = func.returnType || "void";

      lines.push(`${indent}${returnType} ${func.originalName}(${params});`);
    }

    return lines;
  }

  /**
   * Renders function definitions for an implementation file.
   */
  protected renderFunctionDefinitions(functions: FunctionIR[], indent: string): string[] {
    const lines: string[] = [];
    const renderer = this.createStatementRenderer();

    for (const func of functions) {
      if (func.isAsync) {
        // Generate async state machine class
        const result = generateAsyncTaskClass(
          func.originalName,
          func.statements,
          this.strategy,
          this.knownFunctionReturnTypes,
          (stmt, forHeader, strat, ptrTypes, calleeTransformer, retTypes) =>
            this.renderStatement(stmt, forHeader, strat, ptrTypes, calleeTransformer, retTypes)
        );
        this.asyncTasks.push(result);
        continue;
      }

      emitCommentLines(func.leadingComments, indent, (line) => lines.push(line));

      const params = renderer.renderParameters(func.parameters);
      const returnType = func.returnType || "void";

      lines.push(`${indent}${returnType} ${func.originalName}(${params}) {`);

      // Render function body
      for (const stmt of func.statements) {
        const stmtLines = this.renderStatementWithBody(stmt, `${indent}  `, renderer);
        lines.push(...stmtLines);
      }

      lines.push(`${indent}}`);
      lines.push("");
    }

    return lines;
  }

  /**
   * Renders a statement and its nested body (if any).
   */
  protected renderStatementWithBody(
    stmt: StatementIR,
    indent: string,
    renderer: StatementRenderer
  ): string[] {
    const lines: string[] = [];
    const rendered = renderer.render(stmt, false);

    if (stmt.kind === "if" || stmt.kind === "while" || stmt.kind === "for" || 
        stmt.kind === "for_of" || stmt.kind === "for_in" || stmt.kind === "switch" ||
        stmt.kind === "do_while") {
      lines.push(`${indent}${rendered} {`);
      // Body would be rendered here by the caller
      // This is a simplified version - full implementation needs body access
    } else {
      lines.push(`${indent}${rendered}`);
    }

    return lines;
  }

  /**
   * Renders a single statement (callback for async state machine).
   */
  protected renderStatement(
    stmt: StatementIR,
    forHeader: boolean,
    strategy: PlatformStrategy,
    pointerVarTypes?: Map<string, string>,
    calleeTransformer?: (callee: string) => string,
    knownFunctionReturnTypes?: Map<string, string>
  ): string {
    const renderer = new StatementRenderer({
      strategy,
      boardConstants: this.boardConstants,
      arduinoClassNameMap: this.arduinoClassNameMap,
      enumNames: this.enumNames,
      largeEnumNames: this.largeEnumNames,
      knownFunctionReturnTypes: knownFunctionReturnTypes || this.knownFunctionReturnTypes,
      pointerVarTypes,
      pointerStructFields: this.pointerStructFields,
    });
    return renderer.render(stmt, forHeader, calleeTransformer);
  }

  /**
   * Renders class declarations for a header file.
   */
  protected renderClassDeclarations(classes: ClassIR[], indent: string): string[] {
    const lines: string[] = [];

    for (const cls of classes) {
      emitCommentLines(cls.leadingComments, indent, (line) => lines.push(line));

      lines.push(`${indent}class ${cls.name} {`);
      lines.push(`${indent}public:`);

      // Constructor declarations
      if (cls.constructor) {
        const params = this.createStatementRenderer().renderParameters(cls.constructor.parameters);
        lines.push(`${indent}  ${cls.name}(${params});`);
      }

      // Method declarations - render each method directly since ClassMethodIR differs from FunctionIR
      for (const method of cls.methods) {
        emitCommentLines(method.name === cls.name ? undefined : undefined, `${indent}  `, (line) => lines.push(line));
        const params = this.createStatementRenderer().renderParameters(method.parameters);
        const returnType = method.returnType || "void";
        lines.push(`${indent}  ${returnType} ${method.name}(${params});`);
      }

      // Fields
      if (cls.fields.length > 0) {
        lines.push(`${indent}private:`);
        for (const field of cls.fields) {
          const fieldDecl = `${field.cppType} ${field.name};`;
          lines.push(`${indent}  ${fieldDecl}`);
        }
      }

      lines.push(`${indent}};`);
      lines.push("");
    }

    return lines;
  }

  /**
   * Renders enum definitions.
   */
  protected renderEnumDefinitions(enums: EnumIR[], indent: string): string[] {
    const lines: string[] = [];

    for (const enumDef of enums) {
      emitCommentLines(enumDef.leadingComments, indent, (line) => lines.push(line));

      const underlyingType = this.largeEnumNames.has(enumDef.name) ? "int32_t" : "int16_t";
      // Use enum class by default for better type safety
      const enumKeyword = `enum class`;

      lines.push(`${indent}${enumKeyword} ${enumDef.name} : ${underlyingType} {`);

      for (let i = 0; i < enumDef.members.length; i++) {
        const member = enumDef.members[i];
        const comma = i < enumDef.members.length - 1 ? "," : "";
        if (member.value !== undefined) {
          lines.push(`${indent}  ${member.name} = ${member.value}${comma}`);
        } else {
          lines.push(`${indent}  ${member.name}${comma}`);
        }
      }

      lines.push(`${indent}};`);
      lines.push("");
    }

    return lines;
  }

  /**
   * Checks if the program uses std::variant types (from multi-type unions).
   */
  private programUsesVariant(program: ProgramIR): boolean {
    const variantPattern = /std::variant</;
    const checkType = (t: string): boolean => variantPattern.test(t);

    // Check functions
    for (const fn of program.functions) {
      if (checkType(fn.returnType)) return true;
      for (const param of fn.parameters) {
        if (checkType(param.cppType)) return true;
      }
    }
    // Check classes
    for (const cls of program.classes) {
      for (const field of cls.fields) {
        if (checkType(field.cppType)) return true;
      }
      for (const method of cls.methods) {
        if (checkType(method.returnType)) return true;
        for (const param of method.parameters) {
          if (checkType(param.cppType)) return true;
        }
      }
    }
    // Check type aliases
    for (const ta of program.typeAliases) {
      if (checkType(ta.cppType)) return true;
    }
    return false;
  }

  /**
   * Determines required includes for the program.
   */
  protected collectIncludes(program: ProgramIR, filePath: string): string[] {
    const includes: string[] = [];

    // Check for standard library needs
    if (hasStdMathCalls(program)) {
      includes.push("<math.h>");
    }

    if (hasConsoleCalls(program)) {
      // Arduino uses Serial, native could use stdio
      includes.push("<Arduino.h>");
    }

    // Check for std::variant usage (from union types)
    if (this.programUsesVariant(program)) {
      includes.push("<variant>");
    }

    // Add includes from imports
    for (const imp of program.imports) {
      // Skip typecode SDK imports (they're type-level only)
      if (isTypecodeSDKImport(imp.moduleSpecifier, filePath)) {
        continue;
      }

      // Check for transpiled npm packages
      const transpiled = resolveTranspiledModuleInclude(imp.moduleSpecifier, this.npmPackages, filePath);
      if (transpiled.isTranspiled && transpiled.include) {
        includes.push(transpiled.include);
        continue;
      }

      // Handle Arduino library imports
      if (this.arduinoClasses?.has(imp.moduleSpecifier) || this.arduinoFunctions?.has(imp.moduleSpecifier)) {
        // Arduino libraries are typically included via the platform
        continue;
      }
    }

    // Add polyfill includes
    if (this.polyfills) {
      for (const [, polyfill] of this.polyfills) {
        if ((polyfill as any).include) {
          includes.push(normalizeInclude((polyfill as any).include));
        }
      }
    }

    return dedupe(includes);
  }

  /**
   * Renders the include block.
   */
  protected renderIncludes(includes: string[]): string[] {
    const lines: string[] = [];
    
    // Sort: system includes first, then local includes
    const systemIncludes = includes.filter(i => i.startsWith("<"));
    const localIncludes = includes.filter(i => i.startsWith('"'));
    
    systemIncludes.sort();
    localIncludes.sort();

    for (const inc of systemIncludes) {
      lines.push(`#include ${inc}`);
    }
    
    if (systemIncludes.length > 0 && localIncludes.length > 0) {
      lines.push("");
    }

    for (const inc of localIncludes) {
      lines.push(`#include ${inc}`);
    }

    return lines;
  }
}