import { describe, it, expect } from 'vitest';
import { isDependencyCycleFailure } from '../../../packages/framework-zephyr/src/toolchain';

// Zephyr 4.3.99-dev snapshots have a regression (zephyr#104757, fixed by the
// #104784 revert, in v4.4+): after CMake re-runs from a .config change, the
// build dir's .ninja_deps records an offsets.h -> offsets.c.obj -> offsets.h
// cycle and every ninja run aborts with `ninja: error: dependency cycle: ...`.
// compile() detects this signature and recovers with one pristine retry
// instead of pre-emptively nuking the build dir on every build.
describe('isDependencyCycleFailure (ninja dep-cycle detection)', () => {
  it('matches ninja dependency-cycle aborts', () => {
    const out = [
      '-- west build: building application',
      'ninja: error: dependency cycle: zephyr/offsets.h -> CMakeFiles/offsets.dir/arch/posix/core/offsets/offsets.c.obj -> zephyr/offsets.h',
    ].join('\n');
    expect(isDependencyCycleFailure(out)).toBe(true);
  });

  it('does not match ordinary compile/link failures', () => {
    expect(isDependencyCycleFailure(
      'src/main.cpp:12:5: error: \'k_msleep\' was not declared in this scope',
    )).toBe(false);
    expect(isDependencyCycleFailure('undefined reference to `setup()`')).toBe(false);
    expect(isDependencyCycleFailure('')).toBe(false);
  });
});
