/**
 * Class Emitter for C++ code emission.
 * Handles rendering of classes, structs, and their members.
 * Extracted from cpp-emitter.ts
 */

import type { ClassIR, StatementIR, ExpressionIR } from "../ir/model";
import type { PlatformStrategy } from "../platform/platform-strategy";
import type { BoardConstants } from "../ir/board-resolver";
import { StatementRenderer, type StatementRendererContext } from "./statement-renderer";
import { ExpressionRenderer, type ExpressionRendererContext } from "./expression-renderer";
import { emitCommentLines, inferObjectFieldType, collectPointerVarTypes } from "./utils";

/**
 * Context for class emission.
 */
export interface ClassEmitterContext {
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
 * Handles emission of C++ classes and structs.
 */
export class ClassEmitter {
  private readonly strategy: PlatformStrategy;
  private readonly statementRenderer: StatementRenderer;
  private readonly expressionRenderer: ExpressionRenderer;
  private readonly knownFunctionReturnTypes: Map<string, string>;
  private readonly pointerVarTypes?: Map<string, string>;

  constructor(context: ClassEmitterContext) {
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
   * Renders a class definition.
   */
  renderClass(
    classDef: ClassIR,
    appendLine: (line: string) => void,
    renderNestedStatement: (stmt: StatementIR, indent: string) => void
  ): void {
    emitCommentLines(classDef.leadingComments, "", (line) => appendLine(line));

    // Build inheritance clause
    const inheritanceParts: string[] = [];
    if (classDef.extendsClass) {
      inheritanceParts.push(`public ${classDef.extendsClass}`);
    }
    if (classDef.implementsInterfaces && classDef.implementsInterfaces.length > 0) {
      for (const iface of classDef.implementsInterfaces) {
        inheritanceParts.push(`public ${iface}`);
      }
    }
    const inheritanceClause = inheritanceParts.length > 0 ? ` : ${inheritanceParts.join(", ")}` : "";

    if (classDef.isAbstract) {
      appendLine(`// Abstract class - contains pure virtual methods`);
    }

    appendLine(`class ${classDef.name}${inheritanceClause} {`);

    // Group by visibility
    const publicFields = classDef.fields.filter(f => f.visibility === "public");
    const privateFields = classDef.fields.filter(f => f.visibility === "private");
    const protectedFields = classDef.fields.filter(f => f.visibility === "protected");
    const publicMethods = classDef.methods.filter(m => m.visibility === "public");
    const privateMethods = classDef.methods.filter(m => m.visibility === "private");
    const protectedMethods = classDef.methods.filter(m => m.visibility === "protected");

    // Public section
    if (publicFields.length > 0 || publicMethods.length > 0 || classDef.constructor) {
      appendLine("public:");

      // Constructor
      if (classDef.constructor) {
        const ctorParams = this.statementRenderer.renderParameters(classDef.constructor.parameters);
        let ctorInitializer = "";
        let ctorStatements = classDef.constructor.statements;
        const firstStmt = ctorStatements[0];

        if (classDef.extendsClass && firstStmt?.kind === "call" && firstStmt.callee === "super") {
          const baseArgs = firstStmt.args.map((arg) => this.expressionRenderer.render(arg)).join(", ");
          ctorInitializer = ` : ${classDef.extendsClass}(${baseArgs})`;
          ctorStatements = ctorStatements.slice(1);
        }

        appendLine(`  ${classDef.name}(${ctorParams})${ctorInitializer} {`);
        for (const stmt of ctorStatements) {
          renderNestedStatement(stmt, "    ");
        }
        appendLine("  }");
        appendLine("");
      }

      // Public fields
      for (const field of publicFields) {
        const initSuffix = field.initializer ? ` = ${this.expressionRenderer.render(field.initializer)}` : "";
        const fieldType = this.strategy.overrideClassFieldType(field.name, this.normalizeCppType(field.cppType));
        appendLine(`  ${this.renderTypedName(fieldType, field.name)}${initSuffix};`);
      }
      if (publicFields.length > 0) {
        appendLine("");
      }

      // Public methods
      for (const method of publicMethods) {
        const methodParams = this.statementRenderer.renderParameters(method.parameters);
        const staticPrefix = method.isStatic ? "static " : "";
        const returnType = this.normalizeCppType(method.returnType);

        if (method.isAbstract) {
          appendLine(`  virtual ${returnType} ${method.name}(${methodParams}) = 0;`);
          appendLine("");
          continue;
        }

        appendLine(`  ${staticPrefix}${returnType} ${method.name}(${methodParams}) {`);
        for (const stmt of method.statements) {
          renderNestedStatement(stmt, "    ");
        }
        appendLine("  }");
        appendLine("");
      }
    }

    // Private section
    if (privateFields.length > 0 || privateMethods.length > 0) {
      appendLine("private:");
      for (const field of privateFields) {
        const initSuffix = field.initializer ? ` = ${this.expressionRenderer.render(field.initializer)}` : "";
        const fieldType = this.strategy.overrideClassFieldType(field.name, this.normalizeCppType(field.cppType));
        appendLine(`  ${this.renderTypedName(fieldType, field.name)}${initSuffix};`);
      }
      if (privateFields.length > 0) {
        appendLine("");
      }
      for (const method of privateMethods) {
        const methodParams = this.statementRenderer.renderParameters(method.parameters);
        const staticPrefix = method.isStatic ? "static " : "";
        appendLine(`  ${staticPrefix}${this.normalizeCppType(method.returnType)} ${method.name}(${methodParams}) {`);
        for (const stmt of method.statements) {
          renderNestedStatement(stmt, "    ");
        }
        appendLine("  }");
        appendLine("");
      }
    }

    // Protected section
    if (protectedFields.length > 0 || protectedMethods.length > 0) {
      appendLine("protected:");
      for (const field of protectedFields) {
        const initSuffix = field.initializer ? ` = ${this.expressionRenderer.render(field.initializer)}` : "";
        const fieldType = this.strategy.overrideClassFieldType(field.name, this.normalizeCppType(field.cppType));
        appendLine(`  ${this.renderTypedName(fieldType, field.name)}${initSuffix};`);
      }
      if (protectedFields.length > 0) {
        appendLine("");
      }
      for (const method of protectedMethods) {
        const methodParams = this.statementRenderer.renderParameters(method.parameters);
        const staticPrefix = method.isStatic ? "static " : "";
        appendLine(`  ${staticPrefix}${this.normalizeCppType(method.returnType)} ${method.name}(${methodParams}) {`);
        for (const stmt of method.statements) {
          renderNestedStatement(stmt, "    ");
        }
        appendLine("  }");
        appendLine("");
      }
    }

    appendLine("};");
    emitCommentLines(classDef.trailingComments, "", (line) => appendLine(line));
    appendLine("");
  }

  /**
   * Renders a namespace with its contents.
   */
  renderNamespace(
    ns: {
      name: string;
      leadingComments?: string[];
      trailingComments?: string[];
      enums: Array<{ name: string; members: { name: string; value?: number }[]; leadingComments?: string[]; trailingComments?: string[] }>;
      typeAliases: Array<{ name: string; cppType: string; leadingComments?: string[]; trailingComments?: string[] }>;
      constants: Array<{ name: string; cppType: string; value: ExpressionIR }>;
      classes: ClassIR[];
      functions: Array<{
        originalName: string;
        returnType: string;
        parameters: Array<{ name: string; cppType: string }>;
        statements: StatementIR[];
        leadingComments?: string[];
        trailingComments?: string[];
      }>;
    },
    appendLine: (line: string) => void,
    renderNestedStatement: (stmt: StatementIR, indent: string) => void,
    largeEnumNames: Set<string>
  ): void {
    emitCommentLines(ns.leadingComments, "", (line) => appendLine(line));
    appendLine(`namespace ${ns.name} {`);
    appendLine("");

    // Namespace enums
    for (const enumDef of ns.enums) {
      emitCommentLines(enumDef.leadingComments, "  ", (line) => appendLine(line));
      const needsLongUnderlying = this.strategy.needsLargeEnumUnderlying() &&
        enumDef.members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768));
      const underlyingType = needsLongUnderlying ? " : long" : "";
      appendLine(`  enum class ${enumDef.name}${underlyingType} {`);
      for (let i = 0; i < enumDef.members.length; i++) {
        const member = enumDef.members[i];
        const valueSuffix = member.value !== undefined ? ` = ${member.value}` : "";
        const commaSuffix = i < enumDef.members.length - 1 ? "," : "";
        appendLine(`    ${member.name}${valueSuffix}${commaSuffix}`);
      }
      appendLine("  };");
      emitCommentLines(enumDef.trailingComments, "  ", (line) => appendLine(line));
      appendLine("");
    }

