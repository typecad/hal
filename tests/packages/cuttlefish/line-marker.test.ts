// Unit tests for the line-marker helper, which formats GCC linemarkers and
// decides when to emit them (transition-only, to keep emitted C++ clean).

import { describe, it, expect } from 'vitest';
import { formatLinemarker, shouldEmitMarker, sourceKey } from '../../../packages/cuttlefish/src/emit/emitters/line-marker';
import type { SourceSpan } from '../../../packages/cuttlefish/src/types';

describe('formatLinemarker', () => {
  it('emits GCC linemarker form: hash, space, 1-based line, quoted path', () => {
    expect(formatLinemarker('C:/proj/src/main.ts', 41)).toBe('# 42 "C:/proj/src/main.ts"');
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(formatLinemarker('C:\\proj\\src\\main.ts', 0)).toBe('# 1 "C:/proj/src/main.ts"');
  });

  it('produces an absolute path when given a relative one', () => {
    // Resolve relative to cwd; assert it is absolute and forward-slashed.
    const out = formatLinemarker('src/main.ts', 9);
    expect(out).toMatch(/^# 10 "[A-Za-z]:\/.*\/src\/main\.ts"$/);
    expect(out).not.toContain('\\');
  });
});

describe('shouldEmitMarker', () => {
  it('emits when previous source is null (first marker)', () => {
    expect(shouldEmitMarker(null, { filePath: 'a.ts', line: 5 })).toBe(true);
  });

  it('emits when file changes', () => {
    expect(shouldEmitMarker({ filePath: 'a.ts', line: 5 }, { filePath: 'b.ts', line: 5 })).toBe(true);
  });

  it('emits when line changes', () => {
    expect(shouldEmitMarker({ filePath: 'a.ts', line: 5 }, { filePath: 'a.ts', line: 6 })).toBe(true);
  });

  it('does NOT emit when file and line are unchanged (transition-only)', () => {
    expect(shouldEmitMarker({ filePath: 'a.ts', line: 5 }, { filePath: 'a.ts', line: 5 })).toBe(false);
  });
});

describe('sourceKey', () => {
  it('extracts {filePath, 0-based startLine} from a SourceSpan', () => {
    const span: SourceSpan = {
      filePath: 'main.ts', startOffset: 0, endOffset: 10,
      startLine: 7, startColumn: 0, endLine: 7, endColumn: 10,
    };
    expect(sourceKey(span)).toEqual({ filePath: 'main.ts', line: 7 });
  });
});
