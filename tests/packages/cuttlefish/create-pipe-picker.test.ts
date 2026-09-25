import { describe, it, expect, vi, afterEach } from "vitest";

import { lineModePick } from "../../../packages/cuttlefish/src/create/board-search";
import { StdinClosedError } from "../../../packages/cuttlefish/src/create/prompt-io";

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The wizard's board picker degrades to lineModePick when stdin is not a
 * terminal (a parent tool — e.g. the pcb CLI's `workspaces create` — spawns
 * `typecad-hal create` with a piped stdin the raw-mode select cannot drive).
 * These tests script the question/answer flow; the isTTY routing itself is
 * covered by the spawned-CLI scenario.
 */
function scriptedAsker(answers: string[]): { prompts: string[]; ask: (p: string) => Promise<string> } {
  const prompts: string[] = [];
  let i = 0;
  return {
    prompts,
    ask: async (p: string): Promise<string> => {
      prompts.push(p);
      const a = answers[i++];
      if (a === undefined) throw new StdinClosedError();
      return a;
    },
  };
}

const OPTS = [
  { name: "Native Desktop (Windows/Linux executable)", value: "native:desktop" },
  { name: "ESP32-C3 DevKit (esp32c3_devkit/esp32c3)", value: "esp32c3_devkit/esp32c3" },
  { name: "Nucleo F411RE (nucleo_f411re/stm32f411xe)", value: "nucleo_f411re/stm32f411xe" },
];

describe("lineModePick", () => {
  it("searches, lists matches, and picks by number", async () => {
    const asker = scriptedAsker(["nucleo", "1"]);
    const lines: string[] = [];
    const value = await lineModePick("target", OPTS, asker.ask, (l) => lines.push(l));

    expect(value).toBe("nucleo_f411re/stm32f411xe");
    // The filtered list shows only the match…
    expect(lines.some((l) => l.includes("Nucleo F411RE"))).toBe(true);
    expect(lines.some((l) => l.includes("Native Desktop"))).toBe(false);
    // …and the flow is one search question + one pick question.
    expect(asker.prompts).toHaveLength(2);
    expect(asker.prompts[0]).toContain("Search target");
    expect(asker.prompts[1]).toContain("Pick 1-1");
  });

  it("empty search lists the first page unfiltered", async () => {
    const asker = scriptedAsker(["", "2"]);
    const value = await lineModePick("target", OPTS, asker.ask, () => {});
    expect(value).toBe("esp32c3_devkit/esp32c3");
  });

  it("an out-of-range number warns and re-asks without a new search", async () => {
    const asker = scriptedAsker(["esp32", "99", "1"]);
    const lines: string[] = [];
    const value = await lineModePick("target", OPTS, asker.ask, (l) => lines.push(l));

    expect(value).toBe("esp32c3_devkit/esp32c3");
    expect(lines.some((l) => l.includes("between 1 and"))).toBe(true);
    // search + bad pick + good pick
    expect(asker.prompts).toHaveLength(3);
  });

  it("a non-number at the pick prompt becomes the new search query", async () => {
    const asker = scriptedAsker(["", "nomatch", "nucleo", "1"]);
    const lines: string[] = [];
    const value = await lineModePick("target", OPTS, asker.ask, (l) => lines.push(l));

    expect(value).toBe("nucleo_f411re/stm32f411xe");
    expect(lines.some((l) => l.includes('No target matches "nomatch"'))).toBe(true);
  });

  it("cancels with the non-interactive remedy when stdin closes mid-prompt", async () => {
    const asker = scriptedAsker(["esp32"]); // pick prompt hits EOF
    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((l?: string) => {
      logged.push(l ?? "");
    });

    const value = await lineModePick("target", OPTS, asker.ask, () => {});

    expect(value).toBeUndefined();
    const text = logged.join("\n");
    expect(text).toContain("No interactive input on stdin");
    expect(text).toContain("--board");
  });
});
