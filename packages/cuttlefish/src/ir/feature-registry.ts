import ts from "typescript";

// ---------------------------------------------------------------------------
// Transpiler feature registry
//
// Registers TypeScript syntax patterns that have no C++ equivalent or are only
// approximated.  Used by feature-prescan.ts to emit build-time diagnostics.
//
// DUAL-MAINTENANCE CONTRACT:
// Simple selector-based patterns (those added via add()) should be mirrored in
// packages/cuttlefish/src/create/init-templates.ts generateEslintConfig() so
// that users get real-time editor warnings via the scaffolded ESLint config.
// Context-sensitive patterns (those in checkContextSensitive) generally cannot
// be expressed as ESLint selectors and are build-time-only diagnostics.
// ---------------------------------------------------------------------------

export type FeatureStatus = "unsupported" | "approximation" | "unsupported-context";

export interface FeatureEntry {
  status: FeatureStatus;
  message: string;
  hint?: string;
  code: string;
}

type FeatureRegistryKey = ts.SyntaxKind | ((node: ts.Node, sourceText: string) => DiagnosticMatch | null);

export interface DiagnosticMatch {
  message: string;
  hint?: string;
  code: string;
}

const KIND_REGISTRY = new Map<ts.SyntaxKind, FeatureEntry>();

function add(kind: ts.SyntaxKind, entry: FeatureEntry): void {
  KIND_REGISTRY.set(kind, entry);
}

add(ts.SyntaxKind.TaggedTemplateExpression, {
  status: "unsupported",
  message: "Tagged template expressions have no C++ equivalent.",
  hint: "Use a regular template literal (backtick string) or string concatenation instead.",
  code: "TS2CPP_NO_EQUIVALENT",
});

add(ts.SyntaxKind.MetaProperty, {
  status: "unsupported",
  message: "Meta-property expressions (import.meta, new.target) have no C++ equivalent.",
  hint: "Avoid import.meta and new.target; they rely on JS runtime reflection.",
  code: "TS2CPP_NO_EQUIVALENT",
});

add(ts.SyntaxKind.RegularExpressionLiteral, {
  status: "approximation",
  message: "Regular expression literals are approximated with std::regex in C++.",
  hint: "std::regex has different syntax and performance characteristics than JS RegExp.",
  code: "TS2CPP_APPROXIMATE",
});

add(ts.SyntaxKind.SpreadAssignment, {
  status: "unsupported",
  message: "Object spread ({...obj}) has no C++ equivalent.",
  hint: "Manually copy each property, or use a Map with an insert/merge method.",
  code: "TS2CPP_NO_EQUIVALENT",
});

add(ts.SyntaxKind.ComputedPropertyName, {
  status: "unsupported",
  message: "Computed property names ({ [expr]: value }) have no C++ equivalent.",
  hint: "Use a Map<string, T> for dynamic keys, or use fixed property names.",
  code: "TS2CPP_NO_EQUIVALENT",
});

add(ts.SyntaxKind.AnyKeyword, {
  status: "unsupported",
  message: "Explicit 'any' has no safe C++ lowering (transpiler would emit 'auto' and lose type safety).",
  hint: "Annotate with a concrete type. For truly dynamic values, use 'unknown' and narrow with type guards.",
  code: "TS2CPP_EXPLICIT_ANY",
});

export function getKindEntry(kind: ts.SyntaxKind): FeatureEntry | undefined {
  return KIND_REGISTRY.get(kind);
}

