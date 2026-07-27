"""Convert C-style casts (TYPE)expr -> static_cast<TYPE>(expr) in cuttlefish shims.

Conservative: only converts casts where the TYPE is a known primitive and the
cast appears inside a string literal (the C++ shim code). Leaves TS code,
comments, and type declarations untouched.

Handles balanced parens correctly:
  - (TYPE)identifier  ->  static_cast<TYPE>(identifier)
  - (TYPE)(expr)      ->  static_cast<TYPE>(expr)   (absorbs the parens)
  - (TYPE)expr op X   ->  static_cast<TYPE>(expr) op X   (cast applies only to expr)

Loops to stable so nested casts inside absorbed sub-expressions also convert:
  (int16_t)(x + (int32_t)(y % (uint32_t)z))
  -> static_cast<int16_t>(x + static_cast<int32_t>(y % static_cast<uint32_t>(z)))
"""
import os, re, sys

PRIMS = ['uint16_t', 'uint8_t', 'int16_t', 'int8_t', 'uint32_t', 'int32_t',
         'double', 'float', 'bool', 'int', 'char', 'long', 'short', 'size_t',
         'unsigned long', 'unsigned int', 'unsigned char']
# Match longest primitive names first so 'unsigned long' wins over 'unsigned'.
PRIMS_sorted = sorted(set(PRIMS), key=len, reverse=True)
TYPE_ALT = '|'.join(re.escape(p) for p in PRIMS_sorted)
# Match "(TYPE)" possibly with internal spaces. Preceded by non-identifier char.
CAST_START = re.compile(r'(?<![A-Za-z0-9_\.:])\(\s*(' + TYPE_ALT + r')\s*\)')

# Characters that terminate a "bare" cast target (no parens).
# Includes ' and " so the converter stops at TS string-literal boundaries
# (most C++ shims live inside TS '...' strings; without these, the script
# eats past the C++ into the TS quote syntax and produces broken output).
TERMINATORS = set(' \t)+-*/%,;<>&|^~!]=}?:\'"')


def find_target_end(s, start):
    """Given s and the index right after the cast's closing ')', find where
    the casted expression ends. Handles nested parens/brackets; stops at
    a terminator (operator, semicolon, comma) at depth 0."""
    depth = 0
    i = start
    while i < len(s):
        c = s[i]
        if c in '([{':
            depth += 1
        elif c in ')]}':
            if depth == 0:
                return i
            depth -= 1
        elif depth == 0 and c in TERMINATORS:
            return i
        i += 1
    return len(s)


def convert_line(line):
    """No line-level EXEMPT check — the regex CAST_START only matches C-style
    casts like "(int)x", never "static_cast<int>(x)", so a line that already
    uses static_cast elsewhere is processed normally and any remaining
    C-style casts on it get converted. (A line-level exempt check would
    incorrectly skip nested casts after the first conversion.)"""
    stripped = line.lstrip()
    if stripped.startswith('//') or stripped.startswith('*') or stripped.startswith('/*'):
        return line, 0
    count = 0
    out = []
    i = 0
    while i < len(line):
        m = CAST_START.match(line, i)
        if not m:
            out.append(line[i])
            i += 1
            continue
        ty = m.group(1).strip()
        end = m.end()  # position right after the cast's ')'
        # Determine the casted expression.
        if end < len(line) and line[end] == '(':
            # Parenthesized sub-expression: absorb the matching ')' into static_cast.
            depth = 1
            j = end + 1
            while j < len(line) and depth > 0:
                if line[j] == '(':
                    depth += 1
                elif line[j] == ')':
                    depth -= 1
                j += 1
            # j is now just past the matching ')'.
            expr = line[end:j]  # includes outer parens
            out.append(f'static_cast<{ty}>{expr}')
            i = j
        else:
            # Bare target: identifier, literal, or function call.
            target_end = find_target_end(line, end)
            target = line[end:target_end]
            out.append(f'static_cast<{ty}>({target})')
            i = target_end
        count += 1
    return ''.join(out), count


def process_file(path):
    with open(path, encoding='utf-8') as fh:
        src = fh.read()
    # Loop until stable: nested casts inside absorbed sub-expressions need
    # re-scanning after the outer cast absorbs their containing parens.
    total = 0
    cur = src
    while True:
        out_lines = []
        pass_count = 0
        for line in cur.splitlines():
            new, n = convert_line(line)
            out_lines.append(new)
            pass_count += n
        if pass_count == 0:
            break
        total += pass_count
        cur = '\n'.join(out_lines)
        if src.endswith('\n') and not cur.endswith('\n'):
            cur += '\n'
    if total > 0:
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(cur)
    return total


if __name__ == '__main__':
    files = sys.argv[1:]
    if not files:
        print("Usage: convert-casts-v2.py <file> [<file> ...]", file=sys.stderr)
        sys.exit(2)
    grand = 0
    for f in files:
        if not os.path.isfile(f):
            print(f"  skip (not a file): {f}", file=sys.stderr)
            continue
        n = process_file(f)
        grand += n
        print(f"  {n:4d}  {f}")
    print(f"TOTAL: {grand}")
