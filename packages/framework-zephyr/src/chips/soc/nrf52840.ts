// Hand-maintained descriptor table — mechanically migrated from the
// board-xiao-nrf52840 + mcu-nrf52840 package data (the exact flatten+reconstruct the build
// performed). Curated additions: tier/pinNaming/excludedPins. Regenerate
// only alongside a descriptor-type change (edit this file; the original
// migration script was never committed).

import type { ZephyrChipDescriptor } from '../types.js';

export const NRF52840_SOC: ZephyrChipDescriptor = {
  "id": "xiao_ble/nrf52840",
  "soc": "nrf52840",
  "gpioController": "gpio0",
  "gpioControllers": [
    {
      "nodelabel": "gpio0",
      "minPin": 0,
      "maxPin": 31
    },
    {
      "nodelabel": "gpio1",
      "minPin": 32,
      "maxPin": 47
    }
  ],
  "gpio": {
    "dtSpecs": [
      {
        "pin": 26,
        "dtSpec": "led0"
      },
      {
        "pin": 30,
        "dtSpec": "led1"
      },
      {
        "pin": 6,
        "dtSpec": "led2"
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
        "nodeLabel": "spi2"
      }
    ]
  },
  "uart": {
    "controllers": [
      {
        "nodeLabel": "uart0"
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
    "maxFrequencyHz": 2000000,
    "resolutionBits": 16
  },
  "adc": {
    "nodeLabel": "adc",
    "resolution": 12,
    "vrefMv": 3000,
    "channels": [
      {
        "pin": 2,
        "channel": 0
      },
      {
        "pin": 3,
        "channel": 1
      },
      {
        "pin": 28,
        "channel": 2
      },
      {
        "pin": 29,
        "channel": 3
      }
    ]
  },
  "wdt": {
    "nodeLabel": "wdt0"
  },
  "usb": {
    "controller": "zephyr_udc0",
    "cdcInstances": 1,
    "vid": "0x2FE3",
    "pid": "0x0003"
  },
  "probeMethods": [
    {
      "id": "jlink",
      "runner": "jlink",
      "description": "J-Link probe (SWD)",
      "debug": true,
      "debugInterface": "swd",
      "debugDevice": "nRF52840_xxAA"
    },
    {
      "id": "openocd",
      "runner": "openocd",
      "description": "Any SWD probe openocd supports (CMSIS-DAP, cheap clones)",
      "debug": true,
      "debugInterface": "swd",
      "debugCfgSource": [
        "interface/stlink.cfg",
        "target/nrf52.cfg"
      ]
    },
    {
      "id": "uf2",
      "runner": "uf2",
      "description": "Bootloader UF2 drag-and-drop: double-tap reset",
      "debug": false
    }
  ],
  "tier": "validated",
  "pinNaming": "nrf-port"
};
