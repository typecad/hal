// Hand-maintained descriptor table — mechanically migrated from the
// board-blackpill-f411ce + mcu-stm32f411 package data (the exact flatten+reconstruct the build
// performed). Curated additions: tier/pinNaming/excludedPins. Regenerate
// only alongside a descriptor-type change (edit this file; the original
// migration script was never committed).

import type { ZephyrChipDescriptor } from '../types.js';

export const STM32F411XE_SOC: ZephyrChipDescriptor = {
  "id": "blackpill_f411ce/stm32f411xe",
  "soc": "stm32f411xe",
  "gpioController": "gpioa",
  "gpioControllers": [
    {
      "nodelabel": "gpioa",
      "minPin": 0,
      "maxPin": 15
    },
    {
      "nodelabel": "gpiob",
      "minPin": 16,
      "maxPin": 31
    },
    {
      "nodelabel": "gpioc",
      "minPin": 32,
      "maxPin": 47
    }
  ],
  "gpio": {
    "dtSpecs": [
      {
        "pin": 45,
        "dtSpec": "led0"
      },
      {
        "pin": 0,
        "dtSpec": "sw0"
      }
    ],
    "interruptPins": [
      {
        "pin": 0,
        "dtSpec": "sw0"
      }
    ]
  },
  "i2c": {
    "controllers": [
      {
        "nodeLabel": "i2c1"
      }
    ]
  },
  "spi": {
    "controllers": [
      {
        "nodeLabel": "spi1"
      }
    ]
  },
  "uart": {
    "controllers": [
      {
        "nodeLabel": "usart1"
      }
    ]
  },
  "pwm": {
    "specs": [
      {
        "pin": 22,
        "controller": "pwm4",
        "channel": 1,
        "periodNs": 20000000,
        "pinctrl": "tim4_ch1_pb6"
      },
      {
        "pin": 23,
        "controller": "pwm4",
        "channel": 2,
        "periodNs": 20000000,
        "pinctrl": "tim4_ch2_pb7"
      }
    ],
    "clockHz": 96000000,
    "maxFrequencyHz": 50000000,
    "resolutionBits": 16
  },
  "adc": {
    "nodeLabel": "adc1",
    "resolution": 12,
    "vrefMv": 3300,
    "channels": [
      {
        "pin": 0,
        "channel": 0,
        "pinctrl": "adc1_in0_pa0"
      },
      {
        "pin": 1,
        "channel": 1,
        "pinctrl": "adc1_in1_pa1"
      },
      {
        "pin": 2,
        "channel": 2,
        "pinctrl": "adc1_in2_pa2"
      },
      {
        "pin": 3,
        "channel": 3,
        "pinctrl": "adc1_in3_pa3"
      },
      {
        "pin": 4,
        "channel": 4,
        "pinctrl": "adc1_in4_pa4"
      },
      {
        "pin": 5,
        "channel": 5,
        "pinctrl": "adc1_in5_pa5"
      },
      {
        "pin": 6,
        "channel": 6,
        "pinctrl": "adc1_in6_pa6"
      },
      {
        "pin": 7,
        "channel": 7,
        "pinctrl": "adc1_in7_pa7"
      },
      {
        "pin": 16,
        "channel": 8,
        "pinctrl": "adc1_in8_pb0"
      },
      {
        "pin": 17,
        "channel": 9,
        "pinctrl": "adc1_in9_pb1"
      }
    ],
    "gain": "ADC_GAIN_1",
    "reference": "ADC_REF_INTERNAL"
  },
  "wdt": {
    "nodeLabel": "iwdg"
  },
  "storage": {
    "offset": 262144,
    "size": 262144
  },
  "usb": {
    "controller": "zephyr_udc0",
    "cdcInstances": 1,
    "vid": "0x2FE3",
    "pid": "0x0002"
  },
  "consoleDescription": "usart1 on PA9 (TX) / PA10 (RX)",
  "probeMethods": [
    {
      "id": "stlink",
      "runner": "openocd",
      "args": [
        "--cmd-pre-init=reset_config none"
      ],
      "description": "ST-Link or any SWD probe openocd supports (no BOOT0 needed)",
      "debug": true,
      "debugInterface": "swd",
      "debugCfg": [
        "reset_config none"
      ],
      "debugCfgSource": [
        "interface/stlink.cfg",
        "target/stm32f4x.cfg"
      ]
    },
    {
      "id": "stlink-srst",
      "runner": "openocd",
      "args": [
        "--cmd-pre-init=reset_config srst_only srst_nogate connect_assert_srst"
      ],
      "description": "ST-Link with the RST/SRST line wired — connect under reset (recovers wedged targets)",
      "debug": true,
      "debugInterface": "swd",
      "debugCfg": [
        "reset_config srst_only srst_nogate connect_assert_srst"
      ],
      "debugCfgSource": [
        "interface/stlink.cfg",
        "target/stm32f4x.cfg"
      ]
    },
    {
      "id": "dfu",
      "runner": "dfu-util",
      "description": "Built-in USB bootloader: hold BOOT0, tap reset",
      "debug": false
    },
    {
      "id": "jlink",
      "runner": "jlink",
      "description": "J-Link probe (SWD)",
      "debug": true,
      "debugInterface": "swd",
      "debugDevice": "STM32F411CE"
    }
  ],
  "customBoard": {
    "socs": [
      "stm32f411xe"
    ],
    "dtsIncludes": [
      "st/f4/stm32f411Xe.dtsi",
      "st/f4/stm32f411c(c-e)ux-pinctrl.dtsi"
    ],
    "console": {
      "nodeLabel": "usart1",
      "tx": "usart1_tx_pa9",
      "rx": "usart1_rx_pa10",
      "speed": 115200
    },
    "clocks": {
      "hseMHz": 25,
      "pll": {
        "divM": 25,
        "mulN": 192,
        "divP": 2,
        "divQ": 4
      },
      "sysMHz": 96,
      "ahbPrescaler": 1,
      "apb1Prescaler": 2,
      "apb2Prescaler": 1
    },
    "usbNode": "usbotg_fs",
    "usbPinctrl": [
      "usb_otg_fs_dm_pa11",
      "usb_otg_fs_dp_pa12"
    ],
    "adcNode": {
      "nodeLabel": "adc1",
      "clockSource": "SYNC",
      "prescaler": 2,
      "pinctrl": "adc1_in1_pa1"
    }
  },
  "tier": "validated",
  "pinNaming": "stm32-port"
};
