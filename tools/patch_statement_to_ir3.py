from pathlib import Path
path = Path('packages/cli/src/ir/statement-to-ir.ts')
text = path.read_text(encoding='utf-8')
marker = '        // Preserve std::vector typing when inferred; fall back to C arrays otherwise.\n'
idx = text.find(marker)
if idx == -1:
    raise ValueError('Marker not found')
# Find the first closing brace after the marker (end of inner if)
first_close = text.find('      }\n', idx)
if first_close == -1:
    raise ValueError('First close brace not found')
# Find the second closing brace after the first_close (end of outer if)
second_close = text.find('      }\n', first_close + len('      }\n'))
if second_close == -1:
    raise ValueError('Second close brace not found')
# Replace from marker start to before second_close, preserving the outer closing brace
new_text = text[:idx] + '      }\n' + text[second_close + len('      }\n'):]
path.write_text(new_text, encoding='utf-8')
print('patched3')
