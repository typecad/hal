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
  status?: FeatureStatus;
  message: string;
  hint?: string;
  code: string;
}

const KIND_REGISTRY = new Map<ts.SyntaxKind, FeatureEntry>();

function add(kind: ts.SyntaxKind, entry: FeatureEntry): void {
  KIND_REGISTRY.set(kind, entry);
}

const UNSUPPORTED_OBJECT_RUNTIME_METHODS = new Set([
  "assign",
  "freeze",
  "fromEntries",
  "defineProperty",
  "defineProperties",
  "create",
  "getPrototypeOf",
  "setPrototypeOf",
  "getOwnPropertyDescriptor",
]);

const UNSUPPORTED_DYNAMIC_CALL_METHODS = new Set(["bind", "call", "apply"]);
const UNSUPPORTED_RUNTIME_GLOBALS = new Set(["Proxy", "Reflect", "Symbol", "WeakRef", "FinalizationRegistry"]);

const ASSIGNMENT_OPERATOR_KINDS = new Set<number>([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  (ts.SyntaxKind as any).BarBarEqualsToken,
  (ts.SyntaxKind as any).AmpersandAmpersandEqualsToken,
  (ts.SyntaxKind as any).QuestionQuestionEqualsToken,
].filter((kind): kind is number => typeof kind === "number"));

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

add(ts.SyntaxKind.BigIntKeyword, {
  status: "unsupported",
  message: "The 'bigint' type has no supported embedded C++ lowering.",
  hint: "Use number with an explicit fixed-width type such as int32_t, uint32_t, or int64_t.",
  code: "TS2CPP_NO_EQUIVALENT",
});

add(ts.SyntaxKind.BigIntLiteral, {
  status: "unsupported",
  message: "BigInt literals have no supported embedded C++ lowering.",
  hint: "Use a number literal with an explicit fixed-width type annotation.",
  code: "TS2CPP_NO_EQUIVALENT",
});

add(ts.SyntaxKind.NeverKeyword, {
  status: "unsupported",
  message: "The 'never' type has no meaningful C++ lowering.",
  hint: "Use void for functions that do not return a value, or an explicit error/result type.",
  code: "TS2CPP_NO_EQUIVALENT",
});

add(ts.SyntaxKind.IndexedAccessType, {
  status: "unsupported",
  message: "Indexed access types (T[K]) have no deterministic C++ lowering.",
  hint: "Use the concrete field type directly.",
  code: "TS2CPP_NO_EQUIVALENT",
});

add(ts.SyntaxKind.ConditionalType, {
  status: "unsupported",
  message: "Conditional types (T extends U ? X : Y) are type-level logic with no deterministic C++ lowering.",
  hint: "Write an explicit type alias or overload with concrete types.",
  code: "TS2CPP_NO_EQUIVALENT",
});

add(ts.SyntaxKind.MappedType, {
  status: "unsupported",
  message: "Mapped types ({ [K in keyof T]: U }) have no deterministic C++ lowering.",
  hint: "Define an explicit interface or struct with the fields you need.",
  code: "TS2CPP_NO_EQUIVALENT",
});

add(ts.SyntaxKind.TemplateLiteralType, {
  status: "unsupported",
  message: "Template literal types have no C++ equivalent.",
  hint: "Use string at runtime, or define an explicit string enum/union pattern.",
  code: "TS2CPP_NO_EQUIVALENT",
});

export function getKindEntry(kind: ts.SyntaxKind): FeatureEntry | undefined {
  return KIND_REGISTRY.get(kind);
}

