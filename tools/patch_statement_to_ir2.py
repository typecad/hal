from pathlib import Path
path = Path('packages/cli/src/ir/statement-to-ir.ts')
text = path.read_text(encoding='utf-8')
marker = '        // Preserve std::vector typing when inferred; fall back to C arrays otherwise.\n'
idx = text.find(marker)
if idx == -1:
    raise ValueError('Marker not found')
end = text.find('      }\n', idx)
if end == -1:
    raise ValueError('End of block not found')
# Text from marker to end of the duplicate fall-through block
block = text[idx:end+6]
# Confirm block contains the duplicate vecMatch
if 'const vecMatch = varCppType.match(/^std\\.vector<(.+)>$/);' not in block:
    raise ValueError('Expected duplicate block not found')
# Replace the duplicate block with just the closing brace
new_block = '      }\n'
text = text[:idx] + new_block + text[end+6:]
path.write_text(text, encoding='utf-8')
print('patched2')
