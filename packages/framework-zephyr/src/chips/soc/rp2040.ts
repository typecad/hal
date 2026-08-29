// Hand-maintained descriptor table — mechanically migrated from the
// board-rp2040 + mcu-rp2040 package data (the exact flatten+reconstruct the build
// performed). Curated additions: tier/pinNaming/excludedPins. Regenerate
// only alongside a descriptor-type change (edit this file; the original
// migration script was never committed).

import type { ZephyrChipDescriptor } from '../types.js';

export const RP2040_SOC: ZephyrChipDescriptor = {
  "id": "rpi_pico/rp2040",
  "soc": "rp2040",
  "gpioController": "gpio0",
  "gpio": {
    "dtSpecs": [
      {
        "pin": 25,
        "dtSpec": "led0"
      }
    ]
  },
  "i2c": {
    "controllers": [
      {
        "nodeLabel": "i2c0"
      },
      {
        "nodeLabel": "i2c1"
      }
    ]
  },
  "spi": {
    "controllers": [
      {
        "nodeLabel": "spi0"
      },
      {
        "nodeLabel": "spi1"
      }
    ]
  },
  "uart": {
    "controllers": [
      {
        "nodeLabel": "uart0"
      },
      {
        "nodeLabel": "uart1",
        "pinctrl": {
          "include": "zephyr/dt-bindings/pinctrl/rpi-pico-rp2040-pinctrl.h",
          "pinmux": [
            "UART1_TX_P8"
          ],
          "inputPinmux": [
            "UART1_RX_P9"
          ]
        },
        "props": [
          "current-speed = <115200>;"
        ]
      }
    ]
  },
  "pwm": {
    "specs": [
      {
        "pin": 25,
        "controller": "pwm",
        "channel": 9
      }
    ],
    "maxFrequencyHz": 62500000,
    "resolutionBits": 16
  },
  "adc": {
    "nodeLabel": "adc",
    "resolution": 12,
    "vrefMv": 3300,
    "channels": [
      {
        "pin": 26,
        "channel": 0
      },
      {
        "pin": 27,
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
  "storage": {
    "offset": 1572864,
    "size": 524288
  },
  "usb": {
    "controller": "zephyr_udc0",
    "cdcInstances": 1,
    "vid": "0x2FE3",
    "pid": "0x0004"
  },
  "consoleDescription": "uart0 on GP0 (TX) / GP1 (RX)",
  "probeMethods": [
    {
      "id": "uf2",
      "runner": "uf2",
      "description": "BOOTSEL UF2 bootloader: hold BOOTSEL while plugging in USB (no debug)",
      "debug": false
    },
    {
      "id": "openocd",
      "runner": "openocd",
      "description": "Any CMSIS-DAP-class SWD probe on the SWD header — also debugs",
      "debug": true,
      "debugInterface": "swd",
      "debugCfgSource": [
        "interface/cmsis-dap.cfg",
        "target/rp2040.cfg"
      ]
    },
    {
      "id": "jlink",
      "runner": "jlink",
      "description": "J-Link probe (SWD) — also debugs",
      "debug": true,
      "debugInterface": "swd",
      "debugDevice": "RP2040_M0_0"
    }
  ],
  "tier": "validated",
  "pinNaming": "rp-gpio",
  "excludedPins": [
    23,
    24
  ]
};
