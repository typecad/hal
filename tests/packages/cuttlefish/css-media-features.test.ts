import { describe, it, expect, afterEach } from "vitest";
// Import from SRC (not the package export) so parseCss + setDisplayProfile share
// the same module instance — evalMediaCondition reads getDisplayProfile() from
// its own module, so the profile must be set on that same instance. This mirrors
// the pattern in css-parser.test.ts (theme-state sharing).
import { parseCss } from "../../../packages/cuttlefish/src/ui/css-parser";
import { setDisplayProfile, resetDisplayProfile } from "../../../packages/cuttlefish/src/stores/display-profile-store";
import type { DisplayProfile } from "../../../packages/cuttlefish/src/api/shared/display-profile";

function idsOf(rules: any[]): string[] {
  return rules.map(r => r.selector.compounds[0][0].name);
}

describe("@media display-class features", () => {
  // setDisplayProfile takes a profile AND a wiring object ({cs,dc,rst,bus}).
  const tftProfile: DisplayProfile = {
    driver: "ili9341", width: 320, height: 240, colorFormat: "rgb565", rotation: 1,
  };
  const einkProfile: DisplayProfile = {
    driver: "ssd1680", width: 296, height: 128, colorFormat: "mono", rotation: 1, displayClass: "eink",
  };
  const wiring = { cs: 5, dc: 21, rst: 22, bus: "SPI" };

  afterEach(() => resetDisplayProfile());

  const setTft = () => setDisplayProfile(tftProfile, wiring);
  const setEink = () => setDisplayProfile(einkProfile, wiring);

  it("(e-ink) keeps rules on an eink profile, drops them on TFT", () => {
    setEink();
    const einkRules = parseCss(`@media (e-ink) { #a { color: black; } }`);
    expect(idsOf(einkRules)).toContain("a");

    setTft();
    const tftRules = parseCss(`@media (e-ink) { #a { color: black; } } #b { color: red; }`);
    expect(idsOf(tftRules)).not.toContain("a");
    expect(idsOf(tftRules)).toContain("b");
  });

  it("(update: slow) matches eink; (update: fast) matches TFT", () => {
    setEink();
    expect(idsOf(parseCss(`@media (update: slow) { #slow { color: black; } }`))).toContain("slow");
    expect(idsOf(parseCss(`@media (update: fast) { #fast { color: black; } }`))).not.toContain("fast");

    setTft();
    expect(idsOf(parseCss(`@media (update: fast) { #fast { color: red; } }`))).toContain("fast");
    expect(idsOf(parseCss(`@media (update: slow) { #slow { color: red; } }`))).not.toContain("slow");
  });

  it("(monochrome) matches a mono eink profile; (monochrome: 2) requires N>=2 levels", () => {
    setEink(); // colorFormat mono -> 2 levels
    expect(idsOf(parseCss(`@media (monochrome) { #m { color: black; } }`))).toContain("m");
    expect(idsOf(parseCss(`@media (monochrome: 2) { #m2 { color: black; } }`))).toContain("m2");
    expect(idsOf(parseCss(`@media (monochrome: 4) { #m4 { color: black; } }`))).not.toContain("m4");

    setTft(); // rgb565 -> color, not monochrome
    expect(idsOf(parseCss(`@media (monochrome) { #m { color: red; } }`))).not.toContain("m");
  });

  it("(color-gamut: srgb) matches both TFT and eink; (color-gamut: p3) matches neither (no wide gamut yet)", () => {
    setTft();
    expect(idsOf(parseCss(`@media (color-gamut: srgb) { #s { color: red; } }`))).toContain("s");
    expect(idsOf(parseCss(`@media (color-gamut: p3) { #p { color: red; } }`))).not.toContain("p");

    setEink();
    expect(idsOf(parseCss(`@media (color-gamut: srgb) { #s { color: black; } }`))).toContain("s");
  });

  it("AND-combines with width/height (e-ink AND min-width)", () => {
    setEink(); // visible width 296
    expect(idsOf(parseCss(`@media (e-ink) and (min-width: 200px) { #ok { color: black; } }`))).toContain("ok");
    expect(idsOf(parseCss(`@media (e-ink) and (min-width: 400px) { #no { color: black; } }`))).not.toContain("no");
  });

  it("uses effective dimensions when a profile declares native rotated size", () => {
    setDisplayProfile({
      driver: "st7796",
      width: 480,
      height: 320,
      nativeWidth: 320,
      nativeHeight: 480,
      colorFormat: "rgb565",
      rotation: 1,
    }, wiring);
    expect(idsOf(parseCss(`@media (width: 480px) and (height: 320px) { #ok { color: red; } }`))).toContain("ok");
    expect(idsOf(parseCss(`@media (width: 320px) and (height: 480px) { #raw { color: red; } }`))).not.toContain("raw");
  });
});
