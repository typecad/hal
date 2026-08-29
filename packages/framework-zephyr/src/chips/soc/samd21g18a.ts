// Hand-maintained descriptor table — mechanically migrated from the
// board-nano-33-iot + mcu-samd21 package data (the exact flatten+reconstruct the build
// performed). Curated additions: tier/pinNaming/excludedPins. Regenerate
// only alongside a descriptor-type change (edit this file; the original
// migration script was never committed).

import type { ZephyrChipDescriptor } from '../types.js';

export const SAMD21G18A_SOC: ZephyrChipDescriptor = {
  "id": "arduino_nano_33_iot/samd21g18a",
  "soc": "samd21g18a",
  "gpioController": "porta",
  "gpioControllers": [
    {
      "nodelabel": "porta",
      "minPin": 0,
      "maxPin": 31
    },
    {
      "nodelabel": "portb",
      "minPin": 32,
      "maxPin": 55
    }
  ],
  "gpio": {
    "dtSpecs": [
      {
        "pin": 17,
        "dtSpec": "led0"
      }
    ]
  },
  "i2c": {
    "controllers": [
      {
        "nodeLabel": "sercom4"
      }
    ]
  },
  "spi": {
    "controllers": [
      {
        "nodeLabel": "sercom1"
      }
    ]
  },
  "uart": {
    "controllers": [
      {
        "nodeLabel": "sercom5"
      }
    ]
  },
  "pwm": {
    "specs": [
      {
        "pin": 17,
        "dtSpec": "pwm-led0"
      }
    ],
    "maxFrequencyHz": 46875,
    "resolutionBits": 16
  },
  "adc": {
    "nodeLabel": "adc",
    "resolution": 12,
    "vrefMv": 1650,
    "channels": [
      {
        "pin": 2,
        "channel": 0
      },
      {
        "pin": 40,
        "channel": 2
      },
      {
        "pin": 41,
        "channel": 3
      },
      {
        "pin": 34,
        "channel": 10
      },
      {
        "pin": 9,
        "channel": 17
      },
      {
        "pin": 10,
        "channel": 18
      },
      {
        "pin": 11,
        "channel": 19
      }
    ],
    "gain": "ADC_GAIN_1",
    "reference": "ADC_REF_VDD_1_2"
  },
  "usb": {
    "controller": "zephyr_udc0",
    "cdcInstances": 1,
    "vid": "0x2FE3",
    "pid": "0x0003",
    "touchReset": {
      "flagAddress": 536903676,
      "magic": 125010229,
      "bootloaderVid": "0x2341",
      "bootloaderPid": "0x0057"
    }
  },
  "consoleDescription": "sercom5 on PB22 (TX, D1) / PB23 (RX, D0) at 115200",
  "probeMethods": [
    {
      "id": "bossac",
      "runner": "bossac",
      "description": "Built-in USB bootloader: double-tap reset, flash over the USB port (no debug)",
      "debug": false
    },
    {
      "id": "openocd",
      "runner": "openocd",
      "description": "Any CMSIS-DAP-class SWD probe on the underside SWD pads — also debugs",
      "debug": true,
      "debugInterface": "swd",
      "debugCfg": [
        "reset_config none"
      ],
      "debugCfgSource": [
        "interface/cmsis-dap.cfg",
        "target/at91samd.cfg"
      ]
    },
    {
      "id": "jlink",
      "runner": "jlink",
      "description": "J-Link probe (SWD) on the underside SWD pads — also debugs",
      "debug": true,
      "debugInterface": "swd",
      "debugDevice": "ATSAMD21G18"
    }
  ],
  "tier": "validated",
  "pinNaming": "samd-port"
};
