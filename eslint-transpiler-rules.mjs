// ---------------------------------------------------------------------------
// ESLint Custom Rules - Cuttlefish transpiler compatibility
//
// Context-sensitive checks that cannot be expressed as no-restricted-syntax
// selectors.  These rules use AST analysis to detect patterns that the
// transpiler cannot handle or only approximates.
// ---------------------------------------------------------------------------

const MAP_LIKE_RE = /^[A-Z]/;

export default {
  rules: {
    "no-delete-non-map": {
      meta: {
        type: "problem",
        docs: {
          description:
            "[transpiler] delete on non-map types is unsupported in C++.",
        },
      },
      create(context) {
        return {
          "UnaryExpression[operator='delete']"(node) {
            const arg = node.argument;
            if (arg.type === "MemberExpression" && arg.computed) {
              if (
                arg.object.type === "Identifier" &&
                (MAP_LIKE_RE.test(arg.object.name) ||
                  arg.object.name === "this")
              ) {
                return;
              }
            }
            context.report({
              node,
              message:
                "[transpiler] delete on non-map types is unsupported in C++. Use a Map and its .delete() method.",
            });
          },
        };
      },
    },

    "no-object-static-non-map": {
      meta: {
        type: "problem",
        docs: {
          description:
            "[transpiler] Object.keys/values/entries on non-map types is unsupported.",
        },
      },
      create(context) {
        const METHODS = new Set(["keys", "values", "entries"]);
        return {
          CallExpression(node) {
            const callee = node.callee;
            if (
              callee.type === "MemberExpression" &&
              !callee.computed &&
              callee.object.type === "Identifier" &&
              callee.object.name === "Object" &&
              callee.property.type === "Identifier" &&
              METHODS.has(callee.property.name)
            ) {
              if (node.arguments.length > 0) {
                const arg = node.arguments[0];
                // Exempt a bare identifier whose name looks map-like (capitalized
                // first letter) — the transpiler resolves it to std::map.
                if (
                  arg.type === "Identifier" &&
                  MAP_LIKE_RE.test(arg.name) &&
                  arg.name !== "Object"
                ) {
                  return;
                }
                // Exempt a member-access argument (this.field, obj.field). The
                // transpiler resolves the field's declared type and emits the
                // __tc_mapKeys/Values/Entries helper when it's a std::map (demo
                // #7 fix I — Object.keys(this.bus) now lowers correctly). The
                // transpiler emits TS2CPP_UNSUPPORTED_EXPR for genuine non-maps,
                // so non-map member access still fails the build with a clear msg.
                if (
                  arg.type === "MemberExpression" &&
                  !arg.computed &&
                  arg.property.type === "Identifier"
                ) {
                  return;
                }
              }
              context.report({
                node,
                message:
                  "[transpiler] Object." +
                  callee.property.name +
                  " on non-map types is unsupported. Use a Map and iterate with .keys(), .values(), or .entries().",
              });
            }
          },
        };
      },
    },

    "no-super-outside-method": {
      meta: {
        type: "problem",
        docs: {
          description:
            "[transpiler] super keyword outside class method context has no valid C++ translation.",
        },
      },
      create(context) {
        return {
          Super(node) {
            let foundValid = false;
            let current = node.parent;
            while (current) {
              if (
                current.type === "MethodDefinition" ||
                current.type === "FunctionExpression" ||
                current.type === "StaticBlock"
              ) {
                let classBody = current.parent;
                if (classBody && classBody.type === "MethodDefinition") {
                  classBody = classBody.parent;
                }
                if (classBody && classBody.type === "ClassBody") {
                  const classDecl = classBody.parent;
                  if (
                    classDecl &&
                    (classDecl.type === "ClassDeclaration" ||
                      classDecl.type === "ClassExpression") &&
                    classDecl.superClass
                  ) {
                    foundValid = true;
                  }
                }
                break;
              }
              if (
                current.type === "ClassBody" ||
                current.type === "ClassDeclaration" ||
                current.type === "ClassExpression"
              ) {
                break;
              }
              current = current.parent;
            }
            if (!foundValid) {
              context.report({
                node,
                message:
                  "[transpiler] super keyword outside of class method context has no valid C++ translation.",
              });
            }
          },
        };
      },
    },

    "no-typeof-non-primitive": {
      meta: {
        type: "problem",
        docs: {
          description:
            "[transpiler] typeof on non-primitive types returns an approximate type name in C++.",
        },
      },
      create(context) {
        return {
          "UnaryExpression[operator='typeof']"(node) {
            const arg = node.argument;
            if (
              arg.type === "MemberExpression" ||
              arg.type === "CallExpression" ||
              arg.type === "ObjectExpression"
            ) {
              context.report({
                node,
                message:
                  "[transpiler] typeof on non-primitive types returns an approximate type name in C++. Use type guards or instanceof instead.",
              });
            }
          },
        };
      },
    },

    "no-destructured-without-init": {
      meta: {
        type: "problem",
        docs: {
          description:
            "[transpiler] Destructuring declarations without initializers are unsupported.",
        },
      },
      create(context) {
        return {
          VariableDeclarator(node) {
            if (
              (node.id.type === "ObjectPattern" ||
                node.id.type === "ArrayPattern") &&
              !node.init
            ) {
              context.report({
                node,
                message:
                  "[transpiler] Destructuring declaration without an initializer is unsupported in C++. Provide a default value or initializer.",
              });
            }
          },
        };
      },
    },

    "no-fractional-to-number-type": {
      meta: {
        type: "problem",
        docs: {
          description:
            "[transpiler] Fractional literals assigned to 'number'-typed variables/fields are truncated to integers in C++. Use 'double' or 'float' instead.",
        },
      },
      create(context) {
        function isNumberType(typeNode) {
          if (!typeNode) return false;
          if (typeNode.type === "TSNumberKeyword") return true;
          if (
            typeNode.type === "TSTypeAnnotation" &&
            typeNode.typeAnnotation
          ) {
            return isNumberType(typeNode.typeAnnotation);
          }
          return false;
        }

        function isFractionalLiteral(node) {
          if (node.type === "Literal" && typeof node.value === "number") {
            return !Number.isInteger(node.value);
          }
          if (
            node.type === "UnaryExpression" &&
            node.operator === "-" &&
            node.argument
          ) {
            return isFractionalLiteral(node.argument);
          }
          return false;
        }

        function checkFractionalInitializer(node, typeAnnotation, init) {
          if (!typeAnnotation || !init) return;
          if (!isNumberType(typeAnnotation)) return;
          if (!isFractionalLiteral(init)) return;
          context.report({
            node,
            message:
              "[transpiler] Fractional value " + init.raw +
              " is truncated when assigned to 'number' type (becomes int/long long in C++). " +
              "Use 'double' or 'float' type to preserve fractional precision.",
          });
        }

        return {
          PropertyDefinition(node) {
            if (node.typeAnnotation && node.value) {
              checkFractionalInitializer(node, node.typeAnnotation, node.value);
            }
          },
          VariableDeclarator(node) {
            if (node.id.typeAnnotation && node.init) {
              checkFractionalInitializer(
                node,
                node.id.typeAnnotation,
                node.init,
              );
            }
          },
          NewExpression(node) {
            const classDecl = node.callee;
            if (classDecl.type !== "Identifier") return;
            const argNodes = node.arguments;
            if (!argNodes || argNodes.length === 0) return;

            const sourceCode = context.sourceCode || context.getSourceCode();
            const program = sourceCode.ast;

            let targetClass = null;
            for (const stmt of program.body) {
              if (
                stmt.type === "ClassDeclaration" &&
                stmt.id &&
                stmt.id.name === classDecl.name
              ) {
                targetClass = stmt;
                break;
              }
            }
            if (!targetClass) return;

            let ctorParams = [];
            for (const member of targetClass.body.body) {
              if (member.type === "MethodDefinition" && member.kind === "constructor") {
                ctorParams = member.value.params || [];
                break;
              }
            }

            for (let i = 0; i < Math.min(argNodes.length, ctorParams.length); i++) {
              const arg = argNodes[i];
              const param = ctorParams[i];
              if (!isFractionalLiteral(arg)) continue;
              if (param.type === "Identifier" && param.typeAnnotation) {
                if (isNumberType(param.typeAnnotation)) {
                  context.report({
                    node: arg,
                    message:
                      "[transpiler] Fractional value " + arg.raw +
                      " passed to 'number'-typed constructor parameter '" + param.name +
                      "' of class '" + classDecl.name +
                      "' is truncated to int/long long in C++. " +
                      "Change the parameter and field type to 'double' or 'float' to preserve fractional precision.",
                  });
                }
              }
            }
          },
        };
      },
    },

    "no-array-param-content-mutation": {
      meta: {
        type: "problem",
        docs: {
          description:
            "[transpiler] Mutating an array-typed parameter (push/pop/splice/index-assign) is silently lost in C++ — the parameter is a by-value std::vector copy.",
        },
      },
      create(context) {
        const MUTATING_METHODS = new Set([
          "push", "pop", "splice", "shift", "unshift", "sort",
          "fill", "reverse", "copyWithin",
        ]);

        // Resolve a member-expression object chain down to a bare Identifier
        // name (e.g. `arr`, or `this.arr` → "this.arr"), or null if it's not
        // a simple receiver we can match against a parameter.
        function receiverKey(node) {
          if (node.type === "Identifier") return node.name;
          if (
            node.type === "MemberExpression" &&
            !node.computed &&
            node.object.type === "ThisExpression" &&
            node.property.type === "Identifier"
          ) {
            return "this." + node.property.name;
          }
          return null;
        }

        // True if a type annotation node denotes an array type
        // (T[], Array<T>, ReadonlyArray<T>). The transpiler lowers all of
        // these to by-value std::vector<T> parameters.
        function isArrayTypeAnnotation(typeNode) {
          if (!typeNode) return false;
          // TSArrayType: T[]
          if (typeNode.type === "TSArrayType") return true;
          // TSTypeReference: Array<T> / ReadonlyArray<T>
          if (typeNode.type === "TSTypeReference" && typeNode.typeName) {
            const name =
              typeNode.typeName.type === "Identifier"
                ? typeNode.typeName.name
                : null;
            if (name === "Array" || name === "ReadonlyArray") return true;
          }
          return false;
        }

        // For function-like nodes (FunctionDeclaration / FunctionExpression /
        // ArrowFunctionExpression), collect the set of parameter names whose
        // declared type is array-typed, then walk the body for mutations on
        // those names. Nested function declarations reset the set.
        function checkFunction(node) {
          const sourceCode = context.sourceCode || context.getSourceCode();
          const arrayParams = new Set();
          for (const param of node.params || []) {
            // Only simple Identifier params with a type annotation.
            if (param.type === "Identifier" && param.typeAnnotation) {
              if (isArrayTypeAnnotation(param.typeAnnotation.typeAnnotation)) {
                arrayParams.add(param.name);
              }
            }
          }
          if (arrayParams.size === 0) return;

          // Walk the function body, but stop at nested function boundaries
          // (their params shadow ours).
          const visit = (n) => {
            if (!n || typeof n.type !== "string") return;
            // Don't recurse into nested function scopes.
            if (
              n !== node &&
              (n.type === "FunctionDeclaration" ||
                n.type === "FunctionExpression" ||
                n.type === "ArrowFunctionExpression")
            ) {
              return;
            }

            // `param.push(x)` / `param.splice(...)` / etc.
            if (
              n.type === "CallExpression" &&
              n.callee.type === "MemberExpression" &&
              !n.callee.computed &&
              n.callee.property.type === "Identifier" &&
              MUTATING_METHODS.has(n.callee.property.name)
            ) {
              const key = receiverKey(n.callee.object);
              if (key !== null && arrayParams.has(key)) {
                context.report({
                  node: n,
                  message:
                    "[transpiler] Mutating array parameter '" + key +
                    "' via ." + n.callee.property.name +
                    "() has no effect in C++ (the parameter is a by-value std::vector copy). " +
                    "Return a new array, or wrap the parameter in an object/interface field.",
                });
              }
            }

            // `param[i] = value`
            if (
              n.type === "AssignmentExpression" &&
              n.left.type === "MemberExpression" &&
              n.left.computed
            ) {
              const key = receiverKey(n.left.object);
              if (key !== null && arrayParams.has(key)) {
                context.report({
                  node: n,
                  message:
                    "[transpiler] Index assignment on array parameter '" + key +
                    "' has no effect in C++ (the parameter is a by-value std::vector copy). " +
                    "Return a new array, or wrap the parameter in an object/interface field.",
                });
              }
            }

            // `param[i] += value` / `param[i]++` and other compound updates.
            if (
              n.type === "AssignmentExpression" &&
              n.operator !== "=" &&
              n.left.type === "MemberExpression" &&
              n.left.computed
            ) {
              const key = receiverKey(n.left.object);
              if (key !== null && arrayParams.has(key)) {
                context.report({
                  node: n,
                  message:
                    "[transpiler] Compound index update on array parameter '" + key +
                    "' has no effect in C++ (the parameter is a by-value std::vector copy). " +
                    "Return a new array, or wrap the parameter in an object/interface field.",
                });
              }
            }

            for (const key of Object.keys(n)) {
              if (key === "parent") continue;
              const child = n[key];
              if (Array.isArray(child)) {
                for (const c of child) {
                  if (c && typeof c.type === "string") visit(c);
                }
              } else if (child && typeof child.type === "string") {
                visit(child);
              }
            }
          };
          visit(node.body);
        }

        return {
          FunctionDeclaration: checkFunction,
          FunctionExpression: checkFunction,
          ArrowFunctionExpression: checkFunction,
        };
      },
    },

    // -------------------------------------------------------------------------
    // A2: .forEach / .map / .filter / .reduce / .find / .some / .every on a
    // Map/Set/Record. std::map and std::set have no such methods in C++, and
    // the transpiler's forEach inlining only covers arrays (SUPPORT_MATRIX
    // §3.5). Chained functional methods also drop lambda params. We detect by
    // tracking which variables are declared with a Map/Set/Record type and
    // flagging functional-method calls on them.
    // -------------------------------------------------------------------------
    "no-container-functional-methods": {
      meta: {
        type: "problem",
        docs: {
          description:
            "[transpiler] Functional array methods (.forEach/.map/.filter/.reduce/.find/.some/.every) are not lowered on Map/Set/Record — use a for...of loop over a parallel key/value array.",
        },
      },
      create(context) {
        const FUNCTIONAL_METHODS = new Set([
          "forEach", "map", "filter", "reduce", "reduceRight",
          "find", "findIndex", "findLast", "some", "every", "flatMap",
        ]);
        // Type names whose lowered C++ form (std::map / std::set) lacks these
        // functional methods. `Record<K,V>` lowers to std::map.
        const CONTAINER_TYPE_RE = /^(Map|Set|ReadonlyMap|ReadonlySet|Record|WeakMap|WeakSet)\b/;

        // Map of variable name -> true for variables declared with a container
        // type annotation (or initialized with `new Map()`/`new Set()`).
        const containerVars = new Map();

        function typeText(node) {
          if (!node) return "";
          if (node.type === "TSTypeAnnotation" && node.typeAnnotation) {
            return typeText(node.typeAnnotation);
          }
          if (node.type === "TSTypeReference" && node.typeName) {
            return node.typeName.type === "Identifier" ? node.typeName.name : typeText(node.typeName);
          }
          if (node.type === "TSMapLikeType") {
            return "Map";
          }
          return "";
        }

        function markContainerFromInit(name, init) {
          if (!init) return;
          // `new Map(...)` / `new Set(...)`
          if (
            init.type === "NewExpression" &&
            init.callee.type === "Identifier" &&
            CONTAINER_TYPE_RE.test(init.callee.name)
          ) {
            containerVars.set(name, true);
          }
        }

        function isContainerVar(node) {
          if (node.type === "Identifier" && containerVars.has(node.name)) {
            return true;
          }
          // Chained call on the result of another functional method, or on a
          // `.get()`/`.entries()` etc. — these are also not lowered. Catch any
          // functional method whose receiver is itself a functional-method call.
          if (
            node.type === "CallExpression" &&
            node.callee.type === "MemberExpression" &&
            FUNCTIONAL_METHODS.has(node.callee.property.name)
          ) {
            return true;
          }
          return false;
        }

        return {
          VariableDeclarator(node) {
            if (node.id.type !== "Identifier") return;
            const name = node.id.name;
            // Type annotation path: `const x: Map<...> = ...`
            if (node.id.typeAnnotation) {
              const t = typeText(node.id.typeAnnotation);
              if (CONTAINER_TYPE_RE.test(t)) {
                containerVars.set(name, true);
                return;
              }
            }
            // Initializer path: `const x = new Map()`
            markContainerFromInit(name, node.init);
          },
          CallExpression(node) {
            const callee = node.callee;
            if (
              callee.type !== "MemberExpression" ||
              callee.computed ||
              callee.property.type !== "Identifier" ||
              !FUNCTIONAL_METHODS.has(callee.property.name)
            ) {
              return;
            }
            if (isContainerVar(callee.object)) {
              context.report({
                node,
                message:
                  "[transpiler] ." + callee.property.name +
                  "() is not lowered on Map/Set/Record (the C++ std::map/std::set has no such method, and lambda params are dropped). " +
                  "Iterate a parallel key array with for...of instead.",
              });
            }
          },
        };
      },
    },

    // -------------------------------------------------------------------------
    // A6: `=== undefined` / `!== undefined` (and == / != null) on the result
    // of a container .get() call. The transpiler flattens T | undefined to T
    // (SUPPORT_MATRIX §1.8) and lowers `undefined` to the CUTTLEFISH_UNDEFINED
    // macro (= 0). Comparing a struct-typed .get() result to 0 fails to
    // compile ("no match for operator=="). Use .has(key) before .get(key).
    // -------------------------------------------------------------------------
    "no-undefined-compare-on-get": {
      meta: {
        type: "problem",
        docs: {
          description:
            "[transpiler] Comparing a .get() result to undefined/null does not lower to valid C++ (struct-vs-int). Guard with .has() instead.",
        },
      },
      create(context) {
        const UNDEF_NULL_OPS = new Set([
          "==", "!=", "===", "!==",
        ]);

        function isUndefinedOrNull(node) {
          if (node.type === "Identifier" && (node.name === "undefined" || node.name === "null")) {
            return true;
          }
          if (node.type === "Literal" && node.value === null) {
            return true;
          }
          return false;
        }

        function isGetCall(node) {
          return (
            node.type === "CallExpression" &&
            node.callee.type === "MemberExpression" &&
            !node.callee.computed &&
            node.callee.property.type === "Identifier" &&
            (node.callee.property.name === "get" || node.callee.property.name === "at")
          );
        }

        return {
          BinaryExpression(node) {
            if (!UNDEF_NULL_OPS.has(node.operator)) return;
            const leftUndef = isUndefinedOrNull(node.left);
            const rightUndef = isUndefinedOrNull(node.right);
            if (!leftUndef && !rightUndef) return;
            const otherSide = leftUndef ? node.right : node.left;
            if (isGetCall(otherSide)) {
              context.report({
                node,
                message:
                  "[transpiler] Comparing ." + otherSide.callee.property.name +
                  "() to undefined/null does not lower to valid C++ (the optional is flattened to T and compared to 0). " +
                  "Guard with .has(key) before calling .get(key).",
              });
            }
          },
        };
      },
    },

    // -------------------------------------------------------------------------
    // A7: `=== undefined` / `!== undefined` (and == / != null) on a struct or
    // interface member access (`obj.prop`). An optional interface field
    // (`prop?: T`) flattens to a plain `T` in the emitted C++ struct (SUPPORT
    // MATRIX §1.8), so the "is it set?" check is semantically meaningless —
    // `undefined` lowers to the CUTTLEFISH_UNDEFINED macro (= 0), and the
    // comparison either compares a struct to 0 (compile error) or, for scalar
    // fields, silently compares against 0 (wrong semantics). This is the
    // struct-field analogue of A6 (no-undefined-compare-on-get). Workaround:
    // use an explicit boolean flag on the interface instead of an optional
    // field. NOTE: the .get()/.at() container case is covered by A6; this
    // rule catches plain property access (`obj.prop`).
    // -------------------------------------------------------------------------
    "no-undefined-compare-on-struct-field": {
      meta: {
        type: "problem",
        docs: {
          description:
            "[transpiler] Comparing a struct/interface field to undefined/null does not lower to valid C++ (optional fields flatten to T). Use an explicit boolean flag.",
        },
      },
      create(context) {
        const UNDEF_NULL_OPS = new Set([
          "==", "!=", "===", "!==",
        ]);

        function isUndefinedOrNull(node) {
          if (node.type === "Identifier" && (node.name === "undefined" || node.name === "null")) {
            return true;
          }
          if (node.type === "Literal" && node.value === null) {
            return true;
          }
          return false;
        }

        function isMemberAccess(node) {
          // A property access that is NOT itself a call (the .get()/.at() call
          // case is handled by no-undefined-compare-on-get). Element access
          // (obj[key]) is Map-like and also excluded.
          return node.type === "MemberExpression" && !node.computed;
        }

        return {
          BinaryExpression(node) {
            if (!UNDEF_NULL_OPS.has(node.operator)) return;
            const leftUndef = isUndefinedOrNull(node.left);
            const rightUndef = isUndefinedOrNull(node.right);
            if (!leftUndef && !rightUndef) return;
            const otherSide = leftUndef ? node.right : node.left;
            if (isMemberAccess(otherSide)) {
              const propName =
                otherSide.property.type === "Identifier"
                  ? otherSide.property.name
                  : "<computed>";
              context.report({
                node,
                message:
                  "[transpiler] Comparing ." + propName +
                  " to undefined/null does not lower to valid C++ (optional struct/interface fields flatten to their value type). " +
                  "Use an explicit boolean flag on the interface instead of an optional field.",
              });
            }
          },
        };
      },
    },

    // -------------------------------------------------------------------------
    // .length on a typed-array (Uint8Array/Int16Array/Float32Array/...)
    // PARAMETER. Such parameters lower to raw C pointers (uint8_t*), which
    // decay and lose their element count. The .length lowering
    // (sizeof(arr)/sizeof(arr[0])) is only valid on stack arrays, not on
    // pointer parameters — it emits `param.size()` or a garbage sizeof ratio.
    // Pass the length as an explicit number parameter instead.
    // (SUPPORTED: .length on a locally-declared typed array still works.)
    // -------------------------------------------------------------------------
    "no-typed-array-param-length": {
      meta: {
        type: "problem",
        docs: {
          description:
            "[transpiler] .length on a typed-array parameter does not lower to valid C++ (the parameter decays to a raw pointer). Pass the length explicitly.",
        },
      },
      create(context) {
        const TYPED_ARRAYS = new Set([
          "Uint8Array", "Int8Array", "Uint16Array", "Int16Array",
          "Uint32Array", "Int32Array", "Float32Array", "Float64Array",
          "BigUint64Array", "BigInt64Array",
        ]);

        // Collect names of function/method parameters whose type annotation
        // is a typed array.
        const typedArrayParams = new Set();

        function isTypedArrayTypeAnnotation(typeAnnotation) {
          if (!typeAnnotation) return false;
          let t = typeAnnotation;
          if (t.type === "TSTypeAnnotation") t = t.typeAnnotation;
          if (t && t.type === "TSTypeReference" && t.typeName.type === "Identifier") {
            return TYPED_ARRAYS.has(t.typeName.name);
          }
          return false;
        }

        function registerParams(params) {
          for (const p of params) {
            if (p.type === "Identifier" && isTypedArrayTypeAnnotation(p.typeAnnotation)) {
              typedArrayParams.add(p.name);
            }
          }
        }

        return {
          FunctionDeclaration: (node) => registerParams(node.params),
          FunctionExpression: (node) => registerParams(node.params),
          ArrowFunctionExpression: (node) => registerParams(node.params),
          MemberExpression(node) {
            // `param.length` where param is a typed-array parameter.
            if (
              !node.computed &&
              node.object.type === "Identifier" &&
              typedArrayParams.has(node.object.name) &&
              node.property.type === "Identifier" &&
              node.property.name === "length"
            ) {
              context.report({
                node,
                message:
                  "[transpiler] ." + node.object.name +
                  ".length on a typed-array parameter does not lower to valid C++ " +
                  "(the parameter decays to a raw pointer and loses its count). " +
                  "Pass the length as an explicit number parameter.",
              });
            }
          },
        };
      },
    },

    // -------------------------------------------------------------------------
    // A function/method that RETURNS a typed array (Uint8Array/Int16Array/...).
    // Such a return lowers to a pointer to a stack-local C array, which dangles
    // the moment the function returns — the caller dereferences freed stack
    // memory (undefined behavior, often a crash). TS typed arrays are heap
    // objects with value semantics; the C-style lowering can't model that.
    // Write into a caller-provided output array (out-param) instead.
    // -------------------------------------------------------------------------
    "no-typed-array-return": {
      meta: {
        type: "problem",
        docs: {
          description:
            "[transpiler] Returning a typed array dangles (it lowers to a pointer to a stack-local C array). Use an out-parameter instead.",
        },
      },
      create(context) {
        const TYPED_ARRAYS = new Set([
          "Uint8Array", "Int8Array", "Uint16Array", "Int16Array",
          "Uint32Array", "Int32Array", "Float32Array", "Float64Array",
          "BigUint64Array", "BigInt64Array",
        ]);

        function isTypedArrayAnnotation(typeAnnotation) {
          if (!typeAnnotation) return false;
          let t = typeAnnotation;
          if (t.type === "TSTypeAnnotation") t = t.typeAnnotation;
          if (t && t.type === "TSTypeReference" && t.typeName.type === "Identifier") {
            return TYPED_ARRAYS.has(t.typeName.name);
          }
          return false;
        }

        function checkReturnType(node) {
          // Declared return type annotation on a function/method.
          if (node.returnType && isTypedArrayAnnotation(node.returnType)) {
            context.report({
              node: node.returnType,
              message:
                "[transpiler] Returning a typed array dangles in C++ (the array is a stack-local that is destroyed when the function returns; the caller gets a wild pointer). " +
                "Write into a caller-provided output-array parameter instead.",
            });
          }
        }

        return {
          FunctionDeclaration: checkReturnType,
          FunctionExpression: checkReturnType,
          ArrowFunctionExpression: checkReturnType,
        };
      },
    },

    // -------------------------------------------------------------------------
    // Dynamic string-key property access: obj["key"] on a non-map variable.
    // The transpiler supports numeric indexing (arr[0], grid[y][x]) and
    // map/struct associative access (map["key"] per SUPPORT_MATRIX §1.5), but
    // dynamic string-key access on a plain struct/interface has no reliable
    // lowering. We allow:
    //   - numeric index access (arr[0], bytes[i]) — the property is a Literal
    //     with a number value;
    //   - access on identifiers whose name looks map-like (capitalized, or
    //     `this`) — mirrors the no-delete-non-map heuristic;
    //   - access on a known typed-array/Uint8Array variable.
    // Everything else computed (`obj[someStringVar]`, `obj["dynamic"]) is
    // rejected. This is the scoped replacement for the blanket
    // `MemberExpression[computed=true]` selector, which would wrongly reject
    // `arr[0]`.
    // -------------------------------------------------------------------------
    "no-dynamic-property-access": {
      meta: {
        type: "problem",
        docs: {
          description:
            "[transpiler] Dynamic string-key property access (obj[key]) on non-map types is not reliably lowered. Use a Map or a numeric index.",
        },
      },
      create(context) {
        function isNumericLiteral(node) {
          return (
            node.type === "Literal" &&
            (typeof node.value === "number" || /^-?\d+$/.test(String(node.value)))
          );
        }
        function isStringLiteral(node) {
          return node.type === "Literal" && typeof node.value === "string";
        }
        return {
          "MemberExpression[computed=true]"(node) {
            // Numeric index access (arr[0]) is always allowed.
            if (isNumericLiteral(node.property)) return;
            // Variable / expression index (arr[i], grid[y], map[getKey()]) is
            // allowed: numeric loop-counter indexing is the overwhelmingly
            // common case, and map/struct associative access is supported
            // (SUPPORT_MATRIX §1.5). The linter has no type info to distinguish
            // a numeric variable from a string variable, so we don't reject
            // Identifier/computed indexes — only literal string keys below.
            if (!isStringLiteral(node.property)) return;
            // A literal string key on a map-like / this receiver is fine
            // (map["key"], this["field"]).
            if (
              node.object.type === "Identifier" &&
              (MAP_LIKE_RE.test(node.object.name) || node.object.name === "this")
            ) {
              return;
            }
            // A literal string key on a non-map (struct["field"]) is the risky
            // case — it has no reliable lowering for a plain struct/interface.
            context.report({
              node,
              message:
                "[transpiler] dynamic string-key access (obj[\"key\"]) on non-map types is not reliably lowered. Use a Map<string, T> for dynamic keys, or a numeric index for arrays.",
            });
          },
        };
      },
    },

    // -------------------------------------------------------------------------
    // `this` in a free function (not a class method/constructor). In JS, a
    // free function's `this` is determined by the call site (undefined in
    // strict mode, the global object otherwise) — there is no fixed C++
    // `this` pointer to lower to. SUPPORT_MATRIX §4.2 marks `this` in free
    // function as ❌. Arrow functions inherit `this` lexically, so a `this`
    // inside an arrow nested in a free function is still invalid (it resolves
    // to the free function's call-site `this`). A `this` inside a class
    // method, constructor, or an arrow nested in one is valid (mirrors
    // no-super-outside-method's scope walk).
    // -------------------------------------------------------------------------
    "no-this-in-free-function": {
      meta: {
        type: "problem",
        docs: {
          description:
            "[transpiler] `this` in a free function has no fixed C++ this pointer to lower to.",
        },
      },
      create(context) {
        return {
          ThisExpression(node) {
            // Walk up the AST. We're looking for the nearest enclosing
            // function that *binds* `this` (a free function / FunctionDeclaration),
            // OR a valid class context (method/constructor) that makes `this` OK.
            let current = node.parent;
            while (current) {
              // Class method / constructor / static block — valid `this`.
              if (current.type === "MethodDefinition") return;
              if (current.type === "PropertyDefinition") return;
              if (current.type === "StaticBlock") return;
              if (
                current.type === "FunctionExpression" &&
                current.parent &&
                (current.parent.type === "MethodDefinition" ||
                  current.parent.type === "PropertyDefinition")
              ) {
                return;
              }
              // ArrowFunctionExpression does NOT bind its own `this` — keep
              // walking to find the enclosing real function.
              if (current.type === "ArrowFunctionExpression") {
                current = current.parent;
                continue;
              }
              // Any other function (FunctionDeclaration, or a FunctionExpression
              // NOT used as a method) binds `this` to its call site → invalid.
              if (
                current.type === "FunctionDeclaration" ||
                current.type === "FunctionExpression"
              ) {
                context.report({
                  node,
                  message:
                    "[transpiler] `this` in a free function has no fixed C++ this pointer to lower to. Move the code into a class method, or pass the needed value as a parameter.",
                });
                return;
              }
              current = current.parent;
            }
          },
        };
      },
    },
  },
};
