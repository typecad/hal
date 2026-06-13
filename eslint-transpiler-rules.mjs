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
                if (
                  arg.type === "Identifier" &&
                  MAP_LIKE_RE.test(arg.name) &&
                  arg.name !== "Object"
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
  },
};
