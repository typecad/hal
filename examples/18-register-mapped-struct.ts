// ---------------------------------------------------------------------------
// Example 18 — Register-Mapped Structs with Bit Fields
//
// Demonstrates type-safe MMIO register access using @register and @bits
// decorators. Manual bitwise manipulation is replaced with named bit fields
// that the transpiler lowers to correct shift/mask operations.
//
// Transpiles to:
//   volatile uint32_t* const USART1 = reinterpret_cast<volatile uint32_t*>(0x40011000);
//   *USART1 = (*USART1 & ~1UL) | ((1 & 1UL) << 0);   // USART1.UE = 1
//   (*USART1 >> 8) & 3UL                               // USART1.PS read
// ---------------------------------------------------------------------------

import { UART0 } from '@typecad/board';
import { register, bits, type Bit, type Bits } from '@typecad/hal';

// ---------------------------------------------------------------------------
// Define a USART peripheral at address 0x4001_1000
// ---------------------------------------------------------------------------

@register(0x4001_1000)
class USART1 {
  @bits(0, 0)   static UE:  Bit = 0;       // USART enable
  @bits(2, 2)   static RE:  Bit = 0;       // Receiver enable
  @bits(3, 3)   static TE:  Bit = 0;       // Transmitter enable
  @bits(9, 8)   static PS:  Bits<2> = 0;   // Parity selection
  @bits(15, 8)  static BAUD: Bits<8> = 0;  // Baud rate mantissa
}

// ---------------------------------------------------------------------------
// Define a GPIO port at address 0x4001_0800
// ---------------------------------------------------------------------------

@register(0x4001_0800)
class GPIOA {
  @bits(0, 0)   static MODER0: Bits<2> = 0;   // Pin 0 mode
  @bits(1, 1)   static ODR0:   Bit = 0;       // Pin 0 output data
  @bits(31, 16) static IDR_HI: Bits<16> = 0;  // Upper half input data
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

const serial = UART0.begin(9600);

USART1.UE = 1;
USART1.RE = 1;
USART1.TE = 1;

USART1.PS = 2;
USART1.BAUD = 115;

const parity = USART1.PS;
serial.println(parity);

const baud = USART1.BAUD;
serial.println(baud);

GPIOA.ODR0 = 1;

const inputs = GPIOA.IDR_HI;
serial.println(inputs);
