// ---------------------------------------------------------------------------
// board-catalog/types.ts — the board record shape shared by the catalog
// walker, the on-disk overlay, and every consumer (boardgen, the create
// wizard, the sync diff). One record per board VARIANT, keyed by the
// qualified west build target.
// ---------------------------------------------------------------------------

/** One board variant's extractable facts, from its own devicetree + board.yml
 *  + board.cmake. Silicon facts (ADC/PWM matrices) never appear here — they
 *  do not live in devicetree. */
export interface BoardDataEntry {
  /** Qualified west build target (the variant yaml identifier). */
  readonly identifier: string;
  /** Human board name. */
  readonly name: string;
  /** Vendor directory name. */
  readonly vendor: string;
  /** The variant DTS file this was extracted from. */
  readonly dts: string;
  /** Console controller nodelabel (the chosen zephyr,console). */
  readonly console?: string;
  /** Addressable user LED (worldsemi,ws2812-*): the pad driving the pixel.
   *  A plain-GPIO LED — no led0 devicetree spec (the pixel is not a
   *  gpio-leds node). Present only when the board has no gpio-leds LED. */
  readonly stripLed?: { readonly controller: string; readonly pin: number };
  /** PWM-driven LEDs (pwm-leds children) in board order. The alias is the
   *  devicetree alias ('pwm-led0') — the DT_ALIAS-addressable form. */
  readonly pwmLeds?: readonly {
    readonly alias?: string;
    readonly controller: string;
    readonly channel: number;
    readonly periodNs?: number;
    readonly flags?: readonly string[];
  }[];
  /** The board's USB device wiring: 'enabled' (DTS turns the device
   *  controller on), 'disabled' (explicitly off — suppress the USB0
   *  export), undefined (silent; the app overlay may still compose CDC). */
  readonly usbDevice?: 'enabled' | 'disabled';
  /** The USB device controller nodelabel backing usbDevice. */
  readonly usbController?: string;
  /** Watchdog node label (the devicetree watchdog0 alias). */
  readonly wdtNodeLabel?: string;
  /** Probe/flash methods from the board's board.cmake (west runners, in the
   *  board's include order — first = west's default runner). */
  readonly probeMethods?: readonly {
    readonly id: string;
    readonly description: string;
    readonly runner: string;
    readonly args?: readonly string[];
    readonly debug?: boolean;
    readonly debugInterface?: 'swd' | 'jtag';
    readonly debugDevice?: string;
    /** The board's support/openocd.cfg, verbatim lines in file order. */
    readonly debugCfg?: readonly string[];
  }[];
  /** The canonical aliased LED (led0). */
  readonly led?: { readonly dtSpec: string; readonly controller: string; readonly pin: number; readonly flags: readonly string[] };
  /** The canonical aliased button (sw0). */
  readonly button?: { readonly dtSpec: string; readonly controller: string; readonly pin: number; readonly flags: readonly string[] };
  /** Additional aliased LEDs/buttons beyond the canonical ones. */
  readonly extraLeds?: readonly { readonly dtSpec: string; readonly controller: string; readonly pin: number; readonly flags: readonly string[] }[];
  readonly extraButtons?: readonly { readonly dtSpec: string; readonly controller: string; readonly pin: number; readonly flags: readonly string[] }[];
  /** Connector gpio-maps (arduino headers, XIAO edge connector, ...). */
  readonly connectors?: readonly { readonly nodelabel: string; readonly compatible?: string; readonly pins: Readonly<Record<string, { readonly controller: string; readonly pin: number; readonly flags: readonly string[] }>> }[];
  /** Bus controller nodelabels the board DTS wires up. */
  readonly buses?: {
    readonly i2c: readonly string[];
    readonly spi: readonly string[];
    readonly uart: readonly string[];
  };
  /** Silicon PWM routes from the SoC pinctrl files (STM32 vendor HAL's
   *  per-soc *-pinctrl.dtsi, harvested through the board's include chain).
   *  RAW port/bit form — the manifest generator resolves global pin numbers
   *  via its controller table and applies nodelabel conventions (tim4 →
   *  pwm4). Families whose PWM is a matrix or arithmetic (ESP32 LEDC, RP2040
   *  slices) carry no pwmPins — those are family conventions at manifest
   *  generation. */
  readonly pwmPins?: readonly {
    /** Pinctrl-source peripheral, e.g. 'tim4'. */
    readonly source: string;
    readonly channel: number;
    /** GPIO port letter as written in the pinctrl file ('A', 'B', ...). */
    readonly port: string;
    readonly bit: number;
    /** The pinctrl node name — the token overlays reference. */
    readonly pinctrl: string;
  }[];
  /** Silicon analog-input routes from the SoC pinctrl files (STM32
   *  `adc1_in1_pa1` style) or the vendor pin-mux YAMLs (Atmel
   *  modules/hal/atmel/pinconfigs — `[b, adc0, ain15]` per pin). Same
   *  raw-harvest contract as pwmPins; pinctrl is absent for families with
   *  no pinctrl node tokens (Atmel analog inputs need no pad mux). */
  readonly adcPins?: readonly {
    /** ADC controller as written, e.g. 'adc1'. */
    readonly source: string;
    readonly channel: number;
    readonly port: string;
    readonly bit: number;
    readonly pinctrl?: string;
  }[];
  /** Flash size in KB (largest flash@ DT_SIZE_K in the include chain — the
   *  package variant dtsi overrides the SoC base). */
  readonly flashKb?: number;
  /** The board chain already defines a storage_partition label — the
   *  manifest generator must NOT emit synthesis facts (west errors on a
   *  doubly defined node). */
  readonly hasStoragePartition?: boolean;
  /** The board's own storage_partition reg (offset/size bytes) when the
   *  chain ships one — real facts instead of a synthesized region. */
  readonly storageReg?: { offsetBytes: number; sizeBytes: number };
  /** Counter-capable device nodes from the include chain (labeled RTC
   *  nodes with counter compatibles; unlabeled counter{} children under
   *  labeled timer parents — labels assigned in the generated overlay). */
  readonly counterNodes?: readonly {
    readonly compatible: string;
    readonly nodeLabel?: string;
    readonly parentLabel?: string;
  }[];
  /** ESP32 LEDC PWM matrix (harvested from <soc>-pinctrl.h LEDC macros):
   *  any listed pad can carry any of channelCount channels; the overlay
   *  assigns channels to the driven pads at build time. */
  readonly pwmMatrix?: {
    readonly controller: string;
    readonly channelCount: number;
    readonly pads: readonly number[];
  };
  /** Labeled PWM controller device nodes from the include chain (nRF's
   *  psel-routed pwm0..pwm3 — any pad any channel; the manifest generator
   *  synthesizes a matrix from them). */
  readonly pwmNodes?: readonly string[];
  /** ESP32 SARADC routes (harvested from the HAL adc_channel.h):
     *  global pad + channel, keyed to the DT adc{N} device. */
  readonly espAdc?: readonly { readonly source: string; readonly pad: number; readonly channel: number }[];
  /** RP2 header-matrix ADC routes (harvested from the in-tree
   *  rpi-pico-*-pinctrl.h `ADC_CH<n>_P<pad>` macros): global pad + channel
   *  + the PINMUX MACRO token — the RP2 ADC driver applies pinctrl, so the
   *  overlay synthesizes its pad group from the macro. */
  readonly padAdc?: readonly { readonly source: string; readonly channel: number; readonly pad: number; readonly pinctrl: string }[];
  /** RP2 header-matrix PWM routes (the `PWM_<slice><A|B>_P<pad>` macros):
   *  channel = slice*2 + (B?1:0) — the driver's channel encoding — and the
   *  pinmux macro token for the overlay's pinctrl group. */
  readonly padPwm?: readonly { readonly source: string; readonly channel: number; readonly pad: number; readonly pinctrl: string }[];
  /** Wired analog channels from connector io-channel-maps (the DKs'
   *  arduino,uno-adc nodes): the channel index a named connector pin is
   *  wired to, joined with the same connector family's gpio-map for the
   *  pad. Board-authored truth — covers boards on SoCs without a family
   *  table. */
  readonly connectorAdc?: readonly { readonly source: string; readonly channel: number; readonly controller: string; readonly pin: number }[];
  /** Pinctrl harvest lint results — name↔pinmux-value disagreements; each
   *  warning names a route that was dropped as untrustworthy (a harvest bug
   *  or an upstream typo, not a fact to ship). */
  readonly pinctrlWarnings?: readonly string[];
  /** SoC-level ADC/DAC device nodelabels in the include chain — the
   *  cross-check that filters pinctrl routes for undeclared devices. */
  readonly analogDevices?: readonly string[];
  /** Silicon analog-output routes from the SoC pinctrl files (STM32
   *  `dac1_out1_pa4` style). The source ('dac1') is already the DT
   *  nodelabel on STM32. */
  readonly dacPins?: readonly {
    /** DAC controller as written, e.g. 'dac1'. */
    readonly source: string;
    readonly channel: number;
    readonly port: string;
    readonly bit: number;
    readonly pinctrl: string;
  }[];
  /** GPIO controller device nodes from the SoC dtsi include chain (the
   *  universal `gpio-controller` property) — the FULL port inventory, not
   *  just the ports the board's own facts name. Boardgen seeds its derived
   *  controller table from these so every SoC pad sweeps, not just the
   *  wired ones. `ngpios` states the width where the dtsi does. */
  readonly gpioControllers?: readonly {
    readonly nodelabel: string;
    readonly ngpios?: number;
  }[];
  /** The coverage ledger: which silicon source satisfied each capability for
   *  THIS board. 'pinctrl' = SoC pinctrl dtsi/header harvest; 'pinconfig' =
   *  vendor pinconfigs YAML; 'header' = ESP32/RP2 header matrix; 'family' =
   *  a family table (nRF SAADC); 'connector' = board-authored io-channel-map.
   *  Absent = the capability is honestly uncovered. Surfaced by `board sync`
   *  so drift between "known" and "lowered" is diagnosable. */
  readonly siliconSources?: {
    readonly adc?: 'pinctrl' | 'pinconfig' | 'header' | 'family' | 'connector';
    readonly pwm?: 'pinctrl' | 'pinconfig' | 'header' | 'family';
    readonly dac?: 'pinctrl' | 'pinconfig';
  };
}
