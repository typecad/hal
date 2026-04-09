import { describe, it, expect } from "vitest";
import { buildProgramIR } from "../packages/cli/src/ir/build-ir";
import { emitCpp } from "../packages/cli/src/emit/cpp-emitter";
import { resolveStrategy } from "../packages/cli/src/platform/registry";

const TARGET = { name: "generic", cpu: "unknown", flash: 0, ram: 0 };
const STRATEGY = resolveStrategy("generic");

function transpile(source: string): string {
  const ir = buildProgramIR("test.ts", source);
  const result = emitCpp(ir, {
    outDir: "/tmp/test-out",
    emitMode: "single",
    target: TARGET,
    libdefs: new Map(),
    emitMaps: false,
    strategy: STRATEGY,
    isEntryFile: true,
  });
  const sourceFile = result.sourcePath;
  const fs = require("fs");
  return fs.readFileSync(sourceFile, "utf-8");
}

function buildIR(source: string) {
  return buildProgramIR("test.ts", source);
}

describe("Register-mapped Structs", () => {
  describe("@register decorator detection", () => {
    it("detects @register class and creates RegisterClassIR", () => {
      const source = `
@register(0x40011000)
class USART1 {
  @bits(0, 0)   declare UE: Bit;
  @bits(2, 2)   declare RE: Bit;
  @bits(9, 8)   declare PS: Bits<2>;
}
`;
      const ir = buildIR(source);
      expect(ir.registerClasses).toHaveLength(1);
      expect(ir.registerClasses[0].name).toBe("USART1");
      expect(ir.registerClasses[0].address).toBe(0x40011000);
      expect(ir.registerClasses[0].bitFields).toHaveLength(3);
    });

    it("extracts bit field ranges correctly", () => {
      const source = `
@register(0x40011000)
class USART1 {
  @bits(0, 0)   declare UE: Bit;
  @bits(9, 8)   declare PS: Bits<2>;
  @bits(15, 8)  declare BAUD: Bits<8>;
}
`;
      const ir = buildIR(source);
      const reg = ir.registerClasses[0];

      // UE: bits(0,0) → hi=0, lo=0, width=1
      expect(reg.bitFields[0]).toEqual({ name: "UE", hi: 0, lo: 0, width: 1 });

      // PS: bits(9,8) → hi=9, lo=8, width=2
      expect(reg.bitFields[1]).toEqual({ name: "PS", hi: 9, lo: 8, width: 2 });

      // BAUD: bits(15,8) → hi=15, lo=8, width=8
      expect(reg.bitFields[2]).toEqual({ name: "BAUD", hi: 15, lo: 8, width: 8 });
    });

    it("does not create a normal ClassIR for @register classes", () => {
      const source = `
@register(0x40011000)
class USART1 {
  @bits(0, 0)   declare UE: Bit;
}
`;
      const ir = buildIR(source);
      expect(ir.classes).toHaveLength(0);
      expect(ir.registerClasses).toHaveLength(1);
    });
  });

  describe("C++ emission", () => {
    it("emits volatile pointer declaration for register", () => {
      const source = `
@register(0x40011000)
class USART1 {
  @bits(0, 0)   declare UE: Bit;
}
`;
      const cpp = transpile(source);
      expect(cpp).toContain("volatile uint32_t* const USART1 = reinterpret_cast<volatile uint32_t*>(0x40011000);");
    });

    it("emits correct hex address", () => {
      const source = `
@register(0x4001_1000)
class USART1 {
  @bits(0, 0)   declare UE: Bit;
}
`;
      const cpp = transpile(source);
      expect(cpp).toContain("0x40011000");
    });
  });

  describe("Register field read", () => {
    it("reads a single-bit field with & 1UL", () => {
      const source = `
@register(0x40011000)
class USART1 {
  @bits(0, 0)   declare UE: Bit;
}

const parity = USART1.UE;
`;
      const cpp = transpile(source);
      // Single bit at lo=0: (*USART1 >> 0) & 1UL
      expect(cpp).toContain("(*USART1 >> 0) & 1UL");
    });

    it("reads a multi-bit field with correct mask", () => {
      const source = `
@register(0x40011000)
class USART1 {
  @bits(9, 8)   declare PS: Bits<2>;
}

const parity = USART1.PS;
`;
      const cpp = transpile(source);
      // 2-bit field at lo=8: (*USART1 >> 8) & 3UL
      expect(cpp).toContain("(*USART1 >> 8) & 3UL");
    });

    it("reads an 8-bit field with correct mask", () => {
      const source = `
@register(0x40011000)
class USART1 {
  @bits(15, 8)  declare BAUD: Bits<8>;
}

const baud = USART1.BAUD;
`;
      const cpp = transpile(source);
      // 8-bit field at lo=8: (*USART1 >> 8) & 255UL
      expect(cpp).toContain("(*USART1 >> 8) & 255UL");
    });
  });

  describe("Register field write", () => {
    it("writes a single-bit field with correct bit manipulation", () => {
      const source = `
@register(0x40011000)
class USART1 {
  @bits(0, 0)   declare UE: Bit;
}

USART1.UE = 1;
`;
      const cpp = transpile(source);
      // Write: *USART1 = (*USART1 & ~1UL) | ((1 & 1UL) << 0)
      expect(cpp).toContain("*USART1 = (*USART1 & ~1UL) | ((1 & 1UL) << 0)");
    });

    it("writes a multi-bit field with correct bit manipulation", () => {
      const source = `
@register(0x40011000)
class USART1 {
  @bits(9, 8)   declare PS: Bits<2>;
}

USART1.PS = 2;
`;
      const cpp = transpile(source);
      // Write: *USART1 = (*USART1 & ~768UL) | ((2 & 3UL) << 8)
      // 3 << 8 = 768
      expect(cpp).toContain("*USART1 = (*USART1 & ~768UL) | ((2 & 3UL) << 8)");
    });

    it("writes an 8-bit field with correct mask", () => {
      const source = `
@register(0x40011000)
class USART1 {
  @bits(15, 8)  declare BAUD: Bits<8>;
}

USART1.BAUD = 115;
`;
      const cpp = transpile(source);
      // 0xFF << 8 = 0xFF00 = 65280
      expect(cpp).toContain("*USART1 = (*USART1 & ~65280UL) | ((115 & 255UL) << 8)");
    });
  });

  describe("Multiple registers", () => {
    it("handles multiple @register classes", () => {
      const source = `
@register(0x40011000)
class USART1 {
  @bits(0, 0)   declare UE: Bit;
}

@register(0x40004400)
class GPIOA {
  @bits(0, 0)   declare MODER0: Bits<2>;
}
`;
      const ir = buildIR(source);
      expect(ir.registerClasses).toHaveLength(2);
      expect(ir.registerClasses[0].name).toBe("USART1");
      expect(ir.registerClasses[0].address).toBe(0x40011000);
      expect(ir.registerClasses[1].name).toBe("GPIOA");
      expect(ir.registerClasses[1].address).toBe(0x40004400);
    });
  });
});