from pathlib import Path
path = Path('packages/cli/src/ir/statement-to-ir.ts')
text = path.read_text(encoding='utf-8')
old = '''      if (ts.isArrayLiteralExpression(actualInitializer) && !mutableArrayVars.has(varName)) {
        const vecMatch = varCppType.match(/^std\.vector<(.+)>$/);
        if (!vecMatch) {
          activeArrayLiteralVars.add(varName);
          activeCArrayVars.add(varName);
        }
        // Preserve std::vector typing when inferred; fall back to C arrays otherwise.
        // Extract element type from std::vector<T> or use "auto"
        const vecMatch = varCppType.match(/^std\.vector<(.+)>$/);
        if (!vecMatch) {
          activeCArrayVars.add(varName);
          loweredDeclaration.cppType = "auto" as any;
          localVariableTypes.set(varName, "auto");
          activeLocalTypes.set(varName, "auto");
        }
      }
'''
new = '''      if (ts.isArrayLiteralExpression(actualInitializer) && !mutableArrayVars.has(varName)) {
        const vecMatch = varCppType.match(/^std\.vector<(.+)>$/);
        if (!vecMatch) {
          activeArrayLiteralVars.add(varName);
          activeCArrayVars.add(varName);
          loweredDeclaration.cppType = "auto" as any;
          localVariableTypes.set(varName, "auto");
          activeLocalTypes.set(varName, "auto");
        }
      }
'''
if old not in text:
    raise ValueError('Old block not found')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
print('patched')