    // Namespace type aliases
    for (const typeAlias of ns.typeAliases) {
      emitCommentLines(typeAlias.leadingComments, "  ", (line) => appendLine(line));
      const cppType = this.normalizeCppType(typeAlias.cppType);
      if (cppType !== "auto" && !this.strategy.shouldSkipTypeAlias(cppType)) {
        appendLine(`  using ${typeAlias.name} = ${cppType};`);
        emitCommentLines(typeAlias.trailingComments, "  ", (line) => appendLine(line));
        appendLine("");
      }
    }

    // Namespace constants
    for (const constant of ns.constants) {
      const constType = this.normalizeCppType(constant.cppType);
      if (constType !== "auto") {
        appendLine(`  const ${constType} ${constant.name} = ${this.expressionRenderer.render(constant.value)};`);
      } else {
        appendLine(`  const auto ${constant.name} = ${this.expressionRenderer.render(constant.value)};`);
      }
    }
    if (ns.constants.length > 0) {
      appendLine("");
    }

    // Namespace classes
    for (const classDef of ns.classes) {
      this.renderClass(classDef, (line) => appendLine(`  ${line}`), (stmt, indent) => renderNestedStatement(stmt, indent));
    }

    // Namespace functions
    for (const fn of ns.functions) {
      const parameterList = this.statementRenderer.renderParameters(fn.parameters);
      emitCommentLines(fn.leadingComments, "  ", (line) => appendLine(line));
      appendLine(`  ${this.normalizeCppType(fn.returnType)} ${fn.originalName}(${parameterList}) {`);
      for (const statement of fn.statements) {
        renderNestedStatement(statement, "    ");
      }
      appendLine("  }");
      emitCommentLines(fn.trailingComments, "  ", (line) => appendLine(line));
      appendLine("");
    }

    appendLine(`} // namespace ${ns.name}`);
    emitCommentLines(ns.trailingComments, "", (line) => appendLine(line));
    appendLine("");
  }

  private normalizeCppType(typeName: string): string {
    return this.strategy.normalizeCppType(typeName);
  }

  private renderTypedName(cppType: string, name: string, isConst = false): string {
    const normalizedType = this.normalizeCppType(cppType);
    const fnPtrMatch = normalizedType.match(/^(.+?)\s*\(\*\)\((.*)\)$/);
    if (fnPtrMatch) {
      const returnType = fnPtrMatch[1].trim();
      const params = fnPtrMatch[2].trim();
      const constPrefix = isConst ? "const " : "";
      return `${constPrefix}${returnType} (*${name})(${params})`;
    }
    const constPrefix = isConst ? "const " : "";
    return `${constPrefix}${normalizedType} ${name}`;
  }
}