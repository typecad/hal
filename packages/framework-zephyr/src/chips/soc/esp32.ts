// Hand-maintained descriptor table — mechanically migrated from the
// board-esp32-devkit + mcu-esp32 package data (the exact flatten+reconstruct the build
// performed). Curated additions: tier/pinNaming/excludedPins. Regenerate
// only alongside a descriptor-type change (edit this file; the original
// migration script was never committed).

import type { ZephyrChipDescriptor } from '../types.js';

export const ESP32_SOC: ZephyrChipDescriptor = {
  "id": "esp32_devkitc/esp32/procpu",
  "soc": "esp32",
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
      "maxPin": 39
    }
  ],
  "gpio": {
    "dtSpecs": [
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
        "nodeLabel": "i2c0"
      }
    ]
  },
  "spi": {
    "controllers": [
      {
        "nodeLabel": "spi2"
      },
      {
        "nodeLabel": "spi3"
      }
    ]
  },
  "uart": {
    "controllers": [
      {
        "nodeLabel": "uart1"
      },
      {
        "nodeLabel": "uart2"
      }
    ]
  },
  "adc": {
    "nodeLabel": "adc0",
    "resolution": 12,
    "vrefMv": 1100,
    "channels": [
      {
        "pin": 36,
        "channel": 0
      },
      {
        "pin": 37,
        "channel": 1
      },
      {
        "pin": 38,
        "channel": 2
      },
      {
        "pin": 39,
        "channel": 3
      },
      {
        "pin": 32,
        "channel": 4
      },
      {
        "pin": 33,
        "channel": 5
      },
      {
        "pin": 34,
        "channel": 6
      },
      {
        "pin": 35,
        "channel": 7
      }
    ]
  },
  "wdt": {
    "nodeLabel": "wdt0"
  },
  "wifi": {
    "supported": true
  },
  "tier": "validated",
  "pinNaming": "esp32-gpio",
  "excludedPins": [
    6,
    7,
    8,
    9,
    10,
    11,
    16,
    17
  ]
};
