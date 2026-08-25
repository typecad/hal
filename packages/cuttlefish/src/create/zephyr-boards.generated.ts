// ---------------------------------------------------------------------------
// zephyr-boards.generated.ts — the exhaustive Zephyr board snapshot
//
// GENERATED FILE — do not edit by hand. Regenerate against a workspace at the
// pinned revision (v4.4.2) with:
//
//   node scripts/gen-zephyr-boards.mjs <workspace>
//
// Enumerated from Zephyr 4.4 via scripts/list_boards.py: every HWMv2
// board, grouped by SoC (the join key for MCU-only targets — an MCU package's
// zephyr.socs selects the compatible boards). 1014 boards across
// 587 SoCs.
// ---------------------------------------------------------------------------

/** One Zephyr board: its `west build -b` name, vendor folder, and SoC(s). */
export interface ZephyrBoardEntry {
  name: string;
  vendor: string;
  socs: string[];
}

/** Boards grouped by first SoC name (e.g. 'stm32f411xe' → WeAct blackpill, …). */
export const ZEPHYR_BOARD_SNAPSHOT: Readonly<Record<string, ZephyrBoardEntry[]>> = {
  'acp_6_0': [
    { name: 'acp_6_0_adsp', vendor: 'amd', socs: ['acp_6_0'] },
  ],
  'ae1c1f4051920ph0': [
    { name: 'ensemble_e1c_dk', vendor: 'alif', socs: ['ae1c1f4051920ph0'] },
  ],
  'ae350': [
    { name: 'adp_xc7k', vendor: 'andestech', socs: ['ae350'] },
  ],
  'ae402fa0e5597le0': [
    { name: 'ensemble_e8_dk', vendor: 'alif', socs: ['ae402fa0e5597le0', 'ae612fa0e5597ls0', 'ae822fa0e5597ls0'] },
  ],
  'agilex': [
    { name: 'intel_socfpga_agilex_socdk', vendor: 'intel', socs: ['agilex'] },
  ],
  'agilex5': [
    { name: 'intel_socfpga_agilex5_socdk', vendor: 'intel', socs: ['agilex5'] },
  ],
  'alder_lake': [
    { name: 'intel_adl_crb', vendor: 'intel', socs: ['alder_lake'] },
    { name: 'intel_adl_rvp', vendor: 'intel', socs: ['alder_lake'] },
    { name: 'up_squared_pro_7000', vendor: 'up-bridge-the-gap', socs: ['alder_lake'] },
  ],
  'am2434': [
    { name: 'am243x_evm', vendor: 'ti', socs: ['am2434'] },
  ],
  'am6232': [
    { name: 'pocketbeagle_2', vendor: 'beagle', socs: ['am6232', 'am6254', 'mspm0l1105'] },
  ],
  'am6234': [
    { name: 'phyboard_lyra', vendor: 'phytec', socs: ['am6234'] },
    { name: 'verdin_am62', vendor: 'toradex', socs: ['am6234'] },
  ],
  'am6254': [
    { name: 'sk_am62', vendor: 'ti', socs: ['am6254'] },
  ],
  'am62l3': [
    { name: 'am62l_evm', vendor: 'ti', socs: ['am62l3'] },
  ],
  'am6442': [
    { name: 'phyboard_electra', vendor: 'phytec', socs: ['am6442'] },
    { name: 'sk_am64', vendor: 'ti', socs: ['am6442'] },
  ],
  'amd_versal2_apu': [
    { name: 'versal2_apu', vendor: 'amd', socs: ['amd_versal2_apu'] },
  ],
  'amd_versal2_rpu': [
    { name: 'versal2_rpu', vendor: 'amd', socs: ['amd_versal2_rpu'] },
  ],
  'amd_versalnet_apu': [
    { name: 'versalnet_apu', vendor: 'amd', socs: ['amd_versalnet_apu'] },
  ],
  'amd_versalnet_rpu': [
    { name: 'versalnet_rpu', vendor: 'amd', socs: ['amd_versalnet_rpu'] },
  ],
  'an383': [
    { name: 'mps2', vendor: 'arm', socs: ['an383', 'an385', 'an386', 'an500', 'an521'] },
  ],
  'apollo2': [
    { name: 'apollo2_evb', vendor: 'ambiq', socs: ['apollo2'] },
  ],
  'apollo3_blue': [
    { name: 'apollo3_evb', vendor: 'ambiq', socs: ['apollo3_blue'] },
    { name: 'rak11720', vendor: 'rakwireless', socs: ['apollo3_blue'] },
  ],
  'apollo3p_blue': [
    { name: 'apollo3p_evb', vendor: 'ambiq', socs: ['apollo3p_blue'] },
  ],
  'apollo4p': [
    { name: 'apollo4p_evb', vendor: 'ambiq', socs: ['apollo4p'] },
  ],
  'apollo4p_blue': [
    { name: 'apollo4p_blue_kxr_evb', vendor: 'ambiq', socs: ['apollo4p_blue'] },
  ],
  'apollo510': [
    { name: 'apollo510_evb', vendor: 'ambiq', socs: ['apollo510'] },
  ],
  'apollo_lake': [
    { name: 'up_squared', vendor: 'up-bridge-the-gap', socs: ['apollo_lake'] },
  ],
  'arc_hsdk': [
    { name: 'hsdk', vendor: 'snps', socs: ['arc_hsdk'] },
  ],
  'arc_hsdk4xd': [
    { name: 'hsdk4xd', vendor: 'snps', socs: ['arc_hsdk4xd'] },
  ],
  'arc_iot': [
    { name: 'iotdk', vendor: 'snps', socs: ['arc_iot'] },
  ],
  'ast1030': [
    { name: 'ast1030_evb', vendor: 'aspeed', socs: ['ast1030'] },
  ],
  'atom': [
    { name: 'acrn', vendor: 'acrn', socs: ['atom'] },
    { name: 'acrn_adl_crb', vendor: 'acrn', socs: ['atom'] },
    { name: 'acrn_ehl_crb', vendor: 'acrn', socs: ['atom'] },
    { name: 'qemu_x86', vendor: 'intel', socs: ['atom'] },
    { name: 'qemu_x86_64', vendor: 'intel', socs: ['atom'] },
    { name: 'qemu_x86_tiny', vendor: 'intel', socs: ['atom'] },
  ],
  'atsame54p20a': [
    { name: 'sam_e54_cult', vendor: 'microchip', socs: ['atsame54p20a'] },
    { name: 'sam_e54_xpro', vendor: 'microchip', socs: ['atsame54p20a'] },
  ],
  'bcm2711': [
    { name: 'rpi_4b', vendor: 'raspberrypi', socs: ['bcm2711'] },
  ],
  'bcm2712': [
    { name: 'rpi_5', vendor: 'raspberrypi', socs: ['bcm2712'] },
  ],
  'bcm58400': [
    { name: 'bcm958401m2', vendor: 'brcm', socs: ['bcm58400'] },
  ],
  'bcm58402': [
    { name: 'bcm958402m2', vendor: 'brcm', socs: ['bcm58402'] },
  ],
  'beetle_r0': [
    { name: 'v2m_beetle', vendor: 'arm', socs: ['beetle_r0'] },
  ],
  'bgm220pc22hna': [
    { name: 'bgm220_ek4314a', vendor: 'silabs', socs: ['bgm220pc22hna'] },
    { name: 'lyra_dvk_p', vendor: 'ezurio', socs: ['bgm220pc22hna'] },
    { name: 'slwrb4311a', vendor: 'silabs', socs: ['bgm220pc22hna'] },
  ],
  'bgm220sc22hna': [
    { name: 'lyra_dvk_s', vendor: 'ezurio', socs: ['bgm220sc22hna'] },
  ],
  'bgm240pb22vna': [
    { name: 'lyra_24_dvk_p10', vendor: 'ezurio', socs: ['bgm240pb22vna'] },
  ],
  'bgm240pb32vna': [
    { name: 'lyra_24_dvk_p20', vendor: 'ezurio', socs: ['bgm240pb32vna'] },
  ],
  'bgm240pb32vnn': [
    { name: 'lyra_24_dvk_p20rf', vendor: 'ezurio', socs: ['bgm240pb32vnn'] },
  ],
  'bgm240sb22vna': [
    { name: 'lyra_24_dvk_s10', vendor: 'ezurio', socs: ['bgm240sb22vna'] },
  ],
  'bl602c00q2i': [
    { name: 'ai_wb2_12f_kit', vendor: 'aithinker', socs: ['bl602c00q2i'] },
  ],
  'bl602c20q2i': [
    { name: 'dt_bl10_devkit', vendor: 'doiting', socs: ['bl602c20q2i'] },
  ],
  'bl604e20q2i': [
    { name: 'bl604e_iot_dvk', vendor: 'bflb', socs: ['bl604e20q2i'] },
  ],
  'bl616c50q2i': [
    { name: 'ai_m62_12f_kit', vendor: 'aithinker', socs: ['bl616c50q2i'] },
    { name: 'maix_m0s_dock', vendor: 'sipeed', socs: ['bl616c50q2i'] },
  ],
  'bl618m05q2i': [
    { name: 'ai_m61_32s_kit', vendor: 'aithinker', socs: ['bl618m05q2i'] },
    { name: 'qcc744m_evk', vendor: 'qcom', socs: ['bl618m05q2i'] },
  ],
  'bl702c10q2h': [
    { name: 'dt_xt_zb1_devkit', vendor: 'doiting', socs: ['bl702c10q2h'] },
  ],
  'bl704l10q2i': [
    { name: '3r_tnh_sensor_lite', vendor: 'thirdreality', socs: ['bl704l10q2i'] },
  ],
  'bl706c00q2i': [
    { name: 'bl706_iot_dvk', vendor: 'bflb', socs: ['bl706c00q2i'] },
  ],
  'cavs25': [
    { name: 'intel_adsp', vendor: 'intel', socs: ['cavs25', 'ace15_mtpm', 'ace20_lnl', 'ace30', 'ace40'] },
  ],
  'cc1312r': [
    { name: 'cc1312r1_launchxl', vendor: 'ti', socs: ['cc1312r'] },
  ],
  'cc1352p': [
    { name: 'cc1352p1_launchxl', vendor: 'ti', socs: ['cc1352p'] },
  ],
  'cc1352p7': [
    { name: 'beagleconnect_freedom', vendor: 'beagle', socs: ['cc1352p7'] },
    { name: 'beagleplay', vendor: 'beagle', socs: ['cc1352p7', 'am6254'] },
    { name: 'cc1352p7_lp', vendor: 'ti', socs: ['cc1352p7'] },
  ],
  'cc1352r': [
    { name: 'cc1352r_sensortag', vendor: 'ti', socs: ['cc1352r'] },
    { name: 'cc1352r1_launchxl', vendor: 'ti', socs: ['cc1352r'] },
  ],
  'cc2340r5': [
    { name: 'lp_em_cc2340r5', vendor: 'ti', socs: ['cc2340r5'] },
  ],
  'cc2652r': [
    { name: 'cc26x2r1_launchxl', vendor: 'ti', socs: ['cc2652r'] },
  ],
  'cc3220sf': [
    { name: 'cc3220sf_launchxl', vendor: 'ti', socs: ['cc3220sf'] },
  ],
  'cc3235sf': [
    { name: 'cc3235sf_launchxl', vendor: 'ti', socs: ['cc3235sf'] },
  ],
  'ch32v003': [
    { name: 'ch32v003evt', vendor: 'wch', socs: ['ch32v003'] },
    { name: 'ch32v003f4p6_dev_board', vendor: 'wch', socs: ['ch32v003'] },
  ],
  'ch32v006': [
    { name: 'ch32v006evt', vendor: 'wch', socs: ['ch32v006'] },
  ],
  'ch32v203': [
    { name: 'bluepillplus_ch32v203', vendor: 'weact', socs: ['ch32v203'] },
  ],
  'ch32v208': [
    { name: 'linkw', vendor: 'wch', socs: ['ch32v208'] },
  ],
  'ch32v303': [
    { name: 'ch32v303vct6_evt', vendor: 'wch', socs: ['ch32v303'] },
  ],
  'ch32v307': [
    { name: 'ch32v307v_evt_r1', vendor: 'wch', socs: ['ch32v307'] },
  ],
  'corstone300': [
    { name: 'mps3', vendor: 'arm', socs: ['corstone300', 'corstone310'] },
  ],
  'corstone315': [
    { name: 'mps4', vendor: 'arm', socs: ['corstone315', 'corstone320'] },
  ],
  'cortex_r8_virtual': [
    { name: 'cortex_r8_virtual', vendor: 'renode', socs: ['cortex_r8_virtual'] },
  ],
  'cv32a6': [
    { name: 'cv32a6_genesys_2', vendor: 'openhwgroup', socs: ['cv32a6'] },
  ],
  'cv64a6': [
    { name: 'cv64a6_genesys_2', vendor: 'openhwgroup', socs: ['cv64a6'] },
  ],
  'cy8c4147azq_t495': [
    { name: 'cy8cproto_041tp', vendor: 'infineon', socs: ['cy8c4147azq_t495'] },
  ],
  'cy8c4149azi_s598': [
    { name: 'cy8ckit_041s_max', vendor: 'infineon', socs: ['cy8c4149azi_s598'] },
  ],
  'cy8c6244lqi_s4d92': [
    { name: 'cy8ckit_062s4', vendor: 'infineon', socs: ['cy8c6244lqi_s4d92'] },
  ],
  'cy8c6247': [
    { name: 'cy8ckit_062_wifi_bt', vendor: 'cypress', socs: ['cy8c6247'] },
  ],
  'cy8c624abzi_s2d44': [
    { name: 'cy8ckit_062s2_ai', vendor: 'infineon', socs: ['cy8c624abzi_s2d44'] },
    { name: 'cy8cproto_062_4343w', vendor: 'infineon', socs: ['cy8c624abzi_s2d44'] },
  ],
  'cy8c6347': [
    { name: 'cy8ckit_062_ble', vendor: 'cypress', socs: ['cy8c6347'] },
  ],
  'cyble_416045_02': [
    { name: 'cy8cproto_063_ble', vendor: 'infineon', socs: ['cyble_416045_02'] },
  ],
  'cyclonev': [
    { name: 'cyclonev_socdk', vendor: 'intel', socs: ['cyclonev'] },
  ],
  'cyt4bf8cds': [
    { name: 'kit_t2g_b_h_lite', vendor: 'infineon', socs: ['cyt4bf8cds'] },
  ],
  'cyt4bfbche': [
    { name: 'kit_t2g_b_h_evk', vendor: 'infineon', socs: ['cyt4bfbche'] },
  ],
  'cyw20829b0lkml': [
    { name: 'cyw920829m2evk_02', vendor: 'infineon', socs: ['cyw20829b0lkml', 'cyw20829b1010', 'cyw20829b1340'] },
  ],
  'da14695': [
    { name: 'da14695_dk_usb', vendor: 'renesas', socs: ['da14695'] },
  ],
  'da14699': [
    { name: 'da1469x_dk_pro', vendor: 'renesas', socs: ['da14699'] },
  ],
  'dc233c': [
    { name: 'qemu_xtensa', vendor: 'cdns', socs: ['dc233c', 'sample_controller32'] },
  ],
  'designstart_fpga_cortex_m1': [
    { name: 'arty_a7', vendor: 'digilent', socs: ['designstart_fpga_cortex_m1', 'designstart_fpga_cortex_m3'] },
  ],
  'designstart_fpga_cortex_m3': [
    { name: 'scobc_a1', vendor: 'sc', socs: ['designstart_fpga_cortex_m3'] },
  ],
  'efinix_sapphire': [
    { name: 'titanium_ti60_f225', vendor: 'efinix', socs: ['efinix_sapphire'] },
  ],
  'efm32gg11b820f2048gl192': [
    { name: 'slstk3701a', vendor: 'silabs', socs: ['efm32gg11b820f2048gl192'] },
  ],
  'efm32gg11b820f2048gm64': [
    { name: 'slwrb4321a', vendor: 'silabs', socs: ['efm32gg11b820f2048gm64'] },
  ],
  'efm32gg12b810f1024gm64': [
    { name: 'sltb009a', vendor: 'silabs', socs: ['efm32gg12b810f1024gm64'] },
  ],
  'efm32hg322f64': [
    { name: 'slstk3400a', vendor: 'silabs', socs: ['efm32hg322f64'] },
  ],
  'efm32pg12b500f1024gl125': [
    { name: 'slstk3402a', vendor: 'silabs', socs: ['efm32pg12b500f1024gl125', 'efm32jg12b500f1024gl125'] },
  ],
  'efm32pg1b200f256gm48': [
    { name: 'slstk3401a', vendor: 'silabs', socs: ['efm32pg1b200f256gm48'] },
  ],
  'efm32pg23b310f512im48': [
    { name: 'pg23_pk2504a', vendor: 'silabs', socs: ['efm32pg23b310f512im48'] },
  ],
  'efm32pg26b500f3200im68': [
    { name: 'pg26_ek2711a', vendor: 'silabs', socs: ['efm32pg26b500f3200im68'] },
  ],
  'efm32pg28b310f1024im68': [
    { name: 'pg28_pk2506a', vendor: 'silabs', socs: ['efm32pg28b310f1024im68'] },
  ],
  'efm32tg840f32': [
    { name: 'efm32tg_stk3300', vendor: 'silabs', socs: ['efm32tg840f32'] },
  ],
  'efm32wg990f256': [
    { name: 'efm32wg_stk3800', vendor: 'silabs', socs: ['efm32wg990f256'] },
  ],
  'efr32bg13p632f512gm48': [
    { name: 'slwrb4104a', vendor: 'silabs', socs: ['efr32bg13p632f512gm48'] },
  ],
  'efr32bg22c224f512im40': [
    { name: 'bg22_ek4108a', vendor: 'silabs', socs: ['efr32bg22c224f512im40'] },
    { name: 'rm126x_dvk_rm1261', vendor: 'ezurio', socs: ['efr32bg22c224f512im40'] },
    { name: 'rm126x_dvk_rm1262', vendor: 'ezurio', socs: ['efr32bg22c224f512im40'] },
    { name: 'sltb010a', vendor: 'silabs', socs: ['efr32bg22c224f512im40'] },
  ],
  'efr32bg27c140f768im40': [
    { name: 'xg27_dk2602a', vendor: 'silabs', socs: ['efr32bg27c140f768im40'] },
  ],
  'efr32bg27c320f768gj39': [
    { name: 'bg27_rb4110b', vendor: 'silabs', socs: ['efr32bg27c320f768gj39'] },
    { name: 'bg27_rb4111b', vendor: 'silabs', socs: ['efr32bg27c320f768gj39'] },
  ],
  'efr32bg29b220f1024cj45': [
    { name: 'bg29_rb4420a', vendor: 'silabs', socs: ['efr32bg29b220f1024cj45'] },
  ],
  'efr32fg13p233f512gm48': [
    { name: 'slwrb4255a', vendor: 'silabs', socs: ['efr32fg13p233f512gm48'] },
  ],
  'efr32fg1p133f256gm48': [
    { name: 'slwrb4250b', vendor: 'silabs', socs: ['efr32fg1p133f256gm48'] },
  ],
  'efr32mg12p332f1024gl125': [
    { name: 'sltb004a', vendor: 'silabs', socs: ['efr32mg12p332f1024gl125'] },
  ],
  'efr32mg12p432f1024gl125': [
    { name: 'slwrb4161a', vendor: 'silabs', socs: ['efr32mg12p432f1024gl125'] },
  ],
  'efr32mg12p433f1024gm68': [
    { name: 'slwrb4170a', vendor: 'silabs', socs: ['efr32mg12p433f1024gm68'] },
  ],
  'efr32mg21a020f1024im32': [
    { name: 'slwrb4180a', vendor: 'silabs', socs: ['efr32mg21a020f1024im32'] },
    { name: 'slwrb4180b', vendor: 'silabs', socs: ['efr32mg21a020f1024im32'] },
  ],
  'efr32mg22c224f512im40': [
    { name: 'slwrb4182a', vendor: 'silabs', socs: ['efr32mg22c224f512im40'] },
  ],
  'efr32mg22e224f512im40': [
    { name: 'xg22_ek2710a', vendor: 'silabs', socs: ['efr32mg22e224f512im40'] },
  ],
  'efr32mg24b210f1536im48': [
    { name: 'xg24_ek2703a', vendor: 'silabs', socs: ['efr32mg24b210f1536im48'] },
    { name: 'xg24_rb4186c', vendor: 'silabs', socs: ['efr32mg24b210f1536im48'] },
  ],
  'efr32mg24b220f1536im48': [
    { name: 'xg24_rb4187c', vendor: 'silabs', socs: ['efr32mg24b220f1536im48'] },
    { name: 'xiao_mg24', vendor: 'seeed', socs: ['efr32mg24b220f1536im48'] },
  ],
  'efr32mg24b310f1536im48': [
    { name: 'xg24_dk2601b', vendor: 'silabs', socs: ['efr32mg24b310f1536im48'] },
  ],
  'efr32mg26b510f3200il136': [
    { name: 'xg26_rb4118a', vendor: 'silabs', socs: ['efr32mg26b510f3200il136'] },
  ],
  'efr32mg26b510f3200im48': [
    { name: 'xg26_ek2709a', vendor: 'silabs', socs: ['efr32mg26b510f3200im48'] },
  ],
  'efr32mg26b510f3200im68': [
    { name: 'xg26_rb4120a', vendor: 'silabs', socs: ['efr32mg26b510f3200im68'] },
  ],
  'efr32mg27c140f768im40': [
    { name: 'xg27_rb4194a', vendor: 'silabs', socs: ['efr32mg27c140f768im40'] },
  ],
  'efr32mg29b140f1024im40': [
    { name: 'xg29_rb4412a', vendor: 'silabs', socs: ['efr32mg29b140f1024im40'] },
  ],
  'efr32zg23b020f512im48': [
    { name: 'xg23_rb4210a', vendor: 'silabs', socs: ['efr32zg23b020f512im48'] },
  ],
  'efr32zg28b312f1024im48': [
    { name: 'xg28_ek2705a', vendor: 'silabs', socs: ['efr32zg28b312f1024im48'] },
  ],
  'efr32zg28b322f1024im68': [
    { name: 'xg28_rb4401c', vendor: 'silabs', socs: ['efr32zg28b322f1024im68'] },
  ],
  'elemrv_n': [
    { name: 'elemrv', vendor: 'aesc', socs: ['elemrv_n'] },
  ],
  'elkhart_lake': [
    { name: 'intel_ehl_crb', vendor: 'intel', socs: ['elkhart_lake'] },
  ],
  'em32f967': [
    { name: '32f967_dv', vendor: 'elan', socs: ['em32f967'] },
  ],
  'emsdp_em4': [
    { name: 'emsdp', vendor: 'snps', socs: ['emsdp_em4', 'emsdp_em5d', 'emsdp_em6', 'emsdp_em7d', 'emsdp_em7d_esp', 'emsdp_em9d', 'emsdp_em11d'] },
  ],
  'emsk_em7d': [
    { name: 'em_starterkit', vendor: 'snps', socs: ['emsk_em7d', 'emsk_em9d', 'emsk_em11d'] },
  ],
  'esp32': [
    { name: 'adafruit_feather_esp32', vendor: 'adafruit', socs: ['esp32'] },
    { name: 'can485dbv1', vendor: 'weact', socs: ['esp32'] },
    { name: 'doit_esp32_devkit_v1', vendor: 'others', socs: ['esp32'] },
    { name: 'esp_wrover_kit', vendor: 'espressif', socs: ['esp32'] },
    { name: 'esp32_cam', vendor: 'aithinker', socs: ['esp32'] },
    { name: 'esp32_devkitc', vendor: 'espressif', socs: ['esp32'] },
    { name: 'esp32_ethernet_kit', vendor: 'espressif', socs: ['esp32'] },
    { name: 'heltec_wifi_lora32_v2', vendor: 'heltec', socs: ['esp32'] },
    { name: 'inkplate_6color', vendor: 'solderedelectronics', socs: ['esp32'] },
    { name: 'kincony_kc868_a32', vendor: 'kincony', socs: ['esp32'] },
    { name: 'lolin32_lite', vendor: 'wemos', socs: ['esp32'] },
    { name: 'm5stack_atom_lite', vendor: 'm5stack', socs: ['esp32'] },
    { name: 'm5stack_core2', vendor: 'm5stack', socs: ['esp32'] },
    { name: 'm5stack_fire', vendor: 'm5stack', socs: ['esp32'] },
    { name: 'm5stickc_plus', vendor: 'm5stack', socs: ['esp32'] },
    { name: 'odroid_go', vendor: 'hardkernel', socs: ['esp32'] },
    { name: 'olimex_esp32_evb', vendor: 'olimex', socs: ['esp32'] },
    { name: 'ttgo_lora32', vendor: 'lilygo', socs: ['esp32'] },
    { name: 'ttgo_t7v1_5', vendor: 'lilygo', socs: ['esp32'] },
    { name: 'ttgo_tbeam', vendor: 'lilygo', socs: ['esp32'] },
    { name: 'yd_esp32', vendor: 'vcc-gnd', socs: ['esp32'] },
  ],
  'esp32c2': [
    { name: 'esp8684_devkitm', vendor: 'espressif', socs: ['esp32c2'] },
  ],
  'esp32c3': [
    { name: 'beetle_esp32c3', vendor: 'dfrobot', socs: ['esp32c3'] },
    { name: 'esp32c3_042_oled', vendor: '01space', socs: ['esp32c3'] },
    { name: 'esp32c3_devkitc', vendor: 'espressif', socs: ['esp32c3'] },
    { name: 'esp32c3_devkitm', vendor: 'espressif', socs: ['esp32c3'] },
    { name: 'esp32c3_lckfb', vendor: 'others', socs: ['esp32c3'] },
    { name: 'esp32c3_luatos_core', vendor: 'luatos', socs: ['esp32c3'] },
    { name: 'esp32c3_rust', vendor: 'espressif', socs: ['esp32c3'] },
    { name: 'esp32c3_supermini', vendor: 'others', socs: ['esp32c3'] },
    { name: 'glyph_c3', vendor: 'pcbcupid', socs: ['esp32c3'] },
    { name: 'icev_wireless', vendor: 'others', socs: ['esp32c3'] },
    { name: 'stamp_c3', vendor: 'm5stack', socs: ['esp32c3'] },
    { name: 'ttgo_t8c3', vendor: 'lilygo', socs: ['esp32c3'] },
    { name: 'ttgo_toiplus', vendor: 'lilygo', socs: ['esp32c3'] },
    { name: 'we_orthosie1ev', vendor: 'we', socs: ['esp32c3'] },
    { name: 'weact_esp32c3_mini', vendor: 'weact', socs: ['esp32c3'] },
    { name: 'xiao_esp32c3', vendor: 'seeed', socs: ['esp32c3'] },
  ],
  'esp32c5': [
    { name: 'esp32c5_devkitc', vendor: 'espressif', socs: ['esp32c5'] },
  ],
  'esp32c6': [
    { name: 'esp32c6_devkitc', vendor: 'espressif', socs: ['esp32c6'] },
    { name: 'glyph_c6', vendor: 'pcbcupid', socs: ['esp32c6'] },
    { name: 'm5stack_nanoc6', vendor: 'm5stack', socs: ['esp32c6'] },
    { name: 'weact_esp32c6_mini', vendor: 'weact', socs: ['esp32c6'] },
    { name: 'xiao_esp32c6', vendor: 'seeed', socs: ['esp32c6'] },
  ],
  'esp32h2': [
    { name: 'esp32h2_devkitm', vendor: 'espressif', socs: ['esp32h2'] },
    { name: 'glyph_h2', vendor: 'pcbcupid', socs: ['esp32h2'] },
  ],
  'esp32s2': [
    { name: 'adafruit_feather_esp32s2', vendor: 'adafruit', socs: ['esp32s2'] },
    { name: 'adafruit_feather_esp32s2_tft', vendor: 'adafruit', socs: ['esp32s2'] },
    { name: 'adafruit_feather_esp32s2_tft_reverse', vendor: 'adafruit', socs: ['esp32s2'] },
    { name: 'esp32s2_devkitc', vendor: 'espressif', socs: ['esp32s2'] },
    { name: 'esp32s2_franzininho', vendor: 'franzininho', socs: ['esp32s2'] },
    { name: 'esp32s2_lolin_mini', vendor: 'wemos', socs: ['esp32s2'] },
    { name: 'esp32s2_saola', vendor: 'espressif', socs: ['esp32s2'] },
  ],
  'esp32s3': [
    { name: 'adafruit_feather_esp32s3', vendor: 'adafruit', socs: ['esp32s3'] },
    { name: 'adafruit_feather_esp32s3_tft', vendor: 'adafruit', socs: ['esp32s3'] },
    { name: 'adafruit_feather_esp32s3_tft_reverse', vendor: 'adafruit', socs: ['esp32s3'] },
    { name: 'adafruit_qt_py_esp32s3', vendor: 'adafruit', socs: ['esp32s3'] },
    { name: 'dnesp32s3b', vendor: 'alientek', socs: ['esp32s3'] },
    { name: 'esp_threadbr', vendor: 'espressif', socs: ['esp32s3'] },
    { name: 'esp32s3_devkitc', vendor: 'espressif', socs: ['esp32s3'] },
    { name: 'esp32s3_eye', vendor: 'espressif', socs: ['esp32s3'] },
    { name: 'esp32s3_geek', vendor: 'waveshare', socs: ['esp32s3'] },
    { name: 'esp32s3_luatos_core', vendor: 'luatos', socs: ['esp32s3'] },
    { name: 'esp32s3_matrix', vendor: 'waveshare', socs: ['esp32s3'] },
    { name: 'esp32s3_rlcd_4_2', vendor: 'waveshare', socs: ['esp32s3'] },
    { name: 'esp32s3_touch_lcd_1_28', vendor: 'waveshare', socs: ['esp32s3'] },
    { name: 'heltec_wifi_lora32_v3', vendor: 'heltec', socs: ['esp32s3'] },
    { name: 'heltec_wireless_stick_lite_v3', vendor: 'heltec', socs: ['esp32s3'] },
    { name: 'heltec_wireless_tracker', vendor: 'heltec', socs: ['esp32s3'] },
    { name: 'm5stack_atoms3', vendor: 'm5stack', socs: ['esp32s3'] },
    { name: 'm5stack_atoms3_lite', vendor: 'm5stack', socs: ['esp32s3'] },
    { name: 'm5stack_cores3', vendor: 'm5stack', socs: ['esp32s3'] },
    { name: 'm5stack_stamps3', vendor: 'm5stack', socs: ['esp32s3'] },
    { name: 'rak3112', vendor: 'rakwireless', socs: ['esp32s3'] },
    { name: 'reterminal_e1002', vendor: 'seeed', socs: ['esp32s3'] },
    { name: 'tdongle_s3', vendor: 'lilygo', socs: ['esp32s3'] },
    { name: 'ttgo_t8s3', vendor: 'lilygo', socs: ['esp32s3'] },
    { name: 'twatch_s3', vendor: 'lilygo', socs: ['esp32s3'] },
    { name: 'uedx24320028e_wb_a', vendor: 'viewe', socs: ['esp32s3'] },
    { name: 'walter', vendor: 'dptechnics', socs: ['esp32s3'] },
    { name: 'weact_esp32s3_b', vendor: 'weact', socs: ['esp32s3'] },
    { name: 'weact_esp32s3_mini', vendor: 'weact', socs: ['esp32s3'] },
    { name: 'xiao_esp32s3', vendor: 'seeed', socs: ['esp32s3'] },
  ],
  'et171': [
    { name: 'egis_et171', vendor: 'egis', socs: ['et171'] },
  ],
  'fe310_g000': [
    { name: 'hifive1', vendor: 'sifive', socs: ['fe310_g000'] },
  ],
  'fe310_g002': [
    { name: 'hifive1_revb', vendor: 'sifive', socs: ['fe310_g002'] },
    { name: 'qemu_riscv32_xip', vendor: 'qemu', socs: ['fe310_g002'] },
    { name: 'sparkfun_red_v_things_plus', vendor: 'sparkfun', socs: ['fe310_g002'] },
  ],
  'ft9001': [
    { name: 'ft9001_eval', vendor: 'focaltech', socs: ['ft9001'] },
  ],
  'fu540': [
    { name: 'hifive_unleashed', vendor: 'sifive', socs: ['fu540'] },
  ],
  'fu740': [
    { name: 'hifive_unmatched', vendor: 'sifive', socs: ['fu740'] },
  ],
  'fvp_aemv8r_aarch64': [
    { name: 'fvp_baser_aemv8r', vendor: 'arm', socs: ['fvp_aemv8r_aarch64', 'fvp_aemv8r_aarch32'] },
  ],
  'gd32a503': [
    { name: 'gd32a503v_eval', vendor: 'gd', socs: ['gd32a503'] },
  ],
  'gd32e103': [
    { name: 'gd32e103v_eval', vendor: 'gd', socs: ['gd32e103'] },
  ],
  'gd32e507': [
    { name: 'gd32e507v_start', vendor: 'gd', socs: ['gd32e507'] },
    { name: 'gd32e507z_eval', vendor: 'gd', socs: ['gd32e507'] },
  ],
  'gd32f350': [
    { name: 'gd32f350r_eval', vendor: 'gd', socs: ['gd32f350'] },
  ],
  'gd32f403': [
    { name: 'gd32f403z_eval', vendor: 'gd', socs: ['gd32f403'] },
  ],
  'gd32f407': [
    { name: 'gd32f407v_start', vendor: 'gd', socs: ['gd32f407'] },
  ],
  'gd32f450': [
    { name: 'gd32f450i_eval', vendor: 'gd', socs: ['gd32f450'] },
    { name: 'gd32f450v_start', vendor: 'gd', socs: ['gd32f450'] },
    { name: 'gd32f450z_eval', vendor: 'gd', socs: ['gd32f450'] },
  ],
  'gd32f470': [
    { name: 'gd32f470i_eval', vendor: 'gd', socs: ['gd32f470'] },
  ],
  'gd32l233': [
    { name: 'gd32l233r_eval', vendor: 'gd', socs: ['gd32l233'] },
  ],
  'gd32vf103': [
    { name: 'gd32vf103c_starter', vendor: 'gd', socs: ['gd32vf103'] },
    { name: 'gd32vf103v_eval', vendor: 'gd', socs: ['gd32vf103'] },
    { name: 'longan_nano', vendor: 'sipeed', socs: ['gd32vf103'] },
  ],
  'gr716a': [
    { name: 'gr716a_mini', vendor: 'gaisler', socs: ['gr716a'] },
  ],
  'intel_ish_5_4_1': [
    { name: 'intel_ish_5_4_1', vendor: 'intel', socs: ['intel_ish_5_4_1'] },
  ],
  'intel_ish_5_6_0': [
    { name: 'intel_ish_5_6_0', vendor: 'intel', socs: ['intel_ish_5_6_0'] },
  ],
  'intel_ish_5_8_0': [
    { name: 'intel_ish_5_8_0', vendor: 'intel', socs: ['intel_ish_5_8_0'] },
  ],
  'it51526aw': [
    { name: 'it51xxx_evb', vendor: 'ite', socs: ['it51526aw'] },
  ],
  'it81302bx': [
    { name: 'it8xxx2_evb', vendor: 'ite', socs: ['it81302bx'] },
  ],
  'it82202ax': [
    { name: 'it82xx2_evb', vendor: 'ite', socs: ['it82202ax'] },
  ],
  'j721e': [
    { name: 'beaglebone_ai64', vendor: 'beagle', socs: ['j721e'] },
  ],
  'j722s': [
    { name: 'beagley_ai', vendor: 'beagle', socs: ['j722s'] },
  ],
  'jh7110': [
    { name: 'visionfive2', vendor: 'starfive', socs: ['jh7110'] },
  ],
  'k32l2b31a': [
    { name: 'frdm_k32l2b3', vendor: 'nxp', socs: ['k32l2b31a'] },
  ],
  'kb1062': [
    { name: 'kb1062_evb', vendor: 'ene', socs: ['kb1062'] },
  ],
  'kb1200': [
    { name: 'kb1200_evb', vendor: 'ene', socs: ['kb1200'] },
  ],
  'lakemont': [
    { name: 'qemu_x86_lakemont', vendor: 'intel', socs: ['lakemont'] },
  ],
  'leon3': [
    { name: 'generic_leon3', vendor: 'gaisler', socs: ['leon3'] },
    { name: 'qemu_leon3', vendor: 'gaisler', socs: ['leon3'] },
  ],
  'litex_vexriscv': [
    { name: 'litex_vexriscv', vendor: 'enjoydigital', socs: ['litex_vexriscv'] },
  ],
  'lpc11u67': [
    { name: 'faze', vendor: 'seagate', socs: ['lpc11u67'] },
  ],
  'lpc11u68': [
    { name: 'lpcxpresso11u68', vendor: 'nxp', socs: ['lpc11u68'] },
  ],
  'lpc51u68': [
    { name: 'lpcxpresso51u68', vendor: 'nxp', socs: ['lpc51u68'] },
  ],
  'lpc54114': [
    { name: 'lpcxpresso54114', vendor: 'nxp', socs: ['lpc54114'] },
  ],
  'lpc55s06': [
    { name: 'lpcxpresso55s06', vendor: 'nxp', socs: ['lpc55s06'] },
  ],
  'lpc55s16': [
    { name: 'lpcxpresso55s16', vendor: 'nxp', socs: ['lpc55s16'] },
  ],
  'lpc55s28': [
    { name: 'lpcxpresso55s28', vendor: 'nxp', socs: ['lpc55s28'] },
  ],
  'lpc55s36': [
    { name: 'lpcxpresso55s36', vendor: 'nxp', socs: ['lpc55s36'] },
  ],
  'lpc55s69': [
    { name: 'lpcxpresso55s69', vendor: 'nxp', socs: ['lpc55s69'] },
  ],
  'ls1046a': [
    { name: 'ls1046ardb', vendor: 'nxp', socs: ['ls1046a'] },
  ],
  'm2l31xxx': [
    { name: 'numaker_m2l31ki', vendor: 'nuvoton', socs: ['m2l31xxx'] },
  ],
  'm333xxx': [
    { name: 'numaker_m3334ki', vendor: 'nuvoton', socs: ['m333xxx'] },
  ],
  'm467': [
    { name: 'numaker_pfm_m467', vendor: 'nuvoton', socs: ['m467'] },
  ],
  'm487': [
    { name: 'numaker_pfm_m487', vendor: 'nuvoton', socs: ['m487'] },
  ],
  'm55m1xxx': [
    { name: 'numaker_gai_m55m1', vendor: 'nuvoton', socs: ['m55m1xxx'] },
    { name: 'numaker_m5531', vendor: 'nuvoton', socs: ['m55m1xxx'] },
    { name: 'numaker_m55m1', vendor: 'nuvoton', socs: ['m55m1xxx'] },
  ],
  'max32650': [
    { name: 'ad_swiot1l_sl', vendor: 'adi', socs: ['max32650'] },
    { name: 'max32650evkit', vendor: 'adi', socs: ['max32650'] },
    { name: 'max32650fthr', vendor: 'adi', socs: ['max32650'] },
  ],
  'max32655': [
    { name: 'max32655evkit', vendor: 'adi', socs: ['max32655'] },
    { name: 'max32655fthr', vendor: 'adi', socs: ['max32655'] },
  ],
  'max32657': [
    { name: 'max32657evkit', vendor: 'adi', socs: ['max32657'] },
  ],
  'max32658': [
    { name: 'max32658evkit', vendor: 'adi', socs: ['max32658'] },
  ],
  'max32660': [
    { name: 'max32660evsys', vendor: 'adi', socs: ['max32660'] },
  ],
  'max32662': [
    { name: 'max32662evkit', vendor: 'adi', socs: ['max32662'] },
  ],
  'max32666': [
    { name: 'max32666evkit', vendor: 'adi', socs: ['max32666'] },
    { name: 'max32666fthr', vendor: 'adi', socs: ['max32666'] },
  ],
  'max32670': [
    { name: 'max32670evkit', vendor: 'adi', socs: ['max32670'] },
  ],
  'max32672': [
    { name: 'max32672evkit', vendor: 'adi', socs: ['max32672'] },
    { name: 'max32672fthr', vendor: 'adi', socs: ['max32672'] },
  ],
  'max32675': [
    { name: 'max32675evkit', vendor: 'adi', socs: ['max32675'] },
  ],
  'max32680': [
    { name: 'max32680evkit', vendor: 'adi', socs: ['max32680'] },
  ],
  'max32690': [
    { name: 'adi_eval_adin2111d1z', vendor: 'adi', socs: ['max32690'] },
    { name: 'apard32690', vendor: 'adi', socs: ['max32690'] },
    { name: 'max32690evkit', vendor: 'adi', socs: ['max32690'] },
    { name: 'max32690fthr', vendor: 'adi', socs: ['max32690'] },
  ],
  'max78000': [
    { name: 'max78000evkit', vendor: 'adi', socs: ['max78000'] },
    { name: 'max78000fthr', vendor: 'adi', socs: ['max78000'] },
  ],
  'max78002': [
    { name: 'max78002evkit', vendor: 'adi', socs: ['max78002'] },
  ],
  'mcimx6x': [
    { name: 'udoo_neo_full', vendor: 'udoo', socs: ['mcimx6x'] },
  ],
  'mcimx7d': [
    { name: '96b_meerkat96', vendor: '96boards', socs: ['mcimx7d'] },
    { name: 'colibri_imx7d', vendor: 'toradex', socs: ['mcimx7d'] },
    { name: 'pico_pi', vendor: 'technexion', socs: ['mcimx7d'] },
    { name: 'warp7', vendor: 'element14', socs: ['mcimx7d'] },
  ],
  'mcxa153': [
    { name: 'frdm_mcxa153', vendor: 'nxp', socs: ['mcxa153'] },
  ],
  'mcxa156': [
    { name: 'frdm_mcxa156', vendor: 'nxp', socs: ['mcxa156'] },
  ],
  'mcxa266': [
    { name: 'frdm_mcxa266', vendor: 'nxp', socs: ['mcxa266'] },
  ],
  'mcxa344': [
    { name: 'frdm_mcxa344', vendor: 'nxp', socs: ['mcxa344'] },
  ],
  'mcxa346': [
    { name: 'frdm_mcxa346', vendor: 'nxp', socs: ['mcxa346'] },
  ],
  'mcxa366': [
    { name: 'frdm_mcxa366', vendor: 'nxp', socs: ['mcxa366'] },
  ],
  'mcxa577': [
    { name: 'frdm_mcxa577', vendor: 'nxp', socs: ['mcxa577'] },
  ],
  'mcxc242': [
    { name: 'frdm_mcxc242', vendor: 'nxp', socs: ['mcxc242'] },
  ],
  'mcxc444': [
    { name: 'frdm_mcxc444', vendor: 'nxp', socs: ['mcxc444'] },
  ],
  'mcxe247': [
    { name: 'frdm_mcxe247', vendor: 'nxp', socs: ['mcxe247'] },
  ],
  'mcxe31b': [
    { name: 'frdm_mcxe31b', vendor: 'nxp', socs: ['mcxe31b'] },
  ],
  'mcxl255': [
    { name: 'frdm_mcxl255', vendor: 'nxp', socs: ['mcxl255'] },
  ],
  'mcxn236': [
    { name: 'frdm_mcxn236', vendor: 'nxp', socs: ['mcxn236'] },
  ],
  'mcxn547': [
    { name: 'mcx_n5xx_evk', vendor: 'nxp', socs: ['mcxn547'] },
  ],
  'mcxn947': [
    { name: 'frdm_mcxn947', vendor: 'nxp', socs: ['mcxn947'] },
    { name: 'mcx_n9xx_evk', vendor: 'nxp', socs: ['mcxn947'] },
  ],
  'mcxw236': [
    { name: 'frdm_mcxw23', vendor: 'nxp', socs: ['mcxw236'] },
    { name: 'mcxw23_evk', vendor: 'nxp', socs: ['mcxw236'] },
  ],
  'mcxw70ac': [
    { name: 'frdm_mcxw70', vendor: 'nxp', socs: ['mcxw70ac'] },
  ],
  'mcxw716c': [
    { name: 'frdm_mcxw71', vendor: 'nxp', socs: ['mcxw716c'] },
    { name: 'ubx_evkninab5', vendor: 'u-blox', socs: ['mcxw716c'] },
  ],
  'mcxw727c': [
    { name: 'frdm_mcxw72', vendor: 'nxp', socs: ['mcxw727c'] },
    { name: 'mcxw72_evk', vendor: 'nxp', socs: ['mcxw727c'] },
  ],
  'mec1501_hsz': [
    { name: 'mec1501modular_assy6885', vendor: 'microchip', socs: ['mec1501_hsz'] },
    { name: 'mec15xxevb_assy6853', vendor: 'microchip', socs: ['mec1501_hsz'] },
  ],
  'mec1653b_nsz': [
    { name: 'mec_assy6941', vendor: 'microchip', socs: ['mec1653b_nsz', 'mec1743_qlj', 'mec1743_qsz', 'mec1753_qlj', 'mec1753_qsz'] },
  ],
  'mec172x_nsz': [
    { name: 'mec172xevb_assy6906', vendor: 'microchip', socs: ['mec172x_nsz'] },
    { name: 'mec172xmodular_assy6930', vendor: 'microchip', socs: ['mec172x_nsz'] },
  ],
  'mgm240pb22vna': [
    { name: 'xgm240_rb4316a', vendor: 'silabs', socs: ['mgm240pb22vna'] },
  ],
  'mgm240pb32vna': [
    { name: 'sparkfun_thing_plus_matter_mgm240p', vendor: 'sparkfun', socs: ['mgm240pb32vna'] },
    { name: 'xgm240_rb4317a', vendor: 'silabs', socs: ['mgm240pb32vna'] },
  ],
  'mgm240sd22vna': [
    { name: 'arduino_nano_matter', vendor: 'arduino', socs: ['mgm240sd22vna'] },
  ],
  'mgm260pd22vna': [
    { name: 'mgm260p_rb4350a', vendor: 'silabs', socs: ['mgm260pd22vna'] },
  ],
  'mgm260pd32vna': [
    { name: 'mgm260p_ek2713a', vendor: 'silabs', socs: ['mgm260pd32vna'] },
  ],
  'mimx8ml8': [
    { name: 'imx8mp_evk', vendor: 'nxp', socs: ['mimx8ml8'] },
    { name: 'imx8mp_var_dart', vendor: 'variscite', socs: ['mimx8ml8'] },
    { name: 'imx8mp_var_som', vendor: 'variscite', socs: ['mimx8ml8'] },
    { name: 'phyboard_pollux', vendor: 'phytec', socs: ['mimx8ml8'] },
    { name: 'verdin_imx8mp', vendor: 'toradex', socs: ['mimx8ml8'] },
  ],
  'mimx8mm6': [
    { name: 'imx8mm_evk', vendor: 'nxp', socs: ['mimx8mm6'] },
    { name: 'phyboard_polis', vendor: 'phytec', socs: ['mimx8mm6'] },
    { name: 'verdin_imx8mm', vendor: 'toradex', socs: ['mimx8mm6'] },
  ],
  'mimx8mn6': [
    { name: 'imx8mn_evk', vendor: 'nxp', socs: ['mimx8mn6'] },
  ],
  'mimx8mq6': [
    { name: 'imx8mq_evk', vendor: 'nxp', socs: ['mimx8mq6'] },
  ],
  'mimx8qm6': [
    { name: 'imx8qm_mek', vendor: 'nxp', socs: ['mimx8qm6'] },
  ],
  'mimx8qx6': [
    { name: 'imx8qxp_mek', vendor: 'nxp', socs: ['mimx8qx6'] },
  ],
  'mimx8ud7': [
    { name: 'imx8ulp_evk', vendor: 'nxp', socs: ['mimx8ud7'] },
  ],
  'mimx9111': [
    { name: 'imx91_qsb', vendor: 'nxp', socs: ['mimx9111'] },
  ],
  'mimx9131': [
    { name: 'frdm_imx91', vendor: 'nxp', socs: ['mimx9131'] },
    { name: 'imx91_evk', vendor: 'nxp', socs: ['mimx9131'] },
  ],
  'mimx9352': [
    { name: 'frdm_imx93', vendor: 'nxp', socs: ['mimx9352'] },
    { name: 'imx93_evk', vendor: 'nxp', socs: ['mimx9352'] },
    { name: 'imx93_var_dart', vendor: 'variscite', socs: ['mimx9352'] },
    { name: 'imx93_var_som', vendor: 'variscite', socs: ['mimx9352'] },
    { name: 'phyboard_nash', vendor: 'phytec', socs: ['mimx9352'] },
  ],
  'mimx94398': [
    { name: 'imx943_evk', vendor: 'nxp', socs: ['mimx94398'] },
  ],
  'mimx9596': [
    { name: 'imx95_evk', vendor: 'nxp', socs: ['mimx9596'] },
    { name: 'imx95_evk_15x15', vendor: 'nxp', socs: ['mimx9596'] },
  ],
  'mimxrt1011': [
    { name: 'mimxrt1010_evk', vendor: 'nxp', socs: ['mimxrt1011'] },
  ],
  'mimxrt1015': [
    { name: 'mimxrt1015_evk', vendor: 'nxp', socs: ['mimxrt1015'] },
  ],
  'mimxrt1021': [
    { name: 'mimxrt1020_evk', vendor: 'nxp', socs: ['mimxrt1021'] },
  ],
  'mimxrt1024': [
    { name: 'mimxrt1024_evk', vendor: 'nxp', socs: ['mimxrt1024'] },
  ],
  'mimxrt1042': [
    { name: 'mimxrt1040_evk', vendor: 'nxp', socs: ['mimxrt1042'] },
  ],
  'mimxrt1052': [
    { name: 'mimxrt1050_evk', vendor: 'nxp', socs: ['mimxrt1052'] },
    { name: 'mm_swiftio', vendor: 'madmachine', socs: ['mimxrt1052'] },
  ],
  'mimxrt1062': [
    { name: 'mimxrt1060_evk', vendor: 'nxp', socs: ['mimxrt1062'] },
    { name: 'mimxrt1062_fmurt6', vendor: 'nxp', socs: ['mimxrt1062'] },
    { name: 'mm_feather', vendor: 'madmachine', socs: ['mimxrt1062'] },
    { name: 'teensy40', vendor: 'pjrc', socs: ['mimxrt1062'] },
    { name: 'teensy41', vendor: 'pjrc', socs: ['mimxrt1062'] },
    { name: 'teensymm', vendor: 'pjrc', socs: ['mimxrt1062'] },
  ],
  'mimxrt1064': [
    { name: 'mimxrt1064_evk', vendor: 'nxp', socs: ['mimxrt1064'] },
  ],
  'mimxrt1166': [
    { name: 'mimxrt1160_evk', vendor: 'nxp', socs: ['mimxrt1166'] },
  ],
  'mimxrt1176': [
    { name: 'mimxrt1170_evk', vendor: 'nxp', socs: ['mimxrt1176'] },
    { name: 'phyboard_atlas', vendor: 'phytec', socs: ['mimxrt1176'] },
    { name: 'vmu_rt1170', vendor: 'nxp', socs: ['mimxrt1176'] },
  ],
  'mimxrt1186': [
    { name: 'frdm_imxrt1186', vendor: 'nxp', socs: ['mimxrt1186'] },
  ],
  'mimxrt1189': [
    { name: 'mimxrt1180_evk', vendor: 'nxp', socs: ['mimxrt1189'] },
  ],
  'mimxrt595s': [
    { name: 'mimxrt595_evk', vendor: 'nxp', socs: ['mimxrt595s'] },
  ],
  'mimxrt685s': [
    { name: 'mimxrt685_evk', vendor: 'nxp', socs: ['mimxrt685s'] },
  ],
  'mimxrt798s': [
    { name: 'mimxrt700_evk', vendor: 'nxp', socs: ['mimxrt798s'] },
  ],
  'miv': [
    { name: 'm2gl025_miv', vendor: 'microchip', socs: ['miv'] },
  ],
  'mk22f51212': [
    { name: 'frdm_k22f', vendor: 'nxp', socs: ['mk22f51212'] },
  ],
  'mk64f12': [
    { name: 'frdm_k64f', vendor: 'nxp', socs: ['mk64f12'] },
    { name: 'hexiwear', vendor: 'mikroe', socs: ['mk64f12', 'mkw40z4'] },
  ],
  'mk66f18': [
    { name: 'ip_k66f', vendor: 'segger', socs: ['mk66f18'] },
    { name: 'rddrone_fmuk66', vendor: 'nxp', socs: ['mk66f18'] },
  ],
  'mk82f25615': [
    { name: 'frdm_k82f', vendor: 'nxp', socs: ['mk82f25615'] },
  ],
  'mke15z7': [
    { name: 'frdm_ke15z', vendor: 'nxp', socs: ['mke15z7'] },
  ],
  'mke16z4': [
    { name: 'frdm_ke16z', vendor: 'nxp', socs: ['mke16z4'] },
  ],
  'mke17z7': [
    { name: 'frdm_ke17z', vendor: 'nxp', socs: ['mke17z7'] },
  ],
  'mke17z9': [
    { name: 'frdm_ke17z512', vendor: 'nxp', socs: ['mke17z9'] },
  ],
  'mke18f16': [
    { name: 'twr_ke18f', vendor: 'nxp', socs: ['mke18f16'] },
  ],
  'mkl25z4': [
    { name: 'frdm_kl25z', vendor: 'nxp', socs: ['mkl25z4'] },
  ],
  'mkv58f24': [
    { name: 'twr_kv58f220m', vendor: 'nxp', socs: ['mkv58f24'] },
  ],
  'mkw24d5': [
    { name: 'usb_kw24d512', vendor: 'nxp', socs: ['mkw24d5'] },
  ],
  'mkw41z4': [
    { name: 'frdm_kw41z', vendor: 'nxp', socs: ['mkw41z4'] },
  ],
  'msp432p401r': [
    { name: 'msp_exp432p401r_launchxl', vendor: 'ti', socs: ['msp432p401r'] },
  ],
  'mspm0g3507': [
    { name: 'lp_mspm0g3507', vendor: 'ti', socs: ['mspm0g3507'] },
  ],
  'mspm0g3519': [
    { name: 'lp_mspm0g3519', vendor: 'ti', socs: ['mspm0g3519'] },
  ],
  'mspm0l2228': [
    { name: 'lp_mspm0l2228', vendor: 'ti', socs: ['mspm0l2228'] },
  ],
  'mt8186': [
    { name: 'mt8186', vendor: 'mediatek', socs: ['mt8186'] },
  ],
  'mt8188': [
    { name: 'mt8188', vendor: 'mediatek', socs: ['mt8188'] },
  ],
  'mt8195': [
    { name: 'mt8195', vendor: 'mediatek', socs: ['mt8195'] },
  ],
  'mt8196': [
    { name: 'mt8196', vendor: 'mediatek', socs: ['mt8196'] },
  ],
  'mt8365': [
    { name: 'mt8365', vendor: 'mediatek', socs: ['mt8365'] },
  ],
  'musca_b1': [
    { name: 'v2m_musca_b1', vendor: 'arm', socs: ['musca_b1'] },
  ],
  'musca_s1': [
    { name: 'v2m_musca_s1', vendor: 'arm', socs: ['musca_s1'] },
  ],
  'myra': [
    { name: 'myra_sip_baseboard', vendor: 'antmicro', socs: ['myra'] },
  ],
  'native': [
    { name: 'native_sim', vendor: 'zephyr', socs: ['native'] },
    { name: 'nrf52_bsim', vendor: 'zephyr', socs: ['native'] },
  ],
  'neorv32': [
    { name: 'neorv32', vendor: 'others', socs: ['neorv32'] },
  ],
  'niosv_g': [
    { name: 'niosv_g', vendor: 'intel', socs: ['niosv_g'] },
  ],
  'niosv_m': [
    { name: 'niosv_m', vendor: 'intel', socs: ['niosv_m'] },
  ],
  'npck3m8k': [
    { name: 'npck3m8k_evb', vendor: 'nuvoton', socs: ['npck3m8k'] },
  ],
  'npcm400': [
    { name: 'npcm400_evb', vendor: 'nuvoton', socs: ['npcm400'] },
  ],
  'npcx4m8f': [
    { name: 'npcx4m8f_evb', vendor: 'nuvoton', socs: ['npcx4m8f'] },
  ],
  'npcx7m6fb': [
    { name: 'npcx7m6fb_evb', vendor: 'nuvoton', socs: ['npcx7m6fb'] },
  ],
  'npcx9m6f': [
    { name: 'npcx9m6f_evb', vendor: 'nuvoton', socs: ['npcx9m6f'] },
  ],
  'npcx9mfp': [
    { name: 'google_quincy', vendor: 'google', socs: ['npcx9mfp'] },
  ],
  'nrf51822': [
    { name: 'bbc_microbit', vendor: 'bbc', socs: ['nrf51822'] },
    { name: 'nrf51_ble400', vendor: 'waveshare', socs: ['nrf51822'] },
    { name: 'nrf51_blenano', vendor: 'particle', socs: ['nrf51822'] },
    { name: 'nrf51_vbluno51', vendor: 'vngiotlab', socs: ['nrf51822'] },
    { name: 'nrf51dk', vendor: 'nordic', socs: ['nrf51822'] },
    { name: 'nrf51dongle', vendor: 'nordic', socs: ['nrf51822'] },
    { name: 'qemu_cortex_m0', vendor: 'nordic', socs: ['nrf51822'] },
    { name: 'rm1xx_dvk', vendor: 'ezurio', socs: ['nrf51822'] },
  ],
  'nrf52805': [
    { name: 'nrf52dk', vendor: 'nordic', socs: ['nrf52805', 'nrf52810', 'nrf52832'] },
    { name: 'we_ophelia1ev', vendor: 'we', socs: ['nrf52805'] },
  ],
  'nrf52810': [
    { name: 'holyiot_21014', vendor: 'holyiot', socs: ['nrf52810'] },
    { name: 'ubx_bmd330eval', vendor: 'u-blox', socs: ['nrf52810'] },
  ],
  'nrf52811': [
    { name: 'ubx_bmd360eval', vendor: 'u-blox', socs: ['nrf52811'] },
  ],
  'nrf52820': [
    { name: 'nrf52833dk', vendor: 'nordic', socs: ['nrf52820', 'nrf52833'] },
    { name: 'pan1781_evb', vendor: 'panasonic', socs: ['nrf52820'] },
  ],
  'nrf52832': [
    { name: '96b_nitrogen', vendor: '96boards', socs: ['nrf52832'] },
    { name: 'acn52832', vendor: 'aconno', socs: ['nrf52832'] },
    { name: 'arduino_nicla_sense_me', vendor: 'arduino', socs: ['nrf52832'] },
    { name: 'bl652_dvk', vendor: 'ezurio', socs: ['nrf52832'] },
    { name: 'blueclover_plt_demo_v2', vendor: 'bcdevices', socs: ['nrf52832'] },
    { name: 'bytesensi_l', vendor: 'bytesatwork', socs: ['nrf52832'] },
    { name: 'decawave_dwm1001_dev', vendor: 'qorvo', socs: ['nrf52832'] },
    { name: 'ebyte_e73_tbb', vendor: 'ebyte', socs: ['nrf52832'] },
    { name: 'holyiot_yj16019', vendor: 'holyiot', socs: ['nrf52832'] },
    { name: 'holyiot_yj17095', vendor: 'holyiot', socs: ['nrf52832'] },
    { name: 'nrf52_adafruit_feather', vendor: 'adafruit', socs: ['nrf52832'] },
    { name: 'nrf52_blenano2', vendor: 'particle', socs: ['nrf52832'] },
    { name: 'nrf52_sparkfun', vendor: 'sparkfun', socs: ['nrf52832'] },
    { name: 'nrf52_vbluno52', vendor: 'vngiotlab', socs: ['nrf52832'] },
    { name: 'nrf52832_mdk', vendor: 'makerdiary', socs: ['nrf52832'] },
    { name: 'pinetime_devkit0', vendor: 'pine64', socs: ['nrf52832'] },
    { name: 'ruuvi_ruuvitag', vendor: 'ruuvi', socs: ['nrf52832'] },
    { name: 'thingy52', vendor: 'nordic', socs: ['nrf52832'] },
    { name: 'ubx_bmd300eval', vendor: 'u-blox', socs: ['nrf52832'] },
    { name: 'ubx_evkannab1', vendor: 'u-blox', socs: ['nrf52832'] },
    { name: 'ubx_evkninab1', vendor: 'u-blox', socs: ['nrf52832'] },
    { name: 'we_proteus2ev', vendor: 'we', socs: ['nrf52832'] },
  ],
  'nrf52833': [
    { name: 'bbc_microbit_v2', vendor: 'bbc', socs: ['nrf52833'] },
    { name: 'bl653_dvk', vendor: 'ezurio', socs: ['nrf52833'] },
    { name: 'decawave_dwm3001cdk', vendor: 'qorvo', socs: ['nrf52833'] },
    { name: 'pan1782_evb', vendor: 'panasonic', socs: ['nrf52833'] },
    { name: 'raytac_mdbt50q_db_33', vendor: 'raytac', socs: ['nrf52833'] },
    { name: 'ubx_evkninab4', vendor: 'u-blox', socs: ['nrf52833'] },
  ],
  'nrf52840': [
    { name: 'adafruit_feather_nrf52840', vendor: 'adafruit', socs: ['nrf52840'] },
    { name: 'adafruit_itsybitsy', vendor: 'adafruit', socs: ['nrf52840'] },
    { name: 'arduino_nano_33_ble', vendor: 'arduino', socs: ['nrf52840'] },
    { name: 'bl654_dvk', vendor: 'ezurio', socs: ['nrf52840'] },
    { name: 'bl654_sensor_board', vendor: 'ezurio', socs: ['nrf52840'] },
    { name: 'bl654_usb', vendor: 'ezurio', socs: ['nrf52840'] },
    { name: 'bt510', vendor: 'ezurio', socs: ['nrf52840'] },
    { name: 'bt610', vendor: 'ezurio', socs: ['nrf52840'] },
    { name: 'contextualelectronics_abc', vendor: 'contextualelectronics', socs: ['nrf52840'] },
    { name: 'croxel_cx1825', vendor: 'croxel', socs: ['nrf52840'] },
    { name: 'ctcc', vendor: 'ct', socs: ['nrf52840', 'nrf9161'] },
    { name: 'degu_evk', vendor: 'atmarktechno', socs: ['nrf52840'] },
    { name: 'mg100', vendor: 'ezurio', socs: ['nrf52840'] },
    { name: 'micromod', vendor: 'sparkfun', socs: ['nrf52840'] },
    { name: 'nrf21540dk', vendor: 'nordic', socs: ['nrf52840'] },
    { name: 'nrf52840_blip', vendor: 'electronut', socs: ['nrf52840'] },
    { name: 'nrf52840_mdk', vendor: 'makerdiary', socs: ['nrf52840'] },
    { name: 'nrf52840_mdk_usb_dongle', vendor: 'makerdiary', socs: ['nrf52840'] },
    { name: 'nrf52840_papyr', vendor: 'electronut', socs: ['nrf52840'] },
    { name: 'nrf52840dk', vendor: 'nordic', socs: ['nrf52840', 'nrf52811'] },
    { name: 'nrf52840dongle', vendor: 'nordic', socs: ['nrf52840'] },
    { name: 'p2d', vendor: 'coredevices', socs: ['nrf52840'] },
    { name: 'pan1770_evb', vendor: 'panasonic', socs: ['nrf52840'] },
    { name: 'pan1780_evb', vendor: 'panasonic', socs: ['nrf52840'] },
    { name: 'particle_argon', vendor: 'particle', socs: ['nrf52840'] },
    { name: 'particle_boron', vendor: 'particle', socs: ['nrf52840'] },
    { name: 'particle_xenon', vendor: 'particle', socs: ['nrf52840'] },
    { name: 'pinnacle_100_dvk', vendor: 'ezurio', socs: ['nrf52840'] },
    { name: 'promicro_nrf52840', vendor: 'others', socs: ['nrf52840'] },
    { name: 'quill_nrf52840_mesh', vendor: 'fobe', socs: ['nrf52840'] },
    { name: 'rak4631', vendor: 'rakwireless', socs: ['nrf52840'] },
    { name: 'rak5010', vendor: 'rakwireless', socs: ['nrf52840'] },
    { name: 'raytac_mdbt50q_cx_40_dongle', vendor: 'raytac', socs: ['nrf52840'] },
    { name: 'raytac_mdbt50q_db_40', vendor: 'raytac', socs: ['nrf52840'] },
    { name: 'reel_board', vendor: 'phytec', socs: ['nrf52840'] },
    { name: 'ubx_bmd340eval', vendor: 'u-blox', socs: ['nrf52840'] },
    { name: 'ubx_bmd345eval', vendor: 'u-blox', socs: ['nrf52840'] },
    { name: 'ubx_bmd380eval', vendor: 'u-blox', socs: ['nrf52840'] },
    { name: 'ubx_evkninab3', vendor: 'u-blox', socs: ['nrf52840'] },
    { name: 'we_proteus3ev', vendor: 'we', socs: ['nrf52840'] },
    { name: 'wio_wm1110_dev_kit', vendor: 'seeed', socs: ['nrf52840'] },
    { name: 'xiao_ble', vendor: 'seeed', socs: ['nrf52840'] },
  ],
  'nrf5340': [
    { name: 'bl5340_dvk', vendor: 'ezurio', socs: ['nrf5340'] },
    { name: 'nrf5340_audio_dk', vendor: 'nordic', socs: ['nrf5340'] },
    { name: 'nrf5340bsim', vendor: 'zephyr', socs: ['nrf5340'] },
    { name: 'nrf5340dk', vendor: 'nordic', socs: ['nrf5340'] },
    { name: 'nrf7002dk', vendor: 'nordic', socs: ['nrf5340'] },
    { name: 'pan1783_evb', vendor: 'panasonic', socs: ['nrf5340'] },
    { name: 'pan1783a_evb', vendor: 'panasonic', socs: ['nrf5340'] },
    { name: 'pan1783a_pa_evb', vendor: 'panasonic', socs: ['nrf5340'] },
    { name: 'raytac_an7002q_db', vendor: 'raytac', socs: ['nrf5340'] },
    { name: 'raytac_mdbt53_db_40', vendor: 'raytac', socs: ['nrf5340'] },
    { name: 'raytac_mdbt53v_db_40', vendor: 'raytac', socs: ['nrf5340'] },
    { name: 'thingy53', vendor: 'nordic', socs: ['nrf5340'] },
  ],
  'nrf54h20': [
    { name: 'nrf54h20dk', vendor: 'nordic', socs: ['nrf54h20'] },
  ],
  'nrf54l05': [
    { name: 'nrf54l15dk', vendor: 'nordic', socs: ['nrf54l05', 'nrf54l10', 'nrf54l15'] },
  ],
  'nrf54l10': [
    { name: 'bl54l15_dvk', vendor: 'ezurio', socs: ['nrf54l10', 'nrf54l15'] },
  ],
  'nrf54l15': [
    { name: 'bl54l15u_dvk', vendor: 'ezurio', socs: ['nrf54l15'] },
    { name: 'holyiot_25008', vendor: 'holyiot', socs: ['nrf54l15'] },
    { name: 'nrf54l15bsim', vendor: 'zephyr', socs: ['nrf54l15'] },
    { name: 'nrf54l15tag', vendor: 'nordic', socs: ['nrf54l15'] },
    { name: 'ophelia4ev', vendor: 'we', socs: ['nrf54l15'] },
    { name: 'panb611evb', vendor: 'panasonic', socs: ['nrf54l15'] },
    { name: 'raytac_an54lq_db_15', vendor: 'raytac', socs: ['nrf54l15'] },
    { name: 'xiao_nrf54l15', vendor: 'seeed', socs: ['nrf54l15'] },
  ],
  'nrf54lm20a': [
    { name: 'nrf54lm20bsim', vendor: 'zephyr', socs: ['nrf54lm20a'] },
    { name: 'nrf54lm20dk', vendor: 'nordic', socs: ['nrf54lm20a', 'nrf54lm20b'] },
  ],
  'nrf7120': [
    { name: 'nrf7120dk', vendor: 'nordic', socs: ['nrf7120'] },
  ],
  'nrf9131': [
    { name: 'nrf9131ek', vendor: 'nordic', socs: ['nrf9131'] },
  ],
  'nrf9151': [
    { name: 'nrf9151dk', vendor: 'nordic', socs: ['nrf9151'] },
  ],
  'nrf9160': [
    { name: 'actinius_icarus', vendor: 'actinius', socs: ['nrf9160'] },
    { name: 'actinius_icarus_bee', vendor: 'actinius', socs: ['nrf9160'] },
    { name: 'actinius_icarus_som', vendor: 'actinius', socs: ['nrf9160'] },
    { name: 'actinius_icarus_som_dk', vendor: 'actinius', socs: ['nrf9160'] },
    { name: 'circuitdojo_feather', vendor: 'circuitdojo', socs: ['nrf9160'] },
    { name: 'innblue21', vendor: 'innblue', socs: ['nrf9160'] },
    { name: 'innblue22', vendor: 'innblue', socs: ['nrf9160'] },
    { name: 'nrf9160dk', vendor: 'nordic', socs: ['nrf9160', 'nrf52840'] },
    { name: 'octopus_io_board', vendor: 'norik', socs: ['nrf9160'] },
    { name: 'octopus_som', vendor: 'norik', socs: ['nrf9160'] },
    { name: 'sparkfun_thing_plus', vendor: 'sparkfun', socs: ['nrf9160'] },
  ],
  'nrf9161': [
    { name: 'nrf9161dk', vendor: 'nordic', socs: ['nrf9161'] },
  ],
  'nrf9280': [
    { name: 'nrf9280pdk', vendor: 'nordic', socs: ['nrf9280'] },
  ],
  'nsim_em': [
    { name: 'nsim', vendor: 'snps', socs: ['nsim_em', 'nsim_em7d_v22', 'nsim_em11d', 'nsim_hs', 'nsim_hs5x', 'nsim_hs6x', 'nsim_sem', 'nsim_vpx5'] },
  ],
  'openisa_rv32m1': [
    { name: 'rv32m1_vega', vendor: 'openisa', socs: ['openisa_rv32m1'] },
  ],
  'opentitan': [
    { name: 'opentitan_earlgrey', vendor: 'lowrisc', socs: ['opentitan'] },
  ],
  'osd32mp15x': [
    { name: 'osd32mp1_brk', vendor: 'oct', socs: ['osd32mp15x'] },
  ],
  'panther_lake': [
    { name: 'intel_ptl_h_crb', vendor: 'intel', socs: ['panther_lake'] },
  ],
  'pic32cm5164jh01048': [
    { name: 'pic32cm_jh01_cnano', vendor: 'microchip', socs: ['pic32cm5164jh01048'] },
  ],
  'pic32cm5164jh01100': [
    { name: 'pic32cm_jh01_cpro', vendor: 'microchip', socs: ['pic32cm5164jh01100'] },
  ],
  'pic32cm6408pl10048': [
    { name: 'pic32cm_pl10_cnano', vendor: 'microchip', socs: ['pic32cm6408pl10048'] },
  ],
  'pic32cx1025sg41128': [
    { name: 'pic32cx_sg41_cult', vendor: 'microchip', socs: ['pic32cx1025sg41128'] },
  ],
  'pic32cx1025sg61128': [
    { name: 'pic32cx_sg61_cult', vendor: 'microchip', socs: ['pic32cx1025sg61128'] },
  ],
  'pic32cz8110ca80208': [
    { name: 'pic32cz_ca80_cult', vendor: 'microchip', socs: ['pic32cz8110ca80208'] },
  ],
  'pic32cz8110ca90208': [
    { name: 'pic32cz_ca90_cult', vendor: 'microchip', socs: ['pic32cz8110ca90208'] },
  ],
  'pic64gx1000': [
    { name: 'pic64gx_curiosity_kit', vendor: 'microchip', socs: ['pic64gx1000'] },
  ],
  'polarfire': [
    { name: 'beaglev_fire', vendor: 'beagle', socs: ['polarfire'] },
    { name: 'mpfs_icicle', vendor: 'microchip', socs: ['polarfire'] },
  ],
  'psc3m5fds2afq1': [
    { name: 'kit_psc3m5_evk', vendor: 'infineon', socs: ['psc3m5fds2afq1'] },
  ],
  'pse846gps2dbzc4a': [
    { name: 'kit_pse84_ai', vendor: 'infineon', socs: ['pse846gps2dbzc4a'] },
    { name: 'kit_pse84_eval', vendor: 'infineon', socs: ['pse846gps2dbzc4a'] },
  ],
  'qemu_arc_em': [
    { name: 'qemu_arc', vendor: 'qemu', socs: ['qemu_arc_em', 'qemu_arc_hs', 'qemu_arc_hs5x', 'qemu_arc_hs6x'] },
  ],
  'qemu_cortex_a53': [
    { name: 'qemu_cortex_a53', vendor: 'arm', socs: ['qemu_cortex_a53'] },
  ],
  'qemu_malta': [
    { name: 'qemu_malta', vendor: 'qemu', socs: ['qemu_malta'] },
  ],
  'qemu_or1k': [
    { name: 'qemu_or1k', vendor: 'qemu', socs: ['qemu_or1k'] },
  ],
  'qemu_virt_arm64': [
    { name: 'qemu_kvm_arm64', vendor: 'arm', socs: ['qemu_virt_arm64'] },
  ],
  'qemu_virt_riscv32': [
    { name: 'qemu_riscv32', vendor: 'qemu', socs: ['qemu_virt_riscv32'] },
  ],
  'qemu_virt_riscv32e': [
    { name: 'qemu_riscv32e', vendor: 'qemu', socs: ['qemu_virt_riscv32e'] },
  ],
  'qemu_virt_riscv64': [
    { name: 'qemu_riscv64', vendor: 'qemu', socs: ['qemu_virt_riscv64'] },
  ],
  'qnxhv_vm': [
    { name: 'qnxhv_vm', vendor: 'blackberry', socs: ['qnxhv_vm'] },
  ],
  'quicklogic_eos_s3': [
    { name: 'qomu', vendor: 'quicklogic', socs: ['quicklogic_eos_s3'] },
    { name: 'quick_feather', vendor: 'quicklogic', socs: ['quicklogic_eos_s3'] },
  ],
  'r5f51308axfp': [
    { name: 'rsk_rx130', vendor: 'renesas', socs: ['r5f51308axfp'] },
  ],
  'r5f51406bdfn': [
    { name: 'rsk_rx140', vendor: 'renesas', socs: ['r5f51406bdfn'] },
  ],
  'r5f51406bgfn': [
    { name: 'fpb_rx140', vendor: 'renesas', socs: ['r5f51406bgfn'] },
  ],
  'r5f514t5amfm': [
    { name: 'fpb_rx14t', vendor: 'renesas', socs: ['r5f514t5amfm'] },
    { name: 'mcb_rx14t', vendor: 'renesas', socs: ['r5f514t5amfm'] },
  ],
  'r5f52618bgfp': [
    { name: 'ek_rx261', vendor: 'renesas', socs: ['r5f52618bgfp'] },
    { name: 'fpb_rx261', vendor: 'renesas', socs: ['r5f52618bgfp'] },
  ],
  'r5f526tfddfp': [
    { name: 'mcb_rx26t', vendor: 'renesas', socs: ['r5f526tfddfp'] },
  ],
  'r5f562n8': [
    { name: 'qemu_rx', vendor: 'renesas', socs: ['r5f562n8'] },
  ],
  'r7fa0e1073cfj': [
    { name: 'fpb_ra0e1', vendor: 'renesas', socs: ['r7fa0e1073cfj'] },
  ],
  'r7fa2a1ab3cfm': [
    { name: 'ek_ra2a1', vendor: 'renesas', socs: ['r7fa2a1ab3cfm'] },
  ],
  'r7fa2l1abxxfp': [
    { name: 'ek_ra2l1', vendor: 'renesas', socs: ['r7fa2l1abxxfp'] },
    { name: 'rssk_ra2l1', vendor: 'renesas', socs: ['r7fa2l1abxxfp'] },
  ],
  'r7fa4c1bd3cfp': [
    { name: 'ek_ra4c1', vendor: 'renesas', socs: ['r7fa4c1bd3cfp'] },
  ],
  'r7fa4e10d2cfm': [
    { name: 'fpb_ra4e1', vendor: 'renesas', socs: ['r7fa4e10d2cfm'] },
  ],
  'r7fa4e10d2cne': [
    { name: 'voice_ra4e1', vendor: 'renesas', socs: ['r7fa4e10d2cne'] },
  ],
  'r7fa4e2b93cfm': [
    { name: 'ek_ra4e2', vendor: 'renesas', socs: ['r7fa4e2b93cfm'] },
  ],
  'r7fa4l1bd4cfp': [
    { name: 'ek_ra4l1', vendor: 'renesas', socs: ['r7fa4l1bd4cfp'] },
  ],
  'r7fa4m1ab3cfm': [
    { name: 'arduino_uno_r4', vendor: 'arduino', socs: ['r7fa4m1ab3cfm'] },
    { name: 'mikroe_clicker_ra4m1', vendor: 'mikroe', socs: ['r7fa4m1ab3cfm'] },
  ],
  'r7fa4m1ab3cfp': [
    { name: 'ek_ra4m1', vendor: 'renesas', socs: ['r7fa4m1ab3cfp'] },
  ],
  'r7fa4m1ab3cne': [
    { name: 'xiao_ra4m1', vendor: 'seeed', socs: ['r7fa4m1ab3cne'] },
  ],
  'r7fa4m2ad3cfp': [
    { name: 'ek_ra4m2', vendor: 'renesas', socs: ['r7fa4m2ad3cfp'] },
  ],
  'r7fa4m3af3cfb': [
    { name: 'ek_ra4m3', vendor: 'renesas', socs: ['r7fa4m3af3cfb'] },
  ],
  'r7fa4t1bb3cfm': [
    { name: 'mck_ra4t1', vendor: 'renesas', socs: ['r7fa4t1bb3cfm'] },
  ],
  'r7fa4w1ad2cng': [
    { name: 'ek_ra4w1', vendor: 'renesas', socs: ['r7fa4w1ad2cng'] },
  ],
  'r7fa6e10f2cfp': [
    { name: 'fpb_ra6e1', vendor: 'renesas', socs: ['r7fa6e10f2cfp'] },
  ],
  'r7fa6e2bb3cfm': [
    { name: 'ek_ra6e2', vendor: 'renesas', socs: ['r7fa6e2bb3cfm'] },
    { name: 'fpb_ra6e2', vendor: 'renesas', socs: ['r7fa6e2bb3cfm'] },
  ],
  'r7fa6m1ad3cfp': [
    { name: 'ek_ra6m1', vendor: 'renesas', socs: ['r7fa6m1ad3cfp'] },
  ],
  'r7fa6m2af3cfb': [
    { name: 'ek_ra6m2', vendor: 'renesas', socs: ['r7fa6m2af3cfb'] },
  ],
  'r7fa6m3ah3cfc': [
    { name: 'ek_ra6m3', vendor: 'renesas', socs: ['r7fa6m3ah3cfc'] },
  ],
  'r7fa6m4af3cfb': [
    { name: 'ek_ra6m4', vendor: 'renesas', socs: ['r7fa6m4af3cfb'] },
  ],
  'r7fa6m5bh3cfc': [
    { name: 'arduino_portenta_c33', vendor: 'arduino', socs: ['r7fa6m5bh3cfc'] },
    { name: 'ek_ra6m5', vendor: 'renesas', socs: ['r7fa6m5bh3cfc'] },
  ],
  'r7fa8d1bhecbd': [
    { name: 'aik_ra8d1', vendor: 'renesas', socs: ['r7fa8d1bhecbd'] },
    { name: 'cpkcor_ra8d1b', vendor: 'renesas', socs: ['r7fa8d1bhecbd'] },
    { name: 'ek_ra8d1', vendor: 'renesas', socs: ['r7fa8d1bhecbd'] },
    { name: 'ra8d1_vision_board', vendor: 'ruiside', socs: ['r7fa8d1bhecbd'] },
  ],
  'r7fa8e1afdcfb': [
    { name: 'fpb_ra8e1', vendor: 'renesas', socs: ['r7fa8e1afdcfb'] },
  ],
  'r7fa8m1ahecbd': [
    { name: 'ek_ra8m1', vendor: 'renesas', socs: ['r7fa8m1ahecbd'] },
  ],
  'r7fa8t1ahecbd': [
    { name: 'mck_ra8t1', vendor: 'renesas', socs: ['r7fa8t1ahecbd'] },
  ],
  'r7ka8d2kflcac': [
    { name: 'ek_ra8d2', vendor: 'renesas', socs: ['r7ka8d2kflcac'] },
  ],
  'r7ka8m2jflcac': [
    { name: 'ek_ra8m2', vendor: 'renesas', socs: ['r7ka8m2jflcac'] },
  ],
  'r7ka8p1kflcac': [
    { name: 'ek_ra8p1', vendor: 'renesas', socs: ['r7ka8p1kflcac'] },
  ],
  'r7ka8t2lflcac': [
    { name: 'ek_ra8t2', vendor: 'renesas', socs: ['r7ka8t2lflcac'] },
    { name: 'mck_ra8t2', vendor: 'renesas', socs: ['r7ka8t2lflcac'] },
  ],
  'r7s921053vcbg': [
    { name: 'rza2m_evk', vendor: 'renesas', socs: ['r7s921053vcbg'] },
  ],
  'r8a77951': [
    { name: 'rcar_h3ulcb', vendor: 'renesas', socs: ['r8a77951'] },
    { name: 'rcar_salvator_x', vendor: 'renesas', socs: ['r8a77951'] },
  ],
  'r8a77961': [
    { name: 'rcar_salvator_xs', vendor: 'renesas', socs: ['r8a77961'] },
  ],
  'r8a779f0': [
    { name: 'rcar_spider_s4', vendor: 'renesas', socs: ['r8a779f0'] },
  ],
  'r8a779g0': [
    { name: 'sparrowhawk_rcar_v4h', vendor: 'retronix', socs: ['r8a779g0'] },
  ],
  'r9a07g043u11gbg': [
    { name: 'rzg2ul_smarc', vendor: 'renesas', socs: ['r9a07g043u11gbg'] },
  ],
  'r9a07g044c22gbg': [
    { name: 'rzg2lc_smarc', vendor: 'renesas', socs: ['r9a07g044c22gbg'] },
  ],
  'r9a07g044l23gbg': [
    { name: 'rzg2l_smarc', vendor: 'renesas', socs: ['r9a07g044l23gbg'] },
  ],
  'r9a07g054l23gbg': [
    { name: 'rzv2l_smarc', vendor: 'renesas', socs: ['r9a07g054l23gbg'] },
  ],
  'r9a07g063u02gbg': [
    { name: 'rza3ul_smarc', vendor: 'renesas', socs: ['r9a07g063u02gbg'] },
  ],
  'r9a07g074m04gbg': [
    { name: 'rzt2l_rsk', vendor: 'renesas', socs: ['r9a07g074m04gbg'] },
  ],
  'r9a07g075m24gbg': [
    { name: 'rzt2m_rsk', vendor: 'renesas', socs: ['r9a07g075m24gbg'] },
  ],
  'r9a07g084m04gbg': [
    { name: 'rzn2l_rsk', vendor: 'renesas', socs: ['r9a07g084m04gbg'] },
  ],
  'r9a08g045s33gbg': [
    { name: 'rzg3s_smarc', vendor: 'renesas', socs: ['r9a08g045s33gbg'] },
  ],
  'r9a09g047e57gbg': [
    { name: 'rzg3e_smarc', vendor: 'renesas', socs: ['r9a09g047e57gbg'] },
  ],
  'r9a09g056n48gbg': [
    { name: 'rzv2n_evk', vendor: 'renesas', socs: ['r9a09g056n48gbg'] },
  ],
  'r9a09g057h44gbg': [
    { name: 'rzv2h_evk', vendor: 'renesas', socs: ['r9a09g057h44gbg'] },
  ],
  'r9a09g077m44gbg': [
    { name: 'rzt2h_evb', vendor: 'renesas', socs: ['r9a09g077m44gbg'] },
  ],
  'r9a09g087m44gbg': [
    { name: 'rzn2h_evb', vendor: 'renesas', socs: ['r9a09g087m44gbg'] },
  ],
  'raptor_lake': [
    { name: 'intel_btl_s_crb', vendor: 'intel', socs: ['raptor_lake'] },
    { name: 'intel_rpl_p_crb', vendor: 'intel', socs: ['raptor_lake'] },
    { name: 'intel_rpl_s_crb', vendor: 'intel', socs: ['raptor_lake'] },
  ],
  'riscv_virtual_renode': [
    { name: 'riscv32_virtual', vendor: 'renode', socs: ['riscv_virtual_renode'] },
  ],
  'rk3399': [
    { name: 'khadas_edgev', vendor: 'khadas', socs: ['rk3399'] },
  ],
  'rk3568': [
    { name: 'roc_rk3568_pc', vendor: 'firefly', socs: ['rk3568'] },
  ],
  'rk3588': [
    { name: 'orangepi_5_ultra_rk3588', vendor: 'xunlong', socs: ['rk3588'] },
    { name: 'roc_rk3588_pc', vendor: 'firefly', socs: ['rk3588'] },
  ],
  'rk3588s': [
    { name: 'khadas_edge2', vendor: 'khadas', socs: ['rk3588s'] },
  ],
  'rmx100': [
    { name: 'nsim_arc_v', vendor: 'snps', socs: ['rmx100', 'rhx100'] },
  ],
  'rp2040': [
    { name: 'adafruit_feather_adalogger_rp2040', vendor: 'adafruit', socs: ['rp2040'] },
    { name: 'adafruit_feather_canbus_rp2040', vendor: 'adafruit', socs: ['rp2040'] },
    { name: 'adafruit_feather_propmaker_rp2040', vendor: 'adafruit', socs: ['rp2040'] },
    { name: 'adafruit_feather_rfm95_rp2040', vendor: 'adafruit', socs: ['rp2040'] },
    { name: 'adafruit_feather_rp2040', vendor: 'adafruit', socs: ['rp2040'] },
    { name: 'adafruit_feather_scorpio_rp2040', vendor: 'adafruit', socs: ['rp2040'] },
    { name: 'adafruit_itsybitsy_rp2040', vendor: 'adafruit', socs: ['rp2040'] },
    { name: 'adafruit_kb2040', vendor: 'adafruit', socs: ['rp2040'] },
    { name: 'adafruit_macropad_rp2040', vendor: 'adafruit', socs: ['rp2040'] },
    { name: 'adafruit_metro_rp2040', vendor: 'adafruit', socs: ['rp2040'] },
    { name: 'adafruit_qt_py_rp2040', vendor: 'adafruit', socs: ['rp2040'] },
    { name: 'adafruit_trinkey_qt2040', vendor: 'adafruit', socs: ['rp2040'] },
    { name: 'beetle_rp2040', vendor: 'dfrobot', socs: ['rp2040'] },
    { name: 'canbed_rp2040', vendor: 'longan', socs: ['rp2040'] },
    { name: 'framework_laptop16_keyboard', vendor: 'framework', socs: ['rp2040'] },
    { name: 'framework_ledmatrix', vendor: 'framework', socs: ['rp2040'] },
    { name: 'maker_nano_rp2040', vendor: 'cytron', socs: ['rp2040'] },
    { name: 'maker_pi_rp2040', vendor: 'cytron', socs: ['rp2040'] },
    { name: 'maker_uno_rp2040', vendor: 'cytron', socs: ['rp2040'] },
    { name: 'pico_spe', vendor: 'kws', socs: ['rp2040'] },
    { name: 'rp2040_geek', vendor: 'waveshare', socs: ['rp2040'] },
    { name: 'rp2040_keyboard_3', vendor: 'waveshare', socs: ['rp2040'] },
    { name: 'rp2040_matrix', vendor: 'waveshare', socs: ['rp2040'] },
    { name: 'rp2040_plus', vendor: 'waveshare', socs: ['rp2040'] },
    { name: 'rp2040_zero', vendor: 'waveshare', socs: ['rp2040'] },
    { name: 'rpi_debug_probe', vendor: 'raspberrypi', socs: ['rp2040'] },
    { name: 'rpi_pico', vendor: 'raspberrypi', socs: ['rp2040'] },
    { name: 'shrike_lite', vendor: 'vicharak', socs: ['rp2040'] },
    { name: 'sparkfun_pro_micro_rp2040', vendor: 'sparkfun', socs: ['rp2040'] },
    { name: 'sparkfun_rp2040_mikrobus', vendor: 'sparkfun', socs: ['rp2040'] },
    { name: 'tiny2040', vendor: 'pimoroni', socs: ['rp2040'] },
    { name: 'w5500_evb_pico', vendor: 'wiznet', socs: ['rp2040'] },
    { name: 'xiao_rp2040', vendor: 'seeed', socs: ['rp2040'] },
  ],
  'rp2350a': [
    { name: 'beetle_rp2350', vendor: 'dfrobot', socs: ['rp2350a'] },
    { name: 'motion_2350_pro', vendor: 'cytron', socs: ['rp2350a'] },
    { name: 'pico2_spe', vendor: 'kws', socs: ['rp2350a'] },
    { name: 'rp2350_zero', vendor: 'waveshare', socs: ['rp2350a'] },
    { name: 'rpi_pico2', vendor: 'raspberrypi', socs: ['rp2350a'] },
    { name: 'w5500_evb_pico2', vendor: 'wiznet', socs: ['rp2350a'] },
    { name: 'xiao_rp2350', vendor: 'seeed', socs: ['rp2350a'] },
  ],
  'rp2350b': [
    { name: 'adafruit_metro_rp2350', vendor: 'adafruit', socs: ['rp2350b'] },
    { name: 'pico_plus2', vendor: 'pimoroni', socs: ['rp2350b'] },
    { name: 'rp2350b_core', vendor: 'weact', socs: ['rp2350b'] },
  ],
  'rtl8721dx': [
    { name: 'rtl872xda_evb', vendor: 'realtek', socs: ['rtl8721dx'] },
  ],
  'rtl8721f': [
    { name: 'rtl8721f_evb', vendor: 'realtek', socs: ['rtl8721f'] },
  ],
  'rtl872xd': [
    { name: 'rtl872xd_evb', vendor: 'realtek', socs: ['rtl872xd'] },
  ],
  'rtl8752hjl': [
    { name: 'rtl8752h_evb', vendor: 'realtek', socs: ['rtl8752hjl', 'rtl8752hmf', 'rtl8752hjf', 'rtl8752hkf'] },
  ],
  'rtl8762gru': [
    { name: 'rtl87x2g_evb_a', vendor: 'realtek', socs: ['rtl8762gru', 'rtl8762grh', 'rtl8762gku', 'rtl8762gkh'] },
  ],
  'rts5817': [
    { name: 'rts5817_maa_evb', vendor: 'realtek', socs: ['rts5817'] },
  ],
  'rts5912': [
    { name: 'rts5912_evb', vendor: 'realtek', socs: ['rts5912'] },
  ],
  'rw612': [
    { name: 'frdm_rw612', vendor: 'nxp', socs: ['rw612'] },
    { name: 'rd_rw612_bga', vendor: 'nxp', socs: ['rw612'] },
    { name: 'ubx_evk_iris_w1', vendor: 'u-blox', socs: ['rw612'] },
  ],
  's32k146': [
    { name: 'ucans32k1sic', vendor: 'nxp', socs: ['s32k146'] },
  ],
  's32k148': [
    { name: 's32k148_evb', vendor: 'nxp', socs: ['s32k148'] },
  ],
  's32k344': [
    { name: 'mr_canhubk3', vendor: 'nxp', socs: ['s32k344'] },
  ],
  's32k566': [
    { name: 's32k5xxcvb', vendor: 'nxp', socs: ['s32k566'] },
  ],
  's32z270': [
    { name: 's32z2xxdc2', vendor: 'nxp', socs: ['s32z270'] },
  ],
  's400': [
    { name: 'cdns_swerv', vendor: 'cdns', socs: ['s400', 's420'] },
  ],
  'sam3x8e': [
    { name: 'arduino_due', vendor: 'arduino', socs: ['sam3x8e'] },
  ],
  'sam4e16e': [
    { name: 'sam4e_xpro', vendor: 'atmel', socs: ['sam4e16e'] },
  ],
  'sam4lc4b': [
    { name: 'sam4l_wm400_cape', vendor: 'peregrine', socs: ['sam4lc4b'] },
  ],
  'sam4lc4c': [
    { name: 'sam4l_ek', vendor: 'atmel', socs: ['sam4lc4c'] },
  ],
  'sam4s16c': [
    { name: 'sam4s_xplained', vendor: 'atmel', socs: ['sam4s16c'] },
  ],
  'sama7d65': [
    { name: 'sama7d65_curiosity', vendor: 'microchip', socs: ['sama7d65'] },
  ],
  'sama7g54': [
    { name: 'sama7g54_ek', vendor: 'microchip', socs: ['sama7g54'] },
  ],
  'samc21n18a': [
    { name: 'samc21n_xpro', vendor: 'atmel', socs: ['samc21n18a'] },
  ],
  'samd20e16': [
    { name: 'ev11l78a', vendor: 'microchip', socs: ['samd20e16'] },
  ],
  'samd20j18': [
    { name: 'samd20_xpro', vendor: 'atmel', socs: ['samd20j18'] },
  ],
  'samd21e18a': [
    { name: 'adafruit_trinket_m0', vendor: 'adafruit', socs: ['samd21e18a'] },
    { name: 'serpente', vendor: 'others', socs: ['samd21e18a'] },
  ],
  'samd21g18a': [
    { name: 'adafruit_feather_m0_basic_proto', vendor: 'adafruit', socs: ['samd21g18a'] },
    { name: 'adafruit_feather_m0_lora', vendor: 'adafruit', socs: ['samd21g18a'] },
    { name: 'arduino_mkrzero', vendor: 'arduino', socs: ['samd21g18a'] },
    { name: 'arduino_nano_33_iot', vendor: 'arduino', socs: ['samd21g18a'] },
    { name: 'arduino_zero', vendor: 'arduino', socs: ['samd21g18a'] },
    { name: 'seeeduino_xiao', vendor: 'seeed', socs: ['samd21g18a'] },
    { name: 'sparkfun_samd21_breakout', vendor: 'sparkfun', socs: ['samd21g18a'] },
  ],
  'samd21j18a': [
    { name: 'samd21_xpro', vendor: 'atmel', socs: ['samd21j18a'] },
  ],
  'samd51g19a': [
    { name: 'adafruit_itsybitsy_m4_express', vendor: 'adafruit', socs: ['samd51g19a'] },
  ],
  'samd51j19a': [
    { name: 'adafruit_feather_m4_express', vendor: 'adafruit', socs: ['samd51j19a'] },
  ],
  'samd51p19a': [
    { name: 'wio_terminal', vendor: 'seeed', socs: ['samd51p19a'] },
  ],
  'samd51p20a': [
    { name: 'adafruit_grand_central_m4_express', vendor: 'adafruit', socs: ['samd51p20a'] },
  ],
  'same54p20a': [
    { name: 'same54_xpro', vendor: 'atmel', socs: ['same54p20a'] },
  ],
  'same70n20b': [
    { name: 'canbardo', vendor: 'others', socs: ['same70n20b'] },
  ],
  'same70q21': [
    { name: 'sam_e70_xplained', vendor: 'atmel', socs: ['same70q21', 'same70q21b'] },
  ],
  'same70q21b': [
    { name: 'robokit1', vendor: 'tdk', socs: ['same70q21b'] },
  ],
  'saml21j18b': [
    { name: 'saml21_xpro', vendor: 'atmel', socs: ['saml21j18b'] },
  ],
  'samr21g18a': [
    { name: 'samr21_xpro', vendor: 'atmel', socs: ['samr21g18a'] },
  ],
  'samr34j18b': [
    { name: 'samr34_xpro', vendor: 'atmel', socs: ['samr34j18b'] },
  ],
  'samv71q21': [
    { name: 'sam_v71_xult', vendor: 'atmel', socs: ['samv71q21', 'samv71q21b'] },
  ],
  'sf32lb525uc6': [
    { name: 'sf32lb52_devkit_lcd', vendor: 'sifli', socs: ['sf32lb525uc6'] },
  ],
  'sf32lb52jud6': [
    { name: 'pt2', vendor: 'coredevices', socs: ['sf32lb52jud6'] },
  ],
  'sim3u167': [
    { name: 'sgrm', vendor: 'gardena', socs: ['sim3u167'] },
    { name: 'sim3u1xx_dk', vendor: 'silabs', socs: ['sim3u167'] },
  ],
  'siwg917m111mgtba': [
    { name: 'siwx917_dk2605a', vendor: 'silabs', socs: ['siwg917m111mgtba'] },
    { name: 'siwx917_rb4338a', vendor: 'silabs', socs: ['siwg917m111mgtba'] },
    { name: 'siwx917_rb4342a', vendor: 'silabs', socs: ['siwg917m111mgtba'] },
  ],
  'sr100': [
    { name: 'sr100_rdk', vendor: 'syna', socs: ['sr100'] },
  ],
  'stm32c011xx': [
    { name: 'stm32c0116_dk', vendor: 'st', socs: ['stm32c011xx'] },
  ],
  'stm32c031xx': [
    { name: 'nucleo_c031c6', vendor: 'st', socs: ['stm32c031xx'] },
  ],
  'stm32c071xx': [
    { name: 'nucleo_c071rb', vendor: 'st', socs: ['stm32c071xx'] },
  ],
  'stm32c092xx': [
    { name: 'nucleo_c092rc', vendor: 'st', socs: ['stm32c092xx'] },
  ],
  'stm32c542xx': [
    { name: 'nucleo_c542rc', vendor: 'st', socs: ['stm32c542xx'] },
  ],
  'stm32c562xx': [
    { name: 'nucleo_c562re', vendor: 'st', socs: ['stm32c562xx'] },
  ],
  'stm32c5a3xx': [
    { name: 'nucleo_c5a3zg', vendor: 'st', socs: ['stm32c5a3xx'] },
  ],
  'stm32f030x6': [
    { name: 'stm32f030_demo', vendor: 'others', socs: ['stm32f030x6'] },
  ],
  'stm32f030x8': [
    { name: 'nucleo_f030r8', vendor: 'st', socs: ['stm32f030x8'] },
  ],
  'stm32f031x6': [
    { name: 'nucleo_f031k6', vendor: 'st', socs: ['stm32f031x6'] },
  ],
  'stm32f042x6': [
    { name: 'nucleo_f042k6', vendor: 'st', socs: ['stm32f042x6'] },
  ],
  'stm32f051x8': [
    { name: 'stm32f0_disco', vendor: 'st', socs: ['stm32f051x8'] },
  ],
  'stm32f070xb': [
    { name: 'legend', vendor: 'seagate', socs: ['stm32f070xb'] },
    { name: 'nucleo_f070rb', vendor: 'st', socs: ['stm32f070xb'] },
  ],
  'stm32f072xb': [
    { name: 'candlelight', vendor: 'others', socs: ['stm32f072xb'] },
    { name: 'mks_canable_v10', vendor: 'makerbase', socs: ['stm32f072xb'] },
    { name: 'nucleo_f072rb', vendor: 'st', socs: ['stm32f072xb'] },
    { name: 'stm32f072_eval', vendor: 'st', socs: ['stm32f072xb'] },
    { name: 'stm32f072b_disco', vendor: 'st', socs: ['stm32f072xb'] },
    { name: 'ucan', vendor: 'fysetc', socs: ['stm32f072xb'] },
  ],
  'stm32f091xc': [
    { name: 'nucleo_f091rc', vendor: 'st', socs: ['stm32f091xc'] },
  ],
  'stm32f100xb': [
    { name: 'stm32vl_disco', vendor: 'st', socs: ['stm32f100xb'] },
  ],
  'stm32f103xb': [
    { name: 'nucleo_f103rb', vendor: 'st', socs: ['stm32f103xb'] },
    { name: 'olimex_stm32_h103', vendor: 'olimex', socs: ['stm32f103xb'] },
    { name: 'olimexino_stm32', vendor: 'olimex', socs: ['stm32f103xb'] },
    { name: 'stm32_min_dev', vendor: 'others', socs: ['stm32f103xb'] },
  ],
  'stm32f103xe': [
    { name: 'stm32f103_mini', vendor: 'others', socs: ['stm32f103xe'] },
    { name: 'waveshare_open103z', vendor: 'waveshare', socs: ['stm32f103xe'] },
  ],
  'stm32f107xc': [
    { name: 'stm3210c_eval', vendor: 'st', socs: ['stm32f107xc'] },
  ],
  'stm32f207xx': [
    { name: 'nucleo_f207zg', vendor: 'st', socs: ['stm32f207xx'] },
  ],
  'stm32f302x8': [
    { name: 'nucleo_f302r8', vendor: 'st', socs: ['stm32f302x8'] },
  ],
  'stm32f302xc': [
    { name: 'stm32f3_seco_d23', vendor: 'seco', socs: ['stm32f302xc'] },
  ],
  'stm32f303x8': [
    { name: 'nucleo_f303k8', vendor: 'st', socs: ['stm32f303x8'] },
  ],
  'stm32f303xc': [
    { name: 'stm32f3_disco', vendor: 'st', socs: ['stm32f303xc'] },
  ],
  'stm32f303xe': [
    { name: 'nucleo_f303re', vendor: 'st', socs: ['stm32f303xe'] },
  ],
  'stm32f334x8': [
    { name: 'nucleo_f334r8', vendor: 'st', socs: ['stm32f334x8'] },
  ],
  'stm32f373xc': [
    { name: 'stm32373c_eval', vendor: 'st', socs: ['stm32f373xc'] },
  ],
  'stm32f401xc': [
    { name: 'blackpill_f401cc', vendor: 'weact', socs: ['stm32f401xc'] },
    { name: 'steval_fcu001v1', vendor: 'st', socs: ['stm32f401xc'] },
    { name: 'stm32f401_mini', vendor: 'others', socs: ['stm32f401xc'] },
  ],
  'stm32f401xd': [
    { name: 'crd40l50', vendor: 'cirrus', socs: ['stm32f401xd'] },
  ],
  'stm32f401xe': [
    { name: '96b_carbon', vendor: '96boards', socs: ['stm32f401xe', 'nrf51822'] },
    { name: 'blackpill_f401ce', vendor: 'weact', socs: ['stm32f401xe'] },
    { name: 'nucleo_f401re', vendor: 'st', socs: ['stm32f401xe'] },
  ],
  'stm32f405xx': [
    { name: 'adafruit_feather_stm32f405', vendor: 'adafruit', socs: ['stm32f405xx'] },
    { name: 'olimex_stm32_h405', vendor: 'olimex', socs: ['stm32f405xx'] },
    { name: 'olimex_stm32_p405', vendor: 'olimex', socs: ['stm32f405xx'] },
    { name: 'st25dv_mb1283_disco', vendor: 'st', socs: ['stm32f405xx'] },
    { name: 'weact_stm32f405_core', vendor: 'weact', socs: ['stm32f405xx'] },
  ],
  'stm32f407xx': [
    { name: 'black_f407ve', vendor: 'others', socs: ['stm32f407xx'] },
    { name: 'black_f407zg_pro', vendor: 'others', socs: ['stm32f407xx'] },
    { name: 'mikroe_clicker_2', vendor: 'mikroe', socs: ['stm32f407xx'] },
    { name: 'olimex_stm32_e407', vendor: 'olimex', socs: ['stm32f407xx'] },
    { name: 'olimex_stm32_h407', vendor: 'olimex', socs: ['stm32f407xx'] },
    { name: 'segger_trb_stm32f407', vendor: 'segger', socs: ['stm32f407xx'] },
    { name: 'stm32f4_disco', vendor: 'st', socs: ['stm32f407xx'] },
  ],
  'stm32f410rx': [
    { name: 'nucleo_f410rb', vendor: 'st', socs: ['stm32f410rx'] },
  ],
  'stm32f411xe': [
    { name: '96b_neonkey', vendor: '96boards', socs: ['stm32f411xe'] },
    { name: 'blackpill_f411ce', vendor: 'weact', socs: ['stm32f411xe'] },
    { name: 'nucleo_f411re', vendor: 'st', socs: ['stm32f411xe'] },
    { name: 'stm32f411e_disco', vendor: 'st', socs: ['stm32f411xe'] },
  ],
  'stm32f412cx': [
    { name: '96b_argonkey', vendor: '96boards', socs: ['stm32f412cx'] },
    { name: 'google_dragonclaw', vendor: 'google', socs: ['stm32f412cx'] },
  ],
  'stm32f412rx': [
    { name: 'az3166_iotdevkit', vendor: 'mxchip', socs: ['stm32f412rx'] },
  ],
  'stm32f412zx': [
    { name: 'nucleo_f412zg', vendor: 'st', socs: ['stm32f412zx'] },
    { name: 'stm32f412g_disco', vendor: 'st', socs: ['stm32f412zx'] },
  ],
  'stm32f413xx': [
    { name: 'nucleo_f413zh', vendor: 'st', socs: ['stm32f413xx'] },
    { name: 'stm32f413h_disco', vendor: 'st', socs: ['stm32f413xx'] },
  ],
  'stm32f415xx': [
    { name: 'mikroe_mini_m4_for_stm32', vendor: 'mikroe', socs: ['stm32f415xx'] },
    { name: 'mikroe_stm32_m4_clicker', vendor: 'mikroe', socs: ['stm32f415xx'] },
  ],
  'stm32f427xx': [
    { name: '96b_aerocore2', vendor: '96boards', socs: ['stm32f427xx'] },
    { name: 'mikroe_quail', vendor: 'mikroe', socs: ['stm32f427xx'] },
  ],
  'stm32f429xx': [
    { name: 'nucleo_f429zi', vendor: 'st', socs: ['stm32f429xx'] },
    { name: 'stm32f429i_disc1', vendor: 'st', socs: ['stm32f429xx'] },
    { name: 'stm32f429ii_aca', vendor: 'iar', socs: ['stm32f429xx'] },
  ],
  'stm32f439xx': [
    { name: 'nucleo_f439zi', vendor: 'st', socs: ['stm32f439xx'] },
  ],
  'stm32f446xx': [
    { name: '96b_stm32_sensor_mez', vendor: '96boards', socs: ['stm32f446xx'] },
    { name: 'nucleo_f446re', vendor: 'st', socs: ['stm32f446xx'] },
    { name: 'nucleo_f446ze', vendor: 'st', socs: ['stm32f446xx'] },
    { name: 'weact_stm32f446_core', vendor: 'weact', socs: ['stm32f446xx'] },
  ],
  'stm32f469xx': [
    { name: 'adi_sdp_k1', vendor: 'adi', socs: ['stm32f469xx'] },
    { name: 'stm32f469i_disco', vendor: 'st', socs: ['stm32f469xx'] },
  ],
  'stm32f722xx': [
    { name: 'nucleo_f722ze', vendor: 'st', socs: ['stm32f722xx'] },
  ],
  'stm32f723xx': [
    { name: 'stm32f723e_disco', vendor: 'st', socs: ['stm32f723xx'] },
  ],
  'stm32f746xx': [
    { name: 'nucleo_f746zg', vendor: 'st', socs: ['stm32f746xx'] },
    { name: 'stm32f746g_disco', vendor: 'st', socs: ['stm32f746xx'] },
  ],
  'stm32f750xx': [
    { name: 'stm32f7508_dk', vendor: 'st', socs: ['stm32f750xx'] },
  ],
  'stm32f756xx': [
    { name: 'nucleo_f756zg', vendor: 'st', socs: ['stm32f756xx'] },
  ],
  'stm32f767xx': [
    { name: 'nucleo_f767zi', vendor: 'st', socs: ['stm32f767xx'] },
  ],
  'stm32f769xx': [
    { name: 'stm32f769i_disco', vendor: 'st', socs: ['stm32f769xx'] },
  ],
  'stm32g030xx': [
    { name: 'weact_stm32g030_core', vendor: 'weact', socs: ['stm32g030xx'] },
  ],
  'stm32g031xx': [
    { name: 'nucleo_g031k8', vendor: 'st', socs: ['stm32g031xx'] },
    { name: 'stm32g0316_disco', vendor: 'st', socs: ['stm32g031xx'] },
  ],
  'stm32g070xx': [
    { name: 'nucleo_g070rb', vendor: 'st', socs: ['stm32g070xx'] },
  ],
  'stm32g071xx': [
    { name: 'nucleo_g071rb', vendor: 'st', socs: ['stm32g071xx'] },
    { name: 'stm32g071b_disco', vendor: 'st', socs: ['stm32g071xx'] },
  ],
  'stm32g081xx': [
    { name: 'stm32g081b_eval', vendor: 'st', socs: ['stm32g081xx'] },
  ],
  'stm32g0b1xx': [
    { name: 'candlelightfd', vendor: 'others', socs: ['stm32g0b1xx'] },
    { name: 'google_twinkie_v2', vendor: 'google', socs: ['stm32g0b1xx'] },
    { name: 'nucleo_g0b1re', vendor: 'st', socs: ['stm32g0b1xx'] },
    { name: 'usb2canfdv1', vendor: 'weact', socs: ['stm32g0b1xx'] },
    { name: 'weact_stm32g0b1_core', vendor: 'weact', socs: ['stm32g0b1xx'] },
  ],
  'stm32g431xx': [
    { name: 'mks_canable_v20', vendor: 'makerbase', socs: ['stm32g431xx'] },
    { name: 'nucleo_g431kb', vendor: 'st', socs: ['stm32g431xx'] },
    { name: 'nucleo_g431rb', vendor: 'st', socs: ['stm32g431xx'] },
    { name: 'weact_stm32g431_core', vendor: 'weact', socs: ['stm32g431xx'] },
  ],
  'stm32g474xx': [
    { name: 'b_g474e_dpow1', vendor: 'st', socs: ['stm32g474xx'] },
    { name: 'nucleo_g474re', vendor: 'st', socs: ['stm32g474xx'] },
  ],
  'stm32h503xx': [
    { name: 'nucleo_h503rb', vendor: 'st', socs: ['stm32h503xx'] },
    { name: 'tq_h503a', vendor: 'embedsky', socs: ['stm32h503xx'] },
  ],
  'stm32h523xx': [
    { name: 'blackpill_h523ce', vendor: 'weact', socs: ['stm32h523xx'] },
  ],
  'stm32h533xx': [
    { name: 'nucleo_h533re', vendor: 'st', socs: ['stm32h533xx'] },
  ],
  'stm32h562xx': [
    { name: 'weact_stm32h562_core', vendor: 'weact', socs: ['stm32h562xx'] },
  ],
  'stm32h563xx': [
    { name: 'nucleo_h563zi', vendor: 'st', socs: ['stm32h563xx'] },
  ],
  'stm32h573xx': [
    { name: 'stm32h573i_dk', vendor: 'st', socs: ['stm32h573xx'] },
  ],
  'stm32h5f5xx': [
    { name: 'stm32h5f5j_dk', vendor: 'st', socs: ['stm32h5f5xx'] },
  ],
  'stm32h723xx': [
    { name: 'fk723m1_zgt6', vendor: 'fanke', socs: ['stm32h723xx'] },
    { name: 'nucleo_h723zg', vendor: 'st', socs: ['stm32h723xx'] },
  ],
  'stm32h735xx': [
    { name: 'stm32h735g_disco', vendor: 'st', socs: ['stm32h735xx'] },
  ],
  'stm32h743xx': [
    { name: 'fk743m5_xih6', vendor: 'fanke', socs: ['stm32h743xx'] },
    { name: 'google_icetower', vendor: 'google', socs: ['stm32h743xx'] },
    { name: 'mini_stm32h743', vendor: 'weact', socs: ['stm32h743xx'] },
    { name: 'nucleo_h743zi', vendor: 'st', socs: ['stm32h743xx'] },
  ],
  'stm32h745xx': [
    { name: 'nucleo_h745zi_q', vendor: 'st', socs: ['stm32h745xx'] },
    { name: 'stm32h745i_disco', vendor: 'st', socs: ['stm32h745xx'] },
  ],
  'stm32h747xx': [
    { name: 'arduino_giga_r1', vendor: 'arduino', socs: ['stm32h747xx'] },
    { name: 'arduino_nicla_vision', vendor: 'arduino', socs: ['stm32h747xx'] },
    { name: 'arduino_opta', vendor: 'arduino', socs: ['stm32h747xx'] },
    { name: 'arduino_portenta_h7', vendor: 'arduino', socs: ['stm32h747xx'] },
    { name: 'stm32h747i_disco', vendor: 'st', socs: ['stm32h747xx'] },
  ],
  'stm32h750xx': [
    { name: 'art_pi', vendor: 'ruiside', socs: ['stm32h750xx'] },
    { name: 'fk750m1_vbt6', vendor: 'fanke', socs: ['stm32h750xx'] },
    { name: 'stm32h750b_dk', vendor: 'st', socs: ['stm32h750xx'] },
    { name: 'yd_stm32h750vb', vendor: 'vcc-gnd', socs: ['stm32h750xx'] },
  ],
  'stm32h753xx': [
    { name: 'linum', vendor: 'witte', socs: ['stm32h753xx'] },
    { name: 'nucleo_h753zi', vendor: 'st', socs: ['stm32h753xx'] },
  ],
  'stm32h755xx': [
    { name: 'nucleo_h755zi_q', vendor: 'st', socs: ['stm32h755xx'] },
  ],
  'stm32h757xx': [
    { name: 'stm32h757i_eval', vendor: 'st', socs: ['stm32h757xx'] },
  ],
  'stm32h7a3xx': [
    { name: 'nucleo_h7a3zi_q', vendor: 'st', socs: ['stm32h7a3xx'] },
  ],
  'stm32h7b0xx': [
    { name: 'fk7b0m1_vbt6', vendor: 'fanke', socs: ['stm32h7b0xx'] },
    { name: 'mini_stm32h7b0', vendor: 'weact', socs: ['stm32h7b0xx'] },
  ],
  'stm32h7b3xx': [
    { name: 'stm32h7b3i_dk', vendor: 'st', socs: ['stm32h7b3xx'] },
  ],
  'stm32h7r7xx': [
    { name: 'art_pi2', vendor: 'ruiside', socs: ['stm32h7r7xx'] },
  ],
  'stm32h7s3xx': [
    { name: 'nucleo_h7s3l8', vendor: 'st', socs: ['stm32h7s3xx'] },
  ],
  'stm32h7s7xx': [
    { name: 'stm32h7s78_dk', vendor: 'st', socs: ['stm32h7s7xx'] },
  ],
  'stm32l011xx': [
    { name: 'nucleo_l011k4', vendor: 'st', socs: ['stm32l011xx'] },
  ],
  'stm32l031xx': [
    { name: 'nucleo_l031k6', vendor: 'st', socs: ['stm32l031xx'] },
  ],
  'stm32l053xx': [
    { name: 'nucleo_l053r8', vendor: 'st', socs: ['stm32l053xx'] },
  ],
  'stm32l072xx': [
    { name: 'b_l072z_lrwan1', vendor: 'st', socs: ['stm32l072xx'] },
    { name: 'dragino_lsn50', vendor: 'dragino', socs: ['stm32l072xx'] },
    { name: 'dragino_nbsn95', vendor: 'dragino', socs: ['stm32l072xx'] },
  ],
  'stm32l073xx': [
    { name: 'nucleo_l073rz', vendor: 'st', socs: ['stm32l073xx'] },
    { name: 'ronoth_lodev', vendor: 'ronoth', socs: ['stm32l073xx'] },
  ],
  'stm32l151xb': [
    { name: 'stm32l1_disco', vendor: 'st', socs: ['stm32l151xb'] },
  ],
  'stm32l151xba': [
    { name: '96b_wistrio', vendor: '96boards', socs: ['stm32l151xba'] },
  ],
  'stm32l152xc': [
    { name: 'stm32l152c_disco', vendor: 'st', socs: ['stm32l152xc'] },
  ],
  'stm32l152xe': [
    { name: 'nucleo_l152re', vendor: 'st', socs: ['stm32l152xe'] },
  ],
  'stm32l412xx': [
    { name: 'apex_pro_mini', vendor: 'steelseries', socs: ['stm32l412xx'] },
    { name: 'nucleo_l412rb_p', vendor: 'st', socs: ['stm32l412xx'] },
  ],
  'stm32l432xx': [
    { name: 'nucleo_l432kc', vendor: 'st', socs: ['stm32l432xx'] },
  ],
  'stm32l433xx': [
    { name: 'cygnet', vendor: 'blues', socs: ['stm32l433xx'] },
    { name: 'nucleo_l433rc_p', vendor: 'st', socs: ['stm32l433xx'] },
  ],
  'stm32l452xx': [
    { name: 'nucleo_l452re', vendor: 'st', socs: ['stm32l452xx'] },
  ],
  'stm32l475xx': [
    { name: 'disco_l475_iot1', vendor: 'st', socs: ['stm32l475xx'] },
    { name: 'pandora_stm32l475', vendor: 'alientek', socs: ['stm32l475xx'] },
  ],
  'stm32l476xx': [
    { name: 'nucleo_l476rg', vendor: 'st', socs: ['stm32l476xx'] },
    { name: 'stm32l476g_disco', vendor: 'st', socs: ['stm32l476xx'] },
  ],
  'stm32l496xx': [
    { name: 'nucleo_l496zg', vendor: 'st', socs: ['stm32l496xx'] },
    { name: 'stm32l496g_disco', vendor: 'st', socs: ['stm32l496xx'] },
  ],
  'stm32l4a6xx': [
    { name: 'nucleo_l4a6zg', vendor: 'st', socs: ['stm32l4a6xx'] },
  ],
  'stm32l4r5xx': [
    { name: 'nucleo_l4r5zi', vendor: 'st', socs: ['stm32l4r5xx'] },
    { name: 'swan_r5', vendor: 'blues', socs: ['stm32l4r5xx'] },
  ],
  'stm32l4r9xx': [
    { name: 'sensortile_box', vendor: 'st', socs: ['stm32l4r9xx'] },
    { name: 'stm32l4r9i_disco', vendor: 'st', socs: ['stm32l4r9xx'] },
  ],
  'stm32l4s5xx': [
    { name: 'adi_eval_adin1110ebz', vendor: 'adi', socs: ['stm32l4s5xx'] },
    { name: 'adi_eval_adin2111ebz', vendor: 'adi', socs: ['stm32l4s5xx'] },
    { name: 'b_l4s5i_iot01a', vendor: 'st', socs: ['stm32l4s5xx'] },
  ],
  'stm32l552xx': [
    { name: 'nucleo_l552ze_q', vendor: 'st', socs: ['stm32l552xx'] },
  ],
  'stm32l562xx': [
    { name: 'stm32l562e_dk', vendor: 'st', socs: ['stm32l562xx'] },
  ],
  'stm32mp135fxx': [
    { name: 'stm32mp135f_dk', vendor: 'st', socs: ['stm32mp135fxx'] },
  ],
  'stm32mp157cxx': [
    { name: '96b_avenger96', vendor: '96boards', socs: ['stm32mp157cxx'] },
    { name: 'stm32mp157c_dk2', vendor: 'st', socs: ['stm32mp157cxx'] },
  ],
  'stm32mp215fxx': [
    { name: 'stm32mp215f_dk', vendor: 'st', socs: ['stm32mp215fxx'] },
  ],
  'stm32mp257fxx': [
    { name: 'stm32mp257f_dk', vendor: 'st', socs: ['stm32mp257fxx'] },
    { name: 'stm32mp257f_ev1', vendor: 'st', socs: ['stm32mp257fxx'] },
  ],
  'stm32n657xx': [
    { name: 'nucleo_n657x0_q', vendor: 'st', socs: ['stm32n657xx'] },
    { name: 'stm32n6570_dk', vendor: 'st', socs: ['stm32n657xx'] },
  ],
  'stm32u031xx': [
    { name: 'nucleo_u031r8', vendor: 'st', socs: ['stm32u031xx'] },
  ],
  'stm32u083xx': [
    { name: 'nucleo_u083rc', vendor: 'st', socs: ['stm32u083xx'] },
    { name: 'stm32u083c_dk', vendor: 'st', socs: ['stm32u083xx'] },
  ],
  'stm32u385xx': [
    { name: 'nucleo_u385rg_q', vendor: 'st', socs: ['stm32u385xx'] },
  ],
  'stm32u3c5xx': [
    { name: 'nucleo_u3c5zi_q', vendor: 'st', socs: ['stm32u3c5xx'] },
  ],
  'stm32u575xx': [
    { name: 'nucleo_u575zi_q', vendor: 'st', socs: ['stm32u575xx'] },
  ],
  'stm32u585xx': [
    { name: 'arduino_uno_q', vendor: 'arduino', socs: ['stm32u585xx'] },
    { name: 'b_u585i_iot02a', vendor: 'st', socs: ['stm32u585xx'] },
    { name: 'blackpill_u585ci', vendor: 'weact', socs: ['stm32u585xx'] },
    { name: 'sensortile_box_pro', vendor: 'st', socs: ['stm32u585xx'] },
    { name: 'steval_stwinbx1', vendor: 'st', socs: ['stm32u585xx'] },
  ],
  'stm32u5a5xx': [
    { name: 'nucleo_u5a5zj_q', vendor: 'st', socs: ['stm32u5a5xx'] },
  ],
  'stm32u5a9xx': [
    { name: 'stm32u5a9j_dk', vendor: 'st', socs: ['stm32u5a9xx'] },
  ],
  'stm32u5g9xx': [
    { name: 'stm32u5g9j_dk1', vendor: 'st', socs: ['stm32u5g9xx'] },
    { name: 'stm32u5g9j_dk2', vendor: 'st', socs: ['stm32u5g9xx'] },
  ],
  'stm32wb05': [
    { name: 'nucleo_wb05kz', vendor: 'st', socs: ['stm32wb05'] },
  ],
  'stm32wb07': [
    { name: 'nucleo_wb07cc', vendor: 'st', socs: ['stm32wb07'] },
  ],
  'stm32wb09': [
    { name: 'nucleo_wb09ke', vendor: 'st', socs: ['stm32wb09'] },
  ],
  'stm32wb55xx': [
    { name: 'nucleo_wb55rg', vendor: 'st', socs: ['stm32wb55xx'] },
    { name: 'stm32wb5mm_dk', vendor: 'st', socs: ['stm32wb55xx'] },
    { name: 'stm32wb5mmg', vendor: 'st', socs: ['stm32wb55xx'] },
    { name: 'weact_stm32wb55_core', vendor: 'weact', socs: ['stm32wb55xx'] },
  ],
  'stm32wba25xx': [
    { name: 'nucleo_wba25ce1', vendor: 'st', socs: ['stm32wba25xx'] },
  ],
  'stm32wba55xx': [
    { name: 'nucleo_wba55cg', vendor: 'st', socs: ['stm32wba55xx'] },
  ],
  'stm32wba65xx': [
    { name: 'nucleo_wba65ri', vendor: 'st', socs: ['stm32wba65xx'] },
    { name: 'stm32wba65i_dk1', vendor: 'st', socs: ['stm32wba65xx'] },
  ],
  'stm32wl55xx': [
    { name: 'nucleo_wl55jc', vendor: 'st', socs: ['stm32wl55xx'] },
  ],
  'stm32wle5xx': [
    { name: 'lora_e5_dev_board', vendor: 'seeed', socs: ['stm32wle5xx'] },
    { name: 'lora_e5_mini', vendor: 'seeed', socs: ['stm32wle5xx'] },
    { name: 'olimex_lora_stm32wl_devkit', vendor: 'olimex', socs: ['stm32wle5xx'] },
    { name: 'rak11160', vendor: 'rakwireless', socs: ['stm32wle5xx'] },
    { name: 'rak3172', vendor: 'rakwireless', socs: ['stm32wle5xx'] },
    { name: 'we_oceanus1ev', vendor: 'we', socs: ['stm32wle5xx'] },
  ],
  'sun8i_h3': [
    { name: 'opi_zero', vendor: 'xunlong', socs: ['sun8i_h3'] },
  ],
  'sy120_gbm': [
    { name: 'ganymed_bob', vendor: 'sensry', socs: ['sy120_gbm', 'sy120_gen1'] },
    { name: 'ganymed_sk', vendor: 'sensry', socs: ['sy120_gbm', 'sy120_gen1'] },
  ],
  'ti_lm3s6965': [
    { name: 'qemu_cortex_m3', vendor: 'qemu', socs: ['ti_lm3s6965'] },
  ],
  'tlsr9518': [
    { name: 'tlsr9518adk80d', vendor: 'telink', socs: ['tlsr9518'] },
  ],
  'v8a': [
    { name: 'fvp_base_revc_2xaem', vendor: 'arm', socs: ['v8a', 'v9a', 'a320'] },
  ],
  'versal_apu': [
    { name: 'versal_apu', vendor: 'amd', socs: ['versal_apu'] },
  ],
  'versal_rpu': [
    { name: 'scobc_v1', vendor: 'sc', socs: ['versal_rpu'] },
    { name: 'versal_rpu', vendor: 'amd', socs: ['versal_rpu'] },
  ],
  'wildcat_lake': [
    { name: 'intel_wcl_crb', vendor: 'intel', socs: ['wildcat_lake'] },
  ],
  'xc7z007s': [
    { name: 'qemu_cortex_a9', vendor: 'qemu', socs: ['xc7z007s'] },
  ],
  'xc7z010': [
    { name: 'zybo', vendor: 'digilent', socs: ['xc7z010'] },
  ],
  'xenvm': [
    { name: 'xenvm', vendor: 'xen', socs: ['xenvm'] },
  ],
  'xmc4500': [
    { name: 'xmc45_relax_kit', vendor: 'infineon', socs: ['xmc4500'] },
  ],
  'xmc4700': [
    { name: 'xmc47_relax_kit', vendor: 'infineon', socs: ['xmc4700'] },
  ],
  'xmc7200d_e272k8384': [
    { name: 'kit_xmc72_evk', vendor: 'infineon', socs: ['xmc7200d_e272k8384'] },
  ],
  'xtensa_sample_controller': [
    { name: 'xt-sim', vendor: 'cdns', socs: ['xtensa_sample_controller'] },
  ],
  'zynqmp_rpu': [
    { name: 'kv260_r5', vendor: 'amd', socs: ['zynqmp_rpu'] },
    { name: 'mercury_xu', vendor: 'enclustra', socs: ['zynqmp_rpu'] },
    { name: 'qemu_cortex_r5', vendor: 'qemu', socs: ['zynqmp_rpu'] },
  ],
};
