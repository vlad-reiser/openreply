import { describe, expect, it } from "vitest";
import { msUntilAllowed, parseSteps, stepDelayMs } from "@/lib/tracking/steps";

const SEQUENCE = `[steg]
efter: 60
tyst: 22-07
Om du missade den innan 👇
[kort]
bild: https://i.ytimg.com/vi/abc/maxresdefault.jpg
rubrik: Förra videon
knapp: Titta nu
länk: https://www.youtube.com/watch?v=abc
[steg]
efter: 2 h
tyst: 22-07
hoppa-om: camp1, camp2 90
ja-knapp: Ja!
Snabb fråga 👀

Vill du ha den?
[svar]
Varsågod!
[kort]
bild: https://example.com/a.png
rubrik: Analys
länk: https://example.com/`;

describe("follow-up steps", () => {
  it("leaves a plain follow-up message alone", () => {
    expect(parseSteps("Tack för att du tittade!")).toBeNull();
    expect(parseSteps(null)).toBeNull();
  });

  it("parses settings, text, card and button reply", () => {
    const steps = parseSteps(SEQUENCE)!;
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      delayMinutes: 60,
      quiet: { from: 22, to: 7 },
      skipIf: null,
      buttonTitle: null,
      reply: null,
    });
    expect(steps[0].message).toContain("[kort]");
    expect(steps[0].message.startsWith("Om du missade")).toBe(true);
    expect(steps[1]).toMatchObject({
      delayMinutes: 120,
      skipIf: { automationIds: ["camp1", "camp2"], days: 90 },
      buttonTitle: "Ja!",
    });
    expect(steps[1].message).toBe("Snabb fråga 👀\n\nVill du ha den?");
    expect(steps[1].reply).toContain("Varsågod!");
    expect(steps[1].reply).toContain("[kort]");
  });

  it("drops a button that has no reply, and steps with no text", () => {
    const steps = parseSteps("[steg]\nja-knapp: Ja\nHej\n[steg]\nefter: 5\n")!;
    expect(steps).toHaveLength(1);
    expect(steps[0].buttonTitle).toBeNull();
  });

  it("keeps messages out of the quiet hours (Stockholm time)", () => {
    const quiet = { from: 22, to: 7 };
    // November: Stockholm is UTC+1.
    expect(msUntilAllowed(new Date("2026-11-22T12:00:00Z"), quiet)).toBe(0);
    expect(msUntilAllowed(new Date("2026-11-22T20:59:00Z"), quiet)).toBe(0); // 21:59
    expect(msUntilAllowed(new Date("2026-11-22T21:00:00Z"), quiet)).toBe(9 * 3_600_000); // 22:00 → 07:00
    expect(msUntilAllowed(new Date("2026-11-23T05:30:00Z"), quiet)).toBe(30 * 60_000); // 06:30 → 07:00
    expect(msUntilAllowed(new Date("2026-11-23T06:00:00Z"), quiet)).toBe(0); // 07:00
    // July: UTC+2.
    expect(msUntilAllowed(new Date("2026-07-01T20:30:00Z"), quiet)).toBe(8.5 * 3_600_000); // 22:30 → 07:00
    expect(msUntilAllowed(new Date("2026-07-01T12:00:00Z"), null)).toBe(0);
  });

  it("pushes a step that would land at night to the morning", () => {
    const step = { delayMinutes: 120, quiet: { from: 22, to: 7 } };
    // 21:30 Stockholm + 2 h = 23:30 → 07:00, i.e. 9.5 h from now.
    expect(stepDelayMs(step, new Date("2026-11-22T20:30:00Z"))).toBe(9.5 * 3_600_000);
    expect(stepDelayMs(step, new Date("2026-11-22T20:30:00Z"), 60_000)).toBe(9.5 * 3_600_000 + 60_000);
    // 10:00 + 2 h = 12:00 → unchanged, and no spread added.
    expect(stepDelayMs(step, new Date("2026-11-22T09:00:00Z"), 60_000)).toBe(2 * 3_600_000);
  });
});
