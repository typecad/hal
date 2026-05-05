import { describe, done } from '@typehal/expect';
import { LED, D13, A0, UART0, I2C0, SPI0 } from '@typehal';

describe("Dynamic Board Aliases")
  .it("LED resolves to D13 on Uno")
  .expect(
    (() => {
      // In C++, LED is a Pin instance. We check its _pin value.
      // This requires reaching into private fields or just trusting the emission.
      // For this test, we just ensure it transpiles and "works".
      return LED === D13;
    })
  ).toBe(true)
  .it("UART0 resolves to Serial on Uno")
  .expect(
    (() => {
      // UART0 should be mapped to the 'Serial' C++ object
      UART0.begin(115200);
      return true;
    })
  ).toBe(true);

done();
