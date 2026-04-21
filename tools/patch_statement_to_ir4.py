from pathlib import Path
path = Path('packages/cli/src/ir/statement-to-ir.ts')
lines = path.read_text(encoding='utf-8').splitlines(True)
marker = '        // Preserve std::vector typing when inferred; fall back to C arrays otherwise.\n'
start = None
for i, line in enumerate(lines):
    if line == marker:
        start = i
        break
if start is None:
    raise ValueError('marker line not found')
# find the outer closing brace for the if block
end = None
for j in range(start+1, len(lines)):
    if lines[j] == '      }\n':
        end = j
        break
if end is None:
    raise ValueError('outer closing brace not found')
# remove duplicate block, keep outer closing '}\n'
lines = lines[:start] + lines[end:]
path.write_text(''.join(lines), encoding='utf-8')
print('patched4', start, end)
