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

  describe('Shared<T> — immutable borrow', () => {
    it('emits const in C++ for Shared<T> function parameters', () => {
      const result = transpile(`
        type Shared<T> = T;
        function process(data: Shared<number>): void {
          console.log(data);
        }
      `);

      expectCppContains(result, ['const']);
    });

    it('reports error when assigning to a Shared<T> variable', () => {
      const result = transpile(`
        type Shared<T> = T;
        function foo(x: Shared<number>): void {
          x = 42;
        }
      `);

      const diags = findDiagnostics(result, 'ownership-assign-to-ref');
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0].message).toContain('Cannot assign to');
      expect(diags[0].line).toBeDefined();
      expect(typeof diags[0].line).toBe('number');
    });

    it('reports error when updating a Shared<T> variable', () => {
      const result = transpile(`
        type Shared<T> = T;
        function foo(x: Shared<number>): void {
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

    it('does NOT move source when destination is a Shared<T> borrow', () => {
      const result = transpile(`
        type Owned<T> = T;
        type Shared<T> = T;
        function borrowExample(): void {
          const buffer: Owned<number> = 42;
          const ref: Shared<typeof buffer> = buffer;
          console.log(buffer);
          console.log(ref);
        }
      `);

      const diags = findDiagnostics(result, 'ownership-use-after-move');
      expect(diags.length).toBe(0);
    });
  });

  describe('Mutable<T> — mutable borrow', () => {
    it('allows assignment to Mutable<T> variables', () => {
      const result = transpile(`
        type Mutable<T> = T;
        function foo(x: Mutable<number>): void {
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
    it('strips Shared<> wrapper from C++ type emission', () => {
      const result = transpile(`
        type Shared<T> = T;
        function process(data: Shared<number>): void {
          console.log(data);
        }
      `);

      // The type should be resolved to the inner type, not "Shared<number>"
      expectCppNotContains(result, ['Shared<', 'Mutable<', 'Owned<']);
    });
  });

  describe('C++ reference emission (Phase 1)', () => {
    it('emits const T& for non-primitive Shared<T> parameters', () => {
      const result = transpile(`
        type Shared<T> = T;
        function process(data: Shared<number[]>): void {
          console.log(data);
        }
      `);

      expectCppContains(result, ['const std::vector<int>& data']);
    });

    it('emits T& for non-primitive Mutable<T> parameters', () => {
      const result = transpile(`
        type Mutable<T> = T;
        function fill(buf: Mutable<number[]>): void {
          buf[0] = 1;
        }
      `);

      expectCppContains(result, ['std::vector<int>& buf']);
    });

    it('keeps primitive Shared<T> parameters by value (no reference)', () => {
      const result = transpile(`
        type Shared<T> = T;
        function process(data: Shared<number>): void {
          console.log(data);
        }
      `);

      expectCppContains(result, ['const int data']);
      expectCppNotContains(result, ['const int& data', 'int& data']);
    });

    it('emits const T& for non-primitive Shared<T> local variable from named variable', () => {
      const result = transpile(`
        type Owned<T> = T;
        type Shared<T> = T;
        function example(): void {
          const buffer: Owned<number[]> = [1, 2, 3];
          const view: Shared<number[]> = buffer;
        }
      `);

      expectCppContains(result, ['const std::vector<int>& view = buffer']);
    });

    it('falls back to copy (not reference) when Shared<T> initialized from non-identifier', () => {
      const result = transpile(`
        type Shared<T> = T;
        function example(): void {
          const view: Shared<number[]> = [1, 2, 3];
        }
      `);

      // Should be a copy (no & suffix on the type)
      expectCppNotContains(result, ['std::vector<int>& view']);
    });
  });

  describe('Bare Shared / Mutable without type args (Phase 2)', () => {
    it('bare Shared annotation still sets ownershipKind to shared and emits const reference', () => {
      const result = transpile(`
        type Shared<T = any> = T;
        type Owned<T = any> = T;
        function example(): void {
          const buffer: Owned<number[]> = [1, 2, 3];
          const view: Shared = buffer;
        }
      `);

      // Bare Shared should emit a const reference (concrete type deduced from initializer)
      expectCppContains(result, ['const std::vector<int>& view = buffer']);
    });
  });

  describe('New diagnostics (Phase 3)', () => {
    it('emits ownership-temp-ref-warn when Shared<T> non-primitive is initialized from a literal', () => {
      const result = transpile(`
        type Shared<T> = T;
        function example(): void {
          const view: Shared<number[]> = [1, 2, 3];
        }
      `);

      const diags = findDiagnostics(result, 'ownership-temp-ref-warn');
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0].message).toContain('borrows a temporary');
    });

    it('emits ownership-borrow-mismatch when Shared param is passed to Mutable param', () => {
      const result = transpile(`
        type Shared<T> = T;
        type Mutable<T> = T;
        function fill(buf: Mutable<number[]>): void {}
        function proxy(data: Shared<number[]>): void {
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
        type Shared<T> = T;
        function example(): void {
          const buffer: Shared<number[]> = [1, 2, 3];
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
        type Mutable<T> = T;
        function example(): void {
          let dangling: Mutable<number[]>;
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
        type Shared<T> = T;
        function example(): void {
          const data: Owned<number[]> = [1, 2, 3];
          const view: Shared<number[]> = data;
        }
      `);

      const diags = findDiagnostics(result, 'ownership-dangling-borrow');
      expect(diags.length).toBe(0);
    });

    it('does NOT report dangling-borrow when borrow is declared inside the inner scope (safe: both die together)', () => {
      const result = transpile(`
        type Owned<T> = T;
        type Shared<T> = T;
        function example(): void {
          const data: Owned<number[]> = [1, 2, 3];
          {
            const view: Shared<number[]> = data;
          }
        }
      `);

      const diags = findDiagnostics(result, 'ownership-dangling-borrow');
      expect(diags.length).toBe(0);
    });

    it('reports ownership-return-local-ref when returning a borrow of a local Owned variable', () => {
      const result = transpile(`
        type Owned<T> = T;
        type Shared<T> = T;
        function getSlice(): Shared<number[]> {
          const local: Owned<number[]> = [1, 2, 3];
          const view: Shared<number[]> = local;
          return view;
        }
      `);

      const diags = findDiagnostics(result, 'ownership-return-local-ref');
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0].message).toContain('will be destroyed when this function returns');
      expect(diags[0].severity).toBe('error');
    });

    it('does NOT report return-local-ref when returning a borrow of a Shared parameter (pass-through)', () => {
      const result = transpile(`
        type Shared<T> = T;
        function passThrough(buf: Shared<number[]>): Shared<number[]> {
          return buf;
        }
      `);

      const diags = findDiagnostics(result, 'ownership-return-local-ref');
      expect(diags.length).toBe(0);
    });
  });
});