export function checkContextSensitive(node: ts.Node, sourceText: string): DiagnosticMatch | null {
  if (ts.isFunctionDeclaration(node) && node.body && !node.name) {
    return {
      message: "Anonymous function declarations are not supported by the C++ transpiler.",
      hint: "Give the function a name, or assign a function expression to a named const.",
      code: "TS2CPP_NO_EQUIVALENT",
    };
  }

  if (ts.isForOfStatement(node) && node.awaitModifier) {
    return {
      message: "for await...of requires async iteration runtime support and cannot be lowered to deterministic C++.",
      hint: "Use a synchronous for...of loop over a concrete array or collection.",
      code: "TS2CPP_NO_EQUIVALENT",
    };
  }

  if (ts.isCallExpression(node)) {
    if (ts.isFunctionExpression(node.expression) || ts.isArrowFunction(node.expression)) {
      return {
        message: "Immediately-invoked function expressions are not supported by the C++ transpiler.",
        hint: "Move the body into a named function, or assign the result through ordinary statements.",
        code: "TS2CPP_NO_EQUIVALENT",
      };
    }
    if (ts.isIdentifier(node.expression) && UNSUPPORTED_RUNTIME_GLOBALS.has(node.expression.text)) {
      return {
        message: `${node.expression.text} depends on JavaScript runtime reflection and has no AOT C++ lowering.`,
        hint: "Use explicit classes, functions, or ordinary values instead.",
        code: "TS2CPP_NO_EQUIVALENT",
      };
    }
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      return {
        message: "Dynamic import() has no runtime loader in generated C++.",
        hint: "Use a static top-level import.",
        code: "TS2CPP_NO_EQUIVALENT",
      };
    }
    if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
      return {
        message: "require() is unsupported in the C++ transpiler.",
        hint: "Use an ES module import at the top of the file.",
        code: "TS2CPP_NO_EQUIVALENT",
      };
    }
    if (ts.isPropertyAccessExpression(node.expression)) {
      const methodName = node.expression.name.text;
      const receiver = node.expression.expression;
      const receiverName = ts.isIdentifier(receiver) ? receiver.text : undefined;
      if (receiverName === "Promise" || methodName === "then") {
        return {
          message: "Promise APIs and .then() callbacks have no deterministic embedded C++ runtime.",
          hint: "Use synchronous return values, an explicit callback parameter, or a framework-provided async primitive.",
          code: "TS2CPP_NO_EQUIVALENT",
        };
      }
      if (receiverName === "JSON") {
        return {
          message: "JSON APIs require a JavaScript JSON runtime and are not supported by the C++ transpiler.",
          hint: "Parse or format data explicitly, or pass already-structured values.",
          code: "TS2CPP_NO_EQUIVALENT",
        };
      }
      if (receiverName === "Object" && UNSUPPORTED_OBJECT_RUNTIME_METHODS.has(methodName)) {
        return {
          message: `Object.${methodName}() mutates or introspects runtime object shape and has no deterministic C++ lowering.`,
          hint: "Construct fixed-shape structs explicitly, or use a Map for dynamic key/value data.",
          code: "TS2CPP_NO_EQUIVALENT",
        };
      }
      if (receiverName === "Reflect") {
        return {
          message: "Reflect APIs depend on JavaScript runtime reflection and have no AOT C++ lowering.",
          hint: "Use explicit property access, methods, or a Map instead.",
          code: "TS2CPP_NO_EQUIVALENT",
        };
      }
      if (UNSUPPORTED_DYNAMIC_CALL_METHODS.has(methodName)) {
        return {
          message: `.${methodName}() rebinds call-time function context and has no deterministic C++ lowering.`,
          hint: "Call the function or method directly, or pass the receiver as an explicit argument.",
          code: "TS2CPP_NO_EQUIVALENT",
        };
      }
    }
  }

  if ((ts as any).isClassStaticBlockDeclaration?.(node) || node.kind === (ts.SyntaxKind as any).ClassStaticBlockDeclaration) {
    return {
      message: "Static initializer blocks have no deterministic C++ lowering.",
      hint: "Initialize static fields in their declaration, or move setup into an explicit static method.",
      code: "TS2CPP_NO_EQUIVALENT",
    };
  }

  if (ts.isNewExpression(node)) {
    if (ts.isIdentifier(node.expression) && node.expression.text === "Function") {
      return {
        message: "new Function() compiles a string at runtime and has no AOT C++ lowering.",
        hint: "Define a named function in TypeScript instead.",
        code: "TS2CPP_NO_EQUIVALENT",
      };
    }
    if (ts.isIdentifier(node.expression) && (node.expression.text === "Promise" || UNSUPPORTED_RUNTIME_GLOBALS.has(node.expression.text))) {
      return {
        message: `new ${node.expression.text}() requires JavaScript runtime behavior that generated C++ does not provide.`,
        hint: "Use explicit classes/functions or synchronous values instead.",
        code: "TS2CPP_NO_EQUIVALENT",
      };
    }

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
    const receiver = node.expression;
    const receiverName = ts.isIdentifier(receiver) ? receiver.text : undefined;
    const isCallee = ts.isCallExpression(node.parent) && node.parent.expression === node;
    if (!isCallee) {
      if (receiverName === "Promise" || receiverName === "JSON" || receiverName === "Reflect") {
        return {
          message: `${receiverName}.${node.name.text} depends on JavaScript runtime APIs and has no deterministic C++ lowering.`,
          hint: "Use explicit fixed-shape code instead of runtime reflection or JS runtime helpers.",
          code: "TS2CPP_NO_EQUIVALENT",
        };
      }
      if (receiverName === "Object" && UNSUPPORTED_OBJECT_RUNTIME_METHODS.has(node.name.text)) {
        return {
          message: `Object.${node.name.text} depends on runtime object-shape behavior and has no deterministic C++ lowering.`,
          hint: "Construct fixed-shape structs explicitly, or use a Map for dynamic data.",
          code: "TS2CPP_NO_EQUIVALENT",
        };
      }
    }
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

    if (
      ASSIGNMENT_OPERATOR_KINDS.has(opKind) &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === "__proto__"
    ) {
      return {
        message: "__proto__ assignment mutates the JavaScript prototype chain and has no AOT C++ lowering.",
        hint: "Use a class with extends, or store dynamic data in a Map.",
        code: "TS2CPP_NO_EQUIVALENT",
      };
    }

    if (opKind === ts.SyntaxKind.InstanceOfKeyword) {
      return {
        message: "instanceof depends on runtime type metadata and is not deterministic across C++ targets.",
        hint: "Use an explicit discriminator field or enum instead.",
        code: "TS2CPP_NO_EQUIVALENT",
      };
    }

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
      if (name === "Promise") {
        return {
          message: "Promise<T> has no deterministic embedded C++ runtime representation.",
          hint: "Use a synchronous result type or an explicit callback interface instead.",
          code: "TS2CPP_NO_EQUIVALENT",
        };
      }
      if (UNSUPPORTED_RUNTIME_GLOBALS.has(name)) {
        return {
          message: `${name} has no deterministic AOT C++ representation.`,
          hint: "Use ordinary classes, structs, functions, or values instead.",
          code: "TS2CPP_NO_EQUIVALENT",
        };
      }
      const erasedUtilityTypes = new Set(["Partial", "Required", "Readonly", "Pick", "Omit"]);
      if (erasedUtilityTypes.has(name)) {
        return {
          status: "approximation",
          message: `TypeScript utility type '${name}<...>' is erased to its base type during transpilation.`,
          hint: `Define an explicit interface or struct if you need ${name}'s TypeScript semantics.`,
          code: "TS2CPP_APPROXIMATE",
        };
      }
      const autoUtilityTypes = new Set(["Exclude", "Extract", "ReturnType", "InstanceType", "Parameters", "ConstructorParameters"]);
      if (autoUtilityTypes.has(name)) {
        return {
          message: `TypeScript utility type '${name}<...>' falls back to 'auto' and is not deterministic enough for C++ emission.`,
          hint: `Define the concrete type explicitly instead of using ${name}.`,
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
    // String-valued enums ARE supported: type-decl-emitter.ts lowers them to a
    // `namespace EnumName { constexpr const char* Member = "..."; }` so member
    // access yields a `const char*` and `===` / concatenation behave like TS
    // (see isStringEnum). The historical "no C++ equivalent" warning here was
    // stale and contradicted the working lowering — removed (demo #14 F).
    return null;
  }

  return null;
}
