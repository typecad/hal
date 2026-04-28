// ---------------------------------------------------------------------------
// Unit tests for @typehal/expect — Assertion evaluator
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { evaluate, describeExpected } from '../../../packages/expect/src/host/evaluator';

describe('evaluator', () => {
  describe('toBe', () => {
    it('passes when values are equal (numeric)', () => {
      expect(evaluate('toBe', '42', '42')).toBe(true);
    });

    it('fails when values differ', () => {
      expect(evaluate('toBe', '0', '11')).toBe(false);
    });

    it('handles floating point', () => {
      expect(evaluate('toBe', '3.14', '3.14')).toBe(true);
      expect(evaluate('toBe', '3.14', '3.15')).toBe(false);
    });

    it('handles string comparison fallback', () => {
      expect(evaluate('toBe', 'hello', 'hello')).toBe(true);
      expect(evaluate('toBe', 'hello', 'world')).toBe(false);
    });

    it('handles hex literals in expected value', () => {
      // Regression: parseFloat("0x10") returns 0; Number("0x10") returns 16
      expect(evaluate('toBe', '0x10', '16')).toBe(true);
      expect(evaluate('toBe', '0xAA', '170')).toBe(true);
      expect(evaluate('toBe', '0xFF', '255')).toBe(true);
      expect(evaluate('toBe', '0x00', '0')).toBe(true);
    });
  });

  describe('toNotBe', () => {
    it('passes when values differ', () => {
      expect(evaluate('toNotBe', '0', '42')).toBe(true);
    });

    it('fails when values are equal', () => {
      expect(evaluate('toNotBe', '42', '42')).toBe(false);
    });
  });

  describe('toBeGreaterThan', () => {
    it('passes when actual > expected', () => {
      expect(evaluate('toBeGreaterThan', '10', '50')).toBe(true);
    });

    it('fails when actual <= expected', () => {
      expect(evaluate('toBeGreaterThan', '50', '50')).toBe(false);
      expect(evaluate('toBeGreaterThan', '50', '10')).toBe(false);
    });
  });

  describe('toBeGreaterThanOrEqual', () => {
    it('passes when actual >= expected', () => {
      expect(evaluate('toBeGreaterThanOrEqual', '50', '50')).toBe(true);
      expect(evaluate('toBeGreaterThanOrEqual', '10', '50')).toBe(true);
    });

    it('fails when actual < expected', () => {
      expect(evaluate('toBeGreaterThanOrEqual', '50', '10')).toBe(false);
    });
  });

  describe('toBeLessThan', () => {
    it('passes when actual < expected', () => {
      expect(evaluate('toBeLessThan', '100', '50')).toBe(true);
    });

    it('fails when actual >= expected', () => {
      expect(evaluate('toBeLessThan', '50', '50')).toBe(false);
      expect(evaluate('toBeLessThan', '10', '50')).toBe(false);
    });
  });

  describe('toBeLessThanOrEqual', () => {
    it('passes when actual <= expected', () => {
      expect(evaluate('toBeLessThanOrEqual', '50', '50')).toBe(true);
      expect(evaluate('toBeLessThanOrEqual', '100', '50')).toBe(true);
    });

    it('fails when actual > expected', () => {
      expect(evaluate('toBeLessThanOrEqual', '10', '50')).toBe(false);
    });
  });

  describe('toBeCloseTo', () => {
    it('passes within precision tolerance', () => {
      expect(evaluate('toBeCloseTo', '3.14,2', '3.14')).toBe(true);
      expect(evaluate('toBeCloseTo', '3.14,2', '3.141')).toBe(true);
    });

    it('fails outside precision tolerance', () => {
      expect(evaluate('toBeCloseTo', '3.14,2', '3.2')).toBe(false);
    });

    it('uses precision from expected string', () => {
      // precision=1 → tolerance = 0.1
      expect(evaluate('toBeCloseTo', '3.0,1', '3.05')).toBe(true);
      expect(evaluate('toBeCloseTo', '3.0,1', '3.15')).toBe(false);
    });
  });

  describe('toBeWithinRange', () => {
    it('passes when within range', () => {
      expect(evaluate('toBeWithinRange', '20,30', '25')).toBe(true);
      expect(evaluate('toBeWithinRange', '20,30', '20')).toBe(true);
      expect(evaluate('toBeWithinRange', '20,30', '30')).toBe(true);
    });

    it('fails when outside range', () => {
      expect(evaluate('toBeWithinRange', '20,30', '19')).toBe(false);
      expect(evaluate('toBeWithinRange', '20,30', '31')).toBe(false);
    });
  });

  describe('toBeTruthy', () => {
    it('passes for non-zero', () => {
      expect(evaluate('toBeTruthy', '', '1')).toBe(true);
      expect(evaluate('toBeTruthy', '', '42')).toBe(true);
      expect(evaluate('toBeTruthy', '', '-1')).toBe(true);
    });

    it('fails for zero', () => {
      expect(evaluate('toBeTruthy', '', '0')).toBe(false);
    });
  });

  describe('toBeFalsy', () => {
    it('passes for zero', () => {
      expect(evaluate('toBeFalsy', '', '0')).toBe(true);
    });

    it('fails for non-zero', () => {
      expect(evaluate('toBeFalsy', '', '1')).toBe(false);
    });
  });

  describe('toContain', () => {
    it('passes when actual contains expected', () => {
      expect(evaluate('toContain', 'world', 'hello world')).toBe(true);
    });

    it('fails when actual does not contain expected', () => {
      expect(evaluate('toContain', 'xyz', 'hello world')).toBe(false);
    });
  });

  describe('toHaveLength', () => {
    it('passes when length matches', () => {
      expect(evaluate('toHaveLength', '5', 'hello')).toBe(true);
    });

    it('fails when length differs', () => {
      expect(evaluate('toHaveLength', '3', 'hello')).toBe(false);
    });
  });
});

describe('describeExpected', () => {
  it('formats toBe', () => {
    expect(describeExpected('toBe', '42')).toBe('to be 42');
  });

  it('formats toBeWithinRange', () => {
    expect(describeExpected('toBeWithinRange', '20,30')).toBe('to be within 20–30');
  });

  it('formats toBeTruthy', () => {
    expect(describeExpected('toBeTruthy', '')).toBe('to be truthy (≠ 0)');
  });

  it('formats toBeLessThan', () => {
    expect(describeExpected('toBeLessThan', '100')).toBe('to be < 100');
  });

  it('formats toContain', () => {
    expect(describeExpected('toContain', 'hello')).toBe('to contain "hello"');
  });
});
