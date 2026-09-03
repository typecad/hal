// ---------------------------------------------------------------------------
// catalog-walker.test.ts — the Zephyr boards/ tree walker behind BOTH the
// compiled-in pack (scripts/gen-zephyr-board-data.mjs) and the runtime
// overlay (`cuttlefish board sync`). Pins the extraction facts against a
// fixture mini-tree.
// ----------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { walkBoardCatalog, zephyrVersionOf, gitHeadOf, boardProbeMethods } from '../../../packages/cuttlefish/src/board-catalog/walker';

/** Build a fixture Zephyr tree root (boards/ layout, VERSION, git dir). */
function fixtureTree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-walker-'));
  const zephyr = path.join(root, 'zephyr');
  fs.mkdirSync(path.join(zephyr, 'include', 'zephyr'), { recursive: true });
  fs.writeFileSync(path.join(zephyr, 'CMakeLists.txt'), '# fixture\n');
  fs.writeFileSync(path.join(zephyr, 'include', 'zephyr', 'kernel.h'), '# fixture\n');
  fs.writeFileSync(path.join(zephyr, 'VERSION'), 'VERSION_MAJOR = 4\nVERSION_MINOR = 9\nPATCHLEVEL = 1\n');
  fs.mkdirSync(path.join(zephyr, '.git'), { recursive: true });
  fs.writeFileSync(path.join(zephyr, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(zephyr, '.git', 'refs', 'heads'), { recursive: true });
  fs.writeFileSync(path.join(zephyr, '.git', 'refs', 'heads', 'main'), '0123456789abcdef0123456789abcdef01234567\n');

  // One board dir: board.yml (soc list), one bare-identifier variant yaml +
  // matching dts, board.cmake runners, support/openocd.cfg (stlink).
  const board = path.join(zephyr, 'boards', 'acme', 'widget_board');
  fs.mkdirSync(path.join(board, 'support'), { recursive: true });
  fs.writeFileSync(path.join(board, 'board.yml'), [
    'board:',
    '  name: widget_board',
    '  vendor: acme',
    'socs:',
    '  - name: acme_soc',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(board, 'widget_board.yaml'), [
    'identifier: widget_board',
    'name: Widget Board',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(board, 'widget-pinctrl.dtsi'), [
    '/omit-if-no-ref/ tim3_ch1_pb0: tim3_ch1_pb0 {',
    "	pinmux = <STM32_PINMUX('B', 0, AF2)>;",
    '};',
    '/omit-if-no-ref/ adc1_in1_pa1: adc1_in1_pa1 {',
    "	pinmux = <STM32_PINMUX('A', 1, AF0)>;",
    '};',
    '/omit-if-no-ref/ adc_in0_pa0: adc_in0_pa0 {',
    "	pinmux = <STM32_PINMUX('A', 0, AF0)>;",
    '};',
    '/omit-if-no-ref/ adc1_inp16_pa0: adc1_inp16_pa0 {',
    "	pinmux = <STM32_PINMUX('A', 0, AF0)>;",
    '};',
    '/omit-if-no-ref/ adc1_inn16_pa1: adc1_inn16_pa1 {',
    "	pinmux = <STM32_PINMUX('A', 1, AF0)>;",
    '};',
    '/omit-if-no-ref/ dac1_out1_pa4: dac1_out1_pa4 {',
    "	pinmux = <STM32_PINMUX('A', 4, AF0)>;",
    '};',
    // A name/value MISMATCH (name says pa1, macro says B,1) — the linter
    // drops the route and records a warning.
    '/omit-if-no-ref/ tim9_ch2_pa1: tim9_ch2_pa1 {',
    "	pinmux = <STM32_PINMUX('B', 1, AF3)>;",
    '};',
    // Kinetis name/value mismatch: name says PTB0, macro says C,0.
    '#define ADC0_SE7_PTB0 KINETIS_MUX(\'C\', 0, 0)',
    // NXP Kinetis per-part header macros (route in the macro NAME).
    '#define ADC0_SE8_PTB0 KINETIS_MUX(\'B\', 0, 0)',
    '#define ADC1_DP0_PTB0 KINETIS_MUX(\'B\', 0, 0)',
    '#define FTM0_CH5_PTA0 KINETIS_MUX(\'A\', 0, 3)',
    // NXP LPC55 CTIMER match outputs.
    '#define CTIMER0_MATCH0_PIO0_0 IOCON_MUX(0, IOCON_TYPE_A, 3)',
    // GigaDevice: ADC (all unit spellings) + TIMER channels (CH0N excluded).
    '#define ADC01_IN0_PA0 GD32_PINMUX_AFIO(\'A\', 0, ANALOG, NORMP)',
    '#define ADC012_IN10_PC0 GD32_PINMUX_AFIO(\'C\', 0, ANALOG, NORMP)',
    '#define ADC_IN1_PA1 GD32_PINMUX_AFIO(\'A\', 1, ANALOG, NORMP)',
    '#define ADC2_IN4_PA4 GD32_PINMUX_AFIO(\'A\', 4, ANALOG, NORMP)',
    '#define TIMER0_CH0_PA8 GD32_PINMUX_AFIO(\'A\', 8, AF1, NORMP)',
    '#define TIMER0_CH0N_PA7 GD32_PINMUX_AFIO(\'A\', 7, AF1, NORMP)',
    // i.MX RT: node-name shape; the pad→GPIO join is a sibling node.
    '/omit-if-no-ref/ iomuxc_gpio_ad_b0_12_gpio1_io12: IOMUXC_GPIO_AD_B0_12_GPIO1_IO12 {',
    '	pinmux = <0x401f80ec 5 0x0 0 0x401f82dc>;',
    '};',
    '/omit-if-no-ref/ iomuxc_gpio_ad_b0_12_adc1_in1: IOMUXC_GPIO_AD_B0_12_ADC1_IN1 {',
    '	pinmux = <0x401f80ec 5 0x0 0 0x401f82dc>;',
    '};',
    '/omit-if-no-ref/ iomuxc_gpio_ad_b0_00_gpio1_io00: IOMUXC_GPIO_AD_B0_00_GPIO1_IO00 {',
    '	pinmux = <0x401f80d8 5 0x0 0 0x401f82d0>;',
    '};',
    '/omit-if-no-ref/ iomuxc_gpio_ad_b0_01_gpio1_io01: IOMUXC_GPIO_AD_B0_01_GPIO1_IO01 {',
    '	pinmux = <0x401f80dc 5 0x0 0 0x401f82d4>;',
    '};',
    '/omit-if-no-ref/ iomuxc_gpio_ad_b0_00_flexpwm2_pwma3: IOMUXC_GPIO_AD_B0_00_FLEXPWM2_PWMA3 {',
    '	pinmux = <0x401f80d8 5 0x0 0 0x401f82d0>;',
    '};',
    '/omit-if-no-ref/ iomuxc_gpio_ad_b0_01_flexpwm2_pwmb3: IOMUXC_GPIO_AD_B0_01_FLEXPWM2_PWMB3 {',
    '	pinmux = <0x401f80dc 5 0x0 0 0x401f82d4>;',
    '};',
    '/omit-if-no-ref/ iomuxc_gpio_ad_b0_02_flexpwm1_pwmx0: IOMUXC_GPIO_AD_B0_02_FLEXPWM1_PWMX0 {',
    '	pinmux = <0x401f80e0 5 0x0 0 0x401f82d8>;',
    '};',
    // NEW i.MX RT FlexPWM node-name convention (rt11xx/rt116x/rt118x):
    // `flexpwm1_pwm0_a` (A→ch0); the `_x` complementary is skipped.
    // (The rt11xx ADC is the LPADC — `adc1_ch0a` — and stays out, like LPC55.)
    '/omit-if-no-ref/ iomuxc_gpio_ad_06_gpio8_io31: IOMUXC_GPIO_AD_06_GPIO8_IO31 {',
    '	pinmux = <0x401f80ec 5 0x0 0 0x401f82dc>;',
    '};',
    '/omit-if-no-ref/ iomuxc_gpio_ad_07_gpio9_io00: IOMUXC_GPIO_AD_07_GPIO9_IO00 {',
    '	pinmux = <0x401f80f0 5 0x0 0 0x401f82e0>;',
    '};',
    '/omit-if-no-ref/ iomuxc_gpio_ad_06_flexpwm1_pwm0_a: IOMUXC_GPIO_AD_06_FLEXPWM1_PWM0_A {',
    '	pinmux = <0x401f80ec 5 0x0 0 0x401f82dc>;',
    '};',
    '/omit-if-no-ref/ iomuxc_gpio_ad_07_flexpwm1_pwm0_b: IOMUXC_GPIO_AD_07_FLEXPWM1_PWM0_B {',
    '	pinmux = <0x401f80f0 5 0x0 0 0x401f82e0>;',
    '};',
    '/omit-if-no-ref/ iomuxc_gpio_ad_08_flexpwm1_pwm0_x: IOMUXC_GPIO_AD_08_FLEXPWM1_PWM0_X {',
    '	pinmux = <0x401f80f4 5 0x0 0 0x401f82e4>;',
    '};',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(board, 'widget_board.dts'), [
    '#include "widget-pinctrl.dtsi"',
    '/ {',
    '    pwm0: pwm@4001c000 { status = "disabled"; };',
    '    chosen {',
    '        zephyr,console = &uart0;',
    '    };',
    '    aliases {',
    '        led0 = &user_led;',
    '        sw0 = &button0;',
    '    };',
    '    leds {',
    '        compatible = "gpio-leds";',
    '        user_led: led_0 {',
    '            gpios = <&gpio0 7 GPIO_ACTIVE_LOW>;',
    '        };',
    '    };',
    '    buttons {',
    '        compatible = "gpio-keys";',
    '        button0: button_0 {',
    '            /* gpio flags need validation */',
    '            gpios = <&gpio1 3 (GPIO_PULL_UP | GPIO_ACTIVE_LOW)>;',
    '        };',
    '    };',
    '    widget_connector: connector {',
    '        compatible = "acme,widget-gpio";',
    '        #gpio-cells = <2>;',
    '        gpio-map = <0 0 &gpio0 2 GPIO_ACTIVE_HIGH  /* D0 */',
    '                    1 0 &gpio0 3 GPIO_ACTIVE_HIGH  /* D1 */',
    '                    2 0 &gpio0 4 GPIO_ACTIVE_HIGH  /* A0 */>;',
    '    };',
    '    net_connector: net-connector {',
    '        compatible = "acme,net-gpio";',
    '        #gpio-cells = <2>;',
    '        gpio-map = <0 0 &gpio0 8 0>,  /* Pin 1, LEDK */',
    '                    1 0 &gpio0 9 0>;  /* Pin 2, RESET */',
    '    };',
    '};',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(board, 'board.cmake'), [
    'board_runner_args(jlink "--device=ACME1000_CPU0" "--reset-after-load")',
    'include(${ZEPHYR_BASE}/boards/common/openocd.board.cmake)',
    'include(${ZEPHYR_BASE}/boards/common/jlink.board.cmake)',
    '# a second, config-guarded branch — its args must NOT win',
    'if(CONFIG_OTHER_CORE)',
    '  board_runner_args(jlink "--device=ACME1000_DSP")',
    'endif()',
    // and a duplicate include of the same runner (per-cpu config blocks —
    // imx8mm_evk includes jlink.board.cmake twice)
    'include(${ZEPHYR_BASE}/boards/common/jlink.board.cmake)',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(board, 'support', 'openocd.cfg'), [
    'source [find interface/stlink.cfg]',
    'source [find target/acme.cfg]',
    '',
  ].join('\n'));

  // A second vendor dir: an already-qualified identifier variant whose dts
  // is a DIRECTORY (readFileSync throws) — the reader-failure degradation
  // path must still yield the base record.
  const broken = path.join(zephyr, 'boards', 'broke', 'broken_board');
  fs.mkdirSync(broken, { recursive: true });
  fs.writeFileSync(path.join(broken, 'board.yml'), 'socs:\n  - name: broke_soc\n');
  fs.writeFileSync(path.join(broken, 'broken_board.yaml'), 'identifier: broken_board/broke_soc\nname: Broken Board\n');
  fs.mkdirSync(path.join(broken, 'broken_board.dts'));

  // A variant yaml with no matching .dts at all — skipped entirely.
  const dtsless = path.join(zephyr, 'boards', 'acme', 'dtsless_board');
  fs.mkdirSync(dtsless, { recursive: true });
  fs.writeFileSync(path.join(dtsless, 'board.yml'), 'socs:\n  - name: acme_soc\n');
  fs.writeFileSync(path.join(dtsless, 'dtsless_board.yaml'), 'identifier: dtsless_board\nname: DTS-less Board\n');

  // A multi-board directory (the Zephyr 4.x `boards:` list format — e.g.
  // ezurio/lyra_24_dvk): each entry carries its own soc; the variant yamls
  // carry BARE identifiers that must qualify against their own entry's soc.
  // Deliberately mixes the tree's two indent styles: entry A puts its soc
  // list at the SAME indent as its socs: key (xiao_ble style), entry B two
  // deeper (lyra style).
  const multi = path.join(zephyr, 'boards', 'acme', 'duo_board');
  fs.mkdirSync(multi, { recursive: true });
  fs.writeFileSync(path.join(multi, 'board.yml'), [
    'boards:',
    '  - name: duo_board_a',
    '    full_name: Duo A',
    '    vendor: acme',
    '    socs:',
    '    - name: acme_soc_a',
    '  - name: duo_board_b',
    '    full_name: Duo B',
    '    vendor: acme',
    '    socs:',
    '      - name: acme_soc_b',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(multi, 'duo_board_a.yaml'), 'identifier: duo_board_a\nname: Duo A\n');
  fs.writeFileSync(path.join(multi, 'duo_board_a.dts'), '/ { leds { compatible = "gpio-leds"; a_led: led_0 { gpios = <&gpioa 1 GPIO_ACTIVE_HIGH>; }; }; aliases { led0 = &a_led; }; };\n');
  fs.writeFileSync(path.join(multi, 'duo_board_b.yaml'), 'identifier: duo_board_b\nname: Duo B\n');
  fs.writeFileSync(path.join(multi, 'duo_board_b.dts'), '/ { buttons { compatible = "gpio-keys"; b_btn: button_0 { gpios = <&gpiob 2 GPIO_ACTIVE_LOW>; }; }; aliases { sw0 = &b_btn; }; };\n');
  // A shared board.cmake guarding each variant's runner args behind its own
  // CONFIG_BOARD_<ID> (the raytac_mdbt53 cpuapp/cpunet shape): each variant
  // must get ITS branch's jlink device, not the first one.
  fs.writeFileSync(path.join(multi, 'board.cmake'), [
    'if(CONFIG_BOARD_DUO_BOARD_A)',
    '  board_runner_args(jlink "--device=DUO_A_DEVICE")',
    'elseif(CONFIG_BOARD_DUO_BOARD_B)',
    '  board_runner_args(jlink "--device=DUO_B_DEVICE")',
    'endif()',
    'include(${ZEPHYR_BASE}/boards/common/jlink.board.cmake)',
    '',
  ].join('\n'));

  // A board whose devicetree led0 aliases the SECOND gpio-leds child —
  // canonical selection must follow the alias numbering, not child order.
  const ledorder = path.join(zephyr, 'boards', 'acme', 'ledorder_board');
  fs.mkdirSync(ledorder, { recursive: true });
  fs.writeFileSync(path.join(ledorder, 'board.yml'), 'socs:\n  - name: acme_soc\n');
  fs.writeFileSync(path.join(ledorder, 'ledorder_board.yaml'), 'identifier: ledorder_board\nname: LED Order Board\n');
  fs.writeFileSync(path.join(ledorder, 'ledorder_board.dts'), [
    '/ {',
    '    leds {',
    '        compatible = "gpio-leds";',
    '        red_led: led_0 { gpios = <&gpioa 9 GPIO_ACTIVE_HIGH>; };',
    '        green_led: led_1 { gpios = <&gpioa 10 GPIO_ACTIVE_HIGH>; };',
    '    };',
    '    aliases {',
    '        led0 = &green_led;',
    '        led1 = &red_led;',
    '    };',
    '};',
    '',
  ].join('\n'));

  // A revision-qualified board (the nrf9160dk shape): NO plain variant yaml
  // — only <base>_<rev>.yaml files whose identifiers are the plain target
  // (default revision), @revision-qualified, and /ns, all sharing one base
  // dts. Before the shared-base fallback these yamls dropped AFTER claiming
  // their identifiers, and the board.yml synthesis pass then skipped the
  // same ids — the whole board vanished from the catalog.
  const revboard = path.join(zephyr, 'boards', 'nordic', 'revboard');
  fs.mkdirSync(revboard, { recursive: true });
  fs.writeFileSync(path.join(revboard, 'board.yml'), [
    'board:',
    '  name: revboard',
    '  full_name: Revision Board',
    '  vendor: nordic',
    '  socs:',
    '  - name: nrf9160',
    '    variants:',
    '    - name: ns',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(revboard, 'revboard_nrf9160.dts'), [
    '/ {',
    '    chosen { zephyr,console = &uart0; };',
    '    aliases { led0 = &user_led; };',
    '    leds { compatible = "gpio-leds";',
    '        user_led: led_0 { gpios = <&gpio0 11 GPIO_ACTIVE_LOW>; }; };',
    '};',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(revboard, 'revboard_nrf9160_0_14_0.yaml'),
    'identifier: revboard/nrf9160\nname: Revision Board\n');
  fs.writeFileSync(path.join(revboard, 'revboard_nrf9160_0_7_0.yaml'),
    'identifier: revboard@0.7.0/nrf9160\nname: Revision Board (0.7.0)\n');
  fs.writeFileSync(path.join(revboard, 'revboard_nrf9160_ns_0_14_0.yaml'),
    'identifier: revboard/nrf9160/ns\nname: Revision Board NS\n');

  // ── RP2 header-matrix family ─────────────────────────────────────────────
  // The rp2040 publish their silicon routing as pinmux macros in the
  // dt-bindings pinctrl headers: ADC_CH<n>_P<pad> in the SoC header, the
  // PWM slice macros in the shared common header.
  fs.mkdirSync(path.join(zephyr, 'include', 'zephyr', 'dt-bindings', 'pinctrl'), { recursive: true });
  fs.writeFileSync(path.join(zephyr, 'include', 'zephyr', 'dt-bindings', 'pinctrl', 'rpi-pico-rp2040-pinctrl.h'), [
    '#define ADC_CH0_P26 RP2XXX_PINMUX(26, 0)',
    '#define ADC_CH1_P27 RP2XXX_PINMUX(27, 0)',
    '#define ADC_CH2_P28 RP2XXX_PINMUX(28, 0)',
    '#define ADC_CH3_P29 RP2XXX_PINMUX(29, 0)',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(zephyr, 'include', 'zephyr', 'dt-bindings', 'pinctrl', 'rpi-pico-pinctrl-common.h'), [
    '#define PWM_0A_P0 RP2XXX_PINMUX(0, 4)',
    '#define PWM_0B_P1 RP2XXX_PINMUX(1, 4)',
    '#define PWM_7A_P14 RP2XXX_PINMUX(14, 4)',
    '#define PWM_7B_P15 RP2XXX_PINMUX(15, 4)',
    '',
  ].join('\n'));
  const rpboard = path.join(zephyr, 'boards', 'testvendor', 'rp_board');
  fs.mkdirSync(rpboard, { recursive: true });
  fs.writeFileSync(path.join(rpboard, 'board.yml'), 'board:\n  name: rp_board\n  vendor: testvendor\nsocs:\n  - name: rp2040\n');
  fs.writeFileSync(path.join(rpboard, 'rp_board.yaml'), 'identifier: rp_board\nname: RP Board\n');
  fs.writeFileSync(path.join(rpboard, 'rp_board.dts'), [
    '/ {',
    '    chosen { zephyr,console = &uart0; };',
    '    buttons { compatible = "gpio-keys";',
    '        button0: button_0 { gpios = <&gpio0 20 GPIO_PULL_UP>; }; };',
    '    aliases { sw0 = &button0; };',
    '};',
    '',
  ].join('\n'));

  // ── Atmel pinconfigs family ──────────────────────────────────────────────
  // The vendor-maintained pin-mux YAMLs under modules/hal/atmel/pinconfigs —
  // west modules live BESIDE the zephyr checkout (westRoot = dirname(base)).
  const atmelCfg = path.join(path.dirname(zephyr), 'modules', 'hal', 'atmel', 'pinconfigs');
  fs.mkdirSync(atmelCfg, { recursive: true });
  fs.writeFileSync(path.join(atmelCfg, 'sam-fixture.yml'), [
    'model: atmel,sam',
    'family: fixture',
    'map: SAM_PINMUX',
    'series: [d51]',
    'pins:',
    '  pa02:',
    '    pincodes: [g, j]',
    '    periph:',
    '      - [b, adc0, ain0]',
    '  pb03:',
    '    pincodes: [g, j, n]',
    '    periph:',
    '      - [b, adc1, ain15]',
    '  pc10:',
    '    pincodes: [n]',
    '    periph:',
    '      - [b, adc0, ain11]',
    '',
  ].join('\n'));
  const atboard = path.join(zephyr, 'boards', 'testvendor', 'at_board');
  fs.mkdirSync(atboard, { recursive: true });
  fs.writeFileSync(path.join(atboard, 'board.yml'), 'socs:\n  - name: samd51j19a\n');
  fs.writeFileSync(path.join(atboard, 'at_board.yaml'), 'identifier: at_board\nname: Atmel Board\n');
  fs.writeFileSync(path.join(atboard, 'at_board.dts'), [
    '/ {',
    '    leds { compatible = "gpio-leds";',
    '        user_led: led_0 { gpios = <&porta 5 GPIO_ACTIVE_LOW>; }; };',
    '    aliases { led0 = &user_led; };',
    '};',
    '',
  ].join('\n'));

  // ── Bouffalolab pinconfigs family ────────────────────────────────────────
  // Pins are global pads; `analog:` lists `[adc, [ch<N>]]`; `series` names the
  // SoC variants (bl602/bl604).
  const bflbCfg = path.join(path.dirname(zephyr), 'modules', 'hal', 'bouffalolab', 'pinconfigs');
  fs.mkdirSync(bflbCfg, { recursive: true });
  fs.writeFileSync(path.join(bflbCfg, 'bl60x.yml'), [
    'model: bflb,bl',
    'family: bl60x',
    'map: BFLB_PINMUX',
    'series: [602, 604]',
    'pins:',
    '  gpio4:',
    '    series: [602, 604]',
    '    analog:',
    '      - [adc, [ch1]]',
    '  gpio5:',
    '    series: [602, 604]',
    '    analog:',
    '      - [adc, [ch4]]',
    '  gpio6:',
    '    series: [604]',
    '    analog:',
    '      - [adc, [ch5]]',
    '',
  ].join('\n'));
  const blboard = path.join(zephyr, 'boards', 'testvendor', 'bl_board');
  fs.mkdirSync(blboard, { recursive: true });
  fs.writeFileSync(path.join(blboard, 'board.yml'), 'socs:\n  - name: bl602\n');
  fs.writeFileSync(path.join(blboard, 'bl_board.yaml'), 'identifier: bl_board\nname: Bouffalolab Board\n');
  fs.writeFileSync(path.join(blboard, 'bl_board.dts'), [
    '/ {',
    '    leds { compatible = "gpio-leds";',
    '        user_led: led_0 { gpios = <&gpio0 1 GPIO_ACTIVE_LOW>; }; };',
    '    aliases { led0 = &user_led; };',
    '};',
    '',
  ].join('\n'));

  // ── SoC gpio-controller inventory ────────────────────────────────────────
  // A board whose DTS names only gpioa (its led) but whose SoC dtsi include
  // declares the full port inventory (gpioa…gpioc). The walker must harvest
  // the FULL list from the include chain, not just the wired ports.
  const socboard = path.join(zephyr, 'boards', 'testvendor', 'port_board');
  fs.mkdirSync(socboard, { recursive: true });
  fs.writeFileSync(path.join(socboard, 'board.yml'), 'socs:\n  - name: acme_soc\n');
  fs.writeFileSync(path.join(socboard, 'port_board.yaml'), 'identifier: port_board\nname: Port Board\n');
  fs.writeFileSync(path.join(socboard, 'port_soc.dtsi'), [
    '/ {',
    '    soc {',
    '        gpioa: gpio@40020000 { gpio-controller; #gpio-cells = <2>; };',
    '        gpiob: gpio@40020400 { gpio-controller; #gpio-cells = <2>; ngpios = <32>; };',
    '        gpioc: gpio@40020800 { gpio-controller; #gpio-cells = <2>; };',
    '        adc0: adc@40030000 { };',
    '        lpadc1: adc@40031000 { };',
    '        eadc0: eadc@40032000 { };',
    '        adc_0: adc@40033000 { };',
    '        dac: dac@40034000 { };',
    '        hscmp0: comparator@40035000 { };',
    '    };',
    '};',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(socboard, 'port_board.dts'), [
    '#include "port_soc.dtsi"',
    '/ {',
    '    leds { compatible = "gpio-leds";',
    '        user_led: led_0 { gpios = <&gpioa 1 GPIO_ACTIVE_LOW>; }; };',
    '    aliases { led0 = &user_led; };',
    '};',
    '',
  ].join('\n'));

  // ── Connector io-channel wiring ──────────────────────────────────────────
  // A gpio-map connector plus an analog-connector io-channel-map: the join
  // by label (A0/A1) yields channel→pad wiring authored by the board.
  // by label (A0/A1) yields channel→pad wiring authored by the board.
  const cnboard = path.join(zephyr, 'boards', 'testvendor', 'cn_board');
  fs.mkdirSync(cnboard, { recursive: true });
  fs.writeFileSync(path.join(cnboard, 'board.yml'), 'socs:\n  - name: other_soc\n');
  fs.writeFileSync(path.join(cnboard, 'cn_board.yaml'), 'identifier: cn_board\nname: Connector Board\n');
  fs.writeFileSync(path.join(cnboard, 'cn_board.dts'), [
    '/ {',
    '    cn_header: connector-header {',
    '        compatible = "test,gpio-connector";',
    '        #gpio-cells = <2>;',
    '        gpio-map = <0 0 &gpio0 4 0>,  /* A0 */',
    '                    1 0 &gpio0 5 0>,  /* A1 */',
    '                    2 0 &gpio0 6 0>;',
    '    };',
    '    cn_adc: analog-connector {',
    '        compatible = "arduino,uno-adc";',
    '        #io-channel-cells = <1>;',
    '        io-channel-map = <0 &testadc 1>,  /* A0 = gpio0.4 = ch1 */',
    '                         <1 &testadc 3>,  /* A1 = gpio0.5 = ch3 */',
    '                         <2 &testadc 7>;',
    '    };',
    '};',
    '',
  ].join('\n'));

  return zephyr;
}

describe('catalog-walker', () => {
  let zephyr: string;
  let result: ReturnType<typeof walkBoardCatalog>;

  beforeAll(() => {
    zephyr = fixtureTree();
    result = walkBoardCatalog(zephyr);
  });

  afterAll(() => {
    fs.rmSync(path.dirname(zephyr), { recursive: true, force: true });
  });

  it('qualifies a bare identifier with the board.yml soc and keeps qualified ones', () => {
    expect(Object.keys(result.boards).sort()).toEqual([
      'at_board/samd51j19a',
      'bl_board/bl602',
      'broken_board/broke_soc',
      'cn_board/other_soc',
      'duo_board_a/acme_soc_a',
      'duo_board_b/acme_soc_b',
      'ledorder_board/acme_soc',
      'port_board/acme_soc',
      'revboard/nrf9160',
      'revboard/nrf9160/ns',
      'revboard@0.7.0/nrf9160',
      'rp_board/rp2040',
      'widget_board/acme_soc',
    ]);
    const widget = result.boards['widget_board/acme_soc'];
    expect(widget).toBeDefined();
    expect(widget!.name).toBe('Widget Board');
    expect(widget!.vendor).toBe('acme');
    expect(widget!.dts).toBe('widget_board.dts');
  });

  it('revision-qualified yamls resolve through the shared base dts (nrf9160dk regression)', () => {
    // The default-revision yaml carries the PLAIN identifier, the older
    // revision an @rev-qualified one, and the ns variant its trailing
    // segment — all over one shared base dts, none with a same-basename
    // .dts. All three must be present, none may vanish, and the board.yml
    // synthesis pass must not double-emit the ids the yamls claimed.
    const plain = result.boards['revboard/nrf9160'];
    expect(plain).toBeDefined();
    expect(plain!.dts).toBe('revboard_nrf9160.dts');
    expect(plain!.led).toMatchObject({ controller: 'gpio0', pin: 11 });
    expect(result.boards['revboard@0.7.0/nrf9160']!.dts).toBe('revboard_nrf9160.dts');
    expect(result.boards['revboard/nrf9160/ns']!.dts).toBe('revboard_nrf9160.dts');
  });

  it('RP2 header matrices: ADC_CH macros and PWM slice macros become routes', () => {
    const rp = result.boards['rp_board/rp2040'];
    expect(rp).toBeDefined();
    expect(rp!.padAdc).toEqual([
      { source: 'adc', channel: 0, pad: 26, pinctrl: 'ADC_CH0_P26' },
      { source: 'adc', channel: 1, pad: 27, pinctrl: 'ADC_CH1_P27' },
      { source: 'adc', channel: 2, pad: 28, pinctrl: 'ADC_CH2_P28' },
      { source: 'adc', channel: 3, pad: 29, pinctrl: 'ADC_CH3_P29' },
    ]);
    // PWM_7B_P15 → slice 7, B → channel 7*2+1 = 15 (the driver's encoding).
    const pwm15 = rp!.padPwm!.find((p) => p.pad === 15);
    expect(pwm15).toMatchObject({ source: 'pwm', channel: 15, pinctrl: 'PWM_7B_P15' });
    expect(rp!.padPwm!.find((p) => p.pad === 14)).toMatchObject({ channel: 14, pinctrl: 'PWM_7A_P14' });
  });

  it('Atmel pinconfigs YAML: adc routes for the soc package, unbonded pins skipped', () => {
    const at = result.boards['at_board/samd51j19a'];
    expect(at).toBeDefined();
    // samd51j19a → series d51, pincode j: pa02 (adc0 ain0) + pb03
    // (adc1 ain15) bonded; pc10 is n-only — no route.
    expect(at!.adcPins).toEqual([
      { source: 'adc0', channel: 0, port: 'A', bit: 2 },
      { source: 'adc1', channel: 15, port: 'B', bit: 3 },
    ]);
  });

  it('Bouffalolab pinconfigs YAML: per-SoC-variant adc routes (gpio0 pad form)', () => {
    const bl = result.boards['bl_board/bl602'];
    expect(bl).toBeDefined();
    // bl602 → series 602: gpio4 (adc ch1) + gpio5 (adc ch4) bonded; gpio6 is
    // 604-only — skipped. The pad maps to the flat gpio0 controller as port '0'.
    expect(bl!.adcPins).toEqual([
      { source: 'adc0', channel: 1, port: '0', bit: 4 },
      { source: 'adc0', channel: 4, port: '0', bit: 5 },
    ]);
  });

  it('coverage ledger: records which silicon source satisfied each capability', () => {
    // widget_board → pinctrl ADC; at_board + bl_board → pinconfig; rp_board →
    // header; cn_board → connector. Aggregated into stats.coverage.
    expect(result.stats.coverage.adc).toEqual({ pinctrl: 1, pinconfig: 2, header: 1, connector: 1 });
    expect(result.stats.coverage.pwm).toEqual({ pinctrl: 1, header: 1 }); // widget_board tim3 + rp_board PWM macros
    expect(result.stats.coverage.dac).toEqual({ pinctrl: 1 }); // widget_board dac1
  });

  it('connector io-channel-maps join to pads through the gpio-map labels', () => {
    const cn = result.boards['cn_board/other_soc'];
    expect(cn).toBeDefined();
    expect(cn!.connectorAdc).toEqual([
      { source: 'testadc', channel: 1, controller: 'gpio0', pin: 4 },
      { source: 'testadc', channel: 3, controller: 'gpio0', pin: 5 },
    ]);
  });

  it('harvests the full GPIO controller inventory from the SoC include chain', () => {
    // The board's own DTS names only gpioa (its led); the SoC dtsi include
    // declares gpioa..gpioc. All three must appear (sorted), with ngpios
    // carried where the dtsi states it.
    const pb = result.boards['port_board/acme_soc'];
    expect(pb).toBeDefined();
    expect(pb!.gpioControllers).toEqual([
      { nodelabel: 'gpioa' },
      { nodelabel: 'gpiob', ngpios: 32 },
      { nodelabel: 'gpioc' },
    ]);
  });

  it('recognizes every ADC/DAC device label, not just adc\d*/dac\d*', () => {
    // The label — not the node name — is the device signal. lpadc1 (NXP
    // LPADC), eadc0 (Nuvoton), adc_0 (NXP MCX underscore form) and dac all
    // land in analogDevices; a comparator (hscmp0) does not.
    const pb = result.boards['port_board/acme_soc'];
    expect([...(pb!.analogDevices ?? [])].sort()).toEqual(['adc0', 'adc_0', 'dac', 'eadc0', 'lpadc1']);
  });

  it('STM32 pinctrl spellings: standard, digitless, and H7 inp routes harvest; inn skipped', () => {
    const w = result.boards['widget_board/acme_soc'];
    expect(w).toBeDefined();
    const adc = w!.adcPins!;
    expect(adc.find((r) => r.pinctrl === 'adc1_in1_pa1')).toMatchObject({ source: 'adc1', channel: 1, port: 'A', bit: 1 });
    expect(adc.find((r) => r.pinctrl === 'adc_in0_pa0')).toMatchObject({ source: 'adc', channel: 0, port: 'A', bit: 0 });
    expect(adc.find((r) => r.pinctrl === 'adc1_inp16_pa0')).toMatchObject({ source: 'adc1', channel: 16, port: 'A', bit: 0 });
    // Differential negative inputs are not single-ended channels.
    expect(adc.find((r) => r.pinctrl === 'adc1_inn16_pa1')).toBeUndefined();
    expect(w!.dacPins!.find((r) => r.pinctrl === 'dac1_out1_pa4')).toMatchObject({ source: 'dac1', channel: 1 });
    expect(w!.pwmPins!.find((r) => r.pinctrl === 'tim3_ch1_pb0')).toMatchObject({ source: 'tim3', channel: 1, port: 'B', bit: 0 });
    expect(w!.pwmNodes).toEqual(['pwm0']);
  });

  it('NXP/GD32 pinctrl grammars harvest (Kinetis, LPC CTIMER, GD32, i.MX RT)', () => {
    const w = result.boards['widget_board/acme_soc'];
    const adc = w!.adcPins!;
    const pwm = w!.pwmPins!;
    // Kinetis ADC16 single-ended; the differential DP form is excluded.
    expect(adc.find((r) => r.pinctrl === 'ADC0_SE8_PTB0')).toMatchObject({ source: 'adc0', channel: 8, port: 'B', bit: 0 });
    expect(adc.find((r) => r.pinctrl === 'ADC1_DP0_PTB0')).toBeUndefined();
    expect(pwm.find((r) => r.pinctrl === 'FTM0_CH5_PTA0')).toMatchObject({ source: 'ftm0', channel: 5, port: 'A', bit: 0 });
    // LPC CTIMER (MATCHn = pwm channel n).
    expect(pwm.find((r) => r.pinctrl === 'CTIMER0_MATCH0_PIO0_0')).toMatchObject({ source: 'ctimer0', channel: 0, port: '0', bit: 0 });
    // GD32 ADC: header macros harvest all unit spellings (ADC01→adc0,
    // ADC012→adc0, ADC_IN→adc, ADC2→adc2); CH0N complementary excluded.
    expect(adc.find((r) => r.pinctrl === 'ADC01_IN0_PA0')).toMatchObject({ source: 'adc0', channel: 0, port: 'A', bit: 0 });
    expect(adc.find((r) => r.pinctrl === 'ADC012_IN10_PC0')).toMatchObject({ source: 'adc0', channel: 10, port: 'C', bit: 0 });
    expect(adc.find((r) => r.pinctrl === 'ADC_IN1_PA1')).toMatchObject({ source: 'adc', channel: 1, port: 'A', bit: 1 });
    expect(adc.find((r) => r.pinctrl === 'ADC2_IN4_PA4')).toMatchObject({ source: 'adc2', channel: 4, port: 'A', bit: 4 });
    expect(pwm.find((r) => r.pinctrl === 'TIMER0_CH0_PA8')).toMatchObject({ source: 'timer0', channel: 0, port: 'A', bit: 8 });
    expect(pwm.find((r) => r.pinctrl === 'TIMER0_CH0N_PA7')).toBeUndefined();
    // i.MX RT: routes via the in-band pad→GPIO join; controller = the DT
    // child (flexpwm2_pwm3), channel A=0/B=1; pwmx excluded.
    expect(adc.find((r) => r.pinctrl === 'iomuxc_gpio_ad_b0_12_adc1_in1')).toMatchObject({ source: 'adc1', channel: 1, port: '1', bit: 12 });
    const fta = pwm.find((r) => r.pinctrl === 'iomuxc_gpio_ad_b0_00_flexpwm2_pwma3');
    expect(fta).toMatchObject({ source: 'flexpwm2_pwm3', channel: 0, port: '1', bit: 0 });
    expect(pwm.find((r) => r.pinctrl === 'iomuxc_gpio_ad_b0_01_flexpwm2_pwmb3')).toMatchObject({ channel: 1 });
    expect(pwm.find((r) => r.pinctrl === 'iomuxc_gpio_ad_b0_02_flexpwm1_pwmx0')).toBeUndefined();
    // NEW i.MX RT FlexPWM convention (rt11xx+): `flexpwm1_pwm0_a` (A→ch0);
    // `_x` (complementary) is skipped — mirroring the pwmx rule. The rt11xx
    // ADC (`adc1_ch0a`) is the LPADC and stays out (not harvested).
    expect(pwm.find((r) => r.pinctrl === 'iomuxc_gpio_ad_06_flexpwm1_pwm0_a')).toMatchObject({ source: 'flexpwm1_pwm0', channel: 0, port: '8', bit: 31 });
    expect(pwm.find((r) => r.pinctrl === 'iomuxc_gpio_ad_07_flexpwm1_pwm0_b')).toMatchObject({ source: 'flexpwm1_pwm0', channel: 1, port: '9', bit: 0 });
    expect(pwm.find((r) => r.pinctrl === 'iomuxc_gpio_ad_08_flexpwm1_pwm0_x')).toBeUndefined();
    expect(adc.find((r) => r.pinctrl === 'iomuxc_gpio_ad_06_adc1_ch0a')).toBeUndefined();
  });

  it('name↔value cross-validation drops disagreeing routes and warns', () => {
    const w = result.boards['widget_board/acme_soc'];
    // The mismatched STM32 node and Kinetis define are gone…
    expect(w!.pwmPins!.find((r) => r.pinctrl === 'tim9_ch2_pa1')).toBeUndefined();
    expect(w!.adcPins!.find((r) => r.pinctrl === 'ADC0_SE7_PTB0')).toBeUndefined();
    // …and each drop is named in the record's lint warnings.
    const warns = w!.pinctrlWarnings ?? [];
    expect(warns.some((x) => /tim9_ch2_pa1.*name says A1.*value says B1/.test(x))).toBe(true);
    expect(warns.some((x) => /ADC0_SE7_PTB0.*name says B0.*value says C0/.test(x))).toBe(true);
    // The AGREEING routes above are untouched (presence asserted by the
    // STM32-grammar and NXP-grammar tests).
  });

  it('stats surface dropped yamls and reader failures', () => {
    // dtsless_board has an identifier but no resolvable .dts anywhere —
    // absent from the catalog AND counted; broken_board's dts is a
    // directory (reader failure → base record).
    expect(result.boards['dtsless_board/acme_soc']).toBeUndefined();
    expect(result.stats.droppedYamls).toBe(1);
    expect(result.stats.failures).toBe(1);
    expect(result.stats.variants).toBe(13);
  });

  it('qualifies multi-board dirs against each entry’s own soc', () => {
    // The Zephyr 4.x `boards:` list format: two boards, one dir, bare
    // identifiers — each takes ITS entry's soc, not the other's.
    const a = result.boards['duo_board_a/acme_soc_a'];
    expect(a).toBeDefined();
    expect(a!.led).toMatchObject({ controller: 'gpioa', pin: 1 });
    const b = result.boards['duo_board_b/acme_soc_b'];
    expect(b).toBeDefined();
    expect(b!.button).toMatchObject({ controller: 'gpiob', pin: 2 });
    // …and each variant's runner args come from ITS CONFIG_BOARD guard
    // branch — a shared board.cmake must not hand variant B variant A's
    // jlink device (raytac cpunet inherited the cpuapp device before).
    expect(a!.probeMethods!.find((m) => m.id === 'jlink')!.debugDevice).toBe('DUO_A_DEVICE');
    expect(b!.probeMethods!.find((m) => m.id === 'jlink')!.debugDevice).toBe('DUO_B_DEVICE');
  });

  it('extracts the LED/button devicetree facts with flags', () => {
    const widget = result.boards['widget_board/acme_soc']!;
    expect(widget.led).toMatchObject({ dtSpec: 'led0', controller: 'gpio0', pin: 7, flags: ['GPIO_ACTIVE_LOW'] });
    expect(widget.button).toMatchObject({ dtSpec: 'sw0', controller: 'gpio1', pin: 3 });
    expect(widget.button!.flags).toContain('GPIO_PULL_UP');
    expect(widget.console).toBe('uart0');
  });

  it('a comment line inside a node does not hide the property after it', () => {
    // 96b_nitrogen's button0 carries `/* gpio flags need validation */`
    // between '{' and its gpios — the comment marker used to prefix the
    // property statement and break the anchored match, silently dropping
    // the aliased button from the catalog.
    const widget = result.boards['widget_board/acme_soc']!;
    expect(widget.button).toBeDefined();
    expect(widget.button!.controller).toBe('gpio1');
    expect(widget.button!.pin).toBe(3);
  });

  it('extracts connector gpio-map labels', () => {
    const widget = result.boards['widget_board/acme_soc']!;
    expect(widget.connectors).toHaveLength(2);
    const pins = widget.connectors!.find((c) => c.nodelabel === 'widget_connector')!.pins as Record<string, { controller: string; pin: number }>;
    expect(pins.D0).toMatchObject({ controller: 'gpio0', pin: 2 });
    expect(pins.D1).toMatchObject({ controller: 'gpio0', pin: 3 });
    expect(pins.A0).toMatchObject({ controller: 'gpio0', pin: 4 });
  });

  it('derives probe methods from board.cmake (openocd+stlink cfg, jlink device)', () => {
    const widget = result.boards['widget_board/acme_soc']!;
    const ids = widget.probeMethods!.map((m) => m.id);
    // openocd.board.cmake is included FIRST → also first in the table; the
    // duplicate jlink include must not mint a second jlink method.
    expect(ids).toEqual(['stlink', 'jlink']);
    const stlink = widget.probeMethods![0]!;
    expect(stlink.runner).toBe('openocd');
    expect(stlink.debug).toBe(true);
    expect(stlink.debugCfg).toContain('source [find interface/stlink.cfg]');
    const jlink = widget.probeMethods![1]!;
    // First board_runner_args line wins — the config-guarded second branch
    // (a different cpu core) must not clobber the default branch's device.
    expect(jlink.debugDevice).toBe('ACME1000_CPU0');
  });

  it('comma-style connector comments yield net-name labels, never truncated garbage', () => {
    // '/* Pin 1, LEDK */' used to split at the unshielded comma and mint a
    // bogus 'Pin' label (marker consumer chopped a real character). The
    // net name after the comma is the label; the pin number is not.
    const widget = result.boards['widget_board/acme_soc']!;
    const net = widget.connectors!.find((c) => c.nodelabel === 'net_connector')!;
    // 'Pin 2, RESET' trails the property's ';' — its marker never enters
    // the value, so the p<N> fallback names that entry (documented quirk).
    expect(Object.keys(net.pins).sort()).toEqual(['LEDK', 'p1']);
    expect(net.pins.LEDK).toMatchObject({ controller: 'gpio0', pin: 8 });
    expect(net.pins.p1).toMatchObject({ controller: 'gpio0', pin: 9 });
  });

  it('degrades to the base record when the reader throws', () => {
    const broken = result.boards['broken_board/broke_soc']!;
    expect(broken.identifier).toBe('broken_board/broke_soc');
    expect(broken.led).toBeUndefined();
    expect(broken.connectors).toBeUndefined();
    expect(result.stats.failures).toBe(1);
  });

  it('records provenance: version, git head, generatedAt', () => {
    expect(result.provenance.version).toBe('4.9.1');
    expect(result.provenance.gitHead).toBe('0123456789abcdef0123456789abcdef01234567');
    expect(result.provenance.zephyrBase).toBe(path.resolve(zephyr));
    expect(result.provenance.variants).toBe(13);
  });

  it('reads version and git head helpers directly', () => {
    expect(zephyrVersionOf(zephyr)).toBe('4.9.1');
    expect(gitHeadOf(zephyr)).toBe('0123456789abcdef0123456789abcdef01234567');
    // packed-refs fallback when the loose ref is absent
    fs.rmSync(path.join(zephyr, '.git', 'refs', 'heads', 'main'));
    fs.writeFileSync(path.join(zephyr, '.git', 'packed-refs'), '# pack-refs with: peeled fully-peeled sorted\n0123456789abcdef0123456789abcdef01234567 refs/heads/main\n');
    expect(gitHeadOf(zephyr)).toBe('0123456789abcdef0123456789abcdef01234567');
  });

  it('maps vendor-flavored runner includes to their real methods', () => {
    // openocd-stm32 / openocd-nrf5 are the openocd runner with vendor
    // defaults; esp32 is the esptool runner. Unmapped, ST boards lost
    // their onboard-ST-Link method and ESP32 boards their ROM bootloader.
    const stm = path.join(zephyr, 'boards', 'acme', 'stm_like');
    fs.mkdirSync(path.join(stm, 'support'), { recursive: true });
    fs.writeFileSync(path.join(stm, 'board.yml'), 'socs:\n  - name: acme_soc\n');
    fs.writeFileSync(path.join(stm, 'stm_like.yaml'), 'identifier: stm_like\nname: STM-Like\n');
    fs.writeFileSync(path.join(stm, 'stm_like.dts'), '/ { leds { compatible = "gpio-leds"; l: led_0 { gpios = <&gpioa 1 GPIO_ACTIVE_HIGH>; }; }; aliases { led0 = &l; }; };\n');
    fs.writeFileSync(path.join(stm, 'board.cmake'), [
      'include(${ZEPHYR_BASE}/boards/common/openocd-stm32.board.cmake)',
      'include(${ZEPHYR_BASE}/boards/common/jlink.board.cmake)',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(stm, 'support', 'openocd.cfg'), 'source [find interface/stlink.cfg]\n');

    const esp = path.join(zephyr, 'boards', 'acme', 'esp_like');
    fs.mkdirSync(esp, { recursive: true });
    fs.writeFileSync(path.join(esp, 'board.yml'), 'socs:\n  - name: acme_soc2\n');
    fs.writeFileSync(path.join(esp, 'esp_like.yaml'), 'identifier: esp_like\nname: ESP-Like\n');
    fs.writeFileSync(path.join(esp, 'esp_like.dts'), '/ { leds { compatible = "gpio-leds"; l: led_0 { gpios = <&gpioa 2 GPIO_ACTIVE_HIGH>; }; }; aliases { led0 = &l; }; };\n');
    fs.writeFileSync(path.join(esp, 'board.cmake'), [
      'include(${ZEPHYR_BASE}/boards/common/esp32.board.cmake)',
      // The new-generation flashers: cubeprog (macro arg must be filtered),
      // uf2, nrfutil — ids are the west runner name, all flash-only.
      'board_runner_args(stm32cubeprogrammer "--port=swd" "--reset-mode=hw")',
      'include(${ZEPHYR_BASE}/boards/common/stm32cubeprogrammer.board.cmake)',
      'board_runner_args(uf2 "--board-id=RPI-RP2")',
      'include(${ZEPHYR_BASE}/boards/common/uf2.board.cmake)',
      'include(${ZEPHYR_BASE}/boards/common/nrfutil.board.cmake)',
      'board_runner_args(silabs_commander "--device=${CONFIG_SOC}")',
      'include(${ZEPHYR_BASE}/boards/common/silabs_commander.board.cmake)',
      '',
    ].join('\n'));

    const walk2 = walkBoardCatalog(zephyr);
    const stmProbes = walk2.boards['stm_like/acme_soc']!.probeMethods!;
    expect(stmProbes.map((m) => m.id)).toEqual(['stlink', 'jlink']);
    expect(stmProbes[0]!.runner).toBe('openocd-stm32');
    expect(stmProbes[0]!.debugCfg?.join('\n')).toContain('interface/stlink');
    const espProbes = walk2.boards['esp_like/acme_soc2']!.probeMethods!;
    expect(espProbes.map((m) => m.id)).toEqual(['esptool', 'stm32cubeprogrammer', 'uf2', 'nrfutil', 'silabs_commander']);
    const cube = espProbes[1]!;
    expect(cube.debug).toBe(false);
    expect(cube.args).toEqual(['--port=swd', '--reset-mode=hw']);
    const uf2 = espProbes[2]!;
    expect(uf2.args).toEqual(['--board-id=RPI-RP2']);
    expect(uf2.debug).toBe(false);
    // The unresolvable CMake macro arg is dropped; with nothing left the
    // args field is omitted entirely and the method survives.
    const commander = espProbes[4]!;
    expect(commander.args).toBeUndefined();
    expect(commander.debug).toBe(false);
  });

  it('CONFIG_SOC-guarded runner args select by soc + qualifier (imx8mm shape)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-socguard-'));
    try {
      fs.writeFileSync(path.join(dir, 'board.cmake'), [
        'if(CONFIG_SOC_MIMX8MM6_M4)',
        '  board_runner_args(jlink "--device=MIMX8MD6_M4")',
        'endif()',
        'if(CONFIG_SOC_MIMX8MM6_A53)',
        '  board_runner_args(jlink "--device=MIMX8MM6_A53_0" "--no-reset")',
        'endif()',
        'include(${ZEPHYR_BASE}/boards/common/jlink.board.cmake)',
        '',
      ].join('\n'));
      const deviceOf = (id: string) =>
        boardProbeMethods(dir, {
          boardConfigs: [id.split('/')[0].replace(/[^A-Za-z0-9]/g, '_').toUpperCase()],
          soc: id.split('/')[1],
          quals: id.split('/').slice(2),
        })!.find((m) => m.id === 'jlink')!.debugDevice;
      expect(deviceOf('imx8mm_evk/mimx8mm6/m4')).toBe('MIMX8MD6_M4');
      // a53/smp matches the A53 branch via its qualifier token — and must
      // NOT inherit the M4 branch: the CONFIG_BOARD_IMX8MM_EVK stem is a
      // PREFIX of …_EVK_MIMX8MM6_M4, so the BOARD rule needs a token
      // boundary to stay out of it.
      expect(deviceOf('imx8mm_evk/mimx8mm6/a53/smp')).toBe('MIMX8MM6_A53_0');
      // A qualifier with no branch falls back to the first occurrence.
      expect(deviceOf('imx8mm_evk/mimx8mm6/hifi1')).toBe('MIMX8MD6_M4');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a runner include guarded by another core’s config is not offered (variscite shape)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-guardedinc-'));
    try {
      fs.writeFileSync(path.join(dir, 'board.cmake'), [
        'if(CONFIG_SOC_MIMX8ML8_M7)',
        '  board_set_debugger_ifnset(jlink)',
        '  board_runner_args(jlink "--device=MIMX8ML8_M7")',
        '  include(${ZEPHYR_BASE}/boards/common/jlink.board.cmake)',
        'endif()',
        '',
      ].join('\n'));
      const probesFor = (id: string) =>
        boardProbeMethods(dir, {
          boardConfigs: [id.split('/')[0].replace(/[^A-Za-z0-9]/g, '_').toUpperCase()],
          soc: id.split('/')[1],
          quals: id.split('/').slice(2),
        });
      // The A53 target has no jlink — the include only exists for the M7.
      expect(probesFor('imx8mp_var_dart/mimx8ml8/a53')).toBeUndefined();
      const m7 = probesFor('imx8mp_var_dart/mimx8ml8/m7');
      expect(m7!.find((m) => m.id === 'jlink')!.debugDevice).toBe('MIMX8ML8_M7');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('canonical LED follows devicetree led0, not gpio-leds child order', () => {
    // mm_swiftio shape: led0 = green_led is the SECOND child. Picking the
    // first aliased child made the manifest's LED0 contradict the
    // devicetree's led0.
    const lo = result.boards['ledorder_board/acme_soc']!;
    expect(lo.led).toMatchObject({ dtSpec: 'led0', controller: 'gpioa', pin: 10 });
    expect(lo.extraLeds).toHaveLength(1);
    expect(lo.extraLeds![0]).toMatchObject({ dtSpec: 'led1', controller: 'gpioa', pin: 9 });
  });

  it('synthesizes board.yml-driven targets that ship no per-variant yamls', () => {
    // nucleo_n657x0_q shape: variants declared under the soc entry, only a
    // base + a <board>_<soc>_<variant>.dts — no yaml files at all. The
    // whole board family used to vanish from the catalog.
    const bo = path.join(zephyr, 'boards', 'acme', 'ymlboard');
    fs.mkdirSync(bo, { recursive: true });
    fs.writeFileSync(path.join(bo, 'board.yml'), [
      'board:',
      '  name: ymlboard',
      '  full_name: YAML Board',
      '  vendor: acme',
      '  socs:',
      '    - name: acme_soc',
      '      variants:',
      '        - name: sb',
      '',
    ].join('\n'));
    const dtsBody = '/ { leds { compatible = "gpio-leds"; l: led_0 { gpios = <&gpioa 5 GPIO_ACTIVE_HIGH>; }; }; aliases { led0 = &l; }; };\n';
    fs.writeFileSync(path.join(bo, 'ymlboard.dts'), dtsBody);
    fs.writeFileSync(path.join(bo, 'ymlboard_acme_soc_sb.dts'), dtsBody);

    const walk2 = walkBoardCatalog(zephyr);
    const base = walk2.boards['ymlboard/acme_soc'];
    expect(base).toBeDefined();
    expect(base!.name).toBe('YAML Board');
    expect(base!.dts).toBe('ymlboard.dts');
    expect(base!.led).toMatchObject({ controller: 'gpioa', pin: 5 });
    const sb = walk2.boards['ymlboard/acme_soc/sb'];
    expect(sb).toBeDefined();
    expect(sb!.dts).toBe('ymlboard_acme_soc_sb.dts');
    expect(sb!.led).toMatchObject({ controller: 'gpioa', pin: 5 });
  });

  it('throws for a tree with no boards/ directory', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-empty-'));
    expect(() => walkBoardCatalog(empty)).toThrow(/no boards\/ directory/);
    fs.rmSync(empty, { recursive: true, force: true });
  });
});
