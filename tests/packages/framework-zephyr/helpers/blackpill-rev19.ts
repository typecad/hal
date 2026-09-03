// ---------------------------------------------------------------------------
// Black-pill board constants at the CURRENT manifest shape (GENERATOR_REV 19).
//
// The checked-in fixture catalog (tests/fixtures/board-catalog.overlay.json)
// is rev 9 — machine-independent by design — and predates both the ADC/PWM
// silicon-route harvest and the per-family channel-setup pair. Tests that
// need those facts amend them onto the fixture board's constants, exactly the
// shape every synced tree generates today:
//   - PA0 = ADC1_IN0 with the STM32 driver-mandated ADC_GAIN_1 +
//     ADC_REF_INTERNAL pair (adc_stm32.c rejects every other gain)
//   - PB6 = TIM4_CH1 (pin 22 on the gpioa 0-15 / gpiob 16-31 split)
// ---------------------------------------------------------------------------

import { generateBoard } from '../../../../packages/framework-zephyr/src/boardgen';
import type { BoardConstants } from '../../../../packages/cuttlefish/src/api/shared/board-resolver';

export function blackpillRev19(): { boardTs: string; boardConstants: BoardConstants } {
  const g = generateBoard('blackpill_f411ce/stm32f411xe');
  const consts: Record<string, string | number | boolean> = { ...JSON.parse(g.boardJson).constants };
  consts['zephyr.adc.nodeLabel'] = 'adc1';
  consts['zephyr.adc.resolution'] = 12;
  consts['zephyr.adc.vrefMv'] = 3300;
  consts['zephyr.adc.gain'] = 'ADC_GAIN_1';
  consts['zephyr.adc.reference'] = 'ADC_REF_INTERNAL';
  consts['zephyr.adc.channels.0.pin'] = 0;
  consts['zephyr.adc.channels.0.channel'] = 0;
  consts['zephyr.adc.channels.0.pinctrl'] = 'adc1_in0_pa0';
  return { boardTs: g.boardTs, boardConstants: new Map(Object.entries(consts)) as BoardConstants };
}
