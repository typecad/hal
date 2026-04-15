// ---------------------------------------------------------------------------
// Ownership & Borrowing Safety Analysis Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { expectCppContains, expectCppNotContains, findDiagnostics, transpile } from './setup';

describe('Ownership Analysis', () => {
  describe('Opt-in behavior', () => {
    it('produces no ownership error diagnostics when ownership types are not used', () => {
      const result = transpile(`
        let x = 10;
        let y = 20;
        x = y;
      `);

      // assign-to-ref and use-after-move are only generated when ownership types are used
      const ownershipErrors = result.diagnostics.filter(
        d => d.code === 'ownership-assign-to-ref' ||
             d.code === 'ownership-use-after-move'
      );
      expect(ownershipErrors.length).toBe(0);
    });
  });

  describe('Ref<T> — immutable borrow', () => {
    it('emits const in C++ for Ref<T> function parameters', () => {
      const result = transpile(`
        type Ref<T> = T;
        function process(data: Ref<number>): void {
          console.log(data);
        }
      `);

      expectCppContains(result, ['const']);
    });

    it('reports error when assigning to a Ref<T> variable', () => {
      const result = transpile(`
        type Ref<T> = T;
        function foo(x: Ref<number>): void {
          x = 42;
        }
      `);

      const diags = findDiagnostics(result, 'ownership-assign-to-ref');
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0].message).toContain('Cannot assign to');
      expect(diags[0].line).toBeDefined();
      expect(typeof diags[0].line).toBe('number');
    });

    it('reports error when updating a Ref<T> variable', () => {
      const result = transpile(`
        type Ref<T> = T;
        function foo(x: Ref<number>): void {
          x++;
        }
      `);

      const diags = findDiagnostics(result, 'ownership-assign-to-ref');
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0].line).toBeDefined();
      expect(typeof diags[0].line).toBe('number');
    });
  });

  describe('Owned<T> — use-after-move', () => {
    it('reports error when using a variable after it has been moved', () => {
      const result = transpile(`
        type Owned<T> = T;
        function foo(): void {
          let a: Owned<number> = 10;
          let b = a;
          let c = a;
        }
      `);

      const diags = findDiagnostics(result, 'ownership-use-after-move');
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0].message).toContain('was moved');
      expect(diags[0].line).toBeDefined();
      expect(typeof diags[0].line).toBe('number');
      expect(diags[0].column).toBeDefined();
      expect(typeof diags[0].column).toBe('number');
    });

    it('does NOT report error for a single move without subsequent use', () => {
      const result = transpile(`
        type Owned<T> = T;
        function transferExample(): void {
          const buffer: Owned<number[]> = [1, 2, 3];
          let consumer = buffer;
        }
      `);

      const diags = findDiagnostics(result, 'ownership-use-after-move');
      expect(diags.length).toBe(0);
    });

    it('does NOT move source when destination is a Ref<T> borrow', () => {
      const result = transpile(`
        type Owned<T> = T;
        type Ref<T> = T;
        function borrowExample(): void {
          const buffer: Owned<number> = 42;
          const ref: Ref<typeof buffer> = buffer;
          console.log(buffer);
          console.log(ref);
        }
      `);

      const diags = findDiagnostics(result, 'ownership-use-after-move');
      expect(diags.length).toBe(0);
    });
  });

  describe('MutRef<T> — mutable borrow', () => {
    it('allows assignment to MutRef<T> variables', () => {
      const result = transpile(`
        type MutRef<T> = T;
        function foo(x: MutRef<number>): void {
          x = 42;
        }
      `);

      const assignDiags = findDiagnostics(result, 'ownership-assign-to-ref');
      expect(assignDiags.length).toBe(0);
    });
  });

  describe('Const suggestion', () => {
    it('suggests const for let variables that are never reassigned', () => {
      const result = transpile(`
        let x = 10;
        console.log(x);
      `);

      const diags = findDiagnostics(result, 'ownership-suggest-const');
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0].message).toContain('is never reassigned');
      expect(diags[0].line).toBeDefined();
      expect(typeof diags[0].line).toBe('number');
      expect(diags[0].column).toBeDefined();
      expect(typeof diags[0].column).toBe('number');
    });

    it('does not suggest const for variables that are reassigned', () => {
      const result = transpile(`
        let x = 10;
        x = 20;
        console.log(x);
      `);

      const diags = findDiagnostics(result, 'ownership-suggest-const');
      expect(diags.length).toBe(0);
    });
  });

  describe('Type stripping in C++ emission', () => {
    it('strips Ref<> wrapper from C++ type emission', () => {
      const result = transpile(`
        type Ref<T> = T;
        function process(data: Ref<number>): void {
          console.log(data);
        }
      `);

      // The type should be resolved to the inner type, not "Ref<number>"
      expectCppNotContains(result, ['Ref<', 'MutRef<', 'Owned<']);
    });
  });

  describe('C++ reference emission (Phase 1)', () => {
    it('emits const T& for non-primitive Ref<T> parameters', () => {
      const result = transpile(`
        type Ref<T> = T;
        function process(data: Ref<number[]>): void {
          console.log(data);
        }
      `);

      expectCppContains(result, ['const std::vector<int>& data']);
    });

    it('emits T& for non-primitive MutRef<T> parameters', () => {
      const result = transpile(`
        type MutRef<T> = T;
        function fill(buf: MutRef<number[]>): void {
          buf[0] = 1;
        }
      `);

      expectCppContains(result, ['std::vector<int>& buf']);
    });

    it('keeps primitive Ref<T> parameters by value (no reference)', () => {
      const result = transpile(`
        type Ref<T> = T;
        function process(data: Ref<number>): void {
          console.log(data);
        }
      `);

      expectCppContains(result, ['const int data']);
      expectCppNotContains(result, ['const int& data', 'int& data']);
    });

    it('emits const T& for non-primitive Ref<T> local variable from named variable', () => {
      const result = transpile(`
        type Owned<T> = T;
        type Ref<T> = T;
        function example(): void {
          const buffer: Owned<number[]> = [1, 2, 3];
          const view: Ref<number[]> = buffer;
        }
      `);

      expectCppContains(result, ['const std::vector<int>& view = buffer']);
    });

    it('falls back to copy (not reference) when Ref<T> initialized from non-identifier', () => {
      const result = transpile(`
        type Ref<T> = T;
        function example(): void {
          const view: Ref<number[]> = [1, 2, 3];
        }
      `);

      // Should be a copy (no & suffix on the type)
      expectCppNotContains(result, ['std::vector<int>& view']);
    });
  });

  describe('Bare Ref / MutRef without type args (Phase 2)', () => {
    it('bare Ref annotation still sets ownershipKind to ref and emits const reference', () => {
      const result = transpile(`
        type Ref<T = any> = T;
        type Owned<T = any> = T;
        function example(): void {
          const buffer: Owned<number[]> = [1, 2, 3];
          const view: Ref = buffer;
        }
      `);

      // Bare Ref should emit a const reference (concrete type deduced from initializer)
      expectCppContains(result, ['const std::vector<int>& view = buffer']);
    });
  });

  describe('New diagnostics (Phase 3)', () => {
    it('emits ownership-temp-ref-warn when Ref<T> non-primitive is initialized from a literal', () => {
      const result = transpile(`
        type Ref<T> = T;
        function example(): void {
          const view: Ref<number[]> = [1, 2, 3];
        }
      `);

      const diags = findDiagnostics(result, 'ownership-temp-ref-warn');
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0].message).toContain('borrows a temporary');
    });

    it('emits ownership-borrow-mismatch when Ref param is passed to MutRef param', () => {
      const result = transpile(`
        type Ref<T> = T;
        type MutRef<T> = T;
        function fill(buf: MutRef<number[]>): void {}
        function proxy(data: Ref<number[]>): void {
          fill(data);
        }
      `);

      const diags = findDiagnostics(result, 'ownership-borrow-mismatch');
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0].message).toContain('expects a mutable borrow');
    });

    it('emits ownership-implicit-copy info when non-primitive is copied without annotation', () => {
      const result = transpile(`
        type Owned<T> = T;
        type Ref<T> = T;
        function example(): void {
          const buffer: Ref<number[]> = [1, 2, 3];
          const copy = buffer;
        }
      `);

      const diags = findDiagnostics(result, 'ownership-implicit-copy');
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0].severity).toBe('info');
    });

    it('emits ownership-owned-copy info when Owned non-primitive is moved', () => {
      const result = transpile(`
        type Owned<T> = T;
        function example(): void {
          const buffer: Owned<number[]> = [1, 2, 3];
          const moved = buffer;
        }
      `);

      const diags = findDiagnostics(result, 'ownership-owned-copy');
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0].severity).toBe('info');
    });
  });

  describe('Lifetime safety (dangling borrow & return-local-ref)', () => {
    it('reports ownership-dangling-borrow when a borrow outlives its source via block scope', () => {
      const result = transpile(`
        type Owned<T> = T;
        type MutRef<T> = T;
        function example(): void {
          let dangling: MutRef<number[]>;
          {
            const data: Owned<number[]> = [1, 2, 3];
            dangling = data;
          }
        }
      `);

      const diags = findDiagnostics(result, 'ownership-dangling-borrow');
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0].message).toContain('goes out of scope');
      expect(diags[0].severity).toBe('error');
    });

    it('does NOT report dangling-borrow when borrow and source are in the same scope', () => {
      const result = transpile(`
        type Owned<T> = T;
        type Ref<T> = T;
        function example(): void {
          const data: Owned<number[]> = [1, 2, 3];
          const view: Ref<number[]> = data;
        }
      `);

      const diags = findDiagnostics(result, 'ownership-dangling-borrow');
      expect(diags.length).toBe(0);
    });

    it('does NOT report dangling-borrow when borrow is declared inside the inner scope (safe: both die together)', () => {
      const result = transpile(`
        type Owned<T> = T;
        type Ref<T> = T;
        function example(): void {
          const data: Owned<number[]> = [1, 2, 3];
          {
            const view: Ref<number[]> = data;
          }
        }
      `);

      const diags = findDiagnostics(result, 'ownership-dangling-borrow');
      expect(diags.length).toBe(0);
    });

    it('reports ownership-return-local-ref when returning a borrow of a local Owned variable', () => {
      const result = transpile(`
        type Owned<T> = T;
        type Ref<T> = T;
        function getSlice(): Ref<number[]> {
          const local: Owned<number[]> = [1, 2, 3];
          const view: Ref<number[]> = local;
          return view;
        }
      `);

      const diags = findDiagnostics(result, 'ownership-return-local-ref');
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0].message).toContain('will be destroyed when this function returns');
      expect(diags[0].severity).toBe('error');
    });

    it('does NOT report return-local-ref when returning a borrow of a Ref parameter (pass-through)', () => {
      const result = transpile(`
        type Ref<T> = T;
        function passThrough(buf: Ref<number[]>): Ref<number[]> {
          return buf;
        }
      `);

      const diags = findDiagnostics(result, 'ownership-return-local-ref');
      expect(diags.length).toBe(0);
    });
  });
});
