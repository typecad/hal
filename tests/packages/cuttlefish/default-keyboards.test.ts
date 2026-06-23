import { describe, it, expect } from "vitest";
import { DEFAULT_ALPHA_KEYBOARD, DEFAULT_NUMBER_KEYBOARD } from "@typecad/cuttlefish/ui/default-keyboards";

describe("Default keyboard templates", () => {
  it("alpha keyboard has 4 rows", () => {
    expect(DEFAULT_ALPHA_KEYBOARD.id).toBe("__default_alpha");
    expect(DEFAULT_ALPHA_KEYBOARD.variant).toBe("alpha");
    expect(DEFAULT_ALPHA_KEYBOARD.rows).toHaveLength(4);
  });

  it("alpha keyboard rows have between 9 and 11 keys (uniform-ish grid)", () => {
    for (const row of DEFAULT_ALPHA_KEYBOARD.rows) {
      expect(row.length).toBeGreaterThanOrEqual(9);
      expect(row.length).toBeLessThanOrEqual(11);
    }
  });

  it("alpha row 0 is digits 1-0", () => {
    const chs = DEFAULT_ALPHA_KEYBOARD.rows[0].map(k => k.ch);
    expect(chs).toEqual(["1","2","3","4","5","6","7","8","9","0"]);
  });

  it("alpha keyboard has shift (special=1) and backspace (special=2)", () => {
    const all = DEFAULT_ALPHA_KEYBOARD.rows.flat();
    expect(all.some(k => k.special === 1)).toBe(true);  // shift
    expect(all.some(k => k.special === 2)).toBe(true);  // backspace
    expect(all.some(k => k.special === 3)).toBe(true);  // ok
    expect(all.some(k => k.special === 4)).toBe(true);  // 123 page-swap
  });

  it("number keyboard has 4 rows", () => {
    expect(DEFAULT_NUMBER_KEYBOARD.id).toBe("__default_number");
    expect(DEFAULT_NUMBER_KEYBOARD.variant).toBe("number");
    expect(DEFAULT_NUMBER_KEYBOARD.rows).toHaveLength(4);
  });

  it("number keyboard digits cover 0-9", () => {
    const chs = DEFAULT_NUMBER_KEYBOARD.rows.flat().filter(k => k.special === 0).map(k => k.ch);
    for (const d of ["0","1","2","3","4","5","6","7","8","9"]) {
      expect(chs).toContain(d);
    }
  });
});