export function checkContextSensitive(node: ts.Node, sourceText: string): DiagnosticMatch | null {
  if (ts.isNewExpression(node)) {
    // Syntactic heuristic: `new Identifier()` where Identifier names an
    // interface declared in the same file. Accurate cross-file symbol
    // resolution is upgraded in the Phase 3 TypeChecker pass; this catches
    // the common single-file case without any checker infrastructure.
    const expr = node.expression;
    if (ts.isIdentifier(expr)) {
      const name = expr.text;
      const sourceFile = node.getSourceFile();
      let isInterface = false;
      const visit = (n: ts.Node): void => {
        if (ts.isInterfaceDeclaration(n) && n.name?.text === name) {
          isInterface = true;
        }
        if (!isInterface) {
          ts.forEachChild(n, visit);
        }
      };
      ts.forEachChild(sourceFile, visit);
      if (isInterface) {
        return {
          message: `Cannot instantiate interface '${name}' — only class constructors are supported in C++.`,
          hint: `Change 'interface ${name}' to 'class ${name}', or call a factory that returns a concrete class instance.`,
          code: "TS2CPP_NEW_ON_INTERFACE",
        };
      }
    }
    return null;
  }

  if (ts.isDeleteExpression(node)) {
    const target = node.expression;
    let isMapLike = false;
    if (ts.isElementAccessExpression(target)) {
      const objNode = target.expression;
      if (ts.isIdentifier(objNode)) {
        const text = objNode.text;
        if (/^[A-Z]/.test(text) || text === "this") {
          isMapLike = true;
        }
      }
    }
    if (!isMapLike) {
      return {
        message: "delete on non-map types is unsupported in C++.",
        hint: "Use a Map and its .delete() method, or set the property to null/undefined.",
        code: "TS2CPP_NO_EQUIVALENT",
      };
    }
    return null;
  }

  if (ts.isCallExpression(node)) {
    const expr = node.expression;
    if (ts.isPropertyAccessExpression(expr)) {
      const methodName = expr.name.text;
      if (
        ts.isIdentifier(expr.expression) &&
        expr.expression.text === "Object" &&
        (methodName === "keys" || methodName === "values" || methodName === "entries")
      ) {
        if (node.arguments.length > 0) {
          const arg = node.arguments[0];
          let isMapArg = false;
          if (ts.isIdentifier(arg)) {
            const argText = arg.text;
            if (/^[A-Z]/.test(argText) && argText !== "Object") {
              isMapArg = true;
            }
          }
          if (!isMapArg) {
            return {
              message: `Object.${methodName} on non-map types is unsupported.`,
              hint: "Use a Map and iterate with .keys(), .values(), or .entries() instead.",
              code: "TS2CPP_NO_EQUIVALENT",
            };
          }
        }
      }
    }
    return null;
  }

  if (ts.isPropertyAccessExpression(node)) {
    if ((node as any).questionDotToken) {
      return {
        message: "Optional chaining (?.) is approximated with a null guard in C++.",
        hint: "The C++ output may behave differently from TypeScript. Use an explicit null check for clarity.",
        code: "TS2CPP_APPROXIMATE",
      };
    }
    return null;
  }

  if (ts.isBinaryExpression(node)) {
    const opKind = node.operatorToken.kind;

    if (opKind === ts.SyntaxKind.QuestionQuestionToken) {
      return {
        message: "Nullish coalescing (??) is approximated with a polyfill helper in C++.",
        hint: "Consider using an explicit null check: (x !== null && x !== undefined) ? x : fallback.",
        code: "TS2CPP_APPROXIMATE",
      };
    }

    if (opKind === ts.SyntaxKind.InKeyword) {
      return {
        message: "The 'in' operator on non-map types is approximated in C++.",
        hint: "Use a Map and its .has() method for reliable membership testing.",
        code: "TS2CPP_APPROXIMATE",
      };
    }

    return null;
  }

  if (node.kind === ts.SyntaxKind.VoidKeyword && node.parent) {
    let current: ts.Node = node.parent;
    while (current) {
      if (
        ts.isVariableDeclaration(current) ||
        ts.isPropertyDeclaration(current) ||
        ts.isParameter(current) ||
        ts.isBindingElement(current)
      ) {
        return {
          message: "void type annotation on variable/property is erased in C++ (C++ has no void type for variables).",
          hint: "Use 'undefined' or 'null' for optional values, or omit the type annotation.",
          code: "TS2CPP_APPROXIMATE",
        };
      }
      if (
        ts.isFunctionDeclaration(current) ||
        ts.isMethodDeclaration(current) ||
        ts.isConstructorDeclaration(current) ||
        ts.isGetAccessorDeclaration(current) ||
        ts.isSetAccessorDeclaration(current) ||
        ts.isArrowFunction(current) ||
        ts.isFunctionExpression(current)
      ) {
        return null;
      }
      if (ts.isTypeReferenceNode(current)) {
        return null;
      }
      if (current.parent) {
        current = current.parent;
      } else {
        break;
      }
    }
    return null;
  }

  if (ts.isVoidExpression(node)) {
    return {
      message: "void expression is approximated as (void)(...) in C++.",
      hint: "Avoid using void expressions; they have no practical use in C++ embedded code.",
      code: "TS2CPP_APPROXIMATE",
    };
  }

  if (node.kind === ts.SyntaxKind.SuperKeyword) {
    // If parent pointers are not available (common with ts.createSourceFile),
    // skip the validation — the transpiler's own super handling (via getActiveExtendsClass)
    // correctly generates base class initializers when super() is valid.
    if (!node.parent) {
      return null;
    }
    let insideExtendingClass = false;
    let current: ts.Node | undefined = node.parent;
    while (current) {
      if (ts.isConstructorDeclaration(current) || ts.isMethodDeclaration(current)) {
        const classParent = current.parent;
        if (classParent && ts.isClassDeclaration(classParent) && classParent.heritageClauses) {
          const hasExtends = classParent.heritageClauses.some(
            (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword && clause.types.length > 0,
          );
          if (hasExtends) {
            insideExtendingClass = true;
          }
        }
        break;
      }
      if (ts.isClassDeclaration(current)) {
        break;
      }
      current = current.parent;
    }
    if (!insideExtendingClass) {
      return {
        message: "super keyword outside of class method context has no valid C++ translation.",
        hint: "Ensure super is only used inside class constructors or methods that have a base class.",
        code: "TS2CPP_NO_EQUIVALENT",
      };
    }
    return null;
  }

  if (ts.isTypeOfExpression(node)) {
    const inner = node.expression;
    if (!ts.isIdentifier(inner) && !ts.isStringLiteral(inner) && !ts.isNumericLiteral(inner) && inner.kind !== ts.SyntaxKind.TrueKeyword && inner.kind !== ts.SyntaxKind.FalseKeyword) {
      return {
        message: "typeof on non-primitive types returns an approximate type name in C++.",
        hint: "Avoid typeof on objects/arrays; use type guards or instanceof instead.",
        code: "TS2CPP_APPROXIMATE",
      };
    }
    return null;
  }

  if (ts.isTypeReferenceNode(node)) {
    const typeName = node.typeName;
    if (ts.isIdentifier(typeName)) {
      const name = typeName.text;
      const utilityTypes = new Set(["Partial", "Required", "Readonly", "Pick", "Omit", "Record", "Exclude", "Extract", "NonNullable", "ReturnType", "InstanceType", "Parameters", "ConstructorParameters"]);
      if (utilityTypes.has(name)) {
        return {
          message: `TypeScript utility type '${name}<...>' has no C++ equivalent and will be erased during transpilation.`,
          hint: `Define explicit interfaces or structs instead of using ${name}.`,
          code: "TS2CPP_NO_EQUIVALENT",
        };
      }
    }
    return null;
  }

  if (ts.isTypeOperatorNode(node)) {
    if (node.operator === ts.SyntaxKind.KeyOfKeyword) {
      return {
        message: "The 'keyof' type operator has no C++ equivalent.",
        hint: "Use an enum or string literal union to represent key sets explicitly.",
        code: "TS2CPP_NO_EQUIVALENT",
      };
    }
    return null;
  }

  if (ts.isAsExpression(node)) {
    return {
      message: "Type assertion ('as') is a type-only construct with no runtime effect in C++.",
      hint: "Remove 'as' casts or replace with explicit conversion functions.",
      code: "TS2CPP_APPROXIMATE",
    };
  }

  if (ts.isEnumDeclaration(node)) {
    const hasStringInit = node.members.some((m) => {
      if (m.initializer && ts.isStringLiteral(m.initializer)) return true;
      return false;
    });
    if (hasStringInit) {
      return {
        message: "String-valued enum members have no C++ equivalent (C++ enums are integer-only).",
        hint: "Use integer enum values, or use a Map/object for string-to-value mappings.",
        code: "TS2CPP_NO_EQUIVALENT",
      };
    }
    return null;
  }

  return null;
}
