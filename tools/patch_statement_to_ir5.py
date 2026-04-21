from pathlib import Path
path = Path('packages/cli/src/ir/statement-to-ir.ts')
lines = path.read_text(encoding='utf-8').splitlines(True)
marker = '        // Preserve std::vector typing when inferred; fall back to C arrays otherwise.'
start = None
for i, line in enumerate(lines):
    if line.rstrip('\r\n') == marker:
        start = i
        break
if start is None:
    raise ValueError('marker line not found')
# find the line index of the outer closing brace after the marker
first_close = None
for j in range(start+1, len(lines)):
    if lines[j].strip() == '}':
        if first_close is None:
            first_close = j
        else:
            end = j
            break
if first_close is None or end is None:
    raise ValueError('closing braces not found')
# Replace from marker line through the outer closing brace with a single closing brace
lines = lines[:start] + [lines[end]] + lines[end+1:]
path.write_text(''.join(lines), encoding='utf-8')
print('patched5', start, end)
